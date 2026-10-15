#!/bin/bash
# Stage10：服务端契约用例（隔离实例，容器内 node）+ 重启持久（隔离实例）
set -u
ST=/opt/SoftFactory-AINative/artifacts/YUNZ-20/verification/stage10
TOOLS=/opt/SoftFactory-AINative/.multica-workspaces/yunzhidian-f03e0d551ffa/yunz-30-93111e17d54f/workdir/tools
ISO=/opt/SoftFactory-AINative/.multica-workspaces/yunzhidian-f03e0d551ffa/yunz-30-93111e17d54f/workdir/scratch/stage10-iso
IMG=mcr.microsoft.com/playwright:v1.55.0-jammy
echo "== 服务端契约用例 $(date '+%F %T%z')（容器内 node，--network host 打 4181） =="
# 注：本环境的宿主 node 进程无法访问回环（curl 可以），故服务端用例在容器内执行
docker run --rm --network host -v "$ST":/work -v "$TOOLS":/tools -v "$ISO/data":/iso-data:ro -w /work \
  -e NODE_PATH=/tools/node_modules -e QV_BASE=http://127.0.0.1:4181 -e QV_ISO_DATA=/iso-data -e QV_OUT=/work \
  "$IMG" node /work/scripts/qv-iso-server.js
echo "服务端用例退出码 $?"
echo
echo "== 重启持久（隔离实例） $(date '+%F %T%z') =="
pre_note_len=$(curl -s http://127.0.0.1:4181/api/wbs | python3 -c "import json,sys;d=json.load(sys.stdin);print(len([t for t in d['tasks'] if t['id']=='T005'][0]['note']))")
pre_rev=$(curl -s http://127.0.0.1:4181/api/health | python3 -c "import json,sys;print(json.load(sys.stdin)['revision'])")
echo "重启前：T005 note 长度=$pre_note_len revision=$pre_rev"
docker restart qv-stage10-4181 >/dev/null
sleep 3
post_rev=$(curl -s http://127.0.0.1:4181/api/health | python3 -c "import json,sys;print(json.load(sys.stdin)['revision'])")
post_note_len=$(curl -s http://127.0.0.1:4181/api/wbs | python3 -c "import json,sys;d=json.load(sys.stdin);print(len([t for t in d['tasks'] if t['id']=='T005'][0]['note']))")
echo "重启后：T005 note 长度=$post_note_len revision=$post_rev"
var_ok=$(curl -s http://127.0.0.1:4181/api/livez 2>/dev/null; ss -ltn | grep -c 4181)
echo "绑定： $(ss -ltn | grep 4181)"
if [ "$pre_note_len" = "$post_note_len" ] && [ "$pre_rev" = "$post_rev" ] && [ "$pre_note_len" != "0" ]; then
  echo "PASS  重启持久：20000 字符 note 与 revision 跨重启保持一致"; else
  echo "FAIL  重启持久（pre=$pre_note_len post=$post_note_len rev=$pre_rev/$post_rev）"; fi
echo "隔离实例数据现场 sha256："; sha256sum "$ISO/data/wbs.json" "$ISO/data/audit.log"
