import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  CloudUpload,
  Film,
  FolderOpen,
  LayoutDashboard,
  LoaderCircle,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  Video,
  X,
} from "lucide-react";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import "./style.css";

type Project = {
  id: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  bytes: number;
  created: number;
  status: string;
  error: string | null;
  trim_start: number;
  trim_end: number;
};
type Export = {
  id: string;
  start: number;
  end: number;
  status: string;
  progress: number;
  error: string | null;
};
type Page = "dashboard" | "upload" | "editor";
const time = (value: number) => {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  return `${Math.floor(safe / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(safe % 60)
    .toString()
    .padStart(2, "0")}`;
};
const size = (value: number) => `${(value / 1024 / 1024).toFixed(1)} MB`;
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      typeof error.detail === "string"
        ? error.detail
        : "The request failed. Please try again.",
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadName, setUploadName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [exports, setExports] = useState<Export[]>([]);
  const [start, setStart] = useState("0");
  const [end, setEnd] = useState("0");
  const [currentTime, setCurrentTime] = useState(0);
  const [exportSubmitting, setExportSubmitting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const uploadRequest = useRef<XMLHttpRequest | null>(null);
  const selected = projects.find((project) => project.id === selectedId);
  const activeExport = exports.find((item) =>
    ["queued", "rendering"].includes(item.status),
  );
  const startValue = Number(start),
    endValue = Number(end);
  const validTrim =
    !!selected &&
    start.trim() !== "" &&
    end.trim() !== "" &&
    Number.isFinite(startValue) &&
    Number.isFinite(endValue) &&
    startValue >= 0 &&
    endValue > startValue &&
    endValue <= selected.duration + 0.001;

  async function loadProjects() {
    const items = await api<Project[]>("/api/projects");
    setProjects(items);
    return items;
  }
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const items = await api<Project[]>("/api/projects");
        if (alive) setProjects(items);
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 3000);
    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, []);
  useEffect(() => {
    if (!selectedId) {
      setExports([]);
      return;
    }
    let alive = true;
    setExports([]);
    const refresh = async () => {
      try {
        const items = await api<Export[]>(
          `/api/projects/${selectedId}/exports`,
        );
        if (alive) setExports(items);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 1200);
    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [selectedId]);
  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (uploadRequest.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("beforeunload", onLeave);
      uploadRequest.current?.abort();
    };
  }, []);

  function navigate(next: Page) {
    setPage(next);
    setError("");
    setPreviewing(false);
    player.current?.pause();
  }
  function open(project: Project) {
    setSelectedId(project.id);
    setStart(String(project.trim_start));
    setEnd(String(project.trim_end));
    setCurrentTime(0);
    setPreviewing(false);
    setError("");
    setPage("editor");
  }
  function upload(file?: File) {
    if (!file || busy) return;
    setError("");
    if (!file.name.toLowerCase().endsWith(".mp4")) {
      setError("Choose an MP4 video to continue.");
      return;
    }
    if (file.size > 1024 ** 3) {
      setError("Your file exceeds the 1 GB upload limit.");
      return;
    }
    if (file.size === 0) {
      setError("This file is empty. Choose another video.");
      return;
    }
    setBusy(true);
    setUploadProgress(0);
    setUploadName(file.name);
    setPage("upload");
    const xhr = new XMLHttpRequest();
    uploadRequest.current = xhr;
    xhr.open("POST", `/api/projects?filename=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        setUploadProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      uploadRequest.current = null;
      setBusy(false);
      let body: { detail?: string } & Partial<Project> = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* Non-JSON proxy failure. */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.id) {
        const project = body as Project;
        setProjects((items) => [
          project,
          ...items.filter((item) => item.id !== project.id),
        ]);
        open(project);
      } else
        setError(
          typeof body.detail === "string"
            ? body.detail
            : "Upload failed. Check your connection and try again.",
        );
    };
    xhr.onerror = () => {
      uploadRequest.current = null;
      setBusy(false);
      setError("Upload interrupted. Check your connection and try again.");
    };
    xhr.onabort = () => {
      uploadRequest.current = null;
      setBusy(false);
      setUploadProgress(0);
      setError("Upload cancelled. Choose a video to try again.");
    };
    xhr.send(file);
  }
  async function exportVideo() {
    if (!selected || !validTrim || activeExport || exportSubmitting) return;
    setExportSubmitting(true);
    setError("");
    try {
      const item = await api<Export>(`/api/projects/${selected.id}/exports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: startValue, end: endValue }),
      });
      setExports((items) => [item, ...items]);
      setProjects((items) =>
        items.map((project) =>
          project.id === selected.id
            ? { ...project, trim_start: startValue, trim_end: endValue }
            : project,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExportSubmitting(false);
    }
  }
  async function deleteProject(id: string) {
    try {
      await api(`/api/projects/${id}`, { method: "DELETE" });
      setDeleteId(null);
      if (selectedId === id) {
        setSelectedId(null);
        setPage("dashboard");
      }
      await loadProjects();
    } catch (e) {
      setDeleteId(null);
      setError((e as Error).message);
    }
  }
  function previewSelection() {
    if (!player.current || !validTrim) return;
    player.current.currentTime = startValue;
    setPreviewing(true);
    void player.current.play().catch(() => {
      setPreviewing(false);
      setError("The browser could not play this video. Try another MP4 file.");
    });
  }
  const totalSeconds = projects.reduce(
    (sum, project) => sum + project.duration,
    0,
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          href="#"
          className="brand"
          onClick={(event) => {
            event.preventDefault();
            navigate("dashboard");
          }}
          aria-label="ClipForge dashboard"
        >
          <span className="brand-mark">
            <Scissors size={22} />
          </span>
          <span>
            clipforge<span className="brand-ai">AI</span>
          </span>
        </a>
        <div className="workspace">
          <span className="avatar">E</span>
          <div>
            My workspace<small>Personal studio</small>
          </div>
          <ChevronRight size={14} />
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          <button
            className={page === "dashboard" ? "nav-item active" : "nav-item"}
            onClick={() => navigate("dashboard")}
          >
            <LayoutDashboard size={18} /> Dashboard
          </button>
          <button
            className={page === "upload" ? "nav-item active" : "nav-item"}
            onClick={() => navigate("upload")}
          >
            <CloudUpload size={18} /> Upload video{" "}
            <Plus size={14} className="nav-plus" />
          </button>
          {selected && (
            <button
              className={page === "editor" ? "nav-item active" : "nav-item"}
              onClick={() => navigate("editor")}
            >
              <Scissors size={18} /> Video editor
            </button>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="phase-card">
            <span className="phase-symbol">
              <Sparkles size={18} />
            </span>
            <strong>Your studio starts here.</strong>
            <p>
              Upload. Find your moment.
              <br />
              Make the cut.
            </p>
            <span className="phase-badge">
              <span /> Phase 1 · Manual editing
            </span>
          </div>
          <div className="local-info">
            <span className="status-dot" /> Private development workspace
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <span>
              {page === "dashboard"
                ? "Dashboard"
                : page === "upload"
                  ? "Upload video"
                  : "Video editor"}
            </span>
          </div>
          <div className="topbar-right">
            <span className="version">EARLY ACCESS</span>
            <span className="avatar">E</span>
          </div>
        </header>
        <div className="content">
          {error && (
            <div className="error-banner" role="alert">
              <CircleAlert size={19} />
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={17} />
              </button>
            </div>
          )}
          {page === "dashboard" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">YOUR CREATIVE WORKSPACE</span>
                  <h1>
                    Let's make the cut<span className="accent">.</span>
                  </h1>
                  <p>One video. Your next great moment.</p>
                </div>
                <button className="primary" onClick={() => navigate("upload")}>
                  <Plus size={18} /> New project
                </button>
              </div>
              <section className="hero">
                <div className="hero-copy">
                  <span className="pill">
                    <Sparkles size={13} /> LESS FRICTION. MORE CREATING.
                  </span>
                  <h2>
                    Long video.
                    <br />
                    <span>New possibilities.</span>
                  </h2>
                  <p>
                    Bring your footage. Preview, trim, and export
                    <br className="desktop-break" /> your next clip in one
                    simple workspace.
                  </p>
                  <button
                    className="primary"
                    onClick={() => navigate("upload")}
                  >
                    Upload your first cut <ArrowRight size={17} />
                  </button>
                  <small>MP4 uploads · Up to 1 GB · No paid API</small>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="art-glow" />
                  <div className="frame frame-back" />
                  <div className="frame frame-front">
                    <div className="art-top">
                      <span />
                      <span />
                      <span />
                      <i>YOUR NEXT MOMENT</i>
                    </div>
                    <div className="art-screen">
                      <Scissors size={42} />
                      <span>Make every second count.</span>
                    </div>
                    <div className="art-timeline">
                      {Array.from({ length: 31 }, (_, i) => (
                        <i
                          key={i}
                          style={{ height: `${12 + ((i * 17) % 30)}px` }}
                        />
                      ))}
                    </div>
                    <span className="art-playhead" />
                  </div>
                  <span className="floating-label">
                    <Check size={14} /> Ready for your next cut
                  </span>
                </div>
              </section>
              <div className="stats">
                <Stat
                  icon={<FolderOpen size={19} />}
                  value={String(projects.length)}
                  label="Total projects"
                  detail="Your video library"
                />
                <Stat
                  icon={<Clock3 size={19} />}
                  value={time(totalSeconds)}
                  label="Footage uploaded"
                  detail="Minutes : seconds"
                />
                <Stat
                  icon={<Scissors size={19} />}
                  value="MP4"
                  label="Export format"
                  detail="H.264 video + AAC audio"
                />
              </div>
              <section className="projects-section">
                <div className="section-heading">
                  <h2>
                    Recent projects{" "}
                    <span className="count">{projects.length}</span>
                  </h2>
                  <button
                    className="text-button"
                    onClick={() => navigate("upload")}
                  >
                    Add a video <Plus size={16} />
                  </button>
                </div>
                {loading ? (
                  <div className="empty-state">
                    <LoaderCircle className="spin" /> Loading your workspace…
                  </div>
                ) : projects.length === 0 ? (
                  <div className="empty-state">
                    <span className="empty-icon">
                      <Film size={27} />
                    </span>
                    <h3>Your next project starts here</h3>
                    <p>Upload a video to bring your workspace to life.</p>
                    <button
                      className="secondary"
                      onClick={() => navigate("upload")}
                    >
                      <Plus size={16} /> Create a project
                    </button>
                  </div>
                ) : (
                  <div className="project-grid">
                    {projects.map((project) => (
                      <article className="project-card" key={project.id}>
                        <button
                          className="project-open"
                          onClick={() => open(project)}
                        >
                          <div className="project-image">
                            {project.status === "ready" ? (
                              <img
                                src={`/api/projects/${project.id}/poster`}
                                alt=""
                              />
                            ) : (
                              <Film size={32} />
                            )}
                            <span className="duration">
                              {time(project.duration)}
                            </span>
                            <span className={`project-state ${project.status}`}>
                              {project.status === "processing"
                                ? "Preparing"
                                : project.status === "failed"
                                  ? "Needs attention"
                                  : "Ready to edit"}
                            </span>
                          </div>
                          <div className="project-details">
                            <h3>{project.name}</h3>
                            <p>
                              {size(project.bytes)}
                              <span>·</span>
                              {new Date(
                                project.created * 1000,
                              ).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                              })}
                              <ArrowRight size={16} />
                            </p>
                          </div>
                        </button>
                        <button
                          className="delete-project"
                          aria-label={`Delete ${project.name}`}
                          onClick={() => setDeleteId(project.id)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
          {page === "upload" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">A NEW BEGINNING</span>
                  <h1>
                    Bring your video<span className="accent">.</span>
                  </h1>
                  <p>Your next clip starts with a single upload.</p>
                </div>
              </div>
              <div className="upload-layout">
                <section
                  className={`dropzone ${dragging ? "dragging" : ""} ${busy ? "uploading" : ""}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (!busy) setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    upload(event.dataTransfer.files[0]);
                  }}
                >
                  <div className="upload-orbit">
                    <CloudUpload size={38} />
                  </div>
                  <span className="pill">YOUR FOOTAGE, YOUR STORY</span>
                  <h2>
                    {busy
                      ? uploadProgress >= 100
                        ? "Checking your video…"
                        : "Your video is on the way"
                      : "Drop your video here"}
                  </h2>
                  <p>
                    {busy
                      ? uploadName
                      : "Drag and drop an MP4, or choose a file from your computer."}
                  </p>
                  {busy ? (
                    <div className="upload-status" role="status">
                      <div className="progress-label">
                        <span>
                          {uploadProgress >= 100
                            ? "Upload complete. Validating media…"
                            : "Uploading video"}
                        </span>
                        <b>{uploadProgress}%</b>
                      </div>
                      <progress
                        value={uploadProgress}
                        max="100"
                        aria-label="Upload progress"
                      />
                      <button
                        className="text-button"
                        onClick={() => uploadRequest.current?.abort()}
                      >
                        Cancel upload
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        className="primary"
                        onClick={() => input.current?.click()}
                      >
                        <Plus size={18} /> Choose video
                      </button>
                      <small>
                        MP4 · Maximum 1 GB · Up to 30 minutes · Up to 4096 px
                      </small>
                    </>
                  )}
                </section>
                <aside className="upload-guide">
                  <span className="eyebrow">FROM FOOTAGE TO FINISHED</span>
                  <h2>
                    Three steps.
                    <br />
                    One fresh cut.
                  </h2>
                  {[
                    [
                      "01",
                      "Upload your video",
                      "Start with an interview, tutorial, or any moment worth sharing.",
                    ],
                    [
                      "02",
                      "Choose your moment",
                      "Preview your footage and set the start and end times.",
                    ],
                    [
                      "03",
                      "Export and share",
                      "Download your trimmed MP4, ready for your next post.",
                    ],
                  ].map(([number, title, description]) => (
                    <div className="guide-step" key={number}>
                      <span>{number}</span>
                      <div>
                        <h3>{title}</h3>
                        <p>{description}</p>
                      </div>
                    </div>
                  ))}
                  <div className="guide-note">
                    <Video size={18} />
                    <p>
                      Your original video stays unchanged. Every export is a new
                      file.
                    </p>
                  </div>
                </aside>
              </div>
            </>
          )}
          {page === "editor" && selected && (
            <>
              <button
                className="back-link"
                onClick={() => navigate("dashboard")}
              >
                <ArrowLeft size={15} /> All projects
              </button>
              <div className="page-heading editor-heading">
                <div>
                  <span className="eyebrow">THE EDITING ROOM</span>
                  <h1 title={selected.name}>{selected.name}</h1>
                  <p>
                    {selected.width} × {selected.height}
                    <span className="separator">/</span>
                    {time(selected.duration)}
                    <span className="separator">/</span>
                    {size(selected.bytes)}
                  </p>
                </div>
                <span className="pill">
                  <Scissors size={13} /> MANUAL EDITOR
                </span>
              </div>
              {selected.status !== "ready" ? (
                <div className="empty-state">
                  <span className="empty-icon">
                    {selected.status === "failed" ? (
                      <CircleAlert />
                    ) : (
                      <LoaderCircle className="spin" />
                    )}
                  </span>
                  <h3>
                    {selected.status === "failed"
                      ? "This video needs attention"
                      : "Preparing your preview"}
                  </h3>
                  <p>
                    {selected.error ||
                      "Checking your video and creating a browser-friendly preview. Larger videos take longer."}
                  </p>
                  {selected.status === "failed" && (
                    <button
                      className="primary"
                      onClick={() => navigate("upload")}
                    >
                      Upload another video
                    </button>
                  )}
                </div>
              ) : (
                <div className="editor-layout">
                  <section className="preview-panel">
                    <div className="panel-title">
                      <span>
                        <Video size={16} /> Video preview
                      </span>
                      <span className="muted">Original framing</span>
                    </div>
                    <div className="video-stage">
                      <video
                        key={selected.id}
                        ref={player}
                        controls
                        playsInline
                        preload="metadata"
                        poster={`/api/projects/${selected.id}/poster`}
                        src={`/api/projects/${selected.id}/video`}
                        onError={() =>
                          setError(
                            "Video playback failed. Try reloading, or choose another MP4.",
                          )
                        }
                        onTimeUpdate={() => {
                          const video = player.current;
                          if (!video) return;
                          setCurrentTime(video.currentTime);
                          if (previewing && video.currentTime >= endValue) {
                            video.pause();
                            setPreviewing(false);
                          }
                        }}
                        onEnded={() => setPreviewing(false)}
                      />
                    </div>
                    <div className="preview-footer">
                      <span className="status-dot" />{" "}
                      {previewing
                        ? "Playing selection"
                        : "Preview your source video"}
                      <span>
                        {time(currentTime)}{" "}
                        <span className="muted">
                          / {time(selected.duration)}
                        </span>
                      </span>
                    </div>
                    <div className="selection-timeline" aria-hidden="true">
                      <div className="timeline-track">
                        {Array.from({ length: 70 }, (_, i) => (
                          <i
                            key={i}
                            style={{ height: `${10 + ((i * 29) % 30)}px` }}
                          />
                        ))}
                      </div>
                      <div
                        className="timeline-selection"
                        style={{
                          left: `${Math.min(100, Math.max(0, (startValue / selected.duration) * 100)) || 0}%`,
                          width: `${validTrim ? ((endValue - startValue) / selected.duration) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <div className="timeline-labels">
                      <span>00:00</span>
                      <span>{time(selected.duration / 2)}</span>
                      <span>{time(selected.duration)}</span>
                    </div>
                    <div className="source-note">
                      <Check size={15} /> Your source stays untouched. Trim
                      times apply to the exported copy.
                    </div>
                  </section>
                  <aside className="trim-panel">
                    <div className="panel-title">
                      <span>
                        <Scissors size={16} /> Make your cut
                      </span>
                    </div>
                    <div className="trim-body">
                      <p className="muted">
                        Set your clip boundaries in seconds.
                      </p>
                      <label htmlFor="start">
                        Start time <span>seconds</span>
                      </label>
                      <div className="time-input">
                        <Clock3 size={16} />
                        <input
                          id="start"
                          type="number"
                          min="0"
                          max={selected.duration}
                          step="0.1"
                          value={start}
                          onChange={(event) => {
                            setStart(event.target.value);
                            setPreviewing(false);
                          }}
                        />
                        <button
                          title="Use current video position as start"
                          onClick={() =>
                            setStart(
                              String(Math.floor(currentTime * 1000) / 1000),
                            )
                          }
                        >
                          Use playhead
                        </button>
                      </div>
                      <label htmlFor="end">
                        End time <span>seconds</span>
                      </label>
                      <div className="time-input">
                        <Clock3 size={16} />
                        <input
                          id="end"
                          type="number"
                          min="0"
                          max={selected.duration}
                          step="0.1"
                          value={end}
                          onChange={(event) => {
                            setEnd(event.target.value);
                            setPreviewing(false);
                          }}
                        />
                        <button
                          title="Use current video position as end"
                          onClick={() =>
                            setEnd(
                              String(Math.floor(currentTime * 1000) / 1000),
                            )
                          }
                        >
                          Use playhead
                        </button>
                      </div>
                      {!validTrim && (
                        <p className="field-error" role="alert">
                          Choose an end after the start, within{" "}
                          {selected.duration.toFixed(2)} seconds.
                        </p>
                      )}
                      <div className="clip-summary">
                        <span>Clip duration</span>
                        <strong>
                          {validTrim
                            ? `${(endValue - startValue).toFixed(2)}s`
                            : "—"}
                        </strong>
                      </div>
                      <button
                        className="secondary full"
                        disabled={!validTrim}
                        onClick={previewSelection}
                      >
                        <Video size={16} /> Preview selection
                      </button>
                      <div className="export-format">
                        <span>EXPORT FORMAT</span>
                        <div>
                          <span className="format-icon">
                            <Film size={17} />
                          </span>
                          <div>
                            <strong>MP4 video</strong>
                            <small>H.264 · Original resolution</small>
                          </div>
                          <Check size={16} />
                        </div>
                      </div>
                      <button
                        className="primary full"
                        disabled={
                          !validTrim || !!activeExport || exportSubmitting
                        }
                        onClick={() => void exportVideo()}
                      >
                        {activeExport || exportSubmitting ? (
                          <LoaderCircle className="spin" size={17} />
                        ) : (
                          <ArrowDownToLine size={17} />
                        )}{" "}
                        {activeExport
                          ? "Export in progress"
                          : exportSubmitting
                            ? "Starting export…"
                            : "Export clip"}
                      </button>
                      <p className="export-help">
                        Rendered on your workspace server.
                      </p>
                    </div>
                  </aside>
                  <section className="export-panel">
                    <div className="panel-title">
                      <span>
                        <ArrowDownToLine size={16} /> Your exports
                      </span>
                      <span className="muted">
                        {exports.length}{" "}
                        {exports.length === 1 ? "clip" : "clips"}
                      </span>
                    </div>
                    {exports.length === 0 ? (
                      <p className="exports-empty">
                        Your finished clips will appear here. Choose your moment
                        and export.
                      </p>
                    ) : (
                      exports.map((item) => (
                        <div className="export-row" key={item.id}>
                          <span className={`export-icon ${item.status}`}>
                            {item.status === "complete" ? (
                              <Check size={18} />
                            ) : item.status === "failed" ? (
                              <CircleAlert size={18} />
                            ) : (
                              <LoaderCircle size={18} className="spin" />
                            )}
                          </span>
                          <div className="export-description">
                            <strong>
                              {time(item.start)} – {time(item.end)}{" "}
                              <span className="muted">
                                · {(item.end - item.start).toFixed(2)}s
                              </span>
                            </strong>
                            {["queued", "rendering"].includes(item.status) ? (
                              <>
                                <small role="status">
                                  {item.status === "queued"
                                    ? "Queued. Waiting for the renderer…"
                                    : `Rendering your clip · ${Math.round(item.progress)}%`}
                                </small>
                                <progress
                                  value={item.progress}
                                  max="100"
                                  aria-label="Export progress"
                                />
                              </>
                            ) : (
                              <small
                                className={
                                  item.status === "failed" ? "field-error" : ""
                                }
                              >
                                {item.error || "MP4 · Ready to download"}
                              </small>
                            )}
                          </div>
                          {item.status === "complete" && (
                            <a
                              className="secondary small"
                              href={`/api/projects/${selected.id}/exports/${item.id}/download`}
                              download
                            >
                              <ArrowDownToLine size={16} /> Download
                            </a>
                          )}
                        </div>
                      ))
                    )}
                  </section>
                </div>
              )}
            </>
          )}
          <footer>
            <span>CLIPFORGE AI</span>
            <p>A little less editing. A little more creating.</p>
            <span>PHASE 01</span>
          </footer>
        </div>
      </main>
      <input
        ref={input}
        type="file"
        accept=".mp4,video/mp4"
        aria-label="Choose MP4 video"
        className="visually-hidden"
        onChange={(event) => {
          upload(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {deleteId && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            className="modal"
          >
            <h2 id="delete-title">Delete this project?</h2>
            <p>
              The uploaded video and every exported clip will be removed from
              your workspace.
            </p>
            <div>
              <button
                className="secondary"
                autoFocus
                onClick={() => setDeleteId(null)}
              >
                Keep project
              </button>
              <button
                className="danger"
                onClick={() => void deleteProject(deleteId)}
              >
                Delete project
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function Stat({
  icon,
  value,
  label,
  detail,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  detail: string;
}) {
  return (
    <div className="stat-card">
      <span className="stat-icon">{icon}</span>
      <div>
        <span className="stat-label">{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
