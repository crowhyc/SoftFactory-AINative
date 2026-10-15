#!/bin/bash
# Stage10：真实浏览器只读矩阵（Chromium 容器，--network host 访问现场 4180）
set -u
ST=/opt/SoftFactory-AINative/artifacts/YUNZ-20/verification/stage10
TOOLS=/opt/SoftFactory-AINative/.multica-workspaces/yunzhidian-f03e0d551ffa/yunz-30-93111e17d54f/workdir/tools
IMG=mcr.microsoft.com/playwright:v1.55.0-jammy
echo "[stage10-live] $(date '+%F %T%z') 现场 http://127.0.0.1:4180（只读）"
docker run --rm --network host \
  -v "$ST":/work -v "$TOOLS":/tools -w /work \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright -e NODE_PATH=/tools/node_modules \
  -e QV_BASE=http://127.0.0.1:4180 -e QV_OUT=/work \
  "$IMG" node /work/scripts/qv-ch8-live.cjs
echo "[stage10-live] 容器退出码 $?"
