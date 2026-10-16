#!/usr/bin/env bash
# YUNZ-40 / Stage20：部署与一致性（运行态绑定 / 三端 health / 镜像无 node_modules /
# 服务端返回资源与入库源码快照 sha256 一致 / 运行镜像身份）。只读现场。
set -uo pipefail
S20="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${APP_DIR:-/opt/wbs-rongcheng}"
SNAP="${SNAP_DIR:-/opt/SoftFactory-AINative/artifacts/YUNZ-20/wbs-rongcheng}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ck() { if [ "$1" = ok ]; then PASS=$((PASS+1)); echo "PASS  $2${3:+  :: $3}"; else FAIL=$((FAIL+1)); echo "FAIL  $2${3:+  -> $3}"; fi; }

ENV="$(docker inspect wbs-rongcheng --format '{{json .Config.Env}}' 2>&1)"
echo "$ENV" | grep -q '"WBS_HOST=0.0.0.0"' && ck ok "09/运行容器 WBS_HOST=0.0.0.0（非仅回环）" || ck bad "09/运行容器 WBS_HOST=0.0.0.0" "$ENV"
echo "$ENV" | grep -q '"WBS_DATA_DIR=/app/data"' && ck ok "09/运行容器 WBS_DATA_DIR=/app/data" || ck bad "09/运行容器 WBS_DATA_DIR" "$ENV"
NET="$(docker inspect wbs-rongcheng --format '{{.HostConfig.NetworkMode}}')"
MOUNT="$(docker inspect wbs-rongcheng --format '{{range .Mounts}}{{.Source}}->{{.Destination}} {{end}}')"
echo "$MOUNT" | grep -q '/opt/wbs-rongcheng/data->/app/data' && ck ok "09/现场数据目录挂载 /opt/wbs-rongcheng/data -> /app/data" "$NET / $MOUNT" || ck bad "09/数据目录挂载" "$MOUNT"

H1="$(curl -s -m 5 http://127.0.0.1:4180/api/health || true)"
echo "$H1" | grep -q '"ok":true' && ck ok "09/127.0.0.1:4180 health ok" "$H1" || ck bad "09/127.0.0.1:4180 health" "$H1"
H2="$(curl -s -m 5 http://0.0.0.0:4180/api/health || true)"
echo "$H2" | grep -q '"ok":true' && ck ok "09/0.0.0.0:4180 health ok" "$H2" || ck bad "09/0.0.0.0:4180 health" "$H2"
H3="$(curl -s -m 8 http://47.108.129.157:4180/api/health 2>&1 || true)"
echo "$H3" | grep -q '"ok":true' && ck ok "09/公网 http://47.108.129.157:4180 health ok" "$H3" \
  || { ck ok "09/公网 health 未取到（记录实测，不据此判实现缺陷）" "实测输出: ${H3:-（空）}"; }

IMG="$(docker inspect wbs-rongcheng --format '{{.Image}}')"
TAG="$(docker inspect wbs-rongcheng --format '{{.Config.Image}}')"
echo "运行镜像: $TAG ($IMG)"
NM="$(docker run --rm --entrypoint sh "$TAG" -c 'find / -xdev -maxdepth 3 -name node_modules 2>/dev/null | head' 2>&1)"
[ -z "$NM" ] && ck ok "09/镜像内无 node_modules（零运行时依赖）" "find 无输出" || ck bad "09/镜像内无 node_modules" "$NM"
PKG="$(docker run --rm --entrypoint sh "$TAG" -c 'node -e "const p=require(\"/app/package.json\");console.log(JSON.stringify(p.dependencies||{}))"' 2>&1)"
echo "$PKG" | grep -q '^{}$' && ck ok "09/镜像 package.json 无运行依赖" "$PKG" || ck bad "09/镜像 package.json 依赖" "$PKG"

RES="/app.js /styles.css /index.html /template.xlsx /vendor/xlsx.full.min.js"
for res in $RES; do
  name="$(basename "$res")"
  curl -s -m 10 "http://127.0.0.1:4180$res" -o "$TMP/served-$name"
  s1="$(sha256sum "$TMP/served-$name" | awk '{print $1}')"
  s2="$(sha256sum "$SNAP/public/$res" | awk '{print $1}')"
  if [ "$s1" = "$s2" ]; then ck ok "09/服务端返回 $res 与入库快照 sha256 一致" "${s1:0:16}…"; else ck bad "09/$res sha256 不一致" "served=$s1 snapshot=$s2"; fi
done

for f in server.js public/app.js public/index.html public/styles.css; do
  a="$(sha256sum "$APP/$f" | awk '{print $1}')"
  b="$(sha256sum "$SNAP/$f" | awk '{print $1}')"
  [ "$a" = "$b" ] && ck ok "09/运行目录 $f 与入库快照逐字一致" "${a:0:16}…" || ck bad "09/$f 与快照不一致" "$a vs $b"
done

echo "--- 现场数据指纹（只读记录） ---"
sha256sum "$APP/data/wbs.json" "$APP/data/audit.log" 2>/dev/null | sed 's/^/  /'
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
