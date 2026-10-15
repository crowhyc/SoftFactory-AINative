#!/bin/bash
# YUNZ-30 / Stage10 独立复验：复验前现场与部署到位核验（只读）
set -u
RUN=/opt/wbs-rongcheng
SNAP=/opt/SoftFactory-AINative/artifacts/YUNZ-20/wbs-rongcheng
OUT="$1"
mkdir -p "$OUT"
echo "# Stage10 复验前现场记录（只读） $(date '+%F %T%z')"
echo
echo "## 1. 数据现场 sha256 / revision"
sha256sum "$RUN/data/wbs.json" "$RUN/data/audit.log" "$RUN/data/wbs.seed.json"
python3 - <<'PY'
import json, io
d = json.load(io.open('/opt/wbs-rongcheng/data/wbs.json', encoding='utf-8'))
print('revision=%s tasks=%d identities=%d updated_at=%s' % (
    d['meta']['revision'], len(d['tasks']), len(d['identities']), d['meta']['updated_at']))
print('task_keys=%s' % sorted({k for t in d['tasks'] for k in t}))
print('notes_nonempty=%d' % sum(1 for t in d['tasks'] if t.get('note')))
PY
echo
echo "## 2. 运行容器 / 镜像 / 绑定"
docker ps --filter name=wbs-rongcheng --format '{{.Names}} | {{.Image}} | {{.Status}} | {{.Ports}}'
docker inspect wbs-rongcheng --format 'Image={{.Config.Image}} ImageId={{.Image}} NetworkMode={{.HostConfig.NetworkMode}} Env={{range .Config.Env}}{{.}} {{end}}'
ss -ltn | grep -E '4180|4181' || true
echo
echo "## 3. health（回环 / 0.0.0.0 / 公网）"
for u in http://127.0.0.1:4180/api/health http://0.0.0.0:4180/api/health; do
  printf '%s -> ' "$u"; curl -s -m 5 "$u"; echo
done
printf 'http://47.108.129.157:4180/api/health -> '; curl -s -m 8 http://47.108.129.157:4180/api/health; echo " (curl rc=$?)"
echo
echo "## 4. 部署到位：运行态 HTTP 返回 vs 运行目录 vs 源码快照（sha256）"
for f in index.html app.js styles.css; do
  a=$(curl -s "http://127.0.0.1:4180/$f" | sha256sum | cut -d' ' -f1)
  b=$(sha256sum "$RUN/public/$f" | cut -d' ' -f1)
  c=$(sha256sum "$SNAP/public/$f" | cut -d' ' -f1)
  printf '%-14s served=%s rundir=%s snapshot=%s %s\n' "$f" "${a:0:16}" "${b:0:16}" "${c:0:16}" "$([ "$a" = "$b" ] && [ "$b" = "$c" ] && echo MATCH || echo DIFF)"
done
for f in template.xlsx vendor/xlsx.full.min.js; do
  a=$(curl -s "http://127.0.0.1:4180/$f" | sha256sum | cut -d' ' -f1)
  b=$(sha256sum "$RUN/public/$f" | cut -d' ' -f1)
  c=$(sha256sum "$SNAP/public/$f" | cut -d' ' -f1)
  printf '%-22s served=%s rundir=%s snapshot=%s %s\n' "$f" "${a:0:16}" "${b:0:16}" "${c:0:16}" "$([ "$a" = "$b" ] && [ "$b" = "$c" ] && echo MATCH || echo DIFF)"
done
printf '%-22s rundir=%s snapshot=%s %s\n' server.js \
  "$(sha256sum "$RUN/server.js" | cut -d' ' -f1 | cut -c1-16)" \
  "$(sha256sum "$SNAP/server.js" | cut -d' ' -f1 | cut -c1-16)" \
  "$([ "$(sha256sum "$RUN/server.js" | cut -d' ' -f1)" = "$(sha256sum "$SNAP/server.js" | cut -d' ' -f1)" ] && echo MATCH || echo DIFF)"
echo
echo "## 5. 镜像内无 node_modules / 无新增依赖"
echo "package.json dependencies: $(python3 -c "import json;print(json.load(open('$RUN/package.json')).get('dependencies'))")"
docker exec wbs-rongcheng sh -c 'ls -d /app/node_modules 2>/dev/null || echo "NO node_modules in image"'
docker exec wbs-rongcheng sh -c 'ls /app; echo ---; ls /app/data'
echo
echo "## 6. 容器内 /app 源码 vs 运行目录（部署到位）"
for f in server.js public/index.html public/app.js public/styles.css; do
  a=$(docker exec wbs-rongcheng sha256sum "/app/$f" | cut -d' ' -f1)
  b=$(sha256sum "$RUN/$f" | cut -d' ' -f1)
  printf '%-22s image=%s rundir=%s %s\n' "$f" "${a:0:16}" "${b:0:16}" "$([ "$a" = "$b" ] && echo MATCH || echo DIFF)"
done
echo
echo "## 7. 未触碰项"
docker ps --format '{{.Names}} | {{.Status}}' | grep multica
