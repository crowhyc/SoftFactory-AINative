# -*- coding: utf-8 -*-
"""YUNZ-38 / Stage18 独立复验：构造隔离数据，并按契约原文独立推导期望口径。

isoA：多组不同状态分布（五个阶段各自计数和 = 任务总数；含 0 计数状态与并列余数）
isoB：0 行任务（不除零边界）
isoC：单阶段 1/1/1 分布（最大余数法补齐 100.0% 边界）
isoS：isoA 的副本，供服务端写路径用例（PUT / 409 / 重启持久 / 只读语义）使用，避免污染 isoA。

输出的 expected-stats.json 是本脚本**按契约原文**（分母=任务总数、1 位小数、最大余数法补齐到
100.0%）独立复算的期望值，与实现源码无关，用作第二条口径链。
只用 Python 标准库。
"""
import io, json, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
S18 = os.path.normpath(os.path.join(HERE, '..'))
ISO = os.path.join(S18, 'iso')

PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep']
PHASE_LABELS = {'design': u'设计', 'dev': u'开发', 'test': u'测试',
                'product': u'产品', 'demo_prep': u'演示准备'}
PHASE_ENUM = [u'未开始', u'已开始', u'已完成', u'延期', u'阻塞']
IDENTITIES = [u'项目负责人', u'王言', u'李明', u'张航瑞', u'郑述文',
              u'崔文建', u'余宇', u'黄逸偲', u'陈江']  # 九个身份（含项目负责人）


def task(tid, l1, l2, name, owner, phases):
    return {
        'id': tid, 'level1': l1, 'level2': l2, 'task': name, 'owner': owner,
        'demo': u'',
        'dates': {'design': '2026-10-01', 'dev': '2026-10-05', 'test': '2026-10-09',
                  'product': '2026-10-12', 'demo_prep': '2026-10-15'},
        'note': u'', 'status': u'进行中', 'phases': dict(phases),
    }


def doc(tasks, revision):
    return {
        'meta': {'name': u'1023 蓉城战役 WBS 清单', 'revision': revision,
                 'updated_at': '2026-10-16T04:00:00.000Z',
                 'source': u'1023 蓉城战役 WBS 清单.xlsx'},
        'identities': list(IDENTITIES), 'tasks': tasks,
    }


# ---- 独立复算：契约原文口径 ----------------------------------------------
def phase_percentages(counts, total):
    BASE = 10
    FULL = 100 * BASE
    if not total:
        return [0.0] * len(counts)
    tenths = []
    remainders = []
    counted = 0
    for c in counts:
        scaled = c * 100 * BASE
        tenths.append(scaled // total)
        remainders.append(scaled % total)
        counted += c
    if counted != total:
        return [float(t) / BASE for t in tenths]
    used = sum(tenths)
    deficit = FULL - used
    order = sorted(range(len(counts)), key=lambda i: (-remainders[i], i))
    for i in range(deficit):
        tenths[order[i % len(order)]] += 1
    return [float(t) / BASE for t in tenths]


def expected_stats(d):
    tasks = d['tasks']
    total = len(tasks)
    phases = []
    for key in PHASE_KEYS:
        counts = [0] * len(PHASE_ENUM)
        for t in tasks:
            v = (t.get('phases') or {}).get(key)
            if v in PHASE_ENUM:
                counts[PHASE_ENUM.index(v)] += 1
        pcts = phase_percentages(counts, total)
        phases.append({
            'key': key, 'name': PHASE_LABELS[key],
            'statuses': [{'value': PHASE_ENUM[i], 'count': counts[i], 'percentage': pcts[i]}
                         for i in range(len(PHASE_ENUM))],
        })
    return {'ok': True, 'total': total, 'revision': d['meta']['revision'], 'phases': phases}


# ---- isoA：12 行，五个阶段计数和均 = 12 ------------------------------------
DESIGN = [u'未开始', u'未开始', u'未开始', u'已开始', u'已开始', u'已完成',
          u'已完成', u'已完成', u'已完成', u'已完成', u'延期', u'阻塞']
DEV = [u'未开始', u'已开始', u'已完成', u'延期', u'延期', u'阻塞',
       u'阻塞', u'阻塞', u'阻塞', u'阻塞', u'阻塞', u'阻塞']
TEST = [u'已开始', u'已开始', u'已开始', u'已开始', u'已完成', u'已完成',
        u'已完成', u'已完成', u'已完成', u'已完成', u'阻塞', u'阻塞']
PRODUCT = [u'已完成'] * 12
DEMO_PREP = [u'未开始'] * 12
OWNERS = [u'王言', u'李明', u'张航瑞', u'郑述文']


def build_isoA():
    tasks = []
    for i in range(12):
        tasks.append(task(
            'T-Q%02d' % (i + 1), u'一级%d' % (i // 3 + 1), u'二级%d' % (i + 1),
            u'隔离任务 %d' % (i + 1), OWNERS[i % len(OWNERS)],
            {'design': DESIGN[i], 'dev': DEV[i], 'test': TEST[i],
             'product': PRODUCT[i], 'demo_prep': DEMO_PREP[i]}))
    return doc(tasks, 7)


def build_isoB():
    return doc([], 3)


def build_isoC():
    tasks = []
    for i, st in enumerate([u'未开始', u'已开始', u'已完成']):
        tasks.append(task('T-S%02d' % (i + 1), u'单级', u'单子%d' % (i + 1),
                          u'单阶段任务 %d' % (i + 1), u'王言',
                          {'design': st, 'dev': u'未开始', 'test': u'未开始',
                           'product': u'未开始', 'demo_prep': u'未开始'}))
    return doc(tasks, 5)


def write_instance(name, d):
    p = os.path.join(ISO, name)
    if os.path.isdir(p):
        shutil.rmtree(p)
    os.makedirs(p)
    with io.open(os.path.join(p, 'wbs.json'), 'w', encoding='utf-8') as f:
        f.write(json.dumps(d, ensure_ascii=False, indent=2) + u'\n')
    return p


def main():
    sets = {'isoA': build_isoA(), 'isoB': build_isoB(), 'isoC': build_isoC()}
    for name, d in sets.items():
        p = write_instance(name, d)
        print('iso %s -> %s  tasks=%d' % (name, p, len(d['tasks'])))
    # isoS 供写路径用例使用（isoA 的副本）
    src = os.path.join(ISO, 'isoA')
    dst = os.path.join(ISO, 'isoS')
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    print('iso isoS -> %s  (isoA copy)' % dst)

    exp = {name: expected_stats(d) for name, d in sets.items()}
    out = os.path.join(S18, 'results', 'expected-stats.json')
    with io.open(out, 'w', encoding='utf-8') as f:
        f.write(json.dumps(exp, ensure_ascii=False, indent=2) + u'\n')
    print('expected -> %s' % out)
    for name in ('isoA', 'isoB', 'isoC'):
        e = exp[name]
        print('  %s total=%d' % (name, e['total']))
        for ph in e['phases']:
            s = ' '.join('%s=%d/%.1f%%' % (x['value'], x['count'], x['percentage']) for x in ph['statuses'])
            print('    %s: %s (sum=%.1f)' % (ph['name'], s, sum(x['percentage'] for x in ph['statuses'])))
    return 0


if __name__ == '__main__':
    sys.exit(main())
