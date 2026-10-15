'use strict';
/* YUNZ-36 / Stage16：不回归抽样（真实浏览器，隔离实例 isoA）。
   抽样依据：本变更只动「导出日报」入口链路（server.js dailyText + app.js 弹层/复制 + index.html #daily-panel + styles.css），
   故对与之共享 DOM/状态/权限/持久化的相邻能力做等效抽样：身份层隐藏（CH-9/D-3）、五阶段控件与五色（CH-3）、
   demo 隐藏但导出保留（CH-5）、权限矩阵与只读提示（CH-6）、Markdown 编辑器与转义安全（CH-1）、
   新增人员入口（CH-2）、无外部请求与无 pageerror（验收 10）。只读：全程不得发出 PUT。 */
const fs = require('fs');
const path = require('path');
const TOOLS = process.env.TOOLS || '/tools';
const { chromium } = require(path.join(TOOLS, 'node_modules', 'playwright'));
const BASE = process.env.BASE || 'http://127.0.0.1:4260';
const OUTDIR = process.env.OUTDIR || '/qv/results';
const RESULT_FILE = process.env.RESULT_FILE || path.join(OUTDIR, 'nonreg-results.json');
const COLOR = {
  '\u672a\u5f00\u59cb': 'rgb(158, 158, 158)', '\u5df2\u5f00\u59cb': 'rgb(47, 128, 237)',
  '\u5df2\u5b8c\u6210': 'rgb(39, 174, 96)', '\u5ef6\u671f': 'rgb(231, 76, 60)',
  '\u963b\u585e': 'rgb(255, 212, 0)',
};
const results = { base: BASE, checks: [], page_errors: [], requests: [], puts: [] };
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
  await page.waitForTimeout(600);
}
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => results.page_errors.push(String((e && e.message) || e)));
  page.on('request', (r) => { results.requests.push({ url: r.url(), method: r.method() }); if (r.method() === 'PUT') results.puts.push(r.url()); });
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await enterAs(page, '\u9879\u76ee\u8d1f\u8d23\u4eba');

  /* CH-9 / D-3：进入工作台后身份遮罩隐藏 */
  const layer = await page.evaluate(() => {
    const el = document.getElementById('identity-layer');
    return { hidden: el.hidden, display: getComputedStyle(el).display, w: el.getBoundingClientRect().width };
  });
  check('N01 CH-9：进入工作台后 #identity-layer 隐藏（hidden + display:none + 无尺寸）',
    layer.hidden === true && layer.display === 'none' && layer.w === 0, layer);

  /* CH-3：五阶段控件数量与五色映射 */
  const rows = await page.locator('#wbs-body tr').count();
  const selCount = await page.locator('#wbs-body select.phase-select').count();
  check('N02 CH-3：每行 5 个阶段下拉（总 ' + rows * 5 + '）', selCount === rows * 5, { rows, selects: selCount });
  const firstSel = '#wbs-body select.phase-select >> nth=0';
  const colorMap = {};
  for (const k of Object.keys(COLOR)) {
    await page.selectOption(firstSel, k);
    await page.waitForTimeout(120);
    colorMap[k] = await page.evaluate((s) => getComputedStyle(document.querySelectorAll('#wbs-body select.phase-select')[0]).backgroundColor, k);
  }
  const colorOk = Object.keys(COLOR).every((k) => colorMap[k] === COLOR[k]);
  check('N03 CH-3：阶段下拉五色映射（未开始灰/已开始蓝/已完成绿/延期红/阻塞黄）与页面一致', colorOk, { got: colorMap, exp: COLOR });
  /* 复原为未开始，避免残留草稿 */
  await page.selectOption(firstSel, '\u672a\u5f00\u59cb').catch(() => {});

  /* CH-5：demo 不在页面出现（导出保留由 xlsx 读回覆盖） */
  const demoNodes = await page.locator('#wbs-table [data-field="demo"], #wbs-table [data-edit-field="demo"]').count();
  check('N05 CH-5：页面不出现「是否演示范围」列/入口（导出保留见读回 ISOA-W-11）', demoNodes === 0, { nodes: demoNodes });

  /* CH-6 / 权限矩阵：普通负责人本人行可编辑、他人行只读且点击有中文提示 */
  await enterAs(page, '\u738b\u8a00');
  const perm = await page.evaluate(() => {
    const out = { mine: null, other: null };
    Array.from(document.querySelectorAll('#wbs-body tr')).forEach((tr) => {
      const idc = tr.querySelector('td[data-field="id"]');
      const oc = tr.querySelector('td[data-field="owner"]');
      if (!idc || !oc) return;
      const owner = (oc.textContent || '').trim();
      const input = tr.querySelector('input.date-input');
      const rec = { id: idc.textContent.trim(), owner, disabled: input ? input.disabled : null };
      if (owner === '\u738b\u8a00' && !out.mine) out.mine = rec;
      if (owner !== '\u738b\u8a00' && !out.other) out.other = rec;
    });
    return out;
  });
  check('N06 CH-6：普通负责人本人行可编辑（日期输入未 disabled）', !!perm.mine && perm.mine.disabled === false, perm.mine);
  check('N07 CH-6：他人行只读（日期输入 disabled）', !!perm.other && perm.other.disabled === true, perm.other);
  if (perm.other) {
    await page.evaluate((id) => {
      const cell = document.querySelector('td[data-id="' + id + '"][data-field="dates.design"]');
      if (cell) cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, perm.other.id);
    await page.waitForTimeout(300);
    const hint = (await page.locator('#hint').innerText().catch(() => '')).trim();
    check('N08 CH-6：点击只读单元格给出明确中文提示（无静默无反应）', /只读/.test(hint), { hint });
  }

  /* CH-2：新增人员入口仅项目负责人可见 */
  const addBtnNormal = await page.locator('#add-person-btn').isVisible().catch(() => false);
  await enterAs(page, '\u9879\u76ee\u8d1f\u8d23\u4eba');
  const addBtnLeader = await page.locator('#add-person-btn').isVisible().catch(() => false);
  check('N09 CH-2：新增人员入口仅项目负责人可见（普通负责人不可见）', addBtnLeader === true && addBtnNormal === false,
    { leader: addBtnLeader, normal: addBtnNormal });

  /* CH-1：Markdown 编辑器打开 + 预览转义安全（不执行注入） */
  const noteId = await page.evaluate(() => {
    const td = document.querySelector('#wbs-body td[data-field="note"]');
    return td ? td.getAttribute('data-id') : null;
  });
  if (noteId) {
    await page.click('#wbs-body td[data-id="' + noteId + '"][data-field="note"]');
    await page.waitForTimeout(500);
    const open = await page.locator('#note-panel').isVisible();
    const payload = '# \u6807\u9898 <img src=x onerror=alert(1)> <script>alert(1)<\/script> **\u7c97\u4f53**';
    await page.fill('#note-input', payload);
    await page.waitForTimeout(300);
    const prev = await page.evaluate(() => {
      const p = document.getElementById('note-preview');
      return { html: p.innerHTML, scripts: p.querySelectorAll('script').length, imgs: p.querySelectorAll('img').length,
               hasH1: p.querySelectorAll('h1').length, hasStrong: p.querySelectorAll('strong').length };
    });
    check('N10 CH-1：Markdown 预览渲染（标题 / 粗体生效）', prev.hasH1 >= 1 && prev.hasStrong >= 1, prev);
    check('N11 CH-1：预览转义安全（无 script 元素、无 img 元素、注入文本按字面显示）',
      prev.scripts === 0 && prev.imgs === 0 && prev.html.indexOf('<script') === -1 && prev.html.indexOf('&lt;script') !== -1, prev);
    /* 窄视口下走「编辑 / 预览」页签路径（典型用户操作入口可发现性） */
    /* 窄视口阈值 = max-width:768px（app.js NOTE_NARROW_QUERY） */
    await page.setViewportSize({ width: 700, height: 1000 });
    await page.waitForTimeout(400);
    const tabsVisible = await page.locator('#note-tabs').isVisible().catch(() => false);
    await page.click('#note-tab-preview');
    await page.waitForTimeout(250);
    const narrowState = await page.evaluate(() => ({
      tab: document.getElementById('note-dialog').getAttribute('data-tab'),
      previewVisible: !document.getElementById('note-preview-pane').hidden,
      editHidden: document.getElementById('note-edit-pane').hidden,
      scripts: document.getElementById('note-preview').querySelectorAll('script').length,
    }));
    check('N11b CH-1：窄视口显示「编辑 / 预览」页签，切预览后编辑区隐藏、预览区显示且仍无脚本注入',
      tabsVisible && narrowState.tab === 'preview' && narrowState.previewVisible && narrowState.editHidden && narrowState.scripts === 0,
      narrowState);
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.waitForTimeout(200);
    /* 关闭（有未保存改动 → 走确认“继续退出”），不得保存 */
    await page.click('#note-close').catch(() => {});
    await page.waitForTimeout(300);
    if (await page.locator('#note-confirm').isVisible().catch(() => false)) {
      await page.click('#note-confirm-exit');
    } else {
      await page.click('#note-cancel').catch(() => {});
      await page.waitForTimeout(200);
      if (await page.locator('#note-confirm').isVisible().catch(() => false)) await page.click('#note-confirm-exit');
    }
    await page.waitForTimeout(300);
    const closed = await page.locator('#note-panel').isHidden();
    check('N12 CH-1：关闭编辑器可正常退出（含未保存确认路径）', closed === true, { closed });
  } else {
    check('N10-N12 CH-1：Markdown 编辑器可达', false, 'note cell not found');
  }

  /* 无外部请求 / 无 pageerror / 全程未写（无 PUT） */
  const external = results.requests.filter((r) => !r.url.startsWith(BASE) && !r.url.startsWith('data:') && !r.url.startsWith('blob:'));
  check('N13 验收 10：页面无外部请求', external.length === 0, external.slice(0, 5));
  check('N14 无 pageerror', results.page_errors.length === 0, results.page_errors.slice(0, 3));
  check('N15 抽样全程只读（未发出任何 PUT /api/wbs）', results.puts.length === 0, results.puts);

  await context.close();
  await browser.close();
  results.pass = pass; results.fail = fail;
  fs.writeFileSync(RESULT_FILE, JSON.stringify(results, null, 2));
  console.log('\n[nonreg-browser] PASS=' + pass + ' FAIL=' + fail);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => { console.error('FATAL', err); process.exit(2); });
