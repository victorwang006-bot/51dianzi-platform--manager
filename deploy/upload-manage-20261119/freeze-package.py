#!/usr/bin/env python3
"""Freeze local candidates against REAL fresh capture/native JSON/raw logs.
No network, production access, test execution, inferred pass results, or review.json.
All writes below this current deploy directory; no frozen package overwrite.
"""
import argparse
import base64
import importlib.util
import os
from pathlib import Path
import re
import sys

HERE = Path(__file__).absolute().parent
REPO = HERE.parent.parent
SPEC = importlib.util.spec_from_file_location('upload_manage_release', HERE/'release.py')
r = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = r
SPEC.loader.exec_module(r)
BASELINES = {
    'assets/BusinessWorkbenchPage-upload-history-50b4bb692f995bbf.js': '50b4bb692f995bbf4fdc6d25f1e76240e769f9c115949986ac9472cb12a704d3',
    'assets/BusinessWorkbenchPage-upload-history-ae2fa10c659cd37b.js': 'ae2fa10c659cd37bbdbbe2adbc617d30dc9a783a0f1a4e3a41d6a837f6e2d07c',
}
PRIMARY = {'T6/BatchUploadSession', 'B3/CustomerSupplyUploadSession', 'mk/CustomerChannelInventory'}
ALLOWED = PRIMARY | {'Z3/CustomerInventoryMore'}


def confined(p):
    p = Path(p).absolute()
    r.no_symlink(p)
    p = Path(os.path.abspath(str(p)))
    r.no_symlink(p)
    r.need(p != HERE and p.is_relative_to(HERE), 'WRITE_OUTSIDE_CURRENT_DEPLOY_REFUSED')
    return p


def read(p):
    return r.regular(Path(p).absolute())


def b64(value):
    return base64.b64decode(value, validate=True)


def utf16(data):
    return data.decode('utf-8').encode('utf-16-le')


def exact_inverse(data, delta, approved):
    r.need(r.H(data) == delta['afterSha256'] and delta['inverseVerified'] is True and
           delta['forwardVerified'] is True and delta['allBytesOutsideAuthorizedFunctionsUnchanged'] is True,
           'FULL_DELTA_PROOF_REQUIRED')
    patches = delta['patches']
    r.need(len(patches) == len(approved) == delta['changedSpanCount'] and
           {p['name'] for p in patches} == set(approved) and delta['approvedTargets'] == approved,
           'EXACT_ACTUAL_APPROVED_FUNCTION_SPAN_COUNT')
    text = utf16(data)
    old_end = new_end = shift = 0
    for p in patches:
        old, new = b64(p['oldBase64']), b64(p['newBase64'])
        r.need(old != new and r.H(old) == p['oldSha256'] and r.H(new) == p['newSha256'], 'CHANGED_HUNK_PIN')
        r.need(p['oldStart'] >= old_end and p['newStart'] >= new_end and
               p['oldEnd'] > p['oldStart'] and p['newEnd'] > p['newStart'], 'HUNK_OVERLAP')
        r.need(p['oldEnd']-p['oldStart'] == len(utf16(old))//2 and
               p['newEnd']-p['newStart'] == len(utf16(new))//2 and
               p['newStart'] == p['oldStart']+shift, 'EXACT_UTF16_OFFSET_SHIFT')
        shift += len(utf16(new))//2-len(utf16(old))//2
        old_end, new_end = p['oldEnd'], p['newEnd']
    for p in reversed(patches):
        old, new = utf16(b64(p['oldBase64'])), utf16(b64(p['newBase64']))
        start, end = p['newStart']*2, p['newEnd']*2
        r.need(text[start:end] == new, 'INVERSE_EXACT_PREIMAGE')
        text = text[:start]+old+text[end:]
    original = text.decode('utf-16-le').encode('utf-8')
    r.need(r.H(original) == delta['beforeSha256'], 'FULL_ORIGINAL_BYTES_INVERSE')
    for p in patches:
        r.need(text[p['oldStart']*2:p['oldEnd']*2] == utf16(b64(p['oldBase64'])), 'ORIGINAL_RANGE_PIN')
    protected = delta['protectedFunctions']
    r.need(set(protected) == {'z3', 'uk', 'bk', 'ok'}, 'HISTORY_INITIAL_WORKBENCH_PARSE_FULL_PROOF')
    for record in protected.values():
        start, end = record['oldStart'], record['oldEnd']
        r.need(all(p['oldEnd'] <= start or p['oldStart'] >= end for p in patches), 'PROTECTED_FUNCTION_OVERLAP')
        r.need(r.H(text[start*2:end*2].decode('utf-16-le').encode('utf-8')) == record['sha256'],
               'PROTECTED_FUNCTION_RAW_BYTES_PIN')
    forward = text
    for p in reversed(patches):
        forward = forward[:p['oldStart']*2]+utf16(b64(p['newBase64']))+forward[p['oldEnd']*2:]
    r.need(forward.decode('utf-16-le').encode('utf-8') == data, 'FULL_CANDIDATE_FORWARD_BYTES')
    return original


def css_scopes(text):
    text = re.sub(r'/\*[\s\S]*?\*/', '', text)
    roots = r'\.(?:customer-channel-inventory|customer-channel-settings|customer-supply-dialog)(?=[\s.:#\[>+~]|$)'
    def walk(value):
        cursor = 0
        while cursor < len(value):
            opening = value.find('{', cursor)
            if opening < 0:
                r.need(not value[cursor:].strip(), 'CSS_TAIL')
                return
            selector = value[cursor:opening].strip()
            level, end = 1, opening+1
            while end < len(value) and level:
                level += (value[end] == '{')-(value[end] == '}')
                end += 1
            r.need(level == 0, 'CSS_BALANCED')
            body = value[opening+1:end-1]
            if selector.startswith('@media '):
                walk(body)
            else:
                r.need(not selector.startswith('@') and '{' not in body and
                       all(re.match(roots, s.strip()) for s in selector.split(',')), 'CUSTOMER_ONLY_CSS_SCOPE')
            cursor = end
    walk(text)
    r.need('.customer-channel-inventory' in text, 'INVENTORY_CUSTOMER_CSS_REQUIRED')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build', type=Path, default=HERE/'build')
    parser.add_argument('--capture', type=Path, required=True)
    parser.add_argument('--native-evidence', type=Path, required=True)
    parser.add_argument('--tests-log', action='append', required=True, metavar='NAME=PATH')
    args = parser.parse_args()
    build = confined(args.build)
    pack, evidence = confined(build/'package'), confined(build/'package/evidence')
    r.need(pack.is_dir() and evidence.is_dir(), 'EXISTING_CANDIDATE_BUILD_REQUIRED')
    r.need(not (pack/'manifest.json').exists() and not (pack/'review.json').exists(), 'FROZEN_OR_REVIEWED_NO_OVERWRITE')
    for p in pack.rglob('*'):
        r.no_symlink(p)
        r.need(p.is_file() or p.is_dir(), 'REGULAR_PACKAGE_ONLY')
    for name in ['build-native.mjs', 'build-support.mjs', 'native-abi.mjs', 'controller-adaptation.json']:
        r.need(read(evidence/name) == read(HERE/name), 'BUILD_OR_ADAPTATION_CHANGED: '+name)
    controller_hash = r.H(read(HERE/'release.py'))
    adaptation = r.decode(read(HERE/'controller-adaptation.json'))
    r.need(adaptation['outputSha256'] == controller_hash and adaptation['allOtherControllerBytesUnchanged'] is True
           and adaptation['forwardVerified'] is True and adaptation['inverseVerified'] is True, 'CONTROLLER_EXACT_ADAPTATION')
    pins_raw = read(evidence/'source-pins.json')
    pins = r.decode(pins_raw)
    r.need(pins['schema'] == 'upload-manage-source-freeze-v1' and pins['ownerTask'] == r.OWNER
           and pins['scope'] == r.SCOPE and pins['frozen'] is True and pins['supplyNativeSafetyReviewed'] is True,
           'REAL_SOURCE_FREEZE_REQUIRED')
    approved = pins['changedTargets']
    r.need(3 <= len(approved) <= 4 and len(set(approved)) == len(approved) and
           PRIMARY <= set(approved) <= ALLOWED, 'ONLY_ACTUAL_THREE_OR_FOUR_TARGET_FUNCTIONS')
    source_delta = r.decode(read(evidence/'source-delta.json'))
    r.need(source_delta['sourcePinsSha256'] == r.H(pins_raw) and source_delta['approvedTargets'] == approved
           and source_delta['expectedChangedSpanCount'] == len(approved), 'SOURCE_FREEZE_BUILD_BINDING')
    for source in pins['sources']:
        r.relative(source['path'])
        r.need(r.H(read(REPO/source['path'])) == r.pin(source['sha256']), 'FROZEN_SOURCE_DRIFT: '+source['path'])
    assets, modules = r.decode(read(build/'assets.json')), r.decode(read(build/'modules.json'))
    replacements = r.decode(read(build/'replacements.json'))
    css_name = read(build/'css-relative.txt').decode().strip()
    r.relative(css_name)
    r.need(len(modules) == 2 and len(assets) == 3 and {m['before'] for m in modules} == set(BASELINES),
           'LATEST_EXACT_TWO_JS_ONE_CUSTOMER_CSS')
    r.need(replacements == [{'before': '/'+m['before'], 'after': '/'+m['after']} for m in modules], 'EXACT_REPLACEMENTS')
    r.need(assets[:-1] == [{'relative': m['after'], 'sha256': m['sha256'], 'size': m['size']} for m in modules]
           and assets[-1]['relative'] == css_name, 'EXACT_ASSET_SET')
    expected_assets = {a['relative'] for a in assets}
    r.need(len(expected_assets) == 3 and {p.relative_to(pack).as_posix() for p in (pack/'assets').iterdir()} == expected_assets,
           'NO_EXTRA_ASSETS')
    for a in assets:
        data = read(pack/r.relative(a['relative']))
        r.need(r.H(data) == r.pin(a['sha256']) and len(data) == a['size'], 'ASSET_PIN_SIZE')
        match = re.fullmatch(r'assets/[A-Za-z0-9_.-]+-([a-f0-9]{16,64})\.(js|css)', a['relative'])
        r.need(match and a['sha256'].startswith(match[1]), 'CONTENT_HASH_FILENAME')
    css_scopes(read(pack/css_name).decode())
    before, after = read(pack/'before-index.html'), read(pack/'after-index.html')
    expected, counts = before, {}
    for item in replacements:
        ob, nb = item['before'].encode(), item['after'].encode()
        r.need(ob != nb and nb not in before, 'NEW_URL_ABSENT')
        occurrences = list(re.finditer(re.escape(ob), before))
        r.need(occurrences, 'OLD_FULL_URL_PRESENT')
        for match in occurrences:
            pos = match.start()
            r.need(pos > 0 and before[pos-1:pos] in (b'"', b"'") and
                   before[pos+len(ob):pos+len(ob)+1] == before[pos-1:pos], 'ENTIRE_QUOTED_URL_ONLY')
        counts[item['before']] = len(occurrences)
        expected = expected.replace(ob, nb)
    r.need(expected.count(b'</head>') == 1, 'SOLE_HEAD_CLOSE')
    link = ('<link rel="stylesheet" href="/'+css_name+'">\n').encode()
    r.need(link not in before, 'INDEPENDENT_NEW_CSS_LINK')
    r.need(expected.replace(b'</head>', link+b'</head>', 1) == after, 'NO_OTHER_HTML_BYTES_CHANGED')
    native_raw = read(args.native_evidence)
    native = r.decode(native_raw)
    r.need(native['status'] == 'passed' and native['realNetworkCalls'] == 0 and native['businessWrites'] == 0
           and native['mockedWritesOnly'] is True and native['count'] == 8 and len(native['checks']) == 8,
           'EIGHT_REAL_PASSED_MOCK_ONLY_NATIVE_CHECKS_REQUIRED')
    checks = native['checks']
    r.need({c['sha256'] for c in checks} == {m['sha256'] for m in modules}, 'BOTH_CANDIDATE_NATIVE_PINS')
    for m in modules:
        group = [c for c in checks if c['module'] == m['after'] and c['sha256'] == m['sha256']]
        r.need(len(group) == 4 and len({c['case'] for c in group}) == 4 and all(c['case'] for c in group),
               'FOUR_REAL_DISTINCT_NATIVE_CASES_PER_MODULE')
    capture_raw = read(args.capture)
    capture = r.decode(capture_raw)
    cfg = r.Config()
    r.need(capture['schema'] == 'upload-manage-capture-v1' and capture['ownerTask'] == r.OWNER and capture['scope'] == r.SCOPE
           and capture['controllerSha256'] == controller_hash and capture['publicRoot'] == str(cfg.public)
           and capture['frontRoot'] == str(cfg.front) and capture['ttlSeconds'] == 900 and capture['productionWrites'] == 0,
           'REAL_FRESH_CAPTURE_FINAL_CONTROLLER_REQUIRED')
    r.Controller(cfg).fresh(capture)  # Pure timestamp validation, no RPC/snapshot/capture.
    r.validate_processes(capture['processes'])
    r.need(capture['beforeHtmlSha256'] == r.H(before) and capture['adminHtmlRecord'] == capture['protectedFiles'].get(str(cfg.html)),
           'CAPTURE_FULL_HTML_BINDING')
    coord = b64(capture['coordBase64'])
    r.need(r.H(coord) == capture['coordSha256'], 'CAPTURE_COORD_PIN')
    r.coord_closed(coord)
    for m in modules:
        delta = r.decode(read(evidence/(Path(m['before']).name+'.delta.json')))
        original = exact_inverse(read(pack/m['after']), delta, approved)
        record = capture['protectedFiles'].get(str(cfg.public/m['before']))
        r.need(delta['input'] == m['before'] and delta['output'] == m['after'] and r.H(original) == BASELINES[m['before']]
               and record and record.get('kind') == 'file' and record['sha256'] == r.H(original), 'INVERSE_REAL_CAPTURE_LATEST_ASSET')
        r.need(str(cfg.public/m['after']) not in capture['protectedFiles'], 'NEW_ASSET_NOT_ALREADY_ONLINE')
    logs, names = [], {'native-tests.json', 'evidence-provenance.json', 'native-test-source.mjs'}
    for arg in args.tests_log:
        r.need('=' in arg, 'LOG_NAME_EQUALS_PATH_REQUIRED')
        name, source = arg.split('=', 1)
        r.need(re.fullmatch(r'[A-Za-z0-9_.-]+\.log', name) and name not in names, 'SAFE_UNIQUE_RAW_LOG')
        names.add(name)
        data = read(source)
        r.need(data.strip(), 'EMPTY_REAL_LOG_REFUSED')
        logs.append((name, Path(source).absolute(), data))
    pending = {'capture.json': capture_raw, 'evidence/native-tests.json': native_raw,
               'evidence/native-test-source.mjs': read(HERE/'test-native.mjs')}
    for name, _, data in logs:
        pending['evidence/'+name] = data
    pending['evidence/evidence-provenance.json'] = r.encode({'capture': {'source': str(args.capture.absolute()), 'sha256': r.H(capture_raw)},
        'nativeEvidence': {'source': str(args.native_evidence.absolute()), 'sha256': r.H(native_raw)},
        'testLogs': [{'relative': 'evidence/'+n, 'source': str(s), 'sha256': r.H(d)} for n, s, d in logs],
        'testResultsAreSuppliedNotInvented': True, 'noIndependentReviewGenerated': True,
        'actualFunctionSpansPerModule': len(approved), 'approvedTargets': approved})
    for name in pending:
        r.need(not (pack/name).exists(), 'EVIDENCE_EXISTS_NO_OVERWRITE: '+name)
    r.need(not (build/'manifest-sha256.txt').exists(), 'MANIFEST_PIN_EXISTS_NO_OVERWRITE')
    os.chmod(build, 0o700)
    os.chmod(pack, 0o700)
    for name, data in pending.items():
        r.exclusive(confined(pack/name), data)
    manifest = {'ownerTask': r.OWNER, 'scope': r.SCOPE, 'captureSha256': r.H(capture_raw), 'controllerSha256': controller_hash,
        'beforeHtmlSha256': r.H(before), 'afterHtmlSha256': r.H(after), 'assets': assets, 'replacements': replacements,
        'cssRelative': css_name, 'packageFiles': {p.relative_to(pack).as_posix(): r.H(read(p)) for p in sorted(pack.rglob('*')) if p.is_file()}}
    raw = r.encode(manifest)
    r.exclusive(confined(pack/'manifest.json'), raw)
    r.exclusive(confined(build/'manifest-sha256.txt'), (r.H(raw)+'\n').encode())
    print(r.encode({'status': 'FROZEN_LOCAL_PACKAGE_NOT_DEPLOYED', 'package': str(pack), 'manifestSha256': r.H(raw),
        'controllerSha256': controller_hash, 'captureSha256': r.H(capture_raw), 'referenceCounts': counts,
        'actualFunctionSpansPerModule': len(approved), 'reviewStillRequired': True}).decode(), end='')


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt) as exc:
        print('FREEZE_ABORT: '+str(exc), file=sys.stderr)
        sys.exit(1)
