#!/usr/bin/env bash
# YUNZ-20 Stage2 —— 在隔离目录/容器/端口上端到端复跑交付的 deploy/rollback.sh 语义，不触碰现场部署。
set -uo pipefail
WORK="$(cd "$(dirname "$0")" && pwd)"
T="$WORK/isolated/rollback"
RB="$T/container"
IMG="wbs-rongcheng:20261014135512"
TS="$(date +%Y%m%d%H%M%S)"
pass=0; fail=0
ck(){ if [ "$2" = "1" ]; then echo "[PASS] $1 :: $3"; pass=$((pass+1)); else echo "[FAIL] $1 :: $3"; fail=$((fail+1)); fi; }

rm -rf "$T"; mkdir -p "$T/data" "$T/state"
printf '{"meta":{"revision":7,"name":"CURRENT"},"identities":["a"],"tasks":[],"marker":"CURRENT-STATE"}\n' > "$T/data/wbs.json"
printf '{"meta":{"revision":3,"name":"PREVIOUS"},"identities":["a"],"tasks":[],"marker":"BACKUP-STATE"}\n' > "$T/data/wbs.json.$TS.bak"
cat > "$T/state/previous.env" <<EOF
PREV_IMAGE=$IMG
PREV_IMAGE_ID=sha256:053180d90df237c78104bc5b970d2366ed2d25bb96cd4c94da5f1161595f5296
NEW_IMAGE=wbs-rongcheng:20261014135531
DATA_BAK=$T/data/wbs.json.$TS.bak
BIND_HOST=127.0.0.1
HOST_PORT=4181
EOF
echo "--- 隔离前置 ---"
echo "data/wbs.json      = $(cat "$T/data/wbs.json")"
echo "data/.bak          = $(cat "$T/data/wbs.json.$TS.bak")"
echo "state/previous.env : PREV_IMAGE=$IMG DATA_BAK=...HOST_PORT=4181"

echo "--- 执行交付脚本 deploy/rollback.sh（APP_DIR/CONTAINER_NAME/HOST_PORT 覆盖为隔离值）---"
APP_DIR="$T" CONTAINER_NAME="wbs-rongcheng-qv-rb" HOST_PORT=4181 BIND_HOST=127.0.0.1 \
  bash /opt/wbs-rongcheng/deploy/rollback.sh 2>&1 | tee "$T/rollback.out"
rc=${PIPESTATUS[0]}
echo "rollback.sh 退出码=$rc"

health=$(curl -s -m 5 http://127.0.0.1:4181/api/health || true)
echo "4181/api/health = $health"
cur=$(cat "$T/data/wbs.json")
img=$(docker inspect -f '{{.Config.Image}}' wbs-rongcheng-qv-rb 2>/dev/null || true)
rbak=$(ls "$T"/data/*.rollback.bak 2>/dev/null | head -1)
echo "容器镜像=$img"
echo "回滚后 data/wbs.json = $cur"
echo "回滚前数据另存 = ${rbak:-无}"

[ "$rc" = "0" ] && ck "RB1" 1 "rollback.sh 退出码 0（自检 health 通过）" || ck "RB1" 0 "退出码 $rc"
case "$health" in *'"ok":true'*) ck "RB2" 1 "回滚容器在隔离端口 4181 健康" ;; *) ck "RB2" 0 "health=$health" ;; esac
case "$cur" in *BACKUP-STATE*) ck "RB3" 1 "回滚恢复上一 data 备份（BACKUP-STATE）" ;; *) ck "RB3" 0 "当前=$cur" ;; esac
[ "$img" = "$IMG" ] && ck "RB4" 1 "回滚容器使用 PREV_IMAGE（$IMG）" || ck "RB4" 0 "img=$img"
if [ -n "$rbak" ] && grep -q CURRENT-STATE "$rbak"; then ck "RB5" 1 "回滚前把当前数据另存为 *.rollback.bak"; else ck "RB5" 0 "rbak=${rbak:-无}"; fi
case "$(cat "$T/rollback.out")" in *"健康检查通过"*) ck "RB6" 1 "脚本输出包含健康检查通过" ;; *) ck "RB6" 0 "输出片段=$(head -c 200 "$T/rollback.out")" ;; esac

echo "--- 清理隔离容器 ---"
docker rm -f wbs-rongcheng-qv-rb >/dev/null 2>&1
docker ps -a --format '{{.Names}}' | grep -q wbs-rongcheng-qv-rb && ck "RB7" 0 "隔离容器未清理" || ck "RB7" 1 "隔离容器已清理，现场容器未受影响"
live=$(curl -s -m 5 http://127.0.0.1:4180/api/health || true)
case "$live" in *'"ok":true'*) ck "RB8" 1 "现场 4180 服务未受影响：$live" ;; *) ck "RB8" 0 "现场服务异常 $live" ;; esac
echo "== rollback 汇总: pass=$pass fail=$fail =="
exit $(( fail > 0 ))
