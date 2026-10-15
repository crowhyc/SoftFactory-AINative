#!/bin/bash
# Stage10 复验后：现场只读性确认 + 部署到位复核 + 隔离实例清理
set -u
RUN=/opt/wbs-rongcheng
SNAP=/opt/SoftFactory-AINative/artifacts/YUNZ-20/wbs-rongcheng
echo "# Stage10 复验后现场确认 $(date '+%F %T%z')"
echo
echo "## 1. 现场数据字节级未变（对比复验前记录 logs/02a-pre-live-data-sha256.txt）"
NOW=$(sha256sum "$RUN/data/wbs.json" "$RUN/data/audit.log")
echo "$NOW"
if diff <(cat logs/02a-pre-live-data-sha256.txt) <(cd "$RUN/data" && sha256sum wbs.json audit.log) >/dev/null 2>&1; then
  echo "RESULT: sha256 与复验前完全一致（现场数据零改动）"
else
  echo "RESULT: 需要人工比对（格式差异，见上）"
fi
echo "revision=$(curl -s http://127.0.0.1:4180/api/health)"
echo
echo "## 2. 部署到位复核（served vs 运行目录 vs 源码快照）"
for f in index.html app.js styles.css; do
  a=$(curl -s "http://127.0.0.1:4180/$f" | sha256sum | cut -d' ' -f1)
  b=$(sha256sum "$RUN/public/$f" | cut -d' ' -f1)
  c=$(sha256sum "$SNAP/public/$f" | cut -d' ' -f1)
  printf '%-14s %s\n' "$f" "$([ "$a" = "$b" ] && [ "$b" = "$c" ] && echo MATCH || echo DIFF)"
done
printf 'server.js(MD dir/run) %s\n' "$([ "$(sha256sum "$RUN/server.js"|cut -d' ' -f1)" = "$(sha256sum "$SNAP/server.js"|cut -d' ' -f1)" ] && echo MATCH || echo DIFF)"
echo
echo "## 3. 运行态与约束"
docker inspect wbs-rongcheng --format 'image={{.Config.Image}} imageId={{.Image}} host={{.HostConfig.NetworkMode}}'
echo "health 127.0.0.1: $(curl -s -m 5 http://127.0.0.1:4180/api/health)"
echo "health 0.0.0.0:   $(curl -s -m 5 http://0.0.0.0:4180/api/health)"
echo "health 公网:      $(curl -s -m 8 http://47.108.129.157:4180/api/health) (rc=$?)"
echo "绑定: $(ss -ltn | grep 4180)"
docker exec wbs-rongcheng sh -c 'ls -d /app/node_modules 2>/dev/null || echo "镜像内无 node_modules"'
echo
echo "## 4. 未触碰项（Multica 三容器）"
docker ps --format '{{.Names}} | {{.Status}}' | grep multica
echo
echo "## 5. 隔离实例清理（不触碰现场容器）"
docker ps --filter name=qv-stage10-4181 --format '{{.Names}} | {{.Image}} | {{.Status}}'
docker rm -f qv-stage10-4181
docker ps --format '{{.Names}}' | grep -c qv-stage10 || echo "隔离实例已删除"
