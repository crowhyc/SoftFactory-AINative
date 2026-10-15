#!/usr/bin/env bash
# YUNZ-36 / Stage16：现场（0.0.0.0:4180）真实浏览器只读交互 + 真实下载（WBS 导出）。
# 只读现场：不发出任何写请求；浏览器仅在官方 playwright 容器内运行；写入只落本 stage16 目录。
set -uo pipefail
S16="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.55.0-jammy}"
TOOLS="${TOOLS_DIR:-/opt/wbs-rongcheng/tests/.tools}"
docker run --rm --ipc=host --network host \
  -e TOOLS=/tools -e OUTDIR=/qv/results -e DLDIR=/qv/downloads -e SHOTDIR=/qv/shots \
  -e BASE="http://127.0.0.1:${LIVE_PORT:-4180}" \
  -e RESULT_FILE=/qv/results/live-browser-results.json -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v /opt/wbs-rongcheng:/app:ro \
  -v "$TOOLS":/tools:ro \
  -v "$S16":/qv \
  -w /app \
  "$IMAGE" node /qv/scripts/qv-live-browser.cjs
