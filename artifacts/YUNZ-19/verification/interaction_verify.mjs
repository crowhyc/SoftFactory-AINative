// YUNZ-19 独立交互级验证（jsdom + 真实 python3 app.py）。自写脚本，不复用作者/修复者脚本。
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log('PASS  ' + m); };
const bad = (m, d = '') => { FAIL++; console.log('FAIL  ' + m + '  -> ' + d); };
const eq = (m, exp, got) => { if (exp === got) ok(m); else bad(m, `期望[${JSON.stringify(exp)}] 实际[${JSON.stringify(got)}]`); };

const base = process.argv[2], datafile = process.argv[3], snap = process.argv[4];
if (!base || !datafile) { console.error('usage: node interaction_verify.mjs <BASE> <DATA_FILE> [SNAPSHOT]'); process.exit(2); }
console.log('server: ' + base + '  data: ' + datafile);

async function get(p) { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; }
function disk() { return JSON.parse(fs.readFileSync(datafile, 'utf8')); }

const pageHtml = await (await fetch(base + '/')).text();
const vc = new VirtualConsole(); vc.on('jsdomError', () => {});
const dom = new JSDOM(pageHtml, {
  url: base + '/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(window) {
    window.fetch = (input, init) => fetch(new URL(String(input), base + '/'), init);
    window.confirm = () => true;
  },
});
const { window } = dom, doc = window.document;
const $ = (id) => doc.getElementById(id);
const rows = () => Array.from($('items-body').querySelectorAll('tr'));
const rowById = (id) => rows().find((r) => r.querySelector('td.mono')?.textContent === id);
const cells = (r) => Array.from(r.querySelectorAll('td'));
const msg = () => { const b = $('message'); return b && !b.hidden ? b.textContent.trim() : null; };
const editingId = () => { const r = rows().find((x) => x.querySelector('input[data-field]')); return r ? r.getAttribute('data-id') : null; };
async function waitFor(fn, ms = 5000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch {} await sleep(25); } return false; }
const setVal = (el, v) => { el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })); };
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const submit = (el) => el.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

await waitFor(() => rows().length === 3);

// ---------- 1. 页面加载与渲染 ----------
eq('页面加载渲染 3 行', 3, rows().length);
eq('条目计数徽标', '3 条', $('item-count').textContent);
eq('名称列渲染', '牛奶', cells(rowById('dom-01'))[1].textContent);
eq('类别列渲染', '食品', cells(rowById('dom-01'))[2].textContent);
eq('数量列渲染', '3', cells(rowById('dom-01'))[3].textContent);
eq('类别展示单元格带 data-edit 标记', 'category', cells(rowById('dom-01'))[2].getAttribute('data-edit'));
const sm0 = Array.from($('summary-body').querySelectorAll('tr')).map((r) => Array.from(r.querySelectorAll('td')).map((c) => c.textContent));
ok('汇总渲染: ' + JSON.stringify(sm0));

// ---------- 2. 新增 ----------
setVal($('add-name'), '酱油'); setVal($('add-category'), '调味'); setVal($('add-quantity'), '4');
submit($('add-form'));
await waitFor(() => rows().length === 4);
eq('新增后页面 4 行', 4, rows().length);
eq('新增后 API 4 条', 4, (await get('/api/items')).body.items.length);
{ const added = (await disk()).items.find((i) => i.name === '酱油');
  eq('新增后磁盘 4 条', 4, (await disk()).items.length);
  eq('新增持久化 category', '调味', added?.category); eq('新增持久化 quantity', 4, added?.quantity); }

// ---------- 3. 经「编辑」按钮改名称·数量 ----------
click(cells(rowById('dom-01'))[4].querySelector('button[data-action="edit"]'));
await waitFor(() => rowById('dom-01')?.querySelector('input[data-field="name"]'));
ok('「编辑」按钮进入编辑态');
setVal(rowById('dom-01').querySelector('input[data-field="name"]'), '鲜牛奶');
click(rowById('dom-01').querySelector('button[data-action="save"]'));
await waitFor(() => !rowById('dom-01')?.querySelector('input[data-field]'));
eq('改名后页面显示', '鲜牛奶', cells(rowById('dom-01'))[1].textContent);
eq('改名后 API', '鲜牛奶', (await get('/api/items')).body.items.find((i) => i.id === 'dom-01').name);
eq('改名后磁盘', '鲜牛奶', (await disk()).items.find((i) => i.id === 'dom-01').name);

click(cells(rowById('dom-02'))[4].querySelector('button[data-action="edit"]'));
await waitFor(() => rowById('dom-02')?.querySelector('input[data-field="quantity"]'));
setVal(rowById('dom-02').querySelector('input[data-field="quantity"]'), '11');
click(rowById('dom-02').querySelector('button[data-action="save"]'));
await waitFor(() => !rowById('dom-02')?.querySelector('input[data-field]'));
eq('改数量后页面显示', '11', cells(rowById('dom-02'))[3].textContent);
eq('改数量后 API', 11, (await get('/api/items')).body.items.find((i) => i.id === 'dom-02').quantity);
eq('改数量后磁盘', 11, (await disk()).items.find((i) => i.id === 'dom-02').quantity);

// ---------- 4. 取消不写入 ----------
click(cells(rowById('dom-01'))[4].querySelector('button[data-action="edit"]'));
await waitFor(() => rowById('dom-01')?.querySelector('input[data-field="name"]'));
setVal(rowById('dom-01').querySelector('input[data-field="name"]'), '不应保存');
click(rowById('dom-01').querySelector('button[data-action="cancel"]'));
await waitFor(() => !rowById('dom-01')?.querySelector('input[data-field]'));
eq('取消后页面名称不变', '鲜牛奶', cells(rowById('dom-01'))[1].textContent);
eq('取消后 API 名称不变', '鲜牛奶', (await get('/api/items')).body.items.find((i) => i.id === 'dom-01').name);
eq('取消后磁盘名称不变', '鲜牛奶', (await disk()).items.find((i) => i.id === 'dom-01').name);

// ---------- 5. 【A 核心】点击「类别」单元格进入行内编辑态并保存生效 ----------
const before = disk().items.find((i) => i.id === 'dom-01');
click(cells(rowById('dom-01'))[2]);
await waitFor(() => rowById('dom-01')?.querySelector('input[data-field="category"]'));
const catInput = rowById('dom-01')?.querySelector('input[data-field="category"]');
eq('[A] 点击「类别」单元格进入行内编辑态', true, !!catInput);
eq('[A] 聚焦到类别输入框', true, doc.activeElement === catInput);
console.log('     [A] 点击类别单元格后反馈: ' + JSON.stringify(msg()));
eq('[A] 类别输入框初值为原类别', '食品', catInput?.value);
setVal(catInput, '乳制品');
click(rowById('dom-01').querySelector('button[data-action="save"]'));
await waitFor(() => !rowById('dom-01')?.querySelector('input[data-field]'));
eq('[A] 类别保存后页面显示', '乳制品', cells(rowById('dom-01'))[2].textContent);
eq('[A] 类别保存后 API', '乳制品', (await get('/api/items')).body.items.find((i) => i.id === 'dom-01').category);
eq('[A] 类别保存后 磁盘', '乳制品', (await disk()).items.find((i) => i.id === 'dom-01').category);
const after = disk().items.find((i) => i.id === 'dom-01');
eq('[A] 保存未牵连名称', '鲜牛奶', after.name);
eq('[A] 保存未牵连数量', before.quantity, after.quantity);

// ---------- 6. 【C】名称 / 数量 / id 展示态保持现状（提示 + 不进入编辑 + 不写入） ----------
{ const nm = rowById('dom-02');
  click(cells(nm)[1]); await sleep(200);
  const fb = msg(); ok('[C] 点击「名称」单元格反馈: ' + JSON.stringify(fb));
  eq('[C] 名称单元格有明确提示', true, !!fb);
  eq('[C] 名称单元格未进入编辑态', false, !!rowById('dom-02')?.querySelector('input[data-field]'));
  click(cells(nm)[3]); await sleep(200);
  const qb = msg(); eq('[C] 数量单元格有明确提示', true, !!qb);
  eq('[C] 数量单元格未进入编辑态', false, !!rowById('dom-02')?.querySelector('input[data-field]'));
  click(cells(nm)[0]); await sleep(200);
  const ib = msg(); eq('[C] id 单元格有明确提示', true, !!ib);
  eq('[C] 计数未变(无写入)', 4, (await disk()).items.length); }

// ---------- 7. 【D】汇总表只读且有明确提示 ----------
{ const sc = $('summary-body').querySelector('td');
  click(sc); await sleep(200);
  const fb = msg(); ok('[D] 点击汇总单元格反馈: ' + JSON.stringify(fb));
  eq('[D] 汇总表有明确提示', true, !!fb);
  eq('[D] 汇总表无编辑控件', null, $('summary-body').querySelector('input')); }
ok('[A] 汇总已按新类别更新: ' + JSON.stringify(Array.from($('summary-body').querySelectorAll('tr')).map((r) => Array.from(r.querySelectorAll('td')).map((c) => c.textContent))));

// ---------- 8. 【E】编辑中点击他行「类别」单元格 / 「编辑」按钮：不得静默切换或丢弃 ----------
click(cells(rowById('dom-02'))[2]);                    // 用类别单元格进入 dom-02 编辑
await waitFor(() => rowById('dom-02')?.querySelector('input[data-field="name"]'));
setVal(rowById('dom-02').querySelector('input[data-field="name"]'), '未保存E');
eq('[E] 准备态：editingId=dom-02', 'dom-02', editingId());
click(cells(rowById('dom-03'))[2]);                     // 点他行「类别」单元格
await sleep(250);
const fbE1 = msg();
ok('[E] 点他行「类别」单元格反馈: ' + JSON.stringify(fbE1));
eq('[E] 有明确反馈(非静默)', true, !!fbE1);
eq('[E] 未隐式切换编辑目标', 'dom-02', editingId());
eq('[E] 本行未保存改动仍在', '未保存E', rowById('dom-02')?.querySelector('input[data-field="name"]')?.value);
eq('[E] 他行未被置入编辑态', false, !!rowById('dom-03')?.querySelector('input[data-field]'));
eq('[E] 未产生持久化写入', '面包', (await disk()).items.find((i) => i.id === 'dom-02').name);
// 再点他行「编辑」按钮（YUNZ-18 加固）
click(cells(rowById('dom-01'))[4].querySelector('button[data-action="edit"]'));
await sleep(250);
const fbE2 = msg();
ok('[E] 点他行「编辑」按钮反馈: ' + JSON.stringify(fbE2));
eq('[E] 点他行「编辑」按钮有明确反馈', true, !!fbE2);
eq('[E] 编辑目标仍为 dom-02', 'dom-02', editingId());
eq('[E] 未保存改动仍保留', '未保存E', rowById('dom-02')?.querySelector('input[data-field="name"]')?.value);
eq('[E] 未产生持久化写入(编辑按钮)', '面包', (await disk()).items.find((i) => i.id === 'dom-02').name);
// 无编辑时切换应正常
click(rowById('dom-02').querySelector('button[data-action="cancel"]'));
await waitFor(() => !rowById('dom-02')?.querySelector('input[data-field]'));
click(cells(rowById('dom-01'))[4].querySelector('button[data-action="edit"]'));
await sleep(200);
eq('[E] 无进行中编辑时切换正常(不过度阻止)', 'dom-01', editingId());
click(rowById('dom-01').querySelector('button[data-action="cancel"]'));
await waitFor(() => !rowById('dom-01')?.querySelector('input[data-field]'));

// ---------- 9. 空 / 非法输入：明确报错且无写入 ----------
{ const n0 = (await disk()).items.length;
  setVal($('add-name'), ''); setVal($('add-category'), 'x'); setVal($('add-quantity'), '1');
  submit($('add-form')); await sleep(200);
  eq('空名称明确报错', true, !!msg()); eq('空名称未写入', n0, (await disk()).items.length);
  setVal($('add-name'), '有效'); setVal($('add-category'), ''); submit($('add-form')); await sleep(200);
  eq('空类别明确报错', true, !!msg()); eq('空类别未写入', n0, (await disk()).items.length);
  setVal($('add-name'), '有效'); setVal($('add-category'), 'y'); setVal($('add-quantity'), '-2');
  submit($('add-form')); await sleep(200);
  eq('负数量明确报错', true, !!msg()); eq('负数量未写入', n0, (await disk()).items.length);
  eq('负数量条目未落库', undefined, (await disk()).items.find((i) => i.name === '有效')); }

// ---------- 10. 删除 ----------
{ click(cells(rowById('dom-03'))[4].querySelector('button[data-action="delete"]'));
  await waitFor(() => !rowById('dom-03'));
  eq('删除后页面移除', undefined, rowById('dom-03'));
  eq('删除后 API 移除', undefined, (await get('/api/items')).body.items.find((i) => i.id === 'dom-03'));
  eq('删除后磁盘移除', undefined, (await disk()).items.find((i) => i.id === 'dom-03')); }

// ---------- 11. 数据保全 ----------
{ const d = disk();
  eq('未知顶层键 schema_version 保留', 42, d.schema_version);
  eq('未知顶层键 note 保留', '未知顶层键必须保留-DOM', d.note);
  eq('既有条目额外字段保留', '勿删我', d.items.find((i) => i.id === 'dom-01')?.extra_note); }

if (snap) { fs.writeFileSync(snap, window.document.documentElement.outerHTML); console.log('dom snapshot -> ' + snap); }
console.log(`INTERACTION ${PASS}/${PASS + FAIL} PASSED`);
process.exit(FAIL === 0 ? 0 : 1);
