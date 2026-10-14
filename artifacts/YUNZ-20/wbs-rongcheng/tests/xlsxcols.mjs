// WC-001 自测共用工具：直解 xlsx 的 zip/XML，取 sheet1.xml 的 <cols> 与逐列宽度。
// 供 tests/exportcheck.mjs（共享导出实现，页面同一路径）与 tests/domcheck.mjs（页面导出入口）使用。
// 不依赖 SheetJS，避免"用被验证库验证自己"。
import fs from 'node:fs';
import zlib from 'node:zlib';

export function unzip(file) {
  const buf = fs.readFileSync(file);
  const out = {};
  let off = 0;
  while (off + 30 <= buf.length && buf.readUInt32LE(off) === 0x04034b50) {
    const method = buf.readUInt16LE(off + 8);
    const csize = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const name = buf.slice(off + 30, off + 30 + nameLen).toString('latin1');
    const data = buf.slice(off + 30 + nameLen + extraLen, off + 30 + nameLen + extraLen + csize);
    try { out[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8'); } catch (err) { out[name] = ''; }
    off += 30 + nameLen + extraLen + csize;
  }
  return out;
}

/** 返回 { hasCols, count（<col> 声明数）, widths（按列序展开的宽度字符串，A=0） }。 */
export function readCols(file) {
  const xml = unzip(file)['xl/worksheets/sheet1.xml'] || '';
  const block = /<cols>([\s\S]*?)<\/cols>/.exec(xml);
  if (!block) return { hasCols: false, count: 0, widths: [] };
  const widths = [];
  const re = /<col ([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(block[1])) !== null) {
    const attr = m[1];
    const min = Number((/min="(\d+)"/.exec(attr) || [])[1]);
    const max = Number((/max="(\d+)"/.exec(attr) || [])[1]);
    const width = (/width="([\d.]+)"/.exec(attr) || [])[1];
    for (let i = min; i <= Math.min(max, 16384); i += 1) widths[i - 1] = width;
  }
  return { hasCols: true, count: (block[1].match(/<col /g) || []).length, widths };
}
