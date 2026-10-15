#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""YUNZ-32 / Stage12：WBS 导出与日报三 sheet 的 xlsx 读回（Python 标准库 zipfile + xml.etree）。
用法：qv-readback.py wbs <xlsx> <api.json> <label>
      qv-readback.py daily <xlsx> <daily.json> <label> [--empty]
"""
import io, json, re, sys, zipfile
from xml.etree import ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
RNS = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
ST = '/opt/SoftFactory-AINative/artifacts/YUNZ-20/verification/stage12'
TEMPLATE = '/opt/wbs-rongcheng/public/template.xlsx'
PHASES = ['design', 'dev', 'test', 'product', 'demo_prep']
PHASE_HEADERS = ['设计进度', '开发进度', '测试进度', '产品进度', '演示准备进度']
PHASE_HEX = {'未开始': 'FF9E9E9E', '已开始': 'FF2F80ED', '已完成': 'FF27AE60', '延期': 'FFE74C3C', '阻塞': 'FFFFD400'}
RANK = {'延期': 1, '阻塞': 2, '到期未更新': 3, '完成': 4, '普通': 5}
PREFIX_RANK = {'延期·高风险': 1, '阻塞·高风险': 2, '完成': 4, '普通': 5}
import datetime
def fmt_tz(iso):
    """复刻 app.js formatInTz（sv-SE / Asia/Shanghai，秒精度）。"""
    t = str(iso or '')
    if t == '':
        return ''
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$', t)
    if not m:
        return t
    dt = datetime.datetime(*[int(x) for x in m.groups()]) + datetime.timedelta(hours=8)
    return dt.strftime('%Y-%m-%d %H:%M:%S')
DATE_LABELS = {'design': '设计', 'dev': '开发', 'test': '测试', 'product': '产品', 'demo_prep': '演示准备'}
FIELD_LABELS = {'level1': '一级', 'level2': '二级', 'task': '任务项', 'owner': '负责人', 'demo': '是否演示范围', 'note': '进展说明'}
def field_label(f):
    """复刻 app.js fieldLabel（日报「改动字段」列显示的是中文标签）。"""
    f = str(f or '')
    if f in FIELD_LABELS:
        return FIELD_LABELS[f]
    if f.startswith('dates.') and f[6:] in DATE_LABELS:
        return DATE_LABELS[f[6:]]
    if f.startswith('phases.') and f.endswith('.status') and f[7:-7] in PHASES:
        return PHASE_HEADERS[PHASES.index(f[7:-7])]
    return f
fails = []
def ck(n, c, d=''):
    print(('PASS  ' if c else 'FAIL  ') + n + ('  :: ' + str(d) if d != '' else ''))
    if not c:
        fails.append(n)
def load(p):
    return json.load(io.open(p, encoding='utf-8'))

def colnum(ref):
    m = re.match(r'^([A-Z]+)(\d+)$', ref)
    n = 0
    for ch in m.group(1):
        n = n * 26 + (ord(ch) - 64)
    return n, int(m.group(2))
def colname(i):
    s = ''
    while i > 0:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s

def shared(z):
    if 'xl/sharedStrings.xml' not in z.namelist():
        return []
    r = ET.fromstring(z.read('xl/sharedStrings.xml'))
    return [''.join(t.text or '' for t in si.iter(NS + 't')) for si in r.findall(NS + 'si')]

def fills(z):
    st = ET.fromstring(z.read('xl/styles.xml'))
    out = []
    for f in st.find(NS + 'fills'):
        pf = f.find(NS + 'patternFill')
        rgb = None
        if pf is not None:
            fg = pf.find(NS + 'fgColor')
            rgb = fg.attrib.get('rgb') if fg is not None else None
        out.append(rgb)
    xfs = [xf.attrib.get('fillId') for xf in st.find(NS + 'cellXfs')]
    return out, xfs

def sheets(z):
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    rid2target = dict((r.attrib['Id'], r.attrib['Target']) for r in rels)
    out = []
    for s in wb.find(NS + 'sheets'):
        t = rid2target.get(s.attrib.get(RNS + 'id'), '')
        out.append((s.attrib['name'], 'xl/' + t.lstrip('/').replace('xl/', '', 1) if t.startswith('xl/') else 'xl/' + t))
    return out

def read_sheet(z, path):
    sh = ET.fromstring(z.read(path))
    ss = shared(z)
    fl, xfs = fills(z)
    cells, fillmap = {}, {}
    for row in sh.find(NS + 'sheetData'):
        for c in row.findall(NS + 'c'):
            ref = c.attrib['r']
            t = c.attrib.get('t')
            v = c.find(NS + 'v')
            isv = c.find(NS + 'is')
            if t == 's' and v is not None:
                val = ss[int(v.text)]
            elif isv is not None:
                val = ''.join(x.text or '' for x in isv.iter(NS + 't'))
            elif v is not None:
                val = v.text
            else:
                val = ''
            cells[ref] = '' if val is None else val
            s = c.attrib.get('s')
            if s is not None:
                fid = xfs[int(s)] if int(s) < len(xfs) else None
                fillmap[ref] = fl[int(fid)] if fid is not None and int(fid) < len(fl) else None
    mg = sh.find(NS + 'mergeCells')
    merges = [m.attrib['ref'] for m in mg.findall(NS + 'mergeCell')] if mg is not None else []
    cols = {}
    colsel = sh.find(NS + 'cols')
    if colsel is not None:
        for c in colsel.findall(NS + 'col'):
            lo, hi = int(c.attrib['min']), int(c.attrib['max'])
            if hi - lo > 4096:
                continue
            for i in range(lo, hi + 1):
                cols[i] = c.attrib.get('width')
    return {'cells': cells, 'merges': merges, 'cols': cols, 'fillmap': fillmap}

def cell(sheet, col, row):
    return sheet['cells'].get(colname(col) + str(row), '')

def rowvals(sheet, row, ncol):
    return [cell(sheet, i, row) for i in range(1, ncol + 1)]

mode = sys.argv[1]
if mode == 'wbs':
    xlsx, apijson, label = sys.argv[2], sys.argv[3], sys.argv[4]
    z = zipfile.ZipFile(xlsx)
    sh = sheets(z)
    zt = zipfile.ZipFile(TEMPLATE)
    sht = sheets(zt)
    t = read_sheet(zt, sht[0][1])
    s = read_sheet(z, sh[0][1])
    api = load(apijson)
    tasks = api['tasks']
    ck(label + '-W1 导出工作簿 sheet 名称与模板一致', sh[0][0] == sht[0][0], {'export': sh[0][0], 'template': sht[0][0]})
    ck(label + '-W2 第 1 行原文保真（A1 + D1:H1）', cell(s, 1, 1) == cell(t, 1, 1) and [cell(s, i, 1) for i in range(4, 9)] == [cell(t, i, 1) for i in range(4, 9)],
       {'A1': cell(s, 1, 1)[:24]})
    ck(label + '-W3 A1:C1 合并保留', 'A1:C1' in s['merges'], s['merges'])
    ck(label + '-W4 第 2 行 A–K 与模板逐字一致（含 负责人/是否演示范围/5 个日期列/进展说明）',
       [cell(s, i, 2) for i in range(1, 12)] == [cell(t, i, 2) for i in range(1, 12)],
       {'export': [cell(s, i, 2) for i in range(1, 12)], 'template': [cell(t, i, 2) for i in range(1, 12)]})
    ck(label + '-W5 K 后连续 5 个进度列表头顺序正确', [cell(s, i, 2) for i in range(12, 17)] == PHASE_HEADERS, [cell(s, i, 2) for i in range(12, 17)])
    labels = [ref for ref, v in s['cells'].items() if isinstance(v, str) and '导出日期' in v]
    ck(label + '-W6 导出日期标签唯一且右移至最后一个排序列之后的 Q1（内容/格式不变）',
       labels == ['Q1'] and bool(re.match(r'^导出日期：\d{4}-\d{2}-\d{2} \d{2}:\d{2}$', cell(s, 17, 1))), {'labels': labels, 'Q1': cell(s, 17, 1)})
    nrows = len(tasks)
    datarow_ok = all(any(cell(s, i, 3 + r) != '' for i in range(1, 12)) for r in range(nrows))
    empty_after = all(cell(s, i, 3 + nrows) == '' for i in range(1, 18))
    ck(label + '-W7 数据区行数 = %d 且其后无残留' % nrows, datarow_ok and empty_after, {'rows': nrows})
    bad_ak, bad_lp, bad_fill = [], [], []
    for r, task in enumerate(tasks):
        row = 3 + r
        want = [task.get('level1', ''), task.get('level2', ''), task.get('task', ''), task.get('owner', ''), task.get('demo', ''),
                (task.get('dates') or {}).get('design', ''), (task.get('dates') or {}).get('dev', ''), (task.get('dates') or {}).get('test', ''),
                (task.get('dates') or {}).get('product', ''), (task.get('dates') or {}).get('demo_prep', ''), task.get('note', '')]
        got = rowvals(s, row, 11)
        if [str(v) for v in want] != [str(v) for v in got]:
            bad_ak.append((task['id'], want, got))
        wantp = [(task.get('phases') or {}).get(k, '') for k in PHASES]
        gotp = rowvals(s, row, 16)[11:16]
        if wantp != gotp:
            bad_lp.append((task['id'], wantp, gotp))
        for i, k in enumerate(PHASES):
            ref = colname(12 + i) + str(row)
            if s['fillmap'].get(ref) != PHASE_HEX.get(gotp[i]):
                bad_fill.append((ref, gotp[i], s['fillmap'].get(ref), PHASE_HEX.get(gotp[i])))
    ck(label + '-W8 A–K 数据与 JSON 逐字段一致（35 行 × 11 列，含 demo 原值）', not bad_ak, bad_ak[:2])
    ck(label + '-W9 L–P 五进度列数据与 JSON phases 顺序一致', not bad_lp, bad_lp[:2])
    ck(label + '-W10 L–P 五色填充存在且与值映射一致', not bad_fill, bad_fill[:3])
    tw = [t['cols'].get(i) for i in range(1, 12)]
    sw = [s['cols'].get(i) for i in range(1, 12)]
    ck(label + '-W11 A–K 列宽与模板一致', tw == sw, {'template': tw, 'export': sw})
    hdr2 = [cell(s, i, 2) for i in range(1, 18)]
    nonempty2 = [v for v in hdr2 if v != '']
    tmphdr = [cell(t, i, 2) for i in range(1, 12)]
    ck(label + '-W12 旧全局 status 未进入 WBS 导出（表头 = 模板既有表头 + 5 进度列，无「状态」列）',
       '状态' not in nonempty2 and nonempty2 == [v for v in tmphdr if v != ''] + PHASE_HEADERS and hdr2[16] == '',
       {'row2': hdr2})
elif mode == 'daily':
    xlsx, apijson, label = sys.argv[2], sys.argv[3], sys.argv[4]
    empty_mode = '--empty' in sys.argv
    z = zipfile.ZipFile(xlsx)
    sh = sheets(z)
    names = [x[0] for x in sh]
    d = load(apijson)
    ck(label + '-D1 日报 sheet 名称与数量正确', names == ['今日摘要', '阻塞与延期', '当日变更'], names)
    s = dict((nm, read_sheet(z, p)) for nm, p in sh)
    # 今日摘要
    sm = s['今日摘要']
    hdr = rowvals(sm, 1, 9)
    ck(label + '-D2 今日摘要 分列结构（微信文本行/重要度/结论/一级/二级/任务项/负责人/时间/依据）',
       hdr == ['微信文本行', '重要度', '结论', '一级', '二级', '任务项', '负责人', '时间', '依据'], hdr)
    n = len(d['summary'])
    ck(label + '-D3 今日摘要 行数 = API 事件数 + 表头', cell(sm, 1, 2 + n) == '' and any(cell(sm, 1, 1 + i) != '' for i in range(1, n + 1)), {'api': n})
    mismatch, fmt_bad = [], []
    for i, ev in enumerate(d['summary']):
        row = 2 + i
        got = rowvals(sm, row, 9)
        want = [ev.get('line', ''), ev.get('importance', ''), ev.get('conclusion', ''), ev.get('level1', ''), ev.get('level2', ''), ev.get('task', ''), ev.get('owner', ''), (fmt_tz(ev.get('at')) if ev.get('at') else '-'), ev.get('basis', '')]
        if got != want:
            mismatch.append((row, want, got))
        if ev.get('line') == '今日无阻塞、延期或变更。':
            continue
        args = {'重要度': ev.get('importance', ''), '一级': ev.get('level1', ''), '二级': ev.get('level2', ''), '任务项': ev.get('task', ''), '负责人': ev.get('owner', ''), '结论': ev.get('conclusion', '')}
        expect = '【%(重要度)s】%(一级)s / %(二级)s / %(任务项)s @%(负责人)s：%(结论)s。' % args
        if got[0] != expect:
            fmt_bad.append((row, expect, got[0]))
    ck(label + '-D4 今日摘要 逐行与 API 分列一致（含时间/依据）', not mismatch, mismatch[:2])
    ck(label + '-D5 今日摘要 逐字断言「【重要度】一级 / 二级 / 任务项 @负责人：结论。」', not fmt_bad, fmt_bad[:2])
    prefixes = sorted(set(cell(sm, 2, 2 + i) for i in range(n)))
    ck(label + '-D6 重要度前缀取值合法（延期·高风险/阻塞·高风险/完成/普通 或兜底空值）', all(p in ['延期·高风险', '阻塞·高风险', '完成', '普通', ''] for p in prefixes), prefixes)
    ranks = []
    for i in range(n):
        row = 2 + i
        basis, imp = cell(sm, 9, row), cell(sm, 2, row)
        if imp == '':
            continue
        ranks.append(3 if basis == '计划日期早于今天且今日未更新' else PREFIX_RANK.get(imp, 9))
    ck(label + '-D7 今日摘要 排序：延期 > 阻塞 > 到期未更新判定延期 > 完成 > 普通变更', ranks == sorted(ranks), ranks[:12])
    taskcount = {}
    for i in range(n):
        taskcount[cell(sm, 6, 2 + i)] = taskcount.get(cell(sm, 6, 2 + i), 0) + 1
    if not empty_mode:
        ck(label + '-D8 同一任务多事件 → 多行', (max(taskcount.values()) >= 2 if taskcount else True), {'rows': n, 'max_per_task': max(taskcount.values()) if taskcount else 0})
    # 阻塞与延期
    bl = s['阻塞与延期']
    bhdr = rowvals(bl, 1, 16)
    want_hdr = ['一级', '二级', '任务项', '负责人', '是否演示范围', '设计', '开发', '测试', '产品', '演示准备', '进展说明'] + PHASE_HEADERS
    ck(label + '-D9 阻塞与延期 表头 = A–K（含 是否演示范围）+ 五进度列', bhdr == want_hdr, bhdr)
    nb = len(d['blocked'])
    got_tasks = [cell(bl, 3, 2 + i) for i in range(nb)]
    ck(label + '-D10 阻塞与延期 仅含命中延期/阻塞的行且行序与 API 一致', got_tasks == [x.get('task', '') for x in d['blocked']], {'api': [x.get('task') for x in d['blocked']][:5], 'sheet': got_tasks[:5]})
    allhit, demo_ok, blocked_first = True, True, True
    flags = []
    seen_late = False
    for i, tsk in enumerate(d['blocked']):
        row = 2 + i
        ph = [cell(bl, 12 + k, row) for k in range(5)]
        if not any(v in ('延期', '阻塞') for v in ph):
            allhit = False
        isb = any(v == '阻塞' for v in ph)
        flags.append(isb)
        if not isb:
            seen_late = True
        elif seen_late:
            blocked_first = False
        if cell(bl, 5, row) != tsk.get('demo', ''):
            demo_ok = False
        if ph != [(tsk.get('phases') or {}).get(k, '') for k in PHASES]:
            allhit = False
    ck(label + '-D11 阻塞与延期 每行至少一阶段命中延期/阻塞、五进度列与 JSON 一致', allhit, {'rows': nb})
    ck(label + '-D12 阻塞与延期 是否演示范围原值保留', demo_ok, {'has_nonempty_demo': any((x.get('demo') or '') != '' for x in d['blocked'])})
    ck(label + '-D13 阻塞与延期 阻塞行排前', blocked_first, flags[:12])
    # 当日变更
    ch = s['当日变更']
    chdr = rowvals(ch, 1, 9)
    ck(label + '-D14 当日变更 字段级明细列（一级/二级/任务项/负责人/改动字段/旧值/新值/时间/操作身份）',
       chdr == ['一级', '二级', '任务项', '负责人', '改动字段', '旧值', '新值', '时间', '操作身份'], chdr)
    nc = len(d['changes'])
    bad = []
    for i, c in enumerate(d['changes']):
        row = 2 + i
        want = [c.get('level1', ''), c.get('level2', ''), c.get('task', ''), c.get('owner', ''), field_label(c.get('field')), c.get('old', ''), c.get('new', ''), fmt_tz(c.get('at')), c.get('identity', '')]
        if rowvals(ch, row, 9) != want:
            bad.append((row, want, rowvals(ch, row, 9)))
    ck(label + '-D15 当日变更 逐行与 API 明细一致（%d 行）' % nc, not bad, bad[:2])
    def chrank(c):
        if str(c.get('field', '')).startswith('phases.'):
            v = c.get('new')
            return {'延期': 1, '阻塞': 2, '已完成': 4}.get(v, 5)
        return 5
    cr = [chrank(c) for c in d['changes']]
    ck(label + '-D16 当日变更 按重要度排序（延期>阻塞>完成>普通）', cr == sorted(cr), cr[:12])
    alles = ' '.join(str(v) for shn in names for v in s[shn]['cells'].values())
    ck(label + '-D17 迁移审计行未出现在日报任何 sheet', '系统迁移' not in alles and 'migrated' not in alles, None)
    ck(label + '-D18 旧 status 未进入日报任何 sheet', all(cell(ch, 5, 2 + i) != 'status' for i in range(nc)), [cell(ch, 5, 2 + i) for i in range(min(nc, 5))])
    if not empty_mode:
        pr = [c for c in d['changes'] if c.get('field') == '人员池']
        if pr:
            rows_pr = [i for i in range(nc) if cell(ch, 5, 2 + i) == '人员池']
            okpr = all(cell(ch, 6, 2 + i) == '' and cell(ch, 7, 2 + i) == d['changes'][i].get('new') and
                       cell(ch, 3, 2 + i) == '新增人员 ' + str(d['changes'][i].get('new')) for i in rows_pr)
            ck(label + '-D19 CH-7 新增人员审计行（改动字段 人员池 / 旧值空 / 新值姓名 / 任务项 新增人员 X）', bool(rows_pr) and okpr,
               {'rows': rows_pr, 'names': [cell(ch, 7, 2 + i) for i in rows_pr]})
    else:
        ck(label + '-D20 无事件兜底行「今日无阻塞、延期或变更。」', n == 1 and cell(sm, 1, 2) == '今日无阻塞、延期或变更。' and cell(sm, 2, 3) == '' and nb == 0 and nc == 0, {'summary': [cell(sm, i, 2) for i in range(1, 10)], 'blocked_rows': nb, 'change_rows': nc})
else:
    print('unknown mode'); sys.exit(2)
print('== %s 读回汇总：FAIL=%d ==' % (label, len(fails)))
sys.exit(1 if fails else 0)
