#!/bin/bash
# YUNZ-12 独立验证：--selftest 退出码语义 / 纯标准库 / 默认启动 / 多进程并发
ART=/opt/SoftFactory-AINative/artifacts/YUNZ-10
set -u
echo "== 运行时间(UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ) =="
echo "== python3: $(python3 --version 2>&1) =="

echo; echo "=== [E1] 交付物 sha256 与 SHA256SUMS 比对 ==="
cd "$ART" && sha256sum -c SHA256SUMS; echo "E1_exit=$?"

echo; echo "=== [E2] import 扫描：app.py 顶层 import 全量 ==="
grep -nE '^[[:space:]]*(import|from)[[:space:]]' app.py

echo; echo "=== [E3] app.py 第三方/外部资源扫描（应无命中）==="
grep -nEi '\b(pip|install|requests|flask|django|numpy|pandas|pytest|venv|virtualenv)\b' app.py || echo "(no hits)"
grep -nEo 'https?://[^"'"'"' ]+' app.py || echo "(no external URL in app.py)"
grep -nEo 'https?://[^"'"'"' ]+' index.html || echo "(no external URL in index.html)"

echo; echo "=== [E4] 默认 data.json 前置 sha256 ==="
sha256sum "$ART/data.json"

echo; echo "=== [E5] 复跑 --selftest（工作副本，非交付目录）==="
WORK=$(mktemp -d /tmp/yq-selftest-XXXXXX)
cp "$ART/app.py" "$ART/index.html" "$ART/data.json" "$WORK/"
cd "$WORK"
PYTHONIOENCODING=utf-8 python3 app.py --selftest > selftest_rerun.txt 2>selftest_rerun.err
echo "E5_exit=$?"
grep -E '(PASS|FAIL|SELFTEST)' selftest_rerun.txt | tail -6
echo "FAIL 行数: $(grep -c '^FAIL' selftest_rerun.txt)"
echo "交付目录 data.json 在自测后是否未被改动:"
sha256sum -c <(cd "$ART" && sha256sum data.json) && echo "  (未改动)"

echo; echo "=== [E6] FAIL 路径退出码（复制 app.py 但移除 index.html，不改原实现）==="
WORK2=$(mktemp -d /tmp/yq-selftest-fail-XXXXXX)
cp "$ART/app.py" "$WORK2/"
cd "$WORK2"
PYTHONIOENCODING=utf-8 python3 app.py --selftest > fail_run.txt 2>fail_run.err
echo "E6_exit=$?（期望非 0）"
grep -E '^(FAIL|SELFTEST)' fail_run.txt | head -8
echo "FAIL 行数: $(grep -c '^FAIL' fail_run.txt)"

echo; echo "=== [E7] 隔离模式 -I -S（无 site-packages/无用户 site）复跑 --selftest ==="
cd "$ART"
PYTHONIOENCODING=utf-8 python3 -I -S app.py --selftest > /tmp/yq-iso.out 2>/dev/null
echo "E7_exit=$?"
tail -1 /tmp/yq-iso.out

echo; echo "=== [E8] 默认启动 python3 app.py（127.0.0.1:8000）==="
cd "$ART"
BEFORE_DEFAULT=$(sha256sum data.json | cut -d' ' -f1)
if (exec 3<>/dev/tcp/127.0.0.1/8000) 2>/dev/null; then echo "端口 8000 被占用，跳过 E8"; else
  PYTHONIOENCODING=utf-8 python3 app.py > /tmp/yq-default.out 2>/tmp/yq-default.err &
  SRV=$!
  for i in $(seq 1 60); do curl -sf http://127.0.0.1:8000/api/health >/dev/null 2>&1 && break; sleep 0.25; done
  echo "GET / -> $(curl -s -o /dev/null -w '%{http_code} %{content_type}' http://127.0.0.1:8000/)"
  echo "GET /api/items -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/api/items)"
  echo "GET /api/summary -> $(curl -s http://127.0.0.1:8000/api/summary | tr -d '\n')"
  echo "启动横幅: $(head -2 /tmp/yq-default.out | tr '\n' '|')"
  kill -TERM $SRV 2>/dev/null; wait $SRV 2>/dev/null
  AFTER_DEFAULT=$(sha256sum data.json | cut -d' ' -f1)
  echo "只读访问后默认 data.json 是否改动: $([ "$BEFORE_DEFAULT" = "$AFTER_DEFAULT" ] && echo 未改动 || echo 已改动)"
fi

echo; echo "=== [E9] 多进程并发写同一数据文件（两个 app.py 实例）==="
MULTI=$(mktemp -d /tmp/yq-multi-XXXXXX)
python3 - "$MULTI/data.json" <<'PY'
import json,sys
json.dump({"items":[], "schema_version": 1, "keep": "me"}, open(sys.argv[1],"w"), ensure_ascii=False)
PY
P1=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
P2=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
cd "$ART"
PYTHONIOENCODING=utf-8 python3 app.py --port $P1 --data "$MULTI/data.json" >/dev/null 2>"$MULTI/s1.log" &
S1=$!
PYTHONIOENCODING=utf-8 python3 app.py --port $P2 --data "$MULTI/data.json" >/dev/null 2>"$MULTI/s2.log" &
S2=$!
for p in $P1 $P2; do for i in $(seq 1 60); do curl -sf http://127.0.0.1:$p/api/health >/dev/null && break; sleep 0.25; done; done
LOADPIDS=""
for p in $P1 $P2; do
  ( for i in $(seq 1 50); do curl -s -X POST http://127.0.0.1:$p/api/items -H 'Content-Type: application/json' \
      -d '{"name":"mp","category":"mp","quantity":1}' >/dev/null; done ) &
  LOADPIDS="$LOADPIDS $!"
done
for pid in $LOADPIDS; do wait "$pid"; done
echo "并发写完成"
kill -TERM $S1 $S2 2>/dev/null; wait $S1 $S2 2>/dev/null
python3 - "$MULTI/data.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
print("发起 POST 总数: 100（2 进程 x 50）")
print("文件中实际条目数: %d" % len(d["items"]))
print("丢失(未落盘)条目数: %d" % (100-len(d["items"])))
print("未知顶层键 keep 是否保留: %r" % (d.get("keep"),))
print("文件是否仍是合法 JSON: True")
PY
rm -rf "$MULTI" "$WORK" "$WORK2"
echo; echo "== 完成 =="
