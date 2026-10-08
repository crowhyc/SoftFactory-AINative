#!/usr/bin/env bash
set -u
WD=/opt/SoftFactory-AINative/.multica-workspaces/yunzhidian-f03e0d551ffa/yunz-18-68cd224cda87/workdir
ART=/opt/SoftFactory-AINative/artifacts/YUNZ-10
PORT="${PORT:-8816}"
CASE="$WD/selftest/domcase"
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
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://172.18.0.1:$PORT/api/health" || true)
  [ "$code" = "200" ] && break
  sleep 0.25
done
echo "curl_health=$code"
cat "$CASE/server.log"
node "$WD/selftest/interaction_fix_verify.mjs" "http://172.18.0.1:$PORT" "$CASE/data.json"
RC=$?
echo "== final on-disk data.json =="; cat "$CASE/data.json"
echo "== residual app.py processes (not started by this run) =="
ps -eo pid,ppid,cmd | grep -E "app\.py" | grep -v grep || echo "(none)"
exit $RC
