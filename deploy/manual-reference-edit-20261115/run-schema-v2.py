#!/usr/bin/env python3
from pathlib import Path
import hashlib,json,subprocess,sys,uuid
W=Path('/home/ubuntu/work/manual-reference-edit-20261115')
A=W/'schema-maintenance-v2'
ROOT='/opt/ops/20261115-manual-reference-schema-v2-JfFQcJM'
SSH=['ssh','-i','/home/ubuntu/.ssh/51-ecs.pem','-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','ConnectTimeout=15','-o','ControlMaster=auto','-o','ControlPersist=900','-o','ControlPath=/home/ubuntu/.ssh/51-manual-deploy.sock','root@47.97.108.147']
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def run(cmd,data=None):
    r=subprocess.run(SSH+[cmd],input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=120)
    if r.returncode:
        print('SSH_FAILED_INSPECT_NO_REPLAY',r.returncode,r.stderr.decode(errors='replace')[:1500]);raise SystemExit(r.returncode)
    return r.stdout
if __name__=='__main__':
    mode=sys.argv[1]; assert mode in ['stage','plan','apply','verify']
    if mode=='stage':
        assert not A.exists(),'LOCAL_ATTEMPT_EXISTS_INSPECT_NOT_REGENERATE'
        A.mkdir(mode=0o700)
        intent={'contractVersion':'single-manual-reference-table-v1','userConfirmed':True,'confirmationText':'实施','confirmationAt':'2026-11-15T17:47:18+08:00','ownerTask':'JfFQcJMqqFudyf4S9Egg7M','root':ROOT,'table':'channel_inventory_manual_references','requestId':str(uuid.uuid4()),'sqlSha256':sha(W/'schema.sql'),'runnerSha256':sha(W/'manual-schema-v2.cjs'),'frontSha256':'132c2a9924da37ccb50fadeb014865400df5cddf8d2255594631041cb1718538','coordSha256':'7137531cdad59bb3484117fd33f88a82c85ef2f83ab7104a7106c2602fee4e61','expectedColumns':['enterpriseId','dataOwnerUserId','materialId','manualReferenceLcsc','manualReferenceIckey','updatedByUserId','updatedByAdminAccountId','updatedAt'],'scope':'Create exactly one additive empty table; no data backfill, no existing-table DML/DDL, no PM2 reload, no old release ROOT or coordinator mutation.'}
        (A/'intent.json').write_text(json.dumps(intent,ensure_ascii=False,indent=2)+'\n')
        run('test ! -e '+ROOT+' && mkdir -m 700 '+ROOT)
        for name,file in [('intent.json',A/'intent.json'),('manual-schema.cjs',W/'manual-schema-v2.cjs'),('schema.sql',W/'schema.sql')]:
            run('umask 077; cat > '+ROOT+'/'+name,file.read_bytes())
        print('STAGED_NEW_PRIVATE_SCHEMA_ATTEMPT_NO_DATABASE_WRITES',intent['requestId'],sha(A/'intent.json'))
    else:
        intent=json.loads((A/'intent.json').read_text());ih=sha(A/'intent.json')
        assert sha(W/'manual-schema-v2.cjs')==intent['runnerSha256'],'RUNNER_CHANGED_AFTER_STAGE'
        assert sha(W/'schema.sql')==intent['sqlSha256'],'SQL_CHANGED_AFTER_STAGE'
        if mode in ['plan','apply']: assert not (A/(mode+'-result.json')).exists(),'DO_NOT_REPLAY_COMPLETED_MODE'
        ph=sha(A/'plan-result.json') if mode in ['apply','verify'] else ''
        cmd='test "$(sha256sum '+ROOT+'/manual-schema.cjs | cut -d\' \' -f1)" = '+intent['runnerSha256']+' && flock -n /var/lock/dianzi51-public-deploy.lock flock -n /var/lock/dianzi51-production-code.lock node '+ROOT+'/manual-schema.cjs '+mode+' '+ih+' '+ph
        data=run(cmd);result=json.loads(data)
        (A/(mode+'-result.json')).write_bytes(data)
        if mode!='apply':run('umask 077; cat > '+ROOT+'/'+mode+'-result.json',data)
        print(json.dumps(result,ensure_ascii=False,indent=2))
