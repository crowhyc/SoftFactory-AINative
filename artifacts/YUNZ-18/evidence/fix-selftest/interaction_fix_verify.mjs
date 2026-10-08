// YUNZ-18 修复自证：jsdom + 真实 app.py，逐步用 /api 与磁盘核对持久化。
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log('PASS  ' + m); };
const bad = (m, d = '') => { FAIL++; console.log('FAIL  ' + m + ' -> ' + d); };
const eq = (m, exp, got) => { if (exp === got) ok(m); else bad(m, `期望[${JSON.stringify(exp)}] 实际[${JSON.stringify(got)}]`); };

const base = process.argv[2];
const datafile = process.argv[3];
if (!base || !datafile) { console.error('usage: node interaction_fix_verify.mjs <BASE> <DATA_FILE>'); process.exit(2); }

const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };
const disk = async () => JSON.parse(fs.readFileSync(datafile, 'utf8'));

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
const rowById = (id) => rows().find((r) => r.getAttribute('data-id') === id);
const cellsOf = (row) => Array.from(row.querySelectorAll('td'));
const msg = () => { const b = $('message'); return b.hidden ? null : b.textContent.trim(); };
async function waitFor(fn, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch {} await sleep(25); }
  return false;
}
const setVal = (el, v) => { el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })); };
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

await waitFor(() => rows().length === 3);
eq('前置：页面渲染 3 行', 3, rows().length);

// ---- A: 直接点击「类别」单元格 -> 行内编辑态 -> 修改 -> 保存 -> 页面/API/磁盘一致 ----
click(cellsOf(rowById('dom-01'))[2]);
await waitFor(() => rowById('dom-01')?.querySelector('input[data-field="category"]'));
eq('[A] 点击类别单元格出现可编辑输入控件', true, !!rowById('dom-01')?.querySelector('input[data-field="category"]'));
ok('[A] 进入编辑态反馈: ' + JSON.stringify(msg()));
setVal(rowById('dom-01').querySelector('input[data-field="category"]'), '乳制品');
click(rowById('dom-01').querySelector('button[data-action="save"]'));
await waitFor(() => !rowById('dom-01')?.querySelector('input[data-field]'));
eq('[A] 保存后页面显示', '乳制品', cellsOf(rowById('dom-01'))[2].textContent);
eq('[A] 保存后 API', '乳制品', (await get('/api/items')).body.items.find((i) => i.id === 'dom-01').category);
eq('[A] 保存后磁盘', '乳制品', (await disk()).items.find((i) => i.id === 'dom-01').category);
eq('[A] 保存后其余字段未受影响(名称)', '牛奶', (await disk()).items.find((i) => i.id === 'dom-01').name);
eq('[A] 保存后其余字段未受影响(数量)', 3, (await disk()).items.find((i) => i.id === 'dom-01').quantity);

// ---- B: 编辑态「取消」不写入 ----
click(cellsOf(rowById('dom-02'))[2]);
await waitFor(() => rowById('dom-02')?.querySelector('input[data-field="category"]'));
setVal(rowById('dom-02').querySelector('input[data-field="category"]'), '不该落盘');
click(rowById('dom-02').querySelector('button[data-action="cancel"]'));
await sleep(250);
eq('[B] 取消后页面类别不变', '食品', cellsOf(rowById('dom-02'))[2].textContent);
eq('[B] 取消后 API 类别不变', '食品', (await get('/api/items')).body.items.find((i) => i.id === 'dom-02').category);
eq('[B] 取消后磁盘类别不变', '食品', (await disk()).items.find((i) => i.id === 'dom-02').category);

// ---- E: 一行经类别单元格进入编辑且有未保存改动时，点击另一行「类别」 -> 显式阻止，不静默 ----
click(cellsOf(rowById('dom-02'))[2]);
await waitFor(() => rowById('dom-02')?.querySelector('input[data-field="category"]'));
setVal(rowById('dom-02').querySelector('input[data-field="category"]'), '未保存E');
const beforeDisk = JSON.stringify(await disk());
click(cellsOf(rowById('dom-03'))[2]);
await sleep(250);
const stillEditingA = !!rowById('dom-02')?.querySelector('input[data-field="category"]');
const valA = rowById('dom-02')?.querySelector('input[data-field="category"]')?.value;
const bEnteredEdit = !!rowById('dom-03')?.querySelector('input[data-field]');
eq('[E] 他行未被隐式切换为编辑目标', false, bEnteredEdit);
eq('[E] 本行编辑态仍在', true, stillEditingA);
eq('[E] 未保存改动未被静默丢弃', '未保存E', valA);
ok('[E] 阻止时的明确反馈: ' + JSON.stringify(msg()));
eq('[E] 阻止期间未产生持久化写入', beforeDisk, JSON.stringify(await disk()));
// 同一类风险：点击他行「编辑」按钮也不得隐式切换编辑目标
click(rowById('dom-03').querySelector('button[data-action="edit"]'));
await sleep(200);
eq('[E] 点击他行「编辑」按钮未被隐式切换为编辑目标', false, !!rowById('dom-03')?.querySelector('input[data-field]'));
eq('[E] 点击他行「编辑」按钮后本行编辑态仍在', '未保存E', rowById('dom-02')?.querySelector('input[data-field="category"]')?.value);
ok('[E] 编辑按钮阻止反馈: ' + JSON.stringify(msg()));
eq('[E] 编辑按钮阻止期间未产生持久化写入', beforeDisk, JSON.stringify(await disk()));
// 保存 A 行后，再点他行类别应可正常进入编辑
click(rowById('dom-02').querySelector('button[data-action="save"]'));
await waitFor(() => !rowById('dom-02')?.querySelector('input[data-field]'));
eq('[E] 保存后磁盘生效', '未保存E', (await disk()).items.find((i) => i.id === 'dom-02').category);
click(cellsOf(rowById('dom-03'))[2]);
await waitFor(() => rowById('dom-03')?.querySelector('input[data-field="category"]'));
eq('[E] 无进行中编辑时切换他行类别正常进入编辑态', true, !!rowById('dom-03')?.querySelector('input[data-field="category"]'));
click(rowById('dom-03').querySelector('button[data-action="cancel"]'));
await sleep(150);

// ---- C: 名称 / 数量 单元格保持原体验（提示，不进入编辑态） ----
const cRow = rowById('dom-03');
const beforeC = JSON.stringify(await disk());
click(cellsOf(cRow)[1]); await sleep(150);
const nameFb = msg();
eq('[C] 点击名称单元格给出提示', true, !!nameFb);
ok('[C] 名称提示文案: ' + JSON.stringify(nameFb));
eq('[C] 点击名称单元格不进入编辑态', false, !!rowById('dom-03')?.querySelector('input[data-field]'));
click(cellsOf(cRow)[3]); await sleep(150);
ok('[C] 数量提示文案: ' + JSON.stringify(msg()));
eq('[C] 点击数量单元格不进入编辑态', false, !!rowById('dom-03')?.querySelector('input[data-field]'));
click(cellsOf(cRow)[0]); await sleep(150);
ok('[C] id 单元格提示文案: ' + JSON.stringify(msg()));
eq('[C] 点击展示态单元格未改动磁盘', beforeC, JSON.stringify(await disk()));

// ---- D: 汇总表只读 + 提示 ----
click($('summary-body').querySelector('td')); await sleep(150);
eq('[D] 汇总单元格给出提示', true, !!msg());
eq('[D] 汇总表无编辑控件', false, !!$('summary-body').querySelector('input'));

// ---- 未知顶层键 / 既有额外字段全程保留 ----
const finalDisk = await disk();
eq('未知顶层键 schema_version 保留', 42, finalDisk.schema_version);
eq('未知顶层键 note 保留', '未知顶层键必须保留-DOM', finalDisk.note);
eq('既有条目额外字段保留', '勿删我', finalDisk.items.find((i) => i.id === 'dom-01')?.extra_note);
eq('条目总数仍为 3', 3, finalDisk.items.length);

console.log(`FIX-SELFTEST ${PASS}/${PASS + FAIL} PASSED`);
process.exit(FAIL === 0 ? 0 : 1);
