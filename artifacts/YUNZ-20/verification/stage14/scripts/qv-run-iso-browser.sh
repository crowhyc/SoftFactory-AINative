#!/usr/bin/env bash
# YUNZ-34：隔离实例真实浏览器写入矩阵（不触碰现场 4180）。
set -uo pipefail
S14="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.55.0-jammy}"
TOOLS="${TOOLS_DIR:-/opt/wbs-rongcheng/tests/.tools}"
# 每次复跑前把隔离数据复位到「迁移前」基线，保证结果可复现。
PYTHONIOENCODING=utf-8 python3 "$S14/scripts/qv-make-iso-data.py"
docker run --rm --ipc=host \
  -e APP_DIR=/app -e TOOLS=/tools -e ISO=/qv/iso \
  -e OUTDIR=/qv/results -e DLDIR=/qv/downloads \
  -e PORT_A=4260 -e PORT_B=4261 \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v /opt/wbs-rongcheng:/app:ro \
  -v "$TOOLS":/tools:ro \
  -v "$S14":/qv \
  -w /app \
  "$IMAGE" node /qv/scripts/qv-iso-browser.cjs
