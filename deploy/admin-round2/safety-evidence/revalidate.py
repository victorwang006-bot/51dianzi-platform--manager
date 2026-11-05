#!/usr/bin/env python3
"""Offline synthetic tool safety only. Never freeze/build applications or call real PM2/HTTP/DB."""
import ast
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

HERE=Path(__file__).resolve().parent
TOOLS=HERE.parent
REPO=TOOLS.parent.parent
BASE=Path('/home/ubuntu/backend-optimization/round2/baseline')
OLD_EVIDENCE=Path('/home/ubuntu/backend-optimization/round2/tool-evidence/verification.json')

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def run(command,log):
    result=subprocess.run(command,cwd=REPO,capture_output=True,env={'PATH':os.environ['PATH'],'HOME':str(HERE),'PYTHONDONTWRITEBYTECODE':'1','LANG':'C.UTF-8'},timeout=120)
    log.write_bytes(result.stdout+result.stderr)
    if result.returncode:
        print(f'FAIL: {log}; exit={result.returncode}',flush=True)
        raise SystemExit(result.returncode)
    return {'command':command,'exitCode':result.returncode,'log':str(log),'logSha256':sha(log)}

old=json.loads(OLD_EVIDENCE.read_bytes())
original={Path(x['path']).name:x['sha256'] for x in old['tools']}
unchanged=['build-service.mjs','lib.mjs','migrate-sidecar.mjs','reload-target.mjs','runtime-contract.mjs','test-isolation.mjs','vite-worker.mjs']
for name in unchanged:
    if sha(TOOLS/name)!=original[name]:raise SystemExit('STOP: non-authorized tool changed: '+name)

node=run(['node','--test','--test-reporter=spec',str(TOOLS/'safety.test.mjs')],HERE/'node-safety.log')
node['tests']=int(re.search(r'tests\s+(\d+)',(HERE/'node-safety.log').read_text()).group(1));node['passed']=node['tests']
python=run([sys.executable,str(TOOLS/'test_publish.py')],HERE/'python-safety.log')
python['tests']=int(re.search(r'Ran (\d+) tests',(HERE/'python-safety.log').read_text()).group(1));python['passed']=python['tests']
syntax=[]
for p in sorted(TOOLS.glob('*.mjs')):
    r=subprocess.run(['node','--check',str(p)],capture_output=True,timeout=30)
    if r.returncode:raise SystemExit('STOP: node syntax failed: '+p.name)
    syntax.append({'path':str(p),'kind':'node-syntax','exitCode':0})
for p in sorted(TOOLS.glob('*.py')):
    ast.parse(p.read_text());syntax.append({'path':str(p),'kind':'python-ast','passed':True})
artifacts=[{'path':str(p),'sha256':sha(p),'bytes':p.stat().st_size} for p in sorted(TOOLS.iterdir()) if p.is_file() and p.suffix in ['.mjs','.py','.json','.md']]
result={
 'schemaVersion':2,'checkedAt':datetime.now(timezone.utc).isoformat(),'release':'20261105-admin-compact-priority-v2',
 'scope':'synthetic-tool-safety-fixture-only','productionQaClaimed':False,'testResults':{'node':node,'python':python},'syntaxChecks':syntax,'tools':artifacts,
 'evidenceGenerator':{'path':str(Path(__file__).resolve()),'sha256':sha(Path(__file__))},
 'capturedReadOnlyBootBaseline':{str(BASE/n):sha(BASE/n) for n in ['boot-proof.txt','boot-target-configs.json']},
 'parentBuildServiceUnmodifiedSha256':sha(TOOLS/'build-service.mjs'),'otherProtectedToolsUnchanged':{n:sha(TOOLS/n) for n in unchanged},
 'authorizedChangedFiles':['persist-targets.mjs','publish.py','safety.test.mjs','test_publish.py','README.md','qa-approval.expected.json','build.mjs (parent-authorized exact temporary-name exclusion)'],
 'notPerformed':{'finalSourceFreeze':True,'actualApplicationBuildOrTypechecks':True,'productionAccessOrWrites':True,'actualPm2OrSystemctl':True,'actualHttp':True,'databaseOrDdl':True,'finalReactOrBrowserQa':True,'sshOrScp':True,'gitCommitOrPush':True},
 'caveats':['Only synthetic unit/jlist/dump/HTTP fixtures were executed. Captured boot baseline files were read offline; this is not new production verification.','Old tool-evidence hashes are obsolete for modified tools. Parent must freeze/build again and bind a fresh manifest plus QA approval.','PM2 save projection is guarded against complete current contents; unknown runtime/dump drift fails closed without old-API rollback.']
}
(HERE/'verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':'passed','nodeTests':node['tests'],'pythonTests':python['tests'],'verification':str(HERE/'verification.json'),'protectedBuildServiceSha256':result['parentBuildServiceUnmodifiedSha256']},ensure_ascii=False),flush=True)
