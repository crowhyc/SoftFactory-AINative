'use strict';
/* YUNZ-40 / Stage20 独立复验：运行现场（0.0.0.0:4180，live 数据）真实浏览器只读取证。
   只读：只看统计 / 开关详情 / 打开日报 / 切换身份（仅 localStorage），不保存、不新增、不删除。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(process.env.TOOLS || '/tools', 'node_modules', 'playwright'));

const BASE = process.env.LIVE_BASE || 'http://127.0.0.1:4180';
const OUTDIR = process.env.OUTDIR || '/qv/results';
const SHOTDIR = process.env.SHOTDIR || '/qv/shots';
const L = {
  notStarted: '\u672a\u5f00\u59cb', started: '\u5df2\u5f00\u59cb', done: '\u5df2\u5b8c\u6210',
  delayed: '\u5ef6\u671f', blocked: '\u963b\u585e',
  design: '\u8bbe\u8ba1', dev: '\u5f00\u53d1', test: '\u6d4b\u8bd5',
  product: '\u4ea7\u54c1\u9a8c\u6536', demo: '\u6f14\u793a\u51c6\u5907',
  all5: '\u5168\u90e8\u4e94\u9636\u6bb5\u5408\u5e76', detail: '\u8be6\u60c5', pm: '\u9879\u76ee\u8d1f\u8d23\u4eba'
};
const STATUSES = [L.notStarted, L.started, L.done, L.delayed, L.blocked];
const PHASE_LABELS = { design: L.design, dev: L.dev, test: L.test, product: L.product, demo_prep: L.demo };
const COLOR = {
  [L.notStarted]: 'rgb(158, 158, 158)', [L.started]: 'rgb(47, 128, 237)',
  [L.done]: 'rgb(39, 174, 96)', [L.delayed]: 'rgb(231, 76, 60)', [L.blocked]: 'rgb(255, 212, 0)'
};

let pass = 0;
let fail = 0;
const checks = [];
const check = (id, ok, detail) => {
  checks.push({ id, ok: !!ok, detail: detail === undefined ? null : detail });
  if (ok) { pass += 1; console.log('PASS  ' + id + (detail === undefined ? '' : '  :: ' + JSON.stringify(detail, null, 0))); }
  else { fail += 1; console.log('FAIL  ' + id + '  -> ' + JSON.stringify(detail, null, 0)); }
};
const t10 = (v) => Math.round(Number(v) * 10);
const sig = (items) => items.map((b) => b.value + '=' + b.count + '/' +
  t10(b.percentage === undefined ? b.pct : b.percentage)).join(',');

const READ = () => {
  const rowsOf = (sel) => Array.from(document.querySelectorAll(sel + ' .overview-row')).map((row) => ({
    key: row.getAttribute('data-phase'),
    label: (row.querySelector('.overview-phase') || {}).textContent || '',
    badges: Array.from(row.querySelectorAll('.overview-badge')).map((b) => ({
      value: b.getAttribute('data-status'), text: b.textContent,
      count: Number(b.getAttribute('data-count')), pct: Number(b.getAttribute('data-percentage')),
      color: getComputedStyle(b).backgroundColor
    }))
  }));
  return {
    aggregate: rowsOf('#overview-rows'),
    detail: rowsOf('#overview-detail-rows'),
    totalText: document.getElementById('overview-total').textContent,
    detailOpen: !document.getElementById('overview-detail-panel').hidden,
    headers: Array.from(document.querySelectorAll('#wbs-table thead th')).map((th) => th.textContent),
    rows: document.querySelectorAll('#wbs-body tr[data-id]').length,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    tableColors: Array.from(document.querySelectorAll('#wbs-body select.phase-select')).reduce((acc, sel) => {
      if (!acc[sel.value]) acc[sel.value] = getComputedStyle(sel).backgroundColor;
      return acc;
    }, {}),
    revision: window.WBSApp.state.revision,
    identity: window.WBSApp.state.identity
  };
};

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const version = browser.version();
  const external = [];
  const pageErrors = [];
  const downloads = [];
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    if (!url.startsWith(new URL(BASE).origin)) external.push(url);
  });
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  page.on('dialog', (d) => d.accept());

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#identity-list button[data-identity]');
  const identities = await page.evaluate(() => Array.from(document.querySelectorAll('#identity-list button[data-identity]')).map((b) => b.getAttribute('data-identity')));
  await page.click('#identity-list button[data-identity="' + L.pm + '"]');
  await page.waitForSelector('#workbench:not([hidden])');
  await page.waitForFunction(() => document.querySelectorAll('#overview-rows .overview-badge').length === 5, null, { timeout: 20000 });
  const stats = await page.evaluate(() => fetch('/api/stats', { cache: 'no-store' }).then((r) => r.json()));
  const dom = await page.evaluate(READ);

  check('20a/现场 12 身份齐备且可进入工作台', identities.length === 12 && identities.indexOf(L.pm) !== -1, identities);
  check('20a/现场顶部只有一组全量统计（CH-14 五段分行不存在）',
    dom.aggregate.length === 1 && dom.aggregate[0].key === 'aggregate' && dom.aggregate[0].label === L.all5,
    { rows: dom.aggregate.length, label: dom.aggregate[0] && dom.aggregate[0].label });
  check('20a/现场全量区五种状态齐显且与 /api/stats.aggregate 逐项一致（含 0 项状态显示 0 0.0%）',
    sig(dom.aggregate[0].badges) === sig(stats.aggregate.statuses)
    && dom.aggregate[0].badges[4].count === stats.aggregate.statuses[4].count
    && dom.aggregate[0].badges[4].text === L.blocked + ' ' + stats.aggregate.statuses[4].count + ' 0.0%',
    { dom: sig(dom.aggregate[0].badges), api: sig(stats.aggregate.statuses), total: stats.total,
      denominator: stats.aggregate.denominator });
  check('20a/现场分母 = 任务总数 x 5 且页面提示一致',
    stats.aggregate.denominator === stats.total * 5
    && dom.aggregate[0].badges.reduce((s, b) => s + b.count, 0) === stats.total * 5,
    { total: stats.total, denominator: stats.aggregate.denominator,
      domSum: dom.aggregate[0].badges.reduce((s, b) => s + b.count, 0) });
  check('20a/现场总数文案与渲染行数一致', dom.totalText === '\u5171 ' + stats.total + ' \u6761' && dom.rows === stats.total,
    { totalText: dom.totalText, rows: dom.rows, apiTotal: stats.total });

  await page.screenshot({ path: path.join(SHOTDIR, 'live-workbench-1600.png') });
  await page.click('#overview-detail-btn');
  await page.waitForSelector('#overview-detail-panel:not([hidden])');
  const detail = await page.evaluate(READ);
  check('20b/现场详情面板：五阶段五行、标签按「产品验收」、数值与 /api/stats.phases 逐项一致',
    detail.detail.length === 5 && detail.detail.map((r) => r.key).join(',') === 'design,dev,test,product,demo_prep'
    && detail.detail.map((r) => r.label).join(',') === Object.keys(PHASE_LABELS).map((k) => PHASE_LABELS[k]).join(',')
    && detail.detail.every((row, i) => sig(row.badges) === sig(stats.phases[i].statuses)),
    { labels: detail.detail.map((r) => r.label), detail: detail.detail.map((r) => sig(r.badges)) });
  await page.screenshot({ path: path.join(SHOTDIR, 'live-detail-1600.png') });
  await page.keyboard.press('Escape');
  check('20b/现场 Esc 可关闭详情面板', (await page.evaluate(READ)).detailOpen === false, null);

  check('20c/现场五列头显示「产品验收」且无未改名的「产品」标签',
    JSON.stringify(dom.headers.slice(5, 10)) === JSON.stringify([L.design, L.dev, L.test, L.product, L.demo]),
    dom.headers);
  const problems = [];
  STATUSES.forEach((status, i) => {
    const agg = dom.aggregate[0].badges[i].color;
    const table = dom.tableColors[status];
    if (agg !== COLOR[status]) problems.push('aggregate ' + status + '=' + agg);
    if (table && table !== COLOR[status]) problems.push('table ' + status + '=' + table);
    detail.detail.forEach((row) => { if (row.badges[i].color !== COLOR[status]) problems.push('detail ' + status + '=' + row.badges[i].color); });
  });
  check('20c/现场五色（全量区 / 详情区 / 表格阶段控件）computed 颜色一致',
    problems.length === 0, problems);

  const revBefore = await page.evaluate(() => fetch('/api/wbs', { cache: 'no-store' }).then((r) => r.json()).then((d) => d.meta.revision));
  for (let i = 0; i < 5; i += 1) {
    await page.click('#overview-detail-btn');
    await page.waitForSelector('#overview-detail-panel:not([hidden])');
    await page.keyboard.press('Escape');
  }
  await page.click('#daily-btn');
  await page.waitForSelector('#daily-panel:not([hidden])');
  const daily = await page.evaluate(() => ({ text: document.getElementById('daily-text').textContent,
    badges: document.querySelectorAll('#daily-panel .overview-badge').length }));
  await page.click('#daily-close');
  const revAfter = await page.evaluate(() => fetch('/api/wbs', { cache: 'no-store' }).then((r) => r.json()).then((d) => d.meta.revision));
  check('20d/现场只读：查看统计 / 开关详情 5 轮 / 打开日报 后 revision 不变、无下载',
    revBefore === revAfter && downloads.length === 0 && daily.badges === 0,
    { revBefore, revAfter, downloads, dailyBadges: daily.badges });
  check('20d/现场日报弹层文本（不含统计区）',
    daily.badges === 0, { text: daily.text.split('\n').slice(0, 2) });

  /* 375px */
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(400);
  const narrow = await page.evaluate(READ);
  check('20e/现场 375px：无横向页面滚动，全量区仍为单组五徽标',
    narrow.scrollWidth <= narrow.innerWidth + 1 && narrow.aggregate.length === 1
    && narrow.aggregate[0].badges.length === 5,
    { scrollWidth: narrow.scrollWidth, innerWidth: narrow.innerWidth });
  await page.click('#overview-detail-btn');
  await page.waitForSelector('#overview-detail-panel:not([hidden])');
  await page.screenshot({ path: path.join(SHOTDIR, 'live-detail-375.png') });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(SHOTDIR, 'live-workbench-375.png') });
  check('20e/现场 375px：详情可开可关', (await page.evaluate(READ)).detailOpen === false, null);

  check('20f/现场全程无 pageerror、无外部请求、无附带下载',
    pageErrors.length === 0 && external.length === 0 && downloads.length === 0,
    { pageErrors, external, downloads });

  const out = { browser: version, base: BASE, started_at: new Date().toISOString(), checks, pass, fail };
  fs.writeFileSync(path.join(OUTDIR, 'live-browser-results.json'), JSON.stringify(out, null, 2));
  await browser.close();
  console.log('PASS=' + pass + ' FAIL=' + fail);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.log('FAIL  RUN/现场用例集未中断执行  -> ' + JSON.stringify(String(err && err.stack ? err.stack : err)));
  process.exit(1);
});
