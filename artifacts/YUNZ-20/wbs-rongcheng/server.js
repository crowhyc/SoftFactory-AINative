'use strict';

/*
 * WC-001 蓉城战役 WBS 工作系统 —— 服务端。
 * 纯 Node 标准库，零运行时依赖；提供静态资源与 /api/wbs、/api/health、/api/history。
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
/* CH-10：五阶段独立进度。phases.<key> 取值为下列五枚举之一；字段级审计路径写作 phases.<key>.status。 */
const PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep'];
const PHASE_ENUM = ['未开始', '已开始', '已完成', '延期', '阻塞'];
const PHASE_LABELS = { design: '设计', dev: '开发', test: '测试', product: '产品验收', demo_prep: '演示准备' };
const MIGRATION_IDENTITY = '系统迁移';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TASK_FIELDS = ['level1', 'level2', 'task', 'owner', 'demo', 'note'];
const IDENTITY_MAX_LEN = 20;
const PROJECT_LEADER = '项目负责人';
const DEFAULT_TZ = 'Asia/Shanghai';
const HISTORY_SNAPSHOT_FIELDS = ['level1', 'level2', 'task', 'owner'];

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
    const seenIdentities = new Set();
    body.identities.forEach((identity, index) => {
      if (typeof identity !== 'string' || identity.trim() === '') {
        push(null, 'identities[' + index + ']', '身份必须是非空字符串');
        return;
      }
      const trimmed = identity.trim();
      if (trimmed.length > IDENTITY_MAX_LEN) {
        push(null, 'identities[' + index + ']', '身份长度必须为 1–' + IDENTITY_MAX_LEN + ' 个字符');
      }
      if (seenIdentities.has(identity)) {
        push(null, 'identities[' + index + ']', '身份重复：' + identity);
        return;
      }
      seenIdentities.add(identity);
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
      const limits = { level1: 200, level2: 200, task: 300, owner: 40, demo: 20, note: 20000 };
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

    /* CH-10：phases 五键必须齐备，取值仅限五枚举；未知阶段字段一律拒绝。 */
    if (!isPlainObject(task.phases)) {
      push(id, 'phases', 'phases 必须是对象');
    } else {
      PHASE_KEYS.forEach((key) => {
        const value = task.phases[key];
        if (typeof value !== 'string' || PHASE_ENUM.indexOf(value) === -1) {
          push(id, 'phases.' + key, '阶段进度必须是 ' + PHASE_ENUM.join(' / ') + ' 之一');
        }
      });
      Object.keys(task.phases).forEach((key) => {
        if (PHASE_KEYS.indexOf(key) === -1) push(id, 'phases.' + key, '未知阶段字段');
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

/* ------------------------------------------------------- CH-10 一次性迁移 */

/* YYYYMMDDHHmmss（本地时区），用于时间戳备份文件名。 */
function compactStamp(at) {
  const d = at instanceof Date ? at : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate()) +
    pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

/* 迁移是否尚未执行：任一行缺少 phases 或取值非法即视为未迁移。 */
function needsMigration(doc) {
  const tasks = (doc && Array.isArray(doc.tasks)) ? doc.tasks : [];
  return tasks.some((task) => {
    if (!isPlainObject(task.phases)) return true;
    const keys = Object.keys(task.phases);
    if (keys.some((key) => PHASE_KEYS.indexOf(key) === -1)) return true;
    return PHASE_KEYS.some((key) => PHASE_ENUM.indexOf(task.phases[key]) === -1);
  });
}

/* 依据 dates.* 一次性生成 phases：日期存在且早于今天 → 延期，否则 → 未开始。
   迁移前先落时间戳备份；审计每阶段一条 type:"migrated"（操作身份「系统迁移」），
   该类型不进日报任何 sheet、也不产生「今日摘要」事件。revision 正常递增。 */
function migrateDocument(doc, today, options) {
  const opts = options || {};
  const at = opts.at || new Date().toISOString();
  let backup = null;
  if (fs.existsSync(DATA_FILE)) {
    backup = DATA_FILE + '.' + compactStamp(new Date(at)) + '.bak';
    fs.copyFileSync(DATA_FILE, backup);
  }
  const revision = Number(doc.meta.revision) + 1;
  const tasks = (doc.tasks || []).map((task) => {
    const phases = {};
    PHASE_KEYS.forEach((key) => {
      const planned = isPlainObject(task.dates) && typeof task.dates[key] === 'string' ? task.dates[key] : '';
      phases[key] = (isValidDateString(planned) && planned < today) ? '延期' : '未开始';
    });
    return Object.assign({}, task, { phases });
  });
  const next = {
    meta: Object.assign({}, doc.meta, { revision, updated_at: at }),
    identities: (doc.identities || []).slice(),
    tasks
  };
  atomicWriteJson(DATA_FILE, next);
  tasks.forEach((task) => {
    PHASE_KEYS.forEach((key) => {
      appendAudit({
        type: 'migrated',
        identity: MIGRATION_IDENTITY,
        task_id: task.id,
        phase: key,
        field: 'phases.' + key + '.status',
        old: '',
        new: task.phases[key],
        at,
        revision
      });
    });
  });
  return { backup, revision, at, migrated: tasks.length * PHASE_KEYS.length };
}

/* 字段级差异：同时给出 old/new 映射（键：任务 id → 字段 → 值）与改动后快照，
   供 audit.log 记录与 /api/history 还原「当日变更」。dates 展开到 dates.<key>。 */
function diffFields(prevDoc, nextDoc) {
  const prev = new Map((prevDoc.tasks || []).map((task) => [task.id, task]));
  const changed = [];
  const oldValues = {};
  const newValues = {};
  const snapshot = {};
  let added = 0;
  (nextDoc.tasks || []).forEach((task) => {
    const old = prev.get(task.id);
    if (!old) { added += 1; return; }
    const touched = [];
    const record = (field, before, after) => {
      touched.push(field);
      if (!oldValues[task.id]) oldValues[task.id] = {};
      if (!newValues[task.id]) newValues[task.id] = {};
      oldValues[task.id][field] = before;
      newValues[task.id][field] = after;
    };
    const fields = new Set([...Object.keys(old), ...Object.keys(task)]);
    fields.forEach((field) => {
      if (JSON.stringify(old[field]) === JSON.stringify(task[field])) return;
      if (field === 'dates') {
        const before = isPlainObject(old.dates) ? old.dates : {};
        const after = isPlainObject(task.dates) ? task.dates : {};
        [...new Set([...Object.keys(before), ...Object.keys(after)])].forEach((key) => {
          const a = before[key] == null ? '' : String(before[key]);
          const b = after[key] == null ? '' : String(after[key]);
          if (a !== b) record('dates.' + key, a, b);
        });
        return;
      }
      /* CH-10：phases 展平为字段级路径 phases.<阶段>.status（契约指定口径），便于日报逐阶段归类。 */
      if (field === 'phases') {
        const before = isPlainObject(old.phases) ? old.phases : {};
        const after = isPlainObject(task.phases) ? task.phases : {};
        [...new Set([...Object.keys(before), ...Object.keys(after)])].forEach((key) => {
          const a = before[key] == null ? '' : String(before[key]);
          const b = after[key] == null ? '' : String(after[key]);
          if (a !== b) record('phases.' + key + '.status', a, b);
        });
        return;
      }
      record(field, old[field], task[field]);
    });
    if (touched.length) {
      changed.push({ id: task.id, fields: touched });
      const snap = {};
      HISTORY_SNAPSHOT_FIELDS.forEach((field) => {
        snap[field] = task[field] == null ? '' : String(task[field]);
      });
      snapshot[task.id] = snap;
    }
    prev.delete(task.id);
  });
  const removed = prev.size;
  return { changed, added, removed, old: oldValues, new: newValues, snapshot };
}

/* ------------------------------------------------------- 变更历史（日报） */

/* 取某时刻在指定时区的 UTC 偏移（毫秒）；时区不可用时回落到 Asia/Shanghai（+08:00）。 */
function tzOffsetMs(instantMs, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(new Date(instantMs));
    const pick = (type) => Number(parts.find((part) => part.type === type).value);
    const asUtc = Date.UTC(pick('year'), pick('month') - 1, pick('day'), pick('hour'), pick('minute'), pick('second'));
    return asUtc - instantMs;
  } catch (err) {
    return 8 * 60 * 60 * 1000;
  }
}

function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (err) {
    return false;
  }
}

/* 时区下的「今天」YYYY-MM-DD。 */
function todayInTimeZone(tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
  } catch (err) {
    return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
}

/* 自然日边界：[当日 00:00:00, 次日 00:00:00) 的 UTC 毫秒。 */
function dayBounds(dateStr, tz) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  let start = utcGuess - tzOffsetMs(utcGuess, tz);
  start = utcGuess - tzOffsetMs(start, tz);
  return { start, end: start + 24 * 60 * 60 * 1000 };
}

/* 真实日历日期校验（拒绝 2026-13-99 这类形式上合法、实际不存在的日期）。 */
function isValidDateString(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/* 读 audit.log：忽略损坏行；无 old/new 的旧格式行跳过（日报「无明细」）。 */
function historyRecords(dateStr, tz) {
  const range = dayBounds(dateStr, tz);
  let raw = '';
  try { raw = fs.readFileSync(AUDIT_FILE, 'utf8'); } catch (err) { raw = ''; }
  const records = [];
  raw.split('\n').forEach((line) => {
    const text = line.trim();
    if (!text) return;
    let entry = null;
    try { entry = JSON.parse(text); } catch (err) { return; }
    if (!isPlainObject(entry)) return;
    /* CH-10：一次性迁移审计（type:"migrated"，身份「系统迁移」）不进日报任何 sheet。 */
    if (entry.type === 'migrated') return;
    /* CH-7：新增人员审计事件 → 日报「当日变更」一行（改动字段 人员池、旧值空、新值姓名）。 */
    if (entry.type === 'identity_added') {
      const atText = entry.at == null ? entry.ts : entry.at;
      const atMs = Date.parse(atText);
      if (!Number.isFinite(atMs) || atMs < range.start || atMs >= range.end) return;
      const name = entry.name == null ? '' : String(entry.name);
      records.push({
        task_id: '',
        field: '人员池',
        at: atText,
        identity: entry.identity == null ? '' : String(entry.identity),
        level1: '', level2: '', task: '新增人员 ' + name, owner: '',
        old: '', new: name
      });
      return;
    }
    if (!isPlainObject(entry.new)) return;
    const at = Date.parse(entry.ts);
    if (!Number.isFinite(at) || at < range.start || at >= range.end) return;
    const oldMap = isPlainObject(entry.old) ? entry.old : {};
    const snapshot = isPlainObject(entry.snapshot) ? entry.snapshot : {};
    Object.keys(entry.new).forEach((taskId) => {
      const newFields = entry.new[taskId];
      if (!isPlainObject(newFields)) return;
      const oldFields = isPlainObject(oldMap[taskId]) ? oldMap[taskId] : {};
      const snap = isPlainObject(snapshot[taskId]) ? snapshot[taskId] : {};
      Object.keys(newFields).forEach((field) => {
        const record = { task_id: taskId, field, at: entry.ts, identity: entry.identity == null ? '' : String(entry.identity) };
        HISTORY_SNAPSHOT_FIELDS.forEach((key) => { record[key] = snap[key] == null ? '' : String(snap[key]); });
        record.old = oldFields[field] == null ? '' : oldFields[field];
        record.new = newFields[field] == null ? '' : newFields[field];
        records.push(record);
      });
    });
  });
  records.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return records;
}

/* ------------------------------------------------ CH-10 当日概览（日报口径） */

/* 重要度排序：延期 > 阻塞 > 到期未更新判定延期 > 完成 > 普通变更。 */
const DAILY_RANK = { '延期': 1, '阻塞': 2, '到期未更新': 3, '完成': 4, '普通': 5 };
const DAILY_PREFIX = { '延期': '延期·高风险', '阻塞': '阻塞·高风险', '到期未更新': '延期·高风险', '完成': '完成', '普通': '普通' };
const DAILY_FIELD_LABELS = { owner: '负责人', level1: '一级', level2: '二级', task: '任务项', demo: '是否演示范围' };

/* MM-DD（结论模板要求的最简日期表达）；空值写「（空）」。 */
function mmdd(value) {
  const text = String(value == null ? '' : value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) return match[2] + '-' + match[3];
  return text === '' ? '（空）' : text;
}

/* 单条字段变更记录的重要度分类（用于「当日变更」排序与摘要结论）。 */
function changeCategory(field, value) {
  const phase = /^phases\.(.+)\.status$/.exec(String(field || ''));
  if (!phase) return '普通';
  if (value === '延期') return '延期';
  if (value === '阻塞') return '阻塞';
  if (value === '已完成') return '完成';
  return '普通';
}

/* 当日概览：三张 sheet 的数据（今日摘要事件 / 阻塞与延期行 / 当日变更明细）。
   派生规则：阶段计划日期 < 今天，且今天 0 点至今该阶段日期与状态都没被更新 → 到期未更新判定延期。 */
function dailyOverview(doc, dateStr, tz) {
  /* CH-10：旧全局 status 字段已废弃，新日报不再引用（历史审计行仍留在 audit.log，仅不进日报）。 */
  const records = historyRecords(dateStr, tz).filter((record) => record.field !== 'status');
  const tasks = (doc && Array.isArray(doc.tasks)) ? doc.tasks : [];
  const byTask = new Map();
  records.forEach((record) => {
    if (!byTask.has(record.task_id)) byTask.set(record.task_id, []);
    byTask.get(record.task_id).push(record);
  });

  const events = [];
  tasks.forEach((task, index) => {
    const taskRecords = byTask.get(task.id) || [];
    const touched = new Set();
    taskRecords.forEach((record) => {
      const d = /^dates\.(.+)$/.exec(record.field);
      if (d) touched.add(d[1]);
      const p = /^phases\.(.+)\.status$/.exec(record.field);
      if (p) touched.add(p[1]);
    });
    const base = {
      level1: task.level1 == null ? '' : String(task.level1),
      level2: task.level2 == null ? '' : String(task.level2),
      task: task.task == null ? '' : String(task.task),
      owner: task.owner == null ? '' : String(task.owner)
    };
    taskRecords.forEach((record) => {
      const phase = /^phases\.(.+)\.status$/.exec(record.field);
      if (phase) {
        const label = PHASE_LABELS[phase[1]] || phase[1];
        let category = '普通';
        let conclusion = label + '进度 ' + (record.old || '（空）') + ' → ' + (record.new || '（空）');
        if (record.new === '延期') { category = '延期'; conclusion = label + '延期'; }
        else if (record.new === '阻塞') { category = '阻塞'; conclusion = '阶段更新为阻塞'; }
        else if (record.new === '已完成') { category = '完成'; conclusion = '阶段已完成'; }
        events.push(Object.assign({}, base, { category, conclusion, at: record.at || '', basis: '当日阶段状态变更', index }));
        return;
      }
      const date = /^dates\.(.+)$/.exec(record.field);
      if (date) {
        const label = PHASE_LABELS[date[1]] || date[1];
        events.push(Object.assign({}, base, {
          category: '普通',
          conclusion: label + '计划 ' + mmdd(record.old) + ' → ' + mmdd(record.new),
          at: record.at || '', basis: '当日日期变更', index
        }));
        return;
      }
      if (record.field === 'note') {
        events.push(Object.assign({}, base, { category: '普通', conclusion: '进展说明已更新', at: record.at || '', basis: '当日字段变更', index }));
        return;
      }
      const label = DAILY_FIELD_LABELS[record.field];
      if (label) {
        events.push(Object.assign({}, base, {
          category: '普通',
          conclusion: label + ' ' + (record.old || '（空）') + ' → ' + (record.new || '（空）'),
          at: record.at || '', basis: '当日字段变更', index
        }));
      }
    });
    PHASE_KEYS.forEach((key) => {
      const planned = isPlainObject(task.dates) ? task.dates[key] : '';
      if (!isValidDateString(planned) || !(planned < dateStr)) return;
      if (isPlainObject(task.phases) && task.phases[key] === '已完成') return;
      if (touched.has(key)) return;
      const label = PHASE_LABELS[key] || key;
      events.push(Object.assign({}, base, {
        category: '到期未更新',
        conclusion: label + ' ' + mmdd(planned) + ' 到期未更新，判定延期',
        at: '', basis: '计划日期早于今天且今日未更新', index
      }));
    });
  });

  events.sort((a, b) => (DAILY_RANK[a.category] - DAILY_RANK[b.category]) ||
    (a.index - b.index) || (Date.parse(a.at || 0) - Date.parse(b.at || 0)));

  const summary = events.length ? events.map((event) => ({
    line: '【' + DAILY_PREFIX[event.category] + '】' + event.level1 + ' / ' + event.level2 + ' / ' +
      event.task + ' @' + event.owner + '：' + event.conclusion + '。',
    importance: DAILY_PREFIX[event.category],
    conclusion: event.conclusion,
    level1: event.level1, level2: event.level2, task: event.task, owner: event.owner,
    at: event.at, basis: event.basis
  })) : [{
    line: '今日无阻塞、延期或变更。', importance: '', conclusion: '',
    level1: '', level2: '', task: '', owner: '', at: '', basis: ''
  }];

  const blockedTasks = tasks.map((task, index) => ({ task, index }))
    .filter((entry) => {
      const phases = isPlainObject(entry.task.phases) ? entry.task.phases : {};
      return PHASE_KEYS.some((key) => phases[key] === '延期' || phases[key] === '阻塞');
    })
    .map((entry) => {
      const phases = entry.task.phases || {};
      const hasBlocked = PHASE_KEYS.some((key) => phases[key] === '阻塞');
      return { task: entry.task, index: entry.index, blocked: hasBlocked ? 0 : 1 };
    })
    .sort((a, b) => (a.blocked - b.blocked) || (a.index - b.index))
    .map((entry) => entry.task);

  const changes = records.slice().sort((a, b) => (DAILY_RANK[changeCategory(a.field, a.new)] - DAILY_RANK[changeCategory(b.field, b.new)]) ||
    (Date.parse(a.at) - Date.parse(b.at)));

  return { date: dateStr, tz, summary, blocked: blockedTasks, changes };
}

/* ------------------------------------------------ CH-13 日报关键信息文本 */

/* CH-13：日报不再产出 xlsx，改为「一键可复制的关键信息文本」，只体现阻塞与延期。
   判定范围（服务端为准，按 tz 自然日）：
   - 阻塞：任一阶段当前状态 = 阻塞（含当天新出现与仍处于阻塞）；
   - 延期：任一阶段当前状态 = 延期；
   - 派生延期：该阶段计划日期 < 今天，且今天 0 点至今该阶段未被更新（日期或状态都不是今天改的）
     → 结论带计划日「{阶段} MM-DD 到期未更新，判定延期。」；该派生结论优先于「{阶段}延期。」。
   同日更新过的阶段按其当前（最新）状态归类，不再派生「到期未更新」；已完成阶段不判延期、也不派生；
   一任务多事件允许多行，各自标签与结论独立。
   排序：延期条目在前、阻塞条目在后；同类内按任务顺序（一级 / 二级 / 任务项）与阶段顺序
   （设计 → 开发 → 测试 → 产品验收 → 演示准备）稳定排列。 */
function dailyText(doc, dateStr, tz) {
  const records = historyRecords(dateStr, tz).filter((record) => record.field !== 'status');
  const tasks = (doc && Array.isArray(doc.tasks)) ? doc.tasks : [];

  /* 今日被更新过的阶段（dates.<key> 或 phases.<key>.status 有当日审计）。 */
  const touched = new Map();
  records.forEach((record) => {
    const day = /^dates\.(.+)$/.exec(record.field);
    const phase = /^phases\.(.+)\.status$/.exec(record.field);
    const key = day ? day[1] : (phase ? phase[1] : null);
    if (!key || PHASE_KEYS.indexOf(key) === -1) return;
    if (!touched.has(record.task_id)) touched.set(record.task_id, new Set());
    touched.get(record.task_id).add(key);
  });

  const delayed = [];
  const blocked = [];
  tasks.forEach((task, index) => {
    const phases = isPlainObject(task.phases) ? task.phases : {};
    const dates = isPlainObject(task.dates) ? task.dates : {};
    const touchedKeys = touched.get(task.id) || new Set();
    const base = {
      level1: task.level1 == null ? '' : String(task.level1),
      level2: task.level2 == null ? '' : String(task.level2),
      task: task.task == null ? '' : String(task.task),
      owner: task.owner == null ? '' : String(task.owner),
      index
    };
    PHASE_KEYS.forEach((key, phaseIndex) => {
      const label = PHASE_LABELS[key] || key;
      const status = phases[key] == null ? '' : String(phases[key]);
      const planned = dates[key] == null ? '' : String(dates[key]);
      const event = Object.assign({}, base, { phase: key, phaseIndex, phaseLabel: label, at: '' });
      if (status === '阻塞') {
        const fresh = touchedKeys.has(key);
        blocked.push(Object.assign(event, {
          category: '阻塞',
          conclusion: label + (fresh ? '更新为阻塞' : '阻塞'),
          basis: fresh ? '当日阶段状态变更（阻塞）' : '当前仍处于阻塞'
        }));
        return;
      }
      /* 已完成不判延期、也不派生（阶段已收口）。 */
      if (status === '已完成') return;
      /* 派生优先：计划日期已过且今日 0 点至今该阶段无人更新 → 用带 MM-DD 的派生结论。 */
      if (isValidDateString(planned) && planned < dateStr && !touchedKeys.has(key)) {
        delayed.push(Object.assign(event, {
          category: '延期',
          conclusion: label + ' ' + mmdd(planned) + ' 到期未更新，判定延期',
          basis: '计划日期早于今天且今日未更新'
        }));
        return;
      }
      if (status === '延期') {
        delayed.push(Object.assign(event, { category: '延期', conclusion: label + '延期', basis: '当前状态为延期（计划日期未过或今日已更新）' }));
      }
    });
  });

  const events = delayed.concat(blocked);
  const lines = events.map((event) => '【' + DAILY_PREFIX[event.category] + '】' + event.level1 + ' / ' + event.level2 + ' / ' +
    event.task + ' @' + event.owner + '：' + event.conclusion + '。');
  const overview = events.length
    ? '今日延期 ' + delayed.length + ' 项 / 阻塞 ' + blocked.length + ' 项'
    : '今日无阻塞、延期。';
  return {
    date: dateStr,
    tz,
    delayedCount: delayed.length,
    blockedCount: blocked.length,
    overview,
    lines,
    events,
    body: [overview].concat(lines).join('\n')
  };
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

/* -------------------------------------------------------------- CH-14 阶段占比 */

/* 最大余数法：counts 为同一阶段五种状态的计数（顺序 = PHASE_ENUM），total 为任务总数。
   先按 1 位小数截断（以 0.1% 为单位做整数运算），再把差额按小数余数从大到小补给相应状态
   （余数相同按状态顺序），保证五项合计恰为 100.0%；total 为 0 时全为 0，不除零也不补齐。
   仅在「该阶段五项计数之和 == 任务总数」时补齐；数据缺 phases / 取值非法导致分母与计数不一致时
   只做 1 位小数截断，不臆造占比。 */
function phasePercentages(counts, total) {
  var BASE = 10;
  var FULL = 100 * BASE;
  if (!total) return counts.map(function () { return 0; });
  var tenths = [];
  var remainders = [];
  var counted = 0;
  counts.forEach(function (count, index) {
    var scaled = count * 100 * BASE;
    tenths[index] = Math.floor(scaled / total);
    remainders[index] = scaled % total;
    counted += count;
  });
  if (counted !== total) return tenths.map(function (value) { return value / BASE; });
  var used = tenths.reduce(function (sum, value) { return sum + value; }, 0);
  var deficit = FULL - used;
  var order = counts.map(function (count, index) { return index; }).sort(function (a, b) {
    if (remainders[b] !== remainders[a]) return remainders[b] - remainders[a];
    return a - b;
  });
  for (var i = 0; i < deficit; i += 1) tenths[order[i % order.length]] += 1;
  return tenths.map(function (value) { return value / BASE; });
}

/* CH-15：一次遍历同时给出两组结果（同源、无二次统计）：
   - aggregate：顶部「全部五阶段合并」全量统计，分母 = 任务总数 × 5；
   - phases：CH-14 原口径的分阶段统计，分母 = 任务总数。
   返回结构自描述且顺序稳定：aggregate.statuses 与每个 phase.statuses 都按 PHASE_ENUM 固定顺序，
   phases 按 PHASE_KEYS 固定顺序；两项百分比各自用最大余数法补齐到 100.0%（0 行时全 0，不除零）。 */
function statsOverview(doc) {
  var tasks = doc && Array.isArray(doc.tasks) ? doc.tasks : [];
  var total = tasks.length;
  var aggregateCounts = PHASE_ENUM.map(function () { return 0; });
  var phases = PHASE_KEYS.map(function (key) {
    var counts = PHASE_ENUM.map(function () { return 0; });
    tasks.forEach(function (task) {
      var progress = task && isPlainObject(task.phases) ? task.phases[key] : null;
      var index = PHASE_ENUM.indexOf(progress);
      if (index !== -1) counts[index] += 1;
    });
    counts.forEach(function (count, index) { aggregateCounts[index] += count; });
    var percentages = phasePercentages(counts, total);
    return {
      key: key,
      name: PHASE_LABELS[key],
      statuses: PHASE_ENUM.map(function (value, index) {
        return { value: value, count: counts[index], percentage: percentages[index] };
      })
    };
  });
  var aggregateDenominator = total * PHASE_KEYS.length;
  var aggregatePercentages = phasePercentages(aggregateCounts, aggregateDenominator);
  return {
    total: total,
    revision: doc && doc.meta ? doc.meta.revision : null,
    aggregate: {
      key: 'aggregate',
      name: '全部五阶段合并',
      denominator: aggregateDenominator,
      statuses: PHASE_ENUM.map(function (value, index) {
        return { value: value, count: aggregateCounts[index], percentage: aggregatePercentages[index] };
      })
    },
    phases: phases
  };
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

    /* CH-7：仅项目负责人可以新增人员；非项目负责人通过 API 直接新增一律拒绝（不落盘、不写审计）。 */
    const identity = decodeIdentity(req.headers['x-identity']);
    const addedIdentities = next.identities.filter((name) => (current.identities || []).indexOf(name) === -1);
    if (addedIdentities.length && identity !== PROJECT_LEADER) {
      sendJson(res, 403, {
        ok: false,
        reason: 'forbidden',
        message: '仅项目负责人可以新增人员',
        errors: [{ id: null, field: 'identities', message: '仅项目负责人可以新增人员' }]
      });
      return;
    }

    const diff = diffFields(current, next);
    try {
      atomicWriteJson(DATA_FILE, next);
    } catch (err) {
      sendJson(res, 500, { ok: false, reason: 'storage', message: '写入失败' });
      return;
    }
    const auditAt = new Date().toISOString();
    appendAudit({
      ts: auditAt,
      identity,
      revision: nextRevision,
      changed: diff.changed,
      added: diff.added,
      removed: diff.removed,
      old: diff.old,
      new: diff.new,
      snapshot: diff.snapshot
    });
    /* CH-7：新增人员成功时追加一条 identity_added 审计记录（失败/重复/非法输入不会到达此处）。 */
    addedIdentities.forEach((name) => {
      appendAudit({ type: 'identity_added', identity, name, at: auditAt });
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
  /* CH-14 / CH-15：全量（aggregate）+ 分阶段（phases）状态「数量 + 占比」只读统计，两组结果同源。
     与 /api/wbs 读同一份文档（同一口径、同一 revision）；
     纯读接口：不改权限矩阵、不写审计、不产生任何下载路径。 */
  if (pathname === '/api/stats') {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET' });
      res.end('405 Method Not Allowed');
      return;
    }
    let doc = null;
    try {
      doc = loadDocument();
    } catch (err) {
      sendJson(res, 500, { ok: false, reason: 'storage', message: '数据文件不可读' });
      return;
    }
    sendJson(res, 200, Object.assign({ ok: true }, statsOverview(doc)));
    return;
  }
  if (pathname === '/api/history') {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET' });
      res.end('405 Method Not Allowed');
      return;
    }
    const query = new URL(url, 'http://127.0.0.1').searchParams;
    const tz = query.get('tz') || DEFAULT_TZ;
    if (!isValidTimeZone(tz)) {
      sendJson(res, 400, { ok: false, errors: [{ id: null, field: 'tz', message: '未知时区：' + tz }] });
      return;
    }
    const date = query.get('date') || todayInTimeZone(tz);
    if (!isValidDateString(date)) {
      sendJson(res, 400, { ok: false, errors: [{ id: null, field: 'date', message: 'date 必须为 YYYY-MM-DD' }] });
      return;
    }
    const range = dayBounds(date, tz);
    const records = historyRecords(date, tz);
    sendJson(res, 200, {
      ok: true,
      date,
      tz,
      from: new Date(range.start).toISOString(),
      to: new Date(range.end).toISOString(),
      count: records.length,
      records
    });
    return;
  }
  /* CH-10：日报三 sheet 的数据源（今日摘要事件 / 阻塞与延期行 / 当日变更明细）。 */
  if (pathname === '/api/daily') {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET' });
      res.end('405 Method Not Allowed');
      return;
    }
    const query = new URL(url, 'http://127.0.0.1').searchParams;
    const tz = query.get('tz') || DEFAULT_TZ;
    if (!isValidTimeZone(tz)) {
      sendJson(res, 400, { ok: false, errors: [{ id: null, field: 'tz', message: '未知时区：' + tz }] });
      return;
    }
    const date = query.get('date') || todayInTimeZone(tz);
    if (!isValidDateString(date)) {
      sendJson(res, 400, { ok: false, errors: [{ id: null, field: 'date', message: 'date 必须为 YYYY-MM-DD' }] });
      return;
    }
    let doc = null;
    try {
      doc = loadDocument();
    } catch (err) {
      sendJson(res, 500, { ok: false, reason: 'storage', message: '数据文件不可读' });
      return;
    }
    const overview = dailyOverview(doc, date, tz);
    /* CH-13：同一响应内追加「一键可复制的关键信息文本」（只含阻塞、延期）；旧三数据源原样保留。 */
    const text = dailyText(doc, date, tz);
    sendJson(res, 200, Object.assign({ ok: true }, overview, {
      text,
      counts: { summary: overview.summary.length, blocked: overview.blocked.length, changes: overview.changes.length }
    }));
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
  /* CH-10：一次性迁移（仅首次）。迁移前落时间戳备份，迁移审计身份为「系统迁移」。 */
  try {
    const doc = loadDocument();
    if (needsMigration(doc)) {
      const info = migrateDocument(doc, todayInTimeZone(DEFAULT_TZ));
      process.stdout.write('[migrate] 已生成 phases（每阶段一条 migrated 审计，身份：' + MIGRATION_IDENTITY +
        '），revision -> ' + info.revision + '，备份：' + (info.backup || '（无原文件）') + '\n');
    }
  } catch (err) {
    process.stderr.write('[migrate] 迁移失败，服务继续启动（未写入数据）：' + err.message + '\n');
  }
  const server = http.createServer(handler);
  server.listen(PORT, HOST, () => {
    process.stdout.write('wbs-rongcheng listening on http://' + HOST + ':' + PORT + ' (data: ' + DATA_DIR + ')\n');
  });
}

module.exports = {
  handler, validateDocument, atomicWriteJson, loadDocument, STATUS_ENUM,
  diffFields, historyRecords, dayBounds, todayInTimeZone, DEFAULT_TZ
  , isValidDateString, PHASE_KEYS, PHASE_ENUM, PHASE_LABELS, MIGRATION_IDENTITY,
  needsMigration, migrateDocument, dailyOverview, dailyText, changeCategory, mmdd, compactStamp
  , statsOverview, phasePercentages
};
