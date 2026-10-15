'use strict';
/* YUNZ-36 / Stage16 独立复验：现场交付物（0.0.0.0:4180）真实浏览器只读交互 + 真实下载（WBS 导出）。
   由 AI-QV 自写，不加载被测作者的 tests/*。只读：不发出任何写请求（无 PUT / 无保存 / 无新增 / 无删除）。 */
const fs = require('fs');
const path = require('path');
const TOOLS = process.env.TOOLS || '/tools';
const { chromium } = require(path.join(TOOLS, 'node_modules', 'playwright'));

const BASE = process.env.BASE || 'http://127.0.0.1:4180';
const OUTDIR = process.env.OUTDIR || '/qv/results';
const DL_DIR = process.env.DLDIR || '/qv/downloads';
const SHOT_DIR = process.env.SHOTDIR || '/qv/shots';
const RESULT_FILE = process.env.RESULT_FILE || path.join(OUTDIR, 'live-browser-results.json');
const OK_MSG = '\u5df2\u590d\u5236\uff0c\u53ef\u76f4\u63a5\u7c98\u8d34\u5230\u5fae\u4fe1';

const results = { base: BASE, started_at: new Date().toISOString(), checks: [], page_errors: [], console_errors: [], requests: [] };
let pass = 0, fail = 0;
function check(id, ok, detail) {
  results.checks.push({ id, ok: !!ok, detail: detail === undefined ? null : detail });
  if (ok) { pass += 1; console.log('PASS  ' + id + (detail !== undefined ? '  :: ' + JSON.stringify(detail) : '')); }
  else { fail += 1; console.log('FAIL  ' + id + '  -> ' + JSON.stringify(detail)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const INIT_SCRIPT = `
window.__qv = { blob: 0, blobUrls: [], anchorClicks: 0, hookCalls: 0, execCommands: [], clipCalls: [] };
(function () {
  var _co = URL.createObjectURL;
  URL.createObjectURL = function (o) { window.__qv.blob += 1; try { window.__qv.blobUrls.push(String(o && o.type)); } catch (e) {} return _co.call(this, o); };
  var _click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this && this.download) window.__qv.anchorClicks += 1; return _click.call(this); };
  var _exec = document.execCommand.bind(document);
  document.execCommand = function (cmd) {
    if (String(cmd) === 'copy') {
      var el = document.activeElement;
      var val = (el && typeof el.value === 'string') ? el.value : '';
      window.__qv.execCommands.push({ cmd: 'copy', activeTag: el ? el.tagName : null, value: val });
    }
    return _exec(cmd);
  };
  try {
    var proto = Object.getPrototypeOf(navigator.clipboard);
    var orig = proto.writeText;
    proto.writeText = function (t) { window.__qv.clipCalls.push(String(t)); return orig.call(this, t); };
  } catch (e) {}
})();
`;

async function enterAs(page, name) {
  const layerVisible = await page.locator('#identity-layer').isVisible().catch(() => false);
  if (layerVisible) await page.locator('#identity-list button[data-identity="' + name + '"]').first().click();
  else await page.selectOption('#identity-select', String(name));
  await page.waitForTimeout(700);
}
function textDiff(a, b) {
  if (a === b) return null;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return { at: i, a: a.slice(i, i + 24), b: b.slice(i, i + 24), lenA: a.length, lenB: b.length };
  return { at: n, a: a.slice(n), b: b.slice(n), lenA: a.length, lenB: b.length };
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({
    acceptDownloads: true, viewport: { width: 1600, height: 1100 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await context.addInitScript(INIT_SCRIPT);
  const page = await context.newPage();
  const downloads = [];
  const xlsxResponses = [];
  page.on('pageerror', (e) => results.page_errors.push(String((e && e.message) || e)));
  page.on('console', (m) => { if (m.type() === 'error') results.console_errors.push(m.text()); });
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  page.on('response', (r) => {
    const ct = String(r.headers()['content-type'] || '');
    if (/spreadsheet|xlsx/i.test(ct) || /\.xlsx/i.test(r.url())) xlsxResponses.push({ url: r.url(), ct });
  });
  page.on('request', (r) => results.requests.push({ url: r.url(), method: r.method() }));

  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(700);

  /* L01 首页身份层可见、人员池渲染 */
  const idCount = await page.locator('#identity-list button[data-identity]').count();
  check('L01 首页身份层可见且人员池渲染 12 项', idCount === 12, { identity_items: idCount });

  await enterAs(page, '\u9879\u76ee\u8d1f\u8d23\u4eba');
  const wbVisible = await page.locator('#workbench').isVisible();
  const rowCount = await page.locator('#wbs-body tr').count();
  check('L02 项目负责人进入工作台（行数 35，D-3 遗留事实）', wbVisible && rowCount === 35, { workbench_visible: wbVisible, rows: rowCount });

  const api = await page.evaluate(async () => (await fetch('/api/daily?tz=Asia%2FShanghai&date=' +
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }), { cache: 'no-store' })).json());
  fs.writeFileSync(path.join(OUTDIR, 'live-daily.json'), JSON.stringify(api, null, 2));
  const hist = await page.evaluate(async () => (await fetch('/api/history?tz=Asia%2FShanghai&date=' +
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }), { cache: 'no-store' })).json());
  fs.writeFileSync(path.join(OUTDIR, 'live-history.json'), JSON.stringify(hist, null, 2));
  check('L03 保留项：GET /api/history 仍可用（ok + records 数组）',
    hist.ok === true && Array.isArray(hist.records), { ok: hist.ok, count: hist.count });
  check('L04 保留项：/api/daily 旧汇总数据源仍在（summary/blocked/changes/counts + 新 text）',
    Array.isArray(api.summary) && Array.isArray(api.blocked) && Array.isArray(api.changes) && !!api.counts && !!api.text, Object.keys(api));

  /* 清零下载哨兵 → 导出日报 */
  await page.evaluate(() => { window.__qv.blob = 0; window.__qv.blobUrls = []; window.__qv.anchorClicks = 0; window.__qv.clipCalls = []; window.__qv.execCommands = []; });
  await page.click('#daily-btn');
  await page.waitForTimeout(700);
  const rawText = await page.evaluate(() => document.getElementById('daily-text').textContent);
  const panelVisible = await page.locator('#daily-panel').isVisible();
  const roleAttr = await page.locator('#daily-panel [role="dialog"]').getAttribute('role');
  const modal = await page.locator('#daily-panel [role="dialog"]').getAttribute('aria-modal');
  const blockInfo = await page.evaluate(() => {
    const el = document.getElementById('daily-text');
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { tag: el.tagName, ws: cs.whiteSpace, ce: el.isContentEditable, tabindex: el.getAttribute('tabindex'),
             w: Math.round(r.width), h: Math.round(r.height) };
  });
  check('L05 现场点「导出日报」打开只读文本弹层（可见 + dialog + aria-modal）',
    panelVisible && roleAttr === 'dialog' && modal === 'true', { panelVisible, roleAttr, modal });
  check('L06 现场弹层文本 == /api/daily text.body 逐字一致', rawText === api.text.body, textDiff(rawText, api.text.body));
  check('L07 现场弹层文本块只读可聚焦（PRE + pre-wrap + 非 contenteditable + tabindex=0 + 有可见尺寸）',
    blockInfo.tag === 'PRE' && blockInfo.ws === 'pre-wrap' && blockInfo.ce === false && blockInfo.tabindex === '0' && blockInfo.w > 100 && blockInfo.h >= 0,
    blockInfo);
  const sent = await page.evaluate(() => ({ blob: window.__qv.blob, anchor: window.__qv.anchorClicks, urls: window.__qv.blobUrls }));
  check('L08 现场打开弹层不产生任何下载（无 createObjectURL / 无 a[download] / 无 download 事件）',
    sent.blob === 0 && sent.anchor === 0 && downloads.length === 0, { blob: sent.blob, anchor: sent.anchor, downloads });
  check('L09 全程无 xlsx / octet-stream 响应（日报不再产出文件）', xlsxResponses.length === 0, xlsxResponses);

  const lines = rawText.split('\n');
  const bad = lines.filter((l) => /\u3010\u5b8c\u6210\u3011|\u3010\u666e\u901a\u3011/i.test(l));
  check('L10 现场文本仅含阻塞 / 延期（不含完成 / 普通）', bad.length === 0, bad.slice(0, 3));
  const pat = /^\u3010(\u5ef6\u671f|\u963b\u585e)\u00b7\u9ad8\u98ce\u9669\u3011[^\/]+ \/ [^\/]+ \/ .+ @[^\uff1a]+\uff1a.+\u3002$/;
  const badLines = lines.slice(1).filter((l) => !pat.test(l));
  check('L11 现场事件行逐字模板【前缀】一级 / 二级 / 任务项 @负责人：结论。', badLines.length === 0, badLines.slice(0, 2));
  check('L12 现场概况行计数与事件行数一致（延期/阻塞）',
    lines[0] === '\u4eca\u65e5\u5ef6\u671f ' + api.text.delayedCount + ' \u9879 / \u963b\u585e ' + api.text.blockedCount + ' \u9879' &&
    lines.length - 1 === api.text.delayedCount + api.text.blockedCount,
    { first: lines[0], lineCount: lines.length, delayedCount: api.text.delayedCount, blockedCount: api.text.blockedCount });
  const cats = lines.slice(1).map((l) => (l.match(/^\u3010([^\u3011]+)\u3011/) || [])[1]);
  const lastDelay = cats.lastIndexOf('\u5ef6\u671f\u00b7\u9ad8\u98ce\u9669');
  const firstBlock = cats.indexOf('\u963b\u585e\u00b7\u9ad8\u98ce\u9669');
  check('L13 现场排序：延期条目全部在阻塞条目之前', firstBlock === -1 || lastDelay < firstBlock, { lastDelay, firstBlock });
  check('L14 现场弹层文本行 == /api/daily text.lines 逐行一致',
    JSON.stringify(lines.slice(1)) === JSON.stringify(api.text.lines), null);

  /* 对抗路径：双击 / 点击只读文本块不应进入编辑、不应触发其它面板 */
  await page.dblclick('#daily-text');
  await page.waitForTimeout(300);
  const afterDbl = await page.evaluate(() => ({
    ce: document.getElementById('daily-text').isContentEditable,
    sameText: document.getElementById('daily-text').textContent,
    panelOpen: !document.getElementById('daily-panel').hidden,
    noteOpen: !document.getElementById('note-panel').hidden,
    otherModals: Array.from(document.querySelectorAll('.modal')).filter((m) => !m.hidden && m.id !== 'daily-panel').map((m) => m.id),
  }));
  check('L15 对抗：双击只读文本块不进入编辑、不弹其它面板、文本不变',
    afterDbl.ce === false && afterDbl.sameText === rawText && afterDbl.panelOpen && afterDbl.noteOpen === false && afterDbl.otherModals.length === 0, afterDbl);
  await page.screenshot({ path: path.join(SHOT_DIR, 'live-daily-popup.png') });

  /* 复制路径①：navigator.clipboard（现场 51 条长文本） */
  await page.evaluate(() => { window.__qv.clipCalls = []; });
  await page.click('#daily-copy');
  await page.waitForTimeout(600);
  const msg1 = (await page.locator('#daily-msg').innerText().catch(() => '')).trim();
  const msg1Visible = await page.locator('#daily-msg').isVisible().catch(() => false);
  const clip1 = await page.evaluate(async () => { try { return await navigator.clipboard.readText(); } catch (e) { return '__ERR__' + e.message; } });
  const calls1 = await page.evaluate(() => window.__qv.clipCalls.slice());
  check('L16 路径① navigator.clipboard 成功 + 中文提示「已复制，可直接粘贴到微信」',
    msg1Visible && msg1 === OK_MSG && calls1.length === 1, { msg1, calls: calls1.length });
  check('L17 路径① 剪贴板文本 == 弹层文本（逐字，' + rawText.length + ' 字符）', clip1 === rawText, textDiff(clip1, rawText));

  /* 复制路径②：execCommand 兜底 */
  await page.evaluate(() => {
    window.__qv.clipCalls = []; window.__qv.execCommands = [];
    window.__qv_origClip = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });
  await page.click('#daily-copy');
  await page.waitForTimeout(600);
  const msg2 = (await page.locator('#daily-msg').innerText().catch(() => '')).trim();
  const execs = await page.evaluate(() => window.__qv.execCommands.slice());
  const calls2 = await page.evaluate(() => window.__qv.clipCalls.slice());
  const clip2 = await page.evaluate(async () => {
    Object.defineProperty(navigator, 'clipboard', { value: window.__qv_origClip, configurable: true });
    try { return await navigator.clipboard.readText(); } catch (e) { return '__ERR__' + e.message; }
  });
  check('L18 路径② navigator.clipboard 不可用 → 回退 execCommand("copy")（未调用 writeText）',
    execs.length === 1 && calls2.length === 0, { execs: execs.length, clipCalls: calls2.length });
  check('L19 路径② 成功 + 中文提示「已复制，可直接粘贴到微信」', msg2 === OK_MSG, { msg2 });
  check('L20 路径② execCommand 选中文本 == 弹层文本（逐字）',
    execs.length === 1 && execs[0].value === rawText, textDiff((execs[0] || {}).value || '', rawText));
  check('L21 路径② 剪贴板读回文本 == 弹层文本（逐字）', clip2 === rawText, textDiff(clip2, rawText));

  /* 关闭：按钮 + Esc */
  await page.click('#daily-close');
  await page.waitForTimeout(300);
  const closed1 = await page.locator('#daily-panel').isHidden();
  await page.click('#daily-btn');
  await page.waitForTimeout(400);
  const reopened = await page.locator('#daily-panel').isVisible();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const closed2 = await page.locator('#daily-panel').isHidden();
  check('L22 关闭按钮与 Esc 均可关闭弹层', closed1 && reopened && closed2, { closedByButton: closed1, reopened, closedByEsc: closed2 });

  /* 保留项 / 不回归：WBS「导出 Excel」仍能真实下载 */
  const wbsSnapshot = await page.evaluate(async () => (await fetch('/api/wbs', { cache: 'no-store' })).json());
  fs.writeFileSync(path.join(DL_DIR, 'live-wbs-at-export.json'), JSON.stringify(wbsSnapshot, null, 2));
  const dlPromise = page.waitForEvent('download', { timeout: 20000 });
  await page.click('#export-btn');
  const dl = await dlPromise;
  const name = dl.suggestedFilename();
  const savePath = path.join(DL_DIR, name);
  await dl.saveAs(savePath);
  check('L23 保留项：WBS「导出 Excel」仍真实下载（无回归）', /蓉城战役WBS-\d{8}\.xlsx$/.test(name), { filename: name });
  check('L24 WBS 导出文件名日期为今日（Asia/Shanghai）',
    name.indexOf(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }).replace(/-/g, '')) !== -1, { filename: name });

  /* 页面无外部请求（仅同源资源） */
  const external = results.requests.filter((r) => !r.url.startsWith(BASE) && !r.url.startsWith('data:') && !r.url.startsWith('blob:'));
  check('L25 页面全程无外部请求（仅同源 / data: / blob:）', external.length === 0, external.slice(0, 5));
  check('L26 无 pageerror / console error', results.page_errors.length === 0 && results.console_errors.length === 0,
    { page_errors: results.page_errors.slice(0, 3), console_errors: results.console_errors.slice(0, 3) });

  await context.close();
  await browser.close();
  results.pass = pass; results.fail = fail;
  results.live = { panel_text: rawText, panel_chars: rawText.length, daily_text: api.text, downloads, wbs_download: downloads.slice() };
  fs.writeFileSync(RESULT_FILE, JSON.stringify(results, null, 2));
  console.log('\n[live-browser] PASS=' + pass + ' FAIL=' + fail + '  (弹层 ' + rawText.length + ' 字符 / ' + rawText.split('\n').length + ' 行)');
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => { console.error('FATAL', err); process.exit(2); });
