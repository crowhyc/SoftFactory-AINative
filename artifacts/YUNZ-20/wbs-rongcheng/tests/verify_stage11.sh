#!/usr/bin/env bash
# YUNZ-31 / 变更包 #4（CH-9 隐藏演示范围列 + CH-10 五阶段独立进度 / WBS 与日报导出重构）作者自测矩阵 01–11 总入口。
# 浏览器项跑在 playwright Chromium 容器内（宿主 CentOS 7 无法直接跑 Chromium），服务端项用 Node 标准库脚本；
# 导出产物另由宿主 python 侧独立读回（xlsx zip/XML，不依赖 openpyxl）；回归项另跑既有 18 项矩阵、Stage7 矩阵 01–14 与部署自检。
# 用法：bash tests/verify_stage11.sh [输出目录]
set -uo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$APP_DIR"
OUT="${1:-$APP_DIR/tests/.tmp/stage11}"
rm -rf "$OUT"
mkdir -p "$OUT"

SUMMARY="$OUT/matrix-summary.txt"
: > "$SUMMARY"
FAILED=0

# require <log> <必须出现的输出片段...>：逐条确认关键证据已落日志，并汇总 PASS/FAIL。
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

echo "YUNZ-31 变更包 #4（CH-9 + CH-10）作者自测开始 $(date -Iseconds)" | tee -a "$SUMMARY"
echo "node: $(node --version 2>&1)  python3: $(python3 --version 2>&1)  docker: $(docker --version 2>&1)  today: $TODAY" | tee -a "$SUMMARY"
echo | tee -a "$SUMMARY"

BROWSER_LOG="$OUT/browser.log"
SERVER_LOG="$OUT/server.log"
READBACK_WBS="$OUT/readback-wbs.log"
READBACK_DAILY="$OUT/readback-daily.log"
BROWSER_OUT="$APP_DIR/tests/.tmp/stage11-out"
rm -rf "$BROWSER_OUT"

echo "--- 准备 A：真实浏览器（Chromium 容器）用例集（迁移边界 + 五阶段 + 日报/WBS 导出） ---" | tee -a "$SUMMARY"
bash tests/stage11/run.sh "$BROWSER_OUT" > "$BROWSER_LOG" 2>&1
BROWSER_RC=$?
echo "浏览器用例集退出码 $BROWSER_RC（完整输出：$BROWSER_LOG）" | tee -a "$SUMMARY"

echo "--- 准备 B：服务端迁移 / 派生规则 / 审计用例集 ---" | tee -a "$SUMMARY"
node tests/stage11_server_check.js > "$SERVER_LOG" 2>&1
SERVER_RC=$?
echo "服务端用例集退出码 $SERVER_RC（完整输出：$SERVER_LOG）" | tee -a "$SUMMARY"

echo "--- 准备 C：导出产物宿主 python 独立读回（zip/XML，不依赖 openpyxl） ---" | tee -a "$SUMMARY"
WBS_ROWS="$(python3 -c "import json,sys;print(len(json.load(open(sys.argv[1]))['tasks']))" "$BROWSER_OUT/wbs-at-export.json" 2>/dev/null || echo 36)"
python3 tests/stage11/xlsx_readback.py wbs "$BROWSER_OUT/WBS-$TODAY.xlsx" public/template.xlsx "$BROWSER_OUT/wbs-at-export.json" "$WBS_ROWS" > "$READBACK_WBS" 2>&1
READBACK_WBS_RC=$?
python3 tests/stage11/xlsx_readback.py daily "$BROWSER_OUT/日报-$TODAY_COMPACT.xlsx" "$BROWSER_OUT/daily-at-export.json" > "$READBACK_DAILY" 2>&1
READBACK_DAILY_RC=$?
echo "WBS 读回退出码 $READBACK_WBS_RC（$READBACK_WBS） 日报读回退出码 $READBACK_DAILY_RC（$READBACK_DAILY）" | tee -a "$SUMMARY"
echo | tee -a "$SUMMARY"

run_item 01 "五阶段下拉常显与五色映射（灰/蓝/绿/红/黄；含 option 颜色）" \
  "require '$BROWSER_LOG' 'PASS  矩阵01a' 'PASS  矩阵01b' 'PASS  矩阵01c' 'PASS  矩阵01d'"
run_item 02 "普通负责人 / PM 权限边界与只读提示" \
  "require '$BROWSER_LOG' 'PASS  矩阵02a' 'PASS  矩阵02b' 'PASS  矩阵02c'"
run_item 03 "页 / API / 磁盘三端一致（含刷新持久）" \
  "require '$BROWSER_LOG' 'PASS  矩阵03 阶段状态改动' 'PASS  矩阵03b'"
run_item 04 "迁移一次性执行、时间戳备份可回滚、不重复迁移（不污染日报）" \
  "require '$BROWSER_LOG' 'PASS  矩阵04a' 'PASS  矩阵04b' 'PASS  矩阵04c' && require '$SERVER_LOG' 'PASS  矩阵04a' 'PASS  矩阵04b' 'PASS  矩阵04c' 'PASS  矩阵04d'"
run_item 05 "恰好边界（今天 / 昨天 / 缺失）迁移结果" \
  "require '$BROWSER_LOG' 'PASS  矩阵05 迁移边界' && require '$SERVER_LOG' 'PASS  矩阵05 迁移边界'"
run_item 06 "保存与 409（阶段状态字段级 audit + 并发非覆盖 + 非法枚举 400）" \
  "require '$BROWSER_LOG' 'PASS  矩阵06 并发保存 409' && require '$SERVER_LOG' 'PASS  矩阵06a' 'PASS  矩阵06b' 'PASS  矩阵06c'"
run_item 07 "WBS 导出：A–K 保真 + 五进度列文字与颜色读回 + 导出日期标签右移到 Q1" \
  "require '$BROWSER_LOG' 'PASS  矩阵07a' 'PASS  矩阵07b' && require '$READBACK_WBS' 'WBS A–K 数据区逐字段与 JSON 一致' 'WBS 五进度列数据区状态文字与 JSON 一致' 'WBS 五进度列颜色填充存在' '原「导出日期」标签右移到 Q1' 'WBS 导出保留 A1:C1 合并' 'WBS 导出不含旧全局 status'"
run_item 08 "今日摘要格式逐字断言（含 @ 与风险前缀）与重要度排序；仅 A 列（CH-11 分列已删）" \
  "require '$BROWSER_LOG' 'PASS  矩阵08a' 'PASS  矩阵08b' 'PASS  矩阵08c' 'PASS  矩阵08d' && require '$SERVER_LOG' 'PASS  矩阵08' && require '$READBACK_DAILY' '「今日摘要」只有 A 列' '「今日摘要」逐字 = ' '「今日摘要」按重要度排序'"
run_item 09 "到期未更新判定 与「当天已更新则不判定」两条构造用例" \
  "require '$BROWSER_LOG' 'PASS  矩阵09a' 'PASS  矩阵09b' && require '$SERVER_LOG' 'PASS  矩阵09a' 'PASS  矩阵09b'"
run_item 10 "日报两 sheet（CH-12 删除当日变更）与 CH-7 新增人员审计（保留在服务端数据源）" \
  "require '$BROWSER_LOG' 'PASS  矩阵10a' 'PASS  矩阵10b' 'PASS  矩阵10c' && require '$READBACK_DAILY' '日报为单 workbook 两 sheet' '「阻塞与延期」保留 A–K 与 是否演示范围' '日报导出不含「当日变更」sheet' '旧「当日变更」表头与「今日摘要」辅助表头均不出现在任何 sheet' 'CH-7 新增人员审计行仍保留在服务端数据源'"
run_item 11 "回归：CH-1…CH-8（含 CH-9/CH-10）/ D-3 / 验收 1–10 / Markdown / 重启持久 / 无外部请求" \
  "require '$BROWSER_LOG' 'PASS  矩阵11a' 'PASS  矩阵11b' 'PASS  矩阵11c' 'PASS  矩阵11d' 'PASS  矩阵11e' 'PASS  矩阵11f' 'PASS  矩阵11g' 'PASS  矩阵11h' 'PASS  矩阵11i' 'PASS  矩阵11j' && require '$SERVER_LOG' 'PASS  矩阵10b 旧 status 保留原值但不被日报引用' 'PASS  矩阵07（前置）CH-9'"
run_item 12 "既有 18 项矩阵回归（JS/DOM/导出；按当前部署口径跳过容器附加项）" \
  "WBS_SKIP_CONTAINER_ITEMS=1 bash tests/verify.sh '$OUT/legacy-matrix' && grep -F '结论：全部矩阵项通过' '$OUT/legacy-matrix/matrix-summary.txt' && echo 'PASS=1 FAIL=0'"
run_item 13 "Stage7 矩阵 01–14 回归（CH-1…CH-7 真实浏览器深度复跑）" \
  "bash tests/verify_stage7.sh '$OUT/regress-stage7' && grep -F '结论：新增自测矩阵 01–14 全部通过' '$OUT/regress-stage7/matrix-summary.txt' && echo 'PASS=1 FAIL=0'"
run_item 14 "部署与镜像自检（BIND_HOST=0.0.0.0 / 双端+公网 health / 无 node_modules / 资源与源码一致 / 新基线 live 冒烟）" \
  "bash tests/stage11/deploy_check.sh"

echo | tee -a "$SUMMARY"
if [ "$FAILED" -eq 0 ]; then
  echo "结论：变更包 #4（CH-9 + CH-10）作者自测矩阵 01–14 全部通过（浏览器用例集 $BROWSER_RC / 服务端用例集 $SERVER_RC）" | tee -a "$SUMMARY"
else
  echo "结论：存在失败项，见上方与各项日志" | tee -a "$SUMMARY"
fi
echo "输出目录：$OUT" | tee -a "$SUMMARY"
exit "$FAILED"
