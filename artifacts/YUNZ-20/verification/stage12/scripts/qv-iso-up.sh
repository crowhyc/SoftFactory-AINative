#!/bin/bash
# Stage12 隔离写入实例：复用被验证镜像 + 独立数据目录 + 4183，不触碰现场
set -u
ST=/opt/SoftFactory-AINative/artifacts/YUNZ-20/verification/stage12
WORK=/opt/SoftFactory-AINative/.multica-workspaces/yunzhidian-f03e0d551ffa/yunz-32-2cbfbb62fd57/workdir
D="$WORK/scratch/stage12-write"
export PYTHONIOENCODING=utf-8
IMG=wbs-rongcheng:20261015123713
rm -rf "$D"; mkdir -p "$D"
python3 "$ST/scripts/qv-iso-write-data.py" "$D" || exit 1
docker rm -f qv-stage12-4183 >/dev/null 2>&1 || true
chown -R 1000:1000 "$D"
docker run -d --name qv-stage12-4183 --network host \
  -e WBS_HOST=0.0.0.0 -e WBS_PORT=4183 -e WBS_DATA_DIR=/app/data \
  -v "$D":/app/data "$IMG" >/dev/null
for i in $(seq 1 40); do curl -s -m 2 http://127.0.0.1:4183/api/health >/dev/null 2>&1 && break; sleep 0.5; done
echo "隔离写入实例健康：$(curl -s -m 3 http://127.0.0.1:4183/api/health)"
echo "隔离数据目录：$D/data（$D 直接挂载为 /app/data）"
ls -la "$D"
