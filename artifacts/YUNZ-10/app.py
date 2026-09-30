#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""清单管理小应用 —— 纯 Python 标准库 HTTP 后端 + 单 JSON 文件持久化。

启动：python3 app.py [--host 127.0.0.1] [--port 8000] [--data PATH]
自测：python3 app.py --selftest

数据安全约定：
所有写操作都是「加锁 -> 重新读取旧档 -> 合并改动 -> 写同目录临时文件 -> os.replace 原子替换」。
因此文件里原有的条目、条目上的额外字段、以及其它未知顶层键都会被保留，
增删改任何单条记录都不会整体覆盖或清空既有数据。
"""

import argparse
import io
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer

try:  # Python 3.7+
    from http.server import ThreadingHTTPServer
except ImportError:  # Python 3.6 兼容：ThreadingHTTPServer 是 3.7 才有的
    import socketserver

    class ThreadingHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
        daemon_threads = True
        allow_reuse_address = True


HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DATA_PATH = os.path.join(HERE, "data.json")
INDEX_PATH = os.path.join(HERE, "index.html")

MAX_BODY_BYTES = 1024 * 1024
MAX_FIELD_LEN = 200
ITEM_FIELDS = ("name", "category", "quantity")
UNCATEGORISED = "(未分类)"


class ValidationError(Exception):
    """入参不合法，对应 HTTP 400。"""

    def __init__(self, message):
        Exception.__init__(self, message)
        self.message = message


class StoreError(Exception):
    """数据文件读写失败，对应 HTTP 500（绝不为了「成功」而丢弃既有数据）。"""


class TestFailure(Exception):
    """内置自测断言失败。"""


def parse_text(value, field):
    if not isinstance(value, str):
        raise ValidationError("%s 必须是字符串" % field)
    text = value.strip()
    if not text:
        raise ValidationError("%s 不能为空" % field)
    if len(text) > MAX_FIELD_LEN:
        raise ValidationError("%s 过长（最多 %d 个字符）" % (field, MAX_FIELD_LEN))
    return text


def parse_quantity(value):
    if isinstance(value, bool) or value is None:
        raise ValidationError("quantity 必须是非负整数")
    if isinstance(value, int):
        number = value
    elif isinstance(value, float):
        if not value.is_integer():
            raise ValidationError("quantity 必须是非负整数")
        number = int(value)
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            raise ValidationError("quantity 必须是非负整数")
        try:
            number = int(text, 10)
        except ValueError:
            raise ValidationError("quantity 必须是非负整数")
    else:
        raise ValidationError("quantity 必须是非负整数")
    if number < 0:
        raise ValidationError("quantity 不能为负数")
    return number


def coerce_quantity(value):
    """汇总用：读到的历史数据解析不了就按 0 计，不抛错。"""
    try:
        return parse_quantity(value)
    except ValidationError:
        return 0


def public_item(entry):
    """API 对外统一成契约里的 4 个字段。

    文件里的额外字段不会被删除、也不会被改写，只是不出现在 API 响应里，
    这样 GET /api/items 的形状与 README 的契约完全一致。
    """
    name = entry.get("name")
    category = entry.get("category")
    return {
        "id": str(entry["id"]) if "id" in entry else "",
        "name": name if isinstance(name, str) else ("" if name is None else str(name)),
        "category": category if isinstance(category, str) else ("" if category is None else str(category)),
        "quantity": coerce_quantity(entry.get("quantity")),
    }


def parse_item_payload(body, partial):
    if not isinstance(body, dict):
        raise ValidationError("请求体必须是 JSON 对象")
    if partial:
        if not [field for field in ITEM_FIELDS if field in body]:
            raise ValidationError("请求体至少需要包含 name、category、quantity 中的一个字段")
    else:
        missing = [field for field in ITEM_FIELDS if field not in body]
        if missing:
            raise ValidationError("缺少字段：%s" % "、".join(missing))
    changes = {}
    if "name" in body:
        changes["name"] = parse_text(body["name"], "name")
    if "category" in body:
        changes["category"] = parse_text(body["category"], "category")
    if "quantity" in body:
        changes["quantity"] = parse_quantity(body["quantity"])
    return changes


class Store(object):
    """单个 JSON 文件的读写门面；所有写操作先读旧档再合并。"""

    def __init__(self, path):
        self.path = os.path.abspath(path)
        self._lock = threading.RLock()

    # ---------------------------------------------------------------- 读取
    def _load(self):
        """返回 (doc, shape)。doc 完整保留文件内容（含未知键）。"""
        if not os.path.exists(self.path):
            return {"items": []}, "object"
        try:
            with open(self.path, "r", encoding="utf-8") as handle:
                text = handle.read()
        except OSError as exc:
            raise StoreError("无法读取数据文件 %s：%s" % (self.path, exc))
        if not text.strip():
            return {"items": []}, "object"
        try:
            raw = json.loads(text)
        except ValueError as exc:
            raise StoreError(
                "数据文件 %s 不是合法 JSON；为保护既有数据，本次操作拒绝写入：%s" % (self.path, exc)
            )
        if isinstance(raw, dict):
            doc, shape = raw, "object"
        elif isinstance(raw, list):
            doc, shape = {"items": raw}, "list"
        else:
            raise StoreError(
                "数据文件 %s 的顶层不是对象也不是数组；为保护既有数据，本次操作拒绝写入" % self.path
            )
        items = doc.get("items")
        if items is None:
            doc["items"] = []
        elif not isinstance(items, list):
            raise StoreError(
                "数据文件 %s 的 items 不是数组；为保护既有数据，本次操作拒绝写入" % self.path
            )
        return doc, shape

    @staticmethod
    def _entries(doc):
        return [entry for entry in doc["items"] if isinstance(entry, dict)]

    @staticmethod
    def _find(entries, item_id):
        wanted = str(item_id)
        for entry in entries:
            if "id" in entry and str(entry["id"]) == wanted:
                return entry
        return None

    @staticmethod
    def _new_id(entries):
        used = set(str(entry["id"]) for entry in entries if "id" in entry)
        while True:
            candidate = uuid.uuid4().hex[:12]
            if candidate not in used:
                return candidate

    # ---------------------------------------------------------------- 写入
    def _save(self, doc, shape):
        payload = doc["items"] if shape == "list" else doc
        directory = os.path.dirname(self.path) or "."
        try:
            if not os.path.isdir(directory):
                os.makedirs(directory)
        except OSError as exc:
            raise StoreError("无法创建数据目录 %s：%s" % (directory, exc))
        tmp_path = None
        try:
            fd, tmp_path = tempfile.mkstemp(prefix=".data-", suffix=".tmp", dir=directory)
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_path, self.path)  # 原子替换：不会留下半截文件
            tmp_path = None
            self._sync_dir(directory)
        except OSError as exc:
            raise StoreError("无法写入数据文件 %s：%s" % (self.path, exc))
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass

    @staticmethod
    def _sync_dir(directory):
        try:
            dir_fd = os.open(directory, os.O_RDONLY)
        except OSError:
            return
        try:
            os.fsync(dir_fd)
        except OSError:
            pass
        finally:
            os.close(dir_fd)

    # ------------------------------------------------------------ 对外接口
    def items(self):
        with self._lock:
            doc, _shape = self._load()
            return [public_item(entry) for entry in self._entries(doc)]

    def get(self, item_id):
        with self._lock:
            doc, _shape = self._load()
            found = self._find(self._entries(doc), item_id)
            return public_item(found) if found is not None else None

    def add(self, changes):
        with self._lock:
            doc, shape = self._load()
            created = {"id": self._new_id(self._entries(doc))}
            created["name"] = changes["name"]
            created["category"] = changes["category"]
            created["quantity"] = changes["quantity"]
            doc["items"].append(created)
            self._save(doc, shape)
            return public_item(created)

    def update(self, item_id, changes):
        with self._lock:
            doc, shape = self._load()
            target = self._find(self._entries(doc), item_id)
            if target is None:
                return None
            target.update(changes)  # 只覆盖传入字段，其它字段（含未知字段）原样保留
            self._save(doc, shape)
            return public_item(target)

    def delete(self, item_id):
        with self._lock:
            doc, shape = self._load()
            wanted = str(item_id)
            for index, entry in enumerate(doc["items"]):
                if isinstance(entry, dict) and "id" in entry and str(entry["id"]) == wanted:
                    del doc["items"][index]
                    self._save(doc, shape)
                    return True
            return False

    def summary(self):
        with self._lock:
            doc, _shape = self._load()
            entries = self._entries(doc)
        totals = {}
        for entry in entries:
            category = entry.get("category")
            if isinstance(category, str) and category.strip():
                key = category.strip()
            elif isinstance(category, (int, float)) and not isinstance(category, bool):
                key = str(category)
            else:
                key = UNCATEGORISED
            totals[key] = totals.get(key, 0) + coerce_quantity(entry.get("quantity"))
        return [
            {"category": category, "total_quantity": totals[category]}
            for category in sorted(totals)
        ]


def _force_utf8_stdio():
    """在 C/POSIX locale 下（stdout 编码为 ascii）也能打印中文。"""
    for name in ("stdout", "stderr"):
        stream = getattr(sys, name, None)
        if stream is None:
            continue
        encoding = (getattr(stream, "encoding", "") or "").lower().replace("-", "").replace("_", "")
        if encoding in ("utf8", "utf8mb4", "cp65001"):
            continue
        buffer = getattr(stream, "buffer", None)
        if buffer is None:
            continue
        setattr(
            sys,
            name,
            io.TextIOWrapper(buffer, encoding="utf-8", errors="replace", line_buffering=True),
        )


class AppServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, address, handler_class, store):
        ThreadingHTTPServer.__init__(self, address, handler_class)
        self.store = store


class Handler(BaseHTTPRequestHandler):
    server_version = "InventoryApp/1.0"
    protocol_version = "HTTP/1.1"

    # ------------------------------------------------------------ 基础工具
    def _read_body(self):
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            return b""
        try:
            length = int(raw_length)
        except ValueError:
            raise ValidationError("Content-Length 不合法")
        if length <= 0:
            return b""
        if length > MAX_BODY_BYTES:
            raise ValidationError("请求体过大（上限 %d 字节）" % MAX_BODY_BYTES)
        return self.rfile.read(length)

    def _read_json(self):
        raw = self._read_body()
        if not raw:
            raise ValidationError("请求体不能为空")
        try:
            return json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise ValidationError("请求体不是合法 JSON")

    def _send(self, status, payload, content_type="application/json; charset=utf-8"):
        body = payload if isinstance(payload, bytes) else payload.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_json(self, status, payload):
        self._send(status, json.dumps(payload, ensure_ascii=False, indent=2))

    def _send_error_json(self, status, message):
        self._send_json(status, {"error": message})

    def _segments(self):
        path = urllib.parse.urlsplit(self.path).path
        # 路径段逐个 percent-decode（先分段再解码，避免 %2F 改变分段）
        return path, [urllib.parse.unquote(segment) for segment in path.split("/") if segment]

    # -------------------------------------------------------------- 路由
    def do_GET(self):
        path, segments = self._segments()
        if path in ("/", "/index.html"):
            return self._serve_index()
        if segments[:1] != ["api"]:
            return self._send_error_json(404, "未知路径：%s" % path)
        return self._dispatch_api("GET", segments[1:])

    def do_HEAD(self):
        return self.do_GET()

    def do_POST(self):
        _path, segments = self._segments()
        if segments[:1] != ["api"]:
            return self._send_error_json(404, "未知路径：%s" % self.path)
        return self._dispatch_api("POST", segments[1:])

    def do_PUT(self):
        _path, segments = self._segments()
        if segments[:1] != ["api"]:
            return self._send_error_json(404, "未知路径：%s" % self.path)
        return self._dispatch_api("PUT", segments[1:])

    def do_DELETE(self):
        _path, segments = self._segments()
        if segments[:1] != ["api"]:
            return self._send_error_json(404, "未知路径：%s" % self.path)
        return self._dispatch_api("DELETE", segments[1:])

    def __getattr__(self, name):
        # BaseHTTPRequestHandler 对未实现的 do_XXX 直接回 501；这里统一改成 405 + {"error": ...}
        if name.startswith("do_"):
            return self._method_not_allowed
        raise AttributeError(name)

    def _method_not_allowed(self):
        _path, segments = self._segments()
        if segments[:1] == ["api"]:
            return self._dispatch_api(self.command, segments[1:])
        return self._send_error_json(405, "方法 %s 不支持" % self.command)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Allow", "GET, HEAD, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _serve_index(self):
        try:
            with open(INDEX_PATH, "rb") as handle:
                body = handle.read()
        except OSError as exc:
            return self._send(
                500, "index.html 无法读取：%s（%s）" % (INDEX_PATH, exc), "text/plain; charset=utf-8"
            )
        return self._send(200, body, "text/html; charset=utf-8")

    def _dispatch_api(self, method, segments):
        store = self.server.store
        try:
            if method == "GET" and segments == ["items"]:
                return self._send_json(200, {"items": store.items()})
            if method == "GET" and segments == ["summary"]:
                return self._send_json(200, {"summary": store.summary()})
            if method == "GET" and segments == ["health"]:
                return self._send_json(200, {"status": "ok", "data_file": store.path})
            if method == "GET" and len(segments) == 2 and segments[0] == "items":
                found = store.get(segments[1])
                if found is None:
                    return self._send_error_json(404, "id 不存在：%s" % segments[1])
                return self._send_json(200, found)

            if method == "POST" and segments == ["items"]:
                changes = parse_item_payload(self._read_json(), partial=False)
                return self._send_json(201, store.add(changes))

            if method == "PUT" and len(segments) == 2 and segments[0] == "items":
                changes = parse_item_payload(self._read_json(), partial=True)
                updated = store.update(segments[1], changes)
                if updated is None:
                    return self._send_error_json(404, "id 不存在：%s" % segments[1])
                return self._send_json(200, updated)

            if method == "DELETE" and len(segments) == 2 and segments[0] == "items":
                self._read_body()  # 吃掉请求体，保持 HTTP/1.1 连接整洁
                if not store.delete(segments[1]):
                    return self._send_error_json(404, "id 不存在：%s" % segments[1])
                return self._send_json(200, {"deleted": True, "id": segments[1]})

            if segments in (["items"], ["summary"]) and method in ("PUT", "PATCH"):
                return self._send_error_json(405, "方法 %s 不支持该路径" % method)
            if method not in ("GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS"):
                return self._send_error_json(405, "方法 %s 不支持" % method)
            return self._send_error_json(404, "未知的 API 路径：/api/%s" % "/".join(segments))
        except ValidationError as exc:
            return self._send_error_json(400, exc.message)
        except StoreError as exc:
            return self._send_error_json(500, str(exc))

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def log_error(self, fmt, *args):
        pass


# ====================================================================== 自测
class _Client(object):
    def __init__(self, base_url):
        self.base_url = base_url

    def call(self, method, path, body=None):
        data = None
        headers = {}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            self.base_url + urllib.parse.quote(path, safe="/?&=%"),
            data=data,
            headers=headers,
            method=method,
        )
        try:
            response = urllib.request.urlopen(request, timeout=15)
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read().decode("utf-8")
        try:
            return response.getcode(), response.read().decode("utf-8")
        finally:
            response.close()

    def json(self, method, path, body=None):
        status, raw = self.call(method, path, body)
        try:
            parsed = json.loads(raw) if raw else None
        except ValueError:
            parsed = None
        return status, parsed


def expect(condition, message):
    if not condition:
        raise TestFailure(message)


def _spawn_server(data_path):
    server = AppServer(("127.0.0.1", 0), Handler, Store(data_path))
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05})
    thread.daemon = True
    thread.start()
    base_url = "http://127.0.0.1:%d" % port
    client = _Client(base_url)
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            status, _payload = client.json("GET", "/api/health")
            if status == 200:
                return server, thread, client
        except Exception:
            pass
        time.sleep(0.05)
    _stop_server(server, thread)
    raise TestFailure("服务在 15 秒内没有就绪：%s" % base_url)


def _stop_server(server, thread):
    server.shutdown()
    server.server_close()
    thread.join(timeout=10)


def _read_json_file(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def _sha256_of(path):
    import hashlib

    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(65536)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _selftest_crud(tmp_dir, check):
    data_path = os.path.join(tmp_dir, "crud.json")
    server, thread, client = _spawn_server(data_path)
    state = {}
    try:
        def check_page():
            status, raw = client.call("GET", "/")
            expect(status == 200, "GET / 期望 200，实际 %s" % status)
            expect("<html" in raw.lower(), "GET / 没有返回 HTML 页面")
            expect("/api/items" in raw, "页面里没有引用 /api/items")
            expect("/api/summary" in raw, "页面里没有引用 /api/summary")

        def check_list_empty():
            status, payload = client.json("GET", "/api/items")
            expect(status == 200, "期望 200，实际 %s" % status)
            expect(isinstance(payload, dict) and payload.get("items") == [], "初始清单应为空：%r" % (payload,))

        def check_create():
            status, payload = client.json(
                "POST", "/api/items", {"name": "牛奶", "category": "食品", "quantity": 3}
            )
            expect(status == 201, "POST 期望 201，实际 %s（%r）" % (status, payload))
            expect(isinstance(payload, dict), "POST 应返回新建物品对象：%r" % (payload,))
            for field in ("id", "name", "category", "quantity"):
                expect(field in payload, "新建物品缺少字段 %s：%r" % (field, payload))
            expect(payload["name"] == "牛奶", "name 不一致：%r" % (payload,))
            expect(payload["category"] == "食品", "category 不一致：%r" % (payload,))
            expect(payload["quantity"] == 3, "quantity 不一致：%r" % (payload,))
            state["milk"] = payload["id"]

        def check_create_more():
            for name, category, quantity in (("面包", "食品", 2), ("电池", "用品", 5)):
                status, payload = client.json(
                    "POST", "/api/items", {"name": name, "category": category, "quantity": quantity}
                )
                expect(status == 201, "POST %s 期望 201，实际 %s" % (name, status))
                state[name] = payload["id"]
            expect(len(set([state["milk"], state["面包"], state["电池"]])) == 3, "新建 id 出现重复")

        def check_list_after_create():
            status, payload = client.json("GET", "/api/items")
            expect(status == 200, "期望 200，实际 %s" % status)
            items = payload["items"]
            expect(len(items) == 3, "期望 3 条，实际 %d" % len(items))
            names = sorted(item["name"] for item in items)
            expect(names == ["牛奶", "电池", "面包"], "清单内容不符：%r" % (names,))
            for item in items:
                expect(isinstance(item["quantity"], int), "quantity 应是整数：%r" % (item,))

        def check_get_one():
            status, payload = client.json("GET", "/api/items/%s" % state["milk"])
            expect(status == 200, "期望 200，实际 %s" % status)
            expect(payload.get("id") == state["milk"], "单条查询 id 不符：%r" % (payload,))

        def check_update():
            status, payload = client.json(
                "PUT",
                "/api/items/%s" % state["milk"],
                {"quantity": 7, "name": "牛奶(改)"},
            )
            expect(status == 200, "PUT 期望 200，实际 %s（%r）" % (status, payload))
            expect(payload.get("quantity") == 7, "返回值未体现新数量：%r" % (payload,))
            expect(payload.get("name") == "牛奶(改)", "返回值未体现新名称：%r" % (payload,))
            expect(payload.get("category") == "食品", "未传的字段被改动：%r" % (payload,))
            status, payload = client.json("GET", "/api/items/%s" % state["milk"])
            expect(payload.get("quantity") == 7, "重新查询数量仍是旧值：%r" % (payload,))
            expect(payload.get("name") == "牛奶(改)", "重新查询名称仍是旧值：%r" % (payload,))

        def check_summary():
            status, payload = client.json("GET", "/api/summary")
            expect(status == 200, "期望 200，实际 %s" % status)
            summary = payload["summary"]
            got = dict((entry["category"], entry["total_quantity"]) for entry in summary)
            # 牛奶 7 + 面包 2 = 9；电池 5
            expect(got == {"食品": 9, "用品": 5}, "汇总不符：%r" % (got,))
            for entry in summary:
                expect(set(entry.keys()) == set(["category", "total_quantity"]), "汇总字段不符：%r" % (entry,))

        def check_summary_matches_manual_sum():
            _status, payload = client.json("GET", "/api/items")
            manual = {}
            for item in payload["items"]:
                manual[item["category"]] = manual.get(item["category"], 0) + item["quantity"]
            _status, summary_payload = client.json("GET", "/api/summary")
            got = dict((entry["category"], entry["total_quantity"]) for entry in summary_payload["summary"])
            expect(got == manual, "汇总与逐条累加不一致：%r vs %r" % (got, manual))

        def check_delete():
            status, payload = client.json("DELETE", "/api/items/%s" % state["面包"])
            expect(status in (200, 204), "DELETE 期望 200/204，实际 %s" % status)
            status, _payload = client.json("GET", "/api/items/%s" % state["面包"])
            expect(status == 404, "删除后单条查询应 404，实际 %s" % status)
            _status, payload = client.json("GET", "/api/items")
            expect(len(payload["items"]) == 2, "删除后应剩 2 条，实际 %d" % len(payload["items"]))
            ids = [item["id"] for item in payload["items"]]
            expect(state["面包"] not in ids, "已删除的 id 仍在清单里")

        def check_delete_missing():
            status, payload = client.json("DELETE", "/api/items/不存在的id")
            expect(status == 404, "删除不存在的 id 应 404，实际 %s" % status)
            expect(isinstance(payload, dict) and "error" in payload, "404 响应应含 error 字段：%r" % (payload,))

        def check_update_missing():
            status, payload = client.json("PUT", "/api/items/不存在的id", {"quantity": 1})
            expect(status == 404, "更新不存在的 id 应 404，实际 %s" % status)
            expect(isinstance(payload, dict) and "error" in payload, "404 响应应含 error 字段：%r" % (payload,))

        def check_bad_quantity_negative():
            status, payload = client.json(
                "POST", "/api/items", {"name": "香蕉", "category": "食品", "quantity": -1}
            )
            expect(status == 400, "quantity 为负数应 400，实际 %s" % status)
            expect(isinstance(payload, dict) and "error" in payload, "400 响应应含 error 字段：%r" % (payload,))

        def check_bad_quantity_text():
            status, _payload = client.json(
                "POST", "/api/items", {"name": "香蕉", "category": "食品", "quantity": "abc"}
            )
            expect(status == 400, "quantity 为非数字应 400，实际 %s" % status)

        def check_bad_quantity_float():
            status, _payload = client.json(
                "POST", "/api/items", {"name": "香蕉", "category": "食品", "quantity": 1.5}
            )
            expect(status == 400, "quantity 为小数应 400，实际 %s" % status)

        def check_missing_fields():
            status, _payload = client.json("POST", "/api/items", {"name": "只有名字"})
            expect(status == 400, "缺字段应 400，实际 %s" % status)

        def check_empty_name():
            status, _payload = client.json(
                "POST", "/api/items", {"name": "   ", "category": "食品", "quantity": 1}
            )
            expect(status == 400, "空名称应 400，实际 %s" % status)

        def check_non_object_body():
            status, _payload = client.json("POST", "/api/items", ["not", "an", "object"])
            expect(status == 400, "数组请求体应 400，实际 %s" % status)

        def check_broken_json_body():
            request = urllib.request.Request(
                client.base_url + "/api/items",
                data=b"{not json",
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                response = urllib.request.urlopen(request, timeout=15)
                status = response.getcode()
                response.close()
            except urllib.error.HTTPError as exc:
                status = exc.code
                exc.read()
                exc.close()
            expect(status == 400, "非法 JSON 请求体应 400，实际 %s" % status)

        def check_put_without_fields():
            status, _payload = client.json("PUT", "/api/items/%s" % state["milk"], {})
            expect(status == 400, "PUT 无有效字段应 400，实际 %s" % status)

        def check_method_not_allowed():
            status, _payload = client.json("PATCH", "/api/items", {"name": "x"})
            expect(status == 405, "PATCH /api/items 应 405，实际 %s" % status)

        def check_unknown_api_path():
            status, payload = client.json("GET", "/api/nope")
            expect(status == 404, "未知 API 路径应 404，实际 %s" % status)

        def check_unknown_page_path():
            status, _payload = client.json("GET", "/nope")
            expect(status == 404, "未知页面路径应 404，实际 %s" % status)

        def check_atomic_write_no_temp_left():
            leftovers = [name for name in os.listdir(tmp_dir) if name.startswith(".data-")]
            expect(leftovers == [], "写临时文件有残留：%r" % (leftovers,))
            payload = _read_json_file(data_path)
            expect(isinstance(payload.get("items"), list), "数据文件结构被破坏：%r" % (payload,))

        def check_concurrent_writes():
            created = []
            errors = []
            lock = threading.Lock()

            def worker(index):
                try:
                    status, payload = client.json(
                        "POST",
                        "/api/items",
                        {"name": "并发%d" % index, "category": "并发", "quantity": index},
                    )
                    with lock:
                        if status == 201:
                            created.append(payload["id"])
                        else:
                            errors.append("HTTP %s" % status)
                except Exception as exc:  # noqa: BLE001 - 自测需要记录任意异常
                    with lock:
                        errors.append("%s: %s" % (type(exc).__name__, exc))

            threads = [threading.Thread(target=worker, args=(index,)) for index in range(20)]
            for item in threads:
                item.start()
            for item in threads:
                item.join(timeout=30)
            expect(not errors, "并发写入出现错误：%r" % (errors[:5],))
            expect(len(created) == 20, "并发写入成功数不足：%d" % len(created))
            expect(len(set(created)) == 20, "并发写入出现重复 id")
            _status, payload = client.json("GET", "/api/items")
            ids = set(item["id"] for item in payload["items"])
            missing = [item for item in created if item not in ids]
            expect(not missing, "并发写入后丢失条目：%r" % (missing[:5],))
            expect(len(payload["items"]) == 22, "并发写入后总数应为 22，实际 %d" % len(payload["items"]))
            _status, summary_payload = client.json("GET", "/api/summary")
            got = dict(
                (entry["category"], entry["total_quantity"]) for entry in summary_payload["summary"]
            )
            expect(got.get("并发") == sum(range(20)), "并发类别汇总不符：%r" % (got.get("并发"),))

        for label, func in (
            ("GET / 返回单页 HTML", check_page),
            ("GET /api/items 初始为空", check_list_empty),
            ("POST /api/items 新增返回 201 与新物品", check_create),
            ("POST /api/items 追加多条", check_create_more),
            ("GET /api/items 返回全部条目", check_list_after_create),
            ("GET /api/items/<id> 单条查询", check_get_one),
            ("PUT /api/items/<id> 更新生效且不动未传字段", check_update),
            ("GET /api/summary 按类别汇总正确", check_summary),
            ("GET /api/summary 与逐条累加一致", check_summary_matches_manual_sum),
            ("DELETE /api/items/<id> 后该 id 返回 404", check_delete),
            ("DELETE 不存在的 id 返回 404", check_delete_missing),
            ("PUT 不存在的 id 返回 404", check_update_missing),
            ("quantity 为负数返回 400", check_bad_quantity_negative),
            ("quantity 非数字返回 400", check_bad_quantity_text),
            ("quantity 为小数返回 400", check_bad_quantity_float),
            ("POST 缺字段返回 400", check_missing_fields),
            ("POST 空名称返回 400", check_empty_name),
            ("POST 请求体不是对象返回 400", check_non_object_body),
            ("POST 请求体不是合法 JSON 返回 400", check_broken_json_body),
            ("PUT 无有效字段返回 400", check_put_without_fields),
            ("不支持的方法返回 405", check_method_not_allowed),
            ("未知 /api 路径返回 404", check_unknown_api_path),
            ("未知页面路径返回 404", check_unknown_page_path),
            ("写入为原子替换且无临时文件残留", check_atomic_write_no_temp_left),
            ("20 路并发新增不丢数据", check_concurrent_writes),
        ):
            check(label, func)
    finally:
        _stop_server(server, thread)


def _selftest_preserve(tmp_dir, check):
    preset_path = os.path.join(tmp_dir, "preset.json")
    preset = {
        "items": [
            {
                "id": "keep-1",
                "name": "既有物品A",
                "category": "工具",
                "quantity": 4,
                "manual_note": "人工添加的备注，不能被抹掉",
            },
            {"id": "keep-2", "name": "既有物品B", "category": "食品", "quantity": 6},
        ],
        "schema_version": 3,
        "custom_top_level": {"anything": [1, 2, 3]},
    }
    with open(preset_path, "w", encoding="utf-8") as handle:
        json.dump(preset, handle, ensure_ascii=False, indent=2)

    server, thread, client = _spawn_server(preset_path)
    created_id = {}
    try:
        def check_preset_read():
            status, payload = client.json("GET", "/api/items")
            expect(status == 200, "期望 200，实际 %s" % status)
            ids = sorted(item["id"] for item in payload["items"])
            expect(ids == ["keep-1", "keep-2"], "既有条目未被读出：%r" % (ids,))
            for item in payload["items"]:
                expect(
                    sorted(item.keys()) == ["category", "id", "name", "quantity"],
                    "GET /api/items 的元素字段不符合契约：%r" % (item,),
                )
            doc = _read_json_file(preset_path)
            keep = [item for item in doc["items"] if item.get("id") == "keep-1"][0]
            expect(keep.get("manual_note"), "预置文件里的额外字段在服务启动后丢失：%r" % (keep,))

        def check_after_create():
            status, payload = client.json(
                "POST", "/api/items", {"name": "新增C", "category": "工具", "quantity": 2}
            )
            expect(status == 201, "POST 期望 201，实际 %s" % status)
            created_id["c"] = payload["id"]
            doc = _read_json_file(preset_path)
            expect(doc.get("schema_version") == 3, "未知顶层键 schema_version 丢了：%r" % (doc,))
            expect(
                doc.get("custom_top_level") == {"anything": [1, 2, 3]},
                "未知顶层键 custom_top_level 丢了：%r" % (doc.get("custom_top_level"),),
            )
            ids = sorted(item["id"] for item in doc["items"])
            expect(ids == sorted(["keep-1", "keep-2", payload["id"]]), "新增后既有条目丢失：%r" % (ids,))

        def check_after_update():
            status, payload = client.json(
                "PUT", "/api/items/keep-1", {"quantity": 9, "name": "既有物品A(改)"}
            )
            expect(status == 200, "PUT 期望 200，实际 %s（%r）" % (status, payload))
            doc = _read_json_file(preset_path)
            keep = [item for item in doc["items"] if item["id"] == "keep-1"][0]
            expect(keep["quantity"] == 9, "更新未落到文件：%r" % (keep,))
            expect(keep["name"] == "既有物品A(改)", "更新未落到文件：%r" % (keep,))
            expect(
                keep.get("manual_note") == "人工添加的备注，不能被抹掉",
                "条目上的额外字段被更新操作抹掉了：%r" % (keep,),
            )
            expect(doc.get("schema_version") == 3, "更新后未知顶层键丢失")
            expect("custom_top_level" in doc, "更新后未知顶层键丢失")

        def check_after_delete():
            status, payload = client.json("DELETE", "/api/items/keep-2")
            expect(status in (200, 204), "DELETE 期望 200/204，实际 %s" % status)
            doc = _read_json_file(preset_path)
            ids = sorted(item["id"] for item in doc["items"])
            expect("keep-2" not in ids, "删除后条目仍在：%r" % (ids,))
            expect("keep-1" in ids, "删除误伤其它既有条目：%r" % (ids,))
            expect(created_id["c"] in ids, "删除误伤新增条目：%r" % (ids,))
            expect(doc.get("schema_version") == 3, "删除后未知顶层键丢失")
            expect("custom_top_level" in doc, "删除后未知顶层键丢失")

        def check_summary_over_preset():
            status, payload = client.json("GET", "/api/summary")
            got = dict(
                (entry["category"], entry["total_quantity"]) for entry in payload["summary"]
            )
            # 工具：既有A 9 + 新增C 2 = 11；食品：既有B 6
            expect(got == {"工具": 11, "食品": 6}, "预置文件上的汇总不符：%r" % (got,))

        for label, func in (
            ("预置 data.json 的既有条目可读且响应字段符合契约、文件未被改写", check_preset_read),
            ("新增后既有条目与未知顶层键全部保留", check_after_create),
            ("更新既有条目时保留其额外字段与未知顶层键", check_after_update),
            ("预置文件上的类别汇总正确", check_summary_over_preset),
            ("删除仅移除目标条目且既有数据仍在", check_after_delete),
        ):
            check(label, func)
    finally:
        _stop_server(server, thread)


def run_selftest():
    results = []

    def check(label, func):
        try:
            func()
        except TestFailure as exc:
            results.append((label, False, str(exc)))
        except Exception as exc:  # noqa: BLE001 - 自测需要记录任意异常
            results.append((label, False, "%s: %s" % (type(exc).__name__, exc)))
        else:
            results.append((label, True, ""))

    default_state_before = _sha256_of(DEFAULT_DATA_PATH) if os.path.exists(DEFAULT_DATA_PATH) else None
    tmp_dir = tempfile.mkdtemp(prefix="inventory-selftest-")
    try:
        check("自测用临时数据文件、空闲端口（临时目录 %s）" % tmp_dir, lambda: None)
        _selftest_crud(tmp_dir, check)
        _selftest_preserve(tmp_dir, check)

        def check_default_data_untouched():
            now = _sha256_of(DEFAULT_DATA_PATH) if os.path.exists(DEFAULT_DATA_PATH) else None
            expect(now == default_state_before, "自测改动了默认数据文件 %s" % DEFAULT_DATA_PATH)

        def check_cleanup():
            shutil.rmtree(tmp_dir, ignore_errors=True)
            expect(not os.path.exists(tmp_dir), "临时目录未清理：%s" % tmp_dir)

        check("自测未改动默认数据文件", check_default_data_untouched)
        check("临时数据文件与临时目录已清理、无残留", check_cleanup)
    finally:
        if os.path.exists(tmp_dir):
            shutil.rmtree(tmp_dir, ignore_errors=True)

    passed = 0
    for label, ok, message in results:
        if ok:
            passed += 1
            print("PASS  %s" % label)
        else:
            print("FAIL  %s  -> %s" % (label, message))
    total = len(results)
    print("SELFTEST %d/%d PASSED" % (passed, total))
    return 0 if passed == total else 1


# ====================================================================== 启动
def main(argv=None):
    _force_utf8_stdio()
    parser = argparse.ArgumentParser(
        description="清单管理小应用：纯 Python 标准库 HTTP API + 单 JSON 文件持久化"
    )
    parser.add_argument("--host", default="127.0.0.1", help="监听地址（默认 127.0.0.1）")
    parser.add_argument("--port", type=int, default=8000, help="监听端口（默认 8000，0 表示随机空闲端口）")
    parser.add_argument(
        "--data",
        default=DEFAULT_DATA_PATH,
        help="数据文件路径（默认 <脚本目录>/data.json）",
    )
    parser.add_argument(
        "--selftest",
        action="store_true",
        help="运行内置自测（临时数据文件 + 空闲端口，结束后清理）后退出",
    )
    args = parser.parse_args(argv)

    if args.selftest:
        return run_selftest()

    data_path = os.path.abspath(args.data)
    store = Store(data_path)
    try:
        server = AppServer((args.host, args.port), Handler, store)
    except OSError as exc:
        sys.stderr.write("启动失败（%s:%s）：%s\n" % (args.host, args.port, exc))
        return 2

    try:
        store.items()
        data_state = "可读"
    except StoreError as exc:
        data_state = "异常：%s" % exc
    host, port = server.server_address[0], server.server_address[1]
    print("清单管理小应用已启动：http://%s:%d/" % (host, port))
    print("数据文件：%s（%s）" % (data_path, data_state))
    print("按 Ctrl+C 停止。")
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n正在停止……")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
