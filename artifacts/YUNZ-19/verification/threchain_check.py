# -*- coding: utf-8 -*-
# 版本三链锁定：磁盘 sha256 + 交付目录 SHA256SUMS + git HEAD blob sha256
import io, os, re, sys, subprocess, hashlib
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ART = "/opt/SoftFactory-AINative/artifacts/YUNZ-10"
REPO = "/opt/SoftFactory-AINative"
SUMS = os.path.join(ART, "SHA256SUMS")
def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()
print("核对时间(UTC):", subprocess.check_output(["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"]).decode().strip())
head = subprocess.check_output(["git", "-C", REPO, "rev-parse", "HEAD"]).decode().strip() if False else \
       subprocess.check_output("cd %s && git rev-parse HEAD" % REPO, shell=True).decode().strip()
print("git HEAD:", head)
sums = {}
for line in io.open(SUMS, encoding="utf-8"):
    line = line.strip()
    if not line: continue
    m = re.match(r"^([0-9a-f]{64})\s+\*?(.+)$", line)
    if m: sums[m.group(2).lstrip("./")] = m.group(1)
print("SHA256SUMS 条目数:", len(sums))
ok_all = True
for name, want in sorted(sums.items()):
    disk = sha(os.path.join(ART, name))
    blob_cmd = "cd %s && git cat-file -p HEAD:artifacts/YUNZ-10/%s" % (REPO, name)
    try:
        blob = hashlib.sha256(subprocess.check_output(blob_cmd, shell=True)).hexdigest()
    except Exception as e:
        blob = "ERR:%s" % e
    three = (disk == want) and (blob == want)
    ok_all = ok_all and three
    print("%-22s disk=%s sums=%s gitHEAD=%s  %s" % (name, disk[:16], want[:16], blob[:16], "OK" if three else "MISMATCH"))
print("三链锁定:", "全部一致" if ok_all else "存在不一致")
sys.exit(0 if ok_all else 1)
