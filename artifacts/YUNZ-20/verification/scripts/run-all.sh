#!/usr/bin/env bash
# YUNZ-20 Stage2 —— 一键复跑全部独立验证，日志直接写入交付证据目录。
set -uo pipefail
V="$(cd "$(dirname "$0")" && pwd)"
A=/opt/SoftFactory-AINative/artifacts/YUNZ-20/verification
IMG=docker.m.daocloud.io/library/node:24-slim
mkdir -p "$A"
echo "验证开始 $(date -Iseconds)" | tee "$A/run-all.out"
restore(){ cp -f "$V/wbs.json.pre-qv" /opt/wbs-rongcheng/data/wbs.json; sleep 0.4; }

echo "### 0. 输入只读输入复核（VPC 输入基线）" | tee -a "$A/run-all.out"
( cd /opt/wbs-rongcheng-staging/WC-001 && sha256sum -c INPUT-SHA256SUMS ) 2>&1 | tee "$A/input-receipt-qv.txt"

echo "### 1. 交付三链一致性 / 仓库状态" | tee -a "$A/run-all.out"
PYTHONIOENCODING=utf-8 python3 "$V/integrity.py" 2>&1 | tee "$A/integrity.log"

echo "### 2. DOM 交互级验证（jsdom，交付页面脚本 + 真实 /api）" | tee -a "$A/run-all.out"
restore
docker run --rm --network host -v "$V:$V" -w "$V" -v /opt/wbs-rongcheng:/opt/wbs-rongcheng:ro "$IMG" \
  node dom-verify.js > "$A/dom-verify.log" 2>&1
echo "dom-verify.js 退出码=$? （日志 $A/dom-verify.log，共 $(grep -c '^\[' "$A/dom-verify.log") 条判定）" | tee -a "$A/run-all.out"
cp -f "$V/dom-out/dom-results.json" "$A/dom-results.json"
cp -f "$V/dom-out/dom-adv-detail.json" "$A/dom-adv-detail.json"

echo "### 3. 导出保真（页面导出入口 -> python 标准库读回）" | tee -a "$A/run-all.out"
restore
docker run --rm --network host -v "$V:$V" -w "$V" -v /opt/wbs-rongcheng:/opt/wbs-rongcheng:ro "$IMG" \
  node export-verify.js > "$A/export-run.log" 2>&1
cp -f "$V/dom-out/exported.xlsx" "$A/exported.xlsx"
cp -f "$V/dom-out/export-json-snapshot.json" "$A/export-json-snapshot.json"
cp -f "$V/dom-out/export-meta.json" "$A/export-meta.json"
( cd "$V" && PYTHONIOENCODING=utf-8 python3 export-readback.py dom-out/exported.xlsx dom-out/export-json-snapshot.json ) 2>&1 | tee "$A/export-readback.log"
cp -f /opt/wbs-rongcheng/tests/.tmp/蓉城战役WBS-$(date +%Y%m%d).xlsx "$V/dom-out/author-path-export.xlsx" 2>/dev/null || true
( cd "$V" && PYTHONIOENCODING=utf-8 python3 col-compare.py dom-out/exported.xlsx dom-out/author-path-export.xlsx ) 2>&1 | tee "$A/export-cols-compare.log"

echo "### 4. 服务/API/持久化/并发（验收 3,5,6,7,9,10）" | tee -a "$A/run-all.out"
PYTHONIOENCODING=utf-8 python3 "$V/svc-verify.py" 2>&1 | tee "$A/svc-verify.log"

echo "### 5. 隔离复跑 deploy/rollback.sh 语义（不动现场部署）" | tee -a "$A/run-all.out"
bash "$V/rollback-isolated.sh" 2>&1 | tee "$A/rollback-isolated.log"
bash "$V/deploy-isolated.sh" 2>&1 | tee "$A/deploy-isolated.log"

echo "### 6. 收尾：恢复初始数据并确认现场服务" | tee -a "$A/run-all.out"
restore
echo "health: $(curl -s -m 5 http://127.0.0.1:4180/api/health)" | tee -a "$A/run-all.out"
echo "data/wbs.json sha256: $(sha256sum /opt/wbs-rongcheng/data/wbs.json | cut -d' ' -f1)" | tee -a "$A/run-all.out"
echo "验证结束 $(date -Iseconds)" | tee -a "$A/run-all.out"
