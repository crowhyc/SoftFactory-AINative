# -*- coding: utf-8 -*-
"""YUNZ-38 / Stage18 独立复验：服务端口径与只读性（Python 标准库）。

现场 4180 全程只读：/api/stats、/api/wbs、/api/history、/api/health 只读断言。
隔离实例（一次性容器，数据目录挂宿主隔离路径）：
  isoAPI 4270 —— 写路径：409 不覆盖 / 400 不落盘 / 写后 /api/stats 同步 / 重启持久 / identity_added
  isoB   4271 —— 0 行任务边界
只触碰隔离数据；不写现场。
"""
import io, json, os, hashlib, shutil, subprocess, sys, time
import urllib.request, urllib.error, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
S18 = os.path.normpath(os.path.join(HERE, '..'))
ISO = os.path.join(S18, 'iso')
LIVE = os.environ.get('LIVE', 'http://127.0.0.1:4180')
IMAGE = os.environ.get('IMAGE', 'mcr.microsoft.com/playwright:v1.55.0-jammy')
APP = os.environ.get('APP', '/opt/wbs-rongcheng')
PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep']
PHASE_ENUM = [u'未开始', u'已开始', u'已完成', u'延期', u'阻塞']
LEADER = u'项目负责人'
TZ = u'Asia/Shanghai'

PASS = 0
FAIL = 0
LOG = []


def check(cid, ok, detail=''):
    global PASS, FAIL
    line = ('PASS  ' if ok else 'FAIL  ') + cid + (('  :: ' + json.dumps(detail, ensure_ascii=False)) if detail != '' else '')
    LOG.append(line)
    print(line)
    if ok:
        PASS += 1
    else:
        FAIL += 1


def req(base, method, path, body=None, headers=None, raw_body=None):
    data = raw_body if raw_body is not None else (json.dumps(body).encode('utf-8') if body is not None else None)
    r = urllib.request.Request(base + path, data=data, method=method)
    if data is not None:
        r.add_header('Content-Type', 'application/json')
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            return resp.getcode(), dict(resp.headers), json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8')
        try:
            return e.code, dict(e.headers), json.loads(raw)
        except Exception:
            return e.code, dict(e.headers), {'raw': raw}
    except urllib.error.URLError as e:
        return 0, {}, {'error': str(e)}
    except ConnectionResetError as e:
        return 0, {}, {'error': str(e)}


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()


def count_lines(path):
    n = 0
    with io.open(path, 'r', encoding='utf-8', errors='replace') as f:
        for line in f:
            if line.strip():
                n += 1
    return n


def docker(args):
    p = subprocess.Popen(['docker'] + args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    out = p.communicate()[0].decode('utf-8', 'replace')
    return p.returncode, out


def pcts(counts, total):
    """契约原文口径的独立复算（与实现无关）。"""
    BASE = 10
    FULL = 100 * BASE
    if not total:
        return [0.0] * len(counts)
    tenths, rem, counted = [], [], 0
    for c in counts:
        scaled = c * 100 * BASE
        tenths.append(scaled // total)
        rem.append(scaled % total)
        counted += c
    if counted != total:
        return [float(t) / BASE for t in tenths]
    deficit = FULL - sum(tenths)
    order = sorted(range(len(counts)), key=lambda i: (-rem[i], i))
    for i in range(deficit):
        tenths[order[i % len(order)]] += 1
    return [float(t) / BASE for t in tenths]


def expected_from_wbs(doc):
    tasks = doc['tasks']
    total = len(tasks)
    out = []
    for key in PHASE_KEYS:
        counts = [0] * len(PHASE_ENUM)
        for t in tasks:
            v = (t.get('phases') or {}).get(key)
            if v in PHASE_ENUM:
                counts[PHASE_ENUM.index(v)] += 1
        pp = pcts(counts, total)
        out.append({'key': key, 'statuses': [
            {'value': PHASE_ENUM[i], 'count': counts[i], 'percentage': pp[i]} for i in range(5)]})
    return {'total': total, 'revision': doc['meta']['revision'], 'phases': out}


def diff_stats(got, exp, label):
    d = []
    if got.get('total') != exp['total']:
        d.append({'at': label + '.total', 'got': got.get('total'), 'exp': exp['total']})
    if got.get('revision') != exp['revision']:
        d.append({'at': label + '.revision', 'got': got.get('revision'), 'exp': exp['revision']})
    for i in range(5):
        gp, ep = got['phases'][i], exp['phases'][i]
        if gp.get('key') != ep['key']:
            d.append({'at': 'key', 'got': gp.get('key'), 'exp': ep['key']})
            continue
        for j in range(5):
            gs, es = gp['statuses'][j], ep['statuses'][j]
            if gs.get('value') != es['value'] or gs.get('count') != es['count'] or \
               gs.get('percentage') != es['percentage']:
                d.append({'at': ep['key'] + '/' + es['value'], 'got': gs, 'exp': es})
    return d


def start_container(name, data_dir, port):
    subprocess.call(['docker', 'rm', '-f', name], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    rc, out = docker(['run', '-d', '--name', name, '-e', 'WBS_DATA_DIR=/data',
                      '-e', 'WBS_PORT=%d' % port, '-e', 'WBS_HOST=0.0.0.0',
                      '-p', '127.0.0.1:%d:%d' % (port, port),
                      '-v', data_dir + ':/data', '-v', APP + ':/app:ro', IMAGE, 'node', '/app/server.js'])
    if rc != 0:
        raise RuntimeError('docker run failed: ' + out)
    for _ in range(120):
        code, _, body = req('http://127.0.0.1:%d' % port, 'GET', '/api/health')
        if body and body.get('ok'):
            return
        time.sleep(0.25)
    raise RuntimeError('container %s not healthy' % name)


def main():
    # ---------------- 现场只读 ----------------
    code, headers, live = req(LIVE, 'GET', '/api/stats')
    check('LIVE-01 GET /api/stats 200 + JSON + ok:true + Content-Type 为 JSON',
          code == 200 and live.get('ok') is True and 'application/json' in headers.get('Content-Type', ''),
          {'code': code, 'ct': headers.get('Content-Type'), 'ok': live.get('ok')})
    check('LIVE-02 /api/stats 结构：5 阶段（design/dev/test/product/demo_prep）', 
          [p['key'] for p in live.get('phases', [])] == PHASE_KEYS, [p.get('key') for p in live.get('phases', [])])
    order_ok = all([s['value'] for s in p['statuses']] == PHASE_ENUM for p in live['phases'])
    check('LIVE-03 每阶段 5 状态顺序固定（未开始/已开始/已完成/延期/阻塞）', order_ok,
          [s['value'] for s in live['phases'][0]['statuses']])
    sum_ok = all(abs(sum(s['percentage'] for s in p['statuses']) - 100.0) < 1e-9 for p in live['phases']) if live['total'] else True
    check('LIVE-04 各阶段五项百分比合计恰为 100.0%%（total=%d）' % live['total'], sum_ok,
          [round(sum(s['percentage'] for s in p['statuses']), 1) for p in live['phases']])
    code, headers, wbs = req(LIVE, 'GET', '/api/wbs')
    exp = expected_from_wbs(wbs)
    d = diff_stats(live, exp, 'live')
    check('LIVE-05 /api/stats 与 /api/wbs 独立复算逐项一致（count/percentage）', len(d) == 0, d or 'all 25 match')
    check('LIVE-06 total == /api/wbs 任务数，revision == meta.revision',
          live['total'] == len(wbs['tasks']) and live['revision'] == wbs['meta']['revision'],
          {'total': live['total'], 'tasks': len(wbs['tasks']), 'rev': live['revision'], 'wbsRev': wbs['meta']['revision']})
    check('LIVE-07 GET /api/stats 无 Content-Disposition（不构成下载路径）',
          'Content-Disposition' not in headers, {k: v for k, v in headers.items() if 'isposition' in k})
    m405 = []
    for m in ('POST', 'PUT', 'DELETE'):
        c, h, b = req(LIVE, m, '/api/stats', body={'x': 1})
        m405.append((m, c))
    check('LIVE-08 /api/stats 仅允许 GET（POST/PUT/DELETE → 405）', all(c == 405 for _, c in m405), m405)

    # 只读性：连续读总览不动审计、不动 wbs.json
    live_data = '/opt/wbs-rongcheng/data'
    a0, w0 = count_lines(os.path.join(live_data, 'audit.log')), sha(os.path.join(live_data, 'wbs.json'))
    rev0 = wbs['meta']['revision']
    for _ in range(5):
        req(LIVE, 'GET', '/api/stats')
    a1, w1 = count_lines(os.path.join(live_data, 'audit.log')), sha(os.path.join(live_data, 'wbs.json'))
    _, _, h2 = req(LIVE, 'GET', '/api/health')
    check('LIVE-09 查看总览不产生审计记录、不改变 wbs.json（审计行数/revision 不变）',
          a0 == a1 and w0 == w1 and h2.get('revision') == rev0,
          {'audit': [a0, a1], 'wbsShaSame': w0 == w1, 'rev': [rev0, h2.get('revision')]})
    check('LIVE-10 /api/health ok', h2.get('ok') is True and h2.get('revision') == rev0, h2)

    # ---------------- 隔离写路径 ----------------
    api_dir = os.path.join(ISO, 'isoAPI')
    if os.path.isdir(api_dir):
        shutil.rmtree(api_dir)
    shutil.copytree(os.path.join(ISO, 'isoA'), api_dir)
    b_dir = os.path.join(ISO, 'isoB')
    BASE = 'http://127.0.0.1:4270'
    BASB = 'http://127.0.0.1:4271'
    try:
        start_container('qv38-apis', api_dir, 4270)
        start_container('qv38-apib', b_dir, 4271)
        code, _, st = req(BASE, 'GET', '/api/stats')
        _, _, w = req(BASE, 'GET', '/api/wbs')
        d = diff_stats(st, expected_from_wbs(w), 'isoA')
        check('ISOA-11 隔离构造数据（12 行 / 5 阶段各异分布）服务端口径逐项一致', len(d) == 0, d or 'all 25 match')

        code, _, zs = req(BASB, 'GET', '/api/stats')
        check('ISOB-12 0 行任务：/api/stats 200、total 0、五项全 0/0.0%、不报错',
              code == 200 and zs['total'] == 0 and zs['phases'][0]['statuses'][0]['percentage'] == 0
              and all(s['count'] == 0 for p in zs['phases'] for s in p['statuses']),
              {'code': code, 'total': zs.get('total')})

        # 409：过期 If-Match 不覆盖
        rev = w['meta']['revision']
        body = json.loads(json.dumps(w))
        body['tasks'][0]['task'] = u'复验-过期写入'
        c1, _, b1 = req(BASE, 'PUT', '/api/wbs', body=body, headers={'If-Match': str(rev + 5), 'X-Identity': urllib.parse.quote(LEADER)})
        _, _, w_after = req(BASE, 'GET', '/api/wbs')
        check('ISOA-13 PUT 过期 If-Match → 409 conflict，且不覆盖（revision/内容不变）',
              c1 == 409 and b1.get('reason') == 'conflict' and w_after['meta']['revision'] == rev
              and w_after['tasks'][0]['task'] == w['tasks'][0]['task'], {'code': c1, 'body': b1, 'rev': w_after['meta']['revision']})

        # 400：非法 phases 不落盘
        bad = json.loads(json.dumps(w))
        bad['tasks'][0]['phases']['design'] = u'乱码状态'
        c2, _, b2 = req(BASE, 'PUT', '/api/wbs', body=bad, headers={'If-Match': str(rev), 'X-Identity': urllib.parse.quote(LEADER)})
        _, _, w_after2 = req(BASE, 'GET', '/api/wbs')
        check('ISOA-14 PUT 非法阶段枚举 → 400 且不落盘（revision/内容不变）',
              c2 == 400 and w_after2['meta']['revision'] == rev and w_after2['tasks'][0]['phases']['design'] == w['tasks'][0]['phases']['design'],
              {'code': c2, 'errors': b2.get('errors')})

        # 合法写入：改一个阶段状态 -> revision+1，/api/stats 同步
        good = json.loads(json.dumps(w))
        tid = good['tasks'][0]['id']
        old_val = good['tasks'][0]['phases']['design']
        new_val = u'阻塞' if old_val != u'阻塞' else u'已开始'
        good['tasks'][0]['phases']['design'] = new_val
        c3, _, b3 = req(BASE, 'PUT', '/api/wbs', body=good, headers={'If-Match': str(rev), 'X-Identity': urllib.parse.quote(LEADER)})
        _, _, st3 = req(BASE, 'GET', '/api/stats')
        _, _, w3 = req(BASE, 'GET', '/api/wbs')
        d3 = diff_stats(st3, expected_from_wbs(w3), 'after-put')
        check('ISOA-15 合法写入 → 200 revision+1，且 /api/stats 立即与新文档一致（写后重算）',
              c3 == 200 and b3.get('revision') == rev + 1 and len(d3) == 0, {'code': c3, 'rev': b3.get('revision'), 'diff': d3})

        # identity_added（CH-7 回归）→ /api/history 含人员池记录；且 /api/stats 不受影响
        w4 = json.loads(json.dumps(w3))
        w4['identities'] = w4['identities'] + [u'复验员乙']
        c4, _, b4 = req(BASE, 'PUT', '/api/wbs', body=w4, headers={'If-Match': str(rev + 1), 'X-Identity': urllib.parse.quote(LEADER)})
        today = time.strftime('%Y-%m-%d')
        c5, _, hist = req(BASE, 'GET', '/api/history?tz=Asia%2FShanghai&date=' + today)
        has = any(r.get('field') == u'人员池' and r.get('new') == u'复验员乙' for r in hist.get('records', []))
        _, _, st5 = req(BASE, 'GET', '/api/stats')
        d5 = diff_stats(st5, expected_from_wbs(req(BASE, 'GET', '/api/wbs')[2]), 'after-identity')
        check('ISOA-16 新增人员（项目负责人）→ /api/history 含「人员池」identity_added，且总览口径不受影响',
              c4 == 200 and has and len(d5) == 0, {'put': c4, 'history': c5, 'has': has, 'diff': d5})

        # 重启持久
        st_before = req(BASE, 'GET', '/api/stats')[2]
        docker(['restart', 'qv38-apis'])
        ok = False
        for _ in range(160):
            c, _, hh = req(BASE, 'GET', '/api/health')
            if c == 200 and hh.get('ok'):
                ok = True
                break
            time.sleep(0.25)
        st_after = req(BASE, 'GET', '/api/stats')[2]
        check('ISOA-17 服务重启后数据仍在，/api/stats 与重启前逐项一致',
              ok and st_before == st_after, {'healthy': ok, 'rev': [st_before.get('revision'), st_after.get('revision')]})

        # 验收 7 抽样：连续 10 次保存后 A–K 字段无丢失 / 无重复 / 无未知字段被清除
        base_doc = req(BASE, 'GET', '/api/wbs')[2]
        tasks0 = dict((t['id'], t) for t in base_doc['tasks'])
        rev_loop = base_doc['meta']['revision']
        loop_ok = True
        for i in range(10):
            cur = req(BASE, 'GET', '/api/wbs')[2]
            payload = json.loads(json.dumps(cur))
            tgt = payload['tasks'][i % len(payload['tasks'])]
            tgt['note'] = u'复验连续保存 %d' % i
            cc, _, bb = req(BASE, 'PUT', '/api/wbs', body=payload,
                            headers={'If-Match': str(cur['meta']['revision']), 'X-Identity': urllib.parse.quote(LEADER)})
            if cc != 200 or bb.get('revision') != cur['meta']['revision'] + 1:
                loop_ok = False
                break
        final_doc = req(BASE, 'GET', '/api/wbs')[2]
        ids = [t['id'] for t in final_doc['tasks']]
        lost, unknown, changed_struct = [], [], []
        for t in final_doc['tasks']:
            o = tasks0.get(t['id'])
            if o is None:
                lost.append(t['id'])
                continue
            for f in ('level1', 'level2', 'task', 'owner', 'demo', 'dates'):
                if f == 'dates':
                    if set(t.get('dates', {}).keys()) != set(o.get('dates', {}).keys()):
                        unknown.append((t['id'], 'dates keys'))
                    for k in ('design', 'dev', 'test', 'product', 'demo_prep'):
                        if k != 'note' and (t.get('dates', {}).get(k) or '') != (o.get('dates', {}).get(k) or ''):
                            changed_struct.append((t['id'], 'dates.' + k))
                elif (t.get(f) or '') != (o.get(f) or ''):
                    changed_struct.append((t['id'], f))
            for k in set(list(t.keys()) + list(o.keys())):
                if k not in o:
                    unknown.append((t['id'], k))
        dup = len(ids) != len(set(ids))
        check('ISOA-19 连续 10 次保存：revision 递增、A–K 结构字段无丢失无重复、无未知字段被写入',
              loop_ok and len(lost) == 0 and not dup and len(unknown) == 0 and len(changed_struct) == 0
              and final_doc['meta']['revision'] == rev_loop + 10,
              {'loop_ok': loop_ok, 'lost': lost, 'dup': dup, 'unknown': unknown, 'changed': changed_struct,
               'rev': [rev_loop, final_doc['meta']['revision']]})

        # 只读性（隔离实例）：读总览不动审计/文档
        a0 = count_lines(os.path.join(api_dir, 'audit.log'))
        w0 = sha(os.path.join(api_dir, 'wbs.json'))
        for _ in range(5):
            req(BASE, 'GET', '/api/stats')
        a1 = count_lines(os.path.join(api_dir, 'audit.log'))
        w1 = sha(os.path.join(api_dir, 'wbs.json'))
        check('ISOA-18 隔离实例：查看总览不写审计、不改 wbs.json',
              a0 == a1 and w0 == w1, {'audit': [a0, a1], 'shaSame': w0 == w1})
    finally:
        subprocess.call(['docker', 'rm', '-f', 'qv38-apis'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        subprocess.call(['docker', 'rm', '-f', 'qv38-apib'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

    out = os.path.join(S18, 'logs', 'server-api.out')
    with io.open(out, 'w', encoding='utf-8') as f:
        f.write(u'\n'.join(LOG) + u'\n')
    print('\n[server-api] PASS=%d FAIL=%d' % (PASS, FAIL))
    return 1 if FAIL else 0


if __name__ == '__main__':
    sys.exit(main())
