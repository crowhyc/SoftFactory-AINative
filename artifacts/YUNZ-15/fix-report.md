# YUNZ-15 修复报告：D-1 与 D-2

- 任务：`YUNZ-15`（父任务 `YUNZ-13`；缺陷来源：`YUNZ-14` 独立复验结论）
- 产品目录：`/opt/SoftFactory-AINative/artifacts/YUNZ-10/`
- 修复前基线：git HEAD = `dd3f0ef`
- 修复边界：只改 `index.html`（D-1）与 `data.json` + `SHA256SUMS`（D-2）；`app.py` / `verify_e2e.sh` / `README.md` 未改动。

## 1. 缺陷 D-1：点击展示态单元格无任何反馈

### 1.1 复现（先复现再修）

命令（DOM 级，`jsdom`；服务为真实 `app.py`，数据在临时目录）：

```bash
bash tests/run_interaction.sh <workdir> \
  /opt/SoftFactory-AINative/artifacts/YUNZ-10/app.py \
  <修复前 index.html> <out>
```

结果（见 `evidence/d1/before-fix/interaction_output.txt`）：`INTERACTION 12/18 PASSED`，6 项 T11 全部 FAIL —— 点击「物品清单」的名称 / 类别 / 数量 / id 单元格与汇总表两列单元格，`enteredEdit=false` 且 `#message` 无任何文案（`feedback=null`），与 `YUNZ-14` 复验结论一致。

### 1.2 修复方案与理由

**选择「给出明确可见反馈」而非「点击即进入编辑态」。**

改动（`evidence/d1/index.html.diff`，共 +11 行 / -1 行）：

- `#items-body` 点击代理：原 `if (!button) { return; }` 改为——命中展示态 `td`（且不在编辑行的输入框内）时，提示 `提示：请点该行的「编辑」按钮修改名称 / 类别 / 数量`（`info` 级，2.6s 自动消失）。
- 新增 `#summary-body` 点击代理：点汇总表任意 `td` 提示 `提示：汇总表仅供查看，请在「物品清单」中点击「编辑」按钮修改`。

理由：

1. **代价最小、不破坏显式编辑流程。** 显式「编辑」按钮的进入 / 保存 / 取消路径完全未动，`R1.*` 三项回归仍通过。
2. **不引入静默丢弃未保存编辑的风险。** 若改为「点任意单元格即进入编辑态」，用户正在编辑 A 行时点 B 行单元格会隐式切换编辑目标，未保存改动被静默丢弃——这会把「无反馈」换成一个更隐蔽的数据一致性缺陷。
3. **id 与汇总无对应编辑语义。** 编辑表单只允许改名称 / 类别 / 数量，`id` 不可改；汇总表为派生视图。「进入编辑态」对这两类单元格不成立，因此统一用「提示 + 指路」保持行为一致。
4. 同时满足 `YUNZ-14` T11.x 的既有断言（点击展示单元格不改动任何数据与展示行结构）。

### 1.3 修复后验证

`evidence/d1/after-fix/interaction_output.txt`：`INTERACTION 18/18 PASSED`（exit 0）。实际提示文案（harness 逐项采样）：

```
物品清单·名称单元格  -> "提示：请点该行的「编辑」按钮修改名称 / 类别 / 数量"
物品清单·类别单元格  -> "提示：请点该行的「编辑」按钮修改名称 / 类别 / 数量"
物品清单·数量单元格  -> "提示：请点该行的「编辑」按钮修改名称 / 类别 / 数量"
物品清单·id 单元格   -> "提示：请点该行的「编辑」按钮修改名称 / 类别 / 数量"
汇总表·类别          -> "提示：汇总表仅供查看，请在「物品清单」中点击「编辑」按钮修改"
汇总表·合计数量      -> "提示：汇总表仅供查看，请在「物品清单」中点击「编辑」按钮修改"
```

其中 `T11.6`（点击不产生任何数据写入）与 `T11.7`（不改变展示行结构）保持 PASS。

## 2. 缺陷 D-2：交付目录与自身 SHA256SUMS 不一致

### 2.1 复现

```bash
cd /opt/SoftFactory-AINative/artifacts/YUNZ-10 && sha256sum -c SHA256SUMS
```

修复前：`data.json: FAILED`（磁盘 `e30f3db7…ca483811` ≠ 记录值 `f28d242a…990893e2e`），退出码 1。现场证据见 `evidence/d2/before-fix.txt`。

成因（继承任务描述现场事实）：交付目录内残留的 `python3 app.py --port 8090`（PID 9024）在用页面被手工使用后按运行期语义改写了 `data.json`；**不是 `app.py` 的写入缺陷**，因此不改后端。

### 2.2 修复

按默认口径「恢复 `data.json` 为提交版本内容」：用 `git show HEAD:artifacts/YUNZ-10/data.json` 恢复（恢复后 sha256 = `f28d242a…990893e2e`，与 `SHA256SUMS` 记录值一致），并刷新 `SHA256SUMS` 中 `index.html` 一行（D-1 改动的必然结果）。`README.md` 未改：样例说明（4 条物品 + `schema_version`/`note` 两个未知顶层键）在恢复后仍然成立。

### 2.3 修复后验证

```bash
cd /opt/SoftFactory-AINative/artifacts/YUNZ-10 && sha256sum -c SHA256SUMS
# app.py/index.html/data.json/verify_e2e.sh/README.md/selftest_output.txt/e2e_output.txt 均 OK → 7/7
```

退出码 0。证据见 `evidence/d2/after-fix.txt`。

## 3. 回归范围复跑结果（全部在交付目录副本 + 临时数据上执行）

| 项 | 命令 | 结果 | 证据 |
| --- | --- | --- | --- |
| 原内置自测 | `python3 app.py --selftest` | `SELFTEST 33/33 PASSED`，exit 0 | `evidence/regression/selftest_output.txt` |
| 作者端到端 | `bash verify_e2e.sh` | `E2E 28/28 PASSED`，exit 0 | `evidence/regression/verify_e2e_output.txt` |
| 独立 API 回归（只读复用 `YUNZ-14`） | `api_regression.py --app … --index …` | `API_REGRESSION 54/54 PASSED`，exit 0（含 API 契约、按类别汇总、数据不覆盖/不丢失、原子写与只读语义、纯标准库） | `evidence/regression/api_regression_output.txt` |
| 环境与 `--selftest` 退出码语义（只读复用 `YUNZ-14`） | `env_selftest.sh …` | E2 33/33 exit 0；E3 纯 GET 不改档；E4 移除 `index.html` → 32/33 **exit 1** | `evidence/regression/env_selftest_output.txt` |
| D-1 交互级对抗（含 `YUNZ-14` T11） | `tests/run_interaction.sh …` | `INTERACTION 18/18 PASSED`，exit 0 | `evidence/d1/after-fix/interaction_output.txt` |
| 交付目录自洽 | `sha256sum -c SHA256SUMS` | 7/7 OK，exit 0 | `evidence/d2/after-fix.txt` |

未改动项确认：API 契约与字段语义、单 JSON 文件持久化与原子写语义、纯标准库 / 不联网约束、`--selftest` 与 `verify_e2e.sh` 的退出码语义（含 FAIL 路径 exit 1）均保持原样；未放宽任何既有断言。

## 4. 交付目录改动清单（秒级可核）

| 文件 | 修复前 | 修复后 |
| --- | --- | --- |
| `index.html` | `92b6cc19…3f8160dc` | `92e3d454…f137efb0` |
| `data.json` | `e30f3db7…ca483811` | `f28d242a…990893e2e` |
| `SHA256SUMS` | `23af451b…43cb04fa` | `6bfaccee…16eab79cd` |

其余五件（`app.py`、`verify_e2e.sh`、`README.md`、`selftest_output.txt`、`e2e_output.txt`）逐字节未改。完整对照见 `evidence/hashes.txt`。

## 5. 自测隔离

所有运行与回归均在临时目录的副本上执行（`tests/run_interaction.sh` 使用 `<workdir>/tmp/` 副本 + 临时数据文件；回归在 `mktemp -d` 的交付目录副本上执行），未再次改写交付目录；D-2 的恢复动作是唯一对交付目录 `data.json` 的写入。
