#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""YUNZ-28 / Stage8 独立复验：用 Python 标准库（zipfile + xml.etree）读回 xlsx，
对 CH-5 日报导出 / CH-6 导出日期标签 / 原 WBS 导出回归做独立断言。
不依赖 openpyxl / 作者脚本；字段标签与时间格式化在本脚本内独立实现。"""
from __future__ import print_function
import zipfile, re, json, io, sys, argparse
import xml.etree.ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
RNS = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
STATUSES = ['未开始', '进行中', '已完成', '已延期', '被阻塞']
DATE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep']
FIELD_LABELS = {'id': '序号', 'level1': '一级', 'level2': '二级', 'task': '任务项', 'owner': '负责人',
                'demo': '是否演示范围', 'note': '进展说明', 'status': '状态',
                'dates.design': '设计', 'dates.dev': '开发', 'dates.test': '测试',
                'dates.product': '产品', 'dates.demo_prep': '演示准备'}
BLOCKED_HEADER = ['一级', '二级', '任务项', '负责人', '是否演示范围', '设计', '开发', '测试', '产品', '演示准备', '进展说明', '状态']
CHANGE_HEADER = ['id', '一级', '二级', '任务项', '负责人', '改动字段', '旧值', '新值', '时间', '操作身份']

results = {'checks': []}
_pass = [0]
_fail = [0]


def check(cid, ok, detail=None):
    results['checks'].append({'id': cid, 'ok': bool(ok), 'detail': detail})
    if ok:
        _pass[0] += 1
        print('PASS  %s%s' % (cid, ('  :: ' + json.dumps(detail, ensure_ascii=False)) if detail is not None else ''))
    else:
        _fail[0] += 1
        print('FAIL  %s  -> %s' % (cid, json.dumps(detail, ensure_ascii=False)))


def read_xlsx(path):
    z = zipfile.ZipFile(path)
    names = z.namelist()
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    relmap = dict((r.get('Id'), r.get('Target')) for r in rels)
    shared = []
    if 'xl/sharedStrings.xml' in names:
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')):
            shared.append(''.join(t.text or '' for t in si.iter(NS + 't')))
    out = {}
    order = []
    for sh in wb.iter(NS + 'sheet'):
        sheet_name = sh.get('name')
        target = relmap.get(sh.get(RNS + 'id'), '')
        if not target.startswith('xl/'):
            target = 'xl/' + target.lstrip('/')
        ws = ET.fromstring(z.read(target))
        cells = {}
        for c in ws.iter(NS + 'c'):
            ref = c.get('r')
            t = c.get('t')
            v = c.find(NS + 'v')
            isel = c.find(NS + 'is')
            if t == 'inlineStr' and isel is not None:
                val = ''.join(x.text or '' for x in isel.iter(NS + 't'))
            elif v is None:
                continue
            elif t == 's':
                val = shared[int(v.text)]
            elif t in ('str', 'inlineStr'):
                val = v.text or ''
            else:
                val = v.text
            cells[ref] = val
        merges = [m.get('ref') for m in ws.iter(NS + 'mergeCell')]
        cols = [(c.get('min'), c.get('max'), c.get('width')) for c in ws.iter(NS + 'col')]
        dim = ws.find(NS + 'dimension')
        order.append(sheet_name)
        out[sheet_name] = {'cells': cells, 'merges': merges, 'cols': cols,
                           'dim': dim.get('ref') if dim is not None else None}
    return order, out


def col_index(letters):
    v = 0
    for ch in letters:
        v = v * 26 + (ord(ch) - 64)
    return v - 1


def split_ref(ref):
    m = re.match(r'^([A-Z]+)(\d+)$', ref)
    return (col_index(m.group(1)), int(m.group(2)))


def col_name(idx):
    name = ''
    n = idx
    while n >= 0:
        name = chr(65 + (n % 26)) + name
        n = n // 26 - 1
    return name


def shanghai(iso_text, with_seconds=True):
    import datetime
    dt = datetime.datetime.strptime(iso_text.replace('Z', ''), '%Y-%m-%dT%H:%M:%S.%f') if '.' in iso_text else datetime.datetime.strptime(iso_text.replace('Z', ''), '%Y-%m-%dT%H:%M:%S')
    dt = dt + datetime.timedelta(hours=8)
    return dt.strftime('%Y-%m-%d %H:%M:%S') if with_seconds else dt.strftime('%Y-%m-%d %H:%M')


def export_rows(tasks):
    rows = []
    for t in tasks:
        dates = t.get('dates') or {}
        row = [t.get('level1', ''), t.get('level2', ''), t.get('task', ''), t.get('owner', ''), t.get('demo', '')]
        for k in DATE_KEYS:
            row.append('' if dates.get(k) is None else str(dates.get(k)))
        row.append('' if t.get('note') is None else str(t.get('note')))
        return_row = row
        rows.append(return_row)
    return rows


def cell(ws, r, c):
    return ws['cells'].get(col_name(c) + str(r), '')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--wbs-export', required=True)
    ap.add_argument('--daily-export', required=True)
    ap.add_argument('--template', required=True)
    ap.add_argument('--wbs-json', required=True)
    ap.add_argument('--daily-json', required=True)
    ap.add_argument('--out-json', required=True)
    ap.add_argument('--out-log', required=True)
    ap.add_argument('--profile', default='stage8', choices=['stage8', 'legacy'])
    a = ap.parse_args()

    doc = json.load(io.open(a.wbs_json, encoding='utf-8'))
    daily_ctx = json.load(io.open(a.daily_json, encoding='utf-8'))
    doc_at_daily = daily_ctx['doc']
    hist = daily_ctx['history']

    order_t, tpl = read_xlsx(a.template)
    order_w, wbs = read_xlsx(a.wbs_export)
    order_d, daily = read_xlsx(a.daily_export)
    results['sheets'] = {'template': order_t, 'wbs_export': order_w, 'daily_export': order_d}

    tpl_sheet = order_t[0]
    tpl_ws = tpl[tpl_sheet]
    wbs_ws = wbs[order_w[0]]

    # ---------------- 原 WBS 导出回归（不含 status，第 1/2 行与 A–K 保真）
    check('W1.wbs-export-single-sheet-name', len(order_w) == 1 and order_w[0] == tpl_sheet, {'sheets': order_w, 'template': order_t})
    # 第 1/2 行原文：逐格比对，排除 CH-6 有意新增的 M1（M1 由 C1/C3 单独断言）
    row12_t = dict((k, v) for k, v in tpl_ws['cells'].items() if split_ref(k)[1] <= 2 and k != 'M1')
    row12_w = dict((k, v) for k, v in wbs_ws['cells'].items() if split_ref(k)[1] <= 2 and k != 'M1')
    all12_t = dict((k, v) for k, v in tpl_ws['cells'].items() if split_ref(k)[1] <= 2)
    all12_w = dict((k, v) for k, v in wbs_ws['cells'].items() if split_ref(k)[1] <= 2)
    row12_extra = sorted([k for k in set(list(all12_t.keys()) + list(all12_w.keys())) if all12_t.get(k, '') != all12_w.get(k, '') and k != 'M1'])
    check('W2.row1-row2-verbatim-except-M1', row12_t == row12_w and not row12_extra, {'template': row12_t, 'export': row12_w, 'unexpected_changes_in_row1_2': row12_extra})
    check('W3.merges-preserved', tpl_ws['merges'] == wbs_ws['merges'], {'template': tpl_ws['merges'], 'export': wbs_ws['merges']})

    def col_widths(ws):
        w = {}
        for mn, mx, width in ws['cols']:
            for c in range(int(mn), int(mx) + 1):
                if c <= col_index('K') + 1:
                    w[c] = width
        return w
    cw_t, cw_w = col_widths(tpl_ws), col_widths(wbs_ws)
    check('W4.cols-A-K-per-column-widths-preserved', cw_t == cw_w, {'template_expanded': cw_t, 'export_expanded': cw_w, 'template_col_groups_for_A_K': [c for c in tpl_ws['cols'] if int(c[0]) <= 11], 'export_col_groups_for_A_K': [c for c in wbs_ws['cols'] if int(c[1]) <= 11]})

    rows_w = export_rows(doc['tasks'])
    n = len(rows_w)
    data_mismatch = []
    for i, row in enumerate(rows_w):
        for c, expected in enumerate(row):
            got = cell(wbs_ws, 3 + i, c)
            if got != expected:
                data_mismatch.append({'ref': col_name(c) + str(3 + i), 'expected': expected, 'got': got})
    check('W5.A3-K3+n-equals-doc-export-rows', not data_mismatch, {'rows': n, 'mismatch': data_mismatch[:5]})
    leftover = []
    for ref in wbs_ws['cells']:
        c, r = split_ref(ref)
        if r > 2 + n and c <= col_index('K') and wbs_ws['cells'][ref] not in ('', None):
            leftover.append({'ref': ref, 'value': wbs_ws['cells'][ref]})
    check('W6.no-leftover-data-below-new-last-row', not leftover, leftover[:5])
    status_hits = [{'ref': k, 'value': v} for k, v in wbs_ws['cells'].items() if v in STATUSES]
    check('W7.status-not-in-wbs-export', not status_hits, status_hits[:5])
    data_rows = len(set(split_ref(k)[1] for k in wbs_ws['cells'] if split_ref(k)[1] >= 3))
    dim = (wbs_ws['dim'] or '').replace('$', '')
    dim_ok = dim.startswith('A1:') and int(re.search(r'(\d+)$', dim).group(1)) >= 2 + n
    check('W8.data-row-count-matches-json', data_rows == n and dim_ok, {'data_rows': data_rows, 'json_tasks': n, 'dim': wbs_ws['dim'], 'template_dim': tpl_ws['dim']})
    non_ak = [k for k in wbs_ws['cells'] if split_ref(k)[1] >= 3 and split_ref(k)[0] > col_index('K')]
    check('W9.no-cells-beyond-K-in-data-area', set(non_ak) <= set(['M1']), non_ak[:5])

    # ---------------- CH-6：M1 导出日期标签
    m1 = wbs_ws['cells'].get('M1')
    exp_min = shanghai(daily_ctx.get('wbsExportAt') or daily_ctx.get('exportAt'), with_seconds=False)
    ok_fmt = bool(m1) and re.match(r'^导出日期：\d{4}-\d{2}-\d{2} \d{2}:\d{2}$', m1 or '')
    check('C1.CH6-M1-label-format', ok_fmt and m1 == '导出日期：' + exp_min, {'M1': m1, 'expected': '导出日期：' + exp_min, 'exportAt': (daily_ctx.get('wbsExportAt') or daily_ctx.get('exportAt'))})
    check('C2.CH6-template-M1-was-empty', 'M1' not in tpl_ws['cells'] or tpl_ws['cells'].get('M1') in (None, ''), {'template_M1': tpl_ws['cells'].get('M1')})
    diffs = []
    for k in set(list(tpl_ws['cells'].keys()) + list(wbs_ws['cells'].keys())):
        if tpl_ws['cells'].get(k, '') != wbs_ws['cells'].get(k, ''):
            diffs.append(k)
    allowed = set(['M1'])
    for i in range(n):
        for c in range(0, col_index('K') + 1):
            allowed.add(col_name(c) + str(3 + i))
    extra = sorted([d for d in diffs if d not in allowed])
    check('C3.CH6-only-M1-plus-data-area-changed', not extra, {'changed': sorted(diffs), 'unexpected': extra})

    # ---------------- CH-5：日报导出
    check('C4.CH5-two-sheets-names-order', order_d == ['阻塞与延期', '当日变更'], {'sheets': order_d})
    blk = daily.get('阻塞与延期', {'cells': {}, 'cols': [], 'merges': []})
    chg = daily.get('当日变更', {'cells': {}, 'cols': [], 'merges': []})
    blk_rows = sorted(set(split_ref(k)[1] for k in blk['cells']))
    chg_rows = sorted(set(split_ref(k)[1] for k in chg['cells']))
    ncols_blk = max(split_ref(k)[0] for k in blk['cells']) + 1
    ncols_chg = max(split_ref(k)[0] for k in chg['cells']) + 1
    hdr_blk = [cell(blk, 1, c) for c in range(ncols_blk)]
    hdr_chg = [cell(chg, 1, c) for c in range(ncols_chg)]
    check('C5.CH5-blocked-header-12-cols', hdr_blk == BLOCKED_HEADER, hdr_blk)
    check('C6.CH5-change-header-10-cols', hdr_chg == CHANGE_HEADER, hdr_chg)

    blocked_tasks = [t for t in doc_at_daily['tasks'] if t.get('status') in ('被阻塞', '已延期')]
    blocked_expect = [[t.get('level1', ''), t.get('level2', ''), t.get('task', ''), t.get('owner', ''), t.get('demo', '')] +
                      ['' if (t.get('dates') or {}).get(k) is None else str((t.get('dates') or {}).get(k)) for k in DATE_KEYS] +
                      [str(t.get('note') or ''), t.get('status')] for t in blocked_tasks]
    got_blocked = [[cell(blk, r, c) for c in range(len(BLOCKED_HEADER))] for r in blk_rows[1:]]
    check('C7.CH5-blocked-rows-only-blocked-status', got_blocked == blocked_expect and len(got_blocked) == len(blocked_tasks), {'expected': blocked_expect, 'got': got_blocked, 'rows': blk_rows})
    other_status = [v for v in blk['cells'].values() if v in STATUSES and v not in ('被阻塞', '已延期')]
    check('C8.CH5-blocked-sheet-no-other-status', not other_status, other_status)

    recs = hist['records']
    expect_chg = [[r.get('task_id', ''), r.get('level1', ''), r.get('level2', ''), r.get('task', ''), r.get('owner', ''),
                   FIELD_LABELS.get(r.get('field'), r.get('field')), '' if r.get('old') is None else str(r.get('old')),
                   '' if r.get('new') is None else str(r.get('new')), shanghai(r.get('at')), r.get('identity', '')] for r in recs]
    got_chg = [[cell(chg, r, c) for c in range(len(CHANGE_HEADER))] for r in chg_rows[1:]]
    check('C9.CH5-change-rows-match-api-history', got_chg == expect_chg and len(got_chg) == len(recs), {'expected': expect_chg, 'got': got_chg, 'history_count': hist['count']})
    check('C10.CH5-change-time-format-shanghai', all(re.match(r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$', row[8]) for row in got_chg), [row[8] for row in got_chg][:3])
    if a.profile == 'legacy':
        # 旧格式 audit.log（无 old/new）兼容：日报不报错、明细按「无明细」跳过
        check('L1.legacy-profile-audit-no-detail-skipped', len(recs) == 0 and len(got_chg) == 0 and len(chg_rows) == 1,
              {'history_count': hist['count'], 'change_rows': chg_rows, 'got': got_chg})
        results['summary'] = {'pass': _pass[0], 'fail': _fail[0]}
        io.open(a.out_json, 'w', encoding='utf-8').write(json.dumps(results, ensure_ascii=False, indent=2))
        io.open(a.out_log, 'w', encoding='utf-8').write('\n'.join(
            ('PASS  ' if c['ok'] else 'FAIL  ') + c['id'] + (('  :: ' + json.dumps(c['detail'], ensure_ascii=False)) if c['detail'] is not None else '')
            for c in results['checks']) + '\n\nPASS=%d FAIL=%d\n' % (_pass[0], _fail[0]))
        print('\n==== PASS=%d FAIL=%d ====' % (_pass[0], _fail[0]))
        return 1 if _fail[0] else 0
    pool = [row for row in got_chg if row[5] == '人员池']
    check('C11.CH7-daily-sheet-identity-added-row', len(pool) == 1 and pool[0][3] == '新增人员 验证甲' and pool[0][6] == '' and pool[0][7] == '验证甲' and pool[0][9] == '项目负责人' and pool[0][0] == '', pool)
    multi = dict((row[5], row) for row in got_chg if row[0] == 'T001')
    check('C12.CH5-multifield-split-old-new', multi.get('进展说明', [None] * 10)[6:8] == ['', '独立复验：多字段保存 2026-10-14'] and
          multi.get('状态', [None] * 10)[6:8] == ['未开始', '进行中'] and multi.get('开发', [None] * 10)[6:8] == ['', '2026-10-15'], multi)
    blocked_in_change = [row for row in got_chg if row[5] == '状态' and row[7] in ('已延期', '被阻塞')]
    check('C13.CH5-status-changes-for-blocked-sheet-visible', len(blocked_in_change) >= 2, blocked_in_change)

    results['summary'] = {'pass': _pass[0], 'fail': _fail[0]}
    io.open(a.out_json, 'w', encoding='utf-8').write(json.dumps(results, ensure_ascii=False, indent=2))
    io.open(a.out_log, 'w', encoding='utf-8').write('\n'.join(
        ('PASS  ' if c['ok'] else 'FAIL  ') + c['id'] + (('  :: ' + json.dumps(c['detail'], ensure_ascii=False)) if c['detail'] is not None else '')
        for c in results['checks']) + '\n\nPASS=%d FAIL=%d\n' % (_pass[0], _fail[0]))
    print('\n==== PASS=%d FAIL=%d ====' % (_pass[0], _fail[0]))
    return 1 if _fail[0] else 0


if __name__ == '__main__':
    sys.exit(main())
