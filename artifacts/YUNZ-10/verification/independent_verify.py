#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""YUNZ-12 Stage2 独立验证harness（由独立验证工程师编写，不复用实现者的 verify_e2e.sh）。
用法: python3 independent_verify.py /opt/SoftFactory-AINative/artifacts/YUNZ-10/app.py
"""
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

APP = sys.argv[1] if len(sys.argv) > 1 else "/opt/SoftFactory-AINative/artifacts/YUNZ-10/app.py"
APPDIR = os.path.dirname(os.path.abspath(APP))
RESULTS = []


def check(label, func):
    try:
        func()
    except AssertionError as exc:
        RESULTS.append((label, False, str(exc)))
        print("FAIL  %s  -> %s" % (label, exc))
    except Exception as exc:  # noqa
        RESULTS.append((label, False, "%s: %s" % (type(exc).__name__, exc)))
        print("FAIL  %s  -> %s: %s" % (label, type(exc).__name__, exc))
    else:
        RESULTS.append((label, True, ""))
        print("PASS  %s" % label)


def expect(cond, msg):
    if not cond:
        raise AssertionError(msg)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def http(port, method, path, body=None, raw_body=None):
    url = "http://127.0.0.1:%d%s" % (port, urllib.parse.quote(path, safe="/?&=%"))
    data = raw_body
    headers = {}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(req, timeout=20)
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read()
    try:
        return resp.getcode(), dict(resp.headers), resp.read()
    finally:
        resp.close()


def jload(raw):
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return None


class Server(object):
    def __init__(self, data_path, extra=None, app=APP):
        self.port = free_port()
        cmd = [sys.executable, app, "--host", "127.0.0.1", "--port", str(self.port), "--data", data_path]
        if extra:
            cmd = [sys.executable, app] + extra
        self.errfile = tempfile.NamedTemporaryFile(prefix="srv-", suffix=".log", delete=False)
        self.proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=self.errfile, cwd=APPDIR)
        deadline = time.time() + 20
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise AssertionError("服务提前退出，code=%s log=%s" % (self.proc.returncode, open(self.errfile.name).read()[-800:]))
            try:
                code, _h, _b = http(self.port, "GET", "/api/health")
                if code == 200:
                    return
            except Exception:
                time.sleep(0.05)
        raise AssertionError("20s 内服务未就绪")

    def stop(self):
        try:
            self.proc.terminate()
            self.proc.wait(timeout=10)
        except Exception:
            self.proc.kill()
        self.errfile.close()


PRESET = {
    "items": [
        {"id": "keep-1", "name": "既有物品A", "category": "工具", "quantity": 4, "manual_note": "手工加的字段"},
        {"id": "keep-2", "name": "既有物品B", "category": "食品", "quantity": 6},
    ],
    "schema_version": 3,
    "custom_top_level": {"nested": [1, 2, 3]},
    "note": "preset by independent verifier",
}


def write_json(path, doc):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2)


def read_json(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def main():
    tmp = tempfile.mkdtemp(prefix="yq-verify-")
    data_dir = os.path.join(tmp, "datadir")
    os.makedirs(data_dir)
    data_path = os.path.join(data_dir, "preset.json")
    write_json(data_path, PRESET)
    state = {}
    srv = Server(data_path)
    port = srv.port
    try:
        def t_get_index():
            code, hdrs, body = http(port, "GET", "/")
            expect(code == 200, "GET / 返回 %s" % code)
            expect("text/html" in hdrs.get("Content-Type", ""), "Content-Type=%s" % hdrs.get("Content-Type"))
            text = body.decode("utf-8")
            expect('id="add-form"' in text, "单页缺少添加表单")
            expect("/api/items" in text and "/api/summary" in text, "单页未引用 API")
            expect("http://" not in text.replace("http://127.0.0.1", "") and "https://" not in text, "单页出现外部链接")
        check("GET / 返回单页 HTML（含增改删查与汇总，无外部链接）", t_get_index)

        def t_list_shape():
            code, _h, body = http(port, "GET", "/api/items")
            expect(code == 200, "GET /api/items 返回 %s" % code)
            doc = jload(body)
            expect(isinstance(doc, dict) and isinstance(doc.get("items"), list), "响应形状不符：%r" % (doc,))
            ids = [it["id"] for it in doc["items"]]
            expect(sorted(ids) == ["keep-1", "keep-2"], "既有条目不符：%r" % ids)
            for it in doc["items"]:
                expect(set(it.keys()) == {"id", "name", "category", "quantity"}, "字段集不符：%r" % sorted(it.keys()))
            expect(doc["items"][0]["quantity"] == 4, "quantity 不符")
        check("GET /api/items 返回既有条目且响应字段恰为契约 4 字段", t_list_shape)

        def t_post():
            code, _h, body = http(port, "POST", "/api/items", {"name": "新增C", "category": "工具", "quantity": 2})
            expect(code == 201, "POST 返回 %s" % code)
            created = jload(body)
            expect(created.get("name") == "新增C" and created.get("quantity") == 2, "返回体不符：%r" % created)
            expect(created.get("id"), "未返回 id")
            state["new_id"] = created["id"]
            code2, _h, body2 = http(port, "GET", "/api/items/" + created["id"])
            expect(code2 == 200 and jload(body2)["quantity"] == 2, "增后查不到：%s %r" % (code2, jload(body2)))
            disk = read_json(data_path)
            expect(len(disk["items"]) == 3, "文件内条目数 %s" % len(disk["items"]))
            keep1 = [it for it in disk["items"] if it["id"] == "keep-1"][0]
            expect(keep1.get("manual_note") == "手工加的字段", "新增后既有条目额外字段丢失：%r" % keep1)
            expect(disk.get("schema_version") == 3 and "custom_top_level" in disk, "新增后未知顶层键丢失")
        check("POST /api/items 201 生效，且文件内既有条目/额外字段/未知顶层键保留", t_post)

        def t_put():
            code, _h, body = http(port, "PUT", "/api/items/keep-1", {"quantity": 9})
            expect(code == 200, "PUT 返回 %s" % code)
            updated = jload(body)
            expect(updated["quantity"] == 9, "改后值未变：%r" % updated)
            expect(updated["name"] == "既有物品A" and updated["category"] == "工具", "未传字段被改动：%r" % updated)
            code2, _h, body2 = http(port, "GET", "/api/items/keep-1")
            expect(jload(body2)["quantity"] == 9, "改后复查不是新值")
            disk = read_json(data_path)
            keep1 = [it for it in disk["items"] if it["id"] == "keep-1"][0]
            expect(keep1["quantity"] == 9 and keep1.get("manual_note") == "手工加的字段", "PUT 后文件内额外字段丢失：%r" % keep1)
            expect(disk.get("note") == "preset by independent verifier", "PUT 后未知顶层键丢失")
        check("PUT /api/items/<id> 200 改后值变化，未传字段与额外字段保留", t_put)

        def t_put_missing():
            code, _h, body = http(port, "PUT", "/api/items/nope-999", {"quantity": 1})
            expect(code == 404, "PUT 不存在 id 返回 %s" % code)
            expect("error" in (jload(body) or {}), "404 响应缺 error：%r" % jload(body))
        check("PUT 不存在的 id → 404 + {\"error\"}", t_put_missing)

        def t_summary():
            code, _h, body = http(port, "GET", "/api/summary")
            expect(code == 200, "GET /api/summary 返回 %s" % code)
            got = dict((e["category"], e["total_quantity"]) for e in jload(body)["summary"])
            expect(got == {"工具": 11, "食品": 6}, "汇总不符（期望 工具11/食品6）：%r" % (got,))
            manual = {}
            for it in read_json(data_path)["items"]:
                manual[it["category"]] = manual.get(it["category"], 0) + it["quantity"]
            expect(got == manual, "汇总与逐条累加不一致：%r vs %r" % (got, manual))
        check("GET /api/summary 多类别跨条目汇总 == 逐条累加（工具11/食品6）", t_summary)

        def t_delete():
            nid = state["new_id"]
            code, _h, body = http(port, "DELETE", "/api/items/" + nid)
            expect(code in (200, 204), "DELETE 返回 %s" % code)
            code2, _h, _b2 = http(port, "GET", "/api/items/" + nid)
            expect(code2 == 404, "删后该 id 返回 %s（期望 404）" % code2)
            code3, _h, _b3 = http(port, "DELETE", "/api/items/" + nid)
            expect(code3 == 404, "重复 DELETE 返回 %s" % code3)
            disk = read_json(data_path)
            ids = [it["id"] for it in disk["items"]]
            expect(sorted(ids) == ["keep-1", "keep-2"], "删除后文件条目不符：%r" % ids)
            keep1 = [it for it in disk["items"] if it["id"] == "keep-1"][0]
            expect(keep1.get("manual_note") == "手工加的字段", "删除后其它条目额外字段丢失")
            expect(disk.get("schema_version") == 3 and disk.get("custom_top_level") == {"nested": [1, 2, 3]}, "删除后未知顶层键丢失")
            leftovers = [n for n in os.listdir(data_dir) if n.startswith(".data-")]
            expect(not leftovers, "写入残留临时文件：%r" % leftovers)
        check("DELETE /api/items/<id> 200/204 生效、删后 404，其余数据与未知键保留", t_delete)

        def t_readonly_no_write():
            before = sha256(data_path)
            for _ in range(5):
                http(port, "GET", "/api/items")
                http(port, "GET", "/api/summary")
                http(port, "GET", "/api/health")
            expect(sha256(data_path) == before, "只读 API 改动了数据文件")
        check("只读 API（items/summary/health）前后数据文件 sha256 不变", t_readonly_no_write)

        def t_bad_input():
            cases = [
                ("数量为负", "POST", "/api/items", {"name": "x", "category": "y", "quantity": -1}),
                ("数量非数字", "POST", "/api/items", {"name": "x", "category": "y", "quantity": "abc"}),
                ("数量为小数", "POST", "/api/items", {"name": "x", "category": "y", "quantity": 1.5}),
                ("缺字段", "POST", "/api/items", {"name": "x"}),
                ("空名称", "POST", "/api/items", {"name": "  ", "category": "y", "quantity": 1}),
            ]
            for label, method, path, payload in cases:
                code, _h, body = http(port, method, path, payload)
                expect(code == 400, "%s 返回 %s（期望 400）" % (label, code))
                expect("error" in (jload(body) or {}), "%s 响应缺 error" % label)
            code, _h, _b = http(port, "PATCH", "/api/items", {"quantity": 1})
            expect(code == 405, "PATCH 返回 %s（期望 405）" % code)
            code, _h, _b = http(port, "GET", "/api/nope")
            expect(code == 404, "未知 /api 路径返回 %s（期望 404）" % code)
        check("非法输入 400（负/非数字/小数/缺字段/空名）、PATCH 405、未知 /api 404", t_bad_input)

        def t_atomic_reads():
            before_ids = set(it["id"] for it in read_json(data_path)["items"])
            stop = {"n": 0}
            bad = []

            def writer():
                while not stop["n"]:
                    try:
                        http(port, "POST", "/api/items", {"name": "并发", "category": "压力", "quantity": 1})
                    except Exception:
                        pass

            def reader():
                while not stop["n"]:
                    try:
                        with open(data_path, "r", encoding="utf-8") as fh:
                            text = fh.read()
                        if not text.strip():
                            bad.append("空文件")
                            continue
                        json.loads(text)
                    except Exception as exc:  # noqa
                        bad.append("%s: %s" % (type(exc).__name__, exc))
            th = [threading.Thread(target=writer) for _ in range(3)] + [threading.Thread(target=reader) for _ in range(2)]
            for t in th:
                t.daemon = True
                t.start()
            time.sleep(4)
            stop["n"] = 1
            for t in th:
                t.join(timeout=20)
            expect(not bad, "原子性被破坏，读取到非法/空文件 %d 次：%r" % (len(bad), bad[:3]))
            disk = read_json(data_path)
            expect(before_ids.issubset(set(it["id"] for it in disk["items"])), "并发写后既有条目丢失")
            expect(disk.get("custom_top_level") is not None, "并发写后未知顶层键丢失")
            leftovers = [n for n in os.listdir(data_dir) if n.startswith(".data-")]
            expect(not leftovers, "并发写后残留临时文件：%r" % leftovers)
        check("并发写期间连续读文件：始终是完整合法 JSON，既有条目/未知键不丢、无残留", t_atomic_reads)
    finally:
        srv.stop()

    # 损坏文件保护
    corrupt_dir = os.path.join(tmp, "corrupt")
    os.makedirs(corrupt_dir)
    corrupt_path = os.path.join(corrupt_dir, "data.json")
    with open(corrupt_path, "w", encoding="utf-8") as fh:
        fh.write("{ this is not json ")
    corrupt_before = sha256(corrupt_path)
    srv2 = Server(corrupt_path)
    try:
        def t_corrupt():
            code, _h, _b = http(srv2.port, "GET", "/api/items")
            expect(code == 500, "损坏文件的 GET 返回 %s（期望 500）" % code)
            code, _h, _b = http(srv2.port, "POST", "/api/items", {"name": "n", "category": "c", "quantity": 1})
            expect(code == 500, "损坏文件的 POST 返回 %s（期望 500）" % code)
            expect(sha256(corrupt_path) == corrupt_before, "损坏文件被覆盖/改写了（数据丢失）")
        check("数据文件非法 JSON → 500 且拒绝写入、原文件字节不变", t_corrupt)
    finally:
        srv2.stop()

    # 写入失败（数据目录被替换为同名文件）→ 500 且不破坏数据
    fail_dir = os.path.join(tmp, "faildir")
    os.makedirs(fail_dir)
    fail_path = os.path.join(fail_dir, "data.json")
    write_json(fail_path, PRESET)
    fail_before = sha256(fail_path)
    srv3 = Server(fail_path)
    try:
        backup = os.path.join(tmp, "faildir_backup")
        os.rename(fail_dir, backup)
        with open(fail_dir, "w", encoding="utf-8") as fh:
            fh.write("blocker")

        def t_write_failure():
            code, _h, body = http(srv3.port, "POST", "/api/items", {"name": "n", "category": "c", "quantity": 1})
            expect(code == 500, "写入失败时返回 %s（期望 500）" % code)
            expect("error" in (jload(body) or {}), "500 响应缺 error")
            expect(sha256(os.path.join(backup, "data.json")) == fail_before, "写入失败却改动了既有数据文件")
        check("写入不可用时 POST → 500 且既有数据文件 sha256 不变（不半写/不清空）", t_write_failure)
        os.remove(fail_dir)
        os.rename(backup, fail_dir)
        code, _h, _b = http(srv3.port, "POST", "/api/items", {"name": "恢复", "category": "c", "quantity": 1})
        expect(code == 201, "恢复后 POST 返回 %s" % code)
        disk = read_json(fail_path)
        ids = sorted(it["id"] for it in disk["items"])
        expect("keep-1" in ids and "keep-2" in ids, "既有条目在失败/恢复后丢失：%r" % ids)
        expect(len(ids) == 3, "恢复后条目数不符：%r" % ids)
        manual = {}
        for it in disk["items"]:
            manual[it["category"]] = manual.get(it["category"], 0) + it["quantity"]
        expect(manual.get("工具") == 4 and manual.get("食品") == 6, "恢复后汇总不符：%r" % manual)
    finally:
        srv3.stop()

    shutil.rmtree(tmp, ignore_errors=True)
    passed = sum(1 for _l, ok, _m in RESULTS if ok)
    print("INDEPENDENT-VERIFY %d/%d PASSED" % (passed, len(RESULTS)))
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
