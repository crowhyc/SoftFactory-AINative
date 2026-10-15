/* Stage12：最小导出脚本（用于隔离实例的日报兜底行读回） */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.QV_BASE, OUT = process.env.QV_OUT, TAG = process.env.QV_TAG || 'empty';
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('#identity-list .identity-btn');
  await page.click('#identity-list .identity-btn[data-identity="项目负责人"]');
  await page.waitForSelector('#wbs-body tr');
  const [d] = await Promise.all([page.waitForEvent('download'), page.click('#daily-btn')]);
  await d.saveAs(path.join(OUT, 'downloads', TAG + '-daily.xlsx'));
  const banner = await page.$eval('#banner-text', (e) => e.textContent);
  console.log('banner: ' + banner);
  console.log('下载文件: ' + TAG + '-daily.xlsx (' + fs.statSync(path.join(OUT, 'downloads', TAG + '-daily.xlsx')).size + ' bytes)');
  await browser.close();
})().catch((e) => { console.error('ERR ' + (e && e.stack || e)); process.exit(2); });
