'use strict';
/* YUNZ-38 / Stage18：现场（4180）真实浏览器**只读**交互与外观断言。
   只读纪律：不点击任何写入口（保存/新增/删除/新增人员），断言全程 0 次 PUT；
   浏览器只在官方 playwright 容器内运行；截图与结果只落本 stage18 目录。 */
const fs = require('fs');
const path = require('path');
const TOOLS = process.env.TOOLS || '/tools';
const { chromium } = require(path.join(TOOLS, 'node_modules', 'playwright'));
const BASE = process.env.BASE || 'http://127.0.0.1:4180';
const OUTDIR = process.env.OUTDIR || '/qv/results';
const SHOTDIR = process.env.SHOTDIR || '/qv/shots';
const STATUSES = ['未开始', '已开始', '已完成', '延期', '阻塞'];
const PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep'];
const COLOR = {
  '未开始': 'rgb(158, 158, 158)', '已开始': 'rgb(47, 128, 237)',
  '已完成': 'rgb(39, 174, 96)', '延期': 'rgb(231, 76, 60)', '阻塞': 'rgb(255, 212, 0)',
};
const results = { base: BASE, checks: [], page_errors: [], requests: [], writes: [], downloads: [] };
let pass = 0, fail = 0;
function check(id, ok, detail) {
  results.checks.push({ id, ok: !!ok, detail: detail === undefined ? null : detail });
  if (ok) { pass += 1; console.log('PASS  ' + id + (detail !== undefined ? '  :: ' + JSON.stringify(detail) : '')); }
  else { fail += 1; console.log('FAIL  ' + id + '  -> ' + JSON.stringify(detail)); }
}
async function enterAs(page, name) {
  const layerVisible = await page.locator('#identity-layer').isVisible().catch(() => false);
  if (layerVisible) await page.locator('#identity-list button[data-identity="' + name + '"]').first().click();
  else await page.selectOption('#identity-select', String(name));
  await page.waitForTimeout(500);
}
async function readOverview(page) {
  return page.evaluate(function () {
    var rows = Array.from(document.querySelectorAll('#overview-rows .overview-row')).map(function (r) {
      return {
        phase: r.getAttribute('data-phase'),
        label: (r.querySelector('.overview-phase') || {}).textContent,
        badges: Array.from(r.querySelectorAll('.overview-badge')).map(function (b) {
          return { status: b.getAttribute('data-status'), count: b.getAttribute('data-count'),
                   pct: b.getAttribute('data-percentage'),
                   text: (b.innerText || '').replace(/\s+/g, ' ').trim(),
                   bg: getComputedStyle(b).backgroundColor };
        }),
      };
    });
    var ov = document.getElementById('phase-overview');
    return { visible: !!(ov && ov.offsetParent !== null), rows: rows,
             total: (document.getElementById('overview-total') || {}).textContent,
             buttons: ov ? ov.querySelectorAll('button').length : -1 };
  });
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => results.page_errors.push(String((e && e.message) || e)));
  page.on('request', (r) => {
    results.requests.push({ url: r.url(), method: r.method() });
    if (r.method() !== 'GET' && r.method() !== 'HEAD') results.writes.push({ url: r.url(), method: r.method() });
  });
  page.on('download', (d) => results.downloads.push(d.suggestedFilename()));

  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const revBefore = (await page.evaluate(async () => (await (await fetch('/api/health')).json()).revision));
  await enterAs(page, '项目负责人');

  const ov = await readOverview(page);
  const apiStats = await page.evaluate(async () => (await (await fetch('/api/stats', { cache: 'no-store' })).json()));
  const apiWbs = await page.evaluate(async () => (await (await fetch('/api/wbs', { cache: 'no-store' })).json()));
  fs.writeFileSync(path.join(OUTDIR, 'live-stats.json'), JSON.stringify(apiStats, null, 2));
  fs.writeFileSync(path.join(OUTDIR, 'live-overview-dom.json'),
    JSON.stringify({ overview: ov, revision: apiStats.revision, total: apiStats.total }, null, 2));

  check('LIVEB-01 现场顶部总览条可见且常驻（5 行，data-phase 顺序正确）',
    ov.visible && ov.rows.length === 5 && JSON.stringify(ov.rows.map((r) => r.phase)) === JSON.stringify(PHASE_KEYS),
    { visible: ov.visible, rows: ov.rows.map((r) => r.phase) });
  check('LIVEB-02 现场每行阶段名 + 5 徽标，无跨阶段合并行，无手动刷新按钮',
    ov.rows.every((r) => r.badges.length === 5 && r.label.length > 0) && ov.buttons === 0,
    { counts: ov.rows.map((r) => r.badges.length), buttons: ov.buttons });
  let diff = [];
  for (let i = 0; i < 5; i += 1) {
    const ph = apiStats.phases[i], row = ov.rows[i];
    if (row.phase !== ph.key || row.label !== ph.name) diff.push({ at: 'phase', got: row.phase, exp: ph.key });
    for (let j = 0; j < 5; j += 1) {
      const st = ph.statuses[j], b = row.badges[j];
      if (!b || b.status !== st.value || b.count !== String(st.count) || b.pct !== st.percentage.toFixed(1) ||
          b.text !== st.value + ' ' + st.count + ' ' + st.percentage.toFixed(1) + '%') {
        diff.push({ at: ph.key + '/' + st.value, got: b, exp: st });
      }
    }
  }
  check('LIVEB-03 现场 DOM 显示值与 /api/stats 逐项完全一致（含四舍五入结果）', diff.length === 0, diff.length ? diff : 'all 25 match');
  check('LIVEB-04 /api/stats 与 /api/wbs 同源（total == 任务数、revision == meta.revision）',
    apiStats.total === apiWbs.tasks.length && apiStats.revision === apiWbs.meta.revision,
    { total: apiStats.total, tasks: apiWbs.tasks.length, rev: apiStats.revision });
  let sums = apiStats.phases.map((p) => +p.statuses.reduce((a, s) => a + s.percentage, 0).toFixed(1));
  check('LIVEB-05 现场各阶段五项合计恰为 100.0%', sums.every((s) => s === 100.0), sums);
  check('LIVEB-06 现场合计文本 ==「共 N 条」', ov.total === '共 ' + apiStats.total + ' 条', { got: ov.total });

  /* 五色 */
  const badgeColors = {};
  ov.rows.forEach((r) => r.badges.forEach((b) => { badgeColors[b.status] = b.bg; }));
  const selColors = await page.evaluate(function (statuses) {
    var out = {};
    statuses.forEach(function (s) {
      var el = document.querySelector('#wbs-body select.phase-select.phase-' + s);
      if (el) out[s] = getComputedStyle(el).backgroundColor;
    });
    return out;
  }, STATUSES);
  check('LIVEB-07 现场五种状态徽标 computed 颜色 == 五色映射且与表格阶段控件一致',
    STATUSES.every((s) => badgeColors[s] === COLOR[s] && (selColors[s] === undefined || selColors[s] === badgeColors[s])),
    { badge: badgeColors, select: selColors });

  /* 全部身份可见同一只读总览 */
  const identities = apiWbs.identities;
  const texts = {};
  let allVisible = true;
  for (const id of identities) {
    await enterAs(page, id);
    const o = await readOverview(page);
    if (!o.visible || o.rows.length !== 5) allVisible = false;
    texts[id] = o.rows.map((r) => r.badges.map((b) => b.count + '/' + b.pct).join(',')).join('|');
  }
  const uniq = Array.from(new Set(Object.keys(texts).map((k) => texts[k])));
  check('LIVEB-08 现场全部身份（' + identities.length + ' 个，含项目负责人与普通负责人）均看到同一只读总览',
    allVisible && uniq.length === 1 && identities.length >= 9,
    { identities: identities.length, distinct: uniq.length });

  /* 权限矩阵抽样（只读观察，不触发写） */
  await enterAs(page, '项目负责人');
  const pm = await page.evaluate(() => ({
    addRow: !document.getElementById('add-row-btn').hidden,
    addPerson: !document.getElementById('add-person-btn').hidden,
    del: document.querySelectorAll('#wbs-body button[data-delete]').length,
  }));
  await enterAs(page, identities[1]);
  const other = await page.evaluate(() => ({
    addRow: !document.getElementById('add-row-btn').hidden,
    addPerson: !document.getElementById('add-person-btn').hidden,
    del: document.querySelectorAll('#wbs-body button[data-delete]').length,
    lockedCells: document.querySelectorAll('#wbs-body td.locked').length,
    editableCells: document.querySelectorAll('#wbs-body td.editable').length,
  }));
  check('LIVEB-09 现场权限矩阵不回归：项目负责人可增删，普通负责人无增删入口',
    pm.addRow && pm.addPerson && pm.del > 0 && !other.addRow && !other.addPerson && other.del === 0,
    { pm, other: { addRow: other.addRow, addPerson: other.addPerson, del: other.del } });

  await page.screenshot({ path: path.join(SHOTDIR, 'live-workbench-1600.png') });
  const revAfter = (await page.evaluate(async () => (await (await fetch('/api/health')).json()).revision));
  check('LIVEB-10 现场只读浏览不改变 revision（页面加载 + 查看总览）',
    revBefore === revAfter && revAfter === apiStats.revision, { revBefore, revAfter, statsRev: apiStats.revision });

  await context.close();

  /* 375px */
  {
    const c = await browser.newContext({ viewport: { width: 375, height: 780 }, isMobile: true, hasTouch: true });
    const p = await c.newPage();
    p.on('request', (r) => { results.requests.push({ url: r.url(), method: r.method() }); if (r.method() !== 'GET' && r.method() !== 'HEAD') results.writes.push({ url: r.url(), method: r.method() }); });
    await p.goto(BASE + '/', { waitUntil: 'load' });
    await p.waitForTimeout(500);
    await enterAs(p, '项目负责人');
    const m = await p.evaluate(function () {
      var de = document.documentElement;
      var ov = document.getElementById('phase-overview').getBoundingClientRect();
      var table = document.getElementById('wbs-table').getBoundingClientRect();
      var badges = Array.from(document.querySelectorAll('.overview-badge'));
      var overflow = badges.filter(function (b) {
        var r = b.getBoundingClientRect();
        return r.right > de.clientWidth + 1 || r.left < -1;
      }).map(function (b) { return (b.innerText || '').replace(/\s+/g, ' ').trim(); });
      return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, body: document.body.scrollWidth,
               overviewBottom: Math.round(ov.bottom), tableTop: Math.round(table.top),
               overflowBadges: overflow, rows: document.querySelectorAll('#overview-rows .overview-row').length };
    });
    check('LIVEB-11 现场 375px 无横向页面滚动（html/body scrollWidth <= clientWidth）',
      m.scrollWidth <= m.clientWidth && m.body <= m.clientWidth,
      { scrollWidth: m.scrollWidth, clientWidth: m.clientWidth, body: m.body });
    check('LIVEB-12 现场 375px 徽标不溢出视口、不遮挡表格、五阶段仍各成一组',
      m.overflowBadges.length === 0 && m.overviewBottom <= m.tableTop && m.rows === 5,
      { overflowBadges: m.overflowBadges, overviewBottom: m.overviewBottom, tableTop: m.tableTop });
    await p.screenshot({ path: path.join(SHOTDIR, 'live-workbench-375.png') });
    await c.close();
  }

  /* 只读纪律与外部请求 */
  const external = results.requests.filter((r) => !r.url.startsWith(BASE) && !r.url.startsWith('data:'));
  check('LIVEB-13 现场全程只读：0 次非 GET/HEAD 请求（无 PUT/POST/DELETE）', results.writes.length === 0, results.writes);
  check('LIVEB-14 现场全程无外部请求、0 次新增下载', external.length === 0 && results.downloads.length === 0,
    { external: external.slice(0, 5), downloads: results.downloads });
  check('LIVEB-15 现场全程无 pageerror', results.page_errors.length === 0, results.page_errors.slice(0, 3));

  fs.writeFileSync(path.join(OUTDIR, 'live-browser-results.json'),
    JSON.stringify(Object.assign({}, results, { pass, fail }), null, 2));
  await browser.close();
  console.log('\n[live-browser] PASS=' + pass + ' FAIL=' + fail);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => { console.error('FATAL', err); process.exit(2); });
