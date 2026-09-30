// YUNZ-14 独立复验：交互级（DOM 级）验证 harness。
// 用 Node(v24) + jsdom 构造真实 DOM、执行交付页面 index.html 的内联脚本，
// 通过注入的 fetch shim 直连真实 app.py 服务，逐步模拟用户操作，
// 每步后用 /api 核对持久化结果与页面显示是否一致。
//
// 用法：BASE_URL=<已运行的服务> DATA_PATH=<服务数据文件> node interactive_verify.mjs
// 说明：由独立验证工程师（AI-QV）自研，不复用被验证方脚本。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const JSDOM_BASE = process.env.JSDOM_BASE || process.cwd();
const requireFrom = createRequire(path.join(JSDOM_BASE, 'noop.js'));
const { JSDOM } = requireFrom('jsdom');

const BASE_URL = process.env.BASE_URL;
const DATA_PATH = process.env.DATA_PATH;
const DOM_SNAPSHOT = process.env.DOM_SNAPSHOT || path.join(JSDOM_BASE, 'interactive-dom-snapshot.html');
if (!BASE_URL || !DATA_PATH) {
  console.error('need BASE_URL and DATA_PATH env');
  process.exit(2);
}

const RESULTS = [];
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
    try { const v = fn(); if (v) return v; } catch (_e) { /* keep polling */ }
    if (Date.now() > deadline) return null;
    await sleep(interval);
  }
}

async function main() {
  const base = BASE_URL;
  const dataPath = DATA_PATH;

  const api = async (method, p, body) => {
    const init = { method, headers: {} };
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    const res = await fetch(base + p, init);
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch (_e) { parsed = null; }
    return { status: res.status, body: parsed };
  };

  try {
    const ready = await waitFor(async () => {
      try { const r = await fetch(base + '/api/health'); return r.status === 200; } catch (_e) { return false; }
    }, 15000, 50);
    record('T0 真实 app.py 服务就绪（交互级测试前置）', ready, { base });
    if (!ready) return;

    // 从真实服务取页面（而非直接读盘），保证测的是服务实际下发的页面
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
    const cellText = (row, idx) => (row && row.children[idx] ? row.children[idx].textContent.trim() : null);
    const messageText = () => { const m = doc.getElementById('message'); return m && !m.hidden ? m.textContent : null; };
    const hideMessage = () => { const m = doc.getElementById('message'); if (m) m.hidden = true; };
    const submitAdd = (name, category, quantity) => {
      $('#add-name').value = name;
      $('#add-category').value = category;
      $('#add-quantity').value = quantity;
      $('#add-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    };

    const rendered = await waitFor(() => rows().length === 3, 5000);
    record('T1.1 页面加载后渲染既有 3 条数据', !!rendered, { rows: rows().length });
    const itemsApi = (await api('GET', '/api/items')).body.items;
    const sumApi = (await api('GET', '/api/summary')).body.summary;
    const domOk = itemsApi.length === 3 && itemsApi.every((it) => {
      const r = rowById(it.id);
      return r && cellText(r, 1) === it.name && cellText(r, 2) === it.category && String(cellText(r, 3)) === String(it.quantity);
    });
    record('T1.2 页面「名称/类别/数量」单元格与 /api/items 双端一致', domOk);
    record('T1.3 条目计数徽标显示「3 条」', ($('#item-count').textContent || '').trim() === '3 条', $('#item-count').textContent);
    const sumDom = $$('#summary-body tr').map((r) => [r.children[0].textContent.trim(), r.children[1].textContent.trim()]);
    const sumExpected = sumApi.map((e) => [e.category, String(e.total_quantity)]);
    record('T1.4 汇总表与 /api/summary 双端一致', JSON.stringify(sumDom.slice().sort()) === JSON.stringify(sumExpected.slice().sort()), { sumDom, sumExpected });

    // T2 新增
    submitAdd('香蕉', '食品', '4');
    const added = await waitFor(() => rows().length === 4, 5000);
    const itemsAfterAdd = (await api('GET', '/api/items')).body.items;
    const banana = itemsAfterAdd.find((i) => i.name === '香蕉');
    record('T2.1 新增后页面多出 1 行且 API 已持久化', !!added && !!banana && banana.category === '食品' && banana.quantity === 4, { added: !!added, banana });
    record('T2.2 新增后页面显示与 API 一致', !!banana && cellText(rowById(banana.id), 1) === '香蕉' && cellText(rowById(banana.id), 2) === '食品' && cellText(rowById(banana.id), 3) === '4');
    const sumAfterAdd = (await api('GET', '/api/summary')).body.summary;
    const foodSum = (sumAfterAdd.find((e) => e.category === '食品') || {}).total_quantity;
    const foodSumDom = $$('#summary-body tr').filter((r) => r.children[0].textContent.trim() === '食品').map((r) => r.children[1].textContent.trim())[0];
    record('T2.3 新增后汇总（食品=7）双端一致', foodSum === 7 && foodSumDom === '7', { foodSum, foodSumDom });
    record('T2.4 新增成功后名称输入框被清空', $('#add-name').value === '', $('#add-name').value);

    // T3 编辑名称（通过页面提供的编辑入口）
    const target = 'demo-0001';
    rowById(target).querySelector('button[data-action="edit"]').click();
    const inEdit = await waitFor(() => rowById(target).querySelector('input[data-field="name"]'), 3000);
    record('T3.1 点击「编辑」进入编辑态（出现三个字段输入框）', !!inEdit && !!rowById(target).querySelector('input[data-field="category"]') && !!rowById(target).querySelector('input[data-field="quantity"]'));
    rowById(target).querySelector('input[data-field="name"]').value = '鲜牛奶';
    rowById(target).querySelector('button[data-action="save"]').click();
    const nameSaved = await waitFor(() => cellText(rowById(target), 1) === '鲜牛奶', 5000);
    const apiName = (await api('GET', '/api/items/' + target)).body;
    record('T3.2 编辑「名称」保存后 页面显示=API=「鲜牛奶」', !!nameSaved && apiName.name === '鲜牛奶', { nameSaved: !!nameSaved, apiName });

    // T4 编辑类别
    rowById(target).querySelector('button[data-action="edit"]').click();
    await waitFor(() => rowById(target).querySelector('input[data-field="category"]'), 3000);
    rowById(target).querySelector('input[data-field="category"]').value = '饮品';
    rowById(target).querySelector('button[data-action="save"]').click();
    const catSaved = await waitFor(() => cellText(rowById(target), 2) === '饮品', 5000);
    const apiCat = (await api('GET', '/api/items/' + target)).body;
    record('T4.1 编辑「类别」保存后 页面显示=API=「饮品」', !!catSaved && apiCat.category === '饮品', { catSaved: !!catSaved, apiCat });

    // T5 编辑数量
    rowById(target).querySelector('button[data-action="edit"]').click();
    await waitFor(() => rowById(target).querySelector('input[data-field="quantity"]'), 3000);
    rowById(target).querySelector('input[data-field="quantity"]').value = '12';
    rowById(target).querySelector('button[data-action="save"]').click();
    const qtySaved = await waitFor(() => cellText(rowById(target), 3) === '12', 5000);
    const apiQty = (await api('GET', '/api/items/' + target)).body;
    record('T5.1 编辑「数量」保存后 页面显示=API=12', !!qtySaved && apiQty.quantity === 12, { qtySaved: !!qtySaved, apiQty });
    record('T5.2 编辑保存后条目额外字段 manual_note 在文件中保留',
      (JSON.parse(fs.readFileSync(dataPath, 'utf8')).items.find((i) => i.id === target) || {}).manual_note === '保留我');
    record('T5.3 三个字段编辑后页面仍只显示契约字段（无残留输入框）',
      !rowById(target).querySelector('input[data-field]') && rowById(target).querySelector('button[data-action="edit"]') !== null);

    // T6 编辑取消
    rowById(target).querySelector('button[data-action="edit"]').click();
    await waitFor(() => rowById(target).querySelector('input[data-field="name"]'), 3000);
    rowById(target).querySelector('input[data-field="name"]').value = '不该保存的名字';
    rowById(target).querySelector('button[data-action="cancel"]').click();
    const cancelled = await waitFor(() => !rowById(target).querySelector('input[data-field]'), 3000);
    const apiAfterCancel = (await api('GET', '/api/items/' + target)).body;
    record('T6.1 编辑取消后回到展示态且 API 未被改写',
      !!cancelled && apiAfterCancel.name === '鲜牛奶' && cellText(rowById(target), 1) === '鲜牛奶', { cancelled: !!cancelled, apiAfterCancel });

    // T7 删除（确认）
    confirmReturn = true;
    const delId = 'demo-0002';
    rowById(delId).querySelector('button[data-action="delete"]').click();
    const removed = await waitFor(() => !rowById(delId), 5000);
    const delApi = await api('GET', '/api/items/' + delId);
    record('T7.1 删除（确认）后页面移除该行且 API 返回 404', !!removed && delApi.status === 404, { removed: !!removed, delApi });
    record('T7.2 删除前弹出确认框', confirmCalls.length >= 1, confirmCalls);

    // T8 删除取消确认
    confirmReturn = false;
    const keepId = 'demo-0003';
    rowById(keepId).querySelector('button[data-action="delete"]').click();
    await sleep(300);
    const stillThere = await api('GET', '/api/items/' + keepId);
    record('T8.1 删除确认框取消后不删除', !!rowById(keepId) && stillThere.status === 200, { stillThere: stillThere.status });
    confirmReturn = true;

    // T9 空输入
    hideMessage();
    submitAdd('', '食品', '1');
    let msg = await waitFor(() => messageText(), 1500);
    record('T9.1 空名称提交被拦截并给出错误提示', msg === '名称不能为空', { msg });
    hideMessage();
    submitAdd('测试品', '', '1');
    msg = await waitFor(() => messageText(), 1500);
    record('T9.2 空类别提交被拦截并给出错误提示', msg === '类别不能为空', { msg });

    // T10 非法输入
    hideMessage();
    submitAdd('测试品', '食品', 'abc');
    msg = await waitFor(() => messageText(), 1500);
    const qtyInputValue = $('#add-quantity').value;
    record('T10.1 非法数量提交被拦截并给出明确提示', !!msg && (msg.includes('数量') || msg.includes('整数')), { msg, qtyInputValue });

    // T11 典型用户路径对抗：直接点击展示字段/单元格，检查是否进入编辑态或给出反馈
    hideMessage();
    const advId = 'demo-0003';
    const before = JSON.stringify(rowById(advId).innerHTML);
    const advTargets = [
      ['名称单元格', rowById(advId).children[1]],
      ['类别单元格', rowById(advId).children[2]],
      ['数量单元格', rowById(advId).children[3]],
      ['id 单元格', rowById(advId).children[0]],
    ];
    for (const [label, el] of advTargets) {
      el.click();
      await sleep(60);
      const enteredEdit = !!rowById(advId).querySelector('input[data-field]');
      const feedback = messageText();
      record('T11 直接点击「' + label + '」不进入编辑态也无任何提示（可发现性/反馈问题）', enteredEdit || !!feedback,
        { enteredEdit, feedback, hint: '点击展示字段无反应' });
    }
    // 汇总行单元格
    const sumRow = $$('#summary-body tr')[0];
    if (sumRow) {
      sumRow.children[0].click();
      await sleep(60);
      record('T11 直接点击「汇总行单元格」不进入编辑态也无任何提示',
        !!messageText() || !!$('input[data-field]'), { feedback: messageText(), hint: '汇总行不可交互且无反馈' });
    }
    record('T11.x 点击展示单元格不应改动任何数据/结构', JSON.stringify(rowById(advId).innerHTML) === before);

    // T12 刷新按钮
    hideMessage();
    $('#refresh').click();
    const refreshed = await waitFor(() => messageText() === '已刷新', 3000);
    record('T12.1 「刷新」按钮可用并给出反馈', !!refreshed, { msg: messageText() });

    // T13 注入/转义对抗：名称含 HTML 时不得被当作 HTML 渲染
    hideMessage();
    const rowsBeforeInj = rows().length;
    submitAdd('<b>粗体</b>', '测试', '2');
    const injAdded = await waitFor(() => rows().length === rowsBeforeInj + 1, 5000);
    const injRow = rows().find((r) => r.children[1] && r.children[1].textContent.includes('<b>'));
    record('T13.1 名称含 HTML 时被转义为纯文本（无注入）',
      !!injAdded && !!injRow && injRow.children[1].querySelector('b') === null, { injAdded: !!injAdded, html: injRow ? injRow.children[1].innerHTML : null });
    const injApi = (await api('GET', '/api/items')).body.items.find((i) => i.name === '<b>粗体</b>');
    record('T13.2 含 HTML 的名称经 API 原样保存', !!injApi, injApi);

    fs.writeFileSync(DOM_SNAPSHOT, doc.documentElement.outerHTML, 'utf8');
  } finally {
    /* 服务由外部 driver 负责启停，这里不做处理 */
  }

  const passed = RESULTS.filter((r) => r.ok).length;
  const failed = RESULTS.filter((r) => !r.ok);
  console.log('');
  console.log(`INTERACTIVE ${passed}/${RESULTS.length} PASSED`);
  for (const f of failed) console.log('FAILED: ' + f.name + ' :: ' + JSON.stringify(f.detail));
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => { console.error('HARNESS ERROR', err); process.exit(3); });
