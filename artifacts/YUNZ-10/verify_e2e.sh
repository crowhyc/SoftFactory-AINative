#!/usr/bin/env bash
# 端到端复跑脚本（Stage 2 可直接运行）：
#   用 curl 打真实启动的 `python3 app.py`，核验 HTTP API 契约与「不覆盖 / 不丢失既有数据」。
#   全程只在 mktemp 临时目录里操作，不触碰随附的 data.json；结束时关闭服务并清理临时目录。
#
# 用法： bash verify_e2e.sh    （退出码 0 = 全部通过，非 0 = 有失败）
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d /tmp/inventory-e2e-XXXXXX)"
PRESET="$WORK/preset.json"
BODY="$WORK/body.json"
SERVER_PID=""
PASS=0
FAIL=0

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

ok()  { PASS=$((PASS + 1)); printf 'PASS  %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf 'FAIL  %s  -> %s\n' "$1" "${2:-}"; }

# 断言工具
expect_eq() {  # expect_eq <label> <期望> <实际>
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "期望 [$2]，实际 [$3]"; fi
}
expect_true() {  # expect_true <label> <0|1>
  if [ "$2" = "1" ]; then ok "$1"; else bad "$1" "条件不成立：$2"; fi
}

# 读 JSON 的小工具（显式 UTF-8，C locale 下也不会乱码）
cat > "$WORK/jsonq.py" << 'PYEOF'
import io, json, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

def load(path):
    with io.open(path, encoding="utf-8") as handle:
        return json.load(handle)

command = sys.argv[1]
if command == "count":
    print(len(load(sys.argv[2])["items"]))
elif command == "field":
    value = load(sys.argv[2])
    for key in sys.argv[3].split("."):
        value = value[key]
    print(value)
elif command == "has_error":
    print(1 if "error" in load(sys.argv[2]) else 0)
elif command == "keys_ok":
    item = load(sys.argv[2])
    print(1 if sorted(item.keys()) == sorted(["id", "name", "category", "quantity"]) else 0)
elif command == "summary_map":
    data = load(sys.argv[2])
    print(json.dumps(dict((e["category"], e["total_quantity"]) for e in data["summary"]),
                     ensure_ascii=False, sort_keys=True, separators=(", ", ": ")))
else:
    raise SystemExit("unknown command: %s" % command)
PYEOF
JQ() { python3 "$WORK/jsonq.py" "$@"; }

PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
BASE="http://127.0.0.1:$PORT"

# 预置数据：既有条目 + 条目上的额外字段 + 未知顶层键
cat > "$PRESET" << 'JSONEOF'
{
  "items": [
    {"id": "keep-1", "name": "既有物品A", "category": "工具", "quantity": 4, "manual_note": "人工备注，不能被抹掉"},
    {"id": "keep-2", "name": "既有物品B", "category": "食品", "quantity": 6}
  ],
  "schema_version": 3,
  "custom_top_level": {"anything": [1, 2, 3]}
}
JSONEOF

printf '== 启动服务：python3 app.py --host 127.0.0.1 --port %s --data %s\n' "$PORT" "$PRESET"
python3 "$DIR/app.py" --host 127.0.0.1 --port "$PORT" --data "$PRESET" > "$WORK/server.log" 2>&1 &
SERVER_PID=$!

ready=0
for _ in $(seq 1 100); do
  if curl -sS -o /dev/null "$BASE/api/health" 2>/dev/null; then ready=1; break; fi
  sleep 0.1
done
if [ "$ready" != "1" ]; then
  echo "FAIL  服务未就绪，server.log："
  cat "$WORK/server.log"
  exit 1
fi
ok "服务在空闲端口启动，GET /api/health 可用"

# req <method> <path> [json body] -> 响应码写入全局 STATUS，响应体写入 $BODY
req() {
  local method="$1" path="$2" data="${3:-}"
  if [ "$#" -ge 3 ]; then
    STATUS="$(curl -sS -o "$BODY" -w '%{http_code}' -X "$method" -H 'Content-Type: application/json' --data "$data" "$BASE$path")"
  else
    STATUS="$(curl -sS -o "$BODY" -w '%{http_code}' -X "$method" "$BASE$path")"
  fi
}

# ------------------------------------------------------- 页面与预置数据
req GET "/"
expect_eq "GET / 返回 200" "200" "$STATUS"
if grep -qi '<html' "$BODY" && grep -q '/api/items' "$BODY"; then
  ok "GET / 返回单页 HTML 且引用 /api/items"
else
  bad "GET / 返回单页 HTML 且引用 /api/items" "响应体不是预期页面"
fi

req GET "/api/items"
expect_eq "GET /api/items 返回 200" "200" "$STATUS"
expect_eq "预置的 2 条既有条目原样可读" "2" "$(JQ count "$BODY")"
req GET "/api/items/keep-1"
expect_eq "既有条目字段为 id/name/category/quantity" "1" "$(JQ keys_ok "$BODY")"

# ------------------------------------------------------- 增
req POST "/api/items" '{"name":"新增C","category":"工具","quantity":2}'
expect_eq "POST /api/items 返回 201" "201" "$STATUS"
NEW_ID="$(JQ field "$BODY" id)"
expect_true "POST 返回体含新物品 id" "$([ -n "$NEW_ID" ] && echo 1 || echo 0)"
req GET "/api/items"
expect_eq "新增后共 3 条" "3" "$(JQ count "$BODY")"

# ------------------------------------------------------- 改
req PUT "/api/items/keep-1" '{"quantity":9,"name":"既有物品A(改)"}'
expect_eq "PUT 既有条目返回 200" "200" "$STATUS"
req GET "/api/items/keep-1"
expect_eq "PUT 后 quantity 变为 9" "9" "$(JQ field "$BODY" quantity)"
expect_eq "PUT 后 name 变为 既有物品A(改)" "既有物品A(改)" "$(JQ field "$BODY" name)"
expect_eq "PUT 未传的 category 未被改动" "工具" "$(JQ field "$BODY" category)"

# ------------------------------------------------------- 汇总
req GET "/api/summary"
expect_eq "GET /api/summary 返回 200" "200" "$STATUS"
expect_eq "按类别汇总正确（工具 9+2，食品 6）" '{"工具": 11, "食品": 6}' "$(JQ summary_map "$BODY")"

# ------------------------------------------------------- 删
req DELETE "/api/items/keep-2"
expect_eq "DELETE 既有条目返回 200" "200" "$STATUS"
req GET "/api/items/keep-2"
expect_eq "删除后该 id 返回 404" "404" "$STATUS"
req DELETE "/api/items/不存在的id"
expect_eq "删除不存在的 id 返回 404" "404" "$STATUS"
req GET "/api/items"
expect_eq "删除后共 2 条" "2" "$(JQ count "$BODY")"

# ------------------------------------------------------- 非法输入
req POST "/api/items" '{"name":"x","category":"y","quantity":-1}'
expect_eq "quantity 为负数返回 400" "400" "$STATUS"
expect_eq "400 响应体含 error 字段" "1" "$(JQ has_error "$BODY")"
req POST "/api/items" '{"name":"x","category":"y","quantity":"abc"}'
expect_eq "quantity 非数字返回 400" "400" "$STATUS"
req POST "/api/items" '{"name":"x"}'
expect_eq "缺字段返回 400" "400" "$STATUS"
req PUT "/api/items/keep-1" '{}'
expect_eq "PUT 无有效字段返回 400" "400" "$STATUS"
req PATCH "/api/items" '{}'
expect_eq "不支持的方法返回 405" "405" "$STATUS"
req GET "/api/nope"
expect_eq "未知 /api 路径返回 404" "404" "$STATUS"

# ------------------------------------------------------- 文件级：不覆盖 / 不丢失
cat > "$WORK/file_assert.py" << 'PYEOF'
import io, json, os, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

preset_path, work_dir = sys.argv[1], sys.argv[2]
with io.open(preset_path, encoding="utf-8") as handle:
    doc = json.load(handle)
problems = []

if doc.get("schema_version") != 3:
    problems.append("未知顶层键 schema_version 丢失：%r" % (doc.get("schema_version"),))
if doc.get("custom_top_level") != {"anything": [1, 2, 3]}:
    problems.append("未知顶层键 custom_top_level 被改动：%r" % (doc.get("custom_top_level"),))

by_id = dict((item.get("id"), item) for item in doc["items"] if isinstance(item, dict))
if "keep-1" not in by_id:
    problems.append("既有条目 keep-1 丢失")
else:
    keep1 = by_id["keep-1"]
    if keep1.get("quantity") != 9 or keep1.get("name") != "既有物品A(改)":
        problems.append("keep-1 的更新没有落到文件：%r" % (keep1,))
    if keep1.get("manual_note") != "人工备注，不能被抹掉":
        problems.append("keep-1 的额外字段被抹掉：%r" % (keep1,))
if "keep-2" in by_id:
    problems.append("已删除的 keep-2 仍在文件中")
if len(by_id) != 2:
    problems.append("文件中的条目集合不符：%r" % (sorted(by_id),))

leftovers = [name for name in os.listdir(work_dir) if name.startswith(".data-")]
if leftovers:
    problems.append("写临时文件有残留：%r" % (leftovers,))

if problems:
    print("；".join(problems))
    sys.exit(1)
print("ok")
PYEOF
if out="$(python3 "$WORK/file_assert.py" "$PRESET" "$WORK" 2>&1)"; then
  ok "文件级核验：既有条目 / 额外字段 / 未知顶层键全部保留，无临时文件残留"
else
  bad "文件级核验：既有条目 / 额外字段 / 未知顶层键全部保留，无临时文件残留" "$out"
fi

# ------------------------------------------------------- 随附样例数据
if out="$(python3 -c '
import io, json, sys
with io.open(sys.argv[1], encoding="utf-8") as handle:
    doc = json.load(handle)
items = doc["items"]
assert len(items) == 4, len(items)
for item in items:
    for field in ("id", "name", "category", "quantity"):
        assert field in item, (field, item)
' "$DIR/data.json" 2>&1)"; then
  ok "随附 data.json 是合法 JSON 且 4 条样例条目字段完整"
else
  bad "随附 data.json 是合法 JSON 且 4 条样例条目字段完整" "$out"
fi

printf 'E2E %d/%d PASSED\n' "$PASS" "$((PASS + FAIL))"
[ "$FAIL" -eq 0 ]
