# -*- coding: utf-8 -*-
"""YUNZ-40 / Stage20 独立复验：隔离数据构造 + 契约口径独立复算。

用与实现无关的第二套算法（fractions.Fraction 精确有理数）复算 CH-15 的
aggregate（分母 = 任务总数 x 5）与 phases（分母 = 任务总数）两组口径，
把构造数据与期望值写到 stage20/iso 与 stage20/results/expected-stats.json。

数据集：
  isoA  3 行：design 呈 1/1/1 边界（33.4 / 33.3 / 33.3，最大余数法生效）
  isoB 12 行：aggregate 19/20/20/1/0 -> 31.7 / 33.3 / 33.3 / 1.7 / 0（各阶段先截断合计 99.8）
  isoC  0 行：空任务表（不除零）
  isoS  3 行：含阻塞/延期，note 内含「产品」字样；audit.log 含今日 phases.product.status 变更
  isoD  3 行：脏数据（一行缺 product 键）-> 计数与分母不一致时只截断不补齐
  isoE 36 行：seed 原样（无 phases）——迁移幂等与旧 status 保留

只写 stage20 目录，不触碰 /opt/wbs-rongcheng/data 与 0.0.0.0:4180。
"""
import datetime
import json
import os
import shutil
import sys
from fractions import Fraction

HERE = os.path.dirname(os.path.abspath(__file__))
S20 = os.path.normpath(os.path.join(HERE, '..'))
ISO = os.path.join(S20, 'iso')
RESULTS = os.path.join(S20, 'results')
APP = os.environ.get('APP_DIR', '/opt/wbs-rongcheng')
SEED = os.path.join(APP, 'data', 'wbs.seed.json')

PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep']
PHASE_LABELS = {u'design': u'\u8bbe\u8ba1', u'dev': u'\u5f00\u53d1', u'test': u'\u6d4b\u8bd5',
                u'product': u'\u4ea7\u54c1\u9a8c\u6536', u'demo_prep': u'\u6f14\u793a\u51c6\u5907'}
PHASE_ENUM = [u'\u672a\u5f00\u59cb', u'\u5df2\u5f00\u59cb', u'\u5df2\u5b8c\u6210',
              u'\u5ef6\u671f', u'\u963b\u585e']

PASS = 0
FAIL = 0


def check(cid, ok, detail=None):
    global PASS, FAIL
    if ok:
        PASS += 1
        print('PASS  ' + cid + ('  :: ' + json.dumps(detail, ensure_ascii=False) if detail is not None else ''))
    else:
        FAIL += 1
        print('FAIL  ' + cid + '  -> ' + json.dumps(detail, ensure_ascii=False))


def wjson(path, payload):
    with open(path, 'w', encoding='utf-8') as handle:
        handle.write(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')


def rjson(path):
    with open(path, 'r', encoding='utf-8') as handle:
        return json.loads(handle.read())


# ------------------------------------------------------------------ 独立复算

def expected_percentages(counts, total):
    """契约口径的第二套实现：精确有理数 -> 向下取到 0.1 -> 最大余数法补足 100.0%。
    余数相同按 PHASE_ENUM 顺序；total 为 0 时全 0；计数之和与分母不一致时只截断不补齐。"""
    if total == 0:
        return [0.0 for _ in counts]
    counted = sum(counts)
    tenths = []
    remainders = []
    for count in counts:
        scaled = Fraction(count * 100, total) * 10     # 以 0.1% 为单位的精确值
        base = int(scaled)                             # count >= 0 -> 等价于 floor
        tenths.append(base)
        remainders.append(scaled - base)
    if counted == total:
        deficit = 1000 - sum(tenths)
        order = sorted(range(len(counts)), key=lambda i: (-remainders[i], i))
        for step in range(deficit):
            tenths[order[step % len(order)]] += 1
    return [value / 10.0 for value in tenths]


def expected_stats(doc):
    tasks = doc.get('tasks') or []
    total = len(tasks)
    phases = []
    for key in PHASE_KEYS:
        counts = []
        for value in PHASE_ENUM:
            hit = 0
            for task in tasks:
                progress = task.get('phases')
                if isinstance(progress, dict) and progress.get(key) == value:
                    hit += 1
            counts.append(hit)
        phases.append({'key': key, 'name': PHASE_LABELS[key], 'counts': counts,
                       'percentages': expected_percentages(counts, total)})
    aggregate_counts = [sum(phase['counts'][i] for phase in phases) for i in range(len(PHASE_ENUM))]
    denominator = total * len(PHASE_KEYS)
    return {
        'total': total,
        'aggregate': {'denominator': denominator, 'counts': aggregate_counts,
                      'percentages': expected_percentages(aggregate_counts, denominator)},
        'phases': phases
    }


# ------------------------------------------------------------------ 数据构造

def shape_tasks(seed_tasks, shape, note_patch=None):
    """按每阶段五状态目标计数造任务；每阶段计数之和都必须等于该数据集任务数。"""
    total = sum(shape['design'])
    tasks = []
    for index in range(total):
        src = dict(seed_tasks[index % len(seed_tasks)])
        task = {
            'id': 'Q%03d' % (index + 1),
            'level1': src['level1'], 'level2': src['level2'], 'task': src['task'],
            'owner': src['owner'], 'demo': '', 'status': src.get('status', u'\u8fdb\u884c\u4e2d'),
            'note': src.get('note', ''),
            'dates': {}, 'phases': {}
        }
        for key in PHASE_KEYS:
            task['dates'][key] = '2026-12-31'
            rest = index
            value = PHASE_ENUM[-1]
            for slot in range(len(PHASE_ENUM)):
                if rest < shape[key][slot]:
                    value = PHASE_ENUM[slot]
                    break
                rest -= shape[key][slot]
            task['phases'][key] = value
        if note_patch and index in note_patch:
            task['note'] = note_patch[index]
        tasks.append(task)
    return tasks


def build(name, doc, audit_lines=None):
    target = os.path.join(ISO, name)
    if os.path.isdir(target):
        shutil.rmtree(target)
    os.makedirs(target)
    wjson(os.path.join(target, 'wbs.json'), doc)
    wjson(os.path.join(target, 'wbs.seed.json'), doc)
    with open(os.path.join(target, 'audit.log'), 'w', encoding='utf-8') as handle:
        for line in (audit_lines or []):
            handle.write(json.dumps(line, ensure_ascii=False) + '\n')
    print('  构造 %s：任务 %d 行 -> %s' % (name, len(doc.get('tasks') or []), target))
    return target


def main():
    if not os.path.isdir(RESULTS):
        os.makedirs(RESULTS)
    seed = rjson(SEED)
    seed_tasks = seed['tasks']
    identities = list(seed['identities'])
    print('YUNZ-40 / Stage20 隔离数据构造  时间 %s' % datetime.datetime.now().isoformat())
    print('seed：%d 行 / %d 身份' % (len(seed_tasks), len(identities)))

    def meta(revision=0):
        return {'name': seed['meta']['name'], 'revision': revision,
                'updated_at': '2026-10-16T00:00:00.000Z',
                'source': seed['meta']['source'], 'source_sha256': seed['meta']['source_sha256']}

    datasets = {}

    a_shape = {
        'design': [1, 1, 1, 0, 0], 'dev': [3, 0, 0, 0, 0], 'test': [3, 0, 0, 0, 0],
        'product': [3, 0, 0, 0, 0], 'demo_prep': [3, 0, 0, 0, 0]
    }
    datasets['isoA'] = {'meta': meta(), 'identities': identities,
                        'tasks': shape_tasks(seed_tasks, a_shape)}

    b_shape = {
        'design': [4, 4, 4, 0, 0], 'dev': [4, 4, 4, 0, 0], 'test': [4, 4, 4, 0, 0],
        'product': [4, 4, 4, 0, 0], 'demo_prep': [3, 4, 4, 1, 0]
    }
    b_note = {0: u'\u4ea7\u54c1\u8def\u7ebf\u56fe\u786e\u8ba4\uff08\u884c\u5185\u4e1a\u52a1\u6587\u672c\u542b\u201c\u4ea7\u54c1\u201d\uff09',
              1: u'\u4ea7\u54c1\u8bc4\u5ba1\u7ed3\u8bba\uff1a\u4ea7\u54c1\u90e8\u5206\u5df2\u5c31\u7eea'}
    datasets['isoB'] = {'meta': meta(), 'identities': identities,
                        'tasks': shape_tasks(seed_tasks, b_shape, b_note)}

    datasets['isoC'] = {'meta': meta(), 'identities': identities, 'tasks': []}

    s_shape = {
        'design': [1, 1, 1, 0, 0], 'dev': [3, 0, 0, 0, 0], 'test': [2, 1, 0, 0, 0],
        'product': [1, 0, 1, 1, 0], 'demo_prep': [3, 0, 0, 0, 0]
    }
    s_tasks = shape_tasks(seed_tasks, s_shape)
    s_tasks[0]['phases']['design'] = PHASE_ENUM[4]
    s_tasks[2]['phases']['product'] = PHASE_ENUM[3]
    datasets['isoS'] = {'meta': meta(7), 'identities': identities, 'tasks': s_tasks}
    now = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    s_audit = [{
        'ts': now, 'identity': identities[0], 'revision': 7,
        'changed': [{'id': 'Q003', 'fields': ['phases.product.status']}],
        'added': 0, 'removed': 0,
        'old': {'Q003': {'phases.product.status': PHASE_ENUM[0]}},
        'new': {'Q003': {'phases.product.status': PHASE_ENUM[3]}},
        'snapshot': {'Q003': {'level1': s_tasks[2]['level1'], 'level2': s_tasks[2]['level2'],
                              'task': s_tasks[2]['task'], 'owner': s_tasks[2]['owner']}}
    }]

    d_shape = {
        'design': [1, 1, 1, 0, 0], 'dev': [3, 0, 0, 0, 0], 'test': [3, 0, 0, 0, 0],
        'product': [3, 0, 0, 0, 0], 'demo_prep': [3, 0, 0, 0, 0]
    }
    d_tasks = shape_tasks(seed_tasks, d_shape)
    del d_tasks[1]['phases']['product']
    datasets['isoD'] = {'meta': meta(), 'identities': identities, 'tasks': d_tasks}

    datasets['isoE'] = {'meta': meta(), 'identities': identities,
                        'tasks': [dict(task) for task in seed_tasks]}

    for name in ['isoA', 'isoB', 'isoC', 'isoS', 'isoD', 'isoE']:
        build(name, datasets[name], s_audit if name == 'isoS' else None)

    # isoD 原始（未归一）副本：服务启动会做一次性迁移，脏数据会被归一，
    # 故另存一份 pristine 供「截断分支」直接调用验证。
    wjson(os.path.join(ISO, 'isoD', 'wbs.dirty.json'), datasets['isoD'])

    expected = {'built_at': datetime.datetime.now().isoformat(), 'datasets': {}}
    for name in ['isoA', 'isoB', 'isoC', 'isoS', 'isoD']:
        expected['datasets'][name] = expected_stats(datasets[name])
    wjson(os.path.join(RESULTS, 'expected-stats.json'), expected)

    exp_a = expected['datasets']['isoA']
    check('构造-A/design 1/1/1 边界占比 = 33.4/33.3/33.3',
          exp_a['phases'][0]['percentages'][:3] == [33.4, 33.3, 33.3],
          exp_a['phases'][0]['percentages'])
    exp_b = expected['datasets']['isoB']
    naive = [31.6, 33.3, 33.3, 1.6, 0.0]
    check('构造-B/aggregate 占比 = 31.7/33.3/33.3/1.7/0（各阶段先截断合计仅 99.8）',
          exp_b['aggregate']['percentages'] == [31.7, 33.3, 33.3, 1.7, 0.0]
          and abs(sum(naive) - 99.8) < 1e-9,
          {'aggregate': exp_b['aggregate']['percentages'],
           'counts': exp_b['aggregate']['counts'], 'naive_sum': sum(naive)})
    check('构造-B/aggregate 分母 = 任务总数 x 5 = 60',
          exp_b['aggregate']['denominator'] == 60, exp_b['aggregate']['denominator'])
    for name in ['isoA', 'isoB', 'isoS']:
        entry = expected['datasets'][name]
        ok = abs(sum(entry['aggregate']['percentages']) - 100.0) < 1e-9
        for phase in entry['phases']:
            ok = ok and abs(sum(phase['percentages']) - 100.0) < 1e-9
        check('构造-%s/aggregate 与五阶段各自五项合计 = 100.0' % name, ok,
              {'aggregate': entry['aggregate']['percentages'],
               'demo_prep': entry['phases'][4]['percentages']})
    exp_c = expected['datasets']['isoC']
    check('构造-C/0 行：分母 0、全 0 不除零',
          exp_c['total'] == 0 and exp_c['aggregate']['denominator'] == 0
          and set(exp_c['aggregate']['percentages']) == {0.0}
          and all(set(phase['percentages']) == {0.0} for phase in exp_c['phases']), None)
    exp_d = expected['datasets']['isoD']
    check('构造-D/脏数据：product 计数之和 2 != 3，只截断 -> 合计 < 100.0',
          sum(exp_d['phases'][3]['counts']) == 2
          and sum(exp_d['phases'][3]['percentages']) < 100.0
          and sum(exp_d['aggregate']['percentages']) < 100.0,
          {'product': exp_d['phases'][3]['percentages'],
           'product_sum': sum(exp_d['phases'][3]['percentages']),
           'aggregate_sum': sum(exp_d['aggregate']['percentages'])})
    check('构造-期望值文件已落盘',
          os.path.isfile(os.path.join(RESULTS, 'expected-stats.json')),
          os.path.join(RESULTS, 'expected-stats.json'))

    print('构造数据目录：%s' % ISO)
    print('PASS=%d FAIL=%d' % (PASS, FAIL))
    return 0 if FAIL == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
