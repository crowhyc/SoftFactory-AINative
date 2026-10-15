#!/usr/bin/env bash
# YUNZ-35 / 变更包 #6（CH-13 日报改为「一键可复制关键信息文本」弹层）部署与镜像自检。
# 复用 stage13/stage9 的容器/绑定/health/镜像/资源一致性口径（BIND_HOST=0.0.0.0），并追加 CH-13 live 冒烟。
# 注意：CH-13 后 /api/daily 仍保留旧数据源 summary/blocked/changes（其中含【完成】条目），
#       因此「只体现阻塞、延期」的断言只针对 text.body，不针对整个 JSON。
# 用法：bash tests/stage15/deploy_check.sh
set -uo pipefail
APP_DIR="${APP_DIR:-/opt/wbs-rongcheng}"
PORT="${HOST_PORT:-4180}"
PUBLIC_HOST="${PUBLIC_HOST:-47.108.129.157}"
LIVE_TMP="${LIVE_TMP:-$APP_DIR/tests/.tmp/stage15-live}"
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "PASS  $1${2:+  :: $2}"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL  $1${2:+  -> $2}"; }
mkdir -p "$LIVE_TMP"

echo "=== Stage15 部署/镜像自检 $(date -Iseconds) ==="
echo "--- 复用部署口径（容器镜像 / 0.0.0.0 绑定 / 双端+公网 health / 无 node_modules / 资源与源码一致） ---"
if bash "$APP_DIR/tests/stage13/deploy_check.sh"; then
  ok "stage13（含 stage9 部署口径）全部通过"
else
  bad "stage13 / stage9 部署口径存在失败项（见上方输出）"
fi

echo "--- CH-13 live 冒烟（日报文本弹层） ---"
TODAY="$(TZ=Asia/Shanghai date +%F)"
DAILY_JSON_PATH="$LIVE_TMP/daily-$TODAY.json"
if curl -fsS "http://127.0.0.1:$PORT/api/daily?tz=Asia/Shanghai&date=$TODAY" -o "$DAILY_JSON_PATH" 2>/dev/null; then
  ok "live /api/daily 可达（HTTP 200，落盘 $DAILY_JSON_PATH）"
else
  bad "live /api/daily 不可达"
fi

SMOKE="$(node -e '
const fs = require("fs");
const p = process.argv[1];
let d = null;
try { d = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { console.log("parse=false"); process.exit(0); }
const t = (d && d.text) || {};
const body = typeof t.body === "string" ? t.body : "";
const lines = Array.isArray(t.lines) ? t.lines : null;
const overview = String(t.overview || "");
const hasText = !!lines && typeof t.body === "string" && typeof t.overview === "string";
const delayedInLines = lines ? lines.filter(function (l) { return l.indexOf("【延期·高风险】") === 0; }).length : -1;
const blockedInLines = lines ? lines.filter(function (l) { return l.indexOf("【阻塞·高风险】") === 0; }).length : -1;
const countMatch = hasText && t.delayedCount === delayedInLines && t.blockedCount === blockedInLines;
const overviewMatch = delayedInLines <= 0 && blockedInLines <= 0
  ? overview === "今日无阻塞、延期。"
  : overview === ("今日延期 " + delayedInLines + " 项 / 阻塞 " + blockedInLines + " 项");
const bodyClean = !/【完成】|【普通】/.test(body);
const legacy = !!d && ["summary", "blocked", "changes", "counts"].every(function (k) { return k in d; });
const flag = function (b) { return b ? "true" : "false"; };
console.log("hasText=" + flag(hasText));
console.log("countMatch=" + flag(countMatch));
console.log("overviewMatch=" + flag(overviewMatch));
console.log("bodyClean=" + flag(bodyClean));
console.log("legacy=" + flag(legacy));
console.log("overview=" + overview);
console.log("counts=" + (delayedInLines + "/" + blockedInLines));
' "$DAILY_JSON_PATH" 2>/dev/null || echo "parse=false")"
smoke_get() { printf '%s\n' "$SMOKE" | sed -n "s/^$1=//p" | tail -1; }

if [ "$(smoke_get hasText)" = true ]; then
  ok "live /api/daily 返回 CH-13 文本体（text.body / text.lines / text.overview / 计数）"
else
  bad "live /api/daily 未返回 CH-13 文本体" "$(smoke_get parse)"
fi
if [ "$(smoke_get countMatch)" = true ]; then
  ok "live 概况行计数 = 事件行数（延期/阻塞 $(smoke_get counts) 项，与 text 计数一致）"
else
  bad "live 概况行计数与事件行数不一致" "overview=$(smoke_get overview) counts=$(smoke_get counts)"
fi
case "$(smoke_get overview)" in
  "今日延期 "*) ok "live 概况行符合契约：$(smoke_get overview)";;
  "今日无阻塞、延期。") ok "live 概况行符合兜底契约：$(smoke_get overview)";;
  *) bad "live 概况行不符合契约" "${SMOKE:-（未取到）}";;
esac
if [ "$(smoke_get bodyClean)" = true ]; then
  ok "live 文本体只体现阻塞、延期（text.body 无「完成 / 普通」事件）"
else
  bad "live text.body 仍含「完成 / 普通」事件（CH-13 未生效）"
fi
if [ "$(smoke_get legacy)" = true ]; then
  ok "live /api/daily 仍保留旧数据源 summary / blocked / changes / counts（服务端汇总逻辑保留）"
else
  bad "live /api/daily 旧数据源结构异常"
fi

HTML="$(curl -fsS "http://127.0.0.1:$PORT/" 2>/dev/null || true)"
for token in 'id="daily-btn"' 'id="daily-panel"' 'id="daily-text"' 'id="daily-copy"' 'id="daily-close"'; do
  if printf '%s' "$HTML" | grep -Fq -- "$token"; then
    ok "live 页面含日报弹层元素 $token"
  else
    bad "live 页面缺日报弹层元素 $token"
  fi
done
STYLES="$(curl -fsS "http://127.0.0.1:$PORT/styles.css" 2>/dev/null || true)"
case "$STYLES" in
  *"white-space: pre-wrap"*) ok "live styles.css 含保留换行的只读文本块样式（pre-wrap）";;
  *) bad "live styles.css 未含 pre-wrap 只读文本块样式";;
esac
echo "---"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
