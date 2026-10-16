#!/usr/bin/env bash
# YUNZ-38 / Stage18：隔离实例真实浏览器交互（Chromium）。
# 四个一次性隔离服务只绑 127.0.0.1（isoA 4260 / isoB 4261 / isoC 4262 / isoS 4263），
# 数据目录为宿主隔离路径；不触碰现场 4180 与现场数据。写入只落本 stage18 目录。
# 前置：先跑 qv-make-iso-data.py（会重建 isoA/B/C/S 数据）。
set -uo pipefail
S18="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.55.0-jammy}"
TOOLS="${TOOLS_DIR:-/opt/wbs-rongcheng/tests/.tools}"
A=qv38-isoA; B=qv38-isoB; C=qv38-isoC; S=qv38-isoS
PA=4260; PB=4261; PC=4262; PS=4263

cleanup() { docker rm -f "$A" "$B" "$C" "$S" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

start() { # name dir port
  docker run -d --name "$1" -e WBS_DATA_DIR=/data -e WBS_PORT=$3 -e WBS_HOST=0.0.0.0 \
    -p 127.0.0.1:$3:$3 -v "$S18/iso/$2":/data -v /opt/wbs-rongcheng:/app:ro "$IMAGE" node /app/server.js >/dev/null || exit 1
}
start "$A" isoA $PA
start "$B" isoB $PB
start "$C" isoC $PC
start "$S" isoS $PS

for p in $PA $PB $PC $PS; do
  ok=""
  for _ in $(seq 1 80); do
    if curl -s -m 2 "http://127.0.0.1:$p/api/health" | grep -q '"ok":true'; then ok=1; break; fi
    sleep 0.25
  done
  [ -n "$ok" ] || { echo "isolated server on $p failed to start"; docker logs "$A" 2>&1 | tail -6; exit 1; }
done

docker run --rm --ipc=host --network host \
  -e TOOLS=/tools -e OUTDIR=/qv/results -e SHOTDIR=/qv/shots \
  -e BASE_A="http://127.0.0.1:$PA" -e BASE_B="http://127.0.0.1:$PB" \
  -e BASE_C="http://127.0.0.1:$PC" -e BASE_S="http://127.0.0.1:$PS" \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "$TOOLS":/tools:ro -v "$S18":/qv \
  "$IMAGE" node /qv/scripts/qv-iso-browser.cjs
exit $?
