# YUNZ-19 独立复验报告：复验 YUNZ-18 对缺陷 D-1 的修复（点击「类别」单元格进入行内编辑态）

- 任务：YUNZ-19（stage 3，独立验证工程师 AI-QV）
- 被验证对象：`/opt/SoftFactory-AINative/artifacts/YUNZ-10/` 当前交付版本（git HEAD `ddc16c3`）
- 核对时间：2026-10-08T04:09:05Z（= 2026-10-08 12:09:05 CST）
- **结论：通过但有待决项** —— 缺陷 D-1（严重度：高）已修复并经独立复跑确认；本轮验收要求 A–E 与本轮回归范围全部满足；待决项为残余风险 R-1（见第 4 节），是否收口请 Sponsor / 任务与流程协调员决定。

## 1. 版本三链锁定（被验证对象确定）

三链 = ① 磁盘现场 sha256 ② 交付目录 `SHA256SUMS` ③ git HEAD 提交 blob sha256。

- `sha256sum -c SHA256SUMS` → **7/7 OK**（exit 0）。
- 三链逐文件比对 → **7/7 全部一致**（`threchain_check_output.txt`）。
- `index.html` 三链均为 `363fbb6e06932c758040a0a7e6c5be0e8ac25b2c5a79835206e829d4b874989f`，与协调员现场事实、`YUNZ-18` 报告一致。
- 修复前 `index.html`（git HEAD^ = `cbc645d` blob）= `92e3d454...`，与 `YUNZ-18/evidence/index.html.before` 一致（作者自报与独立复跑两条链一致）。
- 全程只读：未写入 `YUNZ-10/`（含 `verification/`）、`YUNZ-14/`、`YUNZ-15/`、`YUNZ-17/`、`YUNZ-18/`；所有运行在**临时目录副本 + 临时数据文件**上进行。

## 2. 核查了什么

1. 版本三链锁定与交付目录自洽（第 1 节，脚本 `threchain_check.py`）。
2. **缺陷 D-1 修复前 vs 修复后对照**（自写探针 `repro_d1_probe.mjs`，连真实 `python3 app.py`，`--data` 指向临时数据文件）。
3. **交互级必测矩阵**（自写 `interaction_verify.mjs`，Node v24 + jsdom，加载 `GET /` 实际下发的 `index.html`，逐步用 `/api` 与磁盘三方核对）：**INTERACTION 67/67 PASSED**（`interaction_output.txt`、DOM 快照 `dom-snapshot-after-interactions.html`）。
4. **A–E 逐项**（第 3 节）：A 必修项、B 取消、C 名称/数量/id 展示态、D 汇总只读、E 行间切换防静默丢失。
5. **回归复跑**（自独立）：`--selftest` 33/33 exit 0、FAIL 路径注入 32/33 exit 1、作者 `verify_e2e.sh` 28/28 exit 0、自写独立 API 契约/数据保全脚本 **API_REGRESSION 51/51 PASSED**。

## 3. 验证证据

| 项 | 证据文件（同级目录） | 结果 |
| --- | --- | --- |
| 三链锁定 | `threchain_check_output.txt` | 7/7 一致，exit 0 |
| 交付目录自洽 | `SHA256SUMS_check_output.txt` | 7/7 OK，exit 0 |
| 修复前 D-1 复现 | `repro_before_output.txt` | 点击类别单元格 `CELL_CLICK_ENTER_EDIT=NO`；反馈=旧提示「请点该行的『编辑』按钮…」 |
| 修复后 D-1 | `repro_after_output.txt` | `CELL_CLICK_ENTER_EDIT=YES`；反馈=「已进入行内编辑：修改「类别」后点「保存」生效」 |
| 交互级全矩阵（自写） | `interaction_output.txt` / `interaction_verify.mjs` / `dom-snapshot-after-interactions.html` | **67/67 PASSED** |
| 交互输入数据 | `interaction_input_data.json` | 预置 3 条含 `extra_note` + 未知顶层键 `schema_version`/`note` |
| `--selftest` | `selftest_output.txt` | **SELFTEST 33/33 PASSED**，exit 0 |
| FAIL 路径非 0 退出 | `selftest_failpath_output.txt` | 注入式断言翻转 → **32/33**，**exit 1** |
| 作者端到端 | `e2e_output.txt` | **E2E 28/28 PASSED**，exit 0 |
| 独立 API 契约/保全 | `api_regression_output.txt` / `api_regression_independent.py` | **API_REGRESSION 51/51 PASSED**，exit 0 |
| 残余风险 R-1 探针 | `probe_reload_output.txt` / `probe_reload.mjs` | 见第 4 节 |
| 环境探测 | `env_probe_output.txt` | node v24.21.0 / npm 11.19.0 / python3 3.6.8；**无真实浏览器**（chromium/chrome/playwright 均 absent）；node 不能走 127.0.0.1 回环，改走容器网关 `172.18.0.1:<port>` |

### 3.1 A–E 逐项结论

- **A（必修 · D-1）：通过。** 点击任一行「类别」展示态单元格 → 该行进入行内编辑态（出现 `input[data-field="category"]` 并聚焦）；改「食品」→「乳制品」保存后 **页面显示 / `GET /api/items` / 磁盘 JSON 三端一致**，名称「鲜牛奶」与数量 3 未被牵连，既有条目与未知顶层键未丢失。
- **B：通过。** 行内编辑态「取消」后页面/API/磁盘三端均无变更（`不应保存` 未落库）。
- **C：通过。** 「名称」「数量」「id」展示态单元格点击仅给明确提示（原文案「请点该行的『编辑』按钮…」），不进入编辑态、不产生写入；未因此判缺陷。
- **D：通过。** 汇总表点击仅提示「汇总表仅供查看…」，无编辑控件。
- **E：通过。** 一行编辑中点击**另一行「类别」单元格** → 显式反馈「当前有未保存的编辑，请先『保存』或『取消』…」；未隐式切换编辑目标、未静默丢弃未保存改动、未产生持久化写入。`YUNZ-18` 额外把「编辑中点他行『编辑』按钮」也纳入同一显式阻止，**独立判定为可接受**：属显式阻止而非静默，语义一致；且已验证「无进行中编辑时切换他行正常」，未过度阻止。

### 3.2 回归范围结论

`--selftest` 33/33（FAIL 路径注入 exit 1）· `verify_e2e.sh` 28/28 · 独立 API 契约（`GET/POST 201/PUT/DELETE/GET summary`，含不存在 id 404、非法输入 400、`PATCH` 405、未知路径 404）· 按类别多条目汇总正确性 · 数据不覆盖/不丢失（既有条目 + `extra_note` + 未知顶层键 `schema_version`/`note`/`custom_top` 全程保留；写入原子无临时文件残留）· 纯标准库无第三方依赖 · 交付目录自洽 —— 全部满足。

## 4. 缺陷与残余风险

- **本轮验证范围内：无缺陷（D-1 修复通过，A–E 与回归全通过）。**
- **残余风险 R-1（待决项 · 不在本轮约定范围 · 既有行为）**：行内编辑（无论经「类别」单元格还是「编辑」按钮进入）**未保存**时，点击「刷新」/新增/删除等他行操作会经 `reload()` 重渲染，**本地未保存输入被静默丢弃**（仅显示「已刷新」/「已删除」，无未保存提醒，编辑态仍保留但输入被服务端值覆盖）。
  - 复现路径：启动 `python3 app.py` → 打开页面 → 点某行「类别」单元格进入编辑 → 改「类别」为「未保存的老酸奶」（不保存）→ 点页面「刷新」按钮（或点他行「删除」并确认）→ 观察该行类别输入框回退为服务端值「食品」，磁盘/API 仍为「食品」，无任何「未保存改动将丢失」提示。
  - 证据：`probe_reload_output.txt`。
  - 影响范围：仅影响**未保存**的行内编辑输入；不产生错误持久化、不丢既有数据。
  - 性质判定：该行为在修复前（经「编辑」按钮的行内编辑）即已存在，`YUNZ-18` 未引入新类别，且本轮约定第 4 条已将要求 E 明确限定为「点击另一行『类别』单元格」这一路径，故**不构成本轮 D-1 的缺陷**；如需收口（补未保存提醒或改动前确认），建议由协调员按缺陷回路另开任务，**由 Sponsor 决定是否接受为已知限制**。
- **残余风险 R-2（低 · 提示可发现性）**：进入/阻止类提示 `kind='info'`，约 2.6 秒后自动隐藏，无常驻态；属既有交互风格，本轮不判缺陷。
- 未发现静默数据丢失于本轮约定点名的行间切换路径；无其它功能性缺陷。

## 5. 复现命令（全部在临时副本上运行，不触碰交付目录）

```bash
W=/opt/SoftFactory-AINative/.multica-workspaces/yunzhidian-f03e0d551ffa/yunz-19-a69b746134fb/workdir
cd "$W" && npm install jsdom@26 --registry https://registry.npmmirror.com   # 依赖仅装在工作目录内
cp -a /opt/SoftFactory-AINative/artifacts/YUNZ-10/. repro/ && chmod -R u+w repro
cd repro && python3 app.py --selftest && bash verify_e2e.sh && sha256sum -c SHA256SUMS
cd "$W" && APP_PY="$W/repro/app.py" python3 api_regression_independent.py
PORT=8892 GW=172.18.0.1 bash inter/run_interaction.sh "$W/repro/app.py"   # 交互级 67/67
python3 threchain_check.py
```

## 6. 声明

- 本报告结论基于**本任务独立脚本的复跑结果**；`YUNZ-18` 作者自报作为对照链单独记录（复现命令 `YUNZ-18/README.md` §4）。
- 未修改被验证的实现代码；只读约束遵守情况见第 1 节。
- 本任务状态由本任务置为 `待验收 in_review`，不自行置 `done`。
