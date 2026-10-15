#!/bin/bash
# Stage10 隔离复验实例：复用被验证部署镜像，host 网络 + 端口 4181 + 独立数据目录，不触碰现场
set -u
WORK=/opt/SoftFactory-AINative/.multica-workspaces/yunzhidian-f03e0d551ffa/yunz-30-93111e17d54f/workdir
ISO="$WORK/scratch/stage10-iso"
IMG="wbs-rongcheng:20261015104003"
docker rm -f qv-stage10-4181 >/dev/null 2>&1 || true
rm -rf "$ISO"; mkdir -p "$ISO/data"
cp /opt/wbs-rongcheng/data/wbs.seed.json "$ISO/data/"
cp /opt/wbs-rongcheng/data/wbs.json "$ISO/data/wbs.json"
: > "$ISO/data/audit.log"
# 容器内进程为 uid 1000(node)：必须让挂载目录可写，否则服务端保存会 500（脚本自身的环境准备，非被测产物问题）
chown -R 1000:1000 "$ISO/data"
echo "隔离数据目录 $ISO/data 初始内容："; sha256sum "$ISO/data"/*
docker run -d --name qv-stage10-4181 --network host \
  -e WBS_HOST=0.0.0.0 -e WBS_PORT=4181 -e WBS_DATA_DIR=/app/data \
  -v "$ISO/data":/app/data "$IMG" >/dev/null
sleep 2
echo "容器：$(docker ps --filter name=qv-stage10-4181 --format '{{.Names}} | {{.Image}} | {{.Status}}')"
echo "镜像 id（隔离实例 vs 现场）："
docker inspect qv-stage10-4181 --format '{{.Image}}'
docker inspect wbs-rongcheng --format '{{.Image}}'
curl -s -m 5 http://127.0.0.1:4181/api/health; echo
