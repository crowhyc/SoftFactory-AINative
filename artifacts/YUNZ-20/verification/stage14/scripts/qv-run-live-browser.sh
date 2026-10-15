#!/usr/bin/env bash
# YUNZ-34：现场真实浏览器只读交互 + 真实下载（日报 / WBS）。
set -uo pipefail
S14="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.55.0-jammy}"
TOOLS="${TOOLS_DIR:-/opt/wbs-rongcheng/tests/.tools}"
docker run --rm --ipc=host --network host \
  -e APP_DIR=/app -e TOOLS=/tools \
  -e OUTDIR=/qv/results -e DLDIR=/qv/downloads \
  -e BASE=http://127.0.0.1:4180 \
  -e RESULT_FILE=/qv/results/live-browser-results.json \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v /opt/wbs-rongcheng:/app:ro \
  -v "$TOOLS":/tools:ro \
  -v "$S14":/qv \
  -w /app \
  "$IMAGE" node /qv/scripts/qv-live-browser.cjs
