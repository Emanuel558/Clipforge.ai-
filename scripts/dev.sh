#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -x .venv/bin/python || ! -d frontend/node_modules ]]; then
  echo 'Run bash scripts/setup.sh first.'
  exit 1
fi
.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 &
api_pid=$!
cleanup() { kill "$api_pid" "${web_pid:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
npm --prefix frontend run dev &
web_pid=$!
wait -n "$api_pid" "$web_pid"
