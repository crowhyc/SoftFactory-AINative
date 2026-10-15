# Stage14 独立复验报告：WC-001 变更包 #5（CH-11 今日摘要仅 A 列 + CH-12 删除「当日变更」sheet）

- 任务：`YUNZ-34`（Stage14 独立复验，独立验证工程师 AI-QV）
- 被验证对象：`YUNZ-33`（Stage13 变更包 #5 实现与自测，`in_review`）
- 复验时间：2026-10-15 14:36–15:05（+08）
- 被验证产物（只读）：`/opt/wbs-rongcheng/`（含 `0.0.0.0:4180` 运行容器）、`data/wbs.json`、`data/audit.log`、源码快照 `/opt/SoftFactory-AINative/artifacts/YUNZ-20/wbs-rongcheng/`
- 本轮验证范围：CH-11 / CH-12 及其不回归抽样；不改动被验证实现代码，不触碰现场数据
- **结论：通过但有待决项**（CH-11 / CH-12 未发现功能缺陷、无交互级失败；待决项见第 3 节，属 Sponsor 决策范围，本报告不自行接受残余风险）

## 0. 判定依据汇总

| 证据块 | 执行方式 | 断言结果 |
| --- | --- | --- |
| 现场真实浏览器只读 + **真实下载**（日报 / WBS） | `scripts/qv-live-browser.cjs`（Chromium 140 容器，打 4180） | PASS=19 / FAIL=0，pageerror=0，外部请求=0 |
| 隔离实例真实浏览器写入矩阵（编辑入口 / 校验 / 增删行 / 人员池 / 导出） | `scripts/qv-iso-browser.cjs`（隔离数据 + 4260/4261） | PASS=35 / FAIL=0 |
| **xlsx 独立读回**（Python 标准库 `zipfile` + `xml.etree`，不依赖 openpyxl/SheetJS） | `scripts/qv-readback.py` | PASS=77 / FAIL=0 |
| 服务端不回归（并发 409 / 原子写 / 重启持久 / 连续 10 次保存） | `scripts/qv-server-api.py`（隔离容器 4263） | PASS=21 / FAIL=0 |
| 部署与一致性（绑定 / 三端 health / 镜像 / 快照 sha256） | `scripts/qv-deploy-consistency.sh` | PASS=20 / FAIL=0 |
| 不回归抽样（CH-1/3/6/8/9/10、D-3、验收 1/3/5/10） | `scripts/qv-nonreg-browser.cjs`（隔离实例 isoD + 4267） | PASS=19 / FAIL=0 |
| 作者自报核验（独立复算，**非结论证据**） | `scripts/qv-author-claims.sh` | PASS=7 / FAIL=0 |

合计 **198 项断言全部通过、0 失败**。一键复跑：`bash scripts/run-all.sh`。

## 1. 两条证据链

- **自报链（不作为证据）**：`YUNZ-33` 交付评论 `01a13e41-e2ca-7a0b-ab16-fdc12d88a927` + `artifacts/YUNZ-20/selftest/stage13/`（`README.md`、`matrix-summary.txt`、`01.log`…`12.log`、`browser/`）。
- **复跑链（本报告结论证据）**：本目录 `scripts/` + `logs/01…07` + `results/` + `downloads/`（含真实浏览器下载的 xlsx 原件）。
- 自报声明经独立复算一致（`logs/07`）：`public/app.js` `d49cc9e2…`、`server.js` `d9b29f00…`（本包未改服务端）、`SHA256SUMS` `d3eab4be…`、运行镜像 `wbs-rongcheng:20261015141900`；`diff -rq` 运行目录 `public/` 与源码快照逐字一致。自报矩阵输出未被采信。

## 2. 必测矩阵逐项结果（对照派发单 1–7）

### 1) 日报 sheet 结构 —— 通过
- 真实浏览器点击「导出日报」下载 `蓉城战役日报-20261015.xlsx`（现场 69 005 B；隔离实例 20 560 B；无事件实例 17 695 B）。
- 读回断言 `sheetNames == ["今日摘要","阻塞与延期"]`（顺序一致、仅 2 个 sheet）：`LIVE-D-01/02`、`ISO-D-01/02`、`QUIET-D-01/02`。
- 旧「当日变更」表头文字在**原始部件级**（未解码字节 + XML 文本）零命中：检索 `当日变更/改动字段/旧值/新值/操作身份/重要度/结论/依据` 均 0 命中（`LIVE-D-03`、`ISO-D-03`、`QUIET-D-03`）；亦无同名 sheet（`*-04`）。

### 2) 今日摘要仅 A 列 —— 通过
- `dimension` 恰为 `A1:A(n+1)`（现场 `A1:A197`、隔离 `A1:A7`、无事件 `A1:A2`）；全部单元格列字母均为 A，**无 B 列及以后的单元格**；每行恰好 1 个单元格（`*-05/06/07`）。
- A1 为表头「微信文本行」（`*-08`）；列定义 `<col min="1" max="1" width="120.83203125" customWidth="1">`（`*-09`）；A2 起单元格 `s` 指向的 cellXf 带 `alignment wrapText="1"`（`*-10`）。

### 3) 摘要文本与排序逐字断言 —— 通过
- A 列逐行与 `/api/daily` 口径**逐字一致**（`*-11`）；每行匹配 `【前缀】一级 / 二级 / 任务项 @负责人：结论。`（`*-12`，含 `@` 兼容 `ISO-D-22`）。
- 隔离实例构造五类事件后逐字结果（`ISO-D-19/20/21`）：
  - `【延期·高风险】…：设计延期。`（当天新增延期）
  - `【阻塞·高风险】…：阶段更新为阻塞。`
  - `【延期·高风险】…：设计 10-14 到期未更新，判定延期。`
  - `【完成】…：阶段已完成。`
  - `【普通】…：产品计划 11-23 → 11-05。`、`【普通】…：开发计划 11-17 → 11-06。`、`【普通】…：设计进度 未开始 → 已开始。`
  - 排序实测 `延期 > 阻塞 > 到期未更新判定延期 > 完成 > 普通`（类内按行序），一任务多事件多行（T006 两行）。
- 无事件实例只输出兜底行「今日无阻塞、延期或变更。」（`QUIET-D-13`）。

### 4) 保留项不变 —— 通过
- 服务端仍写审计：隔离实例新增人员后 `audit.log` 仍出现 `identity_added`（`I16`）；`/api/history` 仍返回且含「人员池」行（`L19`：236 条记录 / 3 条人员池；`I17`）。
- `阻塞与延期` sheet 与 #4 口径一致：表头 `A–K（含是否演示范围）+ 设计进度/开发进度/测试进度/产品进度/演示准备进度`、`dimension = A1:P(n+1)`、无 P 列之后列、逐行等于 `/api/daily`、**阻塞行排在延期行之前**（隔离实例序 `T003(阻塞) → T002(延期) → T006(延期)`，`ISO-D-18`）；现场 32 行、隔离 3 行、无事件 0 行。
- 仅不再有第三个 sheet（见 1）。

### 5) WBS 导出抽样回归 —— 通过（现场 + 隔离两份真实下载件）
- 单 sheet 且与模板同名 `工作表1`；第 1 行、第 2 行与模板**逐格一致**；`A1:C1` 合并保留（`LIVE-W-01…04`、`ISO-W-01…04`）。
- A–K 数据区 35 行逐字一致（日期原文、是否演示范围、进展说明）；L–P 五进度列文字逐格一致；**五色填充**逐格一致，且隔离实例实测出现全部五色 `FF9E9E9E/FF2F80ED/FF27AE60/FFE74C3C/FFFFD400`（`ISO-W-14`）。
- `导出日期：2026-10-15 14:42 / 14:54` 仍在右移后的 Q1 标签位（`*-08`）；`dimension = A1:Q38`（模板末行 38 与数据末行取大）、数据区末尾残留行已清空、无 P/Q 之外列、表头不含旧全局「状态」（`*-05/06/07/09/13`）。

### 6) 不回归 —— 通过（抽样，依据见括号）
- CH-1 Markdown 编辑器与转义安全（`N03–N09`）：K 列「点击打开编辑」入口可发现；预览渲染 `strong/em/h1`；原始 `<img onerror>`/`<script>` **未注入元素、未执行**（`window.__xss` 未定义），以字面文本显示；保存后 API/磁盘逐字等于原始 Markdown；摘要为纯文本。
- CH-2 人员池与新增人员（`I15–I17`）；CH-3 五阶段控件五色（computed 逐档 `N13/N13b` + 导出填充 `ISO-W-11/12/14`）；CH-4 迁移幂等与旧 `status` 保留（`A-14` 重启后逐字节不变、`A-16` 逐条保留 `status`）；CH-5/权限（`L09–L11`、`I18–I19` 本人行可编辑/他人行只读且点击有中文提示）；CH-6/CH-9 `demo` 网页隐藏、导出与日报保留（`N14`、`L04`、`ISO-D-15/17`、`*-W-10`）；CH-7 `identity_added`（`I16/I17`）；CH-10 五进度列与旧 `status` 不进页面与导出（`N15`、`*-W-06`）。
- D-3 身份遮罩（`N01/N02/N10`）：进入工作台后 `#identity-layer` `hidden=true`、`display:none`、无 client rect，顶栏按钮 `elementFromPoint` 命中自身（未被遮挡）；返回首页后恢复可见。
- 验收条件 1–10 抽样（依据：本包只改日报导出路径，故对交互与持久化做等效抽样）：#1 身份选择/刷新保持（`N11`）；#2 行序与条数（`L02`、`*-W-10`）；#3 王言本人行可编辑且三端一致（`N12`）；#5 空值/非法输入前置校验拦截且无写入（`I10/I11`，revision 不变）；#6 原子写与重启持久（`A-12/A-13/A-14/A-15`）；#7 连续 10 次保存无字段丢失/重复/未知字段被清除（`A-09/A-10/A-11/A-11b`）；#8 导出保真（WBS 与日报读回全部断言）；#9 并发旧版本 409 且不覆盖（`A-03/A-04/A-05/A-05b/A-06`）；#10 `/api/health` ok + 无跨域外链（`D-05/D-06`、`L16`、`N16`）。#4 增删行带确认（`I13/I14`）。

### 7) 部署与一致性 —— 通过
- 运行容器 `wbs-rongcheng:20261015141900`，网络模式 `host`，宿主监听 `*:4180`（`D-01…D-04`）；`127.0.0.1:4180`、`0.0.0.0:4180`、公网 `47.108.129.157:4180` health 均 `{"ok":true,"revision":10}`（`D-05…D-07`）。
- 镜像内无 `node_modules`/`package-lock.json`，`dependencies`/`devDependencies` 为空，随包 SheetJS 锁定 `0.18.5`（`D-08…D-10`）。
- 服务端返回资源与运行目录、源码快照 sha256 三处一致（`app.js d49cc9e2…`、`styles.css 62771efb…`、`index.html 4438496e…`、`xlsx.full.min.js c9506197…`、`template.xlsx e01c2696…`）；容器内 `server.js` = 运行目录 = 快照 `d9b29f00…`（`D-11…D-13`）。
- 现场未被本轮改动：`revision` 仍 10、复验窗口内无新增数据备份（`D-14/D-15`）。

## 3. 缺陷与残余风险

**功能缺陷：无**（CH-11 / CH-12 均未发现需修复的缺陷；交互级验证未出现失败）。

1. **既有事实（非本包引入，待 Sponsor 决策）**：现场数据为 35 条（缺 `T001`），而 `harness/spec.md` 验收条件 2 要求 36 条。证据：`data/wbs.seed.json` 36 条含 `T001`；`wbs.json.20261015040405.bak`（rev 9，迁移前）已为 35 条无 `T001`；故缺失发生在变更包 #4 窗口内，早于本包，且本包未改 `server.js`、未删除任何行。影响范围：仅现场数据的行数与验收条件 2 的字面口径；`Stage12` 报告亦已按 35 行记录。请协调员/Sponsor 决定恢复 `T001` 或按 35 行验收。
2. **待决项（Stage13 已提，仍未裁定）**：`今日摘要` 保留 A1 表头「微信文本行」，数据自 A2 起；若 Sponsor 要求整列可直接全选复制，需决定是否连表头一并删除（一行改动）。本报告不代为裁定。
3. **限制性说明（非缺陷）**：A 列自动换行采用「STORED zip 最小修补」注入 `cellXfs`（随包 SheetJS 社区版写出不生成 cellXfs）。本报告已在 XML 级验证 `alignment wrapText="1"` 与该 xf 引用，但**未在 Excel/WPS 真机人工目视**；建议验收时人工打开确认观感。
4. **观察项（不判缺陷，理由：仅注释文字，无功能影响）**：`public/app.js:1635` 注释仍写「三 sheet：今日摘要 / 阻塞与延期 / 当日变更」，与 CH-12 后的两 sheet 实现不符；同文件 1635 行注释不属于「表头」或「组装代码」，不构成对 CH-12 的违反，故未计入缺陷块。

## 4. 复跑方式与证据清单

- 一键复跑：`bash /opt/SoftFactory-AINative/artifacts/YUNZ-20/verification/stage14/scripts/run-all.sh`
- 环境：宿主 CentOS 7（glibc 2.17，无法直接跑 Playwright Chromium），真实浏览器在官方镜像 `mcr.microsoft.com/playwright:v1.55.0-jammy`（Chromium 140）内运行；xlsx 读回使用宿主 `python3`（3.6.8）+ 标准库 `zipfile`/`xml.etree`；隔离实例服务端在一次性容器内以隔离数据目录启动，端口仅绑定 `127.0.0.1`（4260/4261/4263/4267），不触碰现场 4180 与现场数据。
- 证据文件：`logs/01-live-browser.log`、`logs/02-iso-browser.log`、`logs/03-readback.log`、`logs/04-server-api.log`、`logs/05-deploy-consistency.log`、`logs/06-nonreg.log`、`logs/07-author-claims.log`；结果 JSON 在 `results/`；真实浏览器下载原件在 `downloads/`（`live-*`、`iso-*`、`quiet-*`）；截图 `results/live-workbench.png`、`results/iso-workbench.png`、`results/nonreg-note-panel.png`。
