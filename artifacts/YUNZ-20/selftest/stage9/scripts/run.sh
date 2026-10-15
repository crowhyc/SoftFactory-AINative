#!/usr/bin/env bash
# YUNZ-29 / 变更包 #3：CH-8 真实浏览器（Chromium）自测运行器。
#
# 宿主为 CentOS 7（glibc 2.17），无法直接运行 playwright 的 Chromium，因此浏览器跑在官方镜像
# mcr.microsoft.com/playwright:v1.55.0-jammy（chromium 140.0.7339.16）内；宿主不安装任何系统级浏览器组件。
# 被测服务（server.js，Node 标准库）与浏览器同处一个容器、使用隔离数据目录，因此不需要 --network host，
# 也不会触碰运行现场 /opt/wbs-rongcheng/data 与 0.0.0.0:4180。
#
# 前置：
#   1) docker image 存在：docker pull mcr.microsoft.com/playwright:v1.55.0-jammy（本机已缓存）
#   2) 测试工具目录已装 playwright@1.55.0（不进源码快照）：cd tests/.tools && npm i playwright@1.55.0 --ignore-scripts
# 用法：bash tests/stage9/run.sh [输出目录]
set -uo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
TOOLS_DIR="${TOOLS_DIR:-$APP_DIR/tests/.tools}"
IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.55.0-jammy}"
PORT="${WBS_TEST_PORT:-4224}"
DATA_DIR="${DATA_DIR:-$APP_DIR/tests/.tmp/stage9-browser-data}"
OUT="${1:-$APP_DIR/tests/.tmp/stage9-out}"

mkdir -p "$OUT" "$DATA_DIR"

echo "[stage9] 运行 Chromium 容器（真实浏览器断言，隔离数据目录 $DATA_DIR）"
docker run --rm --ipc=host \
  -e APP_DIR=/app \
  -e OUTDIR=/app/tests/.tmp/stage9-out \
  -e DATA_DIR=/data \
  -e TOOLS=/tools \
  -e WBS_TEST_PORT="$PORT" \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "$APP_DIR":/app \
  -v "$TOOLS_DIR":/tools \
  -v "$DATA_DIR":/data \
  -w /app \
  "$IMAGE" node /app/tests/stage9/browser.cjs
RC=$?

echo "[stage9] 容器退出码 $RC；输出目录 $OUT"
exit "$RC"
