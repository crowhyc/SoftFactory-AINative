# YUNZ-17 独立复验报告：YUNZ-10 当前交付版本（升级验收标准）

- 任务：`YUNZ-17`（父任务 `YUNZ-16`）；角色：独立验证工程师（AI-QV）
- 被验证对象：`/opt/SoftFactory-AINative/artifacts/YUNZ-10/` 当前交付版本（`README.md`、`app.py`、`index.html`、`data.json`、`verify_e2e.sh`、`selftest_output.txt`、`e2e_output.txt`、`SHA256SUMS`）及其契约
- 核对时间：2026-10-08T11:49+08:00（本轮三链锁定见 `version-lock.txt`）
- 结论：**不通过**

## 1. 核查内容与方法

所有运行、自测、交互验证均在**临时目录副本 + 临时数据文件**上执行；`/opt/SoftFactory-AINative/artifacts/YUNZ-10/`、`YUNZ-14/`、`YUNZ-15/` 全程只读（复验结束后再次 `sha256sum -c SHA256SUMS` 仍 7/7 OK）。

1. **版本锁定（三链）**：磁盘现场 sha256 / 目录 `SHA256SUMS` / 资产库 git HEAD(`1030e37`) 提交版本 blob sha256 三者逐文件一致（`threchain_check_output.txt`，`THREE-CHAIN CONSISTENT: True`）。
2. **回归**：`python3 app.py --selftest` → `SELFTEST 33/33 PASSED` exit 0（`selftest_output.txt`）；FAIL 路径经注入式断言翻转后 exit 1（`selftest_failpath_output.txt`）；`bash verify_e2e.sh` → `E2E 28/28 PASSED` exit 0（`e2e_output.txt`）。
3. **API 契约 / 汇总 / 数据不丢失 / 原子写 / 纯标准库**：自写独立脚本（不复用作者脚本）`api_regression_independent.py` → `API_REGRESSION 29/29 PASSED`（`api_regression_independent_output.txt`）。
4. **交互级验证（必备）**：Node v24 + `jsdom`（装在工作目录内，非系统级），对 `GET /` 实际下发的 `index.html` 脚本构造 DOM，连真实 `python3 app.py`（本机 node 为 docker 包装容器，经 docker 网关 `172.18.0.1` 回连宿主服务；数据文件置于工作目录内供容器读取），每步操作后用 `/api` 与磁盘 JSON 双端核对。脚本 `interaction_verify.mjs` + 运行器 `run_interaction.sh` → `INTERACTION 41/43 PASSED`（`interaction_output.txt`，DOM 快照 `dom-snapshot-after-interactions.html`）。

## 2. 关键结果

| 项 | 结果 |
|---|---|
| 页面加载与渲染 / 新增 / 经「编辑」改名称 / 改数量 / 取消 / 删除 | 全部 PASS（页面显示、`GET /api/items`、磁盘 JSON 三者一致） |
| 空输入、非法输入（空名称、负数量、数量非数字） | PASS（明确报错且无写入） |
| 既有条目、条目额外字段、未知顶层键经连续增删改后保留 | PASS |
| 原子写（无 `.data-*.tmp` 残留）、纯标准库（无第三方导入）、无外部 URL | PASS |
| D-2（交付目录与自身 `SHA256SUMS` 一致） | 已修复，本轮 7/7 OK，**不复现** |
| D-1（点击展示态单元格无反馈） | 已由「提示」方案修复，反馈存在 |
| **本轮新增要求 A（直接点击「类别」单元格进入行内编辑态）** | **FAIL** |
| 本轮新增要求 B（编辑态取消不写入） / C（名称·数量保留现状） / D（汇总只读且有提示） | PASS |
| 本轮新增要求 E（无静默数据丢失） | PASS（编辑某行时点击他行「类别」单元格，本行编辑态与未保存输入均保留，无写入、无隐式切换） |

## 3. 缺陷与残余风险

### 缺陷 D-1（本轮）：直接点击「类别」单元格不进入行内编辑态，仅给出提示

- 严重度：高
- 复现路径：启动 `python3 app.py` → 浏览器打开 `GET /` → 在「物品清单」中直接点击任一行「类别」列的展示态单元格 → 观察该行是否出现编辑输入控件。
- 期望行为：按本轮验收要求 A，点击「类别」单元格应**进入行内编辑态**（出现可编辑输入控件），可修改并在保存后生效。
- 实际行为：不进入编辑态；只显示提示「提示：请点该行的「编辑」按钮修改名称 / 类别 / 数量」。`index.html` 的 `#items-body` 点击代理对全部展示态 `td`（含类别）统一走提示分支，未对「类别」单元格做行内编辑特例。
- 影响范围：本轮新增验收要求 A 未满足；用户无法像 Sponsor 要求的那样直接点击「类别」单元格就地修改。名称 / 数量 / id 单元格按 C 属可接受现状，不受影响。
- 建议修复位置：`/opt/SoftFactory-AINative/artifacts/YUNZ-10/index.html`，`#items-body` 点击代理（`byId('items-body').addEventListener('click', ...)`，约第 294–303 行）；展示态行渲染 `renderItems()` 中类别单元格分支（约第 124–128 行）。
- 定级理由：非「发现性/反馈」类问题——反馈已存在；此处缺失的是被明确写为「必须」的验收功能本身，直接导致本轮结论不能判「通过」，需改实现而非仅调文案，故定「高」。

### 残余风险 / 待决项

- 若后续按要求 A 实现「点击类别单元格即进入编辑态」，需同时保证要求 E：用户正在编辑 A 行时点击 B 行「类别」单元格不得隐式切换编辑目标、不得静默丢弃 A 行未保存改动（当前实现因「点击不进入编辑态」而不存在该风险，实现变更后须重新验证）。
- 本机无真实浏览器（Chromium/Playwright 均不可用），交互级验证以 Node v24 + `jsdom` 完成；`jsdom` 与真实浏览器在默认行为（如 `type=number` 的输入约束、原生 `confirm`）上可能存在差异，`confirm` 已在 harness 中显式桩化为「确认」。此为验证手段的已知局限，非交付物缺陷。
- 现场未发现他人启动的残留 `app.py` 服务进程；harness 每次运行自行启动并回收其服务进程。

## 4. 证据清单

| 文件 | 说明 |
|---|---|
| `version-lock.txt` | 三链版本锁定与核对时间 |
| `threchain_check.py` / `threchain_check_output.txt` | 三链一致性自动核对输出 |
| `selftest_output.txt` | `--selftest` 33/33 输出 |
| `selftest_failpath_output.txt` | FAIL 路径注入验证（exit 1） |
| `e2e_output.txt` | `verify_e2e.sh` 28/28 输出 |
| `api_regression_independent.py` / `api_regression_independent_output.txt` | 独立 API 契约 / 汇总 / 数据不丢失 / 原子写 / 纯标准库复跑（29/29） |
| `interaction_verify.mjs` / `run_interaction.sh` / `interaction_output.txt` | 交互级验证脚本与输出（41/43） |
| `dom-snapshot-after-interactions.html` | 交互后 DOM 快照 |
| `interaction_server.log` / `interaction_final_data.json` | 交互验证用真实服务日志与最终磁盘数据 |
| `EVIDENCE-SHA256SUMS` | 上述证据文件 sha256 |
