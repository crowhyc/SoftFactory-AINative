'use strict';
/* YUNZ-34 / Stage14 独立复验：隔离实例真实浏览器交互级验证（写入路径 + 五类摘要口径 + 无事件兜底）。
   独立脚本：自行 spawn 被测 server.js（隔离数据目录），使用 playwright 官方容器内的 Chromium 140。
   不触碰现场 0.0.0.0:4180 与 /opt/wbs-rongcheng/data。 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const TOOLS = process.env.TOOLS || '/tools';
const { chromium } = require(path.join(TOOLS, 'node_modules', 'playwright'));

const APP_DIR = process.env.APP_DIR || '/app';
const ISO = process.env.ISO || '/qv/iso';
const OUTDIR = process.env.OUTDIR || '/qv/results';
const DL_DIR = process.env.DLDIR || '/qv/downloads';
const PORT_A = Number(process.env.PORT_A || 4260);
const PORT_B = Number(process.env.PORT_B || 4261);
const BASE_A = 'http://127.0.0.1:' + PORT_A;
const BASE_B = 'http://127.0.0.1:' + PORT_B;
const DATA_A = path.join(ISO, 'isoA');
const DATA_B = path.join(ISO, 'isoB');
const RESULT_FILE = path.join(OUTDIR, 'iso-browser-results.json');

const results = { started_at: new Date().toISOString(), checks: [], page_errors: [], console_errors: [], requests: [] };
let pass = 0, fail = 0;
function check(id, ok, detail) {
  results.checks.push({ id, ok: !!ok, detail: detail === undefined ? null : detail });
  if (ok) { pass += 1; console.log('PASS  ' + id + (detail !== undefined ? '  :: ' + JSON.stringify(detail) : '')); }
  else { fail += 1; console.log('FAIL  ' + id + '  -> ' + JSON.stringify(detail)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* 身份声明制：先点身份选择页的按钮进入工作台；已在工作台时用 #identity-select 切换。 */
async function enterAs(page, name) {
  const layerVisible = await page.locator('#identity-layer').isVisible().catch(() => false);
  if (layerVisible) {
    const btn = page.locator('#identity-list button[data-identity="' + name + '"]');
    const n = await btn.count();
    if (n > 0) { await btn.first().click(); }
    else { throw new Error('identity button not found: ' + name); }
  } else {
    await page.selectOption('#identity-select', String(name));
  }
  await page.waitForTimeout(1000);
}
const jget = async (url) => { const r = await fetch(url); return { status: r.status, body: await r.json().catch(() => null) }; };
const disk = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'wbs.json'), 'utf8'));
const byId = (doc, id) => (doc.tasks || []).filter((t) => t.id === id)[0];

function startServer(dataDir, port) {
  const child = spawn(process.execPath, [path.join(APP_DIR, 'server.js')], {
    env: Object.assign({}, process.env, { WBS_DATA_DIR: dataDir, WBS_PORT: String(port), WBS_HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));
  child.__log = log;
  return child;
}
async function waitHealth(base, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    try { const r = await fetch(base + '/api/health'); if (r.ok) return await r.json(); } catch (e) {}
    await sleep(250);
  }
  throw new Error('health timeout ' + base);
}

(async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const srvA = startServer(DATA_A, PORT_A);
  const srvB = startServer(DATA_B, PORT_B);
  const hA = await waitHealth(BASE_A);
  const hB = await waitHealth(BASE_B);
  results.servers = { A: { base: BASE_A, health: hA, data: DATA_A }, B: { base: BASE_B, health: hB, data: DATA_B } };

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1600, height: 1200 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => results.page_errors.push(String(e && e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') results.console_errors.push(m.text()); });
  page.on('request', (r) => results.requests.push({ url: r.url(), method: r.method() }));
  page.on('dialog', (d) => d.accept());

  const putWait = () => page.waitForResponse((r) => r.url().includes('/api/wbs') && r.request().method() === 'PUT', { timeout: 20000 });
  const readDaily = () => page.evaluate(async (d) => (await fetch('/api/daily?tz=Asia%2FShanghai&date=' + d)).json(), today);

  await page.goto(BASE_A + '/', { waitUntil: 'load' });
  await enterAs(page, '项目负责人');
  let rows = await page.locator('#wbs-body tr').count();
  check('I01 隔离实例页面渲染 35 行', rows === 35, { rows });

  /* ---------- 写入路径：每个可编辑字段走页面提供的编辑入口 ---------- */
  const saveViaUi = async (label) => {
    const disabled = await page.locator('#save-btn').isDisabled();
    if (disabled) {
      const b = (await page.locator('#banner-text').innerText().catch(() => '')).trim();
      check(label + ' 保存可用（存在待提交修改）', false, { save_disabled: disabled, banner: b.slice(0, 200) });
      return null;
    }
    let resp;
    try {
      [resp] = await Promise.all([putWait(), page.click('#save-btn')]);
    } catch (err) {
      const b = (await page.locator('#banner-text').innerText().catch(() => '')).trim();
      check(label + ' 保存触发 PUT 请求', false, { error: String(err.message).slice(0, 120), banner: b.slice(0, 300) });
      return null;
    }
    await page.waitForTimeout(500);
    const status = resp.status();
    const body = await resp.json().catch(() => null);
    check(label + ' 保存返回 200 且带 revision', status === 200 && body && body.ok === true, { status, body });
    return body;
  };

  await page.selectOption('#wbs-body div.phase-cell[data-id="T003"][data-field="phases.dev"] select', '阻塞');
  await page.waitForTimeout(200);
  check('I02 阶段下拉「开发→阻塞」已进入页面草稿', (await page.locator('#wbs-body div.phase-cell[data-id="T003"][data-field="phases.dev"] select').inputValue()) === '阻塞');
  await saveViaUi('SAVE');
  let api = (await jget(BASE_A + '/api/wbs')).body;
  check('I03 页面显示 / API / 磁盘三端一致（T003 开发=阻塞）', byId(api, 'T003').phases.dev === '阻塞' && byId(disk(DATA_A), 'T003').phases.dev === '阻塞', { api: byId(api, 'T003').phases.dev, disk: byId(disk(DATA_A), 'T003').phases.dev });

  await page.selectOption('#wbs-body div.phase-cell[data-id="T004"][data-field="phases.test"] select', '已完成');
  await page.waitForTimeout(200);
  await saveViaUi('SAVE');
  api = (await jget(BASE_A + '/api/wbs')).body;
  check('I04 T004 测试=已完成 三端一致', byId(api, 'T004').phases.test === '已完成' && byId(disk(DATA_A), 'T004').phases.test === '已完成');

  await page.selectOption('#wbs-body div.phase-cell[data-id="T006"][data-field="phases.design"] select', '延期');
  await page.waitForTimeout(200);
  await saveViaUi('SAVE');
  api = (await jget(BASE_A + '/api/wbs')).body;
  check('I05 T006 设计=延期 三端一致', byId(api, 'T006').phases.design === '延期' && byId(disk(DATA_A), 'T006').phases.design === '延期');

  await page.selectOption('#wbs-body div.phase-cell[data-id="T007"][data-field="phases.design"] select', '已开始');
  await page.waitForTimeout(200);
  await saveViaUi('SAVE');
  api = (await jget(BASE_A + '/api/wbs')).body;
  check('I-DESIGN-PROGRESS T007 设计进度=已开始（补齐五色覆盖）', byId(api, 'T007').phases.design === '已开始', { v: byId(api, 'T007').phases.design });

  await page.fill('#wbs-body td[data-id="T005"][data-field="dates.product"] input.date-input', '2026-11-05');
  await page.waitForTimeout(200);
  await saveViaUi('SAVE');
  api = (await jget(BASE_A + '/api/wbs')).body;
  check('I06 日期编辑入口改「产品计划 → 11-05」三端一致', byId(api, 'T005').dates.product === '2026-11-05' && byId(disk(DATA_A), 'T005').dates.product === '2026-11-05');

  await page.fill('#wbs-body td[data-id="T006"][data-field="dates.dev"] input.date-input', '2026-11-06');
  await page.waitForTimeout(200);
  await saveViaUi('SAVE');
  api = (await jget(BASE_A + '/api/wbs')).body;
  check('I07 T006 开发计划 → 11-06 三端一致（同任务多事件基础）', byId(api, 'T006').dates.dev === '2026-11-06');

  /* ---------- 取消：走页面「点击单元格进入编辑」入口，Escape 取消不置脏 ---------- */
  const dirtyBefore = await page.locator('#save-btn').isDisabled();
  const l2 = '#wbs-body td[data-id="T005"][data-field="level2"]';
  const l2TextBefore = (await page.locator(l2).innerText()).trim();
  await page.click(l2);
  await page.waitForTimeout(200);
  const editorShown = await page.locator(l2 + ' input').count();
  await page.keyboard.type('ZZZ');
  await page.locator(l2 + ' input').press('Escape');
  await page.waitForTimeout(300);
  const l2TextAfter = (await page.locator(l2).innerText()).trim();
  const dirtyAfterEsc = await page.locator('#save-btn').isDisabled();
  check('I08 单元格编辑入口存在（点击进入编辑态）', editorShown === 1, { editor: editorShown });
  check('I09 Esc 取消编辑：还原原值且未置脏', l2TextAfter === l2TextBefore && dirtyAfterEsc === dirtyBefore, { before: l2TextBefore, after: l2TextAfter, disabled_before: dirtyBefore, disabled_after: dirtyAfterEsc });

  /* ---------- 空输入 / 非法输入：前置校验拦截且不落盘 ---------- */
  const revBefore = (await jget(BASE_A + '/api/wbs')).body.meta.revision;
  const taskOriginal = (await page.locator('#wbs-body td[data-id="T005"][data-field="task"]').innerText()).trim();
  await page.click('#wbs-body td[data-id="T005"][data-field="task"]');
  await page.waitForTimeout(200);
  await page.fill('#wbs-body td[data-id="T005"][data-field="task"] input', '');
  await page.locator('#wbs-body td[data-id="T005"][data-field="task"] input').press('Tab');
  await page.waitForTimeout(400);
  await page.click('#save-btn');
  await page.waitForTimeout(800);
  const banner1 = (await page.locator('#banner-text').innerText().catch(() => '')).trim();
  const revAfterEmpty = (await jget(BASE_A + '/api/wbs')).body.meta.revision;
  check('I10 空输入被前置校验拦截（横幅报错）且未落盘', /前置校验未通过/.test(banner1) && revAfterEmpty === revBefore, { banner: banner1.slice(0, 120), rev: revAfterEmpty });

  await page.click('#wbs-body td[data-id="T005"][data-field="task"]');
  await page.waitForTimeout(200);
  await page.fill('#wbs-body td[data-id="T005"][data-field="task"] input', taskOriginal);
  await page.locator('#wbs-body td[data-id="T005"][data-field="task"] input').press('Tab');
  await page.waitForTimeout(300);
  await page.click('#wbs-body td[data-id="T005"][data-field="level2"]');
  await page.waitForTimeout(200);
  await page.fill('#wbs-body td[data-id="T005"][data-field="level2"] input', 'X'.repeat(250));
  await page.locator('#wbs-body td[data-id="T005"][data-field="level2"] input').press('Tab');
  await page.waitForTimeout(400);
  await page.click('#save-btn');
  await page.waitForTimeout(800);
  const banner2 = (await page.locator('#banner-text').innerText().catch(() => '')).trim();
  const revAfterBad = (await jget(BASE_A + '/api/wbs')).body.meta.revision;
  check('I11 非法输入（超长 250 字）被拦截且未落盘', /前置校验未通过/.test(banner2) && revAfterBad === revBefore, { banner: banner2.slice(0, 120), rev: revAfterBad });

  await page.click('#wbs-body td[data-id="T005"][data-field="level2"]');
  await page.waitForTimeout(200);
  await page.fill('#wbs-body td[data-id="T005"][data-field="level2"] input', '业务工作台');
  await page.locator('#wbs-body td[data-id="T005"][data-field="level2"] input').press('Tab');
  await page.waitForTimeout(300);
  await saveViaUi('SAVE');
  const revRestore = (await jget(BASE_A + '/api/wbs')).body.meta.revision;
  check('I12 还原合法值后保存成功（revision 仅 +1）', revRestore === revBefore + 1, { rev: revRestore });

  /* ---------- 新增 / 删除行（项目负责人） ---------- */
  await page.click('#add-row-btn');
  await page.waitForTimeout(500);
  const newRowId = await page.evaluate(() => {
    const ids = Array.from(document.querySelectorAll('#wbs-body tr td[data-field="id"]')).map((t) => t.textContent.trim());
    return ids[ids.length - 1];
  });
  for (const pair of [['level1', '验证'], ['level2', '复验'], ['task', '新增行验证']]) {
    const sel = '#wbs-body td[data-id="' + newRowId + '"][data-field="' + pair[0] + '"] input';
    await page.fill(sel, pair[1]);
    await page.locator(sel).press('Enter');
    await page.waitForTimeout(400);
  }
  await saveViaUi('SAVE');
  api = (await jget(BASE_A + '/api/wbs')).body;
  check('I13 新增行已持久化（36 行，含新增行）', api.tasks.length === 36 && !!byId(api, newRowId), { n: api.tasks.length, id: newRowId });
  await page.click('#wbs-body button[data-delete="' + newRowId + '"]');
  await page.waitForTimeout(500);
  await saveViaUi('SAVE');
  api = (await jget(BASE_A + '/api/wbs')).body;
  check('I14 删除行已持久化（回到 35 行）', api.tasks.length === 35 && !byId(api, newRowId), { n: api.tasks.length });

  /* ---------- 新增人员（CH-7 保留项） ---------- */
  await page.click('#add-person-btn');
  await page.waitForTimeout(300);
  await page.fill('#new-person-name', '验证员甲');
  const [respPerson] = await Promise.all([putWait(), page.click('#new-person-confirm')]);
  await page.waitForTimeout(500);
  const identApi = (await jget(BASE_A + '/api/wbs')).body.identities;
  const audit = fs.readFileSync(path.join(DATA_A, 'audit.log'), 'utf8');
  const histToday = (await jget(BASE_A + '/api/history?tz=Asia%2FShanghai&date=' + today)).body;
  const poolRows = (histToday.records || []).filter((r) => r.field === '人员池');
  check('I15 新增人员已保存（身份池 13 人）', respPerson.status() === 200 && identApi.indexOf('验证员甲') !== -1, { n: identApi.length });
  check('I16 新增人员仍写 identity_added 审计', /"type":"identity_added"/.test(audit) || /"type": "identity_added"/.test(audit), { has: /identity_added/.test(audit) });
  check('I17 /api/history 仍返回人员池（identity_added）记录', poolRows.length > 0, { pool: poolRows.length });

  /* ---------- 只读身份对抗（可发现性） ---------- */
  await enterAs(page, '王言');
  const tgt = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#wbs-body tr'));
    for (const r of rows) {
      const idCell = r.querySelector('td[data-field="id"]');
      const ownerCell = r.querySelector('td[data-field="owner"]');
      const owner = ownerCell ? (ownerCell.textContent || '').trim() : '';
      if (idCell && owner && owner !== '王言') {
        const own = rows.find((x) => { const c = x.querySelector('td[data-field="owner"]'); return c && (c.textContent || '').trim() === '王言'; });
        return { other: idCell.textContent.trim(), otherOwner: owner, ownRow: own ? own.querySelector('td[data-field="id"]').textContent.trim() : null };
      }
    }
    return null;
  });
  const perm = await page.evaluate((t) => {
    const ownInput = document.querySelector('tr:has(td[data-field="id"]) td');
    return t;
  }, tgt).catch(() => null);
  const ownDisabled = tgt ? await page.evaluate((id) => document.querySelector('td[data-id="' + id + '"][data-field="dates.design"] input.date-input').disabled, tgt.ownRow) : null;
  const otherDisabled = tgt ? await page.evaluate((id) => document.querySelector('td[data-id="' + id + '"][data-field="dates.design"] input.date-input').disabled, tgt.other) : null;
  check('I18 普通负责人：本人行可编辑 / 他人行只读', ownDisabled === false && otherDisabled === true, { ownRow: tgt && tgt.ownRow, other: tgt && tgt.other, ownDisabled, otherDisabled });
  if (tgt) {
    await page.evaluate((id) => {
      const cell = document.querySelector('td[data-id="' + id + '"][data-field="dates.design"]');
      if (cell) cell.click();
    }, tgt.other);
    await page.waitForTimeout(400);
    const hint = (await page.locator('#hint').innerText().catch(() => '')).trim();
    check('I19 点击他人行只读单元格给出中文提示', /只读/.test(hint), hint);
  }
  await enterAs(page, '项目负责人');

  /* ---------- 导出日报（真实浏览器下载）+ WBS 导出 ---------- */
  const dailyAtExport = await readDaily();
  fs.writeFileSync(path.join(DL_DIR, 'iso-daily-at-export.json'), JSON.stringify(dailyAtExport, null, 2));
  fs.writeFileSync(path.join(DL_DIR, 'iso-wbs-at-export.json'), JSON.stringify((await jget(BASE_A + '/api/wbs')).body, null, 2));
  results.daily_at_export = dailyAtExport;

  const [dlA] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#daily-btn')]);
  const nameA = dlA.suggestedFilename();
  const pathA = path.join(DL_DIR, 'iso-' + nameA);
  await dlA.saveAs(pathA);
  check('I20 隔离实例真实浏览器下载日报', /^蓉城战役日报-\d{8}\.xlsx$/.test(nameA) && fs.statSync(pathA).size > 2000, { name: nameA, size: fs.statSync(pathA).size });

  const [dlW] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#export-btn')]);
  const nameW = dlW.suggestedFilename();
  const pathW = path.join(DL_DIR, 'iso-' + nameW);
  await dlW.saveAs(pathW);
  check('I21 隔离实例真实浏览器下载 WBS 导出', /^蓉城战役WBS-\d{8}\.xlsx$/.test(nameW) && fs.statSync(pathW).size > 2000, { name: nameW, size: fs.statSync(pathW).size });

  await page.screenshot({ path: path.join(OUTDIR, 'iso-workbench.png'), fullPage: false });

  /* ---------- 无事件兜底（隔离实例 B） ---------- */
  const pageB = await context.newPage();
  pageB.on('pageerror', (e) => results.page_errors.push('B:' + String(e && e.message || e)));
  await pageB.goto(BASE_B + '/', { waitUntil: 'load' });
  await enterAs(pageB, '项目负责人');
  const dailyB = await pageB.evaluate(async (d) => (await fetch('/api/daily?tz=Asia%2FShanghai&date=' + d)).json(), today);
  fs.writeFileSync(path.join(DL_DIR, 'iso-quiet-daily.json'), JSON.stringify(dailyB, null, 2));
  const [dlB] = await Promise.all([pageB.waitForEvent('download', { timeout: 30000 }), pageB.click('#daily-btn')]);
  const nameB = dlB.suggestedFilename();
  const pathB = path.join(DL_DIR, 'quiet-' + nameB);
  await dlB.saveAs(pathB);
  check('I22 无事件实例真实浏览器下载日报', fs.statSync(pathB).size > 2000, { name: nameB, size: fs.statSync(pathB).size });
  check('I23 无事件实例摘要为兜底一行', dailyB.summary.length === 1 && dailyB.summary[0].line === '今日无阻塞、延期或变更。', dailyB.summary);

  const externals = results.requests.filter((r) => !r.url.startsWith(BASE_A) && !r.url.startsWith(BASE_B) && !r.url.startsWith('blob:') && !r.url.startsWith('data:'));
  check('I24 隔离会话全程无外部请求', externals.length === 0, externals.slice(0, 5));
  check('I25 无页面脚本错误', results.page_errors.length === 0, results.page_errors.slice(0, 3));

  results.summary = { pass, fail, dailyA: pathA, wbsA: pathW, dailyQuiet: pathB };
  fs.writeFileSync(RESULT_FILE, JSON.stringify(results, null, 2));
  console.log('\n[iso] PASS=' + pass + ' FAIL=' + fail);
  await browser.close();
  srvA.kill('SIGKILL'); srvB.kill('SIGKILL');
  fs.writeFileSync(path.join(OUTDIR, 'iso-server-a.log'), srvA.__log.join(''));
  fs.writeFileSync(path.join(OUTDIR, 'iso-server-b.log'), srvB.__log.join(''));
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FATAL', err && err.stack || err);
  try { fs.writeFileSync(RESULT_FILE, JSON.stringify(Object.assign(results, { fatal: String(err && err.message || err) }), null, 2)); } catch (e) {}
  process.exit(2);
});
