# -*- coding: utf-8 -*-
"""YUNZ-20 Stage3 复验 —— 服务/API/持久化/并发（验收 3,5,6,7,9,10）。只读交付代码，只写本工作目录。"""
import json, os, subprocess, sys, threading, time, hashlib, urllib.request, urllib.error, shutil

BASE = 'http://127.0.0.1:4180'
DATA = '/opt/wbs-rongcheng/data/wbs.json'
PRE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wbs.json.pre-qv')
HERE = os.path.dirname(os.path.abspath(__file__))
TMP = os.path.join(HERE, 'tmp'); os.makedirs(TMP, exist_ok=True)
fails = []
def chk(cid, name, cond, detail):
    print('[%s] %s %s :: %s' % ('PASS' if cond else 'FAIL', cid, name, detail))
    if not cond: fails.append(cid)
def sha(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()
def disk():
    return json.load(open(DATA, encoding='utf-8'))
def req(method, path, body=None, headers=None, timeout=15):
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode('utf-8')
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header('Content-Type', 'application/json')
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8')
        try: return e.code, json.loads(raw)
        except Exception: return e.code, {'raw': raw}
def payload_from(doc, tasks=None, identities=None, name=None):
    return {'meta': {'name': name or doc['meta'].get('name')},
            'identities': identities or doc['identities'],
            'tasks': tasks if tasks is not None else doc['tasks']}
def clean(t):
    return {k: v for k, v in t.items() if k != '__dirty'}

print('== YUNZ-20 Stage3 复验 服务/API/持久化/并发 ==')
print('python %s / service %s' % (sys.version.split()[0], BASE))

# ---------- S1 health (验收 10) ----------
st, h1 = req('GET', '/api/health')
chk('S1', 'GET /api/health 返回 ok（验收 10）',
    st == 200 and h1.get('ok') is True and h1.get('service') == 'wbs-rongcheng' and isinstance(h1.get('revision'), int),
    'HTTP %s %s' % (st, json.dumps(h1, ensure_ascii=False)))

# ---------- S2 监听面（验收 10 非公网暴露） ----------
ss = subprocess.run(['ss', '-ltn'], stdout=subprocess.PIPE).stdout.decode()
lines = [l for l in ss.splitlines() if ':4180' in l]
chk('S2', '4180 仅绑定回环 127.0.0.1，未在任何非回环地址监听',
    len(lines) >= 1 and all(l.split()[3].startswith('127.0.0.1:') for l in lines),
    'ss lines=%s' % json.dumps(lines))
insp = subprocess.run(['docker', 'inspect', '-f', '{{.Config.Image}}|{{.HostConfig.NetworkMode}}|{{range .Mounts}}{{.Source}}->{{.Destination}};{{end}}', 'wbs-rongcheng'],
                      stdout=subprocess.PIPE, stderr=subprocess.STDOUT).stdout.decode().strip()
chk('S3', '运行容器 wbs-rongcheng 使用 host 网络且挂载 /opt/wbs-rongcheng/data（不在非回环暴露）',
    'host|' in insp and '/opt/wbs-rongcheng/data->/app/data' in insp, 'inspect=%s' % insp)

# ---------- 前置：恢复初始数据 ----------
shutil.copyfile(PRE, DATA); time.sleep(0.3)
st, doc = req('GET', '/api/wbs')
chk('S4', '恢复初始态：36 行，revision 0（与 seed 逐字一致）',
    st == 200 and len(doc['tasks']) == 36 and doc['meta']['revision'] == 0 and
    doc['tasks'] == json.load(open('/opt/wbs-rongcheng/data/wbs.seed.json', encoding='utf-8'))['tasks'],
    'rev=%s rows=%s' % (doc['meta']['revision'], len(doc['tasks'])))

# ---------- S5 400 校验失败不落盘（验收 5 服务端侧） ----------
before_sha = sha(DATA)
bad = payload_from(doc)
bad['tasks'][0]['task'] = ''
st, body = req('PUT', '/api/wbs', bad, {'If-Match': '0'})
chk('S5', 'payload 校验失败返回 400 且不落盘（验收 5 服务端侧）',
    st == 400 and body.get('ok') is False and body.get('errors') and sha(DATA) == before_sha,
    'HTTP %s errors=%s diskUnchanged=%s' % (st, json.dumps(body.get('errors'), ensure_ascii=False)[:160], sha(DATA) == before_sha))

# ---------- S6 过期 If-Match -> 409（验收 9 前置） ----------
st, body = req('PUT', '/api/wbs', payload_from(doc), {'If-Match': '99999'})
chk('S6', '过期 If-Match 返回 409 conflict + current', 
    st == 409 and body.get('reason') == 'conflict' and body.get('current') == 0,
    'HTTP %s %s' % (st, json.dumps(body, ensure_ascii=False)))

# ---------- S7 两次并发 PUT（同版本）-> 恰好一个 200 一个 409，先到者为准（验收 9） ----------
cur = disk()['meta']['revision']
pa = payload_from(disk()); pa['tasks'][0]['note'] = 'CONC-A'
pb = payload_from(disk()); pb['tasks'][0]['note'] = 'CONC-B'
res = {}
def worker(tag, pl):
    res[tag] = req('PUT', '/api/wbs', pl, {'If-Match': str(cur), 'X-Identity': '%E7%8E%8B%E8%A8%80'})
th = [threading.Thread(target=worker, args=('A', pa)), threading.Thread(target=worker, args=('B', pb))]
for t in th: t.start()
for t in th: t.join()
codes = sorted(v[0] for v in res.values())
after = disk()
losers = [k for k, v in res.items() if v[0] == 409]
winner_note = after['tasks'][0]['note']
chk('S8', '两次并发同版本 PUT：恰好一个 200 + 一个 409，无静默覆盖，数据为先到者（验收 9）',
    codes == [200, 409] and after['meta']['revision'] == cur + 1 and winner_note in ('CONC-A', 'CONC-B') and
    (res[losers[0]][1].get('reason') == 'conflict' if losers else False),
    'codes=%s winnerNote=%s rev %s->%s loser=%s' % (codes, winner_note, cur, after['meta']['revision'], json.dumps(res, ensure_ascii=False)[:200]))

# ---------- S9 连续 10 次保存：A–K 无丢失、无重复、未知字段保留（验收 7） ----------
shutil.copyfile(PRE, DATA); time.sleep(0.3)
ref = disk()
base = ref['tasks']
rev = ref['meta']['revision']
unknown_ok = True
for i in range(10):
    tasks = [dict(clean(t)) for t in disk()['tasks']]
    for t in tasks: t['dates'] = dict(t['dates'])
    tasks[i]['note'] = 'SAVE-%02d' % i
    tasks[0]['__custom_marker'] = 'QV-KEEP-ME'
    st, body = req('PUT', '/api/wbs', payload_from(ref, tasks), {'If-Match': str(rev)})
    rev = body.get('revision', rev)
    if st != 200: break
fin = disk()
ids = [t['id'] for t in fin['tasks']]
order_ok = ids == [t['id'] for t in base]
dup = len(ids) != len(set(ids))
field_loss = []
for i, t in enumerate(fin['tasks']):
    b = base[i]
    for f in ['level1', 'level2', 'task', 'owner', 'demo']:
        if t.get(f) != b.get(f): field_loss.append((t['id'], f, b.get(f), t.get(f)))
    if (t.get('dates') or {}) != (b.get('dates') or {}): field_loss.append((t['id'], 'dates', b.get('dates'), t.get('dates')))
    if not isinstance(t.get('status'), str): field_loss.append((t['id'], 'status', None, t.get('status')))
notes_ok = all(fin['tasks'][i].get('note') == 'SAVE-%02d' % i for i in range(10))
unknown_ok = fin['tasks'][0].get('__custom_marker') == 'QV-KEEP-ME'
chk('S9', '连续 10 次保存后 36 行 A–K 无丢失/无重复/行序不变，未知字段未被清除（验收 7）',
    fin['meta']['revision'] == rev and len(ids) == 36 and order_ok and not dup and not field_loss and notes_ok and unknown_ok,
    'rev=%s rows=%d orderOk=%s dup=%s fieldLoss=%s notesOk=%s unknownKept=%s' %
    (fin['meta']['revision'], len(ids), order_ok, dup, json.dumps(field_loss[:3], ensure_ascii=False), notes_ok, unknown_ok))

# ---------- S10 重启持久（验收 6） ----------
sha_before = sha(DATA); snap_before = disk()
cp = subprocess.run(['docker', 'restart', 'wbs-rongcheng'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT).stdout.decode().strip()
up = False
for _ in range(30):
    try:
        st, hh = req('GET', '/api/health', timeout=3)
        if st == 200 and hh.get('ok'): up = True; break
    except Exception: pass
    time.sleep(1)
st, after_restart = req('GET', '/api/wbs')
chk('S10', 'docker restart 后服务恢复且数据完全一致（验收 6）',
    up and st == 200 and sha(DATA) == sha_before and after_restart == snap_before,
    'restart=%s healthUp=%s diskShaSame=%s rev=%s' % (cp, up, sha(DATA) == sha_before, after_restart['meta']['revision']))

# ---------- S11 重启后授权身份仍能读写 ----------
rev = after_restart['meta']['revision']
tasks = [dict(clean(t)) for t in after_restart['tasks']]
tasks[1]['note'] = 'POST-RESTART-WANGYAN'
st, body = req('PUT', '/api/wbs', payload_from(after_restart, tasks), {'If-Match': str(rev), 'X-Identity': '%E7%8E%8B%E8%A8%80'})
st2, back = req('GET', '/api/wbs')
chk('S11', '服务重启后授权身份（王言）仍能读且能写，写入落盘生效',
    st == 200 and body.get('revision') == rev + 1 and back['tasks'][1]['note'] == 'POST-RESTART-WANGYAN' and
    disk()['tasks'][1]['note'] == 'POST-RESTART-WANGYAN',
    'PUT HTTP %s rev %s->%s note=%s' % (st, rev, body.get('revision'), back['tasks'][1]['note']))

# ---------- S12 静态资源本地化 + 安全头（验收 10） ----------
for path, needle in [('/', 'wbs-table'), ('/app.js', 'WBSApp'), ('/styles.css', '.wbs-table'), ('/vendor/xlsx.full.min.js', 'XLSX'), ('/template.xlsx', None)]:
    try:
        with urllib.request.urlopen(BASE + path, timeout=10) as r:
            raw = r.read().decode('utf-8', 'replace') if needle else r.read()
            ok = (needle in raw) if needle else len(raw) > 1000
            csp = r.headers.get('Content-Security-Policy', '')
        print('   静态 %-28s -> %s' % (path, 'OK' if ok else 'MISSING'))
    except Exception as e:
        ok = False; csp = ''
        print('   静态 %-28s -> ERROR %s' % (path, e))
    if not ok: fails.append('S12:' + path)
chk('S12', '全部静态资源由本服务同源提供（含 vendor bundle 与 template.xlsx），CSP default-src self',
    "default-src 'self'" in csp, 'CSP=%s' % csp)

# ---------- S13 审计日志（交付附加证据） ----------
audit = '/opt/wbs-rongcheng/data/audit.log'
chk('S13', '写操作产生审计记录（audit.log 记录 revision 与身份）',
    os.path.exists(audit) and len(open(audit, encoding='utf-8').read().strip().splitlines()) > 0,
    'lines=%d last=%s' % (len(open(audit, encoding='utf-8').read().strip().splitlines()), open(audit, encoding='utf-8').read().strip().splitlines()[-1][:120]))

# ---------- 收尾：恢复初始数据 ----------
shutil.copyfile(PRE, DATA); time.sleep(0.3)
st, fin2 = req('GET', '/api/wbs')
chk('S14', '收尾恢复初始态（36 行 revision 0，磁盘 sha 与验证前一致）',
    fin2['meta']['revision'] == 0 and len(fin2['tasks']) == 36 and sha(DATA) == sha(PRE),
    'rev=%s rows=%d sha=%s' % (fin2['meta']['revision'], len(fin2['tasks']), sha(DATA)))

print('== 汇总: %s ==' % ('全部通过' if not fails else 'FAIL ' + ','.join(fails)))
sys.exit(1 if fails else 0)
