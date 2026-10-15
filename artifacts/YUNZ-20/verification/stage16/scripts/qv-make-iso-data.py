# -*- coding: utf-8 -*-
"""YUNZ-36 / Stage16：构造隔离数据，校验 CH-13 派生规则与文本口径（不经作者用例）。

isoA：构造用例（含派生 / 当天已更新不重复判定 / 内容范围 / 排序 / 一任务多事件）
isoB：无任何阻塞、延期与派生条目 → 文本仅一行 `今日无阻塞、延期。`
isoS：isoA 的副本，供服务端 API 用例（409 / 重启持久 / 审计写入 / identity_added）使用，避免污染 isoA。

同时输出 expected-text.json：本脚本独立推导的期望文本（与实现无关的第二条口径链）。
"""
import io, json, os, datetime, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
S16 = os.path.normpath(os.path.join(HERE, '..'))
ISO = os.path.join(S16, 'iso')
TZ = datetime.timezone(datetime.timedelta(hours=8))
PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep']
PHASE_LABELS = {'design': u'设计', 'dev': u'开发', 'test': u'测试', 'product': u'产品', 'demo_prep': u'演示准备'}
IDENTITIES = [u'项目负责人', u'王言', u'李明', u'张航瑞', u'郑述文', u'系统迁移']

def today():
    return datetime.datetime.now(TZ).date()

def shift(d, n):
    return (d + datetime.timedelta(days=n)).isoformat()

def mmdd(s):
    return str(s)[5:]

def task(tid, l1, l2, name, owner, dates, phases, status='进行中', note='', demo=''):
    return {'id': tid, 'level1': l1, 'level2': l2, 'task': name, 'owner': owner,
            'demo': demo, 'dates': dates, 'note': note, 'status': status, 'phases': phases}

def doc(revision, tasks):
    return {'meta': {'name': u'1023 蓉城战役 WBS 清单', 'revision': revision,
                     'updated_at': '2026-10-15T04:04:05.369Z',
                     'source': u'1023 蓉城战役 WBS 清单.xlsx'},
            'identities': list(IDENTITIES), 'tasks': tasks}

def audit_entry(ts, pairs, snap):
    """pairs: {task_id: {field: new_value}}；old 由调用方构造。"""
    return {'ts': ts, 'identity': u'项目负责人', 'revision': 11,
            'old': {}, 'new': pairs, 'snapshot': snap}

def build_isoA():
    t = today()
    tasks = [
        task('T-A1', u'甲级', u'甲子', u'设计任务', u'王言',
             {'design': shift(t, -3), 'dev': shift(t, -2), 'test': shift(t, -1),
              'product': shift(t, -9), 'demo_prep': ''},
             {'design': u'未开始', 'dev': u'延期', 'test': u'未开始',
              'product': u'已完成', 'demo_prep': u'未开始'}),
        task('T-A2', u'乙级', u'乙子', u'开发任务', u'李明',
             {'design': shift(t, -5), 'dev': '', 'test': shift(t, 5), 'product': shift(t, 7), 'demo_prep': ''},
             {'design': u'阻塞', 'dev': u'阻塞', 'test': u'延期', 'product': u'未开始', 'demo_prep': u'未开始'}),
        task('T-A3', u'丙级', u'丙子', u'已完结任务', u'张航瑞',
             {'design': shift(t, -20), 'dev': shift(t, -18), 'test': shift(t, -15),
              'product': shift(t, -12), 'demo_prep': shift(t, -10)},
             {'design': u'已完成', 'dev': u'已完成', 'test': u'已完成',
              'product': u'已完成', 'demo_prep': u'已完成'}),
        task('T-A4', u'丁级', u'丁子', u'多事件任务', u'郑述文',
             {'design': shift(t, 3), 'dev': shift(t, -1), 'test': '', 'product': '', 'demo_prep': ''},
             {'design': u'延期', 'dev': u'延期', 'test': u'阻塞', 'product': u'未开始', 'demo_prep': u'未开始'}),
    ]
    now = datetime.datetime.now(TZ)
    ts = now.astimezone(datetime.timezone.utc).isoformat()
    snap = {tk['id']: {'level1': tk['level1'], 'level2': tk['level2'], 'task': tk['task'], 'owner': tk['owner']} for tk in tasks}
    # 今日审计：T-A1 dev 未开始→延期（当天已更新，按新状态归类）；T-A1 test 日期变更（改为其他状态口径 → 不产出）；
    #           T-A2 design 未开始→阻塞（当天新出现）；T-A3 design 未开始→已完成（完成，不进文本）；
    #           T-A4 dev 日期变更（touched）；T-A4 test 未开始→阻塞（当天新出现）
    entries = [
        {'ts': ts, 'identity': u'项目负责人', 'revision': 11,
         'old': {'T-A1': {'phases.dev.status': u'未开始', 'dates.test': shift(t, 20)}},
         'new': {'T-A1': {'phases.dev.status': u'延期', 'dates.test': shift(t, -1)}},
         'snapshot': snap},
        {'ts': ts, 'identity': u'项目负责人', 'revision': 12,
         'old': {'T-A2': {'phases.design.status': u'未开始'}},
         'new': {'T-A2': {'phases.design.status': u'阻塞'}}, 'snapshot': snap},
        {'ts': ts, 'identity': u'项目负责人', 'revision': 13,
         'old': {'T-A3': {'phases.design.status': u'未开始'}},
         'new': {'T-A3': {'phases.design.status': u'已完成'}}, 'snapshot': snap},
        {'ts': ts, 'identity': u'项目负责人', 'revision': 14,
         'old': {'T-A4': {'dates.dev': shift(t, 10), 'phases.test.status': u'未开始'}},
         'new': {'T-A4': {'dates.dev': shift(t, -1), 'phases.test.status': u'阻塞'}}, 'snapshot': snap},
        {'type': 'identity_added', 'identity': u'项目负责人', 'name': u'新同事', 'at': ts},
    ]
    return doc(10, tasks), entries

def touched_map(entries):
    """从今日审计条目推导「今日被更新过的阶段」：dates.<key> 或 phases.<key>.status。"""
    touched = {}
    for e in entries:
        if e.get('type') == 'identity_added':
            continue
        for tid, fields in (e.get('new') or {}).items():
            for field in fields:
                key = None
                if field.startswith('dates.'):
                    key = field[len('dates.'):]
                elif field.startswith('phases.') and field.endswith('.status'):
                    key = field[len('phases.'):-len('.status')]
                if key in PHASE_KEYS:
                    touched.setdefault(tid, set()).add(key)
    return touched


def expected_text(isoA_tasks, entries):
    t = today()
    touched = touched_map(entries)
    delayed, blocked = [], []
    for tk in isoA_tasks:
        base = u'%s / %s / %s @%s：' % (tk['level1'], tk['level2'], tk['task'], tk['owner'])
        touched_keys = touched.get(tk['id'], set())
        for k in PHASE_KEYS:
            st = tk['phases'][k]
            planned = tk['dates'][k]
            label = PHASE_LABELS[k]
            fresh = k in touched_keys
            if st == u'阻塞':
                blocked.append(u'\u3010阻塞\u00b7高风险\u3011' + base + label + (u'更新为阻塞' if fresh else u'阻塞') + u'。')
                continue
            if st == u'已完成':
                continue
            if planned and len(planned) == 10 and planned < t.isoformat() and not fresh:
                delayed.append(u'\u3010延期\u00b7高风险\u3011' + base + label + u' ' + mmdd(planned) + u' 到期未更新，判定延期。')
                continue
            if st == u'延期':
                delayed.append(u'\u3010延期\u00b7高风险\u3011' + base + label + u'延期。')
    lines = delayed + blocked
    overview = u'今日延期 %d 项 / 阻塞 %d 项' % (len(delayed), len(blocked))
    return {'overview': overview, 'delayedCount': len(delayed), 'blockedCount': len(blocked),
            'lines': lines, 'body': u'\n'.join([overview] + lines)}

def write(dirname, document, entries):
    d = os.path.join(ISO, dirname)
    if os.path.isdir(d):
        shutil.rmtree(d)
    os.makedirs(d)
    with io.open(os.path.join(d, 'wbs.json'), 'w', encoding='utf-8') as f:
        f.write(json.dumps(document, ensure_ascii=False, indent=2))
    with io.open(os.path.join(d, 'audit.log'), 'w', encoding='utf-8') as f:
        for e in entries:
            f.write(json.dumps(e, ensure_ascii=False) + u'\n')
    return d

def main():
    if not os.path.isdir(ISO):
        os.makedirs(ISO)
    dA, eA = build_isoA()
    write('isoA', dA, eA)
    exp = expected_text(dA['tasks'], eA)

    tasksB = [
        task('T-B1', u'戊级', u'戊子', u'未来任务', u'王言',
             {'design': shift(today(), 30), 'dev': shift(today(), 33), 'test': shift(today(), 36),
              'product': shift(today(), 39), 'demo_prep': shift(today(), 42)},
             {'design': u'未开始', 'dev': u'已开始', 'test': u'未开始', 'product': u'未开始', 'demo_prep': u'未开始'}),
        task('T-B2', u'己级', u'己子', u'空日期任务', u'李明',
             {'design': '', 'dev': '', 'test': '', 'product': '', 'demo_prep': ''},
             {'design': u'未开始', 'dev': u'未开始', 'test': u'未开始', 'product': u'未开始', 'demo_prep': u'未开始'}),
    ]
    write('isoB', doc(10, tasksB), [])
    expB = {'overview': u'今日无阻塞、延期。', 'delayedCount': 0, 'blockedCount': 0,
            'lines': [], 'body': u'今日无阻塞、延期。'}

    # isoS：isoA 的副本，供服务端 API 用例
    src = os.path.join(ISO, 'isoA')
    dst = os.path.join(ISO, 'isoS')
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    shutil.copytree(src, dst)

    with io.open(os.path.join(S16, 'results', 'expected-text.json'), 'w', encoding='utf-8') as f:
        f.write(json.dumps({'isoA': exp, 'isoB': expB, 'today': today().isoformat()}, ensure_ascii=False, indent=2))
    print('[iso] isoA / isoB / isoS 已构造（today=%s）' % today().isoformat())
    print('[iso] isoA expected body:')
    print(exp['body'])
    print('[iso] isoB expected body: ' + expB['body'])

if __name__ == '__main__':
    main()
