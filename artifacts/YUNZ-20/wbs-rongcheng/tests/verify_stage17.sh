#!/usr/bin/env bash
# YUNZ-37 / 变更包 #7（CH-14：各阶段状态「数量 + 占比」总览 + 只读 GET /api/stats）作者自测矩阵 01–10 总入口。
# 覆盖：真实浏览器（Chromium 容器）总览/五色/刷新/九身份/375px 用例 + 宿主服务端口径用例
#       + 既有 18 项 / Stage7 / Stage9 / Stage11 / Stage13 / Stage15 回归
#       + 部署与镜像自检（BIND_HOST=0.0.0.0，含 CH-14 live 冒烟）。
# 浏览器项跑在 playwright Chromium 容器内（宿主 CentOS 7 无法直接跑 Chromium）；服务端口径用例跑在宿主 node。
# 前置：容器已按本变更重建（deploy/deploy.sh），否则回归与部署项的资源一致性断言不成立。
# 用法：bash tests/verify_stage17.sh [输出目录]
set -uo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$APP_DIR"
OUT="${1:-$APP_DIR/tests/.tmp/stage17}"
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

echo "YUNZ-37 变更包 #7（CH-14 阶段状态占比总览 + GET /api/stats）作者自测开始 $(date -Iseconds)" | tee -a "$SUMMARY"
echo "node: $(node --version 2>&1)  python3: $(python3 --version 2>&1)  docker: $(docker --version 2>&1)  today: $TODAY" | tee -a "$SUMMARY"
echo | tee -a "$SUMMARY"

BROWSER_LOG="$OUT/browser.log"
STATS_LOG="$OUT/statcheck.log"
BROWSER_OUT="$APP_DIR/tests/.tmp/stage17-out"
rm -rf "$BROWSER_OUT"

echo "--- 准备 A：真实浏览器（Chromium 容器）用例集（总览条 / 五色 / 刷新 / 九身份 / 375px / 下载与外部请求） ---" | tee -a "$SUMMARY"
bash tests/stage17/run.sh "$BROWSER_OUT" > "$BROWSER_LOG" 2>&1
BROWSER_RC=$?
echo "浏览器用例集退出码 $BROWSER_RC（完整输出：$BROWSER_LOG）" | tee -a "$SUMMARY"

echo "--- 准备 B：服务端口径用例集（宿主 node：结构 / 独立复算 / 最大余数法 / 0 行边界 / 只读语义） ---" | tee -a "$SUMMARY"
node tests/stage17/statcheck.cjs > "$STATS_LOG" 2>&1
STATS_RC=$?
cp -f "$APP_DIR/tests/.tmp/stage17-stats/statcheck-results.json" "$OUT/statcheck-results.json" 2>/dev/null || true
echo "服务端口径用例集退出码 $STATS_RC（完整输出：$STATS_LOG + $OUT/statcheck-results.json）" | tee -a "$SUMMARY"
echo | tee -a "$SUMMARY"

run_item 01 "顶部总览条可见：五阶段各自独立一组、每行五项状态徽标，无跨阶段合并行、无手动刷新按钮" \
  "require '$BROWSER_LOG' 'PASS  矩阵01a' 'PASS  矩阵01b' 'PASS  矩阵01c'"
run_item 02 "count / percentage 与 /api/stats 完全一致（多组不同状态组合）；前端原样渲染、不自行统计、不二次四舍五入" \
  "require '$BROWSER_LOG' 'PASS  矩阵02a' 'PASS  矩阵02b' && require '$STATS_LOG' 'PASS  矩阵02a' 'PASS  矩阵02b' 'PASS  矩阵02c' 'PASS  矩阵02d' 'PASS  矩阵02e' 'PASS  矩阵02f'"
run_item 03 "完整体边界：0 行不除零、五项合计恰为 100.0%（最大余数法 33.4 / 33.3 / 33.3）、脏数据不臆造占比" \
  "require '$STATS_LOG' 'PASS  矩阵03a' 'PASS  矩阵03b' 'PASS  矩阵03c'"
run_item 04 "五种状态颜色与表格阶段控件完全一致（且等于五色映射）；0 项仍显示「0 0.0%」" \
  "require '$BROWSER_LOG' 'PASS  矩阵04a' 'PASS  矩阵04b'"
run_item 05 "保存 / 新增 / 删除 / 身份切换后总览实时重算刷新，无陈旧数据；本地草稿不改动服务端口径" \
  "require '$BROWSER_LOG' 'PASS  矩阵05a' 'PASS  矩阵05b' 'PASS  矩阵05c' 'PASS  矩阵05d' 'PASS  矩阵05e' 'PASS  矩阵05f' 'PASS  矩阵05g'"
run_item 06 "九个身份都能看到只读总览；权限矩阵与只读提示不回归" \
  "require '$BROWSER_LOG' 'PASS  矩阵06a' 'PASS  矩阵06b'"
run_item 07 "桌面与 375px：文本/数字不溢出、不遮挡表格、无横向页面滚动；五阶段仍各成一组" \
  "require '$BROWSER_LOG' 'PASS  矩阵07a' 'PASS  矩阵07b' 'PASS  矩阵07c'"
run_item 08 "回归：既有 18 项矩阵 + Stage7 + Stage9 + Stage11 + Stage13 + Stage15（CH-1…CH-13 与 409 / 重启 / 审计 / WBS 导出 / 日报弹层 / Markdown 编辑器）" \
  "WBS_SKIP_CONTAINER_ITEMS=1 bash tests/verify.sh '$OUT/regress-legacy' && grep -F '结论：全部矩阵项通过' '$OUT/regress-legacy/matrix-summary.txt' && bash tests/verify_stage7.sh '$OUT/regress-stage7' && grep -F '结论：新增自测矩阵 01–14 全部通过' '$OUT/regress-stage7/matrix-summary.txt' && bash tests/verify_stage9.sh '$OUT/regress-stage9' && grep -F '结论：CH-8 作者自测矩阵 01–14 全部通过' '$OUT/regress-stage9/matrix-summary.txt' && bash tests/verify_stage11.sh '$OUT/regress-stage11' && grep -F '结论：变更包 #4（CH-9 + CH-10）作者自测矩阵 01–14 全部通过' '$OUT/regress-stage11/matrix-summary.txt' && bash tests/verify_stage13.sh '$OUT/regress-stage13' && grep -F '结论：变更包 #5（CH-11 + CH-12' '$OUT/regress-stage13/matrix-summary.txt' && bash tests/verify_stage15.sh '$OUT/regress-stage15' && grep -F '结论：变更包 #6（CH-13 日报改为可复制关键信息文本弹层）作者自测矩阵 01–10 全部通过' '$OUT/regress-stage15/matrix-summary.txt' && echo 'PASS=1 FAIL=0'"
run_item 09 "部署与镜像自检（BIND_HOST=0.0.0.0 / 本机+0.0.0.0+公网三端 health / 无 node_modules / 服务资源与源码 sha256 一致 / CH-14 live 冒烟）" \
  "bash tests/stage17/deploy_check.sh"
run_item 10 "页面全程无外部请求、0 次新增下载（无 blob / a[download] / WBS_DOWNLOAD_HOOK 调用），/api/stats 不构成下载路径" \
  "require '$BROWSER_LOG' 'PASS  矩阵10a' 'PASS  矩阵10b' && require '$STATS_LOG' 'PASS  矩阵10b'"

echo | tee -a "$SUMMARY"
if [ "$FAILED" -eq 0 ]; then
  echo "结论：变更包 #7（CH-14 阶段状态占比总览 + GET /api/stats）作者自测矩阵 01–10 全部通过（浏览器用例集 $BROWSER_RC / 服务端口径用例集 $STATS_RC）" | tee -a "$SUMMARY"
else
  echo "结论：存在失败项，见上方与各项日志" | tee -a "$SUMMARY"
fi
echo "输出目录：$OUT" | tee -a "$SUMMARY"
exit "$FAILED"
