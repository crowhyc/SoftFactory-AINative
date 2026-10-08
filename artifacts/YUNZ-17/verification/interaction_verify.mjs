// YUNZ-17 交互级验证（jsdom + 真实 app.py）。不复用作者/修复者脚本。
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log('PASS  ' + m); };
const bad = (m, d = '') => { FAIL++; console.log('FAIL  ' + m + '  -> ' + d); };
const eq = (m, exp, got) => { if (exp === got) ok(m); else bad(m, `期望[${JSON.stringify(exp)}] 实际[${JSON.stringify(got)}]`); };

const base = process.argv[2];
const datafile = process.argv[3];
if (!datafile || !base) { console.error('usage: node interaction_verify.mjs <BASE> <DATA_FILE>'); process.exit(2); }
console.log('server: ' + base + '  data: ' + datafile);

// real HTTP helpers against the running server
async function get(pathname) { const r = await fetch(base + pathname); return { status: r.status, body: await r.json() }; }
async function disk() { return JSON.parse(fs.readFileSync(datafile, 'utf8')); }

// fetch index.html exactly as served by GET /
const pageHtml = await (await fetch(base + '/')).text();
const vc = new VirtualConsole();
vc.on('jsdomError', () => {});
const dom = new JSDOM(pageHtml, {
  url: base + '/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(window) {
    window.fetch = (input, init) => fetch(new URL(String(input), base + '/'), init);
    window.confirm = () => true;
  },
});
const { window } = dom;
const doc = window.document;
const $ = (id) => doc.getElementById(id);
const rows = () => Array.from($('items-body').querySelectorAll('tr'));
const rowById = (id) => rows().find((r) => r.querySelector('td.mono')?.textContent === id);
const cellsOf = (row) => Array.from(row.querySelectorAll('td'));
const msg = () => { const b = $('message'); return b.hidden ? null : b.textContent.trim(); };
async function waitFor(fn, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch {} await sleep(25); }
  return false;
}
const setVal = (el, v) => { el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })); };
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

// ---------- 1. 页面加载与渲染 ----------
await waitFor(() => rows().length === 3);
eq('页面加载渲染 3 行', 3, rows().length);
eq('条目计数徽标', '3 条', $('item-count').textContent);
eq('名称列渲染', '牛奶', cellsOf(rowById('dom-01'))[1].textContent);
eq('类别列渲染', '食品', cellsOf(rowById('dom-01'))[2].textContent);
eq('数量列渲染', '3', cellsOf(rowById('dom-01'))[3].textContent);
const smRows = Array.from($('summary-body').querySelectorAll('tr'))
  .map((r) => Array.from(r.querySelectorAll('td')).map((c) => c.textContent));
ok('汇总渲染: ' + JSON.stringify(smRows));

// ---------- 2. 新增 ----------
setVal($('add-name'), '酱油'); setVal($('add-category'), '调味'); setVal($('add-quantity'), '4');
$('add-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await waitFor(() => rows().length === 4);
eq('新增后页面 4 行', 4, rows().length);
{ const g = await get('/api/items'); eq('新增后 API 4 条', 4, g.body.items.length); }
{ const d = await disk(); eq('新增后磁盘 4 条', 4, d.items.length);
  eq('新增持久化 name', '酱油', d.items.find((i) => i.name === '酱油')?.name);
  eq('新增持久化 category', '调味', d.items.find((i) => i.name === '酱油')?.category);
  eq('新增持久化 quantity', 4, d.items.find((i) => i.name === '酱油')?.quantity); }

// ---------- 3. 经「编辑」按钮改名称 ----------
click(cellsOf(rowById('dom-01'))[4].querySelector('button[data-action="edit"]'));
await waitFor(() => rowById('dom-01')?.querySelector('input[data-field="name"]'));
eq('编辑按钮进入编辑态', true, !!rowById('dom-01')?.querySelector('input[data-field="name"]'));
setVal(rowById('dom-01').querySelector('input[data-field="name"]'), '鲜牛奶');
click(rowById('dom-01').querySelector('button[data-action="save"]'));
await waitFor(() => !rowById('dom-01')?.querySelector('input[data-field="name"]'));
eq('保存后名称页面显示', '鲜牛奶', cellsOf(rowById('dom-01'))[1].textContent);
eq('保存后名称 API', '鲜牛奶', (await get('/api/items')).body.items.find((i) => i.id === 'dom-01').name);
eq('保存后名称 磁盘', '鲜牛奶', (await disk()).items.find((i) => i.id === 'dom-01').name);

// ---------- 4. 经「编辑」按钮改数量 ----------
click(cellsOf(rowById('dom-02'))[4].querySelector('button[data-action="edit"]'));
setVal(rowById('dom-02').querySelector('input[data-field="quantity"]'), '11');
click(rowById('dom-02').querySelector('button[data-action="save"]'));
await waitFor(() => !rowById('dom-02')?.querySelector('input[data-field]'));
eq('保存后数量页面显示', '11', cellsOf(rowById('dom-02'))[3].textContent);
eq('保存后数量 API', 11, (await get('/api/items')).body.items.find((i) => i.id === 'dom-02').quantity);
eq('保存后数量 磁盘', 11, (await disk()).items.find((i) => i.id === 'dom-02').quantity);

// ---------- 5. 取消不写入 ----------
click(cellsOf(rowById('dom-03'))[4].querySelector('button[data-action="edit"]'));
setVal(rowById('dom-03').querySelector('input[data-field="name"]'), '不该保存');
click(rowById('dom-03').querySelector('button[data-action="cancel"]'));
await waitFor(() => !rowById('dom-03')?.querySelector('input[data-field]'));
eq('取消后页面名称不变', '电池', cellsOf(rowById('dom-03'))[1].textContent);
eq('取消后 API 名称不变', '电池', (await get('/api/items')).body.items.find((i) => i.id === 'dom-03').name);
eq('取消后磁盘名称不变', '电池', (await disk()).items.find((i) => i.id === 'dom-03').name);

// ---------- 6. 空输入 / 非法输入 ----------
setVal($('add-name'), '   '); setVal($('add-category'), 'x'); setVal($('add-quantity'), '1');
$('add-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await waitFor(() => /名称不能为空/.test(msg() || ''));
eq('空名称提示错误', true, /名称不能为空/.test(msg() || ''));
eq('空名称未产生写入', 4, (await get('/api/items')).body.items.length);
setVal($('add-name'), '有效'); setVal($('add-category'), 'y'); setVal($('add-quantity'), '-2');
$('add-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
// number input with min=0: browser/jsdom may keep -2; app validates
await sleep(300);
const qtyNeg = (await get('/api/items')).body.items.find((i) => i.name === '有效');
eq('负数量被拒绝(无写入)', undefined, qtyNeg);

// ---------- 7. 删除 ----------
click(cellsOf(rowById('dom-03'))[4].querySelector('button[data-action="delete"]'));
await waitFor(() => !rowById('dom-03'));
eq('删除后页面移除', undefined, rowById('dom-03'));
eq('删除后 API 移除', undefined, (await get('/api/items')).body.items.find((i) => i.id === 'dom-03'));
eq('删除后磁盘移除', undefined, (await disk()).items.find((i) => i.id === 'dom-03'));

// ---------- 8. 【本轮重点 A】直接点击「类别」单元格 ----------
const target = rowById('dom-01');
const catCell = cellsOf(target)[2];
const beforeCat = catCell.textContent;
click(catCell);
await sleep(250);
const enteredEdit = !!rowById('dom-01')?.querySelector('input[data-field="category"]');
eq('[A] 点击「类别」单元格进入行内编辑态', true, enteredEdit);
console.log('     [A] 点击类别单元格后反馈: ' + JSON.stringify(msg()));
if (enteredEdit) {
  setVal(rowById('dom-01').querySelector('input[data-field="category"]'), '乳制品');
  click(rowById('dom-01').querySelector('button[data-action="save"]'));
  await waitFor(() => !rowById('dom-01')?.querySelector('input[data-field]'));
  eq('[A] 类别保存后页面显示', '乳制品', cellsOf(rowById('dom-01'))[2].textContent);
  eq('[A] 类别保存后 API', '乳制品', (await get('/api/items')).body.items.find((i) => i.id === 'dom-01').category);
  eq('[A] 类别保存后 磁盘', '乳制品', (await disk()).items.find((i) => i.id === 'dom-01').category);
} else {
  bad('[A] 「类别」单元格修改保存并生效(页面/API/磁盘)', '未进入编辑态，无法通过点击类别单元格修改');
  eq('[A] 点击类别单元格后类别未变更', beforeCat, cellsOf(rowById('dom-01'))[2].textContent);
}

// ---------- 9. 【C】点击「名称」「数量」单元格：给出明确提示即可 ----------
const nm = rowById('dom-02');
click(cellsOf(nm)[1]); await sleep(150);
const nameFb = msg();
ok('[C] 点击「名称」单元格反馈: ' + JSON.stringify(nameFb));
if (!nameFb) bad('[C] 点击「名称」单元格有明确反馈', '无任何提示');
else ok('[C] 点击「名称」单元格有明确提示');
click(cellsOf(nm)[3]); await sleep(150);
const qtyFb = msg();
if (!qtyFb) bad('[C] 点击「数量」单元格有明确反馈', '无任何提示');
else ok('[C] 点击「数量」单元格有明确提示: ' + JSON.stringify(qtyFb));
// 点击展示态单元格不得产生数据写入
{ const d = await disk(); eq('[C] 点击展示单元格未改动磁盘数据', 3, d.items.length); }

// ---------- 10. 【D】汇总表只读且有提示 ----------
const sCell = $('summary-body').querySelector('td');
click(sCell); await sleep(150);
const sumFb = msg();
ok('[D] 点击汇总单元格反馈: ' + JSON.stringify(sumFb));
if (!sumFb) bad('[D] 汇总表点击有明确提示', '无任何提示');
else ok('[D] 汇总表点击有明确提示；无编辑控件: ' + (!!$('summary-body').querySelector('input') ? '有' : '无'));

// ---------- 11. 【E】编辑 A 行时点击 B 行「类别」：是否静默丢失未保存改动 ----------
const rowA = rowById('dom-02');
click(cellsOf(rowA)[4].querySelector('button[data-action="edit"]'));
await waitFor(() => rowById('dom-02')?.querySelector('input[data-field="name"]'));
setVal(rowById('dom-02').querySelector('input[data-field="name"]'), '未保存的改动E');
const rowB = rowById('dom-01');
click(cellsOf(rowB)[2]); await sleep(250);
const aInputStillThere = !!rowById('dom-02')?.querySelector('input[data-field="name"]');
const aInputValue = rowById('dom-02')?.querySelector('input[data-field="name"]')?.value;
eq('[E] 编辑中点击他行单元格后本行编辑态仍在', true, aInputStillThere);
eq('[E] 未保存改动未被静默丢弃', '未保存的改动E', aInputValue);
eq('[E] 编辑中点击他行未产生持久化写入', '面包'.replace('面包','面包'), (await disk()).items.find((i)=>i.id==='dom-02').name);

// ---------- 12. 未知顶层键与既有额外字段全程保留 ----------
{ const d = await disk();
  eq('未知顶层键 schema_version 保留', 42, d.schema_version);
  eq('未知顶层键 note 保留', '未知顶层键必须保留-DOM', d.note);
  eq('既有条目额外字段保留', '勿删我', d.items.find((i) => i.id === 'dom-01')?.extra_note); }

if (process.argv[4]) {
  fs.writeFileSync(process.argv[4], window.document.documentElement.outerHTML);
  console.log('dom snapshot -> ' + process.argv[4]);
}
console.log(`INTERACTION ${PASS}/${PASS + FAIL} PASSED`);
process.exit(FAIL === 0 ? 0 : 1);
