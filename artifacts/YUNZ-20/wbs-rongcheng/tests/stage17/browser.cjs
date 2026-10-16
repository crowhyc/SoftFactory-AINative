'use strict';
/* YUNZ-37 / 变更包 #7（CH-14 阶段状态占比总览 + GET /api/stats）真实浏览器自测。
   运行环境：mcr.microsoft.com/playwright:v1.55.0-jammy 容器（chromium 140，与 playwright 1.55.0 对齐）；
   宿主为 CentOS 7，无法直接运行该 Chromium，浏览器只在测试容器内运行，不进产物、不进镜像。
   被测服务（server.js）由本脚本自行 spawn（隔离数据目录 + 构造数据），结束后回收；
   不触碰运行现场 0.0.0.0:4180 与 /opt/wbs-rongcheng/data。
   用法（由 tests/stage17/run.sh 调用）：
     APP_DIR=/app OUTDIR=/app/tests/.tmp/stage17-out DATA_DIR=/data TOOLS=/tools \
     node /app/tests/stage17/browser.cjs */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const TOOLS = process.env.TOOLS || '/tools';
const { chromium } = require(path.join(TOOLS, 'node_modules', 'playwright'));

const APP_DIR = process.env.APP_DIR || '/app';
const PORT = Number(process.env.WBS_TEST_PORT || 4287);
const BASE = process.env.BASE || 'http://127.0.0.1:' + PORT;
const OUTDIR = process.env.OUTDIR || '/app/tests/.tmp/stage17-out';
const DATA_DIR = process.env.DATA_DIR || '/app/tests/.tmp/stage17-browser-data';
const TZ = 'Asia/Shanghai';
const PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep'];
const PHASE_LABELS = { design: '设计', dev: '开发', test: '测试', product: '产品', demo_prep: '演示准备' };
const PHASE_ENUM = ['未开始', '已开始', '已完成', '延期', '阻塞'];
/* 五色映射（与表格阶段控件、导出填充一致）：未开始=灰 / 已开始=蓝 / 已完成=绿 / 延期=红 / 阻塞=黄。 */
const PHASE_COLORS = {
  '未开始': { bg: 'rgb(158, 158, 158)', fg: 'rgb(255, 255, 255)' },
  '已开始': { bg: 'rgb(47, 128, 237)', fg: 'rgb(255, 255, 255)' },
  '已完成': { bg: 'rgb(39, 174, 96)', fg: 'rgb(255, 255, 255)' },
  '延期': { bg: 'rgb(231, 76, 60)', fg: 'rgb(255, 255, 255)' },
  '阻塞': { bg: 'rgb(255, 212, 0)', fg: 'rgb(58, 46, 0)' }
};
/* 构造数据：每阶段五状态的目标计数（各阶段之和都等于任务总数 36）。 */
const SHAPE = {
  design: [8, 7, 7, 7, 7], dev: [6, 8, 8, 7, 7], test: [5, 5, 5, 16, 5],
  product: [4, 4, 4, 4, 20], demo_prep: [36, 0, 0, 0, 0]
};

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
      for (let i = 0; i < PHASE_ENUM.length; i += 1) {
        if (rest < SHAPE[key][i]) { task.phases[key] = PHASE_ENUM[i]; break; }
        rest -= SHAPE[key][i];
      }
      if (!task.phases[key]) task.phases[key] = PHASE_ENUM[0];
    });
  });
  doc.meta.revision = 0;
  doc.tasks = tasks;
  return doc;
}
function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const signatureOf = (stats) => (stats.phases || []).map((phase) =>
  phase.key + ':' + phase.statuses.map((item) => item.value + '=' + item.count + '/' + item.percentage.toFixed(1)).join(',')).join('|');

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

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  let browser = null;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.readdirSync(DATA_DIR).forEach((f) => fs.rmSync(path.join(DATA_DIR, f), { recursive: true, force: true }));
    fs.copyFileSync(path.join(APP_DIR, 'data', 'wbs.seed.json'), path.join(DATA_DIR, 'wbs.seed.json'));
    fs.writeFileSync(path.join(DATA_DIR, 'wbs.json'), JSON.stringify(docFromShape(), null, 2) + '\n');
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
    /* 下载探针：跨导航累计（sessionStorage），用于矩阵10「0 次新增下载」断言。 */
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
        let anchors = 0;
        try {
          hook = Number(sessionStorage.getItem('wbs.probe.hook') || '0');
          objectUrl = Number(sessionStorage.getItem('wbs.probe.objectUrl') || '0');
        } catch (e) { /* 忽略 */ }
        anchors = document.querySelectorAll('a[download]').length;
        return { hook, objectUrl, anchors };
      };
    });

    const openWorkbench = async (identity) => {
      await page.goto(BASE + '/');
      await page.evaluate((name) => { window.localStorage.setItem('wbs.identity', name); }, identity || '项目负责人');
      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll('#wbs-body tr').length > 0, null, { timeout: 15000 });
      await page.waitForFunction(() => document.querySelectorAll('#overview-rows .overview-row').length === 5, null, { timeout: 15000 });
      await page.waitForTimeout(150);
    };
    /* 计数/百分比/DOM 三口径同源比对：总览以「服务端 /api/stats 原样渲染」为准。 */
    const readOverview = () => page.evaluate(() => {
      const bar = document.getElementById('phase-overview');
      const rows = Array.from(document.querySelectorAll('#overview-rows .overview-row'));
      return {
        exists: !!bar,
        hidden: bar ? bar.hidden : null,
        buttons: bar ? bar.querySelectorAll('button').length : -1,
        total: document.getElementById('overview-total') ? document.getElementById('overview-total').textContent : '',
        bodyText: bar ? bar.textContent : '',
        rows: rows.map((row) => ({
          phase: row.getAttribute('data-phase'),
          label: row.querySelector('.overview-phase') ? row.querySelector('.overview-phase').textContent : null,
          tagged: row.hasAttribute('data-phase'),
          badges: Array.from(row.querySelectorAll('.overview-badge')).map((badge) => {
            const style = getComputedStyle(badge);
            return {
              status: badge.getAttribute('data-status'),
              count: badge.getAttribute('data-count'),
              percentage: badge.getAttribute('data-percentage'),
              text: badge.textContent,
              bg: style.backgroundColor,
              color: style.color,
              scrollWidth: badge.scrollWidth,
              clientWidth: badge.clientWidth
            };
          })
        }))
      };
    });
    const domSignature = () => page.evaluate(() => Array.from(document.querySelectorAll('#overview-rows .overview-row'))
      .map((row) => row.getAttribute('data-phase') + ':' + Array.from(row.querySelectorAll('.overview-badge'))
        .map((b) => b.getAttribute('data-status') + '=' + b.getAttribute('data-count') + '/' + b.getAttribute('data-percentage')).join(','))
      .join('|'));
    const waitSignature = async (stats, timeout) => {
      const expected = signatureOf(stats);
      await page.waitForFunction((want) => {
        const got = Array.from(document.querySelectorAll('#overview-rows .overview-row'))
          .map((row) => row.getAttribute('data-phase') + ':' + Array.from(row.querySelectorAll('.overview-badge'))
            .map((b) => b.getAttribute('data-status') + '=' + b.getAttribute('data-count') + '/' + b.getAttribute('data-percentage')).join(','))
          .join('|');
        return got === want;
      }, expected, { timeout: timeout || 8000 });
      return expected;
    };
    const compareOverview = (id, view, stats) => {
      const problems = [];
      if (!view.exists || view.hidden) problems.push('总览条不可见');
      if (view.rows.length !== stats.phases.length) problems.push('阶段行数 ' + view.rows.length);
      stats.phases.forEach((phase, index) => {
        const row = view.rows[index] || {};
        if (row.phase !== phase.key) problems.push('第 ' + index + ' 行阶段=' + row.phase);
        if (row.label !== phase.name) problems.push(phase.key + ' 阶段名=' + row.label);
        const badges = row.badges || [];
        if (badges.length !== 5) problems.push(phase.key + ' 徽标数=' + badges.length);
        let rowCount = 0;
        phase.statuses.forEach((status, j) => {
          const badge = badges[j] || {};
          const expectText = status.value + ' ' + status.count + ' ' + status.percentage.toFixed(1) + '%';
          rowCount += status.count;
          if (badge.status !== status.value) problems.push(phase.key + ' 第 ' + j + ' 项=' + badge.status);
          if (badge.text !== expectText) problems.push(phase.key + '/' + status.value + ' 文本=' + JSON.stringify(badge.text) + ' 期望 ' + JSON.stringify(expectText));
          if (badge.count !== String(status.count)) problems.push(phase.key + '/' + status.value + ' count=' + badge.count);
          if (badge.percentage !== status.percentage.toFixed(1)) problems.push(phase.key + '/' + status.value + ' pct=' + badge.percentage);
        });
        if (rowCount !== stats.total) problems.push(phase.key + ' 五行计数合计=' + rowCount + ' ≠ 任务总数 ' + stats.total);
      });
      if (view.total.indexOf('共 ' + stats.total + ' 条') === -1) problems.push('总数文案=' + view.total);
      check(id, problems.length === 0, problems.length ? problems.slice(0, 5) : { rows: view.rows.length, total: stats.total });
    };

    /* ============ 矩阵01：顶部常驻总览条，五阶段各自独立一组，无跨阶段合并行 ============ */
    await openWorkbench('项目负责人');
    const stats0 = (await api('/api/stats')).body;
    const view0 = await readOverview();
    compareOverview('矩阵01a 工作台顶部常驻总览条可见，五阶段各自独立一行、每行五项状态徽标，内容与 /api/stats 完全一致', view0, stats0);

    const layout = await page.evaluate(() => {
      const bar = document.getElementById('phase-overview');
      const topbar = document.querySelector('.topbar');
      const toolbar = document.querySelector('.toolbar');
      const wrap = document.querySelector('.table-wrap');
      const rect = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; };
      return {
        bar: rect(bar), topbar: rect(topbar), toolbar: rect(toolbar), wrap: rect(wrap),
        afterTopbar: !!(topbar.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING),
        beforeToolbar: !!(bar.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING)
      };
    });
    check('矩阵01b 总览条位于工作台顶部（页头之下、工具条与表格之上），不遮挡表格、不覆盖工具条',
      layout.afterTopbar && layout.beforeToolbar && layout.bar.bottom <= layout.toolbar.top + 1 &&
      layout.toolbar.bottom <= layout.wrap.top + 1 && layout.bar.left === layout.topbar.left && layout.bar.right === layout.topbar.right,
      layout);

    const mergeFree = view0.rows.every((row) => row.tagged) && view0.rows.map((row) => row.phase).join(',') === PHASE_KEYS.join(',') &&
      view0.rows.map((row) => row.label).join(',') === PHASE_KEYS.map((key) => PHASE_LABELS[key]).join(',') &&
      !/合计|总计|全部阶段|跨阶段/.test(view0.bodyText) && view0.bodyText.indexOf(String(stats0.total * 5)) === -1 &&
      view0.buttons === 0;
    check('矩阵01c 无跨阶段合并行（5 行 = 5 阶段，行内计数合计 = 任务总数而非跨阶段累加），总览条内无手动刷新按钮',
      mergeFree, { rows: view0.rows.map((row) => row.phase), buttons: view0.buttons });

    /* ============ 矩阵02：前端原样渲染服务端口径（不自行统计、不二次四舍五入） ============ */
    const doctored = {
      ok: true, total: 99, revision: 999,
      phases: PHASE_KEYS.map((key, index) => ({
        key, name: PHASE_LABELS[key],
        statuses: PHASE_ENUM.map((value, j) => ({
          value,
          count: index === 0 && j === 0 ? 7 : 0,
          percentage: index === 0 && j === 0 ? 7.7 : 0
        }))
      }))
    };
    await page.route('**/api/stats', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doctored) }));
    await page.selectOption('#identity-select', '王言');
    await page.waitForTimeout(200);
    await page.selectOption('#identity-select', '项目负责人');
    await page.waitForFunction(() => {
      const badge = document.querySelector('#overview-rows .overview-row .overview-badge');
      const total = document.getElementById('overview-total');
      return !!badge && badge.textContent === '未开始 7 7.7%' && !!total && total.textContent.indexOf('共 99 条') !== -1;
    }, null, { timeout: 8000 });
    const doctoredView = await readOverview();
    const doctoredOk = doctoredView.rows.length === 5 && doctoredView.rows.every((row) => row.badges.length === 5) &&
      doctoredView.rows[0].badges[0].text === '未开始 7 7.7%' && doctoredView.total.indexOf('共 99 条') !== -1 &&
      doctoredView.rows[1].badges[0].text === '未开始 0 0.0%';
    check('矩阵02a 前端原样渲染服务端口径：当接口返回与任务数不符的 count / percentage 时逐字渲染（7 7.7%），不做本地统计、不二次四舍五入、不补齐 100.0%',
      doctoredOk, { first: doctoredView.rows[0] && doctoredView.rows[0].badges[0], total: doctoredView.total });
    await page.unroute('**/api/stats');
    await page.selectOption('#identity-select', '王言');
    await page.waitForTimeout(150);
    await page.selectOption('#identity-select', '项目负责人');
    await waitSignature(stats0);
    const restored = await readOverview();
    compareOverview('矩阵02b 撤下伪响应后按真实 /api/stats 渲染（回到构造数据的 count / percentage）', restored, stats0);

    /* ============ 矩阵04：五色与表格控件完全一致；0 项显示 0 0.0% ============ */
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
    restored.rows.forEach((row) => row.badges.forEach((badge) => {
      const control = tableColors[badge.status] || {};
      const expected = PHASE_COLORS[badge.status] || {};
      if (badge.bg !== control.bg || badge.color !== control.color) {
        colorProblems.push(row.phase + '/' + badge.status + ' 与表格控件不一致 ' + badge.bg + '/' + badge.color + ' vs ' + control.bg + '/' + control.color);
      }
      if (badge.bg !== expected.bg || badge.color !== expected.fg) {
        colorProblems.push(row.phase + '/' + badge.status + ' 五色映射不符 ' + badge.bg + '/' + badge.color);
      }
      if (badge.count === '0' && badge.percentage === '0.0') zeroBadges += 1;
    }));
    check('矩阵04a 五种状态颜色与表格阶段控件逐项一致，且等于五色映射（未开始=灰 / 已开始=蓝 / 已完成=绿 / 延期=红 / 阻塞=黄）',
      colorProblems.length === 0 && Object.keys(tableColors).length === 5 && PHASE_ENUM.every((value) => PHASE_COLORS[value].bg === (tableColors[value] || {}).bg),
      colorProblems.length ? colorProblems.slice(0, 3) : { 表格控件取样: Object.keys(tableColors).length, 徽标: 25 });
    check('矩阵04b 数量为 0 的状态同样显示「0 0.0%」（构造数据含 4 个 0 项状态）', zeroBadges >= 4, { zeroBadges });

    /* ============ 矩阵05：保存 / 新增 / 删除 / 身份切换后实时重算刷新，无陈旧数据 ============ */
    const beforeSave = (await api('/api/stats')).body;
    await page.selectOption('#wbs-body tr[data-id="T001"] td[data-field="dates.design"] select.phase-select', '已完成');
    await page.waitForTimeout(150);
    const draftSignature = await domSignature();
    check('矩阵05a 本地草稿（未保存的阶段改动）不改动总览：总览口径唯一来源是服务端 /api/stats（保存前仍与服务器一致）',
      draftSignature === signatureOf(beforeSave), { draft: draftSignature === signatureOf(beforeSave) });
    await page.click('#save-btn');
    await page.waitForFunction(() => document.getElementById('banner-text').textContent.indexOf('保存成功') !== -1, null, { timeout: 15000 });
    const afterSave = (await api('/api/stats')).body;
    await waitSignature(afterSave);
    const savedView = await readOverview();
    compareOverview('矩阵05b 保存成功后总览实时重算刷新（phase select 改动已计入，= 最新 /api/stats，无陈旧数据）', savedView, afterSave);
    check('矩阵05c 保存后确实发生变化（未开始 8 → 7、已完成 7 → 8），不是沿用旧值',
      signatureOf(beforeSave) !== signatureOf(afterSave) && afterSave.phases[0].statuses[2].count === 8 &&
      afterSave.phases[0].statuses[0].count === 7,
      { before: beforeSave.phases[0].statuses.map((s) => s.count), after: afterSave.phases[0].statuses.map((s) => s.count) });

    /* 新增行 → 保存 → 总数 37，总览随之刷新 */
    await page.click('#add-row-btn');
    await page.waitForFunction(() => document.querySelectorAll('#wbs-body tr').length === 37, null, { timeout: 8000 });
    for (const [field, value] of [['level1', '自测一级'], ['level2', '自测二级'], ['task', 'CH-14 自测新增']]) {
      await page.click('#wbs-body tr[data-id="T037"] td[data-field="' + field + '"]');
      await page.fill('#wbs-body tr[data-id="T037"] td[data-field="' + field + '"] input', value);
      await page.keyboard.press('Tab');
    }
    await page.click('#save-btn');
    await page.waitForFunction(() => document.getElementById('banner-text').textContent.indexOf('保存成功') !== -1, null, { timeout: 15000 });
    const afterAdd = (await api('/api/stats')).body;
    await waitSignature(afterAdd);
    compareOverview('矩阵05d 新增行保存成功后总览实时刷新（任务总数 36 → 37，占比按新分母重算）', await readOverview(), afterAdd);
    check('矩阵05e 新增后分母与占比确实按 37 重算', afterAdd.total === 37 && (await readOverview()).total.indexOf('共 37 条') !== -1,
      { total: afterAdd.total });

    /* 删除行 → 保存 → 总数回落 36 */
    await page.click('#wbs-body tr[data-id="T037"] button[data-delete]');
    await page.waitForFunction(() => document.querySelectorAll('#wbs-body tr').length === 36, null, { timeout: 8000 });
    await page.click('#save-btn');
    await page.waitForFunction(() => document.getElementById('banner-text').textContent.indexOf('保存成功') !== -1, null, { timeout: 15000 });
    const afterDelete = (await api('/api/stats')).body;
    await waitSignature(afterDelete);
    compareOverview('矩阵05f 删除行保存成功后总览实时刷新（任务总数回到 36）', await readOverview(), afterDelete);

    /* 身份切换回到工作台 → 刷新（服务器侧改动 + 切换双触发） */
    const docNow = (await api('/api/wbs')).body;
    docNow.tasks[1].phases.test = '阻塞';
    const putSide = await api('/api/wbs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': String(docNow.meta.revision), 'X-Identity': encodeURIComponent('项目负责人') },
      body: JSON.stringify({ meta: { name: docNow.meta.name }, identities: docNow.identities, tasks: docNow.tasks })
    });
    if (putSide.status !== 200) throw new Error('旁路 PUT 失败：HTTP ' + putSide.status);
    const serverSide = (await api('/api/stats')).body;
    await page.selectOption('#identity-select', '王言');
    await page.waitForTimeout(200);
    await page.selectOption('#identity-select', '项目负责人');
    await waitSignature(serverSide);
    compareOverview('矩阵05g 身份切换回到工作台时实时重算刷新（含服务器侧改动，无陈旧数据）', await readOverview(), serverSide);

    /* ============ 矩阵06：九个身份都能看到；权限与只读提示不回归 ============ */
    const identities = (await api('/api/wbs')).body.identities;
    const identityProblems = [];
    for (const identity of identities) {
      await openWorkbench(identity);
      const statsNow = (await api('/api/stats')).body;
      const view = await readOverview();
      if (!view.exists || view.hidden || view.rows.length !== 5) identityProblems.push(identity + ' 看不到总览条');
      if (signatureOf(statsNow) !== await domSignature()) identityProblems.push(identity + ' 总览与 /api/stats 不一致');
      const pm = identity === '项目负责人';
      const editable = await page.evaluate(() => document.querySelectorAll('#wbs-body select.phase-select:not([disabled])').length);
      const total = await page.evaluate(() => document.querySelectorAll('#wbs-body select.phase-select').length);
      const own = (await api('/api/wbs')).body.tasks.filter((task) => task.owner === identity).length * 5;
      const expected = pm ? total : own;
      if (editable !== expected) identityProblems.push(identity + ' 可编辑阶段控件 ' + editable + ' 期望 ' + expected + '（权限矩阵不回归）');
    }
    check('矩阵06a 九个身份在工作台均可看到同一只读总览（内容与 /api/stats 一致）', identityProblems.length === 0,
      identityProblems.length ? identityProblems.slice(0, 3) : { identities: identities.length });

    await openWorkbench('王言');
    const foreignTask = (await api('/api/wbs')).body.tasks.find((task) => task.owner !== '王言');
    await page.evaluate((id) => { document.querySelector('#wbs-body tr[data-id="' + id + '"] td[data-field="dates.design"]').click(); }, foreignTask.id);
    await page.waitForTimeout(150);
    const readonlyHint = await page.evaluate(() => document.getElementById('hint').textContent);
    check('矩阵06b 非项目负责人点击他人行阶段控件仍给出中文只读提示（权限矩阵与只读提示不回归）',
      readonlyHint.indexOf('只读') !== -1 && readonlyHint.indexOf('王言') !== -1, readonlyHint);

    /* ============ 矩阵07：桌面与 375px 手机宽度无溢出 / 不遮挡表格 / 无横向页面滚动 ============ */
    const measure = () => page.evaluate(() => {
      const bar = document.getElementById('phase-overview');
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
        overlapping: badges.filter((badge) => badge.scrollWidth > badge.clientWidth + 1).length,
        rowsOutOfViewport: rows.filter((row) => row.getBoundingClientRect().right > window.innerWidth + 1 || row.getBoundingClientRect().left < -1).length,
        badgesOutOfViewport: badges.filter((badge) => badge.getBoundingClientRect().right > window.innerWidth + 1 || badge.getBoundingClientRect().left < -1).length,
        badges: badges.length
      };
    });
    const desktop = await measure();
    check('矩阵07a 桌面 1600px：总览条文本/数字不溢出、不遮挡表格、无横向页面滚动',
      desktop.docScrollWidth <= desktop.docClientWidth + 1 && desktop.overlapping === 0 && desktop.badgesOutOfViewport === 0 &&
      desktop.barScrollWidth <= desktop.barClientWidth + 1 && desktop.bar.bottom <= desktop.wrapTop + 1,
      desktop);

    await page.setViewportSize({ width: 375, height: 720 });
    await page.waitForTimeout(350);
    const mobile = await measure();
    const mobileStats = (await api('/api/stats')).body;
    const mobileView = await readOverview();
    compareOverview('矩阵07b 375px 手机宽度：五阶段五行仍各成一组、徽标五项齐全、文案与 /api/stats 一致', mobileView, mobileStats);
    check('矩阵07c 375px：文本与数字不溢出、不遮挡表格、无横向页面滚动（表格仍由 .table-wrap 内部横向滚动）',
      mobile.docScrollWidth <= mobile.docClientWidth + 1 && mobile.bodyScrollWidth <= mobile.innerWidth + 1 &&
      mobile.overlapping === 0 && mobile.badgesOutOfViewport === 0 && mobile.rowsOutOfViewport === 0 &&
      mobile.barScrollWidth <= mobile.barClientWidth + 1 && mobile.bar.bottom <= mobile.wrapTop + 1 && mobile.wrapScrollable === true,
      mobile);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForTimeout(250);

    /* ============ 矩阵10：无外部请求、0 次新增下载、无 pageerror ============ */
    const downloads = await page.evaluate(() => window.__probeRead());
    check('矩阵10a 全程 0 次新增下载（未调用 WBS_DOWNLOAD_HOOK、未创建任何 blob URL、页面无 a[download]）',
      downloads.hook === 0 && downloads.objectUrl === 0 && downloads.anchors === 0, downloads);

    const external = allRequests.filter((r) => r.url.indexOf(BASE) !== 0 && r.url.indexOf('data:') !== 0 && r.url.indexOf('blob:') !== 0);
    check('矩阵10b 全程无外部请求（无 CDN / 外链 / 远程图片），且无 pageerror / console error',
      external.length === 0 && results.page_errors.length === 0 && results.console_errors.length === 0,
      { requests: allRequests.length, external: external.slice(0, 3), pageerrors: results.page_errors.slice(0, 2) });

    await page.setViewportSize({ width: 1600, height: 1000 });
    await openWorkbench('项目负责人');
    await page.screenshot({ path: path.join(OUTDIR, 'page-workbench.png'), fullPage: false });
    await page.setViewportSize({ width: 375, height: 720 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUTDIR, 'page-workbench-375.png'), fullPage: false });
    fs.writeFileSync(path.join(OUTDIR, 'stats-at-end.json'), JSON.stringify((await api('/api/stats')).body));
    fs.writeFileSync(path.join(OUTDIR, 'overview-view.json'), JSON.stringify(await readOverview(), null, 2));
  } catch (err) {
    check('stage17 浏览器用例集执行', false, err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : String(err));
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
