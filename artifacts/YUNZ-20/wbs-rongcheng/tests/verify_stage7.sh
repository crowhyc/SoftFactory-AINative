#!/usr/bin/env bash
# YUNZ-27 / 变更包 #2：新增作者自测矩阵（01–14）总入口。
# 覆盖变更 CH-1…CH-7：操作列/日期状态常显/负责人池化/新增人员/日报导出/导出日期标签/新增人员写审计。
# 浏览器项跑在 playwright Chromium 容器内（宿主 CentOS 7 无法直接跑 Chromium），
# 服务端项用 Node 标准库脚本；每项留独立日志，完整输出见 $OUT。
# 用法：bash tests/verify_stage7.sh [输出目录]
set -uo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$APP_DIR"
OUT="${1:-$APP_DIR/tests/.tmp/stage7}"
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
    printf '%-4s %-52s 通过（PASS=%s FAIL=%s）\n' "$id" "$label" "${pass:-?}" "${fail:-0}" | tee -a "$SUMMARY"
  else
    FAILED=1
    printf '%-4s %-52s 失败（PASS=%s FAIL=%s，见 %s）\n' "$id" "$label" "${pass:-?}" "${fail:-?}" "$log" | tee -a "$SUMMARY"
  fi
}

echo "YUNZ-27 变更包 #2 作者自测开始 $(date -Iseconds)" | tee -a "$SUMMARY"
echo "node: $(node --version 2>&1)  python3: $(python3 --version 2>&1)  docker: $(docker --version)" | tee -a "$SUMMARY"
echo | tee -a "$SUMMARY"

BROWSER_LOG="$OUT/browser.log"
SERVER_LOG="$OUT/server.log"
BROWSER_OUT="$APP_DIR/tests/.tmp/stage7-out"

echo "--- 准备 A：真实浏览器（Chromium 容器）用例集 ---" | tee -a "$SUMMARY"
bash tests/stage7/run.sh "$BROWSER_OUT" > "$BROWSER_LOG" 2>&1
BROWSER_RC=$?
echo "浏览器用例集退出码 $BROWSER_RC（完整输出：$BROWSER_LOG）" | tee -a "$SUMMARY"

echo "--- 准备 B：服务端 / 历史接口用例集 ---" | tee -a "$SUMMARY"
node tests/stage7_server_check.js > "$SERVER_LOG" 2>&1
SERVER_RC=$?
echo "服务端用例集退出码 $SERVER_RC（完整输出：$SERVER_LOG）" | tee -a "$SUMMARY"
echo | tee -a "$SUMMARY"

run_item 01 "日期五列与状态列常显为可交互控件（非点击才出现）" \
  "require '$BROWSER_LOG' 'PASS  矩阵1a 项目负责人可见五列日期常显 type=date' 'PASS  矩阵1b 状态列常显五枚举下拉' 'PASS  矩阵2e 本人行日期/状态控件可交互'"
run_item 02 "无权限行日期/状态 disabled、选项不变、点击给中文提示" \
  "require '$BROWSER_LOG' 'PASS  矩阵2a 无权限行五列日期常显' 'PASS  矩阵2b 无权限行状态列常显下拉' 'PASS  矩阵2c 点击无权限行日期单元格仍给中文只读提示' 'PASS  矩阵2d 点击无权限行状态单元格仍给中文只读提示'"
run_item 03 "操作列：每行常显「编辑」进入行编辑态；「删除」仅项目负责人可见" \
  "require '$BROWSER_LOG' 'PASS  矩阵3a 操作列每行常显' 'PASS  矩阵3b 每行常显「编辑」按钮' 'PASS  矩阵3d 点「编辑」进入该行行编辑态' 'PASS  矩阵3e 再点「完成」退出行编辑态' 'PASS  矩阵3c 他人行点「编辑」只给中文只读提示'"
run_item 04 "删除确认框「取消」不删除 / 「确认」删除" \
  "require '$BROWSER_LOG' 'PASS  矩阵4a 删除确认框「取消」路径' 'PASS  矩阵4b 删除确认框「确认」路径'"
run_item 05 "负责人下拉＝人员池；项目负责人可改派、普通负责人只读" \
  "require '$BROWSER_LOG' 'PASS  矩阵5 负责人列为下拉、选项＝当前人员池' 'PASS  矩阵5b 项目负责人改派负责人' 'PASS  矩阵5d 普通负责人负责人列只读'"
run_item 06 "新增人员：非空/去重/1–20 校验；立即生效；返回首页同步；落盘" \
  "require '$BROWSER_LOG' 'PASS  矩阵6a 项目负责人可见「新增人员」入口' 'PASS  矩阵6b 姓名非空校验' 'PASS  矩阵6c 姓名长度 1–20 校验' 'PASS  矩阵6d 姓名去重校验' 'PASS  矩阵6e 合法姓名加入成功' 'PASS  矩阵6f 新增人员立即出现在身份切换' 'PASS  矩阵6g 新增人员已落盘 wbs.json' 'PASS  矩阵6h 返回首页后身份列表同步' 'PASS  矩阵6i 返回首页后可用新增身份重进工作台' && require '$SERVER_LOG' 'PASS  矩阵6a 人员池新增落盘' 'PASS  矩阵6b 服务端拒绝空白 / 重复 / 超长'"
run_item 07 "日报「阻塞与延期」sheet：仅阻塞/延期行，A–K + 状态" \
  "require '$BROWSER_LOG' 'PASS  矩阵7a 日报文件名与日期口径正确' 'PASS  矩阵7b 日报为单个 workbook、两个 sheet' 'PASS  矩阵7c 阻塞与延期表头' 'PASS  矩阵7d 阻塞与延期 sheet 恰好'"
run_item 08 "日报「当日变更」sheet：字段级逐行、旧值→新值、时间、操作身份" \
  "require '$BROWSER_LOG' 'PASS  矩阵8a 当日变更表头正确' 'PASS  矩阵8b 当日变更每行 = 一个被改动的字段' 'PASS  矩阵8c 当日变更同一任务按时间升序' && require '$SERVER_LOG' 'PASS  矩阵8a audit.log 每条记录带 old/new 映射' 'PASS  矩阵8b GET /api/history 字段级记录' 'PASS  矩阵8c 自然日口径 [00:00:00, 次日 00:00:00) 开区间'"
run_item 09 "原 WBS 导出不含 status、第 1/2 行 A–K 逐字一致、A–K 保真" \
  "require '$BROWSER_LOG' 'PASS  矩阵9a 原 WBS 导出文件名保持' 'PASS  矩阵9b 原 WBS 导出第 1/2 行 A–K 逐字与源模板一致' 'PASS  矩阵9c 原 WBS 导出数据区不含 status' && python3 tests/export_verify.py '$BROWSER_OUT/蓉城战役WBS-'\"\$(date +%Y%m%d)\"'.xlsx' public/template.xlsx '$BROWSER_OUT/wbs-at-export.json' 36"
run_item 10 "旧数据兼容：老 wbs.json 可读可保存；老/损坏 audit.log 不报错" \
  "require '$SERVER_LOG' 'PASS  矩阵10a 旧格式（无 old/new）行与损坏行被跳过' 'PASS  矩阵10b 老 wbs.json（无新增字段）可读、可保存'"
run_item 11 "三端一致 + 刷新持久 + 409 非覆盖 + 重启持久 + health" \
  "require '$BROWSER_LOG' 'PASS  矩阵11f 三端一致' 'PASS  矩阵11g 刷新持久' && require '$SERVER_LOG' 'PASS  矩阵11a GET /api/health' 'PASS  矩阵11b 保存成功（原子写，revision +1）' 'PASS  矩阵11c 并发旧版本保存 409 非覆盖' 'PASS  矩阵11d /api/history 参数校验与 405' 'PASS  矩阵11e 服务重启后数据与人员池仍在'"
run_item 12 "回归子集：D-3 遮罩级联 / 验收1 / 验收3 / 验收4 / 无 pageerror" \
  "require '$BROWSER_LOG' 'PASS  回归(D-3) 进入工作台后身份遮罩 [hidden] 级联生效' 'PASS  回归(D-3) 工作台可见并渲染 36 行' 'PASS  验收1a 身份选择页渲染九身份' 'PASS  验收1b 刷新（localStorage 记忆）后身份保持' 'PASS  验收3 普通负责人本人行可编辑并保存（CH-8：K 列经大尺寸面板保存）' 'PASS  验收4 他人行只读' 'PASS  全程无 pageerror' 'PASS  全程无 console error'"

run_item 13 "CH-6 导出 M1 日期标签（Asia/Shanghai，仅新增 M1，不改原文）" \
  "require '$BROWSER_LOG' 'PASS  矩阵13a（CH-6）' 'PASS  矩阵13b（CH-6）' && python3 tests/export_verify.py '$BROWSER_OUT/蓉城战役WBS-'\"\$(date +%Y%m%d)\"'.xlsx' public/template.xlsx '$BROWSER_OUT/wbs-at-export.json' 36"
run_item 14 "CH-7 新增人员写 identity_added 审计 + 日报「当日变更」含该行 + 越权被拒" \
  "require '$BROWSER_LOG' 'PASS  矩阵14a（CH-7）' 'PASS  矩阵14b（CH-7）' 'PASS  矩阵14c（CH-7）' && require '$SERVER_LOG' 'PASS  矩阵14a（CH-7）' 'PASS  矩阵14b（CH-7）' 'PASS  矩阵14c（CH-7）' 'PASS  矩阵14d（CH-7）'"

echo | tee -a "$SUMMARY"
if [ "$FAILED" -eq 0 ]; then
  echo "结论：新增自测矩阵 01–14 全部通过（浏览器用例集 $BROWSER_RC / 服务端用例集 $SERVER_RC）" | tee -a "$SUMMARY"
else
  echo "结论：存在失败项，见上方与各项日志" | tee -a "$SUMMARY"
fi
echo "输出目录：$OUT" | tee -a "$SUMMARY"
exit "$FAILED"
