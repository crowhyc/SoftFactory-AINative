#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""YUNZ-31 / 变更包 #4：WBS 与日报导出产物的独立读回校验（不依赖 openpyxl，直接解析 xlsx 的 zip/XML 部件）。

用法：
  xlsx_readback.py wbs  <导出文件> <模板文件> <导出时的 wbs JSON> <数据行数>
  xlsx_readback.py daily <导出文件> <导出时的 /api/daily JSON>
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
RNS = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
PASS = [0]
FAIL = [0]
PHASES = ['未开始', '已开始', '已完成', '延期', '阻塞']
PHASE_HEADERS = ['设计进度', '开发进度', '测试进度', '产品进度', '演示准备进度']
PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep']
PHASE_HEX = {'未开始': '9E9E9E', '已开始': '2F80ED', '已完成': '27AE60', '延期': 'E74C3C', '阻塞': 'FFD400'}
A2K = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']


def ok(msg, extra=''):
    PASS[0] += 1
    print('PASS  ' + msg + ('  :: ' + extra if extra else ''))


def bad(msg, detail=''):
    FAIL[0] += 1
    print('FAIL  ' + msg + ('  -> ' + detail if detail else ''))


def col_index(letters):
    value = 0
    for ch in letters:
        value = value * 26 + (ord(ch) - 64)
    return value - 1


def col_letters(index):
    name = ''
    n = index
    while n >= 0:
        name = chr(65 + (n % 26)) + name
        n = n // 26 - 1
    return name


class Book(object):
    def __init__(self, path):
        self.zf = zipfile.ZipFile(path)
        self.shared = []
        if 'xl/sharedStrings.xml' in self.zf.namelist():
            root = ET.fromstring(self.zf.read('xl/sharedStrings.xml'))
            for si in root.findall(NS + 'si'):
                self.shared.append(''.join(t.text or '' for t in si.iter(NS + 't')))
        rels = {}
        root = ET.fromstring(self.zf.read('xl/_rels/workbook.xml.rels'))
        for rel in root:
            rels[rel.get('Id')] = rel.get('Target')
        self.sheets = []
        wb = ET.fromstring(self.zf.read('xl/workbook.xml'))
        for sheet in wb.find(NS + 'sheets'):
            target = rels.get(sheet.get(RNS + 'id'), '')
            self.sheets.append((sheet.get('name'), 'xl/' + target.lstrip('/')))

    def fills(self):
        root = ET.fromstring(self.zf.read('xl/styles.xml'))
        fills = root.find(NS + 'fills')
        out = []
        for fill in fills.findall(NS + 'fill'):
            pattern = fill.find(NS + 'patternFill')
            rgb = None
            if pattern is not None:
                fg = pattern.find(NS + 'fgColor')
                if fg is not None:
                    rgb = fg.get('rgb')
            out.append((pattern.get('patternType') if pattern is not None else None, rgb))
        xfs = root.find(NS + 'cellXfs')
        xf_fill = []
        for xf in xfs.findall(NS + 'xf'):
            xf_fill.append(int(xf.get('fillId') or 0))
        return out, xf_fill

    def cells(self, sheet_path):
        root = ET.fromstring(self.zf.read(sheet_path))
        cells = {}
        for c in root.iter(NS + 'c'):
            ref = c.get('r')
            t = c.get('t')
            style = int(c.get('s') or 0)
            v = c.find(NS + 'v')
            value = v.text if (v is not None and v.text is not None) else ''
            if t == 's' and v is not None:
                value = self.shared[int(v.text)]
            cells[ref] = {'value': value, 'style': style}
        return cells

    def raw(self, sheet_path):
        return self.zf.read(sheet_path).decode('utf-8')

    def cols(self, sheet_path):
        xml = self.raw(sheet_path)
        block = re.search(r'<cols>([\s\S]*?)</cols>', xml)
        widths = {}
        if not block:
            return widths
        for m in re.finditer(r'<col ([^>]*?)/?>', block.group(1)):
            attr = m.group(1)
            mn = int(re.search(r'min="(\d+)"', attr).group(1))
            mx = int(re.search(r'max="(\d+)"', attr).group(1))
            width = re.search(r'width="([\d.]+)"', attr)
            for i in range(mn, min(mx, 16384) + 1):
                widths[i - 1] = width.group(1) if width else None
        return widths


def row_values(cells, row_number, count):
    return [cells.get(col_letters(i) + str(row_number), {}).get('value', '') for i in range(count)]


def check_wbs(export, template, snapshot, rows_expected):
    book = Book(export)
    tpl = Book(template)
    doc = json.load(open(snapshot, encoding='utf-8'))
    tasks = doc['tasks']
    name, sheet = book.sheets[0]
    cells = book.cells(sheet)
    tpl_cells = tpl.cells(tpl.sheets[0][1])
    tpl_raw = tpl.raw(tpl.sheets[0][1])
    raw = book.raw(sheet)

    if len(book.sheets) == 1 and len(tasks) == rows_expected:
        ok('WBS 导出为单工作表', name)
    else:
        bad('WBS 工作表/行数异常', 'sheets=%s tasks=%s' % (len(book.sheets), len(tasks)))

    # 第 1/2 行原文（A–K）
    r1 = row_values(cells, 1, 11)
    t1 = row_values(tpl_cells, 1, 11)
    r2 = row_values(cells, 2, 11)
    t2 = row_values(tpl_cells, 2, 11)
    if r1 == t1 and r2 == t2 and r2[3] == '负责人' and r2[4] == '是否演示范围' and r2[10] == '进展说明':
        ok('WBS 第 1/2 行 A–K 与源模板逐字一致（含 E 是否演示范围）', 'D2=%s / E2=%s / K2=%s' % (r2[3], r2[4], r2[10]))
    else:
        bad('WBS 第 1/2 行 A–K 不一致', '导出 %s vs 模板 %s' % (r2, t2))

    head = row_values(cells, 2, 16)
    if head[11:16] == PHASE_HEADERS:
        ok('WBS 在 K 之后连续追加 5 个进度列表头', ' / '.join(head[11:16]))
    else:
        bad('WBS 五进度列表头异常', str(head[11:16]))

    # A–K 数据区逐字段与 JSON 一致
    mismatch = []
    for i, task in enumerate(tasks):
        row_number = 3 + i
        expect = [task['level1'], task['level2'], task['task'], task['owner'], task['demo']] + \
                 [task['dates'].get(k, '') for k in PHASE_KEYS] + [task.get('note', '')]
        actual = row_values(cells, row_number, 11)
        if actual != expect:
            mismatch.append((task['id'], actual, expect))
    if not mismatch:
        ok('WBS A–K 数据区逐字段与 JSON 一致（含 demo 原值、日期原文）', '%d 行' % len(tasks))
    else:
        bad('WBS A–K 数据区与 JSON 不一致', str(mismatch[:2]))

    # 阶段进度列：文字 + 颜色填充
    fills, xf_fill = book.fills()
    fill_index = {}
    for idx, (pattern, rgb) in enumerate(fills):
        if pattern == 'solid' and rgb in ['FF' + h for h in PHASE_HEX.values()]:
            fill_index[rgb] = idx
    text_bad = []
    color_bad = []
    for i, task in enumerate(tasks):
        row_number = 3 + i
        for j, key in enumerate(PHASE_KEYS):
            ref = col_letters(11 + j) + str(row_number)
            cell = cells.get(ref)
            value = task['phases'][key]
            if not cell or cell['value'] != value:
                text_bad.append((ref, cell and cell['value'], value))
                continue
            want_rgb = 'FF' + PHASE_HEX[value]
            want_fill = fill_index.get(want_rgb)
            got_fill = xf_fill[cell['style']] if cell['style'] < len(xf_fill) else None
            if want_fill is None or got_fill != want_fill:
                color_bad.append((ref, value, want_rgb, got_fill, want_fill))
    if not text_bad:
        ok('WBS 五进度列数据区状态文字与 JSON 一致', '%d×5 单元格' % len(tasks))
    else:
        bad('WBS 五进度列状态文字不一致', str(text_bad[:3]))
    if not color_bad and fill_index:
        ok('WBS 五进度列颜色填充存在且与五色映射一致（灰/蓝/绿/红/黄）',
           ' / '.join('%s=%s' % (k, v) for k, v in sorted(fill_index.items())))
    else:
        bad('WBS 五进度列颜色填充缺失或不一致', str(color_bad[:3]))

    # 导出日期标签右移到 Q1；M1 已回到进度列表头基线（模板 M1 原为空）
    label = cells.get('Q1', {}).get('value', '')
    if re.match(r'^导出日期：\d{4}-\d{2}-\d{2} \d{2}:\d{2}$', str(label)) and \
            cells.get('M1', {}).get('value', '') == '' and cells.get('N1', {}).get('value', '') == '':
        ok('原「导出日期」标签右移到 Q1（最后一个排序列之后），内容与格式不变、M1 不再是标签', label)
    else:
        bad('导出日期标签位置/内容异常', 'Q1=%r M1=%r' % (label, cells.get('M1', {}).get('value')))

    # 合并单元格 A1:C1 与列宽
    merge = re.search(r'<mergeCells[\s\S]*?</mergeCells>', raw)
    if merge and 'ref="A1:C1"' in merge.group(0):
        ok('WBS 导出保留 A1:C1 合并', merge.group(0))
    else:
        bad('WBS 导出 A1:C1 合并缺失', merge.group(0) if merge else 'NONE')
    tpl_cols = tpl.cols(tpl.sheets[0][1])
    out_cols = book.cols(sheet)
    diff = [A2K[i] + ':' + str(tpl_cols.get(i)) + '->' + str(out_cols.get(i)) for i in range(11) if tpl_cols.get(i) != out_cols.get(i)]
    if not diff:
        ok('WBS 导出 A–K 列宽与模板逐列一致', 'K=' + str(out_cols.get(10)))
    else:
        bad('WBS 导出 A–K 列宽不一致', '; '.join(diff))

    # 旧全局 status 不进导出
    data_flat = json.dumps([row_values(cells, 3 + i, 16) for i in range(len(tasks))], ensure_ascii=False)
    if 'status' not in data_flat and all(s not in data_flat for s in ['进行中', '已延期', '被阻塞']):
        ok('WBS 导出不含旧全局 status 字面量与取值', '数据区 %d 行 × 16 列' % len(tasks))
    else:
        bad('WBS 导出疑似含 status', data_flat[:200])

    # 模板非数据区单元格（除 L–P/Q1 外）保持原样
    return PASS[0], FAIL[0]


def check_daily(export, snapshot):
    book = Book(export)
    payload = json.load(open(snapshot, encoding='utf-8'))
    names = [s[0] for s in book.sheets]
    if names == ['今日摘要', '阻塞与延期', '当日变更']:
        ok('日报为单 workbook 三 sheet', ' / '.join(names))
    else:
        bad('日报 sheet 名称/数量异常', str(names))

    summary_cells = book.cells(dict(book.sheets)['今日摘要'])
    header = row_values(summary_cells, 1, 9)
    if header == ['微信文本行', '重要度', '结论', '一级', '二级', '任务项', '负责人', '时间', '依据']:
        ok('「今日摘要」分列结构齐备', ' / '.join(header))
    else:
        bad('「今日摘要」分列结构异常', str(header))

    lines = []
    row = 2
    while summary_cells.get('A' + str(row)) is not None:
        lines.append(row_values(summary_cells, row, 9))
        row += 1
    expected_lines = [item['line'] for item in payload['summary']]
    if [r[0] for r in lines] == expected_lines:
        ok('「今日摘要」A 列 = /api/daily 的微信检索式文本行（逐字）', '共 %d 行' % len(lines))
    else:
        bad('「今日摘要」文本行与 /api/daily 不一致', str([r[0] for r in lines])[:200])
    if all(re.match(r'^【[^】]+】.+ / .+ / .+ @.+：.+。$|^今日无阻塞、延期或变更。$', r[0]) for r in lines):
        ok('「今日摘要」行格式逐字符合【重要度】一级 / 二级 / 任务项 @负责人：结论。', lines[0][0] if lines else '')
    else:
        bad('「今日摘要」行格式不符', str([r[0] for r in lines])[:200])
    if [r[1] for r in lines] == [item['importance'] for item in payload['summary']] and \
            [r[2] for r in lines] == [item['conclusion'] for item in payload['summary']]:
        ok('「今日摘要」重要度/结论列与 /api/daily 一致（含五类前缀与结论模板）', str([r[:3] for r in lines[:3]])[:200])
    else:
        bad('「今日摘要」重要度/结论列不一致', str([r[:3] for r in lines[:3]])[:200])

    rank = {'延期·高风险': 1, '阻塞·高风险': 2, '完成': 4, '普通': 5}
    ranks = []
    for r in lines:
        if r[1] == '延期·高风险' and '到期未更新' in r[2]:
            ranks.append(3)
        else:
            ranks.append(rank.get(r[1], 5))
    if ranks == sorted(ranks):
        ok('「今日摘要」按重要度排序：延期 > 阻塞 > 到期未更新判定延期 > 完成 > 普通变更', str(ranks))
    else:
        bad('「今日摘要」排序异常', str(ranks))
    multi = {}
    for r in lines:
        multi[r[4]] = multi.get(r[4], 0) + 1
    if any(v > 1 for v in multi.values()):
        ok('「今日摘要」同一任务多事件多行', str([k for k, v in multi.items() if v > 1]))
    else:
        bad('「今日摘要」未见一任务多行', str(multi))

    blocked_cells = book.cells(dict(book.sheets)['阻塞与延期'])
    bhead = row_values(blocked_cells, 1, 16)
    if bhead[:11] == ['一级', '二级', '任务项', '负责人', '是否演示范围', '设计', '开发', '测试', '产品', '演示准备', '进展说明'] and bhead[11:16] == PHASE_HEADERS:
        ok('「阻塞与延期」保留 A–K 与 是否演示范围，并追加五个阶段进度列', ' / '.join(bhead))
    else:
        bad('「阻塞与延期」表头异常', str(bhead))
    brows = []
    rn = 2
    while blocked_cells.get('A' + str(rn)) is not None:
        brows.append(row_values(blocked_cells, rn, 16))
        rn += 1
    expected = payload['blocked']
    if len(brows) == len(expected) and all(brows[i][2] == expected[i]['task'] for i in range(len(brows))):
        ok('「阻塞与延期」行集与顺序 = 任一阶段命中 延期/阻塞（阻塞行排前）', '%d 行' % len(brows))
    else:
        bad('「阻塞与延期」行集/顺序不一致', '导出 %s vs 期望 %s' % ([r[2] for r in brows], [t['task'] for t in expected]))
    groups = [0 if '阻塞' in r[11:16] else 1 for r in brows]
    if groups == sorted(groups):
        ok('「阻塞与延期」阻塞行排前', str(groups))
    else:
        bad('「阻塞与延期」未按阻塞优先排序', str(groups))

    change_cells = book.cells(dict(book.sheets)['当日变更'])
    chead = row_values(change_cells, 1, 9)
    if chead == ['一级', '二级', '任务项', '负责人', '改动字段', '旧值', '新值', '时间', '操作身份']:
        ok('「当日变更」字段级明细列齐备', ' / '.join(chead))
    else:
        bad('「当日变更」表头异常', str(chead))
    crows = []
    rn = 2
    while change_cells.get('A' + str(rn)) is not None:
        crows.append(row_values(change_cells, rn, 9))
        rn += 1
    pool = [r for r in crows if r[4] == '人员池' and r[6] == '赵新']
    if pool and pool[0][5] == '' and pool[0][8] == '项目负责人':
        ok('「当日变更」含 CH-7 新增人员审计行（任务项=新增人员 赵新 / 改动字段=人员池 / 旧值空 / 新值姓名 / 操作身份照实）',
           str(pool[0]))
    else:
        bad('「当日变更」缺少 CH-7 新增人员行', str(crows[-2:]))
    if len(crows) == len(payload['changes']):
        ok('「当日变更」行数 = /api/daily 明细数', '%d 行' % len(crows))
    else:
        bad('「当日变更」行数不一致', '导出 %d vs API %d' % (len(crows), len(payload['changes'])))
    if all('status' not in json.dumps(r, ensure_ascii=False) for r in crows) and not any(r[4] == '状态' for r in crows):
        ok('「当日变更」不引用旧全局 status', '改动字段集合 %s' % sorted(set(r[4] for r in crows)))
    else:
        bad('「当日变更」疑似引用旧 status', str([r[4] for r in crows]))
    return PASS[0], FAIL[0]


if __name__ == '__main__':
    mode = sys.argv[1]
    if mode == 'wbs':
        check_wbs(sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5]))
    else:
        check_daily(sys.argv[2], sys.argv[3])
    print('---')
    print('PASS=%d FAIL=%d' % (PASS[0], FAIL[0]))
    sys.exit(0 if FAIL[0] == 0 else 1)
