#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""YUNZ-32 / Stage12：构造 CH-10 迁移边界用例输入（隔离实例专用，不改现场）。"""
import io, json, sys
src, dst = sys.argv[1], sys.argv[2]
doc = json.load(io.open(src, encoding='utf-8'))
ids = [t['id'] for t in doc['tasks']]
by = dict((t['id'], t) for t in doc['tasks'])
b1, b2 = ids[0], ids[1]
# 边界行 1：昨天 / 恰好今天 / 缺失 / 未来 / 非法日历日期
by[b1]['dates'] = {'design': '2026-10-14', 'dev': '2026-10-15', 'test': '', 'product': '2026-10-16', 'demo_prep': '2026-02-30'}
# 边界行 2：阶段日期全部缺失
by[b2]['dates'] = {'design': '', 'dev': '', 'test': '', 'product': '', 'demo_prep': ''}
io.open(dst + '.ids', 'w', encoding='utf-8').write(b1 + ' ' + b2)
print('boundary rows: ' + b1 + ', ' + b2)
for t in doc['tasks']:
    t.pop('phases', None)
json.dump(doc, io.open(dst, 'w', encoding='utf-8'), ensure_ascii=False)
print('boundary input written: ' + dst)
