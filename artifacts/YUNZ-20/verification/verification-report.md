# WC-001 / YUNZ-20 独立验证报告（Stage2）

- 任务：`YUNZ-22`（Stage2 独立验证，执行者：独立验证工程师 AI-QV）；Work Case：`YUNZ-20`。
- 被验证产物（只读）：`/opt/wbs-rongcheng/`（运行态 + 源码）；交付快照 `/opt/SoftFactory-AINative/artifacts/YUNZ-20/wbs-rongcheng/`；输入基线 `/opt/wbs-rongcheng-staging/WC-001/`（仅比对，未修改）。
- 本轮验证范围：`harness/spec.md` 验收条件 1–10、DOM 交互级验证、导出保真、服务/持久化/并发 409、`deploy/` 两脚本语义、交付三链一致性。
- 验证时间：2026-10-14 14:16:50 – 14:17:57（+0800，Asia/Shanghai）。
- **结论：不通过**（验收 1–10 全部复现通过；存在 2 项需修复缺陷 D-1 / D-2，见第 6 节）。

## 0. 方法、环境与限制

- 环境：node v24.21.0（容器内）、jsdom 30.1.2、Python 3.6.8、Docker 26.1.4（宿主）、curl。
- **网络限制与处置（重要）**：`/usr/local/bin/node` 是 `docker run` 包装脚本，node 进程默认在 bridge 网络命名空间内，**看不到宿主回环** `127.0.0.1:4180`（`ECONNREFUSED`；与作者 Stage1 备注一致，属环境限制非服务缺陷）。本验证改用 `docker run --network host`，使 node 进程与现场容器共享宿主网络命名空间，可直连 `127.0.0.1:4180`。证据：`run-all.out`、`dom-verify.log` 首行与 C1–C3 全通过。
- 依赖只装在工作目录：`verify/node_modules`（jsdom），不进交付目录、不进镜像；npm 源用 `registry.npmmirror.com`。
- 现场部署未被破坏：`rollback.sh` / `deploy.sh` 均在**隔离目录 + 隔离容器名 + 隔离端口(4181/4182)** 上复跑；全程结束后现场 `GET /api/health` = `{"ok":true,...,"revision":0}`，`data/wbs.json` sha256 = `a3632236d54731f21dffd2a9fd41f9b3ea0829f777da4f09aba7f143d9f04aa5`（= 验证前快照，见 `start-state-wbs.json`）。
- 两条证据链分开记录：**链 A 作者自报**（Stage1 交付评论 `01a138fd-241c-79ff-971f-40c6fd005c50`、`selftest/01–21.log`、`SHA256SUMS`）；**链 B 本次独立复跑**（本目录日志）。核对时间 2026-10-14 14:16–14:18 (+0800)。**未以作者自报作为通过依据。**

## 1. 两条证据链核对（作者主张 vs 我的复跑）

| 作者主张（链 A） | 我的复跑（链 B） | 判定 |
| --- | --- | --- |
| 19 个交付源码与运行产物逐字一致 | `integrity.log` I2：19 文件 mismatch=0 | 一致 |
| `SHA256SUMS` 45 条自校验通过 | I1：45/45 OK | 一致 |
| 交付已入库并记录 sha256 | I3：`SHA256SUMS` = 磁盘实际 = git HEAD blob（45/45） | 一致 |
| commit `5a0294a` 已 push origin main | I4：HEAD == `origin/main` == 5a0294a | 一致 |
| `GET /api/health` → `{"ok":true,...,"revision":0}` | S1/S4：一致；数据 == seed | 一致 |
| 矩阵 12：「列宽设置保持原样」PASS | E8/`export-cols-compare.log`：**交付页面导出无 `<cols>`，列宽丢失** | **不一致 → D-1** |
| 矩阵 12 WARN：「文本/合并/列宽/非数据单元格值不受影响」 | 同上；其中「列宽」不成立（样式丢失属实） | **不一致 → D-1** |
| 附加项 21：`rollback.sh` 恢复上一镜像 + 上一 data 备份 + health | RB1–RB6 隔离复跑全部通过 | 一致 |
| 「独立验证请以自身 DOM 环境复跑」 | 本报告第 3 节 jsdom 35/35 | 已复跑 |

## 2. 验收条件 1–10 逐条复跑

| # | 验收口径（spec） | 复跑方式 | 结论 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | 九身份入口/进入/刷新保持/切换即时生效 | jsdom 点击身份按钮、新实例 + localStorage 预置、切换 select | 通过 | `dom-verify.log` C1a–C1e |
| 2 | 渲染 36 行且顺序与 Excel 第 3–38 行一致 | jsdom 行序 vs seed；python 读源模板 A3:D38 vs JSON | 通过 | `dom-verify.log` C2a–C2d；`export-readback.log` E10（36 行 mismatch=0） |
| 3 | `王言`身份：本人行可编辑、保存后三端一致；他人行不可编辑 | jsdom 逐字段编辑 + 保存 + `/api` + 磁盘比对 | 通过 | `dom-verify.log` C3a–C3c、C3j–C3m；另覆盖 `李欢` C3n |
| 4 | 项目负责人可编辑任意行、可新增、可删除（带确认） | jsdom 新增/确认取消/确认删除 + 三端 | 通过 | `dom-verify.log` C3f–C3i、C4a–C4d |
| 5 | 空表单/非法输入前置校验报错且不产生 API 调用与写入 | jsdom 空任务项、2001 字符超长；API 层 400 | 通过 | `dom-verify.log` C5a–C5b（PUT 增量 0）；`svc-verify.log` S5（400 且磁盘 sha 不变） |
| 6 | 原子写；重启后数据仍在 | 代码核对 `tmp+fsync+rename`；`docker restart` 后比对 sha 与全量 JSON | 通过 | `svc-verify.log` S10（restart=wbs-rongcheng，sha 一致） |
| 7 | 连续 10 次保存后 A–K 无丢失/无重复/无未知字段被清除 | 10 次连续 PUT + 全量字段对账 + 注入未知字段 | 通过 | `svc-verify.log` S9（fieldLoss=[]，unknownKept=True，行序不变） |
| 8 | 导出：第 1/2 行逐字一致、A–K 共 11 列、行数与 JSON 一致、不含 `status` | 页面导出入口生成 → python `zipfile`+`ElementTree` 读回 | 通过（文本口径） | `export-readback.log` E1–E7、E9；列宽见 D-1 |
| 9 | 两客户端用旧版本并发保存：后到者 409，以先到者为准 | 双线程同版本 PUT；过期 `If-Match` | 通过 | `svc-verify.log` S6、S8（codes=[200,409]，无静默覆盖） |
| 10 | `GET /api/health` ok；静态资源全本地、无跨域外链 | health + 静态资源同源 + 运行期请求拦截 + 源码外链扫描 + `ss` 监听面 | 通过 | `svc-verify.log` S1–S3、S12；`dom-verify.log` C10a–C10b、C8a |

## 3. DOM 交互级验证明细（jsdom 30.1.2，35/35 通过）

执行方式：jsdom 加载交付页面 `index.html`（剥离 script 标签后按序 `eval` 交付的 `vendor/xlsx.full.min.js` 与 `app.js`），构造 DOM 执行交付页面脚本；注入的 `fetch` 对 `/api/*` 走真实服务（host 网络命名空间），静态资源读交付目录；`XLSX.writeFile` 仅替换为「取字节落盘」以便读回（jsdom 无下载能力，序列化仍走交付的 `XLSX.write`）。脚本与完整输出：`scripts/dom-verify.js`、`dom-verify.log`、`dom-results.json`。

必测矩阵覆盖：
- 页面加载与 36 行渲染顺序（C2a–C2d）；身份九选、进入、localStorage 刷新保持、切换即时生效（C1a–C1e）。
- **权限矩阵覆盖项目负责人 + 两位普通负责人**：`王言`（本人行 T002 状态/演示范围/5 个日期/进展说明全部可编辑，结构字段只读，他人行只读）C3a–C3c、C3j–C3m；`李欢`（本人行 T001 可编辑并保存三端一致，他人行只读）C3d–C3e、C3n；`项目负责人`（任意行结构字段可编辑、可见新增/删除入口、保存任意行三端一致）C3f–C3i、C3o。
- 取消：编辑中 `Escape` 页面值回退且零写入（C3l）。
- 新增/删除：新增仅 PM 可见、未保存不落盘；删除确认框取消不删、确认后保存生效（C4a–C4d）。
- 空输入 / 非法输入：前置校验拦截、无 PUT（C5a–C5b）。
- 对抗路径（全新页面实例逐目标探测）：权限受限单元格与状态徽标点击均给出中文只读提示（gated=true）；**序号列单元格、普通负责人操作列空单元格、页脚计数、页脚图例、表头标题点击无任何反馈（silent）**，均未误入编辑、未破坏结构（C-ADV/C-ADV2，明细 `dom-adv-detail.json`）→ 序号列见 D-2。

## 4. 导出保真明细

页面导出入口触发 → `蓉城战役WBS-20261014.xlsx`；读回用 Python 标准库 `zipfile`+`xml.etree`（未新增依赖）。

- E1 第 1 行 `A1,B1,C1,D1–H1` 与源模板逐字一致；E2 第 2 行 `A2–K2` 逐字一致。
- E3 数据区列数：仅 A–K（maxcol=11，无 L/M）；E4 导出数据行数 36 == 当前 JSON 36。
- E6 `A3:K38` 每行逐列与 JSON 映射一致（mismatch=0，三端一致的导出侧）。
- E5 不含 `status`（单元格与 sharedStrings 均无命中）。
- E7 合并单元格 `A1:C1` 与源模板一致；E9 非数据区非空单元格逐格保留（checked=14，mismatch=0）。
- E10 源模板第 3–38 行 A–D 与 JSON 行序逐字一致（验收 2 的 Excel 侧）。
- 保真缺口（属 D-1）：导出文件**无 `<cols>`**（列宽丢失，A/B/C 列宽无值）；`styles.xml` 26197→1572 字节、数据区带样式索引单元格 396→0（样式丢失，作者已披露但「列宽不受影响」一节不成立）。

## 5. 服务 / 持久化 / 并发 / 部署明细

- S1 health ok；S2 `4180` 仅 `127.0.0.1` 监听（`ss -ltn` 单行，无 0.0.0.0）；S3 容器 `wbs-rongcheng` 使用 host 网络并挂载 `/opt/wbs-rongcheng/data`。
- S5 payload 校验失败 400 且磁盘 sha 不变；S6 过期 `If-Match` → 409 `{reason:conflict,current:0}`。
- S8 两次并发同版本 PUT：恰好 `[200, 409]`，`revision 0→1`，胜者数据落盘，后到者收到 409，无静默覆盖。
- S9 连续 10 次保存：36 行、行序不变、A–K 无丢失、id 无重复、注入的未知字段 `__custom_marker` 保留。
- S10 `docker restart wbs-rongcheng` 后 health 恢复、`data/wbs.json` sha 与全量 JSON 完全一致（重启持久）。
- S11 重启后授权身份（`王言`）仍能读且能写，写入落盘生效（revision 10→11）。
- S12 静态资源（`/`、`app.js`、`styles.css`、`vendor/xlsx.full.min.js`、`template.xlsx`）全部同源 200，CSP `default-src 'self'`。
- S13 写操作产生 `data/audit.log` 审计记录（含身份与 revision）。
- `deploy/rollback.sh`（隔离：`APP_DIR`/容器名/4181）：退出码 0、自检 health 通过、容器改用 `PREV_IMAGE`、恢复上一 data 备份（BACKUP-STATE）、回滚前数据另存 `*.rollback.bak`（RB1–RB8）。
- `deploy/deploy.sh`（隔离：拷贝目录/容器名/4182）：`docker build --network none`（构建期不回外网）、替换前备份 `data/wbs.json` → `.bak`、写出 `state/previous.env`（PREV_IMAGE/NEW_IMAGE/DATA_BAK）、新容器 host 网络且 4182 仅回环、自检 health 通过（DP1–DP11）。备注：本次构建各层命中缓存（COPY 内容未变），`--network none` 参数与脚本路径已按交付脚本执行。

## 6. 缺陷

**【缺陷 D-1】严重度：中**
- 复现路径：`GET /opt/wbs-rongcheng/public/index.html` → 选择「项目负责人」→ 点击工具栏「导出 Excel」（或 `node scripts/export-verify.js` 触发 `WBSApp.exportXlsx()`）；对下载的 `蓉城战役WBS-YYYYMMDD.xlsx` 执行 `python3 scripts/col-compare.py <导出文件>` 或用 `zipfile` 读 `xl/worksheets/sheet1.xml`。
- 期望行为：交付页面导出的 xlsx 保留原模板列宽（`A–K`，含 K 进展说明列宽 47.26），与作者自测结论「列宽设置保持原样」一致；自测路径与页面路径一致。
- 实际行为：交付页面路径导出的文件**无 `<cols>` 元素**（32762 字节；A–K 列宽全部丢失）；而作者自测路径（`tests/exportcheck.mjs` 用 `XLSX.read/write(..., {cellStyles:true})`）导出的文件含 `<cols>`（16384 条 col 声明，1172885 字节，A/B/C 列宽与模板一致）。根因：交付页面 `loadExportWorkbook` 用默认 `XLSX.read(..., {type:'array'})`，不解析 `!cols`，`XLSX.write` 因此不写 `<cols>`；自测脚本另用 `{cellStyles:true}`，两条路径不一致，导致 `selftest/12.log` 的 PASS 不对交付页面成立。证据：`export-cols-compare.log`、`exported.xlsx`（sha256 `626b269a…`）、`exported-via-author-selftest-path.xlsx`（sha256 `5ea26bf8…`）。
- 影响范围：所有通过页面导出的文件视觉列宽丢失（尤其 K 进展说明列从 47.26 收窄为默认宽）；Sponsor 待决事项 #1 中「列宽不受影响」的说明不成立，决策依据失真。不影响验收 8 的文本口径。
- 建议修复位置：`/opt/wbs-rongcheng/public/app.js:611`（`loadExportWorkbook` 的 `XLSX.read`）；同步 `/opt/wbs-rongcheng/tests/exportcheck.mjs:58,62`（自测改用与页面一致的导出路径，或在页面侧补 `!cols`/改用 `{cellStyles:true}`），并据实修正 `selftest/12.log` 与 Stage1 待决事项 #1 的「列宽」表述。

**【缺陷 D-2】严重度：低**
- 复现路径：以 `王言`（普通负责人）身份进入工作台 → 点击任意行的「序号」列单元格（`td.cell-id`）；对照点击同一行的状态/演示范围/进展说明等只读单元格。
- 期望行为：与其它只读（`locked`）单元格一致，给出明确的中文只读/无权限提示，避免同类元素反馈不一致。
- 实际行为：序号列单元格点击**无任何反馈**（既无提示也不进入编辑），而其它 `locked` 单元格均弹出「当前身份…只读…」提示。证据：`dom-adv-detail.json` / `dom-verify.log` C-ADV 明细中 `序号列单元格（td.cell-id）` `silent:true`。
- 影响范围：仅反馈一致性；行号列本身不应可编辑，不阻断任何任务路径，故定「低」（理由：序号为约定俗成的非编辑展示列，无编辑态视觉暗示——无虚框 hover、灰色文本；仅与相邻只读单元格的提示行为不一致，属打磨项）。
- 建议修复位置：`/opt/wbs-rongcheng/public/app.js:440-443`（`renderRow` 的 `idCell` 未绑定 click 处理，或将该列改为不携带 `locked` 样式以消除同类外观不同反馈）。

## 7. 残余风险与待 Sponsor 决定

1. **导出视觉保真（含 D-1）**：锁定版 SheetJS 0.18.5 社区版不写出单元格样式，导出 `styles.xml` 26197→1572 字节、数据区样式索引 396→0；列宽另因路径差异丢失（D-1）。完整视觉保真需方案决策（zip 级仅改 `sheet1.xml` 保留原 `styles.xml`/`<cols>`，或改用 Pro）。
2. **基础镜像**：`Dockerfile` 用本机已缓存 `docker.m.daocloud.io/library/node:24-slim`（设计示例为 `node:20-slim`），以满足「构建期不回外网」；`server.js` 仅用标准库，两者兼容。是否严格对齐 20-slim 需决策。
3. **容器网络模型**：容器用 `--network host` 使进程真实只绑定 `127.0.0.1:4180`；宿主 `ss -ltn` 仅见回环监听，未对公网暴露，未触碰 Multica 三容器。该模型与「bridge 发布端口」的常规做法不同，需 Sponsor 确认可接受。
4. **运行目录遗留测试工具**：现场 `/opt/wbs-rongcheng/tests/.tools/`（jsdom + 依赖，约 1852 文件）与 `tests/.tmp/`（自测中间产物）留在运行目录；已确认**不在**交付源码快照、不在镜像内。是否需要清理为卫生项，请协调员按需处理。
5. **回环可达性**：本机 node 进程因包装脚本处于 bridge 网络命名空间而无法直连 4180，交互级验证须用 host 网络容器；这不是服务缺陷，但后续任何以 node 直连 4180 的验证脚本都会失败，需沿用同一方法。

## 8. 证据文件清单（本目录）

| 文件 | 内容 |
| --- | --- |
| `run-all.out` | 一键复跑总控日志（时间戳、各步退出码、收尾状态） |
| `input-receipt-qv.txt` | 输入基线 `sha256sum -c INPUT-SHA256SUMS`（8/8 OK） |
| `integrity.log` | 三链一致性（I1–I6：SHA256SUMS / 磁盘 / git HEAD blob / 推送 / 凭据扫描） |
| `dom-verify.log`、`dom-results.json`、`dom-adv-detail.json` | DOM 交互级验证 35 条判定 + 结果 JSON + 对抗路径逐目标明细 |
| `export-run.log`、`exported.xlsx`、`export-json-snapshot.json`、`export-meta.json` | 页面导出入口产物与导出时刻的 JSON 快照 |
| `export-readback.log` | python 标准库读回比对（验收 8 / 验收 2 Excel 侧） |
| `export-cols-compare.log`、`exported-via-author-selftest-path.xlsx` | 列宽保真对比（D-1 证据；作者自测路径导出文件副本） |
| `svc-verify.log` | 服务/API/持久化/并发（S1–S14） |
| `rollback-isolated.log`、`deploy-isolated.log` | 隔离复跑 `deploy/rollback.sh`、`deploy/deploy.sh` 语义 |
| `start-state-wbs.json`、`scripts/start-state-sha256.txt` | 验证前现场数据快照与 sha256（收尾已恢复一致） |
| `scripts/` | 本次全部复跑脚本（随证据入库，可复现） |
