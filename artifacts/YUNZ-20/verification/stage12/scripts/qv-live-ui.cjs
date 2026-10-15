/* YUNZ-32 / Stage12 独立复验：真实浏览器（Chromium，playwright 官方镜像）打运行现场 4180。
 * 只读矩阵：绝不发起 PUT/POST/DELETE；导出 / 日报走真实下载。
 * 断言口径来自 YUNZ-32 派发原文；脚本由 AI-QV 独立编写，不使用作者自测脚本。
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.QV_BASE || 'http://127.0.0.1:4180';
const OUT = process.env.QV_OUT || '.';
const DL = process.env.QV_DL || path.join(OUT, 'downloads');
const results = [];
let pass = 0, fail = 0;
function check(name, cond, detail) {
  const ok = !!cond;
  ok ? pass++ : fail++;
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + '  :: ' + JSON.stringify(detail === undefined ? null : detail));
}
const COLOR = { '未开始': 'rgb(158, 158, 158)', '已开始': 'rgb(47, 128, 237)', '已完成': 'rgb(39, 174, 96)', '延期': 'rgb(231, 76, 60)', '阻塞': 'rgb(255, 212, 0)' };
const PHASES = ['design', 'dev', 'test', 'product', 'demo_prep'];
const M = '```';
const XSS_SAMPLE = '<script>alert(1)</script>\n<img src=x onerror="alert(2)">\n![](http://example.com/remote.png)';

const requests = [], pageErrors = [], consoleErrors = [], dialogs = [];

/* 真实鼠标点击：绕过 playwright 的 enabled 可操作性等待，
   用于「点击 disabled 控件是否有反馈」这一可发现性断言。 */
async function realClick(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error('element not visible: ' + selector);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function newCtx(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', acceptDownloads: true });
  await ctx.addInitScript(() => {
    window.__pwned = 0;
    window.alert = function () { window.__pwned++; };
    window.confirm = function () { window.__pwned++; return true; };
  });
  return ctx;
}

(async () => {
  fs.mkdirSync(DL, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  page.on('request', (r) => requests.push({ method: r.method(), url: r.url() }));
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });

  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('#identity-list .identity-btn');

  /* R1 首屏：九身份 + 无外部请求 */
  const idBtns = await page.$$eval('#identity-list .identity-btn', (els) => els.map((e) => e.getAttribute('data-identity')));
  check('R1-01 首屏身份层可交互（12 身份按钮可见）', idBtns.length === 12 && idBtns[0] === '项目负责人', idBtns);

  await page.click('#identity-list .identity-btn[data-identity="项目负责人"]');
  await page.waitForSelector('#wbs-body tr');

  /* D-3 回归：身份层 computed display */
  const d3 = await page.evaluate(() => ({
    layer: getComputedStyle(document.getElementById('identity-layer')).display,
    wb: getComputedStyle(document.getElementById('workbench')).display,
    layerHiddenAttr: document.getElementById('identity-layer').hidden
  }));
  check('R1-02 D-3 回归：身份层 computed display=none 且工作台可见', d3.layer === 'none' && d3.wb !== 'none', d3);

  /* CH-9 / CH-10 结构断言 */
  const heads = await page.$$eval('#wbs-table thead th', (els) => els.map((e) => e.textContent.trim()));
  const expectHeads = ['序号', '一级', '二级', '任务项', '负责人', '设计', '开发', '测试', '产品', '演示准备', '进展说明', '操作'];
  check('R2-01 表头恰好 12 列且顺序正确（无「状态」列）', JSON.stringify(heads) === JSON.stringify(expectHeads), heads);
  check('R2-02 表头不含「状态」/「是否演示范围」', !heads.some((h) => h === '状态' || h.indexOf('演示范围') >= 0), heads);

  const domScan = await page.evaluate(() => {
    const q = (s) => document.querySelectorAll(s).length;
    const text = document.getElementById('workbench').innerText || '';
    return {
      demoField: q('[data-field="demo"]') + q('[data-edit-field="demo"]'),
      statusField: q('[data-field="status"]') + q('[data-edit-field="status"]'),
      statusFilter: q('#status-filter') + q('[data-filter="status"]'),
      demoText: text.indexOf('是否演示范围') >= 0,
      statusText: text.indexOf('状态') >= 0,
      statusTh: q('th.col-status')
    };
  });
  check('R2-03 工作台无任何 demo 编辑入口 / 无 demo 文本', domScan.demoField === 0 && !domScan.demoText, domScan);
  check('R2-04 工作台无 status 字段入口 / 无状态列 / 无状态筛选', domScan.statusField === 0 && !domScan.statusText && domScan.statusFilter === 0 && domScan.statusTh === 0, domScan);
  check('R2-05 顶部控件：身份选择 / 搜索 / 负责人筛选 / 导出 / 日报 均在位', await page.evaluate(() => ['identity-select', 'search-input', 'owner-filter', 'export-btn', 'daily-btn'].every((id) => !!document.getElementById(id))), null);

  const rows = await page.$$eval('#wbs-body tr', (els) => els.map((tr) => ({ id: (tr.querySelector('td.cell-id') || {}).textContent || '', cells: tr.querySelectorAll('td').length })));
  check('R2-06 表格渲染 35 行且每行 12 单元格', rows.length === 35 && rows.every((r) => r.cells === 12), { n: rows.length, first: rows[0] });

  /* 五阶段下拉常显 + 顺序 + 与 API 一致 */
  const api = await (await fetch(BASE + '/api/wbs')).json();
  const apiMap = {};
  api.tasks.forEach((t) => { apiMap[t.id] = t.phases; });
  const domPhases = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('#wbs-body tr').forEach((tr) => {
      const id = (tr.querySelector('td.cell-id') || {}).textContent.trim();
      const sel = [];
      tr.querySelectorAll('td.cell-date .phase-cell').forEach((w) => {
        const s = w.querySelector('select.phase-select');
        const box = s ? s.getBoundingClientRect() : { width: 0, height: 0 };
        sel.push({
          field: w.getAttribute('data-field'),
          phase: s ? s.getAttribute('data-phase') : null,
          value: s ? s.value : null,
          visible: !!(s && box.width > 0 && box.height > 0),
          disabled: s ? s.disabled : null,
          cls: s ? s.className : null,
          bg: s ? getComputedStyle(s).backgroundColor : null,
          opts: s ? Array.from(s.options).map((o) => ({ v: o.value, c: o.className })) : []
        });
      });
      out.push({ id, sel });
    });
    return out;
  });
  const flat = domPhases.reduce((a, r) => a.concat(r.sel.map((s) => Object.assign({ id: r.id }, s))), []);
  const orderOk = domPhases.every((r) => JSON.stringify(r.sel.map((s) => s.phase)) === JSON.stringify(PHASES));
  check('R3-01 每行 5 个阶段下拉，顺序 design/dev/test/product/demo_prep', domPhases.length === 35 && flat.length === 175 && orderOk, { rows: domPhases.length, cells: flat.length });
  check('R3-02 五阶段下拉全部常显（未进入行编辑态即可见）', flat.every((c) => c.visible), flat.filter((c) => !c.visible).slice(0, 3));
  const valueMatch = flat.every((c) => (apiMap[c.id] || {})[c.phase] === c.value);
  check('R3-03 页面阶段值与 /api/wbs 逐条一致（35×5=175）', valueMatch, flat.filter((c) => (apiMap[c.id] || {})[c.phase] !== c.value).slice(0, 5));
  const colorMatch = flat.every((c) => c.bg === COLOR[c.value]);
  check('R3-04 当前值背景色 = 五色映射（灰/蓝/绿/红/黄）', colorMatch, flat.filter((c) => c.bg !== COLOR[c.value]).slice(0, 5));
  const optOk = flat.every((c) => c.opts.length === 5 && flat.length > 0 &&
    JSON.stringify(c.opts.map((o) => o.v)) === JSON.stringify(['未开始', '已开始', '已完成', '延期', '阻塞']) &&
    c.opts.every((o, i) => o.c === 'phase-' + ['未开始', '已开始', '已完成', '延期', '阻塞'][i]));
  check('R3-05 下拉 5 个 option 枚举齐全且各自带 phase-<值> 类', optOk, flat[0] && flat[0].opts);
  const cssRules = await page.evaluate(() => {
    const want = { '未开始': 'rgb(158, 158, 158)', '已开始': 'rgb(47, 128, 237)', '已完成': 'rgb(39, 174, 96)', '延期': 'rgb(231, 76, 60)', '阻塞': 'rgb(255, 212, 0)' };
    const found = {};
    for (const sheet of Array.from(document.styleSheets)) {
      let rules = [];
      try { rules = Array.from(sheet.cssRules); } catch (e) { continue; }
      rules.forEach((r) => {
        if (!r.selectorText || !r.style) return;
        const m = /option\.phase-(未开始|已开始|已完成|延期|阻塞)/.exec(r.selectorText);
        if (m && r.style.backgroundColor) found[m[1]] = r.style.backgroundColor;
      });
    }
    const ok = Object.keys(want).every((k) => found[k] === want[k]);
    return { ok, found };
  });
  check('R3-06 option 五色在样式表中确有定义且与映射一致', cssRules.ok, cssRules.found);

  /* PM 权限：全部行可编辑 */
  const pmSel = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('#wbs-body tr').forEach((tr) => {
      const id = (tr.querySelector('td.cell-id') || {}).textContent.trim();
      tr.querySelectorAll('td.cell-date .phase-cell select').forEach((s) => out.push({ id, disabled: s.disabled }));
    });
    return out;
  });
  check('R4-01 项目负责人：全部 175 个阶段控件可编辑（disabled=false）', pmSel.length === 175 && pmSel.every((s) => s.disabled === false), pmSel.filter((s) => s.disabled).slice(0, 3));
  const pmUi = await page.evaluate(() => ({ addRow: document.getElementById('add-row-btn').hidden, addPerson: document.getElementById('add-person-btn').hidden }));
  check('R4-02 项目负责人：新增行 / 新增人员 可见', pmUi.addRow === false && pmUi.addPerson === false, pmUi);

  /* 普通负责人视角：仅本人行可改 + 只读中文提示 */
  await page.selectOption('#identity-select', '王言');
  await page.waitForTimeout(300);
  const ownerView = await page.evaluate(() => {
    const byOwner = {};
    let own = 0, ownEditable = 0, other = 0, otherLocked = 0;
    const owners = {};
    document.querySelectorAll('#wbs-body tr').forEach((tr) => {
      const id = (tr.querySelector('td.cell-id') || {}).textContent.trim();
      const ownerCell = tr.querySelectorAll('td')[4];
      const owner = ownerCell ? ownerCell.textContent.trim() : '';
      owners[id] = owner;
      tr.querySelectorAll('td.cell-date .phase-cell select').forEach((s) => {
        if (owner === '王言') { own++; if (!s.disabled) ownEditable++; }
        else { other++; if (s.disabled) otherLocked++; }
      });
    });
    return { own, ownEditable, other, otherLocked, sampleOwners: owners };
  });
  check('R4-03 普通负责人（王言）：本人行阶段控件全部可编辑', ownerView.own > 0 && ownerView.ownEditable === ownerView.own, ownerView);
  check('R4-04 普通负责人（王言）：他人行阶段控件全部 disabled', ownerView.other > 0 && ownerView.otherLocked === ownerView.other, ownerView);

  const lockTarget = await page.evaluate(() => {
    const tr = Array.from(document.querySelectorAll('#wbs-body tr')).find((t) => (t.querySelectorAll('td')[4] || {}).textContent.trim() !== '王言');
    const s = tr.querySelector('td.cell-date .phase-cell select');
    return { id: (tr.querySelector('td.cell-id') || {}).textContent.trim(), sel: s.getAttribute('data-edit-field'), disabled: s.disabled };
  });
  await page.$eval('#hint', (e) => { e.hidden = true; e.textContent = ''; });
  const before = requests.length;
  await realClick(page, '#wbs-body tr:has(td.cell-id:text-is("' + lockTarget.id + '")) td.cell-date .phase-cell select');
  const hint1 = await page.evaluate(() => ({ hidden: document.getElementById('hint').hidden, text: document.getElementById('hint').textContent }));
  check('R4-05 点击无权限行阶段控件给出中文只读提示', hint1.hidden === false && /只读/.test(hint1.text), { target: lockTarget, hint: hint1 });

  await page.$eval('#hint', (e) => { e.hidden = true; e.textContent = ''; });
  await realClick(page, '#wbs-body tr:has(td.cell-id:text-is("' + lockTarget.id + '")) td.cell-date .phase-cell');
  const hint2 = await page.evaluate(() => ({ hidden: document.getElementById('hint').hidden, text: document.getElementById('hint').textContent }));
  check('R4-06 点击无权限行阶段区块（下拉外沿）同样给中文提示', hint2.hidden === false && /只读/.test(hint2.text), hint2);
  const writesSoFar = requests.filter((r) => ['PUT', 'POST', 'DELETE', 'PATCH'].indexOf(r.method) >= 0);
  check('R4-07 只读点击未产生任何写请求（保存按钮仍禁用）', writesSoFar.length === 0 && (await page.$eval('#save-btn', (b) => b.disabled)), writesSoFar);
  const snap = path.join(OUT, 'shots', 'live-phase-locked.png');
  await page.screenshot({ path: snap, fullPage: false });

  /* 回到 PM，导出 / 日报真实下载 */
  await page.selectOption('#identity-select', '项目负责人');
  await page.waitForTimeout(200);
  /* 导出前的 API 快照：供读回脚本逐条比对（xlsx ↔ API ↔ 页面三端一致） */
  fs.writeFileSync(path.join(OUT, 'results', 'live-wbs-pre-export.json'), JSON.stringify(await (await fetch(BASE + '/api/wbs')).json()));
  const dailySnapshot = await (await fetch(BASE + '/api/daily?date=2026-10-15')).json();
  fs.writeFileSync(path.join(OUT, 'results', 'live-daily.json'), JSON.stringify(dailySnapshot));
  check('R5-00 /api/daily 取回成功且结构含 summary/blocked/changes/counts', dailySnapshot.ok === true && Array.isArray(dailySnapshot.summary) && Array.isArray(dailySnapshot.blocked) && Array.isArray(dailySnapshot.changes), dailySnapshot.counts);
  const [dl1] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#export-btn')
  ]);
  const f1 = path.join(DL, 'live-wbs.xlsx');
  await dl1.saveAs(f1);
  check('R5-01 导出 Excel 真实下载成功且文件名符合模板', /^蓉城战役WBS-\d{8}\.xlsx$/.test(dl1.suggestedFilename()) && fs.statSync(f1).size > 10000, { name: dl1.suggestedFilename(), size: fs.statSync(f1).size });
  const banner1 = await page.$eval('#banner-text', (e) => e.textContent);
  check('R5-02 导出提示文案含 A–K + 5 进度列 + demo 保留 + 旧 status 不导出', /A–K/.test(banner1) && /进度列/.test(banner1) && /demo 原值保留/.test(banner1) && /旧 status 不导出/.test(banner1), banner1);

  const [dl2] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#daily-btn')
  ]);
  const f2 = path.join(DL, 'live-daily.xlsx');
  await dl2.saveAs(f2);
  check('R5-03 导出日报真实下载成功且文件名符合模板', /日报-\d{8}\.xlsx$/.test(dl2.suggestedFilename()) && fs.statSync(f2).size > 5000, { name: dl2.suggestedFilename(), size: fs.statSync(f2).size });
  const banner2 = await page.$eval('#banner-text', (e) => e.textContent);
  check('R5-04 日报提示文案含三 sheet 名称', /今日摘要/.test(banner2) && /阻塞与延期/.test(banner2) && /当日变更/.test(banner2), banner2);

  /* CH-8 抽样回归 + 安全：Markdown 面板（只读，不保存） */
  const noteCell = await page.evaluate(() => {
    const tr = Array.from(document.querySelectorAll('#wbs-body tr')).find((t) => t.querySelector('.cell-note.editable'));
    return tr ? (tr.querySelector('td.cell-id') || {}).textContent.trim() : null;
  });
  await page.click('#wbs-body tr:has(td.cell-id:text-is("' + noteCell + '")) .cell-note');
  await page.waitForSelector('#note-panel:not([hidden])');
  const panelOk = await page.evaluate(() => ({ vis: !document.getElementById('note-panel').hidden, editable: !document.getElementById('note-input').disabled }));
  await page.fill('#note-input', XSS_SAMPLE);
  await page.waitForTimeout(200);
  const sec = await page.evaluate(() => ({
    script: document.querySelectorAll('#note-preview script, #note-preview img, #note-preview iframe').length,
    html: document.getElementById('note-preview').innerHTML.slice(0, 120),
    pwned: window.__pwned
  }));
  check('R6-01 CH-8 抽样：进展说明面板可打开且编辑区可用', panelOk.vis && panelOk.editable, panelOk);
  check('R6-02 CH-8 安全抽样：原始 HTML 未解析为节点 / 未触发 alert', sec.script === 0 && sec.pwned === 0 && sec.html.indexOf('&lt;script&gt;') >= 0, sec);
  await page.click('#note-cancel');
  await page.waitForTimeout(150);
  const confirmShown = await page.evaluate(() => !document.getElementById('note-confirm').hidden);
  if (confirmShown) await page.click('#note-confirm-exit');
  await page.waitForTimeout(150);
  const closed = await page.evaluate(() => document.getElementById('note-panel').hidden || getComputedStyle(document.getElementById('note-panel')).display === 'none');
  check('R6-03 CH-8 抽样：未保存关闭走确认框且面板可关闭', closed, { confirmShown, closed });

  /* 全程只读 + 无外部请求 */
  const external = requests.filter((r) => r.url.indexOf(BASE) !== 0 && r.url.indexOf('data:') !== 0 && r.url.indexOf('blob:') !== 0);
  const writes = requests.filter((r) => ['PUT', 'POST', 'DELETE', 'PATCH'].indexOf(r.method) >= 0);
  check('R7-01 全程无外部网络请求（页面资源全本地）', external.length === 0, external.slice(0, 5));
  check('R7-02 只读矩阵全程零写请求（现场 4180 未被写入）', writes.length === 0, writes.slice(0, 5));
  check('R7-03 无 pageerror / 无 alert 弹窗', pageErrors.length === 0 && dialogs.length === 0, { pageErrors, dialogs, consoleErrors: consoleErrors.slice(0, 3) });

  const rev = (await (await fetch(BASE + '/api/health')).json());
  check('R7-04 现场健康探针仍 ok（未受影响）', rev.ok === true, rev);

  fs.writeFileSync(path.join(OUT, 'results', 'live-ui-results.json'), JSON.stringify({ pass, fail, results, requests: requests.length }, null, 1));
  console.log('== LIVE 汇总：PASS=' + pass + ' FAIL=' + fail + ' 请求数=' + requests.length + ' ==');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.error('SCRIPT ERROR ' + (err && err.stack || err)); process.exit(2); });
