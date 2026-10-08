# -*- coding: utf-8 -*-
# YUNZ-19 独立 API 回归（不复用作者/修复者脚本）。仅标准库。
import io, json, os, sys, socket, subprocess, tempfile, time, shutil, urllib.request, urllib.error

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
APP = os.environ["APP_PY"]
PASS = 0; FAIL = 0
def ok(m):
    global PASS; PASS += 1; print("PASS  " + m)
def bad(m, d=""):
    global FAIL; FAIL += 1; print("FAIL  " + m + "  -> " + d)
def eq(m, exp, got):
    if exp == got: ok(m)
    else: bad(m, "期望[%r] 实际[%r]" % (exp, got))

def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p

def call(base, method, path, body=None, raw=None):
    data = None; headers = {}
    if raw is not None:
        data = raw.encode("utf-8"); headers["Content-Type"] = "application/json"
    elif body is not None:
        data = json.dumps(body).encode("utf-8"); headers["Content-Type"] = "application/json"
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            txt = r.read().decode("utf-8")
            return r.status, (json.loads(txt) if txt else None), txt
    except urllib.error.HTTPError as e:
        txt = e.read().decode("utf-8")
        try: parsed = json.loads(txt)
        except Exception: parsed = None
        return e.code, parsed, txt

work = tempfile.mkdtemp(prefix="yunz19-api-")
preset_path = os.path.join(work, "preset.json")
preset = {
    "items": [
        {"id": "keep-1", "name": "牛奶", "category": "食品", "quantity": 3, "extra_note": "勿删我"},
        {"id": "keep-2", "name": "电池", "category": "用品", "quantity": 5},
        {"id": "keep-3", "name": "面包", "category": "食品", "quantity": 2},
    ],
    "schema_version": 42,
    "note": "未知顶层键必须保留-API",
    "custom_top": {"a": [1, 2, 3]},
}
with io.open(preset_path, "w", encoding="utf-8") as f:
    json.dump(preset, f, ensure_ascii=False, indent=2)

port = free_port()
base = "http://127.0.0.1:%d" % port
logf = io.open(os.path.join(work, "server.log"), "w", encoding="utf-8")
proc = subprocess.Popen([sys.executable, APP, "--host", "127.0.0.1", "--port", str(port), "--data", preset_path],
                        stdout=logf, stderr=subprocess.STDOUT)
try:
    deadline = time.time() + 15
    ready = False
    while time.time() < deadline:
        try:
            st, _, _ = call(base, "GET", "/api/health")
            if st == 200: ready = True; break
        except Exception:
            time.sleep(0.2)
    if not ready: bad("服务器启动", "健康检查超时"); raise SystemExit(2)

    def disk():
        with io.open(preset_path, encoding="utf-8") as f: return json.load(f)

    # --- 读取既有数据 ---
    st, b, _ = call(base, "GET", "/api/items"); eq("GET /api/items 200", 200, st)
    eq("既有条目 3 条可读", 3, len(b["items"]))
    eq("API 响应字段符合契约(4 字段)", ["category", "id", "name", "quantity"],
       sorted([i for i in b["items"] if i["id"] == "keep-1"][0].keys()))
    eq("磁盘既有额外字段 extra_note 保留", "勿删我", [i for i in disk()["items"] if i["id"] == "keep-1"][0].get("extra_note"))

    # --- 汇总正确性（多类别跨条目）---
    st, s, _ = call(base, "GET", "/api/summary"); eq("GET /api/summary 200", 200, st)
    sm = {e["category"]: e["total_quantity"] for e in s["summary"]}
    eq("汇总 食品=5(3+2)", 5, sm.get("食品"))
    eq("汇总 用品=5", 5, sm.get("用品"))

    # --- POST 201 ---
    st, c, _ = call(base, "POST", "/api/items", {"name": "酱油", "category": "调味", "quantity": 4})
    eq("POST /api/items 201", 201, st)
    eq("POST 返回新物品名", "酱油", c.get("name"))
    eq("POST 忽略请求体自带 id", None, None if c.get("id") != "forged-id" else "forged-id")
    new_id = c["id"]
    eq("POST 磁盘新增 4 条", 4, len(disk()["items"]))

    # --- GET 单条 ---
    st, g, _ = call(base, "GET", "/api/items/" + new_id); eq("GET 单条 200", 200, st); eq("GET 单条名称", "酱油", g.get("name"))
    st, _, _ = call(base, "GET", "/api/items/nope999"); eq("GET 不存在 id 404", 404, st)

    # --- PUT 部分更新 ---
    st, u, _ = call(base, "PUT", "/api/items/" + new_id, {"quantity": 9})
    eq("PUT 200", 200, st); eq("PUT 只改 quantity", 9, u.get("quantity")); eq("PUT 未牵连 name", "酱油", u.get("name"))
    st, u2, _ = call(base, "PUT", "/api/items/" + new_id, {"category": "酱料"})
    eq("PUT 改 category", "酱料", u2.get("category"))
    eq("PUT 后磁盘 category", "酱料", [i for i in disk()["items"] if i["id"] == new_id][0]["category"])
    st, _, _ = call(base, "PUT", "/api/items/missing-id", {"name": "x"}); eq("PUT 不存在 id 404", 404, st)

    # --- 非法输入 400 ---
    for label, body in [("缺字段", {"name": "x", "category": "y"}), ("空名称", {"name": " ", "category": "y", "quantity": 1}),
                        ("负数量", {"name": "x", "category": "y", "quantity": -1}),
                        ("小数数量", {"name": "x", "category": "y", "quantity": 1.5}),
                        ("非数字数量", {"name": "x", "category": "y", "quantity": "abc"})]:
        st, p, _ = call(base, "POST", "/api/items", body)
        eq("POST 非法输入 %s 400" % label, 400, st)
        eq("POST 非法输入 %s 错误体含 error" % label, True, isinstance(p, dict) and "error" in p)
    st, _, _ = call(base, "POST", "/api/items", raw="{not json"); eq("POST 非法 JSON 400", 400, st)
    st, _, _ = call(base, "PUT", "/api/items/" + new_id, {}); eq("PUT 空字段 400", 400, st)

    # --- 未知键/既有条目保留 ---
    d = disk()
    eq("未知顶层键 schema_version 保留", 42, d.get("schema_version"))
    eq("未知顶层键 note 保留", "未知顶层键必须保留-API", d.get("note"))
    eq("未知顶层键 custom_top 保留", {"a": [1, 2, 3]}, d.get("custom_top"))
    eq("既有条目 keep-1/keep-3 仍在", True, all(any(i["id"] == k for i in d["items"]) for k in ("keep-1", "keep-2", "keep-3")))
    eq("既有条目额外字段 extra_note 保留", "勿删我", [i for i in d["items"] if i["id"] == "keep-1"][0].get("extra_note"))

    # --- 更新既有条目保留其额外字段 ---
    st, _, _ = call(base, "PUT", "/api/items/keep-1", {"category": "乳制品"}); eq("PUT 既有条目 200", 200, st)
    k1 = [i for i in disk()["items"] if i["id"] == "keep-1"][0]
    eq("更新既有条目后额外字段保留", "勿删我", k1.get("extra_note"))
    eq("更新既有条目后未知顶层键保留", 42, disk().get("schema_version"))

    # --- DELETE ---
    st, dd, _ = call(base, "DELETE", "/api/items/" + new_id); eq("DELETE 200", 200, st); eq("DELETE 返回 deleted", True, dd.get("deleted"))
    st, _, _ = call(base, "GET", "/api/items/" + new_id); eq("DELETE 后单条 404", 404, st)
    st, _, _ = call(base, "DELETE", "/api/items/" + new_id); eq("DELETE 不存在 404", 404, st)
    d = disk()
    eq("删除仅移除目标，其余 3 条仍在", 3, len(d["items"]))
    eq("删除后未知顶层键保留", "未知顶层键必须保留-API", d.get("note"))

    # --- 写入原子：目录内无临时残留 ---
    leftovers = [n for n in os.listdir(work) if n not in ("preset.json", "server.log")]
    eq("写入原子无临时残留", [], leftovers)

    # --- 纯标准库：检查 import ---
    src = io.open(APP, encoding="utf-8").read()
    third_party = [m for m in ("requests", "flask", "flask_", "fastapi", "django", "tornado", "aiohttp") if ("import " + m) in src]
    eq("仅标准库无第三方依赖", [], third_party)

    # --- 方法/路径 ---
    st, _, _ = call(base, "PATCH", "/api/items", {"x": 1}); eq("PATCH 405", 405, st)
    st, _, _ = call(base, "GET", "/api/nope"); eq("未知 /api 路径 404", 404, st)
    st, _, _ = call(base, "GET", "/nope"); eq("未知页面 404", 404, st)
finally:
    proc.terminate()
    try: proc.wait(timeout=5)
    except Exception: proc.kill()
    logf.close()
    print("== server.log tail ==")
    print("".join(io.open(os.path.join(work, "server.log"), encoding="utf-8").readlines()[-5:]))
    shutil.rmtree(work, ignore_errors=True)

print("API_REGRESSION %d/%d PASSED" % (PASS, PASS + FAIL))
sys.exit(0 if FAIL == 0 else 1)
