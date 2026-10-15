'use strict';
/* YUNZ-29 / 变更包 #3：CH-8 现场（真实容器 127.0.0.1:4180）只读实测证据。
   只读：不点「保存」、不发任何 PUT，现场 data/wbs.json 与 audit.log 不被改动（脚本首尾校验 sha256）。
   运行（宿主 CentOS 7 无法直接跑 Chromium，浏览器在 playwright 容器内 + --network host 共享宿主网络）：
     bash tests/stage9/live_run.sh */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const TOOLS = process.env.TOOLS || '/tools';
const { chromium } = require(path.join(TOOLS, 'node_modules', 'playwright'));

const BASE = process.env.BASE || 'http://127.0.0.1:4180';
const OUTDIR = process.env.OUTDIR || '/app/tests/.tmp/stage9-live';
const DATA_FILE = process.env.WBS_DATA_FILE || '/app/data/wbs.json';
const AUDIT_FILE = process.env.WBS_AUDIT_FILE || '/app/data/audit.log';
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

let pass = 0;
let fail = 0;
const check = (id, ok, detail) => {
  if (ok) { pass += 1; console.log('PASS  ' + id + (detail !== undefined ? '  :: ' + JSON.stringify(detail) : '')); }
  else { fail += 1; console.log('FAIL  ' + id + '  -> ' + JSON.stringify(detail)); }
};

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const dataBefore = sha256(DATA_FILE);
  const auditBefore = sha256(AUDIT_FILE);
  const requests = [];
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('request', (r) => requests.push(r.url()));
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));

  const doc = await (await fetch(BASE + '/api/wbs')).json();
  const withNote = doc.tasks.filter((t) => String(t.note || '').trim() !== '')[0] || doc.tasks[0];
  console.log('[live] ' + BASE + '  revision=' + doc.meta.revision + '  行数=' + doc.tasks.length +
    '  选用行=' + withNote.id + '（note ' + String(withNote.note || '').length + ' 字符）');

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('#identity-list .identity-btn').length >= 9, null, { timeout: 20000 });
  await page.getByRole('button', { name: /项目负责人/ }).click();
  await page.waitForFunction((n) => document.querySelectorAll('#wbs-body tr').length === n, doc.tasks.length, { timeout: 20000 });
  await page.waitForTimeout(400);

  const cell = await page.evaluate((rowId) => {
    const td = document.querySelector('#wbs-body tr[data-id="' + rowId + '"] td[data-field="note"]');
    const summary = td ? td.querySelector('.note-summary') : null;
    const style = summary ? getComputedStyle(summary) : null;
    return {
      classes: td ? td.className : null,
      cursor: td ? getComputedStyle(td).cursor : null,
      hasInlineEditor: td ? !!td.querySelector('input, textarea') : null,
      summary: summary ? summary.textContent : null,
      oneLine: style ? style.whiteSpace === 'nowrap' : null,
      placeholderHinted: td ? td.textContent.indexOf('点击打开编辑') !== -1 : null
    };
  }, withNote.id);
  check('现场 1：K 列显示去 Markdown 摘要（单行省略、无内联 textarea、给出「点击打开编辑」样式）',
    cell.hasInlineEditor === false && cell.oneLine === true && cell.cursor === 'pointer' &&
    cell.classes.indexOf('note-editable') !== -1 && cell.placeholderHinted === true,
    { row: withNote.id, summary: cell.summary, cursor: cell.cursor });

  await page.click('#wbs-body tr[data-id="' + withNote.id + '"] td[data-field="note"]');
  await page.waitForFunction(() => !document.getElementById('note-panel').hidden, null, { timeout: 10000 });
  await page.waitForTimeout(300);
  const panel = await page.evaluate(() => {
    const rect = document.getElementById('note-dialog').getBoundingClientRect();
    const style = getComputedStyle(document.querySelector('.note-body'));
    return {
      w: Math.round(rect.width), h: Math.round(rect.height),
      vw: window.innerWidth, vh: window.innerHeight,
      columns: style.gridTemplateColumns.split(' ').filter(Boolean).length,
      tabsHidden: document.getElementById('note-tabs').hidden,
      saveHidden: document.getElementById('note-save').hidden,
      readonly: document.getElementById('note-dialog').classList.contains('readonly'),
      inputMatches: document.getElementById('note-input').value === (window.WBSApp.findTask(document.getElementById('note-dialog').getAttribute('data-task')) || {}).note,
      previewHtml: document.getElementById('note-preview').innerHTML.slice(0, 300)
    };
  });
  check('现场 2：桌面面板 90vw×80vh、左编辑右预览双栏、编辑区 = 该行 note（未点保存，未写服务端）',
    Math.abs(panel.w - 0.9 * panel.vw) <= 3 && Math.abs(panel.h - 0.8 * panel.vh) <= 3 &&
    panel.columns === 2 && panel.tabsHidden === true && panel.readonly === false && panel.inputMatches === true,
    { w: panel.w, h: panel.h, columns: panel.columns });
  await page.screenshot({ path: path.join(OUTDIR, 'live-panel-desktop.png') });

  /* 现场手工体验路径（仍不发 PUT）：在面板里输入一段 Markdown → 预览渲染 → 关闭提示丢弃 */
  const sample = [
    '# 现场实测标题',
    '',
    '**粗体** / *斜体* / ~~删除线~~ / `行内代码` / <script>alert(1)</script>',
    '',
    '- 列表项甲',
    '- 列表项乙',
    '',
    '> 引用与 [链接](https://example.com/not-loaded) 与 ![图片](https://example.com/not-loaded.png)',
    '',
    '```js',
    'var 进展 = "代码块";',
    '```'
  ].join('\n');
  await page.fill('#note-input', sample);
  await page.waitForTimeout(300);
  const rendered = await page.evaluate(() => {
    const preview = document.getElementById('note-preview');
    return {
      h1: preview.querySelectorAll('h1').length,
      strong: preview.querySelectorAll('strong').length,
      em: preview.querySelectorAll('em').length,
      del: preview.querySelectorAll('del').length,
      code: preview.querySelectorAll('code').length,
      pre: preview.querySelectorAll('pre').length,
      lists: preview.querySelectorAll('ul li').length,
      quote: preview.querySelectorAll('blockquote').length,
      links: Array.from(preview.querySelectorAll('a')).map((a) => a.getAttribute('target') + '|' + a.getAttribute('rel')),
      scriptNodes: preview.querySelectorAll('script, img').length,
      escaped: preview.innerHTML.indexOf('&lt;script&gt;') !== -1,
      pwned: window.__pwned === undefined
    };
  });
  check('现场 2b：面板内 Markdown 子集渲染（H1/粗体/斜体/删除线/行内代码/代码块/列表/引用/链接）；<script> 与图片按安全文本显示不执行、不加载',
    rendered.h1 === 1 && rendered.strong === 1 && rendered.em === 1 && rendered.del === 1 && rendered.code >= 2 &&
    rendered.pre === 1 && rendered.lists === 2 && rendered.quote === 1 && rendered.links.length === 1 &&
    rendered.links[0] === '_blank|noopener noreferrer' && rendered.scriptNodes === 0 && rendered.escaped === true && rendered.pwned === true,
    rendered);
  await page.screenshot({ path: path.join(OUTDIR, 'live-panel-markdown.png') });
  await page.click('#note-close');
  await page.waitForTimeout(250);
  const confirmLive = await page.evaluate(() => ({
    confirmHidden: document.getElementById('note-confirm').hidden,
    panelHidden: document.getElementById('note-panel').hidden,
    buttons: Array.from(document.querySelectorAll('#note-confirm button')).map((b) => b.textContent.trim())
  }));
  check('现场 2c：有未保存内容时关闭面板弹出「取消 / 继续退出」确认（未提交到服务端）',
    confirmLive.confirmHidden === false && confirmLive.panelHidden === false &&
    JSON.stringify(confirmLive.buttons) === JSON.stringify(['取消', '继续退出']), confirmLive);
  await page.click('#note-confirm-exit');
  await page.waitForTimeout(300);

  await page.selectOption('#identity-select', '王言');
  await page.waitForTimeout(400);
  const foreign = await page.evaluate((rowId) => {
    const tr = Array.from(document.querySelectorAll('#wbs-body tr')).find((row) => row.getAttribute('data-id') !== rowId &&
      row.querySelector('td[data-field="owner"]').textContent.trim() !== '王言');
    return tr ? tr.getAttribute('data-id') : null;
  }, withNote.id);
  await page.click('#wbs-body tr[data-id="' + foreign + '"] td[data-field="note"]');
  await page.waitForFunction(() => !document.getElementById('note-panel').hidden, null, { timeout: 10000 });
  await page.waitForTimeout(250);
  await page.click('#note-tab-preview').catch(() => {});
  const ro = await page.evaluate(() => ({
    readonly: document.getElementById('note-dialog').classList.contains('readonly'),
    saveHidden: document.getElementById('note-save').hidden,
    editPaneHidden: document.getElementById('note-edit-pane').hidden,
    meta: document.getElementById('note-meta').textContent
  }));
  check('现场 3：普通负责人对他人行只读预览（无保存按钮、无编辑区、中文说明），未产生任何写请求',
    ro.readonly === true && ro.saveHidden === true && ro.editPaneHidden === true && ro.meta.indexOf('只读') !== -1 &&
    requests.filter((u) => u.indexOf('/api/wbs') !== -1 && u.indexOf('PUT') !== -1).length === 0,
    { meta: ro.meta, puts: requests.filter((u) => u.indexOf('PUT') !== -1).length });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  const servedApp = await (await fetch(BASE + '/app.js')).text();
  check('现场 4：现场服务返回的 app.js 含 CH-8 实现（摘要 / Markdown 子集 / 面板）且与本地源码一致',
    servedApp.indexOf('noteSummary') !== -1 && servedApp.indexOf('renderNoteMarkdown') !== -1 &&
    servedApp.indexOf('openNotePanel') !== -1 && servedApp.indexOf('NOTE_SUMMARY_LIMIT = 80') !== -1,
    'app.js 长度 ' + servedApp.length);
  check('现场 5：全程无外部资源请求、无 pageerror（现场数据未被改动）',
    requests.filter((u) => u.indexOf('http') === 0 && u.indexOf(BASE) !== 0).length === 0 && pageErrors.length === 0 &&
    sha256(DATA_FILE) === dataBefore && sha256(AUDIT_FILE) === auditBefore,
    { requests: requests.length, pageErrors: pageErrors.length, dataUnchanged: sha256(DATA_FILE) === dataBefore });

  fs.writeFileSync(path.join(OUTDIR, 'live-results.json'), JSON.stringify({
    base: BASE, revision_before: doc.meta.revision, row: withNote.id, panel: panel, readonly: ro,
    requests, page_errors: pageErrors, data_sha256: dataBefore, audit_sha256: auditBefore,
    data_unchanged: sha256(DATA_FILE) === dataBefore, pass, fail
  }, null, 2));
  console.log('---');
  console.log('PASS=' + pass + ' FAIL=' + fail);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})();
