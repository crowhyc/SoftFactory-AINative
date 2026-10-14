'use strict';
/* YUNZ-20 Stage3 复验 —— 交付页面「导出 Excel」入口（jsdom 执行运行态页面脚本）。
 * 资源来自 PUB 目录（本轮默认=从 127.0.0.1:4180 抓取的运行态副本，见 served/）。
 * 只读被验证产物，只写本工作目录 OUT。 */
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const PUB = process.env.PUB || '/opt/wbs-rongcheng/public';
const API = 'http://127.0.0.1:4180';
const OUT = process.env.OUT || path.join(__dirname, '..');
const out = n => path.join(OUT, n);

const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')
  .replace(/<script\b[^>]*>\s*<\/script>/gi, '<!-- script stripped for controlled eval -->');
const vc = new VirtualConsole();
vc.on('jsdomError', e => console.log('[jsdomError] ' + e.message));
const dom = new JSDOM(html, { url: API + '/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const w = dom.window;
const crossOrigin = [], putCalls = [];
w.fetch = async function (input, init) {
  const u = new URL(typeof input === 'string' ? input : (input && input.url), API + '/');
  if (u.origin !== API) crossOrigin.push(u.href);
  if (u.pathname.indexOf('/api/') === 0) {
    if (init && init.method === 'PUT') putCalls.push(u.href);
    return await fetch(u.href, init);
  }
  const rel = u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, '');
  const file = path.join(PUB, rel);
  if (!fs.existsSync(file)) return new Response('not found', { status: 404 });
  const buf = fs.readFileSync(file);
  const type = /\.xlsx$/.test(file) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/octet-stream';
  return new Response(buf, { status: 200, headers: { 'Content-Type': type } });
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch (e) {} await sleep(25); } return false; }

(async () => {
  w.eval(fs.readFileSync(path.join(PUB, 'vendor/xlsx.full.min.js'), 'utf8'));
  const exports_ = [];
  w.XLSX.writeFile = function (wb, name) {
    const buf = w.XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const p = out('exported-stage3.xlsx');
    fs.writeFileSync(p, buf);
    exports_.push({ name: name, bytes: buf.length, path: p });
    return { shim: true, name: name };
  };
  w.eval(fs.readFileSync(path.join(PUB, 'app.js'), 'utf8'));
  await waitFor(() => w.WBSApp && w.WBSApp.state.doc);

  console.log('身份按钮数 =', w.document.querySelectorAll('#identity-list .identity-btn').length);
  const btn = w.document.querySelector('#identity-list .identity-btn[data-identity="项目负责人"]');
  if (!btn) throw new Error('项目负责人 身份按钮未渲染');
  btn.click();
  await waitFor(() => w.document.querySelectorAll('#wbs-body tr').length > 0);
  console.log('进入工作台身份 =', w.WBSApp.state.identity, '渲染行数 =', w.document.querySelectorAll('#wbs-body tr').length);

  const jsonSnap = await (await fetch(API + '/api/wbs')).json();
  fs.writeFileSync(out('export-json-snapshot.json'), JSON.stringify(jsonSnap, null, 1) + '\n');

  const before = exports_.length;
  w.document.querySelector('#export-btn').click();
  await waitFor(() => exports_.length > before, 10000);
  const e = exports_[exports_.length - 1];
  const bannerEl = w.document.querySelector('#banner-text');
  const meta = {
    pub: PUB, identity: '项目负责人',
    rowsInState: w.WBSApp.state.doc.tasks.length, rowsInApi: jsonSnap.tasks.length,
    revision: jsonSnap.meta.revision,
    fileName: e && e.name, bytes: e && e.bytes,
    banner: bannerEl ? bannerEl.textContent : '', putCalls: putCalls.length
  };
  fs.writeFileSync(out('export-meta.json'), JSON.stringify(meta, null, 1) + '\n');
  console.log(JSON.stringify(meta, null, 1));
  console.log(e ? 'PASS 页面导出入口生成文件 ' + e.name : 'FAIL 未捕获导出文件');
  dom.window.close();
  process.exit(e ? 0 : 1);
})().catch(err => { console.log('FATAL ' + (err && err.stack || err)); process.exit(2); });
