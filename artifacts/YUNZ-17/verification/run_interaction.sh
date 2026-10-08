#!/usr/bin/env bash
set -u
PWDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ART=/opt/SoftFactory-AINative/artifacts/YUNZ-10
PORT="${PORT:-8791}"
CASE="$PWDIR/domcase"
rm -rf "$CASE"; mkdir -p "$CASE"
cat > "$CASE/data.json" <<'JSON'
{
  "items": [
    {"id":"dom-01","name":"牛奶","category":"食品","quantity":3,"extra_note":"勿删我"},
    {"id":"dom-02","name":"面包","category":"食品","quantity":2},
    {"id":"dom-03","name":"电池","category":"用品","quantity":5}
  ],
  "schema_version": 42,
  "note": "未知顶层键必须保留-DOM"
}
JSON
python3 "$ART/app.py" --host 0.0.0.0 --port "$PORT" --data "$CASE/data.json" > "$CASE/server.log" 2>&1 &
SPID=$!
trap 'kill $SPID 2>/dev/null; wait $SPID 2>/dev/null' EXIT
sleep 1.5
echo "== server.log =="; cat "$CASE/server.log"
node "$PWDIR/interaction_verify.mjs" "http://172.18.0.1:$PORT" "$CASE/data.json" "$CASE/dom-snapshot-after-interactions.html"
RC=$?
echo "== final on-disk data.json =="; cat "$CASE/data.json"
echo "== OBSERVED RESIDUAL PROCESSES (not started by this run) =="
ps -eo pid,ppid,cmd | grep -E "app\.py" | grep -v grep || echo "(none)"
exit $RC
