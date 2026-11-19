#!/usr/bin/env python3
"""Freeze an existing local build using REAL capture/native evidence/test logs.
No network, production access, test execution, invented pass results or review.json.
All writes are confined to this new deploy directory. Fresh capture expires in 900s.
"""
import argparse
import base64
import importlib.util
import os
from pathlib import Path
import re
import sys

HERE = Path(__file__).absolute().parent
SPEC = importlib.util.spec_from_file_location('upload_history_release', HERE/'release.py')
r = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = r
SPEC.loader.exec_module(r)


def confined(p):
    p = Path(p).absolute()
    r.no_symlink(p)
    r.need(p != HERE and p.is_relative_to(HERE), 'WRITE_OUTSIDE_NEW_DEPLOY_DIRECTORY_REFUSED')
    return p


def read(p):
    return r.regular(Path(p).absolute())


def exact_inverse(data, delta):
    r.need(r.H(data) == delta['afterSha256'] and delta['inverseVerified'] is True,
           'CANDIDATE_DELTA_PIN_MISMATCH')
    patches = delta['patches']
    r.need(len(patches) == 3 and {p['name'] for p in patches} == {
        'z3/HistorySession', 'CustomerWorkbenchSupply/button-label',
        'CustomerParseUpload/hint-label'}, 'ONLY_APPROVED_THREE_RANGES')
    # JS offsets are UTF16 code units, not Python Unicode indices or UTF8 bytes.
    text = data.decode('utf-8').encode('utf-16-le')
    last = 0
    for p in patches:
        r.need(p['newStart'] >= last and p['newEnd'] >= p['newStart'], 'DELTA_OVERLAP')
        last = p['newEnd']
        old = base64.b64decode(p['oldBase64'], validate=True)
        new = base64.b64decode(p['newBase64'], validate=True)
        r.need(r.H(old) == p['oldSha256'] and r.H(new) == p['newSha256'], 'HUNK_PIN')
    for p in reversed(patches):
        old = base64.b64decode(p['oldBase64'], validate=True).decode('utf-8').encode('utf-16-le')
        new = base64.b64decode(p['newBase64'], validate=True).decode('utf-8').encode('utf-16-le')
        start, end = p['newStart'] * 2, p['newEnd'] * 2
        r.need(text[start:end] == new, 'INVERSE_EXACT_PREIMAGE')
        text = text[:start] + old + text[end:]
    before = text.decode('utf-16-le').encode('utf-8')
    r.need(r.H(before) == delta['beforeSha256'], 'ENTIRE_ORIGINAL_BYTE_INVERSE')
    for p in patches:
        old = base64.b64decode(p['oldBase64'], validate=True).decode('utf-8').encode('utf-16-le')
        r.need(text[p['oldStart']*2:p['oldEnd']*2] == old, 'ORIGINAL_RANGE_PIN')
    return before


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build', type=Path, default=HERE/'build')
    parser.add_argument('--capture', type=Path, required=True,
                        help='Actual fresh release.py --capture JSON, never coord-readonly.json')
    parser.add_argument('--native-evidence', type=Path, required=True,
                        help='Existing real native-tests.json with checks pinned to BOTH candidates')
    parser.add_argument('--tests-log', action='append', required=True, metavar='NAME=PATH',
                        help='Existing test/typecheck log; repeat for each, no pass counts inferred')
    args = parser.parse_args()
    build = confined(args.build)
    pack = confined(build/'package')
    evidence = confined(pack/'evidence')
    r.need(pack.is_dir() and evidence.is_dir(), 'EXISTING_BUILD_REQUIRED')
    r.need(not (pack/'manifest.json').exists() and not (pack/'review.json').exists(),
           'FROZEN_OR_REVIEWED_PACKAGE_NO_OVERWRITE')
    for p in sorted(pack.rglob('*')):
        r.no_symlink(p)
        r.need(p.is_file() or p.is_dir(), 'REGULAR_PACKAGE_ENTRIES_ONLY')
    r.need(read(evidence/'build-native.mjs') == read(HERE/'build-native.mjs'),
           'BUILD_SCRIPT_CHANGED_SINCE_BUILD')
    adaptation = r.decode(read(HERE/'controller-adaptation.json'))
    controller_hash = r.H(read(HERE/'release.py'))
    r.need(adaptation['outputSha256'] == controller_hash, 'CONTROLLER_ADAPTATION_PIN')
    assets = r.decode(read(build/'assets.json'))
    modules = r.decode(read(build/'modules.json'))
    replacements = r.decode(read(build/'replacements.json'))
    css_name = read(build/'css-relative.txt').decode().strip()
    r.relative(css_name)
    r.need(len(modules) == 2 and len(assets) == 3, 'TWO_JS_ONE_HISTORY_CSS_REQUIRED')
    r.need(replacements == [{'before': '/'+m['before'], 'after': '/'+m['after']}
                             for m in modules], 'EXACT_REPLACEMENTS')
    r.need(assets == [{'relative':m['after'], 'sha256':m['sha256'], 'size':m['size']}
                     for m in modules] + [assets[-1]] and assets[-1]['relative'] == css_name,
           'EXACT_ASSET_SET')
    expected_assets = {a['relative'] for a in assets}
    r.need(len(expected_assets) == 3 and
           {p.relative_to(pack).as_posix() for p in (pack/'assets').iterdir()} == expected_assets,
           'NO_EXTRA_ASSETS')
    for a in assets:
        r.relative(a['relative']); r.pin(a['sha256'])
        data = read(pack/a['relative'])
        r.need(r.H(data) == a['sha256'] and len(data) == a['size'], 'ASSET_PIN_SIZE')
        match = re.fullmatch(r'assets/[A-Za-z0-9_.-]+-([a-f0-9]{16,64})\.(js|css)', a['relative'])
        r.need(match and a['sha256'].startswith(match[1]), 'NEW_HASH_FILENAME')
    css = read(pack/css_name).decode()
    r.need('.customer-upload-history' in css and '.customer-parse-upload' not in css,
           'HISTORY_ONLY_CSS_REQUIRED')
    before, after = read(pack/'before-index.html'), read(pack/'after-index.html')
    expected = before
    counts = {}
    for item in replacements:
        ob, nb = item['before'].encode(), item['after'].encode()
        r.need(ob != nb and nb not in before, 'NEW_URL_ABSENT')
        occurrences = list(re.finditer(re.escape(ob), before))
        r.need(occurrences, 'ORIGINAL_COMPLETE_URL_PRESENT')
        for match in occurrences:
            pos = match.start()
            r.need(pos > 0 and before[pos-1:pos] in (b'"', b"'") and
                   before[pos+len(ob):pos+len(ob)+1] == before[pos-1:pos],
                   'ENTIRE_QUOTED_URL_REQUIRED')
        counts[item['before']] = len(occurrences)
        expected = expected.replace(ob, nb)
    r.need(expected.count(b'</head>') == 1, 'SOLE_HEAD_CLOSE')
    link = ('<link rel="stylesheet" href="/'+css_name+'">\n').encode()
    expected = expected.replace(b'</head>', link+b'</head>', 1)
    r.need(expected == after, 'NO_OTHER_HTML_CHANGES')
    native_bytes = read(args.native_evidence)
    native = r.decode(native_bytes)
    r.need(native['status'] == 'passed' and native['realNetworkCalls'] == 0 and
           native.get('businessWrites', native.get('realDatabaseWrites')) == 0,
           'EXISTING_REAL_PASSED_NATIVE_ZERO_WRITE_EVIDENCE_REQUIRED')
    checks = native['checks']
    js_hashes = {m['sha256'] for m in modules}
    r.need(isinstance(checks, list) and checks and
           {c['sha256'] for c in checks} == js_hashes,
           'REAL_NATIVE_EVIDENCE_MUST_PIN_BOTH_CANDIDATES')
    for m in modules:
        r.need(any(c.get('module') == m['after'] and c['sha256'] == m['sha256'] for c in checks),
               'REAL_NATIVE_MODULE_REFERENCE_REQUIRED')
    captured_bytes = read(args.capture)
    capture = r.decode(captured_bytes)
    cfg = r.Config()
    r.need(capture['schema'] == 'upload-history-capture-v1' and
           capture['ownerTask'] == r.OWNER and capture['scope'] == r.SCOPE and
           capture['controllerSha256'] == controller_hash and
           capture['publicRoot'] == str(cfg.public) and capture['frontRoot'] == str(cfg.front) and
           capture['ttlSeconds'] == 900 and capture['productionWrites'] == 0,
           'REAL_CAPTURE_FINAL_CONTROLLER_AND_TASK_REQUIRED')
    # This calls only pure local timestamp validation, NOT snapshot(), capture() or RPC.
    r.Controller(cfg).fresh(capture)
    r.validate_processes(capture['processes'])
    r.need(capture['beforeHtmlSha256'] == r.H(before) and
           capture['adminHtmlRecord'] == capture['protectedFiles'].get(str(cfg.html)),
           'CAPTURE_FULL_HTML_BINDING')
    coord = base64.b64decode(capture['coordBase64'], validate=True)
    r.need(r.H(coord) == capture['coordSha256'], 'CAPTURE_COORD_PIN')
    r.coord_closed(coord)
    for m in modules:
        delta_name = Path(m['before']).name + '.delta.json'
        delta = r.decode(read(evidence/delta_name))
        original = exact_inverse(read(pack/m['after']), delta)
        record = capture['protectedFiles'].get(str(cfg.public/m['before']))
        r.need(delta['input'] == m['before'] and delta['output'] == m['after'] and
               record and record.get('kind') == 'file' and record['sha256'] == r.H(original),
               'INVERSE_ORIGINAL_MUST_MATCH_REAL_CAPTURE_ASSET')
        r.need(str(cfg.public/m['after']) not in capture['protectedFiles'], 'NEW_ASSET_MUST_NOT_EXIST')
    names = {'native-tests.json', 'evidence-provenance.json'}
    logs = []
    for arg in args.tests_log:
        r.need('=' in arg, 'LOG_EXPECTS_NAME_EQUALS_PATH')
        name, source = arg.split('=', 1)
        r.need(re.fullmatch(r'[A-Za-z0-9_.-]+\.log', name) and name not in names,
               'SAFE_UNIQUE_LOG_NAME_REQUIRED')
        names.add(name)
        data = read(source)
        r.need(data.strip(), 'EMPTY_REAL_TEST_LOG_REFUSED')
        logs.append((name, Path(source).absolute(), data))
    pending = {'capture.json': captured_bytes, 'evidence/native-tests.json': native_bytes}
    for name, source, data in logs:
        pending['evidence/'+name] = data
    provenance = {'nativeEvidence': {'source': str(args.native_evidence.absolute()),
                                    'sha256': r.H(native_bytes)},
                  'capture': {'source': str(args.capture.absolute()), 'sha256': r.H(captured_bytes)},
                  'testLogs': [{'relative': 'evidence/'+n, 'source': str(s), 'sha256': r.H(d)}
                               for n, s, d in logs],
                  'testResultsAreSuppliedNotInvented': True,
                  'noIndependentReviewGenerated': True}
    pending['evidence/evidence-provenance.json'] = r.encode(provenance)
    for name in pending:
        r.need(not (pack/name).exists(), 'EVIDENCE_ALREADY_EXISTS_NO_OVERWRITE: '+name)
    # All evidence verified before any freeze write. Never touch existing files.
    os.chmod(build, 0o700); os.chmod(pack, 0o700)
    for name, data in pending.items():
        r.exclusive(confined(pack/name), data)
    manifest = {'ownerTask': r.OWNER, 'scope': r.SCOPE,
                'captureSha256': r.H(captured_bytes), 'controllerSha256': controller_hash,
                'beforeHtmlSha256': r.H(before), 'afterHtmlSha256': r.H(after),
                'assets': assets, 'replacements': replacements, 'cssRelative': css_name,
                'packageFiles': {p.relative_to(pack).as_posix(): r.H(read(p))
                                 for p in sorted(pack.rglob('*')) if p.is_file()}}
    raw = r.encode(manifest)
    r.exclusive(confined(pack/'manifest.json'), raw)
    r.exclusive(confined(build/'manifest-sha256.txt'), (r.H(raw)+'\n').encode())
    print(r.encode({'status': 'FROZEN_LOCAL_PACKAGE_NOT_DEPLOYED', 'package': str(pack),
                    'manifestSha256': r.H(raw), 'controllerSha256': controller_hash,
                    'captureSha256': r.H(captured_bytes), 'capturedAtUtc': capture['capturedAtUtc'],
                    'referenceCounts': counts, 'reviewStillRequired': True}).decode(), end='')


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt) as exc:
        print('FREEZE_ABORT: '+(str(exc) if isinstance(exc, r.ReleaseError) else type(exc).__name__),
              file=sys.stderr)
        sys.exit(1)
