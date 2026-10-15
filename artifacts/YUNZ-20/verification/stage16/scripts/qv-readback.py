# -*- coding: utf-8 -*-
"""YUNZ-36 / Stage16：独立读回（WBS 导出 xlsx + CH-13 文本口径）。
WBS 导出 xlsx（真实浏览器下载）用 Python 标准库 zipfile + xml.etree 逐条断言：
单 sheet 同名 / 第 1、2 行与模板逐格一致 / A1:C1 合并 / L2:P2 表头 / 无旧 status 列 /
dimension A1:Q.. / 残留清空 / Q1 导出日期 / A–K 逐行一致 / L–P 文字与五色填充逐格一致 / 五色全出现。
另断言 CH-13 后不再产出日报文件（downloads 无日报 xlsx），且 /api/daily 文本口径自洽。
不依赖 openpyxl / SheetJS，也不复用作者读回脚本。"""
import io, json, os, re, sys, zipfile
import xml.etree.ElementTree as ET

MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
NS = {'m': MAIN}
HERE = os.path.dirname(os.path.abspath(__file__))
S16 = os.path.normpath(os.path.join(HERE, '..'))
DL = os.path.join(S16, 'downloads')
RESULTS = os.path.join(S16, 'results')
TEMPLATE = os.environ.get('TEMPLATE', '/opt/wbs-rongcheng/public/template.xlsx')
PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep']
PHASE_HEADERS = [u'设计进度', u'开发进度', u'测试进度', u'产品进度', u'演示准备进度']
PHASE_HEX = {u'未开始': '9E9E9E', u'已开始': '2F80ED', u'已完成': '27AE60', u'延期': 'E74C3C', u'阻塞': 'FFD400'}

PASS = 0
FAIL = 0
LOG = []
FSENC = sys.getfilesystemencoding() or 'ascii'

def disp(v):
    """宿主文件系统编码为 ascii 时，listdir 返回的汉字文件名带代理项；此处仅在需要输出时还原。"""
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
    line = ('PASS  ' if ok else 'FAIL  ') + cid + ('  :: ' + json.dumps(detail, ensure_ascii=False) if detail != '' else '')
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
        self.fills, self.cellxfs = [], []
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
                self.cellxfs.append({'fillId': xf.get('fillId')})
        self._cache = {}

    def sheet(self, index):
        if index in self._cache:
            return self._cache[index]
        part = self.sheets[index][1]
        sh = ET.fromstring(self.parts[part])
        cells = {}
        for c in sh.findall('.//m:sheetData/m:row/m:c', NS):
            cells[c.get('r')] = c
        dim = sh.find('m:dimension', NS)
        merges = [m.get('ref') for m in sh.findall('.//m:mergeCells/m:mergeCell', NS)]
        info = {'ref': dim.get('ref') if dim is not None else None, 'cells': cells,
                'merges': merges, 'name': self.sheets[index][0]}
        self._cache[index] = info
        return info

    def cell_value(self, sh, addr):
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

    def fill_of(self, sh, addr):
        c = sh['cells'].get(addr)
        if c is None:
            return None
        s = c.get('s')
        if s is None:
            return None
        fid = self.cellxfs[int(s)].get('fillId')
        if fid is None or int(fid) >= len(self.fills):
            return None
        return self.fills[int(fid)]

    @staticmethod
    def col_letters(addr):
        return re.match(r'^([A-Z]+)', addr).group(1)

    @staticmethod
    def row_of(addr):
        return int(re.search(r'(\d+)$', addr).group(1))

def load_json(p):
    with io.open(p, encoding='utf-8') as f:
        return json.load(f)

def check_wbs(label, xlsx_path, api_path):
    x = Xlsx(xlsx_path)
    t = Xlsx(TEMPLATE)
    api = load_json(api_path)
    tasks = api['tasks']
    names = [n for n, _ in x.sheets]
    tnames = [n for n, _ in t.sheets]
    check('%s-01 仍为单 sheet 且与模板同名' % label, names == tnames, {'export': names, 'template': tnames})
    ts, xs = t.sheet(0), x.sheet(0)
    r1k = [a for a in ts['cells'].keys() if t.row_of(a) == 1]
    r1 = [(a, t.cell_value(ts, a) or '', x.cell_value(xs, a) or '') for a in r1k
          if (t.cell_value(ts, a) or '') != (x.cell_value(xs, a) or '')]
    check('%s-02 第 1 行与模板逐格一致' % label, r1 == [], r1[:3])
    r2k = [a for a in ts['cells'].keys() if t.row_of(a) == 2]
    r2 = [(a, t.cell_value(ts, a) or '', x.cell_value(xs, a) or '') for a in r2k
          if (t.cell_value(ts, a) or '') != (x.cell_value(xs, a) or '')]
    check('%s-03 第 2 行（原表头）与模板逐格一致' % label, r2 == [], r2[:3])
    check('%s-04 A1:C1 合并保留' % label, 'A1:C1' in xs['merges'], xs['merges'][:4])
    head_lp = [x.cell_value(xs, '%s2' % chr(65 + i)) for i in range(11, 16)]
    check('%s-05 L2:P2 == 五个进度列表头' % label, head_lp == PHASE_HEADERS, head_lp)
    all_headers = [x.cell_value(xs, '%s2' % chr(65 + i)) for i in range(0, 16)]
    check('%s-06 表头不含旧全局「状态」列' % label, u'状态' not in all_headers, all_headers)
    tmpl_last = max(t.row_of(a) for a in ts['cells'].keys())
    last = max(tmpl_last, 3 + len(tasks) - 1)
    check('%s-07 dimension 为 A1:Q%d' % (label, last), xs['ref'] == 'A1:Q%d' % last, xs['ref'])
    leftover = [a for a in xs['cells'].keys()
                if x.row_of(a) > 3 + len(tasks) - 1 and x.cell_value(xs, a) not in (None, '')]
    check('%s-08 数据区末尾残留行已清空' % label, leftover == [], leftover[:5])
    q1 = x.cell_value(xs, 'Q1')
    check('%s-09 Q1 为「导出日期：」标签' % label, bool(q1) and q1.startswith(u'导出日期：'), q1)
    beyond = sorted(set(x.col_letters(a) for a in xs['cells'].keys()
                        if x.col_letters(a) not in list('ABCDEFGHIJKLMNOPQ')))
    check('%s-10 无 Q 列之外的列（无 status 列）' % label, beyond == [], beyond)

    diffs = []
    for i, tk in enumerate(tasks):
        r = 3 + i
        dates = tk.get('dates') or {}
        exp = [tk.get('level1', ''), tk.get('level2', ''), tk.get('task', ''), tk.get('owner', ''), tk.get('demo', '')]
        exp += [dates.get(k, '') for k in PHASE_KEYS]
        exp += [tk.get('note', '')]
        got = [x.cell_value(xs, '%s%d' % (chr(65 + c), r)) for c in range(11)]
        if got != exp:
            diffs.append({'row': r, 'id': tk.get('id'), 'got': got, 'exp': exp})
    check('%s-11 A–K 数据区 %d 行逐字一致（含日期原文与是否演示范围）' % (label, len(tasks)), diffs == [], diffs[:1])

    pdiff, cdiff = [], []
    for i, tk in enumerate(tasks):
        r = 3 + i
        phases = tk.get('phases') or {}
        for j, k in enumerate(PHASE_KEYS):
            addr = '%s%d' % (chr(65 + 11 + j), r)
            v = x.cell_value(xs, addr)
            if v != phases.get(k):
                pdiff.append({'addr': addr, 'got': v, 'exp': phases.get(k)})
            rgb = x.fill_of(xs, addr)
            want = 'FF' + PHASE_HEX.get(phases.get(k), '')
            if rgb != want:
                cdiff.append({'addr': addr, 'phase': phases.get(k), 'got': rgb, 'exp': want})
    check('%s-12 L–P 进度列文字与 phases 逐格一致' % label, pdiff == [], pdiff[:3])
    check('%s-13 L–P 进度列五色填充与映射逐格一致' % label, cdiff == [], cdiff[:3])
    observed = set()
    for i, tk in enumerate(tasks):
        for j in range(5):
            rgb = x.fill_of(xs, '%s%d' % (chr(65 + 11 + j), 3 + i))
            if rgb:
                observed.add(rgb)
    return {'colors': sorted(observed)}

def check_daily_text(label, api_path, expected_path):
    api = load_json(api_path)
    exp = load_json(expected_path)
    txt = api['text']
    check('%s-01 /api/daily 仍带旧汇总数据源 + 新 text' % label,
          all(k in api for k in ('summary', 'blocked', 'changes', 'counts', 'text')), sorted(api.keys()))
    check('%s-02 text.body == 独立构造的期望文本逐字一致' % label, txt['body'] == exp['body'], None)
    lines = txt['body'].split('\n')
    check('%s-03 overview == body 首行 且 lines == body 其余行' % label,
          lines[0] == txt['overview'] and txt['lines'] == lines[1:], None)
    check('%s-04 计数与事件行数一致' % label,
          len(txt['lines']) == txt['delayedCount'] + txt['blockedCount'] == len(lines) - 1,
          {'lines': len(txt['lines']), 'delayed': txt['delayedCount'], 'blocked': txt['blockedCount']})
    check('%s-05 文本响应无文件 / 下载字段' % label,
          not any(k in json.dumps(api, ensure_ascii=False) for k in ['fileName', 'fileBase64', 'xlsx']), None)

def find_export(prefix):
    for n in sorted(os.listdir(DL)):
        if disp(n).startswith(prefix + '-') and disp(n).endswith('.xlsx'):
            return os.path.join(DL, n)
    return None

def find_live_export():
    for n in sorted(os.listdir(DL)):
        d = disp(n)
        if d.endswith('.xlsx') and u'WBS' in d and not d.startswith(('isoA-', 'isoB-')):
            return os.path.join(DL, n)
    return None

def main():
    live = find_live_export()
    check('LIVE-W-00 现场真实浏览器 WBS 导出文件存在', live is not None, live)
    if live:
        check_wbs('LIVE-W', live, os.path.join(DL, 'live-wbs-at-export.json'))
    a = find_export('isoA')
    b = find_export('isoB')
    check('ISO-W-00 隔离 isoA / isoB WBS 导出文件存在', bool(a) and bool(b), {'isoA': a, 'isoB': b})
    if a and b:
        ra = check_wbs('ISOA-W', a, os.path.join(DL, 'isoA-wbs-at-export.json'))
        rb = check_wbs('ISOB-W', b, os.path.join(DL, 'isoB-wbs-at-export.json'))
        expect_colors = sorted('FF' + v for v in PHASE_HEX.values())
        allc = sorted(set(ra['colors']) | set(rb['colors']))
        check('ISO-W-14 隔离导出覆盖五色（未开始灰 / 已开始蓝 / 已完成绿 / 延期红 / 阻塞黄）',
              allc == expect_colors, {'observed': allc, 'expect': expect_colors})

    e = load_json(os.path.join(RESULTS, 'expected-text.json'))
    with io.open(os.path.join(RESULTS, 'isoA-expect.json'), 'w', encoding='utf-8') as f:
        f.write(json.dumps(e['isoA'], ensure_ascii=False, indent=2))
    check_daily_text('ISO-D', os.path.join(RESULTS, 'isoA-daily.json'), os.path.join(RESULTS, 'isoA-expect.json'))

    daily_files = [disp(n) for n in os.listdir(DL) if (u'日报' in disp(n)) or (disp(n).lower().endswith('.xlsx') and 'daily' in disp(n).lower())]
    check('CH13-01 全程未产生任何日报文件（downloads 目录无日报 xlsx）', daily_files == [], daily_files)
    dl_all = sorted(disp(n) for n in os.listdir(DL))
    check('CH13-02 downloads 只含 WBS 导出与快照 json',
          all((u'WBS' in n or n.endswith('.json')) for n in dl_all), dl_all)

    out = os.path.join(RESULTS, 'readback-results.json')
    with io.open(out, 'w', encoding='utf-8') as f:
        f.write(json.dumps({'pass': PASS, 'fail': FAIL, 'log': LOG}, ensure_ascii=False, indent=2))
    print('\n[readback] PASS=%d FAIL=%d' % (PASS, FAIL))
    return 0 if FAIL == 0 else 1

if __name__ == '__main__':
    sys.exit(main())
