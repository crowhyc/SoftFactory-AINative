# -*- coding: utf-8 -*-
"""YUNZ-20 Stage2 独立验证 —— 导出保真读回（仅 Python 标准库 zipfile + xml.etree）。
比对导出 xlsx 与源模板 template.xlsx / 当前 JSON（验收条件 2 与 8）。"""
import json, re, sys, zipfile, hashlib
from xml.etree import ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
SRC = '/opt/wbs-rongcheng-staging/WC-001/src/public/template.xlsx'
EXP = sys.argv[1] if len(sys.argv) > 1 else 'dom-out/exported.xlsx'
JSN = sys.argv[2] if len(sys.argv) > 2 else 'dom-out/export-json-snapshot.json'

fails = []
def chk(cid, name, cond, detail):
    tag = 'PASS' if cond else 'FAIL'
    if not cond:
        fails.append(cid)
    print('[%s] %s %s :: %s' % (tag, cid, name, detail))

def load(p):
    z = zipfile.ZipFile(p)
    ss = []
    if 'xl/sharedStrings.xml' in z.namelist():
        root = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in root.findall(NS + 'si'):
            ss.append(''.join(t.text or '' for t in si.iter(NS + 't')))
    sheets = sorted(n for n in z.namelist() if re.match(r'xl/worksheets/sheet\d+\.xml$', n))
    root = ET.fromstring(z.read(sheets[0]))
    cells = {}
    for row in root.iter(NS + 'row'):
        for c in row.findall(NS + 'c'):
            ref = c.get('r'); t = c.get('t'); s = c.get('s')
            v = c.find(NS + 'v'); isel = c.find(NS + 'is')
            if t == 's' and v is not None:
                val = ss[int(v.text)]
            elif t == 'inlineStr' and isel is not None:
                val = ''.join(x.text or '' for x in isel.iter(NS + 't'))
            elif v is not None:
                val = v.text if v.text is not None else ''
            else:
                val = ''
            cells[ref] = {'v': val, 's': s, 't': t}
    merges = []
    mc = root.find(NS + 'mergeCells')
    if mc is not None:
        merges = sorted(m.get('ref') for m in mc.findall(NS + 'mergeCell'))
    widths = {}
    cs = root.find(NS + 'cols')
    if cs is not None:
        for c in cs.findall(NS + 'col'):
            widths[(c.get('min'), c.get('max'))] = c.get('width')
    styles = z.read('xl/styles.xml') if 'xl/styles.xml' in z.namelist() else b''
    return {'cells': cells, 'merges': merges, 'widths': widths, 'ss': ss,
            'styles_len': len(styles), 'names': z.namelist(),
            'styles_sha': hashlib.sha256(styles).hexdigest()[:16]}

def colnum(ref):
    m = re.match(r'^([A-Z]+)(\d+)$', ref or '')
    if not m:
        return None, None
    n = 0
    for ch in m.group(1):
        n = n * 26 + (ord(ch) - 64)
    return n, int(m.group(2))

src = load(SRC)
exp = load(EXP)
doc = json.load(open(JSN, encoding='utf-8'))
tasks = doc['tasks']
COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']

print('== 导出保真读回（python 标准库 zipfile+ElementTree）==')
print('源模板: %s' % SRC)
print('导出文件: %s (%d bytes)' % (EXP, len(open(EXP, 'rb').read())))
print('当前 JSON: revision=%s tasks=%d' % (doc['meta']['revision'], len(tasks)))

# --- 验收 2（Excel 侧）：源模板第 3–38 行与 JSON 种子顺序逐字一致 ---
row3_38 = []
for r in range(3, 39):
    row3_38.append([src['cells'].get(c + str(r), {}).get('v', '') for c in ['A', 'B', 'C', 'D']])
json_rows = [[t['level1'], t['level2'], t['task'], t['owner']] for t in tasks]
mismatch = [(i + 3, row3_38[i], json_rows[i]) for i in range(min(len(row3_38), len(json_rows))) if row3_38[i] != json_rows[i]]
chk('E10', '源模板第 3–38 行 A–D 与 JSON 行序/内容逐字一致（验收 2 的 Excel 侧）',
    len(row3_38) == 36 and len(json_rows) == 36 and not mismatch,
    'rows=%d mismatch=%d %s' % (len(row3_38), len(mismatch), json.dumps(mismatch[:3], ensure_ascii=False)))

# --- 验收 8a：第 1 行文字逐字一致 ---
def eq_cells(prefix, refs, label):
    bad = []
    for ref in refs:
        a = src['cells'].get(ref, {}).get('v', '')
        b = exp['cells'].get(ref, {}).get('v', '')
        if a != b:
            bad.append((ref, a, b))
    chk(prefix, label, not bad, ('refs=%s 全部逐字一致' % ','.join(refs)) if not bad else json.dumps(bad, ensure_ascii=False))

eq_cells('E1', ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1'], '第 1 行文字与源模板逐字一致')
eq_cells('E2', ['A2', 'B2', 'C2', 'D2', 'E2', 'F2', 'G2', 'H2', 'I2', 'J2', 'K2'], '第 2 行表头文字与源模板逐字一致')

# --- 验收 8b：A–K 共 11 列 ---
data_refs = [r for r in exp['cells'] if colnum(r)[1] and colnum(r)[1] >= 3]
maxcol = max(colnum(r)[0] for r in data_refs) if data_refs else 0
cols_used = sorted(set(colnum(r)[0] for r in data_refs))
chk('E3', '数据区列数 A–K 共 11 列（无 L/M 及更后列）',
    maxcol == 11 and cols_used == list(range(1, 12)), 'maxcol=%d cols_used=%s' % (maxcol, cols_used))

# --- 验收 8c：数据行数与当前 JSON 一致，且逐单元格 A–K 与 JSON 映射一致 ---
def json_row(t):
    d = t.get('dates') or {}
    return [t.get('level1', ''), t.get('level2', ''), t.get('task', ''), t.get('owner', ''), t.get('demo', ''),
            d.get('design', ''), d.get('dev', ''), d.get('test', ''), d.get('product', ''), d.get('demo_prep', ''),
            t.get('note', '')]

nonempty = 0
for r in range(3, 60):
    vals = [exp['cells'].get(c + str(r), {}).get('v', '') for c in COLS]
    if any(v != '' for v in vals):
        nonempty = r - 2
chk('E4', '导出数据行数与当前 JSON 一致',
    nonempty == len(tasks), 'exportDataRows=%d jsonTasks=%d' % (nonempty, len(tasks)))

detail_fail = []
for i, t in enumerate(tasks):
    r = 3 + i
    want = json_row(t)
    got = [exp['cells'].get(c + str(r), {}).get('v', '') for c in COLS]
    if want != got:
        detail_fail.append((t['id'], want, got))
chk('E6', '导出 A3:K%d 每行逐列与 JSON 映射一致（三端一致导出侧）' % (2 + len(tasks)),
    not detail_fail, 'mismatch=%d %s' % (len(detail_fail), json.dumps(detail_fail[:2], ensure_ascii=False)))

# --- 验收 8d：不含 status ---
bad_status = [r for r, c in exp['cells'].items() if str(c.get('v', '')).strip().lower() == 'status']
ss_status = [s for s in exp['ss'] if 'status' in s.lower()]
chk('E5', '导出文件不含 status 字段/列', not bad_status and not ss_status,
    'cellHits=%s sharedStringHits=%s' % (bad_status, ss_status))

# --- 合并单元格与列宽保持 ---
chk('E7', 'A1:C1 等全部合并单元格与源模板一致',
    'A1:C1' in exp['merges'] and exp['merges'] == src['merges'],
    'merges=%s src=%s' % (exp['merges'], src['merges']))
# --- 非数据单元格逐格保留（验收 8 之外的保真观察；契约 I/F6 要求“全部非数据单元格”保持） ---
def is_data_area(ref):
    n, r = colnum(ref)
    return n is not None and r is not None and r >= 3 and 1 <= n <= 11
preserve_fail = []
preserve_checked = 0
for ref, c in src['cells'].items():
    if is_data_area(ref):
        continue
    want = c['v']
    got = exp['cells'].get(ref, {}).get('v', '')
    if want != '' or ref in exp['cells']:
        preserve_checked += 1
        if want != got:
            preserve_fail.append((ref, want, got))
chk('E9', '非数据区（第 1/2 行与 L/M 列等）非空单元格逐格保留',
    not preserve_fail, 'checked=%d mismatch=%d %s' % (preserve_checked, len(preserve_fail), json.dumps(preserve_fail[:4], ensure_ascii=False)))

# --- 列宽（验收 1–10 未要求；作为保真观察项输出，不计通过/失败） ---
print('-- 列宽观察（非验收 1–10 项规定项）--')
print('  源模板 <cols>: %s' % (src['widths'],))
print('  导出 <cols>: %s' % (exp['widths'],))
print('  结论: %s' % ('列宽保持' if exp['widths'] == src['widths'] else '导出未写 <cols>，列宽丢失'))

# --- 样式保真度量化（残余风险证据） ---
def styled_count(wb, r1, r2):
    n = 0
    for r in range(r1, r2 + 1):
        for c in COLS:
            cell = wb['cells'].get(c + str(r))
            if cell and cell.get('s'):
                n += 1
    return n
print('-- 样式保真度量化 --')
print('  styles.xml: 源模板 %d 字节 (sha %s) -> 导出 %d 字节 (sha %s)' %
      (src['styles_len'], src['styles_sha'], exp['styles_len'], exp['styles_sha']))
print('  数据区(A3:K38) 带样式索引单元格: 源 %d -> 导出 %d' % (styled_count(src, 3, 38), styled_count(exp, 3, 38)))
print('  非数据区(1..2 行) 带样式索引单元格: 源 %d -> 导出 %d' % (styled_count(src, 1, 2), styled_count(exp, 1, 2)))
print('  zip 成员: 源 %d 个 -> 导出 %d 个' % (len(src['names']), len(exp['names'])))
print('  styles.xml 变化: %s' % ('保持' if src['styles_sha'] == exp['styles_sha'] else '丢失/重建'))

print('== 汇总: %s ==' % ('全部通过' if not fails else 'FAIL ' + ','.join(fails)))
sys.exit(1 if fails else 0)
