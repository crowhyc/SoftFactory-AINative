#!/bin/bash
# Stage12：现场（4180）一致性回执与部署口径
set -u
ST=/opt/SoftFactory-AINative/artifacts/YUNZ-20/verification/stage12
SNAP=/opt/SoftFactory-AINative/artifacts/YUNZ-20/wbs-rongcheng
export PYTHONIOENCODING=utf-8
pass=0; fail=0
ck() { local n="$1"; shift; if "$@" >/dev/null 2>&1; then echo "PASS  $n"; pass=$((pass+1)); else echo "FAIL  $n"; fail=$((fail+1)); fi; }

echo "== 输入回执（作者自报 vs 本任务独立复算）=="
curl -s -m 5 http://127.0.0.1:4180/api/wbs -o "$ST/results/live-api-now.json"
cp /opt/wbs-rongcheng/data/wbs.json "$ST/isolated/live-disk-now.json"
cp /opt/wbs-rongcheng/data/audit.log "$ST/isolated/live-audit.log"
echo "现场健康：$(curl -s -m 3 http://127.0.0.1:4180/api/health)"
printf '%s\n' "作者自报（YUNZ-31 评论）与独立复算：见 logs/11-live-receipts.log 上方 hash 对照" | tee -a "$ST/logs/hash-compare.txt"
sha256sum /opt/wbs-rongcheng/server.js /opt/wbs-rongcheng/public/app.js /opt/wbs-rongcheng/public/index.html /opt/wbs-rongcheng/public/styles.css "$SNAP/server.js" "$SNAP/public/app.js" "$SNAP/public/index.html" "$SNAP/public/styles.css" | tee "$ST/results/hash-compare.txt"

ck "L-01 CH-9：现场 demo 与原值逐条一致（35 行，未写空/未清空）" python3 "$ST/scripts/qv-live-assert.py" demo-preserved
ck "L-02 CH-10：旧 status 仍在 JSON 且保留原值（逐条）" python3 "$ST/scripts/qv-live-assert.py" status-preserved
ck "L-03 CH-10：全行 phases 五键齐全、取值仅限五枚举" python3 "$ST/scripts/qv-live-assert.py" phases-enum
ck "L-04 CH-10：dates.* 与 phases.* 独立（互不覆盖，日期原值未变）" python3 "$ST/scripts/qv-live-assert.py" dates-independent
ck "L-05 现场 wbs.json（磁盘）与 /api/wbs 一致，revision 正常" python3 "$ST/scripts/qv-live-assert.py" live-three-way
ck "L-06 迁移审计：175 条 migrated / 身份 系统迁移 / 迁移前备份 sha256 与作者自报一致" python3 "$ST/scripts/qv-live-assert.py" live-audit
ck "L-07 现场 /api/daily 今日：不含迁移行、不引用旧 status" python3 "$ST/scripts/qv-live-assert.py" live-daily
ck "L-08 服务端返回的 index.html/app.js/styles.css 与源码快照逐字节一致" python3 "$ST/scripts/qv-live-assert.py" served-assets
ck "L-09 运行态绑定 0.0.0.0:4180（容器 env + 两个地址 health）" python3 "$ST/scripts/qv-live-assert.py" bind
ck "L-10 镜像内无 node_modules" bash -c "docker run --rm --entrypoint sh wbs-rongcheng:20261015123713 -c 'ls /app/node_modules' 2>&1 | grep -qi 'no such file or directory'"
echo "== 现场汇总：PASS=$pass FAIL=$fail =="
