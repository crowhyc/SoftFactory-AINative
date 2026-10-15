'use strict';
const { chromium } = require('playwright');
const BASE = process.env.QV_BASE;
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  p.on('dialog', (d) => d.accept());
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForSelector('#identity-list .identity-btn');
  await p.click('#identity-list .identity-btn[data-identity="项目负责人"]');
  await p.waitForSelector('#wbs-body tr');
  await p.click('#add-row-btn');
  await p.waitForTimeout(400);
  const info = await p.evaluate(() => {
    const trs = Array.from(document.querySelectorAll('#wbs-body tr'));
    const tr = trs[trs.length - 1];
    return {
      id: (tr.querySelector('td.cell-id') || {}).textContent.trim(),
      editing: tr.className,
      fields: Array.from(tr.querySelectorAll('[data-edit-field]')).map((e) => e.tagName + ':' + e.getAttribute('data-edit-field') + ':' + e.getAttribute('data-field')),
      l2cell: (tr.querySelector('td.cell-l2') || {}).outerHTML
    };
  });
  console.log('last row:', JSON.stringify(info, null, 1));
  await b.close();
})().catch((e) => { console.error('ERR ' + (e && e.stack || e)); process.exit(2); });
