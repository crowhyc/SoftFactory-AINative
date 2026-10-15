#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""YUNZ-32 / Stage12：CH-10 迁移隔离实例断言（Python 标准库）。"""
import io, json, os, sys, glob, hashlib, re, datetime

ST = '/opt/SoftFactory-AINative/artifacts/YUNZ-20/verification/stage12'
WORK = '/opt/SoftFactory-AINative/.multica-workspaces/yunzhidian-f03e0d551ffa/yunz-32-2cbfbb62fd57/workdir/scratch'
PRE = '/opt/wbs-rongcheng/data/wbs.json.20261015040405.bak'
MIG1 = WORK + '/stage12-mig1'
MIG3 = WORK + '/stage12-mig3'
PHASES = ['design', 'dev', 'test', 'product', 'demo_prep']
ENUM = ['未开始', '已开始', '已完成', '延期', '阻塞']
TODAY = '2026-10-15'          # 复验当日（Asia/Shanghai）
YESTERDAY = '2026-10-14'
DATE_RE = re.compile(r'^(\d{4})-(\d{2})-(\d{2})$')

def load(p):
    return json.load(io.open(p, encoding='utf-8'))

def jl(doc):
    return json.dumps(doc, ensure_ascii=False)

def valid(s):
    m = DATE_RE.match(str(s or ''))
    if not m:
        return False
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not (1 <= mo <= 12):
        return False
    try:
        datetime.date(y, mo, d)
        return True
    except ValueError:
        return False

def expect_phases(dates):
    out = {}
    for k in PHASES:
        p = (dates or {}).get(k, '') if isinstance(dates, dict) else ''
        out[k] = '延期' if (valid(p) and p < TODAY) else '未开始'
    return out

fails = []

def ck(name, cond, detail=''):
    print(('PASS  ' if cond else 'FAIL  ') + name + ('  :: ' + str(detail) if detail != '' else ''))
    if not cond:
        fails.append(name)

def wbs_from_api(p):
    return load(p)

def data_doc(d):
    return load(os.path.join(d, 'wbs.json'))

def audit_rows(d):
    rows = []
    with io.open(os.path.join(d, 'audit.log'), encoding='utf-8') as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except ValueError:
                pass
    return rows

def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as fh:
        h.update(fh.read())
    return h.hexdigest()

kind = sys.argv[1]
pre = load(PRE)
if kind == 'mig1-rev':
    cur = wbs_from_api(ST + '/results/iso-mig1-wbs.json')
    ck('mig1-rev', pre['meta']['revision'] == 9 and cur['meta']['revision'] == 10,
       'pre=%s cur=%s' % (pre['meta']['revision'], cur['meta']['revision']))
elif kind == 'mig1-phases-enum':
    cur = wbs_from_api(ST + '/results/iso-mig1-wbs.json')
    bad = []
    for t in cur['tasks']:
        ph = t.get('phases')
        if not isinstance(ph, dict) or list(ph.keys()) != PHASES:
            bad.append((t['id'], 'keys', ph if not isinstance(ph, dict) else list(ph.keys())))
            continue
        for k, v in ph.items():
            if v not in ENUM:
                bad.append((t['id'], k, v))
    ck('mig1-phases-enum', len(cur['tasks']) == 35 and not bad, 'rows=%d bad=%s' % (len(cur['tasks']), bad[:5]))
elif kind == 'mig1-algo':
    cur = wbs_from_api(ST + '/results/iso-mig1-wbs.json')
    bad = []
    for t in cur['tasks']:
        exp = expect_phases(t.get('dates'))
        got = t.get('phases') or {}
        if jl(exp) != jl(got):
            bad.append((t['id'], exp, got))
    ck('mig1-algo', not bad, 'bad=%s' % (bad[:3],))
elif kind == 'mig1-preserve':
    cur = wbs_from_api(ST + '/results/iso-mig1-wbs.json')
    pm = dict((t['id'], t) for t in pre['tasks'])
    bad = []
    for t in cur['tasks']:
        o = pm.get(t['id'])
        if o is None:
            bad.append((t['id'], 'missing-in-pre'))
            continue
        for f in ['level1', 'level2', 'task', 'owner', 'demo', 'note', 'status']:
            if t.get(f) != o.get(f):
                bad.append((t['id'], f, o.get(f), t.get(f)))
        if jl(t.get('dates')) != jl(o.get('dates')):
            bad.append((t['id'], 'dates'))
    ck('mig1-preserve', not bad, 'demo/status/dates diffs=%s' % (bad[:5],))
    ck('mig1-preserve-ids', len(cur['tasks']) == len(pre['tasks']) == 35, 'cur=%d pre=%d' % (len(cur['tasks']), len(pre['tasks'])))
elif kind == 'mig1-backup':
    baks = sorted(glob.glob(os.path.join(MIG1, 'wbs.json.20*.bak')))
    ok = len(baks) >= 1 and sha(baks[0]) == sha(PRE)
    rb = None
    if baks:
        rb = data_doc(MIG1) if False else load(baks[0])
    ck('mig1-backup', ok, 'backups=%s sha_match=%s' % ([os.path.basename(b) for b in baks], ok))
    ck('mig1-backup-rollback-state', bool(baks) and all('phases' not in t for t in rb['tasks']) and rb['meta']['revision'] == 9,
       'rev=%s has_phases=%s' % (rb['meta']['revision'] if rb else None, any('phases' in t for t in rb['tasks']) if rb else None))
elif kind == 'mig1-audit':
    rows = audit_rows(MIG1)
    mig = [r for r in rows if r.get('type') == 'migrated']
    keys = [(r.get('task_id'), r.get('phase')) for r in mig]
    cur = data_doc(MIG1)
    ph = dict((t['id'], t['phases']) for t in cur['tasks'])
    bad = [r for r in mig if r.get('identity') != '系统迁移' or r.get('field') != 'phases.' + str(r.get('phase')) + '.status'
           or r.get('old') != '' or r.get('new') != (ph.get(r.get('task_id')) or {}).get(r.get('phase'))]
    ck('mig1-audit-count', len(mig) == 175 and len(set(keys)) == 175,
       'migrated=%d unique=%d identity=%s' % (len(mig), len(set(keys)), sorted(set(r.get('identity') for r in mig))))
    ck('mig1-audit-fields', not bad, 'bad=%s' % (bad[:3],))
    ck('mig1-audit-per-phase', all(sum(1 for k in keys if k[1] == p) == 35 for p in PHASES),
       'per_phase=%s' % ({p: sum(1 for k in keys if k[1] == p) for p in PHASES},))
elif kind == 'mig1-daily':
    d = wbs_from_api(ST + '/results/iso-mig1-daily.json')
    bad = []
    for s in d.get('summary', []):
        txt = jl(s)
        if '系统迁移' in txt or 'migrated' in txt:
            bad.append(('summary', s.get('line', '')[:60]))
    for c in d.get('changes', []):
        if c.get('identity') == '系统迁移' or str(c.get('field', '')).startswith('phases.'):
            bad.append(('changes', c.get('field'), c.get('old'), c.get('new')))
    ck('mig1-daily-no-migration', not bad, 'counts=%s bad=%s' % (d.get('counts'), bad[:3]))
elif kind == 'mig3-boundary':
    cur = wbs_from_api(ST + '/results/iso-mig3-wbs.json')
    ids = [x['id'] for x in cur['tasks']]
    b1, b2 = ids[0], ids[1]
    t = dict((x['id'], x) for x in cur['tasks'])
    r1 = (t.get(b1) or {}).get('phases')
    r2 = (t.get(b2) or {}).get('phases')
    ck('mig3-boundary-row1', r1 == {'design': '延期', 'dev': '未开始', 'test': '未开始', 'product': '未开始', 'demo_prep': '未开始'},
       b1 + ' phases=%s' % (jl(r1),))
    ck('mig3-boundary-row2', r2 == dict((k, '未开始') for k in PHASES), b2 + ' phases=%s' % (jl(r2),))
elif kind == 'mig3-invalid':
    cur = wbs_from_api(ST + '/results/iso-mig3-wbs.json')
    ids = [x['id'] for x in cur['tasks']]
    b1, b2 = ids[0], ids[1]
    t = dict((x['id'], x) for x in cur['tasks'])
    t1 = t.get(b1) or {}
    ck('mig3-invalid-date', t1.get('dates', {}).get('demo_prep') == '2026-02-30' and t1.get('phases', {}).get('demo_prep') == '未开始',
       'dates.demo_prep=%s phases.demo_prep=%s' % (t1.get('dates', {}).get('demo_prep'), t1.get('phases', {}).get('demo_prep')))
    bad = [x['id'] for x in cur['tasks'] if jl(expect_phases(x.get('dates'))) != jl(x.get('phases'))]
    ck('mig3-algo-all', not bad, 'bad=%s' % (bad[:5],))
elif kind == 'mig3-audit':
    cur = data_doc(MIG3)
    rows = [r for r in audit_rows(MIG3) if r.get('type') == 'migrated']
    ck('mig3-audit', cur['meta']['revision'] == 10 and len(rows) == 175,
       'rev=%s migrated=%d' % (cur['meta']['revision'], len(rows)))
else:
    print('unknown assertion kind: ' + kind)
    sys.exit(2)

sys.exit(1 if fails else 0)
