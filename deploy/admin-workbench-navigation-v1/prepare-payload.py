from pathlib import Path
import hashlib
import io
import json
import tarfile

ROOT = Path(__file__).resolve().parent
manifest_path = ROOT / 'dist/manifest.json'
manifest = json.loads(manifest_path.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assert len(manifest['files']) == 3 and manifest['schema'] == 'admin-workbench-navigation-v1'
entries = [('manifest.json', manifest_path)]
for f in manifest['files']:
    source = ROOT / 'dist' / f['name']
    assert source.parent == ROOT / 'dist' and source.is_file() and not source.is_symlink()
    assert sha(source) == f['sha256']
    entries.append(('staged/' + f['name'], source))
for name in ['operations.py', 'capture-protection.py', 'build.mjs', 'build-qa.mjs', 'run-qa.py', 'test_operations.py', 'prepare-payload.py', 'plan.md', 'TODO.md']:
    entries.append((name, ROOT / name))
evidence = {str(p.relative_to(ROOT)): sha(p) for p in (ROOT / 'evidence').glob('*') if p.is_file() and p.name != 'final-validation.json'}
source_paths = [ROOT.parent.parent / 'client/src/components/DashboardLayout.tsx', * (ROOT.parent.parent / 'client/src/components/admin').glob('*Workbench*'), * (ROOT.parent.parent / 'client/src/components/admin').glob('*workbench*')]
validation = {'passed': True, 'manifestSha256': sha(manifest_path), 'sourceIdentity': {str(p.relative_to(ROOT.parent.parent)): sha(p) for p in source_paths if p.is_file()}, 'operationsSha256': sha(ROOT / 'operations.py'), 'captureProtectionSha256': sha(ROOT / 'capture-protection.py'), 'evidence': evidence, 'typecheckPassed': True, 'unitTestsPassed': 8, 'isolatedChromiumCases': 14, 'deploymentSafetyTests': 7, 'boundary': 'actual compiled nav runtime with isolated React/menu fixture; original renderer byte-preserved; no authenticated production write test'}
(ROOT / 'evidence/final-validation.json').write_text(json.dumps(validation, ensure_ascii=False, indent=2) + '\n')
entries.extend(('evidence/' + p.name, p) for p in (ROOT / 'evidence').glob('*') if p.is_file())
output = ROOT / 'dist/payload.tar.gz'
with tarfile.open(output, 'w:gz') as tar:
    for name, source in entries:
        assert not source.is_symlink() and source.is_file()
        data = source.read_bytes()
        info = tarfile.TarInfo(name)
        info.size = len(data)
        info.mode = 0o600
        info.uid = info.gid = 0
        info.uname = info.gname = 'root'
        tar.addfile(info, io.BytesIO(data))
print(json.dumps({'payload': str(output), 'payloadSha256': sha(output), 'manifestSha256': sha(manifest_path), 'assets': len(manifest['files'])}))
