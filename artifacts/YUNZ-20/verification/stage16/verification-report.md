# Stage16 独立复验报告：WC-001 变更包 #6（CH-13「导出日报」改为可复制关键信息文本弹层）

- 任务：`YUNZ-36`（Stage16 独立复验，独立验证工程师 AI-QV）
- 被验证对象：`YUNZ-35`（Stage15 变更包 #6 实现与自测，`in_review`）
- 复验时间：2026-10-15 18:51–19:04（+08）
- 被验证产物（只读）：`/opt/wbs-rongcheng/`（含 `0.0.0.0:4180` 运行容器、镜像 `wbs-rongcheng:20261015181021`）、
  `data/wbs.json`（revision 10）、`data/audit.log`、源码快照 `/opt/SoftFactory-AINative/artifacts/YUNZ-20/wbs-rongcheng/`
- 本轮约定（验证范围）：CH-13 全量必测 1–9 + 不回归抽样；**未改动被验证实现代码**，未触碰现场数据
- **结论：通过但有待决项**（未发现功能缺陷、无交互级失败；待决项见第 3 节，属 Sponsor 裁决范围，本报告不自行接受残余风险）

## 0. 判定依据汇总

| 证据块 | 执行方式 | 断言结果 |
| --- | --- | --- |
| 隔离实例真实浏览器（isoA 26 项 + isoB 18 项） | `scripts/qv-iso-browser.cjs`（Chromium 140 容器，隔离服务 4260/4261） | PASS=44 / FAIL=0 |
| 现场真实浏览器只读 + 真实下载（WBS） | `scripts/qv-live-browser.cjs`（打现场 4180） | PASS=26 / FAIL=0 |
| WBS 导出 xlsx 独立读回（zipfile + xml.etree） | `scripts/qv-readback.py` | PASS=49 / FAIL=0 |
| 服务端保留项与不回归（审计 / 409 / 400 / 重启 / identity_added） | `scripts/qv-server-api.py`（隔离实例 isoS，4263） | PASS=22 / FAIL=0 |
| 部署与一致性（绑定 / 三端 health / 镜像 / 四方 sha256） | `scripts/qv-deploy-consistency.sh` | PASS=16 / FAIL=0 |
| 不回归抽样（CH-1/2/3/5/6/9、验收 10） | `scripts/qv-nonreg-browser.cjs`（隔离实例 isoA，4265） | PASS=15 / FAIL=0 |
| 作者自报核验（独立复算，**非结论证据**） | `scripts/qv-author-claims.sh` | PASS=13 / FAIL=0 |

合计 **185 项断言全部通过、0 失败**。一键复跑：`bash scripts/run-all.sh`（逐项输出在 `logs/00…08`）。

## 1. 两条证据链

- **自报链（不作为证据）**：`YUNZ-35` 交付评论 `01a13f2b-3424-7cb5-a6d0-795d5784d83c` + `artifacts/YUNZ-20/selftest/stage15/`。
- **复跑链（本报告结论证据）**：本目录 `scripts/` + `logs/00…08-*.log` + `results/`（含独立构造的期望文本）+ `downloads/`（真实浏览器下载原件）+ `shots/`。
- 自报声明经独立复算一致（`logs/07`）：`server.js 81adc14b…`、`public/app.js 33e897a2…`、`public/index.html 70cbd82b…`、
  `public/styles.css eaf8f102…`；`diff -rq` 运行目录 `public/` 与源码快照逐字一致；提交 `b25996c` 仅改 `artifacts/YUNZ-20/`（48 文件、范围外 0）。
  自报矩阵输出未被采信，仅为对照。

## 2. 必测逐项结果（对照派发单 1–9）

### 1) 弹层入口 / 无下载 / 关闭 —— 通过
- 真实浏览器点「导出日报」：`#daily-panel` 可见、`role=dialog`、`aria-modal=true`；`#daily-text` 为 `PRE` + `white-space:pre-wrap`、
  非 `contenteditable`、`tabindex=0` 且 `focus()` 后 `activeElement` 命中自身（ISO/LIVE-01/04/05/07）。
- **不产生任何文件下载**：界面级哨兵 `URL.createObjectURL` 调用 0、`a[download]` 点击 0、Playwright `download` 事件 0、
  全程无 xlsx/octet-stream 响应；前端 `buildDailyWorkbook`/`dailyBytes` 均为 `undefined`（ISO/LIVE-06/07/08、`D-11`）。
- 关闭按钮与 `Esc` 均可关闭；重开正常（ISO/LIVE-22）。

### 2) 剪贴板两条路径 —— 通过
- 路径①：授予剪贴板权限时走 `navigator.clipboard.writeText`（调用 1 次），提示「已复制，可直接粘贴到微信」，
  **剪贴板读回文本与弹层文本逐字一致**（现场 2018 字符 / 隔离 8 行）（ISO/LIVE-15/16/17）。
- 路径②：将 `navigator.clipboard` 置为不可用后点「复制」→ 回退 `document.execCommand('copy')`（`writeText` 调用 0 次、
  `execCommand` 调用 1 次），提示同中文文案，`execCommand` 时选中的文本与剪贴板读回文本均与弹层文本逐字一致（ISO/LIVE-18/19/20/21）。

### 3) 概况行与兜底 —— 通过
- `今日延期 X 项 / 阻塞 Y 项` 的 X/Y 与弹层事件行数、`/api/daily` 的 `text.delayedCount/blockedCount` 三口径一致
  （isoA `5/3` 共 8 行；现场 `51/0` 共 51 行）（ISO/LIVE-09/12/14）。
- 无事件（隔离构造 isoB）时整体文本**仅一行** `今日无阻塞、延期。`，不输出概况行（ISOB-09/10、`logs/04`）。

### 4) 事件行逐字断言 —— 通过
- 隔离构造逐字命中四种结论模板：`设计 10-12 到期未更新，判定延期。` / `开发延期。` / `设计更新为阻塞。` / `开发阻塞。`；
  前缀 `【延期·高风险】`/`【阻塞·高风险】`、负责人前 `@`、阶段中文名与 `MM-DD`（`Asia/Shanghai`）均正确（`logs/01`、`results/expected-text.json`）。
- 现场 51 行全部命中 `【延期·高风险】一级 / 二级 / 任务项 @负责人：结论。` 模板，无一行违反（LIVE-11）。

### 5) 内容范围与排序 —— 通过
- 延期条目全部在阻塞条目之前；同类内按任务（一级/二级/任务项）与阶段顺序（设计→开发→测试→产品→演示准备）稳定
  （isoA 期望序 5 延期 + 3 阻塞逐字一致；现场 `lastDelay=50`、无阻塞条目）。
- 一任务多事件多行且标签/结论各自独立（isoA T-A4：设计延期 / 开发延期 / 测试更新为阻塞，三行独立）。
- 完成与普通变更**不出现**：isoA 构造的当日「设计未开始→已完成」与人员池新增事件均未进入文本；现场文本零命中 `【完成】`/`【普通】`。

### 6) 派生规则两条构造用例 —— 通过
- 用例①（阶段计划日期 < 今天且今日 0 点至今该阶段无任何更新）→ 产出 `设计 10-12 到期未更新，判定延期。`。
- 用例②（当天已更新该阶段，含改为其他状态）→ 按实际新状态归类且**不重复**产出「到期未更新」：isoA 中 `T-A1.test`
  当日被更新后为「未开始」→ 完全不出行；`T-A1.dev` 当日更新为「延期」→ 仅出 `开发延期。`，无派生行。
- 现场说明：51 条延期全部使用最简结论 `X延期。`，原因是当日审计存在这些阶段的 `dates.*` 更新（`logs/05` 现场审计复核：
  `2026-10-15T03:10:35Z` 起 35 个任务均有当日日期变更），派生分支在现网数据下不触发，故必须由隔离构造校验——本项已覆盖。

### 7) 保留项 —— 通过
- 服务端审计继续写入（隔离 PUT 后 `audit.log` 新增一条含 `old/new/snapshot`）；`GET /api/history` 仍可用
  （现场 236 条；隔离下含本次 `phases.design.status` 变更与 `identity_added` 的 `人员池` 记录）（API-14/15/18/19）。
- `/api/daily` 旧汇总（`summary/blocked/changes/counts`）原样保留并附新 `text`；无任何文件/下载字段；`/api/daily.xlsx` 非 200（L04、API-03/06/07）。
- WBS「导出 Excel」仍真实下载（`蓉城战役WBS-20261015.xlsx`），独立读回 A–K 逐行一致、L–P 五色逐格一致、Q1 导出日期标签保留、
  A1:C1 合并与第 1/2 行原文保留、无旧全局 `status` 列、无 Q 列外列、数据区残留清空（LIVE-W-01…13、ISOA/ISOB-W-01…13）。

### 8) 不回归与验收条件抽样 —— 通过（抽样依据已逐条写明）
- 抽样依据：本变更只动「导出日报」链路（`server.js` 的 `dailyText` + `app.js` 弹层/复制 + `index.html #daily-panel` + `styles.css`），
  故对与之共享 DOM / 状态 / 权限 / 持久化的相邻能力做等效抽样。
- CH-1 Markdown 编辑器与转义安全（`<script>` / `<img>` 注入按字面显示、零 script/img 元素，宽/窄视口与新页签路径）→ `N10/N11/N11b/N12`。
- CH-2 人员池与新增人员（入口仅项目负责人可见 + API `identity_added` 审计与历史；非项目负责人 403）→ `N09`、`API-17…20`。
- CH-3 五阶段控件与五色映射（每行 5 个下拉、五色 computed 与映射一致、导出填充一致）→ `N02/N03`、`*-W-13`、`ISO-W-14`。
- CH-5 `demo` 网页隐藏但导出保留（页面零 demo 节点、导出 A–K 含「是否演示范围」）→ `N05`、`*-W-11`。
- CH-6 / 权限矩阵（本人行可编辑、他人行只读且点击给出中文只读提示）→ `N06/N07/N08`。
- CH-9 `#identity-layer` 进入工作台后隐藏（`hidden` + `display:none` + 无尺寸）→ `N01`。
- 验收条件抽样：#5 非法输入 400 且不落盘（`API-12`）；#6 原子写无 `.tmp` 残留 + 重启持久（`API-21/22`）；
  #7 变更后即时重算（`API-16`）；#8 导出保真（`*-W-*` 全部）；#9 缺 / 过期 `If-Match` 均 409 且不覆盖（`API-10/11`）；
  #10 `/api/health` ok + 页面无外部请求（`D-05/06/07`、`L25`、`N13`）；#1 身份切换可用（`N06/N09`）；
  #2 行序与条数（现场 35 行渲染顺序与 `live-wbs-at-export.json` 逐行一致）。
  #3 三端一致与 #4 增删行带确认未在本轮重复复测（依据：本包未改写入/增删路径，Stage14 `N12`、Stage15 回归 09 已覆盖）。
- 现场 `revision` 复验窗口内保持 10、无新增数据备份，未被本轮改动（`D-10`）。

### 9) 部署与一致性 —— 通过
- 运行容器 `wbs-rongcheng:20261015181021`、网络模式 `host`、状态 `healthy`、宿主监听 `:4180`；
  `127.0.0.1:4180`、`0.0.0.0:4180`、公网 `http://47.108.129.157:4180` 三端 `/api/health` 均 `{"ok":true,…,"revision":10}`（`D-01…D-07`）。
- 镜像内无 `node_modules` / `package-lock.json`（`D-08`）。
- 服务端返回资源 == 运行目录 == 源码快照 == 容器，四方 sha256 逐字节一致（`app.js`、`index.html`、`styles.css`、
  `xlsx.full.min.js`、`template.xlsx`；`server.js` 三方一致，服务端不对外返回）（`D-09`）。

## 3. 缺陷与残余风险

**功能缺陷：无**（CH-13 未发现需修复的缺陷；交互级验证未出现失败，未发现「点击无反应且无提示」类可发现性问题）。

1. **待决项（口径歧义，需 Sponsor 裁决，非缺陷）**：契约同时给出 `设计 MM-DD 到期未更新，判定延期。` 与 `设计延期。`
   两种结论，未规定「当前状态=延期 **且** 计划日期已过 **且** 今日未更新该阶段」时取哪一种；实现选择**派生结论优先**。
   影响：仅在上述三者同时成立时改变文本表达，两种写法均属契约列举的模板；现场数据当日已更新相关阶段，暂不触发。
   复现：隔离实例把某阶段设为 `延期`、`dates` 设为昨日、且当日无审计 → 得到 `设计 10-12 到期未更新，判定延期。`（`logs/01`）。
   定位线索：`/opt/wbs-rongcheng/server.js` 的 `dailyText`（`status === '阻塞'` 分支之后的日期判断处）。
   本报告不代为裁定；若验收要求此时用 `设计延期。`，只需改动该分支一处。
2. **观察项（不判缺陷，理由：契约未规定弹层高度，概况行与首条可见、可滚动）**：现场 51 条文本较长，弹层文本块为
   `max-height:46vh; overflow:auto`（实测 718 × 506 px），需滚动查看全部（`shots/live-daily-popup.png`）。
3. **既有事实（非本包引入，前序报告已记录，待 Sponsor 决策）**：现场数据为 35 条（缺 `T001`），与 `harness/spec.md` 验收条件 2
   的 36 条字面口径不一致。证据：`data/wbs.seed.json` 36 条含 `T001`；Stage12 / Stage14 报告已按 35 行记录；本包未改 `server.js`
   写入 / 删除路径、未删除任何行。影响范围仅条数字面口径。
4. **限制性说明（非缺陷）**：本轮「五色」断言在 xlsx XML 级（`fgColor` 填充）与浏览器 computed 级双重验证，
   但未在 Excel/WPS 真机人工目视；建议验收时人工打开确认观感。

## 4. 复跑方式与证据清单

- 一键复跑：`bash /opt/SoftFactory-AINative/artifacts/YUNZ-20/verification/stage16/scripts/run-all.sh`
- 环境：宿主 CentOS 7（glibc 2.17，无法直接跑 Playwright Chromium）→ 真实浏览器在官方镜像
  `mcr.microsoft.com/playwright:v1.55.0-jammy`（Chromium 140）内运行；xlsx 读回与文本口径用宿主 `python3`（3.6.8）标准库；
  隔离实例服务端在一次性容器内以隔离数据目录启动，端口仅绑 `127.0.0.1`（4260 / 4261 / 4263 / 4265），不触碰现场 4180 与现场数据。
- 环境缺口：无（node 与真实浏览器均可用；未安装任何系统级依赖，依赖只落在工作目录内）。
- 证据：`logs/00-iso-data.log … 08-nonreg.log`；结果 JSON 在 `results/`（含独立构造的 `expected-text.json`、`isoA-expect.json`）；
  真实浏览器下载原件在 `downloads/`（现场与隔离的 WBS xlsx + 导出时 `/api/wbs` 快照）；截图在 `shots/live-daily-popup.png`
  与 `results/isoA-daily-popup.png`、`results/isoB-daily-popup.png`；隔离数据构造在 `iso/`。
