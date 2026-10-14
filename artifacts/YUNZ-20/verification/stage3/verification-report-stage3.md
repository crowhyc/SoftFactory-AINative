# WC-001 / YUNZ-20 独立验证报告（Stage3 复验）

- 任务：`YUNZ-24`（Stage3 复验，执行者：独立验证工程师 AI-QV）；Work Case：`YUNZ-20`。
- 被验证产物（只读）：`/opt/wbs-rongcheng/`（运行态 + 源码）、交付快照 `artifacts/YUNZ-20/wbs-rongcheng/`、运行态页面资源（HTTP `127.0.0.1:4180`）；输入基线 `/opt/wbs-rongcheng-staging/WC-001/` 仅作比对，未修改。
- 本轮验证范围：缺陷 D-1 / D-2 复现路径闭环 + 受影响原验收用例（3、8）+ 验收条件 1–10 全量回归 + 交付三链核验 + 口径复核。
- 复验时间：2026-10-14 15:03:47 – 15:04:52（+0800，Asia/Shanghai）。一轮总控：`run-all.out`。
- **结论：通过**（D-1 / D-2 复现路径均已闭环，验收 1–10 全部复跑通过，未引入回归；无新增缺陷）。

## 0. 方法、环境与限制

- 环境：node v24.21.0（容器内）、jsdom 30.1.2（仅装在验证工作目录 `.../yunz-24-ebc21e7f6b92/workdir/verify/node_modules`，未进交付目录、未进镜像）、Python 3.6.8（系统编码 ascii，故三链核验改用 bash + sha256sum + git 实现）、Docker 26.1.4、curl、git 1.8.3.1。
- 运行时资源来源：本轮所有 DOM/导出验证都先用 `curl` 从 `127.0.0.1:4180` 抓取运行态 `index.html / app.js / styles.css / template.xlsx / vendor/xlsx.full.min.js`（落在 `served/`），再用 jsdom 执行**运行态字节**（→ `served-integrity.log` 证明 served == 磁盘交付源码）。
- 网络模型（延续 Stage2 已批准口径）：宿主 `node` 是 `docker run` 包装脚本，默认 bridge 命名空间看不到宿主回环；本轮统一用 `docker run --network host` 直连 `127.0.0.1:4180`（证据：`export-run.log`、`dom-verify.log`）。
- 现场部署未被破坏：收尾 `GET /api/health` = `{"ok":true,...,"revision":0}`，`data/wbs.json` sha256 = `a3632236d54731f21dffd2a9fd41f9b3ea0829f777da4f09aba7f143d9f04aa5`（= 复验前快照 `start-state.txt` / `scripts/wbs.json.pre-qv`）。期间只有持久化用例执行了一次 `docker restart`（镜像 `wbs-rongcheng:20261014144403` 未变）。
- 两条证据链分开记录：**链 A 作者修复自报**（YUNZ-23 交付评论 `01a1392c-14ca-7c24-8aed-de3b7719b75b`、`selftest/`、`SHA256SUMS`）与**链 B 本轮独立复跑**（本目录日志）分别成链；核对时间 2026-10-14 15:01–15:05 (+0800)。**未以作者自报作为判定依据。**

## 1. 两条证据链核对（作者修复主张 vs 我的复跑）

| 作者主张（链 A，YUNZ-23） | 我的复跑（链 B） | 判定 |
| --- | --- | --- |
| D-1：页面 `loadExportWorkbook` 与自测共用 `Core.buildExportWorkbook`，导出恢复 `<cols>` | `export-cols-check.log` D1-2/D1-3；`export-cols-compare.log`：两条路径导出 sha256 同为 `9925d8d6…` | 一致 |
| 现场页面导出 1172751 字节、`<col>` 16384 条、A–K 逐列一致（K `47.2592592592593`） | `export-meta.json` 1172751 字节；`cols-check` A–K 11/11 一致、K = `47.2592592592593` | 一致 |
| D-2：序号列 `td.cell-id` 绑定 `showReadOnlyHint`，与相邻只读单元格同模板 | D2a/D2b PASS；`dom-adv-detail.json` 中该目标 `silent:false` | 一致 |
| 快照 20 文件与运行产物逐字一致、`SHA256SUMS` 60 条自校验、提交 `e9e844e` 已 push | `integrity.log` I1 60/60、I2 mismatch=0、I3 三链一致、I4 HEAD==origin/main==`e9e844e` | 一致 |
| 22 项自测矩阵全通过（含 04b/12b） | 我另起 37 条 DOM + 13 条服务 + 13 条导出/完整性断言全通过，未依赖其自测输出 | 一致 |
| 未扩大范围（styles/镜像/host 网络/中间产物仍列待决） | 复跑确认这些项本轮无改动（见第 7 节） | 一致 |

## 2. 缺陷 D-1 闭环（导出列宽）

- 复现路径：抓取运行态页面资源 → jsdom 进入「项目负责人」→ 点击工具栏「导出 Excel」（`#export-btn`）→ 捕获下载文件 → Python 标准库 `zipfile` 读 `xl/worksheets/sheet1.xml`。证据：`export-run.log`、`exported-stage3.xlsx`、`export-cols-check.log`、`scripts/export-page.js`、`scripts/cols-check-stage3.py`。
- 断言结果（全部 PASS）：
  - 修复前对照：`verification/exported.xlsx` sha256 `626b269a600fda39956907b60ccc6c51af2596fb386a33eaed74d52827aa0440`，32762 字节，**无 `<cols>`**。
  - 修复后：`exported-stage3.xlsx` sha256 `9925d8d6cdb62dff662b5ddd0d5c263a68d1f8a8afeb8c93f3b2c402acbbabd0`，1172751 字节，**`<cols>` 存在 / `<col>` 16384 条**。
  - A–K 列宽与源模板**逐列一致 11/11**：`11.3333333333333, 11.3333333333333, 13.7777777777778, 11.3333333333333, 11.3333333333333, 13.1111111111111, 13.1111111111111, 13.1111111111111, 13.1111111111111, 16.2222222222222, 47.2592592592593`；**K = 47.2592592592593**。
  - 运行态模板 `template.xlsx` sha256 `e01c269699adad8df3c28c05cff0634c7a1fbe4a62bb5ef2a3baf51490317483` = 输入基线 `src/public/template.xlsx`（逐字一致）。
- 自测路径与页面路径统一（运行时可复现证据，非源码断言）：用运行态 `app.js` 的 `Core.buildExportWorkbook`（作者 `tests/exportcheck.mjs` 调用的同一函数）另生成一份导出，两份文件 **sha256 完全相同**（`9925d8d6…`）→ 双路径差异（修复前 `626b269a…` 无 `<cols>` vs `5ea26bf8…` 有 `<cols>`）已消除。证据：`selftest-path-cols.log`、`exported-selftest-path-stage3.xlsx`、`export-cols-compare.log`。
- 回归受影响原验收用例 8（导出文本口径）：`export-readback.log` 全通过 —— 第 1 行 `A1,B1,C1,D1–H1` 逐字一致、第 2 行 `A2–K2` 逐字一致、数据区 A–K 共 11 列（`cols_used=[1..11]`）、导出数据行数 36 == 当前 JSON 36、`A3:K38` 逐格与 JSON 映射 mismatch=0、不含 `status`、`A1:C1` 合并保持、非数据区 14 格保留；列表宽观察：A–K 逐列保持。

## 3. 缺陷 D-2 闭环（序号列只读提示）

- 复现路径：jsdom 以「王言」进入工作台 → 点击任意行序号列单元格 `td.cell-id` → 读取页面提示区 `#hint`；与相邻只读单元格（进展说明）对照。证据：`dom-verify.log` D2a/D2b、`dom-adv-detail.json`、`scripts/dom-verify-stage3.js`。
- 实际提示：`当前身份「王言」对第 T001 行的「序号」只读（仅“负责人 == 自己”的行、且仅非结构性字段可改）` —— 明确中文只读提示，未进入编辑态（`editorOpened=false`），`silent=false`（Stage2 `silent:true` 目标已消除）。
- 一致性：序号列提示与「进展说明」列提示去除字段名后**文案模板完全相同**（D2b PASS）。
- 重跑 Stage2 对抗探测（11 个目标）：4 个权限受限单元格 + 序号列单元格均给出只读提示（`silent=false`）；`C-ADV2` 确认展示型元素点击不进入编辑、不改页面结构（36 行不变）。
- 回归受影响原验收用例 3：`C3a–C3o` 全通过 —— 王言本人行 8 个可编辑字段经页面编辑入口修改后页面显示与期望一致、保存后页面/API/磁盘三端一致（revision 0→1、PUT 1 次）、王言他人行与结构字段只读且有提示、李欢同理、项目负责人可编辑他人行、普通负责人不可见新增/删除入口。另 `S11` 证明重启后王言仍可读可写。

## 4. 验收条件 1–10 逐条复跑

| # | 验收口径 | 复跑方式 | 结论 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | 九身份入口/进入/刷新保持/切换即时生效 | jsdom 点击身份、新实例 + localStorage 预置、切换 select | 通过 | `dom-verify.log` C1a–C1e |
| 2 | 渲染 36 行、顺序与 Excel 第 3–38 行一致 | jsdom 行序 vs seed；python 读源模板 A3:D38 vs JSON | 通过 | C2a–C2d；E10 |
| 3 | 王言本人行可编辑且三端一致；他人行不可编辑 | jsdom 逐字段编辑 + 保存 + API + 磁盘；李欢复跑 | 通过 | C3a–C3o、S11 |
| 4 | 项目负责人可编辑任意行、新增、删除（确认框） | jsdom 新增/确认取消/确认删除 + 三端 | 通过 | C3f–C3i、C4a–C4d |
| 5 | 空表单/非法输入前置校验报错、不产生 API 调用与写入 | jsdom 空任务项、2001 字符超长；API 层 400 | 通过 | C5a/C5b（PUT 增量 0）；S5 |
| 6 | 原子写；重启后数据仍在 | 代码核对 + `docker restart` 后全量比对 | 通过 | S10 |
| 7 | 连续 10 次保存 A–K 无丢失/重复/未知字段被清除 | 10 次连续 PUT + 三端比对 | 通过 | S9 |
| 8 | 导出读回：1/2 行逐字、A–K 11 列、行数==JSON、无 status | 页面导出 + python 标准库读回 | 通过 | E1–E7、E9、E10、C8a |
| 9 | 并发旧版本保存 409、不静默覆盖 | 过期 If-Match 409；两线程同版本 PUT | 通过 | S6、S8（codes=[200,409]） |
| 10 | health ok；静态资源本地；无跨域外链 | curl/urllib + jsdom 运行期请求记录 + 源码扫描 | 通过 | S1–S3、S12；C10a/C10b |

回归重点复核（本轮修复面）：5（`C5a/C5b` PUT=0、`S5` 400 且磁盘 sha 不变）、9（`S8` 恰好一个 200 + 一个 409、胜者数据落盘）、10（`S12` 五个静态资源同源 200 + CSP `default-src 'self'`、`C10a` 跨域请求 0、`C10b` 源码无外链）——**均未回归**。

## 5. 交付三链核验

`integrity.log`（7/7 PASS）：I1 `SHA256SUMS` 60/60 自校验；I2 快照 20 文件与 `/opt/wbs-rongcheng` 运行态源码逐字一致（mismatch=0，无 live 侧多余源码）；I3 `SHA256SUMS` 记录 = 磁盘实际 = git HEAD blob（60/60）；I4 HEAD == `origin/main` == `e9e844e24b0a9f26e49f3060d9a1493772fdb91e`（提交信息 `task(YUNZ-20)：缺陷修复`）；I5 修复提交仅改动 `artifacts/YUNZ-20/`（未触及 `server.js`/`deploy/`，回归面收窄）；I6 独立正则扫描无凭据样式字符串；I7 复跑作者 `tests/scan_secrets.sh` 退出码 0。
运行态资源一致性（`served-integrity.log`）：`index.html f137a68d…`、`app.js 53cc2bd3e60e0a948712484dd61903c093a7b1c394ffb48c2079a55b74f18f5e`、`styles.css e6b61b37…`、`template.xlsx e01c2696…`、`vendor/xlsx.full.min.js c9506197…` —— HTTP 抓取字节与磁盘交付源码 **5/5 SAME**（证明现场容器运行的就是被验证的修复版）。

## 6. 口径复核（Stage1 待决事项 #1 / selftest/12.log）

- `selftest/12.log`（链 A）现表述为「列宽设置保持原样（A–K 11 列宽逐列一致，含 K 进展说明列 47.2592592592593 ≈ 47.26）」，并新增「导出文件含 `<cols>` 列宽定义 … 页面导出路径修复前无 `<cols>`（缺陷 D-1）」的回归断言——**与我的复跑事实一致**（链 B：D1-3/D1-4）。
- Stage1 交付评论 `01a138fd-241c-79ff-971f-40c6fd005c50` 待决事项 #1 原文含「文本、合并、列宽、非数据单元格值均不变」。其中「列宽不变」在**修复前不成立**（Stage2 D-1 已证）、在**修复后成立**（本轮 D1-3）。该历史评论正文未改写（属历史记录），修复态产品口径已由 `selftest/12.log` 与 YUNZ-23 交付评论据实说明，判定：**口径已与事实一致，无需新增缺陷**。
- 自测路径与页面路径已统一：页面 `loadExportWorkbook` → `Core.buildExportWorkbook`，且运行时两条路径产物 sha256 相同（第 2 节）。

## 7. 缺陷与残余风险

- **本轮缺陷：无**（D-1、D-2 复现路径均闭环，无新增缺陷）。
- 残余风险与待 Sponsor 决定（延续 Stage2 口径，本轮未改动、未代决策）：
  1. 导出视觉保真：`styles.xml` 26197→1572 字节、数据区/A1 行带样式索引单元格 396→0 / 22→0（`export-readback.log` 量化）；导出文件因按列展开含 16384 条 `<col>`，体积约 32KB→1.17MB。列宽与文本、合并、非数据单元格值均已保真（本轮实测）。
  2. 基础镜像 `node:24-slim` 与设计示例 `node:20-slim` 不一致（为满足构建期不回外网，沿用本机缓存镜像）。
  3. 容器 `--network host` 网络模型（进程真实仅绑回环 `127.0.0.1:4180`，`ss -ltn` 未见非回环监听）。
  4. 运行目录中间产物：`tests/.tools/`（1852 文件）与 `tests/.tmp/`（76 文件）留在运行目录，不在交付快照/镜像内；本轮 `svc-verify` 的读写使 `data/audit.log` 由 6088 → 9896 字节（运行审计记录，非契约字段）。
  5. 展示型元素的点击反馈：`td.cell-op` 空单元格、页脚汇总计数、页脚图例、表头「序号」标题点击仍无提示（Stage2 本轮约定已按「展示型元素、点击不进入编辑、不破坏页面结构」接受，不在 D-2 范围；如需与只读单元格完全统一，可另开打磨任务）。
  6. 回环可达性：本机 `node` 包装脚本处于 bridge 命名空间，直连 4180 会 `ECONNREFUSED`；任何后续 node 直连验证须沿用 `--network host`。

## 8. 证据文件清单（本目录）

| 文件 | 内容 |
| --- | --- |
| `run-all.out` | 一键复跑总控（时间戳、各步退出码、收尾 health/数据 sha256） |
| `start-state.txt`、`scripts/wbs.json.pre-qv` | 复验前现场快照（health / 数据 sha256 / 容器镜像）与数据副本（收尾已恢复一致） |
| `served-integrity.log`、`served/` | 运行态（4180）页面资源抓取与 served vs 磁盘逐字一致性 |
| `integrity.log` | 交付三链一致性 I1–I7（含修复提交范围与凭据扫描） |
| `dom-verify.log`、`dom-results.json`、`dom-adv-detail.json` | DOM 交互级 37 条判定（验收 1–7、10 + 对抗探测 + D2a/D2b） |
| `export-run.log`、`exported-stage3.xlsx`、`export-json-snapshot.json`、`export-meta.json` | 运行态页面「导出 Excel」入口产物与导出时刻 JSON 快照 |
| `export-cols-check.log` | 缺陷 D-1 闭环断言（`<cols>` 存在 + A–K 逐列一致 + 修复前对照） |
| `export-readback.log` | python 标准库读回（验收 8 / 验收 2 Excel 侧 + 列宽观察 + 样式量化） |
| `selftest-path-cols.log`、`exported-selftest-path-stage3.xlsx`、`export-cols-compare.log` | 自测共用函数路径产物与两路径 sha256 逐字节对照 |
| `svc-verify.log` | 服务/API/持久化/并发/部署（S1–S14） |
| `push-receipt.txt` | 本报告提交推送回执（HEAD / origin/main / 提交序列） |
| `scripts/` | 本轮全部复跑脚本（可复现：`run-all-stage3.sh` 为一键入口） |
