# Stage6 复验报告：WC-001 缺陷 D-3 修复（真实浏览器 computed display + 受影响验收 1/3/4）

- 任务：`YUNZ-26`（Stage6 复验，独立验证工程师 AI-QV）
- 被验证对象：`YUNZ-25`（Stage5 缺陷修复）—— 缺陷 D-3「身份遮罩无法隐藏」
- 复验时间：2026-10-14 19:11–19:22（+08）
- 被验证产物（只读）：`/opt/wbs-rongcheng/`、运行中服务 `http://127.0.0.1:4180`、源码快照 `artifacts/YUNZ-20/wbs-rongcheng/`

## 0. 结论

**结论：通过但有待决项。**

- D-3 复现路径闭环：AI-QV 用**自有真实浏览器对照基线**独立复现了修复前的 D-3，并在修复版上以 `getComputedStyle(#identity-layer).display === 'none'` 断言通过（`logs/fix.log` 58 PASS / 0 FAIL；`logs/baseline.log` 22 条中 11 条 FAIL，恰为 D-3 及其连带表现）。
- 受影响原验收用例 1 / 3 / 4 在真实浏览器中复跑通过，含真实保存往返的三端一致（页面 / `GET /api/wbs` / 磁盘 JSON）。
- 通过的条件项：3 项既有残余风险与 1 项浏览器执行环境偏差按 Sponsor 要求**未由 AI-QV 自行接受或关闭**，状态为「待 Sponsor 决策」，故不判「通过」而判「通过但有待决项」。
- 本轮未发现新的功能缺陷。

## 1. 本轮约定（被验证范围与证据要求）

- 范围 = Sponsor 指定的 D-3 回归范围：身份选择 → 进入工作台 → 九身份切换 → 普通负责人与项目负责人权限抽查各一，外加 D-3 复现路径与 `hidden` 同类盲区强制抽查。
- 验收条件 2、5–10 **本轮不复跑**（依据见第 6 节）。
- 真实浏览器断言未完成或未通过时不得判「通过」；jsdom 复查只能作补充证据。本轮结论**全部来自真实浏览器（Chromium 140.0.7339.16）**。
- 不修改被验证实现代码；发现缺陷只进入缺陷流程。

## 2. 两条证据链（分开记录，不互相采信）

1. **作者自报链（AI-IE / Stage5）**：交付评论 `YUNZ-25` 评论 `01a13a19-5faf-744d-9e2a-ef43789fdd85`（2026-10-14T11:08:23Z / +08 19:08:23）＋ 自测证据 `artifacts/YUNZ-20/selftest/stage5/`。自报要点：Chromium 140 真实浏览器 PASS=21 FAIL=0、`styles.css` sha256 `53afd03f…`、新镜像 `20261014190527`、`/api/health` 通过。
   核对时间（+08）：2026-10-14 19:10–19:11。作者自报**不作为**本轮结论证据。
2. **AI-QV 自跑链（本轮，结论唯一依据）**：自研脚本 `scripts/d3-verify.cjs`（`MODE=fix` / `MODE=baseline` 双模式）与 `scripts/hidden-audit.cjs`；执行时间（+08）2026-10-14 19:11–19:21；输出 `logs/fix.log`、`logs/baseline.log`、`logs/hidden-audit.log`、`results/*.json`、`shots/*.png`。
   作者自报的 `styles.css` sha256 与 AI-QV 三链实测**一致**（`53afd03f…`）；其余结论均以 AI-QV 自跑输出为准（`input-receipt.txt`）。

## 3. D-3 复现与闭环（真实浏览器，Chromium 140.0.7339.16）

对照组为 AI-QV **自建实例**：镜像 `wbs-rongcheng:20261014144403`（Stage5 修复前，image id `50e6ed48ab39`），容器 `qv-baseline-4181`，`--network host`、端口 4181、数据由随包 seed 初始化（未触碰 4180 数据），该实例的 `styles.css` sha256 = `e6b61b37…`（与修复版 `53afd03f…` 不同，确认为真·修复前版本）。

| 观测项（点击「李欢」后） | 修复前对照（4181） | 修复版（4180） |
| --- | --- | --- |
| `#identity-layer` computed display | `flex`（FAIL） | `none`（PASS） |
| `#identity-layer` rect | `1440x900`（整屏遮罩） | `0x0`（塌陷） |
| 视口中心 `elementFromPoint` | `#identity-list`（命中遮罩） | `td` → `#wbs-body` → `#workbench`（命中工作台） |
| `#workbench` | `display:block` 但 rect.y=900（整条被推至视口下方，用户不可见） | `display:block`，rect `1440x1625`，y=0，可见可交互 |
| 渲染行数 | 36 | 36 |
| `pageerror` | 0 | 0 |

- 修复前对照实例上的 11 条 FAIL 全部落在「身份层未隐藏 / 刷新后仍被遮罩 / 九身份切换后仍被遮罩 / `hidden⇒display:none` 不成立」这一组，正是 D-3 的完整表现。
- 修复版关键断言：`d3.identity-layer-computed-display-none`、`d3.identity-layer-rect-collapsed`、`d3.workbench-visible`、`d3.viewport-center-hits-workbench`、`d3.workbench-interactive`、`d3.no-pageerror` 全部 PASS。
- `#identity-layer` 的 `hidden` 属性同时为 `true`：属性与 computed display 一致，说明根因（类选择器压过 UA `[hidden]`）已被基础层 `[hidden] { display: none !important; }` 真正修正，而非仅改属性。
- **修复确已部署到位**：运行中服务返回的静态资源与 `artifacts/YUNZ-20/wbs-rongcheng/` 源码快照、`/opt/wbs-rongcheng/` 运行目录**逐字节一致**（`styles.css` 三链均 `53afd03f…`；`index.html`、`app.js`、`template.xlsx`、`vendor/xlsx.full.min.js` 同样 MATCH，见 `served-vs-snapshot.txt`、`served/`）。运行容器仍为镜像 `wbs-rongcheng:20261014190527`（未重建/未替换/未重启）。

## 4. `hidden` 属性同类盲区抽查（强制项）

`hidden-audit.cjs` 在真实浏览器中对依赖 `hidden` 的元素做了**双向**抽查（可见态须非 `none`，隐藏态须 `none`），18 条判定全 PASS：

| 状态 | `#identity-layer` | `#workbench` | `#banner` | `#hint` | `#empty-state` | `#add-row-btn` | `#identity-error` | `#banner-action` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| state0 身份选择层 | `flex`（可见） | none | none | none | none | none | none | none |
| state1 李欢工作台 | none | block（可见） | none | block（可见） | none | none | none | none |
| state2 搜索 0 行 | none | block | none | block | **block（可见）** | none | none | none |
| state4 项目负责人 | none | block | none | block | none | **block（可见）** | none | none |
| state5 王言 | none | block | none | block | none | **none（隐藏）** | none | none |

- 保存成功时 `#banner` 由 `none` 变 `flex`（`logs/fix.log` 的 `hidden-audit.after-save` 记录，`class="banner ok"`）。
- 结论：全局 `[hidden]` 规则**未引入反向破版**；`#empty-state` 的「0 行即显示」与 `#add-row-btn` 的「仅项目负责人可见」语义均按预期工作。

## 5. 受影响验收用例复跑（真实浏览器交互级）

**验收 1（九身份 / 进入 / 刷新保持 / 切换即时生效）**
- 选择列表与身份切换下拉均为 9 项，顺序与数据一致：`项目负责人, 李欢, 王言, 张航瑞, 郑述文, 崔文建, 余宇, 黄逸偲, 陈江`。
- 点击「李欢」→ 进入工作台（遮罩 `none`、工作台可见、36 行）。
- 刷新（F5）后身份保持「李欢」，遮罩保持 `none`。
- 九身份逐一切换：每次均「遮罩 `none` + 工作台可见 + 36 行 + 会话状态跟随刷新」；`#add-row-btn` 仅在 `项目负责人` 为 `block`，其余 8 身份为 `none`。
- 证据：`logs/fix.log`（`acc1.*` 11 条）、`logs/fix-switch-log.json`。

**验收 3（王言：本人行可编辑且三端一致；非本人行不可编辑）**
- `王言` 本人行（T002）结构性字段（任务项）为 `locked`，点击后**不进入编辑态**且给出中文提示；非本人行（T001）日期列同样 `locked` + 提示 → 权限矩阵正确。
- 本人行 `dates.design` 可编辑：点击后单元格进入 `editing` 并出现 `input`；改值后提示「已修改…」且「保存」按钮启用。
- 保存后横幅 `class="banner ok"`：「保存成功，服务器版本号已更新为 1」。
- 三端一致：页面单元格 = `2026-12-31`、`GET /api/wbs` 的 `T002.dates.design` = `2026-12-31`、磁盘 `/opt/wbs-rongcheng/data/wbs.json` 同值；`meta.revision` 0 → 1。
- 还原原值后再次保存：`tasks` 数组与保存前**完全一致**，磁盘与 API 一致（`results/fix.json` 的 `acc3.restore-*`）。
- 证据：`logs/fix.log`（`acc3.*` 12 条）、`shots/fix-05-wangyan-edited.png`、`shots/fix-06-saved-consistent.png`。

**验收 4（项目负责人：任意行可编辑、可新增、可删除且带确认）**
- `#add-row-btn` 对项目负责人可见（`block`）；对非项目负责人 `none`。
- 任意行可编辑：点击 `李欢` 的行 T001 `dates.dev` 出现 `input`（对比：`王言` 身份下该单元格 `locked`）。
- 新增行：36 → 37 行，提示「已新增第 T037 行…」。
- 删除（带确认）：弹出确认框文案为「确认删除任务 T037（未命名）？该操作需保存后生效。」；**取消**路径行数保持 37 且提示「已取消删除 T037。」；**确认**路径回到 36 行且提示「已删除第 T037 行…」。
- 空输入保护：新增空行直接保存 → 横幅 `banner error`「前置校验未通过，未向服务器提交（共 3 项）…」，API 的 `tasks` 与保存前一致（未落盘）；重新加载后未保存改动被丢弃，仍 36 行。
- 证据：`logs/fix.log`（`acc4.*` 8 条）、`shots/fix-07-pm-added-row.png`、`shots/fix-08-empty-row-validation.png`。

**UX 可发现性对抗**：以 `李欢` 身份点击 `序号` 单元格（只读）→ 提示条可见且文案含「只读」，未出现「点击无反应且无提示」（`shots/fix-09-readonly-hint.png`）。

## 6. 未复跑项、依据与连带影响声明

未复跑（按 Sponsor 指定以既有证据为准）：验收 **2**（导出列数/第 1/2 行保真 —— Stage2 `verification/` 与 Stage3 `export-*`）、验收 **5–10**（空值与非法输入服务端 400、并发 409、纯标准库与资源全本地、导出无 status、`/api/health`、重启持久 —— Stage1 `selftest/` 与 Stage2 `verification/`）。
连带影响声明：D-3 修复为纯 CSS 基础层新增一条 `[hidden]` 规则，本轮对**全站依赖 `hidden` 的 8 个元素**做了双向量抽查、对**全部静态资源做了 served vs 快照逐字节比对**、对**身份/权限/增删存改写路径**做了回归，**未发现本次修复带来的连带影响**。

## 7. 缺陷与残余风险

**本轮新发现缺陷：无**（D-3 复现路径闭环，无新增功能缺陷，无交互级失败，故不附缺陷块）。

残余风险 / 待决项（逐条编号；本轮**不自行接受或关闭**）：
1. **待 Sponsor 决策**：Stage2/Stage3 遗留的 3 项残余风险（导出视觉保真与样式量化、基础镜像 `node:24-slim` 与设计示例 `node:20-slim` 不一致、容器 `--network host` 网络模型）—— 按 Sponsor 要求待 D-3 闭环后一并答复，处理状态「待 Sponsor 决策」。
2. **待 Sponsor 决策**：浏览器执行环境偏差 —— 宿主为 CentOS 7（glibc 2.17），Chromium 140 需 glibc ≥ 2.18 无法在宿主直接运行；本轮沿用官方镜像 `mcr.microsoft.com/playwright:v1.55.0-jammy` + `--network host` 访问宿主回环（未安装任何系统级浏览器组件，浏览器依赖仅落工作目录）。若验收方要求「宿主本机浏览器」形态证据，需授权更换宿主基础镜像或升级 glibc。
3. **观察项（严重度：低，未按缺陷记）**：`http://127.0.0.1:4180/favicon.ico` 返回 404，产生 1 条 console error。页面未声明 favicon，属浏览器默认请求；不影响任何用户路径与验收条件（`logs/fix.log` 的 `final.*` 已单列该项，其余 console/pageerror 均为 0）。理由给「低」：无用户可见影响、不涉及交付契约与验收条件。
4. **实现约定约束（残余风险：低）**：全局 `[hidden] { display: none !important; }` 会覆盖任何「`hidden` 但仍需可见」的未来写法；本轮抽查的 8 个元素语义均为「hidden 即隐藏」，无冲突。
5. **运行数据写副作用（如实记录）**：为满足验收 3 的三端一致，在运行中服务上执行了真实保存往返，`data/audit.log` 追加 7 条审计记录；`data/wbs.json` 收尾已按字节回滚至复验前现场（sha256 `a3632236…`，`revision` 回到 0）。详见 `runtime-state.txt`。

## 8. 证据文件清单（本目录）

| 文件 | 内容 |
| --- | --- |
| `input-receipt.txt` | 被验证产物受理与三链 sha256 核对、两条证据链记录、修复前对照基线说明 |
| `served-vs-snapshot.txt`、`served/` | 运行态 5 个静态资源 served vs 源码快照 vs 运行目录逐字节一致性（证实修复已部署） |
| `runtime-state.txt` | 容器/镜像/health、数据现场前后一致性、写副作用与未改动清单 |
| `scripts/d3-verify.cjs` | 本轮主脚本（`MODE=fix` / `MODE=baseline`），D-3 断言 + 验收 1/3/4 + UX 对抗 |
| `scripts/hidden-audit.cjs` | `hidden` 属性元素双向 computed display 抽查（不写数据） |
| `logs/fix.log`、`results/fix.json` | 修复版复跑：58 PASS / 0 FAIL（含逐步 detail） |
| `logs/baseline.log`、`results/baseline.json` | 修复前对照：22 条判定中 11 条 FAIL —— 独立复现 D-3 |
| `logs/hidden-audit.log`、`results/hidden-audit.json` | 同类盲区双向抽查 18 PASS / 0 FAIL |
| `logs/*-switch-log.json` | 两模式下九身份逐一切换的逐项观测 |
| `shots/*.png` | 身份选择层 / 点击后进入工作台 / 刷新后 / 切换末态 / 编辑 / 保存一致 / 新增行 / 空输入校验 / 只读提示 / 0 行空态 / 项目负责人视图 |
| `results/wbs.json.pre-stage6.bak` | 复验前 `data/wbs.json` 字节副本（收尾一致性比对基准） |
| `SHA256SUMS` | 本目录证据清单 |
