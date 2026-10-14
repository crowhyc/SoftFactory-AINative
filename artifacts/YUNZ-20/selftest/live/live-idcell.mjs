// 缺陷 D-2 复现路径取证：以「王言」进入真实容器页面 → 点击序号列单元格 → 断言给出中文只读提示且与相邻只读单元格一致。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire('/opt/wbs-rongcheng/tests/.tools/package.json');
const { JSDOM, VirtualConsole } = require('jsdom');
const PUB = '/opt/wbs-rongcheng/public';
const API = process.env.LIVE_API || 'http://127.0.0.1:4180';
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
w.document.querySelector('#identity-list .identity-btn[data-identity="王言"]').click();
if (!(await wait(() => w.document.querySelectorAll('#wbs-body tr').length === 36))) { bad('工作台未渲染 36 行', 'rows'); process.exit(1); }

const doc = w.document;
const hint = () => (doc.getElementById('hint').hidden ? '' : doc.getElementById('hint').textContent.trim());
const row = doc.querySelector('#wbs-body tr[data-id]');
const idCell = row.querySelector('td.cell-id');
if (!idCell) { bad('序号列单元格不存在', 'td.cell-id 未渲染'); process.exit(1); }
const hintBefore = hint();
idCell.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const idHint = hint();
if (idHint !== hintBefore && idHint.includes('只读') && idHint.includes('序号')) ok('真实容器页面：序号列点击给出中文只读提示（Stage2 为 silent=true）', idHint);
else bad('序号列点击未给出只读提示', 'before=' + JSON.stringify(hintBefore) + ' after=' + JSON.stringify(idHint));
if (!idCell.querySelector('input,textarea,select')) ok('序号列不进入编辑态（仍为只读展示列）', 'td.cell-id 内无编辑器');
else bad('序号列进入了编辑态', '出现 input/textarea/select');

const noteCell = row.querySelector('td[data-field="note"]');
noteCell.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const noteHint = hint();
if (idHint.replace('序号', '进展说明') === noteHint) ok('与相邻只读单元格（进展说明）行为一致：同文案模板，仅列名不同', noteHint);
else bad('与相邻只读单元格提示不一致', idHint + ' vs ' + noteHint);
console.log('---');
console.log('PASS=' + pass + ' FAIL=' + fail);
process.exit(fail === 0 ? 0 : 1);
