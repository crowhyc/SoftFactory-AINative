# -*- coding: utf-8 -*-
"""YUNZ-38 / Stage18 独立复验：WBS 导出 xlsx 独立读回（3A 不进掺）。
用 Python 标准库 zipfile + xml.etree 读回真实浏览器下载的导出文件，断言：
单 sheet / 第 1、2 行 A–K 与模板逐格一致 / A1:C1 合并保留 / L2:P2 阶段进度表头 /
A–K 数据区与导出时 /api/wbs 快照逐行一致 / L–P 文字与五色填充逐格一致 /
Q1 导出日期标签 / 行数与 dimension / **全表不含 CH-14 统计** / 下载名与 1 次下载。
不使用 openpyxl / SheetJS，也不复用作者读回脚本。
"""
import datetime, glob, io, json, os, re, sys, zipfile
import xml.etree.ElementTree as ET

MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
NS = {'m': MAIN}
HERE = os.path.dirname(os.path.abspath(__file__))
S18 = os.path.normpath(os.path.join(HERE, '..'))
DL = os.path.join(S18, 'downloads')
TEMPLATE = os.environ.get('TEMPLATE', '/opt/wbs-rongcheng/public/template.xlsx')
PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep']
PHASE_HEADERS = [u'设计进度', u'开发进度', u'测试进度', u'产品进度', u'演示准备进度']
PHASE_HEX = {u'未开始': '9E9E9E', u'已开始': '2F80ED', u'已完成': '27AE60',
             u'延期': 'E74C3C', u'阻塞': 'FFD400'}
COLS_AK = [chr(ord('A') + i) for i in range(11)]
COLS_LP = ['L', 'M', 'N', 'O', 'P']
STAT_PATTERNS = [u'阶段状态占比', u'状态占比', u'占比']

PASS = 0
FAIL = 0
LOG = []
FSENC = sys.getfilesystemencoding() or 'ascii'


def disp(v):
    if isinstance(v, str):
        if any('\ud800' <= ch <= '\udfff' for ch in v):
            try:
                return v.encode(FSENC, 'surrogateescape').decode('utf-8', 'replace')
            except Exception:
                return v
        return v
    if isinstance(v, dict):
        return dict((disp(k), disp(x)) for k, x in v.items())
    if isinstance(v, list):
        return [disp(x) for x in v]
    return v


def check(cid, ok, detail=''):
    global PASS, FAIL
    cid = disp(cid)
    detail = disp(detail)
    line = ('PASS  ' if ok else 'FAIL  ') + cid + (('  :: ' + json.dumps(detail, ensure_ascii=False)) if detail != '' else '')
    LOG.append(line)
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
        self._cache = {}

    def sheet(self, i=0):
        if i in self._cache:
            return self._cache[i]
        sh = ET.fromstring(self.parts[self.sheets[i][1]])
        cells = {}
        for c in sh.findall('.//m:sheetData/m:row/m:c', NS):
            cells[c.get('r')] = c
        dim = sh.find('m:dimension', NS)
        info = {'cells': cells, 'ref': dim.get('ref') if dim is not None else None,
                'merges': [m.get('ref') for m in sh.findall('.//m:mergeCells/m:mergeCell', NS)],
                'name': self.sheets[i][0]}
        self._cache[i] = info
        return info

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
    files = [f for f in glob.glob(os.path.join(DL, '*.xlsx'))
             if os.path.basename(f).startswith('isoA-')]
    if not files:
        files = glob.glob(os.path.join(DL, '*.xlsx'))
    if not files:
        print('FAIL  R00 未找到导出的 xlsx（先跑 qv-run-iso-export.sh）')
        return 1
    path = files[0]
    meta_path = os.path.join(DL, 'isoA-download-meta.json')
    meta = json.load(io.open(meta_path, encoding='utf-8')) if os.path.exists(meta_path) else {}
    snapshot = json.load(io.open(os.path.join(DL, 'isoA-wbs-at-export.json'), encoding='utf-8'))
    n = len(snapshot['tasks'])

    x = Xlsx(path)
    sh = x.sheet(0)
    t = Xlsx(TEMPLATE)
    tsh = t.sheet(0)

    check('R01 导出单 sheet 且 sheet 名与模板一致', len(x.sheets) == 1 and sh['name'] == tsh['name'],
          {'export': sh['name'], 'template': tsh['name'], 'sheets': len(x.sheets)})

    row1_diff = [(c, x.val(sh, c + '1'), t.val(tsh, c + '1')) for c in COLS_AK
                 if (x.val(sh, c + '1') or '') != (t.val(tsh, c + '1') or '')]
    check('R02 第 1 行 A–K 与模板逐格一致（未追加统计文字）', len(row1_diff) == 0, row1_diff or 'all A–K row1 identical')
    check('R03 A1:C1 合并保留', 'A1:C1' in sh['merges'], sh['merges'])
    row2_diff = [(c, x.val(sh, c + '2'), t.val(tsh, c + '2')) for c in COLS_AK
                 if (x.val(sh, c + '2') or '') != (t.val(tsh, c + '2') or '')]
    check('R04 第 2 行 A–K 与模板逐格一致（表头未被统计改写）', len(row2_diff) == 0, row2_diff or 'all A–K row2 identical')
    check('R05 L2:P2 阶段进度表头 == 设计/开发/测试/产品/演示准备进度',
          [x.val(sh, c + '2') for c in COLS_LP] == PHASE_HEADERS, [x.val(sh, c + '2') for c in COLS_LP])
    max_row = max([int(a[1:]) for a in sh['cells'].keys()] or [0])
    max_col = max([a[0] for a in sh['cells'].keys()] or ['A'])
    check('R06 数据行数 = 任务数（末行 = N+2），无超出数据区残留单元格，列界 = Q',
          max_row == n + 2 and max_col == 'Q' and all(int(a[1:]) <= n + 2 for a in sh['cells'].keys()),
          {'max_cell_row': max_row, 'max_col': max_col, 'n': n, 'dimension_ref': sh['ref']})

    # A–K 数据区逐行一致（快照口径）
    data_diff = []
    for i, task in enumerate(snapshot['tasks']):
        r = 3 + i
        expect = {
            'A': task['level1'], 'B': task['level2'], 'C': task['task'], 'D': task['owner'],
            'E': task.get('demo', ''),
            'F': task['dates']['design'], 'G': task['dates']['dev'], 'H': task['dates']['test'],
            'I': task['dates']['product'], 'J': task['dates']['demo_prep'],
            'K': task.get('note', ''),
        }
        for c, v in expect.items():
            got = x.val(sh, c + str(r))
            if (got or '') != (v or ''):
                data_diff.append({'row': r, 'col': c, 'got': got, 'exp': v})
    check('R07 A–K 数据区逐行与导出时 /api/wbs 快照一致（含 是否演示范围 / 五日期 / 进展说明）',
          len(data_diff) == 0, data_diff[:5] or ('%d rows x 11 cols match' % n))

    # L–P 文字 + 五色
    phase_diff, color_diff, seen_hex = [], [], set()
    for i, task in enumerate(snapshot['tasks']):
        r = 3 + i
        for j, key in enumerate(PHASE_KEYS):
            addr = COLS_LP[j] + str(r)
            got = x.val(sh, addr)
            exp = task['phases'][key]
            if got != exp:
                phase_diff.append({'addr': addr, 'got': got, 'exp': exp})
            fill = x.fill(sh, addr)
            seen_hex.add(fill)
            if fill != PHASE_HEX[exp]:
                color_diff.append({'addr': addr, 'value': exp, 'fill': fill, 'exp': PHASE_HEX[exp]})
    check('R08 L–P 阶段进度文字逐格 == /api/wbs phases（中文五枚举）', len(phase_diff) == 0, phase_diff[:5] or '%d cells match' % (n * 5))
    check('R09 L–P 五色填充逐格匹配（未开始灰/已开始蓝/已完成绿/延期红/阻塞黄），且五色全出现',
          len(color_diff) == 0 and seen_hex.issuperset(set(PHASE_HEX.values())),
          {'diff': color_diff[:5], 'seen': sorted(h for h in seen_hex if h)})

    # 全表无 CH-14 统计 + 无旧 status 列
    leaks = []
    for addr, c in sh['cells'].items():
        v = x.val(sh, addr)
        if not isinstance(v, str):
            continue
        for pat in STAT_PATTERNS:
            if pat in v:
                leaks.append({'addr': addr, 'text': v[:60], 'pattern': pat})
        if re.search(r'^\d+\s+\d+\.\d%$', v.strip()) or (u'%' in v):
            leaks.append({'addr': addr, 'text': v[:60], 'pattern': '%'})
        if v.strip() == u'状态':
            leaks.append({'addr': addr, 'text': v, 'pattern': 'status header'})
    check('R10 全表不含 CH-14 统计（无「占比」文案 / 无「数量 百分比%」模式 / 无 % 字符 / 无旧 status 列）',
          len(leaks) == 0, leaks[:5] or 'no stats leakage')

    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime('%Y-%m-%d')
    q1 = x.val(sh, 'Q1') or ''
    check('R11 Q1 导出日期标签存在且为今天（Asia/Shanghai %s）' % today,
          q1.startswith(u'导出日期：') and today in q1, {'Q1': q1, 'today': today})

    name = meta.get('suggested', os.path.basename(path))
    name = disp(name)
    m = re.match(r'^蓉城战役WBS-(\d{8})\.xlsx$', name)
    check('R12 下载名 == 蓉城战役WBS-YYYYMMDD.xlsx（日期为今天）',
          bool(m) and m.group(1) == today.replace('-', ''), {'name': name, 'today': today.replace('-', '')})
    xlsx_count = len([f for f in glob.glob(os.path.join(DL, '*.xlsx'))])
    check('R13 导出流程仅 1 个 xlsx 下载（导出日报不产生文件）', xlsx_count == 1, {'xlsx_files': xlsx_count})

    out = os.path.join(S18, 'logs', 'readback.out')
    with io.open(out, 'w', encoding='utf-8') as f:
        f.write(u'\n'.join(LOG) + u'\n')
    print('\n[readback] PASS=%d FAIL=%d' % (PASS, FAIL))
    return 1 if FAIL else 0


if __name__ == '__main__':
    sys.exit(main())
