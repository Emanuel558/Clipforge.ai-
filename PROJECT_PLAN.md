ClipForge AI Project Plan
Date: 6 November 2026
Repository: Emanuel558/Clipforge.ai-
Status: Approved on 6 November 2026. Phase 0 and Phase 1 in development. Phase 2 is excluded from this implementation.

Repository inspection
The repository was cloned and inspected on 6 November 2026.
The default branch is main. No commits or tracked files existed.
No README, application code, dependency files, tests, license or PROJECT_PLAN.md existed.
This document is the first project file.

Vision
Build a browser-based AI video editor for creators.
Users upload long videos, receive suggested highlights, review edits and export short clips for TikTok, YouTube Shorts and Instagram Reels.
The longer-term product includes full-length editing, automatic subtitles, speaker tracking, multiple aspect ratios and an AI editing assistant.
AI suggestions always remain editable. Highlight scores express editorial ranking, without promises about views or viral success.

Starting audience and assumptions
Start with spoken videos such as interviews, podcasts, tutorials and commentary.
Proposed initial test languages: English and Swedish.
Start with direct MP4 uploads and one video per project.
Proposed prototype limits: 30 minutes and 1 GB per upload, subject to hardware measurement.
The interface runs in a browser, including on a school computer. Heavy processing runs on a separate server or development machine.
No school-computer installation is required for end users.
Hosting budget, available hardware and expected simultaneous users are undecided.

First usable release
Upload a video with progress and clear errors.
Display queued, analyzing, rendering, complete and failed states.
Extract audio and generate a timestamped transcript.
Suggest three to five distinct highlights, usually 15 to 60 seconds each.
Explain each suggestion with a short reason.
Let users preview suggestions and adjust start and end times.
Generate editable subtitles with readable styles and safe margins.
Offer a vertical 9:16 layout with manual crop positioning and fit-with-background fallback.
Export MP4 with H.264 video and AAC audio, plus optional SRT or VTT subtitles.
Save projects, transcripts, selected edits and export status.
Provide deletion of source videos and generated files.

First-release exclusions
No automatic social posting, billing, collaboration, stock-media marketplace or broad URL downloading.
No full multi-track editor in the first release.
No automatic active-speaker switching until tracking quality passes testing.
No required paid AI API.

Complete feature roadmap
Short clips: transcript-based highlights, scene and silence signals, configurable lengths, topic selection, duplicate removal and batch exports.
Subtitles: text correction, timing adjustment, word highlighting, styles, subtitle files and later translation.
Framing: 9:16, 16:9 and 1:1, manual crop overrides, face tracking, smooth crop movement and split-screen layouts.
Speaker features: identify speaker turns in audio, track visible faces and later connect voice turns to visible speakers. Audio speaker labels alone do not identify the visible active speaker.
Full-length editing: split, trim, reorder, remove sections, join clips, text overlays, audio levels, optional silence removal and later music tracks.
AI assistant: requests such as “Find three moments about saving money” or “Remove pauses longer than two seconds.” Return a proposed edit list for preview, approval and undo.
Project management: autosave, reusable subtitle styles, export history and later user accounts.

Recommended technology
Frontend: React, TypeScript and Vite. React builds the interface, TypeScript catches common programming mistakes, Vite runs the frontend development tools.
Styling: CSS first. Add a component library only when needed.
Backend: Python with FastAPI. Receives uploads, saves project information and coordinates processing.
Rendering: FFmpeg and ffprobe. Inspect media, extract audio, cut videos, crop, scale, mix audio and render subtitles.
Transcription: faster-whisper. Produces timestamped speech text on CPU or supported GPU hardware. Benchmark model size against English and Swedish samples.
Highlight reasoning and assistant: an Apache-2.0 Qwen3 model served through llama.cpp. Choose model size after memory and quality measurements. Use timestamped transcript sections and validate every suggested time range.
Scene detection: PySceneDetect, added after the basic transcript workflow.
Visual tracking: OpenCV with a separately reviewed face detector and model license.
Speaker turns: evaluate pyannote.audio later. Check the selected pretrained model terms, download requirements and resource usage separately.
Jobs: RQ with Valkey after a small integration check. A worker performs long tasks outside web requests, with persisted job status and bounded retries.
Database: SQLite for a single-user prototype. Move to PostgreSQL before concurrent public use.
Files: local server storage for the prototype. Use private S3-compatible storage for online deployment.
Testing: pytest for processing and API behavior, Playwright for the upload-to-download browser workflow.
Development: GitHub repository and a browser-accessible development environment. Confirm available development minutes and resources before relying on any hosted free tier.
Packaging: containers later for repeatable server deployment. No orchestration platform at the start.

Why this stack
Python fits speech and video analysis tools.
FFmpeg provides one rendering engine for clips and full-length edits.
React keeps browser editing controls separate from long-running server work.
An open-weight language model avoids mandatory per-request AI fees, but still needs hardware.
Store edits as data rather than rewriting the source after every action. Preview and export should read the same edit data.

Processing flow
Browser upload to server.
Validate format, duration, size and decodability.
Store source privately and create a project.
Queue audio extraction and transcription.
Split transcript into manageable sections and rank candidate moments.
Validate timestamps, sentence boundaries, overlap and requested duration.
Show suggestions for human review.
Save trim ranges, subtitles and framing as project edit data.
Queue rendering, then provide an authorized download.
Delete temporary files and apply the documented retention policy.

Development phases
Phase 0. Approve scope and execution environment.
Confirm first-release features, sample videos, initial languages, hardware and budget.
Choose license and document setup decisions.
Completion: owner approval plus a workable processing environment.

Phase 1. Prove video handling.
Build upload, validation, project records, job status, preview, manual trimming and one downloadable export.
Completion: a real uploaded sample produces a playable MP4 with matching audio and video.

Phase 2. Add subtitles.
Build transcription, timestamp storage, subtitle correction, styling and export.
Completion: English and Swedish samples have reviewable text, synchronized captions and saved corrections.

Phase 3. Add automatic highlights.
Build candidate selection, ranking, explanations, overlap removal and adjustable clip boundaries.
Completion: three representative source videos produce useful, distinct suggestions reviewed by the owner.

Phase 4. Finish the first release.
Add vertical formatting, crop controls, batch rendering, retry handling, deletion and project reopening.
Completion: upload-to-download succeeds in a browser with clear progress and recoverable errors.

Phase 5. Add speaker tracking.
Evaluate face detection, tracking, speaker turns and active-speaker matching.
Completion: interviews and scenes with multiple people retain useful framing, with manual fallback after uncertain detection.

Phase 6. Add full-length editing.
Build a basic timeline with trim, split, reorder, captions, audio controls and undo.
Completion: users save, reopen and export a long edited video without changing the original.

Phase 7. Add the AI editing assistant.
Convert requests into validated edit proposals using the existing editing operations.
Completion: users preview, approve, apply and undo assistant edits. The model never executes arbitrary shell commands.

Phase 8. Prepare online beta.
Add authentication, project ownership checks, private downloads, upload limits, quotas, cleanup, monitoring and backups.
Move metadata to PostgreSQL and files to private object storage.
Completion: two accounts remain isolated and processing cost per source minute has been measured.

Quality and operations
Use owned or permissioned sample footage.
Measure transcription quality, subtitle timing, highlight usefulness, crop stability, audio synchronization, rendering time and peak memory.
Test invalid media, interrupted uploads, worker failure, duplicate retries and failed exports.
Treat uploaded text and transcripts as untrusted input.
Invoke media tools through fixed arguments rather than user-generated commands.
Set job timeouts and resource limits.
Keep videos, credentials and generated media out of GitHub.
Review dependency and model licenses before distribution, especially the selected FFmpeg build and codecs.
Public launch requires documented retention, deletion and access controls.

Cost and uncertainty
Free software does not supply free server processing, GPU time, storage or bandwidth.
A private prototype on existing hardware offers the lowest direct cost.
A browser development environment is separate from production hosting.
I don't know processing speed, monthly hosting cost or highlight quality before measuring representative videos.
Avoid delivery promises until the first complete workflow has been measured.

Current implementation scope
The owner approved Phase 0 and Phase 1 on 6 November 2026.
Build and verify one upload-to-export workflow before adding AI features.
See docs/PHASE_0.md for environment decisions, README.md for browser setup, and docs/TESTING.md for the manual test checklist.
Phase 2 requires a separate instruction after Phase 1 works.

Reference projects
React: https://github.com/facebook/react
Vite: https://github.com/vitejs/vite
FastAPI: https://github.com/fastapi/fastapi
FFmpeg licensing: https://ffmpeg.org/legal.html
faster-whisper: https://github.com/SYSTRAN/faster-whisper
Qwen3: https://github.com/QwenLM/Qwen3
llama.cpp: https://github.com/ggml-org/llama.cpp
PySceneDetect: https://github.com/Breakthrough/PySceneDetect
OpenCV: https://opencv.org/license/
pyannote.audio: https://github.com/pyannote/pyannote-audio
RQ: https://github.com/rq/rq
Valkey: https://valkey.io/
