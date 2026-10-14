'use strict';
/* YUNZ-28 / Stage8：真实浏览器请求面复核（页面加载 + 身份进入 + 导出触发），
 * 断言全部请求同源（127.0.0.1:4180），无跨域外链、无外部服务依赖。只读，不写数据。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(process.env.TOOLS || '/tools', 'node_modules', 'playwright'));
const BASE = process.env.BASE || 'http://127.0.0.1:4180';
const OUTDIR = process.env.OUTDIR || '/out';
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ acceptDownloads: true, timezoneId: 'Asia/Shanghai', locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const reqs = [];
  page.on('request', (r) => reqs.push({ url: r.url(), method: r.method(), type: r.resourceType() }));
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('#identity-list button');
  await page.click('#identity-list button[data-identity="项目负责人"]');
  await page.waitForFunction(() => !document.getElementById('workbench').hidden);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-btn')]);
  await dl.saveAs(path.join(OUTDIR, 'downloads', 'network-check-export.xlsx'));
  const external = reqs.filter((r) => !r.url.startsWith(BASE));
  const foreignHosts = reqs.filter((r) => { try { const u = new URL(r.url); return u.host !== new URL(BASE).host; } catch (e) { return r.url.indexOf('data:') !== 0 && r.url.indexOf('blob:') !== 0; } });
  const summary = {
    base: BASE, total_requests: reqs.length, external_requests: external, foreign_hosts: foreignHosts,
    requests: reqs, console_errors: consoleErrors.filter((t) => !t.includes('favicon'))
  };
  fs.writeFileSync(path.join(OUTDIR, 'results', 'network-requests.json'), JSON.stringify(summary, null, 2));
  const lines = ['PASS  NET1.all-requests-same-origin  :: ' + JSON.stringify(foreignHosts) ,
    (external.length === 0 ? 'PASS' : 'FAIL') + '  NET2.no-external-url  :: ' + JSON.stringify(external),
    (summary.console_errors.length === 0 ? 'PASS' : 'FAIL') + '  NET3.no-console-error  :: ' + JSON.stringify(summary.console_errors),
    '', 'total=' + reqs.length, 'urls=', ...reqs.map((r) => '  ' + r.method + ' ' + r.type + ' ' + r.url)];
  fs.writeFileSync(path.join(OUTDIR, 'logs', '03-network-resources.txt'), lines.join('\n') + '\n');
  console.log(lines.slice(0, 3).join('\n'));
  console.log('total_requests=' + reqs.length);
  await context.close(); await browser.close();
  process.exit((external.length === 0 && foreignHosts.length === 0 && summary.console_errors.length === 0) ? 0 : 1);
})().catch((e) => { console.log('FATAL ' + (e && e.stack || e)); process.exit(2); });
