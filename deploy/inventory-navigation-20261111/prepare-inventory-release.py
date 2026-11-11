#!/usr/bin/env python3
"""Prepare one admin-only, explicitly approved inventory-navigation release."""
from pathlib import Path
import hashlib,json,shutil,subprocess,time
BASE=Path('/home/ubuntu/51-inspection');TOOLS=BASE/'deployment-tools';REPO=BASE/'manager-github'
CANDIDATE=BASE/'candidate-inventory-admin';STAGE=BASE/'inventory-release-stage'
def sha(data):return hashlib.sha256(data).hexdigest()
def load(p):return json.loads(p.read_bytes())
def dump(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
def head(repo):return subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
assert not STAGE.exists(),'Archive an existing stage before creating a different fixed candidate'
manifest=load(CANDIDATE/'manifest.json');runtime=load(CANDIDATE/'runtime-test.json')
assert runtime.get('passed') is True,'Actual candidate runtime verification required'
verification=load(CANDIDATE/'verification.json')
assert verification.get('success',verification.get('passed')) is True,'Independent candidate verification required'
assert not subprocess.check_output(['git','status','--porcelain'],cwd=REPO,text=True).strip(),'Commit finalized source and tools before staging'
STAGE.mkdir(mode=0o700);admin=STAGE/'admin';admin.mkdir()
for name in ['index.html','manifest.json','runtime-test.json','verification.json']:
 shutil.copy2(CANDIDATE/name,admin/name)
shutil.copytree(BASE/'inventory-baseline',STAGE/'runtime-baseline')
index=manifest['index'];before_index=index.get('beforeSha256',index.get('indexSHA256Before'));after_index=index.get('afterSha256',index.get('indexSHA256After'))
assert before_index and after_index and sha((admin/'index.html').read_bytes())==after_index
assets=[]
for row in manifest['files']:
 name=row['file'];source=CANDIDATE/name
 if not source.is_file():source=CANDIDATE/'assets'/name
 assert source.is_file(),'Missing candidate JS:'+name
 relative='assets/'+Path(name).name;target=admin/relative;target.parent.mkdir(exist_ok=True);shutil.copy2(source,target)
 assert sha(target.read_bytes())==row['sha256']
 assets.append({'file':relative,'url':row['url'],'sha256':row['sha256'],'originalUrl':row['beforeURL'],'beforeSha256':row['beforeSha256']})
css=manifest.get('css',[])
if isinstance(css,dict):css=[css]
for row in css:
 name=row['file'];source=CANDIDATE/name
 if not source.is_file():source=CANDIDATE/'assets'/name
 assert source.is_file(),'Missing candidate CSS:'+name
 relative='assets/'+Path(name).name;target=admin/relative;target.parent.mkdir(exist_ok=True);shutil.copy2(source,target)
 assert sha(target.read_bytes())==row['sha256']
 assets.append({'file':relative,'url':row['url'],'sha256':row['sha256']})
source_rows=manifest.get('sourceFiles',manifest.get('sourcePins',[]));assert source_rows,'Source provenance required'
source_before=STAGE/'source-before';source_before.mkdir()
for row in source_rows:
 raw=row.get('path',row.get('file'));path=Path(raw)
 if path.is_absolute():path=path.relative_to(REPO)
 relative=path.as_posix();expected=row.get('afterSha256',row.get('sha256'))
 assert expected,'Source-after hash required:'+relative
 committed=subprocess.check_output(['git','show','HEAD:'+relative],cwd=REPO)
 assert sha(committed)==expected,'Committed source differs from candidate:'+relative
 before=BASE/'inventory-source-before'/relative
 if before.is_file():
  expected_before=row.get('beforeSha256',row.get('beforeSourceSha256'))
  assert expected_before and sha(before.read_bytes())==expected_before,'Source-before proof missing:'+relative
  destination=source_before/relative;destination.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(before,destination)
 else:
  assert row.get('newSourceAbsenceProven') is True and row.get('beforeKind','').startswith('EXTRACTED_'),'New source needs real inline-owner and absence proof:'+relative
  owner=Path(row['beforeFile']);owner_relative=owner.relative_to(BASE/'inventory-source-before')
  assert owner.is_file() and sha(owner.read_bytes())==row['beforeSha256'],'Real inline owner hash:'+relative
  destination=source_before/owner_relative;destination.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(owner,destination)
for name in ['publish-inventory-navigation.py','test-inventory-publisher.py']:
 shutil.copy2(TOOLS/name,STAGE/name)
shutil.copy2(BASE/'inventory-evidence/publisher-tests.log',STAGE/'publisher-tests.log')
for name in ['inventory-customer-proof.json','inventory-runtime-factories.json','inventory-nav-synthetic.json']:
 shutil.copy2(TOOLS/name,STAGE/name)
for name in ['source-test-summary.json','customer-tests-verified-final.json','host-direct-final.json','navigation-tests-vitest.json','actual-source.diff','customer-typecheck-verified-final.log']:
 shutil.copy2(BASE/'inventory-evidence'/name,STAGE/name)
commits={'manager':head(REPO),'platform':head(BASE/'platform-github')}
subprocess.run(['git','archive','--format=tar.gz','--output',str(STAGE/('source-manager-'+commits['manager'][:12]+'.tar.gz')),commits['manager']],cwd=REPO,check=True)
subprocess.run(['git','archive','--format=tar.gz','--output',str(STAGE/'source-before-fdc9da77bb7c.tar.gz'),'fdc9da77bb7c1db09a8f8c5e73c419391e5a53eb','client/'],cwd=REPO,check=True)
shutil.copy2(REPO/'TODO-inventory-navigation-20261111.md',STAGE/'implementation.md')
protected=load(BASE/'inventory-evidence/protected-current.json')
publisher_sha=sha((STAGE/'publish-inventory-navigation.py').read_bytes())
sides={'admin':{'beforeIndexSha256':before_index,'indexSha256':after_index,'assets':assets}}
candidate_id=sha(json.dumps({'sourceCommits':commits,'sides':sides,'publisherSha256':publisher_sha},sort_keys=True).encode())[:12]
ops='/opt/ops/20261111-inventory-navigation-'+candidate_id
release={'schemaVersion':1,'scope':'inventory-navigation-admin-static-only','candidateId':candidate_id,
 'preparedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'opsDirectory':ops,'sourceCommits':commits,
 'sourceBaseCommit':'fdc9da77bb7c1db09a8f8c5e73c419391e5a53eb','sides':sides,
 'databaseChanges':False,'apiChanges':False,'processChanges':False,'globalFreezeChanges':False,
 'publicFrontendChanged':False,'publisherSha256':publisher_sha,'protectedFiles':protected['protectedFiles'],
 'processes':protected['processes'],'coordSha256':protected['coordSha256'],'publisherSafetyTestsPassed':10,
 'sourceTestEvidence':load(BASE/'inventory-evidence/source-test-summary.json'),
 'fixedCandidateApprovalRequired':True,'stageFiles':{}}
for p in sorted(STAGE.rglob('*')):
 if p.is_file():release['stageFiles'][p.relative_to(STAGE).as_posix()]=sha(p.read_bytes())
dump(STAGE/'release-manifest.json',release)
info={'opsDirectory':ops,'candidateId':candidate_id,'releaseManifestSha256':sha((STAGE/'release-manifest.json').read_bytes()),
 'sourceCommits':commits,'assetCounts':{'admin':len(assets)},'stageDirectory':str(STAGE),'publicFrontendChanged':False}
dump(BASE/'inventory-stage-info.json',info);print(json.dumps(info,ensure_ascii=False,indent=2))
