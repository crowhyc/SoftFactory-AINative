# -*- coding: utf-8 -*-
"""YUNZ-34 / Stage14：日报与 WBS 导出 xlsx 的独立读回（只用 Python 标准库 zipfile + xml.etree）。
对真实浏览器下载的文件逐条断言，不依赖 openpyxl / SheetJS，也不复用作者读回脚本。
"""
import io, json, os, re, sys, zipfile
import xml.etree.ElementTree as ET

MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL  = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
NS = {'m': MAIN}

HERE = os.path.dirname(os.path.abspath(__file__))
S14 = os.path.normpath(os.path.join(HERE, '..'))
DL = os.path.join(S14, 'downloads')
TEMPLATE = os.environ.get('TEMPLATE', '/opt/wbs-rongcheng/public/template.xlsx')

PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep']
PHASE_HEADERS = ['设计进度', '开发进度', '测试进度', '产品进度', '演示准备进度']
PHASE_HEX = {'未开始': '9E9E9E', '已开始': '2F80ED', '已完成': '27AE60', '延期': 'E74C3C', '阻塞': 'FFD400'}
DAILY_BLOCKED_HEADER = ['一级', '二级', '任务项', '负责人', '是否演示范围', '设计', '开发', '测试', '产品', '演示准备', '进展说明'] + PHASE_HEADERS
OLD_TOKENS = ['当日变更', '改动字段', '旧值', '新值', '操作身份', '重要度', '结论', '依据']

class Xlsx(object):
    def __init__(self, path):
        self.path = path
        self.z = zipfile.ZipFile(path)
        self.parts = dict((n, self.z.read(n)) for n in self.z.namelist() if not n.endswith('/'))
        self.text_parts = dict((n, v.decode('utf-8', 'replace'))
                               for n, v in self.parts.items() if n.endswith('.xml') or n.endswith('.rels'))
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
                rgb = pt = None
                if pf is not None:
                    pt = pf.get('patternType')
                    fg = pf.find('m:fgColor', NS)
                    if fg is not None:
                        rgb = fg.get('rgb')
                self.fills.append({'patternType': pt, 'rgb': rgb})
            for xf in st.findall('.//m:cellXfs/m:xf', NS):
                al = xf.find('m:alignment', NS)
                self.cellxfs.append({'fillId': xf.get('fillId'),
                                     'wrapText': al.get('wrapText') if al is not None else None,
                                     'applyFill': xf.get('applyFill')})
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
        cols = sh.findall('.//m:cols/m:col', NS)
        merges = [m.get('ref') for m in sh.findall('.//m:mergeCells/m:mergeCell', NS)]
        info = {'part': part, 'ref': dim.get('ref') if dim is not None else None,
                'cells': cells, 'cols': cols, 'merges': merges, 'name': self.sheets[index][0]}
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

    def style_of(self, sh, addr):
        c = sh['cells'].get(addr)
        if c is None:
            return None
        s = c.get('s')
        return self.cellxfs[int(s)] if s is not None else None

    def col_letters(self, addr):
        return re.match(r'^([A-Z]+)', addr).group(1)

    def row_of(self, addr):
        return int(re.search(r'(\d+)$', addr).group(1))

    def scan_tokens(self):
        """原始部件（含未解码字节）级检索。"""
        hits = {}
        for tok in OLD_TOKENS:
            tb = tok.encode('utf-8')
            found = [n for n, raw in self.parts.items() if tb in raw]
            if found:
                hits[tok] = found
        return hits

PASS = 0
FAIL = 0
LOG = []

def check(cid, ok, detail=''):
    global PASS, FAIL
    line = ('PASS  ' if ok else 'FAIL  ') + cid + ('  :: ' + json.dumps(detail, ensure_ascii=False) if detail != '' else '')
    LOG.append(line)
    print(line)
    if ok:
        PASS += 1
    else:
        FAIL += 1

def load_json(p):
    with io.open(p, encoding='utf-8') as f:
        return json.load(f)

def mmdd(s):
    return str(s)[5:] if s and len(str(s)) >= 10 else ''

# ------------------------------------------------------------------ 日报断言
def check_daily(label, xlsx_path, api_path, expect_fallback=False):
    x = Xlsx(xlsx_path)
    api = load_json(api_path)
    names = [n for n, _ in x.sheets]
    check('%s-01 sheetNames 顺序 == [今日摘要, 阻塞与延期]' % label,
          names == ['今日摘要', '阻塞与延期'], names)
    check('%s-02 只有两个 sheet（无第三个）' % label, len(names) == 2, names)
    hits = x.scan_tokens()
    check('%s-03 文件中不出现旧「当日变更」表头文字（原始部件检索）' % label, hits == {}, hits)
    check('%s-04 不存在「当日变更」sheet 名' % label, '当日变更' not in names, names)

    s = x.sheet(0)
    ref = s['ref']
    n_rows = len(api['summary']) + 1
    check('%s-05 今日摘要 dimension 为 A1:A%d' % (label, n_rows), ref == 'A1:A%d' % n_rows, ref)
    bad_cols = sorted(set(x.col_letters(a) for a in s['cells'].keys() if x.col_letters(a) != 'A'))
    check('%s-06 今日摘要只有 A 列有单元格（无 B 列及以后）' % label, bad_cols == [], bad_cols)
    per_row = {}
    for a in s['cells'].keys():
        per_row[x.row_of(a)] = per_row.get(x.row_of(a), 0) + 1
    check('%s-07 今日摘要每行恰好 1 个单元格' % label, set(per_row.values()) == set([1]), per_row)
    check('%s-08 今日摘要 A1 == 微信文本行' % label, x.cell_value(s, 'A1') == '微信文本行', x.cell_value(s, 'A1'))
    widths = [(c.get('min'), c.get('max'), c.get('width'), c.get('customWidth')) for c in s['cols']]
    ok_w = any(mn == '1' and mx == '1' and w and 110 <= float(w) <= 130 for (mn, mx, w, cw) in widths)
    check('%s-09 A 列设有足够列宽（>=110 字符宽）' % label, ok_w, widths)
    xf = x.style_of(s, 'A2')
    check('%s-10 A 列单元格套用 wrapText 自动换行 xf' % label, bool(xf) and xf.get('wrapText') in ('1', 'true'), xf)

    lines = [x.cell_value(s, 'A%d' % r) for r in range(2, n_rows + 1)]
    api_lines = [it['line'] for it in api['summary']]
    check('%s-11 A 列文本与 /api/daily 口径逐字一致（逐行）' % label, lines == api_lines,
          [i for i, (a, b) in enumerate(zip(lines, api_lines)) if a != b][:3])
    pat = re.compile(u'^\u3010(延期\u00b7高风险|阻塞\u00b7高风险|完成|普通)\u3011[^/]+ / [^/]+ / .+ @[^\uff1a]+：.+\u3002$')
    bad = [l for l in lines if not pat.match(l)]
    if not expect_fallback:
        check('%s-12 每行符合【前缀】一级 / 二级 / 任务项 @负责人：结论。模板' % label, bad == [], bad[:2])
    if expect_fallback:
        check('%s-13 无事件兜底行 == 今日无阻塞、延期或变更。' % label,
              lines == [u'今日无阻塞、延期或变更。'], lines)
    return x, api, lines

# ------------------------------------------------- 阻塞与延期 sheet 断言
def check_blocked(label, x, api):
    s = x.sheet(1)
    n = len(api['blocked']) + 1
    check('%s-14 阻塞与延期 dimension 为 A1:P%d' % (label, n), s['ref'] == 'A1:P%d' % n, s['ref'])
    header = [x.cell_value(s, '%s1' % chr(65 + i)) for i in range(16)]
    check('%s-15 阻塞与延期表头 == A–K(含是否演示范围) + 五个进度列' % label,
          header == DAILY_BLOCKED_HEADER, header)
    extra = sorted(set(x.col_letters(a) for a in s['cells'].keys() if x.col_letters(a) not in list('ABCDEFGHIJKLMNOP')))
    check('%s-16 阻塞与延期无 P 列之后的列' % label, extra == [], extra)
    tasks = {}
    for t in api['blocked']:
        tasks[t['id']] = t
    rows = []
    for r in range(2, n + 1):
        rows.append([x.cell_value(s, '%s%d' % (chr(65 + i), r)) for i in range(16)])
    exp = []
    for t in api['blocked']:
        dates = t.get('dates') or {}
        row = [t.get('level1', ''), t.get('level2', ''), t.get('task', ''), t.get('owner', ''), t.get('demo', '')]
        row += [dates.get(k, '') for k in PHASE_KEYS]
        row.append(t.get('note', ''))
        row += [(t.get('phases') or {}).get(k, '') for k in PHASE_KEYS]
        exp.append(row)
    diffs = [{'row': i + 2, 'id': api['blocked'][i]['id'], 'got': a, 'exp': b}
             for i, (a, b) in enumerate(zip(rows, exp)) if a != b]
    check('%s-17 阻塞与延期逐行与 /api/daily 一致（A–K + 五进度列）' % label, diffs == [], diffs[:2])
    blocked_first = [t['id'] for t in api['blocked']]
    has_blocked = [t['id'] for t in api['blocked'] if '阻塞' in [(t.get('phases') or {}).get(k) for k in PHASE_KEYS]]
    check('%s-18 阻塞行排在延期行之前（与 API 序一致）' % label,
          blocked_first[:len(has_blocked)] == has_blocked, {'blocked': has_blocked, 'order': blocked_first})
    return rows

# ------------------------------------------------------------------ WBS 断言
def check_wbs(label, xlsx_path, api_path, tmpl_path):
    x = Xlsx(xlsx_path)
    t = Xlsx(tmpl_path)
    api = load_json(api_path)
    tasks = api['tasks']
    names = [n for n, _ in x.sheets]
    tnames = [n for n, _ in t.sheets]
    check('%s-01 WBS 导出仍为单 sheet 且与模板同名' % label, names == tnames, {'export': names, 'template': tnames})
    ts, xs = t.sheet(0), x.sheet(0)
    row1_keys = [a for a in ts['cells'].keys() if t.row_of(a) == 1]
    row1_t = dict((a, t.cell_value(ts, a) or '') for a in row1_keys)
    row1_x = dict((a, x.cell_value(xs, a) or '') for a in row1_keys)
    check('%s-02 第 1 行与模板逐格一致' % label, row1_t == row1_x,
          [k for k in row1_t if row1_t[k] != row1_x.get(k)])
    row2_keys = [a for a in ts['cells'].keys() if t.row_of(a) == 2]
    row2_t = dict((a, t.cell_value(ts, a) or '') for a in row2_keys)
    row2_x = dict((a, x.cell_value(xs, a) or '') for a in row2_keys)
    check('%s-03 第 2 行（原表头）与模板逐格一致' % label, row2_t == row2_x,
          [k for k in row2_t if row2_t[k] != row2_x.get(k)])
    check('%s-04 A1:C1 合并保留' % label, 'A1:C1' in xs['merges'], xs['merges'])
    head_lp = [x.cell_value(xs, '%s2' % chr(65 + i)) for i in range(11, 16)]
    check('%s-05 L2:P2 == 五个进度列表头' % label, head_lp == PHASE_HEADERS, head_lp)
    all_headers = [x.cell_value(xs, '%s2' % chr(65 + i)) for i in range(0, 16)]
    check('%s-06 表头不含旧全局「状态」列' % label, u'状态' not in all_headers, all_headers)
    tmpl_last = max(t.row_of(a) for a in ts['cells'].keys())
    last = max(tmpl_last, 3 + len(tasks) - 1)
    check('%s-07 dimension 为 A1:Q%d（模板末行 %d 与数据末行取大）' % (label, last, tmpl_last),
          xs['ref'] == 'A1:Q%d' % last, xs['ref'])
    leftover = [a for a in xs['cells'].keys()
                if x.row_of(a) > 3 + len(tasks) - 1 and x.cell_value(xs, a) not in (None, '')]
    check('%s-13 数据区末尾残留行已清空' % label, leftover == [], leftover[:5])
    q1 = x.cell_value(xs, 'Q1')
    check('%s-08 Q1 为「导出日期：」标签' % label, bool(q1) and q1.startswith(u'导出日期：'), q1)
    beyond = sorted(set(x.col_letters(a) for a in xs['cells'].keys() if x.col_letters(a) not in list('ABCDEFGHIJKLMNOPQ')[:16] + ['Q']))
    check('%s-09 无 P 列与 Q 列之外的列（无 status 列）' % label, beyond == [], beyond)

    diffs = []
    for i, task in enumerate(tasks):
        r = 3 + i
        dates = task.get('dates') or {}
        exp = [task.get('level1', ''), task.get('level2', ''), task.get('task', ''), task.get('owner', ''), task.get('demo', '')]
        exp += [dates.get(k, '') for k in PHASE_KEYS]
        exp += [task.get('note', '')]
        got = [x.cell_value(xs, '%s%d' % (chr(65 + c), r)) for c in range(11)]
        if got != exp:
            diffs.append({'row': r, 'id': task.get('id'), 'got': got, 'exp': exp})
    check('%s-10 A–K 数据区 %d 行逐字一致（含日期原文与是否演示范围）' % (label, len(tasks)), diffs == [], diffs[:1])

    pdiff = []
    cdiff = []
    for i, task in enumerate(tasks):
        r = 3 + i
        phases = task.get('phases') or {}
        for j, k in enumerate(PHASE_KEYS):
            addr = '%s%d' % (chr(65 + 11 + j), r)
            v = x.cell_value(xs, addr)
            if v != phases.get(k):
                pdiff.append({'addr': addr, 'got': v, 'exp': phases.get(k)})
            st = x.style_of(xs, addr)
            rgb = None
            if st is not None and st.get('fillId') is not None and int(st['fillId']) < len(x.fills):
                rgb = x.fills[int(st['fillId'])]['rgb']
            want = 'FF' + PHASE_HEX.get(phases.get(k), '')
            if rgb != want:
                cdiff.append({'addr': addr, 'phase': phases.get(k), 'got': rgb, 'exp': want})
    check('%s-11 L–P 进度列文字与 phases 逐格一致' % label, pdiff == [], pdiff[:3])
    check('%s-12 L–P 进度列五色填充与五色映射逐格一致' % label, cdiff == [], cdiff[:3])
    observed = set()
    for i, task in enumerate(tasks):
        r = 3 + i
        for j in range(5):
            st = x.style_of(xs, '%s%d' % (chr(65 + 11 + j), r))
            if st is not None and st.get('fillId') is not None and int(st['fillId']) < len(x.fills):
                observed.add(x.fills[int(st['fillId'])]['rgb'])
    return {'colors': sorted(c for c in observed if c), 'phase_values': sorted(set((t.get('phases') or {}).get(k) for t in tasks for k in PHASE_KEYS))}

def main():
    dl = DL
    # 现场（真实浏览器下载）
    xd, api_d, lines_d = check_daily('LIVE-D', os.path.join(dl, u'live-蓉城战役日报-20261015.xlsx'),
                                     os.path.join(dl, 'live-daily-at-export.json'))
    check_blocked('LIVE-D', xd, api_d)
    check_wbs('LIVE-W', os.path.join(dl, u'live-蓉城战役WBS-20261015.xlsx'),
              os.path.join(dl, 'live-wbs-at-export.json'), TEMPLATE)
    iso_w = check_wbs('ISO-W', os.path.join(dl, u'iso-蓉城战役WBS-20261015.xlsx'),
                      os.path.join(dl, 'iso-wbs-at-export.json'), TEMPLATE)
    expect_colors = sorted('FF' + v for v in PHASE_HEX.values())
    check('ISO-W-14 L–P 五色填充全部出现（未开始灰/已开始蓝/已完成绿/延期红/阻塞黄）',
          iso_w['colors'] == expect_colors, {'observed': iso_w['colors'], 'expect': expect_colors, 'phase_values': iso_w['phase_values']})

    # 隔离实例（写入后导出）
    xi, api_i, lines_i = check_daily('ISO-D', os.path.join(dl, u'iso-蓉城战役日报-20261015.xlsx'),
                                     os.path.join(dl, 'iso-daily-at-export.json'))
    check_blocked('ISO-D', xi, api_i)
    cat = [re.match(u'^\u3010([^\u3011]+)\u3011', l).group(1) for l in lines_i]
    expect_cat = [u'延期\u00b7高风险', u'阻塞\u00b7高风险', u'延期\u00b7高风险', u'完成', u'普通', u'普通', u'普通']
    check('ISO-D-19 五类前缀与排序（延期>阻塞>到期未更新>完成>普通）逐行一致', cat == expect_cat, cat)
    concl = [l.split(u'\uff1a')[-1] for l in lines_i]
    expect_concl = [u'设计延期。', u'阶段更新为阻塞。', u'设计 10-14 到期未更新，判定延期。', u'阶段已完成。',
                    u'产品计划 11-23 \u2192 11-05。', u'开发计划 11-17 \u2192 11-06。', u'设计进度 未开始 \u2192 已开始。']
    check('ISO-D-20 结论模板逐字（延期/阻塞/到期未更新/完成/普通）', concl == expect_concl, concl)

    multi = [l for l in lines_i if u'代码开发' in l]
    check('ISO-D-21 一任务多事件多行（T006 = 代码开发，产出「设计延期」与「开发计划」两行）',
          len(multi) == 2 and multi[0].endswith(u'设计延期。') and multi[1].endswith(u'开发计划 11-17 \u2192 11-06。'), multi)
    ids_at = [(('@' in l) and (l.split(' @')[1].split(u'：')[0] != '')) for l in lines_i]
    check('ISO-D-22 @ 兼容（每行都带非空 @负责人）', all(ids_at), [l for l, ok in zip(lines_i, ids_at) if not ok])

    # 无事件兜底
    check_daily('QUIET-D', os.path.join(dl, u'quiet-蓉城战役日报-20261015.xlsx'),
                os.path.join(dl, 'iso-quiet-daily.json'), expect_fallback=True)

    out = os.path.join(S14, 'results', 'readback-results.json')
    with io.open(out, 'w', encoding='utf-8') as f:
        f.write(json.dumps({'pass': PASS, 'fail': FAIL, 'log': LOG}, ensure_ascii=False, indent=2))
    print('\n[readback] PASS=%d FAIL=%d' % (PASS, FAIL))
    return 0 if FAIL == 0 else 1

if __name__ == '__main__':
    sys.exit(main())
