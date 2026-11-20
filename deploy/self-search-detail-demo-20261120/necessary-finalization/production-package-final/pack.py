#!/usr/bin/env python3
"""Offline byte-preserving packager. No network, Git commands, build or production writes.
Required inputs are a CURRENT real controller capture and an independently authored
complete report; neither is generated or promoted by this program.
"""
import argparse
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from types import SimpleNamespace
from urllib.parse import urljoin

sys.dont_write_bytecode = True
ROOT = Path('/home/ubuntu/work/self-row-redesign')
ENGINEERING = ROOT/'detail-native-null-fields/candidate-visual-final'
CONTRACT = ROOT/'static-production'
sys.path.insert(0, str(CONTRACT))
import controller as ctl
import safety_core as h
import static_scope as s

MANIFEST_SHA = '91863042689520a9f8b0cdf5f88d0575a96416f32b43482cb88044a589547c7e'
HTML_SHA = '349cbe260fe908ceb17fe4d04517f6c3ad043ec69d1cf8fe8324935c44a5c19f'
REPORT_KEYS = ('status','detailScopeFinalized','presentationOnly','fullRebuildParity','nonTargetBytesExact','apiStoreFlagsEnvUntouched','staticImportClosureExact','importGraphSHA','dependencySHAs','sourceScope','assetSHAs')
BASELINE_HEAD = '6589eb2653eb30714845c77f7336ed0cf23e3afb'
LIST_HEAD = '027c172ed38f979f5fbe939f08d3f4eb1dde2ee6'
ROUTE_BEFORE_SHA = '2b75a875c5940ac1389d69d503d0f863d8f3ced611ca01ba7a0a85b57c641f13'

def read(p):
    return h.regular(Path(p).absolute())

def load(p):
    return h.decode(read(p))

def require(ok, message):
    h.need(ok, message)

def byteproof(before, after, identity=False):
    """Offsets operate exclusively on bytes, including non-ASCII source/HTML."""
    if before == after:
        require(identity, 'UNEXPECTED_IDENTITY_PROOF')
        return dict(beforeSHA=h.H(before), afterSHA=h.H(after), patches=[])
    start = 0
    limit = min(len(before), len(after))
    while start < limit and before[start] == after[start]:
        start += 1
    tail = 0
    while tail < limit-start and before[len(before)-1-tail] == after[len(after)-1-tail]:
        tail += 1
    end = len(before)-tail
    output_end = len(after)-tail
    p = dict(beforeSHA=h.H(before), afterSHA=h.H(after), patches=[dict(
        start=start, end=end, outputStart=start,
        beforeBase64=h.b64(before[start:end]), afterBase64=h.b64(after[start:output_end]))])
    ctl.proof(before, after, p)
    return p

def native_proof(before, after, original):
    """Convert builder UTF-16 offsets to ByteOffsets; verify forward AND inverse."""
    patches = []
    growth = 0
    for row in original['patches']:
        old, new = h.unb64(row['beforeBase64']), h.unb64(row['afterBase64'])
        x, z = row['start'], row['end']
        if before[x:z] != old:
            text16 = before.decode('utf-8').encode('utf-16-le')
            x = len(text16[:x*2].decode('utf-16-le').encode('utf-8'))
            z = len(text16[:z*2].decode('utf-16-le').encode('utf-8'))
        require(before[x:z] == old, 'BUILDER_PATCH_BYTES_MISMATCH')
        patches.append(dict(start=x, end=z, outputStart=x+growth,
                            beforeBase64=h.b64(old), afterBase64=h.b64(new)))
        growth += len(new)-len(old)
    p = dict(beforeSHA=h.H(before), afterSHA=h.H(after), patches=patches)
    ctl.proof(before, after, p)
    return p

def input_data():
    raw = read(ENGINEERING/'manifest.json')
    require(h.H(raw) == MANIFEST_SHA, 'FIXED_ENGINEERING_MANIFEST_SHA')
    m = h.decode(raw)
    require(h.H(read(ENGINEERING/'index.html')) == HTML_SHA, 'FIXED_ENGINEERING_HTML_SHA')
    pin = m['input']
    require(h.H(read(pin['sourceShaFile'])) == pin['sourceSha'], 'SOURCE_MANIFEST_PIN')
    sourcepins = load(pin['sourceShaFile'])
    require(sourcepins['baselineHead'] == BASELINE_HEAD and sourcepins['listHead'] == LIST_HEAD,
            'FIXED_HISTORICAL_OBJECT_BINDING_NOT_HEAD')
    for asset in m['assets']:
        data = read(ENGINEERING/asset['url'].lstrip('/'))
        require(h.H(data) == asset['sha256'] and len(data) == asset['size'], 'ENGINEERING_ASSET_PIN')
    return m

def cached_bytes(m, extra_indexes=()):
    """Only existing local records/bytes, never URL requests or guessed downloads."""
    records = {}
    def add(url, path, sha=None, size=None):
        data = read(path)
        require(sha is None or h.H(data) == sha, 'CACHE_SHA:'+str(path))
        require(size is None or len(data) == size, 'CACHE_SIZE:'+str(path))
        if url in records:
            require(records[url][0] == data, 'CONFLICTING_LOCAL_URL_BYTES:'+url)
        records[url] = (data, str(path))
    for row in load(ROOT/'existing-binary-dependencies/existing-binary-read.json')['dependencies']:
        add(row['url'], row['local'], row['sha256'], row['size'])
    for row in load(ROOT/'native-final-1305/cache-pins.json'):
        proof = row['proof']
        path = proof.get('local') or proof.get('record', {}).get('local')
        require(path, 'CACHE_RECORD_LOCAL_PATH_REQUIRED:'+row['key'])
        add(row['key'], path, row['sha256'], row['size'])
    for row in m['baseline']['seeds'].values():
        add(row['url'], row['local'], row['sha256'], row['size'])
    row = m['baseline']['detail']
    add(row['url'], row['local'], row['sha256'], row['size'])
    for index in extra_indexes:
        value = load(index)
        rows = value['dependencies'] if isinstance(value, dict) else value
        for row in rows:
            add(row['url'], row['local'], row['sha256'], row['size'])
    return records

def resolve(specifier, importer, imap):
    absolute = urljoin(importer, specifier)
    def table(t):
        if absolute in t:
            return t[absolute]
        if specifier in t:
            return t[specifier]
        for key in sorted(t, key=len, reverse=True):
            if key.endswith('/') and absolute.startswith(key):
                return t[key]+absolute[len(key):]
        return None
    for scope in sorted(imap.get('scopes', {}), key=len, reverse=True):
        if importer.startswith(scope):
            result = table(imap['scopes'][scope])
            if result is not None:
                return result
    result = table(imap['imports'])
    return absolute if result is None else result

def material(m, extra_indexes=(), allow_missing=False):
    cache = cached_bytes(m, extra_indexes)
    after = read(ENGINEERING/'index.html')
    imap, refs = ctl.html_refs(after)
    new_urls = {row['url'] for row in m['assets']}
    edges = set()
    for module in m['assetImports']:
        for imp in module['imports']:
            target = resolve(imp['specifier'], module['url'], imap)
            require(target.startswith('/assets/'), 'IMPORT_NOT_STATIC:'+target)
            edges.add((module['url'], target))
        # Brand image is a source-bound literal URL, not an ES import.
        data = read(ENGINEERING/module['url'].lstrip('/'))
        for row in m['assets']:
            if row['url'].endswith('.webp') and row['url'].encode() in data:
                edges.add((module['url'], row['url']))
    graph = [dict(fromUrl=a, toUrl=b) for a,b in sorted(edges)]
    needed = (set(refs) | {b for a,b in edges})-new_urls
    missing = sorted(needed-set(cache))
    require(allow_missing or not missing, 'MISSING_LOCAL_DEPENDENCY_BYTES:'+json.dumps(missing))
    deps = [dict(url=url, sha256=h.H(cache[url][0]), size=len(cache[url][0])) for url in sorted(needed-set(missing))]
    sources = []
    source_dir = Path(m['input'].get('sourceDir') or m['input']['inputSourceDir'])
    # Two baseline sources are existing historical snapshots pinned in sourceProofs.
    oldpins = {row['source']:row['beforeSha256'] for row in m['sourceProofs']}
    historical = load(ROOT/'detail-native-null-fields/source-sha-visual-final.json')
    require(historical['baselineHead'] == BASELINE_HEAD and historical['listHead'] == LIST_HEAD, 'SOURCE_HISTORY_BINDING')
    route_pins = {}
    for line in read(ROOT/'detail-implementation/before-sha256.txt').decode().splitlines():
        digest, name = line.split(None, 1)
        route_pins[name.strip()] = digest
    for name in sorted(ctl.SOURCE_SCOPE):
        new = read(source_dir/name)
        require(h.H(new) == m['input']['files'][name], 'SOURCE_AFTER_PIN:'+name)
        if name in oldpins:
            oldpath = ROOT/'native-builder/before'/name
            old = read(oldpath)
            require(h.H(old) == oldpins[name], 'SOURCE_BEFORE_FIXED_BASELINE:'+name)
            provenance = BASELINE_HEAD
        elif name.endswith('/OfficialProductDetail.tsx'):
            old = b''
            provenance = 'newPureFile:empty-before'
        else:
            # Archived before bytes from fixed LIST_HEAD, NEVER live HEAD/working tree.
            oldpath = ROOT/'detail-implementation/ProductDetail.before.txt'
            old = read(oldpath)
            require(h.H(old) == route_pins[name] == ROUTE_BEFORE_SHA, 'SOURCE_BEFORE_FIXED_LIST_OBJECT:'+name)
            provenance = LIST_HEAD
        sources.append((name, old, new, provenance))
    return cache, after, imap, refs, graph, deps, sources

def import_changes(before, after):
    changes = []
    require(set(before['imports']) <= set(after['imports']), 'IMPORTMAP_KEY_REMOVAL_NOT_IN_CONTRACT')
    for key, value in sorted(after['imports'].items()):
        old = before['imports'].get(key)
        if old != value:
            changes.append(dict(key=key, before=old, after=value))
    if before.get('scopes') != after.get('scopes'):
        changes.append(dict(scope='scopes',before=copy.deepcopy(before.get('scopes')),
                            after=copy.deepcopy(after.get('scopes'))))
    require(ctl.apply_importmap_changes(before,changes) == after, 'IMPORTMAP_NO_OTHER_CHANGES')
    return changes

def complete_dependencies(cache,graph,refs,deps,new_urls,protected):
    needed=(set(refs)|{row['toUrl'] for row in graph})-set(new_urls)
    reviewed={row['url']:dict(row) for row in deps}
    required_code={row['toUrl'] for row in graph}-set(new_urls)
    require(required_code<=set(cache),'NEW_CODE_DEPENDENCY_BYTES_REQUIRED')
    for url in sorted(needed):
        record=protected.get(str(Path(s.FRONT_PUBLIC)/url.lstrip('/')))
        require(record and record.get('kind')=='file' and type(record.get('size')) is int and record['size']>=0,
                'FRESH_CAPTURE_EXISTING_DEPENDENCY_REQUIRED:'+url)
        row=dict(url=url,sha256=h.pin(record['sha256']),size=record['size'])
        if url in reviewed:require(reviewed[url]==row,'FRESH_DEPENDENCY_HASH_SIZE_MISMATCH:'+url)
        # Old HTML-only references are already hashed by the full fresh capture.
        # They need no duplicate download; actual new-code imports stay byte-reviewed.
        reviewed[url]=row
    require(set(reviewed)==needed,'EXACT_REQUIRED_DEPENDENCY_URLS')
    return [reviewed[url] for url in sorted(reviewed)]

def report_check(report, graph, deps, assets):
    h.exact(report, REPORT_KEYS, 'INDEPENDENT_BUILD_REPORT')
    expected = dict(importGraphSHA=h.H(h.encode(graph)),
                    dependencySHAs={r['url']:r['sha256'] for r in deps},
                    assetSHAs=[r['sha256'] for r in assets])
    require(report['status'] == 'INDEPENDENT_REVIEW_PASSED', 'REAL_COMPLETE_INDEPENDENT_REPORT_REQUIRED_STATUS_NOT_PROMOTED')
    for key in REPORT_KEYS[1:8]:
        if key != 'importGraphSHA':
            require(report[key] is True, 'INDEPENDENT_FALSE:'+key)
    require(set(report['sourceScope']) == ctl.SOURCE_SCOPE, 'INDEPENDENT_EXACT_FOUR_SOURCE_SET')
    for key, value in expected.items():
        require(report[key] == value, 'INDEPENDENT_HASH_SET_MISMATCH:'+key)

def build(capture_path, report_path, output, extra_indexes=()):
    m = input_data()
    cache, after, imap, refs, graph, deps, sources = material(m, extra_indexes,allow_missing=True)
    raw_capture = read(capture_path)
    c = h.decode(raw_capture)
    require(raw_capture == h.encode(c), 'CAPTURE_CANONICAL')
    # Existing controller validation only: freshness, owner, source, coord and full hashes.
    ctl.Controller().valid_capture(c)
    before = h.unb64(c['htmlBeforeBase64'])
    oldmap, _ = ctl.html_refs(before)
    changes = import_changes(oldmap, imap)
    protected = c['state']['protectedFiles']
    deps=complete_dependencies(cache,graph,refs,deps,{row['url'] for row in m['assets']},protected)
    def bind(url, data):
        record = protected.get(str(Path(s.FRONT_PUBLIC)/url.lstrip('/')))
        require(record and record.get('sha256') == h.H(data) and record.get('size') == len(data), 'FRESH_CAPTURE_PROTECTED_BYTES:'+url)
    for row in deps:
        if row['url'] in cache:bind(row['url'], cache[row['url']][0])
    files = {}
    roles = {}
    def add(name, data, role):
        ctl.safe_relative(name)
        require(name not in files, 'DUPLICATE_PACKAGE_PATH:'+name)
        files[name], roles[name] = data, role
    add('index.html', after, 'html-after')
    assets = []
    migration = {v:k for k,v in m['exactMigrations'].items()}
    for row in m['assets']:
        url = row['url']
        data = read(ENGINEERING/url.lstrip('/'))
        require(str(Path(s.FRONT_PUBLIC)/url.lstrip('/')) not in protected, 'NEW_IMMUTABLE_ALREADY_CAPTURED:'+url)
        oldurl = migration.get(url)
        if url.endswith('.webp'):
            matches = sorted(u for u,(b,_) in cache.items() if u.endswith('.webp') and b == data)
            require(matches, 'EXISTING_BRAND_WEBP_SEED_REQUIRED')
            oldurl = matches[0]
        seed = b'' if oldurl is None else cache[oldurl][0]
        if oldurl is not None:
            bind(oldurl, seed)
        seedfile = 'seeds/'+Path(url).name+'.before'
        add(seedfile, seed, 'seed')
        add(url.lstrip('/'), data, 'new-asset')
        if url.endswith('.webp'):
            proof = byteproof(seed, data, identity=True)
        elif row['role'] in m['byteproofs']:
            proof = native_proof(seed, data, m['byteproofs'][row['role']])
        else:
            proof = byteproof(seed, data)
        assets.append(dict(url=url, sha256=h.H(data), size=len(data), beforeUrl=oldurl, beforeFile=seedfile, proof=proof))
    sourcechanges = []
    for name, old, new, provenance in sources:
        oldfile, newfile = 'sources/before/'+name, 'sources/after/'+name
        add(oldfile, old, 'source-before')
        add(newfile, new, 'source-after')
        sourcechanges.append(dict(path=name, beforeFile=oldfile, afterFile=newfile, proof=byteproof(old, new)))
    report_raw = read(report_path)
    report_check(h.decode(report_raw), graph, deps, assets)
    add('evidence/independent-report.json', report_raw, 'independent-report')
    manifest = dict(schema='static-fullmanifest-v1', ownerTask=s.OWNER, scope=s.SCOPE,
        detailScopeFinalized=True, presentationOnly=True, sourceScope=sorted(ctl.SOURCE_SCOPE),
        files=[dict(path=n, sha256=h.H(files[n]), size=len(files[n]), role=roles[n]) for n in sorted(files)],
        assets=assets, dependencies=deps, importGraph=graph,
        html=dict(beforeSHA=h.H(before), afterSHA=h.H(after), proof=byteproof(before, after)),
        importMapChanges=changes, sourceChanges=sourcechanges, independentEvidenceFile='evidence/independent-report.json')
    output = Path(output).absolute()
    # Never replace any old candidate; output is local, outside engineering and production.
    require(output.is_relative_to(Path(__file__).resolve().parent), 'LOCAL_OUTPUT_ONLY')
    require(not output.exists() and not output.is_symlink(), 'OUTPUT_MUST_BE_NEW_KEEP_OLD_CANDIDATES')
    h.no_symlink(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = Path(tempfile.mkdtemp(prefix='.packing-', dir=output.parent))
    try:
        for name, data in files.items():
            p = temp/name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
        (temp/'manifest.json').write_bytes(h.encode(manifest))
        info = ctl.candidate(SimpleNamespace(candidate=temp, front=Path(s.FRONT_PUBLIC)), c)
        # Candidate() is pure local validation; no Controller preflight/apply/network.
        require(not output.exists(), 'OUTPUT_RACE')
        os.rename(temp, output)
        return dict(status='LOCAL_PACKAGE_READY_NOT_RELEASE_APPROVAL', productionWrites=0,
                    candidate=str(output), manifestSHA=info['manifestSHA'],
                    engineeringManifestSHA=MANIFEST_SHA, htmlSHA=HTML_SHA,
                    captureSHA=h.H(raw_capture), independentReportSHA=h.H(report_raw),
                    assets=len(assets), dependencies=len(deps), files=len(files)+1)
    finally:
        if temp.exists():
            shutil.rmtree(temp)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture', required=True, help='CURRENT_REQUIRED real fresh controller capture JSON')
    parser.add_argument('--independent-report', required=True, help='REQUIRED independently authored complete final report')
    parser.add_argument('--output', default=str(Path(__file__).resolve().parent/'candidate'))
    parser.add_argument('--dependency-index', action='append', default=[], help='Optional additional EXISTING LOCAL url/local/sha256/size records; never downloaded')
    args = parser.parse_args()
    for name in (args.capture, args.independent_report):
        require(Path(name).is_file(), 'REQUIRED_REAL_INPUT_MISSING:'+name)
    sys.stdout.buffer.write(h.encode(build(args.capture, args.independent_report, args.output, args.dependency_index)))

if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('LOCAL_PACK_STOPPED '+str(exc), file=sys.stderr)
        sys.exit(1)
