#!/bin/bash
# Stage10：CH-8 写路径矩阵（真实浏览器打隔离实例 4181；现场 4180 只读）
set -u
ST=/opt/SoftFactory-AINative/artifacts/YUNZ-20/verification/stage10
TOOLS=/opt/SoftFactory-AINative/.multica-workspaces/yunzhidian-f03e0d551ffa/yunz-30-93111e17d54f/workdir/tools
ISO=/opt/SoftFactory-AINative/.multica-workspaces/yunzhidian-f03e0d551ffa/yunz-30-93111e17d54f/workdir/scratch/stage10-iso
IMG=mcr.microsoft.com/playwright:v1.55.0-jammy
echo "[stage10-write] $(date '+%F %T%z') 隔离实例 http://127.0.0.1:4181"
docker run --rm --network host \
  -v "$ST":/work -v "$TOOLS":/tools -v "$ISO/data":/iso-data -w /work \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright -e NODE_PATH=/tools/node_modules \
  -e QV_BASE=http://127.0.0.1:4181 -e QV_OUT=/work -e QV_ISO_DATA=/iso-data \
  "$IMG" node /work/scripts/qv-ch8-write.cjs
echo "[stage10-write] 容器退出码 $?"
