'use strict';
/* YUNZ-38 / Stage18：CH-1…CH-13 不回归抽样（真实浏览器，隔离实例 isoNR）。
   抽样依据：本变更只**新增**一个只读接口 GET /api/stats 与工作台顶部只读总览条，
   未改动既有渲染/权限/持久化/导出链路；故对与之共享 DOM、状态与权限的相邻能力做等效抽样：
   CH-3/CH-10 五阶段控件与五色、CH-1 Markdown 编辑器与转义安全、CH-2/CH-8 人员池与新增人员入口、
   CH-5/CH-9 demo 不渲染（导出保留见读回 R07）、CH-6 权限矩阵、CH-13 日报文本弹层、
   CH-4 身份入口与记忆、CH-11/CH-12 由 qv-migrate-check.py + qv-server-api.py 覆盖（409/400/重启/审计）。
   只读交互：仅「前置校验」一项会点击保存按钮，并断言其**不产生 PUT**。 */
const fs = require('fs');
const path = require('path');
const TOOLS = process.env.TOOLS || '/tools';
const { chromium } = require(path.join(TOOLS, 'node_modules', 'playwright'));
const BASE = process.env.BASE || 'http://127.0.0.1:4264';
const OUTDIR = process.env.OUTDIR || '/qv/results';
const COLOR = {
  '未开始': 'rgb(158, 158, 158)', '已开始': 'rgb(47, 128, 237)',
  '已完成': 'rgb(39, 174, 96)', '延期': 'rgb(231, 76, 60)', '阻塞': 'rgb(255, 212, 0)',
};
const results = { base: BASE, checks: [], page_errors: [], requests: [], puts: [], downloads: [] };
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

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => results.page_errors.push(String((e && e.message) || e)));
  page.on('request', (r) => { results.requests.push({ url: r.url(), method: r.method() }); if (r.method() === 'PUT') results.puts.push(r.url()); });
  page.on('download', (d) => results.downloads.push(d.suggestedFilename()));
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(600);

  /* CH-4 / 验收 1：身份入口九身份、进入工作台、切换即时生效 */
  const idCount = await page.locator('#identity-list button[data-identity]').count();
  check('N01 CH-4/验收1：身份入口列出全部身份（>= 9）', idCount >= 9, { idCount });
  await enterAs(page, '项目负责人');
  const inWb = await page.evaluate(() => ({ wb: !document.getElementById('workbench').hidden,
    layerHidden: document.getElementById('identity-layer').hidden }));
  check('N02 CH-9：进入工作台后身份遮罩隐藏（hidden）', inWb.wb && inWb.layerHidden, inWb);

  /* 验收 2：页面渲染任务顺序与 /api/wbs 一致 */
  const wbs = await page.evaluate(async () => (await (await fetch('/api/wbs', { cache: 'no-store' })).json()));
  const domIds = await page.evaluate(() => Array.from(document.querySelectorAll('#wbs-body tr')).map((tr) => tr.getAttribute('data-id')));
  check('N03 验收2：页面按 /api/wbs 原顺序渲染全部任务',
    JSON.stringify(domIds) === JSON.stringify(wbs.tasks.map((t) => t.id)), { dom: domIds.length, api: wbs.tasks.length, same: JSON.stringify(domIds) === JSON.stringify(wbs.tasks.map((t) => t.id)) });

  /* CH-3 / CH-10：五阶段控件与五色、无旧「状态」列 */
  const selCount = await page.locator('#wbs-body select.phase-select').count();
  check('N04 CH-3/CH-10：每行 5 个阶段下拉（总 = 行数 × 5）', selCount === domIds.length * 5, { rows: domIds.length, selects: selCount });
  const colorMap = {};
  const firstSel = '#wbs-body select.phase-select >> nth=0';
  for (const k of Object.keys(COLOR)) {
    await page.selectOption(firstSel, k);
    await page.waitForTimeout(100);
    colorMap[k] = await page.evaluate(() => getComputedStyle(document.querySelectorAll('#wbs-body select.phase-select')[0]).backgroundColor);
  }
  await page.selectOption(firstSel, COLOR && Object.keys(COLOR)[0]).catch(() => {});
  check('N05 CH-3：阶段下拉五色映射与页面一致（未开始灰/已开始蓝/已完成绿/延期红/阻塞黄）',
    Object.keys(COLOR).every((k) => colorMap[k] === COLOR[k]), { got: colorMap });
  const legacy = await page.evaluate(() => {
    const th = Array.from(document.querySelectorAll('#wbs-table thead th')).map((e) => e.textContent.trim());
    return { headers: th, hasStatusCol: th.indexOf('状态') !== -1,
      demoNodes: document.querySelectorAll('#wbs-table [data-field="demo"]').length };
  });
  check('N06 CH-9/CH-5：页面无旧「状态」列、无「是否演示范围」列/入口', !legacy.hasStatusCol && legacy.demoNodes === 0, legacy);

  /* CH-6：权限矩阵（项目负责人全可编辑；普通负责人他人行只读 + 中文提示） */
  await enterAs(page, '王言');
  const perm = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#wbs-body tr'));
    let mine = null, other = null;
    rows.forEach((tr) => {
      const oc = tr.querySelector('td[data-field="owner"]');
      const inp = tr.querySelector('td[data-field="dates.design"] input');
      if (!oc || !inp) return;
      const owner = oc.textContent.trim();
      if (owner === '王言' && !mine) mine = { id: tr.getAttribute('data-id'), disabled: inp.disabled };
      if (owner !== '王言' && !other) other = { id: tr.getAttribute('data-id'), disabled: inp.disabled };
    });
    return { mine, other };
  });
  check('N07 CH-6：本人行可编辑（日期输入未 disabled）', !!perm.mine && perm.mine.disabled === false, perm.mine);
  check('N08 CH-6：他人行只读（日期输入 disabled）', !!perm.other && perm.other.disabled === true, perm.other);
  if (perm.other) {
    await page.click('#wbs-body tr[data-id="' + perm.other.id + '"] td[data-field="task"]');
    await page.waitForTimeout(250);
    const h = await page.evaluate(() => ({ hidden: document.getElementById('hint').hidden, text: document.getElementById('hint').innerText }));
    check('N09 CH-6：点击他人行只读单元格给出中文只读提示', !h.hidden && /只读/.test(h.text), h);
  }

  /* CH-2 / CH-8：人员池与新增人员入口 */
  await enterAs(page, '项目负责人');
  const pool = await page.evaluate(() => ({
    addPerson: !document.getElementById('add-person-btn').hidden,
    identityOptions: Array.from(document.querySelectorAll('#identity-select option')).length,
    ownerOptions: Array.from(document.querySelectorAll('#owner-filter option')).length,
  }));
  check('N10 CH-2/CH-8：项目负责人可见「新增人员」入口，身份与负责人下拉与人员池同步',
    pool.addPerson && pool.identityOptions === wbs.identities.length && pool.ownerOptions >= wbs.identities.length,
    { pool, identities: wbs.identities.length });

  /* CH-1：Markdown 编辑器 + 转义安全（无 innerHTML 执行） */
  const noteId = domIds[0];
  await page.click('#wbs-body tr[data-id="' + noteId + '"] td[data-field="note"]');
  await page.waitForTimeout(500);
  const panelOpen = await page.evaluate(() => !document.getElementById('note-panel').hidden);
  const payload = '<script>window.__xss=1<\/script> **粗体** <img src=x onerror="window.__xss=2">';
  await page.evaluate((p) => { const el = document.getElementById('note-input'); el.value = p; el.dispatchEvent(new Event('input', { bubbles: true })); }, payload);
  await page.waitForTimeout(400);
  const xss = await page.evaluate(() => ({
    xss: window.__xss === undefined ? null : window.__xss,
    scriptTags: document.querySelectorAll('#note-preview script').length,
    imgTags: document.querySelectorAll('#note-preview img').length,
    text: document.getElementById('note-preview').innerText,
    editPaneVisible: !!document.getElementById('note-edit-pane').offsetParent,
    previewPaneVisible: !!document.getElementById('note-preview-pane').offsetParent,
    tabsHidden: document.getElementById('note-tabs').hidden,
    bold: !!document.querySelector('#note-preview strong, #note-preview b'),
  }));
  check('N11 CH-1：进展说明 Markdown 编辑器可用（桌面双栏）且原始 HTML 不被执行（无 script/img 注入、无 XSS 全局）',
    panelOpen && xss.xss === null && xss.scriptTags === 0 && xss.imgTags === 0 &&
    xss.text.indexOf('<script>') !== -1 && xss.editPaneVisible && xss.previewPaneVisible && xss.tabsHidden && xss.bold,
    { panelOpen, xss: xss.xss, scriptTags: xss.scriptTags, imgTags: xss.imgTags, tabsHidden: xss.tabsHidden,
      bold: xss.bold, text: xss.text.slice(0, 90) });
  await page.click('#note-cancel').catch(() => {});
  await page.waitForTimeout(200);
  const confirmVisible = await page.locator('#note-confirm').isVisible().catch(() => false);
  if (confirmVisible) { await page.click('#note-confirm-exit').catch(() => {}); await page.waitForTimeout(200); }
  check('N12 CH-1：进展说明未保存即退出（有确认回退，未产生 PUT）', results.puts.length === 0, { puts: results.puts.length });

  /* CH-13：日报文本弹层可用（无下载） */
  await page.click('#daily-btn');
  await page.waitForTimeout(600);
  const daily = await page.evaluate(() => ({
    visible: !document.getElementById('daily-panel').hidden,
    text: (document.getElementById('daily-text').textContent || ''),
    copyBtn: !!document.getElementById('daily-copy'),
  }));
  await page.click('#daily-close').catch(() => {});
  check('N13 CH-13：日报文本弹层可用（可见 + 文本 + 复制按钮），且不产生下载',
    daily.visible && daily.text.length > 0 && daily.copyBtn && results.downloads.length === 0,
    { visible: daily.visible, len: daily.text.length, downloads: results.downloads });

  /* CH-1（窄屏）：进展说明编辑入口可发现 + 编辑/预览标签可用 */
  {
    const nc = await browser.newContext({ viewport: { width: 375, height: 780 }, isMobile: true, hasTouch: true });
    const np = await nc.newPage();
    np.on('request', (r) => { results.requests.push({ url: r.url(), method: r.method() }); if (r.method() === 'PUT') results.puts.push(r.url()); });
    await np.goto(BASE + '/', { waitUntil: 'load' });
    await np.waitForTimeout(500);
    await enterAs(np, '项目负责人');
    await np.click('#wbs-body tr[data-id="' + domIds[0] + '"] td[data-field="note"]');
    await np.waitForTimeout(500);
    const narrow = await np.evaluate(() => ({
      tabsHidden: document.getElementById('note-tabs').hidden,
      editTabVisible: !!document.getElementById('note-tab-edit').offsetParent,
      previewTabVisible: !!document.getElementById('note-tab-preview').offsetParent,
      inputVisible: !!document.getElementById('note-input').offsetParent,
    }));
    await np.click('#note-tab-preview');
    await np.waitForTimeout(400);
    const afterTab = await np.evaluate(() => ({
      previewVisible: !!document.getElementById('note-preview-pane').offsetParent,
      editHidden: document.getElementById('note-edit-pane').hidden,
      placeholder: (document.getElementById('note-preview').innerText || '').slice(0, 20),
    }));
    check('N17 CH-1（375px）：进展说明编辑入口可发现，编辑/预览标签可用且可切换',
      !narrow.tabsHidden && narrow.editTabVisible && narrow.previewTabVisible && narrow.inputVisible &&
      afterTab.previewVisible && afterTab.editHidden,
      { narrow, afterTab });
    await np.click('#note-cancel').catch(() => {});
    await np.waitForTimeout(200);
    if (await np.locator('#note-confirm').isVisible().catch(() => false)) { await np.click('#note-confirm-exit').catch(() => {}); }
    await nc.close();
  }

  /* 验收 5：空表单前置校验给出明确错误，且不产生 PUT */
  const putsBefore = results.puts.length;
  await page.click('#add-row-btn');
  await page.waitForTimeout(300);
  await page.click('#save-btn');
  await page.waitForTimeout(500);
  const banner = await page.evaluate(() => ({ hidden: document.getElementById('banner').hidden, text: document.getElementById('banner-text').textContent }));
  check('N14 验收5：空任务项保存被前置校验拦下（错误横幅 + 不产生 PUT）',
    !banner.hidden && /前置校验未通过|未向服务器提交/.test(banner.text) && results.puts.length === putsBefore,
    { banner, puts: results.puts.length });

  /* 验收 10：无外部请求 + 无 pageerror */
  const external = results.requests.filter((r) => !r.url.startsWith(BASE) && !r.url.startsWith('data:'));
  check('N15 验收10：无跨域/外部请求', external.length === 0, external.slice(0, 5));
  check('N16 全程无 pageerror', results.page_errors.length === 0, results.page_errors.slice(0, 3));

  fs.writeFileSync(path.join(OUTDIR, 'nonreg-results.json'),
    JSON.stringify(Object.assign({}, results, { pass, fail }), null, 2));
  await context.close();
  await browser.close();
  console.log('\n[nonreg-browser] PASS=' + pass + ' FAIL=' + fail);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => { console.error('FATAL', err); process.exit(2); });
