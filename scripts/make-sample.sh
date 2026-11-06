#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i 'testsrc2=size=640x360:rate=30:duration=8' \
  -f lavfi -i 'sine=frequency=440:sample_rate=48000:duration=8' \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart -threads 2 data/demo.mp4
echo 'Sample ready: data/demo.mp4. Download through the file explorer, then upload through ClipForge.'
