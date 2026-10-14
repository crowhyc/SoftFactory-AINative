#!/usr/bin/env bash
# YUNZ-20 Stage2 —— 在隔离目录/容器/端口上端到端复跑交付的 deploy/deploy.sh（构建无网络 + 备份 + 替换 + 自检），不触碰现场部署。
set -uo pipefail
WORK="$(cd "$(dirname "$0")" && pwd)"
T="$WORK/isolated/deploy"
APP="$T/app"
CNAME="wbs-rongcheng-qv-dp"
pass=0; fail=0
ck(){ if [ "$2" = "1" ]; then echo "[PASS] $1 :: $3"; pass=$((pass+1)); else echo "[FAIL] $1 :: $3"; fail=$((fail+1)); fi; }

rm -rf "$T"; mkdir -p "$T"
cp -a /opt/wbs-rongcheng "$APP"
rm -rf "$APP/tests/.tools" "$APP/tests/.tmp" "$APP/state" "$APP/data"/*.bak
echo "--- 隔离前置：APP_DIR=$APP（源码副本），容器=$CNAME，端口=4182，镜像名=wbs-rongcheng-qv ---"
ls "$APP"

echo "--- 执行交付脚本 deploy/deploy.sh ---"
APP_DIR="$APP" CONTAINER_NAME="$CNAME" HOST_PORT=4182 CONTAINER_PORT=4182 IMAGE_NAME=wbs-rongcheng-qv \
  bash "$APP/deploy/deploy.sh" 2>&1 | tee "$T/deploy.out"
rc=${PIPESTATUS[0]}
echo "deploy.sh 退出码=$rc"

health=$(curl -s -m 5 http://127.0.0.1:4182/api/health || true)
echo "4182/api/health = $health"
img=$(docker inspect -f '{{.Config.Image}}' "$CNAME" 2>/dev/null || true)
netmode=$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$CNAME" 2>/dev/null || true)
bak=$(ls "$APP"/data/wbs.json.*.bak 2>/dev/null | head -1)
echo "容器镜像=$img  网络模式=$netmode"
echo "data 备份=${bak:-无}"
echo "state/previous.env:"; sed 's/^/   /' "$APP/state/previous.env" 2>/dev/null
ssline=$(ss -ltn | grep ':4182' || true)

[ "$rc" = "0" ] && ck "DP1" 1 "deploy.sh 退出码 0（含自检 health）" || ck "DP1" 0 "退出码 $rc"
grep -q -- "--network none" "$T/deploy.out" && grep -q "构建期不回外网" "$T/deploy.out" && \
  ck "DP2" 1 "构建使用 --network none（构建期不回外网）" || ck "DP2" 0 "未见 --network none"
case "$health" in *'"ok":true'*) ck "DP3" 1 "新容器在隔离端口 4182 健康：$health" ;; *) ck "DP3" 0 "health=$health" ;; esac
case "$img" in wbs-rongcheng-qv:*) ck "DP4" 1 "运行镜像为本次新构建 tag：$img" ;; *) ck "DP4" 0 "img=$img" ;; esac
[ -n "$bak" ] && ck "DP5" 1 "替换前备份 data/wbs.json -> $(basename "$bak")" || ck "DP5" 0 "未生成 .bak"
grep -q "PREV_IMAGE=" "$APP/state/previous.env" && grep -q "NEW_IMAGE=" "$APP/state/previous.env" && grep -q "DATA_BAK=" "$APP/state/previous.env" && \
  ck "DP6" 1 "写出回滚信息 state/previous.env（PREV_IMAGE/NEW_IMAGE/DATA_BAK）" || ck "DP6" 0 "previous.env 不完整"
[ "$netmode" = "host" ] && ck "DP7" 1 "容器网络模式 host" || ck "DP7" 0 "netmode=$netmode"
case "$ssline" in *"127.0.0.1:4182"*) ck "DP8" 1 "4182 仅回环监听" ;; *) ck "DP8" 0 "ss=$ssline" ;; esac
grep -q "健康检查通过" "$T/deploy.out" && ck "DP9" 1 "脚本输出包含健康检查通过" || ck "DP9" 0 "输出无健康检查通过"

echo "--- 清理隔离容器与镜像 ---"
docker rm -f "$CNAME" >/dev/null 2>&1
docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^wbs-rongcheng-qv:' | xargs -r docker rmi >/dev/null 2>&1
docker ps -a --format '{{.Names}}' | grep -q "$CNAME" && ck "DP10" 0 "隔离容器未清理" || ck "DP10" 1 "隔离容器/镜像已清理"
live=$(curl -s -m 5 http://127.0.0.1:4180/api/health || true)
case "$live" in *'"ok":true'*) ck "DP11" 1 "现场 4180 服务未受影响：$live" ;; *) ck "DP11" 0 "现场异常 $live" ;; esac
echo "== deploy 汇总: pass=$pass fail=$fail =="
exit $(( fail > 0 ))
