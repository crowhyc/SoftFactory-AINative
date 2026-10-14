# 现场（真实容器）证据 · YUNZ-23

采集对象：现场容器 `wbs-rongcheng`（镜像 `wbs-rongcheng:20261014144403`，host 网络，仅监听 `127.0.0.1:4180`），`data/wbs.json` 保持修复前内容（sha256 `a3632236…`，未被重置）。

| 文件 | 内容 |
| --- | --- |
| `live-deploy.log` | 现场重新部署：`docker build --network none` + `deploy/deploy.sh` + health 自检 + data 备份路径 |
| `live-page-export.mjs` / `live-page-export.log` | **D-1 复现路径**：jsdom 驱动现场页面 → 选「项目负责人」→ 点「导出 Excel」→ 产物含 `<cols>` 且 A–K 列宽与模板逐列一致（4 PASS） |
| `现场页面导出.xlsx` | 上述现场页面导出产物（sha256 `9925d8d6…`，1172751 字节，`<col>` 16384 条） |
| `live-idcell.mjs` / `live-idcell.log` | **D-2 复现路径**：现场页面以「王言」进入 → 点序号列 `td.cell-id` → 中文只读提示且与相邻只读单元格同模板（3 PASS） |
| `live-verify.log` | 现场导出产物的三方读回：① Stage2 复现脚本 `col-compare.py`（只读原样调用，探测段显示 `<cols>` 1 个 / 16384 条，其末行“结论”文字为 Stage2 脚本内置硬编码，未随修复更新）② 交付自测 `export_verify.py`（24 PASS / 0 FAIL）③ 修复前产物 `verification/exported.xlsx` 对照（3 FAIL，复现 D-1） |
| `D1回归-修复前.out` / `D1回归-修复后.out` | D-1 测试先行：同代码仅还原“默认 `XLSX.read` 不解析 `!cols`”一处，`exportcheck.mjs` 的 `<cols>`/列宽断言由 FAIL(2) 转 PASS |
| `D2回归-修复前.out` / `D2回归-修复后.out` | D-2 测试先行：`domcheck.mjs --only idcell` 在修复前 FAIL（点击无反馈），修复后 3 PASS |

复现（现场，需与容器共享宿主网络）：
```bash
A=/opt/SoftFactory-AINative/artifacts/YUNZ-20
cp $A/selftest/live/live-page-export.mjs $A/selftest/live/live-idcell.mjs /opt/wbs-rongcheng/tests/.tmp/
docker run --rm --network host -v /opt/wbs-rongcheng:/opt/wbs-rongcheng -w /opt/wbs-rongcheng \
  docker.m.daocloud.io/library/node:24-slim node tests/.tmp/live-page-export.mjs
docker run --rm --network host -v /opt/wbs-rongcheng:/opt/wbs-rongcheng -w /opt/wbs-rongcheng \
  docker.m.daocloud.io/library/node:24-slim node tests/.tmp/live-idcell.mjs
```
