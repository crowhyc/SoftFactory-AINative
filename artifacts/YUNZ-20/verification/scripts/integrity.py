# -*- coding: utf-8 -*-
"""YUNZ-20 Stage2 —— 交付三链一致性：磁盘 sha256 / 目录 SHA256SUMS / 资产库 git HEAD blob。"""
import hashlib, os, subprocess, sys, json
ART = '/opt/SoftFactory-AINative/artifacts/YUNZ-20'
SNAP = os.path.join(ART, 'wbs-rongcheng')
LIVE = '/opt/wbs-rongcheng'
REPO = '/opt/SoftFactory-AINative'
REL = 'artifacts/YUNZ-20'
fails = []
def chk(cid, name, cond, detail):
    print('[%s] %s %s :: %s' % ('PASS' if cond else 'FAIL', cid, name, detail))
    if not cond: fails.append(cid)
def sha_file(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()
def walk(root):
    out = {}
    for dp, dns, fns in os.walk(root):
        for fn in fns:
            p = os.path.join(dp, fn)
            out[os.path.relpath(p, root)] = p
    return out
def git_blob_sha(rel):
    r = subprocess.run(['git', 'show', 'HEAD:%s/%s' % (REL, rel)], cwd=REPO,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        return None
    return hashlib.sha256(r.stdout).hexdigest()

# ---- 链 1：目录 SHA256SUMS 自校验 ----
r = subprocess.run(['sha256sum', '-c', 'SHA256SUMS'], cwd=ART, stdout=subprocess.PIPE, stderr=subprocess.STDOUT).stdout.decode()
ok_n = r.count(': OK')
chk('I1', 'SHA256SUMS 逐条自校验', ok_n == 45 and ': FAILED' not in r, '条目=%d OK=%d' % (len(r.strip().splitlines()), ok_n))

# ---- 链 2：运行产物（磁盘）与交付源码快照逐字一致 ----
snap = walk(SNAP); live = walk(LIVE)
runtime_only = lambda rel: (rel.startswith('data/wbs.json') or rel.startswith('state/')
                            or rel.startswith('tests/.tools') or rel.startswith('tests/.tmp')
                            or rel.endswith('.log') or rel == 'data/audit.log')
mism, missing_snap = [], []
for rel, p in sorted(snap.items()):
    lp = os.path.join(LIVE, rel)
    if not os.path.exists(lp):
        missing_snap.append(rel); continue
    if sha_file(p) != sha_file(lp):
        mism.append(rel)
live_extra = [rel for rel in sorted(live) if rel not in snap and not runtime_only(rel)]
chk('I2', '运行产物 /opt/wbs-rongcheng 交付源码与快照 artifacts/YUNZ-20/wbs-rongcheng 逐字一致',
    not mism and not missing_snap and not live_extra,
    'snapshotFiles=%d mismatch=%s missingInLive=%s liveExtra(non-runtime)=%s' % (len(snap), mism, missing_snap, live_extra))
runtime_extra = [r for r in sorted(live) if r not in snap]
groups = {}
for rel in runtime_extra:
    key = rel.split('/')[0] + ('/' + rel.split('/')[1] if rel.count('/') >= 1 and rel.split('/')[0] == 'tests' else '')
    groups[key] = groups.get(key, 0) + 1
print('   运行侧仅有的运行期产物 %d 个（不计入源码一致性），分组: %s' % (len(runtime_extra), json.dumps(groups, ensure_ascii=True)))
print('   其中具名项: %s' % json.dumps([r for r in runtime_extra if not r.startswith('tests/.tools/') and not r.startswith('tests/.tmp/') and not r.startswith('tests/.tools') and not r.startswith('tests/.tmp')], ensure_ascii=True))

# ---- 链 3：资产库 git HEAD blob 与磁盘 sha256 一致 ----
sums = [l.split(None, 1) for l in open(os.path.join(ART, 'SHA256SUMS'), encoding='utf-8').read().strip().splitlines()]
git_mism, git_missing = [], []
for h, rel in sums:
    dp = os.path.join(ART, rel)
    disk = sha_file(dp) if os.path.exists(dp) else None
    g = git_blob_sha(rel)
    if g is None:
        git_missing.append(rel)
    elif g != h or disk != h:
        git_mism.append((rel, h[:12], (g or 'none')[:12], (disk or 'none')[:12]))
chk('I3', 'SHA256SUMS 记录的 sha256 = 磁盘实际 = git HEAD blob（三链一致）',
    not git_mism and not git_missing, 'checked=%d mismatch=%s missingInGit=%s' % (len(sums), git_mism, git_missing))

# ---- git 提交与推送状态 ----
log = subprocess.run(['git', 'log', '-1', '--format=%H %s', '--', REL], cwd=REPO, stdout=subprocess.PIPE).stdout.decode().strip()
head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=REPO, stdout=subprocess.PIPE).stdout.decode().strip()
remote = subprocess.run(['git', 'rev-parse', 'origin/main'], cwd=REPO, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout.decode().strip()
chk('I4', '交付目录已提交且已推送（HEAD == origin/main，提交信息 task(YUNZ-20)）',
    head == remote and 'task(YUNZ-20)' in log, 'HEAD=%s origin/main=%s lastCommitForPath=%s' % (head[:12], remote[:12], log))

# ---- 交付目录无凭据样式字符串（独立实现的凭据样式正则；排除 vendor bundle 与测试工具目录） ----
import re
CRED = re.compile(r'AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY|'
                  r'(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*["\'][^"\']{6,}["\']', re.I)
skip_dir = ('node_modules', '.tools', '.tmp', '.git', 'state')
hits = []
for rel, p in sorted(snap.items()):
    if rel.endswith('.xlsx') or rel.endswith('xlsx.full.min.js'):
        continue
    if any(part in skip_dir for part in rel.split(os.sep)[:-1]):
        continue
    try:
        txt = open(p, 'rb').read().decode('utf-8', 'ignore')
    except Exception:
        continue
    for m in CRED.finditer(txt):
        line = txt[:m.start()].count('\n') + 1
        hits.append('%s:%d:%s' % (rel, line, m.group(0)[:60]))
chk('I5', '交付源码快照无凭据样式字符串（独立正则，排除 vendor/测试工具）', not hits, 'hits=%s' % hits)

# ---- 作者自带的凭据扫描脚本复跑（作者链证据） ----
run = subprocess.run(['bash', '/opt/wbs-rongcheng/tests/scan_secrets.sh'], stdout=subprocess.PIPE,
                     stderr=subprocess.STDOUT, env=dict(os.environ, APP_DIR='/opt/wbs-rongcheng'))
out = run.stdout.decode()
print('   [作者脚本复跑] tests/scan_secrets.sh 退出码=%d 输出=%s' % (run.returncode, out.strip().replace('\n', ' | ')[:300]))
chk('I6', '复跑作者 tests/scan_secrets.sh 亦判定无凭据样式字符串', run.returncode == 0, 'exit=%d' % run.returncode)

print('== 汇总: %s ==' % ('全部通过' if not fails else 'FAIL ' + ','.join(fails)))
sys.exit(1 if fails else 0)
