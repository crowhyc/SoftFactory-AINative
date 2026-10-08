# -*- coding: utf-8 -*-
"""YUNZ-17 独立 API 契约 / 数据不丢失 复跑（不复用作者脚本）。"""
import io, json, os, re, subprocess, sys, tempfile, time, urllib.error, urllib.request, shutil

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ART = "/opt/SoftFactory-AINative/artifacts/YUNZ-10"
APP = os.path.join(ART, "app.py")
PASS = [0]; FAIL = [0]

def ok(m): PASS[0]+=1; print("PASS  %s" % m)
def bad(m, d=""): FAIL[0]+=1; print("FAIL  %s  -> %s" % (m, d))
def eq(m, exp, got):
    if exp == got: ok(m)
    else: bad(m, "期望[%r] 实际[%r]" % (exp, got))

def call(base, method, path, body=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(base+path, data=data, method=method,
        headers={"Content-Type":"application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            raw = r.read().decode("utf-8")
            return r.status, (json.loads(raw) if raw else None), raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try: parsed = json.loads(raw)
        except Exception: parsed = None
        return e.code, parsed, raw

work = tempfile.mkdtemp(prefix="yunz17-api-")
datafile = os.path.join(work, "data.json")
preset = {
    "items": [
        {"id":"keep-01","name":"既有甲","category":"食品","quantity":3,"extra_field":"保留我"},
        {"id":"keep-02","name":"既有乙","category":"食品","quantity":4},
        {"id":"keep-03","name":"既有丙","category":"用品","quantity":5},
    ],
    "schema_version": 7,
    "note": "未知顶层键必须保留",
    "custom_top": {"nested":[1,2,3]}
}
with open(datafile,"w",encoding="utf-8") as f: json.dump(preset,f,ensure_ascii=False,indent=2)

proc = subprocess.Popen([sys.executable, APP, "--host","127.0.0.1","--port","0","--data",datafile],
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=work)
try:
    base = None
    for _ in range(100):
        line = proc.stdout.readline().decode("utf-8","replace")
        m = re.search(r"(http://127\.0\.0\.1:\d+/)", line)
        if m: base = m.group(1).rstrip("/"); break
    if not base: raise SystemExit("server did not start")
    print("server: %s" % base)

    # --- GET /api/items shape ---
    st, body, _ = call(base,"GET","/api/items")
    eq("GET /api/items 200", 200, st)
    eq("既有条目数 3", 3, len(body["items"]))
    keys = sorted(body["items"][0].keys())
    eq("条目响应字段=契约4字段", ["category","id","name","quantity"], keys)

    # --- summary correctness (multi-category, cross-entry) ---
    st, body, _ = call(base,"GET","/api/summary")
    eq("GET /api/summary 200", 200, st)
    sm = {e["category"]: e["total_quantity"] for e in body["summary"]}
    eq("汇总 食品=3+4=7", 7, sm.get("食品"))
    eq("汇总 用品=5", 5, sm.get("用品"))

    # --- POST 201 ---
    st, created, _ = call(base,"POST","/api/items",{"name":"新增物","category":"工具","quantity":2})
    eq("POST /api/items 201", 201, st)
    new_id = created["id"]
    ok("POST 返回含 id (%s)" % new_id)

    # --- PUT ---
    st, upd, _ = call(base,"PUT","/api/items/%s" % new_id, {"quantity":9})
    eq("PUT 200", 200, st)
    eq("PUT 生效 quantity=9", 9, upd["quantity"])
    eq("PUT 部分更新保留 name", "新增物", upd["name"])

    # --- PUT nonexistent 404 ---
    st, _, _ = call(base,"PUT","/api/items/nope-xyz", {"quantity":1})
    eq("PUT 不存在 id -> 404", 404, st)

    # --- DELETE nonexistent 404 / existing 200 ---
    st, _, _ = call(base,"DELETE","/api/items/nope-xyz")
    eq("DELETE 不存在 id -> 404", 404, st)

    # --- invalid inputs 400 ---
    for label, payload in [
        ("缺字段", {"name":"x"}),
        ("空名称", {"name":"  ","category":"c","quantity":1}),
        ("负数量", {"name":"x","category":"c","quantity":-1}),
        ("数量非整数", {"name":"x","category":"c","quantity":"abc"}),
        ("name 非字符串", {"name":5,"category":"c","quantity":1}),
    ]:
        st, b, _ = call(base,"POST","/api/items",payload)
        eq("POST 非法输入(%s) -> 400" % label, 400, st)

    # --- update existing item, verify extra field preserved ---
    st, upd, _ = call(base,"PUT","/api/items/keep-01", {"category":"熟食"})
    eq("PUT 既有条目 200", 200, st)

    st, _, _ = call(base,"DELETE","/api/items/keep-03")
    eq("DELETE 既有条目 200", 200, st)

    # --- file-level preservation ---
    with open(datafile,encoding="utf-8") as f: doc = json.load(f)
    eq("未知顶层键 schema_version 保留", 7, doc.get("schema_version"))
    eq("未知顶层键 note 保留", "未知顶层键必须保留", doc.get("note"))
    eq("未知顶层键 custom_top 保留", {"nested":[1,2,3]}, doc.get("custom_top"))
    ids = [i["id"] for i in doc["items"]]
    ok("既有条目 keep-01/keep-02 保留: %s" % ids)
    k1 = [i for i in doc["items"] if i["id"]=="keep-01"][0]
    eq("keep-01 额外字段保留", "保留我", k1.get("extra_field"))
    eq("keep-01 类别已更新为熟食", "熟食", k1.get("category"))
    ok("keep-03 已被删除: %s" % ("keep-03" not in ids))
    leftover = [n for n in os.listdir(work) if n.startswith(".data-")]
    eq("无临时文件残留(原子写)", [], leftover)

    # --- stdlib only ---
    src = open(APP,encoding="utf-8").read()
    imports = re.findall(r"^(?:import|from)\s+([a-zA-Z0-9_\.]+)", src, re.M)
    stdlib = {"argparse","io","json","os","shutil","sys","tempfile","threading","time",
              "urllib","uuid","http","socketserver","collections","re","math","copy"}
    third = sorted({m.split(".")[0] for m in imports} - stdlib)
    eq("仅标准库导入(无第三方)", [], third)

    print("API_REGRESSION %d/%d PASSED" % (PASS[0], PASS[0]+FAIL[0]))
finally:
    proc.terminate()
    try: proc.wait(timeout=5)
    except Exception: proc.kill()
    shutil.rmtree(work, ignore_errors=True)
sys.exit(0 if FAIL[0]==0 else 1)
