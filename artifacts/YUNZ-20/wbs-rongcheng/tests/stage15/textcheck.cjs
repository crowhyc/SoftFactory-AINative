'use strict';
/* YUNZ-35 / 变更包 #6（CH-13 日报改为「一键可复制关键信息文本」）服务端文本口径自测。
   运行在宿主（Node 标准库，无浏览器依赖）：起隔离数据目录的被测服务，用 PUT 造出「今日更新」审计，
   再读 /api/daily 的 text，逐条断言 02 / 03 / 04 / 05 / 06 的口径。
   用法：node tests/stage15/textcheck.cjs
   不触碰运行现场 /opt/wbs-rongcheng/data 与 0.0.0.0:4180。 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const APP_DIR = process.env.APP_DIR || '/opt/wbs-rongcheng';
const TZ = 'Asia/Shanghai';
const PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep'];
const PORT = Number(process.env.WBS_TEXT_PORT || 4290);
const PORT2 = PORT + 1;
const BASE = 'http://127.0.0.1:' + PORT;
const BASE2 = 'http://127.0.0.1:' + PORT2;
const OUTDIR = process.env.OUTDIR || path.join(APP_DIR, 'tests/.tmp/stage15-text');
const DATA_A = path.join(OUTDIR, 'data-a');
const DATA_B = path.join(OUTDIR, 'data-b');

const results = { checked_at: new Date().toISOString(), checks: [] };
let pass = 0;
let fail = 0;
function check(id, ok, detail) {
  results.checks.push({ id, ok: !!ok, detail: detail === undefined ? null : detail });
  if (ok) { pass += 1; console.log('PASS  ' + id + (detail !== undefined ? '  :: ' + JSON.stringify(detail) : '')); }
  else { fail += 1; console.log('FAIL  ' + id + '  -> ' + JSON.stringify(detail)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function shiftDay(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + delta);
  return at.toISOString().slice(0, 10);
}
const mmdd = (dateStr) => String(dateStr).slice(5);
const api = async (base, url, init) => {
  const response = await fetch(base + url, init);
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch (err) { body = text; }
  return { status: response.status, body };
};
const payloadOf = (doc) => ({ meta: { name: doc.meta.name }, identities: doc.identities.slice(), tasks: doc.tasks });

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

/* 基准文档：全部计划日期在未来、全部阶段「未开始」（无迁移、无当日审计）。 */
function baseDoc(today) {
  const seed = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'data', 'wbs.seed.json'), 'utf8'));
  const far = shiftDay(today, 90);
  seed.meta.revision = 0;
  seed.tasks.forEach((task, index) => {
    task.dates = {};
    task.phases = {};
    PHASE_KEYS.forEach((key, phaseIndex) => {
      task.dates[key] = shiftDay(far, (index + phaseIndex) % 20);
      task.phases[key] = '未开始';
    });
  });
  return seed;
}
const findTask = (doc, id) => doc.tasks.find((task) => task.id === id);

(async () => {
  fs.rmSync(OUTDIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_A, { recursive: true });
  fs.mkdirSync(DATA_B, { recursive: true });
  const today = todayStr();
  const yesterday = shiftDay(today, -1);
  const twoWeeksAgo = shiftDay(today, -14);
  try {
    /* ===== 实例 A：构造用例（当前状态 + 派生规则 + 去重 + 边界） ===== */
    const docA = baseDoc(today);
    findTask(docA, 'T001').dates.design = yesterday;          // 当前状态=延期 + 计划日期已过 + 今日未更新 → 派生结论优先
    findTask(docA, 'T001').phases.design = '延期';
    findTask(docA, 'T002').dates.dev = yesterday;            // 派生：计划日期 < 今天且今日未更新
    findTask(docA, 'T002').dates.test = yesterday;           // 同一任务第二事件
    findTask(docA, 'T002').phases.test = '阻塞';              // 仍处于阻塞（今日未更新）
    findTask(docA, 'T003').dates.dev = yesterday;            // 今日 PUT 改状态 → 不重复派生「到期未更新」
    findTask(docA, 'T004').dates.test = yesterday;           // 今日 PUT 改状态为阻塞 → 当天新出现
    findTask(docA, 'T005').dates.product = yesterday;        // 今日 PUT 改状态为已完成 → 完成不进日报、抑制派生
    findTask(docA, 'T006').dates.dev = twoWeeksAgo;          // 今日 PUT 改日期（仍是过去日期）→ 不派生
    findTask(docA, 'T007').dates.test = yesterday;           // 今日 PUT 改状态为延期
    findTask(docA, 'T008').dates.test = today;               // 边界：计划日期 = 今天 → 不派生
    findTask(docA, 'T009').dates.product = '';               // 边界：日期为空 → 不派生
    findTask(docA, 'T010').dates.demo_prep = yesterday;      // 已完成（今日未更新）→ 不派生、不进日报
    findTask(docA, 'T010').phases.demo_prep = '已完成';
    findTask(docA, 'T011').phases.product = '延期';          // 当前状态=延期且计划日期未过 → 「{阶段}延期。」
    fs.writeFileSync(path.join(DATA_A, 'wbs.json'), JSON.stringify(docA, null, 2) + '\n');

    spawnServer('A', PORT, DATA_A);
    await waitReady(BASE);

    /* 今日更新（一次保存，写入当日审计）：T003 状态、T004 状态、T005 状态、T007 状态、T006 日期。 */
    const before = (await api(BASE, '/api/wbs')).body;
    const put = await api(BASE, '/api/wbs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': String(before.meta.revision), 'X-Identity': encodeURIComponent('项目负责人') },
      body: JSON.stringify(payloadOf({
        meta: before.meta,
        identities: before.identities,
        tasks: before.tasks.map((task) => {
          const next = JSON.parse(JSON.stringify(task));
          if (task.id === 'T003') next.phases.dev = '已开始';
          if (task.id === 'T004') next.phases.test = '阻塞';
          if (task.id === 'T005') next.phases.product = '已完成';
          if (task.id === 'T007') next.phases.test = '延期';
          if (task.id === 'T006') next.dates.dev = yesterday;
          return next;
        })
      }))
    });
    check('准备 PUT 今日更新写入审计（HTTP 200，revision 递增）', put.status === 200 && put.body.ok === true, put.body);

    const daily = (await api(BASE, '/api/daily?tz=' + TZ + '&date=' + today)).body;
    const text = daily.text || {};
    const lines = Array.isArray(text.lines) ? text.lines.slice() : [];
    const line = (prefix, id, conclusion) => {
      const task = findTask(docA, id);
      return '【' + prefix + '】' + task.level1 + ' / ' + task.level2 + ' / ' + task.task + ' @' + task.owner + '：' + conclusion + '。';
    };
    const expectLines = [
      line('延期·高风险', 'T001', '设计 ' + mmdd(yesterday) + ' 到期未更新，判定延期'),
      line('延期·高风险', 'T002', '开发 ' + mmdd(yesterday) + ' 到期未更新，判定延期'),
      line('延期·高风险', 'T007', '测试延期'),
      line('延期·高风险', 'T011', '产品延期'),
      line('阻塞·高风险', 'T002', '测试阻塞'),
      line('阻塞·高风险', 'T004', '测试更新为阻塞')
    ];
    const expectBody = ['今日延期 4 项 / 阻塞 2 项'].concat(expectLines).join('\n');

    /* 02：概况行计数与事件行数一致；文本 = 概况行 + 事件行。 */
    check('矩阵02 顶部概况行固定为「今日延期 X 项 / 阻塞 Y 项」，且 X/Y = 事件行数、与 counts 一致',
      text.overview === '今日延期 4 项 / 阻塞 2 项' && text.delayedCount === 4 && text.blockedCount === 2 &&
      lines.filter((l) => l.indexOf('【延期·高风险】') === 0).length === 4 &&
      lines.filter((l) => l.indexOf('【阻塞·高风险】') === 0).length === 2 &&
      text.body === [text.overview].concat(lines).join('\n'),
      { overview: text.overview, delayedCount: text.delayedCount, blockedCount: text.blockedCount, lines: lines.length });

    /* 06 + 03 + 04：逐字模板 / 排序 / 派生与去重 —— 用整段文本逐字比对（最强断言）。 */
    check('矩阵06 事件行逐字为「【延期·高风险】/【阻塞·高风险】一级 / 二级 / 任务项 @负责人：结论。」（@ 与高风险前缀保留）',
      JSON.stringify(lines) === JSON.stringify(expectLines) && text.body === expectBody,
      { expect: expectBody.split('\n'), actual: text.body.split('\n') });

    check('矩阵03 延期条目在前、阻塞条目在后；同类内按任务与阶段顺序稳定排列（设计→开发→测试→产品→演示准备）',
      lines.indexOf(expectLines[0]) === 0 && lines.indexOf(expectLines[1]) === 1 && lines.indexOf(expectLines[2]) === 2 &&
      lines.indexOf(expectLines[3]) === 3 && lines.indexOf(expectLines[4]) === 4 && lines.indexOf(expectLines[5]) === 5,
      { actual: lines.length, actualLines: lines });

    check('矩阵04 派生规则：计划日期 < 今天且今日未更新 → 「{阶段} MM-DD 到期未更新，判定延期。」（优先于「{阶段}延期。」）',
      lines.indexOf(line('延期·高风险', 'T002', '开发 ' + mmdd(yesterday) + ' 到期未更新，判定延期')) !== -1 &&
      lines.indexOf(line('延期·高风险', 'T001', '设计 ' + mmdd(yesterday) + ' 到期未更新，判定延期')) !== -1 &&
      lines.filter((l) => l.indexOf('到期未更新，判定延期') !== -1).length === 2 &&
      lines.indexOf(line('延期·高风险', 'T011', '产品延期')) !== -1,
      { derived: lines.filter((l) => l.indexOf('到期未更新') !== -1), plain: lines.filter((l) => l.indexOf('延期。') === l.length - 3) });

    check('矩阵04 去重规则：今日更新过的阶段（状态 T003 / 日期 T006）按实际状态归类，不再派生「到期未更新」',
      lines.filter((l) => l.indexOf('概要设计&评审') !== -1).length === 0 &&
      lines.filter((l) => l.indexOf('代码开发') !== -1).length === 0 &&
      lines.filter((l) => l.indexOf('到期未更新') !== -1).length === 2,
      { t003: lines.filter((l) => l.indexOf('概要设计&评审') !== -1), t006: lines.filter((l) => l.indexOf('代码开发') !== -1) });

    check('矩阵04 边界与抑制：计划日期=今天 / 日期为空 / 已完成（今日改状态 T005、未更新 T010）都不进日报',
      lines.filter((l) => l.indexOf('研发测试') !== -1).length === 0 &&
      lines.filter((l) => l.indexOf('空间指标') !== -1).length === 0 &&
      lines.filter((l) => l.indexOf('程序设计') !== -1).length === 0 &&
      lines.filter((l) => l.indexOf('研发产物沉淀') !== -1).length === 0,
      { lines: lines.length });

    check('矩阵04 阻塞范围含「当天新出现」（T004 更新为阻塞）与「仍处于阻塞」（T002 测试，今日未更新）',
      lines.indexOf(line('阻塞·高风险', 'T004', '测试更新为阻塞')) !== -1 &&
      lines.indexOf(line('阻塞·高风险', 'T002', '测试阻塞')) !== -1 &&
      text.blockedCount === 2,
      { blocked: lines.filter((l) => l.indexOf('【阻塞·高风险】') === 0) });

    check('矩阵06 只体现阻塞、延期：不存在「完成 / 普通」前缀，也不含当日普通变更（日期/进展说明）',
      lines.every((l) => /^【(延期|阻塞)·高风险】.+ \/ .+ \/ .+ @.+：.+。$/.test(l)) &&
      lines.every((l) => l.indexOf('【完成】') === -1 && l.indexOf('【普通】') === -1 && l.indexOf('【到期未更新】') === -1),
      lines);

    /* 回归：/api/daily 旧三数据源原样保留（服务端汇总逻辑保留作为数据源）。 */
    check('矩阵06 回归 /api/daily 仍返回 summary / blocked / changes / counts（旧数据源未回归）',
      Array.isArray(daily.summary) && Array.isArray(daily.blocked) && Array.isArray(daily.changes) &&
      daily.counts && typeof daily.counts.summary === 'number',
      { counts: daily.counts });

    /* ===== 实例 B：无事件兜底 ===== */
    fs.writeFileSync(path.join(DATA_B, 'wbs.json'), JSON.stringify(baseDoc(today), null, 2) + '\n');
    spawnServer('B', PORT2, DATA_B);
    await waitReady(BASE2);
    const quiet = (await api(BASE2, '/api/daily?tz=' + TZ + '&date=' + today)).body;
    check('矩阵05 无任何阻塞/延期时：整体文本只有一行「今日无阻塞、延期。」（无概况行）',
      quiet.text && quiet.text.body === '今日无阻塞、延期。' && quiet.text.lines.length === 0 &&
      quiet.text.delayedCount === 0 && quiet.text.blockedCount === 0 &&
      quiet.text.body.split('\n').length === 1,
      quiet.text);

    await stopServer('B');
    await stopServer('A');
  } catch (err) {
    check('stage15 服务端文本口径用例集执行', false, err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : String(err));
  } finally {
    await stopServer('A');
    await stopServer('B');
  }
  results.summary = { pass, fail };
  fs.writeFileSync(path.join(OUTDIR, 'textcheck-results.json'), JSON.stringify(results, null, 2));
  console.log('---');
  console.log('PASS=' + pass + ' FAIL=' + fail);
  process.exit(fail === 0 ? 0 : 1);
})();
