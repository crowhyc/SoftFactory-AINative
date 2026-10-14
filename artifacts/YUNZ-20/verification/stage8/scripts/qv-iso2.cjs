'use strict';
/* YUNZ-28 / Stage8：隔离实例重启后复验（容器 restart 之后：数据仍在、审计仍可读、日报仍可用）。 */
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:4181';
const DATA_DIR = process.env.DATA_DIR || '/data';
const OUTDIR = process.env.OUTDIR || '/out';
const TZ = 'Asia/Shanghai';
let pass = 0, fail = 0;
const results = { base: BASE, checks: [] };
function check(id, ok, detail) {
  results.checks.push({ id, ok: !!ok, detail });
  if (ok) { pass += 1; console.log('PASS  ' + id + (detail !== undefined ? '  :: ' + JSON.stringify(detail) : '')); }
  else { fail += 1; console.log('FAIL  ' + id + '  -> ' + JSON.stringify(detail)); }
}
async function api(url) { const r = await fetch(BASE + url); const t = await r.text(); let b = null; try { b = JSON.parse(t); } catch (e) { b = t; } return { status: r.status, body: b }; }
const disk = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wbs.json'), 'utf8'));
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
(async () => {
  const prev = JSON.parse(fs.readFileSync(path.join(OUTDIR, 'isolated', 'iso1-results.json'), 'utf8')).preRestart;
  const h = await api('/api/health');
  check('R1.health-after-restart', h.status === 200 && h.body.ok === true, h.body);
  const d = await api('/api/wbs');
  check('R2.data-persists-after-restart', d.body.meta.revision === prev.revision && d.body.tasks[4].note === prev.noteT005 && d.body.tasks[5].note === prev.noteT006 && JSON.stringify(d.body.identities) === JSON.stringify(prev.identities), { rev: d.body.revision, noteT005: d.body.tasks[4].note, noteT006: d.body.tasks[5].note, identities: d.body.identities });
  check('R3.added-identity-persists', d.body.identities.indexOf('重启甲') !== -1 && disk().identities.indexOf('重启甲') !== -1, d.body.identities);
  const hist = await api('/api/history?date=' + today() + '&tz=' + TZ);
  check('R4.history-readable-after-restart', hist.status === 200 && hist.body.count >= 2 && hist.body.records.some((r) => r.field === '人员池' && r.new === '重启甲'), { count: hist.body.count, fields: hist.body.records.map((r) => r.task_id + ':' + r.field) });
  const lines = fs.readFileSync(path.join(DATA_DIR, 'audit.log'), 'utf8').split('\n').filter((s) => s.trim());
  const legacyKept = lines.filter((l) => l.includes('"changed"') && !l.includes('"old"')).length;
  check('R5.legacy-audit-lines-kept-and-append-only', legacyKept === 2 && lines.length >= prev.auditLines, { legacyKept, lines: lines.length, before: prev.auditLines });
  results.summary = { pass, fail };
  fs.writeFileSync(path.join(OUTDIR, 'isolated', 'iso2-results.json'), JSON.stringify({ results, prevRestart: prev }, null, 2));
  console.log('\n==== ISO2 PASS=' + pass + ' FAIL=' + fail + ' ====');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.log('FATAL ' + (e && e.stack || e)); process.exit(2); });
