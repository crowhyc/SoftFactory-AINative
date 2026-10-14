// 缺陷 D-1 复现路径取证：以「项目负责人」进入真实容器页面 → 点「导出 Excel」→ 读回断言 <cols> 与 A–K 列宽。
// 运行（宿主，node 需与容器共享宿主回环）：docker run --rm --network host -v /opt/wbs-rongcheng:/opt/wbs-rongcheng -w /opt/wbs-rongcheng node:24-slim node tests/.tmp/live-page-export.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { readCols } from '/opt/wbs-rongcheng/tests/xlsxcols.mjs';

const require = createRequire('/opt/wbs-rongcheng/tests/.tools/package.json');
const { JSDOM, VirtualConsole } = require('jsdom');
const PUB = '/opt/wbs-rongcheng/public';
const API = process.env.LIVE_API || 'http://127.0.0.1:4180';
const OUT = process.env.OUT || '/opt/wbs-rongcheng/tests/.tmp/live-page-export.xlsx';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (m, x) => { pass += 1; console.log('PASS  ' + m + (x ? '  :: ' + x : '')); };
const bad = (m, d) => { fail += 1; console.log('FAIL  ' + m + '  -> ' + d); };

const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8').replace(/<script\b[^>]*>\s*<\/script>/gi, '');
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => console.log('[jsdomError] ' + e.message));
const dom = new JSDOM(html, { url: API + '/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const w = dom.window;
w.fetch = (input, init) => fetch(new URL(typeof input === 'string' ? input : input.url, API + '/'), init);
const wait = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (fn()) return true; } catch (e) { /* retry */ } await sleep(25); } return false; };

w.eval(fs.readFileSync(path.join(PUB, 'vendor/xlsx.full.min.js'), 'utf8'));
w.eval(fs.readFileSync(path.join(PUB, 'app.js'), 'utf8'));
if (!(await wait(() => w.WBSApp && w.WBSApp.state.doc))) { bad('页面未就绪', 'state.doc 未加载'); process.exit(1); }
const btn = w.document.querySelector('#identity-list .identity-btn[data-identity="项目负责人"]');
btn.click();
if (!(await wait(() => w.document.querySelectorAll('#wbs-body tr').length === 36))) { bad('工作台未渲染 36 行', 'rows=' + w.document.querySelectorAll('#wbs-body tr').length); process.exit(1); }
ok('真实容器页面：以「项目负责人」进入，渲染 36 行', w.document.querySelectorAll('#wbs-body tr').length + ' 行 · ' + API);

let captured = null, capturedName = null;
w.XLSX.writeFile = (wb, name) => { captured = Buffer.from(w.XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })); capturedName = name; };
w.document.getElementById('export-btn').click();
if (!(await wait(() => captured !== null))) { bad('页面「导出 Excel」未产出文件', 'XLSX.writeFile 未被调用'); process.exit(1); }
fs.writeFileSync(OUT, captured);
const sha = crypto.createHash('sha256').update(captured).digest('hex');
ok('页面「导出 Excel」产出文件', capturedName + ' · ' + captured.length + ' 字节 · sha256 ' + sha);

const outCols = readCols(OUT);
const tplCols = readCols(path.join(PUB, 'template.xlsx'));
if (outCols.hasCols) ok('导出文件含 <cols> 列宽定义（C-ADV 修复前为 0 条）', '<col> 声明 ' + outCols.count + ' 条');
else bad('导出文件缺少 <cols>（列宽丢失，缺陷 D-1 未修）', 'sheet1.xml 无 <cols> 元素');
const diff = [];
for (let i = 0; i < 11; i += 1) if (tplCols.widths[i] !== outCols.widths[i]) diff.push(String.fromCharCode(65 + i) + ' 模板' + tplCols.widths[i] + ' 导出' + outCols.widths[i]);
if (diff.length === 0) ok('导出 A–K 列宽与源模板逐列一致（K 进展说明列 47.26）', 'A–K=' + outCols.widths.slice(0, 11).join(','));
else bad('导出 A–K 列宽与模板不一致', diff.join('; '));
console.log('ARTIFACT live_export_file=' + OUT);
console.log('---');
console.log('PASS=' + pass + ' FAIL=' + fail);
process.exit(fail === 0 ? 0 : 1);
