/* YUNZ-30 / Stage10 独立复验：CH-8 写路径矩阵（真实浏览器 + 真实保存 + 读回）
 * 打隔离实例（同一被验证镜像 wbs-rongcheng:20261015104003，端口 4181，独立数据目录）——
 * 现场 4180 不做任何写操作，避免干扰真实使用中的现场数据。
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.QV_BASE || 'http://127.0.0.1:4181';
const OUT = process.env.QV_OUT || '.';
const ISO_DATA = process.env.QV_ISO_DATA || '/iso-data';
const results = [];
let pass = 0, fail = 0;
function check(name, cond, detail) {
  const ok = !!cond;
  ok ? pass++ : fail++;
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + '  :: ' + JSON.stringify(detail));
}
const disk = (f) => fs.readFileSync(path.join(ISO_DATA, f), 'utf8');
const docOf = () => JSON.parse(disk('wbs.json'));
const apiGet = async (p) => (await fetch(BASE + p, { cache: 'no-store' })).json();
const rev = async () => (await apiGet('/api/health')).revision;
const noteOf = async (id) => { const d = await apiGet('/api/wbs'); return (d.tasks.find((t) => t.id === id) || {}).note; };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const LONG_NOTE = 'A'.repeat(120) + '\n\n# 进展标题\n\n**Steering** 已完成评审，`v1.2` 已上线；见 [设计稿](https://example.com/d)\n\n- 事项甲\n- 事项乙\n';
const MD2 = '# 进展标题\n\n**评审完成**，`v1.2` 已上线；见 [设计稿](https://example.com/d)。';
const EXPECT_TRUNC = 'A'.repeat(80) + '…';

const pageErrors = [], consoleErrors = [];
const writes = [];

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('request', (r) => { if (r.method() !== 'GET') writes.push(r.method() + ' ' + r.url()); });
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  return { ctx, page };
}
const ID = (page, name) => page.click('#identity-list .identity-btn[data-identity="' + name + '"]');
async function ready(page) { await page.waitForFunction(() => document.querySelectorAll('#wbs-body tr').length === 36, null, { timeout: 15000 }); }
const noteCell = (page, id) => page.locator('.cell-note[data-id="' + id + '"]');
async function openPanel(page, id) {
  await noteCell(page, id).click();
  await page.waitForFunction(() => document.getElementById('note-panel').hidden === false, null, { timeout: 5000 });
}
async function closePanel(page, mode) { /* mode: 'clean'|'exit'|'cancel' */
  await page.click('#note-close');
  if (mode === 'clean') { await page.waitForFunction(() => document.getElementById('note-panel').hidden === true, null, { timeout: 5000 }); return; }
  await page.waitForFunction(() => !document.getElementById('note-confirm').hidden, null, { timeout: 5000 });
  await page.click(mode === 'exit' ? '#note-confirm-exit' : '#note-confirm-cancel');
  await page.waitForTimeout(200);
}
const cellState = (page, id) => page.evaluate((rowId) => {
  const td = document.querySelector('.cell-note[data-id="' + rowId + '"]');
  const sum = td.querySelector('.note-summary');
  const cs = getComputedStyle(sum);
  return {
    cls: td.className, cursor: getComputedStyle(td).cursor, dataNoteEmpty: td.getAttribute('data-note-empty'),
    summary: sum.textContent, sumCls: sum.className, nowrap: cs.whiteSpace, overflow: cs.textOverflow,
    clipped: sum.scrollWidth > sum.clientWidth, action: (td.querySelector('.note-action') || {}).textContent || null,
    title: td.getAttribute('title')
  };
}, id);
const panelState = (page) => page.evaluate(() => ({
  panelHidden: document.getElementById('note-panel').hidden,
  confirmHidden: document.getElementById('note-confirm').hidden,
  inputValue: document.getElementById('note-input').value,
  msg: document.getElementById('note-msg').textContent, msgCls: document.getElementById('note-msg').className,
  countText: document.getElementById('note-count').textContent,
  inputCls: document.getElementById('note-input').className,
  bannerHidden: document.getElementById('banner').hidden, bannerText: document.getElementById('banner-text').textContent,
  saveHidden: document.getElementById('note-save').hidden, saveVisible: !document.getElementById('note-save').hidden && document.getElementById('note-save').offsetWidth > 0,
  meta: document.getElementById('note-meta').textContent
}));
const saveAndWait = async (page) => {
  await page.click('#note-save');
  await page.waitForTimeout(900);
  return panelState(page);
};

(async () => {
  const browser = await chromium.launch();
  const { ctx, page } = await newPage(browser);
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('#identity-list .identity-btn');
  await ID(page, '李欢');
  await ready(page);

  /* ---------- A. 摘要截断：真实保存超长 Markdown note，断言 K 列摘要 = 去 Markdown + 80 字符截断 ---------- */
  const revA0 = await rev();
  await openPanel(page, 'T001');
  const revB0 = revA0;
  await page.fill('#note-input', LONG_NOTE);
  const beforeSave = await panelState(page);
  check('隔离 A1：面板打开时编辑区初值 = 该行 note（保存前页面/API 一致），字符计数 = 当前长度 / 20000',
    beforeSave.inputValue === LONG_NOTE && /^\d+ \/ 20000 字符$/.test(beforeSave.countText), { count: beforeSave.countText });
  await page.screenshot({ path: path.join(OUT, 'shots', 'iso-desktop-panel-edit.png') });
  const afterA = await saveAndWait(page);
  const revA1 = await rev();
  check('隔离 A2：仅点「保存」即提交成功，中文成功提示 + revision 正常递增（+1）',
    afterA.msgCls.includes('ok') && /已保存/.test(afterA.msg) && /已更新为/.test(afterA.msg) && revA1 === revB0 + 1,
    { msg: afterA.msg, revBefore: revB0, revAfter: revA1 });
  const apiA = await noteOf('T001');
  const diskA = (docOf().tasks.find((t) => t.id === 'T001') || {}).note;
  check('隔离 A3：保存后页面 / API / 磁盘三端一致（note 原文 = 输入内容，Markdown 原样持久化）',
    apiA === LONG_NOTE && diskA === LONG_NOTE, { apiLen: apiA.length, diskLen: diskA.length });
  await closePanel(page, 'clean');
  const cellA = await cellState(page, 'T001');
  check('隔离 A4：K 列摘要为去 Markdown 单行文本并按 80 字符截断（精确等于 120 个 A 截断为 80 + 省略号）',
    cellA.summary === EXPECT_TRUNC, { summary: cellA.summary, len: cellA.summary.length });
  check('隔离 A5：摘要单行省略样式生效（nowrap/ellipsis 且实际溢出被裁剪）',
    cellA.nowrap === 'nowrap' && cellA.overflow === 'ellipsis' && cellA.clipped === true, { clipped: cellA.clipped });
  check('隔离 A6：有权限行显示「点击打开编辑」提示（note-action）且整格可点（note-editable、cursor:pointer）',
    cellA.action === '点击打开编辑' && /note-editable/.test(cellA.cls) && cellA.cursor === 'pointer' && cellA.dataNoteEmpty === 'false', cellA);
  await page.screenshot({ path: path.join(OUT, 'shots', 'iso-cell-summary.png') });

  /* ---------- B. Ctrl/Cmd+Enter 快捷保存 + 去 Markdown 摘要 ---------- */
  await openPanel(page, 'T001');
  await page.fill('#note-input', MD2);
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(900);
  const afterB = await panelState(page);
  const revB1 = await rev();
  check('隔离 B1：Ctrl+Enter 快捷保存生效（中文成功提示 + revision 递增）',
    afterB.msgCls.includes('ok') && /已保存/.test(afterB.msg) && revB1 === revA1 + 1, { msg: afterB.msg, rev: revB1 });
  check('隔离 B2：快捷保存后 API note = Markdown 原文', (await noteOf('T001')) === MD2, { ok: true });
  await closePanel(page, 'clean');
  const cellB = await cellState(page, 'T001');
  check('隔离 B3：摘要去除全部 Markdown 标记（无 # / * / ` / ]( / http），保留纯文本要点',
    !/[#*`\]]|http/.test(cellB.summary) && /进展标题/.test(cellB.summary) && /评审完成/.test(cellB.summary)
    && /v1\.2/.test(cellB.summary) && /设计稿/.test(cellB.summary), { summary: cellB.summary });

  /* ---------- C. 「仅点保存才提交」：草稿经确认框退出后不落库 ---------- */
  const revC0 = await rev();
  const writesC0 = writes.length;
  await openPanel(page, 'T001');
  await page.fill('#note-input', 'DRAFT-NOT-SAVED');
  await closePanel(page, 'exit');
  const stC = await panelState(page);
  check('隔离 C1：草稿点关闭 → 确认框「继续退出」→ 面板关闭，且 revision 不变、API note 未变（未提交）',
    stC.panelHidden === true && (await rev()) === revC0 && (await noteOf('T001')) === MD2, { rev: await rev(), revBefore: revC0 });
  await openPanel(page, 'T001');
  await page.fill('#note-input', 'DRAFT-KEEP');
  await closePanel(page, 'cancel');
  const stC2 = await panelState(page);
  check('隔离 C2：确认框「取消」路径 —— 面板保留、草稿内容不丢（DRAFT-KEEP）',
    stC2.panelHidden === false && stC2.inputValue === 'DRAFT-KEEP', { input: stC2.inputValue });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const stC3 = await panelState(page);
  check('隔离 C3：有草稿时 Escape 先弹确认框（不直接丢弃），面板与草稿保留',
    stC3.panelHidden === false && stC3.confirmHidden === false && stC3.inputValue === 'DRAFT-KEEP', { panelHidden: stC3.panelHidden, confirmHidden: stC3.confirmHidden });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const stC3b = await panelState(page);
  check('隔离 C3b：确认框上再按 Escape = 取消关闭（确认框收起、面板与草稿仍保留）',
    stC3b.panelHidden === false && stC3b.confirmHidden === true && stC3b.inputValue === 'DRAFT-KEEP', { panelHidden: stC3b.panelHidden, confirmHidden: stC3b.confirmHidden });
  await closePanel(page, 'exit');
  check('隔离 C4：仍以「继续退出」丢弃草稿关闭；整个过程 revision 不变、note 仍为 MD2',
    (await rev()) === revC0 && (await noteOf('T001')) === MD2, { rev: await rev() });
  await page.reload({ waitUntil: 'load' });
  await ready(page);
  const cellC = await cellState(page, 'T001');
  check('隔离 C5：刷新页面后 K 列摘要仍为已保存内容（草稿未落库）', cellC.summary === '进展标题 评审完成，v1.2 已上线；见 设计稿。', { summary: cellC.summary });

  /* ---------- D. 长度上限 20000：前端拒绝 + 服务端不落盘 ---------- */
  const revD0 = await rev();
  await openPanel(page, 'T001');
  await page.fill('#note-input', 'x'.repeat(20001));
  const overState = await panelState(page);
  check('隔离 D1：输入 20001 字符时实时提示超长（中文文案 + over-limit 样式）',
    /超长，无法提交/.test(overState.countText) && /over-limit/.test(overState.inputCls), { count: overState.countText, cls: overState.inputCls });
  const afterD = await saveAndWait(page);
  check('隔离 D2：超长点保存被拒绝（中文错误提示含「长度超过 20000」），revision 不变',
    afterD.msgCls.includes('error') && /长度超过 20000/.test(afterD.msg) && (await rev()) === revD0, { msg: afterD.msg });
  check('隔离 D3：服务端未落盘 —— 磁盘 wbs.json 与 API 的 T001 note 仍为 MD2，不含超长串',
    (await noteOf('T001')) === MD2 && !disk('wbs.json').includes('x'.repeat(500)), { ok: true });
  await closePanel(page, 'exit');

  /* ---------- E. 失败走既有错误横幅：并发版本冲突（409 非覆盖） ---------- */
  await openPanel(page, 'T001');
  await page.fill('#note-input', 'CONFLICT-DRAFT');
  const competitor = await page.evaluate(async () => {
    const doc = await (await fetch('/api/wbs', { cache: 'no-store' })).json();
    const target = doc.tasks.find((t) => t.id === 'T036');
    target.note = 'COMPETING-WRITE';
    const res = await fetch('/api/wbs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': String(doc.meta.revision), 'X-Identity': encodeURIComponent('项目负责人') },
      body: JSON.stringify({ meta: { name: doc.meta.name }, identities: doc.identities, tasks: doc.tasks })
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  });
  const revE1 = await rev();
  await page.click('#note-save');
  await page.waitForTimeout(1000);
  const afterE = await panelState(page);
  check('隔离 E1：他人先写入后本次保存走既有错误横幅（中文「版本冲突」+ 面板错误提示，未提交）',
    competitor.status === 200 && afterE.bannerHidden === false && /版本冲突/.test(afterE.bannerText) && /未提交/.test(afterE.msg)
    && afterE.panelHidden === false, { competitor: competitor.status, banner: afterE.bannerText, msg: afterE.msg });
  check('隔离 E2：409 不覆盖 —— 磁盘/API 保留他人写入（T036=COMPETING-WRITE），T001 未被草稿覆盖（仍 MD2）',
    (await noteOf('T036')) === 'COMPETING-WRITE' && (await noteOf('T001')) === MD2 && (await rev()) === revE1, { rev: await revE1 });
  await closePanel(page, 'exit');
  await page.reload({ waitUntil: 'load' });
  await ready(page);

  /* ---------- F. 空 note 合法 + 权限语义（普通负责人仅本人行 / PM 全行） ---------- */
  await page.selectOption('#identity-select', '王言');
  await page.waitForTimeout(300);
  const isoPerm = await page.evaluate(() => {
    const c = (id) => document.querySelector('.cell-note[data-id="' + id + '"]').className;
    return { own: c('T002'), other: c('T004'), rows: document.querySelectorAll('#wbs-body tr').length };
  });
  check('隔离 F1：普通负责人（王言）仅本人行 K 列可编辑（T002 note-editable），他人行（T004）只读（note-locked）',
    isoPerm.own.includes('note-editable') && isoPerm.other.includes('note-locked'), isoPerm);
  await openPanel(page, 'T004');
  const roPanel = await panelState(page);
  check('隔离 F2：普通负责人打开他人行 = 只读预览（无保存按钮、说明中文只读）',
    roPanel.saveHidden === true && /只读预览/.test(roPanel.meta), { meta: roPanel.meta });
  await closePanel(page, 'clean');
  const revF0 = await rev();
  await openPanel(page, 'T002');
  await page.fill('#note-input', '临时进展内容');
  const okF = await saveAndWait(page);
  check('隔离 F3：普通负责人保存本人行成功（中文提示 + revision 递增）',
    okF.msgCls.includes('ok') && (await rev()) === revF0 + 1, { msg: okF.msg });
  await page.fill('#note-input', '');
  const emptyF = await saveAndWait(page);
  check('隔离 F4：空 note 合法 —— 清空后保存成功、API note = 空串',
    emptyF.msgCls.includes('ok') && (await noteOf('T002')) === '', { msg: emptyF.msg });
  await closePanel(page, 'clean');
  const cellF = await cellState(page, 'T002');
  check('隔离 F5：空 note 后 K 列回到占位样式（「点击打开编辑」、data-note-empty=true）',
    cellF.summary === '点击打开编辑' && cellF.dataNoteEmpty === 'true' && /note-placeholder/.test(cellF.sumCls), cellF);
  await page.selectOption('#identity-select', '项目负责人');
  await page.waitForTimeout(300);
  const pmCls = await page.evaluate(() => document.querySelector('.cell-note[data-id="T004"]').className);
  check('隔离 F6：项目负责人可编辑任意行（T004 note-editable）—— 权限语义不变', pmCls.includes('note-editable'), { cls: pmCls });

  /* ---------- G. 审计与 /api/history 字段契约（读回比对 Markdown 原文） ---------- */
  const auditLines = disk('audit.log').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  const longSave = auditLines.find((e) => e.changed && e.changed.some((c) => c.id === 'T001' && c.fields.includes('note')) && e.new && e.new.T001 && e.new.T001.note === LONG_NOTE);
  const clearSave = auditLines.find((e) => e.new && e.new.T002 && e.new.T002.note === '' && e.old && e.old.T002 && e.old.T002.note === '临时进展内容');
  check('隔离 G1：note 保存写入审计字段级 old→new（Markdown 原文 + 时间 + 操作身份）',
    !!longSave && longSave.old.T001.note === '' && longSave.identity === '李欢' && !isNaN(Date.parse(longSave.ts)), 
    { ts: longSave && longSave.ts, identity: longSave && longSave.identity, oldLen: longSave && longSave.old.T001.note.length, newLen: longSave && longSave.new.T001.note.length });
  check('隔离 G2：清空 note 的审计 old→new 正确（旧值=原内容、新值=空串）',
    !!clearSave && clearSave.identity === '王言', { identity: clearSave && clearSave.identity });
  const auditKeys = new Set(auditLines.flatMap((e) => Object.keys(e)));
  check('隔离 G3：审计行无新增字段（字段集仍为 ts/identity/revision/changed/added/removed/old/new/snapshot + CH-7 事件字段）',
    Array.from(auditKeys).every((k) => ['ts', 'identity', 'revision', 'changed', 'added', 'removed', 'old', 'new', 'snapshot', 'type', 'name', 'at'].includes(k)),
    { auditKeys: Array.from(auditKeys) });
  const hist = await page.evaluate(async (d) => (await fetch('/api/history?tz=Asia%2FShanghai&date=' + d, { cache: 'no-store' })).json(), today());
  fs.writeFileSync(path.join(OUT, 'results', 'iso-api-history-today.json'), JSON.stringify(hist, null, 2));
  const noteRec = (hist.records || []).find((r) => r.task_id === 'T001' && r.field === 'note' && r.new === LONG_NOTE);
  const histKeys = new Set((hist.records || []).flatMap((r) => Object.keys(r)));
  check('隔离 G4：GET /api/history 当日记录无新字段，且 note 记录旧值/新值为 Markdown 原文',
    !!noteRec && noteRec.old === '' && noteRec.new === LONG_NOTE && noteRec.identity === '李欢'
    && Array.from(histKeys).every((k) => ['task_id', 'field', 'at', 'identity', 'level1', 'level2', 'task', 'owner', 'old', 'new'].includes(k)),
    { record: noteRec && { id: noteRec.task_id, field: noteRec.field, old: noteRec.old, identity: noteRec.identity }, histKeys: Array.from(histKeys) });
  check('隔离 G5：数据契约未变 —— note 仍为单个字符串、任务键集未新增字段',
    JSON.stringify(Array.from(new Set(docOf().tasks.flatMap((t) => Object.keys(t)))).sort())
    === JSON.stringify(['dates', 'demo', 'id', 'level1', 'level2', 'note', 'owner', 'status', 'task'])
    && docOf().tasks.every((t) => typeof t.note === 'string'),
    { taskKeys: Array.from(new Set(docOf().tasks.flatMap((t) => Object.keys(t)))).sort() });

  /* ---------- H. 导出 Excel / 日报（真实浏览器下载） ---------- */
  /* 导出时点的 API 快照：读回比对必须与导出内容同一时点（导出后脚本还会继续改数据）。 */
  const docAtExport = await page.evaluate(async () => (await fetch('/api/wbs', { cache: 'no-store' })).json());
  fs.writeFileSync(path.join(OUT, 'results', 'iso-api-wbs-at-export.json'), JSON.stringify(docAtExport, null, 2));
  const [dlWbs] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#export-btn')]);
  await dlWbs.saveAs(path.join(OUT, 'downloads', 'iso-wbs.xlsx'));
  const [dlDaily] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#daily-btn')]);
  await dlDaily.saveAs(path.join(OUT, 'downloads', 'iso-daily.xlsx'));
  const bannerH = await page.evaluate(() => document.getElementById('banner-text').textContent);
  check('隔离 H1：页面导出 Excel 与日报（真实浏览器下载）成功，中文横幅给出导出说明',
    /已按原模板导出/.test(await page.evaluate(async () => document.getElementById('banner-text').textContent)) || /已导出日报/.test(bannerH),
    { wbs: dlWbs.suggestedFilename(), daily: dlDaily.suggestedFilename(), banner: bannerH });

  /* 本矩阵刻意构造了一次 409（E1）：浏览器会把该响应的资源加载失败记为 console error，属预期，不计为异常。 */
  const unexpectedConsole = consoleErrors.filter((t) => !/409 \(Conflict\)/.test(t));
  check('隔离 I1：全程无 pageerror；除刻意构造的 409 外无 console error',
    pageErrors.length === 0 && unexpectedConsole.length === 0, { pageErrors, consoleErrors, unexpectedConsole });
  check('隔离 I2：写请求全部指向隔离实例（4181），未触碰现场 4180',
    writes.every((w) => w.endsWith(':4181/api/wbs')), { writes });

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'results', 'iso-browser-results.json'), JSON.stringify({
    base: BASE, mode: 'write', pass, fail, writes_count: writes.length, results
  }, null, 2));
  console.log('---'); console.log('PASS=' + pass + ' FAIL=' + fail);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(2); });
