import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// Compile the real transport with the project's TypeScript dependency. No test framework download.
const directory = await mkdtemp(join(tmpdir(), "clipforge-upload-test-"));
const compiled = ts.transpileModule(
  await readFile(new URL("../src/upload.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
await writeFile(join(directory, "upload.mjs"), compiled);
const {
  uploadVideo,
  fingerprint,
  UploadError,
  errorFor,
  sendChunk,
  jsonRequest,
  wait,
  REQUEST_MS,
} = await import(pathToFileURL(join(directory, "upload.mjs")));
after(() => rm(directory, { recursive: true, force: true }));
const originalFetch = globalThis.fetch;
const originalXHR = globalThis.XMLHttpRequest;
afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.XMLHttpRequest = originalXHR;
});

function fixture(savedBytes = 0) {
  const file = new File([new Uint8Array(10)], "movie.mp4", {
    lastModified: 123,
  });
  const session = {
    id: "upload-id",
    name: file.name,
    size: 10,
    received: savedBytes,
    status: "uploading",
    error: null,
    chunk_bytes: 4,
  };
  let remembered = savedBytes
    ? { id: session.id, fingerprint: fingerprint(file) }
    : null;
  const controller = new AbortController();
  const sent = [],
    progress = [],
    delays = [];
  const options = {
    signal: controller.signal,
    saved: remembered,
    remember: (value) => {
      remembered = value;
    },
    progress: (value) => progress.push(value),
  };
  const deps = {
    now: () => 10,
    newId: () => session.id,
    delay: async (ms) => {
      delays.push(ms);
    },
    request: async (url, _signal, init) => {
      if (url === "/api/uploads")
        assert.equal(JSON.parse(init.body).size, file.size);
      if (url.endsWith("/complete")) session.status = "complete";
      return url.startsWith("/api/projects/")
        ? { id: session.id }
        : structuredClone(session);
    },
    send: async (url, blob, _signal, onProgress) => {
      const offset = Number(
        new URL(url, "http://test").searchParams.get("offset"),
      );
      sent.push(offset);
      assert.equal(offset, session.received);
      onProgress(blob.size);
      session.received += blob.size;
      return structuredClone(session);
    },
  };
  return {
    file,
    session,
    options,
    deps,
    sent,
    progress,
    delays,
    controller,
    remembered: () => remembered,
  };
}

test("uses bounded chunks and confirmed progress, clears the saved session on success", async () => {
  const f = fixture();
  assert.deepEqual(await uploadVideo(f.file, f.options, f.deps), {
    id: f.session.id,
  });
  assert.deepEqual(f.sent, [0, 4, 8]);
  assert.equal(f.remembered(), null);
  assert.ok(
    f.progress.some(
      (value) => value.transferred === 4 && value.confirmed === 0,
    ),
  );
  assert.ok(
    f.progress
      .filter((value) => value.confirmed === 10)
      .every((value) => value.transferred === 10),
  );
});

test("resume skips confirmed bytes after reselection", async () => {
  const f = fixture(4);
  await uploadVideo(f.file, f.options, f.deps);
  assert.deepEqual(f.sent, [4, 8]);
});

test("lost receipt recovers saved offset without appending duplicate bytes", async () => {
  const f = fixture();
  const send = f.deps.send;
  let loseReceipt = true;
  f.deps.send = async (...args) => {
    const result = await send(...args);
    if (loseReceipt) {
      loseReceipt = false;
      throw new UploadError("Lost receipt", 0, true);
    }
    return result;
  };
  await uploadVideo(f.file, f.options, f.deps);
  assert.deepEqual(f.sent, [0, 4, 8]);
  assert.deepEqual(f.delays, [1000]);
});

test("retries stop after three retries, preserving the resume identifier", async () => {
  const f = fixture();
  let attempts = 0;
  f.deps.send = async () => {
    attempts++;
    throw new UploadError("Network interrupted", 0, true);
  };
  await assert.rejects(
    uploadVideo(f.file, f.options, f.deps),
    /Network interrupted/,
  );
  assert.equal(attempts, 4);
  assert.deepEqual(f.delays, [1000, 2000, 4000]);
  assert.equal(f.remembered().id, f.session.id);
});

test("disk-full response stops immediately with a useful message", async () => {
  const f = fixture();
  f.deps.send = async () => {
    throw errorFor(507, "<html>storage full</html>");
  };
  await assert.rejects(uploadVideo(f.file, f.options, f.deps), /disk space/);
  assert.equal(f.delays.length, 0);
});

test("pause aborts without clearing confirmed progress or the session", async () => {
  const f = fixture(4);
  f.deps.send = async () => {
    f.controller.abort();
    throw new DOMException("Paused", "AbortError");
  };
  await assert.rejects(uploadVideo(f.file, f.options, f.deps), {
    name: "AbortError",
  });
  assert.equal(f.remembered().id, f.session.id);
});

test("validation polls separately, without resending the file", async () => {
  const f = fixture(10);
  const request = f.deps.request;
  let waiting = false;
  f.deps.request = async (url, ...args) => {
    if (url.endsWith("/complete")) {
      waiting = true;
      return { ...f.session, status: "validating" };
    }
    if (waiting && url === `/api/uploads/${f.session.id}`)
      return { ...f.session, status: "complete" };
    return request(url, ...args);
  };
  await uploadVideo(f.file, f.options, f.deps);
  assert.deepEqual(f.sent, []);
  assert.ok(f.progress.some((value) => value.phase === "validating"));
});

test("failed media validation clears the unusable session and reports the server reason", async () => {
  const f = fixture(10);
  f.session.status = "failed";
  f.session.error = "Not a readable MP4";
  await assert.rejects(
    uploadVideo(f.file, f.options, f.deps),
    /Not a readable MP4/,
  );
  assert.equal(f.remembered(), null);
});

test("expired session creates a new idempotent upload instead of sending to an expired offset", async () => {
  const f = fixture(4);
  let expired = true;
  const request = f.deps.request;
  f.deps.request = async (url, ...args) => {
    if (expired) {
      expired = false;
      f.session.received = 0;
      throw errorFor(410, "");
    }
    return request(url, ...args);
  };
  await uploadVideo(f.file, f.options, f.deps);
  assert.deepEqual(f.sent, [0, 4, 8]);
});

class FakeXHR {
  static latest;
  upload = {};
  status = 200;
  responseText = "{}";
  constructor() {
    FakeXHR.latest = this;
  }
  open() {}
  setRequestHeader() {}
  send() {}
  abort() {
    this.onabort?.();
  }
}

test("XHR inactivity watchdog rejects and aborts a stalled chunk", async () => {
  globalThis.XMLHttpRequest = FakeXHR;
  const pending = sendChunk(
    "/test",
    new Blob(["data"]),
    new AbortController().signal,
    () => {},
    10,
  );
  assert.equal(FakeXHR.latest.timeout, REQUEST_MS);
  await assert.rejects(pending, /No upload progress/);
});

test("XHR timeout and non-JSON proxy failures have actionable errors", async () => {
  globalThis.XMLHttpRequest = FakeXHR;
  const pending = sendChunk(
    "/test",
    new Blob(["data"]),
    new AbortController().signal,
    () => {},
  );
  FakeXHR.latest.ontimeout();
  await assert.rejects(pending, /10-minute/);
  const proxy = sendChunk(
    "/test",
    new Blob(["data"]),
    new AbortController().signal,
    () => {},
  );
  FakeXHR.latest.status = 504;
  FakeXHR.latest.responseText = "<html>Gateway timeout</html>";
  FakeXHR.latest.onload();
  await assert.rejects(proxy, /504/);
});

test("metadata requests have a response timeout and support user cancellation", async () => {
  globalThis.fetch = (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError")),
      );
    });
  await assert.rejects(
    jsonRequest("/test", new AbortController().signal, {}, 10),
    /did not respond/,
  );
  const controller = new AbortController();
  const pending = jsonRequest("/test", controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("backoff delay is cancellable", async () => {
  const controller = new AbortController();
  const pending = wait(60_000, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});
