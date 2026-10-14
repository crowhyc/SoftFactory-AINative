'use strict';
/* YUNZ-20 Stage3 复验 —— 路径统一核验：用运行态 app.js 的 Core.buildExportWorkbook
 * （作者自测 tests/exportcheck.mjs 所调用的同一函数）构建导出，与页面导出入口逐列比对。 */
const fs = require('fs'), path = require('path');
const PUB = process.env.PUB || '/opt/wbs-rongcheng/public';
const OUT = process.env.OUT || path.join(__dirname, '..');
const XLSX = require(path.join(PUB, 'vendor', 'xlsx.full.min.js'));
global.XLSX = XLSX;
const Core = require(path.join(PUB, 'app.js'));
const doc = JSON.parse(fs.readFileSync('/opt/wbs-rongcheng/data/wbs.json', 'utf8'));
const tpl = new Uint8Array(fs.readFileSync(path.join(PUB, 'template.xlsx')));
const wb = Core.buildExportWorkbook(tpl, doc.tasks);
const out = path.join(OUT, 'exported-selftest-path-stage3.xlsx');
fs.writeFileSync(out, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
console.log('selftest-path export =', out, fs.statSync(out).size, 'bytes; tasks =', doc.tasks.length);
console.log('Core.buildExportWorkbook 存在 =', typeof Core.buildExportWorkbook === 'function');
