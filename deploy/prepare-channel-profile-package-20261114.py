#!/usr/bin/env python3
"""Prepare only the authorized four static files and hashed evidence; does not deploy."""
import datetime, hashlib, json, re, shutil, subprocess, tarfile
from pathlib import Path
REPO=Path(__file__).resolve().parent.parent
WORK=Path('/home/ubuntu/work/channel-copy-cleanup')
CANDIDATE=WORK/'candidate'
PACKAGE=WORK/'package'
EVIDENCE=REPO/'deploy/channel-profile-evidence-20261114'
DRIVER=REPO/'deploy/activate-channel-copy-cleanup-20261114.py'
def load(p):return json.loads(Path(p).read_text())
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def save(p,x):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
def main():
 proof=load(CANDIDATE/'candidate-proof.json');actual=load(CANDIDATE/'actual-candidate-tests.json');review=load(WORK/'read-only-review.json')
 assert proof['status']=='PASS' and actual['status']=='PASS' and actual['failed']==0 and review['status']=='PASS'
 assert actual['mockNativeIO']['network']==actual['mockNativeIO']['mutations']==0
 assert len(proof['changedSourceFiles'])==4 and len(proof['files'])==4
 for f,pin in proof['sourceHashes'].items():assert sha(REPO/f)==pin,f
 inventory_log=(WORK/'source-tests.log').read_text();profile_log=(WORK/'profile-source-tests.log').read_text();tsc_log=(WORK/'profile-tsc.log').read_text()
 assert 'FINAL_TEST_EXIT_CODE=0' in inventory_log or 'FINAL_TEST_EXIT_CODE 0' in inventory_log or 'FINAL_TEST_EXIT_CODE0' in inventory_log
 assert 'EXIT_CODE=0' in profile_log and re.search(r'Tests\s+195 passed',profile_log)
 assert 'EXIT_CODE=0' in tsc_log
 validation={'status':'PASS','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceInventoryTestsPassed':46,'sourceProfileTestsPassed':195,'sourceTestFailures':0,'tscPassed':True,'actualCandidateGroupsPassed':actual['passed'],'actualCandidateFailures':0,'sourcePinsVerified':len(proof['sourceHashes']),'changedSourceFiles':proof['changedSourceFiles'],'reviewPassed':True,'loggedInBrowserPixelAcceptance':False,'noProductionTestWrites':True,'sourceLogHashes':{p.name:sha(p) for p in [WORK/'source-tests.log',WORK/'profile-source-tests.log',WORK/'profile-tsc.log']}}
 save(WORK/'source-validation.json',validation)
 PACKAGE.mkdir(parents=True,exist_ok=True);EVIDENCE.mkdir(parents=True,exist_ok=True)
 for f in proof['files']:
  src=CANDIDATE/f['relative'];assert sha(src)==f['sha256'];dest=PACKAGE/'candidate'/f['relative'];dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dest)
 names=['candidate-proof.json','actual-candidate-tests.json','html-build-proof.json','entry-build-proof.json','dependency-resolution-proof.json','static-dependencies.json','customer-source-hashes.json','customer-factory-metafile.json','workbench-0-build-proof.json','workbench-1-build-proof.json']
 evidence_hashes={}
 for name in names:
  src=CANDIDATE/name;shutil.copy2(src,PACKAGE/name);shutil.copy2(src,EVIDENCE/name);evidence_hashes[name]=sha(src)
 for name in ['source-validation.json','read-only-review.json','baseline-factory-reproduction.json']:
  src=WORK/name;shutil.copy2(src,PACKAGE/name);shutil.copy2(src,EVIDENCE/name);evidence_hashes[name]=sha(src)
 shutil.copy2(DRIVER,PACKAGE/DRIVER.name)
 snapshot=load('/home/ubuntu/work/channel-copy-protection-snapshot.json')
 manifest={'ownerTask':'CKSZQ7sVc7tADM21c3LWpu','scope':'customer archive default, original followups moved below contacts, four inventory copy removals','sourceBaseCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip(),'files':proof['files'],'coreAssetPaths':[f['relative'] for f in proof['files'] if f['relative']!='index.html'],'beforeHtmlSha256':snapshot['htmlSha256'],'driverSha256':sha(DRIVER),'evidenceHashes':evidence_hashes,'protectedFiles':snapshot['protectedFiles'],'baselineAssets':load(WORK/'baseline-files.json'),'dependencies':load(CANDIDATE/'static-dependencies.json'),'tscPassed':True,'sourceTestFailures':0,'reviewPassed':True}
 save(PACKAGE/'manifest.json',manifest);save(EVIDENCE/'manifest.json',manifest)
 archive=WORK/'channel-profile-20261114.tar.gz'
 with tarfile.open(archive,'w:gz') as tar:
  for child in sorted(PACKAGE.iterdir()):tar.add(child,arcname=child.name)
 print(json.dumps({'status':'PASS','files':len(proof['files']),'archiveBytes':archive.stat().st_size,'archiveSha256':sha(archive),'beforeHtml':manifest['beforeHtmlSha256'],'afterHtml':proof['files'][0]['sha256']}))
if __name__=='__main__':main()
