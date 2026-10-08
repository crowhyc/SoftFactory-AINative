#!/usr/bin/env bash
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$1"                 # app.py 路径
PORT="${PORT:-8892}"
GW="${GW:-172.18.0.1}"
rm -rf "$HERE/domcase"; mkdir -p "$HERE/domcase"
cp "$HERE/data.json" "$HERE/domcase/data.json"
python3 "$APP" --host 0.0.0.0 --port "$PORT" --data "$HERE/domcase/data.json" > "$HERE/domcase/server.log" 2>&1 &
SPID=$!
trap 'kill $SPID 2>/dev/null; wait $SPID 2>/dev/null' EXIT
sleep 1.5
echo "== server.log =="; cat "$HERE/domcase/server.log"
node "$HERE/interaction_verify.mjs" "http://$GW:$PORT" "$HERE/domcase/data.json" "$HERE/domcase/dom-snapshot.html"
RC=$?
echo "== final on-disk data.json =="; cat "$HERE/domcase/data.json"
echo "== residual app.py processes not started by this run =="
ps -eo pid,ppid,cmd | grep -E "app\.py" | grep -v grep | grep -v "$SPID" || echo "(none)"
exit $RC
