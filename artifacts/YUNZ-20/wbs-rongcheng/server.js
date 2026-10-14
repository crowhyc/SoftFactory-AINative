'use strict';

/*
 * WC-001 蓉城战役 WBS 工作系统 —— 服务端。
 * 纯 Node 标准库，零运行时依赖；提供静态资源与 /api/wbs、/api/health。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = process.env.WBS_DATA_DIR || path.join(ROOT_DIR, 'data');
const DATA_FILE = path.join(DATA_DIR, 'wbs.json');
const SEED_FILE = path.join(DATA_DIR, 'wbs.seed.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.log');
const HOST = process.env.WBS_HOST || '127.0.0.1';
const PORT = Number(process.env.WBS_PORT || 4180);
const MAX_BODY = 4 * 1024 * 1024;

const STATUS_ENUM = ['未开始', '进行中', '已完成', '已延期', '被阻塞'];
const DATE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TASK_FIELDS = ['level1', 'level2', 'task', 'owner', 'demo', 'note'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

/* ---------------------------------------------------------------- 校验 */

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateDocument(body) {
  const errors = [];
  const push = (id, field, message) => errors.push({ id: id == null ? null : String(id), field, message });

  if (!isPlainObject(body)) {
    push(null, 'body', '请求体必须是 JSON 对象');
    return errors;
  }
  if (!Array.isArray(body.identities) || body.identities.length === 0) {
    push(null, 'identities', 'identities 必须是非空字符串数组');
  } else {
    body.identities.forEach((identity, index) => {
      if (typeof identity !== 'string' || identity.trim() === '') {
        push(null, 'identities[' + index + ']', '身份必须是非空字符串');
      }
    });
  }
  if (!Array.isArray(body.tasks)) {
    push(null, 'tasks', 'tasks 必须是数组');
    return errors;
  }
  if (body.tasks.length === 0) {
    push(null, 'tasks', 'tasks 不能为空数组');
  }

  const seen = new Set();
  body.tasks.forEach((task, index) => {
    const id = isPlainObject(task) && typeof task.id === 'string' ? task.id : 'tasks[' + index + ']';
    if (!isPlainObject(task)) {
      push(id, 'task', '任务必须是对象');
      return;
    }
    if (typeof task.id !== 'string' || task.id.trim() === '') {
      push(id, 'id', '任务 id 必须是非空字符串');
    } else if (!/^[A-Za-z0-9_-]{1,32}$/.test(task.id)) {
      push(id, 'id', '任务 id 只允许字母、数字、下划线与连字符');
    } else if (seen.has(task.id)) {
      push(id, 'id', '任务 id 重复');
    } else {
      seen.add(task.id);
    }

    TASK_FIELDS.forEach((field) => {
      const value = task[field];
      if (typeof value !== 'string') {
        push(id, field, field + ' 必须是字符串');
        return;
      }
      const limits = { level1: 200, level2: 200, task: 300, owner: 40, demo: 20, note: 2000 };
      if (value.length > limits[field]) {
        push(id, field, field + ' 长度超过上限 ' + limits[field]);
      }
    });
    if (typeof task.task === 'string' && task.task.trim() === '') {
      push(id, 'task', '任务项不能为空');
    }
    if (typeof task.owner === 'string' && task.owner.trim() === '') {
      push(id, 'owner', '负责人不能为空');
    }

    if (!isPlainObject(task.dates)) {
      push(id, 'dates', 'dates 必须是对象');
    } else {
      DATE_KEYS.forEach((key) => {
        const value = task.dates[key];
        if (typeof value !== 'string') {
          push(id, 'dates.' + key, '日期必须是字符串');
        } else if (value !== '' && !DATE_RE.test(value)) {
          push(id, 'dates.' + key, '日期格式必须为 YYYY-MM-DD');
        }
      });
      Object.keys(task.dates).forEach((key) => {
        if (DATE_KEYS.indexOf(key) === -1) push(id, 'dates.' + key, '未知日期字段');
      });
    }

    if (typeof task.status !== 'string' || STATUS_ENUM.indexOf(task.status) === -1) {
      push(id, 'status', '状态必须是 ' + STATUS_ENUM.join(' / ') + ' 之一');
    }
  });

  return errors;
}

/* 身份头为 URL 编码（HTTP 头不允许非 ASCII），解码后仅用于审计。 */
function decodeIdentity(raw) {
  if (typeof raw !== 'string') return '';
  let value = raw;
  try { value = decodeURIComponent(raw); } catch (err) { /* 原样保留 */ }
  return value.replace(/[\r\n\t]/g, '').slice(0, 40);
}

/* ------------------------------------------------------------ 原子读写 */

function fsyncDir(dir) {
  let fd = null;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch (err) {
    /* 目录 fsync 在部分文件系统上不可用，忽略 */
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (err) { /* ignore */ }
    }
  }
}

function atomicWriteJson(file, doc) {
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  const json = JSON.stringify(doc, null, 2) + '\n';
  const fd = fs.openSync(tmp, 'w', 0o644);
  try {
    fs.writeFileSync(fd, json, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  fsyncDir(path.dirname(file));
  return tmp;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadDocument() {
  if (!fs.existsSync(DATA_FILE)) {
    if (!fs.existsSync(SEED_FILE)) throw new Error('缺少数据文件与 seed：' + DATA_FILE);
    const seed = readJson(SEED_FILE);
    atomicWriteJson(DATA_FILE, seed);
    return seed;
  }
  return readJson(DATA_FILE);
}

function appendAudit(entry) {
  try {
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    /* 审计失败不影响主流程 */
  }
}

function diffFields(prevDoc, nextDoc) {
  const prev = new Map((prevDoc.tasks || []).map((task) => [task.id, task]));
  const changed = [];
  let added = 0;
  let removed = 0;
  (nextDoc.tasks || []).forEach((task) => {
    const old = prev.get(task.id);
    if (!old) { added += 1; return; }
    const fields = new Set([...Object.keys(old), ...Object.keys(task)]);
    const touched = [];
    fields.forEach((field) => {
      if (JSON.stringify(old[field]) !== JSON.stringify(task[field])) {
        touched.push(field === 'dates' ? 'dates.*' : field);
      }
    });
    if (touched.length) changed.push({ id: task.id, fields: touched });
    prev.delete(task.id);
  });
  removed = prev.size;
  return { changed, added, removed };
}

/* -------------------------------------------------------------- 静态资源 */

function resolveStatic(urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const normalized = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(PUBLIC_DIR, normalized);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) return null;
  return file;
}

function sendStatic(req, res, file) {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}

/* ------------------------------------------------------------------ 路由 */

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function readBody(req, res, callback) {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      sendJson(res, 413, { ok: false, errors: [{ id: null, field: 'body', message: '请求体过大' }] });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => callback(Buffer.concat(chunks).toString('utf8')));
  req.on('error', () => { /* 连接中断，忽略 */ });
}

function handlePut(req, res) {
  readBody(req, res, (raw) => {
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch (err) {
      sendJson(res, 400, { ok: false, errors: [{ id: null, field: 'body', message: '请求体不是合法 JSON' }] });
      return;
    }

    let current = null;
    try {
      current = loadDocument();
    } catch (err) {
      sendJson(res, 500, { ok: false, reason: 'storage', message: '数据文件不可读' });
      return;
    }

    const ifMatch = req.headers['if-match'];
    if (!ifMatch || String(ifMatch).trim() !== String(current.meta.revision)) {
      sendJson(res, 409, { ok: false, reason: 'conflict', current: current.meta.revision });
      return;
    }

    const errors = validateDocument(body);
    if (errors.length) {
      sendJson(res, 400, { ok: false, errors });
      return;
    }

    const nextRevision = Number(current.meta.revision) + 1;
    const next = {
      meta: Object.assign({}, current.meta, {
        revision: nextRevision,
        updated_at: new Date().toISOString()
      }),
      identities: body.identities.slice(),
      tasks: body.tasks
    };
    if (typeof body.meta === 'object' && body.meta !== null && typeof body.meta.name === 'string' && body.meta.name.trim()) {
      next.meta.name = body.meta.name;
    }

    const diff = diffFields(current, next);
    try {
      atomicWriteJson(DATA_FILE, next);
    } catch (err) {
      sendJson(res, 500, { ok: false, reason: 'storage', message: '写入失败' });
      return;
    }
    const identity = decodeIdentity(req.headers['x-identity']);
    appendAudit({
      ts: new Date().toISOString(),
      identity,
      revision: nextRevision,
      changed: diff.changed,
      added: diff.added,
      removed: diff.removed
    });

    sendJson(res, 200, { ok: true, revision: nextRevision });
  });
}

function handler(req, res) {
  const url = req.url || '/';
  const pathname = url.split('?')[0];

  if (pathname === '/api/health') {
    let revision = null;
    try { revision = loadDocument().meta.revision; } catch (err) { revision = null; }
    sendJson(res, 200, { ok: true, service: 'wbs-rongcheng', revision });
    return;
  }
  if (pathname === '/api/wbs') {
    if (req.method === 'GET') {
      try {
        sendJson(res, 200, loadDocument());
      } catch (err) {
        sendJson(res, 500, { ok: false, reason: 'storage', message: '数据文件不可读' });
      }
      return;
    }
    if (req.method === 'PUT') { handlePut(req, res); return; }
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, PUT' });
    res.end('405 Method Not Allowed');
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
    res.end('405 Method Not Allowed');
    return;
  }
  const file = resolveStatic(pathname);
  if (!file) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request');
    return;
  }
  sendStatic(req, res, file);
}

if (require.main === module) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const server = http.createServer(handler);
  server.listen(PORT, HOST, () => {
    process.stdout.write('wbs-rongcheng listening on http://' + HOST + ':' + PORT + ' (data: ' + DATA_DIR + ')\n');
  });
}

module.exports = { handler, validateDocument, atomicWriteJson, loadDocument, STATUS_ENUM };
