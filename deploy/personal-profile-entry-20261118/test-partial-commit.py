from pathlib import Path
from contextlib import ExitStack
from unittest.mock import patch
import importlib.util,io,json
W=Path('/home/ubuntu/work/profile-entry-20261118')
spec=importlib.util.spec_from_file_location('f',W/'fix-profile-entry.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
before=(W/'index.before.html').read_bytes();after,_=m.build(before);realhash=m.H
report=[]
for scenario in ['replace_committed_then_fsync_failed','foreign_version_after_failed_write','failure_before_replace']:
 target=Path('/virtual-profile.html');stage=Path('/opt/backups/profile-entry-20261118-yOJKWq2D')
 newpath=m.ROOT/m.NEW.lstrip('/');state={'target':before,'files':{},'calls':0,'rollback':0}
 def read(p):
  if p==target:return state['target']
  return b'new-profile-code'if p==newpath else before
 def hashvalue(data):return '3ba04bab14ab3934e2d628e40420f20b8a8ec6a0579458055d2a28a8ad64f009'if data==b'new-profile-code'else realhash(data)
 def write(p,data):state['files'][str(p)]=data;return len(data)
 def atomic(data):
  state['calls']+=1
  if state['calls']==1:
   if scenario=='replace_committed_then_fsync_failed':state['target']=after
   elif scenario=='foreign_version_after_failed_write':state['target']=b'foreign-version'
   raise OSError('simulated atomic write failure')
  state['target']=data;state['rollback']+=1
 patches=[patch.object(m,'TARGET',target),patch.object(m,'atomic',atomic),patch.object(m,'H',hashvalue),patch.object(m,'processes',lambda:[{'id':i,'status':'online'}for i in range(12)]),patch.object(m.fcntl,'flock',lambda *a:None),patch('builtins.open',lambda *a,**k:io.StringIO()),patch.object(Path,'read_bytes',read),patch.object(Path,'write_bytes',write),patch.object(Path,'write_text',lambda p,t:write(p,t.encode())),patch.object(Path,'read_text',lambda p:'profile:()=>ue(()=>import("./Profile-Bb1hTfdM.js")'),patch.object(Path,'exists',lambda p:False),patch.object(Path,'is_file',lambda p:True),patch.object(Path,'resolve',lambda p:p)]
 with ExitStack()as stack:
  for item in patches:stack.enter_context(item)
  try:m.apply(stage)
  except OSError:pass
  else:raise AssertionError('Expected failure')
 if scenario=='replace_committed_then_fsync_failed':assert state['target']==before and state['rollback']==1
 elif scenario=='foreign_version_after_failed_write':assert state['target']==b'foreign-version'and state['rollback']==0
 else:assert state['target']==before and state['rollback']==0
 assert str(stage/'receipt.json')not in state['files'];report.append({'scenario':scenario,'status':'passed','rollbackWrites':state['rollback']})
(W/'partial-commit-tests.json').write_text(json.dumps({'status':'passed','tests':report,'productionIO':0},indent=2)+'\n');print('PASS 3 partial-commit/foreign-version fault scenarios')
