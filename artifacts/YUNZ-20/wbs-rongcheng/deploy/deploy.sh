#!/usr/bin/env bash
# WC-001 部署：构建不回外网的镜像 -> 备份当前镜像与 data/wbs.json -> 替换回环容器 -> 自检 /api/health。
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/wbs-rongcheng}"
IMAGE_NAME="${IMAGE_NAME:-wbs-rongcheng}"
CONTAINER_NAME="${CONTAINER_NAME:-wbs-rongcheng}"
BIND_HOST="${BIND_HOST:-127.0.0.1}"
HOST_PORT="${HOST_PORT:-4180}"
CONTAINER_PORT="${CONTAINER_PORT:-4180}"
DATA_DIR="$APP_DIR/data"
STATE_DIR="$APP_DIR/state"
TS="$(date +%Y%m%d%H%M%S)"
NEW_IMAGE="$IMAGE_NAME:$TS"
DATA_BAK=""

mkdir -p "$STATE_DIR" "$DATA_DIR"

echo "[deploy] 1/6 记录当前 running 容器与镜像"
PREV_IMAGE="$(docker inspect -f '{{.Config.Image}}' "$CONTAINER_NAME" 2>/dev/null || true)"
PREV_IMAGE_ID="$(docker inspect -f '{{.Image}}' "$CONTAINER_NAME" 2>/dev/null || true)"
echo "[deploy]     当前镜像：${PREV_IMAGE:-（无容器）} ${PREV_IMAGE_ID:-}"

echo "[deploy] 2/6 备份当前 data/wbs.json"
if [ -f "$DATA_DIR/wbs.json" ]; then
  DATA_BAK="$DATA_DIR/wbs.json.$TS.bak"
  cp -p "$DATA_DIR/wbs.json" "$DATA_BAK"
  echo "[deploy]     已备份 -> $DATA_BAK"
else
  echo "[deploy]     尚无 wbs.json，跳过备份"
fi

echo "[deploy] 3/6 构建镜像（--network none，构建期不回外网）：$NEW_IMAGE"
docker build --network none -t "$NEW_IMAGE" "$APP_DIR"

echo "[deploy] 4/6 记录回滚信息 -> $STATE_DIR/previous.env"
{
  echo "PREV_IMAGE=$PREV_IMAGE"
  echo "PREV_IMAGE_ID=$PREV_IMAGE_ID"
  echo "NEW_IMAGE=$NEW_IMAGE"
  echo "DATA_BAK=$DATA_BAK"
  echo "DEPLOYED_AT=$(date -Iseconds)"
  echo "BIND_HOST=$BIND_HOST"
  echo "HOST_PORT=$HOST_PORT"
} > "$STATE_DIR/previous.env"

echo "[deploy] 5/6 替换容器（host 网络 + 进程只绑定 $BIND_HOST:$HOST_PORT，挂载 $DATA_DIR）"
# 说明：容器进程自身绑定回环地址（WBS_HOST=$BIND_HOST），使用 host 网络后该回环即宿主回环，
# 因此 4180 不会在任何非回环地址上被监听，也不对公网暴露（非生产部署）。
chown 1000:1000 "$DATA_DIR" 2>/dev/null || true
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --network host \
  -e WBS_HOST="$BIND_HOST" -e WBS_PORT="$CONTAINER_PORT" \
  -v "$DATA_DIR:/app/data" \
  "$NEW_IMAGE" >/dev/null

echo "[deploy] 6/6 自检 curl http://$BIND_HOST:$HOST_PORT/api/health"
health_ok=0
for _ in $(seq 1 30); do
  if body="$(curl -fsS "http://$BIND_HOST:$HOST_PORT/api/health" 2>/dev/null)"; then
    case "$body" in
      *'"ok":true'*) health_ok=1; echo "[deploy]     健康检查通过：$body"; break ;;
    esac
  fi
  sleep 1
done
if [ "$health_ok" -ne 1 ]; then
  echo "[deploy] 部署失败：/api/health 未通过，请执行 deploy/rollback.sh 回滚" >&2
  exit 1
fi

echo "[deploy] 完成：$NEW_IMAGE 运行中（上一镜像：${PREV_IMAGE:-无}，data 备份：${DATA_BAK:-无}）"
