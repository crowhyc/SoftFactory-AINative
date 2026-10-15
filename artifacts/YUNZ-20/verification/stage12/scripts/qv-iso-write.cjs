/* YUNZ-32 / Stage12 独立复验：隔离实例（4183）真实浏览器写路径矩阵。
 * 覆盖：五色映射全枚举、点击保存流程、权限（本人行可改 / 他人行禁用）、CH-7 新增人员、
 *       真实导出下载；现场 4180 不参与任何写入。
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.QV_BASE || 'http://127.0.0.1:4183';
const OUT = process.env.QV_OUT || '.';
const DL = path.join(OUT, 'downloads');
const results = [];
let pass = 0, fail = 0;
function check(name, cond, detail) {
  const ok = !!cond;
  ok ? pass++ : fail++;
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + '  :: ' + JSON.stringify(detail === undefined ? null : detail));
}
const COLOR = { '未开始': 'rgb(158, 158, 158)', '已开始': 'rgb(47, 128, 237)', '已完成': 'rgb(39, 174, 96)', '延期': 'rgb(231, 76, 60)', '阻塞': 'rgb(255, 212, 0)' };
const requests = [], pageErrors = [];
const wbs = () => fetch(BASE + '/api/wbs').then((r) => r.json());
const daily = (d) => fetch(BASE + '/api/daily?date=' + d).then((r) => r.json());
const TODAY = '2026-10-15';

(async () => {
  fs.mkdirSync(DL, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('request', (r) => requests.push({ method: r.method(), url: r.url() }));
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('dialog', (d) => d.accept());

  const api0 = await wbs();
  fs.writeFileSync(path.join(OUT, 'results', 'iso-api-initial.json'), JSON.stringify(api0));
  const ids = api0.tasks.map((t) => t.id);
  const [X, Y, Z] = ids;
  const ownerOf = (id) => (api0.tasks.find((t) => t.id === id) || {}).owner;
  check('I0-01 隔离实例就绪：revision=1 / 35 行 / phases 齐全', api0.meta.revision === 1 && api0.tasks.length === 35 && api0.tasks.every((t) => t.phases && Object.keys(t.phases).length === 5), { rev: api0.meta.revision, rows: api0.tasks.length });

  /* 构造数据基线：/api/daily 派生规则用例① */
  const d0 = await daily(TODAY);
  fs.writeFileSync(path.join(OUT, 'results', 'iso-daily-initial.json'), JSON.stringify(d0));
  const Xt = api0.tasks.find((t) => t.id === X) || {};
  const Yt = api0.tasks.find((t) => t.id === Y) || {};
  const e1 = d0.summary.filter((s) => s.basis === '计划日期早于今天且今日未更新');
  const xCase = e1.filter((s) => s.task === Xt.task);
  check('I0-02 派生规则案例①：计划日期 < 今天且今日无更新 → 产出「到期未更新，判定延期」并归属当前负责人',
    xCase.length === 1 && /设计/.test(xCase[0].conclusion) && /到期未更新，判定延期/.test(xCase[0].conclusion) &&
    xCase[0].owner === Xt.owner && xCase[0].importance === '延期·高风险' && xCase[0].level1 === Xt.level1,
    { lines: e1.map((s) => s.line) });
  check('I0-03 旧 status 审计记录存在于 audit.log 但不进日报任何 sheet', !d0.changes.some((c) => c.field === 'status') && !d0.summary.some((s) => /状态/.test(s.conclusion)), { changes: d0.counts.changes, fields: Array.from(new Set(d0.changes.map((c) => c.field))) });

  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('#identity-list .identity-btn');
  await page.click('#identity-list .identity-btn[data-identity="项目负责人"]');
  await page.waitForSelector('#wbs-body tr');

  /* 五色映射：逐个枚举（隔离实例，不落盘） */
  const sel = '#wbs-body tr:has(td.cell-id:text-is("' + Z + '")) td.cell-date .phase-cell:nth-of-type(1) select';
  const observed = {};
  for (const v of ['未开始', '已开始', '已完成', '延期', '阻塞']) {
    await page.selectOption('#wbs-body tr:has(td.cell-id:text-is("' + Z + '")) td.cell-date .phase-cell select >> nth=0', v);
    await page.waitForTimeout(80);
    observed[v] = await page.$eval('#wbs-body tr:has(td.cell-id:text-is("' + Z + '")) td.cell-date .phase-cell select', (s) => getComputedStyle(s).backgroundColor);
  }
  const colorAll = Object.keys(COLOR).every((k) => observed[k] === COLOR[k]);
  check('I1-01 五色映射全枚举断言（①未开始灰 ②已开始蓝 ③已完成绿 ④延期红 ⑤阻塞黄）', colorAll, observed);
  await page.screenshot({ path: path.join(OUT, 'shots', 'iso-phase-阻塞.png') });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#wbs-body tr');

  /* 点击保存流程：Y.dev 未开始 → 延期 */
  await page.selectOption('#wbs-body tr:has(td.cell-id:text-is("' + Y + '")) td.cell-date .phase-cell select >> nth=1', '延期');
  await page.waitForTimeout(100);
  const dirty = await page.evaluate(() => ({ save: !document.getElementById('save-btn').disabled, status: document.getElementById('session-status').textContent }));
  await page.click('#save-btn');
  await page.waitForFunction(() => /版本号已更新|冲突|失败/.test(document.getElementById('banner-text').textContent), null, { timeout: 15000 });
  const banner = await page.$eval('#banner-text', (e) => e.textContent);
  const api1 = await wbs();
  const y1 = api1.tasks.find((t) => t.id === Y);
  check('I2-01 阶段状态改动走既有「点击保存」流程（草稿态 → 保存按钮可用）', dirty.save === true, dirty);
  check('I2-02 保存成功：提示 + revision 1→2 递增', /版本号已更新/.test(banner) && api1.meta.revision === 2, { banner, rev: api1.meta.revision });
  check('I2-03 页面显示 = API：Y.phases.dev 由 未开始 → 延期', y1.phases.dev === '延期' && (await page.$eval('#wbs-body tr:has(td.cell-id:text-is("' + Y + '")) td.cell-date .phase-cell select >> nth=1', (s) => s.value)) === '延期', y1.phases.dev);
  check('I2-04 CH-9：保存往返后 demo 原值未被清空（Z.demo 仍为 是）', (api1.tasks.find((t) => t.id === Z) || {}).demo === '是', (api1.tasks.find((t) => t.id === Z) || {}).demo);

  /* 派生规则案例②：当天已更新该阶段 → 实际状态事件，不重复判到期未更新 */
  const d1 = await daily(TODAY);
  fs.writeFileSync(path.join(OUT, 'results', 'iso-daily-after-save.json'), JSON.stringify(d1));
  const yEvents = d1.summary.filter((s) => s.task === (y1.task || ''));
  const devEvents = yEvents.filter((s) => /开发/.test(s.conclusion));
  check('I2-05 派生规则案例②：当天更新 Y.dev → 产出实际状态事件（开发延期）', devEvents.some((s) => /延期/.test(s.conclusion)) && devEvents.some((s) => s.basis === '当日阶段状态变更'), devEvents.map((s) => s.line));
  check('I2-06 派生规则案例②：该阶段不再重复判定「到期未更新」（其他行仍正常保留）',
    !d1.summary.some((s) => s.basis === '计划日期早于今天且今日未更新' && s.task === (y1.task || '')) &&
    d1.summary.some((s) => s.basis === '计划日期早于今天且今日未更新' && s.task === Xt.task),
    { after: d1.summary.map((s) => s.line) });

  /* 权限：普通负责人只能改本人行 */
  const ownerY = ownerOf(Y);
  await page.selectOption('#identity-select', ownerY);
  await page.waitForTimeout(250);
  const perm = await page.evaluate((p) => {
    const q = (id, idx) => {
      const tr = Array.from(document.querySelectorAll('#wbs-body tr')).find((t) => (t.querySelector('td.cell-id') || {}).textContent.trim() === id);
      const sels = tr ? tr.querySelectorAll('td.cell-date .phase-cell select') : [];
      return sels[idx] ? sels[idx].disabled : null;
    };
    return { yOwn: q(p.Y, 2), otherRowLocked: q(p.Z, 2), addPerson: document.getElementById('add-person-btn').hidden };
  }, { X, Y, Z });
  check('I3-01 普通负责人：本人行阶段控件可编辑、他人行（不同负责人）disabled、新增人员按钮隐藏', perm.yOwn === false && perm.otherRowLocked === true && perm.addPerson === true, Object.assign({ ownerY, ownerZ: ownerOf(Z) }, perm));
  await page.selectOption('#wbs-body tr:has(td.cell-id:text-is("' + Y + '")) td.cell-date .phase-cell select >> nth=2', '阻塞');
  await page.waitForTimeout(100);
  await page.click('#save-btn');
  await page.waitForFunction(() => /版本号已更新|冲突|失败/.test(document.getElementById('banner-text').textContent), null, { timeout: 15000 });
  const api2 = await wbs();
  const y2 = api2.tasks.find((t) => t.id === Y);
  check('I3-02 普通负责人保存本人行成功：Y.phases.test=阻塞，revision 3', y2.phases.test === '阻塞' && api2.meta.revision === 3, { test: y2.phases.test, rev: api2.meta.revision });

  /* CH-7 新增人员（项目负责人） */
  await page.selectOption('#identity-select', '项目负责人');
  await page.waitForTimeout(200);
  await page.click('#add-person-btn');
  await page.waitForSelector('#add-person-panel:not([hidden])');
  await page.fill('#new-person-name', '验收测试员A');
  await page.click('#new-person-confirm');
  await page.waitForFunction(() => /已新增人员/.test(document.getElementById('banner-text').textContent), null, { timeout: 15000 });
  const banner3 = await page.$eval('#banner-text', (e) => e.textContent);
  const api3 = await wbs();
  check('I4-01 CH-7 新增人员进入人员池并保存到服务器', api3.identities.indexOf('验收测试员A') >= 0 && api3.meta.revision === 4 && /已新增人员/.test(banner3), { rev: api3.meta.revision, has: api3.identities.indexOf('验收测试员A') >= 0 });
  const d2 = await daily(TODAY);
  fs.writeFileSync(path.join(OUT, 'results', 'iso-daily-after-person.json'), JSON.stringify(d2));
  const pr = d2.changes.filter((c) => c.field === '人员池');
  check('I4-02 CH-7 新增人员审计行进入日报「当日变更」（改动字段 人员池 / 旧值空 / 新值姓名）', pr.some((c) => c.new === '验收测试员A' && c.old === '' && /新增人员/.test(c.task)), pr.map((c) => ({ t: c.task, o: c.old, n: c.new })));

  /* 真实导出下载（隔离实例，含非空 demo） */
  const [dw] = await Promise.all([page.waitForEvent('download'), page.click('#export-btn')]);
  await dw.saveAs(path.join(DL, 'iso-wbs.xlsx'));
  const [dd] = await Promise.all([page.waitForEvent('download'), page.click('#daily-btn')]);
  await dd.saveAs(path.join(DL, 'iso-daily.xlsx'));
  check('I5-01 隔离实例导出 Excel / 日报均真实下载成功', fs.statSync(path.join(DL, 'iso-wbs.xlsx')).size > 10000 && fs.statSync(path.join(DL, 'iso-daily.xlsx')).size > 3000, { wbs: fs.statSync(path.join(DL, 'iso-wbs.xlsx')).size, daily: fs.statSync(path.join(DL, 'iso-daily.xlsx')).size });
  fs.writeFileSync(path.join(OUT, 'results', 'iso-api-final.json'), JSON.stringify(await wbs()));
  fs.writeFileSync(path.join(OUT, 'results', 'iso-daily-final.json'), JSON.stringify(await daily(TODAY)));

  const external = requests.filter((r) => r.url.indexOf(BASE) !== 0 && r.url.indexOf('blob:') !== 0 && r.url.indexOf('data:') !== 0);
  const writes = requests.filter((r) => ['PUT', 'POST', 'DELETE'].indexOf(r.method) >= 0);
  check('I6-01 隔离实例页面无外部请求', external.length === 0, external.slice(0, 3));
  check('I6-02 写请求条数与预期一致（2 次保存 + 1 次人员池保存 = 3）', writes.length === 3, writes);
  check('I6-03 无 pageerror', pageErrors.length === 0, pageErrors.slice(0, 2));
  fs.writeFileSync(path.join(OUT, 'results', 'iso-write-results.json'), JSON.stringify({ pass, fail, results, writes }, null, 1));
  console.log('== ISO 写入矩阵汇总：PASS=' + pass + ' FAIL=' + fail + ' ==');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.error('SCRIPT ERROR ' + (err && err.stack || err)); process.exit(2); });
