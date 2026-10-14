#!/usr/bin/env bash
# YUNZ-20 Stage3 复验 —— 交付三链一致性：磁盘 sha256 / 目录 SHA256SUMS / 资产库 git HEAD blob。
# 用 bash + sha256sum + git（避免 python3.6 在 ascii 文件系统编码下无法处理中文文件名）。
set -uo pipefail
ART=/opt/SoftFactory-AINative/artifacts/YUNZ-20
SNAP="$ART/wbs-rongcheng"; LIVE=/opt/wbs-rongcheng
REPO=/opt/SoftFactory-AINative; REL=artifacts/YUNZ-20
fails=0
chk(){ if [ "$3" = 0 ]; then echo "[PASS] $1 $2 :: $4"; else echo "[FAIL] $1 $2 :: $4"; fails=$((fails+1)); fi; }

# I1 SHA256SUMS 自校验
cd "$ART" || exit 9
out=$(sha256sum -c SHA256SUMS 2>&1); ok=$(printf '%s\n' "$out" | grep -c ': OK')
tot=$(grep -c . SHA256SUMS)
printf '%s\n' "$out" | grep -v ': OK' | head -5
r=1; [ "$ok" = "$tot" ] && [ "$tot" -ge 60 ] && ! printf '%s\n' "$out" | grep -q FAILED && r=0
chk I1 "目录 SHA256SUMS 逐条自校验" $r "条目=$tot OK=$ok"

# I2 运行产物（磁盘源码）与交付快照逐字一致
mism=(); missing=()
while IFS= read -r rel; do
  if [ ! -f "$LIVE/$rel" ]; then missing+=("$rel"); continue; fi
  cmp -s "$SNAP/$rel" "$LIVE/$rel" || mism+=("$rel")
done < <(cd "$SNAP" && find . -type f | sed 's|^\./||' | sort)
n=$(cd "$SNAP" && find . -type f | wc -l)
r=1; [ ${#mism[@]} -eq 0 ] && [ ${#missing[@]} -eq 0 ] && r=0
chk I2 "运行产物 /opt/wbs-rongcheng 交付源码与快照 artifacts/YUNZ-20/wbs-rongcheng 逐字一致" $r \
  "snapshotFiles=$n mismatch=${mism[*]:-无} missingInLive=${missing[*]:-无}"

# I3 SHA256SUMS 记录 = 磁盘实际 = git HEAD blob
bad=0; checked=0; detail=""
while read -r h rel; do
  [ -z "${rel:-}" ] && continue
  checked=$((checked+1))
  d=$(sha256sum "$ART/$rel" 2>/dev/null | cut -d' ' -f1)
  g=$( (cd "$REPO" && git show "HEAD:$REL/$rel" 2>/dev/null) | sha256sum | cut -d' ' -f1)
  if [ "$h" != "$d" ] || [ "$h" != "$g" ]; then
    bad=$((bad+1)); detail="$detail $rel(rec=${h:0:8},disk=${d:0:8},git=${g:0:8})"
  fi
done < SHA256SUMS
r=1; [ "$bad" = 0 ] && [ "$checked" -ge 60 ] && r=0
chk I3 "SHA256SUMS 记录的 sha256 = 磁盘实际 = git HEAD blob（三链一致）" $r "checked=$checked mismatch=$bad$detail"

# I4 已提交且已推送
head=$(cd "$REPO" && git rev-parse HEAD); remote=$(cd "$REPO" && git rev-parse origin/main 2>/dev/null)
last=$(cd "$REPO" && git log -1 --format='%H %s' -- "$REL")
r=1; [ "$head" = "$remote" ] && echo "$last" | grep -q 'task(YUNZ-20)' && r=0
chk I4 "交付目录已提交并推送（HEAD == origin/main，提交信息 task(YUNZ-20)）" $r \
  "HEAD=${head:0:12} origin/main=${remote:0:12} last=$last"

# I5 修复提交范围（只动交付目录，未动 server.js / deploy / 数据契约）
scope=$(cd "$REPO" && git -c core.quotepath=false diff --name-only 3551f78 e9e844e | tr '\n' ' ')
outside=$(cd "$REPO" && git -c core.quotepath=false diff --name-only 3551f78 e9e844e | grep -cv "^\"\?$REL/" || true)
server_changed=$(cd "$REPO" && git -c core.quotepath=false diff --name-only 3551f78 e9e844e | grep -c 'server.js\|deploy/' || true)
r=1; [ "${outside:-1}" = 0 ] && [ "${server_changed:-1}" = 0 ] && r=0
chk I5 "修复提交 e9e844e 仅改动交付目录，未触及 server.js/deploy（回归面收窄）" $r \
  "changed=$scope"

# I6 交付源码快照无凭据样式字符串（独立正则，排除 vendor 二进制与测试工具目录）
hits=$(grep -rInE 'AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY|(password|passwd|secret|token|api[_-]?key)[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"']{6,}["'"'"']' \
  --exclude='*.xlsx' --exclude='xlsx.full.min.js' --exclude-dir='.tools' --exclude-dir='.tmp' --exclude-dir='state' "$SNAP" 2>/dev/null | head -5)
r=1; [ -z "$hits" ] && r=0
chk I6 "交付源码快照无凭据样式字符串（独立正则）" $r "hits=${hits:-无}"

# I7 复跑作者 tests/scan_secrets.sh
auc=$(bash /opt/wbs-rongcheng/tests/scan_secrets.sh 2>&1); arc=$?
r=1; [ "$arc" = 0 ] && r=0
chk I7 "复跑作者 tests/scan_secrets.sh 亦判定无凭据" $r "exit=$arc out=$(printf '%s' "$auc" | tr '\n' '|' | cut -c1-200)"

echo "== 汇总: $([ $fails = 0 ] && echo 全部通过 || echo "FAIL $fails 项") =="
exit $([ $fails = 0 ] && echo 0 || echo 1)
