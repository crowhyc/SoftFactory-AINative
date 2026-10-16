#!/usr/bin/env bash
# YUNZ-38 / Stage18：CH-1…CH-13 不回归抽样（隔离实例 isoNR + 真实浏览器）。
set -uo pipefail
S18="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.55.0-jammy}"
TOOLS="${TOOLS_DIR:-/opt/wbs-rongcheng/tests/.tools}"
CN=qv38-nonreg; P=4264
cleanup() { docker rm -f "$CN" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
rm -rf "$S18/iso/isoNR"; cp -r "$S18/iso/isoA" "$S18/iso/isoNR"
docker run -d --name "$CN" -e WBS_DATA_DIR=/data -e WBS_PORT=$P -e WBS_HOST=0.0.0.0 \
  -p 127.0.0.1:$P:$P -v "$S18/iso/isoNR":/data -v /opt/wbs-rongcheng:/app:ro "$IMAGE" node /app/server.js >/dev/null || exit 1
for _ in $(seq 1 80); do curl -s -m 2 "http://127.0.0.1:$P/api/health" | grep -q '"ok":true' && break; sleep 0.25; done
docker run --rm --ipc=host --network host \
  -e TOOLS=/tools -e BASE="http://127.0.0.1:$P" -e OUTDIR=/qv/results \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "$TOOLS":/tools:ro -v "$S18":/qv -w /qv \
  "$IMAGE" node /qv/scripts/qv-nonreg-browser.cjs
