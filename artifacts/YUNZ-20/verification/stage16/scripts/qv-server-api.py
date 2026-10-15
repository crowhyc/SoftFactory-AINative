# -*- coding: utf-8 -*-
"""YUNZ-36 / Stage16：保留项与不回归的服务端口径复跑。
现场只读：/api/health、/api/history、/api/daily 只读断言。
隔离实例 isoS（一次性容器，127.0.0.1:4263，数据目录挂宿主隔离路径）：
  审计继续写入 / identity_added 仍记录 / 409 并发不覆盖 / 400 非法输入不落盘 /
  原子写无残留 / 重启持久 / 变更后 dailyText 即时重算。
只用 Python 标准库；不触碰现场 4180 与现场数据。"""
import io, json, os, hashlib, subprocess, sys
import urllib.request, urllib.error, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
S16 = os.path.normpath(os.path.join(HERE, '..'))
ISO = os.path.join(S16, 'iso')
DATA = os.path.join(ISO, 'isoS')
PORT = int(os.environ.get('PORT', 4263))
BASE = 'http://127.0.0.1:%d' % PORT
LIVE = os.environ.get('LIVE', 'http://127.0.0.1:4180')
IMAGE = os.environ.get('IMAGE', 'mcr.microsoft.com/playwright:v1.55.0-jammy')
CONTAINER = 'qv36-apis'
LEADER = u'\u9879\u76ee\u8d1f\u8d23\u4eba'

PASS = 0
FAIL = 0
LOG = []

def check(cid, ok, detail=''):
    global PASS, FAIL
    line = ('PASS  ' if ok else 'FAIL  ') + cid + ('  :: ' + json.dumps(detail, ensure_ascii=False) if detail != '' else '')
    LOG.append(line)
    print(line)
    if ok:
        PASS += 1
    else:
        FAIL += 1

def req(base, method, path, body=None, headers=None):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    r = urllib.request.Request(base + path, data=data, method=method)
    r.add_header('Content-Type', 'application/json')
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            return resp.getcode(), json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8')
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {'raw': raw}

def docker(args):
    p = subprocess.Popen(['docker'] + args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    out = p.communicate()[0].decode('utf-8', 'replace')
    if p.returncode != 0:
        raise RuntimeError('docker %s failed: %s' % (' '.join(args[:3]), out))
    return out

def stop():
    subprocess.call(['docker', 'rm', '-f', CONTAINER], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

def start():
    stop()
    docker(['run', '-d', '--name', CONTAINER,
            '-e', 'WBS_DATA_DIR=/data', '-e', 'WBS_PORT=%d' % PORT, '-e', 'WBS_HOST=0.0.0.0',
            '-p', '127.0.0.1:%d:%d' % (PORT, PORT),
            '-v', DATA + ':/data', '-v', '/opt/wbs-rongcheng:/app:ro',
            IMAGE, 'node', '/app/server.js'])
    for _ in range(80):
        try:
            with urllib.request.urlopen(BASE + '/api/health', timeout=3) as r:
                if r.getcode() == 200:
                    return True
        except Exception:
            pass
        import time
        time.sleep(0.25)
    return False

def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        h.update(f.read())
    return h.hexdigest()

def audit_lines():
    p = os.path.join(DATA, 'audit.log')
    with io.open(p, encoding='utf-8') as f:
        return [json.loads(x) for x in f.read().split('\n') if x.strip()]

def live_checks():
    code, health = req(LIVE, 'GET', '/api/health')
    check('API-01 现场 /api/health ok 且带 revision', code == 200 and health.get('ok') is True and isinstance(health.get('revision'), int), health)
    code, hist = req(LIVE, 'GET', '/api/history?tz=Asia%2FShanghai&date=2026-10-15')
    check('API-02 现场 /api/history 仍可用（ok + records）', code == 200 and hist.get('ok') is True and isinstance(hist.get('records'), list),
          {'count': hist.get('count')})
    code, daily = req(LIVE, 'GET', '/api/daily?tz=Asia%2FShanghai&date=2026-10-15')
    t = daily.get('text') or {}
    body = t.get('body', '')
    lines = body.split('\n')
    check('API-03 现场 /api/daily 返回 text.body 单字符串（与弹层同源）', code == 200 and isinstance(body, str) and body != '', {'len': len(body)})
    check('API-04 现场 text.lines 数 == delayedCount + blockedCount == 事件行数',
          len(t.get('lines', [])) == (t.get('delayedCount', -1) + t.get('blockedCount', -1)) == (len(lines) - 1),
          {'lines': len(t.get('lines', [])), 'delayed': t.get('delayedCount'), 'blocked': t.get('blockedCount'), 'bodyLines': len(lines)})
    check('API-05 现场 text.overview == body 首行', lines[0] == t.get('overview'), {'first': lines[0], 'overview': t.get('overview')})
    check('API-06 现场 /api/daily 不含任何文件 / 下载字段（无 fileName / bytes / xlsx）',
          not any(k in json.dumps(daily, ensure_ascii=False) for k in ['fileName', 'fileBase64', 'xlsx']), None)
    code, xd = req(LIVE, 'GET', '/api/daily.xlsx')
    check('API-07 现场不再存在日报文件端点（/api/daily.xlsx 非 200）', code != 200, {'code': code})

def iso_checks():
    if not start():
        check('API-08 隔离实例启动', False, 'container failed to start')
        return
    check('API-08 隔离实例启动（WBS_HOST=0.0.0.0，绑 127.0.0.1:%d）' % PORT, True, None)
    code, doc = req(BASE, 'GET', '/api/wbs')
    rev0 = doc['meta']['revision']
    check('API-09 隔离实例初始 revision == 10', code == 200 and rev0 == 10, {'revision': rev0})

    def put(doc_obj, rev, identity=LEADER):
        # HTTP 头只允许 Latin-1，身份按前端约定用 URL 编码传递（服务端 decodeIdentity 解码）。
        return req(BASE, 'PUT', '/api/wbs', doc_obj,
                   {'If-Match': str(rev), 'X-Identity': urllib.parse.quote(identity.encode('utf-8'))})

    # 无 If-Match → 409
    code, r = req(BASE, 'PUT', '/api/wbs', doc, {'X-Identity': urllib.parse.quote(LEADER.encode('utf-8'))})
    check('API-10 缺 If-Match → 409 conflict', code == 409 and r.get('reason') == 'conflict', {'code': code, 'r': r})
    # 过期 If-Match → 409
    code, r = put(doc, rev0 - 1)
    check('API-11 过期 If-Match → 409 且不覆盖', code == 409 and r.get('reason') == 'conflict', {'code': code, 'r': r})
    # 非法 payload → 400 且不落盘
    bad = json.loads(json.dumps(doc))
    bad['tasks'][0]['phases']['design'] = u'不存在状态'
    before = sha(os.path.join(DATA, 'wbs.json'))
    code, r = put(bad, rev0)
    after = sha(os.path.join(DATA, 'wbs.json'))
    check('API-12 非法 payload → 400 且不落盘（wbs.json 逐字节不变）',
          code == 400 and bool(r.get('errors')) and before == after, {'code': code, 'errors': (r.get('errors') or [])[:2], 'unchanged': before == after})

    # 合法 PUT：T-A2 design 阻塞 → 已完成（写入 + 审计）
    n_before = len(audit_lines())
    doc2 = json.loads(json.dumps(doc))
    for tk in doc2['tasks']:
        if tk['id'] == 'T-A2':
            tk['phases']['design'] = u'已完成'
    code, r = put(doc2, rev0)
    rev1 = doc2['meta']['revision'] + 1
    check('API-13 合法 PUT → 200 {ok, revision}', code == 200 and r.get('ok') is True and r.get('revision') == rev1, {'code': code, 'r': r})
    entries = audit_lines()
    last = entries[-1]
    check('API-14 保留项：服务端审计继续写入（audit.log 新增一条含 old/new/snapshot）',
          len(entries) == n_before + 1 and isinstance(last.get('new'), dict) and isinstance(last.get('old'), dict) and isinstance(last.get('snapshot'), dict),
          {'added': len(entries) - n_before, 'keys': sorted(last.keys())})
    code, hist = req(BASE, 'GET', '/api/history?tz=Asia%2FShanghai&date=2026-10-15')
    recs = [x for x in hist.get('records', []) if x.get('task_id') == 'T-A2' and x.get('field') == 'phases.design.status' and x.get('new') == u'已完成']
    check('API-15 /api/history 反映本次变更（T-A2 phases.design.status → 已完成）', len(recs) >= 1, {'matched': len(recs)})

    # 变更后 dailyText 即时重算：T-A2 设计不再出现（已完成）
    code, daily2 = req(BASE, 'GET', '/api/daily?tz=Asia%2FShanghai&date=2026-10-15')
    body2 = daily2['text']['body']
    check('API-16 变更后 dailyText 即时重算：T-A2 设计行消失（已完成不判延期 / 不判阻塞）',
          u'乙级 / 乙子 / 开发任务 @李明：设计' not in body2 and u'乙级 / 乙子 / 开发任务 @李明：开发阻塞。' in body2,
          body2.split('\n')[:4])

    # identity_added：项目负责人新增人员 → 审计 + /api/history；非项目负责人 → 403
    doc3 = json.loads(json.dumps(doc2))
    doc3['identities'] = list(doc3['identities']) + [u'新同事X']
    n_before = len(audit_lines())
    code, r = put(doc3, rev1)
    rev2 = rev1 + 1
    check('API-17 项目负责人新增人员 → 200', code == 200 and r.get('revision') == rev2, {'code': code, 'r': r})
    added = [e for e in audit_lines() if e.get('type') == 'identity_added']
    check('API-18 保留项：identity_added 审计仍写入', len(added) >= 1 and added[-1].get('name') == u'新同事X', {'added': len(added)})
    code, hist = req(BASE, 'GET', '/api/history?tz=Asia%2FShanghai&date=2026-10-15')
    pooled = [x for x in hist.get('records', []) if x.get('field') == u'\u4eba\u5458\u6c60']
    check('API-19 /api/history 含身份新增记录（field=人员池）', len(pooled) >= 1, {'matched': len(pooled)})
    doc4 = json.loads(json.dumps(doc3))
    doc4['identities'] = list(doc4['identities']) + [u'越权人员']
    code, r = put(doc4, rev2, identity=u'王言')
    check('API-20 非项目负责人新增人员 → 403 且不落盘', code == 403 and r.get('reason') == 'forbidden', {'code': code, 'r': r})

    # 原子写无残留
    leftovers = [n for n in os.listdir(DATA) if n.startswith('wbs.json.') and n.endswith('.tmp')]
    check('API-21 原子写无 .tmp 残留', leftovers == [], leftovers)

    # 重启持久
    stop()
    if not start():
        check('API-22 重启后服务可用', False, 'restart failed')
    else:
        code, doc_r = req(BASE, 'GET', '/api/wbs')
        ids = [t['id'] for t in doc_r.get('tasks', [])]
        check('API-22 重启后数据持久（revision=%d、T-A2 设计=已完成、新增人员仍在）' % rev2,
              code == 200 and doc_r['meta']['revision'] == rev2 and
              any(t['id'] == 'T-A2' and t['phases']['design'] == u'已完成' for t in doc_r['tasks']) and
              u'新同事X' in doc_r['identities'], {'revision': doc_r['meta']['revision'], 'tasks': len(ids)})
    stop()

def main():
    live_checks()
    iso_checks()
    out = os.path.join(S16, 'results', 'server-api-results.json')
    with io.open(out, 'w', encoding='utf-8') as f:
        f.write(json.dumps({'pass': PASS, 'fail': FAIL, 'log': LOG}, ensure_ascii=False, indent=2))
    print('\n[server-api] PASS=%d FAIL=%d' % (PASS, FAIL))
    return 0 if FAIL == 0 else 1

if __name__ == '__main__':
    sys.exit(main())
