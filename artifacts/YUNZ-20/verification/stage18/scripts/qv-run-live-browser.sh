#!/usr/bin/env bash
# YUNZ-38 / Stage18：现场（4180）真实浏览器只读交互 + 375px + 只读纪律。
# 只读现场：不发出任何写请求；浏览器仅在官方 playwright 容器内运行；写入只落本 stage18 目录。
# 另记录浏览前后 audit.log / wbs.json 指纹，作为「查看总览不改数据」的第二条证据。
set -uo pipefail
S18="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.55.0-jammy}"
TOOLS="${TOOLS_DIR:-/opt/wbs-rongcheng/tests/.tools}"
LIVE_DATA=/opt/wbs-rongcheng/data
before_audit_lines=$(grep -c . "$LIVE_DATA/audit.log")
before_audit_sha=$(sha256sum "$LIVE_DATA/audit.log" | cut -d' ' -f1)
before_wbs_sha=$(sha256sum "$LIVE_DATA/wbs.json" | cut -d' ' -f1)
before_rev=$(curl -s http://127.0.0.1:4180/api/health | sed -n 's/.*"revision":\([0-9]*\).*/\1/p')

docker run --rm --ipc=host --network host \
  -e TOOLS=/tools -e OUTDIR=/qv/results -e SHOTDIR=/qv/shots \
  -e BASE="http://127.0.0.1:${LIVE_PORT:-4180}" \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "$TOOLS":/tools:ro -v "$S18":/qv \
  "$IMAGE" node /qv/scripts/qv-live-browser.cjs
RC=$?

after_audit_lines=$(grep -c . "$LIVE_DATA/audit.log")
after_audit_sha=$(sha256sum "$LIVE_DATA/audit.log" | cut -d' ' -f1)
after_wbs_sha=$(sha256sum "$LIVE_DATA/wbs.json" | cut -d' ' -f1)
after_rev=$(curl -s http://127.0.0.1:4180/api/health | sed -n 's/.*"revision":\([0-9]*\).*/\1/p')
cat > "$S18/results/live-invariance.json" <<JSON
{
  "audit_lines_before": $before_audit_lines, "audit_lines_after": $after_audit_lines,
  "audit_sha_before": "$before_audit_sha", "audit_sha_after": "$after_audit_sha",
  "wbs_sha_before": "$before_wbs_sha", "wbs_sha_after": "$after_wbs_sha",
  "revision_before": $before_rev, "revision_after": $after_rev,
  "audit_unchanged": $([ "$before_audit_sha" = "$after_audit_sha" ] && echo true || echo false),
  "wbs_unchanged": $([ "$before_wbs_sha" = "$after_wbs_sha" ] && echo true || echo false)
}
JSON
echo "[live-invariance] audit_sha_same=$([ "$before_audit_sha" = "$after_audit_sha" ] && echo true || echo false) wbs_sha_same=$([ "$before_wbs_sha" = "$after_wbs_sha" ] && echo true || echo false) rev=$before_rev->$after_rev"
[ "$before_audit_sha" = "$after_audit_sha" ] && [ "$before_wbs_sha" = "$after_wbs_sha" ] || { echo "FAIL  LIVEB-16 现场浏览改变了 audit.log 或 wbs.json"; exit 3; }
echo "PASS  LIVEB-16 现场只读浏览前后 audit.log 指纹与 wbs.json 指纹均不变（revision $before_rev -> $after_rev）"
exit $RC
