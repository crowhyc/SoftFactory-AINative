# Stage18 独立复验报告：WC-001 变更包 #7（CH-14「阶段状态占比总览」+ 只读 `GET /api/stats`）

- 任务：`YUNZ-38`（Stage18 独立复验，执行者：独立验证工程师 AI-QV）
- 被验证对象：`YUNZ-37`（Stage17 变更包 #7 实现与自测，`in_review`）
- 复验时间：2026-10-16 12:19–12:34（+08）
- 被验证产物（只读）：`/opt/wbs-rongcheng/`（运行容器 `wbs-rongcheng`，镜像 `wbs-rongcheng:20261016115756`，运行态绑定 `0.0.0.0:4180`）、
  `data/wbs.json`（revision 14）、`data/audit.log`（294 行）、源码快照 `/opt/SoftFactory-AINative/artifacts/YUNZ-20/wbs-rongcheng/`
- 本轮约定（验证范围）：CH-14 必测 1–10 全量 + CH-1…CH-13 不回归抽样 + 验收条件 1–10 抽样；**未修改被验证实现代码**，未触碰现场数据
- **结论：通过但有待决项**（未发现功能缺陷、无交互级失败；待决项见第 3 节，属 Sponsor 裁决范围，本报告不自行接受残余风险）

## 0. 判定依据汇总

| 证据块 | 执行方式 | 断言结果 |
| --- | --- | --- |
| 隔离实例真实浏览器（isoA 12 行 / isoB 0 行 / isoC 1-1-1 / isoS 可写） | `scripts/qv-iso-browser.cjs`（Chromium 1.55 容器，隔离服务 4260–4263） | PASS=71 / FAIL=0 |
| 隔离实例真实浏览器导出 WBS + 独立 xlsx 读回 | `scripts/qv-export-wbs.cjs` + `scripts/qv-readback.py`（zipfile + xml.etree） | PASS=13 / FAIL=0 |
| 现场真实浏览器只读 + 375px + 只读纪律 | `scripts/qv-live-browser.cjs`（打现场 4180） | PASS=15 / FAIL=0 |
| 现场浏览前后数据指纹不变 | `scripts/qv-run-live-browser.sh` | PASS 1（audit sha 不变、wbs sha 不变、rev 14→14） |
| 服务端口径与只读性（现场 + 隔离写路径 409/400/重启/审计/10 次保存） | `scripts/qv-server-api.py` | PASS=19 / FAIL=0 |
| 迁移幂等与旧 `status` 保留（CH-11/CH-12） | `scripts/qv-migrate-check.py` | PASS=7 / FAIL=0 |
| CH-1…CH-13 不回归抽样 + 验收 1/2/5/10 抽样 | `scripts/qv-nonreg-browser.cjs` | PASS=17 / FAIL=0 |
| 部署与一致性（绑定 / 三端 health / 镜像 / 三方 sha256） | `scripts/qv-deploy-consistency.sh` | PASS=21 / FAIL=0 |
| 作者自报核验（**非结论证据**，仅对照） | `scripts/qv-author-claims.sh` | PASS=9 / FAIL=0 |

合计 **173 项断言全部通过、0 失败**。一键复跑：`bash scripts/run-all.sh`（逐项输出在 `logs/00…09`）。

## 1. 两条证据链

- **自报链（不作为证据）**：`YUNZ-37` 交付评论 `01a142ec-3881-7c31-817a-e86dfa8c9b1b` + `artifacts/YUNZ-20/selftest/stage17/`。
- **复跑链（本报告结论证据）**：本目录 `scripts/` + `logs/00…09-*.log` + `results/`（含按契约原文独立复算的期望口径 `expected-stats.json`）+
  `downloads/`（真实浏览器下载原件）+ `shots/`（真实浏览器截图）。
- 作者声明的四个 sha256 经独立复算一致（`logs/09`）：`server.js 507df430…`、`public/app.js b48cd499…`、`public/index.html 3b762e0d…`、
  `public/styles.css 2bab8f68…`；运行目录 `public/` 与源码快照 `diff -rq` 逐字一致；提交 `ab040d8` 共 40 文件、范围外 0、已推送 `origin/main`。
  自报矩阵输出未被采信，仅为对照。

## 2. 必测逐项结果（对照派发单 1–10）

### 1) 结构 —— 通过
- 四个隔离实例与现场均断言：`#phase-overview` 可见且常驻工作台顶部（页头之下、工具条与表格之上）；`.overview-row` 恰 5 行、
  `data-phase` 顺序为 `design/dev/test/product/demo_prep`；每行「阶段名 + 五种状态徽标」；`badRow=[]` 无跨阶段合并行；
  徽标文本格式 == `状态名 数量 百分比%`（ISO/LIVE `01–04`）。
- 条内 `button` 数 = 0、无「刷新/reload」文案；顶部合计文本 == `共 N 条`（`ISO/LIVE 05–06`）。

### 2) 与 `/api/stats` 一致 —— 通过
- 四个隔离实例 + 现场：DOM 的 `data-count` / `data-percentage` / 徽标文本与 `GET /api/stats` **逐项完全一致（各 25 项）**（`*-07`）。
- `/api/stats` 与**按契约原文独立复算**的期望值逐项一致（含并列余数的分配顺序）：`results/expected-stats.json` 对 4 实例全等（`*-08`）。
- `/api/stats` 与 `/api/wbs` 同源断言：`total == tasks.length`、`revision == meta.revision`（现场 35/35、rev 14；isoA 12/12、rev 7；isoB 0/0；isoC 3/3）（`*-09`）。
- **前端原样渲染**：用伪造响应（count 与任务数不符、合计 99）断言页面逐字呈现 `共 999 条` 与 `未开始 7 7.7%`，无本地统计、无二次四舍五入（`FRONT-16`）。

### 3) 占比边界 —— 通过
- ① 0 行任务（isoB）：`/api/stats` 200、`total=0`、25 项全 `0 / 0.0%`、页面全 `0 0.0%`、不除零不报错（`ISOB-12`）。
- ② 单阶段 1/1/1（isoC）：`design` = `33.4 / 33.3 / 33.3 / 0.0 / 0.0`，五项合计**恰为 100.0%**（最大余数法生效），页面显示一致（`ISOC-12/13`）。
- ③ 计数为 0 的状态仍显示 `0 0.0%`（四个实例 + 现场均断言）（`*-11`）；各阶段五项合计恰 100.0%（`*-10`；isoA/isoC 含并列余数与 1/12 截断补齐场景）。

### 4) 五色一致 —— 通过
- 徽标 computed `background-color` == 五色映射（未开始 `rgb(158,158,158)` / 已开始 `rgb(47,128,237)` / 已完成 `rgb(39,174,96)` / 延期 `rgb(231,76,60)` / 阻塞 `rgb(255,212,0)`），
  且与表格阶段控件 `select.phase-select.phase-<状态>` 的 computed 颜色**逐项相同**（隔离 + 现场）（`*-14/15`、`LIVEB-07`）。

### 5) 刷新时机 —— 通过
- 隔离可写实例（isoS）真实写路径：保存成功后总览数值确实变化且 == 最新 `/api/stats`；新增并保存后总数 +1（12→13）且口径一致；
  删除并保存后总数 -1（13→12）；身份切换回到工作台后重算；**新增人员（写操作）成功后**总览重算且与服务端口径一致（`ISOS-17…21`）。
- 页面无手动刷新按钮（`*-05`）；未保存草稿不进入总览（口径唯一来源是服务端，与契约一致）。

### 6) 权限与只读性 —— 通过
- isoA **九个身份**（项目负责人 + 8 位普通负责人）全部可看到同一只读总览（`ISOA-22` distinct=1）；现场 12 个身份同样全部可见且一致（`LIVEB-08`）。
- 权限矩阵不回归：项目负责人有新增行/新增人员/删除入口，普通负责人三者皆无；他人行只读（日期输入 `disabled`、单元格 `locked`），点击给出中文只读提示（`ISOA-23/24`、`LIVEB-09`、`N07–N09`）。
- **查看总览不产生副作用**：现场连续 5 次 `GET /api/stats` 及完整页面浏览（含静态资源）前后，`audit.log` 行数与 sha256 不变、`wbs.json` sha256 不变、`revision` 14→14（`LIVE-09`、`LIVEB-16`、`logs/09` `live-invariance.json`）。
- `/api/stats` 仅 GET：POST/PUT/DELETE → 405；无 `Content-Disposition`、`Content-Type: application/json`（`LIVE-07/08`）。

### 7) 移动端 375px —— 通过
- isoA / isoC / 现场：`documentElement.scrollWidth <= clientWidth`（375 = 375）、`body.scrollWidth` 同为 375，**无横向滚动**；
  25 个徽标全部在视口内（`overflowBadges=[]`）；总览条底边 700 < 表格顶边 1025（不遮挡）；五阶段仍各成一组（`ISOA/ISOC-25/26`、`LIVEB-11/12`）。

### 8) Excel 不进掺（3A）—— 通过
- 隔离实例真实浏览器下载 `蓉城战役WBS-20261016.xlsx`，Python 标准库独立读回（单 sheet `工作表1`）：
  第 1/2 行 A–K 与源模板**逐格一致**、`A1:C1` 合并保留、`L2:P2` = 设计/开发/测试/产品/演示准备进度表头、
  数据区 12 行 × 11 列与导出时 `/api/wbs` 快照逐行一致、`L–P` 60 格文字与五色填充逐格匹配且五色全出现、
  `Q1` = `导出日期：2026-10-16 12:33`、无超出数据区残留单元格（`R01–R13`）。
- **全表不含 CH-14 统计**：无「占比」文案、无 `数量 百分比%` 模式、无 `%` 字符、无旧 `status` 列（`R10`）。
- 日报文本弹层文本 1804 字符、不含本统计（`ISOA-27`）；导出流程仅 1 个 xlsx 下载（导出日报不产生文件）（`R13`）。

### 9) 不回归 —— 通过
- **CH-1…CH-13 抽样**（依据：本变更仅**新增**只读接口与顶部只读条，未改动既有渲染/权限/持久化/导出链路）：CH-1 进展说明 Markdown 编辑器
  （桌面双栏 + 375px 标签切换，原始 HTML 不执行——无 `script`/`img` 注入、无 XSS 全局，`N11/N17`）、CH-2/CH-8 人员池与新增人员入口（`N10`）、
  CH-3/CH-10 五阶段控件与五色、无旧「状态」列（`N04–N06`）、CH-5/CH-9 `demo` 不渲染但导出保留（`N06` + `R07`）、CH-6 权限矩阵（`N07–N09`）、
  CH-4 身份入口与进入工作台（`N01/N02`）、CH-13 日报文本弹层（`N13`）、CH-11/CH-12 迁移幂等与旧 `status` 保留（`MIG-01…07`）、409/400/重启持久/审计/`identity_added`（`ISOA-13…17`）。
- **验收条件 1–10 抽样**（依据：以 `harness/spec.md` 1–10 条为准，逐条对应到本轮断言）：1 → `N01/N02`；2 → `N03`；3 → `N07/N08/N09`；4 → `ISOA-23`；
  5 → `N14`（前置校验拦下、0 次 PUT）；6 → `ISOA-17`（重启后数据仍在）；7 → `ISOA-19`（连续 10 次保存：revision 9→19、A–K 无丢失/无重复/无未知字段）；
  8 → `R01–R13`；9 → `ISOA-13`（409 不覆盖）+ `ISOA-14`（400 不落盘）；10 → `N15` + `D04–D06`。
- 页面全程**无外部请求**、**0 次新增下载**（隔离与现场均断言；`ISO-28/29`、`LIVEB-13/14`），全程无 `pageerror`。

### 10) 部署与一致性 —— 通过
- 运行容器 `wbs-rongcheng`，`WBS_HOST=0.0.0.0`、`WBS_PORT=4180`、`--network host`、挂载 `/opt/wbs-rongcheng/data`；
  `127.0.0.1:4180`、`0.0.0.0:4180`、公网 `http://47.108.129.157:4180` 三端 `/api/health` 均 `{"ok":true,"revision":14}`（`D01–D06`）。
- 镜像 `wbs-rongcheng:20261016115756` 内无 `node_modules` / `package-lock.json`（`D07`）。
- sha256 三方一致（`server.js`、`public/{app.js,index.html,styles.css,template.xlsx}`）：运行目录 == 源码快照 == **镜像内实际文件**
  == 服务端 HTTP 返回体（`D08a/D08b/D09`，共 14 项）。

## 3. 缺陷与残余风险

**缺陷：无**（未发现功能缺陷，无交互级失败，无需修复项）。

残余风险与待决项（均不构成实现缺陷，交 Sponsor 裁决；本报告不自行接受）：
1. **总览条位置口径**：作者实现选在「页头」与「搜索/操作工具条」之间（工作台顶部常驻）。若 Sponsor 期望置于页头内部或紧贴表格上方，需新契约授权后调整。
2. **草稿不预演**：新增/删除在保存前属本地草稿，总览只反映服务端口径（契约「前端不自行二次计算口径」的直接结果）。若期望草稿即时预览，需新契约授权。
3. **公网可达性**：公网 `4180` 健康依赖云安全组放行，本轮实测 ok；安全组收紧只影响公网可达性，不影响本机/`0.0.0.0` 与功能。
4. **Excel `dimension` 元数据（观察项，低）**：导出后工作表 `dimension` 仍为模板原始范围 `A1:Q38`，而实际只有 `N+2` 行单元格
   （隔离用例 12 行 → 仅 14 个 `row` 元素、无超出数据区残留）。xl/xml 读回与 Excel 均按实际单元格读取，不影响 3A 与保真；仅元数据未重算。

## 4. 证据清单（本目录）

- `scripts/`：`qv-make-iso-data.py`、`qv-iso-browser.cjs`、`qv-export-wbs.cjs`、`qv-readback.py`、`qv-live-browser.cjs`、
  `qv-server-api.py`、`qv-migrate-check.py`、`qv-nonreg-browser.cjs`、`qv-deploy-consistency.sh`、`qv-author-claims.sh`、
  `qv-run-*.sh`、`run-all.sh`
- `logs/00…09`、`logs/99-run-all.log`（一键复跑汇总：**PASS 173 / FAIL 0**）、`logs/{readback,server-api,migrate}.out`
- `results/`：`expected-stats.json`（契约口径独立复算）、`api-iso{A,B,C,S}-stats.json`、`live-stats.json`、`live-overview-dom.json`、
  `iso-browser-results.json`、`live-browser-results.json`、`live-invariance.json`、`nonreg-results.json`
- `downloads/`：`isoA-蓉城战役WBS-20261016.xlsx`（真实浏览器下载原件）、`isoA-wbs-at-export.json`、`isoA-download-meta.json`
- `shots/`：`isoA-workbench-1500.png`、`isoC-workbench-375.png`、`isoA-workbench-375.png`、`isoS-after-writes-1500.png`、
  `live-workbench-1600.png`、`live-workbench-375.png`
- `iso/`：`isoA`（12 行 / 九身份）、`isoB`（0 行）、`isoC`（1-1-1）、`isoS`（写路径）、`isoNR`、`isoMIG`、`isoAPI`（隔离数据，可复现重建）
