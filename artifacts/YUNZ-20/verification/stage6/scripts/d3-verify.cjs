'use strict';
/* Stage6 独立复验脚本（AI-QV 自有证据链，不引用作者脚本逻辑）
   MODE=fix      对修复后服务做 D-3 回归 + 验收 1/3/4 交互验证
   MODE=baseline 对修复前镜像复现 D-3（缺陷成立性独立确认）
*/
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const BASE = process.env.BASE || 'http://127.0.0.1:4180';
const MODE = process.env.MODE || 'fix';
const OUT = process.env.OUT || path.join(__dirname, 'result.json');
const SHOTS = process.env.SHOTS || path.join(__dirname, 'shots');
const CHROME = process.env.CHROME || '/ms-playwright/chromium-1187/chrome-linux/chrome';

function realConsoleErrors() { return consoleErrors.filter((e) => !/\/favicon\.ico$/.test(e.url || '')); }
const results = [];
let pageErrors = [];
let consoleErrors = [];
let httpErrors = [];
function check(name, pass, detail) {
  const rec = { name, pass: !!pass, detail: detail === undefined ? null : detail };
  results.push(rec);
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${MODE} | ${name}${detail === undefined ? '' : ' | ' + JSON.stringify(detail)}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function snap(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { display: getComputedStyle(el).display, hidden: el.hidden === true,
             rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
  }, sel);
}
function hitTest(page, x, y) {
  return page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    if (!el) return null;
    const chain = [];
    for (let n = el; n && chain.length < 6; n = n.parentElement) chain.push(n.id ? '#' + n.id : n.tagName.toLowerCase());
    return { tag: el.tagName.toLowerCase(), id: el.id || null, chain };
  }, [x, y]);
}
function cellInfo(page, id, field) {
  return page.evaluate(([tid, f]) => {
    const td = document.querySelector(`#wbs-body tr[data-id="${tid}"] td[data-field="${f}"]`);
    if (!td) return null;
    return { text: td.textContent.trim(), cls: td.className,
             editing: td.classList.contains('editing'),
             editor: td.querySelector('input,select,textarea') ? td.querySelector('input,select,textarea').tagName : null,
             rect: (() => { const r = td.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })() };
  }, [id, field]);
}
async function clickCell(page, id, field) {
  const info = await cellInfo(page, id, field);
  if (!info) return false;
  await page.evaluate(([tid, f]) => {
    const td = document.querySelector(`#wbs-body tr[data-id="${tid}"] td[data-field="${f}"]`);
    td.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, [id, field]);
  await sleep(120);
  return true;
}
function hintText(page) {
  return page.evaluate(() => {
    const h = document.getElementById('hint');
    if (!h) return null;
    return { hidden: h.hidden === true, display: getComputedStyle(h).display, text: h.textContent.trim() };
  });
}
function bannerText(page) {
  return page.evaluate(() => {
    const b = document.getElementById('banner');
    return { hidden: b.hidden === true, display: getComputedStyle(b).display, cls: b.className, text: b.textContent.trim() };
  });
}
function sessionText(page) { return page.evaluate(() => document.getElementById('session-status').textContent.trim()); }
function rowCount(page) { return page.locator('#wbs-body tr').count(); }
function revisionOf(page) { return page.evaluate(() => document.getElementById('session-status').textContent.match(/版本：(\S+)/)[1]); }
async function getApi(revisionCheck) {
  const res = await fetch(BASE + '/api/wbs', { cache: 'no-store' });
  return res.json();
}
async function switchIdentity(page, identity) {
  await page.selectOption('#identity-select', identity);
  await sleep(150);
}
async function waitReady(page) {
  await page.waitForFunction(() => document.querySelectorAll('#identity-list button').length === 9, null, { timeout: 20000 });
}
async function chooseFromLayer(page, name) {
  await page.evaluate((n) => {
    const btn = Array.from(document.querySelectorAll('#identity-list button')).find((b) => b.textContent.indexOf(n) === 0);
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, name);
  await sleep(250);
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  pageErrors = []; consoleErrors = []; httpErrors = [];
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ text: m.text(), url: (m.location() && m.location().url) || '' }); });
  page.on('response', (r) => { if (r.status() >= 400) httpErrors.push({ status: r.status(), url: r.url() }); });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await sleep(300);
  const browserVersion = browser.version();
  console.log(`# MODE=${MODE} BASE=${BASE} chromium=${browserVersion}`);

  /* ---------- 初始状态：身份选择层可见 ---------- */
  const layer0 = await snap(page, '#identity-layer');
  const wb0 = await snap(page, '#workbench');
  const idBtns = await page.locator('#identity-list button').count();
  const idNames = await page.$$eval('#identity-list button', (bs) => bs.map((b) => b.querySelector('.identity-name').textContent));
  check('initial.identity-layer-visible', layer0.display !== 'none' && layer0.hidden === false, layer0);
  check('initial.workbench-hidden', wb0.hidden === true && wb0.display === 'none', wb0);
  check('initial.identity-count=9', idBtns === 9, { idBtns });
  await page.screenshot({ path: path.join(SHOTS, `${MODE}-01-identity-layer.png`) });

  /* ---------- D-3 复现路径：点击「李欢」 ---------- */
  const preRect = layer0.rect;
  const preHit = await hitTest(page, 720, 450);
  check('d3.pre-click-overlay-covers-viewport', preRect.h > 0 && preRect.w > 0 && preHit.chain.includes('#identity-layer'),
        { preRect, preHit });
  await chooseFromLayer(page, '李欢');
  const layer1 = await snap(page, '#identity-layer');
  const wb1 = await snap(page, '#workbench');
  const rows = await rowCount(page);
  const postHit = await hitTest(page, 720, 450);
  await page.screenshot({ path: path.join(SHOTS, `${MODE}-02-after-choose-lihuan.png`) });

  if (MODE === 'fix') {
    check('d3.identity-layer-computed-display-none', layer1.display === 'none', layer1);
    check('d3.identity-layer-hidden-attr-true', layer1.hidden === true, layer1);
    check('d3.identity-layer-rect-collapsed', layer1.rect.w === 0 && layer1.rect.h === 0, layer1.rect);
    check('d3.workbench-visible', wb1.hidden === false && wb1.display !== 'none', wb1);
    check('d3.workbench-in-viewport', wb1.rect.y >= 0 && wb1.rect.h > 100 && wb1.rect.w > 100, wb1.rect);
    check('d3.viewport-center-hits-workbench', !!postHit && postHit.chain.includes('#workbench'), postHit);
    check('d3.rows-rendered=36', rows === 36, { rows });
    check('d3.no-pageerror', pageErrors.length === 0, pageErrors);
    check('d3.no-console-error', realConsoleErrors().length === 0, realConsoleErrors());
    const interactive = await page.evaluate(async () => {
      const btn = document.getElementById('identity-select');
      const before = document.getElementById('hint').textContent;
      btn.dispatchEvent(new Event('change', { bubbles: true }));
      return typeof document.getElementById('save-btn').disabled === 'boolean';
    });
    check('d3.workbench-interactive', interactive === true, { interactive });
  } else {
    check('d3.BASELINE-identity-layer-still-flex', layer1.display === 'flex', layer1);
    check('d3.BASELINE-overlay-still-covers-center', !!postHit && postHit.chain.includes('#identity-layer'), postHit);
    check('d3.BASELINE-workbench-pushed-below-viewport', wb1.rect.y >= 900, { wb: wb1.rect });
    check('d3.BASELINE-user-blocked', layer1.display !== 'none' && !!postHit && postHit.chain.includes('#identity-layer'),
          { layer1: layer1.display, centerHit: postHit.chain });
  }

  /* ---------- hidden 属性同类盲区抽查 ---------- */
  async function auditHidden(page, label) {
    const els = ['#identity-layer', '#workbench', '#banner', '#hint', '#empty-state', '#add-row-btn', '#identity-error', '#banner-action'];
    const data = {};
    for (const s of els) data[s] = await snap(page, s);
    const bad = Object.entries(data).filter(([, v]) => v === null).map(([k]) => k);
    const violations = Object.entries(data)
      .filter(([, v]) => v && v.hidden === true && v.display !== 'none')
      .map(([k, v]) => ({ sel: k, display: v.display }));
    check(`hidden-audit.${label}.no-missing-element`, bad.length === 0, { bad });
    check(`hidden-audit.${label}.hidden-implies-display-none`, violations.length === 0, { violations, data });
    return data;
  }
  await auditHidden(page, 'in-workbench');

  /* ---------- 验收 1：九身份 / 刷新保持 / 切换即时生效 ---------- */
  const EXPECT = ['项目负责人', '李欢', '王言', '张航瑞', '郑述文', '崔文建', '余宇', '黄逸偲', '陈江'];
  const opts = await page.$$eval('#identity-select option', (os) => os.map((o) => o.value));
  check('acc1.select-has-9-identities', JSON.stringify(opts) === JSON.stringify(EXPECT), { opts });
  check('acc1.layer-list-matches-select', JSON.stringify(idNames) === JSON.stringify(EXPECT), { idNames });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await sleep(400);
  const layerR = await snap(page, '#identity-layer');
  const wbR = await snap(page, '#workbench');
  const selR = await page.inputValue('#identity-select');
  const sessR = await sessionText(page);
  check('acc1.refresh-keeps-identity', layerR.display === 'none' && wbR.display !== 'none' && selR === '李欢' && sessR.indexOf('李欢') >= 0,
        { layerR: layerR.display, wbR: wbR.display, selR, sessR });
  await page.screenshot({ path: path.join(SHOTS, `${MODE}-03-after-refresh.png`) });

  const switchLog = [];
  for (const id of EXPECT) {
    await switchIdentity(page, id);
    const l = await snap(page, '#identity-layer');
    const w = await snap(page, '#workbench');
    const s = await sessionText(page);
    const addBtn = await snap(page, '#add-row-btn');
    const r = await rowCount(page);
    const isPM = id === '项目负责人';
    const ok = l.display === 'none' && w.display !== 'none' && s.indexOf(id) >= 0 && r === 36 &&
               (isPM ? addBtn.display !== 'none' : addBtn.display === 'none');
    switchLog.push({ id, layerDisplay: l.display, wbDisplay: w.display, rows: r, addRowDisplay: addBtn.display, session: s, pass: ok });
    check(`acc1.switch.${id}`, ok, { layerDisplay: l.display, wbDisplay: w.display, rows: r, addRowDisplay: addBtn.display, session: s });
  }
  fs.writeFileSync(path.join(SHOTS, `..`, 'results', `${MODE}-switch-log.json`), JSON.stringify(switchLog, null, 2));
  await page.screenshot({ path: path.join(SHOTS, `${MODE}-04-pm-view.png`) });

  if (MODE === 'baseline') {
    fs.writeFileSync(OUT, JSON.stringify({ mode: MODE, base: BASE, chromium: browserVersion, results, pageErrors, consoleErrors, httpErrors }, null, 2));
    await browser.close();
    const fails = results.filter((r) => !r.pass);
    console.log(`# SUMMARY mode=${MODE} total=${results.length} fail=${fails.length}`);
    process.exit(0);
  }

  /* ---------- 验收 3：王言 行级权限 + 三端一致 ---------- */
  const apiBefore = await getApi();
  const t002Before = apiBefore.tasks.find((t) => t.id === 'T002');
  const revBefore = apiBefore.meta.revision;
  await switchIdentity(page, '王言');
  const ownLockedStruct = await cellInfo(page, 'T002', 'task');
  check('acc3.wangyan-own-struct-field-locked', ownLockedStruct.cls.indexOf('locked') >= 0, { cls: ownLockedStruct.cls });
  await clickCell(page, 'T002', 'task');
  const afterStructClick = await cellInfo(page, 'T002', 'task');
  const hintStruct = await hintText(page);
  check('acc3.wangyan-own-struct-click-gives-hint-no-editor',
        afterStructClick.editor === null && hintStruct.hidden === false && hintStruct.display !== 'none' && hintStruct.text.length > 0,
        { editor: afterStructClick.editor, hint: hintStruct });

  const otherRow = apiBefore.tasks.find((t) => t.owner !== '王言');
  const otherLocked = await cellInfo(page, otherRow.id, 'dates.dev');
  await clickCell(page, otherRow.id, 'dates.dev');
  const afterOtherClick = await cellInfo(page, otherRow.id, 'dates.dev');
  const hintOther = await hintText(page);
  check('acc3.wangyan-other-row-locked-no-editor',
        otherLocked.cls.indexOf('locked') >= 0 && afterOtherClick.editor === null &&
        hintOther.hidden === false && hintOther.text.length > 0,
        { cls: otherLocked.cls, editor: afterOtherClick.editor, hint: hintOther });

  await clickCell(page, 'T002', 'dates.design');
  const editing = await cellInfo(page, 'T002', 'dates.design');
  check('acc3.wangyan-own-date-editable', editing.editor === 'INPUT' && editing.editing === true, editing);
  const NEWVAL = '2026-12-31';
  await page.evaluate(([v]) => {
    const td = document.querySelector('#wbs-body tr[data-id="T002"] td[data-field="dates.design"]');
    const el = td.querySelector('input');
    el.value = v;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, [NEWVAL]);
  await sleep(200);
  const hintEdit = await hintText(page);
  const saveDisabled = await page.evaluate(() => document.getElementById('save-btn').disabled);
  check('acc3.edit-marks-dirty-and-hint', hintEdit.text.indexOf('已修改') >= 0 && saveDisabled === false, { hintEdit, saveDisabled });
  await page.screenshot({ path: path.join(SHOTS, `${MODE}-05-wangyan-edited.png`) });

  await page.click('#save-btn');
  await page.waitForFunction(() => document.getElementById('banner').className.indexOf('ok') >= 0 ||
                                  document.getElementById('banner').className.indexOf('error') >= 0, null, { timeout: 10000 });
  const ban = await bannerText(page);
  check('acc3.save-banner-ok', ban.cls.indexOf('ok') >= 0 && ban.display !== 'none', ban);
  await auditHidden(page, 'after-save');

  const apiAfter = await getApi();
  const t002After = apiAfter.tasks.find((t) => t.id === 'T002');
  const disk = JSON.parse(fs.readFileSync('/opt/wbs-rongcheng/data/wbs.json', 'utf8'));
  const t002Disk = disk.tasks.find((t) => t.id === 'T002');
  const cellDisplay = await cellInfo(page, 'T002', 'dates.design');
  check('acc3.triple-consistency-api', t002After.dates.design === NEWVAL, { api: t002After.dates.design });
  check('acc3.triple-consistency-disk', t002Disk.dates.design === NEWVAL, { disk: t002Disk.dates.design });
  check('acc3.triple-consistency-page', cellDisplay.text === NEWVAL, { page: cellDisplay.text });
  check('acc3.revision-advanced', apiAfter.meta.revision === revBefore + 1, { before: revBefore, after: apiAfter.meta.revision });
  await page.screenshot({ path: path.join(SHOTS, `${MODE}-06-saved-consistent.png`) });

  /* 还原为原值并复验三端一致 */
  await clickCell(page, 'T002', 'dates.design');
  await page.evaluate(([v]) => {
    const td = document.querySelector('#wbs-body tr[data-id="T002"] td[data-field="dates.design"]');
    const el = td.querySelector('input');
    el.value = v;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, [t002Before.dates.design || '']);
  await sleep(150);
  await page.click('#save-btn');
  await page.waitForFunction(() => document.getElementById('banner').className.indexOf('ok') >= 0, null, { timeout: 10000 });
  const apiRestored = await getApi();
  const diskRestored = JSON.parse(fs.readFileSync('/opt/wbs-rongcheng/data/wbs.json', 'utf8'));
  const t002RestoredApi = apiRestored.tasks.find((t) => t.id === 'T002');
  const t002RestoredDisk = diskRestored.tasks.find((t) => t.id === 'T002');
  const taskEq = JSON.stringify(apiRestored.tasks) === JSON.stringify(apiBefore.tasks);
  check('acc3.restore-value-api', t002RestoredApi.dates.design === t002Before.dates.design, { v: t002RestoredApi.dates.design });
  check('acc3.restore-tasks-array-identical-to-pre-save', taskEq, { eq: taskEq });
  check('acc3.restore-disk-equals-api', JSON.stringify(diskRestored.tasks) === JSON.stringify(apiRestored.tasks), {});

  /* ---------- 验收 4：项目负责人 任意行可编辑 / 新增 / 删除（含确认） ---------- */
  await switchIdentity(page, '项目负责人');
  const addBtnPM = await snap(page, '#add-row-btn');
  check('acc4.add-row-visible-for-pm', addBtnPM.hidden === false && addBtnPM.display !== 'none', addBtnPM);
  const foreignRow = apiBefore.tasks.find((t) => t.owner !== '项目负责人');
  await clickCell(page, foreignRow.id, 'dates.dev');
  const pmEdit = await cellInfo(page, foreignRow.id, 'dates.dev');
  check('acc4.pm-can-edit-any-row', pmEdit.editor === 'INPUT', { row: foreignRow.id, editor: pmEdit.editor });
  await page.keyboard.press('Escape');
  await sleep(120);

  const beforeAdd = await rowCount(page);
  await page.click('#add-row-btn');
  await sleep(200);
  const afterAdd = await rowCount(page);
  const hintAdd = await hintText(page);
  check('acc4.add-row-adds-row-and-hints', afterAdd === beforeAdd + 1 && hintAdd.text.indexOf('已新增') >= 0, { beforeAdd, afterAdd, hint: hintAdd.text });
  const newRowId = await page.evaluate(() => document.querySelector('#wbs-body tr:last-child').getAttribute('data-id'));
  await page.screenshot({ path: path.join(SHOTS, `${MODE}-07-pm-added-row.png`) });

  /* 删除：先走「取消」路径，再走「确认」路径 */
  let dialogMsgs = [];
  page.removeAllListeners('dialog');
  page.on('dialog', async (d) => { dialogMsgs.push(d.message()); await d.dismiss(); });
  await page.click(`#wbs-body tr[data-id="${newRowId}"] button[data-delete]`);
  await sleep(250);
  const afterCancel = await rowCount(page);
  const hintCancel = await hintText(page);
  check('acc4.delete-asks-confirm', dialogMsgs.length === 1 && /确认删除/.test(dialogMsgs[0]), { dialogMsgs });
  check('acc4.delete-cancel-keeps-row', afterCancel === afterAdd && hintCancel.text.indexOf('已取消删除') >= 0, { afterCancel, afterAdd, hint: hintCancel.text });

  page.removeAllListeners('dialog');
  page.on('dialog', async (d) => { await d.accept(); });
  await page.click(`#wbs-body tr[data-id="${newRowId}"] button[data-delete]`);
  await sleep(250);
  const afterDelete = await rowCount(page);
  const hintDelete = await hintText(page);
  check('acc4.delete-confirm-removes-row', afterDelete === beforeAdd && hintDelete.text.indexOf('已删除') >= 0, { afterDelete, expected: beforeAdd, hint: hintDelete.text });

  /* 空输入 + 未保存不得落盘 */
  await page.click('#add-row-btn');
  await sleep(200);
  await page.click('#save-btn');
  await sleep(400);
  const banEmpty = await bannerText(page);
  const apiAfterEmpty = await getApi();
  check('acc4.empty-new-row-blocked-by-validation',
        banEmpty.cls.indexOf('error') >= 0 && banEmpty.text.indexOf('前置校验未通过') >= 0, { ban: banEmpty });
  check('acc4.empty-new-row-not-persisted', JSON.stringify(apiAfterEmpty.tasks) === JSON.stringify(apiBefore.tasks),
        { rev: apiAfterEmpty.meta.revision });
  await page.screenshot({ path: path.join(SHOTS, `${MODE}-08-empty-row-validation.png`) });

  /* 重新加载丢弃未保存改动，复核服务端未变 */
  await page.click('#banner-action').catch(() => {});
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await sleep(500);
  const rowsAfterReload = await rowCount(page);
  const apiFinal = await getApi();
  check('acc4.unsaved-changes-discarded-on-reload', rowsAfterReload === 36 && JSON.stringify(apiFinal.tasks) === JSON.stringify(apiBefore.tasks),
        { rowsAfterReload, rev: apiFinal.meta.revision });

  /* ---------- UX 可发现性：只读点击必须有提示 ---------- */
  await switchIdentity(page, '李欢');
  const seqCell = await cellInfo(page, 'T001', 'id');
  await page.evaluate(() => {
    const td = document.querySelector('#wbs-body tr[data-id="T001"] td[data-field="id"]');
    td.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await sleep(150);
  const hintSeq = await hintText(page);
  check('ux.readonly-id-cell-click-shows-hint', hintSeq.hidden === false && hintSeq.display !== 'none' && hintSeq.text.indexOf('只读') >= 0,
        { cls: seqCell.cls, hint: hintSeq });
  await page.screenshot({ path: path.join(SHOTS, `${MODE}-09-readonly-hint.png`) });

  const finalLayer = await snap(page, '#identity-layer');
  const finalWb = await snap(page, '#workbench');
  check('d3.final-state-still-good', finalLayer.display === 'none' && finalWb.display !== 'none', { finalLayer, finalWb });
  check('final.no-pageerror', pageErrors.length === 0, pageErrors);
  check('final.no-console-error', realConsoleErrors().length === 0, realConsoleErrors());
  check('final.all-console-errors-are-benign-favicon-404',
        consoleErrors.every((e) => /\/favicon\.ico$/.test(e.url || '')), { all: consoleErrors });
  const nonFaviconHttp = httpErrors.filter((e) => !/favicon/i.test(e.url));
  check('final.no-http-error-except-favicon', nonFaviconHttp.length === 0, { nonFaviconHttp, all: httpErrors });

  fs.writeFileSync(OUT, JSON.stringify({
    mode: MODE, base: BASE, chromium: browserVersion,
    results, pageErrors, consoleErrors, httpErrors,
    finalState: { layer: finalLayer, workbench: finalWb, revision: apiFinal.meta.revision }
  }, null, 2));
  await browser.close();
  const fails = results.filter((r) => !r.pass);
  console.log(`# SUMMARY mode=${MODE} total=${results.length} pass=${results.length - fails.length} fail=${fails.length}`);
  if (fails.length) fails.forEach((f) => console.log('  FAILED: ' + f.name));
  process.exit(0);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
