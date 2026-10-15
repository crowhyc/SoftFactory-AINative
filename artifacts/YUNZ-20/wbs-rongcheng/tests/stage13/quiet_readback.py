#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""YUNZ-33 / 变更包 #5：无事件兜底日报导出产物的独立读回校验（直接解析 xlsx zip/XML）。

用法：quiet_readback.py <导出文件> <导出时的 /api/daily JSON>
"""
import io
import json
import re
import sys
import zipfile

if sys.stdout.encoding is None or sys.stdout.encoding.lower() not in ('utf-8', 'utf8'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PASS = [0]
FAIL = [0]
REMOVED = ['当日变更', '改动字段', '操作身份', '重要度', '依据']


def ok(msg, extra=''):
    PASS[0] += 1
    print('PASS  ' + msg + ('  :: ' + extra if extra else ''))


def bad(msg, detail=''):
    FAIL[0] += 1
    print('FAIL  ' + msg + ('  -> ' + detail if detail else ''))


zf = zipfile.ZipFile(sys.argv[1])
payload = json.load(open(sys.argv[2], encoding='utf-8'))
workbook = zf.read('xl/workbook.xml').decode('utf-8')
names = re.findall(r'<sheet name="([^"]+)"', workbook)
expected = ['今日摘要', '阻塞与延期']
if names == expected:
    ok('无事件兜底导出仍为两 sheet（今日摘要 / 阻塞与延期）', ' / '.join(names))
else:
    bad('无事件兜底导出 sheet 异常', str(names))

sheet1 = zf.read('xl/worksheets/sheet1.xml').decode('utf-8')
ref = re.search(r'<dimension ref="([^"]+)"', sheet1)
values = re.findall(r'<c r="A(\d+)"[^>]*><v>([^<]*)</v></c>', sheet1)
fallback = '今日无阻塞、延期或变更。'
api_lines = [item['line'] for item in payload['summary']]
if ref and ref.group(1) == 'A1:A2' and api_lines == [fallback]:
    ok('无事件兜底：/api/daily 与导出 dimension 口径一致（A1:A2）', ref.group(1))
else:
    bad('无事件兜底 dimension/API 不一致', '%s vs %s' % (ref.group(1) if ref else None, api_lines))
if [v for _, v in values] == ['微信文本行', fallback] and not re.search(r'<c r="B\d+"', sheet1):
    ok('无事件兜底：导出 A 列 = 表头 + 一行兜底文案，B 列及之后无任何单元格', fallback)
else:
    bad('无事件兜底 A 列内容异常', str(values))
hits = [t for t in REMOVED if t in sheet1]
if not hits:
    ok('无事件兜底导出无旧表头字样（当日变更 / 辅助分列已移除）', 'sheet1.xml')
else:
    bad('无事件兜底导出残留旧表头', str(hits))

print('---')
print('PASS=%d FAIL=%d' % (PASS[0], FAIL[0]))
sys.exit(0 if FAIL[0] == 0 else 1)
