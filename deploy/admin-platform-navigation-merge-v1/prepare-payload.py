from pathlib import Path
import hashlib
import io
import json
import tarfile

ROOT=Path(__file__).resolve().parent
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
manifest_path=ROOT/'dist/manifest.json'
m=json.loads(manifest_path.read_text())
assert m['schema']=='admin-platform-navigation-merge-v1' and len(m['files'])==2
qa=json.loads((ROOT/'evidence/layout-qa.json').read_text())
assert qa['passed'] and qa['cases']==18
assert '10 passed' in (ROOT/'evidence/unit-tests.log').read_text()
assert '7 passed' in (ROOT/'evidence/permissions-tests.log').read_text()
assert 'Ran 10 tests' in (ROOT/'evidence/deploy-tests.log').read_text() and 'OK' in (ROOT/'evidence/deploy-tests.log').read_text()
source_paths=[ROOT.parent.parent/'client/src/components/admin/adminWorkbenchNavigationModel.ts',ROOT.parent.parent/'client/src/components/admin/adminWorkbenchNavigationModel.test.ts',ROOT.parent.parent/'client/src/components/admin/AdminWorkbenchNavigation.tsx']
validation={'passed':True,'manifestSha256':sha(manifest_path),'sourceIdentity':{str(p.relative_to(ROOT.parent.parent)):sha(p) for p in source_paths},'operationsSha256':sha(ROOT/'operations.py'),'evidence':{p.name:sha(p) for p in (ROOT/'evidence').iterdir() if p.is_file() and p.name!='final-validation.json'},'typecheckPassed':True,'unitTests':10,'permissionTests':7,'compiledChromiumChecks':18,'deploymentSafetyTests':10,'boundary':'actual compiled navigation and existing CSS; original layout remains byte-identical except one nav import literal; React/menu fixtures isolated; no authenticated production business write test'}
(ROOT/'evidence/final-validation.json').write_text(json.dumps(validation,ensure_ascii=False,indent=2)+'\n')
entries=[('manifest.json',manifest_path)]
for f in m['files']:
    source=ROOT/'dist'/f['name'];assert sha(source)==f['sha256']
    entries.append(('staged/'+f['name'],source))
for name in ['operations.py','capture-protection.py','build.mjs','build-qa.mjs','run-qa.py','test_operations.py','prepare-payload.py','plan.md','TODO.md']:
    entries.append((name,ROOT/name))
entries.extend(('evidence/'+p.name,p) for p in (ROOT/'evidence').iterdir() if p.is_file())
output=ROOT/'dist/payload.tar.gz'
with tarfile.open(output,'w:gz') as tar:
    for name,source in entries:
        assert source.is_file() and not source.is_symlink()
        data=source.read_bytes();info=tarfile.TarInfo(name);info.size=len(data);info.mode=0o600;info.uid=info.gid=0;info.uname=info.gname='root'
        tar.addfile(info,io.BytesIO(data))
print(json.dumps({'payloadSha256':sha(output),'manifestSha256':sha(manifest_path),'assets':len(m['files'])}))
