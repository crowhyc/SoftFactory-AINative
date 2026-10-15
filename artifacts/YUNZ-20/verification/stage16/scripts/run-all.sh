#!/usr/bin/env bash
# YUNZ-36 / Stage16 独立复验一键复跑（变更包 #6：CH-13）。
# 依赖：docker（mcr.microsoft.com/playwright:v1.55.0-jammy）、python3 标准库、现有 playwright tools 目录。
# 只读现场 /opt/wbs-rongcheng（含 0.0.0.0:4180 运行容器）；写入只落本 stage16 目录。
set -uo pipefail
S16="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$S16/logs" "$S16/results" "$S16/downloads" "$S16/iso" "$S16/shots"
L="$S16/logs"
echo "=== 00 构造隔离数据 ==="; PYTHONIOENCODING=utf-8 python3 "$S16/scripts/qv-make-iso-data.py" 2>&1 | tee "$L/00-iso-data.log" | tail -3
echo "=== 01 隔离实例真实浏览器弹层/剪贴板/无下载/派生构造 ==="; bash "$S16/scripts/qv-run-iso-browser.sh" 2>&1 | tee "$L/01-iso-browser.log" | tail -3
echo "=== 02 现场真实浏览器只读 + 真实下载（WBS） ==="; bash "$S16/scripts/qv-run-live-browser.sh" 2>&1 | tee "$L/02-live-browser.log" | tail -3
echo "=== 03 隔离实例真实浏览器 WBS 导出（五色覆盖） ==="; bash "$S16/scripts/qv-run-iso-export.sh" 2>&1 | tee "$L/03-iso-export.log" | tail -3
echo "=== 04 WBS xlsx 独立读回 + CH-13 文本口径 ==="; PYTHONIOENCODING=utf-8 python3 "$S16/scripts/qv-readback.py" 2>&1 | tee "$L/04-readback.log" | tail -3
echo "=== 05 服务端保留项与不回归（审计 / 409 / 400 / 重启 / identity_added） ==="; PYTHONIOENCODING=utf-8 python3 "$S16/scripts/qv-server-api.py" 2>&1 | tee "$L/05-server-api.log" | tail -3
echo "=== 06 部署与一致性 ==="; bash "$S16/scripts/qv-deploy-consistency.sh" 2>&1 | tee "$L/06-deploy-consistency.log" | tail -3
echo "=== 07 作者自报核验（独立复算，非结论证据） ==="; bash "$S16/scripts/qv-author-claims.sh" 2>&1 | tee "$L/07-author-claims.log" | tail -3
echo "=== 08 不回归抽样（CH-1/2/3/5/6/9、验收 10） ==="; bash "$S16/scripts/qv-run-nonreg.sh" 2>&1 | tee "$L/08-nonreg.log" | tail -3
echo
grep -h "\[.*\] PASS=" "$L"/0*.log | sed 's/^/  /'
