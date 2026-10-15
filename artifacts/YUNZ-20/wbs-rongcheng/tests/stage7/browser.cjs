'use strict';
/* YUNZ-27 / 变更包 #2：真实浏览器（Chromium）关键交互自测（CH-13 同步见下）。
   CH-13 同步（YUNZ-35 / 变更包 #6）：日报不再产出 xlsx，改为「一键可复制关键信息文本」弹层；
   本套件中编码日报 xlsx 的条目（矩阵7 / 8a / 14c）已按 CH-13 契约同步为弹层文本断言，断言强度未降低。
   运行环境：mcr.microsoft.com/playwright:v1.55.0-jammy 容器（chromium 140，与 playwright 1.55.0 对齐），
   --network host 使容器直接访问宿主回环上的服务（BASE）。宿主 CentOS 7（glibc 2.17）无法直接运行该 Chromium。
   宿主未安装任何系统级浏览器组件；浏览器只在测试容器内运行，不进产物、不进镜像。
   被测服务与浏览器同处一个容器（隔离数据目录），因此无需 --network host：
   本脚本自行 spawn `node <APP_DIR>/server.js`（WBS_DATA_DIR=DATA_DIR / WBS_PORT=PORT），
   结束时回收；OUTDIR 与 DATA_DIR 由 tests/stage7/run.sh 挂载。
   用法（由 tests/stage7/run.sh 调用）：
     APP_DIR=/app OUTDIR=/app/tests/.tmp/stage7-out DATA_DIR=/app/tests/.tmp/stage7-browser-data \
     node /app/tests/stage7/browser.cjs */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const TOOLS = process.env.TOOLS || '/tools';
const { chromium } = require(path.join(TOOLS, 'node_modules', 'playwright'));

const APP_DIR = process.env.APP_DIR || '/app';
const PORT = Number(process.env.WBS_TEST_PORT || 4223);
const BASE = process.env.BASE || 'http://127.0.0.1:' + PORT;
const OUTDIR = process.env.OUTDIR || '/app/tests/.tmp/stage7-out';
const DATA_DIR = process.env.DATA_DIR || '/app/tests/.tmp/stage7-browser-data';
const TZ = 'Asia/Shanghai';
const IDENTITIES = ['项目负责人', '李欢', '王言', '张航瑞', '郑述文', '崔文建', '余宇', '黄逸偲', '陈江'];
const STATUSES = ['未开始', '进行中', '已完成', '已延期', '被阻塞'];
const PHASES = ['未开始', '已开始', '已完成', '延期', '阻塞'];
const PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep'];

const results = { base: BASE, tz: TZ, started_at: new Date().toISOString(), checks: [], page_errors: [], console_errors: [] };
let pass = 0;
let fail = 0;
function check(id, ok, detail) {
  results.checks.push({ id, ok: !!ok, detail: detail === undefined ? null : detail });
  if (ok) { pass += 1; console.log('PASS  ' + id + (detail !== undefined ? '  :: ' + JSON.stringify(detail) : '')); }
  else { fail += 1; console.log('FAIL  ' + id + '  -> ' + JSON.stringify(detail)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (url, init) => {
  const response = await fetch(BASE + url, init);
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch (err) { body = text; }
  return { status: response.status, body };
};
const diskDoc = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wbs.json'), 'utf8'));
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

let server = null;
async function startServer() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.copyFileSync(path.join(APP_DIR, 'data', 'wbs.seed.json'), path.join(DATA_DIR, 'wbs.seed.json'));
  server = spawn(process.execPath, [path.join(APP_DIR, 'server.js')], {
    cwd: APP_DIR,
    env: Object.assign({}, process.env, { WBS_DATA_DIR: DATA_DIR, WBS_PORT: String(PORT), WBS_HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', (chunk) => process.stderr.write('[server] ' + chunk));
  for (let i = 0; i < 150; i += 1) {
    try { if ((await fetch(BASE + '/api/health')).ok) return; } catch (err) { /* 未就绪 */ }
    await sleep(100);
  }
  throw new Error('被测服务未就绪');
}
function stopServer() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    const child = server;
    server = null;
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(resolve, 3000);
  });
}

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  let browser = null;
  try {
    fs.rmSync(path.join(DATA_DIR, 'wbs.json'), { force: true });
    fs.rmSync(path.join(DATA_DIR, 'audit.log'), { force: true });
    await startServer();
    console.log('[env] 被测服务 ' + BASE + '（data: ' + DATA_DIR + '）');
    /* ---------- 准备：一次可追溯的当日改动（供 /api/history 字段级与日报摘要） ---------- */
    const doc0 = (await api('/api/wbs')).body;
    const prepared = {
      meta: { name: doc0.meta.name },
      identities: doc0.identities.slice(),
      tasks: doc0.tasks.map((task) => {
        if (task.id === 'T003') return Object.assign({}, task, { phases: Object.assign({}, task.phases, { test: '阻塞' }), note: '日报自测：等待外部依赖' });
        if (task.id === 'T004') return Object.assign({}, task, { phases: Object.assign({}, task.phases, { dev: '延期' }) });
        if (task.id === 'T005') return Object.assign({}, task, { phases: Object.assign({}, task.phases, { product: '已完成' }) });
        return task;
      })
    };
    const prep = await api('/api/wbs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': String(doc0.meta.revision), 'X-Identity': encodeURIComponent('项目负责人') },
      body: JSON.stringify(prepared)
    });
    if (prep.status !== 200) throw new Error('准备数据失败 HTTP ' + prep.status);
    fs.writeFileSync(path.join(OUTDIR, 'wbs-at-export.json'), JSON.stringify(prepared));
    console.log('[env] 准备数据 revision=' + prep.body.revision + '（T003 测试=阻塞 / T004 开发=延期 / T005 产品=已完成）');

    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (e) => results.page_errors.push(String(e && e.message ? e.message : e)));
    page.on('console', (m) => { if (m.type() === 'error') results.console_errors.push(m.text()); });
    results.browser_version = browser.version();
    console.log('[env] chromium=' + browser.version());

    const cellValue = (id, field) => page.evaluate(([rowId, f]) => {
      const td = document.querySelector('#wbs-body tr[data-id="' + rowId + '"] td[data-field="' + f + '"]');
      if (!td) return null;
      const control = td.querySelector('select, input, textarea');
      return control ? control.value : td.textContent.trim();
    }, [id, field]);
    const columnState = (id, field) => page.evaluate(([rowId, f]) => {
      const td = document.querySelector('#wbs-body tr[data-id="' + rowId + '"] td[data-field="' + f + '"]');
      const control = td ? td.querySelector('select, input, textarea') : null;
      return {
        hasControl: !!control,
        tag: control ? control.tagName.toLowerCase() : null,
        type: control ? control.getAttribute('type') : null,
        disabled: control ? !!control.disabled : null,
        options: control && control.tagName === 'SELECT' ? Array.from(control.options).map((o) => o.value) : [],
        locked: td ? td.classList.contains('locked') : null,
        editable: td ? td.classList.contains('editable') : null
      };
    }, [id, field]);
    const phaseState = (id, key) => page.evaluate(([rowId, k]) => {
      const td = document.querySelector('#wbs-body tr[data-id="' + rowId + '"] td[data-field="dates.' + k + '"]');
      const sel = td ? td.querySelector('select.phase-select') : null;
      return {
        hasControl: !!sel,
        tag: sel ? 'select' : null,
        disabled: sel ? !!sel.disabled : null,
        value: sel ? sel.value : null,
        options: sel ? Array.from(sel.options).map((o) => o.value) : []
      };
    }, [id, key]);
    const hint = () => page.evaluate(() => {
      const el = document.getElementById('hint');
      return el.hidden ? '' : el.textContent.trim();
    });
    const banner = () => page.evaluate(() => {
      const el = document.getElementById('banner');
      return el.hidden ? '' : document.getElementById('banner-text').textContent.trim();
    });
    const rowCount = () => page.evaluate(() => document.querySelectorAll('#wbs-body tr').length);

    /* ---------- 回归：身份进入工作台（D-3） ---------- */
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('#identity-list .identity-btn').length === 9, null, { timeout: 15000 });
    await sleep(300);
    const enterLayer = await page.evaluate(() => {
      const layer = document.getElementById('identity-layer');
      const wb = document.getElementById('workbench');
      return {
        layer_display: getComputedStyle(layer).display,
        layer_hidden: layer.hidden,
        wb_display: getComputedStyle(wb).display,
        wb_hidden: wb.hidden,
        identities: Array.from(document.querySelectorAll('#identity-list .identity-btn')).map((b) => b.getAttribute('data-identity')),
        add_entry_visible: !document.getElementById('identity-add').hidden
      };
    });
    check('验收1a 身份选择页渲染九身份且停留在入口页', enterLayer.identities.length === 9 && enterLayer.layer_display !== 'none' && enterLayer.wb_hidden,
      enterLayer.identities.join('/'));
    check('回归(D-3) 入口页「新增人员」不对未选身份的访客展示', enterLayer.add_entry_visible === false, enterLayer.add_entry_visible);

    await page.getByRole('button', { name: /李欢/ }).click();
    await page.waitForTimeout(700);
    const entered = await page.evaluate(() => {
      const layer = document.getElementById('identity-layer');
      const wb = document.getElementById('workbench');
      const rect = layer.getBoundingClientRect();
      return {
        layer_display: getComputedStyle(layer).display, layer_hidden: layer.hidden,
        layer_rect: { w: Math.round(rect.width), h: Math.round(rect.height) },
        wb_display: getComputedStyle(wb).display, wb_hidden: wb.hidden,
        rows: document.querySelectorAll('#wbs-body tr').length,
        identity_select: document.getElementById('identity-select').value
      };
    });
    check('回归(D-3) 进入工作台后身份遮罩 [hidden] 级联生效（display none、零尺寸）',
      entered.layer_display === 'none' && entered.layer_hidden && entered.layer_rect.w === 0 && entered.layer_rect.h === 0,
      entered.layer_rect);
    check('回归(D-3) 工作台可见并渲染 36 行', entered.wb_display !== 'none' && !entered.wb_hidden && entered.rows === 36, entered.rows);

    /* ---------- 验收1b：刷新后身份保持（localStorage） ---------- */
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const reloaded = await page.evaluate(() => ({
      wb_hidden: document.getElementById('workbench').hidden,
      identity_select: document.getElementById('identity-select').value,
      rows: document.querySelectorAll('#wbs-body tr').length
    }));
    check('验收1b 刷新（localStorage 记忆）后身份保持且直接进工作台',
      !reloaded.wb_hidden && reloaded.identity_select === '李欢' && reloaded.rows === 36, reloaded);

    /* ---------- 矩阵2：普通负责人（王言）——无权限行控件 disabled + 只读提示 ---------- */
    await page.selectOption('#identity-select', '王言');
    await page.waitForTimeout(400);
    const foreignId = await page.evaluate(() => {
      const tr = Array.from(document.querySelectorAll('#wbs-body tr')).find((row) => row.querySelector('td[data-field="owner"]').textContent.trim() !== '王言');
      return tr.getAttribute('data-id');
    });
    const ownId = await page.evaluate(() => {
      const tr = Array.from(document.querySelectorAll('#wbs-body tr')).find((row) => row.querySelector('td[data-field="owner"]').textContent.trim() === '王言');
      return tr.getAttribute('data-id');
    });
    check('矩阵2 前置：存在「本人行」与「他人行」', !!ownId && !!foreignId, { ownId, foreignId });

    const foreignDates = {};
    for (const key of ['design', 'dev', 'test', 'product', 'demo_prep']) {
      foreignDates[key] = await columnState(foreignId, 'dates.' + key);
    }
    const foreignPhase = await phaseState(foreignId, 'design');
    const allDisabled = Object.keys(foreignDates).every((key) => foreignDates[key].hasControl && foreignDates[key].type === 'date' && foreignDates[key].disabled === true);
    check('矩阵2a 无权限行五列日期常显为 type=date 且 disabled（非「点击才出现」）', allDisabled, foreignDates);
    check('矩阵2b 无权限行阶段进度下拉常显、disabled、选项集合不变（五阶段枚举）',
      foreignPhase.hasControl && foreignPhase.tag === 'select' && foreignPhase.disabled === true && JSON.stringify(foreignPhase.options) === JSON.stringify(PHASES),
      { options: foreignPhase.options, disabled: foreignPhase.disabled });

    await page.click('#wbs-body tr[data-id="' + foreignId + '"] td[data-field="dates.design"]');
    await page.waitForTimeout(200);
    const lockedHintDate = await hint();
    check('矩阵2c 点击无权限行日期单元格仍给中文只读提示', lockedHintDate.indexOf('只读') !== -1 && lockedHintDate.indexOf('设计') !== -1, lockedHintDate);
    await page.click('#wbs-body tr[data-id="' + foreignId + '"] td[data-field="dates.design"] .phase-cell');
    await page.waitForTimeout(200);
    const lockedHintStatus = await hint();
    check('矩阵2d 点击无权限行阶段进度单元格仍给中文只读提示', lockedHintStatus.indexOf('只读') !== -1 && lockedHintStatus.indexOf('设计进度') !== -1, lockedHintStatus);

    const ownDates = await columnState(ownId, 'dates.design');
    const ownPhase = await phaseState(ownId, 'design');
    check('矩阵2e 本人行日期/阶段进度控件可交互（未 disabled）', ownDates.hasControl && ownDates.disabled === false && ownPhase.hasControl && ownPhase.disabled === false,
      { date_disabled: ownDates.disabled, phase_disabled: ownPhase.disabled });
    await page.click('#wbs-body tr[data-id="' + foreignId + '"] td[data-field="note"]');
    await page.waitForTimeout(200);
    const othersHint = await hint();
    check('验收4 他人行只读（点击进展说明有中文提示、不进入编辑态）',
      othersHint.indexOf('只读') !== -1 && !(await page.evaluate((id) => !!document.querySelector('#wbs-body tr[data-id="' + id + '"] td[data-field="note"] input, #wbs-body tr[data-id="' + id + '"] td[data-field="note"] textarea'), foreignId)),
      othersHint);
    /* CH-8：只读行的 K 列点击改为打开「只读预览面板」（不再只是内联提示），断言后关闭面板继续后续用例。 */
    const readonlyPanel = await page.evaluate(() => ({
      open: !document.getElementById('note-panel').hidden,
      readonly: document.getElementById('note-dialog').classList.contains('readonly'),
      saveHidden: document.getElementById('note-save').hidden
    }));
    check('验收4（CH-8）他人行只读补充：K 列打开只读预览面板（无保存按钮）',
      readonlyPanel.open === true && readonlyPanel.readonly === true && readonlyPanel.saveHidden === true, readonlyPanel);
    await page.click('#note-close');
    await page.waitForTimeout(200);

    /* ---------- 矩阵3b / 矩阵5c：操作列（普通负责人） ---------- */
    const opNormal = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#wbs-body tr'));
      return {
        rows: rows.length,
        edit_buttons: rows.filter((tr) => tr.querySelector('button[data-edit-row]')).length,
        delete_buttons: rows.filter((tr) => tr.querySelector('button[data-delete]')).length,
        label: rows[0].querySelector('button[data-edit-row]').textContent.trim()
      };
    });
    check('矩阵3b 每行常显「编辑」按钮；普通负责人看不到「删除」',
      opNormal.edit_buttons === opNormal.rows && opNormal.delete_buttons === 0 && opNormal.label === '编辑',
      { rows: opNormal.rows, edit: opNormal.edit_buttons, del: opNormal.delete_buttons, label: opNormal.label });
    await page.click('#wbs-body tr[data-id="' + foreignId + '"] button[data-edit-row]');
    await page.waitForTimeout(250);
    const foreignEdit = await page.evaluate((id) => ({
      row_editing: document.querySelector('#wbs-body tr[data-id="' + id + '"]').classList.contains('row-editing'),
      hint: document.getElementById('hint').hidden ? '' : document.getElementById('hint').textContent.trim()
    }), foreignId);
    check('矩阵3c 他人行点「编辑」只给中文只读提示、不进入行编辑态',
      foreignEdit.row_editing === false && foreignEdit.hint.indexOf('只读') !== -1, foreignEdit);

    /* ---------- 项目负责人：矩阵1 / 3a / 7 / 8 / 9 ---------- */
    await page.selectOption('#identity-select', '项目负责人');
    await page.waitForTimeout(400);

    const pmControls = {
      dates: {},
      phase: await phaseState('T003', 'design'),
      owner: await columnState('T001', 'owner')
    };
    for (const key of ['design', 'dev', 'test', 'product', 'demo_prep']) {
      pmControls.dates[key] = await columnState('T003', 'dates.' + key);
    }
    check('矩阵1a 项目负责人可见五列日期常显 type=date 且可交互（未 disabled）',
      Object.keys(pmControls.dates).every((key) => pmControls.dates[key].hasControl && pmControls.dates[key].type === 'date' && pmControls.dates[key].disabled === false),
      pmControls.dates.design);
    check('矩阵1b 五阶段进度下拉常显五枚举且可交互（旧「状态」列已移除）',
      pmControls.phase.tag === 'select' && pmControls.phase.disabled === false && JSON.stringify(pmControls.phase.options) === JSON.stringify(PHASES) &&
      (await page.evaluate(() => document.querySelectorAll('#wbs-body td[data-field="status"]').length)) === 0,
      pmControls.phase.options);
    check('矩阵5 负责人列为下拉、选项＝当前人员池（项目负责人可见）',
      pmControls.owner.tag === 'select' && JSON.stringify(pmControls.owner.options) === JSON.stringify(IDENTITIES) && (await cellValue('T001', 'owner')) === '李欢',
      pmControls.owner.options);

    const opPm = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#wbs-body tr'));
      return {
        rows: rows.length,
        edit_buttons: rows.filter((tr) => tr.querySelector('button[data-edit-row]')).length,
        delete_buttons: rows.filter((tr) => tr.querySelector('button[data-delete]')).length
      };
    });
    check('矩阵3a 操作列每行常显「编辑」，项目负责人每行另有「删除」',
      opPm.edit_buttons === opPm.rows && opPm.delete_buttons === opPm.rows, opPm);

    await page.click('#wbs-body tr[data-id="T001"] button[data-edit-row]');
    await page.waitForTimeout(300);
    const rowEditOn = await page.evaluate(() => {
      const tr = document.querySelector('#wbs-body tr[data-id="T001"]');
      return {
        row_editing: tr.classList.contains('row-editing'),
        label: tr.querySelector('button[data-edit-row]').textContent.trim(),
        l1_editor: !!tr.querySelector('td[data-field="level1"] input'),
        note_summary_only: !tr.querySelector('td[data-field="note"] textarea') && !!tr.querySelector('td[data-field="note"] .note-summary'),
        hint: document.getElementById('hint').hidden ? '' : document.getElementById('hint').textContent.trim()
      };
    });
    check('矩阵3d 点「编辑」进入该行行编辑态（可编辑文本列常显编辑器；CH-8 后 K 列仍为摘要单元格、不再有内联 textarea）',
      rowEditOn.row_editing && rowEditOn.label === '完成' && rowEditOn.l1_editor && rowEditOn.note_summary_only, rowEditOn);
    await page.click('#wbs-body tr[data-id="T001"] button[data-edit-row]');
    await page.waitForTimeout(250);
    const rowEditOff = await page.evaluate(() => {
      const tr = document.querySelector('#wbs-body tr[data-id="T001"]');
      return { row_editing: tr.classList.contains('row-editing'), label: tr.querySelector('button[data-edit-row]').textContent.trim() };
    });
    check('矩阵3e 再点「完成」退出行编辑态', rowEditOff.row_editing === false && rowEditOff.label === '编辑', rowEditOff);

    /* ---------- 矩阵7 / 8：日报导出（阻塞与延期；CH-12 起不含当日变更） ---------- */
    await page.screenshot({ path: path.join(OUTDIR, 'pm-workbench.png'), fullPage: false });
    const capture = async (buttonId) => {
      await page.evaluate(() => {
        window.__captured = null;
        window.__capturedName = null;
        window.WBS_DOWNLOAD_HOOK = (bytes, name) => {
          let out = '';
          for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
          window.__captured = btoa(out);
          window.__capturedName = name;
        };
      });
      await page.click(buttonId);
      for (let i = 0; i < 60; i += 1) {
        if (await page.evaluate(() => window.__captured !== null)) break;
        await sleep(200);
      }
      return page.evaluate(() => {
        const name = window.__capturedName;
        const base64 = window.__captured;
        let sheets = null;
        if (base64) {
          const wb = window.XLSX.read(base64, { type: 'base64' });
          sheets = wb.SheetNames.map((sheetName) => ({
            name: sheetName,
            rows: window.XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: '' })
          }));
        }
        return { name, base64, sheets };
      });
    };

    /* CH-13：日报弹层采集（打开弹层 → 读文本 + 采集「无下载」证据 → 返回 /api/daily 快照）。 */
    const openDaily = async () => {
      await page.evaluate(() => {
        window.__captured = null;
        window.__capturedName = null;
        window.__objUrls = 0;
        window.WBS_DOWNLOAD_HOOK = (bytes, name) => { window.__captured = name; window.__capturedName = name; };
        const create = window.URL.createObjectURL.bind(window.URL);
        window.URL.createObjectURL = function (blob) { window.__objUrls += 1; return create(blob); };
      });
      await page.click('#daily-btn');
      await page.waitForFunction(() => document.getElementById('daily-panel').hidden === false, null, { timeout: 15000 });
      await page.waitForTimeout(200);
      const view = await page.evaluate(() => ({
        text: document.getElementById('daily-text').textContent,
        whiteSpace: getComputedStyle(document.getElementById('daily-text')).whiteSpace,
        role: document.querySelector('#daily-panel .modal-card') ? document.querySelector('#daily-panel .modal-card').getAttribute('role') : null,
        hook: window.__captured,
        objectUrls: window.__objUrls,
        anchors: document.querySelectorAll('a[download]').length,
        xlsxApi: typeof window.WBSCore.buildDailyWorkbook + '/' + typeof window.WBSCore.dailyBytes
      }));
      const payload = (await api('/api/daily?tz=' + encodeURIComponent(TZ) + '&date=' + today())).body;
      return { view: view, api: payload };
    };

    const daily = await openDaily();
    results.dailyText = daily.api.text;
    const dailyDoc = (await api('/api/wbs')).body;
    const dTask = (id) => dailyDoc.tasks.find((t) => t.id === id);
    const dLine = (prefix, id, conclusion) => '【' + prefix + '】' + dTask(id).level1 + ' / ' + dTask(id).level2 +
      ' / ' + dTask(id).task + ' @' + dTask(id).owner + '：' + conclusion + '。';
    const expectDailyLines = [
      dLine('延期·高风险', 'T004', '开发延期'),
      dLine('阻塞·高风险', 'T003', '测试更新为阻塞')
    ];
    check('矩阵7a 点「导出日报」打开只读文本弹层（role=dialog），且不再产出与下载日报 xlsx（无 WBS_DOWNLOAD_HOOK 调用 / createObjectURL / a[download] / xlsx 组装 API；CH-13）',
      daily.view.role === 'dialog' && daily.view.hook === null && daily.view.objectUrls === 0 &&
      daily.view.anchors === 0 && daily.view.xlsxApi === 'undefined/undefined',
      { role: daily.view.role, hook: daily.view.hook, objectUrls: daily.view.objectUrls, anchors: daily.view.anchors, xlsxApi: daily.view.xlsxApi });
    check('矩阵7b 弹层只读文本块 = /api/daily 的关键信息文本（同一份字符串），首行概况为「今日延期 X 项 / 阻塞 Y 项」',
      daily.view.text === daily.api.text.body && daily.view.whiteSpace === 'pre-wrap' &&
      daily.view.text.split('\n')[0] === '今日延期 1 项 / 阻塞 1 项' &&
      daily.api.text.delayedCount === 1 && daily.api.text.blockedCount === 1,
      { first: daily.view.text.split('\n')[0], text: daily.view.text.split('\n') });

    check('矩阵7c 弹层事件行逐字「【延期·高风险】/【阻塞·高风险】一级 / 二级 / 任务项 @负责人：结论。」（含 @ 与高风险前缀；只体现阻塞、延期）',
      JSON.stringify(daily.api.text.lines) === JSON.stringify(expectDailyLines) &&
      daily.api.text.lines.every((l) => /^【(延期|阻塞)·高风险】.+ \/ .+ \/ .+ @.+：.+。$/.test(l)) &&
      daily.view.text.indexOf('【完成】') === -1 && daily.view.text.indexOf('【普通】') === -1,
      { expect: expectDailyLines, actual: daily.api.text.lines });
    check('矩阵7d 延期条目在前、阻塞条目在后；Esc 可关闭弹层（只读展示、无未保存内容、不下载文件）',
      daily.api.text.lines.slice(0, daily.api.text.delayedCount).every((l) => l.indexOf('【延期·高风险】') === 0) &&
      daily.api.text.lines.slice(daily.api.text.delayedCount).every((l) => l.indexOf('【阻塞·高风险】') === 0) &&
      daily.api.text.lines.length === daily.api.text.delayedCount + daily.api.text.blockedCount,
      { delayed: daily.api.text.delayedCount, blocked: daily.api.text.blockedCount });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('daily-panel').hidden === true, null, { timeout: 15000 });
    const escClosed = await page.evaluate(() => document.getElementById('daily-panel').hidden);
    check('矩阵7e Esc 关闭日报弹层（关闭按钮路径见矩阵 7a 之后的弹层结构断言）', escClosed === true, escClosed);

    /* CH-13：日报改为文本弹层，不含「当日变更」等普通变更明细；字段级证据仍由 /api/history（服务端保留）承载。 */
    check('矩阵8a 日报弹层只体现阻塞、延期：不含「完成 / 普通」事件，也不含当日普通变更明细（CH-13）',
      daily.api.text.lines.every((l) => l.indexOf('【完成】') === -1 && l.indexOf('【普通】') === -1) &&
      daily.api.changes.length > 0 && Array.isArray(daily.api.summary) &&
      daily.view.text.indexOf('当日变更') === -1 && daily.view.text.indexOf('改动字段') === -1,
      { lines: daily.api.text.lines.length, changes: daily.api.changes.length });
    const history = (await api('/api/history?tz=' + TZ + '&date=' + today())).body;
    const nameById = {};
    prepared.tasks.forEach((t) => { nameById[t.id] = t.task; });
    const beforeById = {};
    doc0.tasks.forEach((t) => { beforeById[t.id] = t; });
    const expectedChanges = [
      [nameById.T003, 'note', '', '日报自测：等待外部依赖'],
      [nameById.T003, 'phases.test.status', beforeById.T003.phases.test, '阻塞'],
      [nameById.T004, 'phases.dev.status', beforeById.T004.phases.dev, '延期'],
      [nameById.T005, 'phases.product.status', beforeById.T005.phases.product, '已完成']
    ];
    const actualChanges = history.records.map((row) => [row.task, row.field, row.old, row.new]);
    const fromMs = Date.parse(history.from);
    const toMs = Date.parse(history.to);
    const shapeOk = history.records.every((row) => row.identity === '项目负责人' &&
      Number.isFinite(Date.parse(row.at)) && Date.parse(row.at) >= fromMs && Date.parse(row.at) < toMs);
    const setEqual = (a, b) => JSON.stringify(a.slice().sort()) === JSON.stringify(b.slice().sort());
    check('矩阵8b 每行改动仍可从 /api/history 读到字段级 旧值→新值/时间/操作身份（自然日口径）',
      shapeOk && history.records.length === expectedChanges.length && setEqual(actualChanges, expectedChanges),
      { expected: expectedChanges, actual: actualChanges });
    const times = history.records.map((row) => Date.parse(row.at));
    check('矩阵8c 同一任务的字段级记录按时间升序（/api/history）', times.every((t, i) => i === 0 || t >= times[i - 1]), times);

    /* ---------- 矩阵9：原 WBS 导出仍不含 status、A–K 11 列、第 1/2 行不变 ---------- */
    const wbsExport = await capture('#export-btn');
    results.wbsExport = { name: wbsExport.name, sheets: wbsExport.sheets ? wbsExport.sheets.map((s) => s.name) : null };
    if (wbsExport.base64) fs.writeFileSync(path.join(OUTDIR, wbsExport.name), Buffer.from(wbsExport.base64, 'base64'));
    const wbsFidelity = await page.evaluate(async (base64) => {
      const captureWb = window.XLSX.read(base64, { type: 'base64' });
      const captureRows = window.XLSX.utils.sheet_to_json(captureWb.Sheets[captureWb.SheetNames[0]], { header: 1, raw: false, defval: '' });
      const templateBuffer = await (await fetch('template.xlsx', { cache: 'no-store' })).arrayBuffer();
      const templateWb = window.XLSX.read(new Uint8Array(templateBuffer), { type: 'array', cellStyles: true });
      const templateRows = window.XLSX.utils.sheet_to_json(templateWb.Sheets[templateWb.SheetNames[0]], { header: 1, raw: false, defval: '' });
      const tail = (rows, n) => rows.slice(-n);
      const dataColumns = (row) => row.slice(0, 11);
      return {
        capture_row1: captureRows[0] || [],
        capture_row2: captureRows[1] || [],
        template_row1: templateRows[0] || [],
        template_row2: templateRows[1] || [],
        capture_data: captureRows.slice(2).filter((row) => row.some((cell) => String(cell).trim() !== '')).map(dataColumns),
        capture_data_tail: tail(captureRows, 6).map(dataColumns),
        template_row_count: templateRows.length,
        sheet_names: captureWb.SheetNames
      };
    }, wbsExport.base64);
    const expectedWbsRows = prepared.tasks.map((task) => {
      const dates = task.dates || {};
      return [task.level1, task.level2, task.task, task.owner, task.demo]
        .concat(['design', 'dev', 'test', 'product', 'demo_prep'].map((key) => dates[key] || ''))
        .concat([task.note]);
    });
    check('矩阵9a 原 WBS 导出文件名保持，且 A–K 数据行与当前数据逐字段一致（36 行、11 列）',
      /^蓉城战役WBS-\d{8}\.xlsx$/.test(String(wbsExport.name)) &&
      JSON.stringify(wbsFidelity.capture_data) === JSON.stringify(expectedWbsRows),
      { name: wbsExport.name, rows: wbsFidelity.capture_data.length, expect: expectedWbsRows.length });
    const rowA2K = (row) => (row || []).slice(0, 11);
    check('矩阵9b 原 WBS 导出第 1/2 行 A–K 逐字与源模板一致，K 后追加五个阶段进度列表头（旧状态列已移除）',
      JSON.stringify(rowA2K(wbsFidelity.capture_row1)) === JSON.stringify(rowA2K(wbsFidelity.template_row1)) &&
      JSON.stringify(rowA2K(wbsFidelity.capture_row2)) === JSON.stringify(rowA2K(wbsFidelity.template_row2)) &&
      wbsFidelity.capture_row2[3] === '负责人' && wbsFidelity.capture_row2[10] === '进展说明' &&
      wbsFidelity.capture_row2[11] === '设计进度' && wbsFidelity.capture_row2[15] === '演示准备进度',
      { row2: wbsFidelity.capture_row2 });
    const dataFlat = JSON.stringify(wbsFidelity.capture_data);
    check('矩阵9c 原 WBS 导出数据区不含 status 字段与五个状态取值（status 不导出）',
      dataFlat.indexOf('status') === -1 && STATUSES.every((status) => dataFlat.indexOf(status) === -1) &&
      wbsFidelity.sheet_names.length === 1,
      { has_status_literal: dataFlat.indexOf('status') !== -1, sheets: wbsFidelity.sheet_names });
    /* ---------- 矩阵13（CH-10）：Q1 导出日期标签（Asia/Shanghai，仅新增 Q1） ---------- */
    const q1 = String(wbsFidelity.capture_row1[16] == null ? '' : wbsFidelity.capture_row1[16]);
    const q2 = String(wbsFidelity.capture_row2[16] == null ? '' : wbsFidelity.capture_row2[16]);
    check('矩阵13a（CH-10）原 WBS 导出 Q1 写入「导出日期：YYYY-MM-DD HH:mm」（Asia/Shanghai 当日）',
      /^导出日期：\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(q1) && q1.slice(5, 15) === today(),
      { q1, today: today() });
    check('矩阵13b（CH-10）Q1 为唯一新增单元格：模板 Q1/Q2 原为空、A1:C1 合并与 A–K 数据区不受影响',
      String(wbsFidelity.template_row1[16] == null ? '' : wbsFidelity.template_row1[16]) === '' && q2 === '' &&
      wbsFidelity.template_row_count === wbsFidelity.capture_data.length + 2,
      { template_q1: wbsFidelity.template_row1[16], q2: q2, template_rows: wbsFidelity.template_row_count });

    /* ---------- 矩阵5：项目负责人改派负责人 + 保存 + 三端一致 + 刷新持久 ---------- */
    const beforeOwner = await cellValue('T001', 'owner');
    await page.evaluate(() => {
      const select = document.querySelector('#wbs-body tr[data-id="T001"] td[data-field="owner"] select');
      select.value = '余宇';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(300);
    check('矩阵5b 项目负责人改派负责人（下拉选择写回草稿）', (await cellValue('T001', 'owner')) === '余宇' && beforeOwner === '李欢', { beforeOwner, after: '余宇' });
    await page.click('#save-btn');
    await page.waitForFunction(() => !document.getElementById('banner').hidden && document.getElementById('banner-text').textContent.indexOf('保存成功') !== -1, null, { timeout: 15000 });
    await page.waitForTimeout(300);
    const apiDoc = (await api('/api/wbs')).body;
    const disk = diskDoc();
    const apiRow = apiDoc.tasks.find((task) => task.id === 'T001');
    const diskRow = disk.tasks.find((task) => task.id === 'T001');
    check('矩阵11f 三端一致：页面 / GET /api/wbs / 磁盘 JSON（负责人改派）',
      apiRow.owner === '余宇' && diskRow.owner === '余宇' && (await cellValue('T001', 'owner')) === '余宇', { api: apiRow.owner, disk: diskRow.owner });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    check('矩阵11g 刷新持久：重新加载后改派结果仍在', (await cellValue('T001', 'owner')) === '余宇', await cellValue('T001', 'owner'));

    /* ---------- 验收3：普通负责人本人行可编辑并保存（矩阵3 回归） ---------- */
    await page.selectOption('#identity-select', '王言');
    await page.waitForTimeout(400);
    const ownRowId = await page.evaluate(() => {
      const tr = Array.from(document.querySelectorAll('#wbs-body tr')).find((row) => row.querySelector('td[data-field="owner"]').textContent.trim() === '王言');
      return tr.getAttribute('data-id');
    });
    /* CH-8：K 列改为「摘要单元格 + 大尺寸 Markdown 面板」，本人行的编辑入口随之改为面板内保存。 */
    const noteText = 'stage7 回归（CH-8 面板） ' + new Date().toISOString();
    await page.click('#wbs-body tr[data-id="' + ownRowId + '"] td[data-field="note"]');
    await page.waitForFunction(() => !document.getElementById('note-panel').hidden, null, { timeout: 10000 });
    await page.fill('#note-input', noteText);
    await page.click('#note-save');
    await page.waitForFunction(() => !document.getElementById('banner').hidden && document.getElementById('banner-text').textContent.indexOf('保存成功') !== -1, null, { timeout: 15000 });
    await page.click('#note-close');
    const savedDoc = (await api('/api/wbs')).body;
    const savedRow = savedDoc.tasks.find((task) => task.id === ownRowId);
    const ownNoteSummary = await page.evaluate((rowId) => {
      const td = document.querySelector('#wbs-body tr[data-id="' + rowId + '"] td[data-field="note"]');
      const span = td.querySelector('.note-summary');
      return span ? span.textContent : td.textContent.trim();
    }, ownRowId);
    check('验收3 普通负责人本人行可编辑并保存（CH-8：K 列经大尺寸面板保存），页面/API/磁盘三端一致',
      savedRow.note === noteText && diskDoc().tasks.find((t) => t.id === ownRowId).note === noteText && ownNoteSummary === noteText,
      { row: ownRowId, note: noteText.slice(0, 24), summary: ownNoteSummary.slice(0, 24) });

    /* ---------- 矩阵5（只读侧）：普通负责人负责人列只读 ---------- */
    const ownerReadOnly = await page.evaluate((rowId) => {
      const td = document.querySelector('#wbs-body tr[data-id="' + rowId + '"] td[data-field="owner"]');
      return { has_select: !!td.querySelector('select'), text: td.textContent.trim() };
    }, ownRowId);
    await page.click('#wbs-body tr[data-id="' + ownRowId + '"] td[data-field="owner"]');
    await page.waitForTimeout(200);
    const ownerHint = await hint();
    check('矩阵5d 普通负责人负责人列只读（无下拉、点击给中文提示）',
      ownerReadOnly.has_select === false && ownerReadOnly.text === '王言' && ownerHint.indexOf('只读') !== -1 && ownerHint.indexOf('负责人') !== -1,
      { read: ownerReadOnly, hint: ownerHint });

    /* ---------- 矩阵4：删除确认框「取消」/「确认」两条路径 ---------- */
    await page.selectOption('#identity-select', '项目负责人');
    await page.waitForTimeout(400);
    const rowsBeforeDelete = await rowCount();
    const lastId = await page.evaluate(() => document.querySelectorAll('#wbs-body tr')[document.querySelectorAll('#wbs-body tr').length - 1].getAttribute('data-id'));
    await page.evaluate(() => { window.confirm = () => false; });
    await page.click('#wbs-body tr[data-id="' + lastId + '"] button[data-delete]');
    await page.waitForTimeout(250);
    const afterCancel = await rowCount();
    const cancelHint = await hint();
    check('矩阵4a 删除确认框「取消」路径：行数不变、给出取消提示',
      afterCancel === rowsBeforeDelete && cancelHint.indexOf('已取消删除') !== -1, { rows: afterCancel, hint: cancelHint });
    await page.evaluate(() => { window.confirm = () => true; });
    await page.click('#wbs-body tr[data-id="' + lastId + '"] button[data-delete]');
    await page.waitForTimeout(250);
    const afterConfirm = await rowCount();
    check('矩阵4b 删除确认框「确认」路径：该行从表格移除',
      afterConfirm === rowsBeforeDelete - 1 && !(await page.evaluate((id) => !!document.querySelector('#wbs-body tr[data-id="' + id + '"]'), lastId)),
      { rows: afterConfirm, removed: lastId });

    /* ---------- 矩阵6：新增人员（校验 / 立即生效 / 返回首页同步 / 落盘） ---------- */
    const identityCountBefore = (await api('/api/wbs')).body.identities.length;
    await page.click('#add-person-btn');
    await page.waitForTimeout(250);
    const panelOpen = await page.evaluate(() => !document.getElementById('add-person-panel').hidden);
    check('矩阵6a 项目负责人可见「新增人员」入口并打开录入面板', panelOpen === true, panelOpen);

    const submit = async (value) => {
      if (await page.evaluate(() => document.getElementById('add-person-panel').hidden)) {
        await page.click('#add-person-btn');
        await page.waitForTimeout(200);
      }
      await page.fill('#new-person-name', value);
      await page.click('#new-person-confirm');
      // 成功路径会关闭面板（并落盘）；失败路径立即给出中文提示。两种路径都等待到稳定态。
      await page.waitForFunction(() => {
        const panel = document.getElementById('add-person-panel');
        const message = document.getElementById('new-person-msg');
        return panel.hidden || !message.hidden;
      }, null, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(300);
      return page.evaluate(() => ({
        msg_hidden: document.getElementById('new-person-msg').hidden,
        msg: document.getElementById('new-person-msg').textContent.trim(),
        panel_hidden: document.getElementById('add-person-panel').hidden,
        identities: document.getElementById('identity-select') ? Array.from(document.getElementById('identity-select').options).map((o) => o.value) : []
      }));
    };
    const blank = await submit('   ');
    check('矩阵6b 姓名非空校验：空白被拒并给中文提示', blank.msg.indexOf('不能为空') !== -1 && blank.panel_hidden === false && blank.identities.length === identityCountBefore, blank.msg);
    const tooLong = await submit('一二三四五六七八九十一二三四五六七八九十一');
    check('矩阵6c 姓名长度 1–20 校验：21 字被拒并给中文提示', tooLong.msg.indexOf('1–20') !== -1 && tooLong.identities.length === identityCountBefore, tooLong.msg);
    const dup = await submit('王言');
    check('矩阵6d 姓名去重校验：重复姓名被拒并给中文提示', dup.msg.indexOf('已在人员池中') !== -1 && dup.identities.length === identityCountBefore, dup.msg);
    const added = await submit('赵新');
    check('矩阵6e 合法姓名加入成功（面板关闭、人员池 +1）',
      added.panel_hidden === true && added.msg_hidden === true &&
      added.identities.length === identityCountBefore + 1 && added.identities.indexOf('赵新') !== -1,
      { panel_hidden: added.panel_hidden, msg_hidden: added.msg_hidden, msg: added.msg, identities: added.identities.length });
    const propagation = await page.evaluate(() => ({
      identity_select: Array.from(document.getElementById('identity-select').options).map((o) => o.value),
      owner_filter: Array.from(document.getElementById('owner-filter').options).map((o) => o.value),
      row_owner_options: Array.from(document.querySelector('#wbs-body tr td[data-field="owner"] select').options).map((o) => o.value)
    }));
    check('矩阵6f 新增人员立即出现在身份切换 / 负责人下拉 / 筛选下拉',
      propagation.identity_select.indexOf('赵新') !== -1 && propagation.owner_filter.indexOf('赵新') !== -1 && propagation.row_owner_options.indexOf('赵新') !== -1,
      { select: propagation.identity_select.length, filter: propagation.owner_filter.length, row: propagation.row_owner_options.length });
    const persisted = (await api('/api/wbs')).body;
    check('矩阵6g 新增人员已落盘 wbs.json（可通过 API / 磁盘复核）',
      persisted.identities.indexOf('赵新') !== -1 && diskDoc().identities.indexOf('赵新') !== -1, persisted.identities);

    /* ---------- 矩阵14（CH-7）：新增人员写 identity_added 审计 + 日报数据源含该行（导出已不含当日变更 sheet） ---------- */
    const auditEntries = fs.readFileSync(path.join(DATA_DIR, 'audit.log'), 'utf8').trim().split('\n')
      .map((line) => { try { return JSON.parse(line); } catch (e) { return null; } }).filter(Boolean);
    const identityAdds = auditEntries.filter((e) => e && e.type === 'identity_added');
    const zhaoAdds = identityAdds.filter((e) => e.name === '赵新');
    check('矩阵14a（CH-7）新增人员写入 identity_added 审计（identity=操作身份 / name=新增姓名 / at=时间）',
      zhaoAdds.length === 1 && zhaoAdds[0].identity === '项目负责人' && typeof zhaoAdds[0].at === 'string' &&
      Date.parse(zhaoAdds[0].at) > 0 && identityAdds.every((e) => e.name !== '王言'),
      { entries: identityAdds.length, sample: zhaoAdds[0] });

    const addHistory = (await api('/api/history?tz=' + encodeURIComponent(TZ) + '&date=' + today())).body;
    const addEvents = (addHistory.records || []).filter((r) => r.field === '人员池' && r.new === '赵新');
    check('矩阵14b（CH-7）GET /api/history 返回新增人员事件（改动字段 人员池、旧值空、新值姓名、操作身份照实）',
      addEvents.length === 1 && addEvents[0].old === '' && addEvents[0].task === '新增人员 赵新' && addEvents[0].identity === '项目负责人',
      addEvents[0]);

    /* CH-12：当日变更 sheet 已从日报导出移除，CH-7 新增人员行改由 /api/daily 的 changes 数据 + /api/history 保留。 */
    /* CH-13：日报改为文本弹层（只含阻塞、延期）；CH-7 新增人员行仍留在服务端审计/数据源。 */
    const dailyApi2 = (await api('/api/daily?tz=' + encodeURIComponent(TZ) + '&date=' + today())).body;
    const poolChanges = (dailyApi2.changes || []).filter((row) => row.field === '人员池');
    const addChange = poolChanges.find((row) => row.new === '赵新');
    const daily2 = await openDaily();
    check('矩阵14c（CH-7）CH-7 新增人员行仍在服务端审计/日报数据源中（改动字段=人员池 / 旧值空 / 新值=姓名 / 操作身份照实），且不出现在日报弹层（CH-13 起只含阻塞、延期）',
      !!addChange && addChange.old === '' && addChange.task === '新增人员 赵新' && addChange.identity === '项目负责人' &&
      poolChanges.length === 1 && daily2.view.text.indexOf('赵新') === -1 && daily2.view.text.indexOf('人员池') === -1 &&
      daily2.view.text === daily2.api.text.body,
      { change: addChange, text: daily2.view.text.split('\n').slice(0, 2) });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('daily-panel').hidden === true, null, { timeout: 15000 });

    await page.click('#home-btn');
    await page.waitForTimeout(400);
    const homeState = await page.evaluate(() => ({
      layer_display: getComputedStyle(document.getElementById('identity-layer')).display,
      wb_hidden: document.getElementById('workbench').hidden,
      add_entry_visible: !document.getElementById('identity-add').hidden,
      identities: Array.from(document.querySelectorAll('#identity-list .identity-btn')).map((b) => b.getAttribute('data-identity'))
    }));
    check('矩阵6h 返回首页后身份列表同步（含新增人员）且入口可见',
      homeState.layer_display !== 'none' && homeState.wb_hidden === true && homeState.add_entry_visible === true &&
      homeState.identities.length === IDENTITIES.length + 1 && homeState.identities.indexOf('赵新') !== -1,
      { n: homeState.identities.length, entry: homeState.add_entry_visible });
    await page.getByRole('button', { name: /赵新/ }).click();
    await page.waitForTimeout(500);
    const newIdentitySession = await page.evaluate(() => ({
      identity_select: document.getElementById('identity-select').value,
      session: document.getElementById('session-status').textContent,
      rows: document.querySelectorAll('#wbs-body tr').length
    }));
    check('矩阵6i 返回首页后可用新增身份重进工作台（列表同步、会话一致）',
      newIdentitySession.identity_select === '赵新' && newIdentitySession.session.indexOf('赵新') !== -1 && newIdentitySession.rows > 0,
      newIdentitySession);
    await page.screenshot({ path: path.join(OUTDIR, 'identity-layer-after-add.png') });

    /* ---------- 全程无错误 ---------- */
    check('全程无 pageerror', results.page_errors.length === 0, results.page_errors);
    check('全程无 console error', results.console_errors.length === 0, results.console_errors);

    results.pass = pass;
    results.fail = fail;
    results.finished_at = new Date().toISOString();
    fs.writeFileSync(path.join(OUTDIR, 'browser-results.json'), JSON.stringify(results, null, 2));
    console.log('---');
    console.log('PASS=' + pass + ' FAIL=' + fail + ' pageerrors=' + results.page_errors.length + ' consoleerrors=' + results.console_errors.length);
  } catch (err) {
    results.harness_error = err && err.stack ? err.stack : String(err);
    fs.writeFileSync(path.join(OUTDIR, 'browser-results.json'), JSON.stringify(results, null, 2));
    console.error('HARNESS_ERROR ' + (err && err.stack ? err.stack : err));
    console.log('PASS=' + pass + ' FAIL=' + (fail + 1));
    await stopServer();
    if (browser) await browser.close();
    process.exit(3);
  }
  await stopServer();
  if (browser) await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})();
