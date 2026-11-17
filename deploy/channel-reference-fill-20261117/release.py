#!/usr/bin/env python3
"""Narrow release controller: mature locks/CAS/additive files/rolling reload/own-hash rollback.
No rebuild, blanket tree copy, business INSERT, PM2 environment update/save, or Nginx edits.
Run on production ONLY after a final read-only review. One apply per stage.
"""
from pathlib import Path
import argparse,json,hashlib,subprocess,os,fcntl,time
P=argparse.ArgumentParser();P.add_argument('mode',choices=['preflight','apply','verify']);P.add_argument('--root',required=True);a=P.parse_args();R=Path(a.root);M=json.loads((R/'release-manifest.json').read_text());B=json.loads((R/'protection.json').read_text())
def H(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def run(args,timeout=90):return subprocess.check_output(args,stderr=subprocess.STDOUT,timeout=timeout).decode()
def atomic(src,dest,mode=0o644):
 dest=Path(dest);tmp=dest.with_name(dest.name+'.channel-reference-inbound-documents-v2-next');assert not tmp.exists(),'LEFTOVER_ATOMIC_TARGET';tmp.write_bytes(Path(src).read_bytes());tmp.chmod(mode);os.replace(tmp,dest)
def proc():
 rows=json.loads(run(['pm2','jlist']));out=[]
 for x in rows:
  e=x['pm2_env'];pid=x['pid'];p=Path('/proc')/str(pid)
  out.append(dict(id=x['pm_id'],name=x['name'],pid=pid,status=e['status'],script=e['pm_exec_path'],cwd=e['pm_cwd'],env=hashlib.sha256((p/'environ').read_bytes()).hexdigest(),configuredEnv=hashlib.sha256(json.dumps(e.get('env',{}),sort_keys=True,separators=(',',':'),default=str).encode()).hexdigest()))
 return sorted(out,key=lambda x:x['id'])
def jsonwrite(p,x):Path(p).write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
def http(host,url):return subprocess.check_output(['curl','-fsS','--compressed','--max-time','20','--resolve',host+':443:127.0.0.1','https://'+host+url],timeout=25)
def check_protected(after=False):
 allowed={f['target']:f['sha256'] for f in M['replace']} if after else {}
 for p,h in B['files'].items():assert H(p)==allowed.get(p,h),'PROTECTED_SHA_DRIFT:'+p
 old=B['processes'];now=proc();assert len(now)==len(old)==12,'PROCESS_COUNT_DRIFT';assert all(x['status']=='online' for x in now),'PROCESS_UNHEALTHY'
 for x,y in zip(old,now):
  if after and x['name'] in M['reloadNames']:
   assert all(x[k]==y[k] for k in ['id','name','script','cwd','configuredEnv']),'RELOAD_IDENTITY_DRIFT:'+x['name']
  else:assert x==y,'UNRELATED_PROCESS_DRIFT:'+x['name']
 return now
def db(mode):
 return {'ddlPerformed':False,'noDatabaseConnection':True,'noBusinessDml':True}
def validate():
 assert M['scope']=='channel-reference-inbound-documents-v2' and M['independentReview']=='passed','REVIEW_REQUIRED'
 assert {x['name'] for x in B['processes'] if x['name'] in M['reloadNames']}==set(M['reloadNames'])
 assert M['reloadNames']==['dianzi51','dianzi51-admin']
 assert len(M['replace'])==3 and sum(x['kind']=='api' for x in M['replace'])==2 and sum(x['kind']=='html' for x in M['replace'])==1
 assert M['noDdl'] is True and M['noDatabaseAccess'] is True and M['noBusinessDml'] is True and M['noBindingInstallation'] is True
 assert M['databases']=={}
 expected={}
 for role,d in M['databases'].items():
  assert d['tables']==expected[role],'EMPTY_METADATA_DDL_WHITELIST_DRIFT'
  assert H(R/d['ddlSource'])==d['ddlSha256'],'DDL_DRIFT'
  assert d['processName']==('dianzi51-admin' if role=='admin' else 'dianzi51')
  assert Path(d['packageCwd']).is_absolute() and '..' not in Path(d['packageCwd']).parts
 for f in M['replace']+M['add']:
  assert H(R/f['source'])==f['sha256'],'STAGED_SOURCE_DRIFT'
  p=Path(f['target']);assert p.is_absolute() and '..' not in p.parts
  if f in M['replace']:assert str(p) in B['files']
  elif p.exists():assert H(p)==f['sha256'],'ADDITIVE_COLLISION'
  if p.suffix in ['.js','.mjs']:run(['node','--input-type=module','--check'],30) if False else subprocess.run(['node','--input-type=module','--check'],input=(R/f['source']).read_bytes(),capture_output=True,check=True)
 assert not Path(M['bindingTarget']).exists() or H(M['bindingTarget'])==M['bindingSha256'],'OLD_BINDING_PROTECTION_DRIFT'
 assert M['referenceRoot']==str(R) and M['oldSuccessfulQuotesRetained']==213 and M['manualRefreshConfigured'] is False and M['cacheProvisioned'] is False,'REFERENCE_SCOPE_DRIFT'
 assert all(not(R/n).exists()for n in M['forbiddenConfigFiles']),'UNEXPECTED_PRODUCER_CONFIG'
 assert H(R/M['apiDeltaSource'])==M['apiDeltaSha256'],'REFERENCE_API_DELTA_DRIFT'
 import base64
 delta=json.loads((R/M['apiDeltaSource']).read_text());before=(R/M['apiBeforeSource']).read_bytes();after=(R/'api/admin.js').read_bytes();assert len(delta['patches'])==1 and delta['changedOnly']=='existing-reference-import-module-string','API_SINGLE_NODE_REQUIRED'
 patch=delta['patches'][0];pre=base64.b64decode(patch['beforeBase64']);post=base64.b64decode(patch['afterBase64']);assert pre==json.dumps(M['oldReferenceImport']).encode()and post==json.dumps(str(R/'channel-reference-service.mjs')).encode(),'REFERENCE_MODULE_STRING_ONLY'
 assert before[patch['start']:patch['end']]==pre and after[patch['afterStart']:patch['afterEnd']]==post and after[:patch['afterStart']]+pre+after[patch['afterEnd']:]==before,'REFERENCE_API_EXACT_INVERSE_REQUIRED'
 assert {d['role']for d in M['documentDeltas']}=={'front','admin'} and len(M['documentDeltas'])==2,'DOCUMENT_DELTA_SCOPE'
 for d in M['documentDeltas']:
  assert H(R/d['source'])==d['sha256'],'DOCUMENT_DELTA_DRIFT'
  doc=json.loads((R/d['source']).read_text());target=d['target'];assert d['beforeSha256']==B['files'][target],'DOCUMENT_APPROVED_PREIMAGE_DRIFT'
  candidate=before if d['role']=='admin'else(R/'api/front.js').read_bytes();assert hashlib.sha256(candidate).hexdigest()==d['afterSha256'],'DOCUMENT_CANDIDATE_DRIFT'
  units=candidate.decode('utf-8').encode('utf-16-le')
  for change in sorted(doc['patches'],key=lambda x:x['afterStart'],reverse=True):
   left=change['afterStart']*2;right=change['afterEnd']*2;old=change['before'].encode('utf-16-le');new=change['after'].encode('utf-16-le');assert units[left:right]==new,'DOCUMENT_DELTA_AFTER_BYTES_DRIFT';units=units[:left]+old+units[right:]
  assert hashlib.sha256(units.decode('utf-16-le').encode('utf-8')).hexdigest()==d['beforeSha256'],'DOCUMENT_API_EXACT_INVERSE_REQUIRED'

 for host in ['51dianzi.com','admin.51dianzi.com']:assert http(host,'/'),'HTTP_HEALTH'
locks=[]
for n in ['dianzi51-public-deploy.lock','dianzi51-production-code.lock']:
 f=open('/var/lock/'+n,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
validate()
if a.mode=='preflight':
 check_protected();result={'status':'preflight-passed','database':db('preflight'),'noLiveWrites':True};jsonwrite(R/'preflight-result.json',result);print(json.dumps(result));raise SystemExit(0)
if a.mode=='verify':
 rows=check_protected(True);d=db('verify')
 for f in M['add']:assert H(f['target'])==f['sha256']
 assert H(M['bindingTarget'])==M['bindingSha256']
 for f in M['replace']:
  if f['kind']=='html':assert hashlib.sha256(http(f['host'],'/')).hexdigest()==f['sha256']
 result={'status':'verified','database':d,'processes':rows,'noBusinessDml':True};jsonwrite(R/'verify-result.json',result);print(json.dumps(result));raise SystemExit(0)
assert not (R/'apply-attempt.json').exists(),'SINGLE_APPLY_ALREADY_ATTEMPTED';assert json.loads((R/'preflight-result.json').read_text())['status']=='preflight-passed';check_protected();jsonwrite(R/'apply-attempt.json',{'startedAt':time.time(),'status':'started'})
backup=R/'backup';backup.mkdir(mode=0o700,exist_ok=False)
for i,f in enumerate(M['replace']):q=backup/str(i);q.write_bytes(Path(f['target']).read_bytes());q.chmod(0o600)
changed=[];reloaded=False
try:
 d=db('install');jsonwrite(R/'database-before.json',d)
 for f in M['add']:
  p=Path(f['target']);p.parent.mkdir(parents=True,exist_ok=True)
  if not p.exists():atomic(R/f['source'],p)
  assert H(p)==f['sha256']
 for f in M['replace']:
  if f['kind']!='api':continue
  assert H(f['target'])==B['files'][f['target']],'API_CAS_DRIFT';atomic(R/f['source'],f['target']);changed.append(f)
 reloaded=True
 for name in M['reloadNames']:run(['pm2','reload' if name in ['dianzi51','dianzi51-admin'] else 'restart',name],150)
 # New API is live before enabling any new page. No test products/orders are written.
 for host in ['51dianzi.com','admin.51dianzi.com']:http(host,'/')
 for f in M['replace']:
  if f['kind']!='html':continue
  assert H(f['target'])==B['files'][f['target']],'HTML_CAS_DRIFT';atomic(R/f['source'],f['target']);changed.append(f)
 rows=check_protected(True);d=db('verify')
 for f in M['replace']:
  if f['kind']=='html':assert hashlib.sha256(http(f['host'],'/')).hexdigest()==f['sha256'],'SERVED_HTML_MISMATCH'
 result={'status':'applied','finishedAt':time.time(),'database':d,'processes':rows,'noBusinessDml':True,'noDdl':True,'noBindingInstallation':True,'workersUnchanged':True,'noPm2SaveOrEnvironmentUpdate':True};jsonwrite(R/'apply-result.json',result);print(json.dumps(result))
except Exception as e:
 restored=[];foreign=[]
 for f in reversed(changed):
  p=Path(f['target']);i=M['replace'].index(f)
  if p.exists() and H(p)==f['sha256']:atomic(backup/str(i),p);restored.append(str(p))
  else:foreign.append(str(p))
 if reloaded and not foreign:
  for name in M['reloadNames']:run(['pm2','reload' if name in ['dianzi51','dianzi51-admin'] else 'restart',name],150)
 jsonwrite(R/'apply-result.json',{'status':'failed','error':str(e),'ownFilesRestored':restored,'foreignFilesNotTouched':foreign,'additiveFilesPreserved':True,'noBusinessDml':True,'noDatabaseConnection':True});raise
