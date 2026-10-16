#!/usr/bin/env bash
# YUNZ-40 / Stage20：作者自报核验（第二条证据链的对照材料，不是本轮结论证据）。
# 只核对「自报的哈希 / 产物位置 / 自测输出是否存在且 0 FAIL / 现场数值」，不替作者复跑其脚本。
set -uo pipefail
S20="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${APP_DIR:-/opt/wbs-rongcheng}"
ST19="/opt/SoftFactory-AINative/artifacts/YUNZ-20/selftest/stage19"
PASS=0; FAIL=0
ck() { if [ "$1" = ok ]; then PASS=$((PASS+1)); echo "PASS  $2${3:+  :: $3}"; else FAIL=$((FAIL+1)); echo "FAIL  $2${3:+  -> $3}"; fi; }

declare -A CLAIM=(
  ["server.js"]="807f7624c5f06551650a3a04a337f51bb20248c9c51a5325f383f6bccfe7323c"
  ["public/app.js"]="02b940727e3fdabae8e21824eb3eea2784c63fbb87f08aa86bd5bd5b6b319960"
  ["public/index.html"]="a1b1c035904cad72f0698dce0b16879e5f13fd788da3b16ef05643a28adb0cd7"
  ["public/styles.css"]="094674194747680bf38540509bc4317f3f79ff29a149ec82e04969073483fb6e"
)
for f in "${!CLAIM[@]}"; do
  a="$(sha256sum "$APP/$f" | awk '{print $1}')"
  [ "$a" = "${CLAIM[$f]}" ] && ck ok "10/作者自报 $f sha256 与实测一致" "${a:0:16}…" || ck bad "10/作者自报 $f sha256" "自报=${CLAIM[$f]:0:16}… 实测=${a:0:16}…"
done

for name in README.md 01.log 02.log 03.log 04.log 05.log 06.log 07.log 08.log 09.log 10.log matrix-summary.txt; do
  [ -s "$ST19/$name" ] && ck ok "10/作者自测产物存在 $name" "$(wc -c < "$ST19/$name") 字节" || ck bad "10/作者自测产物缺失 $name" "$ST19/$name"
done
ls -d "$ST19/browser" "$ST19/live" >/dev/null 2>&1 && ck ok "10/作者自测 browser/ 与 live/ 子目录存在" "$(ls "$ST19/browser" | wc -l) / $(ls "$ST19/live" | wc -l) 文件" || ck bad "10/browser 或 live 子目录缺失" ""

AF=$(grep -hE '^FAIL' "$ST19"/*.log 2>/dev/null | wc -l)
AP=$(grep -hE '^PASS' "$ST19"/*.log 2>/dev/null | wc -l)
[ "$AF" -eq 0 ] && [ "$AP" -gt 0 ] && ck ok "10/作者自测日志 0 FAIL，PASS 行数 $AP" "（自报，非本任务证据）" || ck bad "10/作者自测日志存在 FAIL" "PASS=$AP FAIL=$AF"

for name in verify_stage19.sh stage19/run.sh stage19/browser.cjs stage19/statcheck.cjs stage19/deploy_check.sh; do
  [ -s "$APP/tests/$name" ] && ck ok "10/作者自测脚本存在 tests/$name" || ck bad "10/作者自测脚本缺失 tests/$name" ""
done

LIVE="$(curl -s -m 5 http://127.0.0.1:4180/api/stats)"
TOTAL="$(echo "$LIVE" | grep -o '"total":[0-9]*' | head -1 | cut -d: -f2)"
DEN="$(echo "$LIVE" | grep -o '"denominator":[0-9]*' | head -1 | cut -d: -f2)"
REV="$(curl -s -m 5 http://127.0.0.1:4180/api/health | grep -o '"revision":[0-9]*' | cut -d: -f2)"
ck ok "10/现场实测（作者自报 live total=34 / denominator=170 / revision=15）" "total=$TOTAL denominator=$DEN revision=$REV"
[ "$TOTAL" = "34" ] && [ "$DEN" = "170" ] && ck ok "10/自报现场数值与实测一致" "" || ck bad "10/自报现场数值与实测不一致" "total=$TOTAL denominator=$DEN"

echo "PASS=$PASS FAIL=$FAIL"
