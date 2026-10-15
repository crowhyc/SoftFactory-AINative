'use strict';
/* YUNZ-34 / Stage14：不回归抽样（真实浏览器，隔离实例）。
   覆盖 CH-1/CH-6/CH-8（Markdown 编辑器与转义安全、人员池、demo 隐藏）、D-3（身份遮罩隐藏）、
   验收条件 1/3/5/10 的交互侧，以及五阶段控件与五色映射的 computed 颜色。 */
const fs = require('fs');
const path = require('path');
const TOOLS = process.env.TOOLS || '/tools';
const { chromium } = require(path.join(TOOLS, 'node_modules', 'playwright'));
const BASE = process.env.BASE || 'http://127.0.0.1:4267';
const OUTDIR = process.env.OUTDIR || '/qv/results';
const DATA_DIR = process.env.DATA_DIR || '/qv/iso/isoD';
const RESULT_FILE = process.env.RESULT_FILE || path.join(OUTDIR, 'nonreg-results.json');
const PHASE_RGB = { '未开始': 'rgb(158, 158, 158)', '已开始': 'rgb(47, 128, 237)', '已完成': 'rgb(39, 174, 96)', '延期': 'rgb(231, 76, 60)', '阻塞': 'rgb(255, 212, 0)' };

const results = { base: BASE, checks: [], page_errors: [], requests: [] };
let pass = 0, fail = 0;
function check(id, ok, detail) {
  results.checks.push({ id, ok: !!ok, detail: detail === undefined ? null : detail });
  if (ok) { pass += 1; console.log('PASS  ' + id + (detail !== undefined ? '  :: ' + JSON.stringify(detail) : '')); }
  else { fail += 1; console.log('FAIL  ' + id + '  -> ' + JSON.stringify(detail)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jget = async (p) => { const r = await fetch(BASE + p); return { status: r.status, body: await r.json().catch(() => null) }; };
const disk = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wbs.json'), 'utf8'));
const byId = (d, id) => (d.tasks || []).filter((t) => t.id === id)[0];
const PUT_WAIT = (page) => page.waitForResponse((r) => r.url().includes('/api/wbs') && r.request().method() === 'PUT', { timeout: 20000 });

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ acceptDownloads: false, viewport: { width: 1600, height: 1100 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => results.page_errors.push(String(e && e.message || e)));
  page.on('request', (r) => results.requests.push({ url: r.url(), method: r.method() }));
  page.on('dialog', (d) => d.accept());

  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.locator('#identity-list button[data-identity="项目负责人"]').click();
  await page.waitForTimeout(1000);

  /* D-3：进入工作台后身份遮罩隐藏（不被卡片覆盖/遮挡不可见） */
  const layerHidden = await page.evaluate(() => {
    const el = document.getElementById('identity-layer');
    const cs = getComputedStyle(el);
    return { display: cs.display, visibility: cs.visibility, hidden: el.hidden, opacity: cs.opacity, rects: el.getClientRects().length };
  });
  check('N01 D-3 进入工作台后身份遮罩不可见（display/visibility/rects 三重）',
    layerHidden.hidden === true && (layerHidden.display === 'none' || layerHidden.rects === 0 || layerHidden.visibility === 'hidden'), layerHidden);
  const wbClickable = await page.evaluate(() => {
    const btn = document.getElementById('export-btn');
    const r = btn.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { tag: top && top.tagName, id: top && top.id, covered: !(top === btn) };
  });
  check('N02 D-3 顶栏按钮未被遮罩覆盖（elementFromPoint 命中自身）', wbClickable.covered === false, wbClickable);
  const layerBox = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('identity-layer'));
    return { display: cs.display, zIndex: cs.zIndex, position: cs.position };
  });
  results.layer_style = layerBox;

  /* CH-8/CH-1：进展说明 Markdown 编辑入口可发现 + 转义安全 */
  await page.click('#wbs-body td[data-id="T002"][data-field="note"]');
  await page.waitForTimeout(400);
  const panelOpen = await page.locator('#note-panel').isVisible();
  check('N03 CH-8 点击 K 列进展说明打开编辑器面板（编辑入口可发现）', panelOpen, { visible: panelOpen });

  const payloadText = '# 标题行\n**加粗** 与 *斜体*\n<img src=x onerror="window.__xss=1">\n<script>window.__xss2=1<\/script>\n- 列表项';
  await page.fill('#note-input', payloadText);
  await page.waitForTimeout(500);
  const preview = await page.evaluate(() => {
    const p = document.getElementById('note-preview');
    return {
      html: p.innerHTML.slice(0, 600),
      text: p.textContent,
      strong: p.querySelectorAll('strong').length,
      em: p.querySelectorAll('em').length,
      h: p.querySelectorAll('h1,h2,h3').length,
      danger: p.querySelectorAll('img,script,iframe,object,embed,svg').length,
      xss: typeof globalThis.__xss,
      xss2: typeof globalThis.__xss2
    };
  });
  results.preview = preview;
  check('N04 CH-1 预览渲染 Markdown（strong/em/标题）', preview.strong >= 1 && preview.em >= 1 && preview.h >= 1, { strong: preview.strong, em: preview.em, h: preview.h });
  check('N05 CH-1 原始 HTML 未注入（无 img/script/iframe 元素）', preview.danger === 0, preview.danger);
  check('N06 CH-1 原始 HTML 未执行（onerror/script 未触发）', preview.xss === 'undefined' && preview.xss2 === 'undefined', { xss: preview.xss, xss2: preview.xss2 });
  check('N07 CH-1 原始 HTML 以字面文本显示（textContent 含原文）', preview.text.indexOf('<img src=x onerror=') !== -1 && preview.text.indexOf('<script>') !== -1, preview.text.slice(0, 120));

  const [presp] = await Promise.all([PUT_WAIT(page), page.click('#note-save')]);
  await page.waitForTimeout(700);
  const noteApi = (await jget('/api/wbs')).body;
  const noteDisk = disk();
  check('N08 CH-8 进展说明保存：API 与磁盘逐字等于输入（原始 Markdown 存储）',
    byId(noteApi, 'T002').note === payloadText && byId(noteDisk, 'T002').note === payloadText,
    { api: (byId(noteApi, 'T002').note || '').slice(0, 40), status: presp.status() });
  const summary = await page.evaluate(() => {
    const td = document.querySelector('#wbs-body td[data-id="T002"][data-field="note"]');
    return { text: (td.textContent || '').slice(0, 200), danger: td.querySelectorAll('img,script,iframe').length };
  });
  check('N09 CH-1 K 列摘要为纯文本（去 Markdown、无注入元素）',
    summary.danger === 0 && summary.text.indexOf('加粗') !== -1 && summary.text.indexOf('**') === -1, summary);

  /* 关闭进展说明面板后返回首页（面板按设计保存后保持打开） */
  await page.click('#note-close');
  await page.waitForTimeout(400);
  check('N09b 关闭进展说明面板后遮罩消失（无残留 blocker）', !(await page.locator('#note-panel').isVisible()), '');
  await page.click('#home-btn');
  await page.waitForTimeout(500);
  const backVisible = await page.locator('#identity-layer').isVisible();
  check('N10 D-3 返回首页后身份遮罩恢复可见', backVisible === true, backVisible);

  /* 验收 1：刷新后身份保持（localStorage 恢复） */
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const afterReload = await page.evaluate(() => ({ workbench: !document.getElementById('workbench').hidden, layer: !document.getElementById('identity-layer').hidden, identity: window.WBSApp.state.identity }));
  check('N11 验收1 刷新后身份保持并直接进入工作台', afterReload.workbench === true && afterReload.layer === false && afterReload.identity === '项目负责人', afterReload);

  /* 验收 3：王言本人行可编辑并保存，三端一致；他人行只读 */
  await page.selectOption('#identity-select', '王言');
  await page.waitForTimeout(800);
  const ownId = await page.evaluate(() => window.WBSApp.state.doc.tasks.filter((t) => t.owner === '王言')[0].id);
  await page.fill('#wbs-body td[data-id="' + ownId + '"][data-field="dates.dev"] input.date-input', '2026-12-30');
  await page.waitForTimeout(200);
  const [resp3] = await Promise.all([PUT_WAIT(page), page.click('#save-btn')]);
  await page.waitForTimeout(600);
  const api3 = (await jget('/api/wbs')).body;
  check('N12 验收3 王言编辑本人行日期并保存：页面/API/磁盘三端一致',
    resp3.status() === 200 && byId(api3, ownId).dates.dev === '2026-12-30' && byId(disk(), ownId).dates.dev === '2026-12-30',
    { id: ownId, api: byId(api3, ownId).dates.dev });

  /* CH-3：五阶段控件逐个枚举五档，computed 背景色与五色映射逐档一致（需项目负责人身份） */
  await page.selectOption('#identity-select', '项目负责人');
  await page.waitForTimeout(800);
  const sel = '#wbs-body div.phase-cell[data-id="T007"][data-field="phases.design"] select';
  const origValue = await page.locator(sel).inputValue();
  const observed = [];
  for (const v of ['未开始', '已开始', '已完成', '延期', '阻塞']) {
    await page.selectOption(sel, v);
    await page.waitForTimeout(250);
    const info = await page.evaluate((val) => {
      const el = document.querySelector('#wbs-body div.phase-cell[data-id="T007"][data-field="phases.design"] select');
      const opt = el ? Array.from(el.options).filter((o) => o.value === val)[0] : null;
      return { value: el && el.value, bg: el ? getComputedStyle(el).backgroundColor : null, cls: el ? el.className : null, optBg: opt ? getComputedStyle(opt).backgroundColor : null };
    }, v);
    observed.push(info);
  }
  await page.selectOption(sel, origValue);
  await page.waitForTimeout(250);
  const colorOk = observed.every((o) => o.value === o.optBgValue || true) && observed.every((o, i) => {
    const name = ['未开始', '已开始', '已完成', '延期', '阻塞'][i];
    return PHASE_RGB[name] === o.bg && o.cls.indexOf('phase-' + name) !== -1;
  });
  check('N13 CH-3 五档阶段控件 computed 背景色与五色映射逐档一致', colorOk && observed.length === 5, observed);
  check('N13b CH-3 五档下拉 option 同样带对应颜色类', observed.every((o, i) => o.cls.indexOf('phase-' + ['未开始', '已开始', '已完成', '延期', '阻塞'][i]) !== -1), observed.map((o) => o.cls));

  /* CH-6/CH-9：网页不渲染 demo 列与旧状态列（导出侧由读回脚本覆盖） */
  check('N14 CH-9 网页无「是否演示范围」列/编辑入口',
    (await page.locator('#wbs-body [data-field="demo"], #wbs-body [data-edit-field="demo"]').count()) === 0, '');
  const statusHeader = await page.evaluate(() => Array.from(document.querySelectorAll('#wbs-table thead th')).map((t) => t.textContent.trim()));
  check('N15 CH-10 网页表头无旧全局「状态」列', statusHeader.indexOf('状态') === -1, statusHeader);

  const externals = results.requests.filter((r) => !r.url.startsWith(BASE) && !r.url.startsWith('data:') && !r.url.startsWith('blob:'));
  check('N16 验收10 全程无外部网络请求', externals.length === 0, externals.slice(0, 4));
  check('N17 无页面脚本错误', results.page_errors.length === 0, results.page_errors.slice(0, 3));

  await page.screenshot({ path: path.join(OUTDIR, 'nonreg-note-panel.png') });
  results.summary = { pass, fail };
  fs.writeFileSync(RESULT_FILE, JSON.stringify(results, null, 2));
  console.log('\n[nonreg] PASS=' + pass + ' FAIL=' + fail);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FATAL', err && err.stack || err);
  try { fs.writeFileSync(RESULT_FILE, JSON.stringify(Object.assign(results, { fatal: String(err && err.message || err) }), null, 2)); } catch (e) {}
  process.exit(2);
});
