#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""构造「无事件」隔离实例：日期全空、phases 全 未开始、audit.log 空 → 日报应走兜底行。"""
import io, json, os, sys, shutil
out = sys.argv[1]
doc = json.load(io.open('/opt/wbs-rongcheng/data/wbs.json.20261015040405.bak', encoding='utf-8'))
doc['meta']['revision'] = 1
PH = ['design', 'dev', 'test', 'product', 'demo_prep']
for t in doc['tasks']:
    t['dates'] = dict((k, '') for k in PH)
    t['phases'] = dict((k, '未开始') for k in PH)
os.makedirs(out, exist_ok=True)
json.dump(doc, io.open(os.path.join(out, 'wbs.json'), 'w', encoding='utf-8'), ensure_ascii=False)
shutil.copy('/opt/wbs-rongcheng/data/wbs.seed.json', os.path.join(out, 'wbs.seed.json'))
io.open(os.path.join(out, 'audit.log'), 'w').close()
print('empty-events data written: ' + out)
