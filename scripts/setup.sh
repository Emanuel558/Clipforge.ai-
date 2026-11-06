#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
  echo 'FFmpeg is missing. In Codespaces run: sudo apt-get update && sudo apt-get install -y ffmpeg'
  exit 1
fi
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
npm --prefix frontend ci
echo 'Setup complete. Start ClipForge with: npm run dev'
