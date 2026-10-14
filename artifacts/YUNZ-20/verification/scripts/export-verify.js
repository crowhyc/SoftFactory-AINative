'use strict';
/* 导出保真：经交付页面导出入口生成 xlsx，落盘供 python 标准库读回比对。 */
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const PUB = '/opt/wbs-rongcheng/public';
const API = 'http://127.0.0.1:4180';
const OUT = process.env.OUT || path.join(__dirname, 'dom-out');
fs.mkdirSync(OUT, { recursive: true });

const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8').replace(/<script\b[^>]*>\s*<\/script>/gi, '');
const vc = new VirtualConsole();
vc.on('jsdomError', e => console.log('[jsdomError] ' + e.message));
const dom = new JSDOM(html, { url: API + '/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const w = dom.window;
w.fetch = async (input, init) => {
  const u = new URL(typeof input === 'string' ? input : input.url, API + '/');
  if (u.pathname.indexOf('/api/') === 0) return await fetch(u.href, init);
  const file = path.join(PUB, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
  const buf = fs.readFileSync(file);
  return new Response(buf, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  w.eval(fs.readFileSync(path.join(PUB, 'vendor/xlsx.full.min.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(PUB, 'app.js'), 'utf8'));
  for (let i = 0; i < 200 && !(w.WBSApp && w.WBSApp.state.doc); i++) await sleep(25);
  const btn = w.document.querySelector('#identity-list .identity-btn[data-identity="项目负责人"]');
  if (!btn) throw new Error('identity button 项目负责人 未渲染');
  btn.click();
  for (let i = 0; i < 200 && w.document.querySelectorAll('#wbs-body tr').length === 0; i++) await sleep(25);
  const jsonSnap = await (await fetch(API + '/api/wbs')).json();
  fs.writeFileSync(path.join(OUT, 'export-json-snapshot.json'), JSON.stringify(jsonSnap, null, 1));
  let captured = null, capturedName = null;
  w.XLSX.writeFile = function (wb, name) {
    const buf = w.XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    captured = path.join(OUT, 'exported.xlsx');
    fs.writeFileSync(captured, buf);
    capturedName = name;
  };
  const res = await w.WBSApp.exportXlsx();
  console.log('exportXlsx ->', JSON.stringify(res));
  console.log('writeFile name =', capturedName);
  console.log('rows in state =', w.WBSApp.state.doc.tasks.length);
  console.log('banner =', (w.document.querySelector('#banner-text') || {}).textContent);
  if (!captured) { console.log('FAIL: 未捕获到导出文件'); process.exit(1); }
  console.log('saved =', captured, fs.statSync(captured).size, 'bytes');
  fs.writeFileSync(path.join(OUT, 'export-meta.json'), JSON.stringify({ name: capturedName, rows: w.WBSApp.state.doc.tasks.length, bytes: fs.statSync(captured).size }, null, 1));
  dom.window.close();
})().catch(e => { console.log('FATAL', e && e.stack || e); process.exit(2); });
