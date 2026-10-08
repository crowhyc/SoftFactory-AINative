// D-1 复现探针：点击「类别」展示单元格，观察是否进入行内编辑态。独立自写。
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const base = process.argv[2], datafile = process.argv[3];
async function get(p) { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; }
const diskCat = () => JSON.parse(fs.readFileSync(datafile, 'utf8')).items.find((i) => i.id === 'dom-01').category;
const html = await (await fetch(base + '/')).text();
const vc = new VirtualConsole(); vc.on('jsdomError', () => {});
const dom = new JSDOM(html, { url: base + '/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) { w.fetch = (i, o) => fetch(new URL(String(i), base + '/'), o); w.confirm = () => true; } });
const { window } = dom, doc = window.document;
const rows = () => Array.from(doc.getElementById('items-body').querySelectorAll('tr'));
const rowById = (id) => rows().find((r) => r.querySelector('td.mono')?.textContent === id);
const cells = (r) => Array.from(r.querySelectorAll('td'));
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
for (let i = 0; i < 100 && rows().length !== 3; i++) await sleep(50);
const cell = cells(rowById('dom-01'))[2];
const beforeCat = cell.textContent;
click(cell);
await sleep(300);
const input = rowById('dom-01')?.querySelector('input[data-field="category"]');
const box = doc.getElementById('message');
const fb = box && !box.hidden ? box.textContent.trim() : null;
console.log('点击前类别展示值: ' + JSON.stringify(beforeCat));
console.log('是否出现 input[data-field="category"]: ' + !!input);
console.log('反馈文案: ' + JSON.stringify(fb));
console.log('磁盘类别(点击后): ' + JSON.stringify(diskCat()));
console.log('API 类别(点击后): ' + JSON.stringify((await get('/api/items')).body.items.find((i) => i.id === 'dom-01').category));
console.log('CELL_CLICK_ENTER_EDIT=' + (input ? 'YES' : 'NO'));
process.exit(0);
