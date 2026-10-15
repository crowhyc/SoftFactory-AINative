#!/usr/bin/env bash
# YUNZ-31 / 变更包 #4（CH-9 隐藏演示范围列 + CH-10 五阶段独立进度 / WBS 日报重构）部署与镜像自检。
# 复用 stage9 的容器/绑定/health/镜像/资源一致性口径（BIND_HOST=0.0.0.0），并追加新基线 live 冒烟。
# 用法：bash tests/stage11/deploy_check.sh
set -uo pipefail
APP_DIR="${APP_DIR:-/opt/wbs-rongcheng}"
PORT="${HOST_PORT:-4180}"
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "PASS  $1${2:+  :: $2}"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL  $1${2:+  -> $2}"; }

echo "=== Stage11 部署/镜像自检 $(date -Iseconds) ==="
echo "--- 复用 stage9 部署口径（容器镜像 / 0.0.0.0 绑定 / 双端+公网 health / 无 node_modules / 资源与源码一致） ---"
if bash "$APP_DIR/tests/stage9/deploy_check.sh"; then
  ok "stage9 部署口径全部通过（容器 / 绑定 / health / 镜像无依赖 / 资源一致）"
else
  bad "stage9 部署口径存在失败项（见上方输出）"
fi

echo "--- 新基线 live 冒烟（CH-9 / CH-10） ---"
TODAY="$(TZ=Asia/Shanghai date +%F)"
DAILY_JSON="$(curl -fsS "http://127.0.0.1:$PORT/api/daily?tz=Asia/Shanghai&date=$TODAY" 2>/dev/null || true)"
case "$DAILY_JSON" in
  *'"ok":true'*) ok "live /api/daily 返回 ok（三 sheet 数据源可达）";;
  *) bad "live /api/daily 未返回 ok" "${DAILY_JSON:0:120}";;
esac
if [ -n "$DAILY_JSON" ] && ! printf '%s' "$DAILY_JSON" | grep -q 'undefined'; then
  ok "live /api/daily 摘要文本无「undefined」占位（到期未更新前缀 = 延期·高风险）"
else
  bad "live /api/daily 出现 undefined 占位"
fi
INDEX="$(curl -fsS "http://127.0.0.1:$PORT/" 2>/dev/null || true)"
case "$INDEX" in
  *"是否演示范围"*) bad "live 页面仍渲染「是否演示范围」（CH-9 未生效）";;
  *) ok "live 页面不含「是否演示范围」列（CH-9 生效，测试文件字段保留）";;
esac
APPJS="$(curl -fsS "http://127.0.0.1:$PORT/app.js" 2>/dev/null || true)"
case "$APPJS" in
  *phase-select*) ok "live app.js 含五阶段下拉实现（CH-10 生效）";;
  *) bad "live app.js 未含 phase-select（CH-10 未生效）";;
esac
case "$APPJS" in
  *"var STATUSES"*) bad "live app.js 仍含旧全局 STATUSES 常量";;
  *) ok "live app.js 无旧全局 STATUSES 常量";;
esac
echo "---"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
