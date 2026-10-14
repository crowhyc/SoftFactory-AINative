#!/usr/bin/env bash
# WC-001 回滚：恢复上一镜像与上一 data/wbs.json 备份，重启回环容器并自检 /api/health。
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/wbs-rongcheng}"
IMAGE_NAME="${IMAGE_NAME:-wbs-rongcheng}"
CONTAINER_NAME="${CONTAINER_NAME:-wbs-rongcheng}"
STATE_FILE="${STATE_FILE:-$APP_DIR/state/previous.env}"

if [ ! -f "$STATE_FILE" ]; then
  echo "[rollback] 缺少状态文件 $STATE_FILE，无法回滚" >&2
  exit 1
fi

# shellcheck disable=SC1090
. "$STATE_FILE"

echo "[rollback] 目标镜像：${PREV_IMAGE:-${PREV_IMAGE_ID:?缺少 PREV_IMAGE_ID}}"
if [ -n "${DATA_BAK:-}" ] && [ -f "$DATA_BAK" ]; then
  ts_revert="$(date +%Y%m%d%H%M%S)"
  if [ -f "$APP_DIR/data/wbs.json" ]; then
    cp -p "$APP_DIR/data/wbs.json" "$APP_DIR/data/wbs.json.$ts_revert.rollback.bak"
    echo "[rollback] 当前数据已另存 -> $APP_DIR/data/wbs.json.$ts_revert.rollback.bak"
  fi
  cp -p "$DATA_BAK" "$APP_DIR/data/wbs.json"
  echo "[rollback] 已恢复数据 -> $DATA_BAK"
else
  echo "[rollback] 无数据备份可恢复，保留当前数据"
fi

docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --network host \
  -e WBS_HOST="${BIND_HOST:-127.0.0.1}" -e WBS_PORT="${HOST_PORT:-4180}" \
  -v "$APP_DIR/data:/app/data" \
  "${PREV_IMAGE:-$PREV_IMAGE_ID}" >/dev/null

port="${HOST_PORT:-4180}"
for _ in $(seq 1 30); do
  if body="$(curl -fsS "http://${BIND_HOST:-127.0.0.1}:$port/api/health" 2>/dev/null)"; then
    case "$body" in
      *'"ok":true'*) echo "[rollback] 健康检查通过：$body"; exit 0 ;;
    esac
  fi
  sleep 1
done
echo "[rollback] 回滚后健康检查未通过" >&2
exit 1
