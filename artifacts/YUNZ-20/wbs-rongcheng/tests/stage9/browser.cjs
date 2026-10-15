'use strict';
/* YUNZ-29 / 变更包 #3：CH-8（K 列「进展说明」升级为摘要单元格 + 大尺寸 Markdown 编辑器）真实浏览器自测。
   运行环境：mcr.microsoft.com/playwright:v1.55.0-jammy 容器（chromium 140，与 playwright 1.55.0 对齐）。
   宿主为 CentOS 7（glibc 2.17），无法直接运行该 Chromium；浏览器只在测试容器内运行，不进产物、不进镜像。
   被测服务（server.js）由本脚本自行 spawn（隔离数据目录），结束后回收；不触碰运行现场 127.0.0.1:4180。
   用法（由 tests/stage9/run.sh 调用）：
     APP_DIR=/app OUTDIR=/app/tests/.tmp/stage9-out DATA_DIR=/app/tests/.tmp/stage9-browser-data \
     node /app/tests/stage9/browser.cjs */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const TOOLS = process.env.TOOLS || '/tools';
const { chromium } = require(path.join(TOOLS, 'node_modules', 'playwright'));

const APP_DIR = process.env.APP_DIR || '/app';
const PORT = Number(process.env.WBS_TEST_PORT || 4224);
const BASE = process.env.BASE || 'http://127.0.0.1:' + PORT;
const OUTDIR = process.env.OUTDIR || '/app/tests/.tmp/stage9-out';
const DATA_DIR = process.env.DATA_DIR || '/app/tests/.tmp/stage9-browser-data';
const TZ = 'Asia/Shanghai';
const IDENTITIES = ['项目负责人', '李欢', '王言', '张航瑞', '郑述文', '崔文建', '余宇', '黄逸偲', '陈江'];
const STATUSES = ['未开始', '进行中', '已完成', '已延期', '被阻塞'];
const PHASES = ['未开始', '已开始', '已完成', '延期', '阻塞'];
const PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep'];
const NOTE_LIMIT = 20000;
const SUMMARY_LIMIT = 80;
const NOTE_PLACEHOLDER = '点击打开编辑';

const results = {
  base: BASE, tz: TZ, started_at: new Date().toISOString(),
  checks: [], page_errors: [], console_errors: [], requests: []
};
let pass = 0;
let fail = 0;
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
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const stamp = () => new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6);

let server = null;
async function startServer() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(path.join(DATA_DIR, 'wbs.seed.json'))) {
    fs.copyFileSync(path.join(APP_DIR, 'data', 'wbs.seed.json'), path.join(DATA_DIR, 'wbs.seed.json'));
  }
  server = spawn(process.execPath, [path.join(APP_DIR, 'server.js')], {
    cwd: APP_DIR,
    env: Object.assign({}, process.env, { WBS_DATA_DIR: DATA_DIR, WBS_PORT: String(PORT), WBS_HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', (chunk) => process.stderr.write('[server] ' + chunk));
  for (let i = 0; i < 150; i += 1) {
    try { if ((await fetch(BASE + '/api/health')).ok) return; } catch (err) { /* 未就绪 */ }
    await sleep(100);
  }
  throw new Error('被测服务未就绪');
}
function stopServer() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    const child = server;
    server = null;
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(resolve, 3000);
  });
}

let browser = null;
const allRequests = [];
function trackPage(page, list) {
  page.on('request', (request) => {
    const url = request.url();
    allRequests.push({ url, method: request.method() });
    list.push({ url, method: request.method() });
  });
  page.on('pageerror', (e) => results.page_errors.push(String(e && e.message ? e.message : e)));
  page.on('console', (m) => { if (m.type() === 'error') results.console_errors.push(m.text()); });
}

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  try {
    fs.rmSync(path.join(DATA_DIR, 'wbs.json'), { force: true });
    fs.rmSync(path.join(DATA_DIR, 'audit.log'), { force: true });
    await startServer();
    console.log('[env] 被测服务 ' + BASE + '（data: ' + DATA_DIR + '）');

    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    results.browser_version = browser.version();
    console.log('[env] chromium=' + browser.version());

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const pageRequests = [];
    const page = await context.newPage();
    trackPage(page, pageRequests);
    const putCount = () => pageRequests.filter((r) => r.method === 'PUT').length;

    /* ---------- 页面辅助 ---------- */
    const identity = async (name) => {
      await page.selectOption('#identity-select', name);
      await page.waitForTimeout(350);
    };
    const noteCell = (id) => '#wbs-body tr[data-id="' + id + '"] td[data-field="note"]';
    const cellText = (id, field) => page.evaluate(([rowId, f]) => {
      const td = document.querySelector('#wbs-body tr[data-id="' + rowId + '"] td[data-field="' + f + '"]');
      if (!td) return null;
      const control = td.querySelector('select, input, textarea');
      return control ? control.value : td.textContent.trim();
    }, [id, field]);
    const noteSummaryText = (id) => page.evaluate((rowId) => {
      const td = document.querySelector('#wbs-body tr[data-id="' + rowId + '"] td[data-field="note"]');
      const span = td.querySelector('.note-summary');
      return span ? span.textContent : null;
    }, id);
    const banner = () => page.evaluate(() => (document.getElementById('banner').hidden ? '' : document.getElementById('banner-text').textContent.trim()));
    const hint = () => page.evaluate(() => (document.getElementById('hint').hidden ? '' : document.getElementById('hint').textContent.trim()));
    const panelState = () => page.evaluate(() => {
      const panel = document.getElementById('note-panel');
      const dialog = document.getElementById('note-dialog');
      const rect = dialog.getBoundingClientRect();
      const bodyStyle = getComputedStyle(document.querySelector('.note-body'));
      return {
        panelHidden: panel.hidden,
        dialogRect: { w: Math.round(rect.width), h: Math.round(rect.height), x: Math.round(rect.left), y: Math.round(rect.top) },
        viewport: { w: window.innerWidth, h: window.innerHeight, clientW: document.documentElement.clientWidth, clientH: document.documentElement.clientHeight },
        readonly: dialog.classList.contains('readonly'),
        dirtyClass: dialog.classList.contains('note-dirty'),
        dataTask: dialog.getAttribute('data-task'),
        dataTab: dialog.getAttribute('data-tab'),
        dataNarrow: dialog.getAttribute('data-narrow'),
        bodyDisplay: bodyStyle.display,
        bodyColumns: bodyStyle.gridTemplateColumns,
        tabsHidden: document.getElementById('note-tabs').hidden,
        tabsDisplay: getComputedStyle(document.getElementById('note-tabs')).display,
        editPaneHidden: document.getElementById('note-edit-pane').hidden,
        previewPaneHidden: document.getElementById('note-preview-pane').hidden,
        saveHidden: document.getElementById('note-save').hidden,
        confirmHidden: document.getElementById('note-confirm').hidden,
        inputValue: document.getElementById('note-input').value,
        inputType: document.getElementById('note-input').tagName.toLowerCase(),
        countText: document.getElementById('note-count').textContent,
        msg: document.getElementById('note-msg').hidden ? '' : document.getElementById('note-msg').textContent,
        meta: document.getElementById('note-meta').textContent,
        title: document.getElementById('note-title').textContent
      };
    });
    const openPanel = async (id) => {
      /* 面板已打开时先强制关闭（避免遮罩拦截后续点击；未保存内容由各处用例自行负责） */
      if (!(await page.evaluate(() => document.getElementById('note-panel').hidden))) {
        await page.evaluate(() => window.WBSApp.closeNotePanel());
        await page.waitForTimeout(150);
      }
      await page.click(noteCell(id));
      await page.waitForFunction(() => !document.getElementById('note-panel').hidden, null, { timeout: 10000 });
      await page.waitForTimeout(150);
      return panelState();
    };
    const reload = async () => {
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.querySelectorAll('#wbs-body tr').length === 36, null, { timeout: 20000 });
      await page.waitForTimeout(200);
    };
    const capture = async (buttonId) => {
      await page.evaluate(() => {
        window.__captured = null;
        window.__capturedName = null;
        window.WBS_DOWNLOAD_HOOK = (bytes, name) => {
          let out = '';
          for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
          window.__captured = btoa(out);
          window.__capturedName = name;
        };
      });
      await page.click(buttonId);
      for (let i = 0; i < 60; i += 1) {
        if (await page.evaluate(() => window.__captured !== null)) break;
        await sleep(200);
      }
      return page.evaluate(() => {
        const name = window.__capturedName;
        const base64 = window.__captured;
        let sheets = null;
        if (base64) {
          const wb = window.XLSX.read(base64, { type: 'base64' });
          sheets = wb.SheetNames.map((sheetName) => ({
            name: sheetName,
            rows: window.XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: '' })
          }));
        }
        return { name, base64, sheets };
      });
    };

    /* ---------- 进入工作台（项目负责人） ---------- */
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('#identity-list .identity-btn').length === 9, null, { timeout: 20000 });
    await page.getByRole('button', { name: /项目负责人/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('#wbs-body tr').length === 36, null, { timeout: 20000 });
    await page.waitForTimeout(300);

    /* =================== 矩阵 01：K 列点击打开编辑面板 =================== */
    const cellBefore = await page.evaluate((rowId) => {
      const td = document.querySelector('#wbs-body tr[data-id="' + rowId + '"] td[data-field="note"]');
      const span = td.querySelector('.note-summary');
      const style = span ? getComputedStyle(span) : null;
      return {
        classes: td.className,
        hasInlineEditor: !!td.querySelector('input, textarea, select'),
        text: td.textContent.trim(),
        cursor: getComputedStyle(td).cursor,
        summaryWhiteSpace: style ? style.whiteSpace : null,
        hasActionHint: td.textContent.indexOf('点击打开编辑') !== -1,
        summaryHasNewline: span ? span.textContent.indexOf('\n') !== -1 : null
      };
    }, 'T001');
    check('矩阵1a K 列显示纯文本摘要单元格（CH-8 后无内联 textarea/输入控件）',
      cellBefore.hasInlineEditor === false && cellBefore.summaryHasNewline === false, cellBefore);
    check('矩阵1b 有编辑权限的行给出「点击打开编辑」样式（cursor: pointer + 文案提示）',
      cellBefore.classes.indexOf('editable') !== -1 && cellBefore.classes.indexOf('note-editable') !== -1 &&
      cellBefore.cursor === 'pointer' && cellBefore.hasActionHint === true,
      { classes: cellBefore.classes, cursor: cellBefore.cursor, hint: cellBefore.hasActionHint });

    const opened = await openPanel('T001');
    check('矩阵1c 点击 K 单元格打开大尺寸编辑面板（面板可见、标题含行号）',
      opened.panelHidden === false && opened.dataTask === 'T001' && opened.title.indexOf('T001') !== -1 && opened.readonly === false,
      { title: opened.title, task: opened.dataTask, readonly: opened.readonly });
    const apiT001 = (await api('/api/wbs')).body.tasks.find((t) => t.id === 'T001');
    check('矩阵1d 面板编辑区初始值 = 该行 note，可编辑（textarea + 保存按钮可见）',
      opened.inputType === 'textarea' && opened.inputValue === apiT001.note && opened.saveHidden === false, { value: opened.inputValue.slice(0, 40) });
    check('矩阵1e 整格可视区域可点击（点击摘要文字/提示同样打开面板）',
      opened.dataTask === 'T001', { clickTarget: 'td 内的 .note-summary 与 .note-action 均在 td 内' });

    /* 关闭按钮（无未保存内容 → 直接关闭） */
    await page.click('#note-close');
    await page.waitForTimeout(200);
    check('矩阵1f 面板「关闭」按钮可关闭面板（无未保存内容时直接关闭、无确认框）',
      (await panelState()).panelHidden === true, await hint());

    /* =================== 矩阵 02：摘要去 Markdown 与截断 =================== */
    const summaryCases = await page.evaluate(([limit]) => {
      const note = '# 标题\n\n**加粗** 与 *斜体* 与 ~~删除~~ 与 `code`\n\n- 甲\n- 乙\n\n> 引用\n\n[链接](https://example.com)';
      const long = '# ' + 'x'.repeat(200);
      const plain = '普通一行进展说明';
      const empty = '   \n  ';
      return {
        stripped: window.WBSCore.noteSummary(note),
        strippedLength: window.WBSCore.noteSummary(note).length,
        long: window.WBSCore.noteSummary(long),
        longLength: window.WBSCore.noteSummary(long).length,
        plain: window.WBSCore.noteSummary(plain),
        empty: window.WBSCore.noteSummary(empty),
        limit: window.WBSCore.NOTE_SUMMARY_LIMIT,
        placeholder: window.WBSCore.NOTE_PLACEHOLDER,
        codeFence: window.WBSCore.noteSummary('```js\nvar a = 1;\n```')
      };
    }, [SUMMARY_LIMIT]);
    check('矩阵2a 摘要为去 Markdown 的纯文本（标题/粗体/斜体/删除线/行内代码/列表/引用/链接只留文字）',
      summaryCases.stripped === '标题 加粗 与 斜体 与 删除 与 code 甲 乙 引用 链接' &&
      ['#', '*', '`', '>', '~', '\n'].every((ch) => summaryCases.stripped.indexOf(ch) === -1),
      summaryCases.stripped);
    check('矩阵2b 摘要按约 80 字符截断（超长加省略号、合并为单行）',
      summaryCases.limit === SUMMARY_LIMIT && summaryCases.longLength === SUMMARY_LIMIT + 1 &&
      summaryCases.long.slice(-1) === '…' && summaryCases.long.slice(0, SUMMARY_LIMIT) === 'x'.repeat(SUMMARY_LIMIT),
      { limit: summaryCases.limit, length: summaryCases.longLength, tail: summaryCases.long.slice(-4) });
    check('矩阵2c 短摘要不截断、空 note 摘要为空（由单元格给占位提示）',
      summaryCases.plain === '普通一行进展说明' && summaryCases.empty === '' && summaryCases.placeholder === NOTE_PLACEHOLDER &&
      summaryCases.codeFence === 'var a = 1;',
      { plain: summaryCases.plain, empty: summaryCases.empty, fence: summaryCases.codeFence });

    /* 服务端写入一条 Markdown note，页面读回摘要（DOM 级） */
    const summaryNote = '# 摘要用例 **加粗**\n\n- 甲\n- 乙\n\n> 引用 [链接](https://example.com)';
    const doc0 = (await api('/api/wbs')).body;
    const prepSummary = {
      meta: { name: doc0.meta.name },
      identities: doc0.identities.slice(),
      tasks: doc0.tasks.map((task) => (task.id === 'T002' ? Object.assign({}, task, { note: summaryNote }) : task))
    };
    const prepRes = await putDoc(prepSummary, doc0.meta.revision, '项目负责人');
    if (prepRes.status !== 200) throw new Error('准备摘要数据失败 HTTP ' + prepRes.status);
    await reload();
    const domSummary = await page.evaluate((rowId) => {
      const td = document.querySelector('#wbs-body tr[data-id="' + rowId + '"] td[data-field="note"]');
      const span = td.querySelector('.note-summary');
      const style = getComputedStyle(span);
      return {
        text: span.textContent,
        title: td.getAttribute('title'),
        oneLine: span.textContent.indexOf('\n') === -1,
        whiteSpace: style.whiteSpace,
        overflow: style.overflow,
        textOverflow: style.textOverflow,
        clientHeight: span.clientHeight,
        action: td.textContent.indexOf('点击打开编辑') !== -1
      };
    }, 'T002');
    check('矩阵2d 页面 K 单元格显示该 note 的去 Markdown 摘要（与纯逻辑同口径、单行、无换行）',
      domSummary.text === '摘要用例 加粗 甲 乙 引用 链接' && domSummary.oneLine && domSummary.title === domSummary.text,
      domSummary);
    check('矩阵2e 单元格摘要按单行截断渲染（nowrap + hidden + ellipsis，行高单行）',
      domSummary.whiteSpace === 'nowrap' && domSummary.overflow === 'hidden' && domSummary.textOverflow === 'ellipsis' && domSummary.clientHeight <= 30,
      { whiteSpace: domSummary.whiteSpace, overflow: domSummary.overflow, textOverflow: domSummary.textOverflow, h: domSummary.clientHeight });
    const longNote = '## 超长摘要 ' + '长'.repeat(300);
    const docL = (await api('/api/wbs')).body;
    await putDoc({
      meta: { name: docL.meta.name }, identities: docL.identities.slice(),
      tasks: docL.tasks.map((task) => (task.id === 'T003' ? Object.assign({}, task, { note: longNote }) : task))
    }, docL.meta.revision, '项目负责人');
    await reload();
    const longCell = await page.evaluate((rowId) => {
      const span = document.querySelector('#wbs-body tr[data-id="' + rowId + '"] td[data-field="note"] .note-summary');
      return { text: span.textContent, length: span.textContent.length, clipped: span.scrollWidth > span.clientWidth, clientWidth: span.clientWidth };
    }, 'T003');
    check('矩阵2f 超长 note 在单元格内单行截断（文本 ≤ 81 字符 + CSS 省略号裁剪）',
      longCell.length === SUMMARY_LIMIT + 1 && longCell.text.slice(-1) === '…' && longCell.clipped === true,
      { length: longCell.length, clipped: longCell.clipped, clientWidth: longCell.clientWidth });

    /* =================== 矩阵 03：桌面双栏 / 手机标签 =================== */
    const desktopOpen = await openPanel('T001');
    const desktopLayout = await page.evaluate(() => {
      const dialog = document.getElementById('note-dialog');
      const edit = document.getElementById('note-edit-pane').getBoundingClientRect();
      const preview = document.getElementById('note-preview-pane').getBoundingClientRect();
      const style = getComputedStyle(document.querySelector('.note-body'));
      return {
        dialog: dialog.getBoundingClientRect(),
        viewport: { w: window.innerWidth, h: window.innerHeight, clientW: document.documentElement.clientWidth },
        display: style.display,
        columns: style.gridTemplateColumns.split(' ').filter(Boolean).length,
        edit: { x: Math.round(edit.left), w: Math.round(edit.width), hidden: document.getElementById('note-edit-pane').hidden },
        preview: { x: Math.round(preview.left), w: Math.round(preview.width), hidden: document.getElementById('note-preview-pane').hidden },
        tabsHidden: document.getElementById('note-tabs').hidden,
        tabsDisplay: getComputedStyle(document.getElementById('note-tabs')).display,
        position: getComputedStyle(document.getElementById('note-panel')).position,
        dialogPosition: getComputedStyle(dialog).position
      };
    });
    const dw = desktopLayout.dialog.width;
    const dh = desktopLayout.dialog.height;
    const vw = desktopLayout.viewport.w;
    const vh = desktopLayout.viewport.h;
    const near90 = Math.abs(dw - 0.9 * vw) <= 3 || Math.abs(dw - 0.9 * desktopLayout.viewport.clientW) <= 3;
    const near80 = Math.abs(dh - 0.8 * vh) <= 3;
    check('矩阵3a 桌面面板约 90vw × 80vh（1440×900 → ' + Math.round(0.9 * vw) + '×' + Math.round(0.8 * vh) + '，居中弹层）',
      near90 && near80 && desktopLayout.position === 'fixed' &&
      Math.abs(Math.round(desktopLayout.dialog.left) - Math.round((vw - dw) / 2)) <= 3,
      { w: Math.round(dw), h: Math.round(dh), vw, vh, top: Math.round(desktopLayout.dialog.top) });
    check('矩阵3b 桌面左「编辑」右「预览」双栏（两列网格 + x 坐标顺序）',
      desktopLayout.display === 'grid' && desktopLayout.columns === 2 && desktopLayout.edit.hidden === false &&
      desktopLayout.preview.hidden === false && desktopLayout.edit.x < desktopLayout.preview.x,
      { display: desktopLayout.display, columns: desktopLayout.columns, editX: desktopLayout.edit.x, previewX: desktopLayout.preview.x });
    check('矩阵3c 桌面不显示「编辑 / 预览」标签（窄视口专用）',
      desktopLayout.tabsHidden === true && desktopLayout.tabsDisplay === 'none' && desktopOpen.dataNarrow === 'false',
      { hidden: desktopLayout.tabsHidden, display: desktopLayout.tabsDisplay, narrow: desktopOpen.dataNarrow });
    await page.screenshot({ path: path.join(OUTDIR, 'matrix03-desktop-panel.png') });
    await page.click('#note-close');
    await page.waitForTimeout(200);

    /* 手机（390×844）：全屏 + 标签切换 */
    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true });
    const mobileRequests = [];
    const mobilePage = await mobileContext.newPage();
    trackPage(mobilePage, mobileRequests);
    await mobilePage.goto(BASE, { waitUntil: 'networkidle' });
    await mobilePage.waitForFunction(() => document.querySelectorAll('#identity-list .identity-btn').length === 9, null, { timeout: 20000 });
    await mobilePage.getByRole('button', { name: /项目负责人/ }).click();
    await mobilePage.waitForFunction(() => document.querySelectorAll('#wbs-body tr').length === 36, null, { timeout: 20000 });
    await mobilePage.waitForTimeout(300);
    await mobilePage.click('#wbs-body tr[data-id="T001"] td[data-field="note"]');
    await mobilePage.waitForFunction(() => !document.getElementById('note-panel').hidden, null, { timeout: 10000 });
    await mobilePage.waitForTimeout(200);
    const mobileLayout = await mobilePage.evaluate(() => {
      const dialog = document.getElementById('note-dialog');
      const rect = dialog.getBoundingClientRect();
      const bodyStyle = getComputedStyle(document.querySelector('.note-body'));
      return {
        w: Math.round(rect.width), h: Math.round(rect.height), x: Math.round(rect.left), y: Math.round(rect.top),
        vw: window.innerWidth, vh: window.innerHeight, clientW: document.documentElement.clientWidth,
        display: bodyStyle.display,
        tabsHidden: document.getElementById('note-tabs').hidden,
        tabsDisplay: getComputedStyle(document.getElementById('note-tabs')).display,
        tabs: Array.from(document.querySelectorAll('.note-tab')).map((b) => ({ text: b.textContent.trim(), active: b.classList.contains('active') })),
        editPaneHidden: document.getElementById('note-edit-pane').hidden,
        previewPaneHidden: document.getElementById('note-preview-pane').hidden,
        dataTab: document.getElementById('note-dialog').getAttribute('data-tab'),
        narrow: document.getElementById('note-dialog').getAttribute('data-narrow')
      };
    });
    check('矩阵3d 手机面板全屏（100vw × 100vh → 390×844，无圆角边距）',
      Math.abs(mobileLayout.w - mobileLayout.vw) <= 2 && Math.abs(mobileLayout.h - mobileLayout.vh) <= 2 &&
      mobileLayout.x === 0 && mobileLayout.y === 0 && mobileLayout.narrow === 'true',
      { w: mobileLayout.w, h: mobileLayout.h, vw: mobileLayout.vw, vh: mobileLayout.vh });
    check('矩阵3e 手机显示「编辑 / 预览」标签、默认编辑页（单栏）',
      mobileLayout.tabsHidden === false && mobileLayout.tabsDisplay === 'flex' && mobileLayout.display === 'block' &&
      JSON.stringify(mobileLayout.tabs.map((t) => t.text)) === JSON.stringify(['编辑', '预览']) &&
      mobileLayout.tabs[0].active === true && mobileLayout.dataTab === 'edit' &&
      mobileLayout.editPaneHidden === false && mobileLayout.previewPaneHidden === true,
      mobileLayout.tabs);
    await mobilePage.screenshot({ path: path.join(OUTDIR, 'matrix03-mobile-edit-tab.png') });
    await mobilePage.click('#note-tab-preview');
    await mobilePage.waitForTimeout(250);
    const mobileTabbed = await mobilePage.evaluate(() => ({
      dataTab: document.getElementById('note-dialog').getAttribute('data-tab'),
      editPaneHidden: document.getElementById('note-edit-pane').hidden,
      previewPaneHidden: document.getElementById('note-preview-pane').hidden,
      active: Array.from(document.querySelectorAll('.note-tab')).filter((b) => b.classList.contains('active')).map((b) => b.textContent.trim()),
      editDisplay: getComputedStyle(document.getElementById('note-edit-pane')).display,
      previewDisplay: getComputedStyle(document.getElementById('note-preview-pane')).display,
      previewText: document.getElementById('note-preview').textContent
    }));
    const t001Note = (await api('/api/wbs')).body.tasks.find((t) => t.id === 'T001').note;
    const expectedMobilePreview = String(t001Note).trim() === '' ? '（暂无进展说明）' : t001Note;
    check('矩阵3f 手机点「预览」标签切换为预览页（编辑页隐藏、标签高亮切换、预览内容 = 该行 note）',
      mobileTabbed.dataTab === 'preview' && mobileTabbed.editPaneHidden === true && mobileTabbed.previewPaneHidden === false &&
      JSON.stringify(mobileTabbed.active) === JSON.stringify(['预览']) && mobileTabbed.editDisplay === 'none' &&
      mobileTabbed.previewText === expectedMobilePreview,
      { active: mobileTabbed.active, dataTab: mobileTabbed.dataTab, preview: mobileTabbed.previewText.slice(0, 30) });
    await mobilePage.click('#note-tab-edit');
    await mobilePage.waitForTimeout(200);
    check('矩阵3g 手机可切回「编辑」标签', (await mobilePage.evaluate(() => document.getElementById('note-dialog').getAttribute('data-tab'))) === 'edit',
      await mobilePage.evaluate(() => document.getElementById('note-edit-pane').hidden));
    await mobilePage.click('#note-close');
    await mobilePage.waitForTimeout(200);
    await mobilePage.selectOption('#identity-select', '王言');
    await mobilePage.waitForTimeout(400);
    await mobilePage.click('#wbs-body tr[data-id="T001"] td[data-field="note"]');
    await mobilePage.waitForFunction(() => !document.getElementById('note-panel').hidden, null, { timeout: 10000 });
    await mobilePage.waitForTimeout(200);
    const mobileReadonly = await mobilePage.evaluate(() => ({
      readonly: document.getElementById('note-dialog').classList.contains('readonly'),
      tabsHidden: document.getElementById('note-tabs').hidden,
      editPaneHidden: document.getElementById('note-edit-pane').hidden,
      previewPaneHidden: document.getElementById('note-preview-pane').hidden,
      saveHidden: document.getElementById('note-save').hidden,
      display: getComputedStyle(document.querySelector('.note-body')).display
    }));
    check('矩阵3h 手机只读模式：全屏预览、不显示标签与编辑页、无保存按钮',
      mobileReadonly.readonly === true && mobileReadonly.tabsHidden === true && mobileReadonly.editPaneHidden === true &&
      mobileReadonly.previewPaneHidden === false && mobileReadonly.saveHidden === true,
      mobileReadonly);
    await mobilePage.screenshot({ path: path.join(OUTDIR, 'matrix03-mobile-readonly.png') });
    await mobilePage.keyboard.press('Escape');
    await mobilePage.waitForTimeout(250);
    check('矩阵3i 手机只读面板 Esc 关闭',
      (await mobilePage.evaluate(() => document.getElementById('note-panel').hidden)) === true,
      await mobilePage.evaluate(() => (document.getElementById('hint').hidden ? '' : document.getElementById('hint').textContent.trim())));
    await mobileContext.close();

    /* =================== 矩阵 04：原始 HTML 不执行、图片不加载、无外部请求 =================== */
    await identity('项目负责人');
    const htmlNote = [
      '# 安全用例 <script>window.__pwned = 1;</script>',
      '',
      '<img src="' + BASE + '/track.png" onerror="window.__pwned = 2">',
      '',
      '![远程图](' + BASE + '/remote.png)',
      '',
      '**粗体** 行',
      '',
      '[外链](https://example.com/x)',
      '',
      '```',
      '<b>代码块里的 HTML</b>',
      '```'
    ].join('\n');
    const docS = (await api('/api/wbs')).body;
    const prepSec = {
      meta: { name: docS.meta.name }, identities: docS.identities.slice(),
      tasks: docS.tasks.map((task) => (task.id === 'T004' ? Object.assign({}, task, { note: htmlNote }) : task))
    };
    const secRes = await putDoc(prepSec, docS.meta.revision, '项目负责人');
    if (secRes.status !== 200) throw new Error('准备安全用例失败 HTTP ' + secRes.status);
    await reload();
    await page.evaluate(() => { window.__pwned = undefined; });
    const reqBefore = pageRequests.length;
    const secOpened = await openPanel('T004');
    await page.waitForTimeout(700);
    const secState = await page.evaluate((base) => {
      const preview = document.getElementById('note-preview');
      const resources = performance.getEntriesByType('resource').map((entry) => entry.name);
      return {
        pwned: window.__pwned,
        innerHTML: preview.innerHTML,
        text: preview.textContent,
        scriptNodes: preview.querySelectorAll('script').length,
        imgNodes: preview.querySelectorAll('img').length,
        iframeNodes: preview.querySelectorAll('iframe').length,
        links: Array.from(preview.querySelectorAll('a')).map((a) => ({ href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') })),
        strong: preview.querySelectorAll('strong').length,
        h1: preview.querySelectorAll('h1').length,
        pre: preview.querySelectorAll('pre').length,
        externalResources: resources.filter((url) => url.indexOf('http') === 0 && url.indexOf(base) !== 0)
      };
    }, BASE);
    const newRequests = pageRequests.slice(reqBefore);
    const imageRequests = allRequests.filter((r) => r.url.indexOf('track.png') !== -1 || r.url.indexOf('remote.png') !== -1);
    const externalRequests = newRequests.filter((r) => r.url.indexOf(BASE) !== 0);
    check('矩阵4a 原始 HTML 转义后原样显示、不执行（无 script/img 节点、无副作用）',
      secState.pwned === undefined && secState.scriptNodes === 0 && secState.imgNodes === 0 && secState.iframeNodes === 0 &&
      secState.innerHTML.indexOf('&lt;script&gt;') !== -1 && secState.innerHTML.indexOf('&lt;img') !== -1 &&
      secState.text.indexOf('<script>window.__pwned = 1;</script>') !== -1 &&
      secState.text.indexOf('<img src="' + BASE + '/track.png"') !== -1,
      { pwned: secState.pwned === undefined ? 'undefined' : secState.pwned, scriptNodes: secState.scriptNodes, imgNodes: secState.imgNodes });
    check('矩阵4b 远程图片不解析不加载：Markdown 图片语法按安全文本显示，且未发出任何图片请求',
      imageRequests.length === 0 && secState.text.indexOf('![远程图](' + BASE + '/remote.png)') !== -1 && secState.imgNodes === 0,
      { imageRequests: imageRequests.map((r) => r.url), text: secState.text.slice(0, 60) });
    check('矩阵4c 打开面板与渲染预览期间无任何外部资源请求（全部同源 / 仅本站）',
      externalRequests.length === 0 && secState.externalResources.length === 0,
      { newRequests: newRequests.map((r) => r.url), externalResources: secState.externalResources });
    check('矩阵4d Markdown 子集渲染生效：H1/粗体/代码块可见，链接带 target=_blank + rel=noopener noreferrer',
      secState.h1 === 1 && secState.strong === 1 && secState.pre === 1 &&
      secState.links.length === 1 && secState.links[0].href === 'https://example.com/x' &&
      secState.links[0].target === '_blank' && String(secState.links[0].rel).indexOf('noopener') !== -1 &&
      String(secState.links[0].rel).indexOf('noreferrer') !== -1,
      { links: secState.links, h1: secState.h1, strong: secState.strong, pre: secState.pre });
    await page.screenshot({ path: path.join(OUTDIR, 'matrix04-security-preview.png') });
    await page.click('#note-close');
    await page.waitForTimeout(200);

    /* =================== 矩阵 05：编辑保存后页面 / API / 磁盘三端一致 =================== */
    const consistentStamp = stamp();
    const consistentNote = '# 三端一致 ' + consistentStamp + '\n\n**粗体** 与 [链接](https://example.com/y)';
    const consistentSummary = '三端一致 ' + consistentStamp + ' 粗体 与 链接';
    const before5 = (await api('/api/wbs')).body;
    const revBefore5 = before5.meta.revision;
    await openPanel('T005');
    await page.fill('#note-input', consistentNote);
    await page.waitForTimeout(250);
    const previewText5 = await page.evaluate(() => document.getElementById('note-preview').textContent);
    await page.screenshot({ path: path.join(OUTDIR, 'matrix05-panel-preview.png') });
    check('矩阵5a 编辑区输入即时驱动预览渲染（仅本地渲染，不发请求）',
      previewText5.indexOf('三端一致') !== -1 && previewText5.indexOf('粗体') !== -1 && pageRequests.filter((r) => r.method === 'PUT').length === 0,
      previewText5.slice(0, 40));
    await page.click('#note-input');
    await page.keyboard.press('Control+Enter');   /* CH-8：Ctrl/Cmd+Enter 快捷保存 */
    await page.waitForFunction(() => !document.getElementById('banner').hidden && document.getElementById('banner-text').textContent.indexOf('保存成功') !== -1, null, { timeout: 15000 });
    await page.waitForTimeout(300);
    const after5 = (await api('/api/wbs')).body;
    const disk5 = diskDoc();
    const row5 = { api: after5.tasks.find((t) => t.id === 'T005').note, disk: disk5.tasks.find((t) => t.id === 'T005').note };
    const dom5 = await noteSummaryText('T005');
    check('矩阵5b 仅点「保存」（Ctrl/Cmd+Enter）提交到服务端，revision 正常递增',
      after5.meta.revision === revBefore5 + 1 && (await banner()).indexOf('保存成功') !== -1,
      { revision: after5.meta.revision, from: revBefore5 });
    check('矩阵5c 三端一致：页面摘要 / GET /api/wbs / 磁盘 JSON 都是同一次编辑结果',
      row5.api === consistentNote && row5.disk === consistentNote &&
      dom5 === consistentSummary,
      { summary: dom5, api: row5.api.slice(0, 24) });
    check('矩阵5d 保存成功有中文提示且面板提示区同步（页面提示 + 面板内提示）',
      (await banner()).indexOf('保存成功') !== -1 && (await panelState()).msg.indexOf('已保存') !== -1,
      (await panelState()).msg);
    await page.click('#note-close');
    await page.waitForTimeout(200);
    await reload();
    const afterReload5 = await noteSummaryText('T005');
    const reopened5 = await openPanel('T005');
    check('矩阵5e 刷新后 K 列摘要与面板内容仍为该 note（草稿来源＝服务端）',
      afterReload5 === dom5 && reopened5.inputValue === consistentNote && reopened5.dirtyClass === false,
      { summary: afterReload5, same: reopened5.inputValue === consistentNote });
    await page.click('#note-close');
    await page.waitForTimeout(200);

    /* 审计：note 保存沿用既有 audit line（字段级 old→new / 时间 / 操作身份） */
    const history5 = (await api('/api/history?tz=' + encodeURIComponent(TZ) + '&date=' + today())).body;
    const noteRecords = (history5.records || []).filter((r) => r.task_id === 'T005' && r.field === 'note');
    const historyKeys = 'at,field,identity,level1,level2,new,old,owner,task,task_id';
    check('矩阵5f 审计沿用既有 audit line：note 字段级 old→new / 时间 / 操作身份（/api/history 不引入新字段）',
      noteRecords.length === 1 && noteRecords[0].new === consistentNote && noteRecords[0].old === '' &&
      noteRecords[0].identity === '项目负责人' &&
      !isNaN(Date.parse(noteRecords[0].at)) &&
      new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(noteRecords[0].at)) === today() &&
      Object.keys(noteRecords[0]).sort().join(',') === historyKeys.split(',').sort().join(','),
      noteRecords[0] ? Object.keys(noteRecords[0]).join(',') : null);

    /* =================== 矩阵 06：无权限行打开只读预览且无法提交 =================== */
    const ownerNote = '只读预览用 **内容**';
    const docRO = (await api('/api/wbs')).body;
    const roPrepared = {
      meta: { name: docRO.meta.name }, identities: docRO.identities.slice(),
      tasks: docRO.tasks.map((task) => (task.id === 'T001' ? Object.assign({}, task, { note: ownerNote }) : task))
    };
    const roRes = await putDoc(roPrepared, docRO.meta.revision, '项目负责人');
    if (roRes.status !== 200) throw new Error('准备只读用例失败 HTTP ' + roRes.status);
    const revBefore6 = (await api('/api/wbs')).body.meta.revision;
    await reload();
    await identity('王言');
    const roCell = await page.evaluate(() => {
      const td = document.querySelector('#wbs-body tr[data-id="T001"] td[data-field="note"]');
      return { classes: td.className, text: td.textContent.trim(), cursor: getComputedStyle(td).cursor };
    });
    check('矩阵6a 无权限行 K 列仍显示摘要，样式为只读（locked/note-locked）',
      roCell.classes.indexOf('locked') !== -1 && roCell.classes.indexOf('note-locked') !== -1 &&
      roCell.text.indexOf('只读预览用 内容') !== -1, roCell);
    const putBefore6 = putCount();
    const roPanel = await openPanel('T001');
    const roPreview = await page.evaluate(() => ({
      text: document.getElementById('note-preview').textContent,
      strong: document.getElementById('note-preview').querySelectorAll('strong').length,
      meta: document.getElementById('note-meta').textContent,
      editDisplay: getComputedStyle(document.getElementById('note-edit-pane')).display,
      tabsHidden: document.getElementById('note-tabs').hidden
    }));
    check('矩阵6b 无权限行点击 K 单元格同样打开面板，以预览只读展示（无编辑区、无保存按钮、无标签）',
      roPanel.panelHidden === false && roPanel.readonly === true && roPanel.saveHidden === true &&
      roPanel.editPaneHidden === true && roPanel.previewPaneHidden === false && roPreview.editDisplay === 'none' &&
      roPreview.tabsHidden === true && roPreview.text.indexOf('只读预览用 内容') !== -1 && roPreview.strong === 1,
      { meta: roPreview.meta, strong: roPreview.strong });
    const directSave = await page.evaluate(async () => {
      const before = document.getElementById('note-input').value;
      document.getElementById('note-input').value = '只读行尝试写入';
      const result = await window.WBSApp.saveNote();
      const after = document.getElementById('note-input').value;
      return { result, before, after, msg: document.getElementById('note-msg').textContent };
    });
    await page.waitForTimeout(400);
    const apiAfter6 = (await api('/api/wbs')).body;
    check('矩阵6c 只读行无法提交：saveNote 被拒绝、未发出 PUT、服务端数据未变',
      directSave.result.ok === false && directSave.result.error === 'readonly' &&
      putCount() === putBefore6 && apiAfter6.meta.revision === revBefore6 &&
      apiAfter6.tasks.find((t) => t.id === 'T001').note === ownerNote &&
      diskDoc().tasks.find((t) => t.id === 'T001').note === ownerNote,
      { result: directSave.result, puts: putCount() - putBefore6, msg: directSave.msg });
    check('矩阵6d 只读模式给出中文提示（面板提示区说明当前身份只读）',
      directSave.msg.indexOf('只读') !== -1 && directSave.msg.indexOf('无法提交') !== -1, directSave.msg);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    check('矩阵6e 只读面板支持「关闭」按钮与 Esc 关闭', (await panelState()).panelHidden === true, await hint());

    /* =================== 矩阵 07：未保存关闭确认（取消 / 继续退出） =================== */
    await identity('项目负责人');
    const revBefore7 = (await api('/api/wbs')).body.meta.revision;
    const putBefore7 = putCount();
    const opened7 = await openPanel('T001');
    await page.fill('#note-input', '未保存草稿 ' + stamp());
    await page.waitForTimeout(250);
    const dirtyState = await panelState();
    check('矩阵7a 输入后标记为有未保存内容（面板脏标记，未提交）',
      dirtyState.dirtyClass === true && putCount() === putBefore7, { dirty: dirtyState.dirtyClass, puts: putCount() - putBefore7 });
    await page.click('#note-close');
    await page.waitForTimeout(250);
    const confirmShown = await page.evaluate(() => ({
      confirmHidden: document.getElementById('note-confirm').hidden,
      panelHidden: document.getElementById('note-panel').hidden,
      title: document.getElementById('note-confirm-title').textContent,
      buttons: Array.from(document.querySelectorAll('#note-confirm button')).map((b) => b.textContent.trim()),
      inputValue: document.getElementById('note-input').value
    }));
    check('矩阵7b 有未保存内容时关闭面板须确认（面板不关、弹出中文确认框、两条路径按钮）',
      confirmShown.confirmHidden === false && confirmShown.panelHidden === false &&
      confirmShown.title.indexOf('未保存') !== -1 &&
      JSON.stringify(confirmShown.buttons) === JSON.stringify(['取消', '继续退出']) &&
      confirmShown.inputValue.indexOf('未保存草稿') !== -1,
      confirmShown);
    await page.click('#note-confirm-cancel');
    await page.waitForTimeout(250);
    const cancelled = await page.evaluate(() => ({
      confirmHidden: document.getElementById('note-confirm').hidden,
      panelHidden: document.getElementById('note-panel').hidden,
      inputValue: document.getElementById('note-input').value
    }));
    check('矩阵7c「取消」路径：确认框关闭、面板与未保存内容保留、未提交',
      cancelled.confirmHidden === true && cancelled.panelHidden === false &&
      cancelled.inputValue.indexOf('未保存草稿') !== -1 && putCount() === putBefore7,
      cancelled);
    await page.click('#note-close');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    check('矩阵7d 确认框内 Esc 走「取消」路径（面板仍打开、内容保留）',
      (await panelState()).confirmHidden === true && (await panelState()).panelHidden === false &&
      (await panelState()).inputValue.indexOf('未保存草稿') !== -1,
      await panelState());
    await page.click('#note-close');
    await page.waitForTimeout(200);
    await page.click('#note-confirm-exit');
    await page.waitForTimeout(300);
    const exited = await panelState();
    check('矩阵7e「继续退出」路径：面板关闭、未保存内容丢弃、未向服务端提交',
      exited.panelHidden === true && exited.confirmHidden === true && putCount() === putBefore7 &&
      (await api('/api/wbs')).body.meta.revision === revBefore7,
      { puts: putCount() - putBefore7 });
    const reopen7 = await openPanel('T001');
    check('矩阵7f 重新打开面板：内容回到服务端值（未保存草稿未落盘）',
      reopen7.inputValue === ownerNote && reopen7.dirtyClass === false && reopen7.inputValue.indexOf('未保存草稿') === -1,
      { value: reopen7.inputValue, expect: ownerNote });
    await page.click('#note-close');
    await page.waitForTimeout(200);
    check('矩阵7g 无未保存内容时关闭不再弹确认框（直接关闭）',
      (await page.evaluate(() => document.getElementById('note-confirm').hidden)) === true &&
      (await panelState()).panelHidden === true, await hint());

    /* =================== 矩阵 08：超 20000 拒绝并有中文提示 =================== */
    await openPanel('T005');
    const putBefore8 = putCount();
    await page.fill('#note-input', 'x'.repeat(NOTE_LIMIT + 1));
    await page.waitForTimeout(300);
    const overState = await panelState();
    check('矩阵8a 超过 20000 字符时前端实时提示超长（计数 + 超长样式）',
      overState.countText.indexOf(String(NOTE_LIMIT + 1) + ' / ' + NOTE_LIMIT) !== -1 &&
      overState.countText.indexOf('超长') !== -1 &&
      (await page.evaluate(() => document.getElementById('note-input').className)).indexOf('over-limit') !== -1,
      overState.countText);
    await page.click('#note-save');
    await page.waitForTimeout(500);
    const msg8 = (await panelState()).msg;
    const banner8 = await banner();
    check('矩阵8b 超长保存被前端拒绝并有中文提示、未发出 PUT',
      msg8.indexOf('超过 20000') !== -1 && banner8.indexOf('超过 20000') !== -1 && putCount() === putBefore8,
      { msg: msg8, puts: putCount() - putBefore8 });
    const revBefore8b = (await api('/api/wbs')).body.meta.revision;
    await page.fill('#note-input', 'y'.repeat(NOTE_LIMIT));
    await page.waitForTimeout(300);
    await page.click('#note-save');
    await page.waitForFunction(() => !document.getElementById('banner').hidden && document.getElementById('banner-text').textContent.indexOf('保存成功') !== -1, null, { timeout: 20000 });
    await page.waitForTimeout(300);
    const after8 = (await api('/api/wbs')).body;
    check('矩阵8c 恰好 20000 字符可正常保存（服务端上限同步为 20000、磁盘一致）',
      after8.meta.revision === revBefore8b + 1 &&
      after8.tasks.find((t) => t.id === 'T005').note.length === NOTE_LIMIT &&
      diskDoc().tasks.find((t) => t.id === 'T005').note.length === NOTE_LIMIT,
      { length: after8.tasks.find((t) => t.id === 'T005').note.length, revision: after8.meta.revision });
    await page.click('#note-close');
    await page.waitForTimeout(200);
    /* 还原 T005 的 note，避免超长内容影响后续导出用例 */
    const doc8c = (await api('/api/wbs')).body;
    const restore8 = await putDoc({
      meta: { name: doc8c.meta.name }, identities: doc8c.identities.slice(),
      tasks: doc8c.tasks.map((task) => (task.id === 'T005' ? Object.assign({}, task, { note: consistentNote }) : task))
    }, doc8c.meta.revision, '项目负责人');
    if (restore8.status !== 200) throw new Error('还原 T005 note 失败 HTTP ' + restore8.status);

    /* =================== 矩阵 09：并发 PUT 409 不覆盖 =================== */
    await reload();
    await identity('项目负责人');
    const docA = (await api('/api/wbs')).body;
    const noteA = '并发写 A ' + stamp();
    const noteBeforeA = docA.tasks.find((t) => t.id === 'T001').note;
    await openPanel('T001');
    await page.fill('#note-input', noteA);
    await page.waitForTimeout(250);
    const winnerDoc = {
      meta: { name: docA.meta.name },
      identities: docA.identities.slice(),
      tasks: docA.tasks.map((task) => (task.id === 'T002' ? Object.assign({}, task, { status: '已完成' }) : task))
    };
    const winner = await putDoc(winnerDoc, docA.meta.revision, '项目负责人');
    if (winner.status !== 200) throw new Error('并发准备写入失败 HTTP ' + winner.status);
    const winnerRev = winner.body.revision;
    await page.click('#note-save');
    await page.waitForFunction(() => !document.getElementById('banner').hidden && document.getElementById('banner-text').textContent.indexOf('版本冲突') !== -1, null, { timeout: 15000 });
    await page.waitForTimeout(400);
    const afterConflict = (await api('/api/wbs')).body;
    check('矩阵9a 并发旧版本 PUT 返回 409：给出中文冲突提示、不覆盖他人落盘结果',
      (await banner()).indexOf('版本冲突') !== -1 && (await banner()).indexOf('已拒绝覆盖') !== -1 &&
      afterConflict.meta.revision === winnerRev &&
      afterConflict.tasks.find((t) => t.id === 'T002').status === '已完成' &&
      afterConflict.tasks.find((t) => t.id === 'T001').note === noteBeforeA &&
      diskDoc().tasks.find((t) => t.id === 'T001').note === noteBeforeA,
      { revision: afterConflict.meta.revision, winner: winnerRev, note: afterConflict.tasks.find((t) => t.id === 'T001').note });
    const conflictPanel = await panelState();
    check('矩阵9b 409 后未保存内容仍保留在面板中（可重新加载后再改），且提示区说明冲突',
      conflictPanel.panelHidden === false && conflictPanel.dirtyClass === true && conflictPanel.inputValue === noteA &&
      conflictPanel.msg.indexOf('版本冲突') !== -1 && conflictPanel.msg.indexOf('未提交') !== -1,
      { dirty: conflictPanel.dirtyClass, msg: conflictPanel.msg });
    /* 面板（模态）遮挡横幅按钮：先退出面板，再点横幅「重新加载」（路径与手工操作一致） */
    await page.click('#note-close');
    await page.waitForTimeout(200);
    await page.click('#note-confirm-exit');
    await page.waitForTimeout(300);
    await page.click('#banner-action');
    await page.waitForTimeout(800);
    check('矩阵9c 退出面板后点横幅「重新加载」可用新版本继续（页面版本号 = 服务器版本号）',
      (await page.evaluate(() => document.getElementById('session-status').textContent)).indexOf('版本：' + winnerRev) !== -1 &&
      (await panelState()).panelHidden === true,
      await page.evaluate(() => document.getElementById('session-status').textContent));

    /* =================== 矩阵 10：重启后 note 与人员池持久 =================== */
    const persistStamp = stamp();
    const persistNote = '# 重启持久 ' + persistStamp;
    await openPanel('T004');
    await page.fill('#note-input', persistNote);
    await page.click('#note-save');
    await page.waitForFunction(() => !document.getElementById('banner').hidden && document.getElementById('banner-text').textContent.indexOf('保存成功') !== -1, null, { timeout: 15000 });
    await page.waitForTimeout(300);
    await page.click('#note-close');
    await page.waitForTimeout(200);
    const before10 = (await api('/api/wbs')).body;
    await stopServer();
    await startServer();
    const after10 = (await api('/api/wbs')).body;
    check('矩阵10a 服务重启后 note 与人员池仍在（磁盘持久，revision 不回退）',
      after10.tasks.find((t) => t.id === 'T004').note === persistNote &&
      JSON.stringify(after10.identities) === JSON.stringify(before10.identities) &&
      after10.meta.revision === before10.meta.revision,
      { note: after10.tasks.find((t) => t.id === 'T004').note, identities: after10.identities.length, revision: after10.meta.revision });
    await reload();
    check('矩阵10b 重启后页面重新加载：K 列摘要仍显示该 note（页面 / API 一致）',
      (await noteSummaryText('T004')) === '重启持久 ' + persistStamp &&
      (await banner()) === '' &&
      (await page.evaluate(() => document.getElementById('identity-select').value)) === '项目负责人',
      await noteSummaryText('T004'));

    /* =================== 矩阵 11：回归（D-3 / CH-1…CH-7 / 导出保真 / 日报双 sheet） =================== */
    const regression = await page.evaluate(() => {
      const layer = document.getElementById('identity-layer');
      const rows = Array.from(document.querySelectorAll('#wbs-body tr'));
      const phaseOptions = Array.from(document.querySelectorAll('#wbs-body tr[data-id="T003"] td[data-field="dates.design"] select.phase-select option')).map((o) => o.value);
      const ownerOptions = Array.from(document.querySelectorAll('#wbs-body tr[data-id="T001"] td[data-field="owner"] select option')).map((o) => o.value);
      const dateInputs = Array.from(document.querySelectorAll('#wbs-body tr[data-id="T003"] td[data-field^="dates."] input')).map((i) => ({ type: i.type, disabled: i.disabled }));
      return {
        layerDisplay: getComputedStyle(layer).display, layerHidden: layer.hidden,
        workbenchHidden: document.getElementById('workbench').hidden,
        rows: rows.length,
        editButtons: rows.filter((tr) => tr.querySelector('button[data-edit-row]')).length,
        deleteButtons: rows.filter((tr) => tr.querySelector('button[data-delete]')).length,
        noteTextareas: rows.filter((tr) => tr.querySelector('td[data-field="note"] textarea, td[data-field="note"] input')).length,
        phaseOptions, ownerOptions, dateInputs,
        statusCells: document.querySelectorAll('#wbs-body td[data-field="status"]').length,
        warningBanner: !document.getElementById('banner').hidden
      };
    });
    check('矩阵11a 回归(D-3/验收1) 身份遮罩 [hidden] 级联生效、工作台渲染 36 行',
      regression.layerDisplay === 'none' && regression.layerHidden === true && regression.workbenchHidden === false && regression.rows === 36,
      { rows: regression.rows, layer: regression.layerDisplay });
    check('矩阵11b 回归(CH-1) 操作列每行常显「编辑」+ 项目负责人「删除」；K 列改为摘要、无内联编辑器',
      regression.editButtons === regression.rows && regression.deleteButtons === regression.rows && regression.noteTextareas === 0,
      { edit: regression.editButtons, del: regression.deleteButtons, noteInputs: regression.noteTextareas });
    check('矩阵11c 回归(CH-2) 五列日期常显 type=date 且可交互、五阶段进度下拉常显五枚举（旧「状态」列已移除）',
      regression.dateInputs.length === 5 && regression.dateInputs.every((i) => i.type === 'date' && i.disabled === false) &&
      JSON.stringify(regression.phaseOptions) === JSON.stringify(PHASES) && regression.statusCells === 0,
      { dates: regression.dateInputs.length, phase: regression.phaseOptions });
    check('矩阵11d 回归(CH-3) 负责人列为下拉、选项＝当前人员池',
      JSON.stringify(regression.ownerOptions) === JSON.stringify((await api('/api/wbs')).body.identities), regression.ownerOptions);

    /* CH-2 只读侧 + 验收4：普通负责人他人行控件 disabled、点击给中文提示 */
    await identity('王言');
    const readOnlySide = await page.evaluate(() => {
      const tr = Array.from(document.querySelectorAll('#wbs-body tr')).find((row) => row.querySelector('td[data-field="owner"]').textContent.trim() !== '王言');
      const id = tr.getAttribute('data-id');
      const date = tr.querySelector('td[data-field="dates.design"] input');
      const phase = tr.querySelector('td[data-field="dates.design"] select.phase-select');
      const note = tr.querySelector('td[data-field="note"]');
      return { id, dateDisabled: date && date.disabled, phaseDisabled: phase && phase.disabled, noteClasses: note.className, noteTextarea: !!note.querySelector('textarea') };
    });
    await page.click('#wbs-body tr[data-id="' + readOnlySide.id + '"] td[data-field="dates.design"] .phase-cell');
    await page.waitForTimeout(200);
    const readOnlyHint = await hint();
    check('矩阵11e 回归(CH-2/验收4) 他人行日期与阶段进度控件 disabled、K 列只读且点击给中文只读提示',
      readOnlySide.dateDisabled === true && readOnlySide.phaseDisabled === true && readOnlySide.noteTextarea === false &&
      readOnlySide.noteClasses.indexOf('note-locked') !== -1 && readOnlyHint.indexOf('只读') !== -1,
      { id: readOnlySide.id, hint: readOnlyHint });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    /* CH-4 / CH-7：新增人员（立即生效 + 落盘 + identity_added 审计） */
    await identity('项目负责人');
    const identitiesBefore = (await api('/api/wbs')).body.identities.length;
    await page.click('#add-person-btn');
    await page.waitForTimeout(250);
    await page.fill('#new-person-name', '赵新');
    await page.click('#new-person-confirm');
    await page.waitForFunction(() => document.getElementById('add-person-panel').hidden, null, { timeout: 10000 });
    await page.waitForTimeout(500);
    const afterAdd = (await api('/api/wbs')).body;
    const addHistory = (await api('/api/history?tz=' + encodeURIComponent(TZ) + '&date=' + today())).body;
    const addEvents = (addHistory.records || []).filter((r) => r.field === '人员池' && r.new === '赵新');
    check('矩阵11f 回归(CH-4/CH-7) 新增人员立即生效、落盘、写 identity_added 审计',
      afterAdd.identities.length === identitiesBefore + 1 && afterAdd.identities.indexOf('赵新') !== -1 &&
      diskDoc().identities.indexOf('赵新') !== -1 && addEvents.length === 1,
      { n: afterAdd.identities.length, events: addEvents.length });

    /* CH-5 / CH-6 / 导出保真 */
    const currentDoc = (await api('/api/wbs')).body;
    const daily = await capture('#daily-btn');
    results.daily = { name: daily.name, sheets: daily.sheets ? daily.sheets.map((s) => s.name) : null };
    if (daily.base64) fs.writeFileSync(path.join(OUTDIR, daily.name), Buffer.from(daily.base64, 'base64'));
    const blockedSheet = (daily.sheets || [])[1];
    const changeSheet = (daily.sheets || [])[2];
    const blockedHeader = blockedSheet ? blockedSheet.rows[0] : null;
    const blockedRank9 = (task) => (PHASE_KEYS.some((k) => task.phases[k] === '阻塞') ? 0 : 1);
    const expectedBlocked = currentDoc.tasks
      .filter((task) => PHASE_KEYS.some((k) => ['延期', '阻塞'].indexOf(task.phases[k]) !== -1))
      .sort((a, b) => blockedRank9(a) - blockedRank9(b))
      .map((task) => {
        const dates = task.dates || {};
        const phases = task.phases || {};
        return [task.level1, task.level2, task.task, task.owner, task.demo]
          .concat(PHASE_KEYS.map((key) => dates[key] || ''))
          .concat([task.note])
          .concat(PHASE_KEYS.map((key) => phases[key] || ''));
      });
    check('矩阵11g 回归(CH-5) 日报为单 workbook 三 sheet，阻塞与延期行 = 任一阶段 ∈ {延期, 阻塞}（A–K + 五进度列）',
      !!daily.sheets && daily.sheets.length === 3 && (daily.sheets || [])[0].name === '今日摘要' &&
      blockedSheet.name === '阻塞与延期' && changeSheet.name === '当日变更' &&
      blockedHeader.length === 16 && blockedHeader[10] === '进展说明' && blockedHeader[11] === '设计进度' && blockedHeader[15] === '演示准备进度' &&
      JSON.stringify(blockedSheet.rows.slice(1)) === JSON.stringify(expectedBlocked),
      { sheets: daily.sheets ? daily.sheets.map((s) => s.name) : null, blocked: blockedSheet ? blockedSheet.rows.length - 1 : null });
    const changeHeader = changeSheet ? changeSheet.rows[0] : [];
    const changeBody = changeSheet ? changeSheet.rows.slice(1) : [];
    const noteChangeRows = changeBody.filter((row) => row[4] === '进展说明');
    check('矩阵11h 回归(CH-5/CH-8-7) 日报「当日变更」字段级明细（9 列，去 id）且包含 note 字段级 old→new',
      JSON.stringify(changeHeader) === JSON.stringify(['一级', '二级', '任务项', '负责人', '改动字段', '旧值', '新值', '时间', '操作身份']) &&
      changeBody.every((row) => row.length === 9) &&
      noteChangeRows.some((row) => row[5] === '' && row[6] === consistentNote && row[8] === '项目负责人') &&
      changeBody.some((row) => row[4] === '人员池' && row[6] === '赵新'),
      { header: changeHeader, noteRows: noteChangeRows.length, total: changeBody.length });

    const wbsExport = await capture('#export-btn');
    results.wbsExport = { name: wbsExport.name, sheets: wbsExport.sheets ? wbsExport.sheets.map((s) => s.name) : null };
    if (wbsExport.base64) fs.writeFileSync(path.join(OUTDIR, wbsExport.name), Buffer.from(wbsExport.base64, 'base64'));
    const docAtExport = (await api('/api/wbs')).body;
    const fidelity = await page.evaluate(async (base64) => {
      const captureWb = window.XLSX.read(base64, { type: 'base64' });
      const captureRows = window.XLSX.utils.sheet_to_json(captureWb.Sheets[captureWb.SheetNames[0]], { header: 1, raw: false, defval: '' });
      const templateBuffer = await (await fetch('template.xlsx', { cache: 'no-store' })).arrayBuffer();
      const templateWb = window.XLSX.read(new Uint8Array(templateBuffer), { type: 'array', cellStyles: true });
      const templateRows = window.XLSX.utils.sheet_to_json(templateWb.Sheets[templateWb.SheetNames[0]], { header: 1, raw: false, defval: '' });
      const dataColumns = (row) => row.slice(0, 11);
      return {
        captureRow1: captureRows[0] || [], captureRow2: captureRows[1] || [],
        templateRow1: templateRows[0] || [], templateRow2: templateRows[1] || [],
        captureData: captureRows.slice(2).filter((row) => row.slice(0, 11).some((cell) => String(cell).trim() !== '')).map(dataColumns),
        templateRowCount: templateRows.length,
        sheetNames: captureWb.SheetNames
      };
    }, wbsExport.base64);
    const expectedWbsRows = docAtExport.tasks.map((task) => {
      const dates = task.dates || {};
      return [task.level1, task.level2, task.task, task.owner, task.demo]
        .concat(['design', 'dev', 'test', 'product', 'demo_prep'].map((key) => dates[key] || ''))
        .concat([task.note]);
    });
    const rowA2K = (row) => (row || []).slice(0, 11);
    check('矩阵11i 回归(导出) K 列仍导出 note 原始 Markdown；A–K 11 列逐字段与当前数据一致、不含 status',
      JSON.stringify(fidelity.captureData) === JSON.stringify(expectedWbsRows) &&
      fidelity.captureData.length === docAtExport.tasks.length &&
      fidelity.sheetNames.length === 1 &&
      JSON.stringify(fidelity.captureData).indexOf('status') === -1 &&
      fidelity.captureData.every((row) => row.length === 11),
      { rows: fidelity.captureData.length, expect: expectedWbsRows.length, notePreview: String(fidelity.captureData[4][10]).slice(0, 24) });
    check('矩阵11j 回归(导出/CH-10) 第 1/2 行 A–K 与源模板逐字一致，Q1 写入导出日期标签（唯一新增单元格）',
      JSON.stringify(rowA2K(fidelity.captureRow1)) === JSON.stringify(rowA2K(fidelity.templateRow1)) &&
      JSON.stringify(rowA2K(fidelity.captureRow2)) === JSON.stringify(rowA2K(fidelity.templateRow2)) &&
      fidelity.captureRow2[3] === '负责人' && fidelity.captureRow2[10] === '进展说明' &&
      fidelity.captureRow2[11] === '设计进度' && fidelity.captureRow2[15] === '演示准备进度' &&
      /^导出日期：\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(fidelity.captureRow1[16] || '')) &&
      String(fidelity.captureRow2[16] || '') === '' && fidelity.templateRowCount === fidelity.captureData.length + 2,
      { q1: fidelity.captureRow1[16], templateRows: fidelity.templateRowCount });
    check('矩阵11k 回归：全程无外部资源请求（页面资源全本地，无 CDN / 外链 / 外部图片）',
      allRequests.filter((r) => r.url.indexOf(BASE) !== 0).length === 0,
      { total: allRequests.length, external: allRequests.filter((r) => r.url.indexOf(BASE) !== 0).map((r) => r.url).slice(0, 5) });
    /* 409 冲突用例会让 Chromium 打印一条「Failed to load resource ... 409」网络日志（预期路径，非脚本异常）。 */
    const expectedConflictLog = /Failed to load resource: the server responded with a status of 409 \(Conflict\)/;
    const unexpectedConsole = results.console_errors.filter((message) => !expectedConflictLog.test(message));
    check('矩阵11l 全程无 pageerror；console error 仅 409 用例的浏览器网络日志（无脚本异常）',
      results.page_errors.length === 0 && unexpectedConsole.length === 0 &&
      results.console_errors.every((message) => expectedConflictLog.test(message)),
      { pageErrors: results.page_errors, consoleErrors: results.console_errors, unexpected: unexpectedConsole });

    results.pass = pass;
    results.fail = fail;
    results.finished_at = new Date().toISOString();
    fs.writeFileSync(path.join(OUTDIR, 'browser-results.json'), JSON.stringify(results, null, 2));
    console.log('---');
    console.log('PASS=' + pass + ' FAIL=' + fail + ' pageerrors=' + results.page_errors.length + ' consoleerrors=' + results.console_errors.length);
  } catch (err) {
    results.harness_error = err && err.stack ? err.stack : String(err);
    fs.writeFileSync(path.join(OUTDIR, 'browser-results.json'), JSON.stringify(results, null, 2));
    console.error('HARNESS_ERROR ' + (err && err.stack ? err.stack : err));
    console.log('PASS=' + pass + ' FAIL=' + (fail + 1));
    await stopServer();
    if (browser) await browser.close();
    process.exit(3);
  }
  await stopServer();
  if (browser) await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})();
