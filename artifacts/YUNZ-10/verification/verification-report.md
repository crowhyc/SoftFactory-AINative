# YUNZ-10 Stage 2 独立验证报告（清单管理小应用）

- 验证任务：`YUNZ-12`（Stage 2 独立验证，AI-QV）
- 被验证对象：父任务 `YUNZ-10` 的 Stage 1 交付（实现任务 `YUNZ-11`），目录 `/opt/SoftFactory-AINative/artifacts/YUNZ-10/`
- 验证时间（UTC）：2026-09-30T02:47Z ~ 02:52Z；环境：Python 3.6.8 / Linux x86_64
- 验证人员独立性声明：本报告全部结论基于验证方自研脚本的复跑结果；实现者自报输出仅作为对照项，不作为证据。
- 本轮验证范围：`/opt/SoftFactory-AINative/artifacts/YUNZ-10/` 内本轮产物（`app.py` / `index.html` / `data.json` / `README.md`）。

## 0. 结论

**通过但有待决项。** 本轮约定 6 项验证范围逐项复跑全部通过（15/15 自研用例 + 9 组环境/自测用例），未发现功能性缺陷；待决项 2 项均为「风险接受」与「证据缺口」，非功能失效。

## 1. 交付物核验（两条证据链）

| 交付物 | 磁盘 sha256（验证方实测） | 平台附件 sha256 | 作者自报 / SHA256SUMS | 一致性 |
| --- | --- | --- | --- | --- |
| `app.py` | `c4a1b1218cddb5b2d396f7f669c551de75edc39d484c1c0da0c595dd5fd31930` | 同左 | 同左 | 一致 |
| `index.html` | `92b6cc19f26061866fb557ec19c84720035d4d8e0e7fabc6dfb5c9613f8160dc` | 同左 | 同左 | 一致 |
| `data.json` | `f28d242a62bfb9b4419865a5f1e79cb33f6bec62d26cb5d608f760c990893e2e` | 同左 | 同左 | 一致 |
| `README.md` | `50a42736689922aa7855d8f86b70c074e0ff590dbb0aeb11ece49c4d38ee3498` | 同左 | 同左 | 一致 |

- `sha256sum -c SHA256SUMS` → 7/7 OK（含 `verify_e2e.sh`、`selftest_output.txt`、`e2e_output.txt`）。
- git：交付提交 `937b983` 只改 `artifacts/YUNZ-10/` 下 8 个文件，未触碰 `artifacts/INDEX.md`；工作区与 HEAD 一致。
- 结论：交付物可定位、可核验，三条来源（磁盘 / 平台附件 / 自报清单）哈希完全一致。
- 说明：实现者提出的「目录名 `YUNZ-10` vs 身份证目录 `YUNZ-11`」不构成本轮待决项——该路径由 Stage 1 与 Stage 2 任务契约共同指定。

## 2. 验证证据（关键结果）

| # | 用例 | 结果 | 证据 |
| --- | --- | --- | --- |
| A | 验证方自研 e2e（12 用例：页面/CRUD/汇总/保全/只读不写/非法输入/原子读/损坏保护/写失败保护） | 12/12 PASS，exit 0 | `independent_verify_output.txt` |
| B | 边界对抗（HEAD、顶层数组旧档+非对象元素、未知字段不入档） | 3/3 PASS，exit 0 | `edge_cases_output.txt` |
| C | 环境/自测（E1–E9：哈希核对、import 扫描、隔离运行、默认启动、自测退出码、多进程并发） | E1–E8 全部符合预期；E9 见缺陷 D1 | `env_selftest_output.txt` |
| D | 复跑实现者脚本 `bash verify_e2e.sh` | `E2E 28/28 PASSED`，exit 0（与自报一致） | `author_e2e_rerun.txt` |
| E | 复跑 `python3 app.py --selftest` | `SELFTEST 33/33 PASSED`，exit 0 | `env_selftest_output.txt` E5 |

逐项对照「本轮验证范围」：

1. **启动与静态页**：`python3 app.py` 默认 `127.0.0.1:8000` 启动成功，`GET /` → 200 `text/html`，单页含增/删/改/查与汇总、无任何外部 `src/href`；`GET /api/health|items|summary` 均 200。只读访问前后默认 `data.json` sha256 不变（E8）。
2. **CRUD 端到端**：`POST` → 201 且返回新物品、增后可查；`PUT` 数量 4→9 复查生效、未传字段与条目额外字段 `manual_note` 保留；`DELETE` → 200，删后该 id → 404、重复删除 → 404（A 组第 3/4/7 项）。
3. **汇总正确性**：多类别跨条目 `GET /api/summary` = 工具 11 / 食品 6，与逐条累加结果逐键相等（A 组第 6 项）。
4. **数据不覆盖 / 不丢失**：预置含未知顶层键 `schema_version`/`custom_top_level`/`note`、条目额外字段 `manual_note`、以及非对象元素与「顶层数组」旧档的用例，连续增删改后三类数据全部保留、写回形状不变；写入为「同目录 tempfile + fsync + `os.replace`」，并发写期间连续读文件 0 次读到非法/空档、无 `.data-*` 残留；写入不可用时 `POST` → 500 且既有文件 sha256 不变；数据文件非法 JSON → 500 且拒绝写入、原文件字节不变（A 组第 3/4/7/10/11/12 项、B 组第 2 项）。
5. **纯标准库 / 不联网**：`app.py` 顶层 import 全为标准库（`argparse io json os shutil sys tempfile threading time urllib.* uuid http.server`，另含 `socketserver` 与 `hashlib` 回退/自测用）；`python3 -I -S app.py --selftest`（无 site-packages）→ 33/33 PASS exit 0；`index.html` 无外部 URL；代码内出现的 URL 仅 `127.0.0.1`（E2/E3/E7）。
6. **`--selftest`**：正常路径 33/33 PASS exit 0；FAIL 路径构造（复制 `app.py` 但移除 `index.html`，不改原实现）→ `FAIL GET / 返回单页 HTML -> 期望 200，实际 500`，`SELFTEST 32/33`，**exit 1**；自测使用临时数据文件+空闲端口、结束清理、不触碰默认 `data.json`（E5/E6）。

## 3. 缺陷与残余风险（按严重度排序）

**D1（严重度：低–中；已披露）多进程并发写同一数据文件会丢失更新。**
- 复现路径：对同一 `--data` 文件启动 2 个 `app.py` 实例，各发起 50 次 `POST /api/items`（共 100 次），结束后文件中仅 81 条，丢失 19 条（约 19%）；文件仍为合法 JSON，未知顶层键保留。
- 影响范围：同一数据文件被 ≥2 个进程同时写入（重复启动、多用户共享同一文件）。**不触发**于单进程场景——进程内 20 路并发由自测覆盖，且本报告 A 组第 10 项在并发写期间连续读文件未观察到非法/空档。
- 依据：`env_selftest_output.txt` E9；`README.md` §6.2 已把该行为列为已知限制。修复方式（如需）为跨进程文件锁，属变更范围，验证方不代改。

**D2（严重度：低；证据缺口）前端未做真实浏览器交互验证。**
- 本环境无可用浏览器（`chromium/firefox` 均不存在，`node_modules` 中无 puppeteer/playwright），故 `index.html` 的交互未在真实渲染环境下点击验证。
- 已完成的替代证据：单页 HTML 200 返回、结构静态检查（含添加表单与 `/api/items`、`/api/summary` 引用）、内联 JS 通过 `node --check` 语法检查、其调用的全部端点已实测可用且与 README 契约一致。**结论：不足以判定前端有缺陷，但浏览器级行为仍属未覆盖证据。**

**残余风险（不构成缺陷，供 Sponsor 决策参考）**
1. 无鉴权、无 HTTPS，默认仅监听 `127.0.0.1`；对外暴露需自加反向代理与访问控制。
2. 每次写入整档重写，数万条以上数据量时写入延迟上升。
3. 数据文件被外部改坏时返回 500 并拒绝写入，需人工修复后才能继续写（本次实测行为与文档一致，属刻意保护）。
4. 前端依赖较新浏览器 API（`fetch`/`closest` 等），未做旧浏览器兼容。
5. 多进程并发丢失更新（同 D1）。

**未发现其他功能性缺陷。**

## 4. 证据文件清单（同级目录）

| 文件 | 说明 |
| --- | --- |
| `verification-report.md` | 本报告 |
| `independent_verify.py` / `independent_verify_output.txt` | 验证方自研 e2e harness（12 用例）与输出 |
| `edge_cases.py` / `edge_cases_output.txt` | 边界对抗用例（3 用例）与输出 |
| `verify_selftest_and_env.sh` / `env_selftest_output.txt` | 环境、静态、自测退出码、默认启动、多进程并发（E1–E9） |
| `author_e2e_rerun.txt` | 复跑实现者 `verify_e2e.sh` 的输出（对照链） |
| `index_inline.js` | 从 `index.html` 提取的内联 JS（`node --check` 输入） |
| `EVIDENCE-SHA256SUMS` | 上述证据文件的 sha256 |

## 5. 待决项（需 Sponsor / 协调员决定，验证方不代决）

1. **D1 风险接受**：多进程并发丢失更新是否需要修复（加文件锁）或按「单进程本地应用」接受该限制。
2. **D2 证据缺口**：是否需要补充真实浏览器（或 GUI 环境）下的前端交互验证。
