#!/usr/bin/env bash
# YUNZ-20 Stage3 一键复验总控。证据写入 stage3/ 目录；被验证产物只读。
set -uo pipefail
W=/opt/SoftFactory-AINative/artifacts/YUNZ-20/verification/stage3
V="$W/scripts"
WORKDIR=/opt/SoftFactory-AINative/.multica-workspaces/yunzhidian-f03e0d551ffa/yunz-24-ebc21e7f6b92/workdir/verify
IMG=docker.m.daocloud.io/library/node:24-slim
LOG="$W/run-all.out"
: > "$LOG"
say(){ echo "$@" | tee -a "$LOG"; }
restore(){ cp -f "$V/wbs.json.pre-qv" /opt/wbs-rongcheng/data/wbs.json; sleep 0.4; }

say "复验开始 $(date -Iseconds)"
# 0 起始现场快照
{
  echo "start $(date -Iseconds)"
  echo "container: $(docker inspect -f '{{.Config.Image}}|{{.HostConfig.NetworkMode}}' wbs-rongcheng)"
  echo "health: $(curl -s -m 5 http://127.0.0.1:4180/api/health)"
  echo "data/wbs.json sha256: $(sha256sum /opt/wbs-rongcheng/data/wbs.json | cut -d' ' -f1)"
  echo "data/wbs.json bytes: $(stat -c%s /opt/wbs-rongcheng/data/wbs.json)"
} | tee "$W/start-state.txt" >> "$LOG"
cp -f /opt/wbs-rongcheng/data/wbs.json "$V/wbs.json.pre-qv"

say "### 1. 运行态资源抓取 / served vs disk"
bash "$V/served-integrity.sh" 2>&1 | tee "$W/served-integrity.log" >> "$LOG"

say "### 2. 交付三链一致性"
bash "$V/integrity-stage3.sh" 2>&1 | tee "$W/integrity.log" >> "$LOG"

say "### 3. DOM 交互级验证（jsdom，运行态页面脚本 + 真实 /api）"
restore
(cd "$V" && docker run --rm --network host \
  -v "$V:$V" -v "$W:$W" -v "$WORKDIR:$WORKDIR" -v /opt/wbs-rongcheng:/opt/wbs-rongcheng:ro -w "$V" -e NODE_PATH="$WORKDIR/node_modules" \
  -e PUB="$W/served" -e OUT="$V/dom-out" "$IMG" node dom-verify-stage3.js) > "$W/dom-verify.log" 2>&1
say "dom-verify-stage3.js 退出码=$? （判定 $(grep -c '^\[' "$W/dom-verify.log") 条）"
cp -f "$V/dom-out/dom-results.json" "$W/dom-results.json" 2>/dev/null || true
cp -f "$V/dom-out/dom-adv-detail.json" "$W/dom-adv-detail.json" 2>/dev/null || true

say "### 4. 导出（交付页面入口，运行态资源）"
restore
(cd "$V" && docker run --rm --network host -v "$V:$V" -v "$W:$W" -v "$WORKDIR:$WORKDIR" -w "$V" \
  -e NODE_PATH="$WORKDIR/node_modules" -e PUB="$W/served" -e OUT="$W" "$IMG" node export-page.js) \
  > "$W/export-run.log" 2>&1
say "export-page.js 退出码=$?"
PYTHONIOENCODING=utf-8 python3 "$V/cols-check-stage3.py" 2>&1 | tee "$W/export-cols-check.log" >> "$LOG"
say "### 4b. 路径统一核验（作者自测共用函数路径 vs 页面路径）"
(cd "$V" && docker run --rm --network host -v "$V:$V" -v "$W:$W" -v "$WORKDIR:$WORKDIR"   -v /opt/wbs-rongcheng:/opt/wbs-rongcheng:ro -w "$V" -e NODE_PATH="$WORKDIR/node_modules"   -e PUB="$W/served" -e OUT="$W" "$IMG" node selftest-path-cols.js) > "$W/selftest-path-cols.log" 2>&1
say "selftest-path-cols.js 退出码=$?"
(cd "$V" && PYTHONIOENCODING=utf-8 python3 col-compare-stage3.py "$W/exported-stage3.xlsx" "$W/exported-selftest-path-stage3.xlsx") \
  2>&1 | tee "$W/export-cols-compare.log" >> "$LOG"
(cd "$V" && PYTHONIOENCODING=utf-8 python3 export-readback-stage3.py "$W/exported-stage3.xlsx" "$W/export-json-snapshot.json") \
  2>&1 | tee "$W/export-readback.log" >> "$LOG"

say "### 5. 服务 / API / 持久化 / 并发（验收 3,5,6,7,9,10）"
PYTHONIOENCODING=utf-8 python3 "$V/svc-verify-stage3.py" 2>&1 | tee "$W/svc-verify.log" >> "$LOG"

say "### 6. 收尾：恢复初始数据并确认现场服务"
restore
say "health: $(curl -s -m 5 http://127.0.0.1:4180/api/health)"
say "data/wbs.json sha256: $(sha256sum /opt/wbs-rongcheng/data/wbs.json | cut -d' ' -f1)"
say "复验结束 $(date -Iseconds)"
