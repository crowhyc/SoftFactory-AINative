#!/usr/bin/env bash
# YUNZ-14 交互级验证 driver。
# 环境事实：本机 `node`/`npm` 是 docker 包装脚本（docker run -v "$PWD:$PWD" node:24-slim ...），
# 容器只挂载 $PWD，且镜像内无 python3。故本脚本：
#   1) 在宿主机用 python3 启动真实 app.py 服务（数据文件在临时目录）；
#   2) 用 docker run --network host 在 node:24-slim 容器里跑 jsdom harness，直连宿主 127.0.0.1 服务。
# 用法：run_interactive.sh <workdir> <app.py> <index.html>
set -u
WD="${1:?usage: run_interactive.sh <workdir> <app.py> <index.html>}"
APP="${2:?usage: run_interactive.sh <workdir> <app.py> <index.html>}"
INDEX="${3:?usage: run_interactive.sh <workdir> <app.py> <index.html>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
RUN="$WD/tmp/interactive-run"

rm -rf "$RUN"; mkdir -p "$RUN"
cp "$APP" "$RUN/app.py"
cp "$INDEX" "$RUN/index.html"
cat > "$RUN/data.json" <<'JSON'
{
  "items": [
    { "id": "demo-0001", "name": "牛奶", "category": "食品", "quantity": 3, "manual_note": "保留我" },
    { "id": "demo-0002", "name": "扳手", "category": "工具", "quantity": 1 },
    { "id": "demo-0003", "name": "电池", "category": "用品", "quantity": 5 }
  ],
  "schema_version": 1,
  "note": "交互级验证预置档"
}
JSON

PORT="$(python3 -c "import socket;s=socket.socket();s.bind(('127.0.0.1',0));print(s.getsockname()[1]);s.close()")"
echo "interactive server port = $PORT"

( cd "$RUN" && exec env PYTHONIOENCODING=utf-8 python3 app.py --host 127.0.0.1 --port "$PORT" --data "$RUN/data.json" ) >"$RUN/server.log" 2>&1 &
SERVER_PID=$!

READY=no
for _i in $(seq 1 200); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/api/health"; then READY=yes; break; fi
  sleep 0.05
done
echo "server ready = $READY"
if [ "$READY" != yes ]; then
  echo "server failed to start"; cat "$RUN/server.log"; kill "$SERVER_PID" 2>/dev/null; exit 2
fi

cp "$HERE/interactive_verify.mjs" "$WD/_interactive_verify.mjs"
docker run --rm --network host -v "$WD:$WD" -w "$WD" \
  -e BASE_URL="http://127.0.0.1:$PORT" \
  -e DATA_PATH="$RUN/data.json" \
  -e DOM_SNAPSHOT="$RUN/dom-snapshot.html" \
  docker.m.daocloud.io/library/node:24-slim \
  node "$WD/_interactive_verify.mjs"
RC=$?

kill "$SERVER_PID" 2>/dev/null
wait "$SERVER_PID" 2>/dev/null
echo "INTERACTIVE_DRIVER_EXIT=$RC"
exit $RC
