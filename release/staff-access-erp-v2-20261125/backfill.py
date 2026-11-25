import os,json,fcntl,subprocess,datetime,tempfile,sys
W='/opt/ops/team1-customer-backfill-20261125'; os.makedirs(W,exist_ok=True)
COORD='/opt/ops/51-project-release-coordination-20261027.json'
LOCKS=['/var/lock/dianzi51-public-deploy.lock','/var/lock/dianzi51-production-code.lock']
OWNER='eJapJsCGyh39J1FCKC4wSR'; SCOPE='team1-customer-backfill-20261125'
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
def need(c,m):
    if not c: raise SystemExit('FAIL '+m)
def wr(path,data,ref):
    d=os.path.dirname(path); fd,t=tempfile.mkstemp(dir=d,prefix='.tmp-')
    os.write(fd,data); os.fchown(fd,ref.st_uid,ref.st_gid); os.fchmod(fd,ref.st_mode&0o7777)
    os.fsync(fd); os.close(fd); os.rename(t,path)
def Q(sql):
    r=subprocess.run(['mysql','--defaults-extra-file=/root/.ro.cnf','--default-character-set=utf8mb4','-N','-B','-e',sql],capture_output=True,text=True)
    if r.returncode: raise RuntimeError(r.stderr)
    return [l.split('\t') for l in r.stdout.strip().splitlines() if l]
COND=("FROM crm_customers c INNER JOIN enterprise_team_members m ON m.enterpriseId=1 AND m.teamId=1 AND m.userId=c.assignedUserId "
      "INNER JOIN enterprise_teams t ON t.id=1 AND t.enterpriseId=1 AND t.status='active' "
      "WHERE c.enterpriseId=1 AND NOT EXISTS (SELECT 1 FROM enterprise_team_record_assignments a WHERE a.enterpriseId=1 AND a.recordType='customer' AND a.recordId=c.id)")
fds=[]
for p in LOCKS:
    fd=os.open(p,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600); fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB); fds.append(fd)
print('DUAL_LOCKS_ACQUIRED',flush=True)
raw=open(COORD,'rb').read(); coord=json.loads(raw); cst=os.stat(COORD)
need(coord.get('shared_release_active') is False and coord['window']['status']=='closed','RELEASE_WINDOW_BUSY')
open(W+'/before-coord.json','wb').write(raw)
before=Q("SELECT c.id,c.assignedUserId,c.createdByUserId "+COND+" ORDER BY c.id")
maxid=int(Q("SELECT COALESCE(MAX(id),0) FROM enterprise_team_record_assignments")[0][0])
json.dump({'maxAssignmentIdBefore':maxid,'customers':before},open(W+'/before-unassigned.json','w'))
print('UNASSIGNED',len(before),'MAXID',maxid,flush=True)
need(0<len(before)<=400,'UNEXPECTED_COUNT')
o=dict(coord); o['shared_release_active']=True
o['window']={'status':'opening','owner_task':OWNER,'scope':SCOPE,'openedAtUtc':now(),'needsOperatorRecovery':False,'kind':'db-data-backfill'}
wr(COORD,json.dumps(o,ensure_ascii=False,indent=2).encode(),cst); print('WINDOW_OPENED',flush=True)
result='VERIFIED'; err=None; inserted=0
try:
    Q("START TRANSACTION; INSERT INTO enterprise_team_record_assignments (enterpriseId,teamId,recordType,recordId,createdByUserId,currentOwnerUserId,revision) "
      "SELECT 1,1,'customer',c.id,c.createdByUserId,c.assignedUserId,1 "+COND+"; COMMIT;")
    ids=set(int(r[0]) for r in before)
    got=Q(f"SELECT recordId,teamId,currentOwnerUserId FROM enterprise_team_record_assignments WHERE id>{maxid} AND enterpriseId=1 AND recordType='customer' AND teamId=1")
    inserted=len(got)
    need(set(int(r[0]) for r in got)>=ids,'VERIFY_MISSING')
    left=int(Q("SELECT COUNT(*) "+COND)[0][0])
    print('INSERTED',inserted,'REMAINING',left,flush=True)
except BaseException as e:
    err=repr(e); result='ROLLED_BACK'
    ids=",".join(r[0] for r in before) or "0"
    Q(f"DELETE FROM enterprise_team_record_assignments WHERE id>{maxid} AND enterpriseId=1 AND recordType='customer' AND teamId=1 AND revision=1 AND recordId IN ({ids})")
    print('ROLLED_BACK',err,flush=True)
c=json.loads(open(COORD,'rb').read()); c['shared_release_active']=False
c['window']=dict(c['window'],status='closed',closedAtUtc=now(),result=result,needsOperatorRecovery=False)
wr(COORD,json.dumps(c,ensure_ascii=False,indent=2).encode(),cst)
json.dump({'scope':SCOPE,'result':result,'error':err,'team':'智捷团队1 (id=1)','planned':len(before),'inserted':inserted,
 'rollbackSql':f"DELETE FROM enterprise_team_record_assignments WHERE id>{maxid} AND enterpriseId=1 AND recordType='customer' AND teamId=1 AND revision=1 AND recordId IN (ids in before-unassigned.json)",
 'finishedAtUtc':now()},open(W+'/receipt.json','w'),ensure_ascii=False,indent=1)
print('WINDOW_CLOSED',result,flush=True)
