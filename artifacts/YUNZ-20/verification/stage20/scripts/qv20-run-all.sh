#!/usr/bin/env bash
# YUNZ-40 / Stage20 独立复验一键复跑（变更包 #8：CH-15 全量统计 + 分阶段详情 + 产品验收改名）。
# 依赖：docker（mcr.microsoft.com/playwright:v1.55.0-jammy 已缓存）、python3 标准库、
#       /opt/wbs-rongcheng/tests/.tools（playwright）。
# 只读现场 /opt/wbs-rongcheng（含 0.0.0.0:4180 运行容器）；写入只落本 stage20 目录。
set -uo pipefail
S20="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
L="$S20/logs"
mkdir -p "$L" "$S20/results" "$S20/downloads" "$S20/shots" "$S20/iso"
rm -f "$S20/downloads/"*.xlsx "$S20/downloads/"*.json 2>/dev/null

echo "=== 环境 ===" | tee "$L/99-run-all.log"
{ echo "node: $(node -v 2>&1 | tail -1)"; echo "python3: $(python3 -V 2>&1)"
  echo "docker: $(docker version --format '{{.Server.Version}}' 2>&1)"; echo "today: $(date +%F)"; } | tee -a "$L/99-run-all.log"

echo "=== 00 构造隔离数据 + 契约口径独立复算（Fraction 第二套算法） ==="
PYTHONIOENCODING=utf-8 python3 "$S20/scripts/qv20-make-iso-data.py" 2>&1 | tee "$L/00-iso-data.log" | tail -2
echo "=== 01 隔离实例真实浏览器交互（全量统计 / 详情 / 边界 / 五色 / 改名 / 导出 / 刷新 / 权限 / 375px） ==="
bash "$S20/scripts/qv20-run-iso-browser.sh" 2>&1 | tee "$L/01-iso-browser.log" | tail -2
echo "=== 02 重置隔离数据（浏览器用例含写操作） ==="
PYTHONIOENCODING=utf-8 python3 "$S20/scripts/qv20-make-iso-data.py" 2>&1 | tee "$L/02-iso-data-reset.log" | tail -1
echo "=== 03 服务端口径与只读语义（隔离六实例 + 现场只读 + A–K 比对） ==="
bash "$S20/scripts/qv20-run-iso-api.sh" 2>&1 | tee "$L/03-server-api.log" | tail -2
echo "=== 04 WBS 导出 xlsx 独立读回（zipfile + ET，不借 SheetJS/openpyxl） ==="
PYTHONIOENCODING=utf-8 python3 "$S20/scripts/qv20-readback.py" 2>&1 | tee "$L/04-readback.log" | tail -2
echo "=== 05 运行现场真实浏览器只读取证（0.0.0.0:4180） ==="
bash "$S20/scripts/qv20-run-live-browser.sh" 2>&1 | tee "$L/05-live-browser.log" | tail -2
echo "=== 06 部署与一致性（绑定 / 三端 health / 镜像 / 资源 sha256） ==="
bash "$S20/scripts/qv20-deploy-consistency.sh" 2>&1 | tee "$L/06-deploy.log" | tail -2
echo "=== 07 作者自报核验（对照材料，非本任务结论证据） ==="
bash "$S20/scripts/qv20-author-claims.sh" 2>&1 | tee "$L/07-author-claims.log" | tail -2

{
  echo
  grep -hE '^PASS ' "$L"/0*.log | wc -l | sed 's/^/  PASS 合计: /'
  grep -hE '^FAIL ' "$L"/0*.log | sed 's/^/  /'
  echo "  FAIL 合计: $(grep -hE '^FAIL ' "$L"/0*.log | wc -l)"
} | tee -a "$L/99-run-all.log"
[ "$(grep -hE '^FAIL ' "$L"/0*.log | wc -l)" -eq 0 ]
