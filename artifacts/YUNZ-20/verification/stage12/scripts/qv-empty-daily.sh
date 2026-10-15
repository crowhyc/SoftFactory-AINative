#!/bin/bash
set -u
ST=/opt/SoftFactory-AINative/artifacts/YUNZ-20/verification/stage12
WORK=/opt/SoftFactory-AINative/.multica-workspaces/yunzhidian-f03e0d551ffa/yunz-32-2cbfbb62fd57/workdir
TOOLS=/opt/SoftFactory-AINative/.multica-workspaces/yunzhidian-f03e0d551ffa/yunz-30-93111e17d54f/workdir/tools
IMG=mcr.microsoft.com/playwright:v1.55.0-jammy
D="$WORK/scratch/stage12-empty"
export PYTHONIOENCODING=utf-8
rm -rf "$D"; mkdir -p "$D"
python3 "$ST/scripts/qv-empty-make.py" "$D" || exit 1
docker rm -f qv-stage12-4184 >/dev/null 2>&1 || true
chown -R 1000:1000 "$D"
docker run -d --name qv-stage12-4184 --network host -e WBS_HOST=0.0.0.0 -e WBS_PORT=4184 -e WBS_DATA_DIR=/app/data -v "$D":/app/data wbs-rongcheng:20261015123713 >/dev/null
for i in $(seq 1 40); do curl -s -m 2 http://127.0.0.1:4184/api/health >/dev/null 2>&1 && break; sleep 0.5; done
echo "无事件隔离实例健康：$(curl -s -m 3 http://127.0.0.1:4184/api/health)"
curl -s -m 3 "http://127.0.0.1:4184/api/daily?date=2026-10-15" -o "$ST/results/empty-daily.json"
echo "API 日报：$(head -c 300 "$ST/results/empty-daily.json")"
docker run --rm --network host -v "$ST":/work -v "$TOOLS":/tools -w /work \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright -e NODE_PATH=/tools/node_modules \
  -e QV_BASE=http://127.0.0.1:4184 -e QV_OUT=/work -e QV_TAG=empty \
  "$IMG" node /work/scripts/qv-mini-export.cjs
echo "--- 读回 ---"
python3 "$ST/scripts/qv-readback.py" daily "$ST/downloads/empty-daily.xlsx" "$ST/results/empty-daily.json" EMPTY --empty
echo "读回退出码 $?"
docker rm -f qv-stage12-4184 >/dev/null 2>&1 || true
