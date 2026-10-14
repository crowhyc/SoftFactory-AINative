# WC-001 作者自测说明（YUNZ-23 / Stage3 缺陷修复 · AI-IE）

## 本轮（Stage3）变化
- 修复缺陷 **D-1**（页面导出丢失 A–K 列宽）与 **D-2**（序号列点击无反馈）；见 `../wbs-rongcheng/public/app.js` 的 `buildExportWorkbook` 与 `showReadOnlyHint`。
- 新增回归项：**04b**（序号列只读提示一致性，矩阵 4d）、**12b**（页面「导出 Excel」入口产物保留模板列宽）。
- 导出实现统一：页面 `loadExportWorkbook` 与自测 `tests/exportcheck.mjs` 走同一份 `Core.buildExportWorkbook`（自测写出选项与页面 `XLSX.writeFile` 默认值一致，差异项见 `12.log` 的 INFO 行与「页面导出与自测走同一实现」PASS 行）。
- 口径修正：`12.log` 的「列宽设置保持原样」现按实测值表述（A–K 逐列一致，K 进展说明列 **47.2592592592593 ≈ 47.26**），并附复现命令；Stage1 待决事项 #1 中「列宽不受影响」在修复后成立（修复前不成立，见 `live/D1回归-修复前.out`）。

## 逐项输出
- `matrix-summary.txt`：22 项矩阵（原 18 项 + 04b + 12b + 容器附加 19/20/16b/21）逐项结论。
- `01.log` ~ `21.log`、`04b.log`、`12b.log`、`16b.log`：每项实际命令与完整输出。
- 矩阵本轮在**隔离副本**中复跑：`APP_DIR=/opt/wbs-rongcheng/tests/.tmp/iso-app`、容器名 `wbs-rongcheng-iso`、端口 4181（避免容器项改动现场 `data/wbs.json`）；被测源码与运行产物逐字一致（见 `../wbs-rongcheng/` 快照与 `SHA256SUMS`）。
- `live/`：现场（真实容器 `127.0.0.1:4180`）实测证据，见该目录说明。

## 复现命令
```bash
cd /opt/wbs-rongcheng                     # 运行产物目录（权威）
bash tests/verify.sh                      # 全矩阵（容器项请按需用隔离容器名/端口）
# 缺陷 D-1 回归（页面同一实现 + 列宽逐列断言）
node tests/exportcheck.mjs && python3 tests/export_verify.py \
  "/opt/wbs-rongcheng/tests/.tmp/蓉城战役WBS-$(date +%Y%m%d).xlsx" \
  public/template.xlsx tests/.tmp/wbs-from-api.json 36
# 缺陷 D-1 页面入口（jsdom 驱动「导出 Excel」按钮）+ 缺陷 D-2（序号列点击）
node tests/domcheck.mjs --only exportpage
node tests/domcheck.mjs --only idcell
```

## 环境与依赖边界
- 环境：node v24.21.0、python3 3.6.8、docker 26.1.4、jsdom 30.1.2。
- jsdom 仅作测试工具，位于 `/opt/wbs-rongcheng/tests/.tools/`（**不进源码快照、不进镜像**）；缺失时 `domcheck.mjs` 打印 SKIP 不失败。
- 产物运行时**零第三方依赖**：`server.js` 仅 Node 标准库；前端仅用随包 `public/vendor/xlsx.full.min.js`（0.18.5，sha256 锁定）。
- 本机 node 进程处于独立网络命名空间，看不到宿主回环；容器/现场级校验用 `curl` 或用 `docker run --network host` 共享宿主网络。
