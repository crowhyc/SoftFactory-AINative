#!/usr/bin/env bash
# YUNZ-38 / Stage18：作者自报核验（**非结论证据**，仅作对照）。
# 独立复算 YUNZ-37 交付评论声明的 sha256、运行目录与源码快照一致性、提交范围。
set -uo pipefail
S18="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP=/opt/wbs-rongcheng
SNAP=/opt/SoftFactory-AINative/artifacts/YUNZ-20/wbs-rongcheng
REPO=/opt/SoftFactory-AINative
PASS=0; FAIL=0
chk() { if [ "$2" = "1" ]; then echo "PASS  $1  :: $3"; PASS=$((PASS+1)); else echo "FAIL  $1  -> $3"; FAIL=$((FAIL+1)); fi; }
declare -A CLAIM=(
  [server.js]=507df43016affbbb430cec31c60c96467a16cb5c105be2f274ca44adf33f52b6
  [public/app.js]=b48cd499da5f0e6145ed6a1d959fad89f222528a320f80da92e155cc98a3f98c
  [public/index.html]=3b762e0d00cbea856723ec4be92f0265c6eafcc2a9c137e3928887e89e8046c2
  [public/styles.css]=2bab8f68c8c84b89df767bac34d89c299911f6c25b1fdc2df32754bd3bc92b77
)
for f in "${!CLAIM[@]}"; do
  got=$(sha256sum "$APP/$f" | cut -d' ' -f1)
  chk "A-${f} 运行目录 sha256 与作者自报一致" "$([ "$got" = "${CLAIM[$f]}" ] && echo 1 || echo 0)" "got=${got:0:16} claim=${CLAIM[$f]:0:16}"
done
diff -rq "$APP/public" "$SNAP/public" >/dev/null 2>&1
chk "A-public 运行目录 public/ 与源码快照逐字一致（diff -rq）" "$([ $? -eq 0 ] && echo 1 || echo 0)" "diff -rq $APP/public $SNAP/public"
cmp -s "$APP/server.js" "$SNAP/server.js"
chk "A-server 运行目录 server.js 与源码快照一致" "$([ $? -eq 0 ] && echo 1 || echo 0)" "cmp server.js"
OO=$(cd "$REPO" && git diff-tree --no-commit-id --name-only -r ab040d8 | grep -v '^artifacts/YUNZ-20/' | wc -l | tr -d ' ')
chk "A-commit 提交 ab040d8 只改 artifacts/YUNZ-20/（范围外 0 文件）" "$([ "$OO" = "0" ] && echo 1 || echo 0)" "out_of_scope=$OO"
PUSHED=$(cd "$REPO" && git rev-parse origin/main 2>/dev/null)
chk "A-push 提交已推送 origin/main" "$(echo "$PUSHED" | grep -q '^ab040d8' && echo 1 || echo 0)" "origin/main=${PUSHED:0:12}"
SU=$(grep -c . "$SNAP/../SHA256SUMS" 2>/dev/null || echo 0)
chk "A-sums SHA256SUMS 已刷新（条目数 >= 700）" "$([ "$SU" -ge 700 ] && echo 1 || echo 0)" "entries=$SU"
echo "[author-claims] PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ] || exit 1
