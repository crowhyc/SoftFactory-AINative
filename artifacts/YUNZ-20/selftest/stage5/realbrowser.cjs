'use strict';
/* YUNZ-25 / D-3 真实浏览器回归：身份遮罩隐藏 + 进入工作台 + 九身份切换 + 权限抽查。
   运行环境：mcr.microsoft.com/playwright:v1.55.0-jammy 容器（chromium 140，与 playwright-core 1.55.0 对齐）。
   用法：PHASE=before|after OUTDIR=/work/stage5/out node /work/stage5/realbrowser.cjs */
const fs = require('fs');
const path = require('path');
const { chromium } = require('/work/tools/node_modules/playwright');

const PHASE = process.env.PHASE || 'after';
const OUTDIR = process.env.OUTDIR || '/work/stage5/out';
const BASE = process.env.BASE || 'http://127.0.0.1:4180';
const EXPECT_FIXED = PHASE === 'after';
const IDENTITIES = ['项目负责人', '李欢', '王言', '张航瑞', '郑述文', '崔文建', '余宇', '黄逸偲', '陈江'];

const results = { phase: PHASE, base: BASE, started_at: new Date().toISOString(), checks: [], page_errors: [], console_errors: [] };
let pass = 0, fail = 0;
function check(id, ok, detail) {
  results.checks.push({ id, ok: !!ok, detail });
  if (ok) { pass += 1; console.log('PASS  ' + id + (detail !== undefined ? '  :: ' + JSON.stringify(detail) : '')); }
  else { fail += 1; console.log('FAIL  ' + id + '  -> ' + JSON.stringify(detail)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function probe(page) {
  return page.evaluate(() => {
    const layer = document.getElementById('identity-layer');
    const wb = document.getElementById('workbench');
    const cs = (el) => getComputedStyle(el);
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const cx = Math.round(window.innerWidth / 2), cy = Math.round(window.innerHeight / 2);
    const top = document.elementFromPoint(cx, cy);
    const inLayer = (node) => { let n = node; while (n) { if (n === layer) return true; n = n.parentElement; } return false; };
    const inWb = (node) => { let n = node; while (n) { if (n === wb) return true; n = n.parentElement; } return false; };
    return {
      layer: { display: cs(layer).display, hidden: layer.hidden, visibility: cs(layer).visibility, rect: rect(layer) },
      workbench: { display: cs(wb).display, hidden: wb.hidden, visibility: cs(wb).visibility, rect: rect(wb) },
      atPoint: { tag: top ? top.tagName : null, id: top ? top.id : null, cls: top ? top.className : null, inLayer: inLayer(top), inWorkbench: inWb(top) },
      rows: document.querySelectorAll('#wbs-body tr').length,
      identity_buttons: document.querySelectorAll('#identity-list .identity-btn').length,
      add_row_btn: { display: cs(document.getElementById('add-row-btn')).display, hidden: document.getElementById('add-row-btn').hidden },
      session_status: document.getElementById('session-status').textContent,
      identity_select_value: document.getElementById('identity-select').value,
      hint: document.getElementById('hint').hidden ? '' : document.getElementById('hint').textContent.trim(),
      viewport: { w: window.innerWidth, h: window.innerHeight }
    };
  });
}

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (e) => results.page_errors.push(String(e && e.message ? e.message : e)));
  page.on('console', (m) => { if (m.type() === 'error') results.console_errors.push(m.text()); });

  results.browser_version = browser.version();
  console.log('[env] chromium=' + browser.version() + ' phase=' + PHASE);

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('#identity-list .identity-btn').length > 0, null, { timeout: 15000 });
  await sleep(300);

  /* ---------- 1. 进入前：身份选择层 ---------- */
  const before = await probe(page);
  results.step1_before_click = before;
  check('1.1 身份选择层渲染 9 个身份按钮', before.identity_buttons === 9, before.identity_buttons);
  check('1.2 点击前身份选择层可见（display != none）', before.layer.display !== 'none', before.layer);
  check('1.3 点击前工作台隐藏（display == none）', before.workbench.display === 'none', before.workbench);
  await page.screenshot({ path: path.join(OUTDIR, PHASE + '-01-identity-layer.png') });

  /* ---------- 2. 点击「李欢」进入工作台 ---------- */
  await page.getByRole('button', { name: /李欢/ }).click();
  await page.waitForTimeout(800);
  const after = await probe(page);
  results.step2_after_click = after;

  const layerHiddenExpect = EXPECT_FIXED ? 'none' : 'flex';
  check('2.1 点击「李欢」后 #identity-layer 的 computed display === ' + layerHiddenExpect,
    after.layer.display === layerHiddenExpect, { actual_display: after.layer.display, hidden_attr: after.layer.hidden, expected: layerHiddenExpect });
  check('2.2 遮罩不再占据整屏（高度为 0 或不可见）',
    EXPECT_FIXED ? (after.layer.rect.h === 0 || after.layer.visibility === 'hidden') : (after.layer.rect.h > 0),
    after.layer.rect);
  const wbVisible = after.workbench.display !== 'none' && after.workbench.rect.w > 0 && after.workbench.rect.h > 0;
  check('2.3 #workbench 可见（display != none 且有实际尺寸）', wbVisible, after.workbench);
  const wbInViewport = wbVisible && after.workbench.rect.y < after.viewport.h;
  check('2.3b #workbench 进入视口可见区域（rect.y < 视口高度）', wbInViewport, { y: after.workbench.rect.y, viewport_h: after.viewport.h });
  check('2.4 视口中心命中元素属于工作台' + (EXPECT_FIXED ? '' : '（修复前应命中遮罩，此处断言遮罩覆盖）'),
    EXPECT_FIXED ? after.atPoint.inWorkbench : after.atPoint.inLayer, after.atPoint);
  check('2.5 工作台渲染 36 行任务', after.rows === 36, after.rows);
  check('2.6 会话状态已切换为「李欢」', after.session_status.indexOf('李欢') !== -1, after.session_status);
  await page.screenshot({ path: path.join(OUTDIR, PHASE + '-02-workbench-after-click.png') });

  /* ---------- 3. 九身份切换 ---------- */
  const switching = [];
  for (const id of IDENTITIES) {
    await page.selectOption('#identity-select', id);
    await page.waitForTimeout(220);
    const p = await probe(page);
    switching.push({ identity: id, layer_display: p.layer.display, layer_hidden: p.layer.hidden, workbench_display: p.workbench.display, rows: p.rows, session: p.session_status, select: p.identity_select_value, add_row_display: p.add_row_btn.display });
  }
  results.step3_switching = switching;
  const switchOk = switching.every((s) => s.layer_display === 'none' && s.workbench_display !== 'none' && s.rows === 36 && s.session.indexOf(s.identity) !== -1);
  check('3.1 九个身份依次切换：遮罩始终隐藏、工作台可见、36 行、会话状态跟随', switchOk, switching);
  const pmRow = switching.find((s) => s.identity === '项目负责人');
  const noPmRow = switching.filter((s) => s.identity !== '项目负责人');
  check('3.2 「新增行」按钮仅项目负责人可见', pmRow.add_row_display !== 'none' && noPmRow.every((s) => s.add_row_display === 'none'),
    { pm: pmRow.add_row_display, others: noPmRow.map((s) => s.identity + '=' + s.add_row_display) });

  /* ---------- 4. 权限抽查 ---------- */
  // 4a 普通负责人：李欢
  await page.selectOption('#identity-select', '李欢');
  await page.waitForTimeout(250);
  const permOwner = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#wbs-body tr[data-id]'));
    const mine = rows.find((r) => r.querySelector('td[data-field="owner"]').textContent.trim() === '李欢');
    const others = rows.find((r) => r.querySelector('td[data-field="owner"]').textContent.trim() !== '李欢' && r.querySelector('td[data-field="owner"]').textContent.trim() !== '项目负责人');
    const cls = (row, f) => row.querySelector('td[data-field="' + f + '"]').className;
    return {
      mine_id: mine ? mine.getAttribute('data-id') : null,
      mine_date_class: mine ? cls(mine, 'dates.design') : null,
      mine_struct_class: mine ? cls(mine, 'level1') : null,
      other_id: others ? others.getAttribute('data-id') : null,
      other_owner: others ? others.querySelector('td[data-field="owner"]').textContent.trim() : null,
      other_date_class: others ? cls(others, 'dates.design') : null
    };
  });
  results.step4_owner_perms = permOwner;
  check('4.1 普通负责人本人行的日期列可编辑（class 含 editable）', /editable/.test(permOwner.mine_date_class), permOwner);
  check('4.2 普通负责人本人行的结构性字段（一级）只读', /locked/.test(permOwner.mine_struct_class), permOwner.mine_struct_class);
  check('4.3 普通负责人他人行的日期列只读（class 含 locked）', /locked/.test(permOwner.other_date_class), permOwner.other_date_class);

  // 交互级：本人行日期单元格点击进入编辑态
  await page.click('#wbs-body tr[data-id="' + permOwner.mine_id + '"] td[data-field="dates.design"]');
  await page.waitForTimeout(200);
  const editorOpened = await page.evaluate((id) => {
    const td = document.querySelector('#wbs-body tr[data-id="' + id + '"] td[data-field="dates.design"]');
    return { editing: td.classList.contains('editing'), editor: !!td.querySelector('input,textarea,select') };
  }, permOwner.mine_id);
  check('4.4 点击本人行日期单元格进入编辑态（出现 input）', editorOpened.editing && editorOpened.editor, editorOpened);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  results.step4_dirty_after_escape = await page.evaluate(() => document.getElementById('session-status').textContent);

  // 交互级：他人行日期单元格点击给出只读提示且不进入编辑态
  await page.click('#wbs-body tr[data-id="' + permOwner.other_id + '"] td[data-field="dates.design"]');
  await page.waitForTimeout(200);
  const lockedClick = await page.evaluate((id) => {
    const td = document.querySelector('#wbs-body tr[data-id="' + id + '"] td[data-field="dates.design"]');
    const hint = document.getElementById('hint');
    return { editing: td.classList.contains('editing'), editor: !!td.querySelector('input,textarea,select'), hint: hint.hidden ? '' : hint.textContent.trim() };
  }, permOwner.other_id);
  results.step4_locked_click = lockedClick;
  check('4.5 点击他人行日期单元格只读：不进入编辑态且给出中文只读提示',
    !lockedClick.editing && !lockedClick.editor && lockedClick.hint.indexOf('只读') !== -1, lockedClick);

  // 4b 项目负责人：任意行可编辑 + 新增行可见
  await page.selectOption('#identity-select', '项目负责人');
  await page.waitForTimeout(250);
  const permPm = await page.evaluate((otherId) => {
    const td = document.querySelector('#wbs-body tr[data-id="' + otherId + '"] td[data-field="level1"]');
    return { other_row_struct_class: td.className, owner_name: document.querySelector('#wbs-body tr[data-id="' + otherId + '"] td[data-field="owner"]').textContent.trim() };
  }, permOwner.other_id);
  results.step4_pm_perms = permPm;
  check('4.6 项目负责人可编辑他人行的结构性字段（一级 class 含 editable）', /editable/.test(permPm.other_row_struct_class), permPm);
  await page.click('#wbs-body tr[data-id="' + permOwner.other_id + '"] td[data-field="level1"]');
  await page.waitForTimeout(200);
  const pmEditor = await page.evaluate((id) => {
    const td = document.querySelector('#wbs-body tr[data-id="' + id + '"] td[data-field="level1"]');
    return { editing: td.classList.contains('editing'), editor: !!td.querySelector('input,textarea,select') };
  }, permOwner.other_id);
  check('4.7 项目负责人点击他人行一级单元格进入编辑态', pmEditor.editing && pmEditor.editor, pmEditor);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUTDIR, PHASE + '-03-pm-view.png') });

  /* ---------- 5. 页面错误 ---------- */
  const finalProbe = await probe(page);
  results.step5_final = finalProbe;
  check('5.1 全程无 pageerror', results.page_errors.length === 0, results.page_errors);
  check('5.2 全程无 console error', results.console_errors.length === 0, results.console_errors);

  results.finished_at = new Date().toISOString();
  results.pass = pass; results.fail = fail;
  results.expect_fixed = EXPECT_FIXED;
  fs.writeFileSync(path.join(OUTDIR, 'realbrowser-' + PHASE + '.json'), JSON.stringify(results, null, 2));
  console.log('---');
  console.log('PHASE=' + PHASE + ' PASS=' + pass + ' FAIL=' + fail + ' pageerrors=' + results.page_errors.length);
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error('HARNESS_ERROR ' + (e && e.stack ? e.stack : e)); process.exit(3); });
