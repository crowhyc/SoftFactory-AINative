# YUNZ-39 · Stage19 变更包 #8（CH-15）作者自测证据

任务：`YUNZ-39`（父任务 `YUNZ-20`，Stage19 变更实现，变更包 #8）
范围：CH-15 —— 顶部改为「全部五阶段合并」全量统计 + 右侧「详情」只读面板（分阶段）+ 阶段显示名「产品」→「产品验收」。
在 CH-14（`YUNZ-37`）基础上调整：顶部 CH-14 的五段分行被全量一组替换，分阶段口径保留并移入详情面板。

## 一键复现

```bash
bash /opt/wbs-rongcheng/tests/verify_stage19.sh
```

总入口依次跑：真实浏览器（Chromium 容器）用例集（40 项断言）→ 宿主服务端口径用例集（18 项断言）→
既有 18 项矩阵 + Stage7 + Stage9 + Stage11 + Stage13 + Stage15 + Stage17 回归 →
部署与镜像自检（`BIND_HOST=0.0.0.0`，含 CH-15 live 冒烟与 live 页面取证），并把逐项输出落到本目录。

## 结果

- 矩阵 01–10 全部通过（见 `matrix-summary.txt` 与 `01.log`…`10.log`）。
- 浏览器用例集：`browser.log`（Chromium 140.0.7339.16，`mcr.microsoft.com/playwright:v1.55.0-jammy`，PASS=40 FAIL=0，pageerror=0，无外部请求）。
- 服务端口径用例集：`statcheck.log` + `statcheck-results.json`（PASS=18 FAIL=0）。
- 回归：`regress-08-legacy-matrix-summary.txt`（18 项全通过）、`regress-08-stage7-matrix-summary.txt`、
  `regress-08-stage9-matrix-summary.txt`、`regress-08-stage11-matrix-summary.txt`、`regress-08-stage13-matrix-summary.txt`、
  `regress-08-stage15-matrix-summary.txt`、`regress-08-stage17-browser.log`（PASS=22 FAIL=0）+ `regress-08-stage17-statcheck.log`（PASS=12 FAIL=0）。
- 真实产物：`browser/`（`browser-results.json`、`overview-view.json`、`stats-at-end.json`、`page-workbench.png`、
  `page-workbench-375.png`、`page-detail-1600.png`、`page-detail-375.png`、`蓉城战役WBS-20261016.xlsx`）；
  运行现场只读取证：`live/`（`live-zones.json`、`live-shot.log`、`live-workbench-1600.png`、`live-detail-1600.png`、
  `live-workbench-375.png`、`live-detail-375.png`）。

## 关键断言口径

- 01：顶部只有一组「全部五阶段合并」全量统计（单行 `data-phase="aggregate"`、五项状态徽标、行内计数合计 = 任务总数 × 5、
  分母自描述 `aggregate.denominator`）；右侧「详情」按钮；无 CH-14 的五段分行；文案与 `/api/stats.aggregate` 逐字一致。
- 02：详情只读面板（`role=dialog` / `aria-modal`，无输入控件与下载入口）五阶段各一行；关闭按钮与 `Esc` 均可关闭；
  打开 / 关闭不影响工作台未保存编辑状态（草稿阶段值不变、保存按钮仍可用、不误关其它弹层、0 次下载）；
  伪响应下全量区与详情区都逐字渲染（`未开始 7 7.7%`），不做本地统计、不二次四舍五入、不补齐 100.0%。
- 03：服务端一次遍历给出两组结果 —— `aggregate`（分母 = 任务总数 × 5）与 `phases`（分母 = 任务总数，CH-14 原口径），
  均与测试侧独立复算逐项一致；聚合层最大余数法边界（分母 15 的 14/1 → 93.3 / 6.7）、阶段层 1/1/1（33.4 / 33.3 / 33.3）；
  任务总数 0 时两组全为 `0 0.0%`（不除零）；脏数据（缺 `phases`）只做 1 位小数截断、不臆造补齐。
- 04：网页五列头第 9 列、详情面板标签、阶段控件标题（产品验收进度）、日报文本阶段结论（产品验收延期 / 产品验收阻塞）
  全部改名；JSON 字段与接口 key 仍为 `product`；A–K 原数据（含行内业务文本）逐字未改写。
- 05：WBS 导出 `L2:P2` = 设计进度 / 开发进度 / 测试进度 / 产品验收进度 / 演示准备进度；A–K 与模板第 1/2 行逐字保真、
  五阶段五色填充仍在文件内（`9E9E9E / 2F80ED / 27AE60 / E74C3C / FFD400`）、Q1 导出日期标签不回归；导出文件不带统计区。
- 06：保存 / 新增（分母 180 → 185）/ 删除（回到 180）/ 身份切换后全量与详情实时重算，无陈旧数据；详情面板打开状态下
  保存后内容同帧刷新（全屏模态下用键盘激活「保存」）；九个身份都可见；查看与开关面板不写审计、不改 revision。
- 07：桌面 1600px 与 375px 均无横向页面滚动，徽标文本/数字不溢出、不遮挡表格；375px 详情面板可滚动且 Esc 可关。
- 08：既有 18 项矩阵 + Stage7 + Stage9 + Stage11 + Stage13 + Stage15 + Stage17 全量复跑（409 / 重启持久 / 审计 /
  WBS 导出保真与五色 / 日报文本弹层 / Markdown 编辑器 / 权限 / 无外部请求）均不回归。
- 09：`BIND_HOST=0.0.0.0` 重建部署；本机 `127.0.0.1:4180`、`0.0.0.0:4180`、公网 `http://47.108.129.157:4180` 三端
  `/api/health` 均 `ok`；镜像内无 `node_modules` / `package-lock.json`；服务端返回资源与运行目录 sha256 逐字节一致。
- 10：全程无外部请求；只有「导出 Excel」构成 1 次下载（全量统计 / 详情面板 / 日报弹层等交互 0 次下载，无 blob URL、无 `a[download]`）；
  无 pageerror / console error；`/api/stats` 为 `application/json`、无 `Content-Disposition`、仅接受 GET。

## 运行现场

- 部署镜像：`wbs-rongcheng:20261016144702`（`BIND_HOST=0.0.0.0:4180`，host 网络，挂载 `/opt/wbs-rongcheng/data`）；
  上一镜像 `wbs-rongcheng:20261016115756` 可回滚，重建前数据备份 `/opt/wbs-rongcheng/data/wbs.json.20261016144702.bak`。
- 公网 `http://47.108.129.157:4180/api/health` → `{"ok":true,"service":"wbs-rongcheng","revision":15}`；
  现场 `/api/stats` → `total=34`，`aggregate.denominator=170`，五状态 32.4 / 16.5 / 34.1 / 0.6 / 0.0（合计 100.0%），
  设计与演示准备阶段五项合计均 100.0%（见 `live/live-zones.json`）。
- 现场真实浏览器取证（只读）：`live/live-workbench-1600.png`、`live/live-detail-1600.png`、`live/live-workbench-375.png`、
  `live/live-detail-375.png`，全量区 / 详情面板与 live `/api/stats` 零差异。复现命令：

```bash
docker run --rm --network host -e SHOT_DIR=/out -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v /opt/wbs-rongcheng:/app -v /opt/wbs-rongcheng/tests/.tools:/tools -v /opt/wbs-rongcheng/tests/.tmp/stage19-live:/out \
  mcr.microsoft.com/playwright:v1.55.0-jammy node /app/tests/stage19/live_shot.cjs
```

## 实现口径说明（与契约一致）

- 占比口径唯一来源是服务端：`GET /api/stats` 返回
  `{ok,total,revision,aggregate:{key,name,denominator,statuses:[{value,count,percentage}]},phases:[{key,name,statuses:[…]}]}`，
  状态顺序固定 `未开始/已开始/已完成/延期/阻塞`；`aggregate` 分母 = 任务总数 × 5，`phases` 分母 = 任务总数（CH-14 口径）。
- 两组结果由同一次遍历产生（`aggregate` 计数 = 五阶段同状态计数之和），最大余数法对两组各自生效，各自五项合计恰为 `100.0%`；
  任务数为 0 时两组全为 `0 0.0%`（不除零、不补齐）。
- 前端只做等价格式化渲染（`数量 + ' ' + percentage.toFixed(1) + '%'`），不自行统计、不二次四舍五入；
  刷新复用既有写操作成功回调（进入工作台 / 保存 / 新增 / 删除 / 身份切换，以及任何写操作成功后），未新增手动刷新按钮。
- 详情面板只读：不参与权限矩阵、不写审计、不新增下载路径、不触碰编辑器草稿状态；Esc 优先级高于日报弹层与进展说明面板。
- 改名仅限「阶段显示名」：接口 key 与 JSON 字段保持 `product`；A–K 数据（含行内业务文本里的「产品」）未改写。

## 本轮对既有套件的同步（替代关系，非降低强度）

- `tests/stage17/browser.cjs`：CH-15 取代了 CH-14 的「顶部五段分行」形态断言。本套件同步为
  「顶部单行全量合并（`矩阵01d`）+ 详情面板分阶段五行」，阶段口径与其余断言（五色 / 刷新 / 九身份 / 375px / 无下载 / 无外部请求）不变。
- `tests/stage17/statcheck.cjs`、`tests/stage13/browser.cjs`、`tests/stage15/textcheck.cjs`：仅同步阶段显示名常量 /
  导出表头 / 日报结论字面量（产品 → 产品验收），断言强度不变。
- `tests/stage17/deploy_check.sh`：live 冒烟追加 `aggregate` 全量口径断言，并同步统计代码块注释锚点。

## 本变更实现文件 sha256

- `server.js` `807f7624c5f06551650a3a04a337f51bb20248c9c51a5325f383f6bccfe7323c`
- `public/app.js` `02b940727e3fdabae8e21824eb3eea2784c63fbb87f08aa86bd5bd5b6b319960`
- `public/index.html` `a1b1c035904cad72f0698dce0b16879e5f13fd788da3b16ef05643a28adb0cd7`
- `public/styles.css` `094674194747680bf38540509bc4317f3f79ff29a149ec82e04969073483fb6e`
- `tests/verify_stage19.sh` `c80691b5fcce9a3f052901d0b2b719ef5c27db0f8c02fd1311cf6a8477196b8f`
- `tests/stage19/browser.cjs` `7ee246260156e73aa4fabd8982ddbb89c88b32cc760f89457a56313cb05ef87f`
- `tests/stage19/statcheck.cjs` `6a82d13be012f3e8eee98ac492e56e5db1b4a8b60aaccb1af9b0b2aa9d6f1d65`
- `tests/stage19/run.sh` `01055a353d03f34417ea86dbd7d3dbfd1db2b405e4849a09160d0bda6a1c2a84`
- `tests/stage19/deploy_check.sh` `d851d00e7763578546e2d5147e23d6fdd6cbfceffc2c86bc0e305181ef82d572`
- `tests/stage19/live_shot.cjs` `002d15808a5a3d8607a18f1741d140ac63b52768217f5c394bf742aba1c3fc01`
- `tests/stage17/browser.cjs` `1c61cf5514f7eaace9910a1387f57933f0cb3958d058301dfc3e9d928743c810`（CH-15 形态同步）
- `tests/stage17/statcheck.cjs` `6162c2b47c44e1bad91f8b51b3ae6950ce24ab0b6c86a553de4e9f631183f901`（显示名同步）
- `tests/stage17/deploy_check.sh` `77d7ac25016a4f5115f40e68a1cd79eb5ebe2c473f7801b756bf7c2af65e9a9d`（live 冒烟追加 aggregate）
- `tests/stage13/browser.cjs` `7d93a1b9a4d851661c8fc88d7f01db34e9c11ead86689c1842a4b435a21ab016`（导出表头同步）
- `tests/stage15/textcheck.cjs` `343973e4a4c69254787c50634f3691cc65e24c21c4ade616689443eb7744ae89`（日报结论同步）
