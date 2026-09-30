// YUNZ-15 回归 harness（DOM 级 / jsdom）：针对缺陷 D-1 的行为回归 + 显式编辑流程保护。
//
// 覆盖：
//   T11.* 点击「物品清单」展示态单元格（名称 / 类别 / 数量 / id）→ 进入编辑态或给出明确可见反馈；
//   T11.5 点击汇总表单元格 → 给出明确可见反馈；
//   T11.6 上述点击不得改动任何持久化数据；
//   R1.*  既有「编辑」按钮显式流程未被破坏（进入编辑态 / 保存落库 / 取消还原）；
//   R2.*  新增 / 删除确认 / 转义等既有交互仍可用（轻量冒烟）。
//
// 用法（由 run_interaction.sh 驱动）：
//   BASE_URL=<真实 app.py 服务> DATA_PATH=<该服务的数据文件> node interaction_regression.mjs
// 退出码：0 = 全部通过；1 = 有失败；2/3 = 环境或 harness 错误。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const JSDOM_BASE = process.env.JSDOM_BASE || process.cwd();
const requireFrom = createRequire(path.join(JSDOM_BASE, 'noop.js'));
const { JSDOM } = requireFrom('jsdom');

const BASE_URL = process.env.BASE_URL;
const DATA_PATH = process.env.DATA_PATH;
const DOM_SNAPSHOT = process.env.DOM_SNAPSHOT || path.join(JSDOM_BASE, 'dom-snapshot.html');
if (!BASE_URL || !DATA_PATH) {
  console.error('need BASE_URL and DATA_PATH env');
  process.exit(2);
}

const RESULTS = [];
const OBSERVED_HINTS = [];
function record(name, ok, detail) {
  RESULTS.push({ name, ok: !!ok, detail });
  const line = (ok ? 'PASS ' : 'FAIL ') + name + (detail && !ok ? ' :: ' + JSON.stringify(detail) : '');
  console.log(line);
  return !!ok;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 4000, interval = 20) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch (_e) { /* keep polling */ }
    if (Date.now() > deadline) return null;
    await sleep(interval);
  }
}

async function main() {
  const base = BASE_URL;

  const api = async (method, p, body) => {
    const init = { method, headers: {} };
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    const res = await fetch(base + p, init);
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch (_e) { parsed = null; }
    return { status: res.status, body: parsed };
  };

  const ready = await waitFor(async () => {
    try { const r = await fetch(base + '/api/health'); return r.status === 200; } catch (_e) { return false; }
  }, 15000, 50);
  record('T0 真实 app.py 服务就绪（DOM 级测试前置）', ready, { base });
  if (!ready) return;

  const pageRes = await fetch(base + '/');
  const html = await pageRes.text();
  record('T1.0 GET / 由服务返回页面且含内联脚本', pageRes.status === 200 && html.includes('items-body'));

  const confirmCalls = [];
  let confirmReturn = true;
  const dom = new JSDOM(html, {
    url: base + '/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (input, init) => fetch(new URL(String(input), base).toString(), init);
      window.confirm = (msg) => { confirmCalls.push(msg); return confirmReturn; };
    },
  });
  const win = dom.window;
  const doc = win.document;
  const $ = (sel) => doc.querySelector(sel);
  const $$ = (sel) => Array.from(doc.querySelectorAll(sel));
  const rows = () => $$('#items-body tr');
  const rowById = (id) => rows().find((r) => r.children[0] && r.children[0].textContent === id) || null;
  const messageText = () => { const m = doc.getElementById('message'); return m && !m.hidden ? m.textContent : null; };
  const hideMessage = () => { const m = doc.getElementById('message'); if (m) m.hidden = true; };
  const submitAdd = (name, category, quantity) => {
    $('#add-name').value = name;
    $('#add-category').value = category;
    $('#add-quantity').value = quantity;
    $('#add-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  };
  const apiItems = () => api('GET', '/api/items');

  const rendered = await waitFor(() => rows().length === 3, 5000);
  record('T1.1 初始 3 条数据渲染完成', !!rendered, { rows: rows().length });

  // ---------------------------------------------------------------- D-1: 物品清单展示态单元格
  const advId = 'demo-0003';
  const itemsBefore = JSON.stringify((await apiItems()).body);
  const rowSnapshotBefore = JSON.stringify(rowById(advId).innerHTML);
  hideMessage();

  const targets = [
    ['名称单元格', () => rowById(advId).children[1]],
    ['类别单元格', () => rowById(advId).children[2]],
    ['数量单元格', () => rowById(advId).children[3]],
    ['id 单元格', () => rowById(advId).children[0]],
  ];
  for (const [label, getEl] of targets) {
    hideMessage();
    getEl().click();
    await sleep(80);
    const enteredEdit = !!rowById(advId).querySelector('input[data-field]');
    const feedback = messageText();
    OBSERVED_HINTS.push('物品清单·' + label + ' -> ' + (enteredEdit ? '进入编辑态' : '反馈=' + JSON.stringify(feedback)));
    record('T11 点击「物品清单 · ' + label + '」→ 进入编辑态或给出明确可见反馈',
      enteredEdit || !!feedback, { enteredEdit, feedback, hint: '缺陷 D-1：点了没反应' });
    if (enteredEdit) { // 若实现选择了「进入编辑态」，退出编辑态以便后续用例互不干扰
      const cancel = rowById(advId).querySelector('button[data-action="cancel"]');
      if (cancel) cancel.click();
      await sleep(60);
    }
  }

  // ---------------------------------------------------------------- D-1: 汇总表单元格
  const sumRow = $$('#summary-body tr')[0];
  record('T11.4 汇总表已渲染（用于点击对抗）', !!sumRow, { summaryRows: $$('#summary-body tr').length });
  if (sumRow) {
    for (const [ci, label] of [[0, '类别'], [1, '合计数量']]) {
      hideMessage();
      sumRow.children[ci].click();
      await sleep(80);
      const feedback = messageText();
      OBSERVED_HINTS.push('汇总表·' + label + ' -> 反馈=' + JSON.stringify(feedback));
      record('T11 点击「汇总表 · ' + label + '单元格」→ 给出明确可见反馈',
        !!feedback, { feedback, hint: '缺陷 D-1：汇总单元格点击无反馈' });
    }
  }

  // ---------------------------------------------------------------- D-1: 点击不得改动数据
  const itemsAfter = JSON.stringify((await apiItems()).body);
  record('T11.6 点击展示态单元格不产生任何数据写入', itemsAfter === itemsBefore,
    { changed: itemsAfter !== itemsBefore });
  record('T11.7 点击展示态单元格不改变展示行结构（在未进入编辑态的实现下）',
    JSON.stringify(rowById(advId).innerHTML) === rowSnapshotBefore || !!rowById(advId).querySelector('input[data-field]'),
    { before: rowSnapshotBefore, after: JSON.stringify(rowById(advId).innerHTML) });

  // ---------------------------------------------------------------- R1: 既有显式编辑流程未被破坏
  hideMessage();
  rowById(advId).querySelector('button[data-action="edit"]').click();
  const editInputs = await waitFor(() => rowById(advId).querySelectorAll('input[data-field]').length === 3, 2000);
  record('R1.1 「编辑」按钮仍能进入编辑态（三字段可编辑）', !!editInputs,
    { inputs: rowById(advId).querySelectorAll('input[data-field]').length });

  if (editInputs) {
    const nameInput = rowById(advId).querySelector('input[data-field="name"]');
    nameInput.value = '电池(改)';
    hideMessage();
    rowById(advId).querySelector('button[data-action="save"]').click();
    const savedMsg = await waitFor(() => messageText() === '已保存修改', 3000);
    const afterSave = await api('GET', '/api/items/' + advId);
    record('R1.2 编辑保存后页面提示且 API 落库一致',
      !!savedMsg && afterSave.status === 200 && afterSave.body.name === '电池(改)',
      { msg: messageText(), api: afterSave.body && afterSave.body.name });
    // 还原
    await api('PUT', '/api/items/' + advId, { name: '电池' });
    $('#refresh').click();
    await waitFor(() => !!(rowById(advId) && rowById(advId).children[1].textContent.trim() === '电池'), 3000);
  }

  hideMessage();
  rowById(advId).querySelector('button[data-action="edit"]').click();
  await waitFor(() => rowById(advId).querySelector('input[data-field="name"]'), 2000);
  const cancelBtn = rowById(advId).querySelector('button[data-action="cancel"]');
  if (cancelBtn) cancelBtn.click();
  await sleep(80);
  record('R1.3 「取消」仍能退出编辑态且不落库',
    !rowById(advId).querySelector('input[data-field]') && rowById(advId).children[1].textContent.trim() === '电池',
    { name: rowById(advId).children[1].textContent.trim() });

  // ---------------------------------------------------------------- R2: 其余既有交互冒烟
  hideMessage();
  const rowsBeforeAdd = rows().length;
  submitAdd('回归香蕉', '食品', '4');
  const added = await waitFor(() => rows().length === rowsBeforeAdd + 1, 5000);
  const addedApi = added ? (await apiItems()).body.items.find((i) => i.name === '回归香蕉') : null;
  record('R2.1 新增仍可用（页面 + API 双端一致）', !!added && !!addedApi, { added: !!added, api: addedApi });
  if (addedApi) {
    await api('DELETE', '/api/items/' + addedApi.id);
    hideMessage();
    $('#refresh').click();
    await waitFor(() => rows().length === rowsBeforeAdd, 3000);
  }

  hideMessage();
  const delBefore = rows().length;
  confirmReturn = false; // 取消确认框
  rowById('demo-0002').querySelector('button[data-action="delete"]').click();
  await sleep(150);
  record('R2.2 删除确认框仍弹出，取消后不删除',
    confirmCalls.length >= 1 && !!rowById('demo-0002') && rows().length === delBefore, confirmCalls);
  confirmReturn = true;

  hideMessage();
  const rowsBeforeInj = rows().length;
  submitAdd('<b>粗体</b>', '测试', '2');
  const injAdded = await waitFor(() => rows().length === rowsBeforeInj + 1, 5000);
  const injRow = rows().find((r) => r.children[1] && r.children[1].textContent.includes('<b>'));
  record('R2.3 名称含 HTML 仍被转义为纯文本（无注入）',
    !!injAdded && !!injRow && injRow.children[1].querySelector('b') === null,
    { html: injRow ? injRow.children[1].innerHTML : null });

  fs.writeFileSync(DOM_SNAPSHOT, doc.documentElement.outerHTML, 'utf8');

  console.log('');
  console.log('OBSERVED_HINTS:');
  for (const h of OBSERVED_HINTS) console.log('  ' + h);

  const passed = RESULTS.filter((r) => r.ok).length;
  const failed = RESULTS.filter((r) => !r.ok);
  console.log('');
  console.log(`INTERACTION ${passed}/${RESULTS.length} PASSED`);
  for (const f of failed) console.log('FAILED: ' + f.name + ' :: ' + JSON.stringify(f.detail));
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => { console.error('HARNESS ERROR', err); process.exit(3); });
