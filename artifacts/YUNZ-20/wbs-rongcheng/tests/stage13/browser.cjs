'use strict';
/* YUNZ-33 / 变更包 #5（CH-11 今日摘要只保留 A 列 + CH-12 日报删除「当日变更」sheet）真实浏览器自测。
   CH-13 同步（YUNZ-35 / 变更包 #6）：日报不再产出 xlsx，改为「一键可复制关键信息文本」弹层；
   本套件的日报条目已按 CH-13 契约同步（等价断言：弹层文本逐字 / 概况行计数 / 排序 / 派生与去重 / 无事件兜底），
   断言强度未降低；更完整的弹层交互（复制两条路径、关闭与 Esc、未保存编辑不受影响）见 tests/stage15/。
   运行环境：mcr.microsoft.com/playwright:v1.55.0-jammy 容器（chromium 140，与 playwright 1.55.0 对齐）；
   宿主为 CentOS 7（glibc 2.17），无法直接运行该 Chromium，浏览器只在测试容器内运行，不进产物、不进镜像。
   被测服务（server.js）由本脚本自行 spawn（隔离数据目录 + 构造边界数据，phases 显式给出、不起迁移），结束后回收；
   不触碰运行现场 0.0.0.0:4180 与 /opt/wbs-rongcheng/data。
   用法（由 tests/stage13/run.sh 调用）：
     APP_DIR=/app OUTDIR=/app/tests/.tmp/stage13-out DATA_DIR=/app/tests/.tmp/stage13-browser-data \
     node /app/tests/stage13/browser.cjs */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const TOOLS = process.env.TOOLS || '/tools';
const { chromium } = require(path.join(TOOLS, 'node_modules', 'playwright'));

const APP_DIR = process.env.APP_DIR || '/app';
const PORT = Number(process.env.WBS_TEST_PORT || 4260);
const BASE = process.env.BASE || 'http://127.0.0.1:' + PORT;
const BASE2 = process.env.BASE2 || 'http://127.0.0.1:' + (PORT + 1);
const OUTDIR = process.env.OUTDIR || '/app/tests/.tmp/stage13-out';
const DATA_DIR = process.env.DATA_DIR || '/app/tests/.tmp/stage13-browser-data';
const DATA_DIR2 = DATA_DIR + '-quiet';
const TZ = 'Asia/Shanghai';
const PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep'];
const PHASES = ['未开始', '已开始', '已完成', '延期', '阻塞'];
/* CH-13：旧日报 xlsx /「当日变更」口径字样（「结论」不再是特征：新文本格式本身含「：结论。」）。 */
const REMOVED_TOKENS = ['当日变更', '改动字段', '旧值', '新值', '操作身份', '重要度', '依据'];

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

/* 构造边界数据（CH-13 同步）：phases 显式给出（全部「未开始」）→ 服务端不起迁移，
   于是「计划日期 < 今天且今日无人更新」的阶段可稳定地派生「到期未更新，判定延期」。 */
function craftedSeed(today) {
  const seed = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'data', 'wbs.seed.json'), 'utf8'));
  const yesterday = shiftDay(today, -1);
  seed.tasks.forEach((task) => {
    task.phases = {};
    PHASE_KEYS.forEach((key) => { task.phases[key] = '未开始'; });
  });
  const byId = {};
  seed.tasks.forEach((task) => { byId[task.id] = task; });
  byId.T001.dates.design = yesterday;   // 今日无人更新 → 派生「到期未更新，判定延期」
  byId.T002.dates.design = yesterday;   // 今日改状态为已完成 → 抑制派生、完成不进日报
  byId.T003.dates.dev = today;          // 边界：恰好今天 → 不判延期
  byId.T004.dates.test = yesterday;     // 今日无人更新 → 派生；其 dev 今日改为阻塞 → 一任务多事件
  byId.T005.dates.product = yesterday;  // 今日改为已完成 → 抑制派生、完成不进日报
  return seed;
}

/* 迁移前构造「无事件」数据：所有计划日期都在未来、当日无审计 → 今日摘要走兜底行。 */
function quietSeed(today) {
  const seed = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'data', 'wbs.seed.json'), 'utf8'));
  const future = shiftDay(today, 60);
  const far = shiftDay(today, 90);
  seed.tasks.forEach((task) => {
    PHASE_KEYS.forEach((key, index) => { task.dates[key] = shiftDay(future, index * 3); });
    if (task.dates.demo_prep > far) task.dates.demo_prep = far;
  });
  return seed;
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
      fs.rmSync(path.join(dir, 'wbs.json'), { force: true });
      fs.rmSync(path.join(dir, 'audit.log'), { force: true });
      fs.readdirSync(dir).forEach((f) => {
        if (/^wbs\.json\.\d{14}(\.rollback)?\.bak$/.test(f)) fs.rmSync(path.join(dir, f), { force: true });
      });
    });
    fs.writeFileSync(path.join(DATA_DIR, 'wbs.json'), JSON.stringify(craftedSeed(today), null, 2) + '\n');
    spawnServer('A', PORT, DATA_DIR);
    await waitReady(BASE);
    console.log('[env] 被测服务 A ' + BASE + '（data: ' + DATA_DIR + '，today=' + today + '）');

    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    results.browser_version = browser.version();
    console.log('[env] chromium=' + browser.version());
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    trackPage(page);
    const identity = async (name) => { await page.selectOption('#identity-select', name); await page.waitForTimeout(300); };
    const openWorkbench = async (name, base) => {
      await page.goto((base || BASE) + '/');
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
    const setDate = async (rowId, key, value) => {
      await page.fill(phaseCell(rowId, key) + ' input.date-input', value);
      await page.waitForTimeout(150);
    };
    const saveAndWait = async () => {
      await page.click('#save-btn');
      await page.waitForFunction(() => document.getElementById('banner-text').textContent.indexOf('保存成功') !== -1, null, { timeout: 15000 });
      await page.waitForTimeout(200);
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

    /* ============ 构造当日事件（矩阵 03 的排序与逐字模板） ============ */
    await openWorkbench('项目负责人');
    await identity('项目负责人');
    await setPhase('T003', 'test', '延期');      // 当天新增延期
    await setPhase('T004', 'dev', '阻塞');       // 当天更新为阻塞
    await setPhase('T005', 'product', '已完成'); // 当天完成（同时抑制该阶段到期未更新）
    await setPhase('T002', 'design', '已完成');  // 当天完成（抑制 T002 设计到期未更新）
    await saveAndWait();
    await setDate('T006', 'test', '2026-11-01');
    await saveAndWait();
    await setDate('T006', 'test', '2026-11-05'); // 普通变更（日期计划改动）
    await saveAndWait();

    /* ============ 矩阵06（前半）：CH-7 新增人员仍写审计 / /api/history 仍返回 ============ */
    await page.click('#add-person-btn');
    await page.waitForTimeout(300);
    await page.fill('#new-person-name', '赵新');
    await page.click('#new-person-confirm');
    await page.waitForFunction(() => document.getElementById('add-person-panel').hidden, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    const auditEntries = fs.readFileSync(path.join(DATA_DIR, 'audit.log'), 'utf8').trim().split('\n')
      .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
    const identityAdds = auditEntries.filter((e) => e && e.type === 'identity_added' && e.name === '赵新');
    const history = (await api('/api/history?tz=' + TZ + '&date=' + today)).body;
    const poolEvents = (history.records || []).filter((r) => r.field === '人员池' && r.new === '赵新');

    /* ============ 矩阵01–04（CH-13）：日报改为「一键可复制关键信息文本」弹层，不再产出日报 xlsx ============ */
    const openDaily = async () => {
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
      const view = await page.evaluate(() => {
        const panel = document.getElementById('daily-panel');
        const card = panel.querySelector('.modal-card');
        const block = document.getElementById('daily-text');
        return {
          hidden: panel.hidden,
          role: card ? card.getAttribute('role') : null,
          ariaModal: card ? card.getAttribute('aria-modal') : null,
          text: block.textContent,
          whiteSpace: getComputedStyle(block).whiteSpace,
          copyBtn: !!document.getElementById('daily-copy'),
          closeBtn: !!document.getElementById('daily-close'),
          hook: window.__cap,
          objectUrls: window.__objUrls,
          anchors: document.querySelectorAll('a[download]').length,
          dailyXlsxApi: typeof window.WBSCore.buildDailyWorkbook + '/' + typeof window.WBSCore.dailyBytes
        };
      });
      const payload = (await api('/api/daily?tz=' + TZ + '&date=' + today)).body;
      return { view: view, api: payload };
    };

    const docAtExport = (await api('/api/wbs')).body;
    fs.writeFileSync(path.join(OUTDIR, 'wbs-at-export.json'), JSON.stringify(docAtExport));
    const taskById = {};
    docAtExport.tasks.forEach((t) => { taskById[t.id] = t; });
    const line = (prefix, taskId, conclusion) => '【' + prefix + '】' + taskById[taskId].level1 + ' / ' + taskById[taskId].level2 +
      ' / ' + taskById[taskId].task + ' @' + taskById[taskId].owner + '：' + conclusion + '。';

    const dailyPopup = await openDaily();
    const daily = dailyPopup.api;
    const dailyText = daily.text;
    const lines = dailyText.lines;
    const findLine = (needle) => lines.filter((l) => l.indexOf(needle) !== -1);
    fs.writeFileSync(path.join(OUTDIR, 'daily-at-export.json'), JSON.stringify(daily));
    results.dailyText = dailyText;
    const expectLines = [
      line('延期·高风险', 'T001', '设计 ' + mmdd(yesterday) + ' 到期未更新，判定延期'),
      line('延期·高风险', 'T003', '测试延期'),
      line('延期·高风险', 'T004', '测试 ' + mmdd(yesterday) + ' 到期未更新，判定延期'),
      line('阻塞·高风险', 'T004', '开发更新为阻塞')
    ];
    check('矩阵01 点「导出日报」打开只读文本弹层（role=dialog / aria-modal / 复制 + 关闭按钮），且不再产出与下载日报 xlsx（无 WBS_DOWNLOAD_HOOK 调用 / createObjectURL / a[download] / xlsx 组装 API）',
      dailyPopup.view.hidden === false && dailyPopup.view.role === 'dialog' && dailyPopup.view.ariaModal === 'true' &&
      dailyPopup.view.copyBtn === true && dailyPopup.view.closeBtn === true &&
      dailyPopup.view.hook === null && dailyPopup.view.objectUrls === 0 && dailyPopup.view.anchors === 0 &&
      dailyPopup.view.dailyXlsxApi === 'undefined/undefined',
      { role: dailyPopup.view.role, copy: dailyPopup.view.copyBtn, close: dailyPopup.view.closeBtn, hook: dailyPopup.view.hook, anchors: dailyPopup.view.anchors, xlsxApi: dailyPopup.view.dailyXlsxApi });
    check('矩阵01b 弹层只读文本块内容 = /api/daily 的关键信息文本（同一份字符串；pre-wrap 保留换行）',
      dailyPopup.view.text === dailyText.body && dailyPopup.view.whiteSpace === 'pre-wrap' && lines.length > 0,
      { whiteSpace: dailyPopup.view.whiteSpace, lines: lines.length });
    check('矩阵02 顶部概况行固定为「今日延期 X 项 / 阻塞 Y 项」，X/Y = 弹层内事件行数（与 /api/daily 计数一致）',
      dailyPopup.view.text.split('\n')[0] === '今日延期 3 项 / 阻塞 1 项' &&
      dailyText.delayedCount === 3 && dailyText.blockedCount === 1 &&
      dailyText.body === [dailyText.overview].concat(lines).join('\n'),
      { overview: dailyPopup.view.text.split('\n')[0], delayed: dailyText.delayedCount, blocked: dailyText.blockedCount, lines: lines.length });
    check('矩阵04 弹层文本不残留旧日报口径字样（当日变更 / 改动字段 / 旧值 / 新值 / 操作身份 / 重要度 / 依据）',
      REMOVED_TOKENS.filter((token) => dailyPopup.view.text.indexOf(token) !== -1).length === 0,
      REMOVED_TOKENS);
    check('矩阵02b 日报只体现阻塞、延期：无「完成 / 普通」事件（完成阶段与当日普通变更都不进日报，数据源仍保留）',
      lines.every((l) => l.indexOf('【完成】') === -1 && l.indexOf('【普通】') === -1 && l.indexOf('【到期未更新】') === -1) &&
      lines.length === 4 && Array.isArray(daily.changes) && daily.changes.length > 0 && Array.isArray(daily.summary),
      { lines: lines.length, changes: daily.changes.length });
    check('矩阵03a 事件行逐字「【延期·高风险】/【阻塞·高风险】一级 / 二级 / 任务项 @负责人：结论。」（含 @ 与高风险前缀）',
      JSON.stringify(lines) === JSON.stringify(expectLines) &&
      lines.every((l) => /^【(延期|阻塞)·高风险】.+ \/ .+ \/ .+ @.+：.+。$/.test(l)),
      { expect: expectLines, actual: lines });
    check('矩阵03b 延期条目在前、阻塞条目在后；一任务多事件多行（T004 同时命中「延期·高风险」与「阻塞·高风险」）',
      lines.slice(0, 3).every((l) => l.indexOf('【延期·高风险】') === 0) &&
      lines[3].indexOf('【阻塞·高风险】') === 0 &&
      findLine('详细设计与评审').length === 2,
      { ranks: lines.map((l) => (l.indexOf('【延期·高风险】') === 0 ? 1 : 2)), t004: findLine('详细设计与评审').length });
    check('矩阵03c 派生规则「{阶段} MM-DD 到期未更新，判定延期。」逐字命中（T001 设计 / T004 测试，MM-DD = 昨日）',
      findLine('到期未更新，判定延期').length === 2 &&
      lines.indexOf(line('延期·高风险', 'T001', '设计 ' + mmdd(yesterday) + ' 到期未更新，判定延期')) === 0 &&
      lines.indexOf(line('延期·高风险', 'T004', '测试 ' + mmdd(yesterday) + ' 到期未更新，判定延期')) === 2,
      findLine('到期未更新，判定延期'));
    check('矩阵03d 当天已更新过的阶段按实际状态归类、不重复派生「到期未更新」（T002 设计今日改已完成、T006 今日改日期 → 均无条目）',
      findLine('需求拆分').length === 0 && findLine('代码开发').length === 0,
      { t002: findLine('需求拆分'), t006: findLine('代码开发') });
    /* 收尾：关闭日报弹层（后续 WBS 导出断言需要页面可点击）。 */
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('daily-panel').hidden === true, null, { timeout: 15000 });

    /* ============ 矩阵05：WBS 导出不回归（五色 / A–K / L–P / Q1） ============ */
    const wbs = await capture('#export-btn', 'WBS-' + today + '.xlsx');
    results.wbsExport = { name: wbs.name, length: wbs.length };
    const wbsShape = await page.evaluate(async (base64) => {
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
        lastRowCells: rows[rows.length - 1].slice(0, 17)
      };
    }, wbs.b64);
    results.wbsShape = wbsShape;
    check('矩阵05a WBS 导出仍为单 sheet、A–K 与模板第 1/2 行逐字保真、L–P 追加五个进度列表头（Q1 导出日期标签）',
      wbsShape.sheetNames.length === 1 &&
      JSON.stringify(wbsShape.row1.slice(0, 11)) === JSON.stringify(wbsShape.templateRow1.slice(0, 11)) &&
      JSON.stringify(wbsShape.header.slice(0, 11)) === JSON.stringify(wbsShape.templateRow2.slice(0, 11)) &&
      /* CH-15（YUNZ-39）同步：导出 L2:P2 五进度表头随网页列头改名，产品进度 → 产品验收进度。 */
      JSON.stringify(wbsShape.header.slice(11, 16)) === JSON.stringify(['设计进度', '开发进度', '测试进度', '产品验收进度', '演示准备进度']) &&
      /^导出日期：\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(wbsShape.row1[16])),
      { sheets: wbsShape.sheetNames, l2p: wbsShape.header.slice(11, 16), q1: wbsShape.row1[16] });

    /* ============ 矩阵06（后半）：CH-7 数据源行 + 导出不含当日变更 ============ */
    const poolChanges = (daily.changes || []).filter((r) => r.field === '人员池' && r.new === '赵新');
    check('矩阵06 identity_added 仍写审计、/api/history 仍返回人员池行、/api/daily 数据源仍含该行（导出已不含当日变更 sheet）',
      identityAdds.length === 1 && identityAdds[0].identity === '项目负责人' && Date.parse(identityAdds[0].at) > 0 &&
      poolEvents.length === 1 && poolEvents[0].old === '' && poolEvents[0].task === '新增人员 赵新' &&
      poolChanges.length === 1 && poolChanges[0].old === '' && poolChanges[0].identity === '项目负责人' &&
      ((await api('/api/wbs')).body.identities || []).indexOf('赵新') !== -1,
      { audit: identityAdds.length, history: poolEvents.length, dailyChanges: poolChanges.length });
    const dailyAfterAdd = await openDaily();
    check('矩阵06b 当天含 identity_added 审计时，日报弹层文本仍只含阻塞、延期（人员池行只留在服务端数据源）',
      dailyAfterAdd.view.text === dailyAfterAdd.api.text.body &&
      dailyAfterAdd.api.text.lines.length === 4 &&
      dailyAfterAdd.view.text.indexOf('赵新') === -1 && dailyAfterAdd.view.text.indexOf('人员池') === -1,
      { lines: dailyAfterAdd.api.text.lines.length, text: dailyAfterAdd.view.text.split('\n').slice(0, 2) });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    /* ============ 矩阵07：保存 / 409 / 重启持久 / 健康探针 ============ */
    await setPhase('T007', 'dev', '已开始');
    await saveAndWait();
    const saved = (await api('/api/wbs')).body;
    const pageDev = await page.evaluate(() => document.querySelector('#wbs-body tr[data-id="T007"] td[data-field="dates.dev"] select.phase-select').value);
    check('矩阵07a 保存后 页面 / API / 磁盘三端一致（阶段进度）',
      pageDev === '已开始' && saved.tasks.find((t) => t.id === 'T007').phases.dev === '已开始' &&
      diskDoc().tasks.find((t) => t.id === 'T007').phases.dev === '已开始',
      { page: pageDev, api: saved.tasks.find((t) => t.id === 'T007').phases.dev });

    const writeA = JSON.parse(JSON.stringify(saved));
    writeA.tasks.find((t) => t.id === 'T007').phases.dev = '阻塞';
    const writeB = JSON.parse(JSON.stringify(saved));
    writeB.tasks.find((t) => t.id === 'T007').phases.dev = '已完成';
    const staleRevision = saved.meta.revision;
    const first = await putDoc(writeA, staleRevision, '项目负责人');
    const second = await putDoc(writeB, staleRevision, '项目负责人');
    const afterConflict = (await api('/api/wbs')).body;
    const conflictBanner = await page.evaluate(() => document.getElementById('banner-text').textContent);
    check('矩阵07b 并发保存 409：过期 If-Match 被拒且不覆盖（被拒的第二次写入取值未落盘）',
      first.status === 200 && second.status === 409 &&
      afterConflict.tasks.find((t) => t.id === 'T007').phases.dev === '阻塞' &&
      diskDoc().tasks.find((t) => t.id === 'T007').phases.dev === '阻塞',
      { first: first.status, second: second.status, dev: afterConflict.tasks.find((t) => t.id === 'T007').phases.dev, banner: conflictBanner.slice(0, 40) });

    await stopServer('A');
    spawnServer('A', PORT, DATA_DIR);
    await waitReady(BASE);
    const health = await api('/api/health');
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#wbs-body tr').length === 36, null, { timeout: 15000 });
    await page.waitForTimeout(400);
    const afterRestart = await page.evaluate(() => ({
      phase: document.querySelector('#wbs-body tr[data-id="T007"] td[data-field="dates.dev"] select.phase-select').value,
      probe: document.getElementById('health-probe').textContent.trim(),
      probeClass: document.getElementById('health-probe').className
    }));
    check('矩阵07c 服务重启后数据仍在（阶段进度来自磁盘）且健康探针正常',
      afterRestart.phase === '阻塞' && health.status === 200 && health.body.ok === true &&
      afterRestart.probeClass.indexOf('ok') !== -1 && afterRestart.probe.indexOf('正常') !== -1,
      { restart: afterRestart, health: health.body });

    /* ============ 矩阵03e：无事件兜底（隔离实例 B：全部计划日期在未来） ============ */
    fs.writeFileSync(path.join(DATA_DIR2, 'wbs.json'), JSON.stringify(quietSeed(today), null, 2) + '\n');
    spawnServer('B', PORT + 1, DATA_DIR2);
    await waitReady(BASE2);
    const quietDaily = await fetch(BASE2 + '/api/daily?tz=' + TZ + '&date=' + today).then((r) => r.json());
    await openWorkbench('项目负责人', BASE2);
    await page.click('#daily-btn');
    await page.waitForFunction(() => document.getElementById('daily-panel').hidden === false, null, { timeout: 15000 });
    await page.waitForTimeout(200);
    const quietText = await page.evaluate(() => document.getElementById('daily-text').textContent);
    await page.keyboard.press('Escape');
    fs.writeFileSync(path.join(OUTDIR, 'daily-quiet.json'), JSON.stringify(quietDaily));
    check('矩阵03e 无事件兜底：整体文本只有一行「今日无阻塞、延期。」（无概况行；弹层与 /api/daily 一致）',
      quietDaily.text.body === '今日无阻塞、延期。' && quietDaily.text.lines.length === 0 &&
      quietText === '今日无阻塞、延期。' && quietText.split('\n').length === 1,
      { api: quietDaily.text, display: quietText });
    await stopServer('B');

    /* ============ 回归：无外部请求 / 无 pageerror ============ */
    const external = allRequests.filter((r) => r.url.indexOf(BASE) !== 0 && r.url.indexOf(BASE2) !== 0);
    check('矩阵07d 回归 全程无外部资源请求（无 CDN / 外链 / 远程图片）且无 pageerror',
      external.length === 0 && results.page_errors.length === 0,
      { requests: allRequests.length, external: external.slice(0, 3), pageerrors: results.page_errors.slice(0, 2) });

    await page.screenshot({ path: path.join(OUTDIR, 'page-workbench.png'), fullPage: false });
  } catch (err) {
    check('stage13 浏览器用例集执行', false, err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : String(err));
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
