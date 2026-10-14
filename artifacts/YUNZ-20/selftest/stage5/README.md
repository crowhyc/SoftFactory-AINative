# YUNZ-25 / D-3 缺陷修复自测证据（Stage5）

缺陷：`public/styles.css` 中 `.identity-layer { display:flex }` 的类选择器优先于 UA 的 `[hidden]{display:none}`，
`chooseIdentity()` 仅置 `hidden=true`，真实浏览器里遮罩仍整屏覆盖 → 所有身份都无法进入工作台。

修复：在 `public/styles.css` 基础层（`button, input, select` 规则之后）新增**全局** `[hidden] { display: none !important; }`，
不针对 `#identity-layer` 做补丁式覆盖，所有依赖 `hidden` 属性的元素（`#identity-layer` / `#workbench` /
`#banner` / `#hidden-hint` / `#empty-state` / `#add-row-btn` / `#identity-error` / `#banner-action`）在真实浏览器中统一生效。

改动的文件（逐字一致）：
- 运行产物：`/opt/wbs-rongcheng/public/styles.css`
- 源码快照：`/opt/SoftFactory-AINative/artifacts/YUNZ-20/wbs-rongcheng/public/styles.css`
- 两者 sha256 均为 `53afd03fdf138010247be7f26e2b6092fed920762eb684e010b01c9228f82941`

## 真实浏览器（必测项）如何复现

宿主为 CentOS 7（glibc 2.17），Chromium 140 需要 GLIBC_2.18/2.25，无法在宿主直接运行；
因此浏览器跑在官方镜像 `mcr.microsoft.com/playwright:v1.55.0-jammy`（chromium 140.0.7339.16）容器内，
`--network host` 使其直接访问宿主回环 `127.0.0.1:4180`。宿主未安装任何系统级浏览器组件。

```bash
cd /opt/SoftFactory-AINative/.multica-workspaces/yunzhidian-f03e0d551ffa/yunz-25-f878690fb4ed/workdir
# 修复前（对旧镜像）
docker run --rm --ipc=host --network host -e PHASE=before -e OUTDIR=/work/stage5/out \
  -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.55.0-jammy node /work/stage5/realbrowser.cjs
# 修复后（对 wbs-rongcheng:20261014190527）
docker run --rm --ipc=host --network host -e PHASE=after -e OUTDIR=/work/stage5/out \
  -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.55.0-jammy node /work/stage5/realbrowser.cjs
```

## 结果

| 阶段 | 断言 | 实测关键值 |
|---|---|---|
| 修复前 | FAIL 2.3b / FAIL 3.1；PASS=19 FAIL=2 | 点击「李欢」后 `getComputedStyle(#identity-layer).display = "flex"`、`hidden=true`、rect `1440x900`；`#workbench` rect.y=900（等于视口高度，仍在屏下）；视口中心命中 `#identity-list`（属于遮罩） |
| 修复后 | PASS=21 FAIL=0，pageerror=0，console error=0 | `getComputedStyle(#identity-layer).display = "none"`、rect `0x0`；`#workbench` display=block、rect.y=0、36 行；视口中心命中工作台内的 `td.cell-date` |

文件：
- `realbrowser.cjs` —— 真实浏览器回归脚本（21 项断言：进入前/点击后/九身份切换/权限抽查/无 pageerror）
- `browser/before-run.log`、`browser/after-run.log` —— 完整运行输出
- `browser/realbrowser-before.json`、`browser/realbrowser-after.json` —— 结构化实测数据
- `browser/before-02-workbench-after-click.png` —— 修复前：点击身份后仍停在入口页（遮罩覆盖）
- `browser/after-02-workbench-after-click.png` —— 修复后：工作台可见可交互
- `deploy.log` —— `deploy/deploy.sh` 重新构建并替换容器（含 data/wbs.json 时间戳备份 + health 自检）
- `runtime/served-and-health.txt` —— 服务端实际返回的静态资源 sha256、容器与 health、API 数据 sha256
- `jsdom/` —— 既有 jsdom 回归子集的补充证据（非本次必测项）
