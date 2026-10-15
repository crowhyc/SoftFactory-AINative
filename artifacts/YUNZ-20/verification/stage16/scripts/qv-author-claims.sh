#!/usr/bin/env bash
# YUNZ-36 / Stage16：作者自报核验（独立复算，不作为结论证据，只用于证明自报链真实）。
# 复核 Stage15 交付评论里的 4 个 sha256、运行目录 / 快照一致性、自测目录存在、提交范围。
set -uo pipefail
S16="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN=/opt/wbs-rongcheng
SNAP=/opt/SoftFactory-AINative/artifacts/YUNZ-20/wbs-rongcheng
SELF=/opt/SoftFactory-AINative/artifacts/YUNZ-20/selftest/stage15
REPO=/opt/SoftFactory-AINative
P=0; F=0
ck() { if [ "$2" = "1" ]; then echo "PASS  $1"; P=$((P+1)); else echo "FAIL  $1  :: $3"; F=$((F+1)); fi; }

declare -A CLAIM=(
  [server.js]=81adc14b91125ea07c27d152953296e1265ac4fc36cfc3e6f0af134546c7cb54
  [public/app.js]=33e897a2a83bf8451857848723085d140deaa771d66fb9ae434117153140ee24
  [public/index.html]=70cbd82be5ebd9cfcf776db63f2d0d39bc1b304a8025214c3431ce660c10043a
  [public/styles.css]=eaf8f102a80d63eb644d8b155bd3561dac72b592c038d835e34aa0669e106087
)
echo "--- 自报 sha256 独立复算 ---"
for f in "${!CLAIM[@]}"; do
  A=$(sha256sum "$RUN/$f" | awk '{print $1}')
  B=$(sha256sum "$SNAP/$f" | awk '{print $1}')
  ck "A-claim $f == 自报值（运行目录）" "$([ "$A" = "${CLAIM[$f]}" ] && echo 1 || echo 0)" "got=$A want=${CLAIM[$f]}"
  ck "A-claim $f 运行目录 == 源码快照" "$([ "$A" = "$B" ] && echo 1 || echo 0)" "run=$A snap=$B"
done

echo "--- 交付目录与自测证据 ---"
ck "A-01 自测目录 artifacts/YUNZ-20/selftest/stage15 存在且含 README + 01..10.log" \
   "$([ -f "$SELF/README.md" ] && [ -f "$SELF/10.log" ] && [ -f "$SELF/01.log" ] && echo 1 || echo 0)" "$SELF"
ck "A-02 运行目录 public/ 与源码快照逐字一致（diff -rq）" \
   "$(diff -rq "$RUN/public" "$SNAP/public" >/dev/null 2>&1 && echo 1 || echo 0)" "diff -rq $RUN/public $SNAP/public"

echo "--- 提交范围 ---"
cd "$REPO"
A3=$(git diff-tree --no-commit-id --name-only -r b25996c | grep -v '^artifacts/YUNZ-20/' | grep -v '^$' | wc -l)
ck "A-03 提交 b25996c 只改 artifacts/YUNZ-20（范围外文件数 0）" "$([ "$A3" = "0" ] && echo 1 || echo 0)" "outside=$A3"
ck "A-04 提交 b25996c 存在（变更包 #6 实现与自测）" "$(git cat-file -e b25996c 2>/dev/null && echo 1 || echo 0)" ""
G=$(git show b25996c:artifacts/YUNZ-20/SHA256SUMS 2>/dev/null | grep -c 'selftest/stage15')
ck "A-05 提交内 SHA256SUMS 含 stage15 条目（>=10）" "$([ "$G" -ge 10 ] && echo 1 || echo 0)" "entries=$G"

echo
echo "[author-claims] PASS=$P FAIL=$F"
[ "$F" = "0" ] || exit 1
