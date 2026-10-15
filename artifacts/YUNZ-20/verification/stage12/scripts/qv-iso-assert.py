#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""YUNZ-32 / Stage12：隔离写入实例的审计 / 三端一致 / 并发 409 / 重启持久断言。"""
import io, json, os, sys, re
ST = '/opt/SoftFactory-AINative/artifacts/YUNZ-20/verification/stage12'
WORK = '/opt/SoftFactory-AINative/.multica-workspaces/yunzhidian-f03e0d551ffa/yunz-32-2cbfbb62fd57/workdir/scratch/stage12-write'
TODAY = '2026-10-15'
fails = []
def load(p): return json.load(io.open(p, encoding='utf-8'))
def ck(n, c, d=''):
    print(('PASS  ' if c else 'FAIL  ') + n + ('  :: ' + str(d) if d != '' else ''))
    if not c: fails.append(n)
def rows():
    out = []
    for line in io.open(os.path.join(WORK, 'audit.log'), encoding='utf-8'):
        line = line.strip()
        if not line: continue
        try: out.append(json.loads(line))
        except ValueError: pass
    return out
kind = sys.argv[1]
if kind == 'audit-phases':
    recs = [r for r in rows() if isinstance(r.get('new'), dict)]
    hits = []
    for r in recs:
        for tid, fields in r['new'].items():
            for f, v in fields.items():
                if f == 'phases.dev.status' and v == '延期':
                    hits.append((r.get('identity'), r.get('ts'), (r.get('old') or {}).get(tid, {}).get(f), v))
    hits2 = []
    for r in recs:
        for tid, fields in r['new'].items():
            for f, v in fields.items():
                if f == 'phases.test.status' and v == '阻塞':
                    hits2.append((r.get('identity'), r.get('ts'), (r.get('old') or {}).get(tid, {}).get(f), v))
    ok = (len(hits) == 1 and hits[0][0] == '项目负责人' and hits[0][2] == '未开始' and hits[0][1].startswith(TODAY)
          and len(hits2) == 1 and hits2[0][0] == '王言' and hits2[0][2] == '未开始' and hits2[0][1].startswith(TODAY))
    ck('audit-phases', ok, {'dev': hits, 'test': hits2})
elif kind == 'three-way':
    api = load(ST + '/results/iso-api-before-race.json')
    disk = load(os.path.join(WORK, 'wbs.json'))
    p1 = load(ST + '/results/iso-write-results.json')
    bad = []
    for t in api['tasks']:
        d = next((x for x in disk['tasks'] if x['id'] == t['id']), None)
        if d is None or json.dumps(d, ensure_ascii=False) != json.dumps(t, ensure_ascii=False):
            bad.append(t['id'])
    ck('three-way', not bad and api['meta']['revision'] == disk['meta']['revision'], {'api_rev': api['meta']['revision'], 'disk_rev': disk['meta']['revision'], 'bad': bad[:5]})
elif kind == 'demo-preserved':
    api = load(ST + '/results/iso-api-before-race.json')
    disk = load(os.path.join(WORK, 'wbs.json'))
    zs = [t for t in api['tasks'] if (t.get('demo') or '') != '']
    zs2 = [t for t in disk['tasks'] if (t.get('demo') or '') != '']
    init = load(ST + '/results/iso-api-initial.json')
    ck('demo-preserved', len(zs) == 1 and zs[0]['demo'] == '是' and len(zs2) == 1 and
       json.dumps([t.get('demo') for t in api['tasks']]) == json.dumps([t.get('demo') for t in init['tasks']]),
       {'api': [t['demo'] for t in zs], 'disk': [t['demo'] for t in zs2]})
elif kind == 'race-outcome':
    a = io.open(ST + '/results/race-code-a.txt').read().strip()
    b = io.open(ST + '/results/race-code-b.txt').read().strip()
    codes = sorted([a, b])
    ck('race-outcome', codes == ['200', '409'], {'a': a, 'b': b})
elif kind == 'race-nocover':
    after = load(ST + '/results/iso-api-after-race.json')
    before = load(ST + '/results/iso-api-before-race.json')
    a = io.open(ST + '/results/race-code-a.txt').read().strip()
    b = io.open(ST + '/results/race-code-b.txt').read().strip()
    winner = '已开始' if a == '200' else '阻塞'
    loser = '阻塞' if a == '200' else '已开始'
    val = after['tasks'][0]['phases']['design']
    ck('race-nocover', val == winner and after['meta']['revision'] == before['meta']['revision'] + 1,
       {'winner': winner, 'loser': loser, 'final': val, 'rev': after['meta']['revision']})
elif kind == 'stale-nocover':
    after = load(ST + '/results/iso-api-after-stale.json')
    prev = load(ST + '/results/iso-api-after-race.json')
    ck('stale-nocover', json.dumps(after, ensure_ascii=False) == json.dumps(prev, ensure_ascii=False),
       {'rev': after['meta']['revision'], 'design': after['tasks'][0]['phases']['design']})
elif kind == 'restart-persist':
    after = load(ST + '/results/iso-api-after-restart.json')
    pre = load(ST + '/isolated/iso-disk-pre-restart.json')
    ck('restart-persist', after['meta']['revision'] == pre['meta']['revision'] and
       json.dumps(after['tasks'], ensure_ascii=False) == json.dumps(pre['tasks'], ensure_ascii=False),
       {'api_rev': after['meta']['revision'], 'disk_rev': pre['meta']['revision']})
else:
    print('unknown kind ' + kind); sys.exit(2)
sys.exit(1 if fails else 0)
