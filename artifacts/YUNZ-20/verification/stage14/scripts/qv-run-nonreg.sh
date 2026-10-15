#!/usr/bin/env bash
# YUNZ-34：不回归抽样（隔离实例 isoD + 真实浏览器容器）。
set -uo pipefail
S14="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.55.0-jammy}"
TOOLS="${TOOLS_DIR:-/opt/wbs-rongcheng/tests/.tools}"
PORT=4267
CN=qv34-nonreg
PYTHONIOENCODING=utf-8 python3 "$S14/scripts/qv-make-iso-data.py" >/dev/null
rm -rf "$S14/iso/isoD"; cp -r "$S14/iso/isoA" "$S14/iso/isoD"
docker rm -f "$CN" >/dev/null 2>&1
docker run -d --name "$CN" -e WBS_DATA_DIR=/data -e WBS_PORT=$PORT -e WBS_HOST=0.0.0.0 \
  -p 127.0.0.1:$PORT:$PORT -v "$S14/iso/isoD":/data -v /opt/wbs-rongcheng:/app:ro \
  "$IMAGE" node /app/server.js >/dev/null
for i in $(seq 1 60); do curl -s -m 2 "http://127.0.0.1:$PORT/api/health" | grep -q '"ok":true' && break; sleep 0.3; done
docker run --rm --ipc=host --network host \
  -e TOOLS=/tools -e BASE="http://127.0.0.1:$PORT" -e OUTDIR=/qv/results -e DATA_DIR=/qv/iso/isoD \
  -e RESULT_FILE=/qv/results/nonreg-results.json -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "$TOOLS":/tools:ro -v "$S14":/qv -w /qv \
  "$IMAGE" node /qv/scripts/qv-nonreg-browser.cjs
RC=$?
docker rm -f "$CN" >/dev/null 2>&1
exit $RC
