# -*- coding: utf-8 -*-
"""YUNZ-40 / Stage20 独立复验：WBS 导出 xlsx 独立读回（不改用 SheetJS / openpyxl）。

用 Python 标准库 zipfile + xml.etree 直接解析真实浏览器下载的导出文件，断言：
单 sheet / 第 1、2 行 A–K 与模板逐格一致 / A1:C1 合并保留 / L2:P2 五进度表头（含「产品验收进度」）/
A–K 数据区与导出时 /api/wbs 逐行一致（含 E 列 demo 原值保留）/ L–P 文字与五色填充 /
Q1 导出日期标签 / dimension 行数 / **全表不含 CH-14/CH-15 统计区** / A–K 无旧 status 值。
"""
import glob
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
NS = {'m': MAIN}
HERE = os.path.dirname(os.path.abspath(__file__))
S20 = os.path.normpath(os.path.join(HERE, '..'))
DL = os.path.join(S20, 'downloads')
TEMPLATE = os.environ.get('TEMPLATE', '/opt/wbs-rongcheng/public/template.xlsx')

PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep']
PHASE_HEADERS = [u'\u8bbe\u8ba1\u8fdb\u5ea6', u'\u5f00\u53d1\u8fdb\u5ea6', u'\u6d4b\u8bd5\u8fdb\u5ea6',
                 u'\u4ea7\u54c1\u9a8c\u6536\u8fdb\u5ea6', u'\u6f14\u793a\u51c6\u5907\u8fdb\u5ea6']
PHASE_HEX = {u'\u672a\u5f00\u59cb': '9E9E9E', u'\u5df2\u5f00\u59cb': '2F80ED', u'\u5df2\u5b8c\u6210': '27AE60',
             u'\u5ef6\u671f': 'E74C3C', u'\u963b\u585e': 'FFD400'}
STATUS_LEGACY = [u'\u672a\u5f00\u59cb', u'\u8fdb\u884c\u4e2d', u'\u5df2\u5b8c\u6210', u'\u5df2\u5ef6\u671f', u'\u88ab\u963b\u585e']
STAT_PATTERNS = [u'\u5168\u90e8\u4e94\u9636\u6bb5\u5408\u5e76', u'\u9636\u6bb5\u72b6\u6001\u5360\u6bd4', u'\u5360\u6bd4', u'%']
COLS_AK = [chr(ord('A') + i) for i in range(11)]
COLS_LP = ['L', 'M', 'N', 'O', 'P']

PASS = 0
FAIL = 0


def disp(value):
    if isinstance(value, str):
        if any('\ud800' <= ch <= '\udfff' for ch in value):
            try:
                return value.encode('utf-8', 'surrogateescape').decode('utf-8', 'replace')
            except Exception:
                return value
    return value


def check(cid, ok, detail=''):
    global PASS, FAIL
    line = ('PASS  ' if ok else 'FAIL  ') + disp(cid) + \
        (('  :: ' + json.dumps(detail, ensure_ascii=False)) if detail != '' else '')
    print(line)
    if ok:
        PASS += 1
    else:
        FAIL += 1


class Xlsx(object):
    def __init__(self, path):
        self.z = zipfile.ZipFile(path)
        self.parts = dict((n, self.z.read(n)) for n in self.z.namelist() if not n.endswith('/'))
        wb = ET.fromstring(self.parts['xl/workbook.xml'])
        rels = ET.fromstring(self.parts['xl/_rels/workbook.xml.rels'])
        relmap = dict((r.get('Id'), r.get('Target')) for r in rels)
        self.sheets = []
        for sh in wb.findall('.//m:sheets/m:sheet', NS):
            tgt = relmap.get(sh.get('{%s}id' % REL), '')
            tgt = tgt[1:] if tgt.startswith('/') else 'xl/' + tgt.lstrip('./')
            self.sheets.append((sh.get('name'), tgt))
        self.strings = []
        if 'xl/sharedStrings.xml' in self.parts:
            ss = ET.fromstring(self.parts['xl/sharedStrings.xml'])
            for si in ss.findall('m:si', NS):
                self.strings.append(''.join(t.text or '' for t in si.iter('{%s}t' % MAIN)))
        self.fills, self.xfs = [], []
        if 'xl/styles.xml' in self.parts:
            st = ET.fromstring(self.parts['xl/styles.xml'])
            for f in st.findall('.//m:fills/m:fill', NS):
                pf = f.find('m:patternFill', NS)
                rgb = None
                if pf is not None:
                    fg = pf.find('m:fgColor', NS)
                    if fg is not None:
                        rgb = fg.get('rgb')
                self.fills.append(rgb)
            for xf in st.findall('.//m:cellXfs/m:xf', NS):
                self.xfs.append(xf.get('fillId'))

    def sheet(self, index=0):
        sh = ET.fromstring(self.parts[self.sheets[index][1]])
        cells = {}
        for c in sh.findall('.//m:sheetData/m:row/m:c', NS):
            cells[c.get('r')] = c
        dim = sh.find('m:dimension', NS)
        return {'cells': cells, 'ref': dim.get('ref') if dim is not None else None,
                'merges': [m.get('ref') for m in sh.findall('.//m:mergeCells/m:mergeCell', NS)],
                'name': self.sheets[index][0]}

    def val(self, sh, addr):
        c = sh['cells'].get(addr)
        if c is None:
            return None
        t = c.get('t')
        if t == 'inlineStr':
            el = c.find('m:is', NS)
            return ''.join(x.text or '' for x in el.iter('{%s}t' % MAIN)) if el is not None else ''
        v = c.find('m:v', NS)
        if v is None or v.text is None:
            return ''
        if t == 's':
            return self.strings[int(v.text)]
        return v.text

    def fill(self, sh, addr):
        c = sh['cells'].get(addr)
        if c is None:
            return None
        s = c.get('s')
        if s is None:
            return None
        fid = self.xfs[int(s)]
        if fid is None:
            return None
        rgb = self.fills[int(fid)]
        return rgb[-6:].upper() if rgb else None


def main():
    files = sorted(glob.glob(os.path.join(DL, 'isoB-*.xlsx')))
    if not files:
        files = sorted(glob.glob(os.path.join(DL, '*.xlsx')))
    if not files:
        check('16b/存在导出文件', False, 'downloads 下没有 xlsx')
        print('PASS=%d FAIL=%d' % (PASS, FAIL))
        return 1
    export_path = files[-1]
    snap_path = os.path.join(DL, 'isoB-wbs-at-export.json')
    snap = json.load(open(snap_path, encoding='utf-8'))
    tasks = snap['tasks']
    book = Xlsx(export_path)
    template = Xlsx(TEMPLATE)
    sh = book.sheet(0)
    tpl = template.sheet(0)

    print('导出文件：%s' % disp(export_path))
    print('导出时快照：%s（%d 行，revision %s）' % (disp(snap_path), len(tasks), snap['meta']['revision']))
    check('16b/导出文件为单 sheet', len(book.sheets) == 1, [s[0] for s in book.sheets])
    last_row = 2 + len(tasks)
    rows_used = set()
    for addr, cell in sh['cells'].items():
        row = int(re.sub(r'[A-Z]+', '', addr))
        if book.val(sh, addr) not in (None, ''):
            rows_used.add(row)
    max_row = max(rows_used) if rows_used else 0
    max_col = max([re.sub(r'\d+', '', addr) for addr in sh['cells']], key=lambda c: (len(c), c)) if sh['cells'] else None
    check('16b/数据行数 = 任务数（末行 = N+2 = %d），无超出数据区的残留单元格，列界 = Q' % last_row,
          max_row == last_row and max_col == 'Q' and sh['ref'].startswith('A1:Q'), 
          {'max_cell_row': max_row, 'max_col': max_col, 'n': len(tasks), 'dimension_ref': sh['ref']})
    check('16b/A1:C1 合并保留', 'A1:C1' in sh['merges'], sh['merges'][:4])

    def text_of(book_obj, sheet_obj, addr):
        return disp(book_obj.val(sheet_obj, addr) or '')

    row1_diff = [a for a in COLS_AK if text_of(book, sh, a + '1') != text_of(template, tpl, a + '1')]
    row2_diff = [a for a in COLS_AK if text_of(book, sh, a + '2') != text_of(template, tpl, a + '2')]
    check('16b/第 1 行 A–K 与模板逐格一致', not row1_diff, row1_diff)
    check('16b/第 2 行 A–K 与模板逐格一致（不改原文）', not row2_diff, row2_diff)
    headers = [disp(book.val(sh, c + '2')) for c in COLS_LP]
    check('16b/L2:P2 五进度表头 = 设计/开发/测试/产品验收/演示准备（含「产品验收进度」）',
          headers == [disp(h) for h in PHASE_HEADERS], headers)
    check('15a/Excel 表头确实使用「产品验收」而非旧「产品」', headers[3] == u'\u4ea7\u54c1\u9a8c\u6536\u8fdb\u5ea6'
          and headers[3].index(u'\u4ea7\u54c1\u9a8c\u6536') == 0, headers[3])

    aK_diff, phase_diff, fill_diff = [], [], []
    for index, task in enumerate(tasks):
        row = 3 + index
        expect = [task.get('level1', ''), task.get('level2', ''), task.get('task', ''), task.get('owner', ''),
                  task.get('demo', '')]
        for key in PHASE_KEYS:
            expect.append((task.get('dates') or {}).get(key, ''))
        expect.append(task.get('note', ''))
        for ci, col in enumerate(COLS_AK):
            got = book.val(sh, col + str(row))
            if disp(got) != disp(expect[ci]):
                aK_diff.append('%s%d 导出=%r 期望=%r' % (col, row, got, expect[ci]))
        for pi, key in enumerate(PHASE_KEYS):
            addr = COLS_LP[pi] + str(row)
            want = (task.get('phases') or {}).get(key, '')
            got = disp(book.val(sh, addr))
            if got != disp(want):
                phase_diff.append('%s 导出=%r 期望=%r' % (addr, got, want))
            fill = book.fill(sh, addr)
            if want in PHASE_HEX and fill != PHASE_HEX[want]:
                fill_diff.append('%s 值=%s 颜色=%s 期望=%s' % (addr, want, fill, PHASE_HEX[want]))
    check('16b/A–K 数据区与导出时 /api/wbs 逐行逐格一致（含 E 列 demo 原值保留，CH-9 回归）',
          not aK_diff, aK_diff[:5])
    check('16b/L–P 数据区文字 = phases 五阶段值', not phase_diff, phase_diff[:5])
    check('16b/L–P 数据区五阶段五色填充与状态一致（灰/蓝/绿/红/黄）', not fill_diff, fill_diff[:5])
    check('16b/Q1 导出日期标签保留（导出日期：YYYY-MM-DD HH:mm）',
          bool(re.match(u'^\\u5bfc\\u51fa\\u65e5\\u671f\\uff1a\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$',
                        disp(book.val(sh, 'Q1')) or '')),
          disp(book.val(sh, 'Q1')))

    legacy_hits = []
    for index in range(len(tasks)):
        row = 3 + index
        for col in COLS_AK:
            value = disp(book.val(sh, col + str(row)))
            if value in [disp(s) for s in STATUS_LEGACY]:
                legacy_hits.append(col + str(row) + '=' + value)
    check('16b/A–K 数据区不含旧 status 值（status 不导出，CH-1 回归）', not legacy_hits, legacy_hits[:5])

    flat = []
    for addr, cell in sh['cells'].items():
        value = disp(book.val(sh, addr))
        if value:
            flat.append(value)
    stat_hits = [v for v in flat for pattern in STAT_PATTERNS if disp(pattern) in disp(v)]
    check('16b/导出文件不带 CH-14/CH-15 统计区（无「全部五阶段合并」「阶段状态占比」/百分号文本）',
          not stat_hits, stat_hits[:5])
    check('16b/导出文件不含被改名的统计标签（产品验收仅出现在 L2 表头与进度值中）',
          sum(1 for v in flat if u'\u4ea7\u54c1\u9a8c\u6536' in v) == 1, 
          [v for v in flat if u'\u4ea7\u54c1\u9a8c\u6536' in v])

    print('PASS=%d FAIL=%d' % (PASS, FAIL))
    return 0 if FAIL == 0 else 1
if __name__ == '__main__':
    sys.exit(main())
