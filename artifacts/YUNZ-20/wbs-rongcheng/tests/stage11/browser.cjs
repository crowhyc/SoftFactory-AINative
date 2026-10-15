'use strict';
/* YUNZ-31 / 变更包 #4（CH-9 隐藏演示范围列 + CH-10 五阶段独立进度 / WBS 与日报重构）真实浏览器自测。
   CH-13 同步（YUNZ-35 / 变更包 #6）：日报不再产出 xlsx，改为「一键可复制关键信息文本」弹层；
   本套件中编码日报 xlsx（今日摘要 A 列 / 两 sheet）的断言已按 CH-13 契约同步为弹层文本断言，
   服务端 /api/daily 的 summary/blocked/changes 数据源断言保持不变（断言强度未降低）。
   运行环境：mcr.microsoft.com/playwright:v1.55.0-jammy 容器（chromium 140，与 playwright 1.55.0 对齐）；
   宿主为 CentOS 7（glibc 2.17），无法直接运行该 Chromium，浏览器只在测试容器内运行，不进产物、不进镜像。
   被测服务（server.js）由本脚本自行 spawn（隔离数据目录 + 迁移前构造边界数据），结束后回收；
   不触碰运行现场 0.0.0.0:4180 与 /opt/wbs-rongcheng/data。
   用法（由 tests/stage11/run.sh 调用）：
     APP_DIR=/app OUTDIR=/app/tests/.tmp/stage11-out DATA_DIR=/app/tests/.tmp/stage11-browser-data \
     node /app/tests/stage11/browser.cjs */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const TOOLS = process.env.TOOLS || '/tools';
const { chromium } = require(path.join(TOOLS, 'node_modules', 'playwright'));

const APP_DIR = process.env.APP_DIR || '/app';
const PORT = Number(process.env.WBS_TEST_PORT || 4240);
const BASE = process.env.BASE || 'http://127.0.0.1:' + PORT;
const OUTDIR = process.env.OUTDIR || '/app/tests/.tmp/stage11-out';
const DATA_DIR = process.env.DATA_DIR || '/app/tests/.tmp/stage11-browser-data';
const TZ = 'Asia/Shanghai';
const PHASES = ['未开始', '已开始', '已完成', '延期', '阻塞'];
const PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep'];
const PHASE_LABELS = { design: '设计', dev: '开发', test: '测试', product: '产品', demo_prep: '演示准备' };
const PHASE_RGB = {
  '未开始': 'rgb(158, 158, 158)', '已开始': 'rgb(47, 128, 237)', '已完成': 'rgb(39, 174, 96)',
  '延期': 'rgb(231, 76, 60)', '阻塞': 'rgb(255, 212, 0)'
};
const PHASE_FILL = { '未开始': 'FF9E9E9E', '已开始': 'FF2F80ED', '已完成': 'FF27AE60', '延期': 'FFE74C3C', '阻塞': 'FFFFD400' };
const PHASE_HEX = { '未开始': '9E9E9E', '已开始': '2F80ED', '已完成': '27AE60', '延期': 'E74C3C', '阻塞': 'FFD400' };
const NOTE_LIMIT = 20000;

const results = { base: BASE, tz: TZ, started_at: new Date().toISOString(), checks: [], page_errors: [], console_errors: [], requests: [] };
let pass = 0, fail = 0;
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
const diskDoc = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wbs.json'), 'utf8'));
const payloadOf = (doc) => ({ meta: { name: doc.meta.name }, identities: doc.identities.slice(), tasks: doc.tasks });
const putDoc = (doc, revision, identity) => api('/api/wbs', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'If-Match': String(revision), 'X-Identity': encodeURIComponent(identity) },
  body: JSON.stringify(payloadOf(doc))
});
const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function shiftDay(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + delta);
  return at.toISOString().slice(0, 10);
}
const mmdd = (dateStr) => String(dateStr).slice(5);

let server = null;
let browser = null;
async function startServer() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(path.join(DATA_DIR, 'wbs.seed.json'))) {
    fs.copyFileSync(path.join(APP_DIR, 'data', 'wbs.seed.json'), path.join(DATA_DIR, 'wbs.seed.json'));
  }
  server = spawn(process.execPath, [path.join(APP_DIR, 'server.js')], {
    cwd: APP_DIR,
    env: Object.assign({}, process.env, { WBS_DATA_DIR: DATA_DIR, WBS_PORT: String(PORT), WBS_HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', (chunk) => process.stderr.write('[server] ' + chunk));
  for (let i = 0; i < 150; i += 1) {
    try { if ((await fetch(BASE + '/api/health')).ok) return; } catch (err) { /* 未就绪 */ }
    await sleep(100);
  }
  throw new Error('被测服务未就绪');
}
function stopServer() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    const child = server;
    server = null;
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(resolve, 3000);
  });
}

const allRequests = [];
function trackPage(page) {
  page.on('request', (request) => allRequests.push({ url: request.url(), method: request.method() }));
  page.on('pageerror', (e) => results.page_errors.push(String(e && e.message ? e.message : e)));
  page.on('console', (m) => { if (m.type() === 'error') results.console_errors.push(m.text()); });
}

/* 迁移前构造边界数据：日期均为「昨天 / 今天」两类，迁移后 phases 才可预期。 */
function craftedSeed(today) {
  const seed = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'data', 'wbs.seed.json'), 'utf8'));
  const yesterday = shiftDay(today, -1);
  const byId = {};
  seed.tasks.forEach((task) => { byId[task.id] = task; });
  byId.T001.dates.design = yesterday;   // 到期未更新（今日无人更新）→ 判定延期
  byId.T002.dates.design = yesterday;   // 今日改状态为已完成 → 只出「完成」，不再判到期未更新
  byId.T003.dates.dev = today;          // 边界：恰好今天 → 未开始（不判延期）
  byId.T004.dates.test = yesterday;     // 到期未更新；其 dev 今日改为阻塞 → 一任务多事件
  byId.T005.dates.product = yesterday;  // 今日改为已完成 → 只出「完成」
  return seed;
}

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const today = todayStr();
  const yesterday = shiftDay(today, -1);
  try {
    fs.rmSync(path.join(DATA_DIR, 'wbs.json'), { force: true });
    fs.rmSync(path.join(DATA_DIR, 'audit.log'), { force: true });
    fs.readdirSync(DATA_DIR).forEach((f) => {
      if (/^wbs\.json\.\d{14}(\.rollback)?\.bak$/.test(f)) fs.rmSync(path.join(DATA_DIR, f), { force: true });
    });
    fs.writeFileSync(path.join(DATA_DIR, 'wbs.json'), JSON.stringify(craftedSeed(today), null, 2) + '\n');
    await startServer();
    console.log('[env] 被测服务 ' + BASE + '（data: ' + DATA_DIR + '，today=' + today + '）');

    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    results.browser_version = browser.version();
    console.log('[env] chromium=' + browser.version());
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    trackPage(page);
    const hint = () => page.evaluate(() => (document.getElementById('hint').hidden ? '' : document.getElementById('hint').textContent.trim()));
    const banner = () => page.evaluate(() => (document.getElementById('banner').hidden ? '' : document.getElementById('banner-text').textContent.trim()));
    const identity = async (name) => { await page.selectOption('#identity-select', name); await page.waitForTimeout(300); };
    const openWorkbench = async (name) => {
      await page.goto(BASE + '/');
      await page.evaluate((id) => { window.localStorage.setItem('wbs.identity', id); }, name);
      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll('#wbs-body tr').length === 36, null, { timeout: 15000 });
      await page.waitForTimeout(200);
    };
    const phaseCell = (rowId, key) => '#wbs-body tr[data-id="' + rowId + '"] td[data-field="dates.' + key + '"]';
    const setPhase = async (rowId, key, value) => {
      await page.selectOption(phaseCell(rowId, key) + ' select.phase-select', value);
      await page.waitForTimeout(150);
    };
    const saveAndWait = async () => {
      await page.click('#save-btn');
      await page.waitForFunction(() => document.getElementById('banner-text').textContent.indexOf('保存成功') !== -1, null, { timeout: 15000 });
      await page.waitForTimeout(200);
    };
    const setDate = async (rowId, key, value) => {
      await page.fill(phaseCell(rowId, key) + ' input.date-input', value);
      await page.waitForTimeout(150);
    };
    const capture = async (buttonId, fileName) => {
      await page.evaluate(() => {
        window.__cap = null;
        const toB64 = (bytes) => {
          let out = '';
          for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
          return btoa(out);
        };
        window.WBS_DOWNLOAD_HOOK = (bytes, name) => { window.__cap = { name: name, b64: toB64(bytes), length: bytes.length }; };
      });
      await page.click(buttonId);
      for (let i = 0; i < 80; i += 1) {
        if (await page.evaluate(() => window.__cap !== null)) break;
        await sleep(200);
      }
      const captured = await page.evaluate(() => window.__cap);
      if (captured && fileName) fs.writeFileSync(path.join(OUTDIR, fileName), Buffer.from(captured.b64, 'base64'));
      return captured;
    };
    /* CH-13：日报弹层采集（打开弹层 → 读文本 + 采集「无下载」证据 → 返回 /api/daily 快照）。 */
    const openDailyText = async () => {
      await page.evaluate(() => {
        window.__cap = null;
        window.__objUrls = 0;
        window.WBS_DOWNLOAD_HOOK = (bytes, name) => { window.__cap = { name: name, length: bytes.length }; };
        const create = window.URL.createObjectURL.bind(window.URL);
        window.URL.createObjectURL = function (blob) { window.__objUrls += 1; return create(blob); };
      });
      await page.click('#daily-btn');
      await page.waitForFunction(() => document.getElementById('daily-panel').hidden === false, null, { timeout: 15000 });
      await page.waitForTimeout(200);
      const view = await page.evaluate(() => ({
        text: document.getElementById('daily-text').textContent,
        whiteSpace: getComputedStyle(document.getElementById('daily-text')).whiteSpace,
        role: (document.querySelector('#daily-panel .modal-card') || {}).getAttribute
          ? document.querySelector('#daily-panel .modal-card').getAttribute('role') : null,
        hook: window.__cap,
        objectUrls: window.__objUrls,
        anchors: document.querySelectorAll('a[download]').length,
        xlsxApi: typeof window.WBSCore.buildDailyWorkbook + '/' + typeof window.WBSCore.dailyBytes
      }));
      const payload = (await api('/api/daily?tz=' + TZ + '&date=' + today)).body;
      return { view: view, api: payload };
    };
    const closeDailyText = async () => {
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.getElementById('daily-panel').hidden === true, null, { timeout: 15000 });
    };

    /* ============ 迁移（启动即一次性执行，隔离实例） ============ */
    const migrated = (await api('/api/wbs')).body;
    const migratedDisk = diskDoc();
    const backups = fs.readdirSync(DATA_DIR).filter((f) => /^wbs\.json\.\d{14}\.bak$/.test(f));
    const auditLines = fs.readFileSync(path.join(DATA_DIR, 'audit.log'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const migratedAudit = auditLines.filter((e) => e.type === 'migrated');
    check('矩阵04a 一次性迁移：每行 phases 由 dates.* 派生（早于今天→延期，否则→未开始）且 revision 递增',
      migrated.meta.revision === 1 &&
      migrated.tasks.every((t) => PHASE_KEYS.every((k) => PHASES.indexOf(t.phases[k]) !== -1)) &&
      migrated.tasks.find((t) => t.id === 'T001').phases.design === '延期' &&
      migrated.tasks.find((t) => t.id === 'T003').phases.dev === '未开始' &&
      migrated.tasks.find((t) => t.id === 'T003').phases.test === '未开始',
      { revision: migrated.meta.revision, T001: migrated.tasks.find((t) => t.id === 'T001').phases });
    check('矩阵04b 迁移前落时间戳备份、每阶段一条 type:"migrated" 审计（身份「系统迁移」）',
      backups.length === 1 && migratedAudit.length === 36 * PHASE_KEYS.length &&
      migratedAudit.every((e) => e.identity === '系统迁移' && typeof e.phase === 'string' && PHASES.indexOf(e.new) !== -1) &&
      migratedDisk.tasks.every((t) => Array.isArray(Object.keys(t.phases))),
      { backups: backups.length, migratedAudit: migratedAudit.length, sample: migratedAudit[0] });
    check('矩阵04c 迁移幂等：迁移审计不出现在 /api/history，也不产生「今日摘要」事件',
      ((await api('/api/history?tz=' + TZ + '&date=' + today)).body.records || []).length === 0 &&
      ((await api('/api/daily?tz=' + TZ + '&date=' + today)).body.changes || []).length === 0,
      'history=0 / changes=0（仅 migrated 审计）');
    check('矩阵05 迁移边界：恰好今天→未开始、昨天→延期、缺失日期→未开始',
      migrated.tasks.find((t) => t.id === 'T003').phases.dev === '未开始' &&
      migrated.tasks.find((t) => t.id === 'T001').phases.design === '延期' &&
      migrated.tasks.find((t) => t.id === 'T001').phases.test === '未开始',
      { today: today, yesterday: yesterday });

    /* ============ 矩阵01：五阶段下拉常显 + 五色映射 ============ */
    await openWorkbench('项目负责人');
    const layout = await page.evaluate(() => {
      const tr = document.querySelector('#wbs-body tr[data-id="T001"]');
      const cells = Array.from(tr.querySelectorAll('td.cell-date'));
      return cells.map((cell) => {
        const input = cell.querySelector('input.date-input');
        const select = cell.querySelector('select.phase-select');
        const options = select ? Array.from(select.options).map((o) => ({ value: o.value, bg: o.style.backgroundColor })) : [];
        return {
          field: cell.getAttribute('data-field'),
          hasSelect: !!select,
          disabled: select ? select.disabled : null,
          value: select ? select.value : null,
          options: options,
          below: input && select ? (select.getBoundingClientRect().top >= input.getBoundingClientRect().bottom - 2) : false,
          color: select ? getComputedStyle(select).backgroundColor : null
        };
      });
    });
    check('矩阵01a 五个日期列下方各常显一个五档下拉（五枚举选项齐全、位于日期输入下方）',
      layout.length === 5 && layout.every((c) => c.hasSelect && c.options.length === 5 &&
        JSON.stringify(c.options.map((o) => o.value)) === JSON.stringify(PHASES) && c.below === true),
      layout.map((c) => c.field + ':' + c.value));

    const colorRows = await page.evaluate(async () => {
      const out = [];
      const rows = Array.from(document.querySelectorAll('#wbs-body tr'));
      const picks = [];
      rows.slice(0, 5).forEach((tr) => picks.push(tr.getAttribute('data-id')));
      for (const id of picks) {
        const cell = document.querySelector('#wbs-body tr[data-id="' + id + '"] td[data-field="dates.design"]');
        const select = cell.querySelector('select.phase-select');
        out.push({ id, value: select.value, color: getComputedStyle(select).backgroundColor, cls: select.className });
      }
      return out;
    });
    const observed = {};
    colorRows.forEach((r) => { observed[r.value] = { color: r.color, cls: r.cls }; });
    check('矩阵01b 当前值以颜色块展示（未开始=灰 / 已开始=蓝 / 已完成=绿 / 延期=红 / 阻塞=黄）',
      observed['未开始'] && observed['未开始'].color === PHASE_RGB['未开始'] &&
      observed['延期'] && observed['延期'].color === PHASE_RGB['延期'],
      observed);
    const optionColors = await page.evaluate(() => {
      const select = document.querySelector('#wbs-body tr[data-id="T001"] td[data-field="dates.design"] select.phase-select');
      const out = {};
      Array.from(select.options).forEach((option) => {
        out[option.value] = getComputedStyle(option).backgroundColor;
      });
      return out;
    });
    check('矩阵01c 下拉选项同样带对应颜色（option 计算背景色 = 五色映射，CSP style-src self 下用类名着色）',
      Object.keys(PHASE_RGB).every((phase) => optionColors[phase] === PHASE_RGB[phase]), optionColors);

    /* 在 T003 上把五列改成五种阶段，逐一断言 computed 背景色；不点保存，改完直接重载丢弃草稿，
       既覆盖「五色都可呈现」，又不产生当日审计噪声。 */
    const fiveValues = {};
    for (let i = 0; i < PHASE_KEYS.length; i += 1) {
      await setPhase('T003', PHASE_KEYS[i], PHASES[i]);
      fiveValues[PHASES[i]] = await page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).backgroundColor, phaseCell('T003', PHASE_KEYS[i]) + ' select.phase-select');
    }
    check('矩阵01d 五色映射逐值命中（computed background-color）',
      JSON.stringify(fiveValues) === JSON.stringify(PHASE_RGB), fiveValues);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#wbs-body tr').length === 36, null, { timeout: 15000 });
    await identity('项目负责人');

    /* ============ 矩阵02：权限边界与只读提示 ============ */
    const pmSide = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('#wbs-body td[data-field^="dates."] select.phase-select'));
      return { total: selects.length, disabled: selects.filter((s) => s.disabled).length };
    });
    check('矩阵02a 项目负责人：全部行的五阶段下拉均可交互', pmSide.total === 36 * 5 && pmSide.disabled === 0, pmSide);

    await identity('王言');
    const ownIds = (await api('/api/wbs')).body.tasks.filter((t) => t.owner === '王言').map((t) => t.id);
    const normalSide = await page.evaluate((ownIds) => {
      const rows = Array.from(document.querySelectorAll('#wbs-body tr'));
      let ownEnabled = 0, ownTotal = 0, foreignEnabled = 0, foreignTotal = 0;
      rows.forEach((tr) => {
        const id = tr.getAttribute('data-id');
        const selects = Array.from(tr.querySelectorAll('td[data-field^="dates."] select.phase-select'));
        if (ownIds.indexOf(id) !== -1) { ownTotal += selects.length; ownEnabled += selects.filter((s) => !s.disabled).length; }
        else { foreignTotal += selects.length; foreignEnabled += selects.filter((s) => !s.disabled).length; }
      });
      return { ownEnabled, ownTotal, foreignEnabled, foreignTotal };
    }, ownIds);
    check('矩阵02b 普通负责人：仅本人行可改、他人行全部 disabled',
      normalSide.ownTotal > 0 && normalSide.ownEnabled === normalSide.ownTotal && normalSide.foreignEnabled === 0 && normalSide.foreignTotal > 0,
      normalSide);
    const foreignId = (await api('/api/wbs')).body.tasks.find((t) => t.owner !== '王言').id;
    await page.click(phaseCell(foreignId, 'design') + ' .phase-cell');
    await page.waitForTimeout(200);
    const foreignHint = await hint();
    check('矩阵02c 无权限行点击给中文只读提示（沿用既有行为）',
      foreignHint.indexOf('只读') !== -1 && foreignHint.indexOf('设计进度') !== -1, foreignHint);

    /* ============ 矩阵03：页 / API / 磁盘三端一致 ============ */
    await setPhase('T002', 'dev', '已开始');
    await setPhase('T002', 'test', '阻塞');
    await saveAndWait();
    const afterSaveApi = (await api('/api/wbs')).body.tasks.find((t) => t.id === 'T002');
    const afterSaveDisk = diskDoc().tasks.find((t) => t.id === 'T002');
    const afterSavePage = await page.evaluate(() => {
      const cell = document.querySelector('#wbs-body tr[data-id="T002"] td[data-field="dates.test"] select.phase-select');
      return { dev: document.querySelector('#wbs-body tr[data-id="T002"] td[data-field="dates.dev"] select.phase-select').value, test: cell.value };
    });
    check('矩阵03 阶段状态改动走既有点击保存流程，页 / API / 磁盘三端一致',
      afterSaveApi.phases.dev === '已开始' && afterSaveApi.phases.test === '阻塞' &&
      afterSaveDisk.phases.dev === '已开始' && afterSaveDisk.phases.test === '阻塞' &&
      afterSavePage.dev === '已开始' && afterSavePage.test === '阻塞',
      { api: afterSaveApi.phases, page: afterSavePage });

    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#wbs-body tr').length === 36, null, { timeout: 15000 });
    await identity('王言');
    const afterReload = await page.evaluate(() => document.querySelector('#wbs-body tr[data-id="T002"] td[data-field="dates.test"] select.phase-select').value);
    check('矩阵03b 刷新后阶段进度仍在（重启/刷新持久）', afterReload === '阻塞', afterReload);

    /* ============ 矩阵06：保存 + 409 并发保护 ============ */
    const beforeConflict = (await api('/api/wbs')).body;
    const staleRevision = beforeConflict.meta.revision;
    const foreign = JSON.parse(JSON.stringify(beforeConflict));
    foreign.tasks.find((t) => t.id === 'T002').phases.demo_prep = '已开始';
    const firstWrite = await putDoc(foreign, staleRevision, '项目负责人');
    await setPhase('T002', 'product', '已完成');
    await page.click('#save-btn');
    await page.waitForFunction(() => document.getElementById('banner-text').textContent.indexOf('版本冲突') !== -1, null, { timeout: 15000 });
    const conflictBanner = await banner();
    const afterConflict = (await api('/api/wbs')).body.tasks.find((t) => t.id === 'T002');
    check('矩阵06 并发保存 409 不覆盖：基于旧版本的保存被拒、磁盘保留先到者',
      firstWrite.status === 200 && conflictBanner.indexOf('版本冲突') !== -1 &&
      afterConflict.phases.demo_prep === '已开始' && afterConflict.phases.product !== '已完成',
      { first: firstWrite.status, banner: conflictBanner.slice(0, 40), product: afterConflict.phases.product });

    await openWorkbench('项目负责人');

    /* ============ 构造当日事件（用于 08 / 09 / 10 / 07 的读回） ============ */
    await identity('项目负责人');
    await setPhase('T003', 'test', '延期');     // 当天新增延期
    await setPhase('T004', 'dev', '阻塞');      // 当天更新为阻塞
    await setPhase('T005', 'product', '已完成');// 当天完成（同时抑制该阶段到期未更新）
    await setPhase('T002', 'design', '已完成'); // 当天完成（抑制 T002 设计到期未更新）
    await saveAndWait();
    await setDate('T006', 'test', '2026-11-01');
    await saveAndWait();
    await setDate('T006', 'test', '2026-11-05');
    await saveAndWait();

    const daily = (await api('/api/daily?tz=' + TZ + '&date=' + today)).body;
    const lines = daily.summary.map((row) => row.line);
    const findLine = (needle) => lines.filter((line) => line.indexOf(needle) !== -1);
    const t001Line = '【延期·高风险】客户端 / 业务工作台 / 业需导入 @李欢：设计 ' + mmdd(yesterday) + ' 到期未更新，判定延期。';
    const t004Line = '【延期·高风险】客户端 / 业务工作台 / 详细设计与评审 @张航瑞：测试 ' + mmdd(yesterday) + ' 到期未更新，判定延期。';
    check('矩阵08a 今日摘要逐字模板：【重要度】一级 / 二级 / 任务项 @负责人：结论。（含 @ 与风险前缀）',
      lines.indexOf(t001Line) !== -1 && lines.indexOf(t004Line) !== -1,
      { expect: t001Line, lines: lines });
    check('矩阵09a 派生规则①：计划日期 < 今天且今日无更新 → 到期未更新判定延期，归属当前负责人',
      findLine('到期未更新，判定延期').length === 2 && lines.indexOf(t001Line) !== -1,
      findLine('到期未更新，判定延期'));
    check('矩阵09b 派生规则②：当天已更新该阶段状态 → 按实际状态出事件，不重复判定到期未更新',
      findLine('需求拆分 @王言：阶段已完成').length === 1 && findLine('程序设计 @张航瑞：阶段已完成').length === 1 &&
      findLine('需求拆分').filter((l) => l.indexOf('到期未更新') !== -1).length === 0 &&
      findLine('程序设计').filter((l) => l.indexOf('到期未更新') !== -1).length === 0,
      { t002: findLine('需求拆分'), t005: findLine('程序设计') });
    check('矩阵08b 五类前缀与结论模板逐字命中（延期/阻塞/完成/普通/到期未更新）',
      lines.indexOf('【延期·高风险】客户端 / 业务工作台 / 概要设计&评审 @王言：测试延期。') !== -1 &&
      lines.indexOf('【阻塞·高风险】客户端 / 业务工作台 / 详细设计与评审 @张航瑞：阶段更新为阻塞。') !== -1 &&
      lines.indexOf('【完成】客户端 / 业务工作台 / 需求拆分 @王言：阶段已完成。') !== -1 &&
      lines.indexOf('【完成】客户端 / 业务工作台 / 程序设计 @张航瑞：阶段已完成。') !== -1 &&
      lines.indexOf('【普通】客户端 / 业务工作台 / 代码开发 @郑述文：测试计划 11-01 → 11-05。') !== -1,
      lines);
    const rank = (line) => {
      if (line.indexOf('【延期·高风险】') === 0 && line.indexOf('到期未更新') === -1) return 1;
      if (line.indexOf('【阻塞·高风险】') === 0) return 2;
      if (line.indexOf('到期未更新') !== -1) return 3;
      if (line.indexOf('【完成】') === 0) return 4;
      return 5;
    };
    const ranks = daily.summary.map((row) => rank(row.line));
    check('矩阵08c 今日摘要按重要度排序：延期 > 阻塞 > 到期未更新判定延期 > 完成 > 普通变更；一任务多事件多行',
      ranks.join(',') === ranks.slice().sort((a, b) => a - b).join(',') &&
      daily.summary.filter((row) => row.task === '详细设计与评审').length === 2,
      { ranks: ranks, t004: daily.summary.filter((row) => row.task === '详细设计与评审').map((r) => r.conclusion) });
    /* CH-13：日报不再产出 xlsx，改为弹层文本（服务端 /api/daily 的 summary 数据源仍保留）。 */
    const dailyPopup = await openDailyText();
    const popupLines = dailyPopup.api.text.lines;
    const dailyDoc = (await api('/api/wbs')).body;
    const dTask = (id) => dailyDoc.tasks.find((t) => t.id === id);
    const dLine = (prefix, id, conclusion) => '【' + prefix + '】' + dTask(id).level1 + ' / ' + dTask(id).level2 +
      ' / ' + dTask(id).task + ' @' + dTask(id).owner + '：' + conclusion + '。';
    const expectPopupLines = [
      dLine('延期·高风险', 'T001', '设计 ' + mmdd(yesterday) + ' 到期未更新，判定延期'),
      dLine('延期·高风险', 'T003', '测试延期'),
      dLine('延期·高风险', 'T004', '测试 ' + mmdd(yesterday) + ' 到期未更新，判定延期'),
      dLine('阻塞·高风险', 'T002', '测试更新为阻塞'),
      dLine('阻塞·高风险', 'T004', '开发更新为阻塞')
    ];
    check('矩阵08d 点「导出日报」打开只读文本弹层，文本 = /api/daily 的关键信息文本（同一份字符串，逐行一致；CH-13 取代今日摘要 A 列 xlsx）',
      dailyPopup.view.role === 'dialog' && dailyPopup.view.whiteSpace === 'pre-wrap' &&
      dailyPopup.view.text === dailyPopup.api.text.body &&
      dailyPopup.view.text.split('\n')[0] === '今日延期 ' + dailyPopup.api.text.delayedCount + ' 项 / 阻塞 ' + dailyPopup.api.text.blockedCount + ' 项' &&
      dailyPopup.api.text.delayedCount === 3 && dailyPopup.api.text.blockedCount === 2 &&
      JSON.stringify(popupLines) === JSON.stringify(expectPopupLines) &&
      daily.summary.some((row) => row.at && /^\d{4}-\d{2}-\d{2}T/.test(row.at)),
      { overview: dailyPopup.view.text.split('\n')[0], lines: popupLines, expect: expectPopupLines, summaryRows: daily.summary.length });
    await closeDailyText();

    /* CH-7：新增人员 → 服务端审计/日报数据源含「人员池」行（CH-12 起不再进日报导出） */
    await page.click('#add-person-btn');
    await page.waitForTimeout(200);
    await page.fill('#new-person-name', '赵新');
    await page.click('#new-person-confirm');
    await page.waitForFunction(() => document.getElementById('add-person-panel').hidden, null, { timeout: 15000 });
    await page.waitForTimeout(400);
    const daily2 = (await api('/api/daily?tz=' + TZ + '&date=' + today)).body;
    const poolRow = daily2.changes.filter((row) => row.field === '人员池' && row.new === '赵新');
    check('矩阵10c CH-7 新增人员审计行仍在 /api/daily changes 数据源中（改动字段 人员池 / 旧值空 / 新值姓名）',
      poolRow.length === 1 && poolRow[0].old === '' && poolRow[0].identity === '项目负责人',
      poolRow[0]);
    const dailyPopupExport = await openDailyText();
    check('矩阵10a 日报只体现阻塞、延期：无「完成 / 普通」事件、无当日普通变更（完成阶段与日期改动都不进日报；CH-13）',
      dailyPopupExport.api.text.lines.every((l) => l.indexOf('【完成】') === -1 && l.indexOf('【普通】') === -1 && l.indexOf('【到期未更新】') === -1) &&
      popupLines.every((l) => /^【(延期|阻塞)·高风险】.+ \/ .+ \/ .+ @.+：.+。$/.test(l)) &&
      dailyPopupExport.api.text.lines.length === expectPopupLines.length &&
      Array.isArray(dailyPopupExport.api.changes) && dailyPopupExport.api.changes.length > 0,
      { lines: dailyPopupExport.api.text.lines.length, changes: dailyPopupExport.api.changes.length });
    await closeDailyText();

    /* ============ 矩阵07 / 10：导出真实产物（xlsx 读回在宿主 python 侧完成） ============ */
    const docAtExport = (await api('/api/wbs')).body;
    fs.writeFileSync(path.join(OUTDIR, 'wbs-at-export.json'), JSON.stringify(docAtExport));
    const dailyAtExport = (await api('/api/daily?tz=' + TZ + '&date=' + today)).body;
    fs.writeFileSync(path.join(OUTDIR, 'daily-at-export.json'), JSON.stringify(dailyAtExport));
    const wbs = await capture('#export-btn', 'WBS-' + today + '.xlsx');
    results.wbsExport = { name: wbs.name, length: wbs.length };
    results.dailyExport = { mode: 'text-popup', lines: dailyPopupExport.api.text.lines.length, download: dailyPopupExport.view.hook };
    check('矩阵07a 页面「导出 Excel」真实产物已生成（文件名 蓉城战役WBS-YYYYMMDD.xlsx）',
      /^蓉城战役WBS-\d{8}\.xlsx$/.test(String(wbs.name)) && wbs.length > 100000, wbs.name);
    check('矩阵07b WBS 导出模板首行/表头保真（页面侧 SheetJS 读回）',
      await page.evaluate(async (b64) => {
        const wb = window.XLSX.read(b64, { type: 'base64' });
        const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
        return rows[0].some((c) => String(c).indexOf('基础说明') === 0) &&
          String(rows[1][3]) === '负责人' && String(rows[1][4]) === '是否演示范围' && String(rows[1][10]) === '进展说明' &&
          String(rows[1][11]) === '设计进度' && String(rows[1][15]) === '演示准备进度' &&
          wb.SheetNames.length === 1;
      }, wbs.b64), 'L–P 表头 = 五个进度列');
    check('矩阵10b 页面「导出日报」不再产出与下载 xlsx（无 WBS_DOWNLOAD_HOOK 调用 / createObjectURL / a[download] / xlsx 组装 API），只打开文本弹层（CH-13）',
      dailyPopupExport.view.hook === null && dailyPopupExport.view.objectUrls === 0 &&
      dailyPopupExport.view.anchors === 0 && dailyPopupExport.view.xlsxApi === 'undefined/undefined',
      { hook: dailyPopupExport.view.hook, objectUrls: dailyPopupExport.view.objectUrls, anchors: dailyPopupExport.view.anchors, xlsxApi: dailyPopupExport.view.xlsxApi });

    /* ============ 矩阵11：回归（CH-1…CH-8 / D-3 / 验收 1–10 / Markdown / 无外部请求） ============ */
    await openWorkbench('项目负责人');
    const identitiesCount = (await api('/api/wbs')).body.identities.length;
    const layerState = await page.evaluate(() => ({
      layerDisplay: getComputedStyle(document.getElementById('identity-layer')).display,
      layerHidden: document.getElementById('identity-layer').hidden,
      workbenchHidden: document.getElementById('workbench').hidden,
      identities: document.querySelectorAll('#identity-list button').length
    }));
    const regression = await page.evaluate(() => {
      const body = document.querySelectorAll('#wbs-body tr');
      const demoHeader = Array.from(document.querySelectorAll('#wbs-table thead th')).map((th) => th.textContent.trim());
      return {
        rows: body.length,
        headers: demoHeader,
        demoCells: document.querySelectorAll('#wbs-body td[data-field="demo"]').length,
        demoEditors: document.querySelectorAll('#wbs-body select[data-edit-field="demo"]').length,
        statusCells: document.querySelectorAll('#wbs-body td[data-field="status"]').length,
        statusSelects: document.querySelectorAll('#wbs-body select[data-edit-field="status"]').length,
        editButtons: document.querySelectorAll('#wbs-body button[data-edit-row]').length,
        deleteButtons: document.querySelectorAll('#wbs-body button[data-delete]').length,
        noteTextareas: document.querySelectorAll('#wbs-body td[data-field="note"] textarea').length,
        dateInputs: Array.from(document.querySelectorAll('#wbs-body tr[data-id="T001"] td[data-field^="dates."] input.date-input')).map((i) => i.type),
        ownerOptions: Array.from(document.querySelector('#wbs-body tr[data-id="T001"] td[data-field="owner"] select').options).map((o) => o.value),
        ids: Array.from(body).map((tr) => tr.getAttribute('data-id'))
      };
    });
    check('矩阵11a 回归(D-3/验收1) 身份遮罩 [hidden] 级联生效、身份数=人员池、工作台渲染 36 行且顺序与 seed 一致',
      layerState.layerDisplay === 'none' && layerState.layerHidden === true && layerState.workbenchHidden === false &&
      layerState.identities === identitiesCount && regression.rows === 36 &&
      regression.ids[0] === 'T001' && regression.ids[35] === 'T036',
      { identities: layerState.identities, rows: regression.rows });
    check('矩阵11b 回归(CH-1) 操作列每行常显「编辑」+ 项目负责人「删除」；K 列仍为摘要单元格（无内联 textarea）',
      regression.editButtons === regression.rows && regression.deleteButtons === regression.rows && regression.noteTextareas === 0,
      { edit: regression.editButtons, del: regression.deleteButtons });
    check('矩阵11c 回归(CH-9) 网页不渲染「是否演示范围」列、无任何编辑入口；表头不含该列',
      regression.demoCells === 0 && regression.demoEditors === 0 &&
      regression.headers.indexOf('是否演示范围') === -1,
      regression.headers);
    check('矩阵11d 回归(CH-10) 旧全局「状态」列已从网页移除（无单元格、无下拉）',
      regression.statusCells === 0 && regression.statusSelects === 0, { cells: regression.statusCells });
    check('矩阵11e 回归(CH-2) 五列日期常显 type=date；负责人列为人员池下拉',
      regression.dateInputs.length === 5 && regression.dateInputs.every((t) => t === 'date') &&
      JSON.stringify(regression.ownerOptions) === JSON.stringify((await api('/api/wbs')).body.identities),
      regression.ownerOptions.length);

    /* CH-8：Markdown 编辑器与转义安全不回归 */
    await page.click('#wbs-body tr[data-id="T002"] td[data-field="note"]');
    await page.waitForFunction(() => !document.getElementById('note-panel').hidden, null, { timeout: 10000 });
    const markdown = '# 回归标题\n**粗体** <script>window.__xss=1</script> ![远程图](https://example.com/a.png)';
    await page.fill('#note-input', markdown);
    await page.waitForTimeout(400);
    const noteState = await page.evaluate(() => ({
      xss: !!window.__xss,
      images: document.querySelectorAll('#note-preview img').length,
      strong: document.querySelectorAll('#note-preview strong').length,
      heading: document.querySelectorAll('#note-preview h1').length,
      text: document.getElementById('note-preview').textContent
    }));
    check('矩阵11f 回归(CH-8) Markdown 子集渲染生效；原始 HTML 转义不执行、远程图片不解析不加载',
      noteState.xss === false && noteState.images === 0 && noteState.strong === 1 && noteState.heading === 1 &&
      noteState.text.indexOf('<script>') !== -1,
      noteState);
    await page.click('#note-save');
    await page.waitForFunction(() => document.getElementById('banner-text').textContent.indexOf('保存成功') !== -1, null, { timeout: 15000 });
    const noteSaved = (await api('/api/wbs')).body.tasks.find((t) => t.id === 'T002').note;
    check('矩阵11g 回归(CH-8) 进展说明经大尺寸面板保存后落盘', noteSaved.indexOf('回归标题') !== -1, noteSaved.slice(0, 24));

    /* 服务重启后数据仍在 */
    await stopServer();
    await startServer();
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#wbs-body tr').length === 36, null, { timeout: 15000 });
    const afterRestart = await page.evaluate(() => ({
      phase: document.querySelector('#wbs-body tr[data-id="T002"] td[data-field="dates.test"] select.phase-select').value,
      note: document.querySelector('#wbs-body tr[data-id="T002"] td[data-field="note"] .note-summary').textContent
    }));
    check('矩阵11h 回归 服务重启后阶段进度与进展说明仍在（重启持久）',
      afterRestart.phase === '阻塞' && afterRestart.note.indexOf('回归标题') !== -1, afterRestart);

    const external = allRequests.filter((r) => r.url.indexOf(BASE) !== 0);
    check('矩阵11i 回归 全程无外部资源请求（无 CDN / 外链 / 远程图片）',
      external.length === 0 && results.page_errors.length === 0,
      { requests: allRequests.length, external: external.slice(0, 3) });
    check('矩阵11j 回归 全程无 pageerror', results.page_errors.length === 0, results.page_errors.slice(0, 2));

    await page.screenshot({ path: path.join(OUTDIR, 'page-workbench.png'), fullPage: false });
  } catch (err) {
    check('stage11 浏览器用例集执行', false, err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : String(err));
  } finally {
    try { if (browser) await browser.close(); } catch (err) { /* ignore */ }
    await stopServer();
  }
  results.checks_summary = { pass: pass, fail: fail };
  results.requests = allRequests;
  fs.writeFileSync(path.join(OUTDIR, 'browser-results.json'), JSON.stringify(results, null, 2));
  console.log('---');
  console.log('PASS=' + pass + ' FAIL=' + fail);
  process.exit(fail === 0 ? 0 : 1);
})();
