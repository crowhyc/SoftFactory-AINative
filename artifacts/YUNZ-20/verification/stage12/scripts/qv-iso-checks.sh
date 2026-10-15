#!/bin/bash
# Stage12：隔离实例的并发 409、审计字段级明细、三端一致与重启持久
set -u
ST=/opt/SoftFactory-AINative/artifacts/YUNZ-20/verification/stage12
WORK=/opt/SoftFactory-AINative/.multica-workspaces/yunzhidian-f03e0d551ffa/yunz-32-2cbfbb62fd57/workdir
D="$WORK/scratch/stage12-write"
B=http://127.0.0.1:4183
export PYTHONIOENCODING=utf-8
S="$WORK/scratch"; mkdir -p "$S"
pass=0; fail=0
ck() { local n="$1"; shift; if "$@" >/dev/null 2>&1; then echo "PASS  $n"; pass=$((pass+1)); else echo "FAIL  $n"; fail=$((fail+1)); fi; }

echo "== 审计明细与三端一致 =="
curl -s -m 3 "$B/api/wbs" -o "$ST/results/iso-api-before-race.json"
cp "$D/wbs.json" "$ST/isolated/iso-disk-before-race.json"
cp "$D/audit.log" "$ST/isolated/iso-audit.log"
ck "A-01 字段级审计：phases.dev.status 旧值→新值 + 身份 + 时间（点击保存流程）" python3 "$ST/scripts/qv-iso-assert.py" audit-phases
ck "A-02 三端一致：页面保存后的字段在 API 与磁盘 wbs.json 中一致" python3 "$ST/scripts/qv-iso-assert.py" three-way
ck "A-03 CH-9：磁盘 demo 原值（是）未被写入流程清空" python3 "$ST/scripts/qv-iso-assert.py" demo-preserved

echo "== 并发 PUT 409 不覆盖 =="
R=$(python3 -c "import io,json;print(json.load(io.open('$ST/results/iso-api-before-race.json',encoding='utf-8'))['meta']['revision'])")
echo "当前 revision=$R"
python3 "$ST/scripts/qv-iso-race-make.py" "$ST/results/iso-api-before-race.json" "$S/race-a.json" "START" "$S/race-b.json" "BLOCKED"
( curl -s -o "$ST/results/race-resp-a.json" -w '%{http_code}' -m 8 -X PUT "$B/api/wbs" -H 'Content-Type: application/json' -H "If-Match: $R" -H 'X-Identity: 项目负责人' --data-binary @"$S/race-a.json" > "$ST/results/race-code-a.txt" ) &
( curl -s -o "$ST/results/race-resp-b.json" -w '%{http_code}' -m 8 -X PUT "$B/api/wbs" -H 'Content-Type: application/json' -H "If-Match: $R" -H 'X-Identity: 项目负责人' --data-binary @"$S/race-b.json" > "$ST/results/race-code-b.txt" ) &
wait
echo "并发响应码：A=$(cat "$ST/results/race-code-a.txt") B=$(cat "$ST/results/race-code-b.txt")"
curl -s -m 3 "$B/api/wbs" -o "$ST/results/iso-api-after-race.json"
ck "B-01 并发 PUT：恰好一个成功、一个 409（无丢失更新）" python3 "$ST/scripts/qv-iso-assert.py" race-outcome
ck "B-02 409 未覆盖：最终值等于成功方 payload、revision 只 +1" python3 "$ST/scripts/qv-iso-assert.py" race-nocover
R2=$(python3 -c "import io,json;print(json.load(io.open('$ST/results/iso-api-after-race.json',encoding='utf-8'))['meta']['revision'])")
echo "并发后 revision=$R2"
echo "== 过时 If-Match 顺序重放（确定性 409）=="
CODE=$(curl -s -o "$ST/results/stale-resp.json" -w '%{http_code}' -m 8 -X PUT "$B/api/wbs" -H 'Content-Type: application/json' -H "If-Match: $R" -H 'X-Identity: 项目负责人' --data-binary @"$S/race-a.json")
echo "过时 If-Match（=$R）响应码 $CODE，body=$(head -c 120 "$ST/results/stale-resp.json")"
curl -s -m 3 "$B/api/wbs" -o "$ST/results/iso-api-after-stale.json"
ck "B-03 过时 If-Match → 409 且数据/版本不变" python3 "$ST/scripts/qv-iso-assert.py" stale-nocover

echo "== 重启持久（隔离实例）=="
cp "$D/wbs.json" "$ST/isolated/iso-disk-pre-restart.json"
docker restart qv-stage12-4183 >/dev/null
for i in $(seq 1 40); do curl -s -m 2 "$B/api/health" >/dev/null 2>&1 && break; sleep 0.5; done
sleep 1
curl -s -m 3 "$B/api/wbs" -o "$ST/results/iso-api-after-restart.json"
docker logs qv-stage12-4183 > "$ST/logs/iso-restart.log" 2>&1
cp "$D/wbs.json" "$ST/isolated/iso-disk-post-restart.json"
ck "C-01 重启后 API 数据与重启前磁盘快照一致（值 + revision）" python3 "$ST/scripts/qv-iso-assert.py" restart-persist
ck "C-02 重启后磁盘文件逐字节不变（未被重启改写）" bash -c "cmp -s '$D/wbs.json' '$ST/isolated/iso-disk-pre-restart.json'"
echo "== 汇总：PASS=$pass FAIL=$fail =="
