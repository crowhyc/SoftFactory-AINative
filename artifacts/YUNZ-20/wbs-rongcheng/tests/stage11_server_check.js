'use strict';
/* YUNZ-31 / 变更包 #4：服务端用例集（迁移一次性/幂等/边界、字段级审计、409、/api/daily 派生与三 sheet 数据）。
   隔离数据目录 + 独立端口，不触碰运行现场。用法：node tests/stage11_server_check.js */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const APP_DIR = process.env.APP_DIR || path.join(__dirname, '..');
const TZ = 'Asia/Shanghai';
const PHASES = ['未开始', '已开始', '已完成', '延期', '阻塞'];
const PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep'];
const BASE_TMP = process.env.TMP_DIR || path.join(APP_DIR, 'tests/.tmp/stage11-server');
let pass = 0, fail = 0;
function ok(id, extra) { pass += 1; console.log('PASS  ' + id + (extra ? '  :: ' + extra : '')); }
function bad(id, detail) { fail += 1; console.log('FAIL  ' + id + '  -> ' + detail); }
function assert(cond, message) { if (!cond) throw new Error(message); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function shiftDay(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + delta);
  return at.toISOString().slice(0, 10);
}
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

let port = Number(process.env.WBS_TEST_PORT || 4245);
const servers = [];
async function startServer(dataDir, options) {
  const opts = options || {};
  const p = opts.port || (port += 1);
  const base = 'http://127.0.0.1:' + p;
  const child = spawn(process.execPath, [path.join(APP_DIR, 'server.js')], {
    cwd: APP_DIR,
    env: Object.assign({}, process.env, { WBS_DATA_DIR: dataDir, WBS_PORT: String(p), WBS_HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.on('data', (c) => { stdout += '[stderr] ' + c; });
  servers.push(child);
  for (let i = 0; i < 150; i += 1) {
    try { if ((await fetch(base + '/api/health')).ok) return { base, child, out: () => stdout }; } catch (err) { /* wait */ }
    await sleep(100);
  }
  throw new Error('服务未就绪 ' + base + '\n' + stdout);
}
function stopServer(handle) {
  return new Promise((resolve) => {
    const child = handle.child;
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(resolve, 3000);
  });
}
const api = async (base, url, init) => {
  const response = await fetch(base + url, init);
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch (err) { body = text; }
  return { status: response.status, body };
};
const diskDoc = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'wbs.json'), 'utf8'));
const auditLines = (dir) => fs.readFileSync(path.join(dir, 'audit.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

function freshDir(name) {
  const dir = path.join(BASE_TMP, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function seedWithDates(today) {
  const seed = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'data', 'wbs.seed.json'), 'utf8'));
  const byId = {};
  seed.tasks.forEach((t) => { byId[t.id] = t; });
  byId.T001.dates.design = shiftDay(today, -1);  // 昨天 → 延期
  byId.T002.dates.design = shiftDay(today, -7);  // 更早 → 延期
  byId.T003.dates.test = today;                  // 恰好今天 → 未开始
  byId.T003.dates.dev = shiftDay(today, 3);      // 未来 → 未开始
  return seed;
}

(async () => {
  fs.mkdirSync(BASE_TMP, { recursive: true });
  const today = todayStr();
  const yesterday = shiftDay(today, -1);
  try {
    /* ---------- 04/05：迁移一次性、备份、幂等、边界 ---------- */
    const dirA = freshDir('migrate');
    fs.writeFileSync(path.join(dirA, 'wbs.json'), JSON.stringify(seedWithDates(today), null, 2) + '\n');
    const before = sha256(path.join(dirA, 'wbs.json'));
    const a = await startServer(dirA);
    const docA = (await api(a.base, '/api/wbs')).body;
    const backups = fs.readdirSync(dirA).filter((f) => /^wbs\.json\.\d{14}\.bak$/.test(f));
    assert(backups.length === 1, '迁移应生成 1 个时间戳备份，实际 ' + backups.length);
    const backupSha = sha256(path.join(dirA, backups[0]));
    assert(backupSha === before, '备份应等于迁移前的 wbs.json（可回滚）');
    ok('矩阵04a 迁移前生成 wbs.json 时间戳备份且内容 = 迁移前文件（可回滚）',
      backups[0] + ' sha256 ' + backupSha.slice(0, 16) + '…');
    const auditA = auditLines(dirA);
    const migratedA = auditA.filter((e) => e.type === 'migrated');
    assert(migratedA.length === 36 * 5, '迁移审计应为每阶段一条（36×5），实际 ' + migratedA.length);
    assert(migratedA.every((e) => e.identity === '系统迁移' && e.field === 'phases.' + e.phase + '.status' && e.old === ''),
      '迁移审计字段/身份不符');
    assert(docA.meta.revision === 1, 'revision 应正常递增到 1，实际 ' + docA.meta.revision);
    ok('矩阵04b 每阶段一条 type:"migrated" 审计、身份「系统迁移」、revision 递增', migratedA.length + ' 条 · revision ' + docA.meta.revision);

    const t1 = docA.tasks.find((t) => t.id === 'T001');
    const t3 = docA.tasks.find((t) => t.id === 'T003');
    assert(t1.phases.design === '延期' && t1.phases.test === '未开始', 'T001 迁移结果异常 ' + JSON.stringify(t1.phases));
    assert(t3.phases.test === '未开始' && t3.phases.dev === '未开始', 'T003 边界结果异常 ' + JSON.stringify(t3.phases));
    assert(docA.tasks.every((t) => PHASE_KEYS.every((k) => PHASES.indexOf(t.phases[k]) !== -1)), 'phases 取值越界');
    ok('矩阵05 迁移边界：昨天 → 延期、恰好今天 → 未开始、未来 → 未开始', JSON.stringify({ T001: t1.phases, T003: t3.phases }));

    const historyA = (await api(a.base, '/api/history?tz=' + TZ + '&date=' + today)).body;
    const dailyA = (await api(a.base, '/api/daily?tz=' + TZ + '&date=' + today)).body;
    assert(historyA.records.length === 0 && dailyA.changes.length === 0, '迁移审计不得进入日报任何 sheet');
    assert(dailyA.summary.filter((r) => r.conclusion.indexOf('到期未更新') !== -1).length === 2,
      '仅昨日/更早的未更新阶段应判定到期未更新，实际 ' + JSON.stringify(dailyA.summary.map((r) => r.line)));
    ok('矩阵04c 迁移审计不进 /api/history 与日报任何 sheet；迁移本身不产生「今日摘要」事件', 'history=0 changes=0');
    ok('矩阵09a（服务端）派生规则①：计划日期 < 今天且今日无更新 → 到期未更新判定延期（2 例：昨天/更早）',
      dailyA.summary.filter((r) => r.conclusion.indexOf('到期未更新') !== -1).map((r) => r.conclusion).join(' / '));

    /* 幂等：重启同一数据目录不应再次迁移 */
    await stopServer(a);
    const a2 = await startServer(dirA, { port: Number(a.base.split(':')[2]) });
    const docA2 = (await api(a2.base, '/api/wbs')).body;
    const auditA2 = auditLines(dirA).filter((e) => e.type === 'migrated');
    const backups2 = fs.readdirSync(dirA).filter((f) => /^wbs\.json\.\d{14}\.bak$/.test(f));
    assert(docA2.meta.revision === docA.meta.revision && auditA2.length === migratedA.length && backups2.length === 1,
      '重复启动不应重复迁移');
    ok('矩阵04d 迁移幂等：重复启动不重复迁移、revision 与审计条数不变', 'revision ' + docA2.meta.revision + ' · migrated ' + auditA2.length);

    /* ---------- 06：保存与 409 + 字段级审计 ---------- */
    const revision = docA2.meta.revision;
    const payload = { meta: { name: docA2.meta.name }, identities: docA2.identities.slice(), tasks: docA2.tasks.map((t) => JSON.parse(JSON.stringify(t))) };
    payload.tasks.find((t) => t.id === 'T001').phases.design = '已完成';
    const put1 = await api(a2.base, '/api/wbs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': String(revision), 'X-Identity': encodeURIComponent('王言') },
      body: JSON.stringify(payload)
    });
    assert(put1.status === 200 && put1.body.revision === revision + 1, '阶段保存应返回 200 且 revision +1');
    const lastAudit = auditLines(dirA).filter((e) => e.type !== 'migrated').pop();
    assert(lastAudit.identity === '王言' && lastAudit.new.T001['phases.design.status'] === '已完成' &&
      lastAudit.old.T001['phases.design.status'] === '延期' && typeof lastAudit.ts === 'string',
      '字段级审计应为 phases.design.status 旧值→新值 + 时间 + 操作身份，实际 ' + JSON.stringify(lastAudit));
    ok('矩阵06a 阶段状态改动走既有保存流程并写字段级审计 phases.design.status old→new + 时间 + 操作身份',
      JSON.stringify(lastAudit.new.T001));

    const stale = revision;
    const payload2 = JSON.parse(JSON.stringify(payload));
    payload2.tasks.find((t) => t.id === 'T002').phases.dev = '阻塞';
    const put2 = await api(a2.base, '/api/wbs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': String(stale), 'X-Identity': encodeURIComponent('项目负责人') },
      body: JSON.stringify(payload2)
    });
    assert(put2.status === 409 && put2.body.current === revision + 1, '旧版本保存应 409');
    const after409 = diskDoc(dirA).tasks.find((t) => t.id === 'T002');
    assert(after409.phases.dev === '未开始', '409 不得覆盖磁盘数据');
    ok('矩阵06b 并发 PUT 409 不覆盖（current=' + put2.body.current + '）', 'disk T002.dev = ' + after409.phases.dev);

    /* 校验：phases 取值非法 / 缺键 → 400 且不落盘 */
    const revNow = (await api(a2.base, '/api/wbs')).body.meta.revision;
    const badPayload = JSON.parse(JSON.stringify(payload));
    badPayload.tasks.find((t) => t.id === 'T001').phases.design = '开工';
    const putBad = await api(a2.base, '/api/wbs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': String(revNow), 'X-Identity': 'x' },
      body: JSON.stringify(badPayload)
    });
    const missing = JSON.parse(JSON.stringify(payload));
    delete missing.tasks.find((t) => t.id === 'T001').phases.test;
    const putMissing = await api(a2.base, '/api/wbs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': String(revNow), 'X-Identity': 'x' },
      body: JSON.stringify(missing)
    });
    assert(putBad.status === 400 && putMissing.status === 400 &&
      (await api(a2.base, '/api/wbs')).body.meta.revision === revNow, '非法 phases 应 400 且不落盘');
    ok('矩阵06c phases 取值非法 / 缺键 → 400 且不落盘', 'phases.design=' + JSON.stringify(putBad.body.errors[0]));

    /* ---------- 08/09/10：/api/daily 三 sheet 数据、派生规则②、旧 status 不引用 ---------- */
    const rev2 = (await api(a2.base, '/api/wbs')).body.meta.revision;
    const doc3 = (await api(a2.base, '/api/wbs')).body;
    const p3 = { meta: { name: doc3.meta.name }, identities: doc3.identities.slice(), tasks: doc3.tasks.map((t) => JSON.parse(JSON.stringify(t))) };
    const t002 = p3.tasks.find((t) => t.id === 'T002');
    t002.phases.design = '已完成';     // 当天完成（原本到期未更新）→ 抑制到期未更新
    t002.dates.test = '2026-11-01';    // 普通字段变更
    p3.tasks.find((t) => t.id === 'T003').phases.dev = '延期';   // 延期行
    p3.tasks.find((t) => t.id === 'T004').phases.dev = '阻塞';   // 阻塞行（应排在延期行之前）
    p3.tasks.find((t) => t.id === 'T005').phases.dev = '阻塞';   // 第二个阻塞行
    const put3 = await api(a2.base, '/api/wbs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': String(rev2), 'X-Identity': encodeURIComponent('王言') },
      body: JSON.stringify(p3)
    });
    assert(put3.status === 200, '构造用例保存失败 ' + JSON.stringify(put3.body));
    const rev4 = put3.body.revision;
    const p4 = JSON.parse(JSON.stringify(p3));
    p4.tasks.find((t) => t.id === 'T002').dates.test = '2026-11-05';
    await api(a2.base, '/api/wbs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': String(rev4), 'X-Identity': encodeURIComponent('王言') },
      body: JSON.stringify(p4)
    });
    const dailyB = (await api(a2.base, '/api/daily?tz=' + TZ + '&date=' + today)).body;
    const linesB = dailyB.summary.map((r) => r.line);
    assert(linesB.some((l) => l.indexOf('【普通】客户端 / 业务工作台 / 需求拆分 @王言：测试计划 11-01 → 11-05。') !== -1),
      '普通变更结论模板不符：' + JSON.stringify(linesB));
    assert(linesB.some((l) => l.indexOf('需求拆分 @王言：阶段已完成。') !== -1 && l.indexOf('【完成】') === 0),
      '完成事件缺失');
    assert(linesB.filter((l) => l.indexOf('需求拆分') !== -1 && l.indexOf('到期未更新') !== -1).length === 0,
      '当天已更新状态时不得重复判定到期未更新（派生规则②）');
    ok('矩阵09b（服务端）派生规则②：当天更新该阶段状态 → 按实际状态出「完成」，不再判到期未更新', linesB.filter((l) => l.indexOf('需求拆分') !== -1).join(' || '));

    const rankOf = (line) => {
      if (line.indexOf('【延期·高风险】') === 0 && line.indexOf('到期未更新') === -1) return 1;
      if (line.indexOf('【阻塞·高风险】') === 0) return 2;
      if (line.indexOf('到期未更新') !== -1) return 3;
      if (line.indexOf('【完成】') === 0) return 4;
      return 5;
    };
    const ranks = linesB.map(rankOf);
    assert(JSON.stringify(ranks) === JSON.stringify(ranks.slice().sort((x, y) => x - y)),
      '今日摘要排序应按重要度：' + JSON.stringify(ranks));
    ok('矩阵08（服务端）今日摘要按重要度排序（延期 > 阻塞 > 到期未更新 > 完成 > 普通）', ranks.join(','));

    const isBlocked = (t) => PHASE_KEYS.some((k) => t.phases[k] === '阻塞');
    const isHit = (t) => PHASE_KEYS.some((k) => t.phases[k] === '延期' || t.phases[k] === '阻塞');
    const groups = dailyB.blocked.map((t) => (isBlocked(t) ? 0 : 1));
    assert(dailyB.blocked.length >= 3 && dailyB.blocked.every(isHit) &&
      JSON.stringify(groups) === JSON.stringify(groups.slice().sort((x, y) => x - y)) &&
      groups.lastIndexOf(0) < groups.indexOf(1),
      '阻塞与延期行集合/排序不符：' + JSON.stringify(dailyB.blocked.map((t) => t.id)));
    ok('矩阵10a（服务端）阻塞与延期 = 任一阶段命中 延期/阻塞 的行，阻塞行排前',
      '共 ' + dailyB.blocked.length + ' 行（阻塞 ' + groups.filter((g) => g === 0).length + ' / 延期 ' + groups.filter((g) => g === 1).length + '）：' +
      dailyB.blocked.map((t) => t.id).join(','));

    /* 旧全局 status：JSON 保留原值，但页面/导出/日报均不引用 */
    const statusBefore = seedWithDates(today).tasks.map((t) => t.status);
    const docNow = (await api(a2.base, '/api/wbs')).body;
    assert(docNow.tasks.every((t) => typeof t.status === 'string' && t.status.length > 0), 'status 字段应保留在 JSON 中');
    assert(JSON.stringify(docNow.tasks.map((t) => t.status)) === JSON.stringify(statusBefore), 'status 原值应逐条保留');
    assert(dailyB.changes.every((r) => r.field !== 'status'), '日报「当日变更」不得引用旧 status 字段');
    const historyNow = (await api(a2.base, '/api/history?tz=' + TZ + '&date=' + today)).body;
    assert(historyNow.records.every((r) => Object.keys(r).sort().join(',') === 'at,field,identity,level1,level2,new,old,owner,task,task_id'),
      '/api/history 字段集应保持既有口径（CH-8 回归）');
    ok('矩阵10b 旧 status 保留原值但不被日报引用；/api/history 字段集仍为既有口径',
      'status 逐条一致 · 日报 status 行 0 · history 字段集不变');

    /* ---------- 07：WBS/日报导出在宿主 python 侧读回（此处仅确认接口与数据就绪 + demo 未写空） ---------- */
    const demoBefore = seedWithDates(today).tasks.map((t) => t.demo);
    assert(JSON.stringify(docNow.tasks.map((t) => t.demo)) === JSON.stringify(demoBefore), 'demo 值不得被改写/清空（CH-9）');
    ok('矩阵07（前置）CH-9：data/wbs.json 中 demo 值与迁移前逐条一致（未写空、未清空）',
      '非空 demo 行 ' + docNow.tasks.filter((t) => t.demo !== '').length + ' 行');

    await stopServer(a2);
    console.log('---');
    console.log('PASS=' + pass + ' FAIL=' + fail);
    process.exit(fail === 0 ? 0 : 1);
  } catch (err) {
    bad('stage11 服务端用例集执行', err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : String(err));
    console.log('---');
    console.log('PASS=' + pass + ' FAIL=' + fail);
    process.exit(1);
  } finally {
    servers.forEach((child) => { try { child.kill('SIGKILL'); } catch (e) { /* ignore */ } });
  }
})();
