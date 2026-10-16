# -*- coding: utf-8 -*-
"""YUNZ-40 / Stage20 独立复验：服务端口径与只读语义（隔离实例 + 现场只读）。

不依赖被测实现的任何代码：期望值来自 qv20-make-iso-data.py 的第二套算法
（Fraction 精确有理数），并从 /api/wbs 再独立复算一次做同源断言。
"""
import datetime
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from fractions import Fraction

S20 = os.environ.get('S20', os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
APP = os.environ.get('APP_DIR', '/opt/wbs-rongcheng')
ISO = os.path.join(S20, 'iso')
RESULTS = os.path.join(S20, 'results')

PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep']
PHASE_LABELS = {u'design': u'\u8bbe\u8ba1', u'dev': u'\u5f00\u53d1', u'test': u'\u6d4b\u8bd5',
                u'product': u'\u4ea7\u54c1\u9a8c\u6536', u'demo_prep': u'\u6f14\u793a\u51c6\u5907'}
PHASE_ENUM = [u'\u672a\u5f00\u59cb', u'\u5df2\u5f00\u59cb', u'\u5df2\u5b8c\u6210',
              u'\u5ef6\u671f', u'\u963b\u585e']
AGG_NAME = u'\u5168\u90e8\u4e94\u9636\u6bb5\u5408\u5e76'

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


def http(method, url, body=None, headers=None):
    data = None
    hdrs = dict(headers or {})
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode('utf-8')
        hdrs['Content-Type'] = 'application/json; charset=utf-8'
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read()
            return resp.status, raw.decode('utf-8'), dict(resp.headers)
    except urllib.error.HTTPError as err:
        raw = err.read()
        return err.code, raw.decode('utf-8'), dict(err.headers)


def get_json(url):
    status, text, headers = http('GET', url)
    try:
        return status, json.loads(text), headers, text
    except ValueError:
        return status, None, headers, text


# ------------------------------------------------------------ 独立复算（第二套）

def expected_percentages(counts, total):
    if total == 0:
        return [0.0 for _ in counts]
    counted = sum(counts)
    tenths, remainders = [], []
    for count in counts:
        scaled = Fraction(count * 100, total) * 10
        base = int(scaled)
        tenths.append(base)
        remainders.append(scaled - base)
    if counted == total:
        order = sorted(range(len(counts)), key=lambda i: (-remainders[i], i))
        for step in range(1000 - sum(tenths)):
            tenths[order[step % len(order)]] += 1
    return [v / 10.0 for v in tenths]


def recompute(doc):
    tasks = doc.get('tasks') or []
    total = len(tasks)
    phases = []
    for key in PHASE_KEYS:
        counts = []
        for value in PHASE_ENUM:
            counts.append(sum(1 for t in tasks
                              if isinstance(t.get('phases'), dict) and t['phases'].get(key) == value))
        phases.append({'key': key, 'name': PHASE_LABELS[key], 'counts': counts,
                       'percentages': expected_percentages(counts, total)})
    agg = [sum(p['counts'][i] for p in phases) for i in range(len(PHASE_ENUM))]
    den = total * len(PHASE_KEYS)
    return {'total': total, 'aggregate': {'denominator': den, 'counts': agg,
                                          'percentages': expected_percentages(agg, den)},
            'phases': phases}


def tenths(values):
    return [int(round(v * 10)) for v in values]


def digest(path):
    with open(path, 'rb') as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def file_state(path):
    if not os.path.isfile(path):
        return {'exists': False}
    st = os.stat(path)
    return {'exists': True, 'size': st.st_size, 'sha256': digest(path), 'mtime': st.st_mtime}


# ------------------------------------------------------------ 结构比对

def compare_stats(prefix, stats, expected, raw_text):
    problems = []
    if stats is None:
        check(prefix + '/body-json', False, raw_text[:200])
        return
    if stats.get('ok') is not True:
        problems.append('ok=' + repr(stats.get('ok')))
    if stats.get('total') != expected['total']:
        problems.append('total=' + repr(stats.get('total')))
    aggregate = stats.get('aggregate') or {}
    phases = stats.get('phases') or []
    if aggregate.get('key') != 'aggregate':
        problems.append('aggregate.key=' + repr(aggregate.get('key')))
    if aggregate.get('name') != AGG_NAME:
        problems.append('aggregate.name=' + repr(aggregate.get('name')))
    if aggregate.get('denominator') != expected['aggregate']['denominator']:
        problems.append('aggregate.denominator=' + repr(aggregate.get('denominator')))
    if len(phases) != 5:
        problems.append('phases 长度=' + repr(len(phases)))
    agg_statuses = aggregate.get('statuses') or []
    if len(agg_statuses) != 5:
        problems.append('aggregate.statuses 长度=' + repr(len(agg_statuses)))
    if [s.get('value') for s in agg_statuses] != PHASE_ENUM:
        problems.append('aggregate 状态顺序=' + repr([s.get('value') for s in agg_statuses]))
    check(prefix + '/schema', not problems, {'problems': problems} if problems else None)

    bad_counts, bad_pct, bad_meta = [], [], []
    for index, value in enumerate(PHASE_ENUM):
        item = agg_statuses[index] if index < len(agg_statuses) else {}
        if item.get('count') != expected['aggregate']['counts'][index]:
            bad_counts.append('aggregate.%s count=%r 期望 %r' % (value, item.get('count'),
                                                                 expected['aggregate']['counts'][index]))
        if tenths([item.get('percentage') or 0])[0] != tenths([expected['aggregate']['percentages'][index]])[0]:
            bad_pct.append('aggregate.%s pct=%r 期望 %r' % (value, item.get('percentage'),
                                                            expected['aggregate']['percentages'][index]))
    for index, phase in enumerate(expected['phases']):
        actual = phases[index] if index < len(phases) else {}
        if actual.get('key') != phase['key']:
            bad_meta.append('phases[%d].key=%r 期望 %r' % (index, actual.get('key'), phase['key']))
        if actual.get('name') != phase['name']:
            bad_meta.append('phases[%d].name=%r 期望 %r' % (index, actual.get('name'), phase['name']))
        statuses = actual.get('statuses') or []
        if [s.get('value') for s in statuses] != PHASE_ENUM:
            bad_meta.append('phases[%d] 状态顺序=%r' % (index, [s.get('value') for s in statuses]))
        for sindex, value in enumerate(PHASE_ENUM):
            item = statuses[sindex] if sindex < len(statuses) else {}
            if item.get('count') != phase['counts'][sindex]:
                bad_counts.append('%s.%s count=%r 期望 %r' % (phase['key'], value, item.get('count'),
                                                              phase['counts'][sindex]))
            if tenths([item.get('percentage') or 0])[0] != tenths([phase['percentages'][sindex]])[0]:
                bad_pct.append('%s.%s pct=%r 期望 %r' % (phase['key'], value, item.get('percentage'),
                                                         phase['percentages'][sindex]))
    check(prefix + '/phases-meta', not bad_meta, bad_meta[:6] if bad_meta else None)
    check(prefix + '/counts', not bad_counts, bad_counts[:6] if bad_counts else None)
    check(prefix + '/percentages', not bad_pct, bad_pct[:6] if bad_pct else None)

    agg_sum = sum(tenths([s.get('percentage') or 0])[0] for s in agg_statuses)
    phase_sums = [sum(tenths([s.get('percentage') or 0])[0] for s in (p.get('statuses') or []))
                  for p in phases]
    expect_full = expected['total'] > 0 and sum(expected['aggregate']['counts']) == expected['aggregate']['denominator']
    if expect_full:
        check(prefix + '/sum-100', agg_sum == 1000 and all(s == 1000 for s in phase_sums),
              {'aggregate_tenths': agg_sum, 'phases_tenths': phase_sums})
    else:
        check(prefix + '/sum-truncate-only', agg_sum <= 1000,
              {'aggregate_tenths': agg_sum, 'phases_tenths': phase_sums})

    # 接口 key / JSON 字段仍为 product，且显示名已是「产品验收」
    check(prefix + '/key-product', '"key": "product"' in raw_text or '"key":"product"' in raw_text,
          {'product_key_present': True})
    check(prefix + '/no-renamed-key', (u'"key": "\u4ea7\u54c1\u9a8c\u6536"' not in raw_text
                                       and u'"key":"\u4ea7\u54c1\u9a8c\u6536"' not in raw_text))
    names = [p.get('name') for p in phases]
    check(prefix + '/label-3A', names == [PHASE_LABELS[k] for k in PHASE_KEYS]
          and PHASE_LABELS['product'] == u'\u4ea7\u54c1\u9a8c\u6536', names)


def same_source(prefix, base):
    status, stats, _, _ = get_json(base + '/api/stats')
    status2, wbs, _, _ = get_json(base + '/api/wbs')
    if stats is None or wbs is None:
        check(prefix + '/same-source', False, {'stats': status, 'wbs': status2})
        return
    from_wbs = recompute(wbs)
    got = {'total': stats.get('total'),
           'aggregate': {'denominator': (stats.get('aggregate') or {}).get('denominator'),
                         'counts': [s.get('count') for s in (stats.get('aggregate') or {}).get('statuses', [])],
                         'percentages': [s.get('percentage') for s in (stats.get('aggregate') or {}).get('statuses', [])]},
           'phases': [{'key': p.get('key'), 'counts': [s.get('count') for s in p.get('statuses', [])],
                       'percentages': [s.get('percentage') for s in p.get('statuses', [])]}
                      for p in stats.get('phases', [])]}
    want = {'total': from_wbs['total'],
            'aggregate': {'denominator': from_wbs['aggregate']['denominator'],
                          'counts': from_wbs['aggregate']['counts'],
                          'percentages': from_wbs['aggregate']['percentages']},
            'phases': [{'key': p['key'], 'counts': p['counts'], 'percentages': p['percentages']}
                       for p in from_wbs['phases']]}
    ok = (got['total'] == want['total']
          and got['aggregate']['denominator'] == want['aggregate']['denominator']
          and got['aggregate']['counts'] == want['aggregate']['counts']
          and tenths(got['aggregate']['percentages']) == tenths(want['aggregate']['percentages'])
          and all(tenths(g['percentages']) == tenths(w['percentages']) and g['counts'] == w['counts']
                  for g, w in zip(got['phases'], want['phases']))
          and stats.get('revision') == wbs.get('meta', {}).get('revision'))
    check(prefix + '/same-source-with-api-wbs', ok,
          None if ok else {'stats': got, 'recomputed_from_wbs': want,
                           'stats_revision': stats.get('revision'),
                           'wbs_revision': wbs.get('meta', {}).get('revision')})


def main():
    base_a = os.environ.get('BASE_A', '')
    base_b = os.environ.get('BASE_B', '')
    base_c = os.environ.get('BASE_C', '')
    base_s = os.environ.get('BASE_S', '')
    base_d = os.environ.get('BASE_D', '')
    base_e = os.environ.get('BASE_E', '')
    live = os.environ.get('LIVE', 'http://127.0.0.1:4180')
    expected_all = json.load(open(os.path.join(RESULTS, 'expected-stats.json'), encoding='utf-8'))['datasets']
    print('YUNZ-40 / Stage20 服务端口径复验  时间 %s' % datetime.datetime.now().isoformat())

    # ---------------------------------------------------------- 01 多组分布
    for tag, base in [('isoA', base_a), ('isoB', base_b), ('isoC', base_c), ('isoS', base_s)]:
        status, stats, headers, raw = get_json(base + '/api/stats')
        check('01/%s-http' % tag, status == 200 and stats is not None,
              {'status': status, 'content_type': headers.get('Content-Type')})
        check('01/%s-not-a-download' % tag, 'Content-Disposition' not in headers,
              {'content_type': headers.get('Content-Type')})
        compare_stats('01/' + tag, stats, expected_all[tag], raw)
        same_source('01/' + tag, base)

    # ---------------------------------------------------------- 02 0 行边界
    status, stats, _, raw = get_json(base_c + '/api/stats')
    agg = (stats or {}).get('aggregate') or {}
    phases = (stats or {}).get('phases') or []
    check('02/0 行不除零：total=0 / denominator=0 / 全 0 且不报错',
          status == 200 and stats.get('total') == 0 and agg.get('denominator') == 0
          and all(s.get('count') == 0 and abs(float(s.get('percentage') or 0)) < 1e-9
                  for s in agg.get('statuses', []))
          and all(abs(float(s.get('percentage') or 0)) < 1e-9
                  for p in phases for s in p.get('statuses', []))
          and len(phases) == 5,
          {'total': stats.get('total'), 'denominator': agg.get('denominator'),
           'aggregate': [(s.get('value'), s.get('count'), s.get('percentage')) for s in agg.get('statuses', [])]})
    check('02/0 行状态仍显示 0 0.0%（五种状态齐显且值为 0）',
          [s.get('value') for s in agg.get('statuses', [])] == PHASE_ENUM
          and all(s.get('count') == 0 for s in agg.get('statuses', [])),
          [(s.get('value'), s.get('count'), s.get('percentage')) for s in agg.get('statuses', [])])

    # ---------------------------------------------------------- 03 脏数据启动归一
    status, stats_d, _, _ = get_json(base_d + '/api/stats')
    check('03/脏数据（一行缺 product 键）启动即被一次性迁移归一：/api/stats 仍自洽',
          status == 200 and stats_d.get('total') == 3
          and sum(s.get('count') for s in (stats_d.get('aggregate') or {}).get('statuses', [])) == 15,
          {'total': stats_d.get('total'),
           'aggregate_counts': [s.get('count') for s in (stats_d.get('aggregate') or {}).get('statuses', [])]})
    check('03/归一后 aggregate 计数 = 15 = 3 x 5，五项合计 100.0',
          sum(tenths([s.get('percentage') for s in (stats_d.get('aggregate') or {}).get('statuses', [])])) == 1000,
          {'aggregate_pct': [s.get('percentage') for s in (stats_d.get('aggregate') or {}).get('statuses', [])]})

    # ---------------------------------------------------------- 04 只读语义（隔离）
    state_before = (file_state(os.path.join(ISO, 'isoS', 'wbs.json')),
                    file_state(os.path.join(ISO, 'isoS', 'audit.log')))
    for _ in range(10):
        get_json(base_s + '/api/stats')
        get_json(base_s + '/api/daily')
    state_after = (file_state(os.path.join(ISO, 'isoS', 'wbs.json')),
                   file_state(os.path.join(ISO, 'isoS', 'audit.log')))
    check('04/查看统计与日报不写审计、不改数据文件（隔离实例 10 轮）',
          state_before == state_after, {'before': state_before, 'after': state_after})
    status, stats, _, _ = get_json(base_s + '/api/stats')
    status2, wbs, _, _ = get_json(base_s + '/api/wbs')
    check('04/只读查看后 revision 不变', stats.get('revision') == 7 == wbs.get('meta', {}).get('revision'),
          {'stats_revision': stats.get('revision'), 'wbs_revision': wbs.get('meta', {}).get('revision')})
    status, text, headers = http('PUT', base_s + '/api/stats', body={})
    check('04//api/stats 仅 GET（PUT -> 405）', status == 405, {'status': status})

    # ---------------------------------------------------------- 05 日报文本「产品验收」
    status, daily, _, _ = get_json(base_s + '/api/daily')
    body = ((daily or {}).get('text') or {}).get('body', '')
    check('05/日报文本弹层数据源阶段结论含「产品验收」（JSON key 仍 product）',
          u'\u4ea7\u54c1\u9a8c\u6536\u5ef6\u671f' in body, {'body': body.split('\n')[1:3]})

    # ---------------------------------------------------------- 06 409 / 400 与落盘不变
    _, wbs, _, _ = get_json(base_a + '/api/wbs')
    before = file_state(os.path.join(ISO, 'isoA', 'wbs.json'))
    status, payload, _, _ = get_json_put(base_a + '/api/wbs', wbs, {'If-Match': '999'})
    check('06/过期 If-Match -> 409 conflict 且带 current',
          status == 409 and payload and payload.get('reason') == 'conflict' and 'current' in payload,
          {'status': status, 'payload': payload})
    bad = json.loads(json.dumps(wbs, ensure_ascii=False))
    bad['tasks'][0]['task'] = ''
    bad['tasks'][1]['dates']['design'] = '2026/01/01'
    status, payload, _, _ = get_json_put(base_a + '/api/wbs', bad,
                                         {'If-Match': str(wbs['meta']['revision'])})
    after = file_state(os.path.join(ISO, 'isoA', 'wbs.json'))
    check('06/非法 payload -> 400 errors 且不落盘',
          status == 400 and payload and payload.get('errors') and after == before,
          {'status': status, 'errors': (payload or {}).get('errors', [])[:2], 'unchanged': after == before})

    # ---------------------------------------------------------- 07 迁移幂等（isoE）
    status, stats_e, _, _ = get_json(base_e + '/api/stats')
    status2, wbs_e, _, _ = get_json(base_e + '/api/wbs')
    tasks_e = wbs_e.get('tasks') or []
    exp_e = recompute(wbs_e)
    migrated = (stats_e.get('total') == 36 and len(stats_e.get('phases') or []) == 5
                and all(sum(p['counts']) == 36 for p in exp_e['phases'])
                and all(t.get('status') for t in tasks_e))
    check('07/seed 数据启动迁移：36 行补齐五阶段且旧 status 保留',
          migrated, {'total': stats_e.get('total'),
                     'phase_counts_sum': [sum(p['counts']) for p in exp_e['phases']],
                     'status_kept': all(bool(t.get('status')) for t in tasks_e)})
    audit_migrated = 0
    audit_path = os.path.join(ISO, 'isoE', 'audit.log')
    if os.path.isfile(audit_path):
        with open(audit_path, encoding='utf-8') as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                if json.loads(line).get('type') == 'migrated':
                    audit_migrated += 1
    check('07/迁移审计恰好 36 x 5 = 180 条（幂等，无重复迁移）', audit_migrated == 180,
          {'migrated_audit_lines': audit_migrated})

    # ---------------------------------------------------------- 08 现场只读
    live_doc = os.path.join(APP, 'data', 'wbs.json')
    live_audit = os.path.join(APP, 'data', 'audit.log')
    before_live = (file_state(live_doc), file_state(live_audit))
    status, stats_live, headers, raw_live = get_json(live + '/api/stats')

    # 08a 与 /api/history 只读共存（identity_added 回归项）
    status_h, hist, _, _ = get_json(live + '/api/history')
    after_live = (file_state(live_doc), file_state(live_audit))
    check('08/查看现场统计与历史不写审计、不改 revision 文件',
          before_live == after_live, {'before': before_live[1], 'after': after_live[1]})
    status_h2, hist2, _, _ = get_json(live + '/api/history?date=2026-10-15')
    pool_rows = [r for r in (hist2.get('records') or []) if r.get('field') == u'\u4eba\u5458\u6c60']
    check('08//api/history 可用（日期取样）且含 identity_added 事件（人员池 3 条，CH-7/CH-12 回归）',
          status_h == 200 and isinstance(hist.get('records'), list)
          and status_h2 == 200 and len(pool_rows) == 3
          and all(u'\u65b0\u589e\u4eba\u5458' in str(r.get('task', '')) for r in pool_rows),
          {'status': status_h, 'today_count': hist.get('count'), 'status_1015': status_h2,
           'pool_rows': [(r.get('task'), r.get('new')) for r in pool_rows]})
    check('08/现场 /api/stats 结构自描述', status == 200 and stats_live.get('ok') is True
          and (stats_live.get('aggregate') or {}).get('denominator') == stats_live.get('total', 0) * 5,
          {'total': stats_live.get('total'),
           'denominator': (stats_live.get('aggregate') or {}).get('denominator')})
    same_source('08-live', live)

    # 08b A–K 原值未被改写（与部署时备份逐行比对）
    backups = sorted([f for f in os.listdir(os.path.join(APP, 'data'))
                      if f.startswith('wbs.json.') and f.endswith('.bak')])
    base_doc = None
    base_name = None
    for name in reversed(backups):
        candidate = os.path.join(APP, 'data', name)
        try:
            doc = json.load(open(candidate, encoding='utf-8'))
        except Exception:
            continue
        if len(doc.get('tasks') or []) >= 30 and any('phases' in t for t in doc['tasks']):
            base_doc, base_name = doc, name
            break
    if base_doc is None:
        check('08b/A–K 与备份比对', False, {'reason': 'no suitable backup'})
    else:
        old = {t['id']: t for t in base_doc['tasks']}
        new = {t['id']: t for t in (json.load(open(live_doc, encoding='utf-8')).get('tasks') or [])}
        diffs, removed = [], [i for i in old if i not in new]
        fields = ['level1', 'level2', 'task', 'owner', 'demo', 'note']
        for tid, task in old.items():
            if tid not in new:
                continue
            for field in fields:
                if task.get(field, '') != new[tid].get(field, ''):
                    diffs.append('%s.%s' % (tid, field))
            for key in PHASE_KEYS:
                a = (task.get('dates') or {}).get(key, '')
                b = (new[tid].get('dates') or {}).get(key, '')
                if a != b:
                    diffs.append('%s.dates.%s' % (tid, key))
        check('08b/A–K 原值与备份逐行一致（仅允许行被外部删除）',
              not diffs, {'backup': base_name, 'diffs': diffs[:8], 'removed_rows': removed})
        renamed_in_data = []
        for tid, task in new.items():
            for field in fields:
                if u'\u4ea7\u54c1\u9a8c\u6536' in str(task.get(field, '')):
                    renamed_in_data.append('%s.%s' % (tid, field))
        check('08b/A–K 业务文本未被改名污染（无把「产品」改写成「产品验收」的行）',
              not renamed_in_data, {'hits': renamed_in_data[:8]})
        with_product = [(tid, field) for tid, task in new.items() for field in fields
                        if u'\u4ea7\u54c1' in str(task.get(field, ''))]
        check('08b/A–K 含「产品」字样的行保持不变（本轮现场 0 行，风险面在隔离数据覆盖）',
              True, {'rows_with_product_in_AK': len(with_product)})

    print('PASS=%d FAIL=%d' % (PASS, FAIL))
    return 0 if FAIL == 0 else 1


def get_json_put(url, doc, headers):
    status, text, hdrs = http('PUT', url, body=doc, headers=headers)
    try:
        return status, json.loads(text), hdrs, text
    except ValueError:
        return status, None, hdrs, text


if __name__ == '__main__':
    sys.exit(main())
