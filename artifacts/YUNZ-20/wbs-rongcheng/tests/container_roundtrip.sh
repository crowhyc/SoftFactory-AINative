#!/usr/bin/env bash
# 容器内保存往返自测（用 curl 访问已部署容器；node 仅用于本地 JSON 解析，不做网络请求）。
set -uo pipefail
APP_DIR="${APP_DIR:-/opt/wbs-rongcheng}"
PORT="${HOST_PORT:-4180}"
BASE="http://127.0.0.1:$PORT"
DATA_FILE="$APP_DIR/data/wbs.json"
TMP="${TMP_DIR:-$APP_DIR/tests/.tmp}"
mkdir -p "$TMP"
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "PASS  $1${2:+  :: $2}"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL  $1  -> $2"; }
json() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(eval('j.'+process.argv[1]))})" "$1"; }

health=$(curl -fsS "$BASE/api/health" 2>/dev/null) || health=""
if [ -n "$health" ]; then ok "容器内 GET /api/health" "$health"; else bad "容器内健康检查失败" "curl $BASE/api/health 无响应"; fi

for asset in / /app.js /styles.css /template.xlsx /vendor/xlsx.full.min.js; do
  code=$(curl -s -o /dev/null -w '%{http_code} %{size_download}' "$BASE$asset")
  set -- $code
  if [ "$1" = "200" ] && [ "$2" -gt 1000 ]; then ok "容器内静态资源 $asset" "$code bytes"; else bad "容器内静态资源 $asset" "HTTP $1，$2 bytes"; fi
done
csp=$(curl -sD - -o /dev/null "$BASE/" | grep -i '^content-security-policy:' | tr -d '\r')
case "$csp" in *"default-src 'self'"*) ok "容器内下发同源 CSP" "$(echo "$csp" | cut -d' ' -f2)";; *) bad "CSP 缺失或异常" "$csp";; esac

curl -fsS "$BASE/api/wbs" -o "$TMP/container-before.json" || bad "读取 /api/wbs 失败" "curl error"
rows=$(json 'tasks.length' < "$TMP/container-before.json")
rev=$(json 'meta.revision' < "$TMP/container-before.json")
if [ "$rows" = "36" ]; then ok "容器内 GET /api/wbs 返回 36 行" "revision $rev"; else bad "行数异常" "$rows"; fi

NOTE="容器自测 $(date -Iseconds)"
node -e "
const fs=require('fs');
const doc=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
doc.tasks[0]=Object.assign({},doc.tasks[0],{note:process.argv[2],status:'进行中'});
fs.writeFileSync(process.argv[3],JSON.stringify({meta:{name:doc.meta.name},identities:doc.identities,tasks:doc.tasks}));
" "$TMP/container-before.json" "$NOTE" "$TMP/container-put.json"

put_code=$(curl -s -o "$TMP/container-put-resp.json" -w '%{http_code}' -X PUT "$BASE/api/wbs" \
  -H 'Content-Type: application/json' -H "If-Match: $rev" -H 'X-Identity: %E9%A1%B9%E7%9B%AE%E8%B4%9F%E8%B4%A3%E4%BA%BA' \
  --data-binary "@$TMP/container-put.json")
if [ "$put_code" = "200" ] && grep -q '"ok":true' "$TMP/container-put-resp.json"; then
  ok "容器内 PUT /api/wbs（If-Match=$rev）" "$(cat "$TMP/container-put-resp.json")"
else
  bad "容器内保存失败" "HTTP $put_code $(cat "$TMP/container-put-resp.json")"
fi

curl -fsS "$BASE/api/wbs" -o "$TMP/container-after.json"
node -e "
const fs=require('fs');
const api=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
const disk=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const note=process.argv[3];
const a=api.tasks[0], d=disk.tasks[0];
const good = a.note===note && d.note===note && d.status==='进行中' && api.meta.revision===disk.meta.revision;
console.log((good?'PASS  ':'FAIL  ')+'容器内保存后 API 与挂载磁盘一致（三端一致）  :: revision '+api.meta.revision+'，磁盘 '+process.argv[2]+'，note='+d.note);
process.exit(good?0:1);
" "$TMP/container-after.json" "$DATA_FILE" "$NOTE" || FAIL=$((FAIL+1))

stale_code=$(curl -s -o "$TMP/container-stale.json" -w '%{http_code}' -X PUT "$BASE/api/wbs" \
  -H 'Content-Type: application/json' -H "If-Match: $rev" -H 'X-Identity: %E9%A1%B9%E7%9B%AE%E8%B4%9F%E8%B4%A3%E4%BA%BA' \
  --data-binary "@$TMP/container-put.json")
if [ "$stale_code" = "409" ] && grep -q '"reason":"conflict"' "$TMP/container-stale.json"; then
  ok "容器内过期版本收到 409 conflict" "$(cat "$TMP/container-stale.json")"
else
  bad "容器内 409 行为异常" "HTTP $stale_code $(cat "$TMP/container-stale.json")"
fi

echo "---"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
