# ClipForge AI

A browser video workspace with a dark purple and blue interface.
Phase 1 supports MP4 upload, preview, manual trimming, export and download.

## Test through your browser

Nothing needs installing on your school computer. The tools below run inside a GitHub Codespace.

1. Open [the Phase 1 branch](https://github.com/Emanuel558/Clipforge.ai-/tree/feat/phase-1-video-editor).
2. Click **Code**, then **Codespaces**, then create a Codespace for this branch. Choose the smallest machine.
3. Wait for setup to finish. Setup installs Python packages, frontend packages and FFmpeg inside the Codespace.
4. In the browser terminal, run:

   ```bash
   npm run dev
   ```

5. Open the **Ports** tab. Find port **5173**, then choose **Open in Browser**. Keep port visibility **Private**. Port 8000 stays internal.
6. Click **New project** and upload a short MP4 from your computer.
7. Wait for preparation. In the editor, play the video. Enter start `1` and end `3` for a video longer than three seconds. Click **Preview selection**.
8. Click **Export clip**. Wait for the progress bar, then click **Download**. Play the downloaded two-second MP4 and check the picture and sound.
9. Return to the dashboard. Reload the page and reopen the project. Export history and the last submitted trim remain saved.
10. Stop the Codespace from GitHub after testing. Stop the terminal with Ctrl+C first.

Codespaces includes a limited allowance for personal accounts. Use only your included allowance. Do not enable paid usage. If your allowance is exhausted, wait for renewal or use an existing Linux computer. This project has no paid API, subscription or cloud-service requirement. Codespaces availability also depends on your GitHub account and school network.

GitHub explains [included usage and exhausted allowances](https://docs.github.com/en/codespaces/troubleshooting/troubleshooting-included-usage).

### Need a sample video?

Run this in the Codespace terminal:

```bash
bash scripts/make-sample.sh
```

In the left file explorer, expand `data`. Right-click `demo.mp4` and select **Download**. Upload this file through ClipForge. The sample has a changing test picture and a test tone.

### If something fails

- **Setup failed:** run `bash scripts/setup.sh` in the Codespace terminal. If FFmpeg is missing, run `sudo apt-get update && sudo apt-get install -y ffmpeg`, then run setup again.
- **The app is not opening:** confirm `npm run dev` is running. Open port 5173 through the Ports tab, rather than typing localhost into your school browser.
- **Upload failed:** use an MP4 under 1 GB and 30 minutes, with dimensions up to 4096 pixels. Start with a small sample.
- **Preview is preparing:** leave the project open. Incompatible MP4 codecs need a browser-friendly copy, which takes additional processing time.
- **Export failed:** read the displayed message and try a shorter selection. Server details appear in the terminal. Keep the Codespace running until the export finishes.
- **Server restarted:** interrupted jobs show an error. Submit the export again, or reupload an interrupted preparation.
- **Need disk space:** delete finished projects from the dashboard. Confirm deletion in the dialog. Downloaded copies on your computer stay available.

## Included in Phase 1

- Dashboard with real project information and thumbnails.
- Upload page with drag-and-drop, file selection, progress and cancellation.
- MP4 inspection and browser preview, including byte-range seeking.
- Start and end controls in seconds, plus playhead shortcuts.
- Selection playback and a visual selection strip.
- Server-side H.264/AAC MP4 export, job progress, errors and download history.
- SQLite project records and saved trim settings after submitting an export.
- Project deletion, including source files and exports.
- Responsive layout, bundled fonts and keyboard-accessible controls.

Subtitles, AI highlights, speaker tracking and the AI assistant belong to later phases.

## Technology and layout

```text
frontend/src/             React, TypeScript, interface and CSS
backend/app.py            FastAPI routes, SQLite records and media jobs
backend/tests/            Real FFmpeg integration tests
scripts/                  Setup, development and sample-video commands
.devcontainer/            Browser development environment
.github/workflows/        Automated pull-request checks
docs/                     Decisions and test checklist
data/                     Local video files and database, excluded from Git
```

React + TypeScript + Vite build the interface. Python + FastAPI manage projects. FFmpeg handles media processing. SQLite saves project records. A single background executor processes media outside HTTP request threads. RQ/Valkey and external storage are deferred until concurrency needs justify extra services.

The frontend calls `/api` on the same origin. During development, Vite forwards API requests to FastAPI on internal port 8000. No separate browser backend address or CORS setup is needed.

The source remains unchanged. Exports are newly encoded files. For YUV420 encoding, odd pixel dimensions round down to an even value. Audio is included when the source has audio. A silent source produces a silent clip.

## Run on an existing Linux computer

Requires Python 3.12, Node.js 22 or newer, FFmpeg with libx264/AAC support, and ffprobe.

```bash
bash scripts/setup.sh
npm run dev
```

Open `http://localhost:5173`. Run one app instance and one API worker. The Phase 1 executor is for a private, single-user workspace.

For a built frontend served by FastAPI:

```bash
npm run build
.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

Open `http://localhost:8000`. Restart FastAPI after rebuilding frontend assets.

## Automated checks

```bash
.venv/bin/python -m pytest backend/tests -q
npm run build
```

Tests create temporary sample footage, upload through the API, export an actual trimmed MP4, inspect codecs and duration, compare audio/video timing, verify trim boundaries using a scene change, and test seeking, invalid files, invalid times, failed-job retry, deletion and restart recovery.

The pull-request workflow runs these checks on GitHub. See [the manual browser checklist](docs/TESTING.md) for interface checks.

## Data and development limits

Files and metadata live under `data/` on the processing machine. Set `CLIPFORGE_DATA` to change this location before starting the server. Uploads remain until the project is deleted. Interrupted uploads are removed when the request exits. After a machine crash, inspect the data directory for orphaned upload folders.

A Codespace is a development machine, separate from permanent hosting. Deleting the Codespace removes its uncommitted data. Download useful exports before deleting the environment. No automatic backup or retention service runs.

Jobs run one at a time. Up to three preparing projects and four pending exports are accepted, with one pending export per project. Preparation and export jobs have time limits. Stopping the workspace interrupts work. Startup marks interrupted jobs as failed so users receive a clear retry path.

Keep forwarded ports private. This version has no user accounts or project isolation between visitors. GitHub's private Codespace access protects the development entry point. Public hosting requires the later access-control phase.

## License

Project source uses the MIT license. Dependencies, bundled fonts and the installed FFmpeg build retain their own licenses. FFmpeg build options and codecs affect redistribution terms. See [FFmpeg licensing](https://ffmpeg.org/legal.html).
