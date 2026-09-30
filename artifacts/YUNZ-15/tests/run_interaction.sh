#!/usr/bin/env bash
# YUNZ-15 DOM 级回归 driver。
#
# 环境事实：本机 `node`/`npm` 是 docker 包装脚本（docker run -v "$PWD:$PWD" node:24-slim），
# 容器只挂载 $PWD，且镜像内无 python3。故：
#   1) 在宿主机用 python3 启动真实 app.py 服务（副本 + 临时数据文件，绝不触碰交付目录）；
#   2) 用 docker run --network host 在 node:24-slim 容器里跑 jsdom harness，直连宿主 127.0.0.1 服务。
#
# 用法：run_interaction.sh <workdir> <app.py> <index.html> [<out-dir>]
#   workdir 需已安装 jsdom（npm install jsdom@30.1.1）。
set -u
WD="${1:?usage: run_interaction.sh <workdir> <app.py> <index.html> [<out-dir>]}"
APP="${2:?usage: run_interaction.sh <workdir> <app.py> <index.html> [<out-dir>]}"
INDEX="${3:?usage: run_interaction.sh <workdir> <app.py> <index.html> [<out-dir>]}"
OUT="${4:-$WD/tmp/interaction-out}"
NODE_IMAGE="${NODE_IMAGE:-docker.m.daocloud.io/library/node:24-slim}"

RUN="$WD/tmp/interaction-run"
rm -rf "$RUN" "$OUT"; mkdir -p "$RUN" "$OUT"
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
  "note": "YUNZ-15 回归预置档"
}
JSON

PORT="$(python3 -c "import socket;s=socket.socket();s.bind(('127.0.0.1',0));print(s.getsockname()[1]);s.close()")"
echo "interaction server port = $PORT"

( cd "$RUN" && exec env PYTHONIOENCODING=utf-8 python3 app.py --host 127.0.0.1 --port "$PORT" --data "$RUN/data.json" ) >"$RUN/server.log" 2>&1 &
SERVER_PID=$!

READY=no
for _i in $(seq 1 200); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/api/health"; then READY=yes; break; fi
  sleep 0.05
done
echo "server ready = $READY"
if [ "$READY" != yes ]; then
  echo "server failed to start"; cat "$RUN/server.log"
  kill "$SERVER_PID" 2>/dev/null; exit 2
fi

docker run --rm --network host -v "$WD:$WD" -w "$WD" \
  -e JSDOM_BASE="$WD" \
  -e BASE_URL="http://127.0.0.1:$PORT" \
  -e DATA_PATH="$RUN/data.json" \
  -e DOM_SNAPSHOT="$OUT/dom-snapshot-after-interactions.html" \
  "$NODE_IMAGE" \
  node "$WD/tests/interaction_regression.mjs" 2>&1 | tee "$OUT/interaction_output.txt"
RC="${PIPESTATUS[0]}"

cp "$RUN/server.log" "$OUT/interaction_server.log" 2>/dev/null || true
cp "$RUN/data.json" "$OUT/data_after_interaction.json" 2>/dev/null || true

kill "$SERVER_PID" 2>/dev/null
wait "$SERVER_PID" 2>/dev/null
echo "INTERACTION_DRIVER_EXIT=$RC"
exit $RC
