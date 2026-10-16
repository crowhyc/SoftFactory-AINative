#!/usr/bin/env bash
# YUNZ-38 / Stage18：部署与一致性（只读现场）。
# 断言：运行态绑定 0.0.0.0:4180 / 三端 health / 镜像无 node_modules / 服务端资源与源码快照 sha256 一致。
set -uo pipefail
S18="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP=/opt/wbs-rongcheng
SNAP=/opt/SoftFactory-AINative/artifacts/YUNZ-20/wbs-rongcheng
PUBLIC_URL="${PUBLIC_URL:-http://47.108.129.157:4180}"
PASS=0; FAIL=0
chk() { # id ok detail
  if [ "$2" = "1" ]; then echo "PASS  $1  :: $3"; PASS=$((PASS+1)); else echo "FAIL  $1  -> $3"; FAIL=$((FAIL+1)); fi
}

CNAME=$(docker inspect -f '{{.Name}}' wbs-rongcheng 2>/dev/null | sed 's#^/##')
HOST_ENV=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' wbs-rongcheng 2>/dev/null | grep -E '^WBS_(HOST|PORT)=' | tr '\n' ' ')
NET=$(docker inspect -f '{{.HostConfig.NetworkMode}}' wbs-rongcheng 2>/dev/null)
IMG=$(docker inspect -f '{{.Config.Image}}' wbs-rongcheng 2>/dev/null)
MOUNTS=$(docker inspect -f '{{range .Mounts}}{{.Source}}:{{.Destination}} {{end}}' wbs-rongcheng 2>/dev/null)
chk "D01 运行容器存在且名称 == wbs-rongcheng" "$([ "$CNAME" = "wbs-rongcheng" ] && echo 1 || echo 0)" "name=$CNAME"
chk "D02 运行态绑定 0.0.0.0:4180（WBS_HOST=0.0.0.0 / WBS_PORT=4180）" \
  "$(echo "$HOST_ENV" | grep -q 'WBS_HOST=0.0.0.0' && echo "$HOST_ENV" | grep -q 'WBS_PORT=4180' && echo 1 || echo 0)" "$HOST_ENV"
chk "D03 host 网络 + 数据目录挂载 /opt/wbs-rongcheng/data" \
  "$([ "$NET" = "host" ] && echo "$MOUNTS" | grep -q '/opt/wbs-rongcheng/data:/app/data' && echo 1 || echo 0)" "net=$NET mounts=$MOUNTS"

H1=$(curl -s -m 5 http://127.0.0.1:4180/api/health)
chk "D04 127.0.0.1:4180/api/health ok" "$(echo "$H1" | grep -q '"ok":true' && echo 1 || echo 0)" "$H1"
H2=$(curl -s -m 5 http://0.0.0.0:4180/api/health)
chk "D05 0.0.0.0:4180/api/health ok" "$(echo "$H2" | grep -q '"ok":true' && echo 1 || echo 0)" "$H2"
H3=$(curl -s -m 8 "$PUBLIC_URL/api/health" 2>/dev/null || true)
chk "D06 公网 $PUBLIC_URL/api/health ok（失败记录实测，不据此判实现缺陷）" \
  "$(echo "$H3" | grep -q '"ok":true' && echo 1 || echo 0)" "${H3:-（无响应）}"

NM=$(docker run --rm --entrypoint sh "$IMG" -c 'ls -d /app/node_modules /app/package-lock.json 2>/dev/null | wc -l' 2>/dev/null | tr -d '[:space:]')
chk "D07 镜像内无 node_modules / package-lock.json（零运行时依赖）" "$([ "$NM" = "0" ] && echo 1 || echo 0)" "found=$NM image=$IMG"

gs() { sha256sum "$1" 2>/dev/null | cut -d' ' -f1; }
rs() { curl -s -m 8 "http://127.0.0.1:4180/$1" | sha256sum | cut -d' ' -f1; }
# 运行目录 == 源码快照
for f in server.js public/app.js public/index.html public/styles.css public/template.xlsx; do
  A=$(gs "$APP/$f"); B=$(gs "$SNAP/$f")
  chk "D08a 运行目录 $f 与源码快照 sha256 一致" "$([ -n "$A" ] && [ "$A" = "$B" ] && echo 1 || echo 0)" "runtime=${A:0:12} snapshot=${B:0:12}"
done
# 运行镜像内实际文件（权威运行态）== 运行目录 == 快照
for pair in "server.js:/app/server.js" "public/app.js:/app/public/app.js" "public/index.html:/app/public/index.html" "public/styles.css:/app/public/styles.css" "public/template.xlsx:/app/public/template.xlsx"; do
  rel="${pair%%:*}"; cpath="${pair##*:}"
  A=$(gs "$APP/$rel")
  C=$(docker exec wbs-rongcheng sha256sum "$cpath" 2>/dev/null | cut -d' ' -f1)
  chk "D08b 镜像内 $cpath 与运行目录 sha256 一致" "$([ -n "$A" ] && [ "$A" = "$C" ] && echo 1 || echo 0)" "runtime=${A:0:12} in_image=${C:0:12}"
done
# 服务端 HTTP 返回 == 运行目录（静态资源）
for pair in "public/index.html:index.html" "public/app.js:app.js" "public/styles.css:styles.css" "public/template.xlsx:template.xlsx"; do
  rel="${pair%%:*}"; url="${pair##*:}"
  A=$(gs "$APP/$rel"); C=$(rs "$url")
  chk "D09 服务端 GET /$url 返回体与运行目录 sha256 逐字节一致" "$([ -n "$A" ] && [ "$A" = "$C" ] && echo 1 || echo 0)" "runtime=${A:0:12} served=${C:0:12}"
done

echo "[deploy-consistency] PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ] || exit 1
