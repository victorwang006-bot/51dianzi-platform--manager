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
 dest=Path(dest);tmp=dest.with_name(dest.name+'.admin-new-information-v1-next');assert not tmp.exists(),'LEFTOVER_ATOMIC_TARGET';tmp.write_bytes(Path(src).read_bytes());tmp.chmod(mode);os.replace(tmp,dest)
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
DBNODE=r'''const fs=require('fs');const {createRequire}=require('module');const p=JSON.parse(fs.readFileSync(process.argv[1]+'/release-manifest.json','utf8'));const mode=process.argv[2],role=process.argv[3],d=p.databases[role];const mysql=createRequire(d.packageCwd+'/package.json')('mysql2/promise');(async()=>{const c=await mysql.createConnection(process.env.DATABASE_URL);const [[version]]=await c.query('SELECT VERSION() AS v');if(!version.v.startsWith('8.0.'))throw Error('DB_VERSION_DRIFT');const qs=a=>a.map(()=>'?').join(',');const [deps]=await c.query('SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('+qs(d.dependencies)+')',d.dependencies);if(deps.length!==d.dependencies.length||deps.some(t=>t.ENGINE!=='InnoDB'))throw Error('ORIGINAL_DEPENDENCY_TABLE_DRIFT:'+role);const readTables=async()=>{const [r]=await c.query('SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('+qs(d.tables)+')',d.tables);return r;};const check=async rows=>{if(rows.some(t=>t.ENGINE!=='InnoDB'))throw Error('NEW_INFORMATION_ENGINE_DRIFT');for(const r of rows){const name=r.TABLE_NAME;const [cols]=await c.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[name]);if(JSON.stringify(cols.map(r=>r.COLUMN_NAME).sort())!==JSON.stringify(d.tableColumns[name].slice().sort()))throw Error('NEW_INFORMATION_COLUMN_DRIFT:'+name);const [idx]=await c.query('SELECT INDEX_NAME,SEQ_IN_INDEX,COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND NON_UNIQUE=0 ORDER BY INDEX_NAME,SEQ_IN_INDEX',[name]);const groups={};for(const r of idx)(groups[r.INDEX_NAME]??=[]).push(r.COLUMN_NAME);for(const required of d.uniqueKeys[name])if(!Object.values(groups).some(k=>JSON.stringify(k)===JSON.stringify(required)))throw Error('NEW_INFORMATION_KEY_DRIFT:'+name);const [foreign]=await c.query('SELECT CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=?',[name]);if(foreign.length)throw Error('UNEXPECTED_FOREIGN_KEY:'+name);}};const before=await readTables();await check(before);if(mode==='install'){const sql=fs.readFileSync(process.argv[1]+'/'+d.ddlSource,'utf8').replace(/^\s*--.*$/mg,'');const statements=sql.split(';').map(s=>s.trim()).filter(Boolean);if(statements.length!==d.tables.length)throw Error('DDL_STATEMENT_COUNT');for(const stmt of statements){const m=/^CREATE TABLE IF NOT EXISTS `?([a-z_]+)`?\s*\(/i.exec(stmt);if(!m||!d.tables.includes(m[1])||/\b(?:ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|GRANT|REPLACE)\b/i.test(stmt)||!/ENGINE=InnoDB/i.test(stmt))throw Error('DDL_NOT_EMPTY_METADATA_TABLE_ONLY');}for(const stmt of statements)await c.query(stmt);}const now=await readTables();if(mode!=='preflight'&&now.length!==d.tables.length)throw Error('NEW_INFORMATION_TABLES_MISSING');await check(now);const counts={};await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await c.query('START TRANSACTION READ ONLY');for(const t of now){const [[r]]=await c.query('SELECT COUNT(*) AS n FROM `'+t.TABLE_NAME+'`');counts[t.TABLE_NAME]=Number(r.n);}await c.rollback();console.log(JSON.stringify({role,databaseVersion:version.v,originalDependencyTables:deps.length,beforeMetadataTables:before.length,metadataTables:now.length,metadataCounts:counts,innoDbAndExactKeysVerified:true,readOnlyRepeatableReadSqlAccepted:true,emptyTablesOnly:true,ddlPerformed:mode==='install',noBusinessDml:true,noBindingInstallation:true}));await c.end();})().catch(e=>{console.error(e.code||e.message);process.exit(1)});'''
def db(mode):
 result={}
 current=json.loads(run(['pm2','jlist']))
 for role,d in M['databases'].items():
  rows=[x for x in current if x['name']==d['processName']];assert len(rows)==d['expectedInstances']==sum(x['name']==d['processName']for x in B['processes']),'DATABASE_PROCESS_BINDING_DRIFT'
  urls=set()
  for x in rows:
   e=x['pm2_env'];env={**e,**e.get('env',{})};assert e['pm_cwd']==d['packageCwd'],'DATABASE_CWD_DRIFT'
   if env.get('DATABASE_URL'):urls.add(env['DATABASE_URL'])
  assert len(urls)==1,'DATABASE_URL_BINDING_DRIFT'
  env={'PATH':'/usr/bin:/bin','DATABASE_URL':urls.pop()}
  r=subprocess.run(['node','-e',DBNODE,str(R),mode,role],cwd=d['packageCwd'],env=env,capture_output=True,timeout=80)
  assert r.returncode==0,'SQL_CHECK_FAILED:'+role+':'+r.stderr.decode()[-300:]
  result[role]=json.loads(r.stdout)
 return result
def validate():
 assert M['scope']=='admin-new-information-v1' and M['independentReview']=='passed','REVIEW_REQUIRED'
 assert {x['name'] for x in B['processes'] if x['name'] in M['reloadNames']}==set(M['reloadNames'])
 assert M['reloadNames']==['dianzi51','dianzi51-admin']
 assert len(M['replace'])==3 and sum(x['kind']=='api' for x in M['replace'])==2 and sum(x['kind']=='html' for x in M['replace'])==1
 assert M['emptyTablesOnly'] is True and M['noBusinessDml'] is True and M['noBindingInstallation'] is True
 assert set(M['databases'])=={'front','admin'}
 expected={'admin':['admin_new_information_states','admin_new_information_seen'],'front':['admin_new_information_customer_assignments','admin_new_information_customer_assignment_demands','admin_new_information_customer_creations','admin_new_information_origins']}
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
  if p.suffix in ['js','mjs']:run(['node','--input-type=module','--check'],30) if False else subprocess.run(['node','--input-type=module','--check'],input=(R/f['source']).read_bytes(),capture_output=True,check=True)
 assert not Path(M['bindingTarget']).exists() or H(M['bindingTarget'])==M['bindingSha256'],'OLD_BINDING_PROTECTION_DRIFT'
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
 result={'status':'applied','finishedAt':time.time(),'database':d,'processes':rows,'noBusinessDml':True,'emptyTablesOnly':True,'noBindingInstallation':True,'workersUnchanged':True,'noPm2SaveOrEnvironmentUpdate':True};jsonwrite(R/'apply-result.json',result);print(json.dumps(result))
except Exception as e:
 restored=[];foreign=[]
 for f in reversed(changed):
  p=Path(f['target']);i=M['replace'].index(f)
  if p.exists() and H(p)==f['sha256']:atomic(backup/str(i),p);restored.append(str(p))
  else:foreign.append(str(p))
 if reloaded and not foreign:
  for name in M['reloadNames']:run(['pm2','reload' if name in ['dianzi51','dianzi51-admin'] else 'restart',name],150)
 jsonwrite(R/'apply-result.json',{'status':'failed','error':str(e),'ownFilesRestored':restored,'foreignFilesNotTouched':foreign,'additiveFilesPreserved':True,'noBusinessDml':True,'newEmptyTablesPreserved':True});raise
