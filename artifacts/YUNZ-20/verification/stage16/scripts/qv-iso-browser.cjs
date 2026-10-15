'use strict';
/* YUNZ-36 / Stage16 独立复验：隔离实例真实浏览器交互（Chromium）。
   由 AI-QV 自写，不加载被测作者的 tests/*；覆盖派发单必测 1/2/3/4/5/6。
   只读：不发出任何写请求。剪贴板两条路径均断言剪贴板文本 == 弹层文本（逐字）。 */
const fs = require('fs');
const path = require('path');
const TOOLS = process.env.TOOLS || '/tools';
const { chromium } = require(path.join(TOOLS, 'node_modules', 'playwright'));

const OUTDIR = process.env.OUTDIR || '/qv/results';
const EXPECTED = process.env.EXPECTED || path.join(OUTDIR, 'expected-text.json');
const INSTANCES = [
  { name: 'isoA', base: process.env.BASE_A || 'http://127.0.0.1:4260' },
  { name: 'isoB', base: process.env.BASE_B || 'http://127.0.0.1:4261' },
];
const OK_MSG = '\u5df2\u590d\u5236\uff0c\u53ef\u76f4\u63a5\u7c98\u8d34\u5230\u5fae\u4fe1';

const expected = JSON.parse(fs.readFileSync(EXPECTED, 'utf8'));
const results = { started_at: new Date().toISOString(), checks: [], page_errors: [], instance: [] };
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
      var sel = '';
      try { sel = String(window.getSelection() || ''); } catch (e) { sel = ''; }
      window.__qv.execCommands.push({ cmd: 'copy', activeTag: el ? el.tagName : null, value: val, selection: sel });
    }
    return _exec(cmd);
  };
  try {
    var proto = Object.getPrototypeOf(navigator.clipboard);
    var orig = proto.writeText;
    proto.writeText = function (t) { window.__qv.clipCalls.push(String(t)); return orig.call(this, t); };
  } catch (e) { /* 无 clipboard：忽略 */ }
})();
`;

async function enterAs(page, name) {
  const layerVisible = await page.locator('#identity-layer').isVisible().catch(() => false);
  if (layerVisible) {
    await page.locator('#identity-list button[data-identity="' + name + '"]').first().click();
  } else {
    await page.selectOption('#identity-select', String(name));
  }
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
  for (const inst of INSTANCES) {
    const prefix = inst.name.toUpperCase();
    const exp = expected[inst.name];
    const context = await browser.newContext({
      acceptDownloads: true, viewport: { width: 1500, height: 1100 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    await context.addInitScript(INIT_SCRIPT);
    const page = await context.newPage();
    const downloads = [];
    const xlsxResponses = [];
    const reqs = [];
    page.on('pageerror', (e) => results.page_errors.push(inst.name + ': ' + String((e && e.message) || e)));
    page.on('download', (d) => downloads.push(d.suggestedFilename()));
    page.on('response', (r) => {
      const ct = String(r.headers()['content-type'] || '');
      if (/spreadsheet|xlsx|octet-stream/i.test(ct) || /\.xlsx/i.test(r.url())) xlsxResponses.push({ url: r.url(), ct });
    });
    page.on('request', (r) => reqs.push({ url: r.url(), method: r.method() }));

    await page.goto(inst.base + '/', { waitUntil: 'load' });
    await page.waitForTimeout(600);
    await enterAs(page, '\u9879\u76ee\u8d1f\u8d23\u4eba');

    /* 直接取服务端口径，作为独立对照 */
    const api = await page.evaluate(async () => (await fetch('/api/daily?tz=Asia%2FShanghai&date=' +
      new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }), { cache: 'no-store' })).json());
    fs.writeFileSync(path.join(OUTDIR, inst.name + '-daily.json'), JSON.stringify(api, null, 2));

    /* 清零下载哨兵，进入「导出日报」流程 */
    await page.evaluate(() => { window.__qv.blob = 0; window.__qv.blobUrls = []; window.__qv.anchorClicks = 0; window.__qv.clipCalls = []; window.__qv.execCommands = []; });

    await page.click('#daily-btn');
    await page.waitForTimeout(600);

    const panelVisible = await page.locator('#daily-panel').isVisible();
    const role = await page.getAttribute('#daily-title', 'aria-labelledby');
    const roleAttr = await page.locator('#daily-panel [role="dialog"]').getAttribute('role');
    const modal = await page.locator('#daily-panel [role="dialog"]').getAttribute('aria-modal');
    const panelText = await page.locator('#daily-text').innerText();
    const rawText = await page.evaluate(() => document.getElementById('daily-text').textContent);
    check(prefix + '-01 点「导出日报」打开弹层（可见 + role=dialog + aria-modal=true）',
      panelVisible && roleAttr === 'dialog' && modal === 'true', { panelVisible, roleAttr, modal });
    check(prefix + '-02 弹层文本 == /api/daily text.body 逐字一致',
      rawText === api.text.body, textDiff(rawText, api.text.body));
    check(prefix + '-03 弹层文本 == 独立构造的期望文本逐字一致',
      rawText === exp.body, textDiff(rawText, exp.body));
    /* 只读文本块：PRE + pre-wrap，且不可编辑 */
    const blockInfo = await page.evaluate(() => {
      const el = document.getElementById('daily-text');
      const cs = getComputedStyle(el);
      return { tag: el.tagName, ws: cs.whiteSpace, ce: el.isContentEditable, tabindex: el.getAttribute('tabindex') };
    });
    check(prefix + '-04 文本块为只读展示（PRE + pre-wrap + 非 contenteditable + 可聚焦）',
      blockInfo.tag === 'PRE' && blockInfo.ws === 'pre-wrap' && blockInfo.ce === false && blockInfo.tabindex === '0', blockInfo);
    const focusOk = await page.evaluate(() => { document.getElementById('daily-text').focus(); return document.activeElement === document.getElementById('daily-text'); });
    check(prefix + '-05 文本块可聚焦（focus 后 activeElement 命中自身）', focusOk === true, { focusOk });

    /* 无任何下载 */
    const sent = await page.evaluate(() => ({ blob: window.__qv.blob, anchor: window.__qv.anchorClicks, urls: window.__qv.blobUrls }));
    const dailyReqs = reqs.filter((r) => /daily/i.test(r.url));
    check(prefix + '-06 打开弹层不产生任何下载（无 createObjectURL / 无 a[download] 点击 / 无 download 事件）',
      sent.blob === 0 && sent.anchor === 0 && downloads.length === 0,
      { blob: sent.blob, anchor: sent.anchor, downloads });
    check(prefix + '-07 全程无 xlsx / octet-stream 响应（无日报文件下载）',
      xlsxResponses.length === 0, xlsxResponses);
    const noXlsxApi = await page.evaluate(() => ({
      build: typeof (window.WBSCore && window.WBSCore.buildDailyWorkbook),
      bytes: typeof (window.WBSCore && window.WBSCore.dailyBytes),
    }));
    check(prefix + '-08 前端不再暴露日报 xlsx 组装 API（buildDailyWorkbook / dailyBytes 均为 undefined）',
      noXlsxApi.build === 'undefined' && noXlsxApi.bytes === 'undefined', noXlsxApi);

    /* 概况行与兜底 */
    const lines = rawText.split('\n');
    check(prefix + '-09 概况行计数与事件行数一致（延期/阻塞）',
      lines[0] === exp.overview && (lines.length - 1) === (exp.delayedCount + exp.blockedCount),
      { first: lines[0], lineCount: lines.length, exp });
    if (inst.name === 'isoB') {
      check(prefix + '-10 无事件时整体文本仅一行「今日无阻塞、延期。」（无概况行）',
        lines.length === 1 && lines[0] === '\u4eca\u65e5\u65e0\u963b\u585e\u3001\u5ef6\u671f\u3002', lines);
    } else {
      check(prefix + '-10 无事件兜底不出现（isoA 有事件）', rawText !== '\u4eca\u65e5\u65e0\u963b\u585e\u3001\u5ef6\u671f\u3002', lines[0]);
    }

    /* 内容范围：完成 / 普通 不出现 */
    const bad = lines.filter((l) => /\u3010\u5b8c\u6210\u3011|\u3010\u666e\u901a\u3011/i.test(l));
    check(prefix + '-11 文本不含「完成」「普通」类条目', bad.length === 0, bad);
    /* 排序：全部延期在前、阻塞在后 */
    const cats = lines.slice(1).map((l) => (l.match(/^\u3010([^\u3011]+)\u3011/) || [])[1]);
    const lastDelay = cats.lastIndexOf('\u5ef6\u671f\u00b7\u9ad8\u98ce\u9669');
    const firstBlock = cats.indexOf('\u963b\u585e\u00b7\u9ad8\u98ce\u9669');
    check(prefix + '-12 排序：延期条目全部在阻塞条目之前',
      firstBlock === -1 || lastDelay < firstBlock, cats);
    /* 事件行逐字模板 */
    const pat = /^\u3010(\u5ef6\u671f|\u963b\u585e)\u00b7\u9ad8\u98ce\u9669\u3011[^\/]+ \/ [^\/]+ \/ .+ @[^\uff1a]+\uff1a.+\u3002$/;
    const badLines = lines.slice(1).filter((l) => !pat.test(l));
    check(prefix + '-13 事件行逐字模板【前缀】一级 / 二级 / 任务项 @负责人：结论。',
      badLines.length === 0, badLines);
    check(prefix + '-14 弹层文本行 == /api/daily text.lines 逐行一致',
      JSON.stringify(lines.slice(1)) === JSON.stringify(api.text.lines), null);

    /* 复制路径①：navigator.clipboard */
    await page.evaluate(() => { window.__qv.clipCalls = []; });
    await page.click('#daily-copy');
    await page.waitForTimeout(500);
    const msg1 = (await page.locator('#daily-msg').innerText().catch(() => '')).trim();
    const msg1Visible = await page.locator('#daily-msg').isVisible().catch(() => false);
    const clip1 = await page.evaluate(async () => { try { return await navigator.clipboard.readText(); } catch (e) { return '__ERR__' + e.message; } });
    const calls1 = await page.evaluate(() => window.__qv.clipCalls.slice());
    check(prefix + '-15 路径① navigator.clipboard 成功并给出中文提示「已复制，可直接粘贴到微信」',
      msg1Visible && msg1 === OK_MSG && calls1.length === 1, { msg1, msg1Visible, calls: calls1.length });
    check(prefix + '-16 路径① 剪贴板文本 == 弹层文本（逐字，含换行）',
      clip1 === rawText, textDiff(clip1, rawText));
    check(prefix + '-17 路径① 写入剪贴板的入参与弹层文本逐字一致',
      calls1.length === 1 && calls1[0] === rawText, textDiff(calls1[0] || '', rawText));

    /* 复制路径②：模拟 navigator.clipboard 不可用 → execCommand('copy') 兜底 */
    await page.evaluate(() => {
      window.__qv.clipCalls = []; window.__qv.execCommands = [];
      window.__qv_origClip = navigator.clipboard;
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    });
    await page.click('#daily-copy');
    await page.waitForTimeout(500);
    const msg2 = (await page.locator('#daily-msg').innerText().catch(() => '')).trim();
    const msg2Visible = await page.locator('#daily-msg').isVisible().catch(() => false);
    const calls2 = await page.evaluate(() => window.__qv.clipCalls.slice());
    const execs = await page.evaluate(() => window.__qv.execCommands.slice());
    const clip2 = await page.evaluate(async () => {
      const orig = window.__qv_origClip;
      Object.defineProperty(navigator, 'clipboard', { value: orig, configurable: true });
      try { return await navigator.clipboard.readText(); } catch (e) { return '__ERR__' + e.message; }
    });
    check(prefix + '-18 路径② navigator.clipboard 不可用时回退 execCommand("copy")（未调用 writeText）',
      execs.length === 1 && execs[0].cmd === 'copy' && calls2.length === 0,
      { execs: execs.length, clipCalls: calls2.length });
    check(prefix + '-19 路径② 成功并给出中文提示「已复制，可直接粘贴到微信」',
      msg2Visible && msg2 === OK_MSG, { msg2, msg2Visible });
    check(prefix + '-20 路径② execCommand 时选中的文本 == 弹层文本（逐字）',
      execs.length === 1 && execs[0].value === rawText, textDiff((execs[0] || {}).value || '', rawText));
    check(prefix + '-21 路径② 剪贴板读回文本 == 弹层文本（逐字）',
      clip2 === rawText, textDiff(clip2, rawText));

    /* 关闭：关闭按钮 + Esc */
    await page.click('#daily-close');
    await page.waitForTimeout(300);
    const closed1 = await page.locator('#daily-panel').isHidden();
    await page.click('#daily-btn');
    await page.waitForTimeout(400);
    const reopened = await page.locator('#daily-panel').isVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const closed2 = await page.locator('#daily-panel').isHidden();
    check(prefix + '-22 关闭按钮与 Esc 均可关闭弹层',
      closed1 && reopened && closed2, { closedByButton: closed1, reopened, closedByEsc: closed2 });

    const shot = path.join(OUTDIR, inst.name + '-daily-popup.png');
    await page.click('#daily-btn');
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot });
    results.instance.push({ name: inst.name, base: inst.base, panel_text: rawText, api_body: api.text.body,
      screenshot: shot, downloads, xlsxResponses, dailyReqs });
    await context.close();
  }
  await browser.close();
  results.pass = pass; results.fail = fail;
  fs.writeFileSync(process.env.RESULT_FILE || path.join(OUTDIR, 'iso-browser-results.json'), JSON.stringify(results, null, 2));
  console.log('\n[iso-browser] PASS=' + pass + ' FAIL=' + fail);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => { console.error('FATAL', err); process.exit(2); });
