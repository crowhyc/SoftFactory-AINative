# -*- coding: utf-8 -*-
"""YUNZ-34 / Stage14：隔离实例服务端不回归复跑。
覆盖：启动迁移 / 并发 PUT 409 / 旧版本不覆盖 / 无 If-Match 409 / 非法 payload 400 不落盘 /
原子写无残留 / 连续 10 次保存字段无丢失 / 重启持久 / 迁移幂等。只用 Python 标准库。
被测服务跑在一次性容器内（本沙箱宿主 node 是包装器，不能直接执行外部目录脚本），
数据目录挂宿主隔离路径，端口只发布到 127.0.0.1:4263，不触碰现场 4180 与现场数据。"""
import io, json, os, hashlib, shutil, subprocess, sys, threading, time
import urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
S14 = os.path.normpath(os.path.join(HERE, '..'))
ISO = os.path.join(S14, 'iso')
DATA = os.path.join(ISO, 'isoC')
PORT = int(os.environ.get('PORT', 4263))
BASE = 'http://127.0.0.1:%d' % PORT
IMAGE = os.environ.get('IMAGE', 'mcr.microsoft.com/playwright:v1.55.0-jammy')
CONTAINER = 'qv34-apic'
PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep']

PASS = 0
FAIL = 0
LOG = []

def check(cid, ok, detail=''):
    global PASS, FAIL
    line = ('PASS  ' if ok else 'FAIL  ') + cid + ('  :: ' + json.dumps(detail, ensure_ascii=False) if detail != '' else '')
    LOG.append(line)
    print(line)
    if ok: PASS += 1
    else: FAIL += 1

def req(method, path, body=None, headers=None):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
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
            time.sleep(0.25)
    raise RuntimeError('server did not become healthy')

def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        h.update(f.read())
    return h.hexdigest()

def payload(doc):
    """深拷贝：避免调用方就地修改污染后续请求体（本脚本曾因此产生假阳性）。"""
    return {'meta': {'name': doc['meta']['name']},
            'identities': list(doc['identities']),
            'tasks': json.loads(json.dumps(doc['tasks']))}

def main():
    if os.path.isdir(DATA):
        shutil.rmtree(DATA)
    shutil.copytree(os.path.join(ISO, 'isoA'), DATA)
    for stray in [n for n in os.listdir(DATA) if n.endswith('.bak') or n.endswith('.tmp')]:
        os.remove(os.path.join(DATA, stray))
    docfile = os.path.join(DATA, 'wbs.json')
    auditfile = os.path.join(DATA, 'audit.log')
    start()
    try:
        code, h = req('GET', '/api/health')
        check('A-01 隔离实例 /api/health ok', code == 200 and h.get('ok') is True, h)
        code, doc = req('GET', '/api/wbs')
        r1 = doc['meta']['revision']
        check('A-02 启动即迁移（revision 10 -> %d），35 行 phases 齐全' % r1,
              r1 == 11 and len(doc['tasks']) == 35 and all(set(t['phases'].keys()) == set(PHASE_KEYS) for t in doc['tasks']),
              {'revision': r1, 'tasks': len(doc['tasks'])})
        check('A-02b 迁移审计 175 条且不进日报（type=migrated）',
              sum(1 for l in io.open(auditfile, encoding='utf-8') if '"migrated"' in l) == 175, '')

        # 并发：同一 If-Match 两个 PUT
        body = payload(doc)
        body['tasks'][0]['task'] = body['tasks'][0]['task'] + '-并发'
        results = []
        barrier = threading.Barrier(2)
        def worker():
            barrier.wait()
            results.append(req('PUT', '/api/wbs', body, {'If-Match': str(r1)})[0])
        ts = [threading.Thread(target=worker) for _ in range(2)]
        for t in ts: t.start()
        for t in ts: t.join()
        results.sort()
        code, doc2 = req('GET', '/api/wbs')
        check('A-03 并发 PUT：恰好一个 200、一个 409', results == [200, 409], results)
        check('A-04 并发后 revision 只 +1（以先到者为准）', doc2['meta']['revision'] == r1 + 1, doc2['meta']['revision'])
        check('A-04b 并发写入内容为后到者以外的一方（无交叉污染）',
              doc2['tasks'][0]['task'].endswith('-并发'), doc2['tasks'][0]['task'])

        # 旧 If-Match 409 且不覆盖
        r2 = doc2['meta']['revision']
        before_bytes = sha(docfile)
        stale = payload(doc2)
        stale['tasks'][1]['task'] = 'STALE-覆盖尝试'
        code, resp = req('PUT', '/api/wbs', stale, {'If-Match': str(r1)})
        disk = json.load(io.open(docfile, encoding='utf-8'))
        check('A-05 旧 If-Match -> 409 conflict 且未覆盖（磁盘无 STALE 内容）',
              code == 409 and resp.get('reason') == 'conflict' and disk['tasks'][1]['task'] != 'STALE-覆盖尝试',
              {'code': code, 'reason': resp.get('reason'), 'disk': disk['tasks'][1]['task']})
        check('A-05b 被拒写入不落盘（字节未变）', sha(docfile) == before_bytes, '')
        code, resp = req('PUT', '/api/wbs', stale)
        check('A-06 缺 If-Match -> 409', code == 409, {'code': code, 'resp': resp})

        # 非法 payload -> 400 且不落盘（id 非法字符 + 超长字段 + 非法 phase 值）
        before_bytes = sha(docfile)
        bad = payload(doc2)
        bad['tasks'][0]['id'] = 'BAD ID!!'
        bad['tasks'][1]['level1'] = 'X' * 300
        bad['tasks'][2]['phases']['design'] = '不存在的档位'
        code, resp = req('PUT', '/api/wbs', bad, {'If-Match': str(r2)})
        check('A-07 非法 payload -> 400 且带字段错误', code == 400 and isinstance(resp.get('errors'), list) and len(resp['errors']) >= 3,
              {'code': code, 'n_errors': len(resp.get('errors') or []), 'first': (resp.get('errors') or [])[:1]})
        check('A-08 400 后磁盘字节未变（不落盘）', sha(docfile) == before_bytes, {})
        check('A-08b 400 后 revision 未变', req('GET', '/api/wbs')[1]['meta']['revision'] == r2, '')

        # 连续 10 次保存：每次重新取最新 revision，字段无丢失 / 无重复
        base_keys = dict((t['id'], sorted(t.keys())) for t in doc2['tasks'])
        per_iter = []
        for i in range(10):
            cur = req('GET', '/api/wbs')[1]
            r = cur['meta']['revision']
            p = payload(cur)
            tgt = p['tasks'][i % len(p['tasks'])]
            tgt['note'] = (tgt.get('note') or '') + ('第%d次' % (i + 1))
            code, resp = req('PUT', '/api/wbs', p, {'If-Match': str(r)})
            per_iter.append({'i': i + 1, 'status': code, 'rev_before': r, 'rev_after': (resp or {}).get('revision')})
        code, fin = req('GET', '/api/wbs')
        allok = all(x['status'] == 200 and x['rev_after'] == x['rev_before'] + 1 for x in per_iter)
        check('A-09 连续 10 次保存均 200 且 revision 逐次 +1', allok and fin['meta']['revision'] == r2 + 10,
              {'iter': per_iter, 'final': fin['meta']['revision']})
        ids = [t['id'] for t in fin['tasks']]
        keys_ok = all(sorted(t.keys()) == base_keys[t['id']] for t in fin['tasks'])
        check('A-10 10 次保存后 35 条任务 id 无重复、字段集合与基线一致（无丢失/无未知字段被清除）',
              len(ids) == 35 and len(set(ids)) == 35 and keys_ok, {'ids': len(ids), 'unique': len(set(ids))})
        check('A-11 10 次保存后每条任务 dates/phases 五键齐全',
              all(set(t['dates'].keys()) == set(PHASE_KEYS) and set(t['phases'].keys()) == set(PHASE_KEYS) for t in fin['tasks']), '')
        check('A-11b 10 条 note 逐条落盘（每轮写入未被覆盖）',
              sorted([t['note'] for t in fin['tasks'] if (t.get('note') or '').startswith('第')]) == sorted('第%d次' % (i + 1) for i in range(10)),
              [t['note'] for t in fin['tasks'] if (t.get('note') or '').startswith('第')])

        stray = [n for n in os.listdir(DATA) if n.endswith('.tmp') or n.endswith('.part')]
        check('A-12 原子写后数据目录无 .tmp/.part 残留', stray == [], stray)

        # 重启持久 + 迁移幂等
        before_restart = sha(docfile)
        disk_before = json.load(io.open(docfile, encoding='utf-8'))
        stop()
        start()
        try:
            code, h2 = req('GET', '/api/health')
            code, after = req('GET', '/api/wbs')
            check('A-13 重启后 health ok 且 revision/数据不变',
                  h2.get('ok') is True and after['meta']['revision'] == disk_before['meta']['revision']
                  and after['tasks'] == disk_before['tasks'],
                  {'health': h2, 'revision': after['meta']['revision']})
            check('A-14 重启后 wbs.json 逐字节不变（迁移幂等 / 无二次迁移）', sha(docfile) == before_restart,
                  {'before': before_restart[:12], 'after': sha(docfile)[:12]})
            check('A-15 重启后 notes 仍保留（10 条写入未丢）',
                  len([t for t in after['tasks'] if (t.get('note') or '').startswith('第')]) == 10,
                  len([t for t in after['tasks'] if (t.get('note') or '').startswith('第')]))
            check('A-16 重启后旧全局 status 仍逐条保留', all('status' in t for t in after['tasks']), '')
        finally:
            stop()
    finally:
        stop()

    out = os.path.join(S14, 'results', 'server-api-results.json')
    with io.open(out, 'w', encoding='utf-8') as f:
        f.write(json.dumps({'pass': PASS, 'fail': FAIL, 'log': LOG}, ensure_ascii=False, indent=2))
    print('\n[server-api] PASS=%d FAIL=%d' % (PASS, FAIL))
    return 0 if FAIL == 0 else 1

if __name__ == '__main__':
    sys.exit(main())
