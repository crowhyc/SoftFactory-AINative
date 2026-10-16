#!/usr/bin/env bash
# YUNZ-40 / Stage20：运行现场（0.0.0.0:4180）真实浏览器只读取证运行器。
# 浏览器在 playwright 官方镜像内、network host 直连 127.0.0.1:4180；不做任何写操作。
set -uo pipefail
S20="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.55.0-jammy}"
TOOLS="${TOOLS_DIR:-/opt/wbs-rongcheng/tests/.tools}"
docker run --rm --ipc=host --network host \
  -e TOOLS=/tools -e OUTDIR=/qv/results -e SHOTDIR=/qv/shots -e LIVE_BASE=http://127.0.0.1:4180 \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "$TOOLS":/tools:ro -v "$S20":/qv \
  "$IMAGE" node /qv/scripts/qv20-live-browser.cjs
exit $?
