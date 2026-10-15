#!/bin/bash
# Stage12：真实浏览器只读矩阵（playwright 官方镜像，host 网络打现场 4180）
set -u
ST=/opt/SoftFactory-AINative/artifacts/YUNZ-20/verification/stage12
TOOLS=/opt/SoftFactory-AINative/.multica-workspaces/yunzhidian-f03e0d551ffa/yunz-30-93111e17d54f/workdir/tools
IMG=mcr.microsoft.com/playwright:v1.55.0-jammy
docker run --rm --network host \
  -v "$ST":/work -v "$TOOLS":/tools -w /work \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright -e NODE_PATH=/tools/node_modules \
  -e QV_BASE=http://127.0.0.1:4180 -e QV_OUT=/work \
  "$IMG" node /work/scripts/qv-live-ui.cjs
echo "[stage12-live] 容器退出码 $?"
