#!/usr/bin/env bash
# YUNZ-40 / Stage20：隔离实例服务端口径复验运行器。
# 六个一次性容器（isoA 4310 / isoB 4311 / isoC 4312 / isoS 4313 / isoD 4314 / isoE 4315）
# 只绑宿主 127.0.0.1，数据目录为 stage20/iso/<name>，不触碰现场 4180 与现场数据。
set -uo pipefail
S20="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.55.0-jammy}"
APP="${APP_DIR:-/opt/wbs-rongcheng}"
NAMES=(isoA isoB isoC isoS isoD isoE)
PORTS=(4310 4311 4312 4313 4314 4315)

cleanup() { for n in "${NAMES[@]}"; do docker rm -f "qv40-$n" >/dev/null 2>&1 || true; done; }
trap cleanup EXIT
cleanup

for i in "${!NAMES[@]}"; do
  n="${NAMES[$i]}"; p="${PORTS[$i]}"
  docker run -d --name "qv40-$n" --network host \
    -e WBS_DATA_DIR=/data -e WBS_PORT="$p" -e WBS_HOST=127.0.0.1 \
    -v "$S20/iso/$n":/data -v "$APP":/app:ro "$IMAGE" node /app/server.js >/dev/null || exit 1
  ok=""
  for _ in $(seq 1 80); do
    if curl -s -m 2 "http://127.0.0.1:$p/api/health" | grep -q '"ok":true'; then ok=1; break; fi
    sleep 0.25
  done
  [ -n "$ok" ] || { echo "隔离实例 $n (:$p) 启动失败"; docker logs "qv40-$n" 2>&1 | tail -8; exit 1; }
  docker logs "qv40-$n" > "$S20/logs/iso-$n-startup.log" 2>&1
done
echo "[stage20] 六个隔离实例就绪（4310-4315）"

BASE_A=http://127.0.0.1:4310 BASE_B=http://127.0.0.1:4311 \
BASE_C=http://127.0.0.1:4312 BASE_S=http://127.0.0.1:4313 \
BASE_D=http://127.0.0.1:4314 BASE_E=http://127.0.0.1:4315 \
LIVE=http://127.0.0.1:4180 S20="$S20" APP_DIR="$APP" \
  PYTHONIOENCODING=utf-8 python3 "$S20/scripts/qv20-server-api.py"
RC=$?

echo "[stage20] 重启 isoB 验证重启持久与迁移幂等"
docker restart qv40-isoB >/dev/null 2>&1
for _ in $(seq 1 80); do
  curl -s -m 2 http://127.0.0.1:4311/api/health | grep -q '"ok":true' && break
  sleep 0.25
done
docker logs qv40-isoB > "$S20/logs/iso-isoB-restart.log" 2>&1
BASE_B=http://127.0.0.1:4311 S20="$S20" PYTHONIOENCODING=utf-8 python3 - <<'PY'
import json, os, sys, urllib.request
BASE = os.environ['BASE_B']; S20 = os.environ['S20']
def get(path):
    with urllib.request.urlopen(BASE + path, timeout=10) as resp:
        return resp.status, json.loads(resp.read().decode('utf-8'))
status, stats = get('/api/stats')
expected = json.load(open(os.path.join(S20, 'results', 'expected-stats.json'), encoding='utf-8'))['datasets']['isoB']
ok_status, wbs = get('/api/wbs')
sig = [s['value'] + '=' + str(s['count']) + '/' + ('%.1f' % s['percentage']) for s in stats['aggregate']['statuses']]
exp_sig = [e + '=' + str(c) + '/' + ('%.1f' % p) for e, c, p in zip(
    ['\u672a\u5f00\u59cb', '\u5df2\u5f00\u59cb', '\u5df2\u5b8c\u6210', '\u5ef6\u671f', '\u963b\u585e'],
    expected['aggregate']['counts'], expected['aggregate']['percentages'])]
fails = 0
if status != 200 or stats.get('total') != 12:
    print('FAIL  重启持久/isoB 重启后 total 应为 12 ->', stats.get('total')); fails += 1
else:
    print('PASS  重启持久/isoB 重启后 total=12 且 /api/stats 仍 200')
if sig != exp_sig:
    print('FAIL  重启持久/isoB 重启后 aggregate 与重启前期望不一致 ->', sig); fails += 1
else:
    print('PASS  重启持久/isoB 重启后 aggregate 逐项与期望一致')
if wbs.get('meta', {}).get('revision') != 0:
    print('FAIL  重启持久/isoB 重启未改写 revision ->', wbs.get('meta')); fails += 1
else:
    print('PASS  重启持久/isoB 重启未改写 revision（仍 0）')
print('PASS=3 FAIL=%d' % fails)
sys.exit(1 if fails else 0)
PY
RC2=$?
echo "[stage20] 脏数据「只截断不补齐」分支（直接模块调用，数据文件路径不可达）"
docker run --rm -e S20=/qv -e APP_DIR=/app \
  -v "$S20":/qv:ro -v "$APP":/app:ro "$IMAGE" node /qv/scripts/qv20-stats-dirty.cjs
RC3=$?
[ "$RC" -eq 0 ] && [ "$RC2" -eq 0 ] && [ "$RC3" -eq 0 ] || exit 1
exit 0
