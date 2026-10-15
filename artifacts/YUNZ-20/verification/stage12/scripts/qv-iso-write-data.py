#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""YUNZ-32 / Stage12：构造隔离写入实例数据（现场 4180 只读，所有写入只在隔离实例）。
   - 全部行 phases=未开始、dates 清空；两行构造派生规则用例；一行 demo='是' 且 test=延期（进阻塞 sheet）。
   - audit.log 只放一条「旧 status 变更」记录，用于对抗验证「旧 status 不再被日报引用」。"""
import io, json, os, sys, shutil
out = sys.argv[1]
src = '/opt/wbs-rongcheng/data/wbs.json.20261015040405.bak'
doc = json.load(io.open(src, encoding='utf-8'))
doc['meta']['revision'] = 1
PH = ['design', 'dev', 'test', 'product', 'demo_prep']
tasks = doc['tasks']
for t in tasks:
    t['phases'] = dict((k, '未开始') for k in PH)
    t['dates'] = dict((k, '') for k in PH)
X, Y, Z = tasks[0], tasks[1], tasks[2]
# 用例①：X.design 计划日期 < 今天、阶段状态今天无任何更新 → 应判「到期未更新，判定延期」
X['dates']['design'] = '2026-10-14'
# 用例②：Y.dev 计划日期 < 今天，但今天通过界面更新该阶段状态 → 按实际状态出事件、不重复判到期未更新
Y['dates']['dev'] = '2026-10-14'
# CH-9：一个非空 demo 原值（页面不渲染、导出与日报仍保留）
Z['demo'] = '是'
Z['phases']['test'] = '延期'
Z['status'] = '已完成'
os.makedirs(out, exist_ok=True)
json.dump(doc, io.open(os.path.join(out, 'wbs.json'), 'w', encoding='utf-8'), ensure_ascii=False)
shutil.copy('/opt/wbs-rongcheng/data/wbs.seed.json', os.path.join(out, 'wbs.seed.json'))
snap = {}
for k in ['level1', 'level2', 'task', 'owner']:
    snap[k] = X.get(k, '')
with io.open(os.path.join(out, 'audit.log'), 'w', encoding='utf-8') as fh:
    fh.write(json.dumps({
        'ts': '2026-10-15T01:00:00.000Z', 'identity': '项目负责人', 'revision': 1,
        'changed': [], 'added': 0, 'removed': 0,
        'old': {X['id']: {'status': '进行中'}},
        'new': {X['id']: {'status': '已完成'}},
        'snapshot': {X['id']: snap}
    }, ensure_ascii=False) + '\n')
print('iso write data written: ' + out)
print('rows: X=%s Y=%s Z=%s (Z.demo=%s)' % (X['id'], Y['id'], Z['id'], Z['demo']))
