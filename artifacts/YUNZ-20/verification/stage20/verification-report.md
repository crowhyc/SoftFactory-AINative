# YUNZ-40 Stage20 独立复验报告：WC-001 变更包 #8（CH-15 全量统计 + 分阶段详情 + 产品验收改名）

- 结论：**通过**
- 复验对象：Stage19（`YUNZ-39`）交付的 CH-15；被验证运行态 `/opt/wbs-rongcheng/`（绑定 `0.0.0.0:4180`，运行镜像 `wbs-rongcheng:20261016144702`）
- 复验时间：2026-10-16 15:32–16:00（Asia/Shanghai）；执行者：独立验证工程师（AI-QV）
- 本轮约定：只读 `/opt/wbs-rongcheng/`（含运行服务与 `/api/stats`）、`data/wbs.json`、`data/audit.log`、`/opt/SoftFactory-AINative/artifacts/YUNZ-20/`；写入仅落本目录 `artifacts/YUNZ-20/verification/stage20/`
- 环境：Chromium 140.0.7339.16（`mcr.microsoft.com/playwright:v1.55.0-jammy`）/ node v24.21.0 / python3 3.6.8 / docker 26.1.4
- 用例总量：**240 PASS / 0 FAIL**（本任务复跑；作者自报另成链，仅作对照）

## 1. 两条证据链

- 链 1（作者自报，非本任务证据）：`/opt/SoftFactory-AINative/artifacts/YUNZ-20/selftest/stage19/`（README.md + 01–10.log + matrix-summary.txt + browser/ + live/）。核验：自报 4 个源文件 sha256 与实测一致；自测产物齐备；自测日志 0 FAIL（188 PASS 行）。输出见 `logs/07-author-claims.log`（25 PASS / 0 FAIL）。
- 链 2（本任务复跑，结论依据）：本目录 `scripts/`（独立编写，不复用作者断言）+ `logs/` + `results/` + `downloads/` + `shots/`。
- 交付物来源核验：`server.js` / `public/app.js` / `public/index.html` / `public/styles.css` 与入库快照 `artifacts/YUNZ-20/wbs-rongcheng/` 逐字一致（`logs/06-deploy.log`）；服务端返回的 5 个静态资源与入库快照 sha256 一致。

## 2. 逐项核查与证据

### 必测 1 全量统计结构（通过）
- 顶部 `#overview-rows` 只有 **1** 行，`data-phase = aggregate`，标签「全部五阶段合并」；CH-14 的顶部五段分行已不存在（`10a/10c`）。
- 五种状态徽标齐显，文本 = 状态名 + 数量 + 百分比，`data-count` / `data-percentage` 与 `/api/stats.aggregate` 逐项一致（`10b`）。
- 分母文案「五个阶段合计，分母 = 当前任务总数 × 5」，页面计数合计 = 总数 × 5（isoB：60 = 12×5；现场：170 = 34×5）（`10f`、`20a`）。
- 0 项状态仍显示「阻塞 0 0.0%」（`10e`、`13c`）。
- 证据：`logs/01-iso-browser.log` 10a–10g（9 PASS）、`logs/05-live-browser.log` 20a（5 PASS）。

### 必测 2 详情面板（通过）
- 全量区右侧 `.overview-head` 内有可见「详情」按钮，横向位于统计行右侧（`11a`；`btnX=1521 > rowsX=33`）。
- 点开后 5 行，顺序 设计 / 开发 / 测试 / 产品验收 / 演示准备，每行 5 徽标，count + percentage 与 `/api/stats.phases` 及独立期望逐项一致（`11b/11c`）。
- 关闭按钮与 `Esc` 均可关闭（`11d/11e`）。
- 构造未保存草稿（Q001 设计日期改为 2026-11-11）后，打开 + 关闭详情：草稿值、`dirty`、保存按钮可用态、会话状态全部原样保留（`11f`）。
- 伪响应原样渲染：注入 `count=5 / percentage=9.9` 后页面显示「未开始 5 9.9%」，详情首行显示「0 0.4%」——前端不自行统计、不二次四舍五入（`11g`）。
- 证据：`logs/01-iso-browser.log` 11a–11g（10 PASS）、`logs/05-live-browser.log` 20b（2 PASS）、`shots/isoB-detail-1600.png`、`shots/live-detail-1600.png`。

### 必测 3 与 `/api/stats` 一致 + 隔离数据构造校验（通过）
- 隔离数据六组：isoA（design 1/1/1 边界）、isoB（aggregate 19/20/20/1/0，需最大余数法）、isoC（0 行）、isoS（含阻塞/延期 + 今日 `phases.product.status` 审计）、isoD（脏数据）、isoE（seed 36 行无 phases）。
- 期望值由**第二套算法**独立复算（`fractions.Fraction` 精确有理数 → 下取 0.1 → 最大余数法；`scripts/qv20-make-iso-data.py`），与实现无共享代码。
- 页面全量区 / 详情区数值 = `/api/stats` = 独立期望，三处逐项一致（`12/isoA…isoS`，16 PASS）；`aggregate.denominator = 总数 × 5`（isoA 15 / isoB 60 / isoS 15 / 现场 170）。
- 同源断言：`/api/stats` 的 total / revision 与 `/api/wbs` 一致，且由 `/api/wbs` 独立复算两组结果后与 `/api/stats` 逐项相同（`01/*/same-source-with-api-wbs`）。
- 证据：`logs/00-iso-data.log`（9 PASS）、`logs/01-iso-browser.log` 12（16 PASS）、`logs/03-server-api.log` 01（含 4 组分布 × 8 项断言）、`results/expected-stats.json`。

### 必测 4 占比边界（通过）
- ① 0 行（isoC）：`total=0`、`aggregate.denominator=0`、全量区与详情区 25 个徽标全为「0 0.0%」，接口 200 不报错不除零（`13a`、`02/0 行…`）。
- ② 需补齐分布（isoB）：全量区五项合计恰 100.0%（31.7+33.3+33.3+1.7+0.0），五个阶段各自合计恰 100.0%（`13b`）。构造侧确认各阶段先截断合计仅 99.8%，证明补齐来自最大余数法而非朴素四舍五入（`00-iso-data.log` 构造-B）。
- ③ 0 项状态显示「0 0.0%」（全量区 + 详情区五行）（`13c`）。
- 附带：脏数据（isoD 一行缺 `product` 键）在数据文件路径上会被启动一次性迁移归一（`03/脏数据…归一`）；「计数与分母不一致时只截断不补齐」分支改以直接模块调用取证：aggregate [12,1,1,0,0] → 80.0/6.6/6.6/0.0/0.0（合计 93.2 < 100.0），product 阶段 [2,0,0,0,0] → 66.6 不补齐（`logs/03-server-api.log` 03，5 PASS）。

### 必测 5 五色一致（通过）
- isoS 五种状态齐备：全量区、详情区五行、表格阶段控件 giveaway computed `backgroundColor` 逐项相同且等于 未开始 `rgb(158,158,158)` / 已开始 `rgb(47,128,237)` / 已完成 `rgb(39,174,96)` / 延期 `rgb(231,76,60)` / 阻塞 `rgb(255,212,0)`（`14`，含「全量区=详情区=表格控件」联合断言）。
- 现场同项复核通过（`20c`）。

### 必测 6 改名 3A（通过）
- 网页五个阶段列头 = 设计 / 开发 / 测试 / 产品验收 / 演示准备（`15a`，现场 `20c`）。
- 全量区标题「全部五阶段合并」、详情标题「分阶段状态占比」与副标题（含「产品验收」）均按新名呈现；对全量区 + 详情区 + 页脚 + 表头扫描「产品」后接非「验收」的残留 = 0（`15b`）。
- 日报文本弹层阶段结论标签显示「产品验收延期」（isoS 构造，`15c`；现场当日无产品验收事件，故以构造数据覆盖）。
- `GET /api/stats` 与 `wbs.json` 的 key / 字段仍为 `product`：响应原文字面含 `"key":"product"` 且不含 `"key":"产品验收"`（`15d`、`03-server-api.log` `key-product` / `no-renamed-key`）。
- A–K 原数据逐条未改写：现场 `data/wbs.json` 与部署时备份 `wbs.json.20261016144702.bak` 的 level1/level2/task/owner/demo/dates.*/note 逐行逐字段一致（唯一差异 = 备份后 14:47:45 被外部身份删除的 T025 行）；现场 A–K 无任何被写成「产品验收」的字段（`08b`）。行内业务文本含「产品」的风险面（现场 0 行）由隔离数据 2 行覆盖：渲染后仍为「产品路线图确认（行内业务文本含“产品”）」「产品评审结论：产品部分已就绪」，未被改名污染（`15e`）。

### 必测 7 Excel 与日报（通过）
- 真实浏览器触发 1 次下载，文件 `蓉城战役WBS-20261016.xlsx`；统计 / 详情 / 日报 / 搜索交互 0 次下载（`16a/16d`）。
- 标准库 zipfile + xml.etree 独立读回（不借 SheetJS / openpyxl）：单 sheet「工作表1」；第 1/2 行 A–K 与模板逐格一致；`A1:C1` 合并保留；数据行末行 = N+2 = 14 且列界 = Q，无残留单元格；`L2:P2` = 设计进度 / 开发进度 / 测试进度 / **产品验收进度** / 演示准备进度；A–K 数据区与导出时 `/api/wbs` 逐行逐格一致（含 E 列 demo 原值保留）；L–P 文字 = phases 值且五色填充 = 9E9E9E/2F80ED/27AE60/E74C3C/FFD400；`Q1` = 「导出日期：2026-10-16 15:50」；A–K 不含旧 status 值；全表不含统计区（无「全部五阶段合并」「阶段状态占比」「%」文本）（`logs/04-readback.log`，14 PASS）。
- 日报弹层只读文本、无统计区徽标、无 `a[download]`（`15c`、`20d`）。

### 必测 8 刷新时机与只读性（通过）
- 保存后重算：isoB/Q001 设计 未开始→已完成，页面 = `/api/stats`（未开始 19→18，已完成 20→21，revision 0→1），无陈旧值（`17a`）。
- 新增行保存后：总数 12→13、分母 60→65，页面与接口一致（`17b`）；删除行保存后回到 12 / 60（`17c`）。
- 身份切换回到工作台后重算且对普通负责人可见（`17d`）；9 个身份逐一验证全量统计 + 「详情」按钮可见、数值与接口一致（`17e`）。
- 查看统计 / 开关详情 5 轮 / 打开日报：`revision` 保持 15（现场）/ 0（隔离），无下载；隔离侧另有 10 轮 `/api/stats` + `/api/daily` 后 `wbs.json` 与 `audit.log` 的 sha256 / size / mtime 完全未变（`17f`、`20d`、`logs/03-server-api.log` 04）。

### 必测 9 不回归抽样（通过）
- 五阶段控件（每行 5 个下拉，改动即入草稿）、Markdown 编辑器（`<img src=x onerror=…>` 与 `<b>` 被转义成文本，无 img 元素、无脚本执行，`**粗体**` 正常渲染，放弃后未写入）、人员池新增（空输入给中文错误、取消后身份数仍 9）、权限矩阵（本人行可编辑 / 他人行 `disabled` + 点击中文提示 / 无新增行按钮；他人行进展说明点击打开「只读预览」并明确标注，非静默无反应）、demo 隐藏但导出保留 E 列（`18a`–`18e`、`04-readback.log`）。
- 409 / 400：过期 `If-Match` → `409 {reason:conflict,current}`；非法 payload（空任务项 + 非法日期格式）→ 400 `errors[]` 且落盘文件 sha256 未变（`logs/03-server-api.log` 06）。
- 迁移幂等与旧 status 保留：isoE（seed 36 行无 phases）启动迁移补齐五阶段、旧 `status` 全保留、`migrated` 审计恰好 36×5 = 180 条且重启不重复（07、重启用例）。
- 重启持久：isoB 容器重启后 `/api/stats` 200、aggregate 逐项与期望一致、revision 未变（`03` 尾部 3 PASS）。
- `/api/history` 含 identity_added：`?date=2026-10-15` 返回 3 条「人员池 / 新增人员 X」记录（`08`）。
- 页面全程无外部请求、无 pageerror、无 console error（`10g/16f/19d/20f`）。
- 验收条件抽样：1（12 个身份列表 + 刷新后身份保持）、2（页面行序 = `/api/wbs` 行序）、3（王言行保存后 页面 / 前端状态 / API / 磁盘四端一致）（`18h`）。
- CH-14 对照口径变更说明：`#overview-rows` 内只允许 `aggregate` 一行（`10c`），CH-14 的顶部五段分行断言随本轮口径同步为「全量一组 + 详情五行」；本轮未发现 CH-14 能力回退（`GET /api/stats.phases` 仍为原口径且五项合计 100.0%）。

### 必测 10 部署与一致性（通过）
- 运行容器 `WBS_HOST=0.0.0.0`（非仅回环）、`WBS_DATA_DIR=/app/data`、挂载 `/opt/wbs-rongcheng/data -> /app/data`；运行镜像 `wbs-rongcheng:20261016144702`（network host）。
- health：`http://127.0.0.1:4180` / `http://0.0.0.0:4180` / `http://47.108.129.157:4180` 三端均 `{"ok":true,...,"revision":15}`（公网实测通过，非缺陷记录项）。
- 镜像内 `find / -xdev -maxdepth 3 -name node_modules` 无输出；`/app/package.json` 依赖为 `{}`。
- 服务端返回 `app.js` / `styles.css` / `index.html` / `template.xlsx` / `vendor/xlsx.full.min.js` 与入库快照 `artifacts/YUNZ-20/wbs-rongcheng/` sha256 一致；运行目录 `server.js` / `public/*` 与快照逐字一致。
- 证据：`logs/06-deploy.log`（17 PASS / 0 FAIL）。

## 3. 缺陷清单

本轮未发现需要修复的功能缺陷或交互级失败，**缺陷 0 条**。

## 4. 残余风险与观察项（不构成本轮缺陷）

1. **详情面板为全屏模态**：面板打开期间底层控件被背板遮挡（实测 `elementFromPoint` 落在面板内，入参日期输入不可鼠标点击；键盘仍可聚焦）。点击背板无反应也无提示，但有显式「关闭」按钮且 `Esc` 生效。该形态与 CH-8 / CH-13 已复验通过的既有模态实现一致，本轮不判缺陷；是否需要「边看详情边鼠标编辑」属产品行为变更，待 Sponsor 决定（作者自报残余风险 2 已如实记录）。
2. **`counted != denominator` 的「只截断不补齐」分支经数据文件不可达**：脏 phases 会在启动一次性迁移被归一（isoD 实测）。该分支经直接模块调用取证通过，仅作口径提示。
3. **服务端 `PUT /api/wbs` 不校验 owner 是否在九身份池内**（`validateDocument` 只校验非空与长度；`design.md` 明确「服务端只做身份记录，行级可编辑性由前端矩阵控制」）。前端 `validateDraft` 会拦截「负责人必须是九身份之一」，故非本轮引入、非本轮范围，仅作观察（构造性 PUT 可写入池外 owner）。
4. **「A–K 业务文本含『产品』」在现场是空集**（实测 0 行），该风险面由隔离数据（isoB 2 行）覆盖；现场建议保留可回溯副本。
5. **运行现场数据变动（只记录、不处置）**：部署后 14:47:45 被外部身份「项目负责人」删除 T025 一行（revision 14→15，`audit.log` 有记录）；本轮所有用例均在隔离数据目录执行，live 仅只读取证，未改动现场数据（`data/wbs.json` sha256 `eefd89c5…`、`data/audit.log` sha256 `dc7e974d…`）。
6. **绑定面相对原规格略有变化（口径提示）**：`spec.md` A6 为「容器只监听 `127.0.0.1:4180`」，本轮 CH-15 契约第 10 条要求运行态绑定 `0.0.0.0:4180` 且公网 health 可达，实测均满足；公网暴露的安全含义属 Sponsor 决策面，超出本任务结论。
7. **作者自测脚本同步**：作者交付评论第 3 条提到 Stage17 浏览器断言已按 CH-15 形态同步（顶部单行 + 详情五行）。本轮未复跑作者脚本，CH-14 对照以本任务独立断言为准（`10c` + `01/*/sum-100`）。

## 5. 证据索引

- `logs/00-iso-data.log`（9 PASS）、`logs/02-iso-data-reset.log`（9 PASS）
- `logs/01-iso-browser.log`（81 PASS）：隔离实例真实浏览器交互
- `logs/03-server-api.log`（71 PASS）：服务端口径 / 只读语义 / 409·400 / 迁移 / 重启
- `logs/04-readback.log`（14 PASS）：导出 xlsx 独立读回
- `logs/05-live-browser.log`（14 PASS）：运行现场只读取证
- `logs/06-deploy.log`（17 PASS）：部署与一致性
- `logs/07-author-claims.log`（25 PASS）：作者自报核验（对照）
- `results/expected-stats.json`、`results/iso-browser-results.json`、`results/live-browser-results.json`
- `downloads/isoB-蓉城战役WBS-20261016.xlsx`、`downloads/isoB-wbs-at-export.json`
- `shots/`：isoB-workbench-1600.png、isoB-detail-1600.png、isoB-workbench-375.png、isoB-detail-375.png、isoC-zero-1600.png、live-workbench-1600.png、live-detail-1600.png、live-workbench-375.png、live-detail-375.png
