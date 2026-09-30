`YUNZ-15`：修复 `YUNZ-14` 复验结论中的缺陷 D-1（点击展示单元格无任何反馈）与 D-2（交付目录与自身 `SHA256SUMS` 不一致）。
本目录是本任务的修复证据与回归用例；产品改动落在唯一产品目录 `/opt/SoftFactory-AINative/artifacts/YUNZ-10/`。

## 目录内容

| 路径 | 说明 |
| --- | --- |
| `fix-report.md` | 修复报告：改了什么 / 为什么 / 如何验证 / 残余风险 |
| `tests/interaction_regression.mjs` | 新增回归用例（DOM 级 / jsdom）：D-1 对抗项（T11）+ 既有显式编辑流程保护（R1/R2） |
| `tests/run_interaction.sh` | 上述用例的 driver（宿主机 python3 起真实服务 + docker node:24-slim 容器跑 jsdom） |
| `evidence/d1/before-fix/` | D-1 复现证据：修复前 harness 输出（12/18，6 项 T11 FAIL）、DOM 快照、服务日志 |
| `evidence/d1/after-fix/` | D-1 修复后 harness 输出（18/18 PASS，含实际提示文案）、DOM 快照、服务日志 |
| `evidence/d1/index.html.diff` | D-1 的 `index.html` 改动差异（+11 / -1） |
| `evidence/d2/before-fix.txt` | D-2 复现证据：`sha256sum -c SHA256SUMS` 退出码 1，`data.json: FAILED` |
| `evidence/d2/after-fix.txt` | D-2 修复后证据：`sha256sum -c SHA256SUMS` 退出码 0，7/7 `OK` |
| `evidence/regression/` | 回归复跑：`--selftest` 33/33、`verify_e2e.sh` 28/28、`YUNZ-14` `api_regression.py` 54/54、`env_selftest.sh`（退出码语义） |
| `evidence/hashes.txt` | 交付目录各文件修复前 / 修复后 / 提交基线 sha256 对照 + 当前 `sha256sum` 原始输出 |

## 如何复现本任务的验证

环境事实（继承 `YUNZ-14/env_facts.txt`）：`python3` 3.6.8；本机 `node`/`npm` 是 docker 包装脚本（`docker run -v "$PWD:$PWD" node:24-slim`），容器内 node v24.21.0，**无真实浏览器**；故采用 DOM 级（jsdom）验证。

```bash
# 0) 准备（任何工作目录均可，依赖只装在该目录内）
npm install jsdom@30.1.1

# 1) D-1 回归（DOM 级）：把 <workdir> 换成上面这个已装 jsdom 的目录
bash tests/run_interaction.sh <workdir> \
  /opt/SoftFactory-AINative/artifacts/YUNZ-10/app.py \
  /opt/SoftFactory-AINative/artifacts/YUNZ-10/index.html \
  <workdir>/out-evidence          # 退出码 0 = 18/18 通过

# 2) D-2 交付目录自洽
cd /opt/SoftFactory-AINative/artifacts/YUNZ-10 && sha256sum -c SHA256SUMS   # 期望 7/7 OK，退出码 0

# 3) 原有回归（在交付目录副本上运行，避免污染交付目录）
WORK=$(mktemp -d); cp -a /opt/SoftFactory-AINative/artifacts/YUNZ-10/. "$WORK/"
rm -rf "$WORK/verification"
( cd "$WORK" && python3 app.py --selftest )                # 33/33，exit 0
bash "$WORK/verify_e2e.sh"                                  # 28/28，exit 0
python3 /opt/SoftFactory-AINative/artifacts/YUNZ-14/verification/api_regression.py \
  --app "$WORK/app.py" --index "$WORK/index.html"           # 54/54，exit 0
```

`run_interaction.sh` 全程在 `<workdir>/tmp/` 下的副本与临时数据文件上操作，**不读写交付目录内的 `data.json`**。
