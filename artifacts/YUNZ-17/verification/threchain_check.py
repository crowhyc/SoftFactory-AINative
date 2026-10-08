import hashlib, subprocess, os
os.chdir("/opt/SoftFactory-AINative/artifacts/YUNZ-10")
files=["app.py","index.html","data.json","verify_e2e.sh","README.md","selftest_output.txt","e2e_output.txt"]
disk={f:hashlib.sha256(open(f,'rb').read()).hexdigest() for f in files}
sums={}
for line in open("SHA256SUMS",encoding="utf-8"):
    h,f=line.split(None,1); sums[f.strip()]=h
head={f:hashlib.sha256(subprocess.check_output(["git","show","HEAD:artifacts/YUNZ-10/"+f])).hexdigest() for f in files}
print("file                 disk==SHA256SUMS==gitHEAD")
ok=True
for f in files:
    same = disk[f]==sums.get(f)==head[f]; ok=ok and same
    print("%-20s %s" % (f, "YES" if same else "NO"))
print("THREE-CHAIN CONSISTENT:", ok)
