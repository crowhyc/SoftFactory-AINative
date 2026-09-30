#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""YUNZ-14 独立复验 harness：API 契约 / 汇总 / 数据保全 / 原子写 / 纯标准库回归。

由独立验证工程师（AI-QV）自研，不复用被验证方脚本；仅使用 Python 标准库。
用法：python3 api_regression.py --app <app.py> --index <index.html> [--workdir <dir>]
退出码 0 = 全部用例通过。
"""
import argparse
import ast
import hashlib
import io
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

RESULTS = []


def check(name, cond, detail=""):
    ok = bool(cond)
    RESULTS.append((name, ok, detail))
    line = ("PASS" if ok else "FAIL") + " " + name
    if detail and not ok:
        line += " :: " + str(detail)
    print(line)
    return ok


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def free_port():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


class Server(object):
    def __init__(self, app_path, workdir, data_path):
        self.port = free_port()
        self.base = "http://127.0.0.1:%d" % self.port
        env = dict(os.environ)
        env["PYTHONIOENCODING"] = "utf-8"
        self.proc = subprocess.Popen(
            [sys.executable, app_path, "--host", "127.0.0.1", "--port", str(self.port), "--data", data_path],
            cwd=workdir, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env,
        )

    def wait_ready(self, timeout=15):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.proc.poll() is not None:
                return False
            try:
                status, _body, _hdrs = self.call("GET", "/api/health")
                if status == 200:
                    return True
            except Exception:
                pass
            time.sleep(0.05)
        return False

    def call(self, method, path, body=None, raw_body=None, headers=None):
        data = None
        hdrs = dict(headers or {})
        if raw_body is not None:
            data = raw_body.encode("utf-8") if isinstance(raw_body, str) else raw_body
        elif body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            hdrs["Content-Type"] = "application/json"
        req = urllib.request.Request(self.base + path, data=data, headers=hdrs, method=method)
        try:
            resp = urllib.request.urlopen(req, timeout=15)
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read().decode("utf-8"), dict(exc.headers)
        try:
            return resp.getcode(), resp.read().decode("utf-8"), dict(resp.headers)
        finally:
            resp.close()

    def j(self, method, path, body=None, raw_body=None, headers=None):
        status, text, hdrs = self.call(method, path, body=body, raw_body=raw_body, headers=headers)
        try:
            parsed = json.loads(text) if text else None
        except ValueError:
            parsed = None
        return status, parsed, text, hdrs

    def stop(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except Exception:
                self.proc.kill()


PRESET = {
    "items": [
        {"id": "keep-1", "name": "牛奶", "category": "食品", "quantity": 3, "manual_note": "保留我"},
        {"id": "keep-2", "name": "电池", "category": "用品", "quantity": 5},
    ],
    "schema_version": 1,
    "custom_top_level": {"a": 1},
    "note": "既有备注",
}


def write_json(path, obj):
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(obj, handle, ensure_ascii=False, indent=2)


def scenario_main(app, tmp):
    data = os.path.join(tmp, "data.json")
    write_json(data, PRESET)
    srv = Server(app, tmp, data)
    if not check("S1 服务启动就绪", srv.wait_ready()):
        srv.stop()
        return
    try:
        status, text, hdrs = srv.call("GET", "/")
        check("S1 GET / 返回 200", status == 200, status)
        check("S1 GET / Content-Type 为 text/html", "text/html" in hdrs.get("Content-Type", ""), hdrs.get("Content-Type"))
        check("S1 页面含添加表单与清单表体", ("add-form" in text and "items-body" in text))
        external = re.findall(r'(?:src|href)\s*=\s*["\'](?:https?:)?//', text)
        check("S1 页面无外部 src/href（不联网）", not external, external)

        status, payload, _text, hdrs = srv.j("GET", "/api/health")
        check("S1 /api/health 200 且 data_file 指向指定文件",
              status == 200 and payload.get("status") == "ok" and payload.get("data_file") == os.path.abspath(data),
              (status, payload))
        check("S1 API 响应 Content-Type 为 application/json", "application/json" in hdrs.get("Content-Type", ""), hdrs.get("Content-Type"))

        sha_before = sha256_file(data)
        status, payload, _t, _h = srv.j("GET", "/api/items")
        check("S1 GET /api/items 返回 2 条既有条目", status == 200 and len(payload["items"]) == 2, (status, payload))
        status, payload, _t, _h = srv.j("GET", "/api/items/keep-1")
        check("S1 GET /api/items/<id> 投影为契约 4 字段",
              status == 200 and payload.get("name") == "牛奶" and set(payload.keys()) == {"id", "name", "category", "quantity"},
              (status, payload))
        status, _p, _t, _h = srv.j("GET", "/api/items/%E4%B8%8D%E5%AD%98%E5%9C%A8")
        check("S1 GET 不存在 id -> 404", status == 404, status)
        check("S1 纯 GET 不改写数据文件（只读）", sha256_file(data) == sha_before)

        status, payload, _t, _h = srv.j("POST", "/api/items", {"id": "HACK", "name": "苹果", "category": "食品", "quantity": 2, "extra": "x"})
        check("S1 POST 新增 -> 201，id 由服务端生成并忽略请求 id",
              status == 201 and isinstance(payload.get("id"), str) and payload["id"] != "HACK" and len(payload["id"]) == 12,
              (status, payload))
        check("S1 新条目字段符合契约", status == 201 and payload.get("name") == "苹果" and payload.get("category") == "食品" and payload.get("quantity") == 2, payload)
        status, payload, _t, _h = srv.j("POST", "/api/items", {"name": "数字串", "category": "食品", "quantity": "7"})
        check("S1 POST 纯数字字符串 quantity 接受为 7", status == 201 and payload.get("quantity") == 7, (status, payload))
        status, payload, _t, _h = srv.j("POST", "/api/items", {"name": "浮点", "category": "食品", "quantity": 2.0})
        check("S1 POST 等于整数的浮点 quantity 接受为 2", status == 201 and payload.get("quantity") == 2, (status, payload))

        invalid_cases = [
            ("负数", {"name": "x", "category": "食品", "quantity": -1}),
            ("非数字串", {"name": "x", "category": "食品", "quantity": "abc"}),
            ("小数", {"name": "x", "category": "食品", "quantity": 1.5}),
            ("布尔", {"name": "x", "category": "食品", "quantity": True}),
            ("null", {"name": "x", "category": "食品", "quantity": None}),
            ("数组", {"name": "x", "category": "食品", "quantity": []}),
            ("缺字段", {"name": "只有名字"}),
            ("空名称", {"name": "   ", "category": "食品", "quantity": 1}),
        ]
        for label, body in invalid_cases:
            status, payload, _t, _h = srv.j("POST", "/api/items", body)
            check("S1 POST 非法输入(%s) -> 400 且含 error" % label,
                  status == 400 and isinstance(payload, dict) and "error" in payload, (status, payload))
        status, payload, _t, _h = srv.j("POST", "/api/items", body=["not", "object"])
        check("S1 POST 非对象请求体 -> 400", status == 400, (status, payload))
        status, payload, _t, _h = srv.j("POST", "/api/items", raw_body="{bad json")
        check("S1 POST 非法 JSON -> 400", status == 400, (status, payload))

        status, payload, _t, _h = srv.j("PUT", "/api/items/keep-1", {"quantity": 9})
        check("S1 PUT 部分更新仅改数量，其余字段保留",
              status == 200 and payload.get("quantity") == 9 and payload.get("name") == "牛奶" and payload.get("category") == "食品",
              (status, payload))
        status, _p, _t, _h = srv.j("PUT", "/api/items/%E4%B8%8D%E5%AD%98%E5%9C%A8", {"quantity": 1})
        check("S1 PUT 不存在 id -> 404", status == 404, status)
        status, payload, _t, _h = srv.j("PUT", "/api/items/keep-1", body={})
        check("S1 PUT 空体 -> 400", status == 400, (status, payload))
        status, payload, _t, _h = srv.j("PUT", "/api/items/keep-1", raw_body="{bad")
        check("S1 PUT 非法 JSON -> 400", status == 400, (status, payload))

        status, payload, _t, _h = srv.j("DELETE", "/api/items/keep-2")
        check("S1 DELETE -> 200 deleted:true", status == 200 and payload.get("deleted") is True, (status, payload))
        status, _p, _t, _h = srv.j("GET", "/api/items/keep-2")
        check("S1 删除后该 id -> 404", status == 404, status)
        status, _p, _t, _h = srv.j("DELETE", "/api/items/keep-2")
        check("S1 重复删除 -> 404", status == 404, status)
        status, _p, _t, _h = srv.j("PATCH", "/api/items")
        check("S1 PATCH /api/items -> 405", status == 405, status)
        status, _p, _t, _h = srv.j("GET", "/api/nope")
        check("S1 未知 /api 路径 -> 404", status == 404, status)
        status, _p, _t, _h = srv.j("GET", "/nope")
        check("S1 未知非 api 路径 -> 404", status == 404, status)

        _s, items_payload, _t, _h = srv.j("GET", "/api/items")
        _s2, summ_payload, _t, _h = srv.j("GET", "/api/summary")
        expected = {}
        for item in items_payload["items"]:
            expected[item["category"]] = expected.get(item["category"], 0) + item["quantity"]
        got = dict((e["category"], e["total_quantity"]) for e in summ_payload["summary"])
        check("S1 按类别汇总与逐条累加一致", got == expected, (got, expected))
        cats = [e["category"] for e in summ_payload["summary"]]
        check("S1 汇总按类别名排序", cats == sorted(cats), cats)

        with open(data, encoding="utf-8") as handle:
            raw = json.load(handle)
        check("S1 未知顶层键全部保留",
              raw.get("schema_version") == 1 and raw.get("note") == "既有备注" and raw.get("custom_top_level") == {"a": 1},
              list(raw.keys()))
        keep1 = [i for i in raw["items"] if i.get("id") == "keep-1"][0]
        check("S1 条目额外字段 manual_note 在 PUT 后保留", keep1.get("manual_note") == "保留我", keep1)
        check("S1 已删除条目确实从文件消失", all(i.get("id") != "keep-2" for i in raw["items"]), [i.get("id") for i in raw["items"]])
        residual = [n for n in os.listdir(tmp) if n.startswith(".data-")]
        check("S1 无 .data-* 临时文件残留（原子写）", not residual, residual)
    finally:
        srv.stop()


def scenario_legacy_array(app, tmp):
    data = os.path.join(tmp, "data.json")
    write_json(data, [{"id": "a", "name": "旧档", "category": "历史", "quantity": 2}])
    srv = Server(app, tmp, data)
    if not check("S2 顶层数组旧档 服务就绪", srv.wait_ready()):
        srv.stop()
        return
    try:
        status, payload, _t, _h = srv.j("GET", "/api/items")
        check("S2 顶层数组旧档可读（1 条）", status == 200 and len(payload["items"]) == 1, (status, payload))
        status, _p, _t, _h = srv.j("POST", "/api/items", {"name": "新增", "category": "历史", "quantity": 3})
        check("S2 向顶层数组旧档新增 -> 201", status == 201, status)
        with open(data, encoding="utf-8") as handle:
            raw = json.load(handle)
        check("S2 写回后顶层仍为数组且含 2 条", isinstance(raw, list) and len(raw) == 2, type(raw).__name__)
        residual = [n for n in os.listdir(tmp) if n.startswith(".data-")]
        check("S2 无临时文件残留", not residual, residual)
    finally:
        srv.stop()


def scenario_nonobject_element(app, tmp):
    data = os.path.join(tmp, "data.json")
    write_json(data, {"items": [{"id": "n1", "name": "正常", "category": "类别", "quantity": 1}, "坏元素", 42]})
    srv = Server(app, tmp, data)
    if not check("S3 含非对象元素 服务就绪", srv.wait_ready()):
        srv.stop()
        return
    try:
        status, payload, _t, _h = srv.j("GET", "/api/items")
        check("S3 非对象元素被安全跳过，仅返回 1 条", status == 200 and len(payload["items"]) == 1, (status, payload))
        srv.j("POST", "/api/items", {"name": "新增", "category": "类别", "quantity": 4})
        with open(data, encoding="utf-8") as handle:
            raw = json.load(handle)
        check("S3 非对象元素在写回后仍保留", "坏元素" in raw["items"] and 42 in raw["items"], raw["items"])
    finally:
        srv.stop()


def scenario_corrupt(app, tmp):
    data = os.path.join(tmp, "data.json")
    with open(data, "w", encoding="utf-8") as handle:
        handle.write("{ this is not json ")
    before = sha256_file(data)
    srv = Server(app, tmp, data)
    if not check("S4 损坏文件场景 服务就绪", srv.wait_ready()):
        srv.stop()
        return
    try:
        status, payload, _t, _h = srv.j("POST", "/api/items", {"name": "x", "category": "y", "quantity": 1})
        check("S4 数据文件损坏时写操作 -> 500 且拒绝写入", status == 500 and isinstance(payload, dict) and "error" in payload, (status, payload))
        check("S4 损坏文件字节未被覆盖", sha256_file(data) == before)
    finally:
        srv.stop()


def scenario_static(app, index_path):
    with open(app, encoding="utf-8") as handle:
        tree = ast.parse(handle.read())
    modules = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                modules.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom) and node.module:
            modules.add(node.module.split(".")[0])
    print("app.py 顶层/全部 import 模块：%s" % ", ".join(sorted(modules)))
    bad = []
    for name in sorted(modules):
        probe = subprocess.run([sys.executable, "-I", "-S", "-c", "import %s" % name],
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        if probe.returncode != 0:
            bad.append(name)
    check("S5 app.py 全部 import 在 -I -S（无 site-packages）下可导入（纯标准库）", not bad, bad)
    with open(index_path, encoding="utf-8") as handle:
        html = handle.read()
    urls = re.findall(r'https?://[^\s"\'<>]+', html)
    check("S5 index.html 无外部 URL", not urls, urls)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", required=True)
    parser.add_argument("--index", required=True)
    args = parser.parse_args()
    print("app     = %s" % args.app)
    print("index   = %s" % args.index)
    print("python  = %s" % sys.version.replace("\n", " "))

    scenario_main(args.app, tempfile.mkdtemp(prefix="y14-main-"))
    scenario_legacy_array(args.app, tempfile.mkdtemp(prefix="y14-legacy-"))
    scenario_nonobject_element(args.app, tempfile.mkdtemp(prefix="y14-nonobj-"))
    scenario_corrupt(args.app, tempfile.mkdtemp(prefix="y14-corrupt-"))
    scenario_static(args.app, args.index)

    passed = sum(1 for _n, ok, _d in RESULTS if ok)
    failed = [(n, d) for n, ok, d in RESULTS if not ok]
    print("")
    print("API_REGRESSION %d/%d PASSED" % (passed, len(RESULTS)))
    for name, detail in failed:
        print("FAILED: %s :: %s" % (name, detail))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
