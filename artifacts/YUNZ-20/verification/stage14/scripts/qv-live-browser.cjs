'use strict';
/* YUNZ-34 / Stage14 独立复验：现场交付物（0.0.0.0:4180）真实浏览器只读交互 + 真实下载（日报 / WBS）。
   独立于作者用例：本脚本由 AI-QV 自写，不加载被测作者的 tests/*；浏览器仅在官方 playwright 容器内运行。
   只读：不发出任何写请求（无 PUT / 无保存 / 无新增 / 无删除）。 */
const fs = require('fs');
const path = require('path');
const TOOLS = process.env.TOOLS || '/tools';
const { chromium } = require(path.join(TOOLS, 'node_modules', 'playwright'));

const BASE = process.env.BASE || 'http://127.0.0.1:4180';
const OUTDIR = process.env.OUTDIR || '/qv/results';
const DL_DIR = process.env.DLDIR || '/qv/downloads';
const RESULT_FILE = process.env.RESULT_FILE || path.join(OUTDIR, 'live-browser-results.json');

const results = { base: BASE, started_at: new Date().toISOString(), checks: [], page_errors: [], console_errors: [], requests: [] };
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

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1600, height: 1200 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => results.page_errors.push(String(e && e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') results.console_errors.push(m.text()); });
  page.on('request', (r) => results.requests.push({ url: r.url(), method: r.method() }));
  page.on('requestfailed', (r) => results.requests.push({ url: r.url(), failed: true }));

  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(800);

  /* L01 首页：身份层可见、人员池渲染 */
  const idCount = await page.locator('#identity-list button, #identity-list .identity-item, #identity-list [data-identity]').count();
  check('L01 首页身份层可见且人员池渲染 12 项', idCount === 12, { identity_items: idCount });

  /* L02 选择项目负责人进入工作台 */
  await enterAs(page, '项目负责人');
  const wbVisible = await page.locator('#workbench').isVisible();
  const rowCount = await page.locator('#wbs-body tr').count();
  check('L02 项目负责人进入工作台且行数=35', wbVisible && rowCount === 35, { workbench_visible: wbVisible, rows: rowCount });

  /* L03 表头：12 列、无「是否演示范围」、无旧「状态」列 */
  const headers = await page.locator('#wbs-table thead th').allInnerTexts();
  const expectedHeaders = ['序号', '一级', '二级', '任务项', '负责人', '设计', '开发', '测试', '产品', '演示准备', '进展说明', '操作'];
  check('L03 表头 12 列且与预期一致', JSON.stringify(headers.map((h) => h.trim())) === JSON.stringify(expectedHeaders), headers);
  check('L04 页面无「是否演示范围」列/入口', (await page.locator('#wbs-table [data-field="demo"], #wbs-table [data-edit-field="demo"]').count()) === 0);
  check('L05 页面无旧全局「状态」列/控件', (await page.evaluate(() =>
    Array.from(document.querySelectorAll('#wbs-table thead th')).some((th) => th.textContent.trim() === '状态')) === false));

  /* L06 五阶段控件与日期控件常显 */
  const phaseCount = await page.locator('#wbs-body [data-field^="phases."] select').count();
  const dateCount = await page.locator('#wbs-body input.date-input').count();
  check('L06 阶段下拉 175 个常显', phaseCount === 175, { phase_selects: phaseCount });
  check('L07 日期输入 175 个常显', dateCount === 175, { date_inputs: dateCount });

  /* L08 健康探针 */
  const probe = (await page.locator('#health-probe').innerText()).trim();
  check('L08 健康探针显示服务正常', /探针：服务正常/.test(probe), probe);

  /* L09 对抗路径（可发现性）：切换普通负责人，点击他人行只读单元格 → 中文提示 */
  await enterAs(page, '王言');
  const target = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#wbs-body tr'));
    for (const r of rows) {
      const idCell = r.querySelector('td[data-field="id"]');
      if (!idCell) continue;
      const ownerCell = r.querySelector('td[data-field="owner"]');
      const ownerText = ownerCell ? (ownerCell.textContent || '').trim() : '';
      if (ownerText && ownerText !== '王言') {
        const inp = r.querySelector('input.date-input');
        return { id: idCell.textContent.trim(), owner: ownerText, disabled: inp ? inp.disabled : null };
      }
    }
    return null;
  });
  check('L09 普通负责人视角他人行日期输入为 disabled', !!target && target.disabled === true, target);
  if (target) {
    await page.evaluate((id) => {
      const cell = document.querySelector('td[data-id="' + id + '"][data-field="dates.design"]');
      if (cell) cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, target.id);
    await page.waitForTimeout(400);
    const hint = (await page.locator('#hint').innerText().catch(() => '')).trim();
    const hintVisible = await page.locator('#hint').isVisible().catch(() => false);
    check('L10 点击只读单元格给出明确中文提示（无静默无反应）', hintVisible && /只读/.test(hint), { hint, visible: hintVisible });
    await page.click('#hint').catch(() => {});
  }
  /* L11 对抗：点击阶段控件（只读） */
  if (target) {
    await page.evaluate((id) => {
      const w = document.querySelector('.phase-cell[data-id="' + id + '"][data-field="phases.design"]');
      if (w) w.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, target.id);
    await page.waitForTimeout(300);
    const hint2 = (await page.locator('#hint').innerText().catch(() => '')).trim();
    check('L11 点击只读阶段控件给出中文只读提示', /只读/.test(hint2), hint2);
  }

  /* 回到项目负责人，记录导出前 API 口径 */
  await enterAs(page, '项目负责人');
  const preDaily = await page.evaluate(async () => (await fetch('/api/daily?tz=Asia%2FShanghai&date=' + new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }))).json());
  const preWbs = await page.evaluate(async () => (await fetch('/api/wbs', { cache: 'no-store' })).json());
  fs.writeFileSync(path.join(DL_DIR, 'live-daily-at-export.json'), JSON.stringify(preDaily, null, 2));
  fs.writeFileSync(path.join(DL_DIR, 'live-wbs-at-export.json'), JSON.stringify(preWbs, null, 2));

  /* L12 真实浏览器下载日报 */
  const [dlDaily] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#daily-btn')]);
  const dailyName = dlDaily.suggestedFilename();
  const dailyPath = path.join(DL_DIR, 'live-' + dailyName);
  await dlDaily.saveAs(dailyPath);
  const dailySize = fs.statSync(dailyPath).size;
  const dailyBanner = (await page.locator('#banner-text').innerText().catch(() => '')).trim();
  check('L12 点击「导出日报」触发真实浏览器下载', /^蓉城战役日报-\d{8}\.xlsx$/.test(dailyName) && dailySize > 2000, { name: dailyName, size: dailySize });
  check('L13 导出日报成功横幅含 sheet 行数并与 API 一致', /已导出日报/.test(dailyBanner) && dailyBanner.includes('「今日摘要」' + preDaily.counts.summary + ' 行'), { banner: dailyBanner, api_summary: preDaily.counts.summary });
  check('L14 横幅标明只含两个 sheet 且今日摘要只保留 A 列', /只含两个 sheet/.test(dailyBanner) && /只保留 A 列/.test(dailyBanner), dailyBanner);

  /* L15 真实浏览器下载 WBS 导出（抽样回归） */
  const [dlWbs] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#export-btn')]);
  const wbsName = dlWbs.suggestedFilename();
  const wbsPath = path.join(DL_DIR, 'live-' + wbsName);
  await dlWbs.saveAs(wbsPath);
  const wbsSize = fs.statSync(wbsPath).size;
  check('L15 点击「导出 Excel」触发真实浏览器下载 WBS', /^蓉城战役WBS-\d{8}\.xlsx$/.test(wbsName) && wbsSize > 2000, { name: wbsName, size: wbsSize });

  await page.screenshot({ path: path.join(OUTDIR, 'live-workbench.png'), fullPage: false });

  /* L16 全程无外部请求（同源限定） */
  const externals = results.requests.filter((r) => !r.url.startsWith(BASE) && !r.url.startsWith('blob:') && !r.url.startsWith('data:'));
  check('L16 全程无外部网络请求', externals.length === 0, externals.slice(0, 5));
  const writes = results.requests.filter((r) => r.method && r.method !== 'GET');
  check('L17 只读验证未发出任何写请求', writes.length === 0, writes.slice(0, 5));
  check('L18 无页面脚本错误', results.page_errors.length === 0, results.page_errors.slice(0, 3));

  /* L19 保留项：/api/history 仍返回（含 identity_added 人员池记录） */
  const hist = await page.evaluate(async () => (await fetch('/api/history?tz=Asia%2FShanghai&date=' + new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }))).json());
  fs.writeFileSync(path.join(DL_DIR, 'live-history-at-export.json'), JSON.stringify(hist, null, 2));
  const poolRows = (hist.records || []).filter((r) => r.field === '人员池');
  check('L19 /api/history 仍返回且含 identity_added 人员池记录', Array.isArray(hist.records) && poolRows.length > 0, { total: (hist.records || []).length, pool: poolRows.length });

  results.summary = { pass, fail, daily: { name: dailyName, path: dailyPath, size: dailySize }, wbs: { name: wbsName, path: wbsPath, size: wbsSize } };
  fs.writeFileSync(RESULT_FILE, JSON.stringify(results, null, 2));
  console.log('\n[live] PASS=' + pass + ' FAIL=' + fail + ' pageerror=' + results.page_errors.length + ' external=' + externals.length);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FATAL', err && err.stack || err);
  try { fs.writeFileSync(RESULT_FILE, JSON.stringify(Object.assign(results, { fatal: String(err && err.message || err) }), null, 2)); } catch (e) {}
  process.exit(2);
});
