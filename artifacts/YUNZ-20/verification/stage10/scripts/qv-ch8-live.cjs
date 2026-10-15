/* YUNZ-30 / Stage10 独立复验：真实浏览器（Chromium 140，官方 playwright 镜像）
 * 打运行现场 http://127.0.0.1:4180 —— 只读矩阵：绝不发起 PUT/POST/DELETE。
 * 断言口径全部来自 CH-8 派发原文；脚本为 AI-QV 独立编写，不使用作者自测脚本。
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.QV_BASE || 'http://127.0.0.1:4180';
const OUT = process.env.QV_OUT || '.';
const results = [];
let pass = 0, fail = 0;
function check(name, cond, detail) {
  const ok = !!cond;
  ok ? pass++ : fail++;
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + '  :: ' + JSON.stringify(detail));
}
const M = '```';
const MD_SAMPLE = [
  '# 一级标题', '## 二级标题', '### 三级标题',
  '**粗体文本** 与 *斜体文本* 与 ~~删除文本~~ 与 `行内代码`',
  M + 'js', 'const a = 1;', M,
  '> 引用一行', '', '- 无序甲', '- 无序乙', '', '1. 有序甲', '2. 有序乙', '',
  '[链接文本](https://example.com/x)'
].join('\n');
const XSS_SAMPLE = '<script>alert(1)</script>\n\n![](http://example.com/remote.png)\n\n<img src="http://example.com/a.png" onerror="alert(2)">';

const requests = [], pageErrors = [], consoleErrors = [], dialogs = [];

async function newPage(browser, viewport) {
  const ctx = await browser.newContext({ viewport, locale: 'zh-CN' });
  await ctx.addInitScript(() => {
    window.__pwned = 0;
    window.alert = function (m) { window.__pwned++; };
    window.confirm = function () { window.__pwned++; return true; };
  });
  const page = await ctx.newPage();
  page.on('request', (r) => requests.push({ method: r.method(), url: r.url() }));
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
  return { ctx, page };
}

const ID = (page, name) => page.click('#identity-list .identity-btn[data-identity="' + name + '"]');
async function readyWorkbench(page) {
  await page.waitForFunction(() => document.querySelectorAll('#wbs-body tr').length === 36, null, { timeout: 15000 });
}
const noteCell = (page, id) => page.locator('.cell-note[data-id="' + id + '"]');
/* 真实鼠标点击整格：useEdge=true 打该格最右侧可视边缘（验证「整格可视区域」均可点）。 */
async function openPanelByCell(page, id, useEdge) {
  const cell = noteCell(page, id);
  await cell.scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  const box = await cell.boundingBox();
  const vw = await page.evaluate(() => innerWidth);
  const x = useEdge ? box.x + box.width - 3 : Math.max(3, Math.min(box.x + box.width / 2, vw - 4));
  await page.mouse.click(x, box.y + box.height / 2);
  await page.waitForFunction(() => document.getElementById('note-panel').hidden === false, null, { timeout: 5000 });
}
async function panelState(page) {
  return page.evaluate(() => {
    const d = document.getElementById('note-dialog');
    const r = d.getBoundingClientRect();
    const cols = getComputedStyle(document.querySelector('.note-body')).gridTemplateColumns.split(/\s+/).filter(Boolean);
    const tabs = document.getElementById('note-tabs');
    const saveBtn = document.getElementById('note-save');
    return {
      vw: innerWidth, vh: innerHeight, w: Math.round(r.width), h: Math.round(r.height),
      left: Math.round(r.left), top: Math.round(r.top),
      cols: cols.length, colWidths: cols.map((v) => Math.round(parseFloat(v))),
      panelHidden: document.getElementById('note-panel').hidden,
      confirmHidden: document.getElementById('note-confirm').hidden,
      readonlyClass: d.classList.contains('readonly'),
      dirtyClass: d.classList.contains('note-dirty'),
      tabsHidden: tabs.hidden, tabsDisplay: getComputedStyle(tabs).display,
      editPaneVisible: !document.getElementById('note-edit-pane').hidden && document.getElementById('note-edit-pane').offsetWidth > 0,
      previewPaneVisible: document.getElementById('note-preview-pane').offsetWidth > 0,
      saveHidden: saveBtn.hidden,
      saveVisible: !saveBtn.hidden && saveBtn.offsetWidth > 0,
      saveText: saveBtn.textContent, cancelText: document.getElementById('note-cancel').textContent,
      meta: document.getElementById('note-meta').textContent,
      inputValue: document.getElementById('note-input').value,
      msg: document.getElementById('note-msg').textContent,
      confirmButtons: Array.from(document.querySelectorAll('#note-confirm button')).map((b) => b.textContent)
    };
  });
}
const closeConfirmVisible = (page) => page.evaluate(() => {
  const c = document.getElementById('note-confirm');
  return { hidden: c.hidden, visible: !c.hidden && c.offsetWidth > 0 };
});

(async () => {
  const browser = await chromium.launch();
  const t0 = new Date();

  /* ---------- 桌面 1440x900 ---------- */
  const { page } = await newPage(browser, { width: 1440, height: 900 });
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('#identity-list .identity-btn');
  const idCount = await page.locator('#identity-list .identity-btn').count();
  check('现场 A1：身份选择页渲染人员池（12 人）且工作台未显示', idCount === 12, { idCount });

  await ID(page, '李欢');
  await readyWorkbench(page);
  const afterEnter = await page.evaluate(() => ({
    layerDisplay: getComputedStyle(document.getElementById('identity-layer')).display,
    workbenchHidden: document.getElementById('workbench').hidden,
    workbenchVisible: document.getElementById('workbench').offsetWidth > 0
  }));
  check('现场 A2（D-3 回归）：选身份后 #identity-layer computed display=none 且工作台可见可交互',
    afterEnter.layerDisplay === 'none' && afterEnter.workbenchHidden === false && afterEnter.workbenchVisible === true, afterEnter);

  /* ---------- 1. K 列摘要与可点击性（现场 note 全为空 → 断言空态摘要与样式） ---------- */
  const cellEditable = await page.evaluate(() => {
    const td = document.querySelector('.cell-note[data-id="T001"]');
    const sum = td.querySelector('.note-summary');
    const cs = getComputedStyle(sum);
    return {
      cls: td.className, cursor: getComputedStyle(td).cursor, title: td.getAttribute('title'),
      dataNoteEmpty: td.getAttribute('data-note-empty'), text: sum.textContent,
      sumCls: sum.className, nowrap: cs.whiteSpace, overflow: cs.textOverflow,
      inlineEditor: td.querySelectorAll('textarea,input').length, actionText: (td.querySelector('.note-action') || {}).textContent || null
    };
  });
  check('现场 B1：有权限行（T001 负责人=李欢）K 单元格为可点击摘要格（note-editable、cursor:pointer、无内联编辑器）',
    /note-editable/.test(cellEditable.cls) && cellEditable.cursor === 'pointer' && cellEditable.inlineEditor === 0, cellEditable);
  check('现场 B2：空 note 显示「点击打开编辑」占位并给出编辑提示（data-note-empty=true、单行省略样式）',
    cellEditable.text === '点击打开编辑' && cellEditable.dataNoteEmpty === 'true' && /note-placeholder/.test(cellEditable.sumCls)
    && cellEditable.nowrap === 'nowrap' && cellEditable.overflow === 'ellipsis', cellEditable);
  const cellLocked = await page.evaluate(() => {
    const td = document.querySelector('.cell-note[data-id="T002"]');
    const sum = td.querySelector('.note-summary');
    return { cls: td.className, text: sum.textContent, cursor: getComputedStyle(td).cursor, title: td.getAttribute('title') };
  });
  check('现场 B3：无权限行（T002 负责人=王言）K 单元格为只读摘要格（note-locked、提示「点击查看进展说明」，点击行为见 G1）',
    /note-locked/.test(cellLocked.cls) && cellLocked.text === '点击查看进展说明' && /点击查看进展说明/.test(cellLocked.title), cellLocked);

  /* ---------- 2. 面板形态：桌面 90vw x 80vh 居中 + 双栏 ---------- */
  await openPanelByCell(page, 'T001');
  const p1 = await panelState(page);
  check('现场 C1：整格可视区域（右下角）点击即打开面板，编辑区初值 = 该行 note',
    p1.panelHidden === false && p1.inputValue === '' && p1.saveVisible === true, { inputValue: p1.inputValue, saveText: p1.saveText });
  check('现场 C2：桌面面板尺寸 ≈ 90vw x 80vh（1440x900 → 1296x720，容差 2px）',
    Math.abs(p1.w - p1.vw * 0.9) <= 2 && Math.abs(p1.h - p1.vh * 0.8) <= 2, { w: p1.w, h: p1.h, vw: p1.vw, vh: p1.vh });
  check('现场 C3：面板居中（left/top 与 (视口-面板)/2 偏差 <= 2px）',
    Math.abs(p1.left - (p1.vw - p1.w) / 2) <= 2 && Math.abs(p1.top - (p1.vh - p1.h) / 2) <= 2, { left: p1.left, top: p1.top });
  check('现场 C4：桌面为左「编辑」右「预览」双栏（grid 两列且两栏均可见），标签栏隐藏',
    p1.cols === 2 && p1.editPaneVisible && p1.previewPaneVisible && p1.tabsHidden === true, { cols: p1.cols, colWidths: p1.colWidths });
  await page.screenshot({ path: path.join(OUT, 'shots', 'live-desktop-panel.png') });

  /* ---------- 6. Markdown 子集：逐项 DOM 断言（只在输入区打字，不保存） ---------- */
  await page.fill('#note-input', MD_SAMPLE);
  const md = await page.evaluate(() => {
    const q = (s) => document.querySelector('#note-preview ' + s);
    const txt = (s) => { const n = q(s); return n ? n.textContent : null; };
    const a = q('a');
    return {
      h1: txt('h1'), h2: txt('h2'), h3: txt('h3'), strong: txt('strong'), em: txt('em'), del: txt('del'),
      inlineCode: txt('p code'), pre: txt('pre code'), quote: txt('blockquote'),
      ulLi: Array.from(document.querySelectorAll('#note-preview ul li')).map((n) => n.textContent),
      olLi: Array.from(document.querySelectorAll('#note-preview ol li')).map((n) => n.textContent),
      link: a ? { text: a.textContent, href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') } : null
    };
  });
  check('现场 D1：H1–H3 渲染为 h1/h2/h3 且文本正确',
    md.h1 === '一级标题' && md.h2 === '二级标题' && md.h3 === '三级标题', { h1: md.h1, h2: md.h2, h3: md.h3 });
  check('现场 D2：粗体 strong / 斜体 em / 删除线 del / 行内代码 code 逐项渲染正确',
    md.strong === '粗体文本' && md.em === '斜体文本' && md.del === '删除文本' && md.inlineCode === '行内代码',
    { strong: md.strong, em: md.em, del: md.del, code: md.inlineCode });
  check('现场 D3：代码块 pre>code 与引用 blockquote 渲染正确',
    md.pre === 'const a = 1;' && /引用一行/.test(md.quote || ''), { pre: md.pre, quote: md.quote });
  check('现场 D4：无序列表与有序列表分别渲染为 ul/ol 且条目正确',
    JSON.stringify(md.ulLi) === JSON.stringify(['无序甲', '无序乙']) && JSON.stringify(md.olLi) === JSON.stringify(['有序甲', '有序乙']),
    { ulLi: md.ulLi, olLi: md.olLi });
  check('现场 D5：链接渲染为 a[target=_blank][rel 含 noopener/noreferrer] 且 href 正确',
    md.link && md.link.href === 'https://example.com/x' && md.link.target === '_blank'
    && /noopener/.test(md.link.rel || '') && /noreferrer/.test(md.link.rel || ''), md.link);

  /* ---------- 7. 安全：原始 HTML 原样显示不执行；远程图片只作安全文本、无外部请求 ---------- */
  const reqBefore = requests.length;
  await page.fill('#note-input', XSS_SAMPLE);
  await page.waitForTimeout(500);
  const sec = await page.evaluate(() => {
    const host = document.getElementById('note-preview');
    return {
      scriptNodes: host.querySelectorAll('script').length,
      imgNodes: host.querySelectorAll('img').length,
      otherNodes: host.querySelectorAll('iframe,object,embed,link,style').length,
      text: host.textContent, html: host.innerHTML,
      pwned: window.__pwned || 0, dialogs: (window.__dialogs || []).length
    };
  });
  const newReqs = requests.slice(reqBefore);
  const external = newReqs.filter((r) => !/^https?:\/\/(127\.0\.0\.1|0\.0\.0\.0|localhost)(:4180)?\//.test(r.url));
  check('现场 E1：`<script>alert(1)</script>` 与 onerror 原始 HTML 原样显示为文本（渲染区无 script/img/iframe 节点、内容被转义）',
    sec.scriptNodes === 0 && sec.imgNodes === 0 && sec.otherNodes === 0 && sec.text.includes('<script>alert(1)</script>')
    && sec.html.includes('&lt;script&gt;'), { scriptNodes: sec.scriptNodes, imgNodes: sec.imgNodes, escaped: sec.html.includes('&lt;script&gt;') });
  check('现场 E2：脚本未执行（window.alert 未被调用、无 dialog 事件）',
    sec.pwned === 0 && dialogs.length === 0, { pwned: sec.pwned, dialogs: dialogs.length });
  check('现场 E3：`![](http://…png)` 不解析为图片、只显示为安全文本，且渲染阶段无任何外部资源请求',
    sec.imgNodes === 0 && sec.text.includes('![](http://example.com/remote.png)') && external.length === 0,
    { external: external.map((r) => r.url), reqCount: newReqs.length, imgNodes: sec.imgNodes });
  await page.screenshot({ path: path.join(OUT, 'shots', 'live-security-preview.png') });

  /* ---------- 5. 未保存关闭确认：取消 / 继续退出两条路径 ---------- */
  await page.fill('#note-input', 'DRAFT-LIVE-UNSAVED');
  await page.click('#note-close');
  const c1 = await closeConfirmVisible(page);
  const p2 = await panelState(page);
  check('现场 F1：有未保存内容时点关闭弹出确认框（「取消 / 继续退出」），面板保持打开',
    c1.visible && p2.panelHidden === false && JSON.stringify(p2.confirmButtons) === JSON.stringify(['取消', '继续退出']),
    { confirm: c1, buttons: p2.confirmButtons });
  await page.click('#note-confirm-cancel');
  const c2 = await closeConfirmVisible(page);
  const p3 = await panelState(page);
  check('现场 F2：确认框「取消」路径 —— 确认框收起、面板保留、输入内容不丢',
    c2.hidden === true && p3.panelHidden === false && p3.inputValue === 'DRAFT-LIVE-UNSAVED', { input: p3.inputValue });
  await page.click('#note-close');
  await page.waitForFunction(() => !document.getElementById('note-confirm').hidden, null, { timeout: 5000 });
  await page.click('#note-confirm-exit');
  const p4 = await panelState(page);
  check('现场 F3：确认框「继续退出」路径 —— 面板关闭、内容丢弃',
    p4.panelHidden === true && p4.confirmHidden === true, { panelHidden: p4.panelHidden });

  /* ---------- 3. 只读模式（无权限行） ---------- */
  await page.selectOption('#identity-select', '王言');
  await page.waitForTimeout(200);
  await openPanelByCell(page, 'T004');
  const ro = await panelState(page);
  check('现场 G1：普通负责人点他人行 K 单元格 = 只读预览（readonly class、无保存按钮、编辑区隐藏、中文只读说明）',
    ro.readonlyClass === true && ro.saveVisible === false && ro.saveHidden === true && ro.editPaneVisible === false
    && ro.previewPaneVisible === true && ro.tabsHidden === true && /只读预览/.test(ro.meta) && ro.cancelText === '关闭',
    { readonly: ro.readonlyClass, saveVisible: ro.saveVisible, meta: ro.meta, cancel: ro.cancelText });
  const putBefore = requests.filter((r) => r.method !== 'GET').length;
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(600);
  const putAfter = requests.filter((r) => r.method !== 'GET');
  const p5 = await panelState(page);
  check('现场 G2：只读面板无法提交（Ctrl+Enter 无保存路径、未发出任何写请求、面板仍在）',
    putAfter.length === putBefore && p5.panelHidden === false, { writes: putAfter.map((r) => r.method + ' ' + r.url) });
  await page.click('#note-close');
  const p6 = await panelState(page);
  check('现场 G3：只读面板「关闭」按钮可关闭', p6.panelHidden === true, { panelHidden: p6.panelHidden });
  await openPanelByCell(page, 'T004');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const p7 = await panelState(page);
  check('现场 G4：只读面板 Esc 可关闭', p7.panelHidden === true, { panelHidden: p7.panelHidden });

  /* ---------- 可编辑面板 Esc 关闭（无未保存内容 → 直接关闭） ---------- */
  await page.selectOption('#identity-select', '李欢');
  await page.waitForTimeout(200);
  await openPanelByCell(page, 'T001');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const p8 = await panelState(page);
  check('现场 H1：可编辑面板无未保存内容时 Esc 直接关闭（不弹确认）', p8.panelHidden === true && p8.confirmHidden === true, { panelHidden: p8.panelHidden });

  /* ---------- 2b. 窄视口 / 手机：全屏 + 标签切换 ---------- */
  const narrow = await newPage(browser, { width: 390, height: 844 });
  await narrow.page.goto(BASE + '/', { waitUntil: 'load' });
  await narrow.page.waitForSelector('#identity-list .identity-btn');
  await ID(narrow.page, '李欢');
  await readyWorkbench(narrow.page);
  await openPanelByCell(narrow.page, 'T001', false);
  const n1 = await panelState(narrow.page);
  check('现场 I1：窄视口（390x844）面板全屏（100vw x 100vh、无圆角），标签栏显示',
    n1.w === 390 && n1.h === 844 && n1.tabsHidden === false && n1.tabsDisplay === 'flex', { w: n1.w, h: n1.h, tabs: n1.tabsDisplay });
  check('现场 I2：窄视口默认落在「编辑」页（编辑区可见、预览区不可见）',
    n1.editPaneVisible === true && n1.previewPaneVisible === false, { edit: n1.editPaneVisible, preview: n1.previewPaneVisible });
  await narrow.page.fill('#note-input', '# 手机端预览\n**粗体**');
  await narrow.page.screenshot({ path: path.join(OUT, 'shots', 'live-mobile-edit-tab.png') });
  await narrow.page.click('#note-tab-preview');
  await narrow.page.waitForTimeout(200);
  const n2 = await panelState(narrow.page);
  const tabState = await narrow.page.evaluate(() => ({
    editHidden: document.getElementById('note-edit-pane').hidden,
    previewHidden: document.getElementById('note-preview-pane').hidden,
    activeTab: document.querySelector('.note-tab.active').id,
    dialogTab: document.getElementById('note-dialog').getAttribute('data-tab'),
    previewVisibleHeight: document.getElementById('note-preview-pane').offsetHeight
  }));
  check('现场 I3：窄视口点「预览」标签后可见区域切换（编辑区隐藏、预览区可见、active 标签切换）',
    tabState.editHidden === true && tabState.previewHidden === false && tabState.activeTab === 'note-tab-preview'
    && tabState.dialogTab === 'preview' && tabState.previewVisibleHeight > 0, tabState);
  await narrow.page.screenshot({ path: path.join(OUT, 'shots', 'live-mobile-preview-tab.png') });
  await narrow.page.click('#note-tab-edit');
  await narrow.page.waitForTimeout(200);
  const n3 = await narrow.page.evaluate(() => ({
    editHidden: document.getElementById('note-edit-pane').hidden,
    previewHidden: document.getElementById('note-preview-pane').hidden,
    activeTab: document.querySelector('.note-tab.active').id
  }));
  check('现场 I4：切回「编辑」标签后再次切换可见区域', n3.editHidden === false && n3.previewHidden === true && n3.activeTab === 'note-tab-edit', n3);
  await narrow.ctx.close();

  /* ---------- 11. 行为保留抽样：CH-1 操作列 / CH-2 状态与日期常显（以项目负责人身份，仅前端交互，不写服务端） ---------- */
  await page.selectOption('#identity-select', '项目负责人');
  await page.waitForTimeout(300);
  const regress = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#wbs-body tr'));
    const editBtns = rows.map((tr) => (tr.querySelector('[data-edit-row]') || {}).textContent);
    return {
      rows: rows.length,
      editButtons: editBtns.filter((t) => t === '编辑').length,
      statusSelects: rows.filter((tr) => tr.querySelector('.cell-status select')).length,
      dateInputs: document.querySelectorAll('#wbs-body input[type="date"]').length,
      noteInlineEditors: document.querySelectorAll('#wbs-body .cell-note textarea, #wbs-body .cell-note input').length
    };
  });
  check('现场 M1（CH-1/CH-2 抽样）：36 行常显「编辑」按钮、状态控件与日期输入常显；K 列已无行内编辑器（CH-8 取代实现）',
    regress.rows === 36 && regress.editButtons === 36 && regress.statusSelects === 36 && regress.dateInputs >= 36 && regress.noteInlineEditors === 0, regress);
  const firstEdit = page.locator('#wbs-body [data-edit-row]').first();
  await firstEdit.click();
  const inEdit = await page.evaluate(() => ({ editing: document.querySelectorAll('#wbs-body tr.row-editing').length, btn: document.querySelector('#wbs-body [data-edit-row]').textContent }));
  await firstEdit.click();
  const outEdit = await page.evaluate(() => ({ editing: document.querySelectorAll('#wbs-body tr.row-editing').length, btn: document.querySelector('#wbs-body [data-edit-row]').textContent }));
  check('现场 M2（CH-1 回归）：点「编辑」进入行编辑态（tr.row-editing、按钮变「完成」），再点退出编辑态',
    inEdit.editing === 1 && inEdit.btn === '完成' && outEdit.editing === 0 && outEdit.btn === '编辑', { inEdit, outEdit });

  /* ---------- 收尾：无外部请求 / 无 pageerror / 无写请求 ---------- */
  const writes = requests.filter((r) => r.method !== 'GET');
  const allExternal = requests.filter((r) => !/^https?:\/\/(127\.0\.0\.1|0\.0\.0\.0|localhost)(:4180)?\//.test(r.url));
  check('现场 J1：全程无任何外部 / 跨域资源请求（请求面全部同源 127.0.0.1:4180）',
    allExternal.length === 0, { total: requests.length, external: allExternal.map((r) => r.url), distinct: Array.from(new Set(requests.map((r) => r.url.split('/').slice(0, 3).join('/')))) });
  check('现场 J2：全程无 pageerror、无 console error', pageErrors.length === 0 && consoleErrors.length === 0, { pageErrors, consoleErrors });
  check('现场 J3（关键）：只读矩阵全程未发出任何写请求（PUT/POST/DELETE=0），现场数据未被本脚本改动',
    writes.length === 0, { writes: writes.map((r) => r.method + ' ' + r.url) });

  await browser.close();
  const summary = {
    base: BASE, mode: 'read-only', started_at: t0.toISOString(), finished_at: new Date().toISOString(),
    pass, fail, requests_total: requests.length, results
  };
  fs.writeFileSync(path.join(OUT, 'results', 'live-browser-results.json'), JSON.stringify(summary, null, 2));
  console.log('---'); console.log('PASS=' + pass + ' FAIL=' + fail);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(2); });
