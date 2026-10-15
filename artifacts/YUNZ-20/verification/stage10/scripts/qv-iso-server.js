/* YUNZ-30 / Stage10：服务端侧契约用例（隔离实例 4181，宿主直接跑，不需要浏览器）
 * 覆盖：note 长度上限 20000 边界、非法类型、超长不落盘、409 非覆盖、/api/history 与文档契约不变。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const BASE = process.env.QV_BASE || 'http://127.0.0.1:4181';
const ISO_DATA = process.env.QV_ISO_DATA || '';
const results = [];
let pass = 0, fail = 0;
function check(name, cond, detail) { const ok = !!cond; ok ? pass++ : fail++; results.push({ name, ok, detail }); console.log((ok ? 'PASS  ' : 'FAIL  ') + name + '  :: ' + JSON.stringify(detail)); }
const api = async (p, init) => { const r = await fetch(BASE + p, init); return { status: r.status, body: await r.json().catch(() => null) }; };
const getDoc = async () => (await api('/api/wbs')).body;
const diskDoc = () => JSON.parse(fs.readFileSync(path.join(ISO_DATA, 'wbs.json'), 'utf8'));
const put = (doc, identity, ifMatch) => api('/api/wbs', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'If-Match': String(ifMatch), 'X-Identity': encodeURIComponent(identity) },
  body: JSON.stringify({ meta: { name: doc.meta.name }, identities: doc.identities, tasks: doc.tasks })
});

(async () => {
  const d0 = await getDoc();
  check('服务端 S1：GET /api/wbs 文档契约不变（meta.revision/identities/tasks；note 仍为字符串）',
    typeof d0.meta.revision === 'number' && Array.isArray(d0.identities) && d0.tasks.length === 36
    && d0.tasks.every((t) => typeof t.note === 'string'), { rev: d0.meta.revision, tasks: d0.tasks.length });

  /* 边界：恰好 20000 接受 */
  const edge = d0.tasks.map((t) => (t.id === 'T005' ? Object.assign({}, t, { note: 'y'.repeat(20000) }) : t));
  const r1 = await put(Object.assign({}, d0, { tasks: edge }), '余宇', d0.meta.revision);
  const d1 = await getDoc();
  check('服务端 S2：note 恰好 20000 字符被接受（200 + revision 递增 + 落盘长度 20000）',
    r1.status === 200 && r1.body.revision === d0.meta.revision + 1
    && d1.tasks.find((t) => t.id === 'T005').note.length === 20000
    && diskDoc().tasks.find((t) => t.id === 'T005').note.length === 20000,
    { status: r1.status, rev: r1.body.revision, diskLen: diskDoc().tasks.find((t) => t.id === 'T005').note.length });

  /* 超长 20001 拒绝且不落盘 */
  const revBefore = d1.meta.revision;
  const diskBefore = fs.readFileSync(path.join(ISO_DATA, 'wbs.json'), 'utf8');
  const over = d1.tasks.map((t) => (t.id === 'T005' ? Object.assign({}, t, { note: 'z'.repeat(20001) }) : t));
  const r2 = await put(Object.assign({}, d1, { tasks: over }), '余宇', revBefore);
  const d2 = await getDoc();
  check('服务端 S3：note 20001 字符被服务端拒绝（400 + 中文错误指向 note 上限，revision 不变、磁盘逐字节未变）',
    r2.status === 400 && JSON.stringify(r2.body.errors).includes('20000') && d2.meta.revision === revBefore
    && fs.readFileSync(path.join(ISO_DATA, 'wbs.json'), 'utf8') === diskBefore,
    { status: r2.status, errors: r2.body && r2.body.errors, rev: d2.meta.revision });

  /* 非法类型 */
  const bad = d2.tasks.map((t) => (t.id === 'T005' ? Object.assign({}, t, { note: 123 }) : t));
  const r3 = await put(Object.assign({}, d2, { tasks: bad }), '余宇', d2.meta.revision);
  check('服务端 S4：note 非字符串被拒绝（400，note 必须是字符串）—— 数据契约未放宽',
    r3.status === 400 && JSON.stringify(r3.body.errors).includes('note') && (await getDoc()).meta.revision === d2.meta.revision,
    { status: r3.status, errors: r3.body && r3.body.errors });

  /* 409 非覆盖 */
  const d3 = await getDoc();
  const stale = d3.tasks.map((t) => (t.id === 'T005' ? Object.assign({}, t, { note: 'STALE-WRITE' }) : t));
  const r4 = await put(Object.assign({}, d3, { tasks: stale }), '余宇', d3.meta.revision - 1);
  check('服务端 S5：过期 If-Match → 409 且不覆盖（磁盘 note 仍为 20000 字符边界值）',
    r4.status === 409 && r4.body.current === d3.meta.revision && diskDoc().tasks.find((t) => t.id === 'T005').note.startsWith('y'),
    { status: r4.status, current: r4.body && r4.body.current });

  /* /api/history 字段契约 */
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const h = await api('/api/history?tz=' + encodeURIComponent('Asia/Shanghai') + '&date=' + today);
  const keys = Array.from(new Set((h.body.records || []).flatMap((r) => Object.keys(r)))).sort();
  check('服务端 S6：/api/history 无新字段（记录键集不变），且当日含 note 记录、旧值/新值为 Markdown 原文',
    h.status === 200 && JSON.stringify(keys) === JSON.stringify(['at', 'field', 'identity', 'level1', 'level2', 'new', 'old', 'owner', 'task', 'task_id'])
    && (h.body.records || []).some((r) => r.field === 'note' && r.new === 'y'.repeat(20000)),
    { keys, count: (h.body.records || []).length });

  console.log('---'); console.log('PASS=' + pass + ' FAIL=' + fail);
  fs.writeFileSync(path.join(process.env.QV_OUT || '.', 'results', 'iso-server-results.json'), JSON.stringify({ base: BASE, pass, fail, results }, null, 2));
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(2); });
