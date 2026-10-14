#!/usr/bin/env bash
# YUNZ-20 Stage3 复验 —— 抓取运行态(127.0.0.1:4180)页面资源并与磁盘/输入基线比对。
set -uo pipefail
W=/opt/SoftFactory-AINative/artifacts/YUNZ-20/verification/stage3
S="$W/served"; API=http://127.0.0.1:4180
mkdir -p "$S/vendor"
echo "== 运行态资源抓取开始 $(date -Iseconds) =="
echo "容器: $(docker inspect -f '{{.Config.Image}}|{{.HostConfig.NetworkMode}}' wbs-rongcheng 2>/dev/null)"
FILES="index.html app.js styles.css template.xlsx vendor/xlsx.full.min.js"
for f in $FILES; do
  code=$(curl -sS -o "$S/$f" -w '%{http_code}' "$API/$f")
  printf 'GET /%-28s HTTP %s  %s bytes\n' "$f" "$code" "$(stat -c%s "$S/$f")"
done
echo
printf '%-26s %-66s %s\n' 文件 served_sha256 disk_sha256 一致性
for f in $FILES; do
  a=$(sha256sum "$S/$f" | cut -d' ' -f1); b=$(sha256sum "/opt/wbs-rongcheng/public/$f" | cut -d' ' -f1)
  if [ "$a" = "$b" ]; then same=SAME; else same=DIFF; fi
  printf '%-26s %-66s %s\n' "$f" "$a" "$same"
done
echo
echo "运行态 template.xlsx vs 输入基线 src/public/template.xlsx:"
a=$(sha256sum "$S/template.xlsx" | cut -d' ' -f1)
b=$(sha256sum /opt/wbs-rongcheng-staging/WC-001/src/public/template.xlsx | cut -d' ' -f1)
[ "$a" = "$b" ] && echo "  SAME $a" || echo "  DIFF served=$a staging=$b"
echo "== 抓取结束 $(date -Iseconds) =="
