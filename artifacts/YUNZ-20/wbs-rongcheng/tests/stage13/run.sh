#!/usr/bin/env bash
# YUNZ-33 / 变更包 #5（CH-11 今日摘要仅 A 列 + CH-12 日报删除「当日变更」sheet）真实浏览器自测运行器。
#
# 宿主为 CentOS 7（glibc 2.17），无法直接运行 playwright 的 Chromium，因此浏览器跑在官方镜像
# mcr.microsoft.com/playwright:v1.55.0-jammy（chromium 140）内；宿主不安装任何系统级浏览器组件。
# 被测服务（server.js，Node 标准库）与浏览器同处一个容器、使用隔离数据目录，因此不需要 --network host，
# 也不会触碰运行现场 /opt/wbs-rongcheng/data 与 0.0.0.0:4180。
#
# 前置：docker image 已缓存（mcr.microsoft.com/playwright:v1.55.0-jammy）与 tests/.tools 已装 playwright@1.55.0。
# 用法：bash tests/stage13/run.sh [输出目录]
set -uo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
TOOLS_DIR="${TOOLS_DIR:-$APP_DIR/tests/.tools}"
IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.55.0-jammy}"
PORT="${WBS_TEST_PORT:-4260}"
DATA_DIR="${DATA_DIR:-$APP_DIR/tests/.tmp/stage13-browser-data}"
OUT="${1:-$APP_DIR/tests/.tmp/stage13-out}"

mkdir -p "$OUT" "$DATA_DIR"

echo "[stage13] 运行 Chromium 容器（真实浏览器断言，隔离数据目录 $DATA_DIR）"
docker run --rm --ipc=host \
  -e APP_DIR=/app \
  -e OUTDIR=/app/tests/.tmp/stage13-out \
  -e DATA_DIR=/data \
  -e TOOLS=/tools \
  -e WBS_TEST_PORT="$PORT" \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "$APP_DIR":/app \
  -v "$TOOLS_DIR":/tools \
  -v "$DATA_DIR":/data \
  -w /app \
  "$IMAGE" node /app/tests/stage13/browser.cjs
RC=$?

echo "[stage13] 容器退出码 $RC；输出目录 $OUT"
exit "$RC"
