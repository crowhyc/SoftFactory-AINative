# YUNZ-40 / Stage20 独立复验证据目录（WC-001 变更包 #8：CH-15）

复验对象：Stage19（`YUNZ-39`）交付的「全量统计 + 分阶段详情 + 产品验收改名 + `/api/stats` aggregate」。
执行者：独立验证工程师（AI-QV）。本目录是本任务唯一写入位置；被验证实现与现场数据只读。

## 一键复跑

```bash
bash scripts/qv20-run-all.sh      # 00 隔离数据 → 01 隔离浏览器 → 02 重置 → 03 服务端口径 → 04 导出读回
                                  # → 05 现场只读取证 → 06 部署一致性 → 07 作者自报核验
```

依赖：docker（`mcr.microsoft.com/playwright:v1.55.0-jammy` 已缓存）、python3 标准库、
`/opt/wbs-rongcheng/tests/.tools`（playwright 1.55）。不安装任何系统级组件，不联网下载。

## 目录

- `scripts/`：本任务独立编写的用例脚本（不复用作者自测脚本的断言）。
  - `qv20-make-iso-data.py`：隔离数据构造 + 契约口径**第二套算法**（`fractions.Fraction` 精确有理数）复算。
  - `qv20-iso-browser.cjs` / `qv20-run-iso-browser.sh`：隔离实例真实浏览器（Chromium 140）交互用例集。
  - `qv20-server-api.py` / `qv20-run-iso-api.sh`：服务端口径、只读语义、409/400、迁移、重启持久（六隔离实例）。
  - `qv20-stats-dirty.cjs`：脏数据「只截断不补齐」分支（数据文件路径不可达，改直接模块调用取证）。
  - `qv20-live-browser.cjs` / `qv20-run-live-browser.sh`：运行现场（0.0.0.0:4180）只读浏览器取证。
  - `qv20-readback.py`：导出 xlsx 独立读回（标准库 zipfile + xml.etree，不借 SheetJS / openpyxl）。
  - `qv20-deploy-consistency.sh`：绑定 / 三端 health / 镜像 / 资源 sha256 一致性。
  - `qv20-author-claims.sh`：作者自报核验（对照材料，非本任务结论证据）。
- `logs/`：逐段完整输出（`00`–`07`、`99-run-all.log` 汇总，`iso-*` 为隔离实例启动/重启日志）。
- `results/`：`expected-stats.json`（独立复算期望值）、`iso-browser-results.json`、`live-browser-results.json`。
- `iso/`：六组隔离数据（isoA 边界 / isoB 需补齐 / isoC 0 行 / isoS 含阻塞与日报 / isoD 脏数据 / isoE 迁移）。
- `downloads/`：真实浏览器导出的 xlsx 与导出时 `/api/wbs` 快照。
- `shots/`：隔离实例与运行现场截图（1600px / 375px、工作台与详情面板）。
- `matrix-summary.txt`：必测 1–10 与用例的逐项对应与结论。
- `verification-report.md`：验证报告（结论层）。

## 两条证据链

- 链 1（作者自报，仅对照）：`/opt/SoftFactory-AINative/artifacts/YUNZ-20/selftest/stage19/`（核验输出见 `logs/07-author-claims.log`）。
- 链 2（本任务复跑，结论依据）：本目录 `logs/`、`results/`、`downloads/`、`shots/`（240 PASS / 0 FAIL）。
