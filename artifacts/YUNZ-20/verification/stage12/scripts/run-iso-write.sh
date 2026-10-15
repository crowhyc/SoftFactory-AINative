#!/bin/bash
set -u
ST=/opt/SoftFactory-AINative/artifacts/YUNZ-20/verification/stage12
TOOLS=/opt/SoftFactory-AINative/.multica-workspaces/yunzhidian-f03e0d551ffa/yunz-30-93111e17d54f/workdir/tools
IMG=mcr.microsoft.com/playwright:v1.55.0-jammy
docker run --rm --network host \
  -v "$ST":/work -v "$TOOLS":/tools -w /work \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright -e NODE_PATH=/tools/node_modules \
  -e QV_BASE=http://127.0.0.1:4183 -e QV_OUT=/work \
  "$IMG" node /work/scripts/qv-iso-write.cjs
echo "[stage12-iso-write] 容器退出码 $?"
