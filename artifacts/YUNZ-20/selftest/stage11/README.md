# YUNZ-31 · Stage11 变更包 #4（CH-9 + CH-10）作者自测证据

任务：`YUNZ-31`（父任务 `YUNZ-20`，Stage11 变更实现，变更包 #4）
范围：CH-9（「是否演示范围」列仅网页隐藏、数据保留）+ CH-10（五阶段独立进度、网页/WBS 导出/日报三处重构、一次性迁移、派生规则）。

## 一键复现

```bash
bash /opt/wbs-rongcheng/tests/verify_stage11.sh
```

总入口依次跑：真实浏览器（Chromium 容器）用例集 → 服务端用例集 → 导出产物宿主 python 独立读回 → 既有 18 项矩阵 → Stage7 矩阵 01–14 → 部署/镜像自检，并把逐项输出落到本目录。

## 结果

- 矩阵 01–14 全部通过（见 `matrix-summary.txt` 与 `01.log`…`14.log`）。
- 浏览器用例集：`browser.log`（Chromium 140.0.7339.16，`mcr.microsoft.com/playwright:v1.55.0-jammy`，PASS=35 FAIL=0，pageerror=0）。
- 服务端用例集：`server.log`（PASS=14 FAIL=0）。
- 导出读回：`readback-wbs.log`（PASS=10 FAIL=0）、`readback-daily.log`（PASS=14 FAIL=0），均由宿主 python 直接解析 xlsx zip/XML（不依赖 openpyxl）。
- 浏览器真实产物：`browser/`（`WBS-2026-10-15.xlsx`、`日报-20261015.xlsx`、`wbs-at-export.json`、`daily-at-export.json`、`browser-results.json`、`page-workbench.png`）。

## 关键断言口径

- 01：五个日期列下方各常显一个五档下拉，当前值颜色块 = 未开始灰 / 已开始蓝 / 已完成绿 / 延期红 / 阻塞黄；option 亦着色（CSP `style-src 'self'` 下用类名着色，非内联 style）。
- 02：普通负责人仅本人行可改、他人行 disabled、点只读给中文提示；PM 全部可改。
- 04/05：一次性迁移每阶段一条 `type:"migrated"` 审计（身份「系统迁移」），迁移前落时间戳备份；迁移审计不进 `/api/history`、不进日报任何 sheet；重复启动不重复迁移。
- 07：A–K 与模板/JSON 逐字段一致（含 demo 原值），K 后连续追加 5 个进度列（L–P，文字 + 五色填充），导出日期标签右移到 Q1，A1:C1 合并与列宽保持。
- 08/09/10：今日摘要逐字模板 `【重要度】一级 / 二级 / 任务项 @负责人：结论。`（含 `@` 与风险前缀），重要度排序 延期 > 阻塞 > 到期未更新 > 完成 > 普通；派生规则①（计划日期 < 今天且今日未更新 → 到期未更新判定延期）与②（当天已更新则不判定）各留构造用例；日报为单 workbook 三 sheet（今日摘要 / 阻塞与延期 / 当日变更），含 CH-7 新增人员审计行。
- 11：CH-1…CH-8（含 CH-9/CH-10）、D-3、验收 1–10、Markdown 转义安全、重启持久、全程无外部资源请求。

## 运行现场

- 部署镜像：`wbs-rongcheng:20261015123713`（`BIND_HOST=0.0.0.0:4180`，host 网络，挂载 `/opt/wbs-rongcheng/data`）。
- 本机 / 0.0.0.0 / 公网 health 全部 `ok`（revision 10）；镜像内无 `node_modules`；服务端返回资源与源码目录逐字节一致。
- 迁移备份：`/opt/wbs-rongcheng/data/wbs.json.20261015040405.bak`（首次迁移前，sha256 `8df26205…`）；本次重建备份 `/opt/wbs-rongcheng/data/wbs.json.20261015123713.bak`（sha256 `5310e1f3…`）。重建时数据已含 `phases`，未触发第二次迁移（revision 保持 10）。
- 现场迁移审计：`/opt/wbs-rongcheng/data/audit.log` 中 `type:"migrated"` 共 175 条（35 任务 × 5 阶段）。
