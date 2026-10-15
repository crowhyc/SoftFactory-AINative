/* YUNZ-32 / Stage12：不回归抽样（CH-1…CH-8 关键用户路径）——隔离实例 4183。 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.QV_BASE || 'http://127.0.0.1:4183';
const OUT = process.env.QV_OUT || '.';
const results = [];
let pass = 0, fail = 0;
function check(n, c, d) { const ok = !!c; ok ? pass++ : fail++; results.push({ name: n, ok, detail: d }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + '  :: ' + JSON.stringify(d === undefined ? null : d)); }
const wbs = () => fetch(BASE + '/api/wbs').then((r) => r.json());
const requests = [], pageErrors = [];
/* 通过真实 DOM 事件写入字段值（input + change），确保走 app 的既有草稿/提交逻辑 */
async function setField(page, id, field, value) {
  await page.evaluate((a) => {
    const tr = Array.from(document.querySelectorAll('#wbs-body tr')).find((t) => (t.querySelector('td.cell-id') || {}).textContent.trim() === a.id);
    const el = tr.querySelector('[data-edit-field="' + a.field + '"]');
    el.value = a.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { id, field, value });
  await page.waitForTimeout(80);
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('request', (r) => requests.push(r.method() + ' ' + r.url()));
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  const start = await wbs();
  const ids0 = start.tasks.map((t) => t.id);
  const row0 = start.tasks[0];

  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('#identity-list .identity-btn');
  await page.click('#identity-list .identity-btn[data-identity="项目负责人"]');
  await page.waitForSelector('#wbs-body tr');

  /* CH-? 搜索 / 负责人筛选（既有工作面） */
  await page.fill('#search-input', row0.task);
  await page.waitForTimeout(250);
  const searched = await page.$$eval('#wbs-body tr', (e) => e.length);
  const expectSearch = start.tasks.filter((t) => (t.task || '').indexOf(row0.task) >= 0).length;
  check('N1-01 搜索筛选按任务项收敛行数', searched === expectSearch && searched >= 1, { got: searched, expect: expectSearch });
  await page.fill('#search-input', '');
  await page.waitForTimeout(250);
  const ownerName = row0.owner;
  await page.selectOption('#owner-filter', ownerName);
  await page.waitForTimeout(250);
  const filtered = await page.$$eval('#wbs-body tr', (e) => e.length);
  const expectOwner = start.tasks.filter((t) => t.owner === ownerName).length;
  check('N1-02 负责人筛选按负责人收敛行数', filtered === expectOwner, { got: filtered, expect: expectOwner });
  await page.selectOption('#owner-filter', '');
  await page.waitForTimeout(250);

  /* CH-2 操作列：编辑入口可发现且可进出 */
  await page.click('#wbs-body tr:has(td.cell-id:text-is("' + row0.id + '")) [data-edit-row]');
  await page.waitForTimeout(200);
  const editing = await page.evaluate((id) => {
    const tr = Array.from(document.querySelectorAll('#wbs-body tr')).find((t) => (t.querySelector('td.cell-id') || {}).textContent.trim() === id);
    return { inputs: tr.querySelectorAll('input[data-edit-field], textarea[data-edit-field]').length, btn: tr.querySelector('[data-edit-row]').textContent.trim() };
  }, row0.id);
  check('N2-01 CH-2 操作列「编辑」进入行编辑态（常显编辑器出现）', editing.inputs > 0 && editing.btn === '完成', editing);
  await page.click('#wbs-body tr:has(td.cell-id:text-is("' + row0.id + '")) [data-edit-row]');
  await page.waitForTimeout(200);
  const notEditing = await page.evaluate((id) => {
    const tr = Array.from(document.querySelectorAll('#wbs-body tr')).find((t) => (t.querySelector('td.cell-id') || {}).textContent.trim() === id);
    return { textEditors: tr.querySelectorAll('input[data-edit-field="level1"], input[data-edit-field="level2"], input[data-edit-field="task"], input[data-edit-field="note"]').length,
             phaseSelects: tr.querySelectorAll('select.phase-select').length, btn: tr.querySelector('[data-edit-row]').textContent.trim() };
  }, row0.id);
  check('N2-02 CH-2 操作列「完成」退出行编辑态（文本编辑器收起，常显阶段控件保留）',
    notEditing.textEditors === 0 && notEditing.phaseSelects === 5 && notEditing.btn === '编辑', notEditing);

  /* CH-8 进展说明写入路径（Markdown 保存往返） */
  const NOTE = '## 进展说明标题\n\n**评审完成**，见 [设计稿](https://example.com/x)。\n\n- 甲\n- 乙\n\n（第 ' + (process.env.QV_RUN || '1') + ' 次复验写入）';
  await page.click('#wbs-body tr:has(td.cell-id:text-is("' + row0.id + '")) .cell-note');
  await page.waitForSelector('#note-panel:not([hidden])');
  await page.fill('#note-input', NOTE);
  await page.waitForTimeout(250);
  const preview = await page.evaluate(() => ({
    h2: document.querySelectorAll('#note-preview h2').length,
    strong: document.querySelectorAll('#note-preview strong').length,
    li: document.querySelectorAll('#note-preview li').length,
    a: document.querySelectorAll('#note-preview a[rel="noopener noreferrer"]').length
  }));
  await page.click('#note-save');
  await page.waitForFunction(() => /进展说明已保存|冲突|失败/.test(document.getElementById('banner-text').textContent), null, { timeout: 15000 });
  const banner = await page.$eval('#banner-text', (e) => e.textContent);
  await page.click('#note-close');
  await page.waitForFunction(() => document.getElementById('note-panel').hidden, null, { timeout: 10000 });
  const afterNote = await wbs();
  const n0 = afterNote.tasks.find((t) => t.id === row0.id).note;
  check('N3-01 CH-8 Markdown 子集渲染（h2/strong/li/安全链接）', preview.h2 === 1 && preview.strong === 1 && preview.li === 2 && preview.a === 1, preview);
  check('N3-02 CH-8 保存往返：API note 与输入逐字一致', n0 === NOTE && /进展说明已保存/.test(banner), { size: n0.length });

  /* 新增行 / 删除行（项目负责人） */
  const beforeAdd = (await wbs()).tasks.length;
  await page.click('#add-row-btn');
  await page.waitForTimeout(250);
  const newId = await page.evaluate(() => {
    const trs = Array.from(document.querySelectorAll('#wbs-body tr'));
    return (trs[trs.length - 1].querySelector('td.cell-id') || {}).textContent.trim();
  });
  const needEdit = await page.evaluate((id) => {
    const tr = Array.from(document.querySelectorAll('#wbs-body tr')).find((t) => (t.querySelector('td.cell-id') || {}).textContent.trim() === id);
    return tr.querySelectorAll('input[data-edit-field="level1"]').length === 0;
  }, newId);
  if (needEdit) { await page.click('#wbs-body tr:has(td.cell-id:text-is("' + newId + '")) [data-edit-row]'); }
  await page.waitForTimeout(300);
  for (const f of ['level1', 'level2', 'task']) { await setField(page, newId, f, '复验' + f); }
  await setField(page, newId, 'owner', '王言');
  await page.waitForTimeout(200);
  const draft = await page.evaluate((id) => {
    const tr = Array.from(document.querySelectorAll('#wbs-body tr')).find((t) => (t.querySelector('td.cell-id') || {}).textContent.trim() === id);
    return { l1: tr.querySelector('input[data-edit-field="level1"]').value, l2: tr.querySelector('input[data-edit-field="level2"]').value, task: tr.querySelector('input[data-edit-field="task"]').value, owner: tr.querySelector('select[data-edit-field="owner"]').value };
  }, newId);
  console.log('新增行草稿：' + JSON.stringify(draft));
  await page.click('#save-btn');
  await page.waitForFunction(() => /版本号已更新|冲突|失败|校验|拒绝/.test(document.getElementById('banner-text').textContent), null, { timeout: 15000 });
  const addBanner = await page.$eval('#banner-text', (e) => e.textContent);
  const afterAdd = await wbs();
  const added = afterAdd.tasks[afterAdd.tasks.length - 1];
  check('N4-01 新增行可保存，新行默认 phases 全 未开始、日期为空', /版本号已更新/.test(addBanner) && afterAdd.tasks.length === beforeAdd + 1 &&
    ['design', 'dev', 'test', 'product', 'demo_prep'].every((k) => added.phases[k] === '未开始' && added.dates[k] === ''), { rows: afterAdd.tasks.length, id: added.id, phases: added.phases });
  await page.click('#wbs-body tr:has(td.cell-id:text-is("' + added.id + '")) [data-delete]');
  await page.waitForTimeout(300);
  await page.click('#save-btn');
  await page.waitForFunction(() => /版本号已更新|冲突|失败|校验|拒绝/.test(document.getElementById('banner-text').textContent), null, { timeout: 15000 });
  const afterDel = await wbs();
  check('N4-02 删除行可保存（含确认框），行数回到起点', afterDel.tasks.length === beforeAdd && afterDel.tasks.map((t) => t.id).join(',') === ids0.join(','), { rows: afterDel.tasks.length });

  /* 空输入 / 非法输入：不写入 */
  const writesBefore = requests.filter((r) => r.indexOf('PUT ') === 0).length;
  const revBefore = (await wbs()).meta.revision;
  await page.click('#wbs-body tr:has(td.cell-id:text-is("' + row0.id + '")) [data-edit-row]');
  await page.waitForTimeout(200);
  await setField(page, row0.id, 'task', '');
  await page.waitForTimeout(250);
  const saveState = await page.evaluate(() => ({ disabled: document.getElementById('save-btn').disabled, status: document.getElementById('session-status').textContent }));
  if (!saveState.disabled) { await page.click('#save-btn'); }
  await page.waitForTimeout(900);
  const errBanner = await page.$eval('#banner-text', (e) => e.textContent);
  const writesAfter = requests.filter((r) => r.indexOf('PUT ') === 0).length;
  const revAfter = (await wbs()).meta.revision;
  const taskStill = (await wbs()).tasks.find((t) => t.id === row0.id).task;
  check('N5-01 空输入（任务项为空）被拦截：中文错误提示 + 未发出写请求 + 数据未变',
    /任务项/.test(errBanner) && writesAfter === writesBefore && revAfter === revBefore && taskStill === row0.task,
    { errBanner, writesBefore, writesAfter, revBefore, revAfter, saveState });

  const external = requests.filter((r) => r.indexOf('http') === 0 && r.indexOf(BASE) !== 0);
  check('N6-01 不回归抽样全程无外部请求 / 无 pageerror', external.length === 0 && pageErrors.length === 0, { external, pageErrors });
  fs.writeFileSync(path.join(OUT, 'results', 'iso-nonreg-results.json'), JSON.stringify({ pass, fail, results }, null, 1));
  console.log('== 不回归抽样汇总：PASS=' + pass + ' FAIL=' + fail + ' ==');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SCRIPT ERROR ' + (e && e.stack || e)); process.exit(2); });
