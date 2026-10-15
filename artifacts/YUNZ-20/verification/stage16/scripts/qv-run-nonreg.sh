#!/usr/bin/env bash
# YUNZ-36 / Stage16：不回归抽样（隔离实例 isoA + 真实浏览器）。
set -uo pipefail
S16="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.55.0-jammy}"
TOOLS="${TOOLS_DIR:-/opt/wbs-rongcheng/tests/.tools}"
CN=qv36-nonreg; P=4265
cleanup() { docker rm -f "$CN" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
docker run -d --name "$CN" -e WBS_DATA_DIR=/data -e WBS_PORT=$P -e WBS_HOST=0.0.0.0 \
  -p 127.0.0.1:$P:$P -v "$S16/iso/isoA":/data -v /opt/wbs-rongcheng:/app:ro "$IMAGE" node /app/server.js >/dev/null
for _ in $(seq 1 80); do curl -s -m 2 "http://127.0.0.1:$P/api/health" | grep -q '"ok":true' && break; sleep 0.25; done
docker run --rm --ipc=host --network host \
  -e TOOLS=/tools -e BASE="http://127.0.0.1:$P" -e OUTDIR=/qv/results \
  -e RESULT_FILE=/qv/results/nonreg-results.json -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "$TOOLS":/tools:ro -v "$S16":/qv -w /qv \
  "$IMAGE" node /qv/scripts/qv-nonreg-browser.cjs
