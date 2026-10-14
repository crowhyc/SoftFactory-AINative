# WC-001 作者自测说明（YUNZ-21 / AI-IE）

## 逐项输出
- `matrix-summary.txt`：18 项作者自测矩阵 + 4 项容器附加项的逐项结论。
- `01.log` ~ `18.log`、`16b.log`、`19.log` ~ `21.log`：每项的实际命令与完整输出（含 PASS/FAIL 明细）。
- `12.log` 内含导出保真的两套校验（36 行与 34 行变体）；`WARN` 行说明社区版 SheetJS 的样式表行为。
- `../evidence/input-receipt.txt`：开工前对 `/opt/wbs-rongcheng-staging/WC-001/INPUT-SHA256SUMS` 的自证结果（8/8 OK）。

## 复现命令
```bash
cd /opt/wbs-rongcheng            # 运行产物目录（权威）
bash tests/verify.sh             # 全矩阵：node 自测 + python 导出校验 + docker 构建/部署/回滚
```
单项复跑：
```bash
node tests/selfcheck.js --only render36,conflict,tensaves   # API/磁盘/并发/原子写
node tests/domcheck.mjs --only identity,others,adddelete    # jsdom DOM 级交互
node tests/exportcheck.mjs && python3 tests/export_verify.py \
  "/opt/wbs-rongcheng/tests/.tmp/蓉城战役WBS-$(date +%Y%m%d).xlsx" \
  public/template.xlsx tests/.tmp/wbs-from-api.json 36      # 导出保真（zip/XML 直解，不依赖 openpyxl）
bash tests/deploy_selftest.sh build|roundtrip|restart|rollback
```

## 环境与依赖边界
- 本次自测环境：node v24.21.0、python3 3.6.8、docker 26.1.4、jsdom 30.1.2。
- jsdom 仅作测试工具，安装在 `/opt/wbs-rongcheng/tests/.tools/`（**不进源码快照、不进镜像**）；缺失时 `domcheck.mjs` 打印 SKIP 而不失败。
- 产物运行时**零第三方依赖**：`server.js` 只用 Node 标准库；前端只用随包 `public/vendor/xlsx.full.min.js`（0.18.5，sha256 锁定）。
- 说明：本机 node 进程的沙箱网络视图看不到已部署容器，因此容器往返用 `curl`（`tests/container_roundtrip.sh`）而非 node fetch。
