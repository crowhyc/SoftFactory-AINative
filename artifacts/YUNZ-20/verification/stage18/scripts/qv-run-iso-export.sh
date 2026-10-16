#!/usr/bin/env bash
# YUNZ-38 / Stage18：隔离实例（isoA，已全五色）真实浏览器「导出 Excel」下载。
set -uo pipefail
S18="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.55.0-jammy}"
TOOLS="${TOOLS_DIR:-/opt/wbs-rongcheng/tests/.tools}"
A=qv38-expA; PA=4270
cleanup() { docker rm -f "$A" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
docker run -d --name "$A" -e WBS_DATA_DIR=/data -e WBS_PORT=$PA -e WBS_HOST=0.0.0.0 \
  -p 127.0.0.1:$PA:$PA -v "$S18/iso/isoA":/data -v /opt/wbs-rongcheng:/app:ro "$IMAGE" node /app/server.js >/dev/null || exit 1
for _ in $(seq 1 80); do curl -s -m 2 "http://127.0.0.1:$PA/api/health" | grep -q '"ok":true' && break; sleep 0.25; done
docker run --rm --ipc=host --network host \
  -e TOOLS=/tools -e BASE="http://127.0.0.1:$PA" -e DLDIR=/qv/downloads -e PREFIX=isoA \
  -e SNAPSHOT=/qv/downloads/isoA-wbs-at-export.json -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "$TOOLS":/tools:ro -v "$S18":/qv -w /qv \
  "$IMAGE" node /qv/scripts/qv-export-wbs.cjs
