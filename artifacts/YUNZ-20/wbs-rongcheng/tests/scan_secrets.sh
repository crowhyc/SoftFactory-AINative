#!/usr/bin/env bash
# 凭据样式扫描（bash/grep 版本，覆盖 node 沙箱看不到的 artifacts 交付目录）。
set -uo pipefail
TARGETS=("${APP_DIR:-/opt/wbs-rongcheng}" /opt/SoftFactory-AINative/artifacts/YUNZ-20)
PATTERN='AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY|(password|passwd|secret|token|api[_-]?key)[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"']{6,}["'"'"']'
hits=0
for target in "${TARGETS[@]}"; do
  [ -d "$target" ] || { echo "SKIP  目录不存在：$target"; continue; }
  found=$(grep -rInE --binary-files=without-match "$PATTERN" "$target" \
    --exclude-dir=node_modules --exclude-dir=.tools --exclude-dir=.tmp --exclude-dir=.git --exclude-dir=state \
    --exclude='*.xlsx' --exclude='xlsx.full.min.js' 2>/dev/null)
  if [ -n "$found" ]; then
    echo "FAIL  命中凭据样式："
    echo "$found"
    hits=$((hits + 1))
  else
    echo "PASS  $target 未发现凭据样式字符串"
  fi
done
echo "---"
if [ "$hits" -eq 0 ]; then echo "PASS=1 FAIL=0"; exit 0; else echo "PASS=0 FAIL=$hits"; exit 1; fi
