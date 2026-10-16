#!/usr/bin/env bash
# YUNZ-40 / Stage20：隔离实例真实浏览器交互用例集运行器。
# 四个一次性隔离服务（isoA 4310 / isoB 4311 / isoC 4312 / isoS 4313，仅绑 127.0.0.1），
# 浏览器跑在官方 playwright 镜像（Chromium 140）内，network host 直连 127.0.0.1。
set -uo pipefail
S20="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.55.0-jammy}"
TOOLS="${TOOLS_DIR:-/opt/wbs-rongcheng/tests/.tools}"
APP="${APP_DIR:-/opt/wbs-rongcheng}"
NAMES=(isoA isoB isoC isoS)
PORTS=(4310 4311 4312 4313)

cleanup() { for n in "${NAMES[@]}"; do docker rm -f "qv40-$n" >/dev/null 2>&1 || true; done; }
trap cleanup EXIT
cleanup

for i in "${!NAMES[@]}"; do
  n="${NAMES[$i]}"; p="${PORTS[$i]}"
  docker run -d --name "qv40-$n" --network host \
    -e WBS_DATA_DIR=/data -e WBS_PORT="$p" -e WBS_HOST=127.0.0.1 \
    -v "$S20/iso/$n":/data -v "$APP":/app:ro "$IMAGE" node /app/server.js >/dev/null || exit 1
  ok=""
  for _ in $(seq 1 80); do
    if curl -s -m 2 "http://127.0.0.1:$p/api/health" | grep -q '"ok":true'; then ok=1; break; fi
    sleep 0.25
  done
  [ -n "$ok" ] || { echo "隔离实例 $n (:$p) 启动失败"; docker logs "qv40-$n" 2>&1 | tail -8; exit 1; }
done
echo "[stage20] 浏览器用例集隔离实例就绪（4310-4313）"

docker run --rm --ipc=host --network host \
  -e TOOLS=/tools -e OUTDIR=/qv/results -e SHOTDIR=/qv/shots -e DLDIR=/qv/downloads -e QVROOT=/qv \
  -e BASE_A=http://127.0.0.1:4310 -e BASE_B=http://127.0.0.1:4311 \
  -e BASE_C=http://127.0.0.1:4312 -e BASE_S=http://127.0.0.1:4313 \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "$TOOLS":/tools:ro -v "$S20":/qv \
  "$IMAGE" node /qv/scripts/qv20-iso-browser.cjs
exit $?
