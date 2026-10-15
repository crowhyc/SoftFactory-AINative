'use strict';
/* YUNZ-35 / 变更包 #6（CH-13 日报改为「一键可复制关键信息文本」弹层）真实浏览器自测。
   运行环境：mcr.microsoft.com/playwright:v1.55.0-jammy 容器（chromium 140，与 playwright 1.55.0 对齐）；
   宿主为 CentOS 7（glibc 2.17），无法直接运行该 Chromium，浏览器只在测试容器内运行，不进产物、不进镜像。
   被测服务（server.js）由本脚本自行 spawn（隔离数据目录 + 隔离的构造数据），结束后回收；
   不触碰运行现场 0.0.0.0:4180 与 /opt/wbs-rongcheng/data。
   用法（由 tests/stage15/run.sh 调用）：
     APP_DIR=/app OUTDIR=/app/tests/.tmp/stage15-out DATA_DIR=/app/tests/.tmp/stage15-browser-data \
     node /app/tests/stage15/browser.cjs */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const TOOLS = process.env.TOOLS || '/tools';
const { chromium } = require(path.join(TOOLS, 'node_modules', 'playwright'));

const APP_DIR = process.env.APP_DIR || '/app';
const PORT = Number(process.env.WBS_TEST_PORT || 4265);
const BASE = process.env.BASE || 'http://127.0.0.1:' + PORT;
const BASE2 = process.env.BASE2 || 'http://127.0.0.1:' + (PORT + 1);
const OUTDIR = process.env.OUTDIR || '/app/tests/.tmp/stage15-out';
const DATA_DIR = process.env.DATA_DIR || '/app/tests/.tmp/stage15-browser-data';
const DATA_DIR2 = DATA_DIR + '-quiet';
const TZ = 'Asia/Shanghai';
const PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep'];
const COPY_OK = '已复制，可直接粘贴到微信';

const results = { base: BASE, tz: TZ, started_at: new Date().toISOString(), checks: [], page_errors: [], console_errors: [], requests: [] };
let pass = 0, fail = 0;
function check(id, ok, detail) {
  results.checks.push({ id, ok: !!ok, detail: detail === undefined ? null : detail });
  if (ok) { pass += 1; console.log('PASS  ' + id + (detail !== undefined ? '  :: ' + JSON.stringify(detail) : '')); }
  else { fail += 1; console.log('FAIL  ' + id + '  -> ' + JSON.stringify(detail)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (url, init, base) => {
  const response = await fetch((base || BASE) + url, init);
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch (err) { body = text; }
  return { status: response.status, body };
};
const payloadOf = (doc) => ({ meta: { name: doc.meta.name }, identities: doc.identities.slice(), tasks: doc.tasks });
const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function shiftDay(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + delta);
  return at.toISOString().slice(0, 10);
}
const mmdd = (dateStr) => String(dateStr).slice(5);

/* 基准文档：全部计划日期在未来、全部阶段「未开始」（不起迁移、无历史审计）。 */
function baseDoc(today) {
  const seed = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'data', 'wbs.seed.json'), 'utf8'));
  const far = shiftDay(today, 90);
  seed.meta.revision = 0;
  seed.tasks.forEach((task, index) => {
    task.dates = {};
    task.phases = {};
    PHASE_KEYS.forEach((key, phaseIndex) => {
      task.dates[key] = shiftDay(far, (index + phaseIndex) % 20);
      task.phases[key] = '未开始';
    });
  });
  return seed;
}
const findTask = (doc, id) => doc.tasks.find((task) => task.id === id);

/* 构造用例（今日 PUT 之前先落盘的部分）：当前状态 + 仍处于阻塞 + 派生候选。 */
function craftedDoc(today) {
  const doc = baseDoc(today);
  const yesterday = shiftDay(today, -1);
  const twoWeeksAgo = shiftDay(today, -14);
  findTask(doc, 'T001').dates.design = yesterday;   // 当前状态=延期（今日未更新）
  findTask(doc, 'T001').phases.design = '延期';
  findTask(doc, 'T002').dates.dev = yesterday;      // 派生：计划日期 < 今天且今日未更新
  findTask(doc, 'T002').dates.test = yesterday;     // 同一任务第二事件
  findTask(doc, 'T002').phases.test = '阻塞';        // 仍处于阻塞（今日未更新）
  findTask(doc, 'T003').dates.test = yesterday;     // 今日 PUT 改状态 → 不重复派生
  findTask(doc, 'T005').dates.design = yesterday;   // 今日 PUT 改状态（已开始）→ 不重复派生
  findTask(doc, 'T005').dates.product = yesterday;  // 今日 PUT 改状态为已完成 → 不进日报
  findTask(doc, 'T006').dates.dev = twoWeeksAgo;    // 今日 PUT 改日期（仍是过去日期）→ 不派生
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

const allRequests = [];
function trackPage(page) {
  page.on('request', (request) => allRequests.push({ url: request.url(), method: request.method() }));
  page.on('pageerror', (e) => results.page_errors.push(String(e && e.message ? e.message : e)));
  page.on('console', (m) => { if (m.type() === 'error') results.console_errors.push(m.text()); });
}

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const today = todayStr();
  const yesterday = shiftDay(today, -1);
  let browser = null;
  try {
    [DATA_DIR, DATA_DIR2].forEach((dir) => {
      fs.mkdirSync(dir, { recursive: true });
      fs.readdirSync(dir).forEach((f) => fs.rmSync(path.join(dir, f), { force: true }));
    });
    fs.writeFileSync(path.join(DATA_DIR, 'wbs.json'), JSON.stringify(craftedDoc(today), null, 2) + '\n');
    spawnServer('A', PORT, DATA_DIR);
    await waitReady(BASE);
    console.log('[env] 被测服务 A ' + BASE + '（data: ' + DATA_DIR + '，today=' + today + '）');

    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    results.browser_version = browser.version();
    console.log('[env] chromium=' + browser.version());
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    trackPage(page);

    const openWorkbench = async (base) => {
      await page.goto((base || BASE) + '/');
      await page.evaluate(() => { window.localStorage.setItem('wbs.identity', '项目负责人'); });
      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll('#wbs-body tr').length === 36, null, { timeout: 15000 });
      await page.waitForTimeout(200);
    };
    const phaseCell = (rowId, key) => '#wbs-body tr[data-id="' + rowId + '"] td[data-field="dates.' + key + '"]';
    const setPhase = async (rowId, key, value) => {
      await page.selectOption(phaseCell(rowId, key) + ' select.phase-select', value);
      await page.waitForTimeout(150);
    };
    const setDate = async (rowId, key, value) => {
      await page.fill(phaseCell(rowId, key) + ' input.date-input', value);
      await page.waitForTimeout(150);
    };

    /* ============ 今日更新（写入当日审计）：T003 状态阻塞 / T005 状态（已开始+已完成）/ T006 日期 ============ */
    await openWorkbench();
    await setPhase('T003', 'test', '阻塞');       // 当天新出现的阻塞 → 「测试更新为阻塞。」
    await setPhase('T005', 'design', '已开始');   // 当天已更新 → 不派生「到期未更新」
    await setPhase('T005', 'product', '已完成');  // 完成不进日报
    await setDate('T006', 'dev', yesterday);      // 当天改日期（仍是过去日期）→ 不派生
    await page.click('#save-btn');
    await page.waitForFunction(() => document.getElementById('banner-text').textContent.indexOf('保存成功') !== -1, null, { timeout: 15000 });
    await page.waitForTimeout(300);

    const docAtExport = (await api('/api/wbs')).body;
    fs.writeFileSync(path.join(OUTDIR, 'wbs-at-export.json'), JSON.stringify(docAtExport));
    const daily = (await api('/api/daily?tz=' + TZ + '&date=' + today)).body;
    fs.writeFileSync(path.join(OUTDIR, 'daily-at-export.json'), JSON.stringify(daily));
    const apiBody = daily.text.body;
    const apiLines = daily.text.lines;
    const line = (prefix, id, conclusion) => {
      const task = findTask(docAtExport, id);
      return '【' + prefix + '】' + task.level1 + ' / ' + task.level2 + ' / ' + task.task + ' @' + task.owner + '：' + conclusion + '。';
    };
    const expectLines = [
      line('延期·高风险', 'T001', '设计 ' + mmdd(yesterday) + ' 到期未更新，判定延期'),
      line('延期·高风险', 'T002', '开发 ' + mmdd(yesterday) + ' 到期未更新，判定延期'),
      line('阻塞·高风险', 'T002', '测试阻塞'),
      line('阻塞·高风险', 'T003', '测试更新为阻塞')
    ];

    /* ============ 矩阵01：点击「导出日报」打开只读文本弹层（非下载、无 blob / xlsx 组装） ============ */
    await page.evaluate(() => {
      window.__cap = null;
      window.__objectUrls = 0;
      window.WBS_DOWNLOAD_HOOK = (bytes, name) => { window.__cap = { name: name, length: bytes.length }; };
      const create = window.URL.createObjectURL.bind(window.URL);
      window.URL.createObjectURL = function (blob) { window.__objectUrls += 1; return create(blob); };
    });
    const panelHiddenBefore = await page.evaluate(() => document.getElementById('daily-panel').hidden);
    await page.click('#daily-btn');
    await page.waitForFunction(() => document.getElementById('daily-panel').hidden === false, null, { timeout: 15000 });
    await page.waitForTimeout(200);
    const opened = await page.evaluate(() => {
      const panel = document.getElementById('daily-panel');
      const card = panel.querySelector('.modal-card');
      const block = document.getElementById('daily-text');
      return {
        hidden: panel.hidden,
        dialogRole: card ? card.getAttribute('role') : null,
        ariaModal: card ? card.getAttribute('aria-modal') : null,
        label: document.getElementById('daily-title') ? document.getElementById('daily-title').textContent.trim() : null,
        text: block.textContent,
        whiteSpace: getComputedStyle(block).whiteSpace,
        readOnly: block.tagName,
        copyBtn: !!document.getElementById('daily-copy'),
        closeBtn: !!document.getElementById('daily-close'),
        downloadHookCalls: window.__cap,
        objectUrls: window.__objectUrls,
        anchorDownloads: document.querySelectorAll('a[download]').length,
        dailyXlsxApi: typeof window.WBSCore.buildDailyWorkbook + '/' + typeof window.WBSCore.dailyBytes,
        banner: document.getElementById('banner-text').textContent.trim()
      };
    });
    results.opened = opened;
    check('矩阵01a 页面「导出日报」打开只读文本弹层（点击前 hidden，点击后可见；沿用 modal 视觉体系：role=dialog / aria-modal）',
      panelHiddenBefore === true && opened.hidden === false && opened.dialogRole === 'dialog' && opened.ariaModal === 'true' &&
      opened.copyBtn === true && opened.closeBtn === true,
      { panelHiddenBefore, hidden: opened.hidden, role: opened.dialogRole, copy: opened.copyBtn, close: opened.closeBtn });
    check('矩阵01b 「导出日报」不再有下载行为：无 WBS_DOWNLOAD_HOOK 调用、无 createObjectURL、无 a[download]、无日报 xlsx 组装 API',
      opened.downloadHookCalls === null && opened.objectUrls === 0 && opened.anchorDownloads === 0 &&
      opened.dailyXlsxApi === 'undefined/undefined',
      { hook: opened.downloadHookCalls, objectUrls: opened.objectUrls, anchorDownloads: opened.anchorDownloads, xlsxApi: opened.dailyXlsxApi });

    /* ============ 矩阵06 / 02：弹层文本 = /api/daily.text（同一份字符串）与概况行 ============ */
    check('矩阵06 弹层只读文本块内容 = /api/daily 返回的同一份字符串（逐字一致，保留换行的 pre-wrap 只读展示）',
      opened.text === apiBody && opened.whiteSpace === 'pre-wrap' &&
      opened.text.split('\n').slice(1).every((l) => /^【(延期|阻塞)·高风险】.+ @.+：.+。$/.test(l)),
      { display: opened.text.split('\n'), api: apiBody.split('\n'), whiteSpace: opened.whiteSpace });
    check('矩阵02 顶部概况行 = 「今日延期 X 项 / 阻塞 Y 项」，X/Y 与弹层内事件行数一致（且与 /api/daily text 计数一致）',
      opened.text.split('\n')[0] === '今日延期 2 项 / 阻塞 2 项' &&
      opened.text.split('\n').filter((l) => l.indexOf('【延期·高风险】') === 0).length === 2 &&
      opened.text.split('\n').filter((l) => l.indexOf('【阻塞·高风险】') === 0).length === 2 &&
      daily.text.delayedCount === 2 && daily.text.blockedCount === 2,
      { first: opened.text.split('\n')[0], lines: opened.text.split('\n').length - 1, counts: { delayed: daily.text.delayedCount, blocked: daily.text.blockedCount } });
    check('矩阵06 事件行逐字命中「【延期·高风险】/【阻塞·高风险】一级 / 二级 / 任务项 @负责人：结论。」（@ 与高风险前缀保留；只含阻塞、延期）',
      JSON.stringify(opened.text.split('\n')) === JSON.stringify([daily.text.overview].concat(expectLines)) &&
      apiLines.every((l) => /^【(延期|阻塞)·高风险】.+ \/ .+ \/ .+ @.+：.+。$/.test(l)),
      { expect: [daily.text.overview].concat(expectLines), actual: opened.text.split('\n') });
    check('矩阵03 弹层内延期条目在前、阻塞条目在后（同类内按任务与阶段顺序稳定排列）',
      opened.text.split('\n').slice(1).every((l, i) => l === expectLines[i]),
      opened.text.split('\n').slice(1));
    check('矩阵04 派生「到期未更新，判定延期」入弹层（当前状态=延期但计划日期已过且今日未更新时同样用派生结论）；当天已更新过的阶段（T003 测试 / T005 设计 / T006 开发）不重复判定',
      opened.text.indexOf('开发 ' + mmdd(yesterday) + ' 到期未更新，判定延期') !== -1 &&
      opened.text.indexOf('设计 ' + mmdd(yesterday) + ' 到期未更新，判定延期') !== -1 &&
      opened.text.split('\n').filter((l) => l.indexOf('到期未更新') !== -1).length === 2 &&
      opened.text.indexOf('概要设计&评审') === opened.text.lastIndexOf('概要设计&评审') &&
      opened.text.indexOf('程序设计') === -1 && opened.text.indexOf('代码开发') === -1,
      { derived: opened.text.split('\n').filter((l) => l.indexOf('到期未更新') !== -1) });

    /* ============ 矩阵07：复制两条路径与中文提示（真实剪贴板 + 兜底 + 双失败） ============ */
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    await page.click('#daily-copy');
    await page.waitForFunction((m) => document.getElementById('daily-msg').textContent === m, COPY_OK, { timeout: 10000 });
    const clipBoard = await page.evaluate(async () => {
      let read = null;
      try { read = await navigator.clipboard.readText(); } catch (err) { read = 'READ_ERROR:' + String(err && err.message); }
      return { read, msg: document.getElementById('daily-msg').textContent, msgClass: document.getElementById('daily-msg').className };
    });
    check('矩阵07a 复制成功路径：navigator.clipboard 写入真实剪贴板内容 = 弹层文本逐字一致，并提示「已复制，可直接粘贴到微信」',
      clipBoard.read === opened.text && clipBoard.msg === COPY_OK,
      { clipboard: clipBoard.read.split('\n').slice(0, 2), msg: clipBoard.msg });

    const fallback = await page.evaluate(async () => {
      window.__copyProbe = { execCalls: [], selected: null };
      const originalExec = document.execCommand;
      document.execCommand = function (cmd) {
        window.__copyProbe.execCalls.push(cmd);
        const area = document.querySelector('textarea[aria-hidden="true"]');
        window.__copyProbe.selected = area ? area.value : null;
        return true;
      };
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        get: () => ({ writeText: () => Promise.reject(new Error('NotAllowedError')) })
      });
      document.getElementById('daily-copy').click();
      for (let i = 0; i < 60; i += 1) {
        await new Promise((r) => setTimeout(r, 100));
        if (window.__copyProbe.execCalls.length) break;
      }
      await new Promise((r) => setTimeout(r, 200));
      const out = { probe: window.__copyProbe, msg: document.getElementById('daily-msg').textContent };
      document.execCommand = originalExec;
      return out;
    });
    check('矩阵07b 兜底路径：navigator.clipboard 失败时走「选择 + document.execCommand(\'copy\')」，仍提示复制成功',
      fallback.probe.execCalls.indexOf('copy') !== -1 && fallback.probe.selected === opened.text && fallback.msg === COPY_OK,
      { execCalls: fallback.probe.execCalls, selectedLen: fallback.probe.selected ? fallback.probe.selected.length : null, msg: fallback.msg });

    const bothFail = await page.evaluate(async () => {
      const originalExec = document.execCommand;
      document.execCommand = function () { return false; };
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        get: () => ({ writeText: () => Promise.reject(new Error('NotAllowedError')) })
      });
      document.getElementById('daily-copy').click();
      await new Promise((r) => setTimeout(r, 500));
      const out = { msg: document.getElementById('daily-msg').textContent, hidden: document.getElementById('daily-msg').hidden };
      document.execCommand = originalExec;
      return out;
    });
    check('矩阵07c 两条路径都失败时给出中文失败提示（不静默、不报错中断）',
      bothFail.hidden === false && bothFail.msg.indexOf('复制失败') !== -1 && bothFail.msg !== COPY_OK,
      bothFail);

    /* ============ 矩阵08：关闭 / Esc / 不影响工作台未保存编辑状态 ============ */
    await page.screenshot({ path: path.join(OUTDIR, 'page-daily-popup.png') });
    await page.click('#daily-close');
    const afterClose = await page.evaluate(() => ({
      hidden: document.getElementById('daily-panel').hidden,
      msgHidden: document.getElementById('daily-msg').hidden
    }));
    check('矩阵08a 关闭按钮可关闭弹层（并清掉复制提示）',
      afterClose.hidden === true && afterClose.msgHidden === true, afterClose);

    await page.click('#daily-btn');
    await page.waitForFunction(() => document.getElementById('daily-panel').hidden === false, null, { timeout: 15000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const afterEsc = await page.evaluate(() => ({
      hidden: document.getElementById('daily-panel').hidden,
      confirmHidden: document.getElementById('note-confirm').hidden,
      notePanelHidden: document.getElementById('note-panel').hidden
    }));
    check('矩阵08b Esc 可关闭弹层（只读展示、无未保存内容，不弹确认框）',
      afterEsc.hidden === true && afterEsc.confirmHidden === true, afterEsc);

    /* 未保存编辑状态：进入 T001 行编辑态、改一个日期但不保存 → 打开/关闭日报弹层后草稿仍在、未触发保存。 */
    const revisionBefore = (await api('/api/wbs')).body.meta.revision;
    await page.click('#wbs-body tr[data-id="T001"] button[data-edit-row]');
    await page.waitForTimeout(200);
    const draftValue = shiftDay(today, -3);
    await page.fill('#wbs-body tr[data-id="T001"] td[data-field="dates.dev"] input.date-input', draftValue);
    await page.waitForTimeout(200);
    const draftBefore = await page.evaluate(() => ({
      value: document.querySelector('#wbs-body tr[data-id="T001"] td[data-field="dates.dev"] input.date-input').value,
      session: document.getElementById('session-status').textContent
    }));
    await page.click('#daily-btn');
    await page.waitForFunction(() => document.getElementById('daily-panel').hidden === false, null, { timeout: 15000 });
    await page.click('#daily-close');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const draftAfter = await page.evaluate(() => ({
      value: document.querySelector('#wbs-body tr[data-id="T001"] td[data-field="dates.dev"] input.date-input').value,
      editing: !!document.querySelector('#wbs-body tr[data-id="T001"].row-editing'),
      panelHidden: document.getElementById('daily-panel').hidden,
      notePanelHidden: document.getElementById('note-panel').hidden
    }));
    const revisionAfter = (await api('/api/wbs')).body.meta.revision;
    check('矩阵08c 打开/关闭日报弹层不影响工作台未保存编辑状态（草稿值保留、行编辑态保留、未触发任何保存、未改动磁盘）',
      draftBefore.value === draftValue && draftAfter.value === draftValue && draftAfter.editing === true &&
      draftAfter.panelHidden === true && revisionBefore === revisionAfter &&
      draftBefore.session.indexOf('未保存') !== -1,
      { draft: draftAfter.value, editing: draftAfter.editing, revision: [revisionBefore, revisionAfter], session: draftBefore.session });

    /* ============ 矩阵05：无事件兜底（隔离实例 B：全部计划日期在未来、无当日审计） ============ */
    fs.writeFileSync(path.join(DATA_DIR2, 'wbs.json'), JSON.stringify(baseDoc(today), null, 2) + '\n');
    spawnServer('B', PORT + 1, DATA_DIR2);
    await waitReady(BASE2);
    const quietApi = (await api('/api/daily?tz=' + TZ + '&date=' + today, undefined, BASE2)).body;
    await openWorkbench(BASE2);
    await page.click('#daily-btn');
    await page.waitForFunction(() => document.getElementById('daily-panel').hidden === false, null, { timeout: 15000 });
    const quiet = await page.evaluate(() => ({
      text: document.getElementById('daily-text').textContent,
      lines: document.getElementById('daily-text').textContent.split('\n').length
    }));
    fs.writeFileSync(path.join(OUTDIR, 'daily-quiet.json'), JSON.stringify(quietApi));
    check('矩阵05 无任何阻塞/延期时弹层整体文本只有一行「今日无阻塞、延期。」（无概况行；与 /api/daily 一致）',
      quiet.text === '今日无阻塞、延期。' && quiet.lines === 1 && quietApi.text.body === quiet.text &&
      quietApi.text.lines.length === 0,
      { display: quiet.text, api: quietApi.text });
    await page.keyboard.press('Escape');
    await stopServer('B');

    /* ============ 回归：无外部资源请求 / 无 pageerror ============ */
    const external = allRequests.filter((r) => r.url.indexOf(BASE) !== 0 && r.url.indexOf(BASE2) !== 0 && r.url.indexOf('data:') !== 0 && r.url.indexOf('blob:') !== 0);
    check('矩阵09 回归 全程无外部资源请求（无 CDN / 外链 / 远程图片）且无 pageerror（日报弹层不引入任何外链）',
      external.length === 0 && results.page_errors.length === 0,
      { requests: allRequests.length, external: external.slice(0, 3), pageerrors: results.page_errors.slice(0, 2) });

    await page.screenshot({ path: path.join(OUTDIR, 'page-workbench.png'), fullPage: false });
  } catch (err) {
    check('stage15 浏览器用例集执行', false, err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : String(err));
  } finally {
    try { if (browser) await browser.close(); } catch (err) { /* ignore */ }
    await stopServer('A');
    await stopServer('B');
  }
  results.checks_summary = { pass: pass, fail: fail };
  results.requests = allRequests;
  fs.writeFileSync(path.join(OUTDIR, 'browser-results.json'), JSON.stringify(results, null, 2));
  console.log('---');
  console.log('PASS=' + pass + ' FAIL=' + fail);
  process.exit(fail === 0 ? 0 : 1);
})();
