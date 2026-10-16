'use strict';
/* YUNZ-39 / 变更包 #8（CH-15：全量统计 + 分阶段详情 + 产品验收改名）服务端口径自测。
   运行在宿主（Node 标准库 + 被测服务，无浏览器依赖）：起隔离数据目录的被测服务，构造多组
   「五阶段 × 五状态」数据组合，逐条断言 CH-15 矩阵 01 / 02 / 03 / 04 的服务端口径与只读语义。
   宿主 node 为 docker 包装脚本，因此所有路径都用 APP_DIR 内的相对路径（容器以 cwd 挂载同一路径）。
   用法：node tests/stage19/statcheck.cjs
   不触碰运行现场 /opt/wbs-rongcheng/data 与 0.0.0.0:4180。 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const APP_DIR = process.env.APP_DIR || '/opt/wbs-rongcheng';
const PORT = Number(process.env.WBS_STATS_PORT || 4296);
const BASE = 'http://127.0.0.1:' + PORT;
const OUTDIR = process.env.OUTDIR || path.join(APP_DIR, 'tests/.tmp/stage19-stats');
const DATA_DIR = path.join(OUTDIR, 'data');
const DATA_FILE = path.join(DATA_DIR, 'wbs.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.log');
const PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep'];
const PHASE_LABELS = { design: '设计', dev: '开发', test: '测试', product: '产品验收', demo_prep: '演示准备' };
const PHASE_ENUM = ['未开始', '已开始', '已完成', '延期', '阻塞'];

const results = { checked_at: new Date().toISOString(), base: BASE, checks: [] };
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
  return { status: response.status, body, headers: response.headers };
};
const writeDoc = (doc) => fs.writeFileSync(DATA_FILE, JSON.stringify(doc, null, 2) + '\n');

/* ------------------------------------------------- 独立复算（测试侧按契约另写一份口径） */

/* 契约口径：分母 = total；百分比 = count/total*100 保留 1 位小数；五项合计不足 100.0% 时
   用最大余数法补齐（余数相同按未开始→阻塞顺序）；total 为 0 → 全 0 且不除零；
   计数之和与分母不一致（脏数据）时只做 1 位小数截断、不臆造补齐。 */
function expectedPercentages(counts, total) {
  if (!total) return counts.map(() => 0);
  const units = counts.map((count) => {
    const scaled = count * 1000;
    return { tenths: Math.floor(scaled / total), remainder: scaled % total };
  });
  const counted = counts.reduce((sum, count) => sum + count, 0);
  const out = units.map((unit) => unit.tenths);
  if (counted === total) {
    const deficit = 1000 - out.reduce((sum, value) => sum + value, 0);
    const order = units
      .map((unit, index) => ({ index, remainder: unit.remainder }))
      .sort((a, b) => (b.remainder - a.remainder) || (a.index - b.index));
    for (let i = 0; i < deficit; i += 1) out[order[i % order.length].index] += 1;
  }
  return out.map((value) => value / 10);
}

/* 依据文档独立统计：aggregate（分母 = 任务总数 × 5）与 phases（分母 = 任务总数）。 */
function expectedStats(doc) {
  const tasks = Array.isArray(doc.tasks) ? doc.tasks : [];
  const total = tasks.length;
  const phases = PHASE_KEYS.map((key) => {
    const counts = PHASE_ENUM.map((value) => tasks.filter((task) => task.phases && task.phases[key] === value).length);
    return { key, name: PHASE_LABELS[key], counts, percentages: expectedPercentages(counts, total) };
  });
  const aggregateCounts = PHASE_ENUM.map((value, index) => phases.reduce((sum, phase) => sum + phase.counts[index], 0));
  const aggregateDenominator = total * PHASE_KEYS.length;
  return {
    total,
    aggregate: { denominator: aggregateDenominator, counts: aggregateCounts, percentages: expectedPercentages(aggregateCounts, aggregateDenominator) },
    phases
  };
}

/* ------------------------------------------------------------------ 构造数据 */

function seedDoc() {
  return JSON.parse(fs.readFileSync(path.join(APP_DIR, 'data', 'wbs.seed.json'), 'utf8'));
}

/* 按每阶段五状态目标计数造任务（每阶段计数之和都等于任务总数）。 */
function docFromCounts(shape, totalOverride) {
  const doc = seedDoc();
  const total = totalOverride || shape.design.reduce((sum, n) => sum + n, 0);
  const tasks = doc.tasks.slice(0, total);
  tasks.forEach((task, index) => {
    task.dates = {};
    task.phases = {};
    PHASE_KEYS.forEach((key) => {
      task.dates[key] = '2026-12-31';
      let rest = index;
      let value = PHASE_ENUM[PHASE_ENUM.length - 1];
      for (let i = 0; i < PHASE_ENUM.length; i += 1) {
        if (rest < (shape[key][i] || 0)) { value = PHASE_ENUM[i]; break; }
        rest -= (shape[key][i] || 0);
      }
      task.phases[key] = value;
    });
  });
  doc.meta.revision = 0;
  doc.tasks = tasks;
  return doc;
}

const SHAPES = {
  mixed: { design: [8, 7, 7, 7, 7], dev: [6, 8, 8, 7, 7], test: [5, 5, 5, 16, 5], product: [4, 4, 4, 4, 20], demo_prep: [36, 0, 0, 0, 0] },
  skew: { design: [36, 0, 0, 0, 0], dev: [0, 36, 0, 0, 0], test: [0, 0, 36, 0, 0], product: [0, 0, 0, 36, 0], demo_prep: [0, 0, 0, 0, 36] },
  single: { design: [0, 0, 0, 0, 36], dev: [36, 0, 0, 0, 0], test: [0, 36, 0, 0, 0], product: [0, 0, 36, 0, 0], demo_prep: [36, 0, 0, 0, 0] },
  ones: { design: [1, 1, 1, 0, 0], dev: [1, 1, 0, 0, 0], test: [0, 0, 0, 0, 3], product: [1, 0, 1, 0, 1], demo_prep: [3, 0, 0, 0, 0] },
  /* 全量分母 = 3 × 5 = 15：14 项未开始 + 1 项已开始 → 93.3 / 6.7（聚合层最大余数法生效）。 */
  dense: { design: [3, 0, 0, 0, 0], dev: [3, 0, 0, 0, 0], test: [3, 0, 0, 0, 0], product: [2, 1, 0, 0, 0], demo_prep: [3, 0, 0, 0, 0] }
};

const signature = (stats) => {
  const group = (statuses) => statuses.map((item) => item.value + '=' + item.count + '/' + item.percentage.toFixed(1)).join(',');
  return 'A[' + group((stats.aggregate || { statuses: [] }).statuses) + ']P[' +
    (stats.phases || []).map((phase) => phase.key + ':' + group(phase.statuses)).join('|') + ']';
};

let shared = null;
function compareWithExpected(id, stats, doc, detail) {
  const expected = expectedStats(doc);
  const problems = [];
  const aggregate = stats.aggregate || { statuses: [] };
  const aggStatuses = aggregate.statuses || [];
  const phaseKeys = ['aggregate.key', 'aggregate.name', 'aggregate.denominator'];
  if (aggregate.key !== 'aggregate') problems.push('aggregate.key=' + aggregate.key);
  if (typeof aggregate.name !== 'string' || aggregate.name === '') problems.push('aggregate.name=' + aggregate.name);
  if (aggregate.denominator !== expected.aggregate.denominator) problems.push('aggregate.denominator=' + aggregate.denominator + ' 期望 ' + expected.aggregate.denominator);
  if (aggStatuses.length !== PHASE_ENUM.length) problems.push('aggregate.statuses 长度=' + aggStatuses.length);
  PHASE_ENUM.forEach((value, j) => {
    const actual = aggStatuses[j] || {};
    if (actual.value !== value) problems.push('aggregate 顺序 ' + j + '=' + actual.value);
    if (actual.count !== expected.aggregate.counts[j]) problems.push('aggregate/' + value + ' count=' + actual.count + ' 期望 ' + expected.aggregate.counts[j]);
    if (Math.abs(Number(actual.percentage) - expected.aggregate.percentages[j]) > 1e-9) {
      problems.push('aggregate/' + value + ' pct=' + actual.percentage + ' 期望 ' + expected.aggregate.percentages[j]);
    }
  });
  const aggSum = aggStatuses.reduce((sum, item) => sum + Number(item.percentage), 0);
  if (Math.abs(aggSum - 100) > 1e-9) problems.push('aggregate 五项合计=' + aggSum);
  (stats.phases || []).forEach((phase, index) => {
    const want = expected.phases[index] || {};
    if (phase.key !== want.key) problems.push('phase.key=' + phase.key);
    if (phase.name !== want.name) problems.push(phase.key + '.name=' + phase.name + ' 期望 ' + want.name);
    (phase.statuses || []).forEach((item, j) => {
      if (item.count !== want.counts[j]) problems.push(phase.key + '/' + item.value + ' count=' + item.count + ' 期望 ' + want.counts[j]);
      if (Math.abs(Number(item.percentage) - want.percentages[j]) > 1e-9) {
        problems.push(phase.key + '/' + item.value + ' pct=' + item.percentage + ' 期望 ' + want.percentages[j]);
      }
    });
    const sum = phase.statuses.reduce((total2, item) => total2 + item.percentage, 0);
    if (Math.abs(sum - 100) > 1e-9) problems.push(phase.key + ' 五项合计=' + sum);
  });
  check(id, problems.length === 0, problems.length ? problems.slice(0, 5) : Object.assign({ total: stats.total, keys: phaseKeys.length }, detail || {}));
}

function spawnServer(name, port, dataDir) {
  const child = spawn(process.execPath, [path.join(APP_DIR, 'server.js')], {
    cwd: APP_DIR,
    env: Object.assign({}, process.env, { WBS_DATA_DIR: dataDir, WBS_PORT: String(port), WBS_HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.on('data', (chunk) => process.stderr.write('[' + name + '] ' + chunk));
  server = child;
  return child;
}
let server = null;
async function waitReady(base) {
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(base + '/api/health')).ok) return; } catch (err) { /* 未就绪 */ }
    await sleep(100);
  }
  throw new Error('被测服务未就绪：' + base);
}

(async () => {
  try {
    fs.rmSync(OUTDIR, { recursive: true, force: true });
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.copyFileSync(path.join(APP_DIR, 'data', 'wbs.seed.json'), path.join(DATA_DIR, 'wbs.seed.json'));
    writeDoc(docFromCounts(SHAPES.mixed));
    spawnServer('A', PORT, DATA_DIR);
    await waitReady(BASE);
    console.log('[env] 被测服务 ' + BASE + '（data: ' + DATA_DIR + '）');

    /* ============ 矩阵01：全量统计结构 + 五阶段合并语义 ============ */
    let stats = (await api('/api/stats')).body;
    shared = stats;
    const structureOk = !!(stats && stats.ok === true && stats.total === 36) &&
      !!(stats.aggregate && Array.isArray(stats.aggregate.statuses) && stats.aggregate.statuses.length === 5) &&
      Array.isArray(stats.phases) && stats.phases.length === 5 &&
      stats.aggregate.statuses.every((item) => typeof item.value === 'string' && Number.isInteger(item.count) &&
        typeof item.percentage === 'number' && Math.abs(item.percentage * 10 - Math.round(item.percentage * 10)) < 1e-9);
    check('矩阵01a /api/stats 同时给出两组结果：aggregate（全量合并，statuses[5]）+ phases（分阶段，5 × statuses[5]），结构自描述、顺序固定',
      structureOk && stats.aggregate.statuses.map((item) => item.value).join(',') === PHASE_ENUM.join(',') &&
      stats.phases.map((phase) => phase.key).join(',') === PHASE_KEYS.join(','),
      { total: stats.total, aggregateDenominator: stats.aggregate.denominator, phases: stats.phases.map((phase) => phase.key) });
    check('矩阵01b 全量分母 = 任务总数 × 5（聚合层自描述 denominator），与 phases 分母 = 任务总数（CH-14 原口径）并存',
      stats.aggregate.denominator === stats.total * 5 &&
      stats.aggregate.statuses.reduce((sum, item) => sum + item.count, 0) === stats.total * 5 &&
      stats.phases.every((phase) => phase.statuses.reduce((sum, item) => sum + item.count, 0) === stats.total),
      { total: stats.total, aggregateDenominator: stats.aggregate.denominator });

    /* ============ 矩阵02 / 03：与独立复算逐项一致（多组组合 + 聚合层最大余数法） ============ */
    compareWithExpected('矩阵02a 组合一（mixed）：aggregate 与 phases 的 count / percentage 与 /api/wbs 独立复算逐项一致', stats, docFromCounts(SHAPES.mixed));

    let doc = docFromCounts(SHAPES.skew);
    writeDoc(doc);
    stats = (await api('/api/stats')).body;
    compareWithExpected('矩阵02b 组合二（skew，每阶段单状态满编）：aggregate 五状态计数 = 任务总数（每状态 36），占比各 20.0%', stats, doc);

    doc = docFromCounts(SHAPES.single);
    writeDoc(doc);
    stats = (await api('/api/stats')).body;
    compareWithExpected('矩阵02c 组合三（single，阶段间状态互斥）：aggregate 与 phases 逐项一致', stats, doc);

    doc = docFromCounts(SHAPES.dense, 3);
    writeDoc(doc);
    stats = (await api('/api/stats')).body;
    const dense = stats.aggregate.statuses.map((item) => item.count + '/' + item.percentage.toFixed(1));
    check('矩阵03a 聚合层最大余数法：分母 15 的 14/1 分布下五项合计恰为 100.0%（未开始 93.3 / 已开始 6.7）',
      dense.join(' ') === '14/93.3 1/6.7 0/0.0 0/0.0 0/0.0' &&
      Math.abs(stats.aggregate.statuses.reduce((sum, item) => sum + item.percentage, 0) - 100) < 1e-9,
      dense);
    compareWithExpected('矩阵03b 同一组数据下 aggregate 与 phases 两组结果仍与独立复算逐项一致（两组各自补齐、互不影响）', stats, docFromCounts(SHAPES.dense, 3));

    doc = docFromCounts(SHAPES.ones);
    writeDoc(doc);
    stats = (await api('/api/stats')).body;
    const ones = stats.phases[0].statuses.map((item) => item.percentage).join(',');
    check('矩阵03c 阶段层保真：1/1/1 分布下单阶段五项合计仍恰为 100.0%（最大余数法 33.4 / 33.3 / 33.3 / 0.0 / 0.0，CH-14 口径不回归）',
      ones === '33.4,33.3,33.3,0,0', ones);

    doc = { meta: { name: '空表', revision: 0 }, identities: seedDoc().identities, tasks: [] };
    writeDoc(doc);
    const emptyRes = await api('/api/stats');
    const emptyAgg = (emptyRes.body.aggregate || { statuses: [] }).statuses
      .map((item) => item.count + ' ' + item.percentage.toFixed(1) + '%').join(' | ');
    const emptyPhases = (emptyRes.body.phases || []).map((phase) => phase.statuses
      .map((item) => item.count + ' ' + item.percentage.toFixed(1) + '%').join(' | '));
    check('矩阵03d 任务总数为 0：不除零、不报错（HTTP 200），aggregate（分母 0）与 phases 全部为「0 0.0%」',
      emptyRes.status === 200 && emptyRes.body.ok === true && emptyRes.body.total === 0 && emptyRes.body.aggregate.denominator === 0 &&
      emptyAgg === '0 0.0% | 0 0.0% | 0 0.0% | 0 0.0% | 0 0.0%' &&
      emptyPhases.every((line) => line === '0 0.0% | 0 0.0% | 0 0.0% | 0 0.0% | 0 0.0%'),
      { aggregate: emptyAgg, phases: emptyPhases[0] });

    /* 脏数据（缺 phases）导致聚合计数之和 < 分母：只做截断、不臆造补齐。 */
    const allSame = { design: [36, 0, 0, 0, 0], dev: [36, 0, 0, 0, 0], test: [36, 0, 0, 0, 0], product: [36, 0, 0, 0, 0], demo_prep: [36, 0, 0, 0, 0] };
    doc = docFromCounts(allSame);
    delete doc.tasks[0].phases;
    writeDoc(doc);
    const dirtyRes = (await api('/api/stats')).body;
    const dirtyAggSum = dirtyRes.aggregate.statuses.reduce((sum, item) => sum + item.percentage, 0);
    check('矩阵03e 脏数据防御：任一行缺 phases 时聚合计数之和 ≠ 分母，aggregate / phases 都只做 1 位小数截断、不臆造补齐到 100.0%',
      dirtyRes.total === 36 && dirtyRes.aggregate.denominator === 180 &&
      dirtyRes.aggregate.statuses[0].count === 175 && Math.abs(dirtyAggSum - 97.2) < 1e-9 &&
      dirtyRes.phases[0].statuses[0].count === 35,
      { total: dirtyRes.total, aggregateSum: dirtyAggSum, 未开始: dirtyRes.aggregate.statuses[0] });

    /* ============ 矩阵04：改名口径（阶段显示名 / 接口 key 不变） ============ */
    writeDoc(docFromCounts(SHAPES.mixed));
    stats = (await api('/api/stats')).body;
    check('矩阵04a 阶段显示名：phases[3].name = 「产品验收」（其余四个阶段名不变），接口 key 仍为 product',
      stats.phases.length === 5 && stats.phases[3].key === 'product' && stats.phases[3].name === '产品验收' &&
      stats.phases.map((phase) => phase.name).join(',') === '设计,开发,测试,产品验收,演示准备',
      { names: stats.phases.map((phase) => phase.name), keys: stats.phases.map((phase) => phase.key) });
    const wbs = (await api('/api/wbs')).body;
    check('矩阵04b JSON 字段不变：文档内仍为 task.phases.product（含 phases.<阶段> 五键），A–K 原数据未被改写',
      wbs.tasks.every((task) => task.phases && Object.keys(task.phases).join(',') === PHASE_KEYS.join(',')) &&
      wbs.tasks[0].id === seedDoc().tasks[0].id &&
      JSON.stringify(wbs.tasks.map((task) => [task.level1, task.level2, task.task, task.owner, task.demo, task.note])) ===
        JSON.stringify(seedDoc().tasks.slice(0, wbs.tasks.length).map((task) => [task.level1, task.level2, task.task, task.owner, task.demo, task.note])),
      { keys: Object.keys(wbs.tasks[0].phases), tasks: wbs.tasks.length });

    /* ============ 只读语义与口径来源 ============ */
    const before = fs.statSync(DATA_FILE);
    const beforeBytes = fs.readFileSync(DATA_FILE);
    const auditBefore = fs.existsSync(AUDIT_FILE) ? fs.readFileSync(AUDIT_FILE) : Buffer.from('');
    let statsRes = null;
    for (let i = 0; i < 5; i += 1) statsRes = await api('/api/stats');
    const after = fs.statSync(DATA_FILE);
    const auditAfter = fs.existsSync(AUDIT_FILE) ? fs.readFileSync(AUDIT_FILE) : Buffer.from('');
    check('只读口径：/api/stats 与 /api/wbs 读同一份文档（同 revision、同 total），连读 5 次不改盘、不写审计、不改 revision',
      statsRes.body.revision === wbs.meta.revision && statsRes.body.total === wbs.tasks.length &&
      before.size === after.size && before.mtimeMs === after.mtimeMs &&
      beforeBytes.equals(fs.readFileSync(DATA_FILE)) && auditBefore.equals(auditAfter),
      { revision: statsRes.body.revision, size: after.size });

    const postRes = await api('/api/stats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const putRes = await api('/api/stats', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const delRes = await api('/api/stats', { method: 'DELETE' });
    check('只读口径：/api/stats 仅接受 GET（POST / PUT / DELETE 均 405，不产生任何写入路径）',
      postRes.status === 405 && putRes.status === 405 && delRes.status === 405,
      { post: postRes.status, put: putRes.status, del: delRes.status });

    const headers = statsRes.headers;
    check('矩阵10b /api/stats 不构成下载路径（application/json、无 Content-Disposition、no-store）',
      /application\/json/.test(headers.get('content-type') || '') && headers.get('content-disposition') === null &&
      (headers.get('cache-control') || '').indexOf('no-store') !== -1,
      { contentType: headers.get('content-type'), disposition: headers.get('content-disposition') });

    check('矩阵02d aggregate 与 phases 同源：aggregate 五状态计数逐项等于 phases 五阶段同状态计数之和（一次遍历、无二次统计）',
      PHASE_ENUM.every((value, j) => stats.aggregate.statuses[j].count ===
        stats.phases.reduce((sum, phase) => sum + phase.statuses[j].count, 0)),
      stats.aggregate.statuses.map((item) => item.count).join(','));

    /* 独立实例 B：验证写操作后两组结果与 revision 同步。 */
    const portB = PORT + 1;
    const dirB = path.join(OUTDIR, 'data-b');
    fs.mkdirSync(dirB, { recursive: true });
    fs.copyFileSync(path.join(APP_DIR, 'data', 'wbs.seed.json'), path.join(dirB, 'wbs.seed.json'));
    fs.writeFileSync(path.join(dirB, 'wbs.json'), JSON.stringify(docFromCounts(SHAPES.mixed), null, 2) + '\n');
    spawnServer('B', portB, dirB);
    const baseB = 'http://127.0.0.1:' + portB;
    await waitReady(baseB);
    const docB = await (await fetch(baseB + '/api/wbs')).json();
    const putB = await fetch(baseB + '/api/wbs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': String(docB.meta.revision), 'X-Identity': encodeURIComponent('项目负责人') },
      body: JSON.stringify({ meta: { name: docB.meta.name }, identities: docB.identities, tasks: docB.tasks.slice(0, 7) })
    });
    const statsB = await (await fetch(baseB + '/api/stats')).json();
    compareWithExpected('矩阵02e 保存后口径随文档走：PUT 改为 7 行后 aggregate（分母 35）与 phases 两组结果都与独立复算一致', statsB, { tasks: docB.tasks.slice(0, 7) });
    check('矩阵02f 保存后 revision 同步（/api/stats.revision 与 /api/wbs.meta.revision 一致），aggregate 分母随任务数重算',
      putB.status === 200 && statsB.revision === (await (await fetch(baseB + '/api/wbs')).json()).meta.revision &&
      statsB.aggregate.denominator === 35,
      { status: putB.status, statsRevision: statsB.revision, denominator: statsB.aggregate.denominator });

    fs.writeFileSync(path.join(OUTDIR, 'statcheck-results.json'), JSON.stringify(results, null, 2));
  } catch (err) {
    check('stage19 服务端口径用例集执行', false, err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : String(err));
  } finally {
    if (server) await new Promise((resolve) => { server.once('exit', resolve); server.kill('SIGTERM'); setTimeout(resolve, 3000); });
  }
  console.log('---');
  console.log('PASS=' + pass + ' FAIL=' + fail);
  process.exit(fail === 0 ? 0 : 1);
})();
