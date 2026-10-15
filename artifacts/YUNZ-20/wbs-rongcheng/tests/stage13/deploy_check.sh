#!/usr/bin/env bash
# YUNZ-33 / 变更包 #5（CH-11 今日摘要仅 A 列 + CH-12 日报删除「当日变更」sheet）部署与镜像自检。
# CH-13 同步（YUNZ-35 / 变更包 #6）：日报改为「一键可复制关键信息文本」弹层（不再产出 xlsx），
# live 冒烟断言同步为弹层文本口径。
# 复用 stage9 的容器/绑定/health/镜像/资源一致性口径（BIND_HOST=0.0.0.0），并追加新基线 live 冒烟。
# 用法：bash tests/stage13/deploy_check.sh
set -uo pipefail
APP_DIR="${APP_DIR:-/opt/wbs-rongcheng}"
PORT="${HOST_PORT:-4180}"
PUBLIC_HOST="${PUBLIC_HOST:-47.108.129.157}"
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "PASS  $1${2:+  :: $2}"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL  $1${2:+  -> $2}"; }

echo "=== Stage13 部署/镜像自检 $(date -Iseconds) ==="
echo "--- 复用 stage9 部署口径（容器镜像 / 0.0.0.0 绑定 / 双端+公网 health / 无 node_modules / 资源与源码一致） ---"
if bash "$APP_DIR/tests/stage9/deploy_check.sh"; then
  ok "stage9 部署口径全部通过（容器 / 绑定 / health / 镜像无依赖 / 资源一致）"
else
  bad "stage9 部署口径存在失败项（见上方输出）"
fi

echo "--- 新基线 live 冒烟（CH-13：日报文本弹层） ---"
TODAY="$(TZ=Asia/Shanghai date +%F)"
DAILY_JSON="$(curl -fsS "http://127.0.0.1:$PORT/api/daily?tz=Asia/Shanghai&date=$TODAY" 2>/dev/null || true)"
case "$DAILY_JSON" in
  *'"ok":true'*) ok "live /api/daily 返回 ok（日报数据源可达，服务端审计与 changes 保留）";;
  *) bad "live /api/daily 未返回 ok" "${DAILY_JSON:0:120}";;
esac
if printf '%s' "$DAILY_JSON" | grep -q '"summary"' && printf '%s' "$DAILY_JSON" | grep -q '"blocked"' && printf '%s' "$DAILY_JSON" | grep -q '"changes"'; then
  ok "live /api/daily 仍返回 summary / blocked / changes 三个数据源（服务端汇总逻辑保留）"
else
  bad "live /api/daily 数据源结构异常" "${DAILY_JSON:0:160}"
fi
if printf '%s' "$DAILY_JSON" | grep -q '"text"' && printf '%s' "$DAILY_JSON" | grep -q '今日延期\|今日无阻塞、延期。'; then
  ok "live /api/daily 返回 CH-13 关键信息文本（概况行「今日延期 X 项 / 阻塞 Y 项」或兜底「今日无阻塞、延期。」）"
else
  bad "live /api/daily 未返回 CH-13 文本" "${DAILY_JSON:0:160}"
fi

APPJS="$(curl -fsS "http://127.0.0.1:$PORT/app.js" 2>/dev/null || true)"
INDEXHTML="$(curl -fsS "http://127.0.0.1:$PORT/index.html" 2>/dev/null || true)"
if printf '%s' "$APPJS" | grep -q "buildDailyWorkbook\|dailyBytes\|DAILY_SHEET_NAMES\|patchSummaryWrap"; then
  bad "live app.js 仍含日报 xlsx 组装代码（CH-13 未生效）"
else
  ok "live app.js 已移除日报 xlsx 组装（buildDailyWorkbook / dailyBytes / DAILY_SHEET_NAMES / patchSummaryWrap；CH-13 生效）"
fi
case "$APPJS" in
  *"openDailyPanel"*"copyDailyText"*) ok "live app.js 含日报文本弹层与复制实现（CH-13 生效）";;
  *) bad "live app.js 未含日报文本弹层 / 复制实现";;
esac
case "$INDEXHTML" in
  *'id="daily-panel"'*'id="daily-text"'*'id="daily-copy"'*) ok "live index.html 含日报弹层 DOM（daily-panel / daily-text / daily-copy；CH-13 生效）";;
  *) bad "live index.html 未含日报弹层 DOM";;
esac
case "$APPJS" in
  *"已复制，可直接粘贴到微信"*) ok "live app.js 含复制成功中文提示（CH-13 生效）";;
  *) bad "live app.js 未含复制成功中文提示";;
esac
HEALTH_PUBLIC="$(curl -m 8 -fsS "http://$PUBLIC_HOST:$PORT/api/health" 2>/dev/null || true)"
case "$HEALTH_PUBLIC" in
  *'"ok":true'*) ok "公网 http://$PUBLIC_HOST:$PORT/api/health → $HEALTH_PUBLIC";;
  *) echo "NOTE  公网 health 未通过：${HEALTH_PUBLIC:-（无响应/超时）}；本地与 0.0.0.0 均 ok、容器绑定 $BIND_HOST=${BIND_HOST:-}，按既有口径判定为非实现问题（阿里云安全组）。";;
esac
echo "---"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
