#!/usr/bin/env bash
# YUNZ-37 / 变更包 #7（CH-14 阶段状态占比总览 + GET /api/stats）部署与镜像自检。
# CH-15 同步（YUNZ-39 / 变更包 #8）：顶部形态改为单行全量合并 + 详情只读面板，live 冒烟随之断言
# 「aggregate 全量组合并 + phases 分阶段组并存」，并核对页面「详情」入口 DOM。
# 复用 stage15 → stage13 → stage9 的容器/绑定/health/镜像/资源一致性口径（BIND_HOST=0.0.0.0），
# 并追加 CH-14 live 冒烟：/api/stats 口径、只读语义、页面总览条 DOM 与五色样式。
# 前置：已用 deploy/deploy.sh 重建容器（本脚本只校验运行现场，不重建）。
# 用法：bash tests/stage17/deploy_check.sh
set -uo pipefail
APP_DIR="${APP_DIR:-/opt/wbs-rongcheng}"
PORT="${HOST_PORT:-4180}"
PUBLIC_HOST="${PUBLIC_HOST:-47.108.129.157}"
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "PASS  $1${2:+  :: $2}"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL  $1${2:+  -> $2}"; }

echo "=== Stage17 部署/镜像自检 $(date -Iseconds) ==="
echo "--- 复用 stage9/13/15 部署口径（容器镜像 / 0.0.0.0 绑定 / 本机+0.0.0.0+公网 health / 无 node_modules / 资源与源码一致） ---"
if bash "$APP_DIR/tests/stage15/deploy_check.sh"; then
  ok "stage15（含 stage13 / stage9 部署口径与 CH-13 live 冒烟）全部通过"
else
  bad "stage15 / stage13 / stage9 部署口径存在失败项（见上方输出）"
fi

echo "--- CH-14 live 冒烟（/api/stats 口径 + 只读语义 + 页面总览条） ---"
STATS_JSON="$(curl -fsS "http://127.0.0.1:$PORT/api/stats" 2>/dev/null || true)"
WBS_JSON="$(curl -fsS "http://127.0.0.1:$PORT/api/wbs" 2>/dev/null || true)"
SMOKE="$(node -e '
const PHASE_KEYS = ["design", "dev", "test", "product", "demo_prep"];
const PHASE_ENUM = ["未开始", "已开始", "已完成", "延期", "阻塞"];
let stats = null;
let wbs = null;
try { stats = JSON.parse(process.argv[1]); } catch (e) { stats = null; }
try { wbs = JSON.parse(process.argv[2]); } catch (e) { wbs = null; }
const flag = (b) => (b ? "true" : "false");
const phasesOk = !!stats && Array.isArray(stats.phases) && stats.phases.length === 5 &&
  stats.phases.map((p) => p.key).join(",") === PHASE_KEYS.join(",") &&
  stats.phases.every((p) => Array.isArray(p.statuses) && p.statuses.length === 5 &&
    p.statuses.map((s) => s.value).join(",") === PHASE_ENUM.join(","));
const sumOk = phasesOk && stats.phases.every((p) => {
  const sum = p.statuses.reduce((a, s) => a + s.percentage, 0);
  const counts = p.statuses.reduce((a, s) => a + s.count, 0);
  return Math.abs(sum - 100) < 1e-9 && counts === stats.total;
});
const countsOk = !!wbs && phasesOk && stats.total === wbs.tasks.length &&
  PHASE_KEYS.every((key, index) => PHASE_ENUM.every((value, j) => {
    const c = wbs.tasks.filter((t) => t.phases && t.phases[key] === value).length;
    return c === stats.phases[index].statuses[j].count;
  }));
const revisionOk = !!wbs && !!stats && stats.revision === wbs.meta.revision;
const aggOk = !!stats && !!stats.aggregate && Array.isArray(stats.aggregate.statuses) && stats.aggregate.statuses.length === 5 &&
  stats.aggregate.denominator === stats.total * 5 && phasesOk &&
  Math.abs(stats.aggregate.statuses.reduce((a, s) => a + s.percentage, 0) - 100) < 1e-9 &&
  stats.aggregate.statuses.map((s) => s.value).join(",") === PHASE_ENUM.join(",") &&
  PHASE_ENUM.every((v, j) => stats.aggregate.statuses[j].count === stats.phases.reduce((a, p) => a + p.statuses[j].count, 0));
const map = {};
if (phasesOk) stats.phases.forEach((p) => p.statuses.forEach((s) => { map[s.value] = (s.count + " " + s.percentage.toFixed(1) + "%"); }));
console.log("phasesOk=" + flag(phasesOk));
console.log("sumOk=" + flag(sumOk));
console.log("countsOk=" + flag(countsOk));
console.log("revisionOk=" + flag(revisionOk));
console.log("aggOk=" + flag(aggOk));
console.log("aggDenominator=" + (stats && stats.aggregate ? stats.aggregate.denominator : "null"));
console.log("total=" + (stats ? stats.total : "null"));
console.log("design=" + (map["未开始"] || "-") + "|" + (map["已开始"] || "-") + "|" + (map["已完成"] || "-") + "|" + (map["延期"] || "-") + "|" + (map["阻塞"] || "-"));
' "$STATS_JSON" "$WBS_JSON" 2>/dev/null || echo "parse=false")"
smoke_get() { printf '%s\n' "$SMOKE" | sed -n "s/^$1=//p" | tail -1; }

if [ "$(smoke_get phasesOk)" = true ]; then
  ok "live /api/stats 结构为五阶段 × 五状态（固定顺序 未开始/已开始/已完成/延期/阻塞）"
else
  bad "live /api/stats 结构不符" "$(smoke_get parse)${SMOKE:0:120}"
fi
if [ "$(smoke_get countsOk)" = true ]; then
  ok "live /api/stats 的 count 与 /api/wbs 逐阶段独立复算一致（任务总数 $(smoke_get total)）"
else
  bad "live /api/stats 的 count 与 /api/wbs 不一致"
fi
if [ "$(smoke_get sumOk)" = true ]; then
  ok "live 每阶段五项合计恰为 100.0%（分母 = 任务总数，最大余数法补齐）"
else
  bad "live 存在阶段五项合计 ≠ 100.0%"
fi
if [ "$(smoke_get revisionOk)" = true ]; then
  ok "live /api/stats 与 /api/wbs 读同一份文档（revision 一致）"
else
  bad "live /api/stats revision 与 /api/wbs 不一致"
fi
if [ "$(smoke_get aggOk)" = true ]; then
  ok "live /api/stats 同时给出 aggregate（分母 = 任务总数 × 5 = $(smoke_get aggDenominator)，五状态合计 100.0%，计数 = 五阶段同状态之和）与 phases 分阶段两组结果"
else
  bad "live /api/stats 的 aggregate 口径不符"
fi
echo "     设计阶段样例：$(smoke_get design)"

STATS_STATUS="$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/api/stats" 2>/dev/null || true)"
if [ "$STATS_STATUS" = "405" ]; then
  ok "live /api/stats 仅接受 GET（POST → 405，无写入路径）"
else
  bad "live /api/stats 对 POST 返回 $STATS_STATUS（应为 405）"
fi
STATS_DISPOSITION="$(curl -fsSI -X GET "http://127.0.0.1:$PORT/api/stats" 2>/dev/null | grep -i '^content-disposition' || true)"
if [ -z "$STATS_DISPOSITION" ]; then
  ok "live /api/stats 不构成下载路径（无 Content-Disposition）"
else
  bad "live /api/stats 返回了 Content-Disposition" "$STATS_DISPOSITION"
fi

INDEXHTML="$(curl -fsS "http://127.0.0.1:$PORT/" 2>/dev/null || true)"
APPJS="$(curl -fsS "http://127.0.0.1:$PORT/app.js" 2>/dev/null || true)"
STYLES="$(curl -fsS "http://127.0.0.1:$PORT/styles.css" 2>/dev/null || true)"
for token in 'id="phase-overview"' 'id="overview-rows"' 'id="overview-total"' 'id="overview-detail-btn"' 'id="overview-detail-panel"'; do
  if printf '%s' "$INDEXHTML" | grep -Fq -- "$token"; then
    ok "live 页面含总览条 DOM $token"
  else
    bad "live 页面缺总览条 DOM $token"
  fi
done
case "$APPJS" in
  *"/api/stats"*"refreshOverview"*"overview-badge"*"renderOverviewDetail"*"openOverviewDetail"*)
    ok "live app.js 含 CH-14 / CH-15 统计实现（/api/stats 读取 + 刷新 + 全量/详情徽标渲染，原样渲染服务端口径）";;
  *) bad "live app.js 未含 CH-14 / CH-15 统计实现";;
esac
BLOCK="$(printf '%s' "$APPJS" | sed -n '/CH-14 \/ CH-15 全量统计/,/function bindEvents/p')"
if [ -z "$BLOCK" ]; then
  bad "live app.js 未定位到 CH-14 / CH-15 统计代码块"
elif printf '%s' "$BLOCK" | grep -Eq '\.filter\(|\.reduce\(|Math\.(round|floor|ceil)'; then
  bad "live CH-14 总览代码块内出现本地统计痕迹（filter / reduce / Math 取整）"
else
  ok "live CH-14 总览代码块不含任何本地统计（无 filter / reduce / Math 取整，只做字符串渲染）"
fi
case "$STYLES" in
  *".overview-badge.phase-未开始"*".overview-badge.phase-阻塞"*) ok "live styles.css 含总览徽标五色映射（与表格阶段控件同色）";;
  *) bad "live styles.css 未含总览徽标五色映射";;
esac
case "$STYLES" in
  *"flex-wrap: wrap"*) ok "live styles.css 含总览换行样式（窄屏自然换行）";;
  *) bad "live styles.css 未含总览换行样式";;
esac

echo "---"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
