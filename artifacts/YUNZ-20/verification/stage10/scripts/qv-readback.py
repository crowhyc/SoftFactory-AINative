# -*- coding: utf-8 -*-
# YUNZ-30 / Stage10：导出与日报读回器（仅 Python 标准库：zipfile + xml.etree）
# 用法：qv-readback.py --wbs F --daily F --doc API_DOC.json --history HISTORY.json --template TEMPLATE.xlsx --label NAME --out OUT.json
from __future__ import print_function
import argparse, json, re, sys, zipfile
import xml.etree.ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
RNS = '{http://schemas.openxmlformats.org/package/2006/relationships}'
RID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'

results = []
state = {'pass': 0, 'fail': 0}


def check(name, cond, detail):
    ok = bool(cond)
    state['pass' if ok else 'fail'] += 1
    results.append({'name': name, 'ok': ok, 'detail': detail})
    print(('PASS  ' if ok else 'FAIL  ') + name + '  :: ' + json.dumps(detail, ensure_ascii=False))


def col_idx(col):
    n = 0
    for ch in col:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def col_name(index):
    name = ''
    n = index
    while True:
        name = chr(65 + n % 26) + name
        n = n // 26 - 1
        if n < 0:
            return name


def read_xlsx(path):
    z = zipfile.ZipFile(path)
    names = z.namelist()
    shared = []
    if 'xl/sharedStrings.xml' in names:
        root = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in root.findall(NS + 'si'):
            shared.append(''.join(t.text or '' for t in si.iter(NS + 't')))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    relmap = dict((r.get('Id'), r.get('Target')) for r in rels.findall(RNS + 'Relationship'))
    sheets = []
    for sh in wb.find(NS + 'sheets').findall(NS + 'sheet'):
        target = relmap[sh.get(RID)]
        if target.startswith('/'):
            target = target.lstrip('/')
        elif not target.startswith('xl/'):
            target = 'xl/' + target
        root = ET.fromstring(z.read(target))
        cells = {}
        for c in root.iter(NS + 'c'):
            ref, ctype = c.get('r'), c.get('t')
            v, isv = c.find(NS + 'v'), c.find(NS + 'is')
            if ctype == 's' and v is not None and v.text is not None:
                val = shared[int(v.text)]
            elif ctype == 'inlineStr' and isv is not None:
                val = ''.join(x.text or '' for x in isv.iter(NS + 't'))
            elif v is not None:
                val = v.text or ''
            else:
                val = ''
            cells[ref] = val
        cols = []
        cols_el = root.find(NS + 'cols')
        if cols_el is not None:
            for col in cols_el.findall(NS + 'col'):
                cols.append({'min': int(col.get('min')), 'max': int(col.get('max')), 'width': col.get('width')})
        sheets.append((sh.get('name'), {'cells': cells, 'cols': cols}))
    return sheets


def grid(sheet, rows, cols):
    return [[sheet['cells'].get(col_name(c) + str(r), '') for c in cols] for r in rows]


def width_of(cols, index):
    for c in cols:
        if c['min'] <= index + 1 <= c['max']:
            return c['width']
    return None


def main():
    ap = argparse.ArgumentParser()
    for f in ('wbs', 'daily', 'doc', 'history', 'template', 'label', 'out'):
        ap.add_argument('--' + f, required=True)
    a = ap.parse_args()

    doc = json.load(open(a.doc, encoding='utf-8'))
    hist = json.load(open(a.history, encoding='utf-8'))
    tasks = doc['tasks']
    blocked_status = [u'\u5df2\u5ef6\u671f', u'\u88ab\u963b\u585e']
    exp_rows = []
    for t in tasks:
        d = t.get('dates') or {}
        exp_rows.append([t.get('level1', ''), t.get('level2', ''), t.get('task', ''), t.get('owner', ''), t.get('demo', ''),
                         d.get('design', ''), d.get('dev', ''), d.get('test', ''), d.get('product', ''), d.get('demo_prep', ''),
                         t.get('note', '')])
    exp_blocked = [[t.get('level1', ''), t.get('level2', ''), t.get('task', ''), t.get('owner', ''), t.get('demo', ''),
                    (t.get('dates') or {}).get('design', ''), (t.get('dates') or {}).get('dev', ''),
                    (t.get('dates') or {}).get('test', ''), (t.get('dates') or {}).get('product', ''),
                    (t.get('dates') or {}).get('demo_prep', ''), t.get('note', ''), t.get('status', '')]
                   for t in tasks if t.get('status') in blocked_status]

    wbs_sheets = read_xlsx(a.wbs)
    daily_sheets = read_xlsx(a.daily)
    tpl_sheets = read_xlsx(a.template)
    tpl = tpl_sheets[0][1]
    wbs = wbs_sheets[0][1]

    got = grid(wbs, range(3, 3 + len(exp_rows)), range(0, 11))
    diff = [(i + 3, j, exp_rows[i][j], got[i][j]) for i in range(len(exp_rows)) for j in range(11) if exp_rows[i][j] != got[i][j]]
    check(a.label + ' WBS1：A–K 数据区逐格等于 API/磁盘（K 列为 note 原文 Markdown，未被转换）',
          len(tasks) == 36 and len(got) == 36 and not diff, {'rows': len(got), 'diffCount': len(diff), 'diff': diff[:3]})
    extra = [(r, col_name(c)) for r in range(3, 3 + len(exp_rows)) for c in range(11, 16) if wbs['cells'].get(col_name(c) + str(r), '') != '']
    check(a.label + ' WBS2：L–P 无内容 —— status 未导出、数据区外无越界写入', not extra, {'extra': extra[:5]})
    tpl_rows = grid(tpl, [1, 2], range(0, 14))
    wbs_rows = grid(wbs, [1, 2], range(0, 14))
    # M1 是 CH-6 有意新增的日期标签列，单独核对；其余单元格必须与模板逐格一致
    tpl_m1 = tpl_rows[0][12]
    tpl_rows[0][12] = wbs_rows[0][12] = ''
    check(a.label + ' WBS3：第 1/2 行除 M1 外与模板逐格一致（标题与合并区未被改写），且模板 M1 原为空',
          tpl_rows == wbs_rows and tpl_m1 == '', {'same': tpl_rows == wbs_rows, 'template_M1': tpl_m1, 'export_row1_tail': wbs_rows[0][11:14]})
    m1 = wbs['cells'].get('M1', '')
    check(a.label + ' WBS4：M1 日期标签格式为「导出日期：YYYY-MM-DD HH:MM」',
          bool(re.match(u'^\u5bfc\u51fa\u65e5\u671f\uff1a\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$', m1)), {'M1': m1})
    tpl_cols = [width_of(tpl['cols'], i) for i in range(11)]
    wbs_cols = [width_of(wbs['cols'], i) for i in range(11)]
    check(a.label + ' WBS5：A–K 列宽与原模板一致（!cols 保真，K 列宽度未丢失）',
          tpl_cols == wbs_cols and wbs_cols[10] is not None, {'template': tpl_cols[:3] + tpl_cols[-2:], 'export': wbs_cols[:3] + wbs_cols[-2:]})
    check(a.label + ' WBS6：导出文件仅一个工作表且表名与模板一致',
          len(wbs_sheets) == 1 and wbs_sheets[0][0] == tpl_sheets[0][0], {'names': [n for n, _ in wbs_sheets], 'tpl': tpl_sheets[0][0]})

    names = [n for n, _ in daily_sheets]
    check(a.label + ' DLY1：日报含且仅含两个 sheet「阻塞与延期」「当日变更」',
          names == [u'\u963b\u585e\u4e0e\u5ef6\u671f', u'\u5f53\u65e5\u53d8\u66f4'], {'names': names})
    blk = daily_sheets[0][1]
    header = grid(blk, [1], range(0, 12))[0]
    exp_header = [u'\u4e00\u7ea7', u'\u4e8c\u7ea7', u'\u4efb\u52a1\u9879', u'\u8d1f\u8d23\u4eba', u'\u662f\u5426\u6f14\u793a\u8303\u56f4',
                  u'\u8bbe\u8ba1', u'\u5f00\u53d1', u'\u6d4b\u8bd5', u'\u4ea7\u54c1', u'\u6f14\u793a\u51c6\u5907',
                  u'\u8fdb\u5c55\u8bf4\u660e', u'\u72b6\u6001']
    blk_rows = grid(blk, range(2, 2 + len(exp_blocked)), range(0, 12))
    blk_extra = [r for r in range(2 + len(exp_blocked), 6 + len(exp_blocked))
                 if any(blk['cells'].get(col_name(c) + str(r), '') != '' for c in range(0, 13))]
    check(a.label + ' DLY2：sheet「阻塞与延期」表头 12 列正确、行集 = 状态为已延期/被阻塞的任务（含状态列与 note 原文）',
          header == exp_header and blk_rows == exp_blocked and not blk_extra,
          {'rows': len(blk_rows), 'expected': len(exp_blocked), 'extra': blk_extra})

    chg = daily_sheets[1][1] if len(daily_sheets) > 1 else {'cells': {}, 'cols': []}
    cheader = grid(chg, [1], range(0, 10))[0]
    exp_cheader = ['id', u'\u4e00\u7ea7', u'\u4e8c\u7ea7', u'\u4efb\u52a1\u9879', u'\u8d1f\u8d23\u4eba',
                   u'\u6539\u52a8\u5b57\u6bb5', u'\u65e7\u503c', u'\u65b0\u503c', u'\u65f6\u95f4', u'\u64cd\u4f5c\u8eab\u4efd']
    records = hist.get('records') or []
    chg_rows = grid(chg, range(2, 2 + len(records)), range(0, 10))
    chg_extra = [r for r in range(2 + len(records), 6 + len(records))
                 if any(chg['cells'].get(col_name(c) + str(r), '') != '' for c in range(0, 11))]
    check(a.label + ' DLY3：sheet「当日变更」表头 10 列正确、行数 = /api/history 当日记录数（无新字段、无多余列）',
          cheader == exp_cheader and len(chg_rows) == len(records) and not chg_extra,
          {'rows': len(chg_rows), 'records': len(records), 'extra': chg_extra, 'header': cheader[:3]})
    note_rows = [r for r in chg_rows if r[5] == u'\u8fdb\u5c55\u8bf4\u660e']
    hist_notes = [r for r in records if r.get('field') == 'note']
    mism = []
    for nr, hr in zip(note_rows, hist_notes):
        if nr[0] != hr.get('task_id') or nr[6] != hr.get('old') or nr[7] != hr.get('new') or nr[9] != hr.get('identity'):
            mism.append({'export': [nr[0], nr[6], nr[7], nr[9]], 'api': [hr.get('task_id'), hr.get('old'), hr.get('new'), hr.get('identity')]})
    check(a.label + ' DLY4：note 变更行旧值/新值与 /api/history 的 Markdown 原文逐条一致（读回比对，未被截断/转换）',
          len(note_rows) == len(hist_notes) and not mism, {'noteRows': len(note_rows), 'histNotes': len(hist_notes), 'mismatch': mism[:2]})

    out = {'label': a.label, 'pass': state['pass'], 'fail': state['fail'], 'results': results}
    json.dump(out, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('---')
    print('PASS=' + str(state['pass']) + ' FAIL=' + str(state['fail']))
    return 0 if state['fail'] == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
