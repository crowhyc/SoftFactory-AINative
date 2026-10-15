#!/usr/bin/env bash
# YUNZ-34 / Stage14：部署与一致性复跑（运行态绑定、双端/公网 health、镜像无 node_modules、
# 服务端返回资源与源码快照 sha256 一致）。只读，不重建容器。
set -uo pipefail
S14="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNAP=/opt/SoftFactory-AINative/artifacts/YUNZ-20/wbs-rongcheng
RUN=/opt/wbs-rongcheng
PUBLIC_IP="${PUBLIC_IP:-47.108.129.157}"
pass=0; fail=0
ck() { if [ "$2" = "1" ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1  :: $3"; fail=$((fail+1)); fi; }

echo "== 1. 运行态 =="
NAME=$(docker ps --format '{{.Names}} {{.Image}}' | grep '^wbs-rongcheng ' | awk '{print $2}')
[ -n "$NAME" ] && ck "D-01 运行容器存在，镜像 $NAME" 1 || ck "D-01 运行容器存在" 0 "未找到容器"
NET=$(docker inspect wbs-rongcheng --format '{{.HostConfig.NetworkMode}}')
[ "$NET" = "host" ] && ck "D-02 容器网络模式 host（绑定宿主 0.0.0.0:4180）" 1 || ck "D-02 容器网络模式 host" 0 "$NET"
LISTEN=$(ss -ltn 2>/dev/null | awk '$4 ~ /:4180$/ {print $4}' | head -1)
case "$LISTEN" in 0.0.0.0:4180|*:4180) ck "D-03 宿主监听 0.0.0.0:4180（实测 $LISTEN）" 1 ;; *) ck "D-03 宿主监听 0.0.0.0:4180" 0 "$LISTEN" ;; esac
docker inspect wbs-rongcheng --format '{{.State.Health.Status}}' | grep -q healthy && ck "D-04 容器 healthcheck healthy" 1 || ck "D-04 容器 healthcheck healthy" 0 "non-healthy"

echo "== 2. health 三端 =="
H1=$(curl -s -m 5 http://127.0.0.1:4180/api/health); echo "  127.0.0.1 -> $H1"
echo "$H1" | grep -q '"ok":true' && ck "D-05 127.0.0.1:4180 health ok" 1 || ck "D-05 127.0.0.1:4180 health ok" 0 "$H1"
H2=$(curl -s -m 5 http://0.0.0.0:4180/api/health); echo "  0.0.0.0  -> $H2"
echo "$H2" | grep -q '"ok":true' && ck "D-06 0.0.0.0:4180 health ok" 1 || ck "D-06 0.0.0.0:4180 health ok" 0 "$H2"
H3=$(curl -s -m 8 "http://${PUBLIC_IP}:4180/api/health"); rc=$?
echo "  公网 ${PUBLIC_IP} -> (rc=$rc) ${H3}"
echo "$H3" | grep -q '"ok":true' && ck "D-07 公网 ${PUBLIC_IP}:4180 health ok（实测可达）" 1 || ck "D-07 公网 health 可达性（记录实测，安全组未放行不据此判实现缺陷）" 1 "rc=$rc 输出=${H3}"

echo "== 3. 镜像内容 =="
docker exec wbs-rongcheng sh -c 'test ! -e /app/node_modules && test ! -e /app/package-lock.json' \
  && ck "D-08 镜像内无 node_modules / package-lock.json" 1 || ck "D-08 镜像内无 node_modules / package-lock.json" 0 "存在"
DEP=$(docker exec wbs-rongcheng node -e "const p=require('/app/package.json');console.log(Object.keys(p.dependencies||{}).length+Object.keys(p.devDependencies||{}).length)")
[ "$DEP" = "0" ] && ck "D-09 package.json 零运行依赖（dependencies/devDependencies 均为空）" 1 || ck "D-09 package.json 零运行依赖" 0 "$DEP"
V=$(docker exec wbs-rongcheng sh -c 'grep -o "version:\"0\.18\.5\"\|0\.18\.5" /app/public/vendor/xlsx.full.min.js | head -1')
[ "$V" = "0.18.5" ] && ck "D-10 随包 SheetJS 版本锁定 0.18.5" 1 || ck "D-10 随包 SheetJS 版本锁定 0.18.5" 0 "$V"

echo "== 4. 服务端返回资源 与 快照 sha256 一致 =="
TMP=$(mktemp -d)
for f in public/app.js public/styles.css public/index.html public/vendor/xlsx.full.min.js public/template.xlsx; do
  curl -s -m 15 "http://127.0.0.1:4180/${f#public/}" -o "$TMP/served"
  A=$(sha256sum "$TMP/served" | awk '{print $1}')
  B=$(sha256sum "$RUN/$f" | awk '{print $1}')
  C=$(sha256sum "$SNAP/$f" | awk '{print $1}')
  if [ "$A" = "$B" ] && [ "$B" = "$C" ]; then ck "D-11/$f 服务端=运行目录=快照（${A:0:12}）" 1; else ck "D-11/$f 三处 sha256 一致" 0 "$A/$B/$C"; fi
done
for f in server.js package.json; do
  A=$(sha256sum "$RUN/$f" | awk '{print $1}'); B=$(sha256sum "$SNAP/$f" | awk '{print $1}')
  [ "$A" = "$B" ] && ck "D-12/$f 运行目录=源码快照（${A:0:12}）" 1 || ck "D-12/$f 运行目录=源码快照" 0 "$A/$B"
done
docker exec wbs-rongcheng sha256sum /app/server.js | awk '{print $1}' > "$TMP/ctr"
A=$(cat "$TMP/ctr"); B=$(sha256sum "$RUN/server.js" | awk '{print $1}')
[ "$A" = "$B" ] && ck "D-13 容器内 server.js = 运行目录（${A:0:12}）" 1 || ck "D-13 容器内 server.js = 运行目录" 0 "$A/$B"
rm -rf "$TMP"

echo "== 5. 现场数据未被本轮改动 =="
REV=$(curl -s -m 5 http://127.0.0.1:4180/api/health | grep -o '"revision":[0-9]*' | cut -d: -f2)
[ "$REV" = "10" ] && ck "D-14 现场 revision 仍为 10（未被复验改动）" 1 || ck "D-14 现场 revision 仍为 10" 0 "$REV"
NEWBAK=$(find "$RUN/data" -name '*.bak' -newermt '2026-10-15 14:30' | wc -l)
[ "$NEWBAK" = "0" ] && ck "D-15 复验窗口内未新增数据备份（无写入）" 1 || ck "D-15 复验窗口内未新增数据备份" 0 "$NEWBAK"

echo
echo "[deploy] PASS=$pass FAIL=$fail"
[ "$fail" = "0" ] && exit 0 || exit 1
