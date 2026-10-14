// WC-001 作者自测：DOM 级交互验证（真实 server.js + jsdom 承载 index.html/app.js）。
// jsdom 仅作为作者自测工具，安装在 tests/.tools/（不进源码快照、不进镜像），可用 WBS_JSDOM_DIR 覆盖。
// 产物运行时零第三方依赖：jsdom 只在自测阶段加载 index.html/app.js。
// 用法：node tests/domcheck.mjs [--only tag1,tag2]
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCols } from './xlsxcols.mjs';
import crypto from 'node:crypto';

// WBS_JSDOM_DIR 指向安装 jsdom 的测试工具目录（产物之外），默认 /opt/wbs-testharness
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = process.env.WBS_JSDOM_DIR || path.join(__dirname, '.tools');
const require = createRequire(path.join(HARNESS, 'package.json'));
const ROOT = path.join(__dirname, '..');
const TMP = path.join(__dirname, '.tmp');
const DATA_DIR = path.join(TMP, 'dom-data');
const PORT = Number(process.env.WBS_TEST_PORT || 4201);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA_FILE = path.join(DATA_DIR, 'wbs.json');

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
};
const ONLY = (opt('--only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const want = (tag) => ONLY.length === 0 || ONLY.includes(tag);

let JSDOM = null;
let VirtualConsole = null;
try {
  const api = require('jsdom');
  JSDOM = api.JSDOM;
  VirtualConsole = api.VirtualConsole;
} catch (err) {
  console.log('SKIP  jsdom 不可用（' + HARNESS + '）：' + err.message);
  console.log('SKIP  DOM 级自测需要 jsdom，本项由独立验证 AI-QV 用其自有 DOM 环境复跑；其余 17 项由 selfcheck/exportcheck/容器自测覆盖。');
  process.exit(0);
}

let pass = 0;
let fail = 0;
const ok = (message, extra) => { pass += 1; console.log('PASS  ' + message + (extra ? '  :: ' + extra : '')); };
const bad = (message, detail) => { fail += 1; console.log('FAIL  ' + message + '  -> ' + detail); };
function assert(cond, message) { if (!cond) throw new Error(message); }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let server = null;
async function startServer() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'data', 'wbs.seed.json'), path.join(DATA_DIR, 'wbs.seed.json'));
  fs.rmSync(DATA_FILE, { force: true });
  fs.rmSync(path.join(DATA_DIR, 'audit.log'), { force: true });
  server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { WBS_DATA_DIR: DATA_DIR, WBS_PORT: String(PORT), WBS_HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', (chunk) => process.stderr.write('[server] ' + chunk));
  for (let i = 0; i < 100; i += 1) {
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
    setTimeout(resolve, 2000);
  });
}
const disk = () => JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const getDoc = async () => (await fetch(BASE + '/api/wbs')).json();

async function openPage(options) {
  const opts = options || {};
  const html = await (await fetch(BASE + '/')).text();
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  const counter = { put: 0, get: 0 };
  const dom = new JSDOM(html, {
    url: BASE + '/',
    runScripts: 'dangerously',
    resources: 'usable', // 让 jsdom 真实通过本服务加载 app.js / styles.css / vendor bundle（验证资源全本地）
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.fetch = (input, init) => {
        const method = (init && init.method) || 'GET';
        if (String(input).indexOf('/api/wbs') !== -1) {
          if (method === 'PUT') counter.put += 1;
          if (method === 'GET') counter.get += 1;
        }
        return fetch(new URL(String(input), BASE + '/'), init);
      };
      window.confirm = (message) => (typeof opts.confirm === 'function' ? opts.confirm(message) : true);
      window.__confirmMessages = [];
      const base = window.confirm;
      window.confirm = (message) => { window.__confirmMessages.push(String(message)); return base(message); };
      if (opts.identity) window.localStorage.setItem('wbs.identity', opts.identity);
      window.__counter = counter;
    }
  });
  const { window } = dom;
  const doc = window.document;
  const $ = (id) => doc.getElementById(id);
  const rows = () => Array.from($('wbs-body').querySelectorAll('tr'));
  const cellsOf = (tr) => Array.from(tr.querySelectorAll('td'));
  const rowById = (id) => rows().find((tr) => tr.getAttribute('data-id') === id);
  const cellOf = (id, field) => cellsOf(rowById(id)).find((td) => td.getAttribute('data-field') === field);
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const change = (el) => el.dispatchEvent(new window.Event('change', { bubbles: true }));
  const input = (el) => el.dispatchEvent(new window.Event('input', { bubbles: true }));
  const hint = () => ($('hint').hidden ? '' : $('hint').textContent.trim());
  const banner = () => ($('banner').hidden ? '' : $('banner-text').textContent.trim());
  async function waitFor(fn, ms) {
    const limit = Date.now() + (ms || 6000);
    while (Date.now() < limit) {
      try { if (fn()) return true; } catch (err) { /* 重试 */ }
      await sleep(25);
    }
    return false;
  }
  return { dom, window, doc, $, rows, rowById, cellOf, cellsOf, click, change, input, hint, banner, waitFor, counter,
    close: () => window.close() };
}

(async () => {
  try {
    await startServer();
    const identities = (await getDoc()).identities;
    const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'wbs.seed.json'), 'utf8'));

    // ---------- 矩阵1：读取/渲染 36 行 ----------
    if (want('render36')) {
      const page = await openPage({});
      assert(await page.waitFor(() => page.$('identity-list').querySelectorAll('button').length === 9), '身份入口未渲染');
      page.click(page.$('identity-list').querySelector('button[data-identity="项目负责人"]'));
      assert(await page.waitFor(() => page.rows().length === 36), '未在工作台渲染 36 行');
      const ids = page.rows().map((tr) => tr.getAttribute('data-id'));
      assert(JSON.stringify(ids) === JSON.stringify(seed.tasks.map((t) => t.id)), '渲染行序与 seed 不一致');
      const first = page.rowById('T001');
      const firstText = page.cellsOf(first).map((td) => td.textContent);
      assert(firstText[1] === '客户端' && firstText[3] === '业需导入' && firstText[4] === '李欢', '首行内容异常 ' + JSON.stringify(firstText));
      const last = page.cellsOf(page.rowById('T036')).map((td) => td.textContent);
      assert(last[1] === 'AI 能力引擎' && last[3] === '研发产物沉淀', '末行内容异常 ' + JSON.stringify(last));
      assert(page.$('task-count').textContent.includes('36 条'), '计数徽标异常 ' + page.$('task-count').textContent);
      const l1Start = page.rows().filter((tr) => tr.classList.contains('l1-start')).length;
      const l2Start = page.rows().filter((tr) => tr.classList.contains('l2-start')).length;
      ok('矩阵1 页面渲染 36 行，顺序与 seed 一致', '首行 客户端/业需导入/李欢，末行 AI 能力引擎/研发产物沉淀');
      ok('矩阵1b 一级/二级分组视觉按连续段标记（未改行序）', 'l1-start ' + l1Start + ' 处 / l2-start ' + l2Start + ' 处');
      assert(await page.waitFor(() => page.$('health-probe').textContent.includes('服务正常')), '探针未就绪');
      ok('矩阵15b 健康探针显示服务正常', page.$('health-probe').textContent.trim());
      page.close();
    }

    // ---------- 矩阵2：九身份选择与切换保持 ----------
    if (want('identity')) {
      const page = await openPage({});
      assert(await page.waitFor(() => page.$('identity-list').querySelectorAll('button').length === 9), '身份选择页未渲染 9 个身份');
      const names = Array.from(page.$('identity-list').querySelectorAll('button')).map((b) => b.getAttribute('data-identity'));
      assert(JSON.stringify(names) === JSON.stringify(identities), '身份列表与数据不一致');
      const pmButton = page.$('identity-list').querySelector('button[data-identity="项目负责人"]');
      assert(pmButton.classList.contains('pm'), '项目负责人身份应有高亮样式');
      ok('矩阵2 身份选择页展示九身份', names.join(' / '));
      assert(!page.$('identity-layer').hidden && page.$('workbench').hidden, '初始应停留在身份选择页');
      ok('矩阵2b 未选择身份时停留在入口页', 'workbench 隐藏');

      page.click(page.$('identity-list').querySelector('button[data-identity="王言"]'));
      assert(!page.$('workbench').hidden && page.$('identity-layer').hidden, '选择身份后应进入工作台');
      assert(page.window.localStorage.getItem('wbs.identity') === '王言', 'localStorage 未记住身份');
      assert(page.$('identity-select').value === '王言', '身份下拉未同步');
      ok('矩阵2c 选择「王言」进入工作台并写入 localStorage', 'wbs.identity=王言');
      page.close();

      const reloaded = await openPage({ identity: '王言' });
      assert(await reloaded.waitFor(() => reloaded.rows().length === 36), '刷新后未渲染');
      assert(reloaded.$('workbench').hidden === false && reloaded.$('identity-layer').hidden === true, '刷新后未恢复上次身份');
      assert(reloaded.$('identity-select').value === '王言', '刷新后身份下拉值异常');
      ok('矩阵2d 刷新（localStorage 记忆）后身份保持', '无需重选直接进入工作台：' + reloaded.$('identity-select').value);

      reloaded.$('identity-select').value = '李欢';
      reloaded.change(reloaded.$('identity-select'));
      assert(reloaded.$('session-status').textContent.includes('李欢'), '切换身份未即时生效');
      const ownCell = reloaded.cellOf('T001', 'note');
      const otherCell = reloaded.cellOf('T002', 'note');
      assert(ownCell.classList.contains('editable'), '李欢本人行应可编辑');
      assert(otherCell.classList.contains('locked'), '他人行应只读');
      ok('矩阵2e 切换身份即时生效（可编辑集合随之变化）', '李欢可见 T001 可编辑、T002 只读');
      reloaded.close();
    }

    // ---------- 矩阵3 / 6：本人行可编辑并保存，三端一致 ----------
    if (want('ownedit')) {
      const page = await openPage({ identity: '王言' });
      assert(await page.waitFor(() => page.rows().length === 36), '页面未就绪');
      const note = 'DOM 自测 ' + new Date().toISOString();
      page.click(page.cellOf('T002', 'note'));
      const editor = page.cellOf('T002', 'note').querySelector('textarea');
      assert(editor, '点击本人行进展说明未进入编辑态');
      editor.value = note;
      page.change(editor);
      assert(page.$('save-btn').disabled === false, '保存按钮应可用');
      assert(page.$('session-status').textContent.includes('有未保存修改'), '会话状态未提示未保存');
      const statusCell = page.cellOf('T002', 'status');
      page.click(statusCell);
      const select = statusCell.querySelector('select');
      select.value = '进行中';
      page.change(select);
      page.click(page.$('save-btn'));
      assert(await page.waitFor(() => page.banner().includes('保存成功'), 8000), '保存未成功：' + page.banner());
      const apiDoc = await getDoc();
      const diskDoc = disk();
      const apiRow = apiDoc.tasks.find((t) => t.id === 'T002');
      const diskRow = diskDoc.tasks.find((t) => t.id === 'T002');
      assert(apiRow.note === note && diskRow.note === note, 'API/磁盘 note 不一致');
      assert(apiRow.status === '进行中' && diskRow.status === '进行中', 'API/磁盘 status 不一致');
      assert(page.cellOf('T002', 'note').textContent.includes('DOM 自测'), '页面未回显新值');
      ok('矩阵3 普通负责人本人行可编辑并保存（页面/API/磁盘三端一致）', 'T002 note + status，revision ' + apiDoc.meta.revision);
      ok('矩阵6b 保存后 API 与磁盘逐字段一致', JSON.stringify({ note: diskRow.note, status: diskRow.status }));
      page.close();

      const fresh = await openPage({ identity: '王言' });
      assert(await fresh.waitFor(() => fresh.rows().length === 36), '刷新后未渲染');
      assert(fresh.cellOf('T002', 'note').textContent.includes('DOM 自测'), '刷新后数据丢失');
      ok('矩阵7 刷新持久：重新加载页面仍显示已保存内容', fresh.cellOf('T002', 'note').textContent.slice(0, 24));
      fresh.close();
    }

    // ---------- 矩阵4：他人行只读 ----------
    if (want('others')) {
      const page = await openPage({ identity: '王言' });
      assert(await page.waitFor(() => page.rows().length === 36), '页面未就绪');
      const foreignNote = page.cellOf('T001', 'note');
      assert(foreignNote.classList.contains('locked'), '他人行进展说明应为只读');
      page.click(foreignNote);
      assert(!foreignNote.querySelector('input,textarea,select'), '他人行不应进入编辑态');
      assert(page.hint().includes('只读'), '他人行点击未给出只读提示：' + page.hint());
      ok('矩阵4 他人行只读且点击有提示', page.hint());
      const foreignTask = page.cellOf('T001', 'task');
      page.click(foreignTask);
      assert(page.hint().includes('只读') && !foreignTask.querySelector('input'), '结构性字段同样应只读');
      ok('矩阵4b 本人行结构性字段（任务项）仍只读', page.hint());
      const ownerCell = page.cellOf('T002', 'owner');
      page.click(ownerCell);
      assert(!ownerCell.querySelector('select'), '负责人字段对普通负责人应只读');
      ok('矩阵4c 负责人字段对普通负责人只读', page.hint());
      page.close();
    }

    // ---------- 矩阵4d：序号列点击给出与相邻只读单元格一致的提示（缺陷 D-2 回归） ----------
    if (want('idcell')) {
      const page = await openPage({ identity: '王言' });
      assert(await page.waitFor(() => page.rows().length === 36), '页面未就绪');
      const idCell = page.rowById('T001').querySelector('td.cell-id');
      assert(idCell, '序号列单元格不存在');
      assert(idCell.classList.contains('locked'), '序号列应为只读样式');
      const hintBefore = page.hint();
      page.click(idCell);
      const idHint = page.hint();
      assert(idHint !== hintBefore, '序号列点击无任何反馈（缺陷 D-2 复现：提示未变化，silent=true）');
      assert(idHint.includes('只读'), '序号列提示未包含「只读」：' + idHint);
      assert(idHint.includes('序号'), '序号列提示未点明「序号」列：' + idHint);
      assert(!idCell.querySelector('input,textarea,select'), '序号列不应进入编辑态');
      ok('矩阵4d 序号列点击给出中文只读提示', idHint);

      page.click(page.cellOf('T001', 'note'));
      const noteHint = page.hint();
      assert(idHint.replace('序号', '进展说明') === noteHint,
        '序号列提示与相邻只读单元格不一致：' + idHint + ' vs ' + noteHint);
      ok('矩阵4d 与相邻只读单元格行为一致（同文案模板，仅列名不同）', noteHint);

      page.click(idCell);
      assert(page.hint().includes('序号'), '序号列重复点击无提示');
      ok('矩阵4d 序号列重复点击仍有提示', page.hint());
      page.close();
    }

    // ---------- 矩阵5：新增/删除仅项目负责人（带确认） ----------
    if (want('adddelete')) {
      const normal = await openPage({ identity: '王言' });
      assert(await normal.waitFor(() => normal.rows().length === 36), '页面未就绪');
      assert(normal.$('add-row-btn').hidden === true, '普通负责人不应看到新增行按钮');
      normal.window.WBSApp.addRow();
      assert(normal.hint().includes('仅「项目负责人」可以新增行'), '普通负责人新增行未拦截：' + normal.hint());
      assert(normal.rows().length === 36, '普通负责人不应新增成功');
      ok('矩阵5 普通负责人不可新增/删除行', normal.hint());
      normal.close();

      let confirmResult = false;
      const pm = await openPage({ identity: '项目负责人', confirm: () => confirmResult });
      assert(await pm.waitFor(() => pm.rows().length === 36), '页面未就绪');
      assert(pm.$('add-row-btn').hidden === false, '项目负责人应看到新增行按钮');
      pm.click(pm.$('add-row-btn'));
      assert(await pm.waitFor(() => pm.rows().length === 37), '新增行失败');
      assert(pm.rowById('T037'), '新增行 id 应为 T037');
      ok('矩阵5b 项目负责人可新增行（自动生成独立 id）', 'T037，页面 37 行');

      assert((await getDoc()).tasks.length === 36, '未保存前不应写入服务器');
      ok('矩阵5c 新增在保存前不落盘', 'API/磁盘仍为 36 行');

      pm.click(pm.rowById('T037').querySelector('button[data-delete]'));
      assert(pm.window.__confirmMessages.length === 1, '删除应先弹确认框');
      assert(pm.window.__confirmMessages[0].includes('确认删除任务 T037'), '确认文案异常');
      assert(pm.rows().length === 37, '取消确认后行数应不变');
      assert(pm.hint().includes('已取消删除'), '取消提示缺失：' + pm.hint());
      ok('矩阵5d 删除带确认框，取消则不删', pm.window.__confirmMessages[0]);

      confirmResult = true;
      pm.click(pm.rowById('T037').querySelector('button[data-delete]'));
      assert(await pm.waitFor(() => pm.rows().length === 36), '确认后删除失败');
      assert(pm.window.__confirmMessages.length === 2, '第二次删除也应确认');
      pm.click(pm.$('save-btn'));
      assert(await pm.waitFor(() => pm.banner().includes('保存成功'), 8000), '删除后保存失败：' + pm.banner());
      const after = await getDoc();
      assert(after.tasks.length === 36 && !after.tasks.some((t) => t.id === 'T037'), '删除未落盘');
      ok('矩阵5e 项目负责人删除行（确认后）并保存生效', '页面/API/磁盘回到 36 行');
      pm.close();
    }

    // ---------- 矩阵8：前端前置校验不产生 API 调用 ----------
    if (want('prevalidation')) {
      const page = await openPage({ identity: '项目负责人' });
      assert(await page.waitFor(() => page.rows().length === 36), '页面未就绪');
      const before = page.counter.put;
      page.click(page.$('add-row-btn'));
      await page.waitFor(() => page.rows().length === 37);
      const newId = page.rows()[36].getAttribute('data-id');
      // 任务项留空 -> 点击保存应被前端拦下
      page.click(page.$('save-btn'));
      assert(await page.waitFor(() => page.banner().includes('前置校验未通过')), '未出现前置校验错误：' + page.banner());
      assert(page.counter.put === before, '前置校验失败时不应发起 PUT');
      ok('矩阵8 空值/非法输入在前端拦下：无 API 调用、无写入', 'PUT 次数 ' + before + '，提示：' + page.banner().slice(0, 40));

      // 录入非法日期：<input type=date> 在浏览器层即拒绝该值
      page.click(page.cellOf(newId, 'dates.dev'));
      const dateInput = page.cellOf(newId, 'dates.dev').querySelector('input');
      assert(dateInput.getAttribute('type') === 'date', '日期列应使用 type=date 输入');
      dateInput.value = '2026/11/01';
      assert(dateInput.value === '', 'type=date 不应接受 2026/11/01 这类格式（实际 ' + dateInput.value + '）');
      dateInput.value = '2026-11-01';
      page.change(dateInput);
      ok('矩阵8c 日期列由 <input type=date> 约束，非法格式无法录入，保存前 validateDraft 再兜底', 'type=date 拒绝 2026/11/01');

      // 补齐必填后应可保存（正路径），随后恢复现场
      for (const [field, value] of [['level1', '自测一级'], ['level2', '自测二级'], ['task', '自测新增任务']]) {
        page.click(page.cellOf(newId, field));
        const editor = page.cellOf(newId, field).querySelector('input');
        editor.value = value;
        page.change(editor);
      }
      page.click(page.$('save-btn'));
      assert(await page.waitFor(() => page.banner().includes('保存成功'), 8000), '补齐必填后保存失败：' + page.banner());
      const saved = await getDoc();
      const added = saved.tasks.find((t) => t.id === newId);
      assert(added && added.task === '自测新增任务' && added.dates.dev === '2026-11-01', '新增行未正确落盘：' + JSON.stringify(added));
      assert(disk().tasks.length === 37, '磁盘行数应为 37');
      ok('矩阵5f 项目负责人新增行保存成功（页面/API/磁盘 37 行）', newId + ' ' + added.task + ' ' + added.dates.dev);

      page.click(page.cellOf(newId, 'task'));
      page.click(page.rowById(newId).querySelector('button[data-delete]'));
      await page.waitFor(() => page.rows().length === 36);
      page.click(page.$('save-btn'));
      assert(await page.waitFor(() => page.banner().includes('保存成功'), 8000), '删除保存失败：' + page.banner());
      assert((await getDoc()).tasks.length === 36 && disk().tasks.length === 36, '删除未落盘');
      ok('矩阵5g 删除后保存，服务器与磁盘恢复 36 行', '现场已还原');
      page.close();
    }

    // ---------- 矩阵12b：页面「导出 Excel」入口真实产物保留模板 <cols>（缺陷 D-1 回归，页面路径） ----------
    if (want('exportpage')) {
      const page = await openPage({ identity: '项目负责人' });
      assert(await page.waitFor(() => page.rows().length === 36), '页面未就绪');
      let captured = null;
      let capturedName = null;
      page.window.XLSX.writeFile = (workbook, name) => {
        captured = Buffer.from(page.window.XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }));
        capturedName = name;
      };
      page.click(page.$('export-btn'));
      assert(await page.waitFor(() => captured !== null, 8000), '页面导出未捕获到文件（XLSX.writeFile 未被调用）');
      const file = path.join(TMP, 'page-export.xlsx');
      fs.writeFileSync(file, captured);
      assert(/^蓉城战役WBS-\d{8}\.xlsx$/.test(String(capturedName)), '导出文件名异常：' + capturedName);
      const outCols = readCols(file);
      const tplCols = readCols(path.join(ROOT, 'public', 'template.xlsx'));
      assert(outCols.hasCols, '页面导出文件缺少 <cols>，列宽丢失（缺陷 D-1 未修）');
      const diff = [];
      for (let i = 0; i < 11; i += 1) {
        if (tplCols.widths[i] !== outCols.widths[i]) {
          diff.push(String.fromCharCode(65 + i) + ' 模板' + tplCols.widths[i] + ' 导出' + outCols.widths[i]);
        }
      }
      assert(diff.length === 0, '页面导出 A–K 列宽与模板不一致：' + diff.join('; '));
      const sha = crypto.createHash('sha256').update(captured).digest('hex');
      console.log('ARTIFACT page_export_file=' + file);
      console.log('ARTIFACT page_export_sha256=' + sha);
      ok('矩阵12b 页面「导出 Excel」入口产物含 <cols> 且 A–K 列宽与模板逐列一致',
        capturedName + ' · K=' + outCols.widths[10] + ' · ' + captured.length + ' 字节 · <col> ' + outCols.count + ' 条 · sha256 ' + sha.slice(0, 16) + '…');
      page.close();
    }
  } catch (err) {
    bad('DOM 自测执行', err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err.message);
  } finally {
    await stopServer();
  }
  console.log('---');
  console.log('PASS=' + pass + ' FAIL=' + fail);
  process.exit(fail === 0 ? 0 : 1);
})();
