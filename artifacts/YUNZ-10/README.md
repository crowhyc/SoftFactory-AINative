# 清单管理小应用（纯标准库 Python HTTP API + 单页 HTML/JS）

父任务 `YUNZ-10` 的 Stage 1 实现产物；实现环节任务号为 `YUNZ-11`。
后端只用 Python 标准库（`http.server` / `json` / `uuid` / `urllib` 等），无第三方依赖、不联网；前端是单页
原生 HTML/JS，不引用任何外部 CDN。所有数据保存在**同一个 JSON 文件**里，任何操作都不会覆盖或丢失已有数据。

> 交付目录说明：本目录 `artifacts/YUNZ-10/` 是父任务 `YUNZ-10` 的「本轮约定」中指定的产物目录；
> 实现环节（本任务 `YUNZ-11`）的身份证默认目录为 `artifacts/YUNZ-11/`，如需改名请协调员指示。

## 1. 目录内容

| 文件 | 说明 |
| --- | --- |
| `app.py` | 后端：标准库 HTTP 服务 + 单 JSON 文件持久化 + 内置自测（`--selftest`） |
| `index.html` | 前端：单页应用，增 / 删 / 改 / 查 + 按类别汇总，原生 JS，无外部资源 |
| `data.json` | 样例数据（4 条物品 + 2 个未知顶层键，用于演示「未知键会被保留」） |
| `verify_e2e.sh` | 端到端复跑脚本：真实启动服务并用 curl 核验 API 契约与数据保全（Stage 2 可直接运行） |
| `selftest_output.txt` | `python3 app.py --selftest` 的完整输出与退出码 |
| `e2e_output.txt` | `bash verify_e2e.sh` 的完整输出与退出码 |
| `SHA256SUMS` | 以上产物的 sha256 |

## 2. 启动

```bash
cd /opt/SoftFactory-AINative/artifacts/YUNZ-10
python3 app.py                        # 默认 127.0.0.1:8000，数据文件 <脚本目录>/data.json
python3 app.py --host 0.0.0.0 --port 9000
python3 app.py --data /tmp/my-data.json     # 指定数据文件
```

启动后浏览器打开 `http://127.0.0.1:8000/` 即为单页界面（`GET /` 返回 `index.html`）。
`Ctrl+C` 停止。端口被占用时进程以退出码 `2` 退出并打印原因。

```bash
python3 app.py --selftest              # 内置自测：临时数据文件 + 空闲端口，结束自清理
```

## 3. API 契约

所有响应均为 `application/json; charset=utf-8`（`GET /` 为 HTML）。错误响应体固定为 `{"error": "<中文说明>"}`。

| 方法 | 路径 | 请求体 | 成功响应 |
| --- | --- | --- | --- |
| `GET` | `/` | — | `200` + 单页 `index.html` |
| `GET` | `/api/items` | — | `200` `{"items": [{"id","name","category","quantity"}, ...]}` |
| `GET` | `/api/items/<id>` | — | `200` + 该物品；不存在 → `404` |
| `POST` | `/api/items` | `{name, category, quantity}` | `201` + 新物品 `{"id","name","category","quantity"}` |
| `PUT` | `/api/items/<id>` | 部分或全部字段 | `200` + 更新后的物品；不存在 → `404` |
| `DELETE` | `/api/items/<id>` | — | `200` `{"deleted": true, "id": "<id>"}`；不存在 → `404` |
| `GET` | `/api/summary` | — | `200` `{"summary": [{"category","total_quantity"}, ...]}`（按类别汇总，按类别名排序） |
| `GET` | `/api/health` | — | `200` `{"status": "ok", "data_file": "<绝对路径>"}` |

字段与错误规则：

- `id`：由服务端在 `POST` 时生成（12 位十六进制）；请求体里自带的 `id` 会被忽略；其它未知字段也一并忽略。
- `name`、`category`：必填，非空字符串（去除首尾空白后判断），最长 200 字符；`POST` 缺字段、空字符串、非字符串 → `400`。
- `quantity`：非负整数。接受 JSON 整数、纯数字字符串、等于整数的浮点（`2` / `"2"` / `2.0` 均视为 `2`）；
  负数、非数字字符串、小数、`true/false`、`null`、数组/对象 → `400`。
- `PUT` 为部分更新：只覆盖传入的字段，未传字段保持原值；三个字段都没传 → `400`。
- 不支持的方法（如 `PATCH`）→ `405`；未知 `/api/*` 路径 → `404`；请求体不是合法 JSON → `400`。
- 数据文件损坏（非法 JSON、`items` 不是数组、顶层不是对象/数组）→ `500`，并且**拒绝写入**，绝不为了「成功」而清空既有数据。

示例：

```bash
curl -s http://127.0.0.1:8000/api/items
curl -s -X POST http://127.0.0.1:8000/api/items -H 'Content-Type: application/json' \
     -d '{"name":"牛奶","category":"食品","quantity":3}'
curl -s -X PUT http://127.0.0.1:8000/api/items/<id> -H 'Content-Type: application/json' -d '{"quantity":7}'
curl -s -X DELETE http://127.0.0.1:8000/api/items/<id>
curl -s http://127.0.0.1:8000/api/summary
```

## 4. 数据文件与「不覆盖 / 不丢失」的具体保证

- **位置**：默认 `<脚本同目录>/data.json`，可用 `--data <path>` 指定；父目录不存在时会自动创建。
- **结构**：顶层是对象，物品数组放在 `items` 键下；`items` 之外的其它顶层键（如样例里的 `schema_version`、`note`）原样保留。
  历史遗留的「顶层直接是数组」的旧档也能继续读写（写回时仍是数组）。
- **写入流程**：进程内加锁 → **重新读取磁盘上的旧档** → 在内存里只改动目标条目 → 写入同目录临时文件并 `fsync` →
  `os.replace` 原子替换 → `fsync` 目录。因此不会出现半截文件，临时文件也不会残留。
- **保留语义**：条目上除 `id/name/category/quantity` 之外的额外字段（例如样例中的 `"manual_note"`）在 `PUT` /
  `DELETE` / 新增其它条目时都会被保留；`PUT` 采用「合并」而非「整条替换」。
- **读取语义**：每次请求都重新读盘，因此手动编辑数据文件后无需重启即可生效；纯读操作（`GET`）不写文件。
  `GET /api/items` 的每个元素固定投影为契约中的 4 个字段（文件里的额外字段不会被删除，只是不出现在 API 响应里）。
- **损坏保护**：解析失败时拒绝写入并返回 `500`，不会把无法解析的旧档覆盖成空档。
- **并发**：内置线程锁，20 路并发 `POST` 已验证无丢失（见自测）。

## 5. 自测与复跑

```bash
# 内置自测：临时数据文件 + 空闲端口，结束自动清理；逐条打印 PASS/FAIL；退出码 0 = 全部通过
python3 app.py --selftest            # 本次结果：SELFTEST 33/33 PASSED，exit 0

# 端到端复跑：真实启动 app.py，用 curl 核验 API 契约 + 文件级数据保全，全程在临时目录内
bash verify_e2e.sh                   # 本次结果：E2E 28/28 PASSED，exit 0
```

`--selftest` 覆盖：页面可访问、增删改查、单条查询、按类别汇总（含与逐条累加比对）、删除后 `404`、
非法输入 `400`（负数量 / 非数字 / 小数 / 缺字段 / 空名称 / 非对象体 / 非法 JSON / `PUT` 空体）、`405`、未知路径 `404`、
写入原子性与临时文件残留、20 路并发新增不丢数据、预置文件（既有条目 + 额外字段 + 未知顶层键）在增删改后完整保留、
自测不触碰默认 `data.json`、临时目录已清理。完整输出见 `selftest_output.txt`。

`verify_e2e.sh` 额外做了文件级断言：预置文件中的 `keep-1` 更新后 `manual_note` 与两个未知顶层键仍在、
已删除条目确实从文件消失、条目总数为 2、目录内无 `.data-*` 临时文件残留。完整输出见 `e2e_output.txt`。

## 6. 已知限制

1. 无鉴权、无 HTTPS：默认只监听 `127.0.0.1`，如需对外请自行加反向代理与访问控制。
2. 并发保护仅限**单进程**（进程内线程锁）。多个进程同时写同一个数据文件不保证互斥，需要时请自行加文件锁。
3. 每次写入都是整档重写：数据量非常大（数万条以上）时写入延迟会上升。
4. 数据文件被外部改坏（非法 JSON）时接口返回 `500` 并拒绝写入，需人工修复文件（这是刻意的保护行为）。
5. 前端依赖较新的浏览器能力（`fetch`、`closest`、`Object.keys` 等），未做 IE 兼容。
6. 本机 Python 为 3.6.8，`app.py` 对 Python 3.6+ 均可运行（`ThreadingHTTPServer` 在 3.6 上缺失，代码内已做兼容回退）。
7. 本机 locale 为 `C`，`python3` 的 stdin/stdout 默认是 ASCII；`app.py` 内部已把自身输出切换为 UTF-8，
   但用 `python3 -c "..."` 直接打印中文的自制脚本仍需自行设置 `PYTHONIOENCODING=utf-8`。

## 7. 对「本轮约定」的逐条对应

| 约定 | 落实 |
| --- | --- |
| 交付目录 / 提交信息 | 产物在 `artifacts/YUNZ-10/`；提交信息 `task(YUNZ-10)：…`；只提交本目录 |
| 纯标准库、前端不联网 | `app.py` 仅 import 标准库；`index.html` 无任何外部 `src/href`（已静态检查） |
| 单 JSON 文件 + 原子写 + 保留既有数据 | 见第 4 节；`os.replace` + `fsync`；未知顶层键与条目额外字段保留 |
| 启动方式 | `python3 app.py [--host] [--port] [--data]`，`GET /` 返回单页 |
| API 契约 | 见第 3 节，已写进本 README |
| `--selftest` | 临时数据文件 + 空闲端口、自清理、逐条 PASS/FAIL、退出码语义：33/33 PASSED / exit 0 |
| 权限边界 | 只写 `artifacts/YUNZ-10/`；未改 `artifacts/INDEX.md`；未置 `done`（保持 `in_review` 交 Stage 2） |
