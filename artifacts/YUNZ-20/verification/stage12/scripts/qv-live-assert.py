#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import io, json, os, sys, hashlib, subprocess
ST = '/opt/SoftFactory-AINative/artifacts/YUNZ-20/verification/stage12'
SNAP = '/opt/SoftFactory-AINative/artifacts/YUNZ-20/wbs-rongcheng'
PRE = '/opt/wbs-rongcheng/data/wbs.json.20261015040405.bak'
PHASES = ['design', 'dev', 'test', 'product', 'demo_prep']
ENUM = ['未开始', '已开始', '已完成', '延期', '阻塞']
fails = []
def load(p): return json.load(io.open(p, encoding='utf-8'))
def ck(n, c, d=''):
    print(('PASS  ' if c else 'FAIL  ') + n + ('  :: ' + str(d) if d != '' else ''))
    if not c: fails.append(n)
def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        h.update(f.read())
    return h.hexdigest()
kind = sys.argv[1]
api = load(ST + '/results/live-api-now.json')
disk = load(ST + '/isolated/live-disk-now.json')
pre = load(PRE)
if kind == 'demo-preserved':
    pm = dict((t['id'], t.get('demo')) for t in pre['tasks'])
    bad = [(t['id'], pm.get(t['id']), t.get('demo')) for t in api['tasks'] if t.get('demo') != pm.get(t['id'])]
    bad += [(t['id'], pm.get(t['id']), t.get('demo')) for t in disk['tasks'] if t.get('demo') != pm.get(t['id'])]
    ck('demo-preserved', not bad and len(api['tasks']) == len(pre['tasks']), {'rows': len(api['tasks']), 'nonself_empty': sum(1 for t in api['tasks'] if t.get('demo')), 'bad': bad[:5]})
elif kind == 'status-preserved':
    ps = dict((t['id'], t.get('status')) for t in pre['tasks'])
    bad = [(t['id'], ps.get(t['id']), t.get('status')) for t in api['tasks'] if t.get('status') != ps.get(t['id'])]
    ck('status-preserved', not bad and all(t.get('status') is not None for t in api['tasks']), {'bad': bad[:5], 'values': sorted(set(t.get('status') for t in api['tasks']))})
elif kind == 'phases-enum':
    bad = []
    for t in api['tasks']:
        ph = t.get('phases')
        if not isinstance(ph, dict) or list(ph.keys()) != PHASES or any(v not in ENUM for v in ph.values()):
            bad.append((t['id'], ph))
    ck('phases-enum', not bad and len(api['tasks']) == 35, {'bad': bad[:3]})
elif kind == 'dates-independent':
    pd = dict((t['id'], json.dumps(t.get('dates'), ensure_ascii=False, sort_keys=True)) for t in pre['tasks'])
    bad = [(t['id'], pd.get(t['id']), json.dumps(t.get('dates'), ensure_ascii=False, sort_keys=True)) for t in api['tasks'] if json.dumps(t.get('dates'), ensure_ascii=False, sort_keys=True) != pd.get(t['id'])]
    changed_after_only = [t['id'] for t in api['tasks'] if json.dumps(t.get('dates'), ensure_ascii=False, sort_keys=True) != pd.get(t['id'])]
    ck('dates-independent', not bad, {'dates': '与迁移前逐条一致（本轮现场未改日期）', 'diff': bad[:3], 'changed': changed_after_only[:5]})
elif kind == 'live-three-way':
    same = json.dumps(api, ensure_ascii=False, sort_keys=True) == json.dumps(disk, ensure_ascii=False, sort_keys=True)
    ck('live-three-way', same and api['meta']['revision'] == disk['meta']['revision'], {'api_rev': api['meta']['revision'], 'disk_rev': disk['meta']['revision'], 'identical': same})
elif kind == 'live-audit':
    rows = []
    for line in io.open('/opt/wbs-rongcheng/data/audit.log', encoding='utf-8'):
        line = line.strip()
        if line:
            try: rows.append(json.loads(line))
            except ValueError: pass
    mig = [r for r in rows if r.get('type') == 'migrated']
    baks = sorted([b for b in os.listdir('/opt/wbs-rongcheng/data') if b.startswith('wbs.json.2026') and b.endswith('.bak')])
    premig = '/opt/wbs-rongcheng/data/wbs.json.20261015040405.bak'
    ck('live-audit', len(mig) == 175 and all(r.get('identity') == '系统迁移' for r in mig) and sha(premig) == '8df26205246619c4ded1d393356b99afd1eee307e4799c820fdf1b31d85a83d0',
       {'migrated': len(mig), 'premig_sha': sha(premig), 'universal_backups': len(baks), 'bak': 'wbs.json.20261015040405.bak'})
elif kind == 'live-daily':
    import urllib.request
    raw = urllib.request.urlopen('http://127.0.0.1:4180/api/daily?date=2026-10-15', timeout=8).read().decode('utf-8')
    d = json.loads(raw)
    txt = json.dumps(d, ensure_ascii=False)
    ck('live-daily', '系统迁移' not in txt and 'migrated' not in txt and not any(c.get('field') == 'status' for c in d.get('changes', [])),
       {'counts': d.get('counts'), 'has_migrated': '系统迁移' in txt})
elif kind == 'served-assets':
    import urllib.request
    bad = []
    for rel in ['public/index.html', 'public/app.js', 'public/styles.css', 'public/template.xlsx']:
        served = urllib.request.urlopen('http://127.0.0.1:4180/' + rel.split('/')[-1], timeout=10).read()
        local = open(os.path.join(SNAP, rel), 'rb').read()
        if served != local:
            bad.append(rel)
    ck('served-assets', not bad, {'bad': bad, 'checked': ['index.html', 'app.js', 'styles.css', 'template.xlsx']})
elif kind == 'bind':
    env = subprocess.check_output(['docker', 'inspect', 'wbs-rongcheng', '--format', '{{json .Config.Env}}']).decode()
    net = subprocess.check_output(['docker', 'inspect', 'wbs-rongcheng', '--format', '{{.HostConfig.NetworkMode}}']).decode().strip()
    mounts = subprocess.check_output(['docker', 'inspect', 'wbs-rongcheng', '--format', '{{json .Mounts}}']).decode()
    import urllib.request
    ok1 = json.loads(urllib.request.urlopen('http://127.0.0.1:4180/api/health', timeout=5).read().decode())['ok']
    ok2 = json.loads(urllib.request.urlopen('http://0.0.0.0:4180/api/health', timeout=5).read().decode())['ok']
    ck('bind', 'WBS_HOST=0.0.0.0' in env and 'WBS_PORT=4180' in env and net == 'host' and ok1 and ok2 and '/opt/wbs-rongcheng/data' in mounts,
       {'env_host': 'WBS_HOST=0.0.0.0' in env, 'network': net, 'health_127': ok1, 'health_0_0_0_0': ok2, 'data_mount': '/opt/wbs-rongcheng/data' in mounts})
else:
    print('unknown kind ' + kind); sys.exit(2)
sys.exit(1 if fails else 0)
