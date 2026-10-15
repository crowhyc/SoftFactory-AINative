/* YUNZ-30 / Stage10：现场（4180）导出 / 日报读回的来源产物 —— 真实浏览器点击导出按钮下载，全程只读。
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.QV_BASE || 'http://127.0.0.1:4180';
const OUT = process.env.QV_OUT || '.';
const results = [];
let pass = 0, fail = 0;
function check(name, cond, detail) { const ok = !!cond; ok ? pass++ : fail++; results.push({ name, ok, detail }); console.log((ok ? 'PASS  ' : 'FAIL  ') + name + '  :: ' + JSON.stringify(detail)); }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', acceptDownloads: true });
  const page = await ctx.newPage();
  const writes = [], pageErrors = [];
  page.on('request', (r) => { if (r.method() !== 'GET') writes.push(r.method() + ' ' + r.url()); });
  page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e)));
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('#identity-list .identity-btn');
  await page.click('#identity-list .identity-btn[data-identity="项目负责人"]');
  await page.waitForFunction(() => document.querySelectorAll('#wbs-body tr').length === 36, null, { timeout: 15000 });
  const doc = await page.evaluate(async () => (await fetch('/api/wbs', { cache: 'no-store' })).json());
  fs.writeFileSync(path.join(OUT, 'results', 'live-api-wbs-snapshot.json'), JSON.stringify(doc, null, 2));
  const hist = await page.evaluate(async () => {
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return (await fetch('/api/history?tz=Asia%2FShanghai&date=' + d, { cache: 'no-store' })).json();
  });
  fs.writeFileSync(path.join(OUT, 'results', 'live-api-history-today.json'), JSON.stringify(hist, null, 2));

  const [dlWbs] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#export-btn')]);
  await dlWbs.saveAs(path.join(OUT, 'downloads', 'live-wbs.xlsx'));
  const bannerWbs = await page.evaluate(() => document.getElementById('banner-text').textContent);
  const [dlDaily] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#daily-btn')]);
  await dlDaily.saveAs(path.join(OUT, 'downloads', 'live-daily.xlsx'));
  const bannerDaily = await page.evaluate(() => document.getElementById('banner-text').textContent);
  check('现场 K1：现场页面「导出 Excel」真实下载成功，中文横幅说明 A–K / 第 1-2 行 / status 不导出',
    /已按原模板导出 36 行 A–K 数据/.test(bannerWbs) && /status 不导出/.test(bannerWbs), { file: dlWbs.suggestedFilename(), banner: bannerWbs });
  check('现场 K2：现场页面「导出日报」真实下载成功，横幅给出双 sheet 行数与当日口径',
    /已导出日报/.test(bannerDaily) && /阻塞与延期/.test(bannerDaily) && /当日变更/.test(bannerDaily) && /Asia\/Shanghai/.test(bannerDaily), { file: dlDaily.suggestedFilename(), banner: bannerDaily });
  check('现场 K3（关键）：导出过程未发出任何写请求，现场数据未被改动',
    writes.length === 0 && pageErrors.length === 0, { writes, pageErrors });
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'results', 'live-export-results.json'), JSON.stringify({ base: BASE, pass, fail, results }, null, 2));
  console.log('---'); console.log('PASS=' + pass + ' FAIL=' + fail);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(2); });
