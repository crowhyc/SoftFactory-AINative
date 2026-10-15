# YUNZ-29 / Stage9 变更包 #3（CH-8）作者自测证据

变更包：**CH-8 进展说明升级为大尺寸 Markdown 编辑器**（Sponsor 2026-10-15 确认）。
被测运行现场：`/opt/wbs-rongcheng/`（容器 `wbs-rongcheng`，镜像 `wbs-rongcheng:20261015104003`，
`BIND_HOST=0.0.0.0:4180`，host 网络；按 D-0006 授权对外暴露）。

## 一、怎么复现（全部自测都是可复跑脚本）

```bash
cd /opt/wbs-rongcheng

# A. 自测矩阵 01–14（真实浏览器 + 服务端 + 既有/Stage7 回归 + 部署自检）
bash tests/verify_stage9.sh                 # 输出 tests/.tmp/stage9/，逐项日志 + matrix-summary.txt

# B. 单独跑浏览器用例集（Chromium 容器，隔离数据目录、端口 4224，不触碰现场）
bash tests/stage9/run.sh                    # 输出 tests/.tmp/stage9-out/（含截图与导出 xlsx）

# C. 单独跑服务端用例集（note 上限 / 审计 / 历史接口 / 409 / 重启持久）
node tests/stage9_server_check.js           # 隔离数据目录、端口 4225

# D. 部署与镜像自检（只读，不重建容器）
bash tests/stage9/deploy_check.sh

# E. 现场（真实容器 127.0.0.1:4180）只读实测：不点保存、不发 PUT
bash tests/stage9/live_run.sh               # 输出 tests/.tmp/stage9-live/，脚本首尾校验 data/audit sha256 未变
```

## 二、为什么浏览器在容器里跑

宿主为 CentOS 7（glibc 2.17），playwright 的 Chromium 140 需要更新的 glibc，**宿主无法直接运行**，
因此浏览器跑在官方镜像 `mcr.microsoft.com/playwright:v1.55.0-jammy`（chromium 140.0.7339.16）内；
宿主未安装任何系统级浏览器组件，也没有装进产物或镜像。
被测服务（`server.js`，纯 Node 标准库）与浏览器**同处一个容器**、使用隔离数据目录，因此不需要 `--network host`，
也不会触碰现场 `/opt/wbs-rongcheng/data` 与 `0.0.0.0:4180`（仅 E 项用 `--network host` 只读访问现场）。

前置：`docker pull mcr.microsoft.com/playwright:v1.55.0-jammy`（本机已缓存），以及测试工具目录已装 playwright
（**不进源码快照、不进镜像**）：`cd tests/.tools && npm i playwright@1.55.0 --ignore-scripts`。

## 三、证据索引

| 文件 | 说明 |
|---|---|
| `matrix-summary.txt` | 自测矩阵 01–14 逐项结论（本轮全部通过） |
| `rerun-matrix.log` | 交付前对 `verify_stage9.sh` 的二次整跑输出（RC=0，01–14 全通过） |
| `browser.log` | 真实 Chromium 用例集完整输出（**63 项断言 PASS=63 / FAIL=0**，0 pageerror） |
| `server.log` | 服务端用例集完整输出（**10 项断言 PASS=10 / FAIL=0**） |
| `01.log` … `14.log` | 矩阵逐项关键断言留档（12=既有 18 项矩阵、13=Stage7 矩阵 01–14、14=部署自检） |
| `browser/browser-results.json` | 浏览器用例集结构化实测数据（63 checks / requests 64 全本地 / external=[]） |
| `browser/matrix03-desktop-panel.png` | 桌面面板：约 90vw×80vh 居中、左「编辑」右「预览」双栏、字数 0/20000 |
| `browser/matrix03-mobile-edit-tab.png` | 手机全屏 + 「编辑 / 预览」标签（默认编辑页） |
| `browser/matrix03-mobile-readonly.png` | 手机只读预览（无保存按钮、无编辑区） |
| `browser/matrix04-security-preview.png` | `<script>` / 原始 HTML 转义原样显示；`![远程图]` 不解析为图片 |
| `browser/matrix05-panel-preview.png` | 保存后预览：H1 / 粗体 / 链接渲染；字数 64/20000 |
| `browser/蓉城战役WBS-20261015.xlsx` | 页面「导出 Excel」真实产物（A–K 保真、K 列仍为 note 原文） |
| `browser/蓉城战役日报-20261015.xlsx` | 页面「导出日报」真实产物（两个 sheet） |
| `legacy-matrix/` | 既有 18 项矩阵回归完整输出（按当前部署口径跳过容器附加项 19/20/16b/21） |
| `regress-stage7/` | Stage7 矩阵 01–14 回归完整输出（CH-1…CH-7 真实浏览器深度复跑） |
| `live/` | 现场（真实容器 `127.0.0.1:4180`）只读实测：`live-run.log`、`live-results.json`、两张截图（**PASS=7 / FAIL=0**） |
| `scripts/` | 上述自测脚本留档（与 `/opt/wbs-rongcheng/tests/` 逐字一致） |

## 四、实现要点与口径

- **表格展示**：K 列不再有行内 textarea，改为摘要单元格 `.cell-note.note-editable`（无权限行 `.note-locked`），
  整格 `cursor:pointer` 可点，摘要 `.note-summary` 单行省略（`white-space:nowrap`），空 note 显示「点击打开编辑」/只读行「点击查看进展说明」。
- **摘要算法**：`noteSummary()` 去掉 `#`/粗体/斜体/删除线/反引号/引用符/列表符，链接语法只留文字，合并为单行后按
  `NOTE_SUMMARY_LIMIT=80` 截断并加省略号；纯函数导出到 `WBSCore`，便于无 DOM 断言。
- **编辑面板**：`#note-panel` + `.note-dialog` 用 `90vw × 80vh` 居中；桌面左「编辑」右「预览」双栏
  （`.note-body` grid 两列、`#note-tabs` 隐藏）；`@media (max-width: 768px)` 全屏 + 「编辑 / 预览」标签切换。
- **只读模式**：无权限行点击 K 单元格同样打开面板，`#note-dialog.readonly` 隐藏保存按钮与编辑区、只渲染预览，
  给出中文说明（「只读预览（当前身份「X」对第 Y 行无编辑权限）」）；关闭按钮与 Esc 均可用。
- **保存**：仅点「保存」（或 `Ctrl/Cmd+Enter`）才走既有 `PUT /api/wbs`（`If-Match`=revision、原子写、409 语义不变），
  成功给中文提示且 revision 递增；有未保存内容时关闭面板弹「取消 / 继续退出」确认（确认框内 Esc 走「取消」）；
  失败沿用既有错误横幅。
- **Markdown 子集**：自研轻量渲染器 `renderNoteMarkdown()`，覆盖 H1–H3、粗体、斜体、删除线、行内代码、代码块、
  引用、有序/无序列表、链接（`<a target="_blank" rel="noopener noreferrer">`）；全程只用 `createElement` /
  `createTextNode` 构造 DOM，**从不使用 innerHTML**，原始 HTML 一律转义为文本、不执行；`![...](...)` 不解析为图片，
  不预取、不加载，全程无外部资源请求（矩阵 11k 实测 64 个请求全部本地、external=[]）。
- **数据契约**：仍写单个 `task.note`，不新增字段；长度上限 **2000 → 20000**（`public/app.js` 的 `MAX_LEN.note`
  与 `server.js` 同步），前端超长实时提示并拒绝提交，服务端亦不落盘非法长度。
- **审计 / 导出**：note 保存沿用既有 audit line（字段级 `old`→`new`、时间、操作身份）；`/api/history` 字段集不变；
  K 列仍导出 note 原文，A–K 保真、M1 日期标签与日报双 sheet 无回归。
- **零新增依赖**：纯 HTML/CSS/JS + Node 标准库，无 CDN、无外链、无外部服务；镜像内无 `node_modules`。

## 五、与既有自测脚本的必要同步（协调后的口径变更，非放宽断言）

1. `tests/domcheck.mjs`（ownedit / idcell 用例）、`tests/stage7/browser.cjs`（矩阵 3d、验收 3/4）、
   `tests/verify_stage7.sh` 的断言文案：K 列的行内小 textarea 已被变更包 **CH-8 明确取代**，改为
   「K 列无内联编辑器、经面板保存、只读面板断言」，并同步断言文案。语义未放宽。
2. `tests/verify.sh` 新增开关 `WBS_SKIP_CONTAINER_ITEMS=1`：容器附加项（19/20/16b/21）会重建/替换现场容器，
   并按旧口径断言「仅绑定回环」，与 D-0006 授权的 `BIND_HOST=0.0.0.0` 冲突；跳过项由 Stage9 的
   `tests/stage9/deploy_check.sh` 按当前口径覆盖（15 项 PASS）。
3. 钉死的其余既有断言（D-1/D-2/D-3、验收 1–10、CH-1…CH-7）未改动，12/13 两项回归全通过。

## 六、已知限制与残余风险（供独立复验）

- **K 列不再有行内编辑入口**：所有进展说明编辑都必须经面板（点击整格 → 面板 → 保存），这是 CH-8 的有意变更。
- **`note` 上限 2000 → 20000**：数据契约变更，逐条写入与导出行为不变，但口径变化需 Sponsor / 复验确认。
- 面板为纯前端组件，`note` 仍是单个字符串，无版本历史；并发保护仍只靠 `If-Match` revision（409）。
- 现场数据处于真实使用中：只读实测 `live/` 前后 `data/wbs.json`、`data/audit.log` 的 sha256 一致；期间现场 revision
  因**真实用户操作**（新增人员）变化与本自测无关。
- 浏览器用例集依赖本地已缓存的 playwright 镜像与 `tests/.tools` 里的 playwright 包（均为测试工具，不进产物）。
