#!/usr/bin/env bash
# YUNZ-34 / Stage14 独立复验一键复跑（变更包 #5 CH-11 + CH-12）。
# 依赖：docker（镜像 mcr.microsoft.com/playwright:v1.55.0-jammy）、python3 标准库、现有 playwright tools 目录。
# 全部只读现场产物；写入只落本目录（iso/ results/ logs/ downloads/）。
set -uo pipefail
S14="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$S14/logs" "$S14/results" "$S14/downloads" "$S14/iso"
L="$S14/logs"
echo "=== 01 现场真实浏览器只读 + 真实下载（日报 / WBS） ==="; bash "$S14/scripts/qv-run-live-browser.sh" 2>&1 | tee "$L/01-live-browser.log" | tail -3
echo "=== 02 隔离实例真实浏览器写入矩阵 ==="; bash "$S14/scripts/qv-run-iso-browser.sh" 2>&1 | tee "$L/02-iso-browser.log" | tail -3
echo "=== 03 xlsx 独立读回（zipfile + xml.etree） ==="; LC_ALL=en_US.utf8 PYTHONIOENCODING=utf-8 python3 "$S14/scripts/qv-readback.py" 2>&1 | tee "$L/03-readback.log" | tail -3
echo "=== 04 服务端不回归（409 / 原子写 / 重启 / 10 次保存） ==="; PYTHONIOENCODING=utf-8 python3 "$S14/scripts/qv-make-iso-data.py" >/dev/null; LC_ALL=en_US.utf8 PYTHONIOENCODING=utf-8 python3 "$S14/scripts/qv-server-api.py" 2>&1 | tee "$L/04-server-api.log" | tail -3
echo "=== 05 部署与一致性 ==="; bash "$S14/scripts/qv-deploy-consistency.sh" 2>&1 | tee "$L/05-deploy-consistency.log" | tail -3
echo "=== 06 不回归抽样（CH-1/3/6/8/9/10、D-3、验收 1/3/5/10） ==="; bash "$S14/scripts/qv-run-nonreg.sh" 2>&1 | tee "$L/06-nonreg.log" | tail -3
echo "=== 07 作者自报核验（独立复算，非结论证据） ==="; bash "$S14/scripts/qv-author-claims.sh" 2>&1 | tee "$L/07-author-claims.log" | tail -2
echo
grep -h "\[.*\] PASS=" "$L"/0*.log | sed 's/^/  /'
