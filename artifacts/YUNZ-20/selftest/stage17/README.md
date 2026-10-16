# YUNZ-37 · Stage17 变更包 #7（CH-14）作者自测证据

任务：`YUNZ-37`（父任务 `YUNZ-20`，Stage17 变更实现，变更包 #7）
范围：CH-14 —— 工作台顶部新增各阶段状态的「数量 + 占比」只读总览条；服务端新增只读 `GET /api/stats`。
**本轮只做网页能力，不动 Excel**（WBS 导出与日报文本弹层都不带本统计）。

## 一键复现

```bash
bash /opt/wbs-rongcheng/tests/verify_stage17.sh
```

总入口依次跑：真实浏览器（Chromium 容器）总览/五色/刷新/九身份/375px 用例集 → 宿主服务端口径用例集 →
既有 18 项矩阵 + Stage7 + Stage9 + Stage11 + Stage13 + Stage15 回归 →
部署与镜像自检（`BIND_HOST=0.0.0.0`，含 CH-14 live 冒烟），并把逐项输出落到本目录。

## 结果

- 矩阵 01–10 全部通过（见 `matrix-summary.txt` 与 `01.log`…`10.log`）。
- 浏览器用例集：`browser.log`（Chromium 140.0.7339.16，`mcr.microsoft.com/playwright:v1.55.0-jammy`，PASS=21 FAIL=0，pageerror=0，无外部请求）。
- 服务端口径用例集：`statcheck.log` + `statcheck-results.json`（PASS=12 FAIL=0）。
- 回归：`regress-08-legacy-matrix-summary.txt`（18 项全通过）、`regress-08-stage7-matrix-summary.txt`（55 项浏览器断言 0 失败）、
  `regress-08-stage9-matrix-summary.txt`（14 项 0 失败）、`regress-08-stage11-matrix-summary.txt`（14 项 0 失败）、
  `regress-08-stage13-matrix-summary.txt`（12 项 0 失败）、`regress-08-stage15-matrix-summary.txt`（10 项 0 失败）。
- 真实产物：`browser/`（`browser-results.json`、`overview-view.json`、`stats-at-end.json`、`page-workbench.png`、`page-workbench-375.png`）；
  运行现场只读取证：`live/`（`live-stats.json`、`live-workbench-1600.png`、`live-workbench-375.png`）。

## 关键断言口径

- 01：`#phase-overview` 常驻在工作台顶部（页头之下、工具条与表格之上），五阶段各一行（`data-phase` = design/dev/test/product/demo_prep），
  每行五项状态徽标；**无跨阶段合并行**（行内五状态计数合计 = 任务总数，而非跨阶段累加），总览条内无手动刷新按钮。
- 02：DOM 的 `data-count` / `data-percentage` / 文本与 `/api/stats` 逐项一致；**用伪响应（count 与任务数不符、合计 99 不补齐）
  验证「前端原样渲染」**：徽标逐字渲染 `未开始 7 7.7%`，不做本地统计、不二次四舍五入。
- 03：0 行数据不除零（HTTP 200，五阶段 × 五状态全 `0 0.0%`）；1/1/1 分布单阶段五项合计恰为 100.0%（最大余数法 33.4 / 33.3 / 33.3 / 0.0 / 0.0）；
  脏数据（缺 `phases`）时计数之和 ≠ 总数，只做 1 位小数截断、不臆造把占比补齐到 100.0%。
- 04：五种状态颜色与表格阶段控件 `select.phase-select` 的计算样式逐项一致（且等于五色映射：未开始灰 `#9e9e9e` / 已开始蓝 `#2f80ed` /
  已完成绿 `#27ae60` / 延期红 `#e74c3c` / 阻塞黄 `#ffd400`）；数量为 0 仍显示 `0 0.0%`。
- 05：保存 / 新增 / 删除 / 身份切换回到工作台后总览实时重算刷新（每次都与最新 `/api/stats` 逐项一致，且保存后数值确实改变）；
  本地草稿（未保存的阶段改动）不改动总览——口径唯一来源是服务端。
- 06：九个身份在工作台都能看到同一只读总览；项目负责人可编辑全部阶段控件、非项目负责人只能编辑本人负责的行（权限矩阵不回归），
  他人行点击阶段控件仍给中文只读提示。
- 07：桌面 1600px 与 375px 均无横向页面滚动（`documentElement.scrollWidth ≤ clientWidth + 1`），徽标文本/数字不溢出
  （`scrollWidth ≤ clientWidth + 1`）、不遮挡表格（总览条 bottom ≤ 表格 top），窄屏五阶段仍各成一组、行内自然换行；
  表格仍由 `.table-wrap` 内部横向滚动。
- 08：既有 18 项矩阵 + Stage7 + Stage9 + Stage11 + Stage13 + Stage15 全量复跑（409 / 重启持久 / 审计 / WBS 导出保真与五色 /
  日报文本弹层 / Markdown 编辑器 / 权限 / 无外部请求）均不回归。
- 09：`BIND_HOST=0.0.0.0` 重建部署；本机 `127.0.0.1:4180`、`0.0.0.0:4180`、公网 `http://47.108.129.157:4180` 三端
  `/api/health` 均 `ok`；镜像内无 `node_modules` / `package-lock.json`；服务端返回资源与运行目录 sha256 逐字节一致。
- 10：全程无外部请求、**0 次新增下载**（未调用 `WBS_DOWNLOAD_HOOK`、未创建 blob URL、页面无 `a[download]`）；
  `/api/stats` 为 `application/json`、无 `Content-Disposition`、仅接受 GET（POST/PUT/DELETE → 405）。

## 运行现场

- 部署镜像：`wbs-rongcheng:20261016115756`（`BIND_HOST=0.0.0.0:4180`，host 网络，挂载 `/opt/wbs-rongcheng/data`）；
  上一镜像 `wbs-rongcheng:20261015181021` 可回滚，重建前数据备份 `/opt/wbs-rongcheng/data/wbs.json.20261016115756.bak`。
- 公网 `http://47.108.129.157:4180/api/health` → `{"ok":true,"service":"wbs-rongcheng","revision":14}`；
  现场 `/api/stats` → `total=35`，设计与演示准备阶段五项合计均 100.0%（见 `live/live-stats.json`）。
- 现场真实浏览器取证（只读）：`live/live-workbench-1600.png`、`live/live-workbench-375.png`，总览条 DOM 与 live `/api/stats` 零差异。复现命令：

```bash
docker run --rm --network host -e SHOT_DIR=/out -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v /opt/wbs-rongcheng:/app -v /opt/wbs-rongcheng/tests/.tools:/tools -v /opt/wbs-rongcheng/tests/.tmp/stage17-live:/out \
  mcr.microsoft.com/playwright:v1.55.0-jammy node /app/tests/stage17/live_shot.cjs
```

## 本变更实现文件 sha256

- `server.js` `507df43016affbbb430cec31c60c96467a16cb5c105be2f274ca44adf33f52b6`
- `public/app.js` `b48cd499da5f0e6145ed6a1d959fad89f222528a320f80da92e155cc98a3f98c`
- `public/index.html` `3b762e0d00cbea856723ec4be92f0265c6eafcc2a9c137e3928887e89e8046c2`
- `public/styles.css` `2bab8f68c8c84b89df767bac34d89c299911f6c25b1fdc2df32754bd3bc92b77`
- `tests/verify_stage17.sh` `d7786263f2fd3b11938d08305d4195fdd28c100a66485c3ed28a4eea4050d240`
- `tests/stage17/statcheck.cjs` `26e9d09f00bfe806d7ce8e8b00f64cf5cb59751e70fdfd50acb433651168434d`
- `tests/stage17/browser.cjs` `5bd19b0e61caff67641c953c64eca7ebbae4d56c6ebdc2f73d920bc97972874f`
- `tests/stage17/run.sh` `4450abcff2335c15325618c1bb64413dc50b258f0206ee5c1d075fbfe94d2cba`
- `tests/stage17/deploy_check.sh` `58b6001c6639d03c2e98cd05f979d93ee2fb8c6f7cb43c73723b5b0befb6d5e1`
- `tests/stage17/live_shot.cjs` `2d5281b3a9a5ab531a0d38e81bc41842b99415f05ec418e474fc7d7555d4924b`

## 实现口径说明（与契约一致）

- 占比口径唯一来源是服务端：`GET /api/stats` 返回 `{ok,total,revision,phases:[{key,name,statuses:[{value,count,percentage}]}]}`，
  五项顺序固定 `未开始/已开始/已完成/延期/阻塞`；前端只做 `数量 + ' ' + percentage.toFixed(1) + '%'` 形式的等价格式化。
- 分母 = 当前任务总数；先按 1 位小数截断，再按小数余数从大到小把差额补给相应状态（余数相同按状态顺序），
  保证同一阶段五项合计恰为 `100.0%`；总数为 0 时全为 `0 0.0%`（不除零、不补齐）。
- 总览条为只读展示：不参与权限矩阵、不写审计、不产生任何新下载路径；刷新复用既有保存/写操作成功回调，未新增手动刷新按钮。
- 刷新时机：进入工作台、保存 / 新增 / 删除 / 身份切换回到工作台，以及任何写操作成功后。
