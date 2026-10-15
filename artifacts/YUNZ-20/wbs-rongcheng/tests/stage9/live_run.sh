#!/usr/bin/env bash
# YUNZ-29 / 变更包 #3：CH-8 现场（真实容器 127.0.0.1:4180）只读实测运行器。
# 浏览器在 playwright 容器内、用 --network host 共享宿主网络访问现场服务；仅读、不发 PUT。
set -uo pipefail
APP_DIR="${APP_DIR:-/opt/wbs-rongcheng}"
TOOLS_DIR="${TOOLS_DIR:-$APP_DIR/tests/.tools}"
IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.55.0-jammy}"
OUT="${1:-$APP_DIR/tests/.tmp/stage9-live}"
BASE="${BASE:-http://127.0.0.1:4180}"
mkdir -p "$OUT"
echo "[live] 只读实测现场 $BASE（输出 $OUT）"
docker run --rm --ipc=host --network host \
  -e OUTDIR=/app/tests/.tmp/stage9-live -e TOOLS=/tools -e BASE="$BASE" \
  -e WBS_DATA_FILE=/app/data/wbs.json -e WBS_AUDIT_FILE=/app/data/audit.log \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "$APP_DIR":/app -v "$TOOLS_DIR":/tools -w /app \
  "$IMAGE" node /app/tests/stage9/live_check.cjs
RC=$?
echo "[live] 容器退出码 $RC；输出目录 $OUT"
exit "$RC"
