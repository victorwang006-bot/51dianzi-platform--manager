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
 dest=Path(dest);tmp=dest.with_name(dest.name+'.official-mall-native-v10-next');assert not tmp.exists(),'LEFTOVER_ATOMIC_TARGET';tmp.write_bytes(Path(src).read_bytes());tmp.chmod(mode);os.replace(tmp,dest)
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
DBNODE=r'''const fs=require('fs');const {createRequire}=require('module');const p=JSON.parse(fs.readFileSync(process.argv[1]+'/release-manifest.json','utf8'));const mode=process.argv[2];const mysql=createRequire(p.dbCwd+'/package.json')('mysql2/promise');(async()=>{const c=await mysql.createConnection(process.env.DATABASE_URL);const [[version]]=await c.query('SELECT VERSION() AS v');if(!version.v.startsWith('8.0.'))throw Error('DB_VERSION_DRIFT');const tables=p.tables;const [deps]=await c.query("SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('admin_users','admin_user_permissions','official_channel_teams','official_channel_team_members','materials')");if(deps.length!==5||deps.some(t=>t.ENGINE!=='InnoDB'))throw Error('NATIVE_DEPENDENCY_TABLE_DRIFT');const [catalogColumns]=await c.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='materials' AND COLUMN_NAME IN ('partNumber','brand','package','status')");if(catalogColumns.length!==4)throw Error('CATALOG_METADATA_ABI_DRIFT');const [before]=await c.query('SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?,?)',tables);if(mode==='install'){let sql=fs.readFileSync(process.argv[1]+'/official-mall-native.sql','utf8').replace(/^\s*--.*$/mg,'');const statements=sql.split(';').map(s=>s.trim()).filter(Boolean);if(statements.length!==3||statements.some(s=>!/^CREATE TABLE IF NOT EXISTS `official_mall_(materials|publications|requests)`\s*\(/.test(s)||/\b(?:ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|GRANT)\b/i.test(s)))throw Error('DDL_NOT_EMPTY_TABLE_ONLY');for(const stmt of statements)await c.query(stmt);}const [now]=await c.query('SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?,?)',tables);if(mode!=='preflight'&&now.length!==3)throw Error('NATIVE_MALL_TABLES_MISSING');if(now.some(t=>t.ENGINE!=='InnoDB'))throw Error('NATIVE_MALL_ENGINE_DRIFT');if(now.length===3){const [idx]=await c.query("SELECT INDEX_NAME,SEQ_IN_INDEX,COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='official_mall_requests' AND NON_UNIQUE=0 ORDER BY INDEX_NAME,SEQ_IN_INDEX");let groups={};for(const r of idx)(groups[r.INDEX_NAME]??=[]).push(r.COLUMN_NAME);if(!Object.values(groups).some(a=>JSON.stringify(a)===JSON.stringify(['actorAdminUserId','requestId'])))throw Error('NATIVE_REQUEST_UNIQUE_KEY_DRIFT');const expected=p.tableColumns;for(const name of tables){const [cols]=await c.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[name]);const got=cols.map(r=>r.COLUMN_NAME).sort();if(JSON.stringify(got)!==JSON.stringify(expected[name].slice().sort()))throw Error('NATIVE_MALL_COLUMN_DRIFT:'+name);}}let counts={};for(const t of now){const [[r]]=await c.query('SELECT COUNT(*) AS n FROM `'+t.TABLE_NAME+'`');counts[t.TABLE_NAME]=Number(r.n);}const [[isolation]]=await c.query('SELECT @@session.transaction_isolation AS v');console.log(JSON.stringify({databaseVersion:version.v,nativeDependencyTables:deps.length,catalogMetadataAbiVerified:true,beforeNativeTables:before.length,sidecarTables:now.length,sidecarCounts:counts,nativeInnoDbVerified:true,requestUniqueKeyVerified:now.length===3,sessionIsolation:isolation.v,initialRequestTransactionIsolation:'REPEATABLE READ',emptyTablesOnly:true,ddlPerformed:mode==='install',noBusinessDml:true,noBindingInstallation:true}));await c.end();})().catch(e=>{console.error(e.code||e.message);process.exit(1)});'''

def db(mode):
 dump=json.loads(Path('/root/.pm2/dump.pm2').read_text());urls={x.get('env',{}).get('DATABASE_URL') or x.get('DATABASE_URL') for x in dump if x.get('name')=='dianzi51-admin' and x.get('pm_cwd')==M['dbCwd']};urls.discard(None);assert len(urls)==1,'DATABASE_BINDING_DRIFT'
 env={'PATH':'/usr/bin:/bin','DATABASE_URL':urls.pop()};r=subprocess.run(['node','-e',DBNODE,str(R),mode],cwd=M['dbCwd'],env=env,capture_output=True,timeout=70);assert r.returncode==0,'SQL_CHECK_FAILED:'+r.stderr.decode()[-300:];return json.loads(r.stdout)
def validate():
 assert M['scope']=='official-mall-native-v10' and M['independentReview']=='passed','REVIEW_REQUIRED'
 assert {x['name'] for x in B['processes'] if x['name'] in M['reloadNames']}==set(M['reloadNames'])
 assert M['reloadNames']==['dianzi51','dianzi51-admin']
 assert len(M['replace'])==4 and sum(x['kind']=='api' for x in M['replace'])==2 and sum(x['kind']=='html' for x in M['replace'])==2
 assert M['emptyTablesOnly'] is True and M['noBusinessDml'] is True and M['noBindingInstallation'] is True
 assert H(R/'official-mall-native.sql')==M['ddlSha256'],'DDL_DRIFT'
 assert M['tables']==['official_mall_materials','official_mall_publications','official_mall_requests']
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
