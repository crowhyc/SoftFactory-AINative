'use strict';
/* Stage6 补充证据：hidden 属性依赖元素的「可见 / 隐藏」双向 computed display 抽查（真实浏览器，不写数据） */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const BASE = process.env.BASE || 'http://127.0.0.1:4180';
const OUT = process.env.OUT || path.join(__dirname, 'results', 'hidden-audit.json');
const SHOTS = process.env.SHOTS || path.join(__dirname, 'shots');
const CHROME = '/ms-playwright/chromium-1187/chrome-linux/chrome';
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} | hidden-audit | ${name}${detail === undefined ? '' : ' | ' + JSON.stringify(detail)}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function probe(page, sels) {
  return page.evaluate((list) => {
    const out = {};
    list.forEach((s) => {
      const el = document.querySelector(s);
      out[s] = el ? { hidden: el.hidden === true, display: getComputedStyle(el).display,
                      vw: Math.round(el.getBoundingClientRect().width), vh: Math.round(el.getBoundingClientRect().height) } : null;
    });
    return out;
  }, sels);
}
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#identity-list button').length === 9, null, { timeout: 20000 });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#identity-list button').length === 9, null, { timeout: 20000 });
  const SELS = ['#identity-layer', '#workbench', '#banner', '#hint', '#empty-state', '#add-row-btn', '#identity-error', '#banner-action'];

  const s0 = await probe(page, SELS);
  console.log('# state0(身份选择层) ' + JSON.stringify(s0));
  check('state0.identity-layer-visible-when-not-hidden', s0['#identity-layer'].hidden === false && s0['#identity-layer'].display !== 'none', s0['#identity-layer']);
  check('state0.workbench-display-none-when-hidden', s0['#workbench'].hidden === true && s0['#workbench'].display === 'none', s0['#workbench']);
  check('state0.banner-display-none-when-hidden', s0['#banner'].hidden === true && s0['#banner'].display === 'none', s0['#banner']);
  check('state0.empty-state-display-none-when-hidden', s0['#empty-state'].hidden === true && s0['#empty-state'].display === 'none', s0['#empty-state']);
  check('state0.add-row-btn-display-none-when-hidden', s0['#add-row-btn'].hidden === true && s0['#add-row-btn'].display === 'none', s0['#add-row-btn']);
  check('state0.identity-error-display-none-when-hidden', s0['#identity-error'].hidden === true && s0['#identity-error'].display === 'none', s0['#identity-error']);

  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('#identity-list button')).find((b) => b.textContent.indexOf('李欢') === 0);
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await sleep(300);
  const s1 = await probe(page, SELS);
  console.log('# state1(李欢工作台) ' + JSON.stringify(s1));
  check('state1.identity-layer-none', s1['#identity-layer'].hidden === true && s1['#identity-layer'].display === 'none', s1['#identity-layer']);
  check('state1.workbench-visible-when-not-hidden', s1['#workbench'].hidden === false && s1['#workbench'].display !== 'none', s1['#workbench']);
  check('state1.hint-visible-when-not-hidden', s1['#hint'].hidden === false && s1['#hint'].display !== 'none', s1['#hint']);

  /* #empty-state 可见态：筛选到 0 行 */
  await page.fill('#search-input', '绝无此任务ZZZ');
  await sleep(250);
  const s2 = await probe(page, SELS);
  const rows2 = await page.locator('#wbs-body tr').count();
  console.log('# state2(筛选 0 行) ' + JSON.stringify(s2) + ' rows=' + rows2);
  check('state2.empty-state-visible-when-not-hidden', s2['#empty-state'].hidden === false && s2['#empty-state'].display !== 'none', s2['#empty-state']);
  check('state2.no-rows', rows2 === 0, { rows2 });
  await page.screenshot({ path: path.join(SHOTS, 'hidden-audit-empty-state.png') });

  await page.fill('#search-input', '');
  await sleep(250);
  const s3 = await probe(page, SELS);
  const rows3 = await page.locator('#wbs-body tr').count();
  check('state3.empty-state-hidden-again', s3['#empty-state'].hidden === true && s3['#empty-state'].display === 'none', s3['#empty-state']);
  check('state3.rows-restored', rows3 === 36, { rows3 });

  /* 项目负责人：#add-row-btn 可见 + 每行删除按钮可见 */
  await page.selectOption('#identity-select', '项目负责人');
  await sleep(250);
  const s4 = await probe(page, [...SELS, '#wbs-body tr:first-child button[data-delete]']);
  console.log('# state4(项目负责人) ' + JSON.stringify(s4));
  check('state4.add-row-btn-visible-for-pm', s4['#add-row-btn'].hidden === false && s4['#add-row-btn'].display !== 'none', s4['#add-row-btn']);
  check('state4.delete-button-visible-for-pm', s4['#wbs-body tr:first-child button[data-delete]'] && s4['#wbs-body tr:first-child button[data-delete]'].display !== 'none', s4['#wbs-body tr:first-child button[data-delete]']);
  await page.screenshot({ path: path.join(SHOTS, 'hidden-audit-pm-view.png') });

  /* 切回普通负责人：新增行按钮必须回到 display:none */
  await page.selectOption('#identity-select', '王言');
  await sleep(250);
  const s5 = await probe(page, [...SELS, '#wbs-body tr:first-child button[data-delete]']);
  console.log('# state5(王言) ' + JSON.stringify(s5));
  check('state5.add-row-btn-hidden-for-non-pm', s5['#add-row-btn'].hidden === true && s5['#add-row-btn'].display === 'none', s5['#add-row-btn']);
  check('state5.identity-layer-still-none', s5['#identity-layer'].display === 'none', s5['#identity-layer']);
  check('no-pageerror', pageErrors.length === 0, pageErrors);

  fs.writeFileSync(OUT, JSON.stringify({ results, pageErrors }, null, 2));
  await browser.close();
  const fails = results.filter((r) => !r.pass);
  console.log(`# SUMMARY hidden-audit total=${results.length} pass=${results.length - fails.length} fail=${fails.length}`);
  process.exit(0);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
