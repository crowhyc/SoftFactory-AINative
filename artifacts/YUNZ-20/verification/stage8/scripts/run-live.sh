#!/usr/bin/env bash
# YUNZ-28 / Stage8：真实浏览器复验运行器（打运行现场 127.0.0.1:4180，宿主数据只读挂载）。
set -uo pipefail
D="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DATA="${APP_DATA:-/opt/wbs-rongcheng/data}"
TOOLS="${TOOLS:-/opt/wbs-rongcheng/tests/.tools}"
IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.55.0-jammy}"
BASE="${BASE:-http://127.0.0.1:4180}"
ADD_NAME="${ADD_NAME:-验证甲}"

mkdir -p "$D/downloads" "$D/logs" "$D/results" "$D/shots" "$D/results/pre-state"
cp -p "$APP_DATA/wbs.json" "$D/results/pre-state/wbs.json"
cp -p "$APP_DATA/audit.log" "$D/results/pre-state/audit.log"
sha256sum "$D/results/pre-state/wbs.json" "$D/results/pre-state/audit.log" > "$D/logs/02-pre-state-sha256.txt"
date '+%F %T %z' >> "$D/logs/02-pre-state-sha256.txt"
cat "$D/logs/02-pre-state-sha256.txt"

docker run --rm --ipc=host --network host \
  -e TOOLS=/tools -e BASE="$BASE" -e DATA_DIR=/data -e OUTDIR=/out -e ADD_NAME="$ADD_NAME" \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "$D":/out -v "$TOOLS":/tools -v "$APP_DATA":/data:ro \
  "$IMAGE" node /out/scripts/qv-browser-live.cjs 2>&1 | tee "$D/logs/02-live-browser-console.log"
rc=${PIPESTATUS[0]}
echo "[stage8] 浏览器容器退出码 $rc"
exit "$rc"
