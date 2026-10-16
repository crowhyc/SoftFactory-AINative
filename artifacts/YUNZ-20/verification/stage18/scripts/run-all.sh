#!/usr/bin/env bash
# YUNZ-38 / Stage18 独立复验一键复跑（变更包 #7：CH-14 阶段状态占比总览 + GET /api/stats）。
# 依赖：docker（mcr.microsoft.com/playwright:v1.55.0-jammy）、python3 标准库、/opt/wbs-rongcheng/tests/.tools（playwright）。
# 只读现场 /opt/wbs-rongcheng（含 0.0.0.0:4180 运行容器）；写入只落本 stage18 目录。
set -uo pipefail
S18="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$S18/logs" "$S18/results" "$S18/downloads" "$S18/shots" "$S18/iso"
L="$S18/logs"
rm -f "$S18/downloads/"*.xlsx "$S18/downloads/"*.json 2>/dev/null
echo "=== 00 构造隔离数据 + 契约口径独立复算 ==="; PYTHONIOENCODING=utf-8 python3 "$S18/scripts/qv-make-iso-data.py" 2>&1 | tee "$L/00-iso-data.log" | tail -3
echo "=== 01 隔离实例真实浏览器（结构/一致性/边界/五色/刷新/权限/375px） ==="; bash "$S18/scripts/qv-run-iso-browser.sh" 2>&1 | tee "$L/01-iso-browser.log" | tail -2
echo "=== 02 隔离实例真实浏览器导出 WBS 下载 ==="; bash "$S18/scripts/qv-run-iso-export.sh" 2>&1 | tee "$L/02-iso-export.log" | tail -2
echo "=== 03 WBS 导出 xlsx 独立读回（3A 不进掺） ==="; PYTHONIOENCODING=utf-8 python3 "$S18/scripts/qv-readback.py" 2>&1 | tee "$L/03-readback.log" | tail -2
echo "=== 04 现场真实浏览器只读 + 375px + 只读纪律 ==="; bash "$S18/scripts/qv-run-live-browser.sh" 2>&1 | tee "$L/04-live-browser.log" | tail -3
echo "=== 05 服务端口径与只读性（现场 + 隔离写路径） ==="; PYTHONIOENCODING=utf-8 python3 "$S18/scripts/qv-server-api.py" 2>&1 | tee "$L/05-server-api.log" | tail -2
echo "=== 06 迁移幂等与旧 status 保留（CH-11/CH-12） ==="; PYTHONIOENCODING=utf-8 python3 "$S18/scripts/qv-migrate-check.py" 2>&1 | tee "$L/06-migrate.log" | tail -2
echo "=== 07 CH-1…CH-13 不回归抽样 + 验收抽样 ==="; bash "$S18/scripts/qv-run-nonreg.sh" 2>&1 | tee "$L/07-nonreg.log" | tail -2
echo "=== 08 部署与一致性（0.0.0.0 绑定 / 三端 health / 镜像 / sha256） ==="; bash "$S18/scripts/qv-deploy-consistency.sh" 2>&1 | tee "$L/08-deploy.log" | tail -2
echo "=== 09 作者自报核验（非结论证据，仅对照） ==="; bash "$S18/scripts/qv-author-claims.sh" 2>&1 | tee "$L/09-author-claims.log" | tail -2
echo
grep -hE "^PASS " "$L"/0*.log | sed 's/^/  /' | sort | uniq | wc -l | sed 's/^/  PASS 行数（去重）: /'
echo "  PASS 合计: $(grep -hE '^PASS ' "$L"/0*.log | wc -l)"
grep -hE "^FAIL " "$L"/0*.log | sed 's/^/  /'
echo "  FAIL 合计: $(grep -hE '^FAIL ' "$L"/0*.log | wc -l)"
