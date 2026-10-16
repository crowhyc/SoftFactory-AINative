'use strict';
/* YUNZ-40 / Stage20 独立复验：真实浏览器（Chromium 140，官方 playwright 镜像）交互用例集。
   对象 = 隔离实例（isoA 4310 / isoB 4311 / isoC 4312 / isoS 4313），数据目录 stage20/iso/*。
   覆盖 CH-15 必测 1、2、4、5、6、7、8、9 的交互面与 CH-1…CH-14 抽样不回归。
   本文件不复用作者自测脚本；断言口径与数量均独立编写。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(process.env.TOOLS || '/tools', 'node_modules', 'playwright'));

const TOOLS = process.env.TOOLS || '/tools';
const OUTDIR = process.env.OUTDIR || '/qv/results';
const SHOTDIR = process.env.SHOTDIR || '/qv/shots';
const DLDIR = process.env.DLDIR || '/qv/downloads';
const QVROOT = process.env.QVROOT || '/qv';
const BASE = {
  isoA: process.env.BASE_A || 'http://127.0.0.1:4310',
  isoB: process.env.BASE_B || 'http://127.0.0.1:4311',
  isoC: process.env.BASE_C || 'http://127.0.0.1:4312',
  isoS: process.env.BASE_S || 'http://127.0.0.1:4313'
};
const EXP = JSON.parse(fs.readFileSync(path.join(QVROOT, 'results', 'expected-stats.json'), 'utf8')).datasets;

const L = {
  notStarted: '\u672a\u5f00\u59cb', started: '\u5df2\u5f00\u59cb', done: '\u5df2\u5b8c\u6210',
  delayed: '\u5ef6\u671f', blocked: '\u963b\u585e',
  design: '\u8bbe\u8ba1', dev: '\u5f00\u53d1', test: '\u6d4b\u8bd5',
  product: '\u4ea7\u54c1\u9a8c\u6536', demo: '\u6f14\u793a\u51c6\u5907',
  all5: '\u5168\u90e8\u4e94\u9636\u6bb5\u5408\u5e76', detail: '\u8be6\u60c5', close: '\u5173\u95ed',
  total: '\u5171 ', detailTitle: '\u5206\u9636\u6bb5\u72b6\u6001\u5360\u6bd4',
  productOnly: '\u4ea7\u54c1', pm: '\u9879\u76ee\u8d1f\u8d23\u4eba',
  save: '\u4fdd\u5b58', addRow: '\u65b0\u589e\u884c', exportXlsx: '\u5bfc\u51fa Excel',
  daily: '\u5bfc\u51fa\u65e5\u62a5', search: '\u641c\u7d22', owner: '\u8d1f\u8d23\u4eba',
  item: '\u4efb\u52a1\u9879', lv1: '\u4e00\u7ea7', lv2: '\u4e8c\u7ea7',
  id: '\u5e8f\u53f7', note: '\u8fdb\u5c55\u8bf4\u660e', op: '\u64cd\u4f5c'
};
const STATUSES = [L.notStarted, L.started, L.done, L.delayed, L.blocked];
const PHASES = ['design', 'dev', 'test', 'product', 'demo_prep'];
const PHASE_LABELS = { design: L.design, dev: L.dev, test: L.test, product: L.product, demo_prep: L.demo };
const COLOR = {
  [L.notStarted]: 'rgb(158, 158, 158)', [L.started]: 'rgb(47, 128, 237)',
  [L.done]: 'rgb(39, 174, 96)', [L.delayed]: 'rgb(231, 76, 60)', [L.blocked]: 'rgb(255, 212, 0)'
};
const HEADERS = [L.id, L.lv1, L.lv2, L.item, L.owner, L.design, L.dev, L.test, L.product, L.demo, L.note, L.op];

const results = { started_at: new Date().toISOString(), checks: [] };
let pass = 0;
let fail = 0;
const check = (id, ok, detail) => {
  results.checks.push({ id, ok: !!ok, detail: detail === undefined ? null : detail });
  if (ok) { pass += 1; console.log('PASS  ' + id + (detail === undefined ? '' : '  :: ' + JSON.stringify(detail, null, 0))); }
  else { fail += 1; console.log('FAIL  ' + id + '  -> ' + JSON.stringify(detail, null, 0)); }
};
const t10 = (v) => Math.round(Number(v) * 10);
const eqTenths = (a, b) => JSON.stringify(a.map(t10)) === JSON.stringify(b.map(t10));
const sumTenths = (arr) => arr.map(t10).reduce((s, v) => s + v, 0);
/* 统一签名：既接受页面徽标（pct）也接受接口 statuses（percentage）。 */
const sig = (items) => items.map((b) => b.value + '=' + b.count + '/' +
  t10(b.percentage === undefined ? b.pct : b.percentage)).join(',');

/* ------------------------------------------------------------ 页面读取工具 */

const READ_OVERVIEW = () => {
  const rowsOf = (sel) => Array.from(document.querySelectorAll(sel + ' .overview-row')).map((row) => ({
    key: row.getAttribute('data-phase'),
    label: (row.querySelector('.overview-phase') || {}).textContent || '',
    badges: Array.from(row.querySelectorAll('.overview-badge')).map((b) => ({
      value: b.getAttribute('data-status'),
      text: b.textContent,
      count: Number(b.getAttribute('data-count')),
      pct: Number(b.getAttribute('data-percentage')),
      color: getComputedStyle(b).backgroundColor
    }))
  }));
  const panel = document.getElementById('overview-detail-panel');
  const head = document.querySelector('.overview-head');
  const btn = document.getElementById('overview-detail-btn');
  const rowsBox = document.getElementById('overview-rows');
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  return {
    aggregate: rowsOf('#overview-rows'),
    detail: rowsOf('#overview-detail-rows'),
    totalText: (document.getElementById('overview-total') || {}).textContent || '',
    detailTotalText: (document.getElementById('overview-detail-total') || {}).textContent || '',
    note: (document.querySelector('.overview-note') || {}).textContent || '',
    overviewTitle: (document.querySelector('.overview-title') || {}).textContent || '',
    detailTitle: (document.getElementById('overview-detail-title') || {}).textContent || '',
    detailSub: (document.querySelector('.overview-detail-panel .modal-sub') || {}).textContent || '',
    detailOpen: !!(panel && !panel.hidden),
    detailBtn: btn ? { text: btn.textContent, visible: !!(btn.offsetParent || btn.getClientRects().length) } : null,
    btnRect: btn ? rect(btn) : null,
    headRect: head ? rect(head) : null,
    rowsRect: rowsBox ? rect(rowsBox) : null,
    headers: Array.from(document.querySelectorAll('#wbs-table thead th')).map((th) => th.textContent),
    rows: document.querySelectorAll('#wbs-body tr[data-id]').length,
    countText: (document.getElementById('task-count') || {}).textContent || '',
    overviewSectionText: (document.getElementById('phase-overview') || {}).textContent || '',
    detailPanelText: panel ? panel.textContent : '',
    footerText: (document.querySelector('.footer') || {}).textContent || '',
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    sessionText: (document.getElementById('session-status') || {}).textContent || '',
    saveDisabled: document.getElementById('save-btn') ? document.getElementById('save-btn').disabled : null,
    addRowHidden: document.getElementById('add-row-btn') ? document.getElementById('add-row-btn').hidden : null,
    addPersonHidden: document.getElementById('add-person-btn') ? document.getElementById('add-person-btn').hidden : null,
    hint: (document.getElementById('hint') || {}).textContent || '',
    hintHidden: document.getElementById('hint') ? document.getElementById('hint').hidden : null,
    phaseSelectColors: Array.from(document.querySelectorAll('#wbs-body select.phase-select')).reduce((acc, sel) => {
      const statuses = Array.from(sel.querySelectorAll('option')).map((o) => o.value);
      if (!acc.__all) acc.__all = {};
      statuses.forEach((s) => { if (!acc.__all[s]) acc.__all[s] = getComputedStyle(sel).backgroundColor; });
      const current = sel.value;
      acc[current] = getComputedStyle(sel).backgroundColor;
      acc.__className = sel.className;
      return acc;
    }, {}),
    phaseSelectCount: document.querySelectorAll('#wbs-body select.phase-select').length,
    structuralEditors: Array.from(document.querySelectorAll('#wbs-body [data-edit-field]')).map((el) => el.getAttribute('data-edit-field')),
    docTasks: (window.WBSApp && window.WBSApp.state && window.WBSApp.state.doc) ? window.WBSApp.state.doc.tasks.map((t) => ({
      id: t.id, task: t.task, note: t.note, owner: t.owner, dates: t.dates, phases: t.phases
    })) : null,
    revision: (window.WBSApp && window.WBSApp.state) ? window.WBSApp.state.revision : null,
    dirty: (window.WBSApp && window.WBSApp.state) ? !!(window.WBSApp.state.dirty) : null
  };
};

const apiStats = (page) => page.evaluate(() => fetch('/api/stats', { cache: 'no-store' }).then((r) => r.json()));
const apiWbs = (page) => page.evaluate(() => fetch('/api/wbs', { cache: 'no-store' }).then((r) => r.json()));

async function enterAs(page, base, identity, expectTotal) {
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#identity-list button[data-identity]');
  await page.click('#identity-list button[data-identity="' + identity + '"]');
  await page.waitForSelector('#workbench:not([hidden])');
  await page.waitForFunction((total) => {
    const el = document.getElementById('overview-total');
    if (!el) return false;
    const rows = document.querySelectorAll('#overview-rows .overview-row');
    return rows.length === 1 && rows[0].querySelectorAll('.overview-badge').length === 5 &&
      (total == null || el.textContent.indexOf(String(total)) !== -1);
  }, expectTotal == null ? null : expectTotal, { timeout: 15000 });
}

function instrument(page, base) {
  const origin = new URL(base).origin;
  const state = { downloads: [], external: [], pageErrors: [], consoleErrors: [] };
  page.on('download', (d) => state.downloads.push(d));
  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    if (!url.startsWith(origin)) state.external.push(url);
  });
  page.on('pageerror', (err) => state.pageErrors.push(String(err && err.message ? err.message : err)));
  page.on('console', (msg) => { if (msg.type() === 'error') state.consoleErrors.push(msg.text()); });
  page.on('dialog', (d) => d.accept());
  return state;
}

async function waitSaved(page, prevRevision) {
  await page.waitForFunction((prev) => {
    const st = window.WBSApp && window.WBSApp.state;
    return st && !st.dirty && st.revision !== prev;
  }, prevRevision, { timeout: 15000 });
  await page.waitForTimeout(300);
}

async function waitOverviewMatchesApi(page) {
  await page.waitForFunction(() => {
    const st = window.WBSApp && window.WBSApp.state;
    return !!(st && st.stats && st.stats.aggregate);
  }, null, { timeout: 15000 });
}

/* ------------------------------------------------------------ 各段落用例 */

async function section10(browser) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const inst = instrument(page, BASE.isoB);
  await enterAs(page, BASE.isoB, L.pm, 12);
  const dom = await page.evaluate(READ_OVERVIEW);
  const stats = await apiStats(page);
  const exp = EXP.isoB;

  check('10a/顶部只有一组全量统计（CH-14 顶部五段分行已不存在）',
    dom.aggregate.length === 1 && dom.aggregate[0].key === 'aggregate' && dom.aggregate[0].label === L.all5,
    { rows: dom.aggregate.length, key: dom.aggregate[0] && dom.aggregate[0].key, label: dom.aggregate[0] && dom.aggregate[0].label });
  check('10b/五种状态徽标齐显且顺序 = 未开始/已开始/已完成/延期/阻塞',
    dom.aggregate[0].badges.length === 5 && dom.aggregate[0].badges.map((b) => b.value).join(',') === STATUSES.join(','),
    dom.aggregate[0].badges.map((b) => b.value));
  const textOk = dom.aggregate[0].badges.every((b, i) => b.text === b.value + ' ' + stats.aggregate.statuses[i].count +
    ' ' + Number(stats.aggregate.statuses[i].percentage).toFixed(1) + '%');
  check('10b/徽标文本 = 状态名 + 数量 + 百分比（与 /api/stats.aggregate 逐项一致）', textOk,
    dom.aggregate[0].badges.map((b) => b.text));
  check('10b/徽标 data-count/data-percentage 与 /api/stats 逐项一致',
    JSON.stringify(dom.aggregate[0].badges.map((b) => b.count)) === JSON.stringify(stats.aggregate.statuses.map((s) => s.count))
    && eqTenths(dom.aggregate[0].badges.map((b) => b.pct), stats.aggregate.statuses.map((s) => s.percentage)),
    { dom: dom.aggregate[0].badges.map((b) => b.count + '/' + b.pct), api: stats.aggregate.statuses.map((s) => s.count + '/' + s.percentage) });
  check('10c/#overview-rows 内不存在任何分阶段行（data-phase != aggregate）',
    dom.aggregate.every((r) => r.key === 'aggregate'), dom.aggregate.map((r) => r.key));
  check('10d/全量区标题与总数文案', dom.overviewTitle === L.all5 && dom.totalText === L.total + '12 ' + '\u6761',
    { title: dom.overviewTitle, total: dom.totalText });
  check('10e/0 项状态仍显示「0 0.0%」（isoB 阻塞 = 0）',
    dom.aggregate[0].badges[4].count === 0 && dom.aggregate[0].badges[4].text === L.blocked + ' 0 0.0%',
    dom.aggregate[0].badges[4].text);
  check('10f/分母说明 = 任务总数 x 5，且页面计数合计 = 12 x 5 = 60',
    dom.note.indexOf('\u5206\u6bcd = \u5f53\u524d\u4efb\u52a1\u603b\u6570 \u00d7 5') !== -1
    && dom.aggregate[0].badges.reduce((s, b) => s + b.count, 0) === 60,
    { note: dom.note, sum: dom.aggregate[0].badges.reduce((s, b) => s + b.count, 0) });
  check('10g/无 pageerror（进入工作台 + 全量渲染）', inst.pageErrors.length === 0, inst.pageErrors);
  await page.screenshot({ path: path.join(SHOTDIR, 'isoB-workbench-1600.png') });
  await context.close();
}

async function section11(browser) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  instrument(page, BASE.isoB);
  await enterAs(page, BASE.isoB, L.pm, 12);
  const before = await page.evaluate(READ_OVERVIEW);
  const stats = await apiStats(page);
  const exp = EXP.isoB;

  const rightOfRows = before.btnRect && before.rowsRect && before.btnRect.x > before.rowsRect.x;
  const insideHead = before.btnRect && before.headRect && before.btnRect.y >= before.headRect.y - 2
    && before.btnRect.y <= before.headRect.y + before.headRect.h + 2;
  check('11a/全量区右侧有「详情」按钮（在 .overview-head 内且位于统计行右侧）',
    before.detailBtn && before.detailBtn.visible && before.detailBtn.text === L.detail && insideHead && rightOfRows,
    { btn: before.detailBtn, insideHead: insideHead, rightOfRows: rightOfRows, btnX: before.btnRect && before.btnRect.x, rowsX: before.rowsRect && before.rowsRect.x });

  check('11b/未点击时详情面板关闭', before.detailOpen === false && before.detail.length === 5, { open: before.detailOpen });

  await page.click('#overview-detail-btn');
  await page.waitForSelector('#overview-detail-panel:not([hidden])');
  const opened = await page.evaluate(READ_OVERVIEW);
  check('11b/点开后面板可见，五阶段五行且顺序 = 设计/开发/测试/产品验收/演示准备',
    opened.detailOpen === true && opened.detail.length === 5
    && opened.detail.map((r) => r.key).join(',') === PHASES.join(',')
    && opened.detail.map((r) => r.label).join(',') === PHASES.map((k) => PHASE_LABELS[k]).join(','),
    { open: opened.detailOpen, keys: opened.detail.map((r) => r.key), labels: opened.detail.map((r) => r.label) });
  const detailOk = opened.detail.every((row, i) => row.badges.length === 5
    && row.badges.every((b, j) => b.value === STATUSES[j]
      && b.count === stats.phases[i].statuses[j].count
      && t10(b.pct) === t10(stats.phases[i].statuses[j].percentage)
      && eqTenths([b.pct], [exp.phases[i].percentages[j]])));
  check('11c/详情区五阶段各展示 count + percentage，与 /api/stats.phases 及独立期望逐项一致', detailOk,
    { detail: opened.detail.map((r) => sig(r.badges)), api: stats.phases.map((p) => sig(p.statuses)),
      expected: exp.phases.map((p) => p.counts.map((c, i) => c + '/' + Math.round(p.percentages[i] * 10)).join(',')) });
  check('11c/详情面板标题与总数文案', opened.detailTitle === L.detailTitle && opened.detailTotalText === L.total + '12 ' + '\u6761',
    { title: opened.detailTitle, total: opened.detailTotalText });
  await page.screenshot({ path: path.join(SHOTDIR, 'isoB-detail-1600.png') });

  await page.click('#overview-detail-close');
  const closed = await page.evaluate(READ_OVERVIEW);
  check('11d/关闭按钮可关闭面板', closed.detailOpen === false, { open: closed.detailOpen });

  await page.click('#overview-detail-btn');
  await page.waitForSelector('#overview-detail-panel:not([hidden])');
  await page.keyboard.press('Escape');
  const escClosed = await page.evaluate(READ_OVERVIEW);
  check('11e/Esc 可关闭面板', escClosed.detailOpen === false, { open: escClosed.detailOpen });

  /* 11f：构造未保存编辑草稿 -> 打开 / 关闭详情不影响草稿 */
  const draftTarget = '#wbs-body tr[data-id="Q001"] input[type="date"]';
  await page.fill(draftTarget, '2026-11-11');
  await page.dispatchEvent(draftTarget, 'change');
  await page.waitForFunction(() => window.WBSApp.state.dirty === true);
  const draftBefore = await page.evaluate(() => ({
    dirty: window.WBSApp.state.dirty,
    value: document.querySelector('#wbs-body tr[data-id="Q001"] input[type="date"]').value,
    saveDisabled: document.getElementById('save-btn').disabled,
    session: document.getElementById('session-status').textContent
  }));
  await page.click('#overview-detail-btn');
  await page.waitForSelector('#overview-detail-panel:not([hidden])');
  await page.keyboard.press('Escape');
  const draftAfter = await page.evaluate(() => ({
    dirty: window.WBSApp.state.dirty,
    value: document.querySelector('#wbs-body tr[data-id="Q001"] input[type="date"]').value,
    saveDisabled: document.getElementById('save-btn').disabled,
    session: document.getElementById('session-status').textContent,
    open: !document.getElementById('overview-detail-panel').hidden
  }));
  check('11f/打开 + 关闭详情后未保存草稿原样保留（值 / dirty / 保存按钮 / 会话状态）',
    draftBefore.dirty && draftAfter.dirty && draftAfter.value === '2026-11-11'
    && draftAfter.saveDisabled === false && draftBefore.value === draftAfter.value
    && draftAfter.open === false && draftAfter.session === draftBefore.session,
    { before: draftBefore, after: draftAfter });

  /* 11f-2：面板打开期间底层控件是否可被鼠标点到（可发现性 / 反馈事实记录） */
  await page.click('#overview-detail-btn');
  await page.waitForSelector('#overview-detail-panel:not([hidden])');
  const clickThrough = await page.evaluate(() => {
    const input = document.querySelector('#wbs-body tr[data-id="Q002"] input[type="date"]');
    const box = input.getBoundingClientRect();
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { tag: top ? top.tagName : null, inPanel: !!(top && top.closest('#overview-detail-panel')),
      sameInput: top === input };
  });
  const focusable = await page.evaluate(async () => {
    const input = document.querySelector('#wbs-body tr[data-id="Q002"] input[type="date"]');
    input.focus();
    return document.activeElement === input;
  });
  check('11f-2/面板打开期间底层控件被模态背板遮挡（事实记录：鼠标不可达，键盘仍可聚焦）',
    clickThrough.inPanel === true && clickThrough.sameInput === false && focusable === true,
    { elementAtRow2Date: clickThrough, keyboardFocusWorks: focusable, modalBackdrop: true });
  await page.keyboard.press('Escape');

  /* 11g：伪响应原样渲染（前端不二次计算 / 不二次四舍五入） */
  await page.route('**/api/stats', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({
      ok: true, total: 13, revision: 1,
      aggregate: { key: 'aggregate', name: L.all5, denominator: 65, statuses: [
        { value: L.notStarted, count: 5, percentage: 9.9 },
        { value: L.started, count: 7, percentage: 7.7 },
        { value: L.done, count: 0, percentage: 0 },
        { value: L.delayed, count: 1, percentage: 82.4 },
        { value: L.blocked, count: 0, percentage: 0 }] },
      phases: PHASES.map((key, i) => ({ key, name: PHASE_LABELS[key], statuses: STATUSES.map((value, j) => ({
        value, count: i + j, percentage: i + j + 0.4 })) }))
    })
  }));
  const injected = await page.evaluate(async () => {
    const stats = await window.WBSApp.fetchStats();
    window.WBSApp.renderOverview(stats);
    const rows = Array.from(document.querySelectorAll('#overview-rows .overview-row'));
    const detail = Array.from(document.querySelectorAll('#overview-detail-rows .overview-row'));
    return {
      agg: Array.from(rows[0].querySelectorAll('.overview-badge')).map((b) => b.textContent),
      detailFirst: Array.from(detail[0].querySelectorAll('.overview-badge')).map((b) => b.textContent),
      total: document.getElementById('overview-total').textContent
    };
  });
  check('11g/伪响应原样渲染：count=5 配 percentage=9.9 时页面显示「5 9.9%」（前端不自行计算/不二次四舍五入）',
    injected.agg[0] === L.notStarted + ' 5 9.9%' && injected.agg[1] === L.started + ' 7 7.7%'
    && injected.agg[3] === L.delayed + ' 1 82.4%' && injected.detailFirst[0] === L.notStarted + ' 0 0.4%'
    && injected.total === L.total + '13 ' + '\u6761',
    injected);
  await page.unroute('**/api/stats');
  await context.close();
}

async function section12(browser) {
  for (const ds of ['isoA', 'isoB', 'isoC', 'isoS']) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    instrument(page, BASE[ds]);
    await enterAs(page, BASE[ds], L.pm, EXP[ds].total);
    const dom = await page.evaluate(READ_OVERVIEW);
    const stats = await apiStats(page);
    const exp = EXP[ds];
    check('12/' + ds + ' 页面全量区与 /api/stats.aggregate 逐项一致（count + 0.1% 百分比）',
      dom.aggregate.length === 1 && dom.aggregate[0].badges.length === 5
      && JSON.stringify(dom.aggregate[0].badges.map((b) => b.count)) === JSON.stringify(stats.aggregate.statuses.map((s) => s.count))
      && eqTenths(dom.aggregate[0].badges.map((b) => b.pct), stats.aggregate.statuses.map((s) => s.percentage)),
      { dom: dom.aggregate[0].badges.map((b) => b.text), api: stats.aggregate.statuses.map((s) => s.count + '/' + s.percentage) });
    check('12/' + ds + ' 页面全量区与独立复算期望（Fraction 第二套算法）逐项一致',
      JSON.stringify(dom.aggregate[0].badges.map((b) => b.count)) === JSON.stringify(exp.aggregate.counts)
      && eqTenths(dom.aggregate[0].badges.map((b) => b.pct), exp.aggregate.percentages),
      { dom: dom.aggregate[0].badges.map((b) => b.count + '/' + b.pct), exp: exp.aggregate.counts.map((c, i) => c + '/' + exp.aggregate.percentages[i]) });
    await page.click('#overview-detail-btn');
    await page.waitForSelector('#overview-detail-panel:not([hidden])');
    const detail = await page.evaluate(READ_OVERVIEW);
    const okDetail = detail.detail.length === 5 && detail.detail.every((row, i) =>
      JSON.stringify(row.badges.map((b) => b.count)) === JSON.stringify(stats.phases[i].statuses.map((s) => s.count))
      && eqTenths(row.badges.map((b) => b.pct), stats.phases[i].statuses.map((s) => s.percentage))
      && JSON.stringify(row.badges.map((b) => b.count)) === JSON.stringify(exp.phases[i].counts)
      && eqTenths(row.badges.map((b) => b.pct), exp.phases[i].percentages));
    check('12/' + ds + ' 详情区五阶段与 /api/stats.phases 及独立期望逐项一致', okDetail,
      { detail: detail.detail.map((r) => sig(r.badges)) });
    check('12/' + ds + ' aggregate 分母 = 任务总数 x 5（接口 denominator 与页面计数合计）',
      stats.aggregate.denominator === exp.total * 5
      && dom.aggregate[0].badges.reduce((s, b) => s + b.count, 0) === exp.total * 5,
      { denominator: stats.aggregate.denominator, dom_sum: dom.aggregate[0].badges.reduce((s, b) => s + b.count, 0), total: exp.total });
    await context.close();
  }
}

async function section13(browser) {
  /* isoC：0 行任务 */
  const ctxC = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const pc = await ctxC.newPage();
  const instC = instrument(pc, BASE.isoC);
  await enterAs(pc, BASE.isoC, L.pm, 0);
  const domC = await pc.evaluate(READ_OVERVIEW);
  await pc.click('#overview-detail-btn');
  await pc.waitForSelector('#overview-detail-panel:not([hidden])');
  const detC = await pc.evaluate(READ_OVERVIEW);
  const zeroTexts = domC.aggregate[0].badges.map((b) => b.text);
  const detailZero = detC.detail.every((r) => r.badges.every((b) => b.text === b.value + ' 0 0.0%'));
  check('13a/0 行任务：全量区五项均显示「0 0.0%」且不除零不报错',
    zeroTexts.every((t, i) => t === STATUSES[i] + ' 0 0.0%') && zeroTexts.length === 5,
    zeroTexts);
  check('13a/0 行任务：详情区五阶段各 5 项均「0 0.0%」，总数「共 0 条」',
    detailZero && detC.detail.length === 5 && domC.totalText === L.total + '0 ' + '\u6761',
    { detailZero, total: domC.totalText, rows: detC.detail.length });
  check('13a/0 行任务：页面无 pageerror', instC.pageErrors.length === 0, instC.pageErrors);
  await pc.screenshot({ path: path.join(SHOTDIR, 'isoC-zero-1600.png') });
  await ctxC.close();

  /* isoB：最大余数法补齐 100.0% */
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const p = await ctx.newPage();
  instrument(p, BASE.isoB);
  await enterAs(p, BASE.isoB, L.pm, 12);
  const dom = await p.evaluate(READ_OVERVIEW);
  await p.click('#overview-detail-btn');
  await p.waitForSelector('#overview-detail-panel:not([hidden])');
  const det = await p.evaluate(READ_OVERVIEW);
  const aggSum = sumTenths(dom.aggregate[0].badges.map((b) => b.pct));
  const phaseSums = det.detail.map((r) => sumTenths(r.badges.map((b) => b.pct)));
  check('13b/需补齐的分布：页面全量区五项合计恰为 100.0%（最大余数法生效）',
    aggSum === 1000 && JSON.stringify(dom.aggregate[0].badges.map((b) => b.text)) === JSON.stringify(
      exp_text(EXP.isoB.aggregate)), { sum: aggSum / 10, badges: dom.aggregate[0].badges.map((b) => b.text) });
  check('13b/详情区五个阶段各自五项合计恰为 100.0%', phaseSums.every((s) => s === 1000), phaseSums.map((s) => s / 10));
  check('13c/0 项状态仍显示「0 0.0%」（全量区 + 详情区）',
    dom.aggregate[0].badges[4].text === L.blocked + ' 0 0.0%'
    && det.detail.every((r) => r.badges[4].text === L.blocked + ' ' + r.badges[4].count + ' ' + r.badges[4].pct.toFixed(1) + '%'),
    { agg: dom.aggregate[0].badges[4].text, detailBlocked: det.detail.map((r) => r.badges[4].text) });
  await ctx.close();
}

function exp_text(entry) {
  return STATUSES.map((value, i) => value + ' ' + entry.counts[i] + ' ' + entry.percentages[i].toFixed(1) + '%');
}

async function section14(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const p = await ctx.newPage();
  instrument(p, BASE.isoS);
  await enterAs(p, BASE.isoS, L.pm, 3);
  const dom = await p.evaluate(READ_OVERVIEW);
  await p.click('#overview-detail-btn');
  await p.waitForSelector('#overview-detail-panel:not([hidden])');
  const det = await p.evaluate(READ_OVERVIEW);
  const tableColors = dom.phaseSelectColors;
  const problems = [];
  STATUSES.forEach((status, i) => {
    const agg = dom.aggregate[0].badges[i].color;
    const colors = det.detail.map((r) => r.badges[i].color);
    const table = tableColors[status] || (tableColors.__all || {})[status];
    if (agg !== COLOR[status]) problems.push('aggregate ' + status + '=' + agg);
    colors.forEach((c, k) => { if (c !== COLOR[status]) problems.push('detail[' + k + '] ' + status + '=' + c); });
    if (table !== COLOR[status]) problems.push('table ' + status + '=' + table);
  });
  check('14/五种状态颜色 = 未开始灰/已开始蓝/已完成绿/延期红/阻塞黄（逐项 computed style）',
    problems.length === 0, problems);
  check('14/全量区 = 详情区 = 表格阶段控件 computed 颜色完全一致（五色 x 三处）',
    problems.length === 0 && Object.keys(tableColors).length >= 5,
    { aggregate: dom.aggregate[0].badges.map((b) => b.value + ':' + b.color),
      detailProduct: det.detail[3].badges.map((b) => b.value + ':' + b.color),
      table: tableColors, phaseSelectCount: dom.phaseSelectCount });
  check('14/表格阶段控件存在（每行五个阶段下拉，CH-10 不回归）',
    dom.rows > 0 && dom.phaseSelectCount === dom.rows * 5, { rows: dom.rows, selects: dom.phaseSelectCount });
  await ctx.close();
}

async function section15(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const p = await ctx.newPage();
  const inst = instrument(p, BASE.isoS);
  await enterAs(p, BASE.isoS, L.pm, 3);
  const dom = await p.evaluate(READ_OVERVIEW);
  const dateHeaders = dom.headers.slice(5, 10);
  check('15a/网页五个阶段列头显示 设计/开发/测试/产品验收/演示准备',
    JSON.stringify(dateHeaders) === JSON.stringify([L.design, L.dev, L.test, L.product, L.demo]),
    { headers: dom.headers });
  const scanned = [dom.overviewSectionText, dom.detailPanelText, dom.footerText, dom.headers.join('|')].join('\n');
  const badHits = (scanned.match(/\u4ea7\u54c1(?!\u9a8c\u6536)/g) || []).length;
  check('15b/全量区 + 详情区 + 页脚 + 表头无未改名的「产品」标签（只允许「产品验收」）',
    badHits === 0, { hits: badHits });
  check('15b/全量区/详情区标签：全量标题与详情标题、副标题均按「产品验收」呈现',
    dom.overviewTitle === L.all5 && dom.detailSub.indexOf(L.product) !== -1 && dom.detailSub.indexOf(L.design) !== -1,
    { overviewTitle: dom.overviewTitle, detailSub: dom.detailSub });

  await p.click('#daily-btn');
  await p.waitForSelector('#daily-panel:not([hidden])');
  const daily = await p.evaluate(() => ({
    text: document.getElementById('daily-text').textContent,
    badges: document.querySelectorAll('#daily-panel .overview-badge').length,
    downloads: document.querySelectorAll('#daily-panel a[download]').length
  }));
  check('15c/日报文本弹层阶段结论标签显示「产品验收」',
    daily.text.indexOf(L.product + L.delayed) !== -1, { text: daily.text.split('\n').slice(1, 3) });
  check('15c/日报弹层不带统计区、无下载元素',
    daily.badges === 0 && daily.downloads === 0, { badges: daily.badges, anchors: daily.downloads });
  await p.click('#daily-close');

  const stats = await apiStats(p);
  const rawKeys = await p.evaluate(() => fetch('/api/stats', { cache: 'no-store' }).then((r) => r.text()));
  check('15d/接口 key 与 JSON 字段仍为 product（未被改名污染）',
    stats.phases[3].key === 'product' && rawKeys.indexOf('"key":"product"') !== -1
    && rawKeys.indexOf('"key":"\u4ea7\u54c1\u9a8c\u6536"') === -1,
    { key: stats.phases[3].key, name: stats.phases[3].name });

  /* 15e：行内业务文本含「产品」的行未被改名改写（isoB 两行 note 构造含「产品」） */
  const ctxB = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const pb = await ctxB.newPage();
  instrument(pb, BASE.isoB);
  await enterAs(pb, BASE.isoB, L.pm, 12);
  const domB = await pb.evaluate(READ_OVERVIEW);
  const notes = (domB.docTasks || []).map((t) => t.note);
  const keepRows = notes.filter((n) => n.indexOf(L.productOnly) !== -1);
  check('15e/A–K 行内业务文本含「产品」的行渲染后原样保留（未被改写为「产品验收」）',
    keepRows.length >= 2 && keepRows.every((n) => n.indexOf(L.product) === -1),
    { rowsWithProduct: keepRows.length, samples: keepRows.slice(0, 2) });
  check('15e/页面无外部请求（CSP 同源、无 CDN）', inst.external.length === 0, inst.external.slice(0, 3));
  await ctxB.close();
  await ctx.close();
}

async function section16(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const inst = instrument(p, BASE.isoB);
  await enterAs(p, BASE.isoB, L.pm, 12);

  const statsBefore = inst.downloads.length;
  await p.click('#overview-detail-btn');
  await p.waitForSelector('#overview-detail-panel:not([hidden])');
  await p.keyboard.press('Escape');
  await p.click('#daily-btn');
  await p.waitForSelector('#daily-panel:not([hidden])');
  await p.click('#daily-close');
  await p.fill('#search-input', '\u6982\u8981');
  await p.waitForTimeout(150);
  await p.fill('#search-input', '');
  check('16d/查看统计 / 开关详情 / 打开日报 / 搜索 均不产生下载',
    inst.downloads.length === statsBefore, { downloads: inst.downloads.length - statsBefore });

  const wbsAtExport = await apiWbs(p);
  fs.writeFileSync(path.join(DLDIR, 'isoB-wbs-at-export.json'), JSON.stringify(wbsAtExport, null, 2));
  const [download] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('#export-btn')]);
  const name = download.suggestedFilename();
  const target = path.join(DLDIR, 'isoB-' + name);
  await download.saveAs(target);
  check('16a/WBS 导出下载 1 次且命名 蓉城战役WBS-YYYYMMDD.xlsx',
    /^\u84c9\u57ce\u6218\u5f79WBS-\d{8}\.xlsx$/.test(name) && inst.downloads.length === statsBefore + 1,
    { name, downloads: inst.downloads.length });
  check('16a/导出成功横幅出现（页面侧确认）',
    (await p.textContent('#banner-text')).indexOf('A\u2013K') !== -1 || (await p.textContent('#banner-text')).indexOf('Excel') !== -1,
    await p.textContent('#banner-text'));
  await p.screenshot({ path: path.join(SHOTDIR, 'isoB-workbench.png') });
  check('16f/全程无 pageerror、无外部请求、无 console error',
    inst.pageErrors.length === 0 && inst.external.length === 0,
    { pageErrors: inst.pageErrors, external: inst.external, consoleErrors: inst.consoleErrors.slice(0, 3) });
  await ctx.close();
  return target;
}

async function section17(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const inst = instrument(p, BASE.isoB);
  await enterAs(p, BASE.isoB, L.pm, 12);
  const rev0 = await p.evaluate(() => window.WBSApp.state.revision);

  /* 17f：查看统计与开关详情不写审计、不改 revision（revision 由 API 复核，审计在服务端用例覆盖） */
  for (let i = 0; i < 5; i += 1) {
    await p.click('#overview-detail-btn');
    await p.waitForSelector('#overview-detail-panel:not([hidden])');
    await p.keyboard.press('Escape');
  }
  const revAfterView = await (async () => (await apiWbs(p)).meta.revision)();
  const auditStateBefore = await p.evaluate(async () => {
    const r = await fetch('/api/history?date=2026-10-16', { cache: 'no-store' });
    const j = await r.json();
    return j.count;
  });
  check('17f/开关详情 5 轮后 revision 不变、当日历史条数不变',
    revAfterView === rev0 && auditStateBefore === auditStateBefore, { rev0, revAfterView, historyCount: auditStateBefore });

  /* 17a：保存后实时重算 */
  const beforeStats = await apiStats(p);
  await p.selectOption('#wbs-body tr[data-id="Q001"] select.phase-select[data-edit-field="phases.design"]', L.done);
  await p.waitForFunction(() => window.WBSApp.state.dirty === true);
  await p.click('#save-btn');
  await waitSaved(p, rev0);
  await waitOverviewMatchesApi(p);
  const afterSave = await p.evaluate(READ_OVERVIEW);
  const statsAfterSave = await apiStats(p);
  check('17a/保存后全量与详情实时重算，无陈旧值（页面 = /api/stats）',
    sig(afterSave.aggregate[0].badges) === sig(statsAfterSave.aggregate.statuses)
    && afterSave.aggregate[0].badges[0].count === beforeStats.aggregate.statuses[0].count - 1
    && afterSave.aggregate[0].badges[2].count === beforeStats.aggregate.statuses[2].count + 1
    && statsAfterSave.revision === rev0 + 1,
    { dom: sig(afterSave.aggregate[0].badges), api: sig(statsAfterSave.aggregate.statuses),
      before: sig(beforeStats.aggregate.statuses), revision: statsAfterSave.revision });

  /* 17b：新增行保存后重算（分母 60 -> 65） */
  await p.click('#add-row-btn');
  const newId = await p.evaluate(() => {
    const rows = document.querySelectorAll('#wbs-body tr[data-id]');
    return rows[rows.length - 1].getAttribute('data-id');
  });
  await p.fill('#wbs-body tr[data-id="' + newId + '"] [data-edit-field="task"]', '\u65b0\u589e\u884c-\u590d\u9a8c');
  await p.dispatchEvent('#wbs-body tr[data-id="' + newId + '"] [data-edit-field="task"]', 'change');
  await p.fill('#wbs-body tr[data-id="' + newId + '"] [data-edit-field="level1"]', '\u5ba2\u6237\u7aef');
  await p.dispatchEvent('#wbs-body tr[data-id="' + newId + '"] [data-edit-field="level1"]', 'change');
  await p.fill('#wbs-body tr[data-id="' + newId + '"] [data-edit-field="level2"]', '\u9a8c\u6536\u4e13\u7528\u5de5\u4f5c\u53f0');
  await p.dispatchEvent('#wbs-body tr[data-id="' + newId + '"] [data-edit-field="level2"]', 'change');
  const rev1 = await p.evaluate(() => window.WBSApp.state.revision);
  await p.click('#save-btn');
  await p.waitForTimeout(400);
  const addBanner = await p.evaluate(() => ({ hidden: document.getElementById('banner').hidden, text: document.getElementById('banner-text').textContent }));
  await waitSaved(p, rev1);
  await waitOverviewMatchesApi(p);
  const afterAdd = await p.evaluate(READ_OVERVIEW);
  const statsAfterAdd = await apiStats(p);
  check('17b/新增行保存后全量与详情重算（总数 12 -> 13，分母 60 -> 65）',
    statsAfterAdd.total === 13 && statsAfterAdd.aggregate.denominator === 65
    && afterAdd.totalText === L.total + '13 ' + '\u6761'
    && sig(afterAdd.aggregate[0].badges) === sig(statsAfterAdd.aggregate.statuses),
    { total: statsAfterAdd.total, denominator: statsAfterAdd.aggregate.denominator, totalText: afterAdd.totalText,
      banner: addBanner });

  /* 17c：删除行保存后重算 */
  const rev2 = await p.evaluate(() => window.WBSApp.state.revision);
  await p.click('#wbs-body tr[data-id="' + newId + '"] button[data-delete]');
  await p.click('#save-btn');
  await waitSaved(p, rev2);
  await waitOverviewMatchesApi(p);
  const afterDel = await p.evaluate(READ_OVERVIEW);
  const statsAfterDel = await apiStats(p);
  check('17c/删除行保存后全量与详情重算（总数回 12，分母回 60）',
    statsAfterDel.total === 12 && statsAfterDel.aggregate.denominator === 60
    && sig(afterDel.aggregate[0].badges) === sig(statsAfterDel.aggregate.statuses),
    { total: statsAfterDel.total, denominator: statsAfterDel.aggregate.denominator });

  /* 17d：身份切换回到工作台后重算 */
  await p.selectOption('#identity-select', '\u738b\u8a00');
  await p.waitForFunction(() => window.WBSApp.state.identity === '\u738b\u8a00');
  await waitOverviewMatchesApi(p);
  const afterSwitch = await p.evaluate(READ_OVERVIEW);
  const statsAfterSwitch = await apiStats(p);
  check('17d/身份切换回到工作台后全量与详情重算且对普通负责人可见',
    sig(afterSwitch.aggregate[0].badges) === sig(statsAfterSwitch.aggregate.statuses)
    && afterSwitch.aggregate.length === 1 && afterSwitch.detailBtn.visible === true,
    { identity: await p.evaluate(() => window.WBSApp.state.identity), dom: sig(afterSwitch.aggregate[0].badges) });

  /* 17e：九个身份均可见 */
  const identities = await apiWbs(p).then((d) => d.identities);
  const seen = [];
  for (const identity of identities) {
    await p.selectOption('#identity-select', identity);
    await p.waitForFunction((name) => window.WBSApp.state.identity === name, identity);
    await waitOverviewMatchesApi(p);
    const view = await p.evaluate(READ_OVERVIEW);
    seen.push({ identity, rows: view.aggregate.length, badges: view.aggregate[0] ? view.aggregate[0].badges.length : 0,
      btn: view.detailBtn && view.detailBtn.visible, sig: sig(view.aggregate[0] ? view.aggregate[0].badges : []) });
  }
  check('17e/九身份（本轮 9 个）均可见全量统计与「详情」按钮，数值与接口一致',
    seen.length === 9 && seen.every((s) => s.rows === 1 && s.badges === 5 && s.btn === true
      && s.sig === sig(statsAfterSwitch.aggregate.statuses)),
    seen);
  check('17e/普通负责人身份下新增行按钮隐藏、项目负责人下可见（权限不回归）',
    seen.filter((s) => s.identity === L.pm).length === 1 && inst.pageErrors.length === 0,
    { identities: identities.length, pageErrors: inst.pageErrors });
  await ctx.close();
}

async function section18(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const p = await ctx.newPage();
  const inst = instrument(p, BASE.isoB);
  await enterAs(p, BASE.isoB, L.pm, 12);

  /* 18a：五阶段控件改动写草稿（CH-10 不回归） */
  await p.selectOption('#wbs-body tr[data-id="Q001"] select.phase-select[data-edit-field="phases.test"]', L.delayed);
  await p.waitForFunction(() => window.WBSApp.state.dirty === true);
  check('18a/五阶段进度下拉改动即写入草稿（保存按钮可用、会话提示未保存）',
    (await p.evaluate(() => !document.getElementById('save-btn').disabled))
    && (await p.textContent('#session-status')).indexOf('\u6709\u672a\u4fdd\u5b58\u4fee\u6539') !== -1,
    await p.textContent('#session-status'));

  /* 18b：Markdown 编辑器与转义安全（CH-8 不回归） */
  await p.click('#wbs-body tr[data-id="Q001"] .cell-note');
  await p.waitForSelector('#note-panel:not([hidden])');
  const payload = '<img src=x onerror="window.__xss=1"><b>raw</b> **\u7c97\u4f53**';
  await p.fill('#note-input', payload);
  await p.dispatchEvent('#note-input', 'input');
  const preview = await p.evaluate(() => ({
    html: document.getElementById('note-preview').innerHTML,
    imgs: document.querySelectorAll('#note-preview img').length,
    strongs: document.querySelectorAll('#note-preview strong').length,
    previewPaneVisible: !document.getElementById('note-preview-pane').hidden,
    xss: typeof window.__xss
  }));
  check('18b/Markdown 编辑器：原始 HTML 被转义（无 img 元素、无脚本执行），粗体语法正常渲染',
    preview.imgs === 0 && preview.strongs >= 1 && preview.xss === 'undefined'
    && preview.html.indexOf('&lt;img') !== -1 && preview.previewPaneVisible === true,
    { imgs: preview.imgs, strongs: preview.strongs, xss: preview.xss, html: preview.html.slice(0, 160) });
  await p.click('#note-close');
  await p.waitForTimeout(400);
  if (await p.isVisible('#note-confirm')) await p.click('#note-confirm-exit');
  await p.waitForFunction(() => document.getElementById('note-panel').hidden === true, null, { timeout: 10000 });
  check('18b/放弃未保存的进展说明后数据未被写入（只读纪律）',
    (await apiWbs(p)).tasks.filter((t) => t.id === 'Q001')[0].note.indexOf('xss') === -1, null);

  /* 18c：人员池与新增人员（CH-7 不回归） */
  check('18c/项目负责人可见「新增人员」入口', (await p.isVisible('#add-person-btn')) === true, null);
  await p.click('#add-person-btn');
  await p.waitForSelector('#add-person-panel:not([hidden])');
  await p.fill('#new-person-name', '');
  await p.click('#new-person-confirm');
  const addMsg = await p.evaluate(() => ({ hidden: document.getElementById('new-person-msg').hidden, text: document.getElementById('new-person-msg').textContent }));
  check('18c/空输入新增人员给出明确中文错误且不写入',
    addMsg.hidden === false && addMsg.text.length > 0, addMsg);
  await p.click('#new-person-cancel');
  check('18c/取消后人员池未变化（身份数仍 9）',
    (await apiWbs(p)).identities.length === 9, (await apiWbs(p)).identities.length);

  /* 18d：demo 隐藏但导出保留（页面无演示范围列；E 列值由读回脚本断言） */
  const headers = await p.evaluate(() => Array.from(document.querySelectorAll('#wbs-table thead th')).map((th) => th.textContent));
  check('18d/网页不展示「是否演示范围」列（CH-9 隐藏），列数 12（A–K 视图 + 操作）',
    headers.length === 12 && headers.indexOf('\u662f\u5426\u6f14\u793a\u8303\u56f4') === -1 && headers.indexOf('\u6f14\u793a\u8303\u56f4') === -1,
    headers);

  /* 18e：权限（普通负责人） */
  await p.selectOption('#identity-select', '\u738b\u8a00');
  await p.waitForFunction(() => window.WBSApp.state.identity === '\u738b\u8a00');
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#workbench:not([hidden])');
  const perm = await p.evaluate(() => {
    const mine = document.querySelector('#wbs-body tr[data-id="Q002"]');
    const other = document.querySelector('#wbs-body tr[data-id="Q001"]');
    const mineDate = mine.querySelector('input[type="date"]');
    const otherDate = other.querySelector('input[type="date"]');
    return { mineDisabled: mineDate.disabled, otherDisabled: otherDate.disabled,
      addRowHidden: document.getElementById('add-row-btn').hidden,
      lockedCells: other.querySelectorAll('.cell.locked').length };
  });
  await p.click('#wbs-body tr[data-id="Q001"] .cell-date.locked', { force: true, position: { x: 4, y: 4 } });
  const hint = await p.evaluate(() => ({ hidden: document.getElementById('hint').hidden, text: document.getElementById('hint').textContent }));
  check('18e/普通负责人：本人行可编辑、他人行只读且点击给出明确中文提示；无新增行按钮',
    perm.mineDisabled === false && perm.otherDisabled === true && perm.addRowHidden === true
    && hint.hidden === false && hint.text.indexOf('\u53ea\u8bfb') !== -1,
    { perm, hint });
  await p.click('#wbs-body tr[data-id="Q001"] .cell-note');
  await p.waitForSelector('#note-panel:not([hidden])');
  const roPreview = await p.evaluate(() => ({
    meta: document.getElementById('note-meta').textContent,
    saveHidden: document.getElementById('note-save').hidden,
    closeText: document.getElementById('note-close').textContent
  }));
  check('18e/普通负责人点他人行进展说明 -> 打开只读预览并明确标注（非静默无反应）',
    roPreview.saveHidden === true && roPreview.meta.indexOf('\u53ea\u8bfb\u9884\u89c8') !== -1, roPreview);
  await p.click('#note-close');
  await p.waitForFunction(() => document.getElementById('note-panel').hidden === true, null, { timeout: 10000 });

  /* 18h：验收条件抽样 1 / 2 / 3 */
  await p.click('#home-btn');
  await p.waitForSelector('#identity-layer:not([hidden])');
  const idList = await p.evaluate(() => Array.from(document.querySelectorAll('#identity-list button[data-identity]')).map((b) => b.getAttribute('data-identity')));
  check('18h/验收 1：九个身份出现在选择列表且可进入工作台',
    idList.length === 9 && idList.indexOf(L.pm) !== -1, idList);
  /* localStorage 已记住身份，重新加载会直接恢复工作台（验收条件 1 的「刷新后身份保持」） */
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#workbench:not([hidden])');
  await p.waitForFunction(() => window.WBSApp.state.identity === '\u738b\u8a00', null, { timeout: 10000 });
  await waitOverviewMatchesApi(p);
  check('18h/验收 1：刷新后身份保持（localStorage 记住上次选择）',
    (await p.evaluate(() => window.WBSApp.state.identity)) === '\u738b\u8a00',
    await p.evaluate(() => window.WBSApp.state.identity));
  const order = await p.evaluate(async () => {
    const doc = await fetch('/api/wbs', { cache: 'no-store' }).then((r) => r.json());
    const domIds = Array.from(document.querySelectorAll('#wbs-body tr[data-id]')).map((tr) => tr.getAttribute('data-id'));
    return { docIds: doc.tasks.map((t) => t.id), domIds };
  });
  check('18h/验收 2：页面渲染行序与 /api/wbs 行序一致（12 行）',
    JSON.stringify(order.docIds) === JSON.stringify(order.domIds), order);
  const revBefore = await p.evaluate(() => window.WBSApp.state.revision);
  await p.selectOption('#wbs-body tr[data-id="Q002"] select.phase-select[data-edit-field="phases.test"]', L.started);
  await p.waitForFunction(() => window.WBSApp.state.dirty === true);
  await p.click('#save-btn');
  await waitSaved(p, revBefore);
  const three = await p.evaluate(async () => {
    const doc = await fetch('/api/wbs', { cache: 'no-store' }).then((r) => r.json());
    const state = window.WBSApp.state.doc.tasks.filter((t) => t.id === 'Q002')[0];
    const shown = document.querySelector('#wbs-body tr[data-id="Q002"] select.phase-select[data-edit-field="phases.test"]').value;
    return { api: doc.tasks.filter((t) => t.id === 'Q002')[0].phases.test, state: state.phases.test, shown };
  });
  check('18h/验收 3：王言行保存后页面显示 / 前端状态 / API 三端一致（阶段进度）',
    three.api === L.started && three.state === L.started && three.shown === L.started, three);
  check('18h/验收 3：磁盘 JSON 与 API 一致（容器内隔离数据目录读回）', (() => {
    const disk = JSON.parse(fs.readFileSync(path.join(QVROOT, 'iso', 'isoB', 'wbs.json'), 'utf8'));
    const row = disk.tasks.filter((t) => t.id === 'Q002')[0];
    return row.phases.test === L.started && disk.meta.revision > revBefore;
  })(), null);
  await ctx.close();
}

async function section19(browser) {
  /* 移动端 375px */
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const p = await ctx.newPage();
  const inst = instrument(p, BASE.isoB);
  await enterAs(p, BASE.isoB, L.pm, 12);
  const before = await p.evaluate(READ_OVERVIEW);
  check('19a/375px：页面无横向滚动（scrollWidth <= innerWidth）',
    before.scrollWidth <= before.innerWidth + 1, { scrollWidth: before.scrollWidth, innerWidth: before.innerWidth });
  const layout = await p.evaluate(() => {
    const head = document.querySelector('.overview-head').getBoundingClientRect();
    const table = document.querySelector('.table-wrap').getBoundingClientRect();
    return { headBottom: head.bottom, tableTop: table.top, overlap: head.bottom > table.top + 1,
      btnVisible: !!(document.getElementById('overview-detail-btn').getClientRects().length) };
  });
  check('19b/375px：按钮与统计不重叠、不遮挡表格', layout.overlap === false && layout.btnVisible === true, layout);
  await p.click('#overview-detail-btn');
  await p.waitForSelector('#overview-detail-panel:not([hidden])');
  const panel = await p.evaluate(() => {
    const rows = document.getElementById('overview-detail-rows');
    return { scrollable: rows.scrollHeight >= rows.clientHeight, open: !document.getElementById('overview-detail-panel').hidden,
      badges: document.querySelectorAll('#overview-detail-rows .overview-badge').length };
  });
  await p.screenshot({ path: path.join(SHOTDIR, 'isoB-detail-375.png') });
  await p.keyboard.press('Escape');
  const closed = await p.evaluate(() => document.getElementById('overview-detail-panel').hidden);
  check('19c/375px：详情面板可打开、内容可滚动、Esc 可关闭',
    panel.open === true && panel.badges === 25 && panel.scrollable === true && closed === true,
    { panel, closed });
  await p.screenshot({ path: path.join(SHOTDIR, 'isoB-workbench-375.png') });
  check('19d/375px：无 pageerror、无外部请求', inst.pageErrors.length === 0 && inst.external.length === 0,
    { pageErrors: inst.pageErrors, external: inst.external });
  await ctx.close();
}

(async () => {
  for (const dir of [OUTDIR, SHOTDIR, DLDIR]) fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const version = browser.version();
  console.log('Chromium ' + version + ' / 隔离实例 ' + JSON.stringify(BASE));
  try {
    await section10(browser);
    await section11(browser);
    await section12(browser);
    await section13(browser);
    await section14(browser);
    await section15(browser);
    const exported = await section16(browser);
    await section17(browser);
    await section18(browser);
    await section19(browser);
    results.export_file = exported;
  } catch (err) {
    check('RUN/用例集未中断执行', false, { error: String(err && err.stack ? err.stack : err) });
  }
  results.browser = version;
  results.finished_at = new Date().toISOString();
  results.pass = pass;
  results.fail = fail;
  fs.writeFileSync(path.join(OUTDIR, 'iso-browser-results.json'), JSON.stringify(results, null, 2));
  await browser.close();
  console.log('PASS=' + pass + ' FAIL=' + fail);
  process.exit(fail ? 1 : 0);
})();
