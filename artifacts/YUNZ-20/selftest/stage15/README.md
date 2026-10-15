# YUNZ-35 · Stage15 变更包 #6（CH-13）作者自测证据

任务：`YUNZ-35`（父任务 `YUNZ-20`，Stage15 变更实现，变更包 #6）
范围：CH-13 —— 点「导出日报」**不再生成 Excel**，改为弹出**可复制的一段关键信息文本**，只体现**阻塞、延期**。
服务端 `/api/daily` 的既有汇总（`summary` / `blocked` / `changes` / `counts`）与审计写入原样保留，只作为数据源；
前端不再产出、不再下载任何日报文件。

## 一键复现

```bash
bash /opt/wbs-rongcheng/tests/verify_stage15.sh
```

总入口依次跑：真实浏览器（Chromium 容器）弹层/复制/关闭用例集 → 宿主服务端文本口径用例集 →
既有 18 项矩阵 + Stage7 + Stage9 + Stage11 + Stage13 回归 → 部署与镜像自检（`BIND_HOST=0.0.0.0`，含 CH-13 live 冒烟），
并把逐项输出落到本目录。

## 结果

- 矩阵 01–10 全部通过（见 `matrix-summary.txt` 与 `01.log`…`10.log`）。
- 浏览器用例集：`browser.log`（Chromium 140.0.7339.16，`mcr.microsoft.com/playwright:v1.55.0-jammy`，PASS=15 FAIL=0，pageerror=0，无外部请求）。
- 服务端文本用例集：`textcheck.log` + `textcheck-results.json`（PASS=11 FAIL=0）。
- 回归：`regress-09-legacy-matrix-summary.txt`（18 项全通过）、`regress-09-stage7-matrix-summary.txt`（55 项浏览器断言 0 失败）、
  `regress-09-stage9-matrix-summary.txt`（14 项 0 失败）、`regress-09-stage11-matrix-summary.txt`（14 项 0 失败）、
  `regress-09-stage13-matrix-summary.txt`（12 项 0 失败）。
- 浏览器真实产物：`browser/`（`browser-results.json`、`daily-at-export.json`、`daily-quiet.json`、`wbs-at-export.json`、
  `page-workbench.png`、`page-daily-popup.png`、运行现场 `live-daily-popup.png` + `live-daily.json`）。

## 关键断言口径

- 01：点「导出日报」打开只读文本弹层（`#daily-panel` / `role=dialog` / `aria-modal=true`，含 `#daily-text`、`#daily-copy`、`#daily-close`）；
  全程无 `WBS_DOWNLOAD_HOOK` 调用、无 `createObjectURL`、无 `a[download]`、无 xlsx 组装 API（`WBSCore.buildDailyWorkbook` / `dailyBytes` 均为 `undefined`）。
- 02：首行恒为 `今日延期 X 项 / 阻塞 Y 项`，X/Y 与弹层内事件行数、`/api/daily` 的 `text.delayedCount/blockedCount` 三口径一致。
- 03：延期条目在前、阻塞条目在后；同类内按任务（一级/二级/任务项）与阶段顺序（设计→开发→测试→产品→演示准备）稳定排列。
- 04：派生规则「该阶段计划日期 < 今天且今日 0 点至今无更新」→ `{阶段} MM-DD 到期未更新，判定延期。`；
  当天更新过的阶段按实际新状态归类、不重复派生；计划日期=今天 / 日期为空 / 已完成 均不进日报；
  阻塞范围含「当天新出现」与「仍处于阻塞」。
- 05：无任何阻塞/延期时整体文本只有一行 `今日无阻塞、延期。`（**不输出**概况行）。
- 06：事件行逐字 `【延期·高风险】/【阻塞·高风险】一级 / 二级 / 任务项 @负责人：结论。`，
  `@` 与「·高风险」前缀保留；结论用最简表达；不含「完成 / 普通」字样。
- 07：复制优先 `navigator.clipboard.writeText`（写入真实剪贴板内容 = 弹层文本逐字），
  失败走「选择 + `document.execCommand('copy')`」兜底；两条路径都失败时给出中文失败提示；成功提示 `已复制，可直接粘贴到微信`。
- 08：关闭按钮与 `Esc` 均可关闭（只读展示、不弹确认框）；打开/关闭弹层不影响工作台未保存编辑状态（草稿值、行编辑态保留、未触发保存、未改动磁盘）。
- 09：WBS 导出（A–K 保真 / L–P 五进度列 / 五色填充 / Q1 导出日期标签）、五阶段下拉与五色、权限边界、
  409 并发不覆盖、重启持久、Markdown 编辑器、无外部请求与 `pageerror` 全部不回归。
- 10：`BIND_HOST=0.0.0.0` 重建；本机 `127.0.0.1:4180`、`0.0.0.0:4180`、公网 `http://47.108.129.157:4180` 三端
  `/api/health` 均 `ok`；镜像内无 `node_modules` / `package-lock.json`；服务端返回资源与运行目录 sha256 逐字节一致。

## 回归用例同步口径

CH-13 移除了日报 xlsx 产出，因此此前编码日报 xlsx 的用例已按新契约同步为弹层文本断言，断言强度未降低：

- `tests/stage9/browser.cjs` 矩阵 11g/11h、`tests/verify_stage9.sh` 断言关键字；
- `tests/stage13/browser.cjs` 矩阵 01–04、`tests/verify_stage13.sh` 条目 01–04（并新增 `tests/stage15/` 全套弹层交互）；
- `tests/stage7/browser.cjs` 矩阵 7a–7e / 8a / 14c、`tests/stage11/browser.cjs` 矩阵 08d / 10a / 10b、
  `tests/verify_stage7.sh` / `tests/verify_stage11.sh` / `tests/stage13/deploy_check.sh` / `tests/stage9/deploy_check.sh` 文案。

## 运行现场

- 部署镜像：`wbs-rongcheng:20261015181021`（`BIND_HOST=0.0.0.0:4180`，host 网络，挂载 `/opt/wbs-rongcheng/data`）；
  上一镜像 `wbs-rongcheng:20261015141900` 可回滚，重建前数据备份 `/opt/wbs-rongcheng/data/wbs.json.20261015181021.bak`。
- 公网 `http://47.108.129.157:4180/api/health` → `{"ok":true,"service":"wbs-rongcheng","revision":10}`。
- 运行现场真实浏览器取证（只读）：`browser/live-daily-popup.png`，点「导出日报」后概况行 `今日延期 51 项 / 阻塞 0 项`，
  52 行、2018 字符、`role=dialog`、`pre-wrap`、无 pageerror。复现命令：

```bash
docker run --rm --network host -e SHOT=/out/live-daily-popup.png -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v /opt/wbs-rongcheng:/app -v /opt/wbs-rongcheng/tests/.tools:/tools -v /opt/wbs-rongcheng/tests/.tmp/stage15-live:/out \
  mcr.microsoft.com/playwright:v1.55.0-jammy node /app/tests/stage15/live_shot.cjs
```

## 本变更实现文件 sha256

- `server.js` `81adc14b91125ea07c27d152953296e1265ac4fc36cfc3e6f0af134546c7cb54`
- `public/app.js` `33e897a2a83bf8451857848723085d140deaa771d66fb9ae434117153140ee24`
- `public/index.html` `70cbd82be5ebd9cfcf776db63f2d0d39bc1b304a8025214c3431ce660c10043a`
- `public/styles.css` `eaf8f102a80d63eb644d8b155bd3561dac72b592c038d835e34aa0669e106087`
