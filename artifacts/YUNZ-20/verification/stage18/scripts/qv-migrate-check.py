# -*- coding: utf-8 -*-
"""YUNZ-38 / Stage18：CH-11/CH-12 迁移幂等与旧 status 保留（隔离实例，Python 标准库）。
构造一份**缺少 phases**的旧文档（含旧 status 与非空日期），启动隔离容器：
  1) 一次性迁移为五阶段 phases（旧日期早于今天 → 延期，否则 → 未开始），旧 status 字段保留；
  2) 审计追加 migrated 记录（每任务每阶段一条），/api/stats 与迁移后文档一致；
  3) 重启容器 → 不再迁移（revision / wbs.json 指纹 / 审计行数均不变）→ 幂等。
"""
import io, json, os, shutil, subprocess, sys, time, hashlib
import urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
S18 = os.path.normpath(os.path.join(HERE, '..'))
ISO = os.path.join(S18, 'iso')
IMAGE = os.environ.get('IMAGE', 'mcr.microsoft.com/playwright:v1.55.0-jammy')
APP = os.environ.get('APP', '/opt/wbs-rongcheng')
PORT = 4272
NAME = 'qv38-mig'
BASE = 'http://127.0.0.1:%d' % PORT
PHASE_KEYS = ['design', 'dev', 'test', 'product', 'demo_prep']
PHASE_ENUM = [u'未开始', u'已开始', u'已完成', u'延期', u'阻塞']
PASS = FAIL = 0
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


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=20) as r:
        return json.loads(r.read().decode('utf-8'))


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for c in iter(lambda: f.read(65536), b''):
            h.update(c)
    return h.hexdigest()


def lines(p):
    try:
        return len([l for l in io.open(p, encoding='utf-8', errors='replace') if l.strip()])
    except IOError:
        return 0


def main():
    d = os.path.join(ISO, 'isoMIG')
    if os.path.isdir(d):
        shutil.rmtree(d)
    os.makedirs(d)
    old_status = [u'未开始', u'进行中', u'已完成', u'已延期', u'被阻塞']
    tasks = []
    for i in range(4):
        tasks.append({
            'id': 'T-M%d' % (i + 1), 'level1': u'迁移一级', 'level2': u'迁移二级',
            'task': u'迁移任务 %d' % (i + 1), 'owner': u'王言', 'demo': u'',
            'dates': {'design': '2020-01-0%d' % (i + 1), 'dev': '', 'test': '',
                      'product': '', 'demo_prep': ''},
            'note': u'旧数据', 'status': old_status[i],
        })
    doc = {'meta': {'name': u'1023 蓉城战役 WBS 清单', 'revision': 2,
                    'updated_at': '2026-10-01T00:00:00.000Z', 'source': u'旧模板.xlsx'},
           'identities': [u'项目负责人', u'王言'], 'tasks': tasks}
    with io.open(os.path.join(d, 'wbs.json'), 'w', encoding='utf-8') as f:
        f.write(json.dumps(doc, ensure_ascii=False, indent=2) + u'\n')

    subprocess.call(['docker', 'rm', '-f', NAME], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    subprocess.call(['docker', 'run', '-d', '--name', NAME, '-e', 'WBS_DATA_DIR=/data',
                     '-e', 'WBS_PORT=%d' % PORT, '-e', 'WBS_HOST=0.0.0.0',
                     '-p', '127.0.0.1:%d:%d' % (PORT, PORT), '-v', d + ':/data',
                     '-v', APP + ':/app:ro', IMAGE, 'node', '/app/server.js'],
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    ok = False
    for _ in range(120):
        try:
            if get('/api/health').get('ok'):
                ok = True
                break
        except Exception:
            pass
        time.sleep(0.25)
    try:
        check('MIG-01 隔离容器启动成功（旧文档自动迁移）', ok, {'healthy': ok})
        doc1 = get('/api/wbs')
        tasks1 = doc1['tasks']
        migrated = all(isinstance(t.get('phases'), dict) and set(t['phases'].keys()) == set(PHASE_KEYS)
                       for t in tasks1)
        check('MIG-02 一次性迁移：每任务生成五阶段 phases（键齐备、取值合法）',
              migrated and all(t['phases'][k] in PHASE_ENUM for t in tasks1 for k in PHASE_KEYS),
              {t['id']: t.get('phases') for t in tasks1[:2]})
        check('MIG-03 旧 status 字段保留（不被清除/改写，4 行逐行一致）',
              [t.get('status') for t in tasks1] == old_status[:len(tasks1)],
              {'got': [t.get('status') for t in tasks1], 'exp': old_status[:len(tasks1)]})
        check('MIG-04 迁移规则：日期早于今天 → 延期，空日期 → 未开始',
              tasks1[0]['phases']['design'] == u'延期' and tasks1[0]['phases']['dev'] == u'未开始',
              {'design': tasks1[0]['phases']['design'], 'dev': tasks1[0]['phases']['dev']})
        ad = os.path.join(d, 'audit.log')
        n_migrated = len([l for l in io.open(ad, encoding='utf-8', errors='replace')
                          if l.strip() and json.loads(l).get('type') == 'migrated'])
        check('MIG-05 迁移审计：migrated 记录数 == 任务数 × 5', n_migrated == len(tasks1) * 5,
              {'migrated': n_migrated, 'expect': len(tasks1) * 5})
        st = get('/api/stats')
        check('MIG-06 迁移后 /api/stats 与文档一致（total/revision、design 延期计数）',
              st['total'] == len(tasks1) and st['revision'] == doc1['meta']['revision'] and
              st['phases'][0]['statuses'][PHASE_ENUM.index(u'延期')]['count'] == 4,
              {'total': st['total'], 'rev': st['revision'],
               'design_delayed': st['phases'][0]['statuses'][3]['count']})

        rev_before, sha_before, lines_before = doc1['meta']['revision'], sha(os.path.join(d, 'wbs.json')), lines(ad)
        subprocess.call(['docker', 'restart', NAME], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        for _ in range(160):
            try:
                if get('/api/health').get('ok'):
                    break
            except Exception:
                pass
            time.sleep(0.25)
        doc2 = get('/api/wbs')
        check('MIG-07 重启幂等：不再迁移（revision / wbs.json 指纹 / 审计行数均不变）',
              doc2['meta']['revision'] == rev_before and sha(os.path.join(d, 'wbs.json')) == sha_before
              and lines(ad) == lines_before,
              {'rev': [rev_before, doc2['meta']['revision']], 'lines': [lines_before, lines(ad)]})
    finally:
        subprocess.call(['docker', 'rm', '-f', NAME], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

    with io.open(os.path.join(S18, 'logs', 'migrate.out'), 'w', encoding='utf-8') as f:
        f.write(u'\n'.join(LOG) + u'\n')
    print('\n[migrate] PASS=%d FAIL=%d' % (PASS, FAIL))
    return 1 if FAIL else 0


if __name__ == '__main__':
    sys.exit(main())
