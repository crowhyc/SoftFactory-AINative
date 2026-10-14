#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""WC-001 导出保真独立校验（不依赖 openpyxl，直接解析 xlsx 的 zip/XML 部件）。
用法：export_verify.py <导出文件> <模板文件> <JSON 文件> <期望数据行数>
"""
import io
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

if sys.stdout.encoding is None or sys.stdout.encoding.lower() not in ('utf-8', 'utf8'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
PASS = [0]
FAIL = [0]
WARN = [0]
COLS = [chr(ord('A') + i) for i in range(11)]  # A..K
STATUS_VALUES = ['未开始', '进行中', '已完成', '已延期', '被阻塞']


def ok(msg, extra=''):
    PASS[0] += 1
    print('PASS  ' + msg + ('  :: ' + extra if extra else ''))


def bad(msg, detail=''):
    FAIL[0] += 1
    print('FAIL  ' + msg + '  -> ' + detail)


def warn(msg, detail=''):
    WARN[0] += 1
    print('WARN  ' + msg + ('  -> ' + detail if detail else ''))


def split(ref):
    m = re.match(r'([A-Z]+)(\d+)$', ref)
    return m.group(1), int(m.group(2))


def col_index(letters):
    value = 0
    for ch in letters:
        value = value * 26 + (ord(ch) - 64)
    return value - 1


def read_sheet(path):
    zf = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in zf.namelist():
        root = ET.fromstring(zf.read('xl/sharedStrings.xml'))
        for si in root.findall(NS + 'si'):
            shared.append(''.join(t.text or '' for t in si.iter(NS + 't')))
    raw = zf.read('xl/worksheets/sheet1.xml').decode('utf-8')
    sheet = ET.fromstring(raw)
    cells = {}
    for row in sheet.find(NS + 'sheetData'):
        for c in row:
            ref = c.attrib['r']
            ctype = c.attrib.get('t')
            value_node = c.find(NS + 'v')
            inline = c.find(NS + 'is')
            if inline is not None:
                value = ''.join(t.text or '' for t in inline.iter(NS + 't'))
            elif value_node is None or value_node.text is None:
                value = ''
            elif ctype == 's':
                value = shared[int(value_node.text)]
            else:
                value = value_node.text
            cells[ref] = {'t': ctype, 'v': value, 's': c.attrib.get('s')}
    merges = []
    node = sheet.find(NS + 'mergeCells')
    if node is not None:
        merges = [m.attrib['ref'] for m in node]
    dimension = sheet.find(NS + 'dimension')
    widths = []
    for c in sheet.iter(NS + 'col'):
        lo = int(c.attrib.get('min', '0'))
        hi = int(c.attrib.get('max', '0'))
        for _ in range(max(0, hi - lo + 1)):
            widths.append(c.attrib.get('width'))
    widths = widths[:64]
    return {'cells': cells, 'merges': merges, 'widths': widths, 'raw': raw,
            'dimension': dimension.attrib.get('ref') if dimension is not None else None,
            'styles_len': len(zf.read('xl/styles.xml')) if 'xl/styles.xml' in zf.namelist() else 0}


def row_values(cells, row_no, letters):
    out = []
    for letter in letters:
        cell = cells.get(letter + str(row_no))
        out.append(cell['v'] if cell else '')
    return out


def main():
    exported, template, json_path, expected_rows = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
    doc = json.load(open(json_path, encoding='utf-8'))
    tasks = doc['tasks']
    out = read_sheet(exported)
    tmpl = read_sheet(template)

    # 1) 第 1/2 行逐字一致
    for row_no, letters in ((1, ['A', 'D', 'E', 'F', 'G', 'H']), (2, ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'])):
        for letter in letters:
            ref = letter + str(row_no)
            expect = tmpl['cells'].get(ref, {}).get('v', '')
            got = out['cells'].get(ref, {}).get('v', '')
            if expect == got and expect != '':
                ok('%s 逐字一致: %r' % (ref, got))
            else:
                bad('%s 与模板不一致' % ref, '期望 %r 实际 %r' % (expect, got))

    if out['merges'] == tmpl['merges']:
        ok('合并单元格保持原样', str(out['merges']))
    else:
        bad('合并单元格变化', '模板 %s 导出 %s' % (tmpl['merges'], out['merges']))

    # 列宽（缺陷 D-1 回归）：导出必须含 <cols>，且 A–K 逐列与源模板一致；K 进展说明列 47.2592592592593（≈47.26）
    if '<cols>' in out['raw']:
        ok('导出文件含 <cols> 列宽定义', '页面导出路径修复前无 <cols>（缺陷 D-1），本条为回归断言')
    else:
        bad('导出文件缺少 <cols>（列宽丢失，缺陷 D-1）', 'sheet1.xml 无 <cols> 元素')
    tpl_w = {i: tmpl['widths'][i] for i in range(11) if i < len(tmpl['widths'])}
    out_w = {i: out['widths'][i] for i in range(11) if i < len(out['widths'])}
    width_diff = [i for i in range(11) if tpl_w.get(i) != out_w.get(i)]
    if not width_diff:
        ok('列宽设置保持原样（A–K 11 列宽逐列一致，含 K 进展说明列 %s ≈ 47.26）' % out_w.get(10),
           'A–K=%s' % ','.join(str(out_w.get(i)) for i in range(11)))
    else:
        bad('列宽变化', '列索引 %s: 模板 %s 导出 %s' % (width_diff, [tpl_w.get(i) for i in width_diff], [out_w.get(i) for i in width_diff]))
    k_value = out_w.get(10)
    if k_value is not None and abs(float(k_value) - 47.2592592592593) < 1e-9:
        ok('K 进展说明列宽 = 47.2592592592593（与源模板一致）',
           '复现：node tests/exportcheck.mjs && python3 tests/export_verify.py "<导出文件>" public/template.xlsx tests/.tmp/wbs-from-api.json 36')
    else:
        bad('K 进展说明列宽异常', '实际 %s，期望 47.2592592592593' % k_value)

    # 2) 数据行数
    data_rows = []
    row_no = 3
    while row_no <= 200:
        values = row_values(out['cells'], row_no, COLS)
        if any(v != '' for v in values):
            data_rows.append((row_no, values))
        elif row_no > expected_rows + 5:
            break
        row_no += 1
    if len(data_rows) == expected_rows:
        last = data_rows[-1][0] if data_rows else 2
        ok('数据行数与 JSON 一致', '%d 行（第 3 行起，末行 %d）' % (len(data_rows), last))
    else:
        bad('数据行数不一致', '期望 %d 实际 %d' % (expected_rows, len(data_rows)))

    # 3) A–K 逐行逐列与 JSON 对账
    keys = ['design', 'dev', 'test', 'product', 'demo_prep']
    compare_ok = True
    for index, (row_no, values) in enumerate(data_rows):
        if index >= len(tasks):
            compare_ok = False
            bad('导出行多于 JSON', '第 %d 行' % row_no)
            break
        task = tasks[index]
        expect = [task.get('level1', ''), task.get('level2', ''), task.get('task', ''), task.get('owner', ''),
                  task.get('demo', '')] + [task.get('dates', {}).get(k, '') for k in keys] + [task.get('note', '')]
        if values != expect:
            compare_ok = False
            bad('第 %d 行（%s）不一致' % (row_no, task.get('id')), '期望 %r 实际 %r' % (expect, values))
    if compare_ok:
        ok('A–K 共 11 列逐行与 JSON 对账一致', '%d 行 x 11 列' % len(data_rows))

    # 4) 不含 status
    if 'status' not in out['raw']:
        ok("导出文件不含字面量 'status'")
    else:
        bad("导出文件出现 'status'", 'sheet1.xml 命中')
    leaked = []
    for row_no, values in data_rows:
        for letter, value in zip(COLS, values):
            if any(sv in value for sv in STATUS_VALUES):
                leaked.append(letter + str(row_no) + '=' + value)
    if not leaked:
        ok('数据区不含任何 status 取值', '（第 1 行 D1:H1 的模板原文颜色说明属于原表内容，未改动）')
    else:
        bad('数据区混入 status 取值', '; '.join(leaked))
    if any('status' in t for t in tasks):
        ok('JSON 存在 status 字段（仅网页使用），未进入导出', '示例 %s' % tasks[0].get('status'))

    # 5) 数据区之外的非数据单元格保持原样
    changed = []
    for ref, cell in tmpl['cells'].items():
        if ref == 'M1':
            continue  # CH-6：M1 是本次唯一有意新增的单元格，单独断言
        letter, row = split(ref)
        inside = 3 <= row <= 38 and col_index(letter) <= 10
        if inside:
            continue
        got = out['cells'].get(ref)
        if got is None:
            if cell['v'] not in ('', None):
                changed.append(ref + ' 丢失(%r)' % cell['v'])
        elif got['v'] != cell['v']:
            changed.append('%s 模板%r 导出%r' % (ref, cell['v'], got['v']))
    if not changed:
        ok('数据区（A3:K38）之外的非数据单元格内容保持原样', '%d 个模板单元格核对' % len(tmpl['cells']))
    else:
        bad('非数据单元格被改动', '; '.join(changed[:6]))

    # 5b) CH-6：导出日期标签（仅新增 M1，Asia/Shanghai，YYYY-MM-DD HH:mm）
    m1 = out['cells'].get('M1', {}).get('v', '')
    if re.match(r'^导出日期：\d{4}-\d{2}-\d{2} \d{2}:\d{2}$', m1 or ''):
        ok('M1 写入导出日期标签（Asia/Shanghai，精确到分钟）', repr(m1))
    else:
        bad('M1 导出日期标签缺失或格式不符', '实际 %r' % m1)
    tmpl_m1 = tmpl['cells'].get('M1', {}).get('v', '')
    if tmpl_m1 == '':
        ok('模板 M1 原为空（导出为纯新增，非改写原文）', '模板 M1=%r' % tmpl_m1)
    else:
        bad('模板 M1 非空，无法判定为纯新增', '模板 M1=%r' % tmpl_m1)
    row1_diff = sorted(ref for ref in out['cells'] if re.match(r'^[A-Z]+1$', ref)
                       and out['cells'][ref].get('v', '') != tmpl['cells'].get(ref, {}).get('v', ''))
    if row1_diff == ['M1']:
        ok('第 1 行仅 M1 一处变化（A–K 原文与其余单元格不变）', str(row1_diff))
    else:
        bad('第 1 行变化单元格异常', '实际变化 %s' % row1_diff)

    # 6) 样式部件说明（SheetJS 0.18.5 社区版不解析/不写出单元格样式）
    if out['styles_len'] < tmpl['styles_len']:
        warn('导出文件的单元格样式表被重写（社区版 SheetJS 限制）',
             'styles.xml %d -> %d 字节；文本/合并/列宽/非数据单元格值不受影响，验收条件 8 不涉及单元格样式' % (tmpl['styles_len'], out['styles_len']))
    else:
        ok('导出文件样式表未被裁剪', 'styles.xml %d 字节' % out['styles_len'])

    print('---')
    print('PASS=%d FAIL=%d WARN=%d' % (PASS[0], FAIL[0], WARN[0]))
    sys.exit(0 if FAIL[0] == 0 else 1)


if __name__ == '__main__':
    main()
