# -*- coding: utf-8 -*-
"""YUNZ-20 Stage3 复验 —— 缺陷 D-1 闭环断言：导出文件 <cols> 与源模板 A–K 逐列一致。
仅 Python 标准库（zipfile + re），不依赖 SheetJS，避免“用被验证库验证自己”。"""
import hashlib, os, re, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
STAGE3 = os.path.dirname(HERE)
TPL = '/opt/wbs-rongcheng/public/template.xlsx'            # 运行态模板（=served/，见 served-integrity.log）
STAGING_TPL = '/opt/wbs-rongcheng-staging/WC-001/src/public/template.xlsx'
POST = os.path.join(STAGE3, 'exported-stage3.xlsx')
PRE = '/opt/SoftFactory-AINative/artifacts/YUNZ-20/verification/exported.xlsx'
COL_LETTERS = [chr(ord('A') + i) for i in range(11)]
fails = []
def chk(cid, name, cond, detail):
    print('[%s] %s %s :: %s' % ('PASS' if cond else 'FAIL', cid, name, detail))
    if not cond: fails.append(cid)

def cols_of(path):
    if not os.path.exists(path):
        return {'path': path, 'sha256': '(缺失)', 'size': 0, 'has_cols': False,
                'col_count': 0, 'widths': {}, 'styles_len': 0, 'missing': True}
    raw = open(path, 'rb').read()
    z = zipfile.ZipFile(path)
    xml = z.read('xl/worksheets/sheet1.xml').decode('utf-8', 'replace')
    block = re.search(r'<cols>.*?</cols>', xml, re.S)
    widths = {}
    if block:
        for c in re.finditer(r'<col ([^>]*?)/?>', block.group(0)):
            a = c.group(1)
            mn = int(re.search(r'min="(\d+)"', a).group(1))
            mx = int(re.search(r'max="(\d+)"', a).group(1))
            wd = re.search(r'width="([\d.eE+-]+)"', a)
            for i in range(mn, min(mx, 16384) + 1):
                widths[i] = wd.group(1) if wd else None
    return {'path': path, 'sha256': hashlib.sha256(raw).hexdigest(), 'size': len(raw),
            'has_cols': bool(block), 'col_count': len(re.findall(r'<col ', xml)), 'widths': widths,
            'styles_len': len(z.read('xl/styles.xml')) if 'xl/styles.xml' in z.namelist() else 0}

print('== 缺陷 D-1 闭环：导出 <cols> / A–K 列宽 逐列比对（Python 标准库）==')
tpl, s_tpl, post, pre = cols_of(TPL), cols_of(STAGING_TPL), cols_of(POST), cols_of(PRE)
print('运行态模板 : %s | sha=%s | <col>=%d | A–K=%s' % (TPL, tpl['sha256'][:16], tpl['col_count'], [tpl['widths'].get(i) for i in range(1, 12)]))
print('输入基线模板: %s | sha=%s' % (STAGING_TPL, s_tpl['sha256'][:16]))
print('复验导出   : %s | sha=%s | %d 字节' % (POST, post['sha256'][:16], post['size']))
print('修复前导出 : %s | sha=%s | %d 字节' % (PRE, pre['sha256'][:16], pre['size']))
print()

chk('D1-1', '运行态模板与输入基线模板逐字一致', tpl['sha256'] == s_tpl['sha256'], 'tpl=%s staging=%s' % (tpl['sha256'][:16], s_tpl['sha256'][:16]))
chk('D1-2', '修复后页面导出文件包含 <cols> 列宽定义（修复前无 <cols>）',
    post['has_cols'] and not pre['has_cols'],
    'pre.hasCols=%s（sha %s，%d 字节） post.hasCols=%s（<col> %d 条）' %
    (pre['has_cols'], pre['sha256'][:8], pre['size'], post['has_cols'], post['col_count']))
diff = [COL_LETTERS[i] + ' 模板' + str(tpl['widths'].get(i + 1)) + ' 导出' + str(post['widths'].get(i + 1))
        for i in range(11) if tpl['widths'].get(i + 1) != post['widths'].get(i + 1)]
chk('D1-3', '导出 A–K 列宽与源模板逐列一致（11/11）', post['has_cols'] and not diff,
    'diff=%s | A–K=%s' % (diff, [post['widths'].get(i) for i in range(1, 12)]))
chk('D1-4', 'K 进展说明列宽 = 47.2592592592593（与模板一致）',
    post['widths'].get(11) == '47.2592592592593' and tpl['widths'].get(11) == '47.2592592592593',
    'post K=%s tpl K=%s' % (post['widths'].get(11), tpl['widths'].get(11)))
print()
print('附：样例行宽对比（X 列宽维度）')
for i in range(11):
    print('  %s  模板 %-18s 导出 %-18s %s' % (COL_LETTERS[i], tpl['widths'].get(i + 1), post['widths'].get(i + 1),
          'OK' if tpl['widths'].get(i + 1) == post['widths'].get(i + 1) else 'DIFF'))
print()
print('== 汇总: %s ==' % ('全部通过' if not fails else 'FAIL ' + ','.join(fails)))
sys.exit(1 if fails else 0)
