'use strict';
/* YUNZ-38 / Stage18 独立复验：隔离实例真实浏览器（Chromium）交互断言。
   由 AI-QV 自写，不加载被测作者 tests/*；覆盖派发单必测 1–7 与 9 的浏览器侧。
   只对隔离实例（isoA 4260 / isoB 4261 / isoC 4262 / isoS 4263）操作；isoS 允许真实写路径。
   现场（4180）不在本脚本内，避免任何写风险。 */
const fs = require('fs');
const path = require('path');
const TOOLS = process.env.TOOLS || '/tools';
const { chromium } = require(path.join(TOOLS, 'node_modules', 'playwright'));

const OUTDIR = process.env.OUTDIR || '/qv/results';
const SHOTDIR = process.env.SHOTDIR || '/qv/shots';
const EXP = JSON.parse(fs.readFileSync(path.join(OUTDIR, 'expected-stats.json'), 'utf8'));

const STATUSES = ['未开始', '已开始', '已完成', '延期', '阻塞'];
const PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep'];
const COLOR = {
  '未开始': 'rgb(158, 158, 158)', '已开始': 'rgb(47, 128, 237)',
  '已完成': 'rgb(39, 174, 96)', '延期': 'rgb(231, 76, 60)', '阻塞': 'rgb(255, 212, 0)',
};
const INSTANCES = [
  { name: 'isoA', base: process.env.BASE_A || 'http://127.0.0.1:4260' },
  { name: 'isoB', base: process.env.BASE_B || 'http://127.0.0.1:4261' },
  { name: 'isoC', base: process.env.BASE_C || 'http://127.0.0.1:4262' },
  { name: 'isoS', base: process.env.BASE_S || 'http://127.0.0.1:4263' },
];

const results = { started_at: new Date().toISOString(), checks: [], page_errors: [], requests: [], downloads: [] };
let pass = 0, fail = 0;
function check(id, ok, detail) {
  results.checks.push({ id, ok: !!ok, detail: detail === undefined ? null : detail });
  if (ok) { pass += 1; console.log('PASS  ' + id + (detail !== undefined ? '  :: ' + JSON.stringify(detail) : '')); }
  else { fail += 1; console.log('FAIL  ' + id + '  -> ' + JSON.stringify(detail)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function enterAs(page, name) {
  const layerVisible = await page.locator('#identity-layer').isVisible().catch(() => false);
  if (layerVisible) await page.locator('#identity-list button[data-identity="' + name + '"]').first().click();
  else await page.selectOption('#identity-select', String(name));
  await page.waitForTimeout(500);
}

/* 读取总览条 DOM 结构（与 expected 口径无关，纯结构） */
async function readOverview(page) {
  return page.evaluate(function () {
    var rows = Array.from(document.querySelectorAll('#overview-rows .overview-row')).map(function (r) {
      return {
        phase: r.getAttribute('data-phase'),
        label: (r.querySelector('.overview-phase') || {}).textContent,
        badges: Array.from(r.querySelectorAll('.overview-badge')).map(function (b) {
          return {
            status: b.getAttribute('data-status'),
            count: b.getAttribute('data-count'),
            pct: b.getAttribute('data-percentage'),
            text: (b.innerText || '').replace(/\s+/g, ' ').trim(),
            bg: getComputedStyle(b).backgroundColor,
          };
        }),
      };
    });
    var ov = document.getElementById('phase-overview');
    return {
      visible: !!(ov && ov.offsetParent !== null),
      rows: rows,
      total: (document.getElementById('overview-total') || {}).textContent,
      buttons: ov ? ov.querySelectorAll('button').length : -1,
      refreshText: ov ? /刷新|重新计算|reload/i.test(ov.innerText || '') : true,
    };
  });
}

function expMap(inst, phaseKey) {
  const ph = EXP[inst].phases.filter((p) => p.key === phaseKey)[0];
  const m = {};
  ph.statuses.forEach((s) => { m[s.value] = s; });
  return m;
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  /* ============ 逐实例：结构 / 一致性 / 边界 / 五色 ============ */
  for (const inst of INSTANCES) {
    const prefix = inst.name.toUpperCase();
    const exp = inst.name === 'isoS' ? EXP.isoA : EXP[inst.name];
    const context = await browser.newContext({ viewport: { width: 1500, height: 1100 }, acceptDownloads: true });
    const page = await context.newPage();
    page.on('pageerror', (e) => results.page_errors.push(inst.name + ': ' + String((e && e.message) || e)));
    page.on('request', (r) => results.requests.push({ inst: inst.name, url: r.url(), method: r.method() }));
    page.on('download', (d) => results.downloads.push(inst.name + ':' + d.suggestedFilename()));
    await page.goto(inst.base + '/', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    await enterAs(page, '项目负责人');

    const ov = await readOverview(page);

    /* ---- 1) 结构 ---- */
    const rowKeys = ov.rows.map((r) => r.phase);
    check(prefix + '-01 顶部总览条可见（常驻于工作台顶部）', ov.visible, { visible: ov.visible });
    check(prefix + '-02 五阶段各自独立一组（5 行，data-phase 顺序 == 设计/开发/测试/产品/演示准备）',
      ov.rows.length === 5 && JSON.stringify(rowKeys) === JSON.stringify(PHASE_KEYS), { rowKeys });
    const badRow = ov.rows.filter((r) => r.badges.length !== 5);
    check(prefix + '-03 每行含阶段名 + 五种状态徽标，无跨阶段合并行',
      badRow.length === 0 && ov.rows.every((r) => r.badges.length === 5) &&
      ov.rows.every((r, i) => r.label === exp.phases[i].name), { badRow, labels: ov.rows.map((r) => r.label) });
    const badgeTextOk = ov.rows.every((r) => r.badges.every((b) =>
      b.text === b.status + ' ' + b.count + ' ' + Number(b.pct).toFixed(1) + '%'));
    check(prefix + '-04 每个徽标文本 ==「状态名 + 数量 + 百分比（1 位小数）」', badgeTextOk,
      { sample: ov.rows[0].badges.map((b) => b.text) });
    check(prefix + '-05 条内无手动刷新按钮（无 button、无「刷新/reload」文案）',
      ov.buttons === 0 && ov.refreshText === false, { buttons: ov.buttons, refreshText: ov.refreshText });
    check(prefix + '-06 顶部合计文本 ==「共 N 条」（N == /api/wbs 任务总数）',
      ov.total === '共 ' + exp.total + ' 条', { got: ov.total, exp: '共 ' + exp.total + ' 条' });

    /* ---- 2) 与 /api/stats 一致（服务端口径） ---- */
    const apiStats = await page.evaluate(async () => (await fetch('/api/stats', { cache: 'no-store' })).json());
    const apiWbs = await page.evaluate(async () => (await fetch('/api/wbs', { cache: 'no-store' })).json());
    fs.writeFileSync(path.join(OUTDIR, 'api-' + inst.name + '-stats.json'), JSON.stringify(apiStats, null, 2));
    let diff = [];
    for (let i = 0; i < 5; i += 1) {
      const ph = apiStats.phases[i];
      const row = ov.rows[i];
      if (!row || row.phase !== ph.key) { diff.push({ at: 'phase', got: row && row.phase, exp: ph.key }); continue; }
      if (row.label !== ph.name) diff.push({ at: 'name', got: row.label, exp: ph.name });
      for (let j = 0; j < 5; j += 1) {
        const st = ph.statuses[j], b = row.badges[j];
        if (!b || b.status !== st.value) { diff.push({ at: 'status', got: b && b.status, exp: st.value }); continue; }
        if (b.count !== String(st.count)) diff.push({ at: ph.key + '/' + st.value + '.count', got: b.count, exp: st.count });
        if (b.pct !== st.percentage.toFixed(1)) diff.push({ at: ph.key + '/' + st.value + '.pct', got: b.pct, exp: st.percentage.toFixed(1) });
      }
    }
    check(prefix + '-07 DOM 显示值（数量/百分比/文本）与 GET /api/stats 逐项完全一致',
      diff.length === 0, diff.length ? diff : 'all 25 statuses match');
    /* 与服务端返回 == 我按契约独立复算的期望 */
    check(prefix + '-08 /api/stats 与「按契约独立复算」的期望口径逐项一致',
      JSON.stringify(apiStats.phases) === JSON.stringify(exp.phases),
      { total: apiStats.total, exp: exp.total });
    check(prefix + '-09 /api/stats 与 /api/wbs 读同一份文档（total == 任务数、revision == meta.revision）',
      apiStats.total === apiWbs.tasks.length && apiStats.revision === apiWbs.meta.revision,
      { statsTotal: apiStats.total, tasks: apiWbs.tasks.length, statsRev: apiStats.revision, wbsRev: apiWbs.meta.revision });
    let sums = apiStats.phases.map((p) => ({ k: p.key, sum: +p.statuses.reduce((a, s) => a + s.percentage, 0).toFixed(1) }));
    check(prefix + '-10 每阶段五项百分比合计恰为 100.0%（0 行实例除外）',
      exp.total === 0 ? sums.every((s) => s.sum === 0) : sums.every((s) => s.sum === 100.0), sums);
    const zeroState = apiStats.phases.some((p) => p.statuses.some((s) => s.count === 0)) &&
      ov.rows.some((r) => r.badges.some((b) => b.count === '0' && b.text.endsWith('0 0.0%')));
    check(prefix + '-11 计数为 0 的状态仍显示「0 0.0%」', exp.total === 0 ? ov.rows.every((r) => r.badges.every((b) => b.text.endsWith('0 0.0%'))) : zeroState,
      { hasZeroCountState: apiStats.phases.some((p) => p.statuses.some((s) => s.count === 0)) });

    /* ---- 3) 占比边界 ---- */
    if (inst.name === 'isoB') {
      check('ISOB-12 0 行任务：不做除零、五项全为「0 0.0%」、接口 200 不报错',
        apiStats.total === 0 && apiStats.phases.length === 5 &&
        apiStats.phases.every((p) => p.statuses.every((s) => s.count === 0 && s.percentage === 0)) &&
        ov.rows.every((r) => r.badges.every((b) => b.text.endsWith('0 0.0%'))),
        { total: apiStats.total, first: ov.rows[0].badges.map((b) => b.text) });
    }
    if (inst.name === 'isoC') {
      const d = apiStats.phases[0];
      const vals = d.statuses.map((s) => s.percentage);
      const sum = +vals.reduce((a, b) => a + b, 0).toFixed(1);
      check('ISOC-12 单阶段 1/1/1 分布：最大余数法补齐，五项合计恰为 100.0%',
        d.key === 'design' && JSON.stringify(vals) === JSON.stringify([33.4, 33.3, 33.3, 0, 0]) && sum === 100.0,
        { design: vals, sum });
      check('ISOC-13 补齐结果与页面显示一致（33.4 / 33.3 / 33.3）',
        ov.rows[0].badges.map((b) => b.text).join(' | ') ===
        '未开始 1 33.4% | 已开始 1 33.3% | 已完成 1 33.3% | 延期 0 0.0% | 阻塞 0 0.0%',
        { got: ov.rows[0].badges.map((b) => b.text) });
    }

    /* ---- 4) 五色一致（computed style） ---- */
    const badgeColors = {};
    ov.rows.forEach((r) => r.badges.forEach((b) => { badgeColors[b.status] = b.bg; }));
    check(prefix + '-14 五种状态徽标 computed 颜色 == 五色映射（未开始灰/已开始蓝/已完成绿/延期红/阻塞黄）',
      STATUSES.every((s) => badgeColors[s] === COLOR[s]), { got: badgeColors, exp: COLOR });
    /* 与表格阶段控件逐项比对：取表格中同状态的 select computed 颜色 */
    const selColors = await page.evaluate(function (statuses) {
      var out = {};
      statuses.forEach(function (s) {
        var el = document.querySelector('#wbs-body select.phase-select.phase-' + s);
        if (el) out[s] = getComputedStyle(el).backgroundColor;
      });
      return out;
    }, STATUSES);
    check(prefix + '-15 徽标颜色与表格阶段控件（select.phase-select）computed 颜色完全一致',
      STATUSES.every((s) => selColors[s] === undefined || selColors[s] === badgeColors[s]),
      { badge: badgeColors, select: selColors });

    if (inst.name === 'isoA') {
      await page.screenshot({ path: path.join(SHOTDIR, 'isoA-workbench-1500.png'), fullPage: false });
    }
    await context.close();
  }

  /* ============ 2b) 前端「原样渲染」断言：伪造 /api/stats 响应 ============ */
  {
    const context = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
    const page = await context.newPage();
    const fabricated = {
      ok: true, total: 999, revision: 42,
      phases: PHASE_KEYS.map((k, i) => ({
        key: k, name: EXP.isoA.phases[i].name,
        statuses: STATUSES.map((s, j) => ({
          value: s,
          count: (i === 0 && j === 0) ? 7 : 0,
          percentage: (i === 0 && j === 0) ? 7.7 : 0,
        })),
      })),
    };
    await page.route('**/api/stats', (route) => route.fulfill({
      status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(fabricated),
    }));
    await page.goto((process.env.BASE_A || 'http://127.0.0.1:4260') + '/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await enterAs(page, '项目负责人');
    const ov = await readOverview(page);
    check('FRONT-16 前端原样渲染 /api/stats（伪造 count 与任务数不符 / 合计 99 的响应亦逐字呈现，不二次计算/四舍五入）',
      ov.total === '共 999 条' && ov.rows[0].badges[0].text === '未开始 7 7.7%' &&
      ov.rows[0].badges[0].count === '7' && ov.rows[0].badges[0].pct === '7.7',
      { total: ov.total, first: ov.rows[0].badges[0] });
    await context.close();
  }

  /* ============ 5) 刷新时机（isoS：真实写路径） ============ */
  {
    const base = process.env.BASE_S || 'http://127.0.0.1:4263';
    const context = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => results.page_errors.push('isoS: ' + String((e && e.message) || e)));
    page.on('dialog', (d) => d.accept());
    await page.goto(base + '/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await enterAs(page, '项目负责人');

    async function ovText() {
      const o = await readOverview(page);
      return o.rows.map((r) => r.label + ':' + r.badges.map((b) => b.text).join(',')).join(' | ');
    }
    async function serverText() {
      const s = await page.evaluate(async () => (await fetch('/api/stats', { cache: 'no-store' })).json());
      return s.phases.map((p) => p.name + ':' + p.statuses.map((x) => x.value + ' ' + x.count + ' ' + x.percentage.toFixed(1) + '%').join(',')).join(' | ');
    }
    const before = await ovText();
    const predictedSel = '#wbs-body tr >> nth=0 >> select.phase-select >> nth=0';
    const prevVal = await page.locator(predictedSel).inputValue();
    const newVal = prevVal === '延期' ? '阻塞' : '延期';
    await page.selectOption(predictedSel, newVal);
    await page.click('#save-btn');
    await page.waitForTimeout(900);
    const afterSave = await ovText();
    const serverAfterSave = await serverText();
    check('ISOS-17 保存成功后总览实时重算（数值随隔离数据变化，无陈旧值）',
      afterSave !== before && afterSave === serverAfterSave, { before, afterSave, serverAfterSave, changed: prevVal + '->' + newVal });

    /* 新增行：填字段 -> 保存 -> 总数 +1 且与 /api/stats 一致 */
    const totalBefore = await page.evaluate(() => document.querySelectorAll('#wbs-body tr').length);
    await page.click('#add-row-btn');
    await page.waitForTimeout(300);
    const newRow = await page.locator('#wbs-body tr.row-editing').first();
    const nid = await newRow.getAttribute('data-id');
    /* 写入草稿：直接对当前节点赋值并派发 input+change（避免渲染替换导致丢失） */
    async function setField(id, field, value) {
      await page.evaluate(function (a) {
        var sel = '#wbs-body tr[data-id="' + a.id + '"] [data-edit-field="' + a.field + '"]';
        var el = document.querySelector(sel);
        if (!el) throw new Error('editor not found: ' + sel);
        el.value = a.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, { id: id, field: field, value: value });
      await page.waitForTimeout(150);
    }
    await setField(nid, 'level1', '复验一级');
    await setField(nid, 'level2', '复验二级');
    await setField(nid, 'task', '复验新增任务');
    const filled = await page.evaluate(function (id) {
      return Array.from(document.querySelectorAll('#wbs-body tr[data-id="' + id + '"] input[data-edit-field]'))
        .map(function (i) { return i.getAttribute('data-edit-field') + '=' + i.value; });
    }, nid);
    const ovDraft = await ovText();
    await page.click('#save-btn');
    await page.waitForTimeout(900);
    const totalAfter = await page.evaluate(() => document.querySelectorAll('#wbs-body tr').length);
    const statTotal = await page.evaluate(async () => (await (await fetch('/api/stats', { cache: 'no-store' })).json()).total);
    const afterAdd = await ovText();
    check('ISOS-18 新增并保存后总览重算（总数 +1，与 /api/stats 一致）',
      totalAfter === totalBefore + 1 && statTotal === EXP.isoA.total + 1 && afterAdd === (await serverText()),
      { totalBefore, totalAfter, statTotal, afterAdd, filled });

    /* 删除行：删除 -> 保存 -> 总数 -1 且与 /api/stats 一致 */
    await page.click('#wbs-body tr[data-id="' + nid + '"] button[data-delete]');
    await page.waitForTimeout(300);
    await page.click('#save-btn');
    await page.waitForTimeout(900);
    const statTotal2 = await page.evaluate(async () => (await (await fetch('/api/stats', { cache: 'no-store' })).json()).total);
    const afterDel = await ovText();
    check('ISOS-19 删除并保存后总览重算（总数 -1，与 /api/stats 一致）',
      statTotal2 === EXP.isoA.total && afterDel === (await serverText()), { statTotal2, afterDel });

    /* 身份切换回到工作台 -> 总览重算 */
    await enterAs(page, '王言');
    await page.waitForTimeout(300);
    await enterAs(page, '项目负责人');
    const afterSwitch = await ovText();
    check('ISOS-20 身份切换回到工作台后总览重算（与 /api/stats 一致）',
      afterSwitch === (await serverText()), { afterSwitch });

    /* 新增人员（写操作）成功后总览重算 */
    const beforePerson = await ovText();
    await page.click('#add-person-btn');
    await page.waitForTimeout(300);
    await page.fill('#new-person-name', '复验员甲');
    await page.click('#new-person-confirm');
    await page.waitForTimeout(900);
    const afterPerson = await ovText();
    check('ISOS-21 新增人员（写操作）成功后总览重算且与服务端口径一致',
      afterPerson === (await serverText()), { beforePerson, afterPerson });

    await page.screenshot({ path: path.join(SHOTDIR, 'isoS-after-writes-1500.png') });
    await context.close();
  }

  /* ============ 6) 权限与只读性（isoA） ============ */
  {
    const base = process.env.BASE_A || 'http://127.0.0.1:4260';
    const context = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
    const page = await context.newPage();
    await page.goto(base + '/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const identities = await page.evaluate(async () => (await (await fetch('/api/wbs', { cache: 'no-store' })).json()).identities);
    const texts = {};
    let allVisible = true;
    for (const id of identities) {
      await enterAs(page, id);
      const o = await readOverview(page);
      if (!o.visible || o.rows.length !== 5) allVisible = false;
      texts[id] = o.rows.map((r) => r.badges.map((b) => b.text).join(',')).join('|');
    }
    const uniq = Array.from(new Set(Object.keys(texts).map((k) => texts[k])));
    check('ISOA-22 全部身份（' + identities.length + ' 个）进入工作台均能看到同一只读总览',
      allVisible && uniq.length === 1, { identities: identities.length, distinctOverviews: uniq.length });

    await enterAs(page, '项目负责人');
    const pmBtns = await page.evaluate(() => ({
      addRow: !document.getElementById('add-row-btn').hidden,
      addPerson: !document.getElementById('add-person-btn').hidden,
      delButtons: document.querySelectorAll('#wbs-body button[data-delete]').length,
    }));
    await enterAs(page, '王言');
    const ownerBtns = await page.evaluate(() => ({
      addRow: !document.getElementById('add-row-btn').hidden,
      addPerson: !document.getElementById('add-person-btn').hidden,
      delButtons: document.querySelectorAll('#wbs-body button[data-delete]').length,
    }));
    check('ISOA-23 权限矩阵不回归：项目负责人可新增/删除，普通负责人无新增/删除入口',
      pmBtns.addRow && pmBtns.addPerson && pmBtns.delButtons > 0 &&
      !ownerBtns.addRow && !ownerBtns.addPerson && ownerBtns.delButtons === 0, { pmBtns, ownerBtns });

    /* 他人行只读提示（可发现性）：点击他人行只读单元格应有中文提示 */
    await enterAs(page, '王言');
    const other = await page.evaluate(() => {
      var out = null;
      Array.from(document.querySelectorAll('#wbs-body tr')).forEach(function (tr) {
        if (out) return;
        var oc = tr.querySelector('td[data-field="owner"]');
        if (oc && oc.textContent.trim() !== '王言') {
          var inp = tr.querySelector('td[data-field="dates.design"] input.date-input');
          out = { id: tr.getAttribute('data-id'), owner: oc.textContent.trim(), dateDisabled: inp ? inp.disabled : null,
                  locked: tr.querySelector('td[data-field="task"]').className.indexOf('locked') !== -1 };
        }
      });
      return out;
    });
    const hintBefore = await page.evaluate(() => document.getElementById('hint').hidden);
    await page.click('#wbs-body tr[data-id="' + other.id + '"] td[data-field="task"]');
    await page.waitForTimeout(300);
    const hint = await page.evaluate(() => ({ hidden: document.getElementById('hint').hidden, text: document.getElementById('hint').innerText }));
    check('ISOA-24 他人行只读：日期输入 disabled、单元格 locked，点击给出中文只读提示',
      other.dateDisabled === true && other.locked === true && hint.hidden === false && /只读/.test(hint.text),
      { other, hintBefore, hint });
    await context.close();
  }

  /* ============ 7) 移动端 375px ============ */
  for (const inst of [{ name: 'isoA', base: process.env.BASE_A || 'http://127.0.0.1:4260' },
                      { name: 'isoC', base: process.env.BASE_C || 'http://127.0.0.1:4262' }]) {
    const context = await browser.newContext({ viewport: { width: 375, height: 780 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto(inst.base + '/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await enterAs(page, '项目负责人');
    const m = await page.evaluate(function () {
      var de = document.documentElement;
      var ov = document.getElementById('phase-overview').getBoundingClientRect();
      var table = document.getElementById('wbs-table').getBoundingClientRect();
      var badges = Array.from(document.querySelectorAll('.overview-badge'));
      var overflow = badges.filter(function (b) {
        var r = b.getBoundingClientRect();
        return r.right > de.clientWidth + 1 || r.left < -1;
      }).map(function (b) { return (b.innerText || '').replace(/\s+/g, ' ').trim(); });
      var rows = document.querySelectorAll('#overview-rows .overview-row').length;
      return {
        scrollWidth: de.scrollWidth, clientWidth: de.clientWidth,
        overviewBottom: Math.round(ov.bottom), tableTop: Math.round(table.top),
        overflowBadges: overflow, rows: rows,
        bodyScrollWidth: document.body.scrollWidth,
      };
    });
    check(inst.name.toUpperCase() + '-25 375px 无横向页面滚动（scrollWidth <= clientWidth）',
      m.scrollWidth <= m.clientWidth && m.bodyScrollWidth <= m.clientWidth,
      { scrollWidth: m.scrollWidth, clientWidth: m.clientWidth, body: m.bodyScrollWidth });
    check(inst.name.toUpperCase() + '-26 375px 徽标文本不溢出视口、总览条不遮挡表格（5 行仍在）',
      m.overflowBadges.length === 0 && m.overviewBottom <= m.tableTop && m.rows === 5,
      { overflowBadges: m.overflowBadges, overviewBottom: m.overviewBottom, tableTop: m.tableTop, rows: m.rows });
    await page.screenshot({ path: path.join(SHOTDIR, inst.name + '-workbench-375.png'), fullPage: false });
    await context.close();
  }

  /* ============ 8b) 日报文本弹层不含本统计（isoA） ============ */
  {
    const base = process.env.BASE_A || 'http://127.0.0.1:4260';
    const context = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
    const page = await context.newPage();
    await page.goto(base + '/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await enterAs(page, '项目负责人');
    await page.click('#daily-btn');
    await page.waitForTimeout(600);
    const daily = await page.evaluate(() => ({
      visible: !document.getElementById('daily-panel').hidden,
      text: document.getElementById('daily-text').textContent,
    }));
    check('ISOA-27 日报文本弹层仍可用（可见）且文本不含 CH-14 统计',
      daily.visible && !/阶段状态占比|未开始 3 25\.0%|占\s*比/.test(daily.text), { len: daily.text.length, head: daily.text.slice(0, 80) });
    await page.click('#daily-close').catch(() => {});
    await context.close();
  }

  /* ============ 9b) 全程无外部请求、0 次新增下载（isoA） ============ */
  {
    const base = process.env.BASE_A || 'http://127.0.0.1:4260';
    const allowed = ['http://127.0.0.1:4260', 'http://127.0.0.1:4261', 'http://127.0.0.1:4262', 'http://127.0.0.1:4263'];
    const external = results.requests.filter((r) => !allowed.some((o) => r.url.startsWith(o)) && !r.url.startsWith('data:'));
    check('ISO-28 隔离实例全程无外部请求（所有请求仅指向四个隔离实例端口）', external.length === 0, external.slice(0, 5));
    check('ISO-29 隔离实例工作台常规操作 0 次新增下载（无 download 事件）', results.downloads.length === 0, results.downloads);
  }

  fs.writeFileSync(path.join(OUTDIR, 'iso-browser-results.json'),
    JSON.stringify(Object.assign({}, results, { pass, fail }), null, 2));
  await browser.close();
  console.log('\n[iso-browser] PASS=' + pass + ' FAIL=' + fail);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => { console.error('FATAL', err); process.exit(2); });
