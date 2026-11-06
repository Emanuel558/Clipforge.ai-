# Phase 0 decisions

Owner approval: 6 November 2026. Phase 0 and Phase 1 authorized.

Scope: dashboard, MP4 upload, preview, manual trimming, MP4 export/download, visible progress and errors. Phase 2 is excluded.

Interface: dark theme, purple and blue accents, desktop and narrow-screen layouts.

Execution environment: browser-accessible GitHub Codespace using the smallest machine and included allowance. No school-computer installation, paid API or paid hosting dependency. Available Codespaces quota has not been inspected in the owner's account. Confirm remaining included allowance before opening a new Codespace.

Server: Python 3.12, FFmpeg and ffprobe. Frontend: Node.js 22+, React, TypeScript and Vite. Local SQLite and file storage. No GPU required for manual trimming and exports. An existing Linux machine is another supported environment.

Source license: MIT. FFmpeg, codec and dependency licenses remain separate.

Prototype limits: MP4, 1 GB per upload, 30 minutes, maximum dimension 4096 pixels. Start tests with short 320×180 footage. Larger files and concurrent usage need resource measurements before raising limits.

Job execution: one background media executor, with SQLite job state. RQ/Valkey deferred during the single-user prototype. No Redis-compatible server is required to test Phase 1.

Access: one private workspace, accessed through private Codespace port 5173. No public deployment in this phase.

Storage: media and SQLite database stay in the Codespace data folder until project deletion or environment deletion. Export download is the user's copy. No permanent-storage promise.

Test material: generated footage with a test picture and tone. User footage is optional for manual review.
