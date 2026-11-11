#!/usr/bin/env python3
from pathlib import Path
import gzip, hashlib, json, shutil, subprocess, time
BASE = Path('/home/ubuntu/51-inspection')
TOOLS = BASE / 'deployment-tools'
STAGE = BASE / 'release-stage'
def sha(data): return hashlib.sha256(data).hexdigest()
def read_json(p): return json.loads(p.read_bytes())
def write_json(p,d): p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
def commit(repo): return subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
def pin_source(repo,path,expected):
    data=subprocess.check_output(['git','show','HEAD:'+path],cwd=repo)
    assert sha(data)==expected, 'Committed source does not match candidate: '+path
assert not STAGE.exists(), 'Archive existing stage before preparing a new candidate'
STAGE.mkdir(mode=0o700)
front=read_json(BASE/'candidate-front/manifest.json'); admin=read_json(BASE/'candidate-admin/manifest.json')
commits={'platform':commit(BASE/'platform-github'),'manager':commit(BASE/'manager-github')}
for a in front['assets']:pin_source(BASE/'platform-github',a['source'],a['sourceSha256'])
for row in admin['sourceFiles']:
    path=Path(row['file']).relative_to(BASE/'manager-github').as_posix();pin_source(BASE/'manager-github',path,row['sha256'])
normalized={
 'front':{'beforeIndexSha256':front['beforeIndexSha256'],'indexSha256':front['indexSha256'],
          'assets':[{k:a[k] for k in ['url','file','sha256','originalUrl','beforeSha256']} for a in front['assets']]},
 'admin':{'beforeIndexSha256':admin['index']['beforeSha256'],'indexSha256':admin['index']['afterSha256'],
          'assets':[{'url':a['url'],'file':'assets/'+a['file'],'sha256':a['sha256'],'originalUrl':a['beforeURL'],'beforeSha256':a['beforeSha256']} for a in admin['files']] +
                   [{'url':admin['css']['url'],'file':'assets/'+admin['css']['file'],'sha256':admin['css']['sha256']}]}}
for side,spec in normalized.items():
    source=BASE/('candidate-'+side);destination=STAGE/side;destination.mkdir()
    for name in ['index.html','manifest.json','runtime-test.json']:
        shutil.copy2(source/name,destination/name)
    assert read_json(destination/'runtime-test.json')['passed'] is True
    for asset in spec['assets']:
        path=destination/asset['file'];path.parent.mkdir(exist_ok=True,parents=True);shutil.copy2(source/asset['file'],path)
        assert sha(path.read_bytes())==asset['sha256']
    assert sha((destination/'index.html').read_bytes())==spec['indexSha256']
shutil.copytree(TOOLS/'admin-source-before',STAGE/'source-before/admin')
shutil.copytree(TOOLS/'front-source-before',STAGE/'source-before/front')
for name in ['publish-demand-navigation.py','test-demand-publisher.py','publisher-tests.log',
             'build-demand-admin.mjs','verify-demand-admin.mjs','test-demand-admin-runtime.mjs',
             'build-front-demand-navigation.mjs','test-front-demand-runtime.mjs']:
    shutil.copy2(TOOLS/name,STAGE/name)
for repo,label in [(BASE/'manager-github','manager'),(BASE/'platform-github','platform')]:
    archive=STAGE/('source-'+label+'-'+commits[label][:12]+'.tar.gz')
    subprocess.run(['git','archive','--format=tar.gz','--output',str(archive),commits[label]],cwd=repo,check=True)
    shutil.copy2(repo/'TODO-demand-navigation-20261111.md',STAGE/('implementation-'+label+'.md'))
protected=read_json(TOOLS/'protected-current.json')
candidate_id=sha(json.dumps({'sourceCommits':commits,'sides':normalized,'publisher':sha((STAGE/'publish-demand-navigation.py').read_bytes())},sort_keys=True).encode())[:12]
ops='/opt/ops/20261111-demand-navigation-'+candidate_id
release={'schemaVersion':1,'scope':'demand-navigation-static-only','candidateId':candidate_id,
 'preparedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'opsDirectory':ops,
 'sourceCommits':commits,'sourceBaseCommits':{'manager':'f9703e50bd10b7b243406491d48fb8909b5d2c88','platform':'4257e217c4db5d737f0a6542dc4e4f39d7d42cff'},
 'sides':normalized,'databaseChanges':False,'apiChanges':False,'processChanges':False,'globalFreezeChanges':False,
 'publisherSha256':sha((STAGE/'publish-demand-navigation.py').read_bytes()),
 'protectedFiles':protected['protectedFiles'],'processes':protected['processes'],'coordSha256':protected['coordSha256'],
 'sourceTests':{'platform':{'typecheckPassed':True,'testsPassed':24},'manager':{'typecheckPassed':True,'testsPassed':329}},
 'publisherSafetyTestsPassed':8,'fixedCandidateApprovalRequired':True,'stageFiles':{}}
for p in sorted(STAGE.rglob('*')):
    if p.is_file():release['stageFiles'][p.relative_to(STAGE).as_posix()]=sha(p.read_bytes())
write_json(STAGE/'release-manifest.json',release)
release_sha=sha((STAGE/'release-manifest.json').read_bytes())
info={'opsDirectory':ops,'releaseManifestSha256':release_sha,'candidateId':candidate_id,'sourceCommits':commits,
      'assetCounts':{side:len(spec['assets']) for side,spec in normalized.items()},'stageDirectory':str(STAGE)}
write_json(BASE/'stage-info.json',info)
print(json.dumps(info,ensure_ascii=False,indent=2))
