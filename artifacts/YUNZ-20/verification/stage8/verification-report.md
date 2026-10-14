# Stage8 独立复验报告：WC-001 变更包 #2（CH-1…CH-7，真实浏览器 + 导出/日报读回）

- 任务：`YUNZ-28`（Stage8 独立复验，独立验证工程师 AI-QV）
- 被验证对象：`YUNZ-27`（Stage7 变更包 #2 实现与自测，含 Sponsor 追加的 CH-6 / CH-7）
- 复验时间：2026-10-14 20:42–20:56（+08）
- 被验证产物（只读）：`/opt/wbs-rongcheng/`、运行中服务 `http://127.0.0.1:4180`（`0.0.0.0:4180`）、`data/wbs.json`、`data/audit.log`、源码快照 `/opt/SoftFactory-AINative/artifacts/YUNZ-20/wbs-rongcheng/`
- 结论：**通过但有待决项**（本轮未发现功能缺陷；4 项原决策包残余风险按 Sponsor 要求状态「待 Sponsor 决策」，不由 AI-QV 自行接受或关闭）

## 0. 结论判定依据

- 真实浏览器断言（Chromium 140.0.7339.16，打运行现场 4180）：**PASS=79 / FAIL=0**（`logs/02-live-browser-console.log`）
- 导出与日报读回（Python 标准库 `zipfile` + `xml.etree`，AI-QV 自研读回器）：**PASS=22 / FAIL=0**（`logs/05-readback.log`）
- 隔离实例（旧数据兼容 / 并发 409 / CH-7 反例 / 重启持久）：**PASS=14 + 5 / FAIL=0**（`logs/08-iso1.log`、`logs/09-iso2.log`）
- 旧格式导出读回：**PASS=20 / FAIL=0**（`logs/11-legacy-readback.log`）；请求面同源断言 **PASS=3**（`logs/03-network-resources.txt`）
- 合计 143 条断言全通过；**交互级验证与日报读回均已完成且通过**，故不判「待你决定」/「不通过」；因 Sponsor 要求 4 项残余风险留待其一并答复，判「通过但有待决项」。

## 1. 本轮约定（被验证范围与证据要求）

- 本轮验证范围 = 变更包 #2 全部七项（CH-1…CH-7）+ Sponsor 指定的不回归范围（D-3、验收 1/3/4、`/api/health`、重启持久、并发 `PUT` 409 非覆盖、身份选择 → 工作台 → 九身份切换 → 双身份权限抽查）+ D-0006 绑定口径（`0.0.0.0:4180`）。
- 必测矩阵按派发原文执行：CH-1 操作列（进入编辑态 / 删除可见性 / 确认框取消与确认）、CH-2 日期与状态常显（真实浏览器 computed/属性态）、CH-3 负责人池化三端一致、CH-4 新增人员（入口可见性 + 校验 + 四处同步 + 刷新/重启持久）、CH-5 日报导出（双 sheet + 字段级读回 + `/api/history` 交叉核对 + `date`/`tz` 边界）、CH-6 M1 导出日期标签、CH-7 新增人员审计（含三类反例）。
- 不修改被验证实现代码；`/opt/wbs-rongcheng` 下所有源码 sha256 全程与快照一致。发现缺陷只按缺陷块回到缺陷流程（本轮无需要修复的缺陷）。
- 运行器与脚本置于本目录 `scripts/`，可复跑：`bash scripts/run-live.sh`、`bash scripts/run-isolated.sh`、`python3 scripts/qv-readback.py …`。

## 2. 两条证据链（分开记录，不互相采信）

1. **作者自报链（AI-IE / Stage7）**：交付评论 `YUNZ-27` 评论 `01a13a6b-fb84-7b63-a5d8-0226113d9cc0`（+08 20:38:37）＋ 自测证据 `artifacts/YUNZ-20/selftest/stage7/`。核对时间（+08）20:42–20:44。作者自报的 4 项哈希（`server.js` `0e6703b9…`、`public/app.js` `7db0a47a…`、`SHA256SUMS` `5b2482cb…`、`stage7/README.md` `e67bab2e…`）经 AI-QV 独立计算**全部一致**；作者自报的浏览器/服务端矩阵输出**不作为**本轮结论证据。
2. **AI-QV 自跑链（本轮，结论唯一依据）**：`scripts/qv-browser-live.cjs`（真实浏览器 + API + 磁盘三端）、`scripts/qv-readback.py`（标准库读回）、`scripts/qv-iso1.cjs` / `qv-iso2.cjs`（隔离实例）、`scripts/qv-network.cjs`（请求面），执行时间（+08）20:42–20:56，输出见第 8 节清单与 `input-receipt.txt`。

## 3. 部署到位核验（变更确已在 4180 对外提供）

- served（运行态 HTTP 返回）vs `/opt/wbs-rongcheng/public` vs 源码快照：`index.html` `3f73e1c1…`、`app.js` `7db0a47a…`、`styles.css` `8b3d6392…`、`template.xlsx` `e01c2696…`、`vendor/xlsx.full.min.js` `c9506197…` 五件逐字节 MATCH。
- 容器内 `/app`（`server.js` `0e6703b9…` + `public/*`）vs 运行目录 vs 源码快照：逐字节 MATCH。
- 绑定与健康（D-0006）：`ss -ltn` 为 `*:4180` LISTEN，容器 `WBS_HOST=0.0.0.0`、`--network host`；`http://127.0.0.1:4180/api/health` 与 `http://0.0.0.0:4180/api/health` 均 `{"ok":true,…}`；重启后仍一致（`logs/01*`、`logs/07`、`logs/12`）。

## 4. 变更包逐项复验结果（真实浏览器 + 读回）

### CH-1 操作列（高）
- 36 行每行常显「编辑」按钮（`data-edit-row`，文案「编辑」）；点击后该行进入行编辑态：`tr.row-editing`、按钮变「完成」、文本字段变为编辑器且初值等于行数据、日期/状态控件保留；再次点击退出编辑态（A11/A13/A14）。
- 「删除」仅项目负责人可见：项目负责人侧 36/36 行可见、非项目负责人侧 `[data-delete]` 计数 0（A12/A30）。
- 确认框两条路径：取消 → 弹「确认删除任务 T037（删除路径验证）？该操作需保存后生效。」、行数保持 37、提示「已取消删除 T037。」；确认 → 行从页面消失（36 行），保存后 `GET /api/wbs`、磁盘 JSON、页面三者一致且 `T037` 不存在（E1/E2/E3/E4，`shots/06-delete-confirm-cancel.png`）。
- 对抗：非本人在只读行点「编辑」→ 给中文提示「…对第 T001 行只读…」，不静默、不进入编辑态（A29）。

### CH-2 日期/状态常显（高）
- 五列（设计/开发/测试/产品/演示准备）在 36 行全部常显 `input`，真实浏览器属性态为 `type=date`、`disabled=false`（项目负责人）、`value` 与该行 `dates.*` 相等（A7/A8，样例 `dotsClass=cell cell-date editable`）。
- 状态列常显 `select`，选项集合与顺序恒为 `未开始/进行中/已完成/已延期/被阻塞`、`value` 等于该行 `status`，并保留状态徽标（A9/A10）。
- 无权限行：非本人行 `input`/`select` 的 `disabled=true`（属性态而非文本态），选项集合仍为五枚举；本人行 `disabled=false`（A17/A17b：九身份 × 36 行全量权限矩阵，violations=0）。
- 点击只读单元格仍给中文提示：`一级`/`进展说明` 文本单元格 ✓；**对抗**——直接点「不可编辑行的 disabled 日期输入本体」「disabled 状态下拉本体」以及 td 内边距均给出「…只读…」提示，无「点击无反应且无提示」（A24–A28）。

### CH-3 负责人池化（中）
- 负责人列为 `select.owner-select`，选项集合与顺序等于当前 `identities`；项目负责人可改派（A31）。
- 改派 `T001` 李欢 → 张航瑞并保存：页面 `select.value`、`GET /api/wbs`、磁盘 JSON 三端一致（revision 0→1）；再改回李欢保存，三端一致（B1/B2）。
- 非项目负责人：负责人列无下拉（文本 + 点击只读提示），全量矩阵已覆盖（A17b）。

### CH-4 新增人员（中）
- 入口可见性：工作台「新增人员」仅项目负责人可见（非项目负责人 `hidden=true`）；身份选择页 `#identity-add` 在项目负责人身份/记忆身份下可见，非项目负责人时隐藏（A21/A22/C9）。
- 校验：空/全空格 → 「姓名不能为空。」、21 字符 → 「姓名长度需为 1–20 个字符（当前 21 个）。」、重复「李欢」→ 「「李欢」已在人员池中，请勿重复添加。」；三者均弹窗保留、人员池与 revision 不变、审计行数不变（C2–C5）。
- 合法新增「验证甲」：横幅「已新增人员「验证甲」，人员池已保存到服务器（版本 4）…」；**四处同步**全部命中——身份切换下拉、负责人下拉（表内 select）、负责人筛选下拉、返回首页重选身份列表（C7/C8）；API 与磁盘均含该身份；页面刷新后仍在（C10）。
- 重启持久：隔离实例（同镜像）新增人员后 `docker restart`，重启后身份仍在（`isolated/iso2-results.json` R3）；现场容器重启后数据整体持久（第 5 节）。

### CH-5 日报导出（高）
- 「导出日报」位于「导出 Excel」右侧（工具栏按钮顺序 `…export-btn, daily-btn, save-btn`），下载单个 Excel `蓉城战役日报-20261014.xlsx`（A23/F2）。
- 读回（独立标准库）`sheetNames` = `['阻塞与延期','当日变更']`（长度 2、顺序一致）。`阻塞与延期`：表头 12 列（A–K 全字段 + 状态列）；数据行恰好为 `status ∈ {被阻塞, 已延期}` 的 2 行（T002 已延期、T003 被阻塞），逐字段与 `GET /api/wbs` 相等，无其它状态混入（C4–C8）。
- `当日变更`：表头 10 列（id、一级/二级/任务项/负责人、改动字段、旧值、新值、时间、操作身份）；**逐行与 `GET /api/history?date=2026-10-14&tz=Asia/Shanghai` 的 14 条记录完全一致**（C9）；时间为 Asia/Shanghai `YYYY-MM-DD HH:mm:ss`（C10）。
- 多字段保存拆行与旧值/新值：一次保存同时改 `T001` 三字段 + `T002`/`T003` 状态，`/api/history` 拆为 5 条记录（`T001|dates.dev`、`T001|note`、`T001|status`、`T002|status`、`T003|status`），旧值/新值逐条正确（`未开始→进行中`、`''→2026-10-15`、`''→独立复验：多字段保存 2026-10-14`、`未开始→已延期`、`未开始→被阻塞`），日报中对应「进展说明/状态/开发」三行拆分正确（B5/B7/B8/B8b/C12/C13）。
- `/api/history` 参数与边界：`date` 缺省 → 当日（tz 缺省 Asia/Shanghai）；`tz=UTC` 窗口切换为 `…T00:00:00Z`；Asia/Shanghai 当日窗口 = `2026-10-13T16:00:00Z … 2026-10-14T16:00:00Z`（24h）；`date=2026-10-13` 的 `to = 2026-10-13T16:00:00Z` 且返回 0 条（跨日 0 点口径正确）；非法 `tz`、非法 `date` 均 400（B6/B9–B14）。
- 回归：原 WBS 导出**仍不含 status**（导出文件中不存在任何状态枚举值）；第 1/2 行既有单元格与源模板逐格一致、`A1:C1` 合并保留、A–K 列宽逐列值与模板一致；`A3:K(3+n)` 与 JSON 导出行完全一致、无残留行；导出 vs 模板的差异集合精确为 `{M1} ∪ {A3:K38}`（W1–W9、C3）。
- 旧数据兼容（隔离实例，旧格式 `audit.log` 无 `old`/`new` + 变更包前 `wbs.json` 副本）：可读（rev 1 / 36 行 / 9 身份）、可保存（真实保存往返三端一致 rev 1→2）、日报不报错（横幅 ok，`当日变更` 仅表头 0 行，旧行按「无明细」跳过）（L1–L7、L1.legacy-profile）。

### CH-6 WBS 导出日期标签（中，追加）
- 读回「导出 Excel」：`M1` = `导出日期：2026-10-14 20:49`，与导出时刻的 Asia/Shanghai 渲染精确一致（`exportAt=2026-10-14T12:49:02.735Z`），格式正则通过；模板 `M1` 原为空（C1/C2）。
- 只新增 M1：导出与模板的全单元格差异集合 = `{G3, K3, M1}`（G3/K3 为本轮保存的数据；非 A3:K38 区域仅 M1），第 1/2 行其它单元格、合并、列宽、数据区保真不变；status 仍未进入导出（C3/W2/W3/W4/W7）。

### CH-7 新增人员审计（中，追加）
- 项目负责人新增成功后 `data/audit.log` 追加 `{"type":"identity_added","identity":"项目负责人","name":"验证甲","at":"2026-10-14T12:46:48.826Z"}`（唯一一条）；`GET /api/history` 返回该事件（`field=人员池`、`old=''`、`new=验证甲`、`task=新增人员 验证甲`、`identity=项目负责人`）；日报 `当日变更` 含「新增人员 验证甲」一行且字段/旧值/新值/操作身份照实（C11/C12/C11-daily）。
- 反例（真实浏览器 + API 直连双路径）：普通负责人身份经 API 新增 → **403 `forbidden`**，人员池、revision、磁盘、审计均无变化（N1/N2）；重复/空/超长 → **400**，同样不落盘、不写审计（N3/N4、C2–C5）；浏览器侧非项目负责人无入口且面板被拒（A21/C4）。

## 5. 不回归要求复跑结果（Sponsor 指定）

| 项 | 结果 | 证据 |
| --- | --- | --- |
| D-3 身份遮罩 | 通过：进入工作台后 `getComputedStyle(#identity-layer).display === 'none'`、`hidden=true`、rect 0×0、`#workbench` `display:block` 且 y=0、视口中心 `elementFromPoint` 命中工作台 | A2/A3/A3b/A3c |
| 验收 1 九身份 | 通过：9 身份全部出现在列表与切换下拉，选择即进入工作台、切换即时生效、刷新后身份保持（`localStorage`） | A1/A15/A19/A20 |
| 验收 3 权限 | 通过：`王言` 本人行（T002/T003/T026–T028）日期与状态控件可编辑，非本人行锁定；含两位普通负责人（李欢/王言）组合与九身份 × 36 行全量矩阵 violations=0 | A17/A17b/A18 |
| 验收 4 增删行 | 通过：项目负责人「新增行」进入编辑态；填必填后保存 → 37 行三端一致；删除带确认框，取消/确认两路径行为正确 | D1/D4/E1–E4 |
| 验收 5 空输入 | 通过：空行保存被前置校验拦下（「前置校验未通过，未向服务器提交（共 3 项）…」），revision 与磁盘 mtime 不变；刷新后草稿丢弃 | D2/D3 |
| `/api/health` | 通过：127.0.0.1 与 0.0.0.0 均 ok；页面探针显示「服务正常 · v0」 | A6/F3、`logs/00` |
| 重启持久 | 通过：现场容器 `docker restart` 后 2s 健康、绑定不变、数据逐字节一致；隔离实例重启后保存内容与新增身份仍在 | `logs/07`、R1–R5 |
| 并发 PUT 409 | 通过：同旧版本两次 `PUT`，先到 200（rev+1），后到 409 `current=rev+1`，磁盘以先到者为准，未静默覆盖 | L8 |
| 验收 10 资源全本地 | 通过：真实浏览器 7 个请求全部同源（`/`、`styles.css`、`vendor/xlsx.full.min.js`、`app.js`、`/api/wbs`、`/api/health`、`template.xlsx`），无跨域外链、无 console error | NET1–NET3、`logs/12` |

未复跑项与依据（按派发口径，其余以既有 Stage1/Stage2/Stage6 证据为准）：验收 2 的「与 Excel 第 3–38 行逐行对照」未重做（本轮仅复核 36 行渲染与 API 顺序一致，行序/分组视觉依据 Stage2 验证）；验收 7「连续 10 次保存无字段丢失」未复跑（依据 Stage2）；验收 6 的原子写故障注入未复跑（本轮只复跑重启持久，依据 Stage1/Stage2）；`deploy/rollback.sh` 语义与容器回环往返依据 Stage3/Stage5 证据。

## 6. 约束与安全复核

- 无新增依赖：`package.json` `dependencies={}`、`server.js` 只 `require` `http/fs/path`、镜像 `/app` 无 `node_modules`；页面资源全部本地（CSP `default-src 'self'`）。
- 无凭据：以真值样式凭据正则扫描运行目录与本源快照的源码/脚本/部署文件 → 无命中；第三方 `vendor/xlsx.full.min.js` 未改动（sha256 与基线一致）。
- 未触碰 Multica 三容器：`multica-frontend-1 / multica-backend-1 / multica-postgres-1` 仍为 `Up 2 weeks`。
- 阿里云安全组放行属 Sponsor 控制台操作，**不在本轮验证范围**（如实记录为未验证项）。

## 7. 缺陷与残余风险

**本轮新发现需要修复的缺陷：无**（143 条断言全通过，未发现功能缺陷与交互级失败，故不附缺陷块）。首轮脚本自身的 3 处断言写错（字段键名、列定义表示、横幅竞态）为 AI-QV 自研脚本缺陷，已在复跑前修正，不属被验证产物问题（留档 `results/partial-run-1/`）。

残余风险 / 待决项（逐条编号；本轮**不自行接受或关闭**）：
1. **待 Sponsor 决策（4 项，原决策包）**：① 导出视觉保真与样式量化；② 基础镜像 `node:24-slim` 与设计示例 `node:20-slim` 不一致；③ 容器 `--network host` 网络模型；④ 浏览器执行环境偏差——宿主 CentOS 7（glibc 2.17）无法直接运行 Chromium 140，本轮沿用官方镜像 `mcr.microsoft.com/playwright:v1.55.0-jammy` + `--network host` 访问宿主回环（未安装系统级浏览器组件，浏览器依赖只在测试容器与本目录）。
2. **待 Sponsor 决策（本变更包新增、作者已声明口径）**：日报两个 sheet 为纯数据表（无样式模板/冻结行）；「当日变更」以本服务单实例 `data/audit.log` 为准，旧格式（无 `old`/`new`）行按「无明细」跳过（本轮已实测不报错、明细为 0）；`identity_added` 行的任务结构列（id/一级/二级/负责人）留空（该事件不属于任何 WBS 行）。
3. 观察项（严重度：低，**非本变更包引入**）：保存前置校验失败时横幅不提供「重新加载」入口，用户丢弃草稿需自行刷新页面。理由给「低」：属 Stage1 既有设计、无数据风险（校验失败不落盘），且不属于 CH-1…CH-7 改动面。
4. 观察项（严重度：低，**非本变更包引入**）：导出文件的 `<cols>` 为逐列展开（16384 列），文件约 1.17MB；A–K 列宽值与模板逐列一致，Stage2/Stage3 基线导出同量级（1172751 字节）。理由给「低」：不影响任何验收条件与读回结果。
5. 说明项（口径澄清，非风险）：CH-6 的 `M1` 落在第 1 行，因此「第 1/2 行原文不变」本轮按「既有单元格 + A–K 不变」核验，且已用差异集合精确证明仅 `{M1} ∪ {A3:K38}` 变化。
6. 运行数据写副作用（如实记录）：为满足 CH-1/CH-3/CH-5/CH-7 的真实读写断言，在 4180 现场执行了真实保存（revision 0→5），收尾已把 `data/wbs.json` 与 `data/audit.log` 按字节回滚到复验前现场（sha256 与复验前完全一致，revision 回到 0）；过程副本留档 `results/during-run/`。

## 8. 证据文件清单（本目录）

| 文件 | 内容 |
| --- | --- |
| `input-receipt.txt` | 产物定位、作者自报链哈希交叉核对、AI-QV 自跑链清单 |
| `runtime-state.txt` | 容器/镜像/绑定/health、数据现场前后字节一致、重启持久、隔离实例、未触碰项 |
| `scripts/qv-browser-live.cjs`、`scripts/run-live.sh` | 真实浏览器主矩阵（79 断言，打 4180 现场） |
| `scripts/qv-readback.py` | 标准库 xlsx 读回（CH-5/CH-6/回归，stage8 与 legacy 两档） |
| `scripts/qv-iso1.cjs`、`qv-iso2.cjs`、`scripts/run-isolated.sh` | 隔离实例：旧数据兼容、并发 409、CH-7 反例、重启持久 |
| `scripts/qv-network.cjs` | 真实浏览器请求面同源断言 |
| `logs/00-runtime-and-binding.txt`、`logs/01*` | 绑定/健康/部署到位逐字节核验 |
| `logs/02-live-browser-console.log`、`results/live-browser-results.json` | 主矩阵逐条 PASS/FAIL 与详情 |
| `logs/03-network-resources.txt`、`results/network-requests.json` | 7 个同源请求清单 |
| `logs/05-readback.log`、`results/readback-results.json`、`downloads/{wbs-export,daily-export}.xlsx` | 导出与日报读回原始件与结论 |
| `logs/06-restore-after-run.txt`、`results/{pre-state,during-run,partial-run-1}/` | 数据现场字节回滚与过程副本 |
| `logs/07-restart-persistence.txt` | 现场容器重启持久证据 |
| `logs/08-iso1.log`、`logs/09-iso2.log`、`isolated/` | 隔离实例两阶段逐条结果与旧格式导出件 |
| `logs/11-legacy-readback.log` | 旧格式导出读回结论 |
| `logs/12-constraints.txt` | 请求面/无新增依赖/凭据扫描/收尾一致性综合 |
| `results/permission-matrix.json`、`results/identity-switch.json`、`results/history-*.json` | 九身份 × 36 行权限矩阵、身份切换、history 采样 |
| `shots/*.png` | 身份层 / 项目负责人工作台（常显控件与操作列）/ 非项目负责人锁定 / 新增人员面板 / 日报导出 / 删除确认 |
