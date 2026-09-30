#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""YUNZ-12 独立验证：边界/对抗用例（合法遗留档形状、非对象条目、HEAD、未知字段）。"""
import json, os, shutil, subprocess, sys, tempfile, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import independent_verify as iv  # 复用同一个自研客户端

RESULTS = []
def check(label, func):
    try:
        func()
    except AssertionError as exc:
        RESULTS.append((label, False, str(exc))); print("FAIL  %s  -> %s" % (label, exc))
    except Exception as exc:
        RESULTS.append((label, False, str(exc))); print("FAIL  %s  -> %s: %s" % (label, type(exc).__name__, exc))
    else:
        RESULTS.append((label, True, "")); print("PASS  %s" % label)

def main():
    tmp = tempfile.mkdtemp(prefix="yq-edge-")
    # 合法遗留形状：顶层直接是数组，且含一个非对象元素
    legacy = [{"id": "L1", "name": "旧A", "category": "甲", "quantity": 2, "extra": "keep"},
              "not-an-object",
              {"id": "L2", "name": "旧B", "category": "甲", "quantity": 3}]
    lp = os.path.join(tmp, "legacy.json")
    with open(lp, "w", encoding="utf-8") as fh:
        json.dump(legacy, fh, ensure_ascii=False)
    srv = iv.Server(lp)
    try:
        def t_head():
            code, hdrs, body = iv.http(srv.port, "HEAD", "/")
            assert code == 200 and body == b"", "HEAD / -> %s body=%r" % (code, body[:40])
            code, hdrs, body = iv.http(srv.port, "HEAD", "/api/items")
            assert code == 200 and body == b"", "HEAD /api/items -> %s" % code
        check("HEAD / 与 HEAD /api/items 返回 200 且无响应体", t_head)

        def t_legacy_list():
            code, _h, body = iv.http(srv.port, "GET", "/api/items")
            assert code == 200, "旧档 GET 返回 %s" % code
            ids = sorted(i["id"] for i in iv.jload(body)["items"])
            assert ids == ["L1", "L2"], "旧档读到的条目 %r" % ids
            code, _h, b2 = iv.http(srv.port, "POST", "/api/items", {"name": "新", "category": "乙", "quantity": 1})
            assert code == 201, "旧档 POST 返回 %s" % code
            with open(lp, encoding="utf-8") as fh:
                raw = fh.read()
            disk = json.loads(raw)
            assert isinstance(disk, list), "顶层数组形状未被保持：%r" % type(disk)
            kept = [e for e in disk if isinstance(e, dict) and e.get("id") == "L1"]
            assert kept and kept[0].get("extra") == "keep", "旧档条目额外字段丢失：%r" % kept
            assert "not-an-object" in disk, "旧档非对象元素被清除"
            assert len(disk) == 4, "旧档元素数 %d" % len(disk)
            code, _h, b3 = iv.http(srv.port, "DELETE", "/api/items/L2")
            assert code == 200, "旧档 DELETE 返回 %s" % code
            disk = json.loads(open(lp, encoding="utf-8").read())
            assert "not-an-object" in disk and isinstance(disk, list), "删除后非对象元素/数组形状丢失"
        check("顶层数组旧档可读写，非对象元素与额外字段保留，写回仍为数组", t_legacy_list)

        def t_unknown_field_payload():
            code, _h, _b = iv.http(srv.port, "POST", "/api/items",
                                   {"name": "带杂键", "category": "丙", "quantity": 1, "evil": {"x": 1}})
            assert code == 201, "POST 带未知字段返回 %s" % code
            disk = json.loads(open(lp, encoding="utf-8").read())
            hit = [e for e in disk if isinstance(e, dict) and e.get("name") == "带杂键"]
            assert hit and "evil" not in hit[0], "未知字段被写进数据文件：%r" % hit
            code, _h, _b = iv.http(srv.port, "PUT", "/api/items/L1", {"whatever": 1})
            assert code == 400, "PUT 仅未知字段返回 %s（期望 400）" % code
        check("POST 请求体未知字段被忽略不入档；PUT 仅未知字段 → 400", t_unknown_field_payload)
    finally:
        srv.stop()
        shutil.rmtree(tmp, ignore_errors=True)
    passed = sum(1 for _l, ok, _m in RESULTS if ok)
    print("EDGE-CASES %d/%d PASSED" % (passed, len(RESULTS)))
    return 0 if passed == len(RESULTS) else 1

if __name__ == "__main__":
    sys.exit(main())
