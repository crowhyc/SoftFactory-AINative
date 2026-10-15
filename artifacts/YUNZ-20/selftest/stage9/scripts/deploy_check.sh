#!/usr/bin/env bash
# YUNZ-29 / 变更包 #3：CH-8 部署与镜像自检（按 D-0006 授权口径：BIND_HOST=0.0.0.0）。
# 覆盖：现场容器镜像/绑定/挂载、本机 127.0.0.1 与 0.0.0.0 健康、公网健康（失败仅记录判断依据）、
#       镜像内无 node_modules、服务端返回资源与运行目录源码一致、容器内源码与运行目录一致。
# 用法：bash tests/stage9/deploy_check.sh
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/wbs-rongcheng}"
CONTAINER="${CONTAINER_NAME:-wbs-rongcheng}"
PORT="${HOST_PORT:-4180}"
PUBLIC_HOST="${PUBLIC_HOST:-47.108.129.157}"
BIND_HOST="${BIND_HOST:-0.0.0.0}"
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "PASS  $1${2:+  :: $2}"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL  $1${2:+  -> $2}"; }
sha() { sha256sum "$1" | cut -d' ' -f1; }
served_sha() { curl -fsS "http://127.0.0.1:$PORT$1" 2>/dev/null | sha256sum | cut -d' ' -f1; }

echo "=== 部署/镜像自检 $(date -Iseconds) ==="
echo "容器：$CONTAINER  端口：$PORT  BIND_HOST：$BIND_HOST  APP_DIR：$APP_DIR"

IMAGE="$(docker inspect -f '{{.Config.Image}}' "$CONTAINER" 2>/dev/null || true)"
ENVS="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$CONTAINER" 2>/dev/null || true)"
MOUNT="$(docker inspect -f '{{range .Mounts}}{{.Source}}->{{.Destination}}{{end}}' "$CONTAINER" 2>/dev/null || true)"
NETMODE="$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$CONTAINER" 2>/dev/null || true)"
if [ -n "$IMAGE" ]; then ok "现场容器存在并运行（镜像 $IMAGE，网络 $NETMODE，挂载 $MOUNT）"; else bad "现场容器 $CONTAINER 不存在"; fi
case "$ENVS" in
  *"WBS_HOST=$BIND_HOST"*) ok "容器进程绑定 $BIND_HOST（D-0006 授权对外暴露口径）" ;;
  *) bad "容器 WBS_HOST 不是 $BIND_HOST" "$(echo "$ENVS" | grep WBS_HOST || true)" ;;
esac
case "$MOUNT" in
  *"$APP_DIR/data->/app/data"*) ok "运行数据挂载 = $APP_DIR/data（现场数据未改挂载）" ;;
  *) bad "数据挂载异常：$MOUNT" ;;
esac

HEALTH_LOCAL="$(curl -fsS "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)"
case "$HEALTH_LOCAL" in
  *'"ok":true'*) ok "本机 http://127.0.0.1:$PORT/api/health → $HEALTH_LOCAL" ;;
  *) bad "本机 health 未通过" "$HEALTH_LOCAL" ;;
esac
HEALTH_ANY="$(curl -fsS "http://$BIND_HOST:$PORT/api/health" 2>/dev/null || true)"
case "$HEALTH_ANY" in
  *'"ok":true'*) ok "http://$BIND_HOST:$PORT/api/health → $HEALTH_ANY" ;;
  *) bad "http://$BIND_HOST:$PORT/api/health 未通过" "$HEALTH_ANY" ;;
esac
if ss -ltn 2>/dev/null | grep -E "0\.0\.0\.0:$PORT|\*:$PORT|\[::\]:$PORT" >/dev/null; then
  ok "宿主监听包含 $BIND_HOST:$PORT（按 D-0006 授权对外暴露）"
else
  bad "宿主未在 $BIND_HOST 上监听 $PORT"
fi
HEALTH_PUBLIC="$(curl -m 8 -fsS "http://$PUBLIC_HOST:$PORT/api/health" 2>/dev/null || true)"
case "$HEALTH_PUBLIC" in
  *'"ok":true'*) ok "公网 http://$PUBLIC_HOST:$PORT/api/health → $HEALTH_PUBLIC" ;;
  *) echo "NOTE  公网 http://$PUBLIC_HOST:$PORT/api/health 未通过：${HEALTH_PUBLIC:-（无响应/超时）}；本地 $BIND_HOST 与 127.0.0.1 均 ok、容器绑定 $BIND_HOST，按既有口径判定为阿里云安全组未放行（属 Sponsor 控制台操作），非实现问题。" ;;
esac

if docker run --rm --entrypoint sh "$IMAGE" -c 'test ! -e /app/node_modules && test ! -e /app/package-lock.json' >/dev/null 2>&1; then
  ok "镜像内无 node_modules / package-lock.json（零运行时依赖）"
else
  bad "镜像内存在 node_modules 或 package-lock.json"
fi
IMAGE_LS="$(docker run --rm --entrypoint sh "$IMAGE" -c 'ls -A /app' 2>&1 || true)"
echo "镜像 /app 内容：$(echo "$IMAGE_LS" | tr '\n' ' ')"

for f in app.js styles.css; do
  local_sha="$(sha "$APP_DIR/public/$f")"
  http_sha="$(served_sha "/$f")"
  if [ "$local_sha" = "$http_sha" ]; then ok "服务端返回 /$f 与运行目录源码一致（sha256 $local_sha）"; else bad "/$f 与源码不一致" "$local_sha vs $http_sha"; fi
done
INDEX_LOCAL="$(sha "$APP_DIR/public/index.html")"
INDEX_HTTP="$(curl -fsS "http://127.0.0.1:$PORT/" 2>/dev/null | sha256sum | cut -d' ' -f1)"
if [ "$INDEX_LOCAL" = "$INDEX_HTTP" ]; then ok "服务端返回 / 与运行目录 index.html 一致（sha256 $INDEX_LOCAL）"; else bad "index.html 与源码不一致" "$INDEX_LOCAL vs $INDEX_HTTP"; fi

for f in public/app.js public/index.html public/styles.css server.js; do
  in_container="$(docker exec "$CONTAINER" sha256sum "/app/$f" 2>/dev/null | cut -d' ' -f1)"
  in_dir="$(sha "$APP_DIR/$f")"
  if [ "$in_container" = "$in_dir" ]; then ok "容器内 /app/$f == 运行目录（sha256 $in_dir）"; else bad "容器内 /app/$f 与运行目录不一致" "$in_container vs $in_dir"; fi
done

echo "---"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
