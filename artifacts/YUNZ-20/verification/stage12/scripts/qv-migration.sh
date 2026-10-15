#!/bin/bash
# YUNZ-32 / Stage12 独立复验：CH-10 一次性迁移（隔离实例）
# 复用被验证部署镜像 + 独立数据目录 + 4181 端口；绝不触碰现场 4180。
set -u
ST=/opt/SoftFactory-AINative/artifacts/YUNZ-20/verification/stage12
WORK=/opt/SoftFactory-AINative/.multica-workspaces/yunzhidian-f03e0d551ffa/yunz-32-2cbfbb62fd57/workdir
SCRATCH="$WORK/scratch"
IMG=wbs-rongcheng:20261015123713
PRE=/opt/wbs-rongcheng/data/wbs.json.20261015040405.bak
export PYTHONIOENCODING=utf-8
pass=0; fail=0
ck() { local n="$1"; shift; if "$@" >/dev/null 2>&1; then echo "PASS  $n"; pass=$((pass+1)); else echo "FAIL  $n"; fail=$((fail+1)); fi; }

up() { # up <name> <port> <datadir>
  local name="$1" port="$2" dir="$3"
  docker rm -f "$name" >/dev/null 2>&1 || true
  chown -R 1000:1000 "$dir"
  docker run -d --name "$name" --network host \
    -e WBS_HOST=0.0.0.0 -e WBS_PORT="$port" -e WBS_DATA_DIR=/app/data \
    -v "$dir":/app/data "$IMG" >/dev/null
  for i in $(seq 1 40); do curl -s -m 2 "http://127.0.0.1:$port/api/health" >/dev/null 2>&1 && return 0; sleep 0.5; done
  return 1
}

echo "== M1 迁移：从迁移前备份启动（$PRE）=="
echo "迁移前输入：$(sha256sum "$PRE")"
D1="$SCRATCH/stage12-mig1"; rm -rf "$D1"; mkdir -p "$D1"
cp "$PRE" "$D1/wbs.json"; cp /opt/wbs-rongcheng/data/wbs.seed.json "$D1/wbs.seed.json"; : > "$D1/audit.log"
echo "启动前 data 目录："; ls -1 "$D1"
up qv-stage12-mig1 4181 "$D1" || { echo "FAIL  隔离实例未就绪"; exit 1; }
echo "健康：$(curl -s -m 3 http://127.0.0.1:4181/api/health)"
curl -s -m 3 "http://127.0.0.1:4181/api/wbs" -o "$ST/results/iso-mig1-wbs.json"
curl -s -m 3 "http://127.0.0.1:4181/api/daily" -o "$ST/results/iso-mig1-daily.json"
cp "$D1/wbs.json" "$ST/isolated/iso-mig1-wbs.json"
cp "$D1/audit.log" "$ST/isolated/iso-mig1-audit.log"
ls -1 "$D1" > "$ST/results/iso-mig1-dirlist.txt"
docker logs qv-stage12-mig1 > "$ST/logs/iso-mig1-container.log" 2>&1

ck "M1-01 revision 9→10（递增 +1）" python3 "$ST/scripts/qv-mig-assert.py" mig1-rev
ck "M1-02 全 35 行 phases 齐全且取值合法（五键/五枚举）" python3 "$ST/scripts/qv-mig-assert.py" mig1-phases-enum
ck "M1-03 phases 与算法逐条一致（日期 < 今天 → 延期，否则 未开始）" python3 "$ST/scripts/qv-mig-assert.py" mig1-algo
ck "M1-04 demo / status 原值与迁移前逐条一致" python3 "$ST/scripts/qv-mig-assert.py" mig1-preserve
ck "M1-05 迁移前时间戳备份存在且与输入逐字节一致（可回滚）" python3 "$ST/scripts/qv-mig-assert.py" mig1-backup
ck "M1-06 审计每阶段一条 type=migrated、身份「系统迁移」、175 条且无重复" python3 "$ST/scripts/qv-mig-assert.py" mig1-audit
ck "M1-07 迁移行不出现在日报任何 sheet / 不产生今日摘要事件" python3 "$ST/scripts/qv-mig-assert.py" mig1-daily

echo "== M2 幂等：重启同一实例（不再迁移）=="
S1=$(sha256sum "$D1/wbs.json" | cut -d' ' -f1); A1=$(wc -l < "$D1/audit.log"); L1=$(ls -1 "$D1/wbs.json".*.bak 2>/dev/null | wc -l)
docker restart qv-stage12-mig1 >/dev/null
for i in $(seq 1 40); do curl -s -m 2 http://127.0.0.1:4181/api/health >/dev/null 2>&1 && break; sleep 0.5; done
sleep 1
S2=$(sha256sum "$D1/wbs.json" | cut -d' ' -f1); A2=$(wc -l < "$D1/audit.log"); L2=$(ls -1 "$D1/wbs.json".*.bak 2>/dev/null | wc -l)
echo "重启前 wbs.json=$S1 audit=$A1 bak=$L1 | 重启后 wbs.json=$S2 audit=$A2 bak=$L2"
echo "重启后健康：$(curl -s -m 3 http://127.0.0.1:4181/api/health)"
docker logs qv-stage12-mig1 > "$ST/logs/iso-mig1-restart.log" 2>&1
ck "M2-01 重启后 wbs.json 逐字节不变（无二次迁移）" test "$S1" = "$S2"
ck "M2-02 重启后审计行数不变（未追加 migrated）" test "$A1" = "$A2"
ck "M2-03 重启后备份数不变（不再生成迁移备份）" test "$L1" = "$L2"

echo "== M3 边界用例：恰好今天 / 昨天 / 阶段日期缺失 / 非法日期 =="
D3="$SCRATCH/stage12-mig3"; rm -rf "$D3"; mkdir -p "$D3"
python3 "$ST/scripts/qv-mig-boundary-make.py" "$PRE" "$D3/wbs.json" || exit 1
cp /opt/wbs-rongcheng/data/wbs.seed.json "$D3/wbs.seed.json"; : > "$D3/audit.log"
up qv-stage12-mig3 4182 "$D3" || { echo "FAIL  边界隔离实例未就绪"; exit 1; }
curl -s -m 3 "http://127.0.0.1:4182/api/wbs" -o "$ST/results/iso-mig3-wbs.json"
cp "$D3/wbs.json" "$ST/isolated/iso-mig3-wbs.json"
cp "$D3/audit.log" "$ST/isolated/iso-mig3-audit.log"
docker logs qv-stage12-mig3 > "$ST/logs/iso-mig3-container.log" 2>&1
ck "M3-01 边界行判定正确（昨天→延期；恰好今天/缺失/未来→未开始）" python3 "$ST/scripts/qv-mig-assert.py" mig3-boundary
ck "M3-02 非法日历日期（2026-02-30）不判延期" python3 "$ST/scripts/qv-mig-assert.py" mig3-invalid
ck "M3-03 边界实例迁移后 revision 递增且审计 175 条" python3 "$ST/scripts/qv-mig-assert.py" mig3-audit

echo "== M4 保存后 revision 正常递增（隔离实例，迁移后写入）=="
R0=$(curl -s -m 3 http://127.0.0.1:4181/api/wbs | python3 -c "import sys,json;print(json.load(sys.stdin)['meta']['revision'])")
curl -s -m 3 http://127.0.0.1:4181/api/wbs -o "$SCRATCH/m4.json"
python3 - "$SCRATCH/m4.json" "$SCRATCH/m4-put.json" <<'PY'
import io,json,sys
doc=json.load(io.open(sys.argv[1],encoding='utf-8'))
doc['tasks'][0]['phases']['design']='已开始'
json.dump(doc,io.open(sys.argv[2],'w',encoding='utf-8'),ensure_ascii=False)
PY
REV=$(curl -s -m 5 -X PUT http://127.0.0.1:4181/api/wbs -H "Content-Type: application/json" -H "If-Match: $R0" -H "X-WBS-Identity: 项目负责人" --data-binary @"$SCRATCH/m4-put.json")
echo "PUT 结果：$REV"
R1=$(curl -s -m 3 http://127.0.0.1:4181/api/health | python3 -c "import sys,json;print(json.load(sys.stdin)['revision'])")
echo "revision $R0 → $R1"
ck "M4-01 迁移后保存 revision +1" test "$R1" = "$((R0+1))"
ck "M4-02 过时 If-Match 返回 409 且不覆盖" bash -c "code=\$(curl -s -o /dev/null -w '%{http_code}' -m 5 -X PUT http://127.0.0.1:4181/api/wbs -H 'Content-Type: application/json' -H 'If-Match: $R0' -H 'X-WBS-Identity: 项目负责人' --data-binary @$SCRATCH/m4-put.json); [ \"\$code\" = 409 ]"
docker rm -f qv-stage12-mig1 qv-stage12-mig3 >/dev/null 2>&1 || true
echo "== 汇总：PASS=$pass FAIL=$fail =="
