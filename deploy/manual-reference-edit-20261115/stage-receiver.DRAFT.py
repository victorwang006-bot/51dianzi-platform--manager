#!/usr/bin/env python3
"""DRAFT FOR PARENT REVIEW ONLY; never run by preparation agent.
File-only stdin tar contract: candidate/<package-relative>, candidate/manifest.json,
external/activation.json and external/<basename-of-each-activation-evidence-pin>.
No SSH client, activation, DB, reload, old ROOT writes or coordination edits.
Default --inspect validates in memory without writing. --stage additionally requires
real pinned parent approval, two existing nonblocking locks, closed captured coord,
and both entirely new destination directories. No partial failure cleanup/replay.
"""
import argparse, hashlib, io, json, os, pathlib, re, sys, tarfile, fcntl
ROOT='/opt/ops/20261115-manual-reference-edit-JfFQcJM'
OLD='/opt/ops/20261115-customer-origin-edit-JfFQcJM'
CANDIDATE=ROOT+'-candidate'
OWNER='JfFQcJMqqFudyf4S9Egg7M'
COORD='/opt/ops/51-project-release-coordination-20261027.json'
LOCKS=['/var/lock/dianzi51-public-deploy.lock','/var/lock/dianzi51-production-code.lock']
EVIDENCE=['parentApproval','affectedNativeQA','readonlyHelperQA','databaseMaintenanceReceipt']
def need(v,message):
    if not v: raise RuntimeError(message)
def sha(b): return hashlib.sha256(b).hexdigest()
def fullsha(s): need(isinstance(s,str) and re.fullmatch('[0-9a-f]{64}',s),'FULL_SHA_REQUIRED'); return s
def safe(n):
    need(isinstance(n,str) and re.fullmatch('[A-Za-z0-9._/-]{1,512}',n),'SAFE_ARCHIVE_PATH_REQUIRED')
    need(not n.startswith('/') and all(x not in ('','.','..','.git','node_modules') for x in n.split('/')),'ARCHIVE_ESCAPE_OR_FORBIDDEN_DIRECTORY')
    return n
def no_links(p,allow_verified_lock_alias=False):
    p=pathlib.Path(p)
    for q in [p,*p.parents]:
        if os.path.lexists(q) and q.is_symlink():
            standard=allow_verified_lock_alias and q==pathlib.Path('/var/lock') and os.readlink(q)=='../run/lock' and str(q.resolve())=='/run/lock'
            need(standard,'DESTINATION_SYMLINK_REFUSED '+str(q))
            st=os.stat('/run/lock');need(st.st_uid==0 and st.st_gid==0 and (st.st_mode&0o777)==0o755,'VERIFIED_SYSTEM_LOCK_TARGET_REQUIRED')
def main():
    ap=argparse.ArgumentParser(description=__doc__)
    mode=ap.add_mutually_exclusive_group(required=True); mode.add_argument('--inspect',action='store_true'); mode.add_argument('--stage',action='store_true')
    for n in ('tar-sha256','manifest-sha256','activation-sha256'): ap.add_argument('--'+n,required=True)
    a=ap.parse_args(); [fullsha(x) for x in (a.tar_sha256,a.manifest_sha256,a.activation_sha256)]
    archive=sys.stdin.buffer.read(1024*1024*1024+1);need(len(archive)<=1024*1024*1024,'BOUNDED_TAR_REQUIRED');need(sha(archive)==a.tar_sha256,'FULL_STDIN_TAR_SHA_MISMATCH')
    files={}
    with tarfile.open(fileobj=io.BytesIO(archive),mode='r:') as tf:
        for entry in tf:
            n=safe(entry.name);need(n.startswith(('candidate/','external/')),'EXACT_ARCHIVE_NAMESPACES_ONLY');need(n not in files,'DUPLICATE_TAR_MEMBER');need(entry.isfile() and not entry.issparse() and not entry.linkname,'FILE_ONLY_TAR_NO_LINKS_DEVICES_OR_DIRECTORIES');need(not entry.pax_headers,'PAX_HEADERS_REFUSED');need(0<=entry.size<=256*1024*1024,'BOUNDED_FILE_REQUIRED');need(len(files)<4096,'BOUNDED_FILE_COUNT_REQUIRED')
            content=tf.extractfile(entry).read(entry.size+1);need(len(content)==entry.size,'TRUNCATED_TAR_FILE');files[n]=content
    need('candidate/manifest.json' in files and 'external/activation.json' in files,'MANIFEST_AND_EXTERNAL_ACTIVATION_REQUIRED')
    mb=files['candidate/manifest.json'];ab=files['external/activation.json'];need(sha(mb)==a.manifest_sha256 and sha(ab)==a.activation_sha256,'EXTERNAL_ENVELOPE_PIN_MISMATCH');m=json.loads(mb);c=json.loads(ab)
    need(m['contractVersion']=='manual-reference-edit-release-v1' and m['fixtureOnly'] is False and m['runtimeRoot']==ROOT and m['priorRuntimeRoot']==OLD and m['candidateDir']==CANDIDATE and m['ownerTask']==OWNER,'MANIFEST_NEW_ROOT_OWNER_REQUIRED')
    need(c['contractVersion']=='manual-reference-edit-activation-v1' and c['runtimeRoot']==ROOT and c['candidateDir']==CANDIDATE and c['ownerTask']==OWNER and c['manifestSha256']==a.manifest_sha256 and c['inputContractSha256']==m['inputContractSha256'],'ACTIVATION_NEW_ROOT_MANIFEST_INPUT_BINDING_REQUIRED')
    for key in ('attemptId','rootOwnershipNonce'): need(re.fullmatch('[A-Za-z0-9_-]{16,96}',c[key]),'NEW_ATTEMPT_AND_NONCE_REQUIRED')
    external_root=ROOT+'-activation-'+c['attemptId'];need(external_root not in (ROOT,OLD,CANDIDATE),'NEW_EXTERNAL_ROOT_REQUIRED')
    pk=m['packageHashes'];need(isinstance(pk,dict) and len(pk)>0 and 'manifest.json' not in pk,'EXACT_PACKAGE_MANIFEST_CONTRACT');expected={'candidate/manifest.json','external/activation.json'}
    for n,h in pk.items(): safe(n);fullsha(h);name='candidate/'+n;expected.add(name);need(name in files and sha(files[name])==h,'FULL_PACKAGE_HASH_MISMATCH '+n)
    evidence={}
    for key in EVIDENCE:
        pin=c[key];f=pin['file'];h=fullsha(pin['sha256']);need(isinstance(f,str) and str(pathlib.PurePosixPath(f).parent)==external_root,'EXTERNAL_PIN_MUST_USE_NEW_APPROVED_ACTIVATION_DIRECTORY');n=safe(pathlib.PurePosixPath(f).name);name='external/'+n;need(name not in expected,'EXTERNAL_PIN_FILENAME_COLLISION');expected.add(name);need(name in files and sha(files[name])==h,'EXTERNAL_APPROVAL_QA_PIN_MISMATCH '+key);evidence[key]=json.loads(files[name])
    need(set(files)==expected,'EXACT_COMPLETE_ARCHIVE_FILE_SHAPE_REQUIRED')
    p=evidence['parentApproval'];need(p['approved'] is True and p['fixtureOnly'] is False and p['manifestSha256']==a.manifest_sha256,'REAL_PARENT_APPROVAL_REQUIRED')
    p=evidence['affectedNativeQA'];need(p['status']=='PASS' and p['fixtureOnly'] is False and p['manifestSha256']==a.manifest_sha256,'REAL_AFFECTED_NATIVE_QA_REQUIRED')
    p=evidence['readonlyHelperQA'];need(p['status']=='PASS' and p['fixtureOnly'] is False and p['defaultRealSiblingLoaderUsed'] is True and p['helperHashes']==m['runtimeHelpers'] and p['snapshotSha256']==m['snapshotSha256'] and p['sourceRecordsChecked']==588 and p['statusCounts'].get('lcsc:ok',0)+p['statusCounts'].get('ickey:ok',0)==213 and p['readonly'] is True and p['http'] is False and p['db'] is False and p['businessWrites']==0,'REAL_COPIED_HELPER_QA_REQUIRED')
    p=evidence['databaseMaintenanceReceipt'];need(p['approved'] is True and p['fixtureOnly'] is False and p['status']=='VERIFIED' and p['table']=='channel_inventory_manual_references' and type(p['databaseWrites']) is int and p['databaseWrites']==1 and re.fullmatch('/opt/ops/[A-Za-z0-9_-]+',p['root']) and p['root'] not in (ROOT,OLD,CANDIDATE),'REAL_SEPARATE_SCHEMA_RECEIPT_EXACT_ONE_WRITE_REQUIRED');need(m['scope']['dbWrites'] is None and m['scope']['codeDriverDatabaseAccess'] is False,'CODE_DRIVER_DB_NULL_NOT_FAKE_ZERO')
    for f in (ROOT,CANDIDATE,external_root): no_links(f);need(not os.path.lexists(f),'DESTINATION_ALREADY_EXISTS_NO_REPLAY '+f)
    staged=False;fds=[]
    if a.stage:
        need(os.geteuid()==0,'PARENT_REVIEWED_ROOT_STAGE_ONLY')
        try:
            for lock in LOCKS:
                no_links(lock,allow_verified_lock_alias=True);physical=str(pathlib.Path(lock).resolve());need(physical=='/run/lock/'+pathlib.Path(lock).name,'EXACT_PHYSICAL_LOCK_PATH');fd=os.open(physical,os.O_RDWR|os.O_NOFOLLOW);fds.append(fd);fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            no_links(COORD);cb=pathlib.Path(COORD).read_bytes();need(sha(cb)==m['capturedCoordSha256'] and json.loads(cb)['shared_release_active'] is False,'CAPTURED_CLOSED_COORD_CAS_REQUIRED_NO_REBASE')
            for f in (ROOT,CANDIDATE,external_root): no_links(f);need(not os.path.lexists(f),'DESTINATION_RACE_NO_REPLAY')
            os.mkdir(CANDIDATE,0o700);os.mkdir(external_root,0o700)
            for name,content in sorted(files.items()):
                namespace,relative=name.split('/',1);target=pathlib.Path(CANDIDATE if namespace=='candidate' else external_root)/relative
                target.parent.mkdir(parents=True,exist_ok=True,mode=0o700);no_links(target.parent)
                fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                with os.fdopen(fd,'wb') as stream: stream.write(content);stream.flush();os.fsync(stream.fileno())
                need(sha(target.read_bytes())==sha(content),'STAGED_FULL_SHA_MISMATCH')
            for root in (CANDIDATE,external_root):
                dirs=[p for p in pathlib.Path(root).rglob('*') if p.is_dir()]+[pathlib.Path(root)]
                for directory in dirs:
                    fd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
                    try: os.fsync(fd)
                    finally: os.close(fd)
            need(pathlib.Path(COORD).read_bytes()==cb,'COORD_BYTES_MUST_REMAIN_UNCHANGED');staged=True
        finally:
            for fd in reversed(fds): os.close(fd)
    print(json.dumps({'status':'STAGED' if staged else 'INSPECTED_WITHOUT_WRITES','draftReceiver':True,'manifestSha256':a.manifest_sha256,'activationSha256':a.activation_sha256,'packageCount':len(pk),'candidateDir':CANDIDATE,'activationFile':external_root+'/activation.json','productionActivationExecuted':False,'databaseAccess':False},indent=2))
if __name__=='__main__':
    try: main()
    except Exception as exc: print('STAGE_DRAFT_FAIL_CLOSED: '+str(exc),file=sys.stderr);sys.exit(1)
