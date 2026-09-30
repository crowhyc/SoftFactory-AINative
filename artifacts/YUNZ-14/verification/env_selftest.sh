#!/usr/bin/env bash
# YUNZ-14 独立复验：环境与 --selftest 退出码语义（E2-E4）。
# 全程在临时目录内运行，不触碰被验证目录内任何文件。
# 用法：env_selftest.sh <app.py> <index.html>
set -u
APP="${1:?usage: env_selftest.sh <app.py> <index.html>}"
INDEX="${2:?usage: env_selftest.sh <app.py> <index.html>}"

TMP="$(mktemp -d)"
mkdir -p "$TMP/ok" "$TMP/broken"
cp "$APP" "$TMP/ok/app.py"
cp "$INDEX" "$TMP/ok/index.html"
cp "$APP" "$TMP/broken/app.py"

echo "== E2: python3 -I -S app.py --selftest（禁用 site-packages，验证纯标准库与退出码 0）=="
( cd "$TMP/ok" && PYTHONIOENCODING=utf-8 python3 -I -S app.py --selftest >"$TMP/e2.log" 2>&1 )
E2=$?
tail -3 "$TMP/e2.log"
echo "E2 exit=$E2"

echo ""
echo "== E3: 默认启动（无参数 = 127.0.0.1:8000）+ 只读访问不改写数据文件 =="
( cd "$TMP/ok" && exec env PYTHONIOENCODING=utf-8 python3 app.py >"$TMP/ok-server.log" 2>&1 ) &
SERVER_PID=$!
READY=no
for _i in $(seq 1 120); do
  if curl -s -o /dev/null http://127.0.0.1:8000/api/health; then READY=yes; break; fi
  sleep 0.05
done
echo "E3 健康检查就绪：$READY"
if [ "$READY" = yes ]; then
  BEFORE="$(sha256sum "$TMP/ok/data.json" 2>/dev/null | cut -d' ' -f1)"
  curl -s -o /dev/null -w "E3 GET / -> %{http_code} (%{content_type})\n" http://127.0.0.1:8000/
  curl -s -o /dev/null -w "E3 GET /api/items -> %{http_code}\n" http://127.0.0.1:8000/api/items
  curl -s -o /dev/null -w "E3 GET /api/summary -> %{http_code}\n" http://127.0.0.1:8000/api/summary
  AFTER="$(sha256sum "$TMP/ok/data.json" 2>/dev/null | cut -d' ' -f1)"
  echo "E3 data.json before='${BEFORE}' after='${AFTER}' (纯 GET 不建/不改档: $([ "$BEFORE" = "$AFTER" ] && echo yes || echo no))"
fi
kill "$SERVER_PID" 2>/dev/null
wait "$SERVER_PID" 2>/dev/null

echo ""
echo "== E4: --selftest FAIL 路径（复制 app.py 但移除 index.html）退出码语义 =="
( cd "$TMP/broken" && PYTHONIOENCODING=utf-8 python3 app.py --selftest >"$TMP/e4.log" 2>&1 )
E4=$?
tail -4 "$TMP/e4.log"
echo "E4 exit=$E4"

rm -rf "$TMP"
echo ""
echo "ENV_SELFTEST DONE"
