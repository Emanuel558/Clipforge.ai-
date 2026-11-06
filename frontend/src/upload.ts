/** Resumable upload transport. Server receipts, rather than browser buffering, define progress. */
export type UploadSession = {
  id: string;
  name: string;
  size: number;
  received: number;
  status: "uploading" | "validating" | "complete" | "failed";
  error: string | null;
  chunk_bytes: number;
};
export type UploadProgress = {
  phase: "connecting" | "uploading" | "retrying" | "validating";
  message: string;
  confirmed: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
};
export type SavedUpload = { id: string; fingerprint: string };
export const STORAGE_KEY = "clipforge-upload-v1";
export const IDLE_MS = 90_000;
export const REQUEST_MS = 600_000;
const MAX_RETRIES = 3;

export class UploadError extends Error {
  constructor(
    message: string,
    public status = 0,
    public retryable = false,
  ) {
    super(message);
  }
}
const aborted = () => new DOMException("Upload paused.", "AbortError");
function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw aborted();
}
export function fingerprint(file: File) {
  return JSON.stringify([file.name, file.size, file.lastModified]);
}
export function errorFor(status: number, text: string): UploadError {
  let body: { detail?: unknown } = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* Forwarded-port errors are sometimes HTML. */
  }
  const fallback =
    status === 401 || status === 403
      ? "Your workspace session expired. Sign in to GitHub, reopen the private port, then resume."
      : status === 413
        ? "An upload request was rejected for its size. Check the server or proxy limit."
        : status === 507
          ? "The workspace is out of disk space. Delete unused projects, then resume."
          : `Upload request failed (${status || "network error"}). Resume after checking your connection and workspace.`;
  return new UploadError(
    typeof body.detail === "string" ? body.detail : fallback,
    status,
    status === 0 ||
      status === 408 ||
      status === 409 ||
      status === 429 ||
      (status >= 500 && status !== 507),
  );
}
export async function jsonRequest<T>(
  url: string,
  signal: AbortSignal,
  options: RequestInit = {},
  timeoutMs = 30_000,
): Promise<T> {
  checkAbort(signal);
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw errorFor(response.status, text);
    if (response.status === 204) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new UploadError(
        "The server returned an unreadable receipt. Resume to check saved progress.",
        0,
        true,
      );
    }
  } catch (error) {
    if (signal.aborted) throw aborted();
    if (timedOut)
      throw new UploadError(
        "The workspace did not respond within 30 seconds. Resume to check saved progress.",
        408,
        true,
      );
    if (error instanceof UploadError) throw error;
    throw new UploadError(
      "The connection stopped. Resume from the last saved chunk.",
      0,
      true,
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}

export function sendChunk(
  url: string,
  blob: Blob,
  signal: AbortSignal,
  progress: (loaded: number) => void,
  idleMs = IDLE_MS,
): Promise<UploadSession> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(aborted());
      return;
    }
    const xhr = new XMLHttpRequest();
    let finished = false;
    let lastLoaded = 0;
    let idle: ReturnType<typeof setTimeout>;
    const cancel = () => {
      finish(aborted());
      xhr.abort();
    };
    function finish(error?: Error, result?: UploadSession) {
      if (finished) return;
      finished = true;
      clearTimeout(idle);
      signal.removeEventListener("abort", cancel);
      if (error) reject(error);
      else resolve(result!);
    }
    const resetIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        finish(
          new UploadError(
            "No upload progress or server receipt for 90 seconds. Retrying the unfinished chunk.",
            408,
            true,
          ),
        );
        xhr.abort();
      }, idleMs);
    };
    xhr.open("PUT", url);
    xhr.timeout = REQUEST_MS;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (finished) return;
      if (event.loaded > lastLoaded) {
        lastLoaded = event.loaded;
        resetIdle();
      }
      progress(Math.min(blob.size, event.loaded));
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        finish(errorFor(xhr.status, xhr.responseText));
        return;
      }
      try {
        finish(undefined, JSON.parse(xhr.responseText));
      } catch {
        finish(
          new UploadError(
            "The server receipt was unreadable. Checking saved progress.",
            0,
            true,
          ),
        );
      }
    };
    xhr.onerror = () =>
      finish(
        new UploadError(
          "Connection interrupted. Retrying from saved progress.",
          0,
          true,
        ),
      );
    xhr.ontimeout = () =>
      finish(
        new UploadError(
          "This chunk exceeded the 10-minute transfer limit. Retrying from saved progress.",
          408,
          true,
        ),
      );
    xhr.onabort = () => finish(aborted());
    signal.addEventListener("abort", cancel, { once: true });
    resetIdle();
    try {
      xhr.send(blob);
    } catch {
      finish(
        new UploadError(
          "The browser could not send this chunk. Check your connection and resume.",
          0,
          true,
        ),
      );
    }
  });
}
export function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(aborted());
      return;
    }
    const cancel = () => {
      clearTimeout(timer);
      reject(aborted());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

type Dependencies = {
  request: typeof jsonRequest;
  send: typeof sendChunk;
  delay: typeof wait;
  now: () => number;
  newId: () => string;
};
const defaults: Dependencies = {
  request: jsonRequest,
  send: sendChunk,
  delay: wait,
  now: () => performance.now(),
  newId: () => crypto.randomUUID(),
};

type Options = {
  signal: AbortSignal;
  saved: SavedUpload | null;
  remember: (value: SavedUpload | null) => void;
  progress: (value: UploadProgress) => void;
};
export async function uploadVideo<T>(
  file: File,
  options: Options,
  overrides: Partial<Dependencies> = {},
): Promise<T> {
  const deps = { ...defaults, ...overrides };
  const { signal } = options;
  const fileKey = fingerprint(file);
  let saved = options.saved?.fingerprint === fileKey ? options.saved : null;
  let session: UploadSession | undefined;
  let transferred = 0,
    confirmed = 0;
  const started = deps.now();
  let initialBytes = 0;
  function report(phase: UploadProgress["phase"], message: string) {
    const seconds = (deps.now() - started) / 1000;
    options.progress({
      phase,
      message,
      confirmed,
      transferred,
      total: file.size,
      bytesPerSecond:
        seconds > 0 ? Math.max(0, transferred - initialBytes) / seconds : 0,
    });
  }
  function validateReceipt(value: UploadSession) {
    if (
      value.id !== saved!.id ||
      value.size !== file.size ||
      !Number.isSafeInteger(value.received) ||
      value.received < 0 ||
      value.received > file.size ||
      !Number.isSafeInteger(value.chunk_bytes) ||
      value.chunk_bytes <= 0 ||
      value.chunk_bytes > 4 * 1024 * 1024
    )
      throw new UploadError(
        "Invalid server receipt. Pause and check the workspace before resuming.",
      );
    return value;
  }
  const retry = async <R>(operation: () => Promise<R>): Promise<R> => {
    for (let attempt = 0; ; attempt++) {
      checkAbort(signal);
      try {
        return await operation();
      } catch (error) {
        if (signal.aborted) throw aborted();
        if (
          !(error instanceof UploadError) ||
          !error.retryable ||
          attempt >= MAX_RETRIES
        )
          throw error;
        report(
          "retrying",
          `${error.message} Retry ${attempt + 1} of ${MAX_RETRIES}…`,
        );
        await deps.delay(1000 * 2 ** attempt, signal);
      }
    }
  };
  report("connecting", "Connecting to your workspace…");
  if (saved) {
    try {
      session = validateReceipt(
        await retry(() =>
          deps.request<UploadSession>(`/api/uploads/${saved!.id}`, signal),
        ),
      );
    } catch (error) {
      if (error instanceof UploadError && [404, 410].includes(error.status)) {
        saved = null;
        options.remember(null);
      } else throw error;
    }
  }
  if (!saved) {
    saved = { id: deps.newId(), fingerprint: fileKey };
    options.remember(saved);
  }
  if (!session)
    session = validateReceipt(
      await retry(() =>
        deps.request<UploadSession>("/api/uploads", signal, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: saved!.id,
            filename: file.name,
            size: file.size,
          }),
        }),
      ),
    );
  confirmed = session.received;
  transferred = confirmed;
  initialBytes = confirmed;
  while (session.status === "uploading" && confirmed < file.size) {
    await retry(async () => {
      // A lost receipt might follow a successful write. Always ask before resending.
      session = validateReceipt(
        await deps.request<UploadSession>(`/api/uploads/${saved!.id}`, signal),
      );
      confirmed = session.received;
      transferred = confirmed;
      if (session.status !== "uploading" || confirmed === file.size) return;
      const offset = confirmed;
      const chunk = file.slice(
        offset,
        Math.min(file.size, offset + session.chunk_bytes),
      );
      report(
        "uploading",
        "Sending a chunk. Confirmed progress updates after saving.",
      );
      session = validateReceipt(
        await deps.send(
          `/api/uploads/${saved!.id}?offset=${offset}`,
          chunk,
          signal,
          (loaded) => {
            transferred = offset + loaded;
            report(
              "uploading",
              "Sending a chunk. Waiting for the server receipt.",
            );
          },
        ),
      );
      if (session.received !== offset + chunk.size)
        throw new UploadError(
          "The server did not confirm this chunk. Checking saved progress.",
          409,
          true,
        );
      confirmed = session.received;
      transferred = confirmed;
      report("uploading", "Chunk saved to your workspace.");
    });
  }
  if (session.status === "uploading") {
    report("validating", "All bytes saved. Queuing the video check…");
    session = validateReceipt(
      await retry(() =>
        deps.request<UploadSession>(
          `/api/uploads/${saved!.id}/complete`,
          signal,
          { method: "POST" },
        ),
      ),
    );
  }
  const deadline = deps.now() + 30 * 60 * 1000;
  while (session.status === "validating") {
    report(
      "validating",
      "All bytes saved. Video check is queued or running. Keep this workspace running.",
    );
    if (deps.now() >= deadline)
      throw new UploadError(
        "The video check is still pending. Open the dashboard or resume later to check the result.",
      );
    await deps.delay(1500, signal);
    session = validateReceipt(
      await retry(() =>
        deps.request<UploadSession>(`/api/uploads/${saved!.id}`, signal),
      ),
    );
  }
  if (session.status === "failed") {
    options.remember(null);
    throw new UploadError(
      session.error || "Video validation failed. Choose another MP4.",
    );
  }
  if (session.status !== "complete")
    throw new UploadError(
      "Upload stopped before completion. Resume to check the saved state.",
    );
  const project = await retry(() =>
    deps.request<T>(`/api/projects/${session!.id}`, signal),
  );
  options.remember(null);
  return project;
}
