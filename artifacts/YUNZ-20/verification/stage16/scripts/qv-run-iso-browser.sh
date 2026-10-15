#!/usr/bin/env bash
# YUNZ-36 / Stage16：隔离实例真实浏览器交互（Chromium）。
# 两个一次性隔离服务（isoA 4260 / isoB 4261）只绑 127.0.0.1，数据目录为宿主隔离路径；
# 不触碰现场 4180 与现场数据。写入只落本 stage16 目录。
set -uo pipefail
S16="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.55.0-jammy}"
TOOLS="${TOOLS_DIR:-/opt/wbs-rongcheng/tests/.tools}"
A=qv36-isoA; B=qv36-isoB; PA=4260; PB=4261

cleanup() { docker rm -f "$A" "$B" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

docker run -d --name "$A" -e WBS_DATA_DIR=/data -e WBS_PORT=$PA -e WBS_HOST=0.0.0.0 \
  -p 127.0.0.1:$PA:$PA -v "$S16/iso/isoA":/data -v /opt/wbs-rongcheng:/app:ro \
  "$IMAGE" node /app/server.js >/dev/null || exit 1
docker run -d --name "$B" -e WBS_DATA_DIR=/data -e WBS_PORT=$PB -e WBS_HOST=0.0.0.0 \
  -p 127.0.0.1:$PB:$PB -v "$S16/iso/isoB":/data -v /opt/wbs-rongcheng:/app:ro \
  "$IMAGE" node /app/server.js >/dev/null || exit 1

for p in $PA $PB; do
  ok=""
  for _ in $(seq 1 80); do
    if curl -s -m 2 "http://127.0.0.1:$p/api/health" | grep -q '"ok":true'; then ok=1; break; fi
    sleep 0.25
  done
  [ -n "$ok" ] || { echo "isolated server on $p failed to start"; docker logs "$A" 2>&1 | tail -5; exit 1; }
done

docker run --rm --ipc=host --network host \
  -e TOOLS=/tools -e OUTDIR=/qv/results -e EXPECTED=/qv/results/expected-text.json \
  -e BASE_A="http://127.0.0.1:$PA" -e BASE_B="http://127.0.0.1:$PB" \
  -e RESULT_FILE=/qv/results/iso-browser-results.json -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "$TOOLS":/tools:ro -v "$S16":/qv \
  "$IMAGE" node /qv/scripts/qv-iso-browser.cjs
RC=$?
exit $RC
