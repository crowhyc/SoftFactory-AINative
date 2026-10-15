#!/usr/bin/env bash
# YUNZ-29 / 变更包 #3：CH-8（进展说明 → 摘要单元格 + 大尺寸 Markdown 编辑器）作者自测矩阵 01–11 总入口。
# 浏览器项跑在 playwright Chromium 容器内（宿主 CentOS 7 无法直接跑 Chromium），服务端项用 Node 标准库脚本；
# 每项留独立日志，完整输出见 $OUT；回归项另跑既有 18 项矩阵与 Stage7 矩阵 01–14。
# 用法：bash tests/verify_stage9.sh [输出目录]
set -uo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$APP_DIR"
OUT="${1:-$APP_DIR/tests/.tmp/stage9}"
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

echo "YUNZ-29 变更包 #3（CH-8）作者自测开始 $(date -Iseconds)" | tee -a "$SUMMARY"
echo "node: $(node --version 2>&1)  python3: $(python3 --version 2>&1)  docker: $(docker --version 2>&1)" | tee -a "$SUMMARY"
echo | tee -a "$SUMMARY"

BROWSER_LOG="$OUT/browser.log"
SERVER_LOG="$OUT/server.log"
BROWSER_OUT="$APP_DIR/tests/.tmp/stage9-out"

echo "--- 准备 A：真实浏览器（Chromium 容器）用例集 ---" | tee -a "$SUMMARY"
bash tests/stage9/run.sh "$BROWSER_OUT" > "$BROWSER_LOG" 2>&1
BROWSER_RC=$?
echo "浏览器用例集退出码 $BROWSER_RC（完整输出：$BROWSER_LOG）" | tee -a "$SUMMARY"

echo "--- 准备 B：服务端 note 上限 / 审计 / 历史接口用例集 ---" | tee -a "$SUMMARY"
node tests/stage9_server_check.js > "$SERVER_LOG" 2>&1
SERVER_RC=$?
echo "服务端用例集退出码 $SERVER_RC（完整输出：$SERVER_LOG）" | tee -a "$SUMMARY"
echo | tee -a "$SUMMARY"

run_item 01 "K 列点击打开编辑面板（摘要单元格、整格可点、面板初始值）" \
  "require '$BROWSER_LOG' 'PASS  矩阵1a K 列显示纯文本摘要单元格' 'PASS  矩阵1b 有编辑权限的行给出「点击打开编辑」样式' 'PASS  矩阵1c 点击 K 单元格打开大尺寸编辑面板' 'PASS  矩阵1d 面板编辑区初始值 = 该行 note' 'PASS  矩阵1e 整格可视区域可点击' 'PASS  矩阵1f 面板「关闭」按钮可关闭面板'"
run_item 02 "摘要去 Markdown 与截断（纯逻辑 + DOM 单行省略）" \
  "require '$BROWSER_LOG' 'PASS  矩阵2a 摘要为去 Markdown 的纯文本' 'PASS  矩阵2b 摘要按约 80 字符截断' 'PASS  矩阵2c 短摘要不截断' 'PASS  矩阵2d 页面 K 单元格显示该 note 的去 Markdown 摘要' 'PASS  矩阵2e 单元格摘要按单行截断渲染' 'PASS  矩阵2f 超长 note 在单元格内单行截断' && require '$SERVER_LOG' 'PASS  矩阵02/06 note 允许为空'"
run_item 03 "桌面 90vw×80vh 双栏 / 手机全屏标签切换（视口与布局属性断言）" \
  "require '$BROWSER_LOG' 'PASS  矩阵3a 桌面面板约 90vw × 80vh' 'PASS  矩阵3b 桌面左「编辑」右「预览」双栏' 'PASS  矩阵3c 桌面不显示「编辑 / 预览」标签' 'PASS  矩阵3d 手机面板全屏' 'PASS  矩阵3e 手机显示「编辑 / 预览」标签、默认编辑页' 'PASS  矩阵3f 手机点「预览」标签切换为预览页' 'PASS  矩阵3g 手机可切回「编辑」标签' 'PASS  矩阵3h 手机只读模式' 'PASS  矩阵3i 手机只读面板 Esc 关闭'"
run_item 04 "原始 HTML 转义不执行 / 远程图片不解析不加载 / 无外部资源请求" \
  "require '$BROWSER_LOG' 'PASS  矩阵4a 原始 HTML 转义后原样显示、不执行' 'PASS  矩阵4b 远程图片不解析不加载' 'PASS  矩阵4c 打开面板与渲染预览期间无任何外部资源请求' 'PASS  矩阵4d Markdown 子集渲染生效'"
run_item 05 "编辑保存后页面/API/磁盘三端一致 + 审计字段级 old→new" \
  "require '$BROWSER_LOG' 'PASS  矩阵5a 编辑区输入即时驱动预览渲染' 'PASS  矩阵5b 仅点「保存」（Ctrl/Cmd+Enter）提交到服务端' 'PASS  矩阵5c 三端一致' 'PASS  矩阵5d 保存成功有中文提示' 'PASS  矩阵5e 刷新后 K 列摘要与面板内容仍为该 note' 'PASS  矩阵5f 审计沿用既有 audit line' && require '$SERVER_LOG' 'PASS  矩阵05 审计记录 note 字段级 old→new' 'PASS  矩阵05 审计记录时间与操作身份' 'PASS  矩阵05 /api/history 仍为既有字段集'"
run_item 06 "无权限行只读预览且无法提交" \
  "require '$BROWSER_LOG' 'PASS  矩阵6a 无权限行 K 列仍显示摘要' 'PASS  矩阵6b 无权限行点击 K 单元格同样打开面板，以预览只读展示' 'PASS  矩阵6c 只读行无法提交' 'PASS  矩阵6d 只读模式给出中文提示' 'PASS  矩阵6e 只读面板支持「关闭」按钮与 Esc 关闭'"
run_item 07 "未保存关闭确认：取消 / 继续退出两条路径" \
  "require '$BROWSER_LOG' 'PASS  矩阵7a 输入后标记为有未保存内容' 'PASS  矩阵7b 有未保存内容时关闭面板须确认' 'PASS  矩阵7c「取消」路径' 'PASS  矩阵7d 确认框内 Esc 走「取消」路径' 'PASS  矩阵7e「继续退出」路径' 'PASS  矩阵7f 重新打开面板：内容回到服务端值' 'PASS  矩阵7g 无未保存内容时关闭不再弹确认框'"
run_item 08 "note 超 20000 拒绝并有中文提示（前端 + 服务端）" \
  "require '$BROWSER_LOG' 'PASS  矩阵8a 超过 20000 字符时前端实时提示超长' 'PASS  矩阵8b 超长保存被前端拒绝并有中文提示、未发出 PUT' 'PASS  矩阵8c 恰好 20000 字符可正常保存' && require '$SERVER_LOG' 'PASS  矩阵08 服务端拒绝 note > 20000' 'PASS  矩阵08 服务端接受 note = 20000'"
run_item 09 "并发 PUT 409 不覆盖（前端 + 服务端）" \
  "require '$BROWSER_LOG' 'PASS  矩阵9a 并发旧版本 PUT 返回 409' 'PASS  矩阵9b 409 后未保存内容仍保留在面板中' 'PASS  矩阵9c 退出面板后点横幅「重新加载」可用新版本继续' && require '$SERVER_LOG' 'PASS  矩阵09 并发旧版本保存 409 且不覆盖'"
run_item 10 "重启后 note 与人员池持久（前端 + 服务端）" \
  "require '$BROWSER_LOG' 'PASS  矩阵10a 服务重启后 note 与人员池仍在' 'PASS  矩阵10b 重启后页面重新加载' && require '$SERVER_LOG' 'PASS  矩阵10 服务重启后 note 与人员池仍在'"
run_item 11 "回归：M1 标签 / 日报双 sheet / WBS 导出 A–K / D-3 / CH-1…CH-7" \
  "require '$BROWSER_LOG' 'PASS  矩阵11a 回归(D-3/验收1)' 'PASS  矩阵11b 回归(CH-1)' 'PASS  矩阵11c 回归(CH-2)' 'PASS  矩阵11d 回归(CH-3)' 'PASS  矩阵11e 回归(CH-2/验收4)' 'PASS  矩阵11f 回归(CH-4/CH-7)' 'PASS  矩阵11g 回归(CH-5)' 'PASS  矩阵11h 回归(CH-5/CH-8-7)' 'PASS  矩阵11i 回归(导出)' 'PASS  矩阵11j 回归(导出/CH-6)' 'PASS  矩阵11k 回归：全程无外部资源请求' 'PASS  矩阵11l 全程无 pageerror' && require '$SERVER_LOG' 'PASS  矩阵11 服务端返回的 index.html / app.js / styles.css 与源码运行目录一致' 'PASS  矩阵11 回归(CH-7) 非项目负责人通过 API 新增人员被拒'"
run_item 12 "既有 18 项矩阵回归（JS/DOM/导出；按当前部署口径跳过容器附加项）" \
  "WBS_SKIP_CONTAINER_ITEMS=1 bash tests/verify.sh '$OUT/legacy-matrix' && grep -F '结论：全部矩阵项通过' '$OUT/legacy-matrix/matrix-summary.txt' && echo 'PASS=1 FAIL=0'"
run_item 13 "Stage7 矩阵 01–14 回归（CH-1…CH-7 真实浏览器深度复跑）" \
  "bash tests/verify_stage7.sh '$OUT/regress-stage7' && grep -F '结论：新增自测矩阵 01–14 全部通过' '$OUT/regress-stage7/matrix-summary.txt' && echo 'PASS=1 FAIL=0'"
run_item 14 "部署与镜像自检（BIND_HOST=0.0.0.0 / 双端 health / 无 node_modules / 资源与源码一致）" \
  "bash tests/stage9/deploy_check.sh"

echo | tee -a "$SUMMARY"
if [ "$FAILED" -eq 0 ]; then
  echo "结论：CH-8 作者自测矩阵 01–14 全部通过（浏览器用例集 $BROWSER_RC / 服务端用例集 $SERVER_RC）" | tee -a "$SUMMARY"
else
  echo "结论：存在失败项，见上方与各项日志" | tee -a "$SUMMARY"
fi
echo "输出目录：$OUT" | tee -a "$SUMMARY"
exit "$FAILED"
