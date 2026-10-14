'use strict';
/* YUNZ-28 / Stage8：隔离实例（同镜像 wbs-rongcheng:20261014203454，端口 4181，隔离数据目录）
 * 复验「旧数据兼容 / 可读可保存 / 日报不报错 / 并发 PUT 409 非覆盖 / CH-7 反例（越权、非法、重复）」。
 * 运行于 mcr.microsoft.com/playwright:v1.55.0-jammy（--network host），真实浏览器 + API + 磁盘三方核对。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(process.env.TOOLS || '/tools', 'node_modules', 'playwright'));
const BASE = process.env.BASE || 'http://127.0.0.1:4181';
const DATA_DIR = process.env.DATA_DIR || '/data';
const OUTDIR = process.env.OUTDIR || '/out';
const TZ = 'Asia/Shanghai';
const results = { base: BASE, started_at: new Date().toISOString(), checks: [] };
let pass = 0, fail = 0;
function check(id, ok, detail) {
  results.checks.push({ id, ok: !!ok, detail: detail === undefined ? null : detail });
  if (ok) { pass += 1; console.log('PASS  ' + id + (detail !== undefined ? '  :: ' + JSON.stringify(detail) : '')); }
  else { fail += 1; console.log('FAIL  ' + id + '  -> ' + JSON.stringify(detail)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(url, init) {
  const res = await fetch(BASE + url, init);
  const text = await res.text();
  let body = null; try { body = JSON.parse(text); } catch (e) { body = text; }
  return { status: res.status, body };
}
const disk = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wbs.json'), 'utf8'));
const auditLines = () => fs.readFileSync(path.join(DATA_DIR, 'audit.log'), 'utf8').split('\n').filter((s) => s.trim());
const auditJson = () => auditLines().map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const put = (doc, identity, rev, override) => api('/api/wbs', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'If-Match': String(rev), 'X-Identity': encodeURIComponent(identity) },
  body: JSON.stringify(override || { meta: { name: doc.meta.name }, identities: doc.identities, tasks: doc.tasks })
});

(async () => {
  fs.mkdirSync(path.join(OUTDIR, 'isolated'), { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ acceptDownloads: true, timezoneId: TZ, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  let dialogBehavior = 'dismiss';
  page.on('dialog', async (d) => { if (dialogBehavior === 'accept') await d.accept(); else await d.dismiss(); });

  // 1) 旧格式数据：纯读
  const legacyAudit = fs.readFileSync(path.join(DATA_DIR, 'audit.log'), 'utf8');
  check('L1.legacy-audit-format-on-disk', legacyAudit.includes('"changed"') && !legacyAudit.includes('"old"') && !legacyAudit.includes('"new"'), legacyAudit.split('\n').filter(Boolean).length);
  const h = await api('/api/health');
  check('L2.isolated-health-ok', h.status === 200 && h.body.ok === true, h.body);
  const d0 = await api('/api/wbs');
  check('L3.legacy-wbs-readable', d0.status === 200 && d0.body.tasks.length === 36 && d0.body.identities.length === 9 && d0.body.meta.revision === 1, { rev: d0.body.meta.revision, tasks: d0.body.tasks.length, identities: d0.body.identities.length });
  const hist0 = await api('/api/history?date=' + today() + '&tz=' + TZ);
  check('L4.legacy-history-no-detail-skipped', hist0.status === 200 && hist0.body.count === 0, { count: hist0.body.count, from: hist0.body.from, to: hist0.body.to });

  // 2) 旧格式下：页面渲染 / 导出日报不报错（真实浏览器）
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('#identity-list button', { timeout: 20000 });
  await page.click('#identity-list button[data-identity="项目负责人"]');
  await page.waitForFunction(() => !document.getElementById('workbench').hidden && document.getElementById('wbs-body').children.length > 0, null, { timeout: 15000 });
  const rendered = await page.evaluate(() => document.querySelectorAll('#wbs-body tr').length);
  check('L5.legacy-render-36-rows', rendered === 36, rendered);
  const [dlWbs] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#export-btn')]);
  await dlWbs.saveAs(path.join(OUTDIR, 'isolated', 'legacy-wbs-export.xlsx'));
  const docLegacy = (await api('/api/wbs')).body;
  const histLegacy = (await api('/api/history?date=' + today() + '&tz=' + TZ)).body;
  const legacyExportAt = new Date();
  const [dlDaily] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#daily-btn')]);
  await dlDaily.saveAs(path.join(OUTDIR, 'isolated', 'legacy-daily-export.xlsx'));
  const dailyBanner = await page.evaluate(() => ({ cls: document.getElementById('banner').className, text: document.getElementById('banner-text').textContent }));
  check('L6.legacy-daily-export-no-error', fs.existsSync(path.join(OUTDIR, 'isolated', 'legacy-daily-export.xlsx')) && !dailyBanner.cls.includes('error') && dailyBanner.text.includes('导出日报'), { banner: dailyBanner, historyCount: histLegacy.count });
  fs.writeFileSync(path.join(OUTDIR, 'isolated', 'legacy-snapshots.json'), JSON.stringify({ doc: docLegacy, history: histLegacy, exportAt: legacyExportAt.toISOString() }, null, 2));

  // 3) 旧格式下：真实保存往返（可保存）
  const revBeforeSave = (await api('/api/wbs')).body.meta.revision;
  await page.click('#wbs-body tr[data-id="T005"] [data-edit-row]');
  await sleep(150);
  await page.fill('#wbs-body tr[data-id="T005"] td[data-field="note"] textarea', '旧数据兼容复验保存');
  await page.locator('#wbs-body tr[data-id="T005"] td[data-field="note"] textarea').press('Tab');
  await sleep(200);
  await page.click('#save-btn');
  await page.waitForFunction(() => { const b = document.getElementById('banner'); return !b.hidden && b.className.includes('ok'); }, null, { timeout: 15000 });
  const afterSave = (await api('/api/wbs')).body;
  const diskAfterSave = disk();
  check('L7.legacy-save-roundtrip-3way', afterSave.meta.revision === revBeforeSave + 1 && afterSave.tasks.filter((t) => t.id === 'T005')[0].note === '旧数据兼容复验保存' && diskAfterSave.tasks.filter((t) => t.id === 'T005')[0].note === '旧数据兼容复验保存', { rev: { before: revBeforeSave, after: afterSave.meta.revision }, api: afterSave.tasks[4].note, disk: diskAfterSave.tasks[4].note });

  // 4) 并发 PUT：旧版本后到必须 409 且不覆盖
  const base = (await api('/api/wbs')).body;
  const rev = base.meta.revision;
  const staleDoc = JSON.parse(JSON.stringify(base));
  const ts = '并发复验-' + Date.now();
  const docA = JSON.parse(JSON.stringify(base));
  docA.tasks.filter((t) => t.id === 'T006')[0].note = ts + '-先到';
  const docB = JSON.parse(JSON.stringify(staleDoc));
  docB.tasks.filter((t) => t.id === 'T006')[0].note = ts + '-后到';
  const rA = await put(docA, '项目负责人', rev);
  const rB = await put(docB, '项目负责人', rev);
  await sleep(200);
  const diskNow = disk();
  check('L8.concurrent-put-later-409-not-overwrite', rA.status === 200 && rA.body.revision === rev + 1 && rB.status === 409 && rB.body.reason === 'conflict' && rB.body.current === rev + 1 &&
    diskNow.tasks.filter((t) => t.id === 'T006')[0].note === ts + '-先到' && diskNow.meta.revision === rev + 1, { a: rA, b: rB, diskNote: diskNow.tasks[5].note, diskRev: diskNow.meta.revision });

  // 5) CH-7 反例：非项目负责人新增（API 直连）
  const before = { api: (await api('/api/wbs')).body, audit: auditJson().length };
  const docForbidden = JSON.parse(JSON.stringify(before.api));
  docForbidden.identities = docForbidden.identities.concat(['越权甲']);
  const rForbidden = await put(docForbidden, '王言', before.api.meta.revision);
  await sleep(150);
  const afterForbiddenApi = (await api('/api/wbs')).body;
  check('N1.CH7-non-pm-api-add-forbidden-403', rForbidden.status === 403 && rForbidden.body.reason === 'forbidden' && afterForbiddenApi.identities.indexOf('越权甲') === -1 && afterForbiddenApi.meta.revision === before.api.meta.revision && disk().identities.indexOf('越权甲') === -1, { status: rForbidden.status, body: rForbidden.body, rev: afterForbiddenApi.meta.revision });
  check('N2.CH7-forbidden-writes-no-audit', auditJson().length === before.audit && auditJson().every((e) => e.name !== '越权甲'), { before: before.audit, after: auditJson().length });

  // 6) CH-7 反例：重复 / 空 / 超长（项目负责人直连 API → 400，且不写审计）
  const dup = JSON.parse(JSON.stringify(before.api));
  dup.identities = dup.identities.concat(['李欢']);
  const empty = JSON.parse(JSON.stringify(before.api));
  empty.identities = empty.identities.concat(['']);
  const toolong = JSON.parse(JSON.stringify(before.api));
  toolong.identities = toolong.identities.concat(['123456789012345678901']);
  const rDup = await put(dup, '项目负责人', before.api.meta.revision);
  const rEmpty = await put(empty, '项目负责人', before.api.meta.revision);
  const rLong = await put(toolong, '项目负责人', before.api.meta.revision);
  await sleep(150);
  check('N3.CH7-duplicate-empty-toolong-400', rDup.status === 400 && rEmpty.status === 400 && rLong.status === 400, { dup: rDup.status, empty: rEmpty.status, toolong: rLong.status, msg: rDup.body.errors && rDup.body.errors[0] && rDup.body.errors[0].message });
  check('N4.CH7-invalid-inputs-no-audit-no-revision', auditJson().length === before.audit && (await api('/api/wbs')).body.meta.revision === before.api.meta.revision, { audit: auditJson().length, rev: (await api('/api/wbs')).body.meta.revision });

  // 7) 项目负责人合法新增（API 直连路径）→ 审计 + history + 供重启持久复验
  const okDoc = JSON.parse(JSON.stringify((await api('/api/wbs')).body));
  okDoc.identities = okDoc.identities.concat(['重启甲']);
  const rOk = await put(okDoc, '项目负责人', okDoc.meta.revision);
  await sleep(200);
  const ev = auditJson().filter((e) => e.type === 'identity_added' && e.name === '重启甲');
  const histOk = (await api('/api/history?date=' + today() + '&tz=' + TZ)).body;
  check('N5.CH7-pm-api-add-writes-audit-and-history', rOk.status === 200 && ev.length === 1 && ev[0].identity === '项目负责人' && histOk.records.filter((r) => r.field === '人员池' && r.new === '重启甲').length === 1, { status: rOk.status, ev: ev, hist: histOk.records.filter((r) => r.field === '人员池') });
  check('N6.no-pageerror-isolated', pageErrors.length === 0, pageErrors);
  fs.writeFileSync(path.join(OUTDIR, 'isolated', 'iso1-results.json'), JSON.stringify({ results, pass, fail, preRestart: { revision: (await api('/api/wbs')).body.meta.revision, identities: (await api('/api/wbs')).body.identities, noteT005: (await api('/api/wbs')).body.tasks[4].note, noteT006: (await api('/api/wbs')).body.tasks[5].note, auditLines: auditJson().length } }, null, 2));
  console.log('\n==== ISO1 PASS=' + pass + ' FAIL=' + fail + ' ====');
  await context.close(); await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => { console.log('FATAL ' + (err && err.stack || err)); results.fatal = String(err); process.exit(2); });
