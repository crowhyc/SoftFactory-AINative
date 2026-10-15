#!/usr/bin/env bash
# YUNZ-36 / Stage16：隔离实例真实浏览器「导出 Excel」（WBS）下载。
# isoA（延期 / 阻塞 / 已完成 / 未开始）+ isoB（已开始）覆盖五色；服务只绑 127.0.0.1。
set -uo pipefail
S16="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.55.0-jammy}"
TOOLS="${TOOLS_DIR:-/opt/wbs-rongcheng/tests/.tools}"
A=qv36-isoA; B=qv36-isoB; PA=4260; PB=4261

cleanup() { docker rm -f "$A" "$B" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

docker run -d --name "$A" -e WBS_DATA_DIR=/data -e WBS_PORT=$PA -e WBS_HOST=0.0.0.0 \
  -p 127.0.0.1:$PA:$PA -v "$S16/iso/isoA":/data -v /opt/wbs-rongcheng:/app:ro "$IMAGE" node /app/server.js >/dev/null
docker run -d --name "$B" -e WBS_DATA_DIR=/data -e WBS_PORT=$PB -e WBS_HOST=0.0.0.0 \
  -p 127.0.0.1:$PB:$PB -v "$S16/iso/isoB":/data -v /opt/wbs-rongcheng:/app:ro "$IMAGE" node /app/server.js >/dev/null
for p in $PA $PB; do
  for _ in $(seq 1 80); do curl -s -m 2 "http://127.0.0.1:$p/api/health" | grep -q '"ok":true' && break; sleep 0.25; done
done

for pair in "isoA:$PA" "isoB:$PB"; do
  NAME="${pair%%:*}"; PORT="${pair##*:}"
  docker run --rm --ipc=host --network host \
    -e TOOLS=/tools -e BASE="http://127.0.0.1:$PORT" -e DLDIR=/qv/downloads -e PREFIX="$NAME" \
    -e SNAPSHOT="/qv/downloads/$NAME-wbs-at-export.json" -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    -v "$TOOLS":/tools:ro -v "$S16":/qv -w /qv \
    "$IMAGE" node /qv/scripts/qv-export-wbs.cjs || exit 1
done
