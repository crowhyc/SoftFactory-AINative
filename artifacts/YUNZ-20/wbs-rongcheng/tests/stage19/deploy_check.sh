#!/usr/bin/env bash
# YUNZ-39 / 变更包 #8（CH-15 全量统计 + 分阶段详情 + 产品验收改名）部署与镜像自检。
# 复用 stage17 → stage15 → stage13 → stage9 的容器 / 绑定 / health / 镜像 / 资源一致性口径（BIND_HOST=0.0.0.0），
# 并追加 CH-15 live 冒烟：aggregate 全量口径、详情面板 DOM、阶段显示名改名（无旧标签残留）+ live 页面取证。
# 前置：已用 deploy/deploy.sh 重建容器（本脚本只校验运行现场，不重建）。
# 用法：bash tests/stage19/deploy_check.sh
set -uo pipefail
APP_DIR="${APP_DIR:-/opt/wbs-rongcheng}"
PORT="${HOST_PORT:-4180}"
PUBLIC_HOST="${PUBLIC_HOST:-47.108.129.157}"
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "PASS  $1${2:+  :: $2}"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL  $1${2:+  -> $2}"; }

echo "=== Stage19 部署/镜像自检 $(date -Iseconds) ==="
echo "--- 复用 stage17 / stage15 / stage13 / stage9 部署口径（容器镜像 / 0.0.0.0 绑定 / 本机+0.0.0.0+公网 health / 无 node_modules / 资源与源码一致） ---"
if bash "$APP_DIR/tests/stage17/deploy_check.sh"; then
  ok "stage17（含 stage15 / stage13 / stage9 部署口径与 CH-14 / CH-15 总览 live 冒烟）全部通过"
else
  bad "stage17 / stage15 / stage13 / stage9 部署口径存在失败项（见上方输出）"
fi

echo "--- CH-15 live 冒烟（aggregate 全量口径 + 分阶段 phases + 改名 + 详情面板 DOM） ---"
STATS_JSON="$(curl -fsS "http://127.0.0.1:$PORT/api/stats" 2>/dev/null || true)"
SMOKE="$(node -e '
const PHASE_KEYS = ["design", "dev", "test", "product", "demo_prep"];
const PHASE_ENUM = ["未开始", "已开始", "已完成", "延期", "阻塞"];
const NAMES = ["设计", "开发", "测试", "产品验收", "演示准备"];
let stats = null;
try { stats = JSON.parse(process.argv[1]); } catch (e) { stats = null; }
const flag = (b) => (b ? "true" : "false");
const phasesOk = !!stats && Array.isArray(stats.phases) && stats.phases.length === 5 &&
  stats.phases.map((p) => p.key).join(",") === PHASE_KEYS.join(",") &&
  stats.phases.map((p) => p.name).join(",") === NAMES.join(",");
const aggOk = phasesOk && stats.aggregate && Array.isArray(stats.aggregate.statuses) && stats.aggregate.statuses.length === 5 &&
  stats.aggregate.denominator === stats.total * 5 && stats.aggregate.statuses.map((s) => s.value).join(",") === PHASE_ENUM.join(",") &&
  Math.abs(stats.aggregate.statuses.reduce((a, s) => a + s.percentage, 0) - 100) < 1e-9 &&
  PHASE_ENUM.every((v, j) => stats.aggregate.statuses[j].count === stats.phases.reduce((a, p) => a + p.statuses[j].count, 0));
const phaseSumOk = phasesOk && stats.phases.every((p) =>
  Math.abs(p.statuses.reduce((a, s) => a + s.percentage, 0) - 100) < 1e-9 &&
  p.statuses.reduce((a, s) => a + s.count, 0) === stats.total);
console.log("phasesOk=" + flag(phasesOk));
console.log("aggOk=" + flag(aggOk));
console.log("phaseSumOk=" + flag(phaseSumOk));
console.log("total=" + (stats ? stats.total : "null"));
console.log("denominator=" + (stats && stats.aggregate ? stats.aggregate.denominator : "null"));
console.log("names=" + (phasesOk ? stats.phases.map((p) => p.name).join("/") : "-"));
' "$STATS_JSON" 2>/dev/null || echo "parse=false")"
smoke_get() { printf '%s\n' "$SMOKE" | sed -n "s/^$1=//p" | tail -1; }

if [ "$(smoke_get aggOk)" = true ]; then
  ok "live /api/stats.aggregate 全量口径：五阶段合并、分母 = 任务总数 × 5 = $(smoke_get denominator)、五状态顺序固定、合计 100.0%、计数 = 五阶段同状态之和"
else
  bad "live /api/stats.aggregate 口径不符" "$(smoke_get parse)${SMOKE:0:140}"
fi
if [ "$(smoke_get phasesOk)" = true ]; then
  ok "live /api/stats.phases 分阶段口径不回归，且阶段显示名 = $(smoke_get names)（接口 key 仍为 product）"
else
  bad "live /api/stats.phases 结构 / 阶段显示名不符"
fi
if [ "$(smoke_get phaseSumOk)" = true ]; then
  ok "live 每阶段五项合计恰为 100.0%（分母 = 任务总数 = $(smoke_get total)，CH-14 口径不回归）"
else
  bad "live 存在阶段五项合计 ≠ 100.0%"
fi

INDEXHTML="$(curl -fsS "http://127.0.0.1:$PORT/" 2>/dev/null || true)"
APPJS="$(curl -fsS "http://127.0.0.1:$PORT/app.js" 2>/dev/null || true)"
DAILY="$(curl -fsS "http://127.0.0.1:$PORT/api/daily?tz=Asia%2FShanghai" 2>/dev/null || true)"
# 说明：以下文本断言一律用 shell 内建 case 匹配（而非 printf | grep -q），
# 避免 `set -o pipefail` 下大文本管道被 SIGPIPE 提前关闭而产生假阴性。
for token in 'id="overview-detail-btn"' 'id="overview-detail-panel"' 'id="overview-detail-rows"' 'id="overview-detail-close"' 'id="overview-detail-total"'; do
  case "$INDEXHTML" in
    *"$token"*) ok "live 页面含详情面板 DOM $token";;
    *) bad "live 页面缺详情面板 DOM $token";;
  esac
done
case "$INDEXHTML" in
  *'<th class="col-date">产品验收</th>'*) ok "live 页面阶段列头第 9 列已改名「产品验收」（其余阶段列头不变）";;
  *) bad "live 页面阶段列头未改名";;
esac
case "$INDEXHTML" in
  *'全部五阶段合并'*)
    case "$INDEXHTML" in
      *'各阶段状态占比'*) bad "live 顶部仍残留旧 CH-14 统计标题「各阶段状态占比」";;
      *) ok "live 顶部标题为「全部五阶段合并」全量统计（旧的 CH-14 统计标题「各阶段状态占比」已移除）";;
    esac;;
  *) bad "live 顶部标题未切换为全量统计";;
esac
CH15_MISSING=""
for token in '产品验收进度' 'aggregate' 'renderOverviewDetail' 'openOverviewDetail' 'overview-detail-panel'; do
  case "$APPJS" in
    *"$token"*) ;;
    *) CH15_MISSING="$CH15_MISSING $token";;
  esac
done
if [ -n "$CH15_MISSING" ]; then
  bad "live app.js 未含 CH-15 详情面板实现" "缺：$CH15_MISSING"
else
  case "$APPJS" in
    *"'产品进度'"*) bad "live app.js 仍残留旧导出表头「产品进度」";;
    *) ok "live app.js 已改名（导出表头 产品验收进度）且含 CH-15 详情面板实现（aggregate / phases 两组只读渲染）";;
  esac
fi
for stale in '产品延期' '产品阻塞' '产品已完成' '产品更新为阻塞' '产品进度'; do
  case "$APPJS" in
    *"$stale"*) bad "live app.js 残留旧阶段标签" "$stale";;
    *) ok "live app.js 无旧阶段标签「$stale」";;
  esac
done
case "$DAILY" in
  *'产品验收'*) ok "live /api/daily 文本阶段结论已用新标签「产品验收」";;
  *) ok "live /api/daily 文本当前无产品阶段结论（阶段显示名映射由 /api/stats.phases[3].name 断言）";;
esac
STALE_DAILY=""
for stale in '产品延期' '产品阻塞' '产品已完成' '产品更新为阻塞'; do
  case "$DAILY" in
    *"$stale"*) STALE_DAILY="$STALE_DAILY $stale";;
  esac
done
if [ -n "$STALE_DAILY" ]; then
  bad "live /api/daily 文本残留旧阶段标签" "$STALE_DAILY"
else
  ok "live /api/daily 文本无旧阶段标签（产品延期 / 产品阻塞 / 产品已完成 / 产品更新为阻塞）"
fi

echo "--- CH-15 live 页面取证（真实 Chromium 打开 127.0.0.1:4180，只读） ---"
LIVE_DIR="$APP_DIR/tests/.tmp/stage19-live"
mkdir -p "$LIVE_DIR"
if docker run --rm --network host \
  -e SHOT_DIR=/out -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "$APP_DIR":/app -v "$APP_DIR/tests/.tools":/tools -v "$LIVE_DIR":/out \
  mcr.microsoft.com/playwright:v1.55.0-jammy node /app/tests/stage19/live_shot.cjs > "$LIVE_DIR/live-shot.log" 2>&1; then
  ok "live 页面取证：全量统计 / 详情面板（开→Esc 关）/ 桌面 1600 与 375px 与 /api/stats 零差异（详见 $LIVE_DIR/live-shot.log）"
else
  bad "live 页面取证失败" "$(tail -3 "$LIVE_DIR/live-shot.log" 2>/dev/null | tr '\n' ' ')"
fi

echo "---"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
