#!/usr/bin/env bash
# YUNZ-33 / 变更包 #5（CH-11 今日摘要只保留 A 列 + CH-12 日报删除「当日变更」sheet）作者自测矩阵 01–07 总入口。
# CH-13 同步（YUNZ-35 / 变更包 #6）：日报不再产出 xlsx，改为「一键可复制关键信息文本」弹层；
# 本套件编码日报 xlsx 的条目（01–04 / 06）已按 CH-13 契约同步为弹层文本断言，断言强度未降低。
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
BROWSER_OUT="$APP_DIR/tests/.tmp/stage13-out"
rm -rf "$BROWSER_OUT"

echo "--- 准备 A：真实浏览器（Chromium 容器）用例集（日报文本弹层 / WBS 不回归 / 409 / 重启） ---" | tee -a "$SUMMARY"
bash tests/stage13/run.sh "$BROWSER_OUT" > "$BROWSER_LOG" 2>&1
BROWSER_RC=$?
echo "浏览器用例集退出码 $BROWSER_RC（完整输出：$BROWSER_LOG）" | tee -a "$SUMMARY"

echo "--- 准备 B：导出产物宿主 python 独立读回（zip/XML，不依赖 openpyxl） ---" | tee -a "$SUMMARY"
python3 tests/stage13/xlsx_readback.py wbs "$BROWSER_OUT/WBS-$TODAY.xlsx" public/template.xlsx "$BROWSER_OUT/wbs-at-export.json" 36 > "$READBACK_WBS" 2>&1
READBACK_WBS_RC=$?
echo "WBS 读回退出码 $READBACK_WBS_RC（$READBACK_WBS） 日报已改为弹层文本（CH-13）：无日报 xlsx 读回，弹层文本断言在浏览器侧逐字比对 /api/daily.text" | tee -a "$SUMMARY"
echo | tee -a "$SUMMARY"

run_item 01 "日报弹层（CH-13）：点「导出日报」打开只读文本弹层（role=dialog / 复制 + 关闭），且不再产出与下载日报 xlsx" \
  "require '$BROWSER_LOG' 'PASS  矩阵01 点「导出日报」打开只读文本弹层'"
run_item 02 "弹层文本 = /api/daily 的关键信息文本（同一份字符串）；概况行「今日延期 X 项 / 阻塞 Y 项」计数与事件行数一致，且只体现阻塞与延期" \
  "require '$BROWSER_LOG' 'PASS  矩阵01b 弹层只读文本块内容' 'PASS  矩阵02 顶部概况行固定为' 'PASS  矩阵02b 日报只体现阻塞、延期'"
run_item 03 "事件行逐字模板（含 @ 与高风险前缀）/ 延期在前阻塞在后 / 派生到期未更新与当天已更新不重复判定 / 无事件兜底" \
  "require '$BROWSER_LOG' 'PASS  矩阵03a 事件行逐字' 'PASS  矩阵03b 延期条目在前' 'PASS  矩阵03c 派生规则' 'PASS  矩阵03d 当天已更新过的阶段' 'PASS  矩阵03e 无事件兜底'"
run_item 04 "弹层文本不残留旧日报口径字样（当日变更 / 改动字段 / 旧值 / 新值 / 操作身份 / 重要度 / 依据）" \
  "require '$BROWSER_LOG' 'PASS  矩阵04 弹层文本不残留旧日报口径字样'"
run_item 05 "WBS 导出不回归：五色填充 / A–K 保真 / L–P 五进度列 / Q1 导出日期标签" \
  "require '$BROWSER_LOG' 'PASS  矩阵05a' && require '$READBACK_WBS' 'WBS 第 1/2 行 A–K 与源模板逐字一致' 'WBS A–K 数据区逐字段与 JSON 一致' 'WBS 五进度列数据区状态文字与 JSON 一致' 'WBS 五进度列颜色填充存在且与五色映射一致' '原「导出日期」标签右移到 Q1' 'WBS 导出保留 A1:C1 合并' 'WBS 导出不含旧全局 status'"
run_item 06 "CH-7 identity_added 仍写审计、/api/history 与 /api/daily 数据源仍返回（CH-13 起只留在服务端、不进日报文本）" \
  "require '$BROWSER_LOG' 'PASS  矩阵06 identity_added 仍写审计' 'PASS  矩阵06b 当天含 identity_added 审计时'"
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
  echo "结论：变更包 #5（CH-11 + CH-12，日报口径已由 CH-13 同步为文本弹层）作者自测矩阵 01–07 与回归项 08–12 全部通过（浏览器用例集 $BROWSER_RC）" | tee -a "$SUMMARY"
else
  echo "结论：存在失败项，见上方与各项日志" | tee -a "$SUMMARY"
fi
echo "输出目录：$OUT" | tee -a "$SUMMARY"
exit "$FAILED"
