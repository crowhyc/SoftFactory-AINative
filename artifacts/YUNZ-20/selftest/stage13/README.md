# YUNZ-33 · Stage13 变更包 #5（CH-11 + CH-12）作者自测证据

任务：`YUNZ-33`（父任务 `YUNZ-20`，Stage13 变更实现，变更包 #5）
范围：CH-11（日报「今日摘要」只保留 A 列微信文本行，删除辅助分列）+ CH-12（日报导出删除「当日变更」sheet，只留 `今日摘要`/`阻塞与延期`）。服务端审计写入、`/api/history`、CH-7 `identity_added` 全部保留不动。

## 一键复现

```bash
bash /opt/wbs-rongcheng/tests/verify_stage13.sh
```

总入口依次跑：真实浏览器（Chromium 容器）用例集 → 导出产物宿主 python 独立读回（WBS / 日报 / 无事件兜底三份）→ 既有 18 项矩阵 → Stage7 / Stage9 / Stage11 矩阵回归 → 部署/镜像自检，并把逐项输出落到本目录。

## 结果

- 矩阵 01–07（本变更包）与回归项 08–12 全部通过（见 `matrix-summary.txt` 与 `01.log`…`12.log`）。
- 浏览器用例集：`browser.log`（Chromium 140.0.7339.16，`mcr.microsoft.com/playwright:v1.55.0-jammy`，PASS=17 FAIL=0，pageerror=0，无外部请求）。
- 导出读回：`readback-wbs.log`（PASS=10 FAIL=0）、`readback-daily.log`（PASS=16 FAIL=0）、`readback-daily-quiet.log`（PASS=4 FAIL=0），均由宿主 python 直接解析 xlsx zip/XML（不依赖 openpyxl）。
- 回归：`regress-08-legacy-matrix-summary.txt`（18 项全通过）、`regress-09-stage7-matrix-summary.txt`（54 项浏览器断言 0 失败）、`regress-10-stage9-matrix-summary.txt`（63 项 0 失败）、`regress-11-stage11-matrix-summary.txt`（35 项 0 失败）。
- 浏览器真实产物：`browser/`（`日报-20261015.xlsx`、`日报-20261015-无事件.xlsx`、`WBS-2026-10-15.xlsx`、`daily-at-export.json`、`daily-quiet.json`、`wbs-at-export.json`、`browser-results.json`、`page-workbench.png`）。

## 关键断言口径

- 01/04：日报导出 sheetNames 恒为 `["今日摘要","阻塞与延期"]`；`当日变更` sheet、其 9 列表头与组装代码已从导出路径移除（原始 XML 扫描 11 个部件无 `当日变更/改动字段/旧值/新值/操作身份/重要度/结论/依据` 字样）。
- 02：`今日摘要` 只有 A 列——`!ref = A1:A(n+1)`、每行长度 1、表头仅 `微信文本行`，B 列及之后无任何单元格；A 列宽 120（Excel 宽 120.83）；因随包 SheetJS 0.18.5 社区版写出时不生成 cellXfs，自动换行沿用 CH-10 的「STORED zip 最小修补」注入 `cellXfs` + `alignment wrapText="1"`（A 列单元格引用该 xf）。
- 03：摘要文本逐字维持变更包 #4 口径 `【延期·高风险】一级 / 二级 / 任务项 @负责人：结论。`，排序 `延期 > 阻塞 > 到期未更新判定延期 > 完成 > 普通`，一任务多事件多行；无事件仍只输出一行「今日无阻塞、延期或变更。」（`daily-quiet.json` + `日报-20261015-无事件.xlsx` 为独立实例证据）。
- 05：WBS 导出不回归——单 sheet、A–K 与模板第 1/2 行逐字一致、L–P 五进度列文字与五色填充（灰/蓝/绿/红/黄）、「导出日期」标签仍在 Q1、A1:C1 合并保留、不含旧全局 status。
- 06：CH-7 新增人员仍写 `identity_added` 审计、`/api/history` 仍返回「人员池」行、`/api/daily` 仍返回 `summary/blocked/changes`；只是导出的日报文件里不再有 `当日变更` sheet。
- 07：保存后页面/API/磁盘三端一致；过期 `If-Match` 返回 409 且被拒写入不落盘；服务重启后数据仍在；健康探针 `探针：服务正常 · v7`；全程无外部资源请求与 pageerror。

## 回归用例同步口径（重要）

CH-12 删除了导出中的 `当日变更` sheet，因此此前编码该 sheet / `今日摘要` 辅助分列的用例已按新契约同步：`tests/stage7/browser.cjs`（矩阵 8a–8c → 字段级证据改由 `/api/history` 承载）、`tests/stage9/browser.cjs`（矩阵 11g/11h）、`tests/stage11/browser.cjs` 与 `tests/stage11/xlsx_readback.py`（矩阵 08d/10a/10c 与日报读回），以及对应 `verify_stage7.sh` / `verify_stage11.sh` 的断言关键字与 `tests/stage11/deploy_check.sh` 的 live 冒烟文案；断言强度未降低。

## 运行现场

- 部署镜像：`wbs-rongcheng:20261015141900`（`BIND_HOST=0.0.0.0:4180`，host 网络，挂载 `/opt/wbs-rongcheng/data`）；上一镜像 `wbs-rongcheng:20261015123713` 可回滚，重建前数据备份 `/opt/wbs-rongcheng/data/wbs.json.20261015141900.bak`。
- 本机 `127.0.0.1:4180`、`0.0.0.0:4180`、公网 `http://47.108.129.157:4180/api/health` 全部 `ok`（revision 10）；镜像内无 `node_modules`/`package-lock.json`；服务端返回 `app.js` / `styles.css` / `index.html` 与运行目录源码 sha256 逐字节一致；容器内 `/app` 源码与运行目录一致。
- 服务端 `server.js` 本轮未改动（sha256 `d9b29f0001fece55ec8c7010ea4c4526f62b70f37538f1761439e0936df4ec33`）；实现改动集中在 `public/app.js`（sha256 `d49cc9e2fce5c3c0e22a35f52ce4ab642110a6a920464bf1d1d14d2a279280f7`）。
