#!/usr/bin/env python3
"""Two read-only SSH calls. Remote Python executes from stdin, never stages files.
Output is a NEW LOCAL directory. No production write, database, reload or HTTP."""
import argparse, base64, hashlib, json, pathlib, shlex, subprocess, tarfile
D=pathlib.Path(__file__).resolve().parent
SSH=['ssh','-i','/home/ubuntu/.ssh/51-ecs.pem','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','ConnectTimeout=15','-o','ControlPath=none','root@47.97.108.147']
sha=lambda b:hashlib.sha256(b).hexdigest()
def remote(payload,output):
    code="import sys,json,base64; p=json.load(sys.stdin); g={'__name__':'memory_capture','__file__':'/MEMORY_ONLY_NO_REMOTE_FILE'}; g['CAPTURE_SCRIPT_BYTES']=base64.b64decode(p['capture']); exec(compile(g['CAPTURE_SCRIPT_BYTES'],'memory-fresh-capture','exec'),g); "+payload
    command=SSH+['python3 -B -c '+shlex.quote(code)]
    with output.open('xb') as f, output.with_suffix(output.suffix+'.stderr.log').open('xb') as err:
        r=subprocess.run(command,input=INPUT,stdout=f,stderr=err,timeout=600)
    if r.returncode:raise RuntimeError(output.with_suffix(output.suffix+'.stderr.log').read_text())
def main():
    global INPUT
    a=argparse.ArgumentParser();a.add_argument('--out',required=True);args=a.parse_args();out=pathlib.Path(args.out).resolve();assert not out.exists(),'NEW_LOCAL_BASELINE_DIRECTORY_ONLY'
    archive=out.with_suffix('.tar.gz');contract=out.with_suffix('.contract.json');assert not archive.exists() and not contract.exists()
    capture=(D/'fresh-capture-readonly.py').read_bytes();preflight=(D/'preflight-capture-readonly.py').read_bytes()
    INPUT=json.dumps({'capture':base64.b64encode(capture).decode(),'preflight':base64.b64encode(preflight).decode()}).encode()
    print('Read-only preflight: exact current lifecycle + two non-blocking locks',flush=True)
    remote("exec(compile(base64.b64decode(p['preflight']),'memory-preflight','exec'),g)",contract)
    cb=contract.read_bytes();c=json.loads(cb);assert c['newRuntimeRoot']=='/opt/ops/20261115-manual-reference-edit-JfFQcJM'
    INPUT=json.dumps({'capture':base64.b64encode(capture).decode(),'contract':base64.b64encode(cb).decode()}).encode()
    print('Read-only full capture: original ROOT/old trees/assets/source172 guarded twice',flush=True)
    remote("g['CAPTURE_CONTRACT_BYTES']=base64.b64decode(p['contract']); g['sys'].argv=['memory-capture','--contract','MEMORY','--sha256',"+repr(sha(cb))+"]; g['main']()",archive)
    assert sha((D/'fresh-capture-readonly.py').read_bytes())==sha(capture),'LOCAL_CAPTURE_TOOL_RACE'
    with tarfile.open(archive) as t:
        members=t.getmembers();assert len({m.name for m in members})==len(members)
        for m in members:assert m.isfile() and not m.name.startswith('/') and all(x not in ('','.','..') for x in m.name.split('/'))
        out.mkdir(mode=0o700);t.extractall(out,filter='data')
    report=out/'live-baseline-current.json';b=json.loads(report.read_bytes());assert b['captureScriptSha256']==sha(capture)
    finalpins=json.loads(pathlib.Path('/home/ubuntu/work/customer-origin-edit-20261115/source-final-pins.json').read_bytes())
    assert b['sourceHashes']==finalpins['sourceHashes'],'EXACT_SOURCE_FINAL172_MATCH'
    result={'status':'PASS','baselineDir':str(out),'reportSha256':sha(report.read_bytes()),'archiveSha256':sha(archive.read_bytes()),'sourceCount':len(b['sourceHashes']),'hostSourceCount':b['hostSourceCount'],'currentRootFiles':len(b['currentRootTree']),'frozenRoots':len(b['frozenRootTrees']),'baselineAssets':len(b['baselineAssets']),'legacyFrozenFiles':len(b['legacyFrozenFiles']),'processCount':b['processCount'],'sshWrites':0,'databaseAccess':False,'reloads':0,'oldRootReplayed':False}
    (D/'capture-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2),flush=True)
if __name__=='__main__':main()
