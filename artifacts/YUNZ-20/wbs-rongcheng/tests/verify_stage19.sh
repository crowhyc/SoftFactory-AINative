#!/usr/bin/env bash
# YUNZ-39 / 变更包 #8（CH-15：全量统计 + 分阶段详情 + 产品验收改名）作者自测矩阵 01–10 总入口。
# 覆盖：真实浏览器（Chromium 容器）全量统计 / 详情面板 / 五色 / 刷新 / 九身份 / 改名 / 导出 / 375px 用例
#       + 宿主服务端口径用例（aggregate 与 phases 两组同源口径、最大余数法、0 行边界）
#       + 既有 18 项 / Stage7 / Stage9 / Stage11 / Stage13 / Stage15 / Stage17 回归
#       + 部署与镜像自检（BIND_HOST=0.0.0.0，含 CH-15 live 冒烟与 live 页面取证）。
# 浏览器项跑在 playwright Chromium 容器内（宿主 CentOS 7 无法直接跑 Chromium）；服务端口径用例跑在宿主 node。
# 前置：容器已按本变更重建（deploy/deploy.sh），否则回归与部署项的资源一致性断言不成立。
# 用法：bash tests/verify_stage19.sh [输出目录]
set -uo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$APP_DIR"
OUT="${1:-$APP_DIR/tests/.tmp/stage19}"
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
    printf '%-4s %-58s 通过（PASS=%s FAIL=%s）\n' "$id" "$label" "${pass:-?}" "${fail:-0}" | tee -a "$SUMMARY"
  else
    FAILED=1
    printf '%-4s %-58s 失败（PASS=%s FAIL=%s，见 %s）\n' "$id" "$label" "${pass:-?}" "${fail:-?}" "$log" | tee -a "$SUMMARY"
  fi
}

TODAY="$(TZ=Asia/Shanghai date +%F)"

echo "YUNZ-39 变更包 #8（CH-15 全量统计 + 分阶段详情 + 产品验收改名）作者自测开始 $(date -Iseconds)" | tee -a "$SUMMARY"
echo "node: $(node --version 2>&1)  python3: $(python3 --version 2>&1)  docker: $(docker --version 2>&1)  today: $TODAY" | tee -a "$SUMMARY"
echo | tee -a "$SUMMARY"

BROWSER_LOG="$OUT/browser.log"
STATS_LOG="$OUT/statcheck.log"
BROWSER_OUT="$APP_DIR/tests/.tmp/stage19-out"
rm -rf "$BROWSER_OUT"

echo "--- 准备 A：真实浏览器（Chromium 容器）用例集（全量统计 / 详情面板 / 五色 / 刷新 / 九身份 / 改名 / 导出 / 375px） ---" | tee -a "$SUMMARY"
bash tests/stage19/run.sh "$BROWSER_OUT" > "$BROWSER_LOG" 2>&1
BROWSER_RC=$?
cp -f "$BROWSER_OUT/browser-results.json" "$OUT/browser-results.json" 2>/dev/null || true
echo "浏览器用例集退出码 $BROWSER_RC（完整输出：$BROWSER_LOG）" | tee -a "$SUMMARY"

echo "--- 准备 B：服务端口径用例集（宿主 node：aggregate / phases 两组同源口径、独立复算、最大余数法、0 行边界） ---" | tee -a "$SUMMARY"
node tests/stage19/statcheck.cjs > "$STATS_LOG" 2>&1
STATS_RC=$?
cp -f "$APP_DIR/tests/.tmp/stage19-stats/statcheck-results.json" "$OUT/statcheck-results.json" 2>/dev/null || true
echo "服务端口径用例集退出码 $STATS_RC（完整输出：$STATS_LOG + $OUT/statcheck-results.json）" | tee -a "$SUMMARY"
echo | tee -a "$SUMMARY"

run_item 01 "顶部只剩一组「全部五阶段合并」全量统计：五阶段合并 count/percentage、五种状态齐显、行内计数合计 = 任务总数 × 5、右侧有「详情」按钮" \
  "require '$BROWSER_LOG' 'PASS  矩阵01a' 'PASS  矩阵01b' 'PASS  矩阵01c'"
run_item 02 "「详情」只读面板：五阶段各自占比、打开/关闭按钮与 Esc、伪响应原样渲染、不影响未保存草稿" \
  "require '$BROWSER_LOG' 'PASS  矩阵02a' 'PASS  矩阵02b' 'PASS  矩阵02c' 'PASS  矩阵02d' 'PASS  矩阵02e' 'PASS  矩阵02f' 'PASS  矩阵02g'"
run_item 03 "隔离数据构造（含 1/1/1 与 0 行边界）：aggregate 与 phases 都与 /api/stats 完全一致，两组结果服务端同源" \
  "require '$STATS_LOG' 'PASS  矩阵01a' 'PASS  矩阵01b' 'PASS  矩阵02a' 'PASS  矩阵02b' 'PASS  矩阵02c' 'PASS  矩阵02d' 'PASS  矩阵02e' 'PASS  矩阵02f' 'PASS  矩阵03a' 'PASS  矩阵03b' 'PASS  矩阵03c' 'PASS  矩阵03d' 'PASS  矩阵03e' 'PASS  矩阵04a' 'PASS  矩阵04b'"
run_item 04 "改名：网页五列头 / 全量·详情标签 / 阶段控件 / 日报文本结论全部改为「产品验收」；JSON 与接口 key 保持 product；A–K 原数据未改写" \
  "require '$BROWSER_LOG' 'PASS  矩阵08a' 'PASS  矩阵08b' 'PASS  矩阵08c' 'PASS  矩阵08d'"
run_item 05 "WBS 导出：L2:P2 显示「产品验收进度」；A–K 与模板首两行保真、五阶段五色、Q1 导出日期标签不回归；不带统计区" \
  "require '$BROWSER_LOG' 'PASS  矩阵08e' 'PASS  矩阵08f' 'PASS  矩阵08g'"
run_item 06 "保存 / 新增 / 删除 / 身份切换后全量与详情实时重算，无陈旧数据；九身份可见；查看不改审计与 revision" \
  "require '$BROWSER_LOG' 'PASS  矩阵05a' 'PASS  矩阵05b' 'PASS  矩阵05c' 'PASS  矩阵05d' 'PASS  矩阵05e' 'PASS  矩阵05f' 'PASS  矩阵05g' 'PASS  矩阵05h' 'PASS  矩阵05i' 'PASS  矩阵05j' 'PASS  矩阵05k' 'PASS  矩阵06a' 'PASS  矩阵06b'"
run_item 07 "桌面 1600px 与 375px：按钮与统计不重叠、不溢出、无横向页面滚动；弹层可滚动且可关闭" \
  "require '$BROWSER_LOG' 'PASS  矩阵07a' 'PASS  矩阵07b' 'PASS  矩阵07c' 'PASS  矩阵07d' 'PASS  矩阵07e' 'PASS  矩阵07f'"
run_item 08 "回归：既有 18 项矩阵 + Stage7 + Stage9 + Stage11 + Stage13 + Stage15 + Stage17（CH-1…CH-14、409 / 重启 / 审计 / WBS 导出 / 日报弹层 / Markdown 编辑器）" \
  "WBS_SKIP_CONTAINER_ITEMS=1 bash tests/verify.sh '$OUT/regress-legacy' && grep -F '结论：全部矩阵项通过' '$OUT/regress-legacy/matrix-summary.txt' && bash tests/verify_stage7.sh '$OUT/regress-stage7' && grep -F '结论：新增自测矩阵 01–14 全部通过' '$OUT/regress-stage7/matrix-summary.txt' && bash tests/verify_stage9.sh '$OUT/regress-stage9' && grep -F '结论：CH-8 作者自测矩阵 01–14 全部通过' '$OUT/regress-stage9/matrix-summary.txt' && bash tests/verify_stage11.sh '$OUT/regress-stage11' && grep -F '结论：变更包 #4（CH-9 + CH-10）作者自测矩阵 01–14 全部通过' '$OUT/regress-stage11/matrix-summary.txt' && bash tests/verify_stage13.sh '$OUT/regress-stage13' && grep -F '结论：变更包 #5（CH-11 + CH-12' '$OUT/regress-stage13/matrix-summary.txt' && bash tests/verify_stage15.sh '$OUT/regress-stage15' && grep -F '结论：变更包 #6（CH-13 日报改为可复制关键信息文本弹层）作者自测矩阵 01–10 全部通过' '$OUT/regress-stage15/matrix-summary.txt' && mkdir -p '$OUT/regress-stage17' && bash tests/stage17/run.sh '$OUT/regress-stage17/browser' > '$OUT/regress-stage17/browser.log' 2>&1 && grep -F 'FAIL=0' '$OUT/regress-stage17/browser.log' && node tests/stage17/statcheck.cjs > '$OUT/regress-stage17/statcheck.log' 2>&1 && grep -F 'FAIL=0' '$OUT/regress-stage17/statcheck.log' && echo 'PASS=7 FAIL=0'"
run_item 09 "部署与镜像自检（BIND_HOST=0.0.0.0 / 本机+0.0.0.0+公网三端 health / 无 node_modules / 资源与源码 sha256 一致 / CH-15 live 冒烟与 live 页面取证）" \
  "bash tests/stage19/deploy_check.sh"
run_item 10 "页面全程无外部请求、详情与统计交互 0 次新增下载、无 pageerror；/api/stats 不构成下载路径" \
  "require '$BROWSER_LOG' 'PASS  矩阵10a' 'PASS  矩阵10b' && require '$STATS_LOG' 'PASS  矩阵10b' && echo 'PASS=3 FAIL=0'"

echo | tee -a "$SUMMARY"
if [ "$FAILED" -eq 0 ]; then
  echo "结论：变更包 #8（CH-15 全量统计 + 分阶段详情 + 产品验收改名）作者自测矩阵 01–10 全部通过（浏览器用例集 $BROWSER_RC / 服务端口径用例集 $STATS_RC）" | tee -a "$SUMMARY"
else
  echo "结论：存在失败项，见上方与各项日志" | tee -a "$SUMMARY"
fi
echo "输出目录：$OUT" | tee -a "$SUMMARY"
exit "$FAILED"
