#!/usr/bin/env python3
"""Read only approved static CSS via authorized SSH. No production file writes."""
import hashlib
import json
import pathlib
import re
import subprocess

BASE = pathlib.Path('/home/ubuntu/tmp/customer-live')
OUT = pathlib.Path('/home/ubuntu/work/customer-workbench-20261114')
EXPECTED = 'a895f40bfc395e7fd31c16771d68a32a92519d825c075cb40c652ec0da9be5c1'
html = (BASE / 'index.html').read_bytes()
assert hashlib.sha256(html).hexdigest() == EXPECTED
refs = [re.search(rb'href=["\']([^"\']+)["\']', tag).group(1).decode() for tag in re.findall(rb'<link\b[^>]*\brel=["\']stylesheet["\'][^>]*>', html)]
assert refs and all(re.fullmatch(r'/assets/(?:[A-Za-z0-9][A-Za-z0-9_.-]*/)*[A-Za-z0-9][A-Za-z0-9_.-]*\.css', ref) and '..' not in pathlib.PurePosixPath(ref).parts for ref in refs)
archive = pathlib.Path('/home/ubuntu/tmp/customer-native-css.tar')
with archive.open('wb') as stream:
    subprocess.run(['ssh', '-i', '/home/ubuntu/.ssh/51-server', '-o', 'BatchMode=yes', 'root@47.97.108.147', 'tar', '-C', '/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public', '-cf', '-', *[ref.lstrip('/') for ref in refs]], stdout=stream, check=True)
root = OUT / 'native-css'
root.mkdir(exist_ok=True)
subprocess.run(['tar', '-C', str(root), '-xf', str(archive)], check=True)
manifest, evidence = {}, []
for ref in refs:
    file = root / ref.lstrip('/')
    assert file.is_file() and not file.is_symlink() and file.resolve().is_relative_to(root.resolve())
    data = file.read_bytes()
    assert not data.lstrip().lower().startswith(b'<!doctype html')
    digest = hashlib.sha256(data).hexdigest()
    manifest[ref] = {'path': str(file), 'sha256': digest}
    evidence.append({'href': ref, 'path': str(file), 'sha256': digest, 'bytes': len(data), 'method': 'SSH_READ_ONLY_TAR'})
assert hashlib.sha256((BASE / 'index.html').read_bytes()).hexdigest() == EXPECTED
(OUT / 'native-css-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
(OUT / 'native-css-snapshot-evidence.json').write_text(json.dumps({'status': 'PASS', 'baselineHtmlSha256': EXPECTED, 'readMethod': 'SSH_READ_ONLY_TAR', 'productionWrites': 0, 'files': evidence}, indent=2) + '\n')
print(json.dumps({'status': 'PASS', 'stylesheets': len(refs), 'productionWrites': 0}))
