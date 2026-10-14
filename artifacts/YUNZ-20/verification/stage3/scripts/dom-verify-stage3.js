'use strict';
/* YUNZ-20 Stage3 复验 —— DOM 交互级验证（jsdom 执行交付页面脚本 + 真实 /api 核对）
 * 只读交付源码；写入仅落在本工作目录 OUT（证据），不改被验证代码。 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const PUB = process.env.PUB || '/opt/wbs-rongcheng/public';
const DATA = '/opt/wbs-rongcheng/data/wbs.json';
const API = 'http://127.0.0.1:4180';
const OUT = process.env.OUT || path.join(__dirname, 'dom-out');
fs.mkdirSync(OUT, { recursive: true });

const lines = [];
function L(m) { lines.push(m); console.log(m); }
const results = [];
function rec(id, name, pass, detail) {
  results.push({ id, name, pass: !!pass, detail });
  L('[' + (pass ? 'PASS' : 'FAIL') + '] ' + id + ' ' + name + ' :: ' + detail);
}
function assert(id, name, cond, detail) { rec(id, name, cond, detail); return !!cond; }

const seed = JSON.parse(fs.readFileSync('/opt/wbs-rongcheng/data/wbs.seed.json', 'utf8'));
const seedOrder = seed.tasks.map(t => t.id);
function readData() { return JSON.parse(fs.readFileSync(DATA, 'utf8')); }
async function apiGet() { const r = await fetch(API + '/api/wbs'); return r.json(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitFor(fn, ms = 8000, step = 25) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch (e) {} await sleep(step); }
  return false;
}

let putCalls = [];
let crossOrigin = [];
let exports_ = [];

function makeDom(opts) {
  opts = opts || {};
  const html0 = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  const html = html0.replace(/<script\b[^>]*>\s*<\/script>/gi, '<!-- script stripped for controlled eval -->');
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => L('  [jsdomError] ' + e.message));
  const dom = new JSDOM(html, {
    url: API + '/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  const w = dom.window;
  w.confirm = () => ('confirmAnswer' in opts ? opts.confirmAnswer : true);

  w.fetch = async function (input, init) {
    const u = new URL(typeof input === 'string' ? input : (input && input.url), API + '/');
    if (u.origin !== API) crossOrigin.push(u.href);
    if (u.pathname.indexOf('/api/') === 0) {
      if (init && init.method === 'PUT') putCalls.push({ t: Date.now(), url: u.href });
      return await fetch(u.href, init);
    }
    const rel = u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, '');
    const file = path.join(PUB, rel);
    if (!fs.existsSync(file)) return new Response('not found', { status: 404 });
    const buf = fs.readFileSync(file);
    const type = /\.xlsx$/.test(file)
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/octet-stream';
    return new Response(buf, { status: 200, headers: { 'Content-Type': type } });
  };

  if (opts.identity) w.localStorage.setItem('wbs.identity', opts.identity);

  w.eval(fs.readFileSync(path.join(PUB, 'vendor/xlsx.full.min.js'), 'utf8'));
  const realWriteFile = w.XLSX.writeFile;
  w.XLSX.writeFile = function (wb, name) {
    const buf = w.XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const p = path.join(OUT, 'export-captured.xlsx');
    fs.writeFileSync(p, buf);
    exports_.push({ name: name, bytes: buf.length, path: p });
    return { shim: true, name: name, path: p };
  };
  w.__realWriteFile = realWriteFile;
  w.eval(fs.readFileSync(path.join(PUB, 'app.js'), 'utf8'));

  return { dom, w };
}
function pickDoc(node) { return node && node.document ? node.document : node; }
const $ = (a, b) => (typeof a === 'string' ? pickDoc(b) : pickDoc(a)).querySelector(typeof a === 'string' ? a : b);
const $$ = (a, b) => {
  const doc = typeof a === 'string' ? pickDoc(b) : pickDoc(a);
  return Array.from(doc.querySelectorAll(typeof a === 'string' ? a : b));
};
const cell = (w, id, field) => w.document.querySelector('td[data-id="' + id + '"][data-field="' + field + '"]');
const rowIds = w => $$(w, '#wbs-body tr').map(r => r.getAttribute('data-id'));
const hintText = w => { const h = $('#hint', w); return !h || h.hidden ? '' : h.textContent; };
const bannerText = w => { const b = $('#banner', w); return !b || b.hidden ? '' : $('#banner-text', w).textContent; };

function chooseIdentity(w, id) {
  const btn = $$(w, '#identity-list .identity-btn').filter(b => b.getAttribute('data-identity') === id)[0];
  if (btn) btn.click();
  return !!btn;
}
function switchIdentity(w, id) {
  const sel = $('#identity-select', w);
  sel.value = id;
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
}
async function clickCellEdit(w, id, field, value) {
  const td = cell(w, id, field);
  if (!td) return { ok: false, why: 'cell missing' };
  td.click();
  await waitFor(() => td.querySelector('[data-edit-field]'), 1000);
  const ed = td.querySelector && td.querySelector('[data-edit-field]');
  if (!ed) return { ok: false, why: 'no editor opened (read-only?)' };
  const applied = (ed.value = value);
  ed.dispatchEvent(new w.Event('change', { bubbles: true }));
  await waitFor(() => !td.querySelector('[data-edit-field]'), 2000);
  return { ok: true, editorTag: ed.tagName, valueAfterSet: ed.value === undefined ? null : applied };
}
/* 仅探测是否打开编辑入口，随即 Escape 取消，不产生任何修改 */
async function opensEditor(w, id, field) {
  const td = cell(w, id, field);
  if (!td) return false;
  td.click();
  await waitFor(() => td.querySelector('[data-edit-field]'), 800);
  const ed = td.querySelector && td.querySelector('[data-edit-field]');
  if (!ed) return false;
  ed.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(30);
  return true;
}
function escapeEditor(w, id, field) {
  const td = cell(w, id, field);
  td.click();
  const ed = td.querySelector('[data-edit-field]');
  if (!ed) return { ok: false, why: 'no editor' };
  ed.value = 'SHOULD-NOT-PERSIST';
  ed.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return { ok: true };
}
async function clickSave(w) {
  const before = readData().meta.revision;
  const beforePuts = putCalls.length;
  $('#save-btn', w).click();
  await waitFor(() => readData().meta.revision !== before || bannerText(w), 6000);
  await sleep(120);
  return { revBefore: before, revAfter: readData().meta.revision, puts: putCalls.length - beforePuts, banner: bannerText(w) };
}

(async function main() {
  L('== YUNZ-20 Stage3 复验 DOM 交互验证（jsdom 执行交付/运行态页面脚本 + 真实 /api 核对）==');
  L('PUB=' + PUB);
  L('node ' + process.version + ' / jsdom ' + require('jsdom/package.json').version + ' / service ' + API);
  const t0data = readData();
  L('起始服务状态: revision=' + t0data.meta.revision + ' tasks=' + t0data.tasks.length);
  L('起始磁盘 wbs.json sha256=' + require('crypto').createHash('sha256').update(fs.readFileSync(DATA)).digest('hex'));

  /* ---------- C1 身份入口：九选 / 进入 / 切换 ---------- */
  const { w: w1, dom: d1 } = makeDom({});
  await waitFor(() => w1.WBSApp && w1.WBSApp.state.doc, 10000);
  const btns = $$(w1, '#identity-list .identity-btn');
  assert('C1a', '身份入口渲染九选', btns.length === 9 && btns.map(b => b.getAttribute('data-identity')).join(',') === seed.identities.join(','),
    'buttons=' + btns.length + ' => ' + btns.map(b => b.getAttribute('data-identity')).join('/'));
  const enterOk = chooseIdentity(w1, '项目负责人');
  await waitFor(() => !$('#workbench', w1).hidden, 3000);
  assert('C1b', '选择身份后进入工作台', enterOk && !$('#workbench', w1).hidden && $('#identity-layer', w1).hidden,
    'workbench.hidden=' + $('#workbench', w1).hidden);
  assert('C1c', '身份写入 localStorage（刷新保持）', w1.localStorage.getItem('wbs.identity') === '项目负责人',
    'localStorage=' + w1.localStorage.getItem('wbs.identity'));

  /* ---------- C2 36 行渲染与顺序 ---------- */
  const ids1 = rowIds(w1);
  assert('C2a', '页面渲染 36 行', ids1.length === 36, 'rows=' + ids1.length);
  assert('C2b', '渲染顺序 == seed/JSON 顺序', ids1.join(',') === seedOrder.join(','), 'first3=' + ids1.slice(0, 3).join(',') + ' last3=' + ids1.slice(-3).join(','));
  const r0 = cell(w1, 'T001', 'task').textContent, o0 = cell(w1, 'T001', 'owner').textContent;
  assert('C2c', '单元格文本与 JSON 一致抽样', r0 === seed.tasks[0].task && o0 === seed.tasks[0].owner, 'T001.task=' + r0 + ' owner=' + o0);
  const stat = $('#task-count', w1).textContent;
  assert('C2d', '底部计数显示 36 条', stat.trim().indexOf('36') === 0, 'text=' + stat);

  /* ---------- C1d 刷新后身份保持（新实例 + localStorage 预置） ---------- */
  const { w: wr, dom: dr } = makeDom({ identity: '王言' });
  await waitFor(() => wr.WBSApp && wr.WBSApp.state.doc, 10000);
  await waitFor(() => !$('#workbench', wr).hidden, 4000);
  assert('C1d', '刷新（新页面实例）后身份保持为 王言',
    !$('#workbench', wr).hidden && $('#identity-select', wr).value === '王言',
    'select=' + $('#identity-select', wr).value + ' hint=' + hintText(wr));

  /* ---------- C1e 切换身份即时生效 ---------- */
  switchIdentity(w1, '王言');
  await sleep(60);
  assert('C1e', '切换身份即时生效（会话状态更新）',
    $('#identity-select', w1).value === '王言' && /王言/.test($('#session-status', w1).textContent),
    'session=' + $('#session-status', w1).textContent);
  dr.window.close();

  /* ---------- C3 权限矩阵：项目负责人 + 王言 + 李欢 ---------- */
  const structFields = ['level1', 'level2', 'task', 'owner'];
  const dataFields = ['status', 'demo', 'dates.design', 'dates.dev', 'dates.test', 'dates.product', 'dates.demo_prep', 'note'];

  // 王言：自身行 T002 非结构字段可编辑；结构字段只读；他人行只读
  const wangOwnEditable = await opensEditor(w1, 'T002', 'status');
  assert('C3a', '王言 本人行 T002 状态可编辑（进入编辑入口）', wangOwnEditable, 'opensEditor=' + wangOwnEditable);

  const wangStruct = await clickCellEdit(w1, 'T002', 'level1', 'HACK');
  const hintStruct = hintText(w1);
  assert('C3b', '王言 本人行结构字段（一级）不可编辑且给提示',
    !wangStruct.ok && /只读/.test(hintStruct), 'edit=' + JSON.stringify(wangStruct) + ' hint=' + hintStruct);

  const wangOther = await clickCellEdit(w1, 'T001', 'status', '已完成');
  const hintOther = hintText(w1);
  assert('C3c', '王言 他人行 T001 不可编辑且给提示',
    !wangOther.ok && /只读/.test(hintOther), 'edit=' + JSON.stringify(wangOther) + ' hint=' + hintOther);

  // 李欢：自身行 T001 可编辑；王言行 T002 只读
  switchIdentity(w1, '李欢');
  await sleep(60);
  const liOwn = await opensEditor(w1, 'T001', 'note');
  assert('C3d', '李欢 本人行 T001 进展说明可编辑（编辑入口可打开）', !!liOwn, 'opensEditor=' + liOwn);
  const liOther = await clickCellEdit(w1, 'T002', 'note', '不该写');
  assert('C3e', '李欢 他人行 T002 只读且给提示', !liOther.ok && /只读/.test(hintText(w1)),
    'edit=' + JSON.stringify(liOther) + ' hint=' + hintText(w1));

  // 项目负责人：任意行、任意字段可编辑 + 新增/删除可见
  switchIdentity(w1, '项目负责人');
  await sleep(60);
  const pmAny = await opensEditor(w1, 'T001', 'level1');
  assert('C3f', '项目负责人 可编辑他人行结构字段（编辑入口可打开）', !!pmAny, 'opensEditor=' + pmAny);
  assert('C3g', '项目负责人 可见新增行按钮', !$('#add-row-btn', w1).hidden, 'hidden=' + $('#add-row-btn', w1).hidden);
  assert('C3h', '项目负责人 每行有删除按钮', $$(w1, '#wbs-body [data-delete]').length === 36,
    'deleteBtns=' + $$(w1, '#wbs-body [data-delete]').length);

  // 正常负责人看不到新增/删除
  switchIdentity(w1, '王言');
  await sleep(60);
  const normalNoAdd = $('#add-row-btn', w1).hidden && $$(w1, '#wbs-body [data-delete]').length === 0;
  assert('C3i', '普通负责人 不可见新增/删除入口', normalNoAdd,
    'addHidden=' + $('#add-row-btn', w1).hidden + ' deleteBtns=' + $$(w1, '#wbs-body [data-delete]').length);

  /* ---------- C3j..C3q 每个可编辑字段走页面编辑入口并保存 ---------- */
  L('-- 逐字段编辑（王言 T002 本人行）--');
  const edits = [
    ['status', '进行中'], ['demo', '是'],
    ['dates.design', '2026-10-20'], ['dates.dev', '2026-10-21'], ['dates.test', '2026-10-22'],
    ['dates.product', '2026-10-23'], ['dates.demo_prep', '2026-10-24'],
    ['note', 'QV 验证：进展说明已更新']
  ];
  switchIdentity(w1, '王言');
  await sleep(50);
  const fieldResults = [];
  for (const [f, v] of edits) {
    const r = await clickCellEdit(w1, 'T002', f, v);
    await sleep(30);
    const shown = readShownField(w1, 'T002', f);
    fieldResults.push({ field: f, want: v, editor: r.ok, shown: shown });
  }
  function readShownField(w, id, f) {
    const td = cell(w, id, f);
    if (!td) return null;
    if (f === 'status') { const b = td.querySelector('.badge'); return b ? b.textContent : td.textContent; }
    return td.textContent;
  }
  const allShown = fieldResults.every(r => r.editor && r.shown === r.want);
  assert('C3j', '8 个可编辑字段经页面编辑入口修改后页面显示为期望值', allShown,
    JSON.stringify(fieldResults));
  assert('C3k', '编辑后进入未保存态（保存按钮可用 + 会话提示）',
    !$('#save-btn', w1).disabled && /未保存修改/.test($('#session-status', w1).textContent),
    'session=' + $('#session-status', w1).textContent);

  /* ---------- C3l 取消（Escape）不落盘 ---------- */
  const revBeforeEsc = readData().meta.revision;
  const escR = escapeEditor(w1, 'T002', 'note');
  await sleep(80);
  const noteAfterEsc = cell(w1, 'T002', 'note').textContent;
  assert('C3l', '编辑中按 Escape 取消：页面值回退且无写入', escR.ok && noteAfterEsc === 'QV 验证：进展说明已更新' && readData().meta.revision === revBeforeEsc,
    'esc=' + JSON.stringify(escR) + ' noteShown=' + noteAfterEsc + ' rev=' + readData().meta.revision);

  /* ---------- C3m 保存：三端一致（页面/API/磁盘） ---------- */
  const saveRes = await clickSave(w1);
  const api1 = await apiGet();
  const disk1 = readData();
  const t002api = api1.tasks.filter(t => t.id === 'T002')[0];
  const t002disk = disk1.tasks.filter(t => t.id === 'T002')[0];
  const threeWay = t002api.status === '进行中' && t002disk.status === '进行中' &&
    t002api.dates.design === '2026-10-20' && t002disk.dates.design === '2026-10-20' &&
    t002api.note === 'QV 验证：进展说明已更新' && t002disk.note === 'QV 验证：进展说明已更新' &&
    t002api.demo === '是' && cell(w1, 'T002', 'status').querySelector('.badge').textContent === '进行中';
  assert('C3m', '保存成功且页面/API/磁盘三端一致（王言行）', threeWay && saveRes.puts === 1 && saveRes.revAfter === saveRes.revBefore + 1,
    'rev ' + saveRes.revBefore + '->' + saveRes.revAfter + ' puts=' + saveRes.puts + ' api.status=' + t002api.status + ' disk.note=' + t002disk.note);

  /* ---------- C3n/C3o 第二位普通负责人与项目负责人各自保存一次并核对三端 ---------- */
  switchIdentity(w1, '李欢');
  await sleep(50);
  await clickCellEdit(w1, 'T001', 'note', '李欢：QV 验证进展');
  await clickCellEdit(w1, 'T001', 'status', '已完成');
  const saveLi = await clickSave(w1);
  const liApi = (await apiGet()).tasks.filter(t => t.id === 'T001')[0];
  const liDisk = readData().tasks.filter(t => t.id === 'T001')[0];
  assert('C3n', '李欢（第二位普通负责人）保存后三端一致',
    liApi.note === '李欢：QV 验证进展' && liDisk.note === '李欢：QV 验证进展' && liApi.status === '已完成' &&
    cell(w1, 'T001', 'note').textContent === '李欢：QV 验证进展' && cell(w1, 'T001', 'status').querySelector('.badge').textContent === '已完成' &&
    saveLi.puts === 1,
    'api=' + liApi.note + '/' + liApi.status + ' disk=' + liDisk.note + ' puts=' + saveLi.puts);

  switchIdentity(w1, '项目负责人');
  await sleep(50);
  await clickCellEdit(w1, 'T027', 'note', '项目负责人：QV 验证任意行可改');
  const savePm = await clickSave(w1);
  const pmApi = (await apiGet()).tasks.filter(t => t.id === 'T027')[0];
  assert('C3o', '项目负责人保存任意行（含他人行）后三端一致',
    pmApi.note === '项目负责人：QV 验证任意行可改' && readData().tasks.filter(t => t.id === 'T027')[0].note === '项目负责人：QV 验证任意行可改' &&
    cell(w1, 'T027', 'note').textContent === '项目负责人：QV 验证任意行可改' && savePm.puts === 1,
    'api=' + pmApi.note + ' puts=' + savePm.puts);

  /* ---------- C5 空输入 / 非法输入：前置校验，无 PUT ---------- */
  const before5 = putCalls.length;
  const t001taskOrig = readData().tasks.filter(t => t.id === 'T001')[0].task;
  switchIdentity(w1, '项目负责人');
  await sleep(50);
  await clickCellEdit(w1, 'T001', 'task', '');
  await sleep(30);
  $('#save-btn', w1).click();
  await sleep(300);
  const emptyBanner = bannerText(w1);
  const emptyNoPut = putCalls.length === before5;
  assert('C5a', '空输入（任务项置空）保存被前置校验拦下，无 PUT 调用',
    emptyNoPut && /前置校验未通过/.test(emptyBanner), 'banner=' + emptyBanner + ' puts=' + (putCalls.length - before5));

  await clickCellEdit(w1, 'T001', 'task', t001taskOrig);
  await clickCellEdit(w1, 'T001', 'note', 'x'.repeat(2001));
  await sleep(30);
  $('#save-btn', w1).click();
  await sleep(300);
  const badBanner = bannerText(w1);
  assert('C5b', '非法输入（进展说明 2001 字符超长）被拦下，无 PUT 调用',
    putCalls.length === before5 && /前置校验未通过/.test(badBanner), 'banner=' + badBanner.slice(0, 120) + ' puts=' + (putCalls.length - before5));
  await clickCellEdit(w1, 'T001', 'note', '');
  await sleep(30);

  /* ---------- C4 新增 / 删除（项目负责人，带确认） ---------- */
  const revAddBefore = readData().meta.revision;
  $('#add-row-btn', w1).click();
  await sleep(80);
  const afterAdd = rowIds(w1);
  const newId = afterAdd[afterAdd.length - 1];
  assert('C4a', '项目负责人新增行（页面出现新行，未保存不落盘）',
    afterAdd.length === 37 && readData().meta.revision === revAddBefore, 'rows=' + afterAdd.length + ' newId=' + newId + ' rev=' + readData().meta.revision);

  await clickCellEdit(w1, newId, 'level1', 'QV 验证');
  await clickCellEdit(w1, newId, 'level2', '临时');
  await clickCellEdit(w1, newId, 'task', 'QV 临时任务');
  await clickCellEdit(w1, newId, 'owner', '王言');
  await sleep(50);
  const saveAdd = await clickSave(w1);
  const apiAdd = await apiGet();
  assert('C4b', '新增行保存后 API/磁盘出现 37 行且新行内容一致',
    apiAdd.tasks.length === 37 && readData().tasks.length === 37 &&
    readData().tasks.filter(t => t.id === newId)[0].task === 'QV 临时任务' && saveAdd.puts === 1,
    'apiRows=' + apiAdd.tasks.length + ' diskRows=' + readData().tasks.length);

  // 删除：确认框取消 -> 不删
  const beforeDel = readData().tasks.length;
  const dCancel = makeConfirm(w1, false);
  await clickDelete(w1, newId);
  await sleep(80);
  assert('C4c', '删除确认框取消：行仍在且不落盘', readData().tasks.length === beforeDel && readData().meta.revision === revAddBefore + 1,
    'diskRows=' + readData().tasks.length + ' hint=' + hintText(w1));
  dCancel();
  // 删除：确认 -> 删除并保存
  const dOk = makeConfirm(w1, true);
  await clickDelete(w1, newId);
  await sleep(80);
  const rowsAfterDel = rowIds(w1);
  const saveDel = await clickSave(w1);
  assert('C4d', '删除确认后（保存生效）API/磁盘回到 36 行且删掉的是新行',
    rowsAfterDel.length === 36 && (await apiGet()).tasks.length === 36 && readData().tasks.length === 36 &&
    !readData().tasks.some(t => t.id === newId) && saveDel.puts === 1,
    'pageRows=' + rowsAfterDel.length + ' apiRows=' + (await apiGet()).tasks.length + ' diskRows=' + readData().tasks.length);
  dOk();

  function makeConfirm(w, ans) {
    const prev = w.confirm;
    w.confirm = () => ans;
    return () => { w.confirm = prev; };
  }
  async function clickDelete(w, id) {
    const btn = w.document.querySelector('[data-delete="' + id + '"]');
    if (btn) btn.click();
    await sleep(50);
    return !!btn;
  }

  /* ---------- 对抗路径：在全新页面实例上逐目标探测“有无反馈” ---------- */
  const { w: w2, dom: d2 } = makeDom({});
  await waitFor(() => w2.WBSApp && w2.WBSApp.state.doc, 10000);
  chooseIdentity(w2, '王言');
  await waitFor(() => !$('#workbench', w2).hidden && rowIds(w2).length > 0, 4000);
  await sleep(60);
  function fb(w) {
    return { hint: hintText(w), editors: $$(w, '#wbs-body [data-edit-field]').length, rows: rowIds(w).length };
  }
  const adv = [];
  async function probe(w, label, click) {
    const before = fb(w);
    await click();
    await sleep(60);
    const after = fb(w);
    adv.push({
      target: label, hintBefore: before.hint, hintAfter: after.hint,
      editorOpened: after.editors > 0, structureChanged: after.rows !== before.rows,
      silent: after.hint === before.hint && after.editors === 0 && after.rows === before.rows
    });
  }
  await probe(w2, '他人行状态徽标（span.badge）', async () => cell(w2, 'T001', 'status').querySelector('.badge').click());
  await probe(w2, '他人行“是否演示范围”单元格', async () => cell(w2, 'T001', 'demo').click());
  await probe(w2, '本人行结构字段（一级）', async () => cell(w2, 'T002', 'level1').click());
  await probe(w2, '他人行进展说明单元格', async () => cell(w2, 'T001', 'note').click());
  await probe(w2, '序号列单元格（td.cell-id）', async () => $$(w2, '#wbs-body tr')[0].querySelector('td.cell-id').click());
  await probe(w2, '操作列空单元格（普通负责人）', async () => $$(w2, '#wbs-body tr')[0].querySelector('td.cell-op').click());
  await probe(w2, '页脚汇总计数', async () => $('#task-count', w2).click());
  await probe(w2, '页脚图例文字', async () => $$(w2, '.footer-legend')[0].click());
  await probe(w2, '表头“序号”列标题', async () => $$(w2, '#wbs-table thead th')[0].click());
  await probe(w2, '普通负责人触发新增（隐藏入口）', async () => w2.WBSApp.addRow());
  await probe(w2, '普通负责人调用删除无权行', async () => w2.WBSApp.deleteRow('T001'));

  L(' 对抗路径明细: ' + JSON.stringify(adv, null, 1));
  const gated = ['他人行状态徽标（span.badge）', '他人行“是否演示范围”单元格', '本人行结构字段（一级）', '他人行进展说明单元格'];
  const gatedOk = gated.every(t => /只读/.test((adv.filter(a => a.target === t)[0] || {}).hintAfter || ''));
  assert('C-ADV', '权限受限单元格（含展示徽标）点击均给出中文只读提示，无静默无反应',
    gatedOk && adv.filter(a => a.target.indexOf('普通负责人') === 0).every(a => a.hintAfter && !a.silent),
    'gated=' + gatedOk + ' silent=' + JSON.stringify(adv.filter(a => a.silent).map(a => a.target)));
  assert('C-ADV2', '展示型元素（序号/操作列/页脚/表头）点击不进入编辑、不破坏页面结构',
    adv.every(a => !a.editorOpened && !a.structureChanged) && rowIds(w2).length === 36 &&
    $$(w2, '#wbs-body tr')[0].querySelector('td.cell-id') !== null,
    'rows=' + rowIds(w2).length + ' unexpectedEditors=' + adv.filter(a => a.editorOpened).length);
  {
    const pick = t => adv.filter(a => a.target === t)[0] || {};
    const idAdv = pick('序号列单元格（td.cell-id）');
    const noteAdv = pick('他人行进展说明单元格');
    const idHint = idAdv.hintAfter || '';
    const noteHint = noteAdv.hintAfter || '';
    const shape = s => s.replace(/「[^」]*」/g, '「X」');
    assert('D2a', 'D-2 闭环：王言 点击序号列单元格 td.cell-id 给出明确中文只读提示（原 silent:true 已消除）',
      !!idHint && /只读/.test(idHint) && !idAdv.silent && !idAdv.editorOpened,
      'hintAfter=' + JSON.stringify(idHint) + ' silent=' + idAdv.silent + ' editorOpened=' + idAdv.editorOpened);
    assert('D2b', 'D-2 序号列提示与相邻只读单元格（进展说明）同文案模板，反馈一致',
      !!idHint && !!noteHint && shape(idHint) === shape(noteHint),
      'idCell=' + JSON.stringify(idHint) + ' | noteCell=' + JSON.stringify(noteHint));
    console.log('D2-HINT 序号列: ' + idHint);
    console.log('D2-HINT 进展说明: ' + noteHint);
  }
  fs.writeFileSync(path.join(OUT, 'dom-adv-detail.json'), JSON.stringify(adv, null, 1));
  d2.window.close();

  /* ---------- C8 导出（页面入口触发） ---------- */
  switchIdentity(w1, '项目负责人');
  await sleep(50);
  const rowsNow = readData().tasks.length;
  const revNow = readData().meta.revision;
  const exportListBefore = exports_.length;
  $('#export-btn', w1).click();
  await waitFor(() => exports_.length > exportListBefore, 8000);
  const exp = exports_[exports_.length - 1];
  const expBanner = bannerText(w1);
  assert('C8a', '导出由页面导出入口触发并生成文件（文件名规则 蓉城战役WBS-YYYYMMDD.xlsx）',
    !!exp && /^蓉城战役WBS-\d{8}\.xlsx$/.test(exp.name) && /已按原模板导出/.test(expBanner),
    'name=' + (exp && exp.name) + ' bytes=' + (exp && exp.bytes) + ' banner=' + expBanner);
  fs.writeFileSync(path.join(OUT, 'export-context.json'), JSON.stringify({ rowsNow, revNow, name: exp && exp.name, bytes: exp && exp.bytes }, null, 1));

  /* ---------- C10 无跨域外链 ---------- */
  assert('C10a', '页面运行期无任何跨域请求（仅同源 /api 与本地静态资源）',
    crossOrigin.length === 0, 'crossOrigin=' + JSON.stringify(crossOrigin.slice(0, 5)));
  const htmlSrc = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  const jsSrc = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8');
  const cssSrc = fs.readFileSync(path.join(PUB, 'styles.css'), 'utf8');
  const ext = (htmlSrc + jsSrc + cssSrc).match(/https?:\/\/[^\s"'`)<>]+/g) || [];
  assert('C10b', '页面三件套源码无外部 http(s) 资源引用', ext.length === 0, 'externalRefs=' + JSON.stringify([...new Set(ext)].slice(0, 8)));

  /* ---------- 收尾：恢复原状 ---------- */
  const endData = readData();
  L('验证结束时服务状态: revision=' + endData.meta.revision + ' tasks=' + endData.tasks.length);
  d1.window.close();

  fs.writeFileSync(path.join(OUT, 'dom-verify.log'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'dom-results.json'), JSON.stringify({ results, putCalls: putCalls.length, crossOrigin, exports: exports_, adv }, null, 1));
  const failed = results.filter(r => !r.pass);
  L('== 汇总: ' + (results.length - failed.length) + '/' + results.length + ' 通过 ==');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { L('FATAL ' + (e && e.stack || e)); fs.writeFileSync(path.join(OUT, 'dom-verify.log'), lines.join('\n') + '\nFATAL ' + (e && e.stack || e) + '\n'); process.exit(2); });
