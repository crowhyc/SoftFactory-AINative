# -*- coding: utf-8 -*-
"""YUNZ-20 Stage2 —— 导出列宽保真对比：交付页面路径 vs 作者自测路径。"""
import hashlib, re, sys, zipfile
def probe(label, path):
    if not path or not __import__('os').path.exists(path):
        print('%s: 文件缺失 %s' % (label, path)); return
    z = zipfile.ZipFile(path)
    s = z.read('xl/worksheets/sheet1.xml').decode('utf-8', 'replace')
    cols = re.findall(r'<col ', s)
    m = re.search(r'<cols>.*?</cols>', s, re.S)
    print('%s\n  文件: %s\n  sha256: %s\n  大小: %d 字节 | zip 成员: %d | <cols> 元素: %d | <col> 声明: %d' %
          (label, path, hashlib.sha256(open(path, 'rb').read()).hexdigest(), len(open(path, 'rb').read()),
           len(z.namelist()), 1 if m else 0, len(cols)))
    if m:
        print('  A/B/C 列宽: %s' % re.findall(r'width="([\d.]+)"', m.group(0))[:3])
    else:
        print('  A/B/C 列宽: 无（导出未写 <cols>，列宽信息丢失）')
print('== 导出列宽保真对比（同一模板、不同导出代码路径）==')
print('模板: /opt/wbs-rongcheng/public/template.xlsx')
z = zipfile.ZipFile('/opt/wbs-rongcheng/public/template.xlsx')
s = z.read('xl/worksheets/sheet1.xml').decode('utf-8', 'replace')
m = re.search(r'<cols>.*?</cols>', s, re.S)
print('  模板 <cols> 元素: %d | <col> 声明: %d | A/B/C 列宽: %s' % (1 if m else 0, len(re.findall(r'<col ', s)), re.findall(r'width="([\d.]+)"', m.group(0))[:3] if m else []))
print()
probe('① 交付页面路径（app.js:611 默认 XLSX.read + 页面导出按钮，本报告证据文件）', sys.argv[1] if len(sys.argv) > 1 else 'dom-out/exported.xlsx')
print()
probe('② 作者自测路径（tests/exportcheck.mjs 用 {cellStyles:true}）',
      sys.argv[2] if len(sys.argv) > 2 else 'dom-out/author-path-export.xlsx')
print()
print('结论: 交付页面的真实导出路径不写 <cols>（列宽丢失）；作者自测路径保留列宽。')
print('      自测 12.log 的“列宽设置保持原样”结论不对交付页面成立。')
