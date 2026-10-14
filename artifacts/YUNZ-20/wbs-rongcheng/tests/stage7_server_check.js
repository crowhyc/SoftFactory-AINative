'use strict';
/* YUNZ-27 / 变更包 #2：服务端与历史接口自测（Node 标准库）。
   覆盖：audit.log 扩展 old/new、GET /api/history 自然日口径与字段、旧数据兼容、
   人员池校验（非空/去重/1–20）与持久化、409 非覆盖、重启持久、health。
   用法：node tests/stage7_server_check.js [--keep] */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(__dirname, '.tmp', 'stage7-data');
const PORT = Number(process.env.WBS_TEST_PORT || 4222);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA_FILE = path.join(TMP, 'wbs.json');
const AUDIT_FILE = path.join(TMP, 'audit.log');
const TZ = 'Asia/Shanghai';
const SERVER = require(path.join(ROOT, 'server.js'));

let pass = 0;
let fail = 0;
const ok = (m, extra) => { pass += 1; console.log('PASS  ' + m + (extra !== undefined ? '  :: ' + extra : '')); };
const bad = (m, detail) => { fail += 1; console.log('FAIL  ' + m + '  -> ' + detail); };
const assert = (cond, message) => { if (!cond) throw new Error(message); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

let server = null;
async function startServer() {
  fs.mkdirSync(TMP, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'data', 'wbs.seed.json'), path.join(TMP, 'wbs.seed.json'));
  server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { WBS_DATA_DIR: TMP, WBS_PORT: String(PORT), WBS_HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', (chunk) => process.stderr.write('[server] ' + chunk));
  for (let i = 0; i < 120; i += 1) {
    try { if ((await fetch(BASE + '/api/health')).ok) return; } catch (err) { /* 未就绪 */ }
    await sleep(100);
  }
  throw new Error('服务未就绪');
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
const getDoc = async () => (await fetch(BASE + '/api/wbs')).json();
const disk = () => JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const putDoc = (doc, revision, identity) => fetch(BASE + '/api/wbs', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'If-Match': String(revision), 'X-Identity': encodeURIComponent(identity) },
  body: JSON.stringify(doc)
});
const payloadOf = (doc) => ({ meta: { name: doc.meta.name }, identities: doc.identities.slice(), tasks: doc.tasks });
const history = async (date, tz) => {
  const query = '/api/history?tz=' + encodeURIComponent(tz || TZ) + (date ? '&date=' + encodeURIComponent(date) : '');
  const response = await fetch(BASE + query);
  return { status: response.status, body: await response.json() };
};
const auditLines = () => fs.readFileSync(AUDIT_FILE, 'utf8').trim().split('\n').filter(Boolean)
  .map((line) => { try { return JSON.parse(line); } catch (err) { return null; } }).filter(Boolean);
const appendRaw = (text) => fs.appendFileSync(AUDIT_FILE, text + '\n', 'utf8');

(async () => {
  try {
    fs.mkdirSync(TMP, { recursive: true });
    fs.rmSync(DATA_FILE, { force: true });
    fs.rmSync(AUDIT_FILE, { force: true });
    await startServer();
    const today = SERVER.todayInTimeZone(TZ);
    console.log('数据目录: ' + TMP + '  端口: ' + PORT + '  tz: ' + TZ + '  今天: ' + today);

    /* ---- 1. 基线 ---- */
    const doc0 = await getDoc();
    assert(doc0.tasks.length === 36 && doc0.identities.length === 9, '基线数据异常');
    const health = await (await fetch(BASE + '/api/health')).json();
    ok('矩阵11a GET /api/health 返回 ok', JSON.stringify(health));

    /* ---- 2. 保存：一次改动多个字段 -> audit 记录 field 级 old/new ---- */
    const before = sha256(DATA_FILE);
    const target = doc0.tasks[1];
    const changed = payloadOf(doc0);
    changed.tasks = changed.tasks.map((task) => {
      if (task.id !== target.id) return task;
      return Object.assign({}, task, {
        status: '已延期',
        note: 'stage7：延期原因已同步客户',
        dates: Object.assign({}, task.dates, { design: '2026-10-13', test: '2026-10-21' })
      });
    });
    const put = await putDoc(changed, doc0.meta.revision, '王言');
    assert(put.status === 200, '保存应 200，实际 ' + put.status);
    const putBody = await put.json();
    assert(sha256(DATA_FILE) !== before, '磁盘应已更新');
    ok('矩阵11b 保存成功（原子写，revision +1）', target.id + ' revision ' + putBody.revision);

    const lines = auditLines();
    const entry = lines[lines.length - 1];
    assert(entry.old && entry.new, 'audit 应带 old/new 映射');
    const newFields = entry.new[target.id];
    assert(newFields && newFields.status === '已延期' && newFields.note.indexOf('stage7') === 0 && newFields['dates.design'] === '2026-10-13',
      'audit new 映射缺字段：' + JSON.stringify(newFields));
    assert(entry.old[target.id].status === '未开始' && entry.old[target.id]['dates.design'] === '',
      'audit old 映射缺旧值：' + JSON.stringify(entry.old[target.id]));
    assert(entry.snapshot[target.id].level1 === target.level1 && entry.snapshot[target.id].task === target.task,
      'audit snapshot 缺改动后结构字段');
    ok('矩阵8a audit.log 每条记录带 old/new 映射与改动后快照',
      '字段 ' + Object.keys(newFields).join(',') + '；old.status=' + entry.old[target.id].status);

    /* ---- 3. /api/history：字段级逐行、时间升序、含结构字段与操作身份 ---- */
    const hist = await history(today, TZ);
    assert(hist.status === 200 && hist.body.ok === true, 'history 应 200 ok');
    assert(hist.body.date === today && hist.body.tz === TZ, 'history date/tz 异常');
    const records = hist.body.records;
    assert(records.length === 4, '本次保存应产生 4 条字段级记录，实际 ' + records.length);
    const times = records.map((r) => Date.parse(r.at));
    assert(times.every((t, i) => i === 0 || t >= times[i - 1]), '记录应按时间升序');
    const ownerRecord = records.find((r) => r.field === 'status');
    ['task_id', 'level1', 'level2', 'task', 'owner', 'field', 'old', 'new', 'at', 'identity'].forEach((key) => {
      assert(ownerRecord[key] !== undefined, 'history 记录缺字段 ' + key);
    });
    assert(ownerRecord.task_id === target.id && ownerRecord.old === '未开始' && ownerRecord.new === '已延期', 'status 记录值异常');
    assert(ownerRecord.identity === '王言', '操作身份应取自 X-Identity，实际 ' + ownerRecord.identity);
    assert(ownerRecord.task === target.task && ownerRecord.owner === target.owner, '结构字段应取改动后值');
    assert(records.some((r) => r.field === 'dates.design') && records.some((r) => r.field === 'dates.test'), 'dates 应展开到字段级');
    assert(hist.body.from === new Date(SERVER.dayBounds(today, TZ).start).toISOString(), 'from 应为当日 00:00:00');
    ok('矩阵8b GET /api/history 字段级记录（旧值→新值/时间/操作身份）',
      records.length + ' 条：' + records.map((r) => r.field).join(',') + '；' + hist.body.from + ' → ' + hist.body.to);

    /* ---- 4. 自然日边界（Asia/Shanghai） ---- */
    const todayStart = SERVER.dayBounds(today, TZ).start;
    const isoAt = (ms) => new Date(ms).toISOString();
    appendRaw(JSON.stringify({ ts: isoAt(todayStart + 1000), identity: '王言', revision: 99, changed: [], added: 0, removed: 0,
      old: { TX: { note: '' } }, new: { TX: { note: '当日 00:00:01 的改动' } }, snapshot: { TX: { level1: 'L1', level2: 'L2', task: 'T', owner: '王言' } } }));
    appendRaw(JSON.stringify({ ts: isoAt(todayStart - 1000), identity: '王言', revision: 98, changed: [], added: 0, removed: 0,
      old: { TX: { note: '' } }, new: { TX: { note: '昨日 23:59:59 的改动' } }, snapshot: { TX: { level1: 'L1', level2: 'L2', task: 'T', owner: '王言' } } }));
    const inDay = (await history(today, TZ)).body.records.filter((r) => r.task_id === 'TX');
    assert(inDay.length === 1 && inDay[0].new.indexOf('当日') === 0, '当日边界记录数应为 1：' + JSON.stringify(inDay));
    const yesterday = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(todayStart - 1000));
    assert(SERVER.dayBounds(yesterday, TZ).start + 24 * 3600 * 1000 === todayStart, '相邻自然日边界不连续');
    const prevDay = (await history(yesterday, TZ)).body.records.filter((r) => r.task_id === 'TX');
    assert(prevDay.length === 1 && prevDay[0].new.indexOf('昨日') === 0, '相邻自然日应能取到昨日记录：' + JSON.stringify(prevDay));
    ok('矩阵8c 自然日口径 [00:00:00, 次日 00:00:00) 开区间（Asia/Shanghai）',
      '当日含 00:00:01 不含 23:59:59；' + yesterday + ' 单独可取');

    /* ---- 5. 旧格式 / 损坏 audit 行兼容 ---- */
    appendRaw(JSON.stringify({ ts: isoAt(todayStart + 2000), identity: '王言', revision: 97, changed: [{ id: 'T001', fields: ['note'] }], added: 0, removed: 0 }));
    appendRaw('{ 这不是合法 JSON');
    const tolerant = await history(today, TZ);
    assert(tolerant.status === 200, '旧格式/损坏行不应导致接口报错：' + tolerant.status);
    assert(tolerant.body.records.every((r) => r.task_id !== undefined && r.field !== undefined), '记录结构异常');
    assert(!JSON.stringify(tolerant.body.records).includes('这不是合法 JSON'), '损坏行不应进入记录');
    ok('矩阵10a 旧格式（无 old/new）行与损坏行被跳过，接口不报错', 'records=' + tolerant.body.count);

    /* ---- 6. 人员池：校验 + 去重 + 持久化 ---- */
    const dupPayload = payloadOf(await getDoc());
    dupPayload.identities = dupPayload.identities.concat(['新成员']);
    const dup = await putDoc(dupPayload, (await getDoc()).meta.revision, '项目负责人');
    assert(dup.status === 200, '首次新增人员应 200，实际 ' + dup.status);
    const addedRevision = (await dup.json()).revision;
    ok('矩阵6a 人员池新增落盘（PUT /api/wbs，原子写 + revision 保护）', 'revision ' + addedRevision);

    const dupAgain = payloadOf(await getDoc());
    dupAgain.identities = dupAgain.identities.concat(['新成员']);
    const dupRes = await putDoc(dupAgain, (await getDoc()).meta.revision, '项目负责人');
    const dupBody = await dupRes.json();
    assert(dupRes.status === 400, '重复人员应 400，实际 ' + dupRes.status);
    assert(dupBody.errors.some((e) => e.message.indexOf('重复') !== -1), '重复人员应给中文提示：' + JSON.stringify(dupBody.errors));
    const longName = payloadOf(await getDoc());
    longName.identities = longName.identities.concat(['一二三四五六七八九十一二三四五六七八九十一']);
    const longRes = await putDoc(longName, (await getDoc()).meta.revision, '项目负责人');
    assert(longRes.status === 400 && (await longRes.json()).errors.some((e) => e.message.indexOf('1–20') !== -1),
      '21 字姓名应 400 并提示长度');
    const blankName = payloadOf(await getDoc());
    blankName.identities = blankName.identities.concat(['   ']);
    const blankRes = await putDoc(blankName, (await getDoc()).meta.revision, '项目负责人');
    assert(blankRes.status === 400, '空白姓名应 400，实际 ' + blankRes.status);
    ok('矩阵6b 服务端拒绝空白 / 重复 / 超长（>20）身份并给中文提示',
      'dup400 / blank400 / len400');

    /* ---- 7. 409 非覆盖 ---- */
    const staleDoc = payloadOf(await getDoc());
    const fresh = await getDoc();
    const freshPayload = payloadOf(fresh);
    freshPayload.tasks = freshPayload.tasks.map((task, index) => (index === 0 ? Object.assign({}, task, { note: '409 先到者写入' }) : task));
    assert((await putDoc(freshPayload, fresh.meta.revision, '项目负责人')).status === 200, '先到者应保存成功');
    const latePayload = payloadOf(staleDoc);
    latePayload.tasks = latePayload.tasks.map((task, index) => (index === 0 ? Object.assign({}, task, { note: '409 后到者不应覆盖' }) : task));
    const late = await putDoc(latePayload, fresh.meta.revision, '项目负责人');
    assert(late.status === 409, '后到且版本过期应 409，实际 ' + late.status);
    const settled = await getDoc();
    assert(settled.tasks[0].note === '409 先到者写入', '数据应以先到者为准');
    assert(disk().tasks[0].note === '409 先到者写入', '磁盘应以先到者为准');
    ok('矩阵11c 并发旧版本保存 409 非覆盖（API 与磁盘一致）', 'current=' + (await late.json()).current);

    /* ---- 8. 旧数据兼容（老 wbs.json 无新增字段）---- */
    const legacy = { meta: { name: doc0.meta.name, revision: 7, updated_at: doc0.meta.updated_at }, identities: doc0.identities.slice(), tasks: doc0.tasks };
    fs.writeFileSync(DATA_FILE, JSON.stringify(legacy, null, 2) + '\n', 'utf8');
    const legacyRead = await getDoc();
    assert(legacyRead.tasks.length === 36 && legacyRead.meta.revision === 7, '旧 wbs.json 应可读');
    const legacySave = payloadOf(legacyRead);
    legacySave.tasks = legacySave.tasks.map((task, index) => (index === 2 ? Object.assign({}, task, { note: '旧数据可保存' }) : task));
    assert((await putDoc(legacySave, 7, '项目负责人')).status === 200, '旧 wbs.json 应可保存');
    ok('矩阵10b 老 wbs.json（无新增字段）可读、可保存', 'revision 7 → ' + (await getDoc()).meta.revision);

    /* ---- 9. 参数校验 ---- */
    assert((await fetch(BASE + '/api/history?date=2026-13-99')).status === 400, '非法 date 应 400');
    assert((await fetch(BASE + '/api/history?tz=No/Such_Zone')).status === 400, '非法 tz 应 400');
    const post = await fetch(BASE + '/api/history', { method: 'POST', body: '{}' });
    assert(post.status === 405, 'POST /api/history 应 405');
    ok('矩阵11d /api/history 参数校验与 405', 'date/tz 400，POST 405');

    /* ---- 10. 重启持久 ---- */
    const beforeRestart = await getDoc();
    await stopServer();
    await startServer();
    const afterRestart = await getDoc();
    assert(JSON.stringify(afterRestart.identities) === JSON.stringify(beforeRestart.identities), '重启后人员池应保持');
    assert(afterRestart.tasks.length === 36 && afterRestart.tasks[2].note === '旧数据可保存', '重启后任务应保持');
    assert((await history(today, TZ)).status === 200, '重启后 history 应可用');
    ok('矩阵11e 服务重启后数据与人员池仍在（含 /api/history）',
      'identities=' + afterRestart.identities.length + ' revision=' + afterRestart.meta.revision);

    console.log('---');
    console.log('ARTIFACT data_sha256=' + sha256(DATA_FILE));
    console.log('ARTIFACT audit_lines=' + fs.readFileSync(AUDIT_FILE, 'utf8').trim().split('\n').filter(Boolean).length);
  } catch (err) {
    bad('Stage7 服务端自测执行', err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : String(err));
  } finally {
    await stopServer();
  }
  console.log('PASS=' + pass + ' FAIL=' + fail);
  process.exit(fail === 0 ? 0 : 1);
})();
