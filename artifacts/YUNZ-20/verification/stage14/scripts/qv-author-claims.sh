#!/usr/bin/env bash
# YUNZ-34 / Stage14：作者自报（YUNZ-33 交付评论）核验 —— 独立复算，仅用于核对声明的一致性，
# 不作为本报告结论证据（本报告结论证据一律取自本任务复跑）。
set -uo pipefail
A=/opt/SoftFactory-AINative/artifacts/YUNZ-20
RUN=/opt/wbs-rongcheng
pass=0; fail=0
ck() { if [ "$2" = "1" ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1  :: $3"; fail=$((fail+1)); fi; }

S=$(sha256sum "$RUN/public/app.js" | awk '{print $1}')
[ "$S" = "d49cc9e2fce5c3c0e22a35f52ce4ab642110a6a920464bf1d1d14d2a279280f7" ] && ck "C-01 作者自报 app.js sha256 复算一致" 1 || ck "C-01 作者自报 app.js sha256 复算一致" 0 "$S"
S=$(sha256sum "$RUN/server.js" | awk '{print $1}')
[ "$S" = "d9b29f0001fece55ec8c7010ea4c4526f62b70f37538f1761439e0936df4ec33" ] && ck "C-02 作者自报 server.js sha256 复算一致（本包未改服务端）" 1 || ck "C-02 作者自报 server.js sha256 复算一致" 0 "$S"
S=$(sha256sum "$A/SHA256SUMS" | awk '{print $1}')
[ "$S" = "d3eab4be94d0c54f1751f72bd18f4b17c740117c06f0d7eabfef1712fcece6f2" ] && ck "C-03 作者自报 SHA256SUMS sha256 复算一致" 1 || ck "C-03 作者自报 SHA256SUMS sha256 复算一致" 0 "$S"
[ -d "$A/selftest/stage13" ] && [ -f "$A/selftest/stage13/README.md" ] && ck "C-04 作者自测证据目录 selftest/stage13 存在（自报链）" 1 || ck "C-04 作者自测证据目录存在" 0 "缺失"
N=$(ls "$A/selftest/stage13"/*.log 2>/dev/null | wc -l)
[ "$N" -ge 12 ] && ck "C-05 作者自测逐项日志 >= 12（自报链）" 1 || ck "C-05 作者自测逐项日志 >= 12" 0 "$N"
IMG=$(docker ps --format '{{.Names}} {{.Image}}' | grep '^wbs-rongcheng ' | awk '{print $2}')
[ "$IMG" = "wbs-rongcheng:20261015141900" ] && ck "C-06 作者自报部署镜像名与实际运行镜像一致" 1 || ck "C-06 作者自报部署镜像名一致" 0 "$IMG"
if diff -rq "$RUN/public" "$A/wbs-rongcheng/public" >/dev/null 2>&1; then ck "C-07 运行目录 public/ 与源码快照逐字一致" 1; else ck "C-07 运行目录 public/ 与源码快照逐字一致" 0 "$(diff -rq "$RUN/public" "$A/wbs-rongcheng/public" | head -3)"; fi
S=$(sha256sum "$A/selftest/stage13/browser/日报-20261015.xlsx" | awk '{print $1}')
echo "  作者自测浏览器产物 日报-20261015.xlsx sha256=$S size=$(stat -c%s "$A/selftest/stage13/browser/日报-20261015.xlsx")"
S=$(sha256sum "$A/selftest/stage13/browser/无事件"* 2>/dev/null | awk '{print $1}' | head -1)
echo "  作者自测无事件兜底文件 sha256=$S"
echo
echo "[author-claims] PASS=$pass FAIL=$fail"
[ "$fail" = "0" ] && exit 0 || exit 1
