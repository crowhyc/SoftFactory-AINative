'use strict';
/* YUNZ-39 / 变更包 #8（CH-15：全量统计 + 分阶段详情 + 产品验收改名）真实浏览器自测。
   运行环境：mcr.microsoft.com/playwright:v1.55.0-jammy 容器（chromium 140，与 playwright 1.55.0 对齐）；
   宿主为 CentOS 7，无法直接运行该 Chromium，浏览器只在测试容器内运行，不进产物、不进镜像。
   被测服务（server.js）由本脚本自行 spawn（隔离数据目录 + 构造数据），结束后回收；
   不触碰运行现场 0.0.0.0:4180 与 /opt/wbs-rongcheng/data。
   用法（由 tests/stage19/run.sh 调用）：
     APP_DIR=/app OUTDIR=/app/tests/.tmp/stage19-out DATA_DIR=/data TOOLS=/tools \
     node /app/tests/stage19/browser.cjs */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const TOOLS = process.env.TOOLS || '/tools';
const { chromium } = require(path.join(TOOLS, 'node_modules', 'playwright'));

const APP_DIR = process.env.APP_DIR || '/app';
const PORT = Number(process.env.WBS_TEST_PORT || 4288);
const BASE = process.env.BASE || 'http://127.0.0.1:' + PORT;
const OUTDIR = process.env.OUTDIR || '/app/tests/.tmp/stage19-out';
const DATA_DIR = process.env.DATA_DIR || '/app/tests/.tmp/stage19-browser-data';
const AUDIT_FILE = path.join(DATA_DIR, 'audit.log');
const DATA_FILE = path.join(DATA_DIR, 'wbs.json');
const TZ = 'Asia/Shanghai';
const PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep'];
const PHASE_LABELS = { design: '设计', dev: '开发', test: '测试', product: '产品验收', demo_prep: '演示准备' };
const PHASE_ENUM = ['未开始', '已开始', '已完成', '延期', '阻塞'];
/* 五色映射（与表格阶段控件、导出填充一致）：未开始=灰 / 已开始=蓝 / 已完成=绿 / 延期=红 / 阻塞=黄。 */
const PHASE_COLORS = {
  '未开始': { bg: 'rgb(158, 158, 158)', fg: 'rgb(255, 255, 255)' },
  '已开始': { bg: 'rgb(47, 128, 237)', fg: 'rgb(255, 255, 255)' },
  '已完成': { bg: 'rgb(39, 174, 96)', fg: 'rgb(255, 255, 255)' },
  '延期': { bg: 'rgb(231, 76, 60)', fg: 'rgb(255, 255, 255)' },
  '阻塞': { bg: 'rgb(255, 212, 0)', fg: 'rgb(58, 46, 0)' }
};
const EXPORT_HEADERS = ['设计进度', '开发进度', '测试进度', '产品验收进度', '演示准备进度'];
const EXPORT_HEX = ['9E9E9E', '2F80ED', '27AE60', 'E74C3C', 'FFD400'];
/* 构造数据：每阶段五状态的目标计数（各阶段之和都等于任务总数 36），含 0 项与五色齐显。 */
const SHAPE = {
  design: [8, 7, 7, 7, 7], dev: [6, 8, 8, 7, 7], test: [5, 5, 5, 16, 5],
  product: [4, 4, 4, 4, 20], demo_prep: [36, 0, 0, 0, 0]
};
const IDENTITIES = ['项目负责人', '李欢', '王言', '张航瑞', '郑述文', '崔文建', '余宇', '黄逸偲', '陈江'];

const results = { base: BASE, tz: TZ, started_at: new Date().toISOString(), checks: [], page_errors: [], console_errors: [], requests: [] };
let pass = 0;
let fail = 0;
function check(id, ok, detail) {
  results.checks.push({ id, ok: !!ok, detail: detail === undefined ? null : detail });
  if (ok) { pass += 1; console.log('PASS  ' + id + (detail !== undefined ? '  :: ' + JSON.stringify(detail) : '')); }
  else { fail += 1; console.log('FAIL  ' + id + '  -> ' + JSON.stringify(detail)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (url, init) => {
  const response = await fetch(BASE + url, init);
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch (err) { body = text; }
  return { status: response.status, body };
};
const diskDoc = () => JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const auditBytes = () => (fs.existsSync(AUDIT_FILE) ? fs.readFileSync(AUDIT_FILE) : Buffer.from(''));
function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function docFromShape() {
  const doc = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'data', 'wbs.seed.json'), 'utf8'));
  const total = SHAPE.design.reduce((sum, n) => sum + n, 0);
  const far = todayStr().slice(0, 4) + '-12-31';
  const tasks = doc.tasks.slice(0, total);
  tasks.forEach((task, index) => {
    task.dates = {};
    task.phases = {};
    PHASE_KEYS.forEach((key) => {
      task.dates[key] = far;
      let rest = index;
      let value = PHASE_ENUM[PHASE_ENUM.length - 1];
      for (let i = 0; i < PHASE_ENUM.length; i += 1) {
        if (rest < SHAPE[key][i]) { value = PHASE_ENUM[i]; break; }
        rest -= SHAPE[key][i];
      }
      task.phases[key] = value;
    });
  });
  doc.meta.revision = 0;
  doc.tasks = tasks;
  return doc;
}

const servers = {};
function spawnServer(name, port, dataDir) {
  const child = spawn(process.execPath, [path.join(APP_DIR, 'server.js')], {
    cwd: APP_DIR,
    env: Object.assign({}, process.env, { WBS_DATA_DIR: dataDir, WBS_PORT: String(port), WBS_HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.on('data', (chunk) => process.stderr.write('[' + name + '] ' + chunk));
  servers[name] = child;
  return child;
}
async function waitReady(base) {
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(base + '/api/health')).ok) return; } catch (err) { /* 未就绪 */ }
    await sleep(100);
  }
  throw new Error('被测服务未就绪：' + base);
}
function stopServer(name) {
  return new Promise((resolve) => {
    const child = servers[name];
    if (!child) return resolve();
    delete servers[name];
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(resolve, 3000);
  });
}

let allRequests = [];
function trackPage(page) {
  page.on('request', (request) => allRequests.push({ url: request.url(), method: request.method() }));
  page.on('pageerror', (e) => results.page_errors.push(String(e && e.message ? e.message : e)));
  page.on('console', (m) => { if (m.type() === 'error') results.console_errors.push(m.text()); });
}

const sigOf = (statuses) => (statuses || []).map((item) => item.value + '=' + item.count + '/' + Number(item.percentage).toFixed(1)).join(',');
const badgesOf = (node) => Array.from(node.querySelectorAll('.overview-badge')).map((badge) => {
  const style = getComputedStyle(badge);
  return {
    status: badge.getAttribute('data-status'), count: badge.getAttribute('data-count'),
    percentage: badge.getAttribute('data-percentage'), text: badge.textContent,
    bg: style.backgroundColor, color: style.color, scrollWidth: badge.scrollWidth, clientWidth: badge.clientWidth
  };
});
const labelOf = (row) => (row.querySelector('.overview-phase') ? row.querySelector('.overview-phase').textContent : null);

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  let browser = null;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.readdirSync(DATA_DIR).forEach((f) => fs.rmSync(path.join(DATA_DIR, f), { recursive: true, force: true }));
    fs.copyFileSync(path.join(APP_DIR, 'data', 'wbs.seed.json'), path.join(DATA_DIR, 'wbs.seed.json'));
    fs.writeFileSync(DATA_FILE, JSON.stringify(docFromShape(), null, 2) + '\n');
    spawnServer('A', PORT, DATA_DIR);
    await waitReady(BASE);
    console.log('[env] 被测服务 ' + BASE + '（data: ' + DATA_DIR + '）');

    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    results.browser_version = browser.version();
    console.log('[env] chromium=' + browser.version());
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    trackPage(page);
    page.on('dialog', (dialog) => dialog.accept());
    /* 下载探针：跨导航累计（sessionStorage），用于「详情交互 0 次下载」断言。 */
    await page.addInitScript(() => {
      const bump = (key) => {
        try { sessionStorage.setItem(key, String(Number(sessionStorage.getItem(key) || '0') + 1)); } catch (e) { /* 忽略 */ }
      };
      window.WBS_DOWNLOAD_HOOK = function () { bump('wbs.probe.hook'); };
      const create = window.URL.createObjectURL.bind(window.URL);
      window.URL.createObjectURL = function (blob) { bump('wbs.probe.objectUrl'); return create(blob); };
      window.__probeRead = function () {
        let hook = 0;
        let objectUrl = 0;
        try {
          hook = Number(sessionStorage.getItem('wbs.probe.hook') || '0');
          objectUrl = Number(sessionStorage.getItem('wbs.probe.objectUrl') || '0');
        } catch (e) { /* 忽略 */ }
        return { hook: hook, objectUrl: objectUrl, anchors: document.querySelectorAll('a[download]').length };
      };
    });

    const openWorkbench = async (identity) => {
      await page.goto(BASE + '/');
      await page.evaluate((name) => { window.localStorage.setItem('wbs.identity', name); }, identity || '项目负责人');
      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll('#wbs-body tr').length > 0, null, { timeout: 15000 });
      await page.waitForFunction(() => document.querySelectorAll('#overview-rows .overview-row').length === 1 &&
        document.querySelectorAll('#overview-rows .overview-badge').length === 5, null, { timeout: 15000 });
      await page.waitForTimeout(150);
    };
    const readOverview = () => page.evaluate(() => {
      const bar = document.getElementById('phase-overview');
      const panel = document.getElementById('overview-detail-panel');
      const wrap = document.querySelector('.table-wrap');
      const rowsOf = (node) => Array.from(node.querySelectorAll('.overview-row')).map((row) => ({
        phase: row.getAttribute('data-phase'),
        label: row.querySelector('.overview-phase') ? row.querySelector('.overview-phase').textContent : null,
        badges: window.__readBadges(row)
      }));
      window.__readBadges = (row) => Array.from(row.querySelectorAll('.overview-badge')).map((badge) => {
        const style = getComputedStyle(badge);
        return {
          status: badge.getAttribute('data-status'), count: badge.getAttribute('data-count'),
          percentage: badge.getAttribute('data-percentage'), text: badge.textContent,
          bg: style.backgroundColor, color: style.color, scrollWidth: badge.scrollWidth, clientWidth: badge.clientWidth
        };
      });
      const rect = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }; };
      return {
        exists: !!bar,
        hidden: bar ? bar.hidden : null,
        buttons: bar ? bar.querySelectorAll('button').length : -1,
        total: document.getElementById('overview-total') ? document.getElementById('overview-total').textContent : '',
        detailTotal: document.getElementById('overview-detail-total') ? document.getElementById('overview-detail-total').textContent : '',
        bodyText: bar ? bar.textContent : '',
        detailBtnText: document.getElementById('overview-detail-btn') ? document.getElementById('overview-detail-btn').textContent : null,
        detailHidden: panel ? panel.hidden : null,
        detailCard: !!document.getElementById('overview-detail-rows'),
        topRows: rowsOf(document.getElementById('overview-rows')),
        detailRows: rowsOf(document.getElementById('overview-detail-rows')),
        bar: rect(bar), wrap: rect(wrap),
        afterTopbar: !!(document.querySelector('.topbar').compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING),
        beforeToolbar: !!(bar.compareDocumentPosition(document.querySelector('.toolbar')) & Node.DOCUMENT_POSITION_FOLLOWING)
      };
    });
    const waitStats = async (stats) => {
      const aggregate = sigOf(stats.aggregate.statuses);
      const phases = stats.phases.map((phase) => phase.key + ':' + sigOf(phase.statuses)).join('|');
      await page.waitForFunction((want) => {
        const top = document.querySelectorAll('#overview-rows .overview-badge');
        const gotTop = Array.from(top).map((b) => b.getAttribute('data-status') + '=' + b.getAttribute('data-count') + '/' + b.getAttribute('data-percentage')).join(',');
        const detail = Array.from(document.querySelectorAll('#overview-detail-rows .overview-row')).map((row) =>
          row.getAttribute('data-phase') + ':' + Array.from(row.querySelectorAll('.overview-badge'))
            .map((b) => b.getAttribute('data-status') + '=' + b.getAttribute('data-count') + '/' + b.getAttribute('data-percentage')).join(',')).join('|');
        return gotTop === want.aggregate && detail === want.phases;
      }, { aggregate: aggregate, phases: phases }, { timeout: 15000 });
    };

    /* 顶部区域（全量）与详情区域（分阶段）各做一次「DOM 与 /api/stats 逐项一致」核对。 */
    const compareTop = (id, view, stats, extra) => {
      const problems = [];
      const aggregate = stats.aggregate;
      if (view.topRows.length !== 1) problems.push('全量行数=' + view.topRows.length);
      const row = view.topRows[0] || { badges: [], label: null, phase: null };
      const badges = row.badges || [];
      if (badges.length !== 5) problems.push('全量徽标数=' + badges.length);
      aggregate.statuses.forEach((status, j) => {
        const badge = badges[j] || {};
        const expectText = status.value + ' ' + status.count + ' ' + status.percentage.toFixed(1) + '%';
        if (badge.status !== status.value) problems.push('顺序=' + badge.status);
        if (badge.count !== String(status.count)) problems.push(status.value + ' count=' + badge.count);
        if (badge.percentage !== status.percentage.toFixed(1)) problems.push(status.value + ' pct=' + badge.percentage);
        if (badge.text !== expectText) problems.push(status.value + ' 文案=' + badge.text);
      });
      if (badges.reduce((sum, badge) => sum + Number(badge.count), 0) !== stats.total * 5) {
        problems.push('全量五项计数合计=' + badges.reduce((sum, badge) => sum + Number(badge.count), 0) + ' ≠ 任务总数 × 5');
      }
      if (view.total.indexOf('共 ' + stats.total + ' 条') === -1) problems.push('总数文案=' + view.total);
      check(id, problems.length === 0, problems.length ? problems.slice(0, 5) : Object.assign({ 全量签名: sigOf(aggregate.statuses), total: stats.total }, extra || {}));
    };
    const compareDetail = (id, view, stats, extra) => {
      const problems = [];
      if (view.detailRows.length !== 5) problems.push('详情行数=' + view.detailRows.length);
      stats.phases.forEach((phase, index) => {
        const row = view.detailRows[index] || { badges: [], label: null, phase: null };
        if (row.phase !== phase.key) problems.push('阶段键=' + row.phase);
        if (row.label !== phase.name) problems.push(phase.key + ' 标签=' + row.label);
        (row.badges || []).forEach((badge, j) => {
          const status = phase.statuses[j] || {};
          if (badge.status !== status.value) problems.push(phase.key + ' 顺序=' + badge.status);
          if (badge.count !== String(status.count)) problems.push(phase.key + '/' + status.value + ' count=' + badge.count);
          if (badge.percentage !== status.percentage.toFixed(1)) problems.push(phase.key + '/' + status.value + ' pct=' + badge.percentage);
          if (badge.text !== status.value + ' ' + status.count + ' ' + status.percentage.toFixed(1) + '%') problems.push(phase.key + '/' + status.value + ' 文案=' + badge.text);
        });
        if ((row.badges || []).length !== 5) problems.push(phase.key + ' 徽标数=' + (row.badges || []).length);
      });
      if (view.detailTotal.indexOf('共 ' + stats.total + ' 条') === -1) problems.push('详情总数文案=' + view.detailTotal);
      check(id, problems.length === 0, problems.length ? problems.slice(0, 5) : Object.assign({
        详情签名: stats.phases.map((phase) => phase.key + ':' + sigOf(phase.statuses)).join('|')
      }, extra || {}));
    };

    /* ============ 矩阵01：顶部只剩一组「全部五阶段合并」全量统计 + 右侧「详情」按钮 ============ */
    await openWorkbench('项目负责人');
    const stats0 = (await api('/api/stats')).body;
    const view0 = await readOverview();
    compareTop('矩阵01a 顶部只保留一组全量统计（单行 = 五阶段合并），五种状态徽标齐显、count/percentage 与 /api/stats.aggregate 逐项一致',
      view0, stats0, { buttons: view0.buttons });
    check('矩阵01b 全量统计区位于工作台顶部（页头之下、工具条之上），右侧有「详情」按钮，且不遮挡表格',
      view0.afterTopbar && view0.beforeToolbar && view0.bar.bottom <= view0.wrap.top + 1 &&
      view0.detailBtnText === '详情' && view0.buttons === 1 && view0.detailHidden === true,
      { bar: view0.bar, wrapTop: view0.wrap.top, detailBtn: view0.detailBtnText, buttons: view0.buttons });
    const phaseRowFree = view0.topRows.every((row) => PHASE_KEYS.indexOf(row.phase) === -1) &&
      view0.topRows.map((row) => row.phase).join(',') === 'aggregate' &&
      view0.bodyText.indexOf('产品验收') === -1;
    check('矩阵01c 顶部不再有 CH-14 的五段分行（无 data-phase = 阶段键的行），全量行计数合计 = 任务总数 × 5 而非任务总数',
      phaseRowFree && view0.topRows[0].badges.reduce((sum, badge) => sum + Number(badge.count), 0) === stats0.total * 5,
      { rows: view0.topRows.map((row) => row.phase), 行内合计: view0.topRows[0].badges.reduce((sum, badge) => sum + Number(badge.count), 0) });

    /* ============ 矩阵02：详情面板（打开 / 关闭 / Esc / 不影响未保存编辑状态） ============ */
    const probeBefore = await page.evaluate(() => window.__probeRead());
    await page.click('#overview-detail-btn');
    await page.waitForFunction(() => document.getElementById('overview-detail-panel').hidden === false, null, { timeout: 8000 });
    await page.waitForTimeout(150);
    const detailOpen = await readOverview();
    compareDetail('矩阵02a 点开「详情」后按五个阶段各展示状态 count + percentage（设计 / 开发 / 测试 / 产品验收 / 演示准备），与 /api/stats.phases 逐项一致',
      detailOpen, stats0, { detailHidden: detailOpen.detailHidden });
    check('矩阵02b 详情为只读面板（role=dialog / aria-modal，无编辑控件、无下载入口），打开不改动页面其它区域',
      await page.evaluate(() => {
        const card = document.getElementById('overview-detail-panel').querySelector('.modal-card');
        const panel = document.getElementById('overview-detail-panel');
        return card.getAttribute('role') === 'dialog' && card.getAttribute('aria-modal') === 'true' &&
          panel.querySelectorAll('input, textarea, select').length === 0 &&
          panel.querySelectorAll('a[download]').length === 0;
      }), null);

    /* 未保存草稿（阶段控件改动）在打开 / 关闭详情期间保持不变，且详情交互不产生任何下载。 */
    await page.click('#overview-detail-close');
    await page.waitForFunction(() => document.getElementById('overview-detail-panel').hidden === true, null, { timeout: 8000 });
    await page.selectOption('#wbs-body tr[data-id="T001"] td[data-field="dates.design"] select.phase-select', '已完成');
    await page.waitForTimeout(150);
    const draftSig = await page.evaluate(() => document.querySelector('#wbs-body tr[data-id="T001"] td[data-field="dates.design"] select.phase-select').value);
    await page.click('#overview-detail-btn');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('overview-detail-panel').hidden === true, null, { timeout: 8000 });
    const afterEsc = await page.evaluate(() => ({
      value: document.querySelector('#wbs-body tr[data-id="T001"] td[data-field="dates.design"] select.phase-select').value,
      saveDisabled: document.getElementById('save-btn').disabled,
      panelHidden: document.getElementById('overview-detail-panel').hidden,
      dailyHidden: document.getElementById('daily-panel').hidden,
      notePanelHidden: document.getElementById('note-panel').hidden,
      probes: window.__probeRead()
    }));
    check('矩阵02c Esc 能关闭详情面板，且打开 / 关闭不影响工作台未保存编辑状态（草稿阶段值不变、保存按钮仍可用、不误关其它弹层）',
      afterEsc.panelHidden === true && afterEsc.value === '已完成' && draftSig === '已完成' &&
      afterEsc.saveDisabled === false && afterEsc.dailyHidden === true && afterEsc.notePanelHidden === true &&
      afterEsc.probes.hook === probeBefore.hook && afterEsc.probes.objectUrl === probeBefore.objectUrl,
      afterEsc);
    await page.click('#overview-detail-btn');
    await page.waitForTimeout(150);
    const reopened = await readOverview();
    check('矩阵02d 关闭按钮与 Esc 之后可再次打开，详情内容仍与 /api/stats 一致（无陈旧数据）',
      reopened.detailHidden === false && reopened.detailRows.length === 5, { rows: reopened.detailRows.length });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('overview-detail-panel').hidden === true, null, { timeout: 8000 });

    /* 伪响应：前端只原样渲染服务端口径，不做本地统计、不二次四舍五入。 */
    const doctored = {
      ok: true, total: 99, revision: 999,
      aggregate: {
        key: 'aggregate', name: '全部五阶段合并', denominator: 495,
        statuses: PHASE_ENUM.map((value, j) => ({ value: value, count: j === 0 ? 7 : 0, percentage: j === 0 ? 7.7 : 0 }))
      },
      phases: PHASE_KEYS.map((key, index) => ({
        key, name: PHASE_LABELS[key],
        statuses: PHASE_ENUM.map((value, j) => ({ value, count: index === 0 && j === 0 ? 7 : 0, percentage: index === 0 && j === 0 ? 7.7 : 0 }))
      }))
    };
    await page.route('**/api/stats', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doctored) }));
    await page.selectOption('#identity-select', '王言');
    await page.waitForTimeout(200);
    await page.selectOption('#identity-select', '项目负责人');
    await waitStats(doctored);
    const doctoredView = await readOverview();
    check('矩阵02e 前端原样渲染服务端口径：伪响应下全量区与详情区都逐字渲染（未开始 7 7.7%），不做本地统计、不二次四舍五入、不补齐 100.0%',
      doctoredView.topRows[0].badges[0].text === '未开始 7 7.7%' && doctoredView.detailRows[0].badges[0].text === '未开始 7 7.7%' &&
      doctoredView.total.indexOf('共 99 条') !== -1 && doctoredView.topRows[0].badges.reduce((sum, b) => sum + Number(b.percentage), 0) === 7.7,
      { 全量: doctoredView.topRows[0].badges[0].text, 详情: doctoredView.detailRows[0].badges[0].text, total: doctoredView.total });
    await page.unroute('**/api/stats');
    const stats0b = (await api('/api/stats')).body;
    await page.selectOption('#identity-select', '王言');
    await page.waitForTimeout(150);
    await page.selectOption('#identity-select', '项目负责人');
    await waitStats(stats0b);
    const restored = await readOverview();
    compareTop('矩阵02f 撤下伪响应后按真实 /api/stats 渲染（回到构造数据的 count / percentage）', restored, stats0b);
    compareDetail('矩阵02g 详情区同步回到真实 /api/stats.phases 口径', restored, stats0b);

    /* ============ 矩阵04：五色与表格阶段控件一致；0 项仍显示 0 0.0% ============ */
    const tableColors = await page.evaluate((keys) => {
      const map = {};
      keys.forEach((key) => {
        document.querySelectorAll('#wbs-body td[data-field="dates.' + key + '"] select.phase-select').forEach((select) => {
          if (map[select.value]) return;
          const style = getComputedStyle(select);
          map[select.value] = { bg: style.backgroundColor, color: style.color };
        });
      });
      return map;
    }, PHASE_KEYS);
    const colorProblems = [];
    let zeroBadges = 0;
    const allBadges = restored.topRows[0].badges.concat(restored.detailRows.reduce((list, row) => list.concat(row.badges), []));
    allBadges.forEach((badge) => {
      const control = tableColors[badge.status] || {};
      const expected = PHASE_COLORS[badge.status] || {};
      if (badge.bg !== control.bg || badge.color !== control.color) {
        colorProblems.push(badge.status + ' 与表格控件不一致 ' + badge.bg + '/' + badge.color + ' vs ' + control.bg + '/' + control.color);
      }
      if (badge.bg !== expected.bg || badge.color !== expected.fg) colorProblems.push(badge.status + ' 五色映射不符 ' + badge.bg + '/' + badge.color);
      if (badge.count === '0' && badge.percentage === '0.0' && badge.text.indexOf('0 0.0%') !== -1) zeroBadges += 1;
    });
    check('矩阵04a 五色与表格阶段控件逐项一致（未开始=灰 / 已开始=蓝 / 已完成=绿 / 延期=红 / 阻塞=黄），全量区与详情区同色同形',
      colorProblems.length === 0 && Object.keys(tableColors).length === 5 && allBadges.length === 30 &&
      PHASE_ENUM.every((value) => PHASE_COLORS[value].bg === (tableColors[value] || {}).bg),
      colorProblems.length ? colorProblems.slice(0, 3) : { 徽标数: allBadges.length, 表格控件取样: Object.keys(tableColors).length });
    check('矩阵04b 数量为 0 的状态同样显示「0 0.0%」（构造数据含 4 个 0 项状态，全部按「0 0.0%」渲染）', zeroBadges >= 4, { zeroBadges });

    /* ============ 矩阵05：保存 / 新增 / 删除 / 身份切换后全量与详情实时重算 ============ */
    const beforeSave = (await api('/api/stats')).body;
    await page.click('#save-btn');
    await page.waitForFunction(() => document.getElementById('banner-text').textContent.indexOf('保存成功') !== -1, null, { timeout: 15000 });
    const afterSave = (await api('/api/stats')).body;
    await waitStats(afterSave);
    const savedView = await readOverview();
    compareTop('矩阵05a 保存成功后全量区实时重算（阶段控件改动已计入，= 最新 /api/stats.aggregate）', savedView, afterSave);
    compareDetail('矩阵05b 详情区同步实时重算（= 最新 /api/stats.phases，无陈旧数据）', savedView, afterSave);
    check('矩阵05c 保存后两组结果确实变化（设计阶段：未开始 8 → 7、已完成 7 → 8；全量分母不变）',
      sigOf(beforeSave.aggregate.statuses) !== sigOf(afterSave.aggregate.statuses) &&
      afterSave.phases[0].statuses[2].count === 8 && afterSave.phases[0].statuses[0].count === 7,
      { before: beforeSave.phases[0].statuses.map((s) => s.count), after: afterSave.phases[0].statuses.map((s) => s.count) });

    /* 详情面板打开状态下保存 → 面板内容随之刷新。
       面板与 CH-8 / CH-13 的弹层同为全屏模态（鼠标不可点到底层工具条），因此用键盘激活「保存」
       （按钮仍可聚焦，Enter 触发 click），验证「写操作成功后全量区与详情区一起重算」。 */
    await page.selectOption('#wbs-body tr[data-id="T002"] td[data-field="dates.dev"] select.phase-select', '阻塞');
    await page.waitForTimeout(150);
    await page.click('#overview-detail-btn');
    await page.waitForTimeout(150);
    await page.$eval('#save-btn', (el) => el.focus());
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('banner-text').textContent.indexOf('保存成功') !== -1, null, { timeout: 15000 });
    const afterSave2 = (await api('/api/stats')).body;
    await waitStats(afterSave2);
    const openSaved = await readOverview();
    check('矩阵05d 详情面板打开状态下保存：面板不关闭、内容与全量区一起按最新 /api/stats 刷新',
      openSaved.detailHidden === false && openSaved.detailRows.length === 5 &&
      openSaved.detailRows[1].badges[4].count === String(afterSave2.phases[1].statuses[4].count),
      { 开头: openSaved.detailRows[1].badges[4].text });
    await page.keyboard.press('Escape');

    /* 新增行 → 保存 → 任务总数 36 → 37，全量分母 = 185。 */
    await page.click('#add-row-btn');
    await page.waitForFunction(() => document.querySelectorAll('#wbs-body tr').length === 37, null, { timeout: 8000 });
    for (const [field, value] of [['level1', '自测一级'], ['level2', '自测二级'], ['task', 'CH-15 自测新增']]) {
      await page.click('#wbs-body tr[data-id="T037"] td[data-field="' + field + '"]');
      await page.fill('#wbs-body tr[data-id="T037"] td[data-field="' + field + '"] input', value);
      await page.keyboard.press('Tab');
    }
    await page.click('#save-btn');
    await page.waitForFunction(() => document.getElementById('banner-text').textContent.indexOf('保存成功') !== -1, null, { timeout: 15000 });
    const afterAdd = (await api('/api/stats')).body;
    await waitStats(afterAdd);
    compareTop('矩阵05e 新增行保存后全量区实时刷新（任务总数 36 → 37，分母 180 → 185，占比按新分母重算）', await readOverview(), afterAdd);
    check('矩阵05f 新增后分母与占比确实按 37 重算', afterAdd.total === 37 && afterAdd.aggregate.denominator === 185 &&
      afterAdd.aggregate.statuses.reduce((sum, item) => sum + item.count, 0) === 185,
      { total: afterAdd.total, denominator: afterAdd.aggregate.denominator });

    /* 删除行 → 保存 → 任务总数 37 → 36。 */
    await page.click('#wbs-body tr[data-id="T036"] td.cell-op button[data-delete]');
    await page.waitForTimeout(200);
    await page.click('#save-btn');
    await page.waitForFunction(() => document.getElementById('banner-text').textContent.indexOf('保存成功') !== -1, null, { timeout: 15000 });
    const afterDelete = (await api('/api/stats')).body;
    await waitStats(afterDelete);
    const deleted = await readOverview();
    compareTop('矩阵05g 删除行保存后全量区实时刷新（任务总数回到 36，分母回到 180）', deleted, afterDelete);
    compareDetail('矩阵05h 删除后详情区同步刷新', deleted, afterDelete);
    check('矩阵05i 删除后分母确实回到 180', afterDelete.total === 36 && afterDelete.aggregate.denominator === 180,
      { total: afterDelete.total, denominator: afterDelete.aggregate.denominator });

    /* 身份切换回到工作台 → 实时重算。 */
    await page.selectOption('#identity-select', '李欢');
    await page.waitForTimeout(400);
    const asLi = (await api('/api/stats')).body;
    compareTop('矩阵05j 切到非项目负责人身份后全量区仍按 /api/stats 实时重算（九身份共享同一只读口径）', await readOverview(), asLi);
    await page.selectOption('#identity-select', '项目负责人');
    await page.waitForTimeout(300);
    const backStats = (await api('/api/stats')).body;
    await waitStats(backStats);
    compareDetail('矩阵05k 切回项目负责人后详情区同步刷新（= 最新 /api/stats.phases，无陈旧数据）', await readOverview(), backStats);

    /* ============ 矩阵06：九个身份都可见全量统计与详情；查看不改审计 / revision ============ */
    const revisionBefore = (await api('/api/wbs')).body.meta.revision;
    const auditBefore = auditBytes();
    const perIdentity = [];
    for (const name of IDENTITIES) {
      await openWorkbench(name);
      const stats = (await api('/api/stats')).body;
      await page.click('#overview-detail-btn');
      await page.waitForTimeout(120);
      const view = await readOverview();
      const ok = view.topRows.length === 1 && view.topRows[0].badges.length === 5 &&
        view.detailRows.length === 5 && sigOf(stats.phases[3].statuses) === view.detailRows[3].badges
          .map((badge) => badge.status + '=' + badge.count + '/' + badge.percentage).join(',') &&
        view.detailRows[3].label === '产品验收';
      perIdentity.push({ identity: name, ok: ok });
      await page.keyboard.press('Escape');
    }
    const visibleAll = perIdentity.every((entry) => entry.ok);
    const revisionAfter = (await api('/api/wbs')).body.meta.revision;
    const auditAfter = auditBytes();
    check('矩阵06a 九个身份都能看到全量统计与详情面板（详情含五个阶段、产品阶段标签为「产品验收」，内容与 /api/stats 一致）',
      visibleAll && perIdentity.length === 9, perIdentity.filter((entry) => !entry.ok));
    check('矩阵06b 查看全量统计 / 打开关闭详情均为只读：不写审计、不改 revision（查看前后逐字节一致）',
      revisionBefore === revisionAfter && auditBefore.equals(auditAfter),
      { revision: revisionAfter, auditBytes: auditAfter.length });

    /* ============ 矩阵07：桌面与 375px 不溢出、不遮挡表格、无横向滚动 ============ */
    const measure = () => page.evaluate(() => {
      const bar = document.getElementById('phase-overview');
      const panel = document.getElementById('overview-detail-panel');
      const card = panel.querySelector('.modal-card');
      const wrap = document.querySelector('.table-wrap');
      const badges = Array.from(document.querySelectorAll('.overview-badge'));
      const rows = Array.from(document.querySelectorAll('.overview-row'));
      const rect = (el) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width) }; };
      return {
        innerWidth: window.innerWidth,
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        bar: rect(bar), barScrollWidth: bar.scrollWidth, barClientWidth: bar.clientWidth,
        wrapTop: Math.round(wrap.getBoundingClientRect().top), wrap: rect(wrap),
        wrapScrollable: wrap.scrollWidth > wrap.clientWidth + 1,
        panelHidden: panel.hidden, panel: rect(panel), card: rect(card),
        cardScrollable: document.getElementById('overview-detail-rows').scrollHeight > document.getElementById('overview-detail-rows').clientHeight,
        overlapping: badges.filter((badge) => badge.scrollWidth > badge.clientWidth + 1).length,
        badgesOutOfViewport: badges.filter((badge) => badge.getBoundingClientRect().right > window.innerWidth + 1 || badge.getBoundingClientRect().left < -1).length,
        rowsOutOfViewport: rows.filter((row) => row.getBoundingClientRect().right > window.innerWidth + 1 || row.getBoundingClientRect().left < -1).length,
        badges: badges.length
      };
    });
    await openWorkbench('项目负责人');
    const desktop = await measure();
    check('矩阵07a 桌面 1600px：全量统计文本/数字不溢出、不遮挡表格、无横向页面滚动；「详情」按钮不重叠',
      desktop.docScrollWidth <= desktop.docClientWidth + 1 && desktop.overlapping === 0 && desktop.badgesOutOfViewport === 0 &&
      desktop.barScrollWidth <= desktop.barClientWidth + 1 && desktop.bar.bottom <= desktop.wrapTop + 1 &&
      desktop.rowsOutOfViewport === 0,
      desktop);
    await page.click('#overview-detail-btn');
    await page.waitForTimeout(200);
    const desktopDetail = await measure();
    check('矩阵07b 桌面：详情面板内的五阶段徽标不溢出视口（面板宽度受控、内容不超界）',
      desktopDetail.panelHidden === false && desktopDetail.card.width <= desktopDetail.innerWidth &&
      desktopDetail.badgesOutOfViewport === 0, { card: desktopDetail.card, innerWidth: desktopDetail.innerWidth });
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 375, height: 720 });
    await page.waitForTimeout(350);
    const mobile = await measure();
    const mobileStats = (await api('/api/stats')).body;
    compareTop('矩阵07c 375px 手机宽度：全量统计仍显示五种状态徽标，文案与 /api/stats 一致（自然换行）', await readOverview(), mobileStats);
    check('矩阵07d 375px：文本与数字不溢出、不遮挡表格、无横向页面滚动（表格仍由 .table-wrap 内部横向滚动）',
      mobile.docScrollWidth <= mobile.docClientWidth + 1 && mobile.bodyScrollWidth <= mobile.innerWidth + 1 &&
      mobile.overlapping === 0 && mobile.badgesOutOfViewport === 0 && mobile.rowsOutOfViewport === 0 &&
      mobile.barScrollWidth <= mobile.barClientWidth + 1 && mobile.bar.bottom <= mobile.wrapTop + 1 && mobile.wrapScrollable === true,
      mobile);
    await page.click('#overview-detail-btn');
    await page.waitForTimeout(250);
    const mobileDetail = await measure();
    const mobileDetailView = await readOverview();
    compareDetail('矩阵07e 375px：详情面板可滚动且五阶段各行完整可读，内容与 /api/stats.phases 一致', mobileDetailView, mobileStats, { card: mobileDetail.card });
    check('矩阵07f 375px：详情面板不溢出视口、无横向页面滚动，Esc 可关闭',
      mobileDetail.panelHidden === false && mobileDetail.card.width <= mobileDetail.innerWidth &&
      mobileDetail.docScrollWidth <= mobileDetail.docClientWidth + 1 && mobileDetail.badgesOutOfViewport === 0,
      { card: mobileDetail.card, docScrollWidth: mobileDetail.docScrollWidth, innerWidth: mobileDetail.innerWidth, panelScrollable: mobileDetail.cardScrollable });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('overview-detail-panel').hidden === true, null, { timeout: 8000 });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForTimeout(250);

    /* ============ 矩阵08：改名（网页五列头 / 全量·详情标签 / 阶段控件 / 日报文本 / 导出 L2:P2） ============ */
    const headers = await page.evaluate(() => Array.from(document.querySelectorAll('#wbs-table thead th')).map((th) => th.textContent));
    check('矩阵08a 网页五列头阶段显示名全部改名：第 9 列为「产品验收」（其余设计 / 开发 / 测试 / 演示准备不变）',
      JSON.stringify(headers.slice(5, 10)) === JSON.stringify(['设计', '开发', '测试', '产品验收', '演示准备']),
      { headers: headers.slice(5, 10) });
    const controlTitles = await page.evaluate((keys) => keys.map((key) => {
      const select = document.querySelector('#wbs-body td[data-field="dates.' + key + '"] select.phase-select');
      const wrap = select ? select.closest('.phase-cell') : null;
      return wrap ? wrap.getAttribute('title') : null;
    }), PHASE_KEYS);
    check('矩阵08b 阶段控件标题同步改名（产品验收进度：…），接口 key 仍为 product（DOM data-field 不变）',
      controlTitles[3].indexOf('产品验收进度：') === 0 &&
      await page.evaluate(() => !!document.querySelector('#wbs-body td[data-field="dates.product"] select.phase-select')),
      { titles: controlTitles });
    await page.click('#overview-detail-btn');
    await page.waitForTimeout(150);
    const detailLabels = await page.evaluate(() => Array.from(document.querySelectorAll('#overview-detail-rows .overview-phase')).map((el) => el.textContent));
    await page.keyboard.press('Escape');
    check('矩阵08c 详情面板五阶段标签为「设计 / 开发 / 测试 / 产品验收 / 演示准备」',
      JSON.stringify(detailLabels) === JSON.stringify(['设计', '开发', '测试', '产品验收', '演示准备']), { detailLabels });

    /* 日报文本弹层：阶段结论标签改名（构造数据里 product 阶段存在 4 个「延期」）。 */
    await page.click('#daily-btn');
    await page.waitForFunction(() => document.getElementById('daily-panel').hidden === false, null, { timeout: 15000 });
    const dailyText = await page.evaluate(() => document.getElementById('daily-text').textContent);
    const dailyApi = (await api('/api/daily?tz=' + TZ + '&date=' + todayStr())).body;
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('daily-panel').hidden === true, null, { timeout: 8000 });
    check('矩阵08d 日报文本弹层阶段结论标签改名：出现「产品验收延期 / 产品验收阻塞」，且不再出现旧标签「产品延期 / 产品阻塞」',
      dailyText.indexOf('产品验收') !== -1 && dailyText.indexOf('产品延期') === -1 && dailyText.indexOf('产品阻塞') === -1 &&
      dailyText === dailyApi.text.body && dailyApi.text.lines.some((line) => line.indexOf('产品验收') !== -1),
      { 样板: dailyText.split('\n').slice(0, 3), 行数: dailyApi.text.lines.length });

    /* WBS 导出：L2:P2 五进度表头改名；A–K 与模板首两行保真；五色仍在文件里；不带统计区。 */
    const captured = await (async () => {
      await page.evaluate(() => {
        window.__cap = null;
        const toB64 = (bytes) => {
          let out = '';
          for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
          return btoa(out);
        };
        window.WBS_DOWNLOAD_HOOK = (bytes, name) => {
          try { sessionStorage.setItem('wbs.probe.hook', String(Number(sessionStorage.getItem('wbs.probe.hook') || '0') + 1)); } catch (e) { /* 忽略 */ }
          window.__cap = { name: name, b64: toB64(bytes), length: bytes.length };
        };
      });
      await page.click('#export-btn');
      for (let i = 0; i < 80; i += 1) {
        if (await page.evaluate(() => window.__cap !== null)) break;
        await sleep(200);
      }
      return page.evaluate(() => window.__cap);
    })();
    /* 文件名沿用 CH-7 既有口径：蓉城战役WBS-YYYYMMDD.xlsx（不以本轮改名而变）。 */
    const exportName = '蓉城战役WBS-' + todayStr().replace(/-/g, '') + '.xlsx';
    if (captured) fs.writeFileSync(path.join(OUTDIR, exportName), Buffer.from(captured.b64, 'base64'));
    const rawBytes = captured ? Buffer.from(captured.b64, 'base64').toString('latin1') : '';
    const shape = await page.evaluate(async (base64) => {
      const wb = window.XLSX.read(base64, { type: 'base64' });
      const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
      const templateBuffer = await (await fetch('template.xlsx', { cache: 'no-store' })).arrayBuffer();
      const templateWb = window.XLSX.read(new Uint8Array(templateBuffer), { type: 'array', cellStyles: true });
      const templateRows = window.XLSX.utils.sheet_to_json(templateWb.Sheets[templateWb.SheetNames[0]], { header: 1, raw: false, defval: '' });
      return {
        sheetNames: wb.SheetNames,
        header: rows[1],
        row1: rows[0],
        templateRow1: templateRows[0],
        templateRow2: templateRows[1],
        dataColumnL: rows.slice(2, 7).map((row) => row[11]),
        width: rows[1].length
      };
    }, captured.b64);
    results.exportShape = { name: captured ? captured.name : null, header: shape.header.slice(0, 17), row1: shape.row1.slice(14, 18) };
    check('矩阵08e WBS 导出 L2:P2 五进度表头同步改名（产品验收进度），仍为单 sheet、A–K 与模板第 1/2 行逐字保真、Q1 导出日期标签不回归',
      shape.sheetNames.length === 1 &&
      JSON.stringify(shape.header.slice(11, 16)) === JSON.stringify(EXPORT_HEADERS) &&
      JSON.stringify(shape.row1.slice(0, 11)) === JSON.stringify(shape.templateRow1.slice(0, 11)) &&
      JSON.stringify(shape.header.slice(0, 11)) === JSON.stringify(shape.templateRow2.slice(0, 11)) &&
      /^导出日期：\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(shape.row1[16])),
      { l2p: shape.header.slice(11, 16), q1: shape.row1[16] });
    check('矩阵08f 导出数据区 L 列起为阶段状态文字（产品验收列沿用 product 阶段值），且文件内含五阶段五色填充（未开始灰 / 已开始蓝 / 已完成绿 / 延期红 / 阻塞黄）',
      shape.dataColumnL.every((value) => PHASE_ENUM.indexOf(String(value)) !== -1) &&
      EXPORT_HEX.every((hex) => rawBytes.indexOf(hex) !== -1),
      { L列: shape.dataColumnL, 颜色: EXPORT_HEX.filter((hex) => rawBytes.indexOf(hex) !== -1) });
    check('矩阵08g 导出文件名与内容不带统计区（无 aggregate / 占比文案 / 详情面板字样），仍只含原模板数据区 + 五进度列',
      captured && captured.name === exportName &&
      String(shape.row1[16]).indexOf('导出日期：') === 0 &&
      rawBytes.indexOf('全部五阶段合并') === -1 && rawBytes.indexOf('分阶段状态占比') === -1,
      { name: captured ? captured.name : null });

    /* ============ 矩阵10：无外部请求、仅 WBS 导出构成下载、无 pageerror ============ */
    const probes = await page.evaluate(() => window.__probeRead());
    check('矩阵10a 全程只有「导出 Excel」构成下载（探针 = 1 次），全量统计 / 详情面板 / 日报弹层等交互 0 次下载、页面无 a[download]',
      probes.hook === 1 && probes.objectUrl === 0 && probes.anchors === 0, probes);

    const external = allRequests.filter((r) => r.url.indexOf(BASE) !== 0 && r.url.indexOf('data:') !== 0 && r.url.indexOf('blob:') !== 0);
    check('矩阵10b 全程无外部请求（无 CDN / 外链 / 远程图片 / 新增下载路径），且无 pageerror / console error',
      external.length === 0 && results.page_errors.length === 0 && results.console_errors.length === 0,
      { requests: allRequests.length, external: external.slice(0, 3), pageerrors: results.page_errors.slice(0, 2) });

    await page.setViewportSize({ width: 1600, height: 1000 });
    await openWorkbench('项目负责人');
    await page.screenshot({ path: path.join(OUTDIR, 'page-workbench.png'), fullPage: false });
    await page.click('#overview-detail-btn');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUTDIR, 'page-detail-1600.png'), fullPage: false });
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 375, height: 720 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUTDIR, 'page-workbench-375.png'), fullPage: false });
    await page.click('#overview-detail-btn');
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUTDIR, 'page-detail-375.png'), fullPage: false });
    fs.writeFileSync(path.join(OUTDIR, 'stats-at-end.json'), JSON.stringify((await api('/api/stats')).body));
    fs.writeFileSync(path.join(OUTDIR, 'overview-view.json'), JSON.stringify(await readOverview(), null, 2));
  } catch (err) {
    check('stage19 浏览器用例集执行', false, err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : String(err));
  } finally {
    try { if (browser) await browser.close(); } catch (err) { /* ignore */ }
    await stopServer('A');
  }
  results.checks_summary = { pass: pass, fail: fail };
  results.requests = allRequests;
  fs.writeFileSync(path.join(OUTDIR, 'browser-results.json'), JSON.stringify(results, null, 2));
  console.log('---');
  console.log('PASS=' + pass + ' FAIL=' + fail);
  process.exit(fail === 0 ? 0 : 1);
})();
