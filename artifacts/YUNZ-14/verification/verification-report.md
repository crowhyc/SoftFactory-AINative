# YUNZ-14 独立复验报告：清单管理小应用（按升级后的验证标准，含交互级验证）

- 验证任务：`YUNZ-14`（独立复验，AI-QV / 独立验证工程师）
- 被验证对象：父任务 `YUNZ-13`（原请求见其描述）所指的 `YUNZ-10` Stage 1 交付，目录 `/opt/SoftFactory-AINative/artifacts/YUNZ-10/`
- 验证时间（UTC）：2026-09-30T06:07Z ~ 06:16Z
- 验证环境：Python 3.6.8；`node`/`npm` 为本机 docker 包装脚本（`docker run -v "$PWD:$PWD" node:24-slim`，容器内 node v24.21.0），`jsdom@30.1.1` 装在工作目录内；**无 Chromium/Chrome/Firefox/Playwright/Puppeteer**（见 `env_facts.txt`）
- 独立性声明：本报告全部结论基于验证方**自研脚本**的复跑结果与自建 DOM 环境；被验证方随附输出仅作对照，不作为证据。
- 本轮验证范围：`/opt/SoftFactory-AINative/artifacts/YUNZ-10/` 内第一轮交付的 `app.py`、`index.html`、`README.md`、`data.json`、`verify_e2e.sh` 及其契约，不扩大到其它任务产物。

## 0. 结论

**不通过。**

- 功能与契约层面**全部通过**：API 契约回归 54/54、`--selftest` 33/33（exit 0）、作者 `verify_e2e.sh` 28/28（exit 0）、`--selftest` FAIL 路径 exit 1、纯标准库与原子写/数据保全全部成立。
- 交互级（DOM 级）验证**已完成并通过大部分矩阵**（27/32）：加载渲染、新增、三字段编辑保存、取消、删除（含确认）、空/非法输入、转义对抗均通过。
- 但本轮约定的**典型用户路径对抗**（本轮重点）产生 5 例失败：直接点击展示单元格/汇总行**既无编辑响应也无任何提示**，属可发现性/反馈类 **UX 缺陷（中）**（缺陷 D-1）。另有交付目录与自身 `SHA256SUMS` 不一致的完整性问题（缺陷 D-2，低）。
- 按本轮约定「发现功能缺陷或交互级失败时判『不通过』」，结论为**不通过**；本任务保持 `待验收 in_review`，由协调员按缺陷回路创建「修复 → 复验」子任务。

## 1. 交付物核验（两条证据链 + 哈希，核对时间 2026-09-30T06:09Z）

git HEAD（`main`）= `77b1d8d24a597b827518d7105c130906d0ea9f30`；交付提交 = `937b983`。

| 交付物 | 磁盘现场 sha256 | git HEAD 提交版本 sha256 | 结论 |
| --- | --- | --- | --- |
| `app.py` | `c4a1b121…d31930` | `c4a1b121…d31930` | 一致（与第一轮逐字节相同） |
| `index.html` | `92b6cc19…3f8160dc` | `92b6cc19…3f8160dc` | 一致（与第一轮逐字节相同） |
| `README.md` | `50a42736…8ee3498` | `50a42736…8ee3498` | 一致 |
| `verify_e2e.sh` | `5649b967…66f13680` | `5649b967…66f13680` | 一致 |
| `data.json` | `e30f3db708ce377ad9fe6c4f110ad15dd373bd4a8b7f3d36616b4ce3ca483811` | `f28d242a62bfb9b4419865a5f1e79cb33f6bec62d26cb5d608f760c990893e2e` | **不一致（现场漂移）** |

- `git HEAD` 版本 `sha256sum -c SHA256SUMS` → **7/7 OK**；但**磁盘现场**同一命令 → `data.json: FAILED`（见 `hash_check.txt`）。
- 现场 `data.json` 表现为样例条目被改写（"牛奶"/3 → "33"/666）、`demo-0002` 被删、新增一条 `75d4d49b7a78`「测试」，疑似有人在交付目录内实际使用过该页面。
- 本轮**以 git HEAD 提交版本作为交付基线**核验；同时把「交付目录与其自身 `SHA256SUMS` 不一致」作为事实判定为缺陷 D-2。
- 两条证据链：实现者自报（`author_selfreport.txt`）与验证方复跑（`author_scripts_rerun.txt`）分别记录，结论以后者为准。

## 2. 交互级验证（必备证据）

方法：宿主机用真实 `app.py` 起服务（数据文件在临时目录，预置 3 条含额外字段 `manual_note` 的条目）；用 Node v24 + `jsdom@30.1.1` 构造真实 DOM、执行 `GET /` 实际下发的 `index.html` 内联脚本，注入 `fetch` shim 直连该服务，模拟用户操作；**每步操作后用 `/api` 核对持久化结果与页面显示双端一致**。
驱动与脚本：`run_interactive.sh`、`interactive_verify.mjs`；原始输出 `interactive_verify_output.txt`（并两次复跑 `…_run2.txt`，结果一致，无抖动）。交互后 DOM 快照：`dom-snapshot-after-interactions.html`。

必测矩阵结果（27/32 PASS）：

| 用例 | 结果 | 说明 |
| --- | --- | --- |
| T1 页面加载与数据渲染 | PASS | 3 条既有数据渲染；名称/类别/数量单元格与 `/api/items` 一致；计数徽标「3 条」；汇总表与 `/api/summary` 一致 |
| T2 新增 | PASS | 提交「香蕉/食品/4」→ 页面 4 行、API 持久化、汇总（食品=7）双端一致、名称框清空 |
| T3 编辑名称（经「编辑」入口） | PASS | 保存后 页面显示=API=「鲜牛奶」 |
| T4 编辑类别（经「编辑」入口） | PASS | 保存后 页面显示=API=「饮品」 |
| T5 编辑数量（经「编辑」入口） | PASS | 保存后 页面显示=API=12；条目额外字段 `manual_note` 在文件中保留；无残留输入框 |
| T6 编辑取消 | PASS | 回到展示态且 API 未被改写 |
| T7 删除（确认） | PASS | 页面移除该行且 API 404；确认框已弹出 |
| T8 删除（取消确认） | PASS | 不删除 |
| T9 空输入 | PASS | 空名称/空类别均被拦截并给出中文错误提示 |
| T10 非法输入 | PASS | 非法数量被拦截并给出明确提示 |
| T11 典型用户路径对抗 | **FAIL ×5** | 直接点击 名称/类别/数量/id 单元格与汇总行单元格 → 均无编辑态、无任何提示（缺陷 D-1） |
| T12 刷新 | PASS | 可用并给出反馈 |
| T13 HTML 转义对抗 | PASS | 名称含 `<b>` 被转义为纯文本，无注入；经 API 原样保存 |

> 说明：本环境无真实浏览器，交互级验证按本轮约定以 Node(v24)+jsdom 的 DOM 级方式完成；与真实浏览器在布局/焦点/原生控件视觉反馈上的差异列入残余风险。

## 3. 回归范围复跑（不得省略，逐项结果）

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| API 契约（页面/健康/items/单条/新增/PUT 部分更新/DELETE/405/未知路径；含 8 类非法输入 400、非对象体、非法 JSON） | 54/54 PASS，exit 0 | `api_regression.py` / `api_regression_output.txt` |
| 按类别汇总正确性（与逐条累加逐键比对、按类别名排序） | PASS | 同上 S1 |
| 数据不覆盖/不丢失（未知顶层键、条目额外字段、非对象元素、顶层数组旧档在增删改后保留） | PASS | 同上 S1/S2/S3 |
| 原子写与只读语义（无 `.data-*` 残留；纯 GET 不改写；损坏档 500 且字节不变） | PASS | 同上 S1/S4 |
| 纯标准库 / 不联网（全部 import 在 `-I -S` 无 site-packages 下可导入；页面无外部 URL） | PASS | 同上 S5 |
| `--selftest` 退出码语义 | 33/33 PASS，exit 0（`-I -S` 同样）；移除 `index.html` 的 FAIL 路径 → 32/33，**exit 1** | `env_selftest.sh` / `env_selftest_output.txt` |
| 默认启动（无参数 = 127.0.0.1:8000）与只读不改档 | PASS（`GET /` 200 text/html；`/api/items`、`/api/summary` 200；数据文件未被建/改） | 同上 E3 |
| 作者脚本复跑对照 | `bash verify_e2e.sh` 28/28 PASS exit 0；`python3 app.py --selftest` 33/33 PASS exit 0（与自报一致） | `author_scripts_rerun.txt` |

## 4. 缺陷（按严重度排序）

### 【缺陷 D-1】严重度：中
- 复现路径：启动应用打开 `/` → 在「物品清单」表内**直接点击任一展示单元格**（名称 / 类别 / 数量 / id）或**汇总表单元格**（重点：类别单元格）→ 页面无任何变化。
- 期望行为：直接点击展示字段应进入编辑态，或至少给出明确反馈（例如提示「请点『编辑』按钮」）；用户不应面对「点了没反应」的静默。
- 实际行为：未进入编辑态，且 `#message` 区域不出现任何提示（无反馈、无光标/样式暗示该处不可点）。
- 影响范围：仅 `index.html` 前端交互与编辑入口可发现性；编辑仍可通过每行显式的「编辑」按钮完成，API/数据正确性不受影响（T11.x 确认点击不改动任何数据与结构）。
- 建议修复位置：`/opt/SoftFactory-AINative/artifacts/YUNZ-10/index.html`（`renderItems` 生成的展示态行 `td`，约 L227-L235；`#items-body` 点击代理约 L296-L306；汇总表 `td`。可考虑点击单元格即进入编辑，或给出提示）

### 【缺陷 D-2】严重度：低
- 复现路径：`cd /opt/SoftFactory-AINative/artifacts/YUNZ-10 && sha256sum -c SHA256SUMS`。
- 期望行为：交付目录内容与其随附 `SHA256SUMS` 自洽；或明确声明 `data.json` 为运行期可变数据、不纳入校验。
- 实际行为：`data.json` 磁盘 sha256=`e30f3db7…` ≠ `SHA256SUMS` 记录（=git HEAD）`f28d242a…`，校验 `FAILED`（7 项中 1 项不符）。
- 影响范围：仅数据文件本身；`app.py`、`index.html` 与提交版本逐字节一致，代码契约与第一轮结论不受影响；但交付目录不再自洽，后续核验/复现易被误导。
- 判定为「低」的理由：纯数据文件一致性问题，不涉及代码或契约功能失效，且 `data.json` 本质是运行期可变数据。
- 建议修复位置：`/opt/SoftFactory-AINative/artifacts/YUNZ-10/data.json`（恢复为提交版本，或更新 `SHA256SUMS` 并在 README 说明其运行期可变属性）

## 5. 残余风险（非本轮缺陷，供 Sponsor 决策）

1. **无真实浏览器证据**：本轮以 jsdom 做 DOM 级交互验证；布局、原生控件视觉反馈、移动端等仍属未覆盖证据。
2. 无鉴权、无 HTTPS，默认仅监听 `127.0.0.1`（继承 README §6.1）。
3. 多进程并发写同一数据文件会丢失更新（README §6.2 已知限制；第一轮已列，本轮未新增验证）。
4. 每次写入整档重写，数万条以上时写入延迟上升（README §6.3）。
5. 数据文件被外部改坏时接口返回 500 并拒绝写入，需人工修复（刻意保护，与文档一致）。
6. 观测到一条**非本次验证启动**的残留服务进程 `python3 app.py --port 8090`，本次未启动/未终止它，仅记录（见 `env_facts.txt`）。

## 6. 证据文件清单（同级目录）

| 文件 | 说明 |
| --- | --- |
| `verification-report.md` | 本报告 |
| `api_regression.py` / `api_regression_output.txt` | 验证方自研 API 回归 harness（54 用例）与输出 |
| `interactive_verify.mjs` / `interactive_verify_output.txt` / `interactive_verify_output_run2.txt` | DOM 级交互 harness（32 用例）与两次复跑输出 |
| `run_interactive.sh` | 交互验证 driver（宿主 python 服务 + docker node 容器 jsdom） |
| `dom-snapshot-after-interactions.html` | 交互结束后的 DOM 快照 |
| `interactive_server.log` | 交互验证期间服务日志 |
| `env_selftest.sh` / `env_selftest_output.txt` | 环境与 `--selftest` 退出码语义（E2–E4） |
| `hash_check.txt` | 磁盘 vs 提交版本哈希、`SHA256SUMS` 校验、git status |
| `author_selfreport.txt` / `author_scripts_rerun.txt` | 实现者自报输出 / 验证方复跑作者脚本（两条证据链） |
| `env_facts.txt` | 运行时、浏览器探测、外部进程记录 |
| `EVIDENCE-SHA256SUMS` | 上述证据文件的 sha256 |
