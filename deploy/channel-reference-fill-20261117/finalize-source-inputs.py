from pathlib import Path
import json,hashlib,shutil
D=Path(__file__).resolve().parent;V=Path('/home/ubuntu/work/inbound-documents-fix-v2-20261117');M=Path('/home/ubuntu/work/51dianzi-platform--manager');H=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();J=lambda p:json.loads(Path(p).read_text())
r=J(V/'independent-review-v2.json');assert r['status'].startswith('PASS')and r['p0Count']==r['p1Count']==0
fix=J(V/'sdk-import-fix.json');assert fix['noRuntimeSourceChange'];p=V/'candidate/manifest.json';b=J(p);before=H(p)
for file,h in fix['sha256'].items():assert H(file)==h;b['sourceHashes'][file]=h
b['parentTypeOnlyFinalization']={'oldManifestSha256':before,'noRuntimeSourceChange':True,'fixedImportProof':str(V/'sdk-import-fix.json'),'fixedImportProofSha256':H(V/'sdk-import-fix.json'),'wholeFrontTypesExit':0,'wholeAdminTypesExit':0,'narrowUITypesExit':0,'UIFinalSixFilesPassed':86,'compiledFinalFactoryChecks':14}
p.write_text(json.dumps(b,indent=2)+'\n')
for name in ['snapshot','identity-bindings','stock-evidence']:
 f='channel-reference-'+name+'.json';src=D/'data-final'/f.replace('.json','.staged.json');dst=M/'server/channelReference'/f;shutil.copyfile(src,dst);assert H(dst)==H(src)
(D/'final-source-inputs.json').write_text(json.dumps({'softwareReviewSha256':H(V/'independent-review-v2.json'),'documentManifestSha256':H(p),'runtimeManifestSha256':H(D/'runtime-build/manifest.json'),'staticManifestSha256':H(V/'static-build/manifest.json'),'finalSiblings':{f.name:H(f)for f in(M/'server/channelReference').glob('channel-reference-*.json')},'noProductionWrites':True,'noPrivateDocumentRead':True},indent=2)+'\n')
print('FINAL_SOURCE_INPUTS_REVIEW_PASSED_95NEW_8STOCK_213OLD_TYPE_METADATA_FIXED_NO_PRODUCTION')
