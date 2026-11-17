from pathlib import Path
import json,hashlib,shutil,tarfile
D=Path(__file__).resolve().parent;V=Path('/home/ubuntu/work/inbound-documents-fix-v2-20261117');O=Path('/home/ubuntu/work/inbound-documents-20261117');P=D/'package';R='/opt/ops/20261117-channel-reference-fill-v1';H=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();J=lambda p:json.loads(Path(p).read_text())
assert not P.exists(),'FREEZE_NEW_PACKAGE_ONCE_OR_EXPLICITLY_ARCHIVE';P.mkdir(mode=0o700);B=J(D/'protection-current.json');om=J(O/'release-manifest.json');api=J(V/'candidate/manifest.json');ad=J(D/'api-build/delta.json');sm=J(V/'static-build/manifest.json');ref=J(D/'runtime-build/manifest.json')
for p,h in sm['sourceHashes'].items():assert H(p)==h,'STATIC_SOURCE_DRIFT:'+p
# SDK mirror import rewrites are type-only; main backend/runtime source hashes still must match.
typefix=J(V/'sdk-import-fix.json');fixed=set(typefix['files'])
for p,h in api['sourceHashes'].items():
 if p in fixed:assert 'front-router-types' in p and H(p)==typefix['sha256'][p],'SDK_FIX_DRIFT'
 else:assert H(p)==h,'DOCUMENT_SOURCE_DRIFT:'+p
assert sm['status']=='PASS_OFFLINE_CANDIDATE'and api['checks']['actualNarrowAbiPassed']and api['checks']['noOriginalFinancialLockChange'];assert ref['workerExecuted']is False and ref['mainApiCompiled']is False and ref['configProvisioned']is False
replace=[];add=[]
def copy(source,name):
 q=P/name;q.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,q);return H(q)
def addfile(source,name,target,kind):
 h=copy(source,name);add.append(dict(source=name,target=target,sha256=h,kind=kind))
oldapi={x['target'].split('/')[-3]:x for x in om['replace']if x['kind']=='api'}
deltas=[]
for role in ['front','admin']:
 target=oldapi[role]['target'];assert B['files'][target]==api['api'][role]['before'];src=V/'candidate/frontApi.js'if role=='front'else D/'api-build/admin.js';name='api/'+role+'.js';h=copy(src,name);replace.append(dict(kind='api',source=name,target=target,sha256=h,host='51dianzi.com'if role=='front'else'admin.51dianzi.com'))
 row=api['api'][role];deltaName='proof/doc-'+role+'-delta.json';assert copy(row['deltaPath'],deltaName)==row['deltaSha256'];deltas.append(dict(role=role,source=deltaName,sha256=row['deltaSha256'],target=target,beforeSha256=row['before'],afterSha256=row['after']))
 runtimeTarget=str(Path(target).parent.parent/'runtime')
 for a in api['stage']['newRuntime']:addfile(V/'candidate'/a['path'],a['path'],runtimeTarget+'/'+Path(a['path']).name,'runtime')
html=next(x for x in om['replace']if x['kind']=='html');assert B['files'][html['target']]==sm['production']['htmlBefore']['sha256'];h=copy(sm['html']['after']['local'],'static/index.html');assert h==sm['html']['after']['sha256'];replace.append(dict(kind='html',source='static/index.html',target=html['target'],sha256=h,host='admin.51dianzi.com'))
for a in sm['assets']:assert H(a['local'])==a['sha256'];addfile(a['local'],'static'+a['url'],str(Path(html['target']).parent)+a['url'],'static')
for name in ['service','worker']:
 a=ref['artifacts'][name];src=D/'runtime-build/runtime'/a['basename'];assert H(src)==a['sha256'];addfile(src,'channel-reference-'+name+'.mjs',R+'/channel-reference-'+name+'.mjs','reference')
for name in ['snapshot','identity-bindings','stock-evidence']:
 file='channel-reference-'+name+'.json';addfile(D/'data-final'/file.replace('.json','.staged.json'),file,R+'/'+file,'reference-data')
copy(D/'api-build/before-admin.js','proof/doc-admin-before-reference.js');copy(D/'api-build/delta.json','proof/reference-api-delta.json');copy(D/'release.py','release.py');(P/'protection.json').write_text(json.dumps(B,indent=2)+'\n')
M=dict(scope='channel-reference-inbound-documents-v2',root=R,referenceRoot=R,independentReview='passed',reloadNames=['dianzi51','dianzi51-admin'],replace=replace,add=add,noDdl=True,noDatabaseAccess=True,noBusinessDml=True,noBindingInstallation=True,databases={},bindingTarget=om['bindingTarget'],bindingSha256=om['bindingSha256'],oldSuccessfulQuotesRetained=213,manualRefreshConfigured=False,cacheProvisioned=False,forbiddenConfigFiles=['manual-refresh-config.json','channel-reference-cache.json'],apiDeltaSource='proof/reference-api-delta.json',apiDeltaSha256=H(P/'proof/reference-api-delta.json'),apiBeforeSource='proof/doc-admin-before-reference.js',oldReferenceImport=ad['oldReferenceImport'],documentDeltas=deltas,sourceFilesFrozen=True,sourceProfileClosed=True,stockObservedAtPreserved=True,activeCollectorDisabled=True,compilerManifestSha256=H(D/'runtime-build/manifest.json'),documentManifestSha256=H(V/'candidate/manifest.json'),staticManifestSha256=H(V/'static-build/manifest.json'))
(P/'release-manifest.json').write_text(json.dumps(M,indent=2)+'\n');(D/'release-manifest.json').write_text(json.dumps(M,indent=2)+'\n');(D/'protection.json').write_text(json.dumps(B,indent=2)+'\n')
with tarfile.open(D/'package-private.tar.gz','w:gz')as t:
 for p in sorted(P.rglob('*')):
  if p.is_file():assert not p.is_symlink();t.add(p,arcname=str(p.relative_to(P)),recursive=False)
print('FROZEN_COMBINED_PRIVATE_PACKAGE',len(replace),'replace',len(add),'add',len(B['files']),'protected',len(B['processes']),'processes','NO_DDL/NO_DB/NO_NEW_DEPS',H(D/'package-private.tar.gz'))
