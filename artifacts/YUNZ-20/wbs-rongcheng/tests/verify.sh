#!/usr/bin/env bash
# WC-001 作者自测总入口：按 18 项矩阵逐项留输出，另加容器部署/回滚附加项。
# 用法：bash tests/verify.sh [输出目录]，默认输出到 tests/.tmp/outputs
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/wbs-rongcheng}"
cd "$APP_DIR"
OUT="${1:-$APP_DIR/tests/.tmp/outputs}"
rm -rf "$OUT"
mkdir -p "$OUT"

SUMMARY="$OUT/matrix-summary.txt"
: > "$SUMMARY"
FAILED=0

run_item() {
  local id="$1" label="$2" cmd="$3"
  local log="$OUT/$id.log"
  {
    echo "=== 矩阵 $id · $label ==="
    echo "\$ $cmd"
    echo
  } > "$log"
  bash -c "$cmd" >> "$log" 2>&1
  local rc=$?
  local fails pass
  pass=$(grep -oE 'PASS=[0-9]+' "$log" | tail -1 | cut -d= -f2)
  fails=$(grep -oE 'FAIL=[0-9]+' "$log" | tail -1 | cut -d= -f2)
  if [ "$rc" -eq 0 ]; then
    printf '%-4s %-46s 通过（PASS=%s FAIL=%s）\n' "$id" "$label" "${pass:-?}" "${fails:-0}" | tee -a "$SUMMARY"
  else
    FAILED=1
    printf '%-4s %-46s 失败（PASS=%s FAIL=%s，见 %s）\n' "$id" "$label" "${pass:-?}" "${fails:-?}" "$log" | tee -a "$SUMMARY"
  fi
}

echo "WC-001 作者自测开始 $(date -Iseconds)" | tee -a "$SUMMARY"
echo "node: $(node --version)  python3: $(python3 --version 2>&1)  docker: $(docker --version)" | tee -a "$SUMMARY"
echo | tee -a "$SUMMARY"

run_item 01 "读取/渲染 36 行" \
  "node tests/selfcheck.js --only render36 && node tests/domcheck.mjs --only render36"
run_item 02 "九身份选择与切换保持（localStorage）" \
  "node tests/domcheck.mjs --only identity"
run_item 03 "普通负责人本人行可编辑并保存" \
  "node tests/selfcheck.js --only ownedit && node tests/domcheck.mjs --only ownedit"
run_item 04 "他人行只读" \
  "node tests/domcheck.mjs --only others"
run_item 04b "序号列只读提示一致性（D-2 回归）" \
  "node tests/domcheck.mjs --only idcell"
run_item 05 "新增/删除仅项目负责人（带确认）" \
  "node tests/domcheck.mjs --only adddelete"
run_item 06 "保存后页面/API/磁盘三端一致（含原子写）" \
  "node tests/selfcheck.js --only consistency,atomic && node tests/domcheck.mjs --only ownedit"
run_item 07 "刷新持久" \
  "node tests/domcheck.mjs --only ownedit"
run_item 08 "空值与非法输入不写入" \
  "node tests/selfcheck.js --only validation && node tests/domcheck.mjs --only prevalidation"
run_item 09 "并发保存 409 不覆盖" \
  "node tests/selfcheck.js --only conflict"
run_item 10 "纯标准库、零运行时依赖" \
  "node tests/selfcheck.js --only stdlib"
run_item 11 "页面资源全本地（无外部请求）" \
  "node tests/selfcheck.js --only localonly"
run_item 12 "导出 A–K 共 11 列（含行数一致）" \
  "node tests/exportcheck.mjs && python3 tests/export_verify.py \"$APP_DIR/tests/.tmp/蓉城战役WBS-\$(date +%Y%m%d).xlsx\" public/template.xlsx tests/.tmp/wbs-from-api.json 36 && python3 tests/export_verify.py \"$APP_DIR/tests/.tmp/蓉城战役WBS-\$(date +%Y%m%d)-34row.xlsx\" public/template.xlsx tests/.tmp/wbs-34rows.json 34"
run_item 12b "页面导出入口保留模板列宽（D-1 回归）" \
  "node tests/domcheck.mjs --only exportpage"
run_item 13 "导出第 1/2 行逐字一致 / 非数据单元格不变" \
  "grep -E '逐字一致' $OUT/12.log >/dev/null && grep -E '非数据单元格内容保持原样' $OUT/12.log && echo 'PASS=2 FAIL=0'"
run_item 14 "导出不含 status" \
  "grep -E \"不含字面量 'status'\" $OUT/12.log >/dev/null && grep -E '数据区不含任何 status 取值' $OUT/12.log && echo 'PASS=2 FAIL=0'"
run_item 15 "/api/health 返回 ok（含页面探针）" \
  "node tests/selfcheck.js --only health && grep -E '服务正常' $OUT/01.log"
run_item 16 "服务重启数据仍在" \
  "node tests/selfcheck.js --only restart"
run_item 17 "连续 10 次保存 A–K 无丢失/无重复/无未知字段被清除" \
  "node tests/selfcheck.js --only tensaves"
run_item 18 "产物与仓库不含凭据字符串" \
  "node tests/selfcheck.js --only secrets && bash tests/scan_secrets.sh"

echo | tee -a "$SUMMARY"
echo "=== 附加项：容器部署（契约 I 部署要求） ===" | tee -a "$SUMMARY"

run_item 19 "docker build --network none 构建（构建期无网络）+ deploy.sh 部署自检" \
  "bash tests/deploy_selftest.sh build"
run_item 20 "容器内保存往返：页面资源/API/磁盘一致 + health" \
  "bash tests/deploy_selftest.sh roundtrip"
run_item 16b "容器重启后数据仍在（docker restart）" \
  "bash tests/deploy_selftest.sh restart"
run_item 21 "rollback.sh 回滚语义（上一镜像 + 上一 data 备份 + health）" \
  "bash tests/deploy_selftest.sh rollback"

echo | tee -a "$SUMMARY"
if [ "$FAILED" -eq 0 ]; then
  echo "结论：全部矩阵项通过" | tee -a "$SUMMARY"
else
  echo "结论：存在失败项，见上方日志" | tee -a "$SUMMARY"
fi
echo "输出目录：$OUT" | tee -a "$SUMMARY"
exit "$FAILED"
