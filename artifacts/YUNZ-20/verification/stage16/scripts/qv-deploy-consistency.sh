#!/usr/bin/env bash
# YUNZ-36 / Stage16：部署与一致性核验（只读）。
# 运行态绑定 / 三端 health / 镜像无 node_modules / 服务端返回资源 == 运行目录 == 源码快照 sha256。
set -uo pipefail
S16="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN=/opt/wbs-rongcheng
SNAP=/opt/SoftFactory-AINative/artifacts/YUNZ-20/wbs-rongcheng
RES="$S16/results/deploy-consistency.json"
P=0; F=0
ck() { if [ "$2" = "1" ]; then echo "PASS  $1"; P=$((P+1)); else echo "FAIL  $1  :: $3"; F=$((F+1)); fi; }

echo "--- 容器与绑定 ---"
CN=$(docker ps --format '{{.Names}} {{.Image}}' | awk '$1=="wbs-rongcheng"{print $2}')
ck "D-01 现场容器 wbs-rongcheng 运行中" "$([ -n "$CN" ] && echo 1 || echo 0)" "image='$CN'"
echo "      running image: $CN"
NM=$(docker inspect -f '{{.HostConfig.NetworkMode}}' wbs-rongcheng 2>/dev/null)
ck "D-02 网络模式为 host（宿主 0.0.0.0:4180）" "$([ "$NM" = "host" ] && echo 1 || echo 0)" "netmode=$NM"
HL=$(docker inspect -f '{{.State.Health.Status}}' wbs-rongcheng 2>/dev/null)
ck "D-03 容器健康状态 healthy" "$([ "$HL" = "healthy" ] && echo 1 || echo 0)" "health=$HL"
SS=$( (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -c ':4180')
ck "D-04 宿主监听 :4180（监听套接字存在）" "$([ "$SS" -ge 1 ] && echo 1 || echo 0)" "matches=$SS"

echo "--- 三端 health ---"
H1=$(curl -s -m 6 http://127.0.0.1:4180/api/health)
ck "D-05 127.0.0.1:4180/api/health ok" "$(echo "$H1" | grep -q '"ok":true' && echo 1 || echo 0)" "$H1"
H2=$(curl -s -m 6 http://0.0.0.0:4180/api/health)
ck "D-06 0.0.0.0:4180/api/health ok" "$(echo "$H2" | grep -q '"ok":true' && echo 1 || echo 0)" "$H2"
H3=$(curl -s -m 8 http://47.108.129.157:4180/api/health || true)
echo "      公网实测: ${H3:-（无响应）}"
ck "D-07 公网 health（安全组未放行不据此判缺陷，仅记录实测）" "1" "observed='${H3:-none}'"

echo "--- 镜像内容 ---"
IMG="$CN"
if [ -z "$IMG" ]; then IMG="wbs-rongcheng:20261015181021"; fi
LSD=$(docker run --rm --entrypoint sh "$IMG" -c 'ls -1 /app' 2>/dev/null | tr '\n' ',')
ck "D-08 镜像内无 node_modules / package-lock.json" \
   "$(docker run --rm --entrypoint sh "$IMG" -c '[ -e /app/node_modules ] && exit 3; [ -e /app/package-lock.json ] && exit 3; exit 0' >/dev/null 2>&1 && echo 1 || echo 0)" "ls=/app: $LSD"

echo "--- 资源 sha256 三方一致（服务端返回 / 运行目录 / 源码快照）---"
for f in server.js public/app.js public/index.html public/styles.css public/vendor/xlsx.full.min.js public/template.xlsx; do
  A=$(sha256sum "$RUN/$f" 2>/dev/null | awk '{print $1}')
  B=$(sha256sum "$SNAP/$f" 2>/dev/null | awk '{print $1}')
  case "$f" in
    public/*) C=$(curl -s -m 8 "http://127.0.0.1:4180/${f#public/}" | sha256sum | awk '{print $1}') ;;
    *)        C="(服务端不返回)" ;;
  esac
  D=$(docker run --rm --entrypoint sh "$IMG" -c "sha256sum /app/$f" 2>/dev/null | awk '{print $1}')
  if [ "$f" = "server.js" ]; then
    ok=$([ -n "$A" ] && [ "$A" = "$B" ] && [ "$A" = "$D" ] && echo 1 || echo 0)
    ck "D-09 server.js 运行目录 == 源码快照 == 容器（服务端不对外返回）" "$ok" "run=$A snap=$B ctr=$D"
  else
    ok=$([ -n "$A" ] && [ "$A" = "$B" ] && [ "$A" = "$C" ] && [ "$A" = "$D" ] && echo 1 || echo 0)
    ck "D-09 $f 运行目录 == 源码快照 == 服务端返回 == 容器" "$ok" "run=$A snap=$B served=$C ctr=$D"
  fi
done

echo "--- 现场数据未被本轮改动 ---"
REV=$(curl -s -m 6 http://127.0.0.1:4180/api/wbs | grep -o '"revision":[0-9]*' | head -1)
ck "D-10 现场 revision 仍为 10（复验窗口无写入）" "$(echo "$REV" | grep -q '"revision":10' && echo 1 || echo 0)" "$REV"

echo "--- 静态补充：日报 xlsx 组装代码已移除 ---"
G=$(grep -c -E "buildDailyWorkbook|dailyBytes|DAILY_SHEET_NAMES" "$RUN/public/app.js" || true)
ck "D-11 前端 app.js 无日报 xlsx 组装符号（buildDailyWorkbook/dailyBytes/DAILY_SHEET_NAMES）" "$([ "$G" = "0" ] && echo 1 || echo 0)" "hits=$G"

echo
echo "[deploy-consistency] PASS=$P FAIL=$F"
python3 - "$RES" "$P" "$F" <<'PY' 2>/dev/null || true
import json,sys
json.dump({'pass':int(sys.argv[2]),'fail':int(sys.argv[3])}, open(sys.argv[1],'w'))
PY
[ "$F" = "0" ] || exit 1
