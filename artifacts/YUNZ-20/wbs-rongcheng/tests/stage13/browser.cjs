'use strict';
/* YUNZ-33 / 变更包 #5（CH-11 今日摘要只保留 A 列 + CH-12 日报删除「当日变更」sheet）真实浏览器自测。
   运行环境：mcr.microsoft.com/playwright:v1.55.0-jammy 容器（chromium 140，与 playwright 1.55.0 对齐）；
   宿主为 CentOS 7（glibc 2.17），无法直接运行该 Chromium，浏览器只在测试容器内运行，不进产物、不进镜像。
   被测服务（server.js）由本脚本自行 spawn（隔离数据目录 + 迁移前构造边界数据），结束后回收；
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
const REMOVED_TOKENS = ['当日变更', '改动字段', '旧值', '新值', '操作身份', '重要度', '结论', '依据'];

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

/* 迁移前构造边界数据：A 实例日期为「昨天 / 今天」两类，迁移后 phases 可预期。 */
function craftedSeed(today) {
  const seed = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'data', 'wbs.seed.json'), 'utf8'));
  const yesterday = shiftDay(today, -1);
  const byId = {};
  seed.tasks.forEach((task) => { byId[task.id] = task; });
  byId.T001.dates.design = yesterday;   // 到期未更新（今日无人更新）→ 判定延期
  byId.T002.dates.design = yesterday;   // 今日改状态为已完成 → 只出「完成」
  byId.T003.dates.dev = today;          // 边界：恰好今天 → 未开始（不判延期）
  byId.T004.dates.test = yesterday;     // 到期未更新；其 dev 今日改为阻塞 → 一任务多事件
  byId.T005.dates.product = yesterday;  // 今日改为已完成 → 只出「完成」
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

    const docAtExport = (await api('/api/wbs')).body;
    fs.writeFileSync(path.join(OUTDIR, 'wbs-at-export.json'), JSON.stringify(docAtExport));
    const taskById = {};
    docAtExport.tasks.forEach((t) => { taskById[t.id] = t; });
    const line = (prefix, taskId, conclusion) => '【' + prefix + '】' + taskById[taskId].level1 + ' / ' + taskById[taskId].level2 +
      ' / ' + taskById[taskId].task + ' @' + taskById[taskId].owner + '：' + conclusion + '。';

    const daily = (await api('/api/daily?tz=' + TZ + '&date=' + today)).body;
    const dailyAtExport = daily;
    fs.writeFileSync(path.join(OUTDIR, 'daily-at-export.json'), JSON.stringify(dailyAtExport));
    const lines = dailyAtExport.summary.map((row) => row.line);
    const findLine = (needle) => lines.filter((l) => l.indexOf(needle) !== -1);
    const t001Line = line('延期·高风险', 'T001', '设计 ' + mmdd(yesterday) + ' 到期未更新，判定延期');
    const t004Line = line('延期·高风险', 'T004', '测试 ' + mmdd(yesterday) + ' 到期未更新，判定延期');
    check('矩阵03a 今日摘要逐字模板：【重要度】一级 / 二级 / 任务项 @负责人：结论。（含 @ 与风险前缀，变更包 #4 口径不变）',
      lines.indexOf(t001Line) !== -1 && lines.indexOf(t004Line) !== -1,
      { expect: t001Line, hit: lines.indexOf(t001Line) !== -1 });

    /* ============ 矩阵01 / 02 / 03 / 04 / 06b：导出真实产物与结构断言 ============ */
    const dailyFile = await capture('#daily-btn', '日报-' + today.replace(/-/g, '') + '.xlsx');
    results.dailyExport = { name: dailyFile.name, length: dailyFile.length };
    const dailyShape = await page.evaluate((base64) => {
      const wb = window.XLSX.read(base64, { type: 'base64', cellStyles: true });
      const sheets = wb.SheetNames.map((sheetName) => ({
        name: sheetName,
        ref: (wb.Sheets[sheetName] || {})['!ref'],
        rows: window.XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: '' }),
        width: ((wb.Sheets[sheetName] || {})['!cols'] || [{}])[0].wch
      }));
      return { sheets: sheets, cols: ((wb.Sheets['今日摘要'] || {})['!cols'] || []) };
    }, dailyFile.b64);
    results.dailyShape = dailyShape;
    check('矩阵01 日报 sheetNames == ["今日摘要","阻塞与延期"]（CH-12：当日变更已删除，顺序不变）',
      dailyShape.sheets.map((s) => s.name).join('/') === '今日摘要/阻塞与延期',
      dailyShape.sheets.map((s) => s.name));
    check('矩阵01b 页面「导出日报」真实产物已生成（文件名 蓉城战役日报-YYYYMMDD.xlsx）',
      /^蓉城战役日报-\d{8}\.xlsx$/.test(String(dailyFile.name)) && dailyFile.length > 3000 &&
      String(dailyFile.name).indexOf(today.replace(/-/g, '')) !== -1, dailyFile.name);

    const summarySheet = dailyShape.sheets[0];
    const summaryRows = summarySheet.rows;
    check('矩阵02 今日摘要仅 A 列有值：列数 1（!ref = A 列）、每行长度 1、表头只有「微信文本行」',
      /^A1:A\d+$/.test(String(summarySheet.ref)) &&
      summaryRows.every((row) => row.length === 1) &&
      JSON.stringify(summaryRows[0]) === JSON.stringify(['微信文本行']) &&
      summaryRows.length === dailyAtExport.summary.length + 1,
      { ref: summarySheet.ref, width: summarySheet.width, header: summaryRows[0], rows: summaryRows.length });
    check('矩阵02b 今日摘要 A 列列宽足够（≥100 字符宽，配合自动换行显示）',
      Number(summarySheet.width) >= 100, { width: summarySheet.width, cols: dailyShape.cols });

    const headerTexts = dailyShape.sheets.reduce((acc, sheet) => acc.concat(sheet.rows.slice(0, 2).reduce((a, r) => a.concat(r), [])), []);
    const removedHits = REMOVED_TOKENS.filter((token) => headerTexts.some((cell) => String(cell) === token));
    check('矩阵04 旧「当日变更」表头与「今日摘要」辅助分列表头（重要度/结论/…/依据）全部不出现',
      removedHits.length === 0 && dailyShape.sheets.every((s) => s.name !== '当日变更') &&
      !headerTexts.some((cell) => String(cell).indexOf('当日变更') !== -1),
      { cells: headerTexts.slice(0, 12), hits: removedHits });

    check('矩阵03b 导出「今日摘要」A 列逐字 = /api/daily 文本行（含 @、高风险前缀，逐行一致）',
      summaryRows.slice(1).map((row) => row[0]).join('\n') === lines.join('\n'),
      { rows: summaryRows.length - 1, api: lines.length, first: summaryRows[1] ? summaryRows[1][0] : null });
    check('矩阵03c 五类前缀与结论模板逐字命中（延期/阻塞/完成/普通/到期未更新）',
      lines.indexOf(line('延期·高风险', 'T003', '测试延期')) !== -1 &&
      lines.indexOf(line('阻塞·高风险', 'T004', '阶段更新为阻塞')) !== -1 &&
      lines.indexOf(line('完成', 'T005', '阶段已完成')) !== -1 &&
      lines.indexOf(line('完成', 'T002', '阶段已完成')) !== -1 &&
      lines.indexOf(line('普通', 'T006', '测试计划 11-01 → 11-05')) !== -1,
      findLine('【').slice(0, 6));
    const rankOf = (l) => {
      if (l.indexOf('【延期·高风险】') === 0 && l.indexOf('到期未更新') === -1) return 1;
      if (l.indexOf('【阻塞·高风险】') === 0) return 2;
      if (l.indexOf('到期未更新') !== -1) return 3;
      if (l.indexOf('【完成】') === 0) return 4;
      return 5;
    };
    const ranks = lines.map(rankOf);
    check('矩阵03d 排序 延期 > 阻塞 > 到期未更新判定延期 > 完成 > 普通；一任务多事件多行',
      ranks.join(',') === ranks.slice().sort((a, b) => a - b).join(',') &&
      daily.summary.filter((row) => row.task === taskById.T004.task).length === 2 &&
      findLine('到期未更新，判定延期').length === 2,
      { ranks: ranks, t004: daily.summary.filter((row) => row.task === taskById.T004.task).length });

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
      JSON.stringify(wbsShape.header.slice(11, 16)) === JSON.stringify(['设计进度', '开发进度', '测试进度', '产品进度', '演示准备进度']) &&
      /^导出日期：\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(wbsShape.row1[16])),
      { sheets: wbsShape.sheetNames, l2p: wbsShape.header.slice(11, 16), q1: wbsShape.row1[16] });

    /* ============ 矩阵06（后半）：CH-7 数据源行 + 导出不含当日变更 ============ */
    const poolChanges = (dailyAtExport.changes || []).filter((r) => r.field === '人员池' && r.new === '赵新');
    check('矩阵06 identity_added 仍写审计、/api/history 仍返回人员池行、/api/daily 数据源仍含该行（导出已不含当日变更 sheet）',
      identityAdds.length === 1 && identityAdds[0].identity === '项目负责人' && Date.parse(identityAdds[0].at) > 0 &&
      poolEvents.length === 1 && poolEvents[0].old === '' && poolEvents[0].task === '新增人员 赵新' &&
      poolChanges.length === 1 && poolChanges[0].old === '' && poolChanges[0].identity === '项目负责人' &&
      ((await api('/api/wbs')).body.identities || []).indexOf('赵新') !== -1,
      { audit: identityAdds.length, history: poolEvents.length, dailyChanges: poolChanges.length });
    check('矩阵06b 当天含 identity_added 审计时，日报导出仍为两 sheet、仍不含「当日变更」（审计只留在服务端）',
      dailyShape.sheets.map((s) => s.name).join('/') === '今日摘要/阻塞与延期' &&
      dailyShape.sheets.every((s) => s.name !== '当日变更'),
      dailyShape.sheets.map((s) => s.name));

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
    const quietFile = await capture('#daily-btn', '日报-' + today.replace(/-/g, '') + '-无事件.xlsx');
    const quietShape = await page.evaluate((base64) => {
      const wb = window.XLSX.read(base64, { type: 'base64' });
      return {
        sheets: wb.SheetNames,
        rows: window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' }),
        ref: (wb.Sheets[wb.SheetNames[0]] || {})['!ref']
      };
    }, quietFile.b64);
    fs.writeFileSync(path.join(OUTDIR, 'daily-quiet.json'), JSON.stringify(quietDaily));
    check('矩阵03e 无事件兜底：/api/daily 与导出 A 列都只输出一行「今日无阻塞、延期或变更。」（仍两 sheet、A 列）',
      quietDaily.summary.length === 1 && quietDaily.summary[0].line === '今日无阻塞、延期或变更。' &&
      quietShape.sheets.join('/') === '今日摘要/阻塞与延期' &&
      quietShape.rows.length === 2 && quietShape.rows[1][0] === '今日无阻塞、延期或变更。' &&
      quietShape.rows[1].length === 1 && quietShape.ref === 'A1:A2',
      { api: quietDaily.summary, export: quietShape.rows, ref: quietShape.ref });
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
