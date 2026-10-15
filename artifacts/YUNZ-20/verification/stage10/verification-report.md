# Stage10 独立复验报告：WC-001 变更包 #3 CH-8（进展说明升级为大尺寸 Markdown 编辑器）

- 任务：`YUNZ-30`（Stage10 独立复验，独立验证工程师 AI-QV）
- 被验证对象：`YUNZ-29`（Stage9 变更包 #3 CH-8 实现与自测）
- 复验时间：2026-10-15 10:59–11:13（+08）
- 被验证产物（只读）：`/opt/wbs-rongcheng/`（含 `0.0.0.0:4180` / `127.0.0.1:4180` 运行服务）、`data/wbs.json`、`data/audit.log`、源码快照 `/opt/SoftFactory-AINative/artifacts/YUNZ-20/wbs-rongcheng/`
- **结论：通过**
- 判定依据：真实浏览器交互断言（现场 34 项 + 隔离写路径 34 项）+ 导出 / 日报 / 审计读回（现场 10 项 + 隔离 10 项）+ 服务端契约 6 项，**合计 94 项断言全部通过，未发现功能缺陷与交互级失败**；本轮未出现需 Sponsor 决策的新残余风险（既有残余风险处理状态为「待 Sponsor 决策」，不由 AI-QV 自行接受或关闭）。

## 0. 结论判定依据（汇总）

| 证据块 | 载体 | 结果 |
| --- | --- | --- |
| 现场真实浏览器只读矩阵 | `scripts/qv-ch8-live.cjs`（Chromium 140.0.7339.16，打 4180） | PASS=34 / FAIL=0（`logs/02-live-browser.log`） |
| 现场导出 / 日报真实下载 | `scripts/qv-ch8-live-export.cjs` | PASS=3 / FAIL=0（`logs/05-live-export.log`） |
| 隔离实例真实浏览器写矩阵 | `scripts/qv-ch8-write.cjs`（同一被验证镜像，4181） | PASS=34 / FAIL=0（`logs/03-iso-write.log`） |
| 服务端契约与 20000 边界 | `scripts/qv-iso-server.js` | PASS=6 / FAIL=0（`logs/04-iso-server-restart.log`） |
| 导出 / 日报读回（Python 标准库自研读回器） | `scripts/qv-readback.py` | 现场 PASS=10 / 隔离 PASS=10（`logs/06`、`logs/07`） |
| 重启持久（隔离实例） | `scripts/run-server-and-restart.sh` | 20000 字符 note 与 revision 跨重启一致 |

## 1. 本轮约定（被验证范围与证据要求）

- 本轮验证范围 = CH-8 全部必测 1–12 项 + 派发指定的行为保留抽样（CH-1/CH-2、D-3、验收 1/3/4）+ 部署与绑定口径。
- 「不得修改被验证实现代码」：`/opt/wbs-rongcheng` 下 `server.js` 与 `public/*` 的 sha256 全程与源码快照一致（`logs/00-pre-state.log`、`logs/08-post-check.log`）。
- 写路径策略（本轮明确声明）：**现场 4180 全程只读**（浏览器会话断言写请求 = 0），所有真实写入（保存 / 409 / 超长 / 空 note / 重启持久）在**同一被验证镜像**的隔离实例（4181、独立数据目录）上执行。理由是现场数据处于真实使用中（复验窗口内现场 revision 由真实使用 5→6），避免对现场造成无谓写副作用；现场侧的部署到位性由「运行态返回资源与源码快照逐字节一致」+ 现场只读交互矩阵 + 现场导出/日报/审计读回共同证明。
- 两条证据链分开：作者自报（`YUNZ-29` 评论 `01a13d79-b8c3-73d6-b080-46acef4d909a` + `selftest/stage9/`）与本轮自跑链分别成链，核对时间与证据文件见 `input-receipt.txt`；作者自报的 5 项哈希（app.js / index.html / styles.css / server.js / 镜像 id）经独立计算全部 MATCH，但作者自报的矩阵输出不作为结论证据。

## 2. 必测矩阵逐项结果（真实浏览器 + 读回）

### 1. 摘要与可点击性 —— 通过
- 现场（note 全空）：可编辑行 T001（负责人 李欢）K 单元格 `class="cell cell-note editable note-editable"`、`cursor:pointer`、无内联 `textarea/input`、摘要为占位「点击打开编辑」且 `data-note-empty=true`、`.note-summary` computed `white-space:nowrap` + `text-overflow:ellipsis`（B1/B2）；只读行 T002 为 `note-locked` + 「点击查看进展说明」（B3）。
- 隔离（真实保存）：保存 204 字符 Markdown note 后，T001 摘要**精确等于** 120 个 `A` 去 Markdown 后按 80 字符截断的 `A×80 + …`（长度 81，A4），`.note-summary` 实际溢出被裁剪（`scrollWidth > clientWidth`，A5），`.note-action` 显示「点击打开编辑」（A6）。
- 整格可视区域可点：真实鼠标点击 K 单元格**最右侧可视边缘**（x = 右边界 − 3px）即打开面板（C1），非仅文字命中区。
- 去 Markdown 正确性（隔离 B3）：`# 进展标题 **评审完成**，`` `v1.2` `` 已上线；见 [设计稿](url)。` → 摘要 `进展标题 评审完成，v1.2 已上线；见 设计稿。`（无 `#`/`*`/`` ` ``/`](`/`http`）。

### 2. 面板形态 —— 通过
- 桌面 1440×900：`#note-dialog` 实测 **1296×720 = 90vw×80vh**（容差 2px），居中（left=72、top=90，与 (视口−面板)/2 偏差 0）；`.note-body` 为 grid **两列**（各 625px），左「编辑」右「预览」两栏同时可见，`#note-tabs` 隐藏（C2/C3/C4）。
- 窄视口 390×844：面板 **100vw×100vh（390×844）全屏**、无圆角；`#note-tabs` 显示（display:flex）；默认落「编辑」页（编辑区可见、预览区隐藏）；点「预览」标签后编辑区隐藏、预览区可见、`active` 标签与 `data-tab` 同步切换（可切换可见区域高度 650px）；再点「编辑」切回（I1–I4，截图 `shots/live-mobile-edit-tab.png`、`shots/live-mobile-preview-tab.png`）。

### 3. 只读模式 —— 通过
- 普通负责人（王言）点他人行 T004：`#note-dialog.readonly`、`#note-save` hidden 且不可见、编辑区隐藏、仅预览区可见、标签栏隐藏、`#note-cancel` 文案「关闭」、说明「只读预览（当前身份「王言」对第 T004 行无编辑权限）」（G1）。
- **无法提交**：只读面板上按 `Ctrl+Enter` 后**未发出任何写请求**（写请求计数不变）且面板仍打开，无可用保存路径（G2）；隔离实例侧同样复现（F2）。
- 关闭路径：`关闭` 按钮可关（G3）、`Esc` 可关（G4）；可编辑面板无改动时 `Esc` 直接关闭不弹确认（H1）。

### 4. 保存语义 —— 通过
- 仅点「保存」才提交：隔离 A2 中文成功提示「第 T001 行进展说明已保存，服务器版本号已更新为 6。（页面、API、磁盘三端一致）」，revision 5→6 **递增 +1**；页面 / API / 磁盘三端 note 原文完全一致（A3）。
- `Ctrl+Enter` 快捷保存生效（B1，revision 6→7）。
- 未点保存的草稿不落库：草稿经确认框「继续退出」后 revision 不变、API note 未变，刷新页面后摘要仍为已保存内容（C1/C4/C5）。
- 失败路径走既有错误横幅：构造一次并发写后保存 → 横幅「版本冲突：服务器当前版本为 8，你的保存基于版本 7，已拒绝覆盖。请重新加载后再改。」+ 面板错误提示「版本冲突，未提交（服务器版本 8）」（E1）。

### 5. 未保存关闭确认 —— 通过
- 有未保存内容时点关闭 → 弹确认框，按钮为「取消 / 继续退出」，面板保持打开（F1）；**取消**路径：确认框收起、面板保留、输入内容 `DRAFT-LIVE-UNSAVED` 不丢（F2 / 隔离 C2）；**继续退出**路径：面板关闭（F3 / 隔离 C1）。
- 补充：有草稿时 `Esc` 先弹确认（不直接丢弃），确认框上再按 `Esc` = 取消关闭（面板与草稿保留）（隔离 C3/C3b）。

### 6. Markdown 子集 —— 通过（逐项 DOM 断言）
H1/H2/H3 → `h1`/`h2`/`h3` 文本正确（D1）；`**粗体**`→`strong`、`*斜体*`→`em`、`~~删除~~`→`del`、`` `行内代码` ``→`code`（D2）；``` 围栏代码块 → `pre > code` 文本 `const a = 1;`，`> 引用` → `blockquote`（D3）；`- ` → `ul` 两项、`1. ` → `ol` 两项（D4）；`[链接文本](url)` → `a[href][target=_blank][rel="noopener noreferrer"]`（D5）。

### 7. 安全 —— 通过
- `<script>alert(1)</script>`、`<img src=x onerror="alert(2)">`：预览区 **script/img/iframe/object/embed/link/style 节点数均为 0**，原文以文本原样显示、`innerHTML` 中为 `&lt;script&gt;`（E1）；`window.alert` 未被调用、无 `dialog` 事件（E2）。
- `![](http://example.com/remote.png)` 不解析为图片、只显示为安全文本，渲染阶段 **外部请求数 = 0**（E3）。
- 全程请求面断言：现场矩阵 12 个请求全部同源 `http://127.0.0.1:4180`，无跨域/外部资源（J1）；无 pageerror、无 console error（J2）。

### 8. 数据契约 —— 通过
- `note` 仍为**单个字符串**，任务键集仍为 `{dates,demo,id,level1,level2,note,owner,status,task}`，无新增字段（隔离 G5、服务端 S1）。
- 长度上限 **20000**：前端输入 20001 字符即时提示「20001 / 20000 字符（超长，无法提交）」并加 `over-limit` 样式；点保存被拒绝（中文「进展说明长度超过 20000 个字符（当前 20001 个），未提交。」），revision 不变、磁盘与 API 未落盘（D1–D3）。服务端侧：**恰好 20000 接受**（200、落盘 20000、revision+1），**20001 拒绝**（400 `note 长度超过上限 20000`，磁盘逐字节未变），非字符串拒绝（400 `note 必须是字符串`）（S2/S3/S4）。
- 空 `note` 合法：清空后保存成功、API note = `""`、K 列回到「点击打开编辑」占位（F4/F5）。
- 权限语义不变：普通负责人仅本人行可编辑（T002 `note-editable` / T004 `note-locked`，F1）、他人行只读预览（F2）、项目负责人全行可编辑（F6）；现场同类断言（B1/B3/G1）。

### 9. 审计 —— 通过
- note 保存产生字段级 `old`→`new`（Markdown 原文）、时间、操作身份：`{"ts":"2026-10-15T03:05:38.229Z","identity":"李欢",…,"old":{"T001":{"note":""}},"new":{"T001":{"note":"A×120…"}}}`（G1）；清空 note 的 `old`=原内容 / `new`=空串（G2）。
- 审计行字段集无新增（仍为 `ts/identity/revision/changed/added/removed/old/new/snapshot`，另有既有 CH-7 `identity_added` 的 `type/name/at`）（G3）。
- `GET /api/history?tz=Asia/Shanghai&date=` 记录无新字段（键集不变），note 记录旧值/新值为 Markdown 原文（G4 / 服务端 S6）。
- 日报「当日变更」读回：sheet 表头 10 列正确、行数 = `/api/history` 当日记录数、**note 变更行旧值/新值/操作身份与 API 逐条一致**（隔离 5/5 条，mismatch=0；现场当日无 note 变更记录，0/0）（`logs/06`、`logs/07` DLY3/DLY4）。

### 10. 导出不回归 —— 通过（读回）
- 现场与隔离导出文件均以真实浏览器点击「导出 Excel」/「导出日报」下载后读回（`downloads/live-*.xlsx`、`downloads/iso-*.xlsx`）。
- WBS 导出：A–K 数据区 36 行**逐格**等于该时点 API/磁盘（K 列仍为 note 原文 Markdown，未被摘要化），L–P 无内容（`status` 不导出、无越界写入），**第 1/2 行除 M1 外与模板逐格一致**，**M1 = `导出日期：2026-10-15 11:11`**，A–K 列宽与原模板一致（含 K 列 47.2595…，`!cols` 保真），仅一个工作表且表名与模板一致（WBS1–WBS6）。
- 日报：两个 sheet「阻塞与延期」「当日变更」齐备；「阻塞与延期」表头 12 列正确、行集 = 状态为已延期/被阻塞的任务（现场与隔离当日均为 0 行，双向核对）、无多余行（DLY1/DLY2）。

### 11. 行为保留（抽样） —— 通过
- D-3：选身份后 `getComputedStyle(#identity-layer).display === 'none'`、`#workbench` 可见可交互（A2）。
- CH-1/CH-2：36 行常显「编辑」按钮（点击进入 `tr.row-editing`、按钮变「完成」，再点退出）、36 行状态控件、180 个日期输入常显；K 列**无**行内编辑器（CH-8 有意取代）（M1/M2）。
- 并发 `PUT` 409 非覆盖：现场语义在隔离实例复现 —— 他人先写入后本次保存被拒，磁盘保留他人写入（`T036=COMPETING-WRITE`）、`T001` 未被草稿覆盖；服务端过期 `If-Match` → 409 且磁盘未变（E2 / S5）。
- 重启持久：`docker restart` 后 20000 字符 note 与 revision 保持一致（第四节）。
- 未复跑项与依据：验收 2「与 Excel 第 3–38 行逐行对照」、验收 6 原子写故障注入、验收 7「连续 10 次保存无字段丢失」未重做（以 Stage1/Stage2/Stage6 既有证据为准，本轮范围只覆盖 CH-8 接触面与其直接回归面）；CH-3…CH-7 未逐项重跑，但导出/日报/审计/权限/身份链路已在本轮读回中抽样交叉验证。

### 12. 部署与绑定 —— 通过
- 运行态绑定 `0.0.0.0:4180`：宿主 `ss -ltn` 为 `*:4180` LISTEN，容器 `NetworkMode=host`、`WBS_HOST=0.0.0.0`（D-0006 口径）。
- `http://127.0.0.1:4180/api/health` 与 `http://0.0.0.0:4180/api/health` 均 `{"ok":true,…}`。
- 公网 `http://47.108.129.157:4180/api/health` **实测返回 200 `{"ok":true,…}`**（安全组已放行；该放行属 Sponsor 控制台操作，不在本轮验证范围）。
- **镜像内无 `node_modules`**、`package.json` 无依赖。
- 运行态返回资源与 `artifacts/YUNZ-20/wbs-rongcheng/` 快照 sha256 **逐字节一致**（index.html/app.js/styles.css/template.xlsx/vendor/xlsx.full.min.js），容器内 `/app` 亦与运行目录一致。

## 3. 约束与安全复核

- 零新增依赖：`package.json` `dependencies` 为空；页面资源全部本地、无 CDN/外链；请求面全部同源。
- 未修改被验证实现代码；未触碰 Multica 三容器（`Up 2 weeks`）。
- 未使用任何凭据值；浏览器依赖只装在执行容器与工作目录（不进产物、不进镜像）。

## 4. 缺陷与残余风险

**本轮新发现需要修复的缺陷：无**（94 项断言全部通过，未出现交互级失败或功能缺陷，故不附缺陷块）。

残余风险 / 待决项（逐条编号；**本轮不自行接受或关闭**）：
1. **待 Sponsor 决策（沿用既有，非本轮新增）**：`note` 上限 2000→20000 的口径确认；K 列不再有行内编辑入口（CH-8 有意变更）；导出视觉保真、基础镜像 `node:24-slim` 与设计示例差异、容器 `--network host` 网络模型、浏览器执行环境偏差（宿主 CentOS 7 无法直跑 Chromium 140，改用官方 playwright 镜像）。
2. **待 Sponsor 决策（Stage8 遗留观察项，非本轮引入）**：保存前置校验失败时横幅不提供「重新加载」入口；导出文件 `<cols>` 为逐列展开（约 1.17MB）。
3. 观察项（严重度：低，本轮如实记录，非缺陷、非本轮引入）：**现场数据在复验窗口内发生一次真实用途的批量保存**（`audit.log` 记 +08 11:10:35 身份「项目负责人」、`changed` 含 T001…T0xx 的 `dates.*` 与 `status`，revision 5→6）。本轮现场会话断言写请求为 0，变化与本轮脚本无关；判定为现场真实使用。理由给「低」：现场本处于真实使用中（Stage9 作者亦记载同类现象），note 全为空未被改动，且本轮现场读回一律以同导出时点（11:11）的 API 快照为基准，读回结果自洽（WBS1 diffCount=0）。建议收口时以现场当时 revision 为准。
4. 说明项（口径澄清，非风险）：CH-8 接触面只在 `public/{app.js,index.html,styles.css}` 与 `server.js` 的 `note` 上限；本轮现场读回覆盖部署到位性与导出/日报/审计链路，写语义验证在隔离实例（同一镜像）完成，二者共同构成结论证据（见第 1 节声明）。

## 5. 证据文件清单（本目录）

| 文件 | 内容 |
| --- | --- |
| `input-receipt.txt` | 产物定位、作者自报链哈希交叉核对、AI-QV 自跑链清单 |
| `runtime-state.txt` | 容器/镜像/绑定/health（含公网）、部署到位三端比对、现场数据窗口变化认定、隔离实例与清理、环境偏差 |
| `scripts/qv-ch8-live.cjs`、`scripts/run-live.sh` | 现场只读矩阵（34 项断言，含 CH-1/CH-2 抽样） |
| `scripts/qv-ch8-live-export.cjs`、`scripts/run-live-export.sh` | 现场导出 / 日报真实下载（只读，3 项断言） |
| `scripts/qv-ch8-write.cjs`、`scripts/run-write.sh` | 隔离实例写矩阵（34 项断言：摘要截断 / 保存 / 快捷保存 / 未保存确认 / 超长 / 409 / 空 note / 权限 / 审计 / 读回输入） |
| `scripts/qv-iso-server.js`、`scripts/run-server-and-restart.sh` | 服务端契约与 20000 边界（6 项）+ 重启持久 |
| `scripts/qv-readback.py` | 自研 xlsx 读回器（Python 标准库），现场与隔离各 10 项 |
| `scripts/qv-pre.sh`、`scripts/qv-iso-up.sh`、`scripts/qv-post.sh` | 现场记录、隔离实例搭建、复验后确认与清理 |
| `logs/00-pre-state.*`、`logs/02a-pre-live-data-sha256.txt`、`logs/08-post-check.log` | 复验前后现场与部署记录 |
| `results/*.json` | 浏览器/服务端/读回结构化结果 + 导出时点 API 快照与历史记录 |
| `downloads/live-*.xlsx`、`downloads/iso-*.xlsx` | 现场与隔离的真实导出产物（读回输入） |
| `shots/*.png` | 桌面面板、手机编辑/预览标签、安全预览、摘要单元格截图 |
| `isolated/iso-wbs-final.json`、`isolated/iso-audit-final.log` | 隔离实例收尾数据现场（含 20000 字符边界值） |
