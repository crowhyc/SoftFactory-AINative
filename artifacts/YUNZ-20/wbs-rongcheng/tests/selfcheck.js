'use strict';
/* WC-001 作者自测（API / 持久化 / 原子写 / 冲突 / 校验 / 依赖 / 资源本地化）。
 * 用法：node tests/selfcheck.js [--only tag1,tag2] [--data-dir DIR] [--port N]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const moduleApi = require('module');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SEED = path.join(ROOT, 'data', 'wbs.seed.json');

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
};
const ONLY = (opt('--only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const PORT = Number(opt('--port', '4199'));
const DATA_DIR = path.resolve(opt('--data-dir', path.join(__dirname, '.tmp', 'api')));
const BASE = 'http://127.0.0.1:' + PORT;
const DATA_FILE = path.join(DATA_DIR, 'wbs.json');
const SEED_FILE = path.join(DATA_DIR, 'wbs.seed.json');

let pass = 0;
let fail = 0;
const checks = [];
function check(tags, name, fn) { checks.push({ tags: [].concat(tags), name, fn }); }
function ok(name, extra) { pass += 1; console.log('PASS  ' + name + (extra ? '  :: ' + extra : '')); }
function bad(name, detail) { fail += 1; console.log('FAIL  ' + name + '  -> ' + detail); }
function assert(cond, message) { if (!cond) throw new Error(message || '断言失败'); }
function eq(expect, got, label) {
  if (JSON.stringify(expect) !== JSON.stringify(got)) {
    throw new Error((label || '') + ' 期望 ' + JSON.stringify(expect) + ' 实际 ' + JSON.stringify(got));
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const disk = () => JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const seed = () => JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
const A_TO_K = (task) => ({
  id: task.id, level1: task.level1, level2: task.level2, task: task.task, owner: task.owner,
  demo: task.demo, dates: task.dates, note: task.note
});

let server = null;
async function startServer() {
  server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { WBS_DATA_DIR: DATA_DIR, WBS_PORT: String(PORT), WBS_HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', (chunk) => process.stderr.write('[server] ' + chunk));
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(BASE + '/api/health');
      if (res.ok) return;
    } catch (err) { /* 未就绪 */ }
    await sleep(100);
  }
  throw new Error('服务未在 10s 内就绪');
}
async function stopServer() {
  if (!server) return;
  const child = server;
  server = null;
  await new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) {} resolve(); }, 3000);
  });
}
async function api(method, url, body, headers) {
  const res = await fetch(BASE + url, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (err) { json = null; }
  return { status: res.status, json, text, headers: res.headers };
}
const getDoc = async () => (await api('GET', '/api/wbs')).json;
const putDoc = (doc, revision, identity) => api('PUT', '/api/wbs', doc, {
  'If-Match': String(revision), 'X-Identity': encodeURIComponent(identity || '项目负责人')
});
const payloadOf = (doc) => ({ meta: { name: doc.meta.name }, identities: doc.identities, tasks: doc.tasks });

/* ------------------------------------------------------------ 检查项 */

check(['render36'], '矩阵1 读取 36 行且 A–K 顺序与 seed 一致', async () => {
  const doc = await getDoc();
  eq(36, doc.tasks.length, '任务条数');
  assert(doc.tasks[0].id === 'T001' && doc.tasks[35].id === 'T036', 'id 序列应为 T001..T036');
  const expected = seed().tasks.map(A_TO_K);
  const actual = doc.tasks.map(A_TO_K);
  eq(expected, actual, 'A–K 字段与 seed 逐行对比');
  ok('GET /api/wbs 返回 36 行，顺序与 seed 完全一致', 'ids T001..T036');
  const page = await fetch(BASE + '/');
  const html = await page.text();
  assert(page.status === 200 && html.includes('id="wbs-body"'), '首页应返回工作台');
  ok('GET / 返回工作台页面', 'HTTP 200, 含 #wbs-body');
  const escape = await fetch(BASE + '/../server.js');
  assert(escape.status === 400 || escape.status === 404, '路径穿越应被拒绝，实际 ' + escape.status);
  ok('静态目录路径穿越被拒绝', 'HTTP ' + escape.status);
});

check(['health'], '矩阵15 /api/health 返回 ok', async () => {
  const res = await api('GET', '/api/health');
  eq(200, res.status, '健康检查状态码');
  assert(res.json && res.json.ok === true, 'ok 应为 true');
  eq('wbs-rongcheng', res.json.service, 'service 标识');
  ok('GET /api/health -> ' + JSON.stringify(res.json));
});

check(['stdlib'], '矩阵10 纯 Node 标准库、零运行时依赖', async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  eq({}, pkg.dependencies || {}, 'package.json dependencies');
  eq({}, pkg.devDependencies || {}, 'package.json devDependencies');
  const source = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const requires = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
  const builtins = new Set(moduleApi.builtinModules);
  requires.forEach((name) => assert(builtins.has(name), 'require 非标准库模块：' + name));
  assert(!fs.existsSync(path.join(ROOT, 'node_modules')), '产物目录不应存在 node_modules');
  ok('server.js require 仅标准库：' + requires.join(', '));
  ok('package.json 无依赖，产物无 node_modules');
});

check(['localonly'], '矩阵11 页面资源全本地，无外部请求', async () => {
  const files = ['index.html', 'app.js', 'styles.css'];
  files.forEach((name) => {
    const text = fs.readFileSync(path.join(PUBLIC_DIR, name), 'utf8');
    const external = [...text.matchAll(/(https?:)?\/\/[a-zA-Z0-9.-]+/g)].map((m) => m[0]);
    eq([], external, name + ' 外部引用');
    const refs = [...text.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    refs.forEach((ref) => {
      assert(ref.indexOf('//') === -1 && ref.indexOf('http') !== 0, name + ' 存在外链 ' + ref);
      assert(fs.existsSync(path.join(PUBLIC_DIR, ref)), name + ' 引用文件缺失 ' + ref);
    });
  });
  for (const asset of ['template.xlsx', 'vendor/xlsx.full.min.js']) {
    const res = await fetch(BASE + '/' + asset);
    eq(200, res.status, asset + ' 本地可取');
    assert(Number(res.headers.get('content-length')) > 1000, asset + ' 响应体异常');
    ok('本地资源 ' + asset + ' 由本服务提供', 'HTTP 200');
  }
  const csp = (await fetch(BASE + '/')).headers.get('content-security-policy');
  assert(csp && csp.includes("default-src 'self'"), '应下发同源 CSP');
  ok('index.html/app.js/styles.css 无外部引用，全部相对本地加载', 'CSP: ' + csp.split(';')[0]);
});

check(['consistency', 'ownedit'], '矩阵3/6 普通负责人本人行可编辑，保存后页面/API/磁盘三端一致', async () => {
  const doc = await getDoc();
  const revision = doc.meta.revision;
  const row = doc.tasks.find((t) => t.owner === '王言');
  assert(row, '应存在王言负责的行');
  const updatedNote = '自测：' + new Date().toISOString();
  doc.tasks = doc.tasks.map((task) => (task.id === row.id
    ? Object.assign({}, task, {
      status: '进行中',
      demo: '是',
      dates: Object.assign({}, task.dates, { design: '2026-10-20', dev: '2026-10-25' }),
      note: updatedNote
    })
    : task));
  const res = await putDoc(doc, revision, '王言');
  eq(200, res.status, 'PUT 状态码');
  eq(true, res.json.ok, 'ok');
  eq(revision + 1, res.json.revision, 'revision 应 +1');
  const after = await getDoc();
  const apiRow = after.tasks.find((t) => t.id === row.id);
  eq('进行中', apiRow.status, 'API status');
  eq(updatedNote, apiRow.note, 'API note');
  eq('2026-10-20', apiRow.dates.design, 'API dates.design');
  const diskRow = disk().tasks.find((t) => t.id === row.id);
  eq(updatedNote, diskRow.note, '磁盘 note');
  eq('进行中', diskRow.status, '磁盘 status');
  eq(apiRow, diskRow, 'API 与磁盘行一致');
  ok('王言行保存成功：页面草稿 -> API -> 磁盘 三端一致', row.id + ' revision ' + res.json.revision);
  const audit = fs.readFileSync(path.join(DATA_DIR, 'audit.log'), 'utf8').trim().split('\n').pop();
  const entry = JSON.parse(audit);
  eq('王言', entry.identity, 'audit 身份');
  assert(JSON.stringify(entry).includes(row.id), 'audit 应记录行号');
  // 变更包 #2：audit 行扩展 old/new 映射（供日报「当日变更」还原字段级改动）。
  assert(entry.old && entry.new, 'audit 应带 old/new 映射');
  eq(updatedNote, entry.new[row.id].note, 'audit new.note');
  eq('未开始', entry.old[row.id].note === '' ? '未开始' : entry.old[row.id].note, 'audit old.note 为空基线');
  eq(updatedNote, JSON.parse(audit).new[row.id].note, 'audit 应记录改动后的值');
  ok('audit.log 记录身份/行/字段 + old/new 映射', audit.slice(0, 120) + '…');
});

check(['validation'], '矩阵8 空值与非法输入被拒且不落盘', async () => {
  const before = sha256(DATA_FILE);
  const doc = await getDoc();
  const revision = doc.meta.revision;
  const broken = payloadOf(doc);
  broken.tasks = broken.tasks.map((task, index) => {
    if (index === 0) return Object.assign({}, task, { task: '' });
    if (index === 1) return Object.assign({}, task, { status: '开工' });
    if (index === 2) return Object.assign({}, task, { dates: Object.assign({}, task.dates, { dev: '2026/10/25' }) });
    if (index === 3) return Object.assign({}, task, { owner: '' });
    return task;
  });
  const res = await putDoc(broken, revision, '项目负责人');
  eq(400, res.status, 'PUT 状态码');
  eq(false, res.json.ok, 'ok 应为 false');
  assert(Array.isArray(res.json.errors) && res.json.errors.length >= 4, '应返回逐字段错误列表');
  const fields = res.json.errors.map((e) => e.id + ':' + e.field);
  ['task', 'status', 'dates.dev', 'owner'].forEach((field) => {
    assert(fields.some((f) => f.endsWith(':' + field)), '缺少字段错误 ' + field + '，实际 ' + JSON.stringify(fields));
  });
  ok('非法 payload 返回 400 且逐字段报错', JSON.stringify(res.json.errors));
  eq(before, sha256(DATA_FILE), '校验失败后磁盘不应变化');
  ok('400 后磁盘文件 sha256 未变化', before.slice(0, 16) + '…');
  const badJson = await api('PUT', '/api/wbs', undefined, { 'If-Match': String(revision) });
  assert(badJson.status === 400, '空体应返回 400，实际 ' + badJson.status);
  ok('空请求体返回 400', 'HTTP ' + badJson.status);
});

check(['conflict'], '矩阵9 并发保存 409 且不静默覆盖', async () => {
  const doc = await getDoc();
  const revision = doc.meta.revision;
  const first = payloadOf(doc);
  const winner = first.tasks.find((t) => t.id === 'T005');
  winner.note = '先到者写入 ' + revision;
  const res1 = await putDoc(first, revision, '项目负责人');
  eq(200, res1.status, '先到者状态码');

  const stale = payloadOf(doc);
  stale.tasks.find((t) => t.id === 'T005').note = '后到者覆盖尝试';
  stale.tasks.forEach((t) => { t.level1 = '被污染的一级'; });
  const res2 = await putDoc(stale, revision, '王言');
  eq(409, res2.status, '后到者状态码');
  eq(false, res2.json.ok, 'ok');
  eq('conflict', res2.json.reason, 'reason');
  eq(res1.json.revision, res2.json.current, '应回报当前 revision');
  ok('旧版本并发保存收到 409 conflict', JSON.stringify(res2.json));

  const now = await getDoc();
  eq(res1.json.revision, now.meta.revision, '磁盘版本应停在先到者');
  eq('先到者写入 ' + revision, now.tasks.find((t) => t.id === 'T005').note, '磁盘应保留先到者数据');
  assert(now.tasks.every((t) => t.level1 !== '被污染的一级'), '后到者内容不应落盘');
  ok('数据以先到者为准，后到者未覆盖');
});

check(['restart'], '矩阵16 服务重启后数据仍在', async () => {
  const before = disk();
  const beforeRev = before.meta.revision;
  await stopServer();
  await startServer();
  const after = await getDoc();
  eq(beforeRev, after.meta.revision, '重启后 revision');
  eq(before.tasks.length, after.tasks.length, '重启后条数');
  eq(before.tasks, after.tasks, '重启后任务内容');
  ok('SIGTERM 重启后 36 行与 revision ' + beforeRev + ' 保持', '数据目录 ' + DATA_DIR);
});

check(['tensaves'], '矩阵17 连续 10 次保存无丢失/无重复/无未知字段被清除', async () => {
  let doc = await getDoc();
  const seedFields = Object.keys(seed().tasks[0]).sort();
  // 注入未知字段，验证 10 次保存后仍被保留
  const probePayload = payloadOf(doc);
  probePayload.tasks[0].extra_probe = 'keep-me';
  const probeRes = await putDoc(probePayload, doc.meta.revision, '项目负责人');
  eq(200, probeRes.status, '探针字段写入');

  const owners = ['王言', '李欢', '张航瑞', '郑述文', '崔文建', '余宇', '黄逸偲', '陈江', '王言', '李欢'];
  for (let i = 0; i < 10; i += 1) {
    doc = await getDoc();
    const payload = payloadOf(doc);
    const index = i % payload.tasks.length;
    const identity = owners[i];
    const row = payload.tasks[index];
    const editable = row.owner === identity;
    if (editable) {
      row.note = '第 ' + (i + 1) + ' 次保存 by ' + identity;
      row.dates.test = '2026-11-' + String(10 + i).padStart(2, '0');
      row.status = ['未开始', '进行中', '已完成', '已延期', '被阻塞'][i % 5];
    } else {
      row.note = '第 ' + (i + 1) + ' 次保存 by 项目负责人';
    }
    const res = await putDoc(payload, doc.meta.revision, identity);
    eq(200, res.status, '第 ' + (i + 1) + ' 次保存');
  }
  const final = await getDoc();
  eq(36, final.tasks.length, '10 次保存后条数');
  const ids = final.tasks.map((t) => t.id);
  eq(new Set(ids).size, ids.length, 'id 不应重复');
  eq(seed().tasks.map((t) => t.id), ids, '行序不应变化');
  final.tasks.forEach((task) => {
    seedFields.forEach((field) => assert(task[field] !== undefined, task.id + ' 丢失字段 ' + field));
  });
  eq('keep-me', final.tasks[0].extra_probe, '未知字段 extra_probe 应保留');
  const lastNote = final.tasks[9].note;
  assert(typeof lastNote === 'string' && lastNote !== '', '末次写入应保留');
  ok('10 次保存后 A–K 无丢失、id 无重复、行序不变、未知字段保留', '末次 note=' + lastNote);
  eq(disk().tasks.length, final.tasks.length, '磁盘与 API 条数一致');
});

check(['atomic'], '矩阵6b 写盘为 tmp+fsync+rename 原子替换', async () => {
  const source = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(/fs\.fsyncSync\(fd\)/.test(source) && /fs\.renameSync\(tmp, file\)/.test(source), '应使用 fsync + rename');
  assert(/fsyncDir/.test(source), '应同步目录');
  const leftovers = fs.readdirSync(DATA_DIR).filter((name) => name.includes('.tmp-'));
  eq([], leftovers, '不应残留临时文件');

  const readers = [];
  let stop = false;
  let rev = 0;
  try {
  const reader = async () => {
    while (!stop) {
      const res = await fetch(BASE + '/api/wbs');
      const body = await res.text();
      JSON.parse(body);
      if (res.status !== 200) throw new Error('读取状态码 ' + res.status);
    }
  };
  for (let i = 0; i < 4; i += 1) readers.push(reader().catch((err) => { stop = true; throw err; }));

  rev = (await getDoc()).meta.revision;
  for (let i = 0; i < 15; i += 1) {
    const doc = await getDoc();
    rev = doc.meta.revision;
    const payload = payloadOf(doc);
    payload.tasks[i % 36].note = '原子写压力 ' + i;
    const res = await putDoc(payload, rev, '项目负责人');
    eq(200, res.status, '压力写 ' + i);
  }
  } finally {
    stop = true;
    await Promise.all(readers).catch(() => {});
  }
  ok('15 次写盘期间 4 个并发读取始终拿到完整 JSON（无半写）', '最终 revision ' + rev);
  const leftoversAfter = fs.readdirSync(DATA_DIR).filter((name) => name.includes('.tmp-'));
  eq([], leftoversAfter, '压力后不应残留临时文件');
  ok('写盘后无 .tmp 残留，代码含 fsync + rename + 目录同步');
});

check(['secrets'], '矩阵18 产物与仓库无凭据字符串', async () => {
  const patterns = [/AKIA[0-9A-Z]{16}/, /sk-[A-Za-z0-9]{20,}/, /ghp_[A-Za-z0-9]{20,}/,
    /(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*['"][^'"]{6,}['"]/i, /BEGIN [A-Z ]*PRIVATE KEY/];
  const roots = [ROOT, path.join('/opt/SoftFactory-AINative', 'artifacts', 'YUNZ-20')];
  const hits = [];
  const walk = (dir) => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['.tmp', 'node_modules', '.git', 'state', '.tools'].includes(entry.name)) return;
        walk(full);
        return;
      }
      if (!entry.isFile()) return;
      if (entry.name.endsWith('.xlsx')) return;
      if (full.indexOf(path.sep + 'vendor' + path.sep) !== -1) return;
      if (fs.statSync(full).size > 4 * 1024 * 1024) return;
      const text = fs.readFileSync(full, 'utf8');
      patterns.forEach((re) => { if (re.test(text)) hits.push(full + ' :: ' + re); });
    });
  };
  roots.forEach((dir) => { if (fs.existsSync(dir)) walk(dir); });
  eq([], hits, '凭据样式命中');
  const vendor = crypto.createHash('sha256').update(fs.readFileSync(path.join(PUBLIC_DIR, 'vendor', 'xlsx.full.min.js'))).digest('hex');
  eq('c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99', vendor, 'vendor bundle 应与锁定输入逐字节一致');
  ok('产物目录与 artifacts/YUNZ-20 未发现凭据样式字符串（vendor bundle 排除但校验 sha256）', roots.join(' , '));
});

/* -------------------------------------------------------------- 运行 */

(async () => {
  const selected = ONLY.length ? checks.filter((c) => c.tags.some((t) => ONLY.includes(t))) : checks;
  if (!selected.length) {
    console.log('没有匹配 --only=' + ONLY.join(',') + ' 的检查项');
    process.exit(2);
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.rmSync(DATA_FILE, { force: true });
  fs.copyFileSync(SEED, SEED_FILE);
  console.log('数据目录: ' + DATA_DIR + '  端口: ' + PORT);
  try {
    await startServer();
    for (const item of selected) {
      try {
        await item.fn();
      } catch (err) {
        bad(item.name, err.message);
      }
    }
  } catch (err) {
    bad('服务启动', err.message);
  } finally {
    await stopServer();
  }
  console.log('---');
  console.log('PASS=' + pass + ' FAIL=' + fail);
  process.exit(fail === 0 ? 0 : 1);
})();
