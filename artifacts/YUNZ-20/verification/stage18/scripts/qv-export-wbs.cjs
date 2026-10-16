'use strict';
/* YUNZ-38 / Stage18：隔离实例真实浏览器「导出 Excel」（WBS）下载，供独立 xlsx 读回（3A 不进掺）。
   只读交互，不写服务端；下载文件落本 stage18 的 downloads/。 */
const fs = require('fs');
const path = require('path');
const TOOLS = process.env.TOOLS || '/tools';
const { chromium } = require(path.join(TOOLS, 'node_modules', 'playwright'));
const BASE = process.env.BASE || 'http://127.0.0.1:4260';
const DL_DIR = process.env.DLDIR || '/qv/downloads';
const PREFIX = process.env.PREFIX || 'isoA';
const SNAPSHOT = process.env.SNAPSHOT || ('/qv/downloads/' + PREFIX + '-wbs-at-export.json');

async function enterAs(page, name) {
  const layerVisible = await page.locator('#identity-layer').isVisible().catch(() => false);
  if (layerVisible) await page.locator('#identity-list button[data-identity="' + name + '"]').first().click();
  else await page.selectOption('#identity-select', String(name));
  await page.waitForTimeout(600);
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1600, height: 1100 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await enterAs(page, '项目负责人');
  const snapshot = await page.evaluate(async () => (await fetch('/api/wbs', { cache: 'no-store' })).json());
  fs.writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 2));
  const dlPromise = page.waitForEvent('download', { timeout: 20000 });
  await page.click('#export-btn');
  const dl = await dlPromise;
  const name = dl.suggestedFilename();
  const savePath = path.join(DL_DIR, PREFIX + '-' + name);
  await dl.saveAs(savePath);
  fs.writeFileSync(path.join(DL_DIR, PREFIX + '-download-meta.json'),
    JSON.stringify({ suggested: name, saved: savePath }, null, 2));
  await context.close();
  await browser.close();
  console.log('[export-wbs] ' + PREFIX + ' -> ' + savePath + '  pageerrors=' + errors.length);
  process.exit(errors.length === 0 ? 0 : 1);
})().catch((err) => { console.error('FATAL', err); process.exit(2); });
