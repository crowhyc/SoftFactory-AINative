#!/usr/bin/env bash
# YUNZ-35 / 变更包 #6（CH-13：导出日报改为「一键可复制关键信息文本」弹层）作者自测矩阵 01–10 总入口。
# 覆盖：真实浏览器（Chromium 容器）弹层/复制/关闭用例 + 宿主服务端文本口径用例 + 既有 18 项 / Stage7 / Stage9 /
#       Stage11 / Stage13 回归 + 部署与镜像自检（BIND_HOST=0.0.0.0，含 CH-13 live 冒烟）。
# 浏览器项跑在 playwright Chromium 容器内（宿主 CentOS 7 无法直接跑 Chromium）；服务端文本口径用例跑在宿主 node。
# 用法：bash tests/verify_stage15.sh [输出目录]
set -uo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$APP_DIR"
OUT="${1:-$APP_DIR/tests/.tmp/stage15}"
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

echo "YUNZ-35 变更包 #6（CH-13 日报文本弹层）作者自测开始 $(date -Iseconds)" | tee -a "$SUMMARY"
echo "node: $(node --version 2>&1)  python3: $(python3 --version 2>&1)  docker: $(docker --version 2>&1)  today: $TODAY" | tee -a "$SUMMARY"
echo | tee -a "$SUMMARY"

BROWSER_LOG="$OUT/browser.log"
TEXT_LOG="$OUT/textcheck.log"
BROWSER_OUT="$APP_DIR/tests/.tmp/stage15-out"
rm -rf "$BROWSER_OUT"

echo "--- 准备 A：真实浏览器（Chromium 容器）用例集（弹层 / 复制 / 关闭 / 无事件兜底） ---" | tee -a "$SUMMARY"
bash tests/stage15/run.sh "$BROWSER_OUT" > "$BROWSER_LOG" 2>&1
BROWSER_RC=$?
echo "浏览器用例集退出码 $BROWSER_RC（完整输出：$BROWSER_LOG）" | tee -a "$SUMMARY"

echo "--- 准备 B：服务端文本口径用例集（宿主 node：概况行 / 排序 / 派生 / 去重 / 兜底 / 旧数据源保留） ---" | tee -a "$SUMMARY"
# 说明：宿主 node 是 docker 包装脚本（环境变量不会传进容器），textcheck 的 OUTDIR 只能用其默认值
#       $APP_DIR/tests/.tmp/stage15-text；跑完把结果文件复制到本次输出目录，保证证据自包含。
node tests/stage15/textcheck.cjs > "$TEXT_LOG" 2>&1
TEXT_RC=$?
cp -f "$APP_DIR/tests/.tmp/stage15-text/textcheck-results.json" "$OUT/textcheck-results.json" 2>/dev/null || true
echo "服务端文本用例集退出码 $TEXT_RC（完整输出：$TEXT_LOG + $OUT/textcheck-results.json）" | tee -a "$SUMMARY"
echo | tee -a "$SUMMARY"

run_item 01 "弹层入口（CH-13）：点「导出日报」打开只读文本弹层（role=dialog / 复制 + 关闭），无 blob / a[download] / xlsx 组装调用" \
  "require '$BROWSER_LOG' 'PASS  矩阵01a 页面「导出日报」打开只读文本弹层' 'PASS  矩阵01b 「导出日报」不再有下载行为'"
run_item 02 "顶部概况行固定「今日延期 X 项 / 阻塞 Y 项」，计数与事件行数一致（前端 + 服务端双口径）" \
  "require '$BROWSER_LOG' 'PASS  矩阵02 顶部概况行' && require '$TEXT_LOG' 'PASS  矩阵02 顶部概况行固定为'"
run_item 03 "排序：延期条目在前、阻塞条目在后；同类内按任务与阶段顺序稳定排列（设计→开发→测试→产品→演示准备）" \
  "require '$BROWSER_LOG' 'PASS  矩阵03 弹层内延期条目在前' && require '$TEXT_LOG' 'PASS  矩阵03 延期条目在前、阻塞条目在后'"
run_item 04 "内容范围：派生「到期未更新，判定延期」；当天已更新过的阶段不重复判定；边界（今天 / 空日期 / 已完成）与阻塞范围（当天新出现 + 仍阻塞）" \
  "require '$BROWSER_LOG' 'PASS  矩阵04 派生「到期未更新，判定延期」入弹层' && require '$TEXT_LOG' 'PASS  矩阵04 派生规则' 'PASS  矩阵04 去重规则' 'PASS  矩阵04 边界与抑制' 'PASS  矩阵04 阻塞范围含'"
run_item 05 "无事件兜底：整体文本只有一行「今日无阻塞、延期。」（无概况行；与 /api/daily 一致）" \
  "require '$BROWSER_LOG' 'PASS  矩阵05 无任何阻塞/延期时' && require '$TEXT_LOG' 'PASS  矩阵05 无任何阻塞/延期时'"
run_item 06 "行格式与高风险前缀：逐字「【延期·高风险】/【阻塞·高风险】一级 / 二级 / 任务项 @负责人：结论。」；文本 = /api/daily 同一份字符串；只体现阻塞、延期" \
  "require '$BROWSER_LOG' 'PASS  矩阵06 弹层只读文本块内容' 'PASS  矩阵06 事件行逐字命中' && require '$TEXT_LOG' 'PASS  矩阵06 事件行逐字为' 'PASS  矩阵06 只体现阻塞、延期'"
run_item 07 "复制：优先 navigator.clipboard 成功路径 + 失败走选择/execCommand 兜底路径 + 双失败中文提示；成功提示「已复制，可直接粘贴到微信」" \
  "require '$BROWSER_LOG' 'PASS  矩阵07a 复制成功路径' 'PASS  矩阵07b 兜底路径' 'PASS  矩阵07c 两条路径都失败时'"
run_item 08 "关闭路径：关闭按钮 / Esc 均可关闭（只读展示、不弹确认）；打开与关闭不影响工作台未保存编辑状态" \
  "require '$BROWSER_LOG' 'PASS  矩阵08a 关闭按钮可关闭弹层' 'PASS  矩阵08b Esc 可关闭弹层' 'PASS  矩阵08c 打开/关闭日报弹层不影响'"
run_item 09 "回归：既有 18 项矩阵 + Stage7 + Stage9 + Stage11 + Stage13（WBS 导出与五色、阶段下拉、权限、409 / 重启、Markdown、无外部请求）" \
  "WBS_SKIP_CONTAINER_ITEMS=1 bash tests/verify.sh '$OUT/regress-legacy' && grep -F '结论：全部矩阵项通过' '$OUT/regress-legacy/matrix-summary.txt' && bash tests/verify_stage7.sh '$OUT/regress-stage7' && grep -F '结论：新增自测矩阵 01–14 全部通过' '$OUT/regress-stage7/matrix-summary.txt' && bash tests/verify_stage9.sh '$OUT/regress-stage9' && grep -F '结论：CH-8 作者自测矩阵 01–14 全部通过' '$OUT/regress-stage9/matrix-summary.txt' && bash tests/verify_stage11.sh '$OUT/regress-stage11' && grep -F '结论：变更包 #4（CH-9 + CH-10）作者自测矩阵 01–14 全部通过' '$OUT/regress-stage11/matrix-summary.txt' && bash tests/verify_stage13.sh '$OUT/regress-stage13' && grep -F '结论：变更包 #5（CH-11 + CH-12' '$OUT/regress-stage13/matrix-summary.txt' && echo 'PASS=1 FAIL=0'"
run_item 10 "部署与镜像自检（BIND_HOST=0.0.0.0 / 本机+0.0.0.0+公网三端 health / 无 node_modules / 资源与源码一致 / CH-13 live 冒烟）" \
  "bash tests/stage15/deploy_check.sh"

echo | tee -a "$SUMMARY"
if [ "$FAILED" -eq 0 ]; then
  echo "结论：变更包 #6（CH-13 日报改为可复制关键信息文本弹层）作者自测矩阵 01–10 全部通过（浏览器用例集 $BROWSER_RC / 服务端文本用例集 $TEXT_RC）" | tee -a "$SUMMARY"
else
  echo "结论：存在失败项，见上方与各项日志" | tee -a "$SUMMARY"
fi
echo "输出目录：$OUT" | tee -a "$SUMMARY"
exit "$FAILED"
