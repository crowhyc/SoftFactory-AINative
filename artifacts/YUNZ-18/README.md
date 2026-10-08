# YUNZ-18 修复报告：缺陷 D-1（点击「类别」单元格进入行内编辑态）

本任务对应父任务 YUNZ-16 的复验缺陷 **D-1**（严重度：高），被修复对象为 `/opt/SoftFactory-AINative/artifacts/YUNZ-10/` 当前交付版本。

## 1. 复现（修复前）

- 复现脚本：`evidence/after-fix/verifier_copy_interaction_verify.mjs`（YUNZ-17 独立复验脚本原样副本）+ `evidence/after-fix/run_interaction.sh`。
- 修复前输出：`evidence/before-fix/interaction_output.txt` → `INTERACTION 41/43 PASSED`，2 条 FAIL：
  - `FAIL  [A] 点击「类别」单元格进入行内编辑态  -> 期望[true] 实际[false]`
  - `FAIL  [A] 「类别」单元格修改保存并生效(页面/API/磁盘)`
  - 点击类别单元格反馈为旧提示：`"提示：请点该行的「编辑」按钮修改名称 / 类别 / 数量"`
- 与缺陷块描述一致，复现成立。

## 2. 改动（唯一产品改动文件：`index.html`）

- 绝对路径：`/opt/SoftFactory-AINative/artifacts/YUNZ-10/index.html`
- 修复前 sha256：`92e3d4543c5d8aeddd722d8a2164a3092c3cebb1b4defcecfd3ccafdf137efb0`
- 修复后 sha256：`363fbb6e06932c758040a0a7e6c5be0e8ac25b2c5a79835206e829d4b874989f`
- 完整 diff：`evidence/index.html.diff`
- 改动点：
  1. `renderItems()` 展示态：`tr` 增加 `data-id`；「类别」`td` 增加 `data-edit="category"` 标记与 `title`。
  2. `#items-body` 点击代理：「类别」单元格走行内编辑特例——设置 `state.editingId` 后 `renderItems()` 并聚焦类别输入框。
  3. 需求 E 防静默丢失：当前有未保存编辑时，点击**其它行**的「类别」单元格或「编辑」按钮，**显式阻止并给出明确提示**，不隐式切换编辑目标。第 3 点为需求 E「交互路径不得产生静默数据丢失」的同类加固（点「编辑」按钮切换行同属隐式切换编辑目标），已在此标注以便复验关注。
- 同名清单同步：`/opt/SoftFactory-AINative/artifacts/YUNZ-10/SHA256SUMS`（修复后 sha256：`9d75e38c1caf1b2fb4aaf7c2bcac9f1f9bf5577e7643b5354283d0b6e5bf2a71`），仅刷新 `index.html` 一行，仍为 7 项。
- 未改动：`app.py`（`c4a1b12…`）、`data.json`（`f28d242…`）、`README.md`（`50a4273…`）、`verify_e2e.sh`（`5649b96…`）、`selftest_output.txt`、`e2e_output.txt`。

## 3. 验证证据

| 证据 | 文件 | 结果 |
| --- | --- | --- |
| 交互级（独立复验脚本复跑） | `evidence/after-fix/interaction_output.txt` | `INTERACTION 44/44 PASSED`，`[A]` 两条由 FAIL 转 PASS |
| 交互级（修复自证 35 项） | `evidence/fix-selftest/interaction_fix_verify_output.txt` | `FIX-SELFTEST 35/35 PASSED` |
| `python3 app.py --selftest` | `evidence/regression/selftest_output.txt` | `SELFTEST 33/33 PASSED`，exit 0 |
| FAIL 路径注入 | `evidence/regression/selftest_failpath_output.txt` | 注入式断言翻转 → `SELFTEST 33/34 PASSED`，exit 1 |
| 作者端到端 `bash verify_e2e.sh` | `evidence/regression/e2e_output.txt` | `E2E 28/28 PASSED`，exit 0 |
| API 契约 / 数据不丢失（独立脚本） | `evidence/regression/api_regression_output.txt` | `API_REGRESSION 29/29 PASSED`，exit 0 |
| 交付目录自洽 `sha256sum -c SHA256SUMS` | `evidence/regression/SHA256SUMS_check_output.txt` | 7/7 OK，exit 0 |

关键结论：
- 要求 A：点击「类别」单元格 → 出现 `input[data-field="category"]` → 修改保存 → 页面/API/磁盘三者一致（`乳制品`），名称/数量未被牵连改动。
- 要求 B：行内编辑态「取消」后页面/API/磁盘均无变更。
- 要求 C：名称 / 数量 / id 单元格保持原体验（原有提示文案不变，不进入编辑态，不产生写入）。
- 要求 D：汇总表点击仅有提示，无编辑控件。
- 要求 E：编辑中点击其它行「类别」单元格或「编辑」按钮 → 显式提示阻止，编辑态与未保存内容保留，无持久化写入；无进行中编辑时切换正常。
- 数据不丢失：既有条目、条目额外字段 `extra_note`、未知顶层键 `schema_version` / `note` / `custom_top` 全程保留；写入原子无临时文件残留；仅标准库。

## 4. 复现命令

```bash
# 环境：Node v24.21.0 + jsdom（依赖仅装在本任务工作目录内，registry.npmmirror.com）
cd /opt/SoftFactory-AINative/.multica-workspaces/yunzhidian-f03e0d551ffa/yunz-18-68cd224cda87/workdir
PORT=8818 bash repro/run_before.sh          # 独立复验脚本复跑（连真实 app.py）
PORT=8817 bash selftest/run_fix_verify.sh   # 修复自证脚本
python3 selftest/api_regression_independent.py
cd /opt/SoftFactory-AINative/artifacts/YUNZ-10 && python3 app.py --selftest && bash verify_e2e.sh && sha256sum -c SHA256SUMS
```

注：本环境 `node` 无法访问 `127.0.0.1` 回环，脚本统一通过主机地址 `172.18.0.1:<port>` 连接（与 YUNZ-17 一致）。

## 5. 残余风险（提交独立复验判定）

1. 新增/删除/刷新等**其它**路径在行内编辑未保存时仍会经 `reload()` 重渲染，可能丢弃未保存输入；本轮约定要求 E 仅点名「点击另一行「类别」单元格」这一类新引入路径，故未扩大改动，如实记录待复验关注。
2. 阻止切换时提示 `kind='info'`（2.6 秒后自动隐藏），未做常驻态展示。
3. 修复仅覆盖缺陷 D-1 与要求 A/E 的同路径加固，未改动名称/数量单元格行为（要求 C 明确保持现状）。
