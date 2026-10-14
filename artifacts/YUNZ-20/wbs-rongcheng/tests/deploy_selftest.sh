#!/usr/bin/env bash
# WC-001 容器部署/回滚自测（附加项 19/20/16b/21）。
# 用法：bash tests/deploy_selftest.sh {build|roundtrip|restart|rollback}
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/wbs-rongcheng}"
CONTAINER="${CONTAINER_NAME:-wbs-rongcheng}"
PORT="${HOST_PORT:-4180}"
BASE="http://127.0.0.1:$PORT"
STATE_DIR="$APP_DIR/state"
STEP="${1:-build}"

wait_health() {
  local i
  for i in $(seq 1 30); do
    if curl -fsS "$BASE/api/health" 2>/dev/null | grep -q '"ok":true'; then return 0; fi
    sleep 1
  done
  return 1
}

case "$STEP" in
  build)
    echo "--- docker build --network none（构建期无网络） ---"
    docker build --network none -t wbs-rongcheng:selftest-build "$APP_DIR" || { echo "FAIL  构建失败"; echo "PASS=0 FAIL=1"; exit 1; }
    echo "PASS  docker build --network none 成功（构建期不能回外网）"
    echo "--- deploy/deploy.sh ---"
    bash "$APP_DIR/deploy/deploy.sh" || { echo "FAIL  deploy.sh 失败"; echo "PASS=0 FAIL=1"; exit 1; }
    wait_health || { echo "FAIL  /api/health 未通过"; echo "PASS=0 FAIL=1"; exit 1; }
    echo "PASS  deploy.sh 自检通过：$(curl -fsS "$BASE/api/health")"
    echo "--- 回环绑定与挂载 ---"
    docker inspect -f '  Image={{.Config.Image}}  NetworkMode={{.HostConfig.NetworkMode}}  Mounts={{range .Mounts}}{{.Source}}->{{.Destination}} {{end}} RestartPolicy={{.HostConfig.RestartPolicy.Name}}' "$CONTAINER"
    echo "--- 容器内监听套接字（应只有 127.0.0.1:4180，无 0.0.0.0） ---"
    docker exec "$CONTAINER" node -e "
const fs=require('fs');
const lines=fs.readFileSync('/proc/net/tcp','utf8').trim().split('\n').slice(1);
const rows=lines.map(l=>l.trim().split(/\s+/)).filter(r=>parseInt(r[1].split(':')[1],16)===4180);
// 只看 LISTEN（0A）：本机回环上的短连接会留下 TIME-WAIT(06) 等同端口记录，不是监听。
const listen=rows.filter(r=>r[3]==='0A');
console.log('  端口 4180 全部记录：'+JSON.stringify(rows.map(r=>({local:r[1],state:r[3]}))));
console.log('  容器内监听（state=0A）：'+JSON.stringify(listen.map(r=>r[1])));
const addr=listen.map(r=>r[1].split(':')[0]);
process.exit(listen.length>0 && addr.every(a=>a==='0100007F') ? 0 : 1);
" || { echo "FAIL  容器未仅绑定回环 127.0.0.1:$PORT"; echo "PASS=0 FAIL=1"; exit 1; }
    if ss -ltn 2>/dev/null | grep -E "0\.0\.0\.0:$PORT|\*:$PORT|\[::\]:$PORT" >/dev/null; then
      echo "FAIL  宿主上存在非回环监听 :$PORT"; echo "PASS=0 FAIL=1"; exit 1
    fi
    echo "PASS  仅监听回环 127.0.0.1:$PORT（容器进程绑定回环 + host 网络，未对公网暴露）"
    run_image=$(docker inspect -f '{{.Config.Image}}' "$CONTAINER")
    data_mount=$(docker inspect -f '{{range .Mounts}}{{.Source}}{{end}}' "$CONTAINER")
    if [ "$data_mount" = "$APP_DIR/data" ]; then echo "PASS  运行数据挂载 $data_mount"; else echo "FAIL  挂载异常：$data_mount"; echo "PASS=0 FAIL=1"; exit 1; fi
    echo "PASS  当前镜像 $run_image（state/previous.env 记录上一镜像用于回滚）"
    echo "---"
    echo "PASS=5 FAIL=0"
    ;;
  roundtrip)
    bash "$APP_DIR/tests/container_roundtrip.sh" || exit 1
    ;;
  restart)
    before_rev=$(curl -fsS "$BASE/api/wbs" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.meta.revision+' '+j.tasks.length+' '+j.tasks[0].note)})")
    docker restart "$CONTAINER" >/dev/null || { echo "FAIL  容器重启失败"; echo "PASS=0 FAIL=1"; exit 1; }
    wait_health || { echo "FAIL  重启后 health 未通过"; echo "PASS=0 FAIL=1"; exit 1; }
    after=$(curl -fsS "$BASE/api/wbs" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.meta.revision+' '+j.tasks.length+' '+j.tasks[0].note)})")
    echo "重启前：$before_rev"
    echo "重启后：$after"
    if [ "$before_rev" = "$after" ]; then
      echo "PASS  docker restart 后 revision/行数/内容完全一致（数据卷持久）"
      echo "PASS  docker restart 后 /api/health 通过"
      echo "---"; echo "PASS=2 FAIL=0"
    else
      echo "FAIL  重启后数据变化"; echo "---"; echo "PASS=0 FAIL=1"; exit 1
    fi
    ;;
  rollback)
    echo "--- 准备：第二次部署（记录上一镜像与 data 备份） ---"
    bash "$APP_DIR/deploy/deploy.sh" || { echo "FAIL  第二次 deploy 失败"; echo "PASS=0 FAIL=1"; exit 1; }
    wait_health || { echo "FAIL  health 未通过"; echo "PASS=0 FAIL=1"; exit 1; }
    # shellcheck disable=SC1090
    . "$STATE_DIR/previous.env"
    echo "state/previous.env: PREV_IMAGE=${PREV_IMAGE:-} DATA_BAK=${DATA_BAK:-}"
    [ -n "${PREV_IMAGE:-}" ] || { echo "FAIL  未记录上一镜像"; echo "PASS=0 FAIL=1"; exit 1; }
    echo "PASS  deploy.sh 生成当前镜像名与 data/wbs.json 时间戳备份：$DATA_BAK"
    [ -f "$DATA_BAK" ] || { echo "FAIL  备份文件不存在"; echo "PASS=0 FAIL=1"; exit 1; }
    echo "PASS  备份文件存在：$DATA_BAK"
    echo "--- 回滚（先停容器 -> 恢复上一 data -> 上一镜像起容器 -> health） ---"
    bash "$APP_DIR/deploy/rollback.sh" || { echo "FAIL  rollback.sh 失败"; echo "PASS=0 FAIL=1"; exit 1; }
    wait_health || { echo "FAIL  回滚后 health 未通过"; echo "PASS=0 FAIL=1"; exit 1; }
    now_image=$(docker inspect -f '{{.Config.Image}}' "$CONTAINER")
    echo "回滚后容器镜像：$now_image（期望 $PREV_IMAGE）"
    if [ "$now_image" = "$PREV_IMAGE" ]; then echo "PASS  rollback.sh 恢复上一镜像"; else echo "FAIL  镜像未恢复"; echo "PASS=0 FAIL=1"; exit 1; fi
    if [ "$(sha256sum "$APP_DIR/data/wbs.json" | cut -d' ' -f1)" = "$(sha256sum "$DATA_BAK" | cut -d' ' -f1)" ]; then
      echo "PASS  rollback.sh 恢复上一 data/wbs.json 备份（sha256 一致）"
    else
      echo "FAIL  data 未恢复"; echo "PASS=0 FAIL=1"; exit 1
    fi
    echo "--- 收尾：重新部署最新镜像并把数据重置为 seed 初始态 ---"
    bash "$APP_DIR/deploy/deploy.sh" || { echo "FAIL  收尾部署失败"; echo "PASS=0 FAIL=1"; exit 1; }
    wait_health || { echo "FAIL  收尾 health 未通过"; echo "PASS=0 FAIL=1"; exit 1; }
    rm -f "$APP_DIR/data/wbs.json"
    curl -fsS "$BASE/api/wbs" >/dev/null
    final=$(curl -fsS "$BASE/api/wbs" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.meta.revision+' '+j.tasks.length)})")
    if [ "$final" = "0 36" ]; then
      echo "PASS  交付态：容器运行中，data/wbs.json 由 wbs.seed.json 初始化为 36 行 revision 0"
    else
      echo "FAIL  交付态异常：$final"; echo "PASS=0 FAIL=1"; exit 1
    fi
    echo "---"; echo "PASS=5 FAIL=0"
    ;;
  *)
    echo "用法：bash tests/deploy_selftest.sh {build|roundtrip|restart|rollback}" >&2
    exit 2
    ;;
esac
