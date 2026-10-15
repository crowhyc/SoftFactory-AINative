# -*- coding: utf-8 -*-
"""YUNZ-34 / Stage14：构造隔离实例数据（迁移前文档，无 phases）。
isoA：预期五类今日摘要事件（延期/阻塞/到期未更新/完成/普通，含一任务多事件）。
isoB：所有计划日期在未来且当日无审计 → 今日摘要走兜底行。
"""
import io, json, os, sys, datetime, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ISO = os.path.normpath(os.path.join(HERE, '..', 'iso'))
LIVE = os.environ.get('LIVE_WBS', 'http://127.0.0.1:4180/api/wbs')

def today_sh():
    tz = datetime.timezone(datetime.timedelta(hours=8))
    return datetime.datetime.now(tz).date()

def shift(d, n):
    return (d + datetime.timedelta(days=n)).isoformat()

def load_live():
    with urllib.request.urlopen(LIVE, timeout=10) as r:
        return json.loads(r.read().decode('utf-8'))

def build(base, offset_all, t002_design):
    tasks = []
    for t in base['tasks']:
        dates = {}
        base_day = today_sh()
        for i, k in enumerate(['design', 'dev', 'test', 'product', 'demo_prep']):
            dates[k] = shift(base_day, offset_all + i * 3)
        nt = dict(t)
        nt['dates'] = dates
        nt.pop('phases', None)
        nt['note'] = ''
        nt['demo'] = ''
        tasks.append(nt)
    # T002：设计计划早于今天且当日不更新 → 「到期未更新，判定延期」；并置演示范围口径列
    for nt in tasks:
        if nt['id'] == 'T002':
            nt['dates']['design'] = t002_design
            nt['demo'] = '是'
    meta = dict(base['meta'])
    meta['revision'] = 10
    return {'meta': meta, 'identities': list(base['identities']), 'tasks': tasks}

def main():
    base = load_live()
    y = shift(today_sh(), -1)
    for name, off, d2 in (('isoA', 30, y), ('isoB', 60, shift(today_sh(), 75))):
        d = os.path.join(ISO, name)
        if not os.path.isdir(d):
            os.makedirs(d)
        doc = build(base, off, d2)
        with io.open(os.path.join(d, 'wbs.json'), 'w', encoding='utf-8') as f:
            f.write(json.dumps(doc, ensure_ascii=False, indent=2))
        seed = os.path.normpath(os.path.join(HERE, '..', '..', '..', 'wbs-rongcheng', 'data', 'wbs.seed.json'))
        if os.path.exists(seed):
            with io.open(seed, encoding='utf-8') as f:
                sd = f.read()
            with io.open(os.path.join(d, 'wbs.seed.json'), 'w', encoding='utf-8') as f:
                f.write(sd)
        ap = os.path.join(d, 'audit.log')
        if os.path.exists(ap):
            os.remove(ap)
        print('%s: tasks=%d today=%s t002.design=%s' % (name, len(doc['tasks']), today_sh().isoformat(), doc['tasks'][1]['dates']['design']))

if __name__ == '__main__':
    main()
