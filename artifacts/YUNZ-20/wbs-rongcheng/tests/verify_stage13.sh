#!/usr/bin/env bash
# YUNZ-33 / 变更包 #5（CH-11 今日摘要只保留 A 列 + CH-12 日报删除「当日变更」sheet）作者自测矩阵 01–07 总入口。
# 浏览器项跑在 playwright Chromium 容器内（宿主 CentOS 7 无法直接跑 Chromium）；
# 导出产物另由宿主 python 侧独立读回（xlsx zip/XML，不依赖 openpyxl）；
# 回归项另跑既有 18 项矩阵、Stage7 / Stage9 / Stage11 矩阵与部署自检。
# 用法：bash tests/verify_stage13.sh [输出目录]
set -uo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$APP_DIR"
OUT="${1:-$APP_DIR/tests/.tmp/stage13}"
rm -rf "$OUT"
mkdir -p "$OUT"

SUMMARY="$OUT/matrix-summary.txt"
: > "$SUMMARY"
FAILED=0

require() {
  local log="$1"; shift
  local miss=0 total=0
  for pattern in "$@"; do
    total=$((total + 1))
    if grep -Fq -- "$pattern" "$log"; then
      echo "OK    $pattern"
    else
      echo "MISS  $pattern"
      miss=$((miss + 1))
    fi
  done
  echo "PASS=$((total - miss)) FAIL=$miss"
  [ "$miss" -eq 0 ]
}
export -f require

run_item() {
  local id="$1" label="$2" cmd="$3"
  local log="$OUT/$id.log"
  {
    echo "=== 自测矩阵 $id · $label ==="
    echo "\$ $cmd"
    echo
  } > "$log"
  bash -c "$cmd" >> "$log" 2>&1
  local rc=$?
  local pass fail
  pass=$(grep -oE 'PASS=[0-9]+' "$log" | tail -1 | cut -d= -f2)
  fail=$(grep -oE 'FAIL=[0-9]+' "$log" | tail -1 | cut -d= -f2)
  if [ "$rc" -eq 0 ]; then
    printf '%-4s %-56s 通过（PASS=%s FAIL=%s）\n' "$id" "$label" "${pass:-?}" "${fail:-0}" | tee -a "$SUMMARY"
  else
    FAILED=1
    printf '%-4s %-56s 失败（PASS=%s FAIL=%s，见 %s）\n' "$id" "$label" "${pass:-?}" "${fail:-?}" "$log" | tee -a "$SUMMARY"
  fi
}

TODAY="$(TZ=Asia/Shanghai date +%F)"
TODAY_COMPACT="$(printf '%s' "$TODAY" | tr -d -)"

echo "YUNZ-33 变更包 #5（CH-11 + CH-12）作者自测开始 $(date -Iseconds)" | tee -a "$SUMMARY"
echo "node: $(node --version 2>&1)  python3: $(python3 --version 2>&1)  docker: $(docker --version 2>&1)  today: $TODAY" | tee -a "$SUMMARY"
echo | tee -a "$SUMMARY"

BROWSER_LOG="$OUT/browser.log"
READBACK_WBS="$OUT/readback-wbs.log"
READBACK_DAILY="$OUT/readback-daily.log"
READBACK_QUIET="$OUT/readback-daily-quiet.log"
BROWSER_OUT="$APP_DIR/tests/.tmp/stage13-out"
rm -rf "$BROWSER_OUT"

echo "--- 准备 A：真实浏览器（Chromium 容器）用例集（日报两 sheet / 摘要仅 A 列 / WBS 不回归 / 409 / 重启） ---" | tee -a "$SUMMARY"
bash tests/stage13/run.sh "$BROWSER_OUT" > "$BROWSER_LOG" 2>&1
BROWSER_RC=$?
echo "浏览器用例集退出码 $BROWSER_RC（完整输出：$BROWSER_LOG）" | tee -a "$SUMMARY"

echo "--- 准备 B：导出产物宿主 python 独立读回（zip/XML，不依赖 openpyxl） ---" | tee -a "$SUMMARY"
python3 tests/stage13/xlsx_readback.py wbs "$BROWSER_OUT/WBS-$TODAY.xlsx" public/template.xlsx "$BROWSER_OUT/wbs-at-export.json" 36 > "$READBACK_WBS" 2>&1
READBACK_WBS_RC=$?
python3 tests/stage13/xlsx_readback.py daily "$BROWSER_OUT/日报-$TODAY_COMPACT.xlsx" "$BROWSER_OUT/daily-at-export.json" > "$READBACK_DAILY" 2>&1
READBACK_DAILY_RC=$?
python3 tests/stage13/quiet_readback.py "$BROWSER_OUT/日报-$TODAY_COMPACT-无事件.xlsx" "$BROWSER_OUT/daily-quiet.json" > "$READBACK_QUIET" 2>&1
READBACK_QUIET_RC=$?
echo "WBS 读回退出码 $READBACK_WBS_RC（$READBACK_WBS） 日报读回退出码 $READBACK_DAILY_RC（$READBACK_DAILY） 无事件读回退出码 $READBACK_QUIET_RC（$READBACK_QUIET）" | tee -a "$SUMMARY"
echo | tee -a "$SUMMARY"

run_item 01 "日报 sheetNames == [\"今日摘要\",\"阻塞与延期\"]（CH-12）" \
  "require '$BROWSER_LOG' 'PASS  矩阵01 日报 sheetNames == ' 'PASS  矩阵01b' && require '$READBACK_DAILY' '日报为单 workbook 两 sheet'"
run_item 02 "今日摘要仅 A 列有值（列数 1 / 无辅助表头）与 A 列宽 + 自动换行（CH-11）" \
  "require '$BROWSER_LOG' 'PASS  矩阵02 今日摘要仅 A 列有值' 'PASS  矩阵02b' && require '$READBACK_DAILY' '「今日摘要」只有 A 列' '「今日摘要」A 列之外无任何值' '「今日摘要」A 列列宽足够' '「今日摘要」单元格套用自动换行样式'"
run_item 03 "摘要文本逐字与 #4 口径一致（@ / 高风险前缀 / 排序 / 五类模板 / 一任务多行 / 无事件兜底）" \
  "require '$BROWSER_LOG' 'PASS  矩阵03a' 'PASS  矩阵03b' 'PASS  矩阵03c' 'PASS  矩阵03d' 'PASS  矩阵03e' && require '$READBACK_DAILY' '「今日摘要」A 列 = /api/daily 的微信检索式文本行' '「今日摘要」逐字 = ' '「今日摘要」按重要度排序' '「今日摘要」同一任务多事件多行' && require '$READBACK_QUIET' '无事件兜底导出仍为两 sheet' '无事件兜底：导出 A 列 = 表头 + 一行兜底文案'"
run_item 04 "旧「当日变更」表头不出现（导出路径已移除）" \
  "require '$BROWSER_LOG' 'PASS  矩阵04 旧「当日变更」表头与「今日摘要」辅助分列表头' && require '$READBACK_DAILY' '日报导出不含「当日变更」sheet' '旧「当日变更」表头与「今日摘要」辅助表头均不出现在任何 sheet' '全部 sheet/workbook 部件无旧「当日变更」表头字样'"
run_item 05 "WBS 导出不回归：五色填充 / A–K 保真 / L–P 五进度列 / Q1 导出日期标签" \
  "require '$BROWSER_LOG' 'PASS  矩阵05a' && require '$READBACK_WBS' 'WBS 第 1/2 行 A–K 与源模板逐字一致' 'WBS A–K 数据区逐字段与 JSON 一致' 'WBS 五进度列数据区状态文字与 JSON 一致' 'WBS 五进度列颜色填充存在且与五色映射一致' '原「导出日期」标签右移到 Q1' 'WBS 导出保留 A1:C1 合并' 'WBS 导出不含旧全局 status'"
run_item 06 "CH-7 identity_added 仍写审计、/api/history 仍返回（导出不再含当日变更 sheet）" \
  "require '$BROWSER_LOG' 'PASS  矩阵06 identity_added 仍写审计' 'PASS  矩阵06b' && require '$READBACK_DAILY' 'CH-7 新增人员审计行仍保留在服务端数据源' '日报导出不含「当日变更」sheet' '日报为单 workbook 两 sheet'"
run_item 07 "保存 / 409 / 重启持久 / 健康探针 / 无外部请求不回归" \
  "require '$BROWSER_LOG' 'PASS  矩阵07a' 'PASS  矩阵07b' 'PASS  矩阵07c' 'PASS  矩阵07d'"
run_item 08 "回归：既有 18 项矩阵（JS/DOM/导出；按当前部署口径跳过容器附加项）" \
  "WBS_SKIP_CONTAINER_ITEMS=1 bash tests/verify.sh '$OUT/legacy-matrix' && grep -F '结论：全部矩阵项通过' '$OUT/legacy-matrix/matrix-summary.txt' && echo 'PASS=1 FAIL=0'"
run_item 09 "回归：Stage7 矩阵 01–14（CH-1…CH-7 真实浏览器深度复跑）" \
  "bash tests/verify_stage7.sh '$OUT/regress-stage7' && grep -F '结论：新增自测矩阵 01–14 全部通过' '$OUT/regress-stage7/matrix-summary.txt' && echo 'PASS=1 FAIL=0'"
run_item 10 "回归：Stage9 矩阵 01–14（CH-8 大尺寸 Markdown 编辑器）" \
  "bash tests/verify_stage9.sh '$OUT/regress-stage9' && grep -F '结论：CH-8 作者自测矩阵 01–14 全部通过' '$OUT/regress-stage9/matrix-summary.txt' && echo 'PASS=1 FAIL=0'"
run_item 11 "回归：Stage11 矩阵 01–14（CH-9 / CH-10 五阶段与日报重构）" \
  "bash tests/verify_stage11.sh '$OUT/regress-stage11' && grep -F '结论：变更包 #4（CH-9 + CH-10）作者自测矩阵 01–14 全部通过' '$OUT/regress-stage11/matrix-summary.txt' && echo 'PASS=1 FAIL=0'"
run_item 12 "部署与镜像自检（BIND_HOST=0.0.0.0 / 双端+公网 health / 无 node_modules / 资源与源码一致 / 新基线 live 冒烟）" \
  "bash tests/stage13/deploy_check.sh"

echo | tee -a "$SUMMARY"
if [ "$FAILED" -eq 0 ]; then
  echo "结论：变更包 #5（CH-11 + CH-12）作者自测矩阵 01–07 与回归项 08–12 全部通过（浏览器用例集 $BROWSER_RC）" | tee -a "$SUMMARY"
else
  echo "结论：存在失败项，见上方与各项日志" | tee -a "$SUMMARY"
fi
echo "输出目录：$OUT" | tee -a "$SUMMARY"
exit "$FAILED"
