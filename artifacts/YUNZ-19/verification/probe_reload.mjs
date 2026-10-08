// 残余风险探针：行内编辑未保存时，其它会触发 reload() 的入口是否静默丢弃本地输入。
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const base = process.argv[2], datafile = process.argv[3];
async function get(p) { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; }
const disk = () => JSON.parse(fs.readFileSync(datafile, 'utf8'));
const html = await (await fetch(base + '/')).text();
const vc = new VirtualConsole(); vc.on('jsdomError', () => {});
const dom = new JSDOM(html, { url: base + '/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) { w.fetch = (i, o) => fetch(new URL(String(i), base + '/'), o); w.confirm = () => true; } });
const { window } = dom, doc = window.document;
const $ = (i) => doc.getElementById(i);
const rows = () => Array.from($('items-body').querySelectorAll('tr'));
const rowById = (id) => rows().find((r) => r.querySelector('td.mono')?.textContent === id);
const cells = (r) => Array.from(r.querySelectorAll('td'));
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const setVal = (el, v) => { el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })); };
const msg = () => { const b = $('message'); return b && !b.hidden ? b.textContent.trim() : null; };
for (let i = 0; i < 100 && rows().length !== 3; i++) await sleep(50);

// 进入 dom-01 行内编辑（经「类别」单元格），改类别但不保存
click(cells(rowById('dom-01'))[2]);
await sleep(200);
const inp = () => rowById('dom-01')?.querySelector('input[data-field="category"]');
setVal(inp(), '未保存的老酸奶');
console.log('进入编辑态=' + !!inp() + '  本地输入=' + JSON.stringify(inp()?.value));
// 点击「刷新」
click($('refresh'));
await sleep(400);
console.log('--- 点击「刷新」之后 ---');
console.log('提示=' + JSON.stringify(msg()));
console.log('仍处编辑态=' + !!inp() + '  类别输入框值=' + JSON.stringify(inp()?.value));
console.log('磁盘类别=' + JSON.stringify(disk().items.find((i) => i.id === 'dom-01').category));

// 再次进入编辑并改值，然后点他行「删除」（触发 reload）
setVal(inp(), '未保存的酸奶2');
console.log('--- 再改本地输入=' + JSON.stringify(inp()?.value));
click(cells(rowById('dom-03'))[4].querySelector('button[data-action="delete"]'));
await sleep(500);
console.log('--- 点击他行「删除」之后 ---');
console.log('提示=' + JSON.stringify(msg()));
console.log('仍处编辑态=' + !!inp() + '  类别输入框值=' + JSON.stringify(inp()?.value));
console.log('磁盘 dom-01 类别=' + JSON.stringify((disk().items.find((i) => i.id === 'dom-01')||{}).category));
process.exit(0);
