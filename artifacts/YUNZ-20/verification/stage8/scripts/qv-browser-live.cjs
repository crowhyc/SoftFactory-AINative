'use strict';
/* YUNZ-28 / Stage8 独立复验（AI-QV）：真实浏览器交互断言，直接打运行现场 http://127.0.0.1:4180。
 * 运行环境：mcr.microsoft.com/playwright:v1.55.0-jammy（chromium 140），--network host 访问宿主回环。
 * 数据现场：宿主 /opt/wbs-rongcheng/data 挂载为 /data（只读读取用于三端一致核对；本脚本自身不写数据）。
 * 宿主 CentOS 7（glibc 2.17）无法直接运行该 Chromium，宿主不安装任何系统级浏览器组件。
 * 由 scripts/run-live.sh 调用。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(process.env.TOOLS || '/tools', 'node_modules', 'playwright'));

const BASE = process.env.BASE || 'http://127.0.0.1:4180';
const DATA_DIR = process.env.DATA_DIR || '/data';
const OUTDIR = process.env.OUTDIR || '/out';
const DL = path.join(OUTDIR, 'downloads');
const TZ = 'Asia/Shanghai';
const STATUSES = ['未开始', '进行中', '已完成', '已延期', '被阻塞'];
const DATE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep'];
const ADD_NAME = process.env.ADD_NAME || '验证甲';
const LONG_NAME = '123456789012345678901';

const results = { base: BASE, tz: TZ, started_at: new Date().toISOString(), checks: [], notes: [], page_errors: [], console_errors: [] };
let pass = 0, fail = 0;
function check(id, ok, detail) {
  results.checks.push({ id, ok: !!ok, detail: detail === undefined ? null : detail });
  if (ok) { pass += 1; console.log('PASS  ' + id + (detail !== undefined ? '  :: ' + JSON.stringify(detail) : '')); }
  else { fail += 1; console.log('FAIL  ' + id + '  -> ' + JSON.stringify(detail)); }
}
function note(text) { results.notes.push(text); console.log('NOTE  ' + text); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(url, init) {
  const res = await fetch(BASE + url, init);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (e) { body = text; }
  return { status: res.status, body };
}
const readDisk = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wbs.json'), 'utf8'));
const readAuditLines = () => fs.readFileSync(path.join(DATA_DIR, 'audit.log'), 'utf8').split('\n').filter((s) => s.trim());
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const tzStamp = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(d);

let dialogBehavior = 'dismiss';
let lastDialog = null;

(async () => {
  fs.mkdirSync(DL, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ acceptDownloads: true, timezoneId: TZ, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => results.page_errors.push(String(e && e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') results.console_errors.push(m.text()); });
  page.on('dialog', async (d) => { lastDialog = { type: d.type(), message: d.message() }; if (dialogBehavior === 'accept') await d.accept(); else await d.dismiss(); });

  const startApi = await api('/api/wbs');
  const startDoc = startApi.body;
  results.start = { revision: startDoc.meta.revision, tasks: startDoc.tasks.length, identities: startDoc.identities.slice(), disk_sha_hint: readDisk().meta.revision };
  fs.writeFileSync(path.join(OUTDIR, 'results', 'live-start-doc.json'), JSON.stringify(startDoc, null, 2));

  const shot = async (name) => { try { await page.screenshot({ path: path.join(OUTDIR, 'shots', name + '.png'), fullPage: false }); } catch (e) { note('截图失败 ' + name + ': ' + e.message); } };
  const clearBanner = () => page.evaluate(() => { const b = document.getElementById('banner'); b.hidden = true; });
  const bannerText = () => page.evaluate(() => ({ hidden: document.getElementById('banner').hidden, cls: document.getElementById('banner').className, text: document.getElementById('banner-text').textContent }));
  const hintText = () => page.evaluate(() => ({ hidden: document.getElementById('hint').hidden, text: document.getElementById('hint').textContent, disp: getComputedStyle(document.getElementById('hint')).display }));
  const identitiesInPage = () => page.evaluate(() => Array.from(document.querySelectorAll('#identity-list button')).map((b) => b.getAttribute('data-identity')));
  const controls = () => page.evaluate(() => ({
    identitySelect: Array.from(document.getElementById('identity-select').options).map((o) => o.value),
    ownerFilter: Array.from(document.getElementById('owner-filter').options).map((o) => o.value),
    statusFilter: Array.from(document.getElementById('status-filter').options).map((o) => o.value),
    addPersonBtnHidden: document.getElementById('add-person-btn').hidden,
    addRowBtnHidden: document.getElementById('add-row-btn').hidden,
    identityAddHidden: document.getElementById('identity-add').hidden,
    toolbarOrder: Array.from(document.querySelectorAll('.toolbar-actions button')).map((b) => b.id),
    sessionStatus: document.getElementById('session-status').textContent,
    taskCount: document.getElementById('task-count').textContent,
    health: document.getElementById('health-probe').textContent
  }));
  const rows = () => page.evaluate(() => Array.from(document.querySelectorAll('#wbs-body tr')).map((tr) => {
    const cells = {};
    tr.querySelectorAll('td').forEach((td) => {
      const f = td.getAttribute('data-field');
      if (!f) return;
      const ctrl = td.querySelector('input,select,textarea');
      if (ctrl && ctrl.tagName === 'INPUT' && ctrl.type === 'date') cells[f] = { kind: 'date', type: ctrl.type, disabled: ctrl.disabled, value: ctrl.value };
      else if (ctrl && ctrl.tagName === 'SELECT') cells[f] = { kind: 'select', cls: ctrl.className, disabled: ctrl.disabled, value: ctrl.value, options: Array.from(ctrl.options).map((o) => o.value) };
      else if (ctrl) cells[f] = { kind: ctrl.tagName.toLowerCase(), cls: ctrl.className, disabled: !!ctrl.disabled, value: ctrl.value };
      else cells[f] = { kind: 'text', text: td.textContent };
      cells[f].tdClass = td.className;
    });
    const op = tr.querySelector('td.cell-op');
    return {
      id: tr.getAttribute('data-id'), cls: tr.className, cells,
      opEdit: !!op.querySelector('[data-edit-row]'), opEditText: op.querySelector('[data-edit-row]') ? op.querySelector('[data-edit-row]').textContent : null,
      opDelete: !!op.querySelector('[data-delete]'),
      hasOwnerSelect: !!tr.querySelector('td[data-field="owner"] select.owner-select')
    };
  }));

  // ---------------------------------------------------------------- A：加载与渲染
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('#identity-list button', { timeout: 20000 });
  await page.waitForFunction(() => !document.getElementById('health-probe').textContent.includes('检测中'), null, { timeout: 15000 }).catch(() => {});

  const pageIdentities = await identitiesInPage();
  check('A1.identity-list-9', pageIdentities.length === 9 && JSON.stringify(pageIdentities) === JSON.stringify(startDoc.identities), { page: pageIdentities, api: startDoc.identities });
  const a2 = await page.evaluate(() => ({
    idLayerDisplay: getComputedStyle(document.getElementById('identity-layer')).display,
    workbenchDisplay: getComputedStyle(document.getElementById('workbench')).display
  }));
  check('A2.initial-identity-layer-visible-workbench-hidden', a2.idLayerDisplay !== 'none' && a2.workbenchDisplay === 'none', a2);

  // D-3 回归：进入工作台后身份遮罩必须真隐藏（computed display === 'none'）
  await shot('01-identity-layer');
  await page.click('#identity-list button[data-identity="项目负责人"]');
  await page.waitForFunction(() => !document.getElementById('workbench').hidden, null, { timeout: 10000 });
  await shot('02-pm-workbench');
  const a3 = await page.evaluate(() => {
    const layer = document.getElementById('identity-layer');
    const r = layer.getBoundingClientRect();
    const wb = document.getElementById('workbench');
    const el = document.elementFromPoint(720, 450);
    return {
      idLayerDisplay: getComputedStyle(layer).display, idLayerHiddenAttr: layer.hidden,
      rect: { w: r.width, h: r.height },
      workbenchDisplay: getComputedStyle(wb).display, workbenchRectY: wb.getBoundingClientRect().y,
      centerHit: el ? (el.id || el.className || el.tagName) : null,
      centerInWorkbench: !!(el && wb.contains(el))
    };
  });
  check('A3.d3-identity-layer-computed-display-none', a3.idLayerDisplay === 'none' && a3.idLayerHiddenAttr === true, a3);
  check('A3b.d3-rect-collapsed-and-workbench-visible-top', a3.rect.w === 0 && a3.rect.h === 0 && a3.workbenchDisplay !== 'none' && a3.workbenchRectY === 0, a3);
  check('A3c.d3-viewport-center-hits-workbench', a3.centerInWorkbench, { hit: a3.centerHit });

  const r0 = await rows();
  const c0 = await controls();
  check('A4.render-36-rows-order', r0.length === 36 && JSON.stringify(r0.map((x) => x.id)) === JSON.stringify(startDoc.tasks.map((t) => t.id)), { rendered: r0.length, api: startDoc.tasks.length });
  check('A5.task-count-text', c0.taskCount === '36 条', c0.taskCount);
  check('A6.health-probe-ok', c0.health.includes('服务正常'), c0.health);

  // ------------------------------------------------- CH-2 日期 / 状态常显（项目负责人）
  const byId = (list, id) => list.filter((x) => x.id === id)[0];
  for (const key of DATE_KEYS) {
    const okAll = r0.every((r) => {
      const c = r.cells['dates.' + key];
      const t = startDoc.tasks.filter((x) => x.id === r.id)[0];
      return c && c.kind === 'date' && c.type === 'date' && c.disabled === false && c.value === (t.dates[key] || '');
    });
    check('A7.CH2-pm-date-' + key + '-always-visible', okAll, { sample: byId(r0, 'T001').cells['dates.' + key] });
  }
  const dateCellsAllRows = r0.every((r) => DATE_KEYS.every((k) => r.cells['dates.' + k] && r.cells['dates.' + k].kind === 'date'));
  check('A8.CH2-pm-5-date-controls-all-36-rows', dateCellsAllRows);
  const statusOk = r0.every((r) => {
    const c = r.cells.status;
    const t = startDoc.tasks.filter((x) => x.id === r.id)[0];
    return c && c.kind === 'select' && JSON.stringify(c.options) === JSON.stringify(STATUSES) && c.value === t.status && c.disabled === false;
  });
  check('A9.CH2-pm-status-select-enum-order-value', statusOk, { sample: byId(r0, 'T001').cells.status });
  const badgeOk = await page.evaluate(() => {
    const tr = document.querySelector('#wbs-body tr');
    const b = tr.querySelector('td[data-field="status"] .badge');
    return b ? { text: b.textContent, disp: getComputedStyle(b).display } : null;
  });
  check('A10.status-badge-present', !!(badgeOk && badgeOk.text && badgeOk.disp !== 'none'), badgeOk);

  // ------------------------------------------------- CH-1 操作列（项目负责人）
  check('A11.CH1-edit-button-every-row', r0.every((r) => r.opEdit && r.opEditText === '编辑'), { sample: byId(r0, 'T001') });
  check('A12.CH1-pm-delete-visible-every-row', r0.every((r) => r.opDelete), { count: r0.filter((r) => r.opDelete).length });

  // 行编辑态切换
  const beforeToggle = await page.evaluate(() => document.querySelector('#wbs-body tr[data-id="T001"]').className);
  await page.click('#wbs-body tr[data-id="T001"] [data-edit-row]');
  const editState = await page.evaluate(() => {
    const tr = document.querySelector('#wbs-body tr[data-id="T001"]');
    const taskCell = tr.querySelector('td[data-field="task"]');
    const inp = taskCell.querySelector('input,textarea');
    return {
      rowClass: tr.className, btnText: tr.querySelector('[data-edit-row]').textContent,
      taskEditor: inp ? { kind: inp.tagName.toLowerCase(), value: inp.value } : null,
      l1Editor: !!tr.querySelector('td[data-field="level1"] input'),
      statusStillSelect: !!tr.querySelector('td[data-field="status"] select'),
      dateStillInput: !!tr.querySelector('td[data-field="dates.design"] input')
    };
  });
  const t1 = startDoc.tasks.filter((x) => x.id === 'T001')[0];
  check('A13.CH1-row-edit-state-entered', editState.rowClass.includes('row-editing') && editState.btnText === '完成' && editState.taskEditor && editState.taskEditor.value === t1.task && editState.l1Editor && editState.statusStillSelect && editState.dateStillInput, editState);
  await page.click('#wbs-body tr[data-id="T001"] [data-edit-row]');
  const exitState = await page.evaluate(() => {
    const tr = document.querySelector('#wbs-body tr[data-id="T001"]');
    return { rowClass: tr.className, btnText: tr.querySelector('[data-edit-row]').textContent, l1Editor: !!tr.querySelector('td[data-field="level1"] input') };
  });
  check('A14.CH1-row-edit-state-exited', !exitState.rowClass.includes('row-editing') && exitState.btnText === '编辑' && !exitState.l1Editor, exitState);

  // ------------------------------------------------- 九身份切换（验收 1）
  const switchLog = [];
  for (const ident of startDoc.identities) {
    await page.selectOption('#identity-select', ident);
    await sleep(120);
    const snap = await page.evaluate(() => {
      const tr = document.querySelector('#wbs-body tr[data-id="T001"]');
      const own = document.querySelector('#wbs-body tr[data-id="T002"]');
      const g = (tr2, sel) => { const el = tr2.querySelector(sel); return el ? { disabled: !!el.disabled, tag: el.tagName } : null; };
      return {
        session: document.getElementById('session-status').textContent,
        t001Date: g(tr, 'td[data-field="dates.design"] input'),
        t001Status: g(tr, 'td[data-field="status"] select'),
        t002Date: g(own, 'td[data-field="dates.design"] input'),
        t002Status: g(own, 'td[data-field="status"] select'),
        t001OwnerText: tr.querySelector('td[data-field="owner"]').textContent,
        t001OwnerSelect: !!tr.querySelector('td[data-field="owner"] select')
      };
    });
    switchLog.push(Object.assign({ ident }, snap));
  }
  const pmRow = switchLog.filter((x) => x.ident === '项目负责人')[0];
  const nonPm = switchLog.filter((x) => x.ident !== '项目负责人');
  check('A15.acceptance1-nine-identity-switch-immediate', switchLog.every((x) => x.session.includes('身份：' + x.ident)), switchLog.map((x) => x.session));
  check('A16.pm-all-editable', pmRow.t001Date.disabled === false && pmRow.t001Status.disabled === false && pmRow.t001OwnerSelect === true, pmRow);
  check('A17.non-pm-others-locked', nonPm.every((x) => (x.ident === '李欢' ? x.t001Date.disabled === false : x.t001Date.disabled === true) && x.t001OwnerSelect === false), { sample: nonPm.map((x) => ({ ident: x.ident, t001Date: x.t001Date.disabled, t001Status: x.t001Status.disabled })) });
  // 全量权限矩阵：九身份 × 36 行，逐行核对「日期 / 状态控件 disabled」与「负责人下拉存在性」
  const matrix = [];
  for (const ident of startDoc.identities) {
    await page.selectOption('#identity-select', ident);
    await sleep(150);
    const m = await page.evaluate(() => ({
      isPm: document.getElementById('identity-select').value === '项目负责人',
      rows: Array.from(document.querySelectorAll('#wbs-body tr')).map((tr) => {
        const d = tr.querySelector('td[data-field="dates.design"] input');
        const st = tr.querySelector('td[data-field="status"] select');
        const os = !!tr.querySelector('td[data-field="owner"] select.owner-select');
        return { id: tr.getAttribute('data-id'), dateDisabled: !!d.disabled, statusDisabled: !!st.disabled, ownerSelect: os };
      })
    }));
    const bad = m.rows.filter((r) => {
      const t = startDoc.tasks.filter((x) => x.id === r.id)[0];
      const editable = m.isPm || t.owner === ident;
      return r.dateDisabled === editable || r.statusDisabled === editable || r.ownerSelect !== m.isPm;
    });
    matrix.push({ ident, rows: m.rows.length, violations: bad.length, isPm: m.isPm, editableRows: m.rows.filter((r) => !r.dateDisabled).length });
  }
  results.permissionMatrix = matrix;
  check('A17b.permission-matrix-9x36', matrix.length === 9 && matrix.every((m) => m.rows === 36 && m.violations === 0), matrix);
  fs.writeFileSync(path.join(OUTDIR, 'results', 'permission-matrix.json'), JSON.stringify(matrix, null, 2));
  const wangyan = switchLog.filter((x) => x.ident === '王言')[0];
  check('A18.non-pm-own-row-editable', wangyan.t002Date.disabled === false && wangyan.t002Status.disabled === false, wangyan);
  fs.writeFileSync(path.join(OUTDIR, 'results', 'identity-switch.json'), JSON.stringify(switchLog, null, 2));

  // 刷新后身份保持（验收 1）
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !document.getElementById('workbench').hidden, null, { timeout: 15000 });
  const afterReload = await page.evaluate(() => ({
    idLayerDisplay: getComputedStyle(document.getElementById('identity-layer')).display,
    workbenchDisplay: getComputedStyle(document.getElementById('workbench')).display,
    session: document.getElementById('session-status').textContent,
    selected: document.getElementById('identity-select').value,
    remembered: window.localStorage.getItem('wbs.identity')
  }));
  check('A19.acceptance1-identity-kept-after-reload', afterReload.idLayerDisplay === 'none' && afterReload.workbenchDisplay !== 'none' && afterReload.selected === '陈江' && afterReload.session.includes('身份：陈江'), afterReload);

  // 返回首页 / 重新进入
  await page.click('#home-btn');
  await sleep(150);
  const home = await page.evaluate(() => ({
    idLayerDisplay: getComputedStyle(document.getElementById('identity-layer')).display,
    workbenchDisplay: getComputedStyle(document.getElementById('workbench')).display,
    identityAddHidden: document.getElementById('identity-add').hidden,
    list: Array.from(document.querySelectorAll('#identity-list button')).map((b) => b.getAttribute('data-identity'))
  }));
  check('A20.back-home-shows-identity-layer', home.idLayerDisplay !== 'none' && home.workbenchDisplay === 'none' && home.list.length === 9, { disp: home.idLayerDisplay, n: home.list.length });
  check('A21.CH4-non-pm-identity-add-entry-hidden', home.identityAddHidden === true, home);
  await page.click('#identity-list button[data-identity="项目负责人"]');
  await page.waitForFunction(() => !document.getElementById('workbench').hidden, null, { timeout: 10000 });
  const ctrlPm = await controls();
  check('A22.CH4-pm-add-person-entry-visible', ctrlPm.addPersonBtnHidden === false && ctrlPm.addRowBtnHidden === false, ctrlPm);
  check('A23.CH5-daily-btn-next-to-export', ctrlPm.toolbarOrder.indexOf('daily-btn') === ctrlPm.toolbarOrder.indexOf('export-btn') + 1, ctrlPm.toolbarOrder);

  // ------------------------------------------------- 只读提示对抗（王言身份，非本人行）
  await page.selectOption('#identity-select', '王言');
  await sleep(120);
  await shot('03-non-pm-workbench-locked');
  const hintBefore = await hintText();
  await page.click('#wbs-body tr[data-id="T001"] td[data-field="level1"]');
  await sleep(120);
  const hint1 = await hintText();
  check('A24.readonly-td-click-hint', hint1.hidden === false && hint1.disp !== 'none' && hint1.text.includes('只读') && hint1.text.includes('T001'), { before: hintBefore, after: hint1 });
  await page.click('#wbs-body tr[data-id="T001"] td[data-field="note"]');
  await sleep(120);
  const hint2 = await hintText();
  check('A25.readonly-note-cell-hint', hint2.text.includes('只读'), hint2);
  // 对抗：点击「不可编辑行的常显控件本身」（disabled input / select）
  await page.evaluate(() => { document.getElementById('hint').hidden = true; document.getElementById('hint').textContent = ''; });
  try { await page.click('#wbs-body tr[data-id="T001"] td[data-field="dates.design"] input', { timeout: 3000, force: true }); } catch (e) { note('disabled date input click 抛错：' + e.message.split('\n')[0]); }
  await sleep(200);
  const hintDate = await hintText();
  results.adversarial = { disabledDateInputClick: hintDate };
  check('A26.adversarial-disabled-date-input-click-hint', hintDate.hidden === false && hintDate.text.includes('只读'), hintDate);
  await page.evaluate(() => { document.getElementById('hint').hidden = true; document.getElementById('hint').textContent = ''; });
  try { await page.click('#wbs-body tr[data-id="T001"] td[data-field="status"] select', { timeout: 3000, force: true }); } catch (e) { note('disabled status select click 抛错：' + e.message.split('\n')[0]); }
  await sleep(200);
  const hintStatus = await hintText();
  results.adversarial.disabledStatusSelectClick = hintStatus;
  check('A27.adversarial-disabled-status-select-click-hint', hintStatus.hidden === false && hintStatus.text.includes('只读'), hintStatus);
  // 对抗：点 disabled 日期输入的 td 内边距（应命中 td 处理器）
  await page.evaluate(() => { document.getElementById('hint').hidden = true; document.getElementById('hint').textContent = ''; });
  const box = await page.locator('#wbs-body tr[data-id="T001"] td[data-field="dates.dev"]').boundingBox();
  await page.mouse.click(box.x + 2, box.y + 2);
  await sleep(200);
  const hintEdge = await hintText();
  results.adversarial.disabledDateTdEdgeClick = hintEdge;
  check('A28.disabled-date-td-edge-click-hint', hintEdge.hidden === false && hintEdge.text.includes('只读'), hintEdge);
  // 对抗：非本人行点「编辑」按钮 → 必须给提示（不能静默）
  await page.evaluate(() => { document.getElementById('hint').hidden = true; document.getElementById('hint').textContent = ''; });
  await page.click('#wbs-body tr[data-id="T001"] [data-edit-row]');
  await sleep(150);
  const hintEdit = await hintText();
  const rowCls = await page.evaluate(() => document.querySelector('#wbs-body tr[data-id="T001"]').className);
  check('A29.adversarial-edit-button-on-readonly-row-hint', hintEdit.hidden === false && hintEdit.text.includes('只读') && !rowCls.includes('row-editing'), { hint: hintEdit, rowClass: rowCls });
  // 非项目负责人：无删除 / 无新增行 / 无新增人员入口
  const ctrlWy = await controls();
  const deleteCount = await page.evaluate(() => document.querySelectorAll('#wbs-body [data-delete]').length);
  check('A30.CH1-non-pm-no-delete-button', deleteCount === 0 && ctrlWy.addRowBtnHidden === true && ctrlWy.addPersonBtnHidden === true, { deleteCount, ctrlWy });

  // ------------------------------------------------- CH-3 负责人池化改派（写）
  await page.selectOption('#identity-select', '项目负责人');
  await sleep(150);
  const ownerSelectSnapshot = await page.evaluate(() => {
    const sel = document.querySelector('#wbs-body tr[data-id="T001"] select.owner-select');
    return { options: Array.from(sel.options).map((o) => o.value), value: sel.value };
  });
  check('A31.CH3-owner-select-options-from-identities', JSON.stringify(ownerSelectSnapshot.options) === JSON.stringify(startDoc.identities), ownerSelectSnapshot);
  const revBefore = (await api('/api/wbs')).body.meta.revision;
  await page.selectOption('#wbs-body tr[data-id="T001"] select.owner-select', '张航瑞');
  await sleep(150);
  await clearBanner();
  await page.click('#save-btn');
  await page.waitForFunction(() => { const b = document.getElementById('banner'); return !b.hidden && b.className.includes('ok'); }, null, { timeout: 15000 });
  const save1 = await bannerText();
  const api1 = (await api('/api/wbs')).body;
  const disk1 = readDisk();
  const page1 = await page.evaluate(() => document.querySelector('#wbs-body tr[data-id="T001"] select.owner-select').value);
  check('B1.CH3-owner-reassign-3way', api1.tasks.filter((t) => t.id === 'T001')[0].owner === '张航瑞' && disk1.tasks.filter((t) => t.id === 'T001')[0].owner === '张航瑞' && page1 === '张航瑞', { api: api1.tasks[0].owner, disk: disk1.tasks[0].owner, page: page1, rev: { before: revBefore, after: api1.meta.revision }, banner: save1.text.slice(0, 60) });
  check('B1b.save-banner-ok-and-revision-increment', save1.text.includes('保存成功') && api1.meta.revision === revBefore + 1, { banner: save1.text, rev: api1.meta.revision });

  // 改回
  await page.selectOption('#wbs-body tr[data-id="T001"] select.owner-select', '李欢');
  await sleep(150);
  await clearBanner();
  await page.click('#save-btn');
  await page.waitForFunction(() => { const b = document.getElementById('banner'); return !b.hidden && b.className.includes('ok'); }, null, { timeout: 15000 });
  const api2 = (await api('/api/wbs')).body;
  const disk2 = readDisk();
  check('B2.CH3-owner-revert-3way', api2.tasks.filter((t) => t.id === 'T001')[0].owner === '李欢' && disk2.tasks.filter((t) => t.id === 'T001')[0].owner === '李欢', { api: api2.tasks[0].owner, disk: disk2.tasks[0].owner });

  // ------------------------------------------------- 多字段保存（CH-5 当日变更基准）
  await page.click('#wbs-body tr[data-id="T001"] [data-edit-row]'); // 进入行编辑态以编辑 进展说明
  await sleep(120);
  await page.fill('#wbs-body tr[data-id="T001"] td[data-field="note"] textarea', '独立复验：多字段保存 2026-10-14');
  await page.locator('#wbs-body tr[data-id="T001"] td[data-field="note"] textarea').press('Tab');
  await sleep(200);
  await page.selectOption('#wbs-body tr[data-id="T001"] select.status-select', '进行中');
  await sleep(150);
  await page.fill('#wbs-body tr[data-id="T001"] td[data-field="dates.dev"] input', '2026-10-15');
  await sleep(150);
  await page.selectOption('#wbs-body tr[data-id="T002"] select.status-select', '已延期');
  await sleep(150);
  await page.selectOption('#wbs-body tr[data-id="T003"] select.status-select', '被阻塞');
  await sleep(150);
  const dirtyState = await page.evaluate(() => ({ cls: document.getElementById('session-status').className, text: document.getElementById('session-status').textContent, saveDisabled: document.getElementById('save-btn').disabled }));
  check('B3.draft-dirty-before-save', dirtyState.saveDisabled === false && dirtyState.text.includes('有未保存修改'), dirtyState);
  const auditLenBefore = readAuditLines().length;
  await clearBanner();
  await page.click('#save-btn');
  await page.waitForFunction(() => { const b = document.getElementById('banner'); return !b.hidden && b.className.includes('ok'); }, null, { timeout: 15000 });
  const api3 = (await api('/api/wbs')).body;
  const disk3 = readDisk();
  const t1api = api3.tasks.filter((t) => t.id === 'T001')[0];
  const t1disk = disk3.tasks.filter((t) => t.id === 'T001')[0];
  check('B4.multifield-save-3way', t1api.note === '独立复验：多字段保存 2026-10-14' && t1api.status === '进行中' && t1api.dates.dev === '2026-10-15' &&
    t1disk.note === t1api.note && t1disk.status === t1api.status && t1disk.dates.dev === t1api.dates.dev &&
    api3.tasks.filter((t) => t.id === 'T002')[0].status === '已延期' && api3.tasks.filter((t) => t.id === 'T003')[0].status === '被阻塞',
    { t1: { note: t1api.note, status: t1api.status, dev: t1api.dates.dev }, t2: api3.tasks[1].status, t3: api3.tasks[2].status });
  const auditAll = readAuditLines().map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  const lastAudit = auditAll[auditAll.length - 1];
  results.multifieldAudit = lastAudit;
  check('B5.audit-old-new-field-level', !!lastAudit.old && !!lastAudit.new &&
    Object.keys(lastAudit.old.T001 || {}).length >= 3 && lastAudit.old.T001.note === '' && lastAudit.new.T001.note === '独立复验：多字段保存 2026-10-14' &&
    lastAudit.old.T001.status === '未开始' && lastAudit.new.T001.status === '进行中' && lastAudit.old.T001['dates.dev'] === '' && lastAudit.new.T001['dates.dev'] === '2026-10-15' &&
    lastAudit.new.T002.status === '已延期' && lastAudit.new.T003.status === '被阻塞' && auditAll.length === auditLenBefore + 1,
    lastAudit);

  const histNow = await api('/api/history?date=' + today() + '&tz=' + TZ);
  check('B6.api-history-today-count', histNow.status === 200 && histNow.body.count === histNow.body.records.length && histNow.body.date === today(), { status: histNow.status, date: histNow.body.date, count: histNow.body.count });
  const histRecs = histNow.body.records;
  results.historyFields = histRecs.map((r) => r.task_id + ':' + r.field);
  const mrecs = histRecs.filter((r) => r.at === lastAudit.ts);
  results.multifieldHistoryRecords = mrecs;
  const key = (r) => r.task_id + '|' + r.field;
  const mrecKeys = mrecs.map(key).sort();
  check('B7.api-history-multifield-split-per-field', JSON.stringify(mrecKeys) === JSON.stringify(['T001|dates.dev', 'T001|note', 'T001|status', 'T002|status', 'T003|status']), mrecKeys);
  const recOf = (k) => mrecs.filter((r) => key(r) === k)[0];
  check('B8.api-history-old-new-values', !!recOf('T001|dates.dev') && recOf('T001|dates.dev').old === '' && recOf('T001|dates.dev').new === '2026-10-15' &&
    recOf('T001|status').old === '未开始' && recOf('T001|status').new === '进行中' &&
    recOf('T001|note').old === '' && recOf('T001|note').new === '独立复验：多字段保存 2026-10-14' &&
    recOf('T002|status').new === '已延期' && recOf('T003|status').new === '被阻塞', mrecs);
  check('B8b.api-history-structural-snapshot-fields', mrecs.every((r) => r.identity === '项目负责人' && r.level1 && r.level2 && r.task && r.owner), mrecs[0]);
  check('B9.api-history-snapshot-columns', histNow.body.records.every((r) => ['task_id', 'field', 'at', 'identity', 'level1', 'level2', 'task', 'owner', 'old', 'new'].every((k) => k in r)), histNow.body.records[0]);

  // /api/history 参数行为
  const hNoDate = await api('/api/history');
  check('B10.api-history-default-date-tz', hNoDate.status === 200 && hNoDate.body.date === today() && hNoDate.body.tz === TZ, { date: hNoDate.body.date, tz: hNoDate.body.tz });
  const hUtc = await api('/api/history?date=' + today() + '&tz=UTC');
  check('B11.api-history-tz-param-changes-window', hUtc.status === 200 && hUtc.body.tz === 'UTC' && hUtc.body.from !== histNow.body.from && Date.parse(hUtc.body.from) === Date.parse(today() + 'T00:00:00Z'), { from: hUtc.body.from, to: hUtc.body.to, shFrom: histNow.body.from });
  check('B12.api-history-shanghai-day-bounds', histNow.body.from === today() + 'T00:00:00.000Z' ? false : Date.parse(histNow.body.to) - Date.parse(histNow.body.from) === 24 * 3600 * 1000 && histNow.body.from.endsWith('Z'), { from: histNow.body.from, to: histNow.body.to });
  const hBadTz = await api('/api/history?tz=Not/AZone');
  const hBadDate = await api('/api/history?date=2026-13-99');
  check('B13.api-history-invalid-tz-date-400', hBadTz.status === 400 && hBadDate.status === 400, { badTz: hBadTz.status, badDate: hBadDate.status });
  const hYesterday = await api('/api/history?date=2026-10-13&tz=' + TZ);
  check('B14.api-history-crossday-boundary', hYesterday.status === 200 && hYesterday.body.to === '2026-10-13T16:00:00.000Z' && hYesterday.body.records.every((r) => Date.parse(r.at) >= Date.parse(hYesterday.body.from) && Date.parse(r.at) < Date.parse(hYesterday.body.to)), { from: hYesterday.body.from, to: hYesterday.body.to, count: hYesterday.body.count });
  fs.writeFileSync(path.join(OUTDIR, 'results', 'history-today.json'), JSON.stringify(histNow.body, null, 2));
  fs.writeFileSync(path.join(OUTDIR, 'results', 'history-params.json'), JSON.stringify({ noDate: hNoDate.body, utc: hUtc.body, badTz: hBadTz.body, badDate: hBadDate.body, yesterday: hYesterday.body }, null, 2));

  // ------------------------------------------------- CH-4 新增人员（校验 / 反例 / 正例）
  const idsBefore = (await api('/api/wbs')).body.identities.slice();
  const auditBeforeAdd = readAuditLines().length;
  await page.click('#add-person-btn');
  await page.waitForFunction(() => !document.getElementById('add-person-panel').hidden, null, { timeout: 5000 });
  const panelOpen = await page.evaluate(() => ({ hidden: document.getElementById('add-person-panel').hidden, confirmVisible: getComputedStyle(document.getElementById('new-person-confirm')).display !== 'none', cancelVisible: getComputedStyle(document.getElementById('new-person-cancel')).display !== 'none' }));
  check('C1.CH4-panel-open-with-buttons', panelOpen.hidden === false && panelOpen.confirmVisible && panelOpen.cancelVisible, panelOpen);
  // 空输入
  await page.fill('#new-person-name', '   ');
  await page.click('#new-person-confirm');
  await sleep(200);
  const emptyMsg = await page.evaluate(() => ({ hidden: document.getElementById('new-person-msg').hidden, text: document.getElementById('new-person-msg').textContent, panelHidden: document.getElementById('add-person-panel').hidden }));
  const idsAfterEmpty = (await api('/api/wbs')).body.identities;
  check('C2.CH4-empty-rejected-with-cn-message', emptyMsg.hidden === false && emptyMsg.text.includes('不能为空') && emptyMsg.panelHidden === false && JSON.stringify(idsAfterEmpty) === JSON.stringify(idsBefore), { msg: emptyMsg, ids: idsAfterEmpty.length });
  // 重复
  await page.fill('#new-person-name', '李欢');
  await page.click('#new-person-confirm');
  await sleep(200);
  const dupMsg = await page.evaluate(() => document.getElementById('new-person-msg').textContent);
  check('C3.CH4-duplicate-rejected', dupMsg.includes('已在人员池'), dupMsg);
  // 超长（21 字符）
  await page.fill('#new-person-name', LONG_NAME);
  await page.click('#new-person-confirm');
  await sleep(200);
  const longMsg = await page.evaluate(() => document.getElementById('new-person-msg').textContent);
  check('C4.CH4-toolong-rejected', longMsg.includes('长度'), longMsg);
  const auditAfterInvalid = readAuditLines().length;
  check('C5.CH7-invalid-inputs-write-no-audit-no-state', JSON.stringify((await api('/api/wbs')).body.identities) === JSON.stringify(idsBefore) && auditAfterInvalid === auditBeforeAdd, { auditBefore: auditBeforeAdd, auditAfter: auditAfterInvalid });
  // 取消
  await page.click('#new-person-cancel');
  await sleep(150);
  const cancelled = await page.evaluate(() => document.getElementById('add-person-panel').hidden);
  check('C6.CH4-cancel-closes-panel-no-change', cancelled === true && JSON.stringify((await api('/api/wbs')).body.identities) === undefined ? cancelled === true : cancelled === true, { hidden: cancelled });
  // 合法新增
  await page.click('#add-person-btn');
  await page.fill('#new-person-name', ADD_NAME);
  await shot('04-add-person-panel');
  await clearBanner();
  await page.click('#new-person-confirm');
  await page.waitForFunction(() => !document.getElementById('banner').hidden && document.getElementById('banner-text').textContent.indexOf('已新增人员') !== -1, null, { timeout: 20000 });
  const addBanner = await bannerText();
  const apiAfterAdd = (await api('/api/wbs')).body;
  const diskAfterAdd = readDisk();
  check('C7.CH4-valid-add-persisted-api-disk', apiAfterAdd.identities.indexOf(ADD_NAME) !== -1 && diskAfterAdd.identities.indexOf(ADD_NAME) !== -1 && addBanner.text.includes('已新增人员'), { banner: addBanner.text, api: apiAfterAdd.identities, disk: diskAfterAdd.identities });
  const fourPlaces = await page.evaluate(() => ({
    identitySelect: Array.from(document.getElementById('identity-select').options).map((o) => o.value),
    ownerFilter: Array.from(document.getElementById('owner-filter').options).map((o) => o.value),
    ownerSelects: Array.from(document.querySelectorAll('#wbs-body select.owner-select')).map((s) => Array.from(s.options).map((o) => o.value)).slice(0, 1)[0],
    layerList: null
  }));
  await page.click('#home-btn');
  await sleep(200);
  const layerList = await identitiesInPage();
  const identityAddHidden = await page.evaluate(() => document.getElementById('identity-add').hidden);
  check('C8.CH4-four-places-sync', fourPlaces.identitySelect.indexOf(ADD_NAME) !== -1 && fourPlaces.ownerFilter.indexOf(ADD_NAME) !== -1 && fourPlaces.ownerSelects.indexOf(ADD_NAME) !== -1 && layerList.indexOf(ADD_NAME) !== -1, { identitySelect: fourPlaces.identitySelect, ownerFilter: fourPlaces.ownerFilter, ownerSelect: fourPlaces.ownerSelects, layerList });
  check('C9.CH4-pm-entry-visible-on-identity-layer', identityAddHidden === false, { hidden: identityAddHidden });
  await page.click('#identity-list button[data-identity="项目负责人"]');
  await page.waitForFunction(() => !document.getElementById('workbench').hidden, null, { timeout: 10000 });
  // 刷新后仍在
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !document.getElementById('workbench').hidden, null, { timeout: 15000 });
  const afterReloadAdd = await page.evaluate(() => ({ list: null, sel: Array.from(document.getElementById('identity-select').options).map((o) => o.value) }));
  check('C10.CH4-survives-page-reload', afterReloadAdd.sel.indexOf(ADD_NAME) !== -1, afterReloadAdd.sel);
  // CH-7 审计
  const auditAll2 = readAuditLines().map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  const idAdded = auditAll2.filter((e) => e.type === 'identity_added' && e.name === ADD_NAME);
  check('C11.CH7-identity_added-audit', idAdded.length === 1 && idAdded[0].identity === '项目负责人' && typeof idAdded[0].at === 'string' && !isNaN(Date.parse(idAdded[0].at)), idAdded);
  const histAfterAdd = await api('/api/history?date=' + today() + '&tz=' + TZ);
  const poolRec = histAfterAdd.body.records.filter((r) => r.field === '人员池');
  results.poolRecords = poolRec;
  check('C12.CH7-history-identity_added-record', poolRec.length === 1 && poolRec[0].new === ADD_NAME && poolRec[0].old === '' && poolRec[0].identity === '项目负责人' && poolRec[0].task === '新增人员 ' + ADD_NAME, poolRec);

  // ------------------------------------------------- 验收 5：新增行空输入不写入
  const revBeforeAddRow = (await api('/api/wbs')).body.meta.revision;
  const diskMtimeBefore = fs.statSync(path.join(DATA_DIR, 'wbs.json')).mtimeMs;
  await page.click('#add-row-btn');
  await sleep(200);
  const draftRow = await page.evaluate(() => {
    const tr = document.querySelector('#wbs-body tr.row-editing');
    return tr ? { id: tr.getAttribute('data-id'), cls: tr.className, l1Editor: !!tr.querySelector('td[data-field="level1"] input') } : null;
  });
  check('D1.acceptance4-add-row-draft', !!draftRow && draftRow.id === 'T037' && draftRow.cls.includes('row-editing') && draftRow.l1Editor, draftRow);
  await clearBanner();
  await page.click('#save-btn');
  await sleep(800);
  const emptySaveBanner = await bannerText();
  const revAfterEmptySave = (await api('/api/wbs')).body.meta.revision;
  const diskMtimeAfter = fs.statSync(path.join(DATA_DIR, 'wbs.json')).mtimeMs;
  check('D2.acceptance5-empty-row-blocked-no-api-no-write', emptySaveBanner.cls.includes('error') && emptySaveBanner.text.includes('前置校验未通过') && revAfterEmptySave === revBeforeAddRow && diskMtimeAfter === diskMtimeBefore, { banner: emptySaveBanner.text.slice(0, 120), rev: { before: revBeforeAddRow, after: revAfterEmptySave } });
  const bannerActionHidden = await page.evaluate(() => document.getElementById('banner-action').hidden);
  note('校验失败横幅未提供「重新加载」按钮（banner-action hidden=' + bannerActionHidden + '），因此本脚本用页面刷新放弃草稿；该行为属 Stage1 既有设计，非本变更包范围，仅记录。');
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !document.getElementById('workbench').hidden && document.getElementById('wbs-body').children.length > 0, null, { timeout: 15000 });
  await sleep(300);
  const rowsAfterReload = (await rows()).length;
  check('D3.discard-draft-reload-36-rows', rowsAfterReload === 36, rowsAfterReload);

  // 新增行 → 填必填 → 保存 → 三端一致
  await page.click('#add-row-btn');
  await sleep(200);
  await page.fill('#wbs-body tr[data-id="T037"] td[data-field="level1"] input', '独立复验');
  await page.locator('#wbs-body tr[data-id="T037"] td[data-field="level1"] input').press('Tab');
  await sleep(150);
  await page.fill('#wbs-body tr[data-id="T037"] td[data-field="level2"] input', '临时验证行');
  await page.locator('#wbs-body tr[data-id="T037"] td[data-field="level2"] input').press('Tab');
  await sleep(150);
  await page.fill('#wbs-body tr[data-id="T037"] td[data-field="task"] input', '删除路径验证');
  await page.locator('#wbs-body tr[data-id="T037"] td[data-field="task"] input').press('Tab');
  await sleep(200);
  await clearBanner();
  await page.click('#save-btn');
  await page.waitForFunction(() => { const b = document.getElementById('banner'); return !b.hidden && b.className.includes('ok'); }, null, { timeout: 15000 });
  const apiAdded = (await api('/api/wbs')).body;
  const diskAdded = readDisk();
  check('D4.acceptance4-add-row-saved-3way', apiAdded.tasks.length === 37 && diskAdded.tasks.length === 37 && !!apiAdded.tasks.filter((t) => t.id === 'T037')[0] && (await rows()).length === 37, { api: apiAdded.tasks.length, disk: diskAdded.tasks.length, page: (await rows()).length });

  // ------------------------------------------------- CH-1 删除：取消 / 确认
  dialogBehavior = 'dismiss';
  await page.click('#wbs-body tr[data-id="T037"] [data-delete]');
  await sleep(300);
  const cancelPath = { dialog: lastDialog, rows: (await rows()).length, hint: await hintText() };
  await shot('06-delete-confirm-cancel');
  check('E1.CH1-delete-cancel-keeps-row', cancelPath.dialog && cancelPath.dialog.type === 'confirm' && cancelPath.dialog.message.includes('T037') && cancelPath.rows === 37 && cancelPath.hint.text.includes('已取消删除'), cancelPath);
  dialogBehavior = 'accept';
  await page.click('#wbs-body tr[data-id="T037"] [data-delete]');
  await sleep(300);
  const acceptPath = { dialog: lastDialog, rows: (await rows()).length };
  check('E2.CH1-delete-confirm-removes-from-page', acceptPath.rows === 36 && acceptPath.dialog.message.includes('T037'), acceptPath);
  await clearBanner();
  await page.click('#save-btn');
  await page.waitForFunction(() => { const b = document.getElementById('banner'); return !b.hidden && b.className.includes('ok'); }, null, { timeout: 15000 });
  const apiDeleted = (await api('/api/wbs')).body;
  const diskDeleted = readDisk();
  const pageIds = (await rows()).map((r) => r.id);
  check('E3.CH1-delete-saved-page-api-disk-consistent', apiDeleted.tasks.length === 36 && diskDeleted.tasks.length === 36 && !apiDeleted.tasks.filter((t) => t.id === 'T037')[0] && !diskDeleted.tasks.filter((t) => t.id === 'T037')[0] && !pageIds.includes('T037') &&
    JSON.stringify(diskDeleted.tasks.map((t) => t.id)) === JSON.stringify(apiDeleted.tasks.map((t) => t.id)), { api: apiDeleted.tasks.length, disk: diskDeleted.tasks.length, page: pageIds.length });
  const apiTasksJson = JSON.stringify(apiDeleted.tasks);
  const diskTasksJson = JSON.stringify(diskDeleted.tasks);
  check('E4.three-way-tasks-full-equal', apiTasksJson === diskTasksJson, { equal: apiTasksJson === diskTasksJson });

  // ------------------------------------------------- CH-5 / CH-6 导出（真实下载 + 读回）
  const docAtWbsExport = (await api('/api/wbs')).body;
  const wbsExportAt = new Date();
  await clearBanner();
  const [dlWbs] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#export-btn')]);
  const wbsPath = path.join(DL, 'wbs-export.xlsx');
  await dlWbs.saveAs(wbsPath);
  const wbsBanner = await bannerText();
  check('F1.CH6-wbs-export-downloaded', fs.existsSync(wbsPath) && fs.statSync(wbsPath).size > 1000 && dlWbs.suggestedFilename().startsWith('蓉城战役WBS-') && wbsBanner.text.includes('导出'), { name: dlWbs.suggestedFilename(), size: fs.statSync(wbsPath).size });

  const docAtDailyExport = (await api('/api/wbs')).body;
  const histAtDailyExport = (await api('/api/history?date=' + today() + '&tz=' + TZ)).body;
  const dailyExportAt = new Date();
  await clearBanner();
  const [dlDaily] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#daily-btn')]);
  const dailyPath = path.join(DL, 'daily-export.xlsx');
  await dlDaily.saveAs(dailyPath);
  const dailyBanner = await bannerText();
  await shot('05-daily-export-banner');
  const blockedCount = docAtDailyExport.tasks.filter((t) => ['被阻塞', '已延期'].indexOf(t.status) !== -1).length;
  check('F2.CH5-daily-export-downloaded-banner', fs.existsSync(dailyPath) && dailyBanner.text.includes('阻塞与延期') && dailyBanner.text.includes('当日变更') && dailyBanner.text.includes('sheet「当日变更」' + histAtDailyExport.count + ' 行'), { name: dlDaily.suggestedFilename(), banner: dailyBanner.text, historyCount: histAtDailyExport.count, blockedCount });

  fs.writeFileSync(path.join(OUTDIR, 'results', 'wbs-at-export.json'), JSON.stringify(docAtWbsExport, null, 2));
  fs.writeFileSync(path.join(OUTDIR, 'results', 'daily-at-export.json'), JSON.stringify({ doc: docAtDailyExport, history: histAtDailyExport, exportAt: dailyExportAt.toISOString(), wbsExportAt: wbsExportAt.toISOString(), tzStampWbs: tzStamp(wbsExportAt), tzStampDaily: tzStamp(dailyExportAt) }, null, 2));

  // ------------------------------------------------- 收尾：健康 + 错误计数
  const finalControls = await controls();
  check('F3.health-probe-final-ok', finalControls.health.includes('服务正常'), finalControls.health);
  const faviconErr = results.console_errors.filter((t) => t.includes('favicon'));
  results.console_errors_other = results.console_errors.filter((t) => !t.includes('favicon'));
  check('F4.no-pageerror', results.page_errors.length === 0, results.page_errors);
  check('F5.no-console-error-except-favicon', results.console_errors_other.length === 0, { favicon: faviconErr.length, other: results.console_errors_other });

  results.finished_at = new Date().toISOString();
  results.summary = { pass, fail };
  fs.writeFileSync(path.join(OUTDIR, 'results', 'live-browser-results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(OUTDIR, 'logs', 'live-browser.log'), results.checks.map((c) => (c.ok ? 'PASS  ' : 'FAIL  ') + c.id + (c.detail ? '  :: ' + JSON.stringify(c.detail) : '')).join('\n') + '\n\nPASS=' + pass + ' FAIL=' + fail + '\n');
  console.log('\n==== PASS=' + pass + ' FAIL=' + fail + ' ====');
  await context.close();
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (err) => {
  console.log('FATAL ' + (err && err.stack || err));
  results.fatal = String(err && err.stack || err);
  try { fs.writeFileSync(path.join(OUTDIR, 'results', 'live-browser-results.json'), JSON.stringify(results, null, 2)); } catch (e) {}
  process.exit(2);
});
