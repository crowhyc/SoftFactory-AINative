# YUNZ-27 / Stage7 变更包 #2 作者自测证据

变更包：CH-1 操作列 / CH-2 日期与状态常显 / CH-3 负责人池化 / CH-4 新增人员 / CH-5 日报导出。
被测运行现场：`/opt/wbs-rongcheng/`（容器 `wbs-rongcheng`，`127.0.0.1:4180`）。

## 一、怎么复现（全部自测都是可复跑脚本）

```bash
cd /opt/wbs-rongcheng

# A. 新增自测矩阵 01–12（真实浏览器 + 服务端历史接口）
bash tests/verify_stage7.sh                 # 输出 tests/.tmp/stage7/，逐项日志 + matrix-summary.txt

# B. 既有 18 项矩阵 + 容器部署/回滚附加项（回归）
bash tests/verify.sh                        # 输出 tests/.tmp/outputs/

# C. 单独跑浏览器用例集（Chromium 容器，隔离数据）
bash tests/stage7/run.sh                    # 输出 tests/.tmp/stage7-out/

# D. 单独跑服务端 / 历史接口用例集（Node 标准库）
node tests/stage7_server_check.js
```

## 二、真实浏览器为什么在容器里跑

宿主为 CentOS 7（glibc 2.17），playwright 的 Chromium 140 需要更新的 glibc，**宿主无法直接运行**，
因此浏览器跑在官方镜像 `mcr.microsoft.com/playwright:v1.55.0-jammy`（chromium 140.0.7339.16）内；
宿主未安装任何系统级浏览器组件，也没有安装进产物或镜像。

被测服务（`server.js`，纯 Node 标准库）与浏览器**同处一个容器**，使用隔离数据目录
（`tests/.tmp/stage7-browser-data`），因此不需要 `--network host`，也不会触碰运行现场
`/opt/wbs-rongcheng/data` 与 `127.0.0.1:4180`。

前置：`docker pull mcr.microsoft.com/playwright:v1.55.0-jammy`（本机已缓存），以及测试工具目录
已装 playwright（**不进源码快照、不进镜像**）：

```bash
cd /opt/wbs-rongcheng/tests/.tools && npm i playwright@1.55.0 --ignore-scripts
```

## 三、证据索引

| 文件 | 说明 |
|---|---|
| `matrix-summary.txt` | 新增矩阵 01–12 逐项结论 |
| `browser.log` | 真实 Chromium 用例集完整输出（48 项断言，PASS=48 / FAIL=0，无 pageerror / console error） |
| `server.log` | 服务端与 `/api/history` 用例集完整输出（12 项断言，PASS=12 / FAIL=0） |
| `01.log` … `12.log` | 新增矩阵逐项关键断言留档 |
| `browser/browser-results.json` | 浏览器用例集结构化实测数据 |
| `browser/pm-workbench.png` | 项目负责人视角：常显日期/状态控件、操作列「编辑+删除」 |
| `browser/identity-layer-after-add.png` | 返回首页后身份列表含新增人员 |
| `browser/蓉城战役日报-20261014.xlsx` | 页面「导出日报」真实产物（两个 sheet） |
| `browser/蓉城战役WBS-20261014.xlsx` | 页面「导出 Excel」真实产物（A–K 保真、不含 status） |
| `browser/wbs-at-export.json` | 导出时刻的数据快照（供 `export_verify.py` 独立读回比对） |
| `legacy-matrix/` | 既有 18 项矩阵 + 部署/回滚附加项完整回归输出（24 项全通过） |
| `runtime-served-and-health.txt` | 部署后容器/镜像/health/回环绑定/静态资源与镜像内源码 sha256 比对 |
| `scripts/` | 上述自测脚本留档（与 `/opt/wbs-rongcheng/tests/` 逐字一致） |

## 四、实现要点与口径

- **CH-1** 操作列每行常显「编辑」（点击进入/退出该行行编辑态：可编辑文本列常显编辑器，按钮变「完成」）；
  「删除」仅项目负责人可见，确认框取消/确认两条路径都保留。
- **CH-2** 设计/开发/测试/产品/演示准备五列常显 `<input type=date>`；状态列常显五枚举 `<select>`（并保留状态徽标）；
  无权限行控件 `disabled`（选项集合不变），并用 `pointer-events:none` 让点击落到单元格，保留「点击只读单元格给中文提示」。
- **CH-3** 负责人列为下拉、选项＝当前人员池；仅项目负责人可改派，普通负责人为只读文本 + 点击提示。
- **CH-4** 身份选择页与工作台（项目负责人）均有「新增人员」入口；校验非空/去重/长度 1–20 并给中文提示；
  新增后立即同步身份切换、负责人下拉、筛选下拉；`persistIdentities()` 复用既有 `PUT /api/wbs`
  （原子写 + `If-Match` 版本保护 + 409 重试），不携带未保存的任务草稿；顶栏「返回首页」可在保留身份的前提下回入口页（列表同步）。
- **CH-5** 「导出日报」在原「导出 Excel」旁；单个 workbook 两个 sheet：`阻塞与延期`（status ∈ {被阻塞, 已延期}，A–K + 状态）、
  `当日变更`（每行 = 一个被改动的字段：id/一级/二级/任务项/负责人/改动字段/旧值/新值/时间/操作身份）；
  文件名 `蓉城战役日报-YYYYMMDD.xlsx`；浏览器本地生成，仍用随包 `xlsx.full.min.js`，无新增依赖、不联网。
  服务端 `audit.log` 每条记录扩展 `old`/`new` 映射与改动后快照；新增
  `GET /api/history?date=YYYY-MM-DD&tz=Asia/Shanghai`（160→200），自然日口径 `[00:00:00, 次日 00:00:00)`，
  旧格式（无 `old`/`new`）行与损坏行跳过、不报错。原 WBS 导出仍不含 `status`。

## 五、与既有自测脚本的必要同步（协调后的口径变更，非放宽断言）

1. `tests/domcheck.mjs` 矩阵1：行内取值改为「控件 value 优先」读取（负责人/状态已由变更包改为下拉/常显控件）。
2. `tests/selfcheck.js` 矩阵3/6：原断言 `audit 不应记录值` 被变更包 **CH-5 明确取代**（audit 必须带 `old`/`new` 以支撑日报），
   改为断言 `old`/`new` 映射与改动后值。
3. `tests/deploy_selftest.sh` 回环绑定检查：只统计 `LISTEN`（`state=0A`）套接字。
   现场 `ss -ltn` 观察到同端口 `TIME-WAIT`（uid=0、inode=0，非本容器套接字）会被旧写法误判为监听；
   本容器套接字只有 `127.0.0.1:4180`（LISTEN，uid=1000），宿主无非回环监听。
4. 钉死的其余既有断言（D-1/D-2/D-3、验收 1–10）未改动，24 项回归全通过。

## 六、已知限制

- `阻塞与延期`/`当日变更` 两个 sheet 为纯数据表（无冻结行、无样式模板）；日报不套用原模板。
- `当日变更` 以 `audit.log` 为准：只覆盖本服务（单实例）写过的保存；旧格式历史行无字段级明细，按「无明细」跳过。
- 浏览器用例集依赖本地已缓存的 playwright 镜像与 `tests/.tools` 里的 playwright 包（均为测试工具，不进产物）。
