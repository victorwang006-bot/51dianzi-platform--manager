#!/usr/bin/env python3
"""Local-only exact adaptation; all outputs remain beside this script."""
from pathlib import Path
import base64
import hashlib
import json

HERE = Path(__file__).absolute().parent
SOURCE = HERE.parent/'upload-history-20261119'
H = lambda b: hashlib.sha256(b).hexdigest()
substitutions = [
    (b"SCOPE = 'upload-history-20261119-6hBIbUvP'", b"SCOPE = 'upload-manage-20261119-6hBIbUvP'", 1),
    (b"Path('/opt/ops/upload-history-20261119-6hBIbUvP')", b"Path('/opt/ops/upload-manage-20261119-6hBIbUvP')", 1),
    (b'upload-history-capture-v1', b'upload-manage-capture-v1', 2),
]
original = (SOURCE/'release.py').read_bytes()
output = original
for old, new, count in substitutions:
    assert original.count(old) == count and new not in original
    output = output.replace(old, new)
reverse = output
for old, new, count in reversed(substitutions):
    assert reverse.count(new) == count
    reverse = reverse.replace(new, old)
assert reverse == original
assert b"OWNER = '6hBIbUvPpWI2Wkj3jxYdIQ'" in output
records = []
shift = 0
occurrences = []
for old, new, count in substitutions:
    start = 0
    for _ in range(count):
        pos = original.index(old, start)
        occurrences.append((pos, old, new))
        start = pos + len(old)
for pos, old, new in sorted(occurrences):
    records.append(dict(oldStart=pos, oldEnd=pos+len(old), newStart=pos+shift,
                        newEnd=pos+shift+len(new), oldBase64=base64.b64encode(old).decode(),
                        newBase64=base64.b64encode(new).decode(), oldSha256=H(old), newSha256=H(new)))
    shift += len(new)-len(old)
test = (SOURCE/'test_release.py').read_bytes()
for name, data in [('release.py', output), ('test_release.py', test)]:
    target = HERE/name
    assert not target.exists(), 'existing controller/test refused'
    target.write_bytes(data)
proof = dict(source=str(SOURCE/'release.py'), sourceSha256=H(original), outputSha256=H(output),
             exactSubstitutions={old.decode(): new.decode() for old, new, _ in substitutions},
             substitutionCounts={old.decode(): count for old, _, count in substitutions},
             offsetUnits='raw bytes', patches=records, inverseVerified=True,
             forwardVerified=True, allOtherControllerBytesUnchanged=True,
             ownerUnchanged='6hBIbUvPpWI2Wkj3jxYdIQ',
             testSource=str(SOURCE/'test_release.py'), testSourceSha256=H(test),
             testOutputSha256=H(test), allTestBytesUnchanged=True)
(HERE/'controller-adaptation.json').write_text(json.dumps(proof, indent=2)+'\n')
print(json.dumps(dict(status='CONTROLLER_LOCAL_READY', controllerSha256=H(output),
                      testSha256=H(test), rawByteChangeSpans=len(records))))
