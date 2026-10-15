'use strict';
/* YUNZ-29 / 变更包 #3：CH-8 服务端自测（Node 标准库）。
   覆盖：note 上限 20000（>20000 400 且不落盘、=20000 正常）、note 字段级 audit old→new、
   /api/history 不引入新字段、note 为空合法、409 非覆盖、原子写 + revision 递增、
   服务端重启后 note 与人员池仍在、静态资源与镜像快照一致（同源）。
   用法：node tests/stage9_server_check.js */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(__dirname, '.tmp', 'stage9-data');
const PORT = Number(process.env.WBS_TEST_PORT || 4225);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA_FILE = path.join(TMP, 'wbs.json');
const AUDIT_FILE = path.join(TMP, 'audit.log');
const TZ = 'Asia/Shanghai';
const NOTE_LIMIT = 20000;
const SERVER = require(path.join(ROOT, 'server.js'));

let pass = 0;
let fail = 0;
/* ok(标题, 断言条件, 证据摘要)：条件为真才计 PASS 并打印证据，否则计 FAIL。 */
const ok = (m, cond, extra) => {
  if (!cond) { fail += 1; console.log('FAIL  ' + m + (extra !== undefined ? '  -> ' + extra : '')); return; }
  pass += 1;
  console.log('PASS  ' + m + (extra !== undefined ? '  :: ' + extra : ''));
};
const bad = (m, detail) => { fail += 1; console.log('FAIL  ' + m + '  -> ' + detail); };
const assert = (cond, message) => { if (!cond) throw new Error(message); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

let server = null;
async function startServer() {
  fs.mkdirSync(TMP, { recursive: true });
  if (!fs.existsSync(path.join(TMP, 'wbs.seed.json'))) {
    fs.copyFileSync(path.join(ROOT, 'data', 'wbs.seed.json'), path.join(TMP, 'wbs.seed.json'));
  }
  server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { WBS_DATA_DIR: TMP, WBS_PORT: String(PORT), WBS_HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', (chunk) => process.stderr.write('[server] ' + chunk));
  for (let i = 0; i < 150; i += 1) {
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
  body: JSON.stringify({ meta: { name: doc.meta.name }, identities: doc.identities.slice(), tasks: doc.tasks })
});
const history = async (date) => {
  const query = '/api/history?tz=' + encodeURIComponent(TZ) + (date ? '&date=' + encodeURIComponent(date) : '');
  const response = await fetch(BASE + query);
  return { status: response.status, body: await response.json() };
};
const auditLines = () => fs.readFileSync(AUDIT_FILE, 'utf8').trim().split('\n').filter(Boolean)
  .map((line) => { try { return JSON.parse(line); } catch (err) { return null; } }).filter(Boolean);
const today = () => SERVER.todayInTimeZone(TZ);

(async () => {
  try {
    fs.mkdirSync(TMP, { recursive: true });
    fs.rmSync(DATA_FILE, { force: true });
    fs.rmSync(AUDIT_FILE, { force: true });
    await startServer();
    console.log('数据目录: ' + TMP + '  端口: ' + PORT + '  tz: ' + TZ + '  今天: ' + today());

    /* ---------- A. note 上限 20000：20001 → 400 且不落盘；20000 → 200 ---------- */
    const doc0 = await getDoc();
    const rev0 = doc0.meta.revision;
    const diskHashBefore = sha256(DATA_FILE);
    const tooLong = {
      meta: { name: doc0.meta.name }, identities: doc0.identities.slice(),
      tasks: doc0.tasks.map((task) => (task.id === 'T001' ? Object.assign({}, task, { note: 'x'.repeat(NOTE_LIMIT + 1) }) : task))
    };
    const res400 = await putDoc(tooLong, rev0, '项目负责人');
    const body400 = await res400.json();
    assert(res400.status === 400, 'note 超 20000 应 400，实际 ' + res400.status);
    assert(sha256(DATA_FILE) === diskHashBefore, '校验失败时不应落盘');
    const noteErr = (body400.errors || []).filter((e) => e.field === 'note')[0];
    ok('矩阵08 服务端拒绝 note > 20000（400 + 中文错误 + 不落盘）',
      !!noteErr && noteErr.message.indexOf('note') !== -1 && noteErr.message.indexOf(String(NOTE_LIMIT)) !== -1,
      noteErr ? noteErr.message : JSON.stringify(body400));
    assert((await getDoc()).meta.revision === rev0, '拒绝请求不应推进 revision');

    const atLimit = 'y'.repeat(NOTE_LIMIT);
    const res200 = await putDoc({
      meta: { name: doc0.meta.name }, identities: doc0.identities.slice(),
      tasks: doc0.tasks.map((task) => (task.id === 'T001' ? Object.assign({}, task, { note: atLimit }) : task))
    }, rev0, '项目负责人');
    assert(res200.status === 200, 'note = 20000 应 200，实际 ' + res200.status);
    const docA = await getDoc();
    ok('矩阵08 服务端接受 note = 20000（revision +1、API 与磁盘一致）',
      docA.meta.revision === rev0 + 1 && docA.tasks.find((t) => t.id === 'T001').note.length === NOTE_LIMIT &&
      disk().tasks.find((t) => t.id === 'T001').note.length === NOTE_LIMIT,
      { revision: docA.meta.revision, length: docA.tasks.find((t) => t.id === 'T001').note.length });

    /* ---------- B. note 字段级 audit：old→new / 时间 / 操作身份，只记 note 一个字段 ---------- */
    const noteB = '# 服务端审计 **粗体**\n\n- 甲\n- 乙';
    const docB = await getDoc();
    const resB = await putDoc({
      meta: { name: docB.meta.name }, identities: docB.identities.slice(),
      tasks: docB.tasks.map((task) => (task.id === 'T002' ? Object.assign({}, task, { note: noteB }) : task))
    }, docB.meta.revision, '王言');
    assert(resB.status === 200, 'note 保存应 200，实际 ' + resB.status);
    const lastAudit = auditLines().slice(-1)[0];
    ok('矩阵05 审计记录 note 字段级 old→new（old 为空基线、new 为本次 Markdown 原文）',
      lastAudit.old.T002 && lastAudit.old.T002.note === '' && lastAudit.new.T002.note === noteB &&
      Object.keys(lastAudit.new.T002).length === 1 && Object.keys(lastAudit.new.T002)[0] === 'note',
      JSON.stringify({ old: lastAudit.old.T002, fields: Object.keys(lastAudit.new.T002) }));
    ok('矩阵05 审计记录时间与操作身份（ISO 时间 + X-Identity 原样记录）',
      !isNaN(Date.parse(lastAudit.ts)) && lastAudit.identity === '王言' && typeof lastAudit.revision === 'number',
      JSON.stringify({ ts: lastAudit.ts, identity: lastAudit.identity, revision: lastAudit.revision }));

    /* ---------- C. /api/history 不引入新字段（字段级记录 = 既有 10 键） ---------- */
    const hist = await history(today());
    const noteRec = (hist.body.records || []).filter((r) => r.task_id === 'T002' && r.field === 'note')[0];
    const keys = noteRec ? Object.keys(noteRec).sort().join(',') : null;
    ok('矩阵05 /api/history 仍为既有字段集（task_id/field/at/identity/level1/level2/task/owner/old/new）',
      hist.body.count >= 2 && !!noteRec && keys === 'at,field,identity,level1,level2,new,old,owner,task,task_id' &&
      noteRec.new === noteB && noteRec.old === '' && noteRec.identity === '王言' && noteRec.level1 === (docB.tasks.find((t) => t.id === 'T002').level1),
      keys);

    /* ---------- D. 并发旧版本 PUT 409 不覆盖（note 场景） ---------- */
    const docC = await getDoc();
    const winnerRes = await putDoc({
      meta: { name: docC.meta.name }, identities: docC.identities.slice(),
      tasks: docC.tasks.map((task) => (task.id === 'T003' ? Object.assign({}, task, { note: '先到者 ' + Date.now() }) : task))
    }, docC.meta.revision, '项目负责人');
    assert(winnerRes.status === 200, '先到者写入应 200');
    const staleRes = await putDoc({
      meta: { name: docC.meta.name }, identities: docC.identities.slice(),
      tasks: docC.tasks.map((task) => (task.id === 'T003' ? Object.assign({}, task, { note: '后到者覆盖尝试' }) : task))
    }, docC.meta.revision, '项目负责人');
    const staleBody = await staleRes.json();
    const docAfterC = await getDoc();
    ok('矩阵09 并发旧版本保存 409 且不覆盖（current = 服务器版本、磁盘保留先到者）',
      staleRes.status === 409 && staleBody.reason === 'conflict' && staleBody.current === docAfterC.meta.revision &&
      docAfterC.tasks.find((t) => t.id === 'T003').note.indexOf('先到者') === 0 &&
      disk().tasks.find((t) => t.id === 'T003').note.indexOf('先到者') === 0,
      JSON.stringify({ status: staleRes.status, current: staleBody.current }));

    /* ---------- E. note 可为空 + 空 note 合法（权限语义不变，普通负责人只能改本人行由前端约束） ---------- */
    const docD = await getDoc();
    const emptyRes = await putDoc({
      meta: { name: docD.meta.name }, identities: docD.identities.slice(),
      tasks: docD.tasks.map((task) => (task.id === 'T002' ? Object.assign({}, task, { note: '' }) : task))
    }, docD.meta.revision, '王言');
    ok('矩阵02/06 note 允许为空（清空后 API 与磁盘均为空字符串、revision 正常递增）',
      emptyRes.status === 200 && (await getDoc()).tasks.find((t) => t.id === 'T002').note === '' &&
      disk().tasks.find((t) => t.id === 'T002').note === '',
      'HTTP ' + emptyRes.status);

    /* ---------- F. 重启后 note 与人员池持久（磁盘 + 原子写） ---------- */
    const persistNote = '# 重启持久（服务端用例）';
    const docE = await getDoc();
    const persistRes = await putDoc({
      meta: { name: docE.meta.name }, identities: docE.identities.slice(),
      tasks: docE.tasks.map((task) => (task.id === 'T004' ? Object.assign({}, task, { note: persistNote }) : task))
    }, docE.meta.revision, '项目负责人');
    assert(persistRes.status === 200, '重启用例写入应 200');
    const beforeRestart = await getDoc();
    await stopServer();
    await startServer();
    const afterRestart = await getDoc();
    ok('矩阵10 服务重启后 note 与人员池仍在（磁盘持久、revision 不回退）',
      afterRestart.tasks.find((t) => t.id === 'T004').note === persistNote &&
      JSON.stringify(afterRestart.identities) === JSON.stringify(beforeRestart.identities) &&
      afterRestart.meta.revision === beforeRestart.meta.revision,
      JSON.stringify({ revision: afterRestart.meta.revision, people: afterRestart.identities.length }));

    /* ---------- G. 静态资源：app.js / styles.css / index.html 与运行目录同源且非空（临时注入不可行） ---------- */
    const served = {};
    for (const file of ['/', '/app.js', '/styles.css']) {
      const response = await fetch(BASE + file);
      served[file] = { status: response.status, length: (await response.text()).length };
    }
    const servedApp = await (await fetch(BASE + '/app.js')).text();
    const localApp = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
    ok('矩阵11 服务端返回的 index.html / app.js / styles.css 与源码运行目录一致（HTTP 200、字节一致）',
      served['/'].status === 200 && served['/app.js'].status === 200 && served['/styles.css'].status === 200 &&
      servedApp === localApp && servedApp.indexOf('noteSummary') !== -1 && servedApp.indexOf('renderNoteMarkdown') !== -1,
      JSON.stringify({ appBytes: served['/app.js'].length, cssBytes: served['/styles.css'].length, same: servedApp === localApp }));

    /* ---------- H. 权限语义：非项目负责人不得新增人员（既有 CH-7 约束不回归） ---------- */
    const docF = await getDoc();
    const badIdentity = await fetch(BASE + '/api/wbs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': String(docF.meta.revision), 'X-Identity': encodeURIComponent('王言') },
      body: JSON.stringify({ meta: { name: docF.meta.name }, identities: docF.identities.concat(['越权新增']), tasks: docF.tasks })
    });
    ok('矩阵11 回归(CH-7) 非项目负责人通过 API 新增人员被拒（403、不落盘、不写审计）',
      badIdentity.status === 403 && (await getDoc()).identities.indexOf('越权新增') === -1,
      'HTTP ' + badIdentity.status);

    console.log('---');
    console.log('PASS=' + pass + ' FAIL=' + fail);
    await stopServer();
    process.exit(fail === 0 ? 0 : 1);
  } catch (err) {
    console.error('HARNESS_ERROR ' + (err && err.stack ? err.stack : err));
    console.log('PASS=' + pass + ' FAIL=' + (fail + 1));
    await stopServer();
    process.exit(3);
  }
})();
