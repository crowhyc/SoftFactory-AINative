// WC-001 作者自测：导出构建（app.js 同一套 applyExportRows + 锁定 vendor bundle）。
// 输出 ARTIFACT 行供 tests/verify.sh 交给 python 独立解析校验。
// 用法：node tests/exportcheck.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { readCols } from './xlsxcols.mjs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const TMP = path.join(__dirname, '.tmp');
const DATA_DIR = path.join(TMP, 'export-data');
const PORT = Number(process.env.WBS_TEST_PORT || 4200);
const BASE = 'http://127.0.0.1:' + PORT;

let pass = 0;
let fail = 0;
const ok = (message, extra) => { pass += 1; console.log('PASS  ' + message + (extra ? '  :: ' + extra : '')); };
const bad = (message, detail) => { fail += 1; console.log('FAIL  ' + message + '  -> ' + detail); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const XLSX = require(path.join(PUBLIC, 'vendor', 'xlsx.full.min.js'));
const Core = require(path.join(PUBLIC, 'app.js'));
// 页面由 vendor bundle 提供全局 XLSX；node 侧同样挂上，才能调用页面同一份 Core.buildExportWorkbook。
global.XLSX = XLSX;

const COL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];

let server = null;
async function startServer() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'data', 'wbs.seed.json'), path.join(DATA_DIR, 'wbs.seed.json'));
  fs.rmSync(path.join(DATA_DIR, 'wbs.json'), { force: true });
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

// 与页面「导出 Excel」走完全同一实现：Core.buildExportWorkbook 就是页面 loadExportWorkbook 所调用的那一个。
function writeExport(tasks, fileName) {
  const template = fs.readFileSync(path.join(PUBLIC, 'template.xlsx'));
  const rows = Core.exportRows(tasks);
  const workbook = Core.buildExportWorkbook(new Uint8Array(template), tasks);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const lastRow = Core.parseRange(sheet['!ref']).e.r + 1;
  // 写出选项与页面 XLSX.writeFile(workbook, name) 的默认值一致：<cols> 是否写出只取决于读取选项。
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
  const file = path.join(TMP, fileName);
  fs.writeFileSync(file, buffer);
  return { file, rows, lastRow };
}

(async () => {
  try {
    await startServer();
    const doc = await (await fetch(BASE + '/api/wbs')).json();
    doc.tasks[0] = Object.assign({}, doc.tasks[0], {
      demo: '是', note: '自测：已填写进展说明', status: '进行中',
      dates: Object.assign({}, doc.tasks[0].dates,
        { design: '2026-10-20', dev: '2026-10-24', test: '2026-10-28', product: '2026-10-30', demo_prep: '2026-11-01' })
    });
    doc.tasks[5] = Object.assign({}, doc.tasks[5], { demo: '否', status: '已延期', note: '自测：延期原因示例' });
    doc.tasks[35] = Object.assign({}, doc.tasks[35], { note: '自测：末行进展', status: '被阻塞' });
    const put = await fetch(BASE + '/api/wbs', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': String(doc.meta.revision),
        'X-Identity': encodeURIComponent('项目负责人')
      },
      body: JSON.stringify({ meta: { name: doc.meta.name }, identities: doc.identities, tasks: doc.tasks })
    });
    if (put.status !== 200) throw new Error('准备数据失败 HTTP ' + put.status);
    const live = await (await fetch(BASE + '/api/wbs')).json();
    const jsonFile = path.join(TMP, 'wbs-from-api.json');
    fs.writeFileSync(jsonFile, JSON.stringify(live, null, 2) + '\n');

    const name = Core.exportRows ? '蓉城战役WBS-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.xlsx' : 'export.xlsx';
    const full = writeExport(live.tasks, name);
    ok('导出文件已生成', full.file + '（数据 ' + full.rows.length + ' 行，末行 ' + full.lastRow + '）');
    console.log('ARTIFACT export_file=' + full.file);
    console.log('ARTIFACT export_json=' + jsonFile);
    console.log('ARTIFACT export_rows=36');

    // ---- 缺陷 D-1 回归：页面导出路径必须保留模板 <cols>（A–K 逐列一致，K 列 47.2592592592593） ----
    const tplCols = readCols(path.join(PUBLIC, 'template.xlsx'));
    const outCols = readCols(full.file);
    if (outCols.hasCols) ok('导出文件含 <cols> 列宽定义（页面导出路径）', '<col> 声明 ' + outCols.count + ' 条');
    else bad('导出文件缺少 <cols>（列宽丢失，缺陷 D-1 未修）', 'sheet1.xml 无 <cols> 元素');
    const widthDiff = [];
    for (let i = 0; i < 11; i += 1) {
      if (tplCols.widths[i] !== outCols.widths[i]) widthDiff.push(COL_LETTERS[i] + ' 模板' + tplCols.widths[i] + ' 导出' + outCols.widths[i]);
    }
    if (tplCols.hasCols && outCols.hasCols && widthDiff.length === 0) {
      ok('导出 A–K 列宽与源模板逐列一致（含 K 进展说明列 47.2592592592593）',
        'K=' + outCols.widths[10] + '，A–K=' + outCols.widths.slice(0, 11).join(','));
    } else {
      bad('导出 A–K 列宽与模板不一致', widthDiff.join('; ') || '模板/导出缺 <cols>');
    }
    // 路径统一留证：页面 loadExportWorkbook 与自测脚本调用同一个 Core.buildExportWorkbook。
    const appSrc = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
    const pageShared = /loadExportWorkbook[\s\S]{0,600}Core\.buildExportWorkbook\(/.test(appSrc);
    const pageBypass = /global\.XLSX\.read\(new Uint8Array\(buffer\)/.test(appSrc);
    if (pageShared && !pageBypass) ok('页面导出与自测走同一实现（loadExportWorkbook → Core.buildExportWorkbook）', '页面侧无独立 XLSX.read 旁路');
    else bad('导出实现未统一（D-1 双路径差异仍在）', 'pageShared=' + pageShared + ' pageBypass=' + pageBypass);
    console.log('INFO  D-1 修复前：页面路径导出 sha256=626b269a…（32762 字节、无 <cols>）；修复后见上方 <cols>/列宽断言。');

    const readBack = XLSX.read(fs.readFileSync(full.file), { type: 'buffer' });
    const sheet = readBack.Sheets[readBack.SheetNames[0]];
    const merges = JSON.stringify(sheet['!merges']);
    if (merges.includes('"c":0') && merges.includes('"c":2')) ok('读回导出文件：A1:C1 合并仍在', merges);
    else bad('读回导出文件合并丢失', merges);
    const headers = ['D2', 'K2'].map((ref) => (sheet[ref] ? String(sheet[ref].v) : ''));
    if (headers[0] === '负责人' && headers[1] === '进展说明') ok('读回导出文件：第 2 行表头仍在', headers.join('/'));
    else bad('读回导出文件表头异常', headers.join('/'));
    const ref = XLSX.utils.decode_range(sheet['!ref']);
    if (String(sheet['!ref']) === 'A1:Q38') ok('读回导出文件工作表范围 = A–P 数据列 + Q 导出日期标签', sheet['!ref']);
    else bad('工作表范围变化', sheet['!ref'] + ' -> ' + JSON.stringify(ref));

    // 行数变少：原数据区残留必须清空
    const short = writeExport(live.tasks.slice(0, 34), '蓉城战役WBS-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-34row.xlsx');
    const shortSheet = XLSX.read(fs.readFileSync(short.file), { type: 'buffer' }).Sheets['工作表1'];
    const leftover = [];
    for (let r = 37; r <= 38; r += 1) {
      for (const column of ['A', 'B', 'C', 'D', 'K']) {
        const cell = shortSheet[column + r];
        if (cell && String(cell.v) !== '') leftover.push(column + r + '=' + cell.v);
      }
    }
    if (leftover.length === 0) ok('行数变少时原数据区残留被清空', '第 37/38 行 A–D/K 为空');
    else bad('残留未清空', leftover.join('; '));
    const shortJson = path.join(TMP, 'wbs-34rows.json');
    fs.writeFileSync(shortJson, JSON.stringify({ tasks: live.tasks.slice(0, 34) }, null, 2) + '\n');
    console.log('ARTIFACT export_file_34=' + short.file);
    console.log('ARTIFACT export_json_34=' + shortJson);
    console.log('ARTIFACT export_rows_34=34');
  } catch (err) {
    bad('导出自测执行', err.message);
  } finally {
    await stopServer();
  }
  console.log('---');
  console.log('PASS=' + pass + ' FAIL=' + fail);
  process.exit(fail === 0 ? 0 : 1);
})();
