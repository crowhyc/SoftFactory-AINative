#!/usr/bin/env bash
# YUNZ-28 / Stage8：隔离实例复验运行器（同镜像、端口 4181、隔离数据目录，不触碰 4180 现场）。
set -uo pipefail
D="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCR="${SCR:-/opt/SoftFactory-AINative/.multica-workspaces/yunzhidian-f03e0d551ffa/yunz-28-8823ba1611a5/workdir/scratch/stage8-iso}"
TOOLS="${TOOLS:-/opt/wbs-rongcheng/tests/.tools}"
IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.55.0-jammy}"
APP_IMAGE="${APP_IMAGE:-wbs-rongcheng:20261014203454}"
NAME="qv-stage8-4181"
PORT="${PORT:-4181}"
BASE="http://127.0.0.1:$PORT"
mkdir -p "$D/isolated" "$D/logs"
chown -R 1000:1000 "$SCR/data"

echo "[iso] 启动隔离容器 $NAME（镜像 $APP_IMAGE，端口 $PORT，数据 $SCR/data）"
docker rm -f "$NAME" >/dev/null 2>&1
docker run -d --name "$NAME" --network host -e WBS_HOST=0.0.0.0 -e WBS_PORT="$PORT" -e WBS_DATA_DIR=/app/data \
  -v "$SCR/data":/app/data "$APP_IMAGE" >/dev/null
for _ in $(seq 1 30); do curl -fsS -m 3 "$BASE/api/health" >/dev/null 2>&1 && break; sleep 1; done
curl -s "$BASE/api/health"; echo

echo "[iso] 阶段 1：旧数据兼容 / 保存 / 并发 409 / CH-7 反例（真实浏览器 + API）"
docker run --rm --ipc=host --network host \
  -e TOOLS=/tools -e BASE="$BASE" -e DATA_DIR=/data -e OUTDIR=/out -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "$D":/out -v "$TOOLS":/tools -v "$SCR/data":/data:ro \
  "$IMAGE" node /out/scripts/qv-iso1.cjs 2>&1 | tee "$D/logs/08-iso1.log"
rc1=${PIPESTATUS[0]}

echo "[iso] 重启隔离容器（重启持久复验）"
docker restart "$NAME" >/dev/null
for _ in $(seq 1 30); do curl -fsS -m 3 "$BASE/api/health" >/dev/null 2>&1 && break; sleep 1; done
curl -s "$BASE/api/health"; echo

echo "[iso] 阶段 2：重启后数据 / 审计 / 日报"
docker run --rm --ipc=host --network host \
  -e BASE="$BASE" -e DATA_DIR=/data -e OUTDIR=/out \
  -v "$D":/out -v "$SCR/data":/data:ro \
  "$IMAGE" node /out/scripts/qv-iso2.cjs 2>&1 | tee "$D/logs/09-iso2.log"
rc2=${PIPESTATUS[0]}

echo "[iso] 容器日志尾部"; docker logs "$NAME" 2>&1 | tail -5 | tee "$D/logs/10-iso-container.log"
docker rm -f "$NAME" >/dev/null 2>&1
echo "[iso] 退出码 iso1=$rc1 iso2=$rc2"
[ "$rc1" = 0 ] && [ "$rc2" = 0 ]
