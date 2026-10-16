'use strict';
/* YUNZ-37 / 变更包 #7（CH-14 阶段状态占比总览 + GET /api/stats）服务端口径自测。
   运行在宿主（Node 标准库 + 被测服务，无浏览器依赖）：起隔离数据目录的被测服务，构造多组
   「五阶段 × 五状态」数据组合，逐条断言 02 / 03 / 只读与边界口径。宿主 node 为 docker 包装脚本，
   因此所有路径都用 APP_DIR 内的相对路径（容器以 cwd 挂载同一路径）。
   用法：node tests/stage17/statcheck.cjs
   不触碰运行现场 /opt/wbs-rongcheng/data 与 0.0.0.0:4180。 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const APP_DIR = process.env.APP_DIR || '/opt/wbs-rongcheng';
const PORT = Number(process.env.WBS_STATS_PORT || 4295);
const BASE = 'http://127.0.0.1:' + PORT;
const OUTDIR = process.env.OUTDIR || path.join(APP_DIR, 'tests/.tmp/stage17-stats');
const DATA_DIR = path.join(OUTDIR, 'data');
const DATA_FILE = path.join(DATA_DIR, 'wbs.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.log');
const PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep'];
const PHASE_LABELS = { design: '设计', dev: '开发', test: '测试', product: '产品', demo_prep: '演示准备' };
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

/* 契约口径：分母 = 当前任务总数；百分比 = count/total*100 保留 1 位小数；
   五项合计因四舍五入不足 100.0% 时用最大余数法补齐（余数相同按未开始→阻塞顺序）；
   总数为 0 → 全 0 且不除零。计数之和与总数不一致（脏数据）时只做截断、不补齐。 */
function expectedPercentages(counts, total) {
  if (!total) return counts.map(() => 0);
  const units = counts.map((count) => {
    const scaled = count * 1000;
    return { tenths: Math.floor(scaled / total), remainder: scaled % total };
  });
  const counted = counts.reduce((sum, count) => sum + count, 0);
  const out = units.map((unit) => unit.tenths);
  if (counted === total) {
    let deficit = 1000 - out.reduce((sum, value) => sum + value, 0);
    const order = units
      .map((unit, index) => ({ index, remainder: unit.remainder }))
      .sort((a, b) => (b.remainder - a.remainder) || (a.index - b.index));
    for (let i = 0; i < deficit; i += 1) out[order[i % order.length].index] += 1;
  }
  return out.map((value) => value / 10);
}

/* 依据文档独立统计：返回 [phases][statuses] 的 count / percentage。 */
function expectedStats(doc) {
  const tasks = Array.isArray(doc.tasks) ? doc.tasks : [];
  return {
    total: tasks.length,
    phases: PHASE_KEYS.map((key) => {
      const counts = PHASE_ENUM.map((value) => tasks.filter((task) => task.phases && task.phases[key] === value).length);
      const percentages = expectedPercentages(counts, tasks.length);
      return { key, name: PHASE_LABELS[key], counts, percentages };
    })
  };
}

/* ------------------------------------------------------------------ 构造数据 */

function seedDoc() {
  return JSON.parse(fs.readFileSync(path.join(APP_DIR, 'data', 'wbs.seed.json'), 'utf8'));
}

/* 按每阶段五状态的目标计数切分任务（五阶段计数之和都等于任务数）。 */
function docFromCounts(shape) {
  const doc = seedDoc();
  const tasks = doc.tasks.slice(0, shape.design.reduce((sum, n) => sum + n, 0));
  doc.meta.revision = 0;
  tasks.forEach((task, index) => {
    task.phases = {};
    task.dates = task.dates || {};
    PHASE_KEYS.forEach((key) => task.dates[key] = task.dates[key] || '');
    PHASE_KEYS.forEach((key) => {
      let rest = index;
      for (let i = 0; i < PHASE_ENUM.length; i += 1) {
        if (rest < shape[key][i]) { task.phases[key] = PHASE_ENUM[i]; return; }
        rest -= shape[key][i];
      }
      task.phases[key] = PHASE_ENUM[0];
    });
  });
  doc.tasks = tasks;
  return doc;
}

/* 三组不同状态组合 + 全同状态 + 极端（单状态满编）。 */
const SHAPES = {
  mixed: { design: [8, 7, 7, 7, 7], dev: [6, 8, 8, 7, 7], test: [5, 5, 5, 16, 5], product: [4, 4, 4, 4, 20], demo_prep: [36, 0, 0, 0, 0] },
  skew: { design: [30, 1, 1, 2, 2], dev: [1, 1, 1, 1, 32], test: [0, 0, 0, 0, 36], product: [18, 18, 0, 0, 0], demo_prep: [6, 6, 6, 6, 12] },
  single: { design: [36, 0, 0, 0, 0], dev: [0, 36, 0, 0, 0], test: [0, 0, 36, 0, 0], product: [0, 0, 0, 36, 0], demo_prep: [0, 0, 0, 0, 36] },
  ones: { design: [1, 1, 1, 0, 0], dev: [1, 1, 1, 0, 0], test: [1, 1, 1, 0, 0], product: [1, 1, 1, 0, 0], demo_prep: [1, 1, 1, 0, 0] }
};

const servers = {};
function spawnServer(name, port, dataDir) {
  const child = spawn(process.execPath, [path.join(APP_DIR, 'server.js')], {
    cwd: APP_DIR,
    env: Object.assign({}, process.env, { WBS_DATA_DIR: dataDir, WBS_PORT: String(port), WBS_HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.on('data', (chunk) => process.stderr.write('[' + name + '] ' + chunk));
  servers[name] = child;
  return child;
}
async function waitReady(base) {
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(base + '/api/health')).ok) return; } catch (err) { /* 未就绪 */ }
    await sleep(100);
  }
  throw new Error('被测服务未就绪：' + base);
}
function stopServer(name) {
  return new Promise((resolve) => {
    const child = servers[name];
    if (!child) return resolve();
    delete servers[name];
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(resolve, 3000);
  });
}

/* 断言 /api/stats 与独立复算逐项一致（count / percentage / 顺序 / 阶段名 / 总数）。 */
function compareWithExpected(id, stats, doc) {
  const expected = expectedStats(doc);
  const problems = [];
  if (stats.total !== expected.total) problems.push('total=' + stats.total + ' 期望 ' + expected.total);
  if (!Array.isArray(stats.phases) || stats.phases.length !== 5) problems.push('phases 非五组');
  expected.phases.forEach((phase, index) => {
    const actual = (stats.phases || [])[index] || {};
    if (actual.key !== phase.key) problems.push('phases[' + index + '].key=' + actual.key);
    if (actual.name !== phase.name) problems.push(actual.key + '.name=' + actual.name);
    const statuses = actual.statuses || [];
    if (statuses.length !== 5) problems.push(actual.key + '.statuses 非五项');
    PHASE_ENUM.forEach((value, j) => {
      const item = statuses[j] || {};
      if (item.value !== value) problems.push(actual.key + ' 顺序 ' + item.value);
      if (item.count !== phase.counts[j]) problems.push(actual.key + '/' + value + ' count=' + item.count + ' 期望 ' + phase.counts[j]);
      if (Math.abs(item.percentage - phase.percentages[j]) > 1e-9) {
        problems.push(actual.key + '/' + value + ' pct=' + item.percentage + ' 期望 ' + phase.percentages[j]);
      }
    });
    const sum = statuses.reduce((total2, item) => total2 + item.percentage, 0);
    if (Math.abs(sum - 100) > 1e-9) problems.push(actual.key + ' 五项合计=' + sum);
  });
  check(id, problems.length === 0, problems.length ? problems.slice(0, 4) : { total: stats.total, phases: 5 });
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

    /* ============ 矩阵02：结构 + 与 /api/wbs 独立复算一致（多组不同状态组合） ============ */
    let stats = (await api('/api/stats')).body;
    const shapeOk = stats && stats.ok === true && stats.total === 36 && Array.isArray(stats.phases) &&
      stats.phases.every((phase) => typeof phase.key === 'string' && typeof phase.name === 'string' && Array.isArray(phase.statuses) &&
        phase.statuses.every((item) => typeof item.value === 'string' && Number.isInteger(item.count) &&
          typeof item.percentage === 'number' && Math.abs(item.percentage * 10 - Math.round(item.percentage * 10)) < 1e-9));
    check('矩阵02a /api/stats 结构自描述且稳定（ok / total / revision / phases[5]，每阶段 statuses[5]：value+count+percentage 一位小数）',
      shapeOk && stats.phases.map((phase) => phase.key).join(',') === PHASE_KEYS.join(',') &&
      JSON.stringify(stats.phases.map((phase) => phase.statuses.map((item) => item.value))) === JSON.stringify(PHASE_KEYS.map(() => PHASE_ENUM)),
      { total: stats.total, keys: stats.phases.map((phase) => phase.key) });

    compareWithExpected('矩阵02b 组合一（mixed）：五阶段 × 五状态 count / percentage 与 /api/wbs 独立复算逐项一致', stats, docFromCounts(SHAPES.mixed));

    let doc = docFromCounts(SHAPES.skew);
    writeDoc(doc);
    stats = (await api('/api/stats')).body;
    compareWithExpected('矩阵02c 组合二（skew）：单状态满编 / 大量 0 项组合下 count / percentage 仍逐项一致', stats, doc);

    doc = docFromCounts(SHAPES.single);
    writeDoc(doc);
    stats = (await api('/api/stats')).body;
    compareWithExpected('矩阵02d 组合三（single）：每阶段单状态 100.0% / 其余 0.0%', stats, doc);

    /* ============ 矩阵03：分母 / 精度 / 最大余数法 / 0 行边界 ============ */
    doc = docFromCounts(SHAPES.ones);
    writeDoc(doc);
    stats = (await api('/api/stats')).body;
    const ones = stats.phases[0].statuses;
    check('矩阵03a 完整体边界：1/1/1 分布下单阶段五项合计恰为 100.0%（最大余数法 33.4 / 33.3 / 33.3 / 0.0 / 0.0）',
      ones.map((item) => item.percentage).join(',') === '33.4,33.3,33.3,0,0' &&
      Math.abs(ones.reduce((sum, item) => sum + item.percentage, 0) - 100) < 1e-9,
      ones.map((item) => item.count + '/' + item.percentage).join(' '));

    doc = { meta: { name: '空表', revision: 0 }, identities: seedDoc().identities, tasks: [] };
    writeDoc(doc);
    const emptyRes = await api('/api/stats');
    const emptyBadges = (emptyRes.body.phases || []).map((phase) => phase.statuses
      .map((item) => item.count + ' ' + item.percentage.toFixed(1) + '%').join(' | '));
    check('矩阵03b 任务总数为 0：不除零、不报错（HTTP 200），五阶段 × 五状态全部为「0 0.0%」',
      emptyRes.status === 200 && emptyRes.body.ok === true && emptyRes.body.total === 0 &&
      emptyBadges.every((line) => line === '0 0.0% | 0 0.0% | 0 0.0% | 0 0.0% | 0 0.0%'),
      emptyBadges[0]);

    /* 脏数据（缺 phases）导致计数之和 < 总数：只做截断、不臆造补齐。 */
    const allSame = { design: [36, 0, 0, 0, 0], dev: [36, 0, 0, 0, 0], test: [36, 0, 0, 0, 0], product: [36, 0, 0, 0, 0], demo_prep: [36, 0, 0, 0, 0] };
    doc = docFromCounts(allSame);
    delete doc.tasks[0].phases;
    writeDoc(doc);
    const dirtyRes = (await api('/api/stats')).body;
    const dirtySum = dirtyRes.phases[0].statuses.reduce((sum, item) => sum + item.percentage, 0);
    check('矩阵03c 脏数据防御：任一行缺 phases 时计数之和 ≠ 总数，服务端只做 1 位小数截断、不臆造占比（不强行补到 100.0%）',
      dirtyRes.total === 36 && dirtyRes.phases[0].statuses[0].count === 35 &&
      Math.abs(dirtySum - 97.2) < 1e-9,
      { total: dirtyRes.total, 未开始: dirtyRes.phases[0].statuses[0], sum: dirtySum });

    /* ============ 只读与口径一致性 ============ */
    writeDoc(docFromCounts(SHAPES.mixed));
    const before = fs.statSync(DATA_FILE);
    const beforeBytes = fs.readFileSync(DATA_FILE);
    const auditBefore = fs.existsSync(AUDIT_FILE) ? fs.readFileSync(AUDIT_FILE) : Buffer.from('');
    const wbs = (await api('/api/wbs')).body;
    let statsRes = null;
    for (let i = 0; i < 5; i += 1) statsRes = await api('/api/stats');
    const after = fs.statSync(DATA_FILE);
    const auditAfter = fs.existsSync(AUDIT_FILE) ? fs.readFileSync(AUDIT_FILE) : Buffer.from('');
    check('只读口径：/api/stats 与 /api/wbs 读同一份文档（同 revision、同数据），连读 5 次不改盘、不写审计、不改 revision',
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

    /* 独立实例 B：验证总数变化后 revision / total 同步（保存后口径随文档走）。 */
    const setBPort = PORT + 1;
    const DIR_B = path.join(OUTDIR, 'data-b');
    fs.mkdirSync(DIR_B, { recursive: true });
    fs.copyFileSync(path.join(APP_DIR, 'data', 'wbs.seed.json'), path.join(DIR_B, 'wbs.seed.json'));
    fs.writeFileSync(path.join(DIR_B, 'wbs.json'), JSON.stringify(docFromCounts(SHAPES.mixed), null, 2) + '\n');
    spawnServer('B', setBPort, DIR_B);
    await waitReady('http://127.0.0.1:' + setBPort);
    const baseB = 'http://127.0.0.1:' + setBPort;
    const docB = (await fetch(baseB + '/api/wbs')).json ? await (await fetch(baseB + '/api/wbs')).json() : null;
    const putB = await fetch(baseB + '/api/wbs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': String(docB.meta.revision), 'X-Identity': encodeURIComponent('项目负责人') },
      body: JSON.stringify({ meta: { name: docB.meta.name }, identities: docB.identities, tasks: docB.tasks.slice(0, 3) })
    });
    const statsB = await (await fetch(baseB + '/api/stats')).json();
    compareWithExpected('矩阵02e 保存后口径随文档走：PUT 改为 3 行后 /api/stats 的 total / count / percentage 与独立复算一致', statsB, { tasks: docB.tasks.slice(0, 3) });
    check('矩阵02f 保存后 revision 同步（/api/stats.revision 与 /api/wbs.meta.revision 一致）',
      putB.status === 200 && statsB.revision === (await (await fetch(baseB + '/api/wbs')).json()).meta.revision,
      { status: putB.status, statsRevision: statsB.revision });
    await stopServer('B');

    fs.writeFileSync(path.join(OUTDIR, 'statcheck-results.json'), JSON.stringify(results, null, 2));
  } catch (err) {
    check('stage17 服务端口径用例集执行', false, err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : String(err));
  } finally {
    await stopServer('A');
  }
  console.log('---');
  console.log('PASS=' + pass + ' FAIL=' + fail);
  process.exit(fail === 0 ? 0 : 1);
})();
