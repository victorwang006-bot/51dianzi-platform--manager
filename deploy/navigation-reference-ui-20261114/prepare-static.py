#!/usr/bin/env python3
"""Offline phase1 packager: read-only Git, no compilation, network, or production IO."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile

TOOLS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('static_release', TOOLS/'static-release.py')
D = importlib.util.module_from_spec(spec)
spec.loader.exec_module(D)
REPO = TOOLS.parent.parent
WORK = Path('/home/ubuntu/work/navigation-channel-reference-20261114')
BUILDER_TOOLS = ('core.cjs', 'frontend-inspect.cjs', 'frontend-factory.cjs', 'frontend-build.cjs', 'merge.cjs', 'frontend-proof.cjs', 'frontend-tests/native.cjs', 'frontend-tests/bindings.cjs')
EVIDENCE = ('frontend-proof.json', 'native-tests.json', 'frontend-parts.json', 'host-factory-metafile.json', 'source-dependency-pins.json', 'html-build-proof.json', 'html-patches.json', 'css-selector-proof.json', 'dependency-resolution-proof.json', 'static-dependencies.json', 'workbench-0-build-proof.json', 'workbench-1-build-proof.json', 'layout-build-proof.json')
CONFIG = ('package.json', 'pnpm-lock.yaml', 'tsconfig.json')
INTENTIONAL = {'client/src/business/platform/client/src/pages/'+n for n in ('ChannelInventoryHost.tsx', 'ChannelInventoryHost.css', 'channelInventoryColumns.ts', 'ChannelReferenceCell.tsx', 'channelReferenceModel.ts')} | {'client/src/components/admin/AdminWorkspaceNavigation.tsx'}


def git(*args):
    result = subprocess.run(['git', '--no-pager', *args], cwd=REPO, env=dict(os.environ, GIT_OPTIONAL_LOCKS='0', GIT_NO_REPLACE_OBJECTS='1'), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
    D.require(result.returncode == 0, 'READ_ONLY_GIT_CHECK_FAILED '+args[0])
    return result.stdout


def source_map(value, label):
    D.require(isinstance(value, dict) and value, label+' EMPTY_SOURCE_MAP')
    for name, h in value.items():
        D.require(D.safe(name).parts[0] in ('client', 'server', 'shared') and isinstance(h, str) and D.HEX.fullmatch(h), label+' INVALID_PIN')
    return value


class Inputs:
    """Freeze bytes once; no invisible source/evidence change during packaging."""
    def __init__(self):
        self.reads = {}
        self.payload = {}

    def read(self, path):
        path = Path(path)
        data = D.regular(path.parent, path.name).read_bytes()
        D.require(self.reads.setdefault(path, D.digest(data)) == D.digest(data), 'INPUT_CHANGED_WHILE_READING')
        return data

    def obj(self, path, destination=None):
        data = self.read(path)
        if destination:
            self.add(destination, data)
        return json.loads(data, object_pairs_hook=D.unique)

    def add(self, name, data):
        D.safe(name)
        D.require(name not in self.payload, 'DUPLICATE_PACKAGE_PATH')
        self.payload[name] = data

    def unchanged(self):
        D.require(all(D.sha(p) == h for p, h in self.reads.items()), 'INPUT_CHANGED_DURING_PREPARE')


def report_binding(obj, label, pins, pin_sha, html_sha, commit):
    D.require(obj.get('status') == 'PASS', label+' NOT_PASS')
    # A real current report can bind the compiler pins or the exact source map.
    source_bound = obj.get('sourcePinsSha256') == pin_sha
    hashes = obj.get('sourceHashes', {})
    if hashes:
        source_map(hashes, label)
        D.require(all(pins.get(k) == v for k, v in hashes.items()), label+' SOURCE_HASH_DRIFT')
        source_bound = source_bound or set(hashes) == set(pins)
    D.require(source_bound, label+' NEED_CURRENT_SOURCE_BINDING')
    if 'sourceCommit' in obj:
        D.require(obj['sourceCommit'] == commit, label+' COMMIT_DRIFT')
    if label == 'review':
        D.require(obj.get('htmlSha256') == html_sha, 'REVIEW_CURRENT_CANDIDATE_REQUIRED')
    elif label == 'typecheck':
        D.require(obj.get('sourceSnapshotStable') is True, 'TYPECHECK_SOURCE_STABILITY')
    else:
        passed = obj.get('passed', obj.get('numPassedTests'))
        failed = obj.get('failed', obj.get('numFailedTests'))
        D.require(type(passed) is int and passed > 0 and type(failed) is int and failed == 0, 'AFFECTED_REAL_COUNTS_REQUIRED')
        if 'numTotalTests' in obj:
            D.require(obj['numTotalTests'] == passed, 'AFFECTED_TOTAL_MISMATCH')


def slice16(data, a, b):
    encoded = data.decode().encode('utf-16-le')
    D.require(type(a) is int and type(b) is int and 0 <= a <= b and b*2 <= len(encoded), 'INVALID_JS_INTERVAL')
    return encoded[a*2:b*2].decode('utf-16-le').encode()


def inverse(proof, before, after):
    D.require(all(proof.get(k) is True for k in ('exactInverse', 'allNonpatchBytesUnchanged', 'allOldSpecifiersPreserved', 'importsByteIdentical', 'exportsByteIdentical')), 'INVERSE_FLAGS')
    D.require(proof['encoding'] == 'UTF-8 hashes; JS character offsets' and D.digest(before) == proof['beforeSha256'] and D.digest(after) == proof['sha256'], 'INVERSE_FILE_BINDING')
    intervals = []
    for p in proof['unchangedPartitions']:
        b, a = slice16(before, p['beforeStart'], p['beforeEnd']), slice16(after, p['afterStart'], p['afterEnd'])
        D.require(b == a and D.digest(a) == p['sha256'], 'NONPATCH_BYTES_CHANGED')
        intervals.append((p['beforeStart'], p['beforeEnd'], p['afterStart'], p['afterEnd']))
    for p in proof['patches']:
        D.require(D.digest(slice16(before, p['start'], p['end'])) == p['beforeSha256'] and D.digest(slice16(after, p['afterStart'], p['afterEnd'])) == p['afterSha256'], 'PATCH_HASH_CHANGED')
        intervals.append((p['start'], p['end'], p['afterStart'], p['afterEnd']))
    b = a = 0
    for b0, b1, a0, a1 in sorted(intervals, key=lambda x: (x[0], x[2])):
        D.require((b0, a0) == (b, a), 'INVERSE_GAP_OR_OVERLAP')
        b, a = b1, a1
    D.require(b*2 == len(before.decode().encode('utf-16-le')) and a*2 == len(after.decode().encode('utf-16-le')), 'INVERSE_INCOMPLETE')
    reconstructed = after.decode().encode('utf-16-le')
    for p in sorted(proof['patches'], key=lambda x: x['afterStart'], reverse=True):
        reconstructed = reconstructed[:p['afterStart']*2]+slice16(before, p['start'], p['end']).decode().encode('utf-16-le')+reconstructed[p['afterEnd']*2:]
    D.require(reconstructed.decode('utf-16-le').encode() == before, 'ACTUAL_INVERSE_FAILED')
    D.require(all(s.encode() in before and s.encode() in after for s in proof['oldSpecifiers']), 'OLD_SPECIFIER_LOST')


def html_check(before, after, patches, reloc, css):
    positioned = [p for p in patches if 'start' in p and 'end' in p]
    additive = [p for p in patches if 'start' not in p and 'end' not in p]
    D.require(len(positioned) == len(additive) == 1, 'HTML_EXACT_MAP_AND_CSS_PATCH')
    p, add = positioned[0], additive[0]
    text = before.decode().encode('utf-16-le')
    D.require(slice16(before, p['start'], p['end']).decode() == p['before'], 'HTML_PATCH_BEFORE')
    text = (text[:p['start']*2]+p['after'].encode('utf-16-le')+text[p['end']*2:]).decode('utf-16-le')
    allowed_link = r'<link rel="stylesheet" href="'+re.escape(css)+r'"(?: data-navigation-(?:channel-reference|reference-ui)="20261114")?>\n</head>'
    D.require(add['before'] == '</head>' and text.count('</head>') == 1 and re.fullmatch(allowed_link, add['after']), 'HTML_ONLY_ONE_CSS')
    D.require(text.replace('</head>', add['after'], 1).encode() == after, 'HTML_RECONSTRUCTION')
    pattern = r'<script\b[^>]*type="importmap"[^>]*>([\s\S]*?)</script>'
    old = re.findall(pattern, before.decode())
    new = re.findall(pattern, after.decode())
    D.require(len(old) == len(new) == 1 and p['before'] == old[0] and p['after'] == new[0], 'ONLY_IMPORTMAP_BODY_PATCH')
    om, nm = json.loads(old[0]), json.loads(new[0])
    D.require(set(om) == set(nm) == {'imports', 'scopes'} and set(nm['scopes']) == set(om['scopes']) | set(reloc.values()), 'IMPORT_SCOPE_KEYS')
    imports = {k: reloc.get(v, v) for k, v in om['imports'].items()}
    imports.update(reloc)  # Actual builder adds exactly these three direct old->new aliases.
    D.require(nm['imports'] == imports, 'ONLY_APPROVED_DIRECT_ALIASES')
    for table, current in [(v, nm['scopes'][k]) for k, v in om['scopes'].items()]:
        D.require({k: reloc.get(v, v) for k, v in table.items()} == current, 'OLD_IMPORT_CHANGED')
    for oldurl, newurl in reloc.items():
        D.require(nm['scopes'][newurl] == {k: reloc.get(v, v) for k, v in om['scopes'][oldurl].items()}, 'NEW_SCOPE_NOT_CLONE')


def prepare(args):
    i = Inputs()
    candidate, baseline_dir = args.candidate, args.baseline_dir
    b = i.obj(args.baseline, 'baseline.json')
    D.validate_baseline(b, fresh=True)
    prior = i.obj(args.previous_receipt, 'evidence/previous-source-receipt.json')
    prior_pins = source_map(prior['sourceHashes'], 'prior')
    D.require(len(prior_pins) == prior['sourceFiles'] == 100 and prior['htmlSha256'] == D.BEFORE_SHA and prior['adminApiSha256'] == D.API_SHA['admin'] and prior['frontApiSha256'] == D.API_SHA['front'], 'PRIOR100_CURRENT_RUNTIME_REQUIRED')
    pin_data = i.read(args.source_pins)
    i.add('source-pins.json', pin_data)
    pins = json.loads(pin_data, object_pairs_hook=D.unique)
    current = source_map(pins['sourceHashes'], 'frontend')
    intentional = source_map(pins['freeze']['pins'], 'intentional frontend')
    D.require(set(intentional) <= INTENTIONAL and all(current.get(k) == v for k, v in intentional.items()), 'INTENTIONAL_ONLY_APPROVED_FRONTEND')
    front = i.obj(candidate/'frontend-proof.json')
    qa = i.obj(candidate/'native-tests.json')
    files = i.obj(candidate/'files.json', 'evidence/files.json')
    D.validate_proofs(front, qa, files)
    D.require(front['actualCandidateQA']['reportSha256'] == D.sha(candidate/'native-tests.json') and front['sourceHashes'] == current, 'QA_AND_PIN_HASH_BINDING')
    evidence = {n: i.obj(candidate/n, 'evidence/'+n) for n in EVIDENCE}
    parts, meta = evidence['frontend-parts.json'], evidence['host-factory-metafile.json']
    D.require(parts['status'] == 'PASS' and parts['files'] == files and parts['sourceHashes'] == current and parts['baselineAssets'] == b['baselineAssets'], 'PARTS_CURRENT_BINDING')
    deps = evidence['source-dependency-pins.json']
    D.require(deps == front['sourceDependencyPins'] == parts['dependencySourceHashes'], 'DEPENDENCY_PIN_BINDING')
    D.require(meta['inputs'] and meta['outputs'], 'COMPILER_GRAPH_REQUIRED')
    graph = set()
    for name, row in meta['inputs'].items():
        if name.startswith(('client/', 'shared/', 'server/')):
            D.require(name in current and '/server/' not in name and not name.startswith('server/') and name != 'shared/channelReference.ts', 'STATIC_FRONTEND_GRAPH_ONLY')
            data = i.read(D.regular(REPO, name))
            D.require(row['bytes'] == len(data) and D.digest(data) == current[name], 'COMPILER_SOURCE_BYTES')
            graph.add(name)
        elif name.startswith('node_modules/.pnpm/'):
            D.require(name in deps, 'UNPINNED_COMPILER_DEPENDENCY')
            # pnpm virtual-store filenames may contain @ and +; no traversal/symlink.
            D.require(re.fullmatch(r'[A-Za-z0-9._/@+=-]+', name) and all(p not in ('', '.', '..') for p in name.split('/')), 'DEPENDENCY_PATH')
            path = REPO/name
            D.require(path.resolve().is_relative_to(REPO.resolve()) and not any(p.is_symlink() for p in (path, *path.parents)), 'DEPENDENCY_SYMLINK')
            data = i.read(path)
            D.require(D.digest(data) == deps[name] and len(data) == row['bytes'], 'COMPILER_DEPENDENCY_BYTES')
        else:
            D.require(name.startswith('customer-native:') or name == 'customer-workbench-scoped-entry.mjs', 'UNKNOWN_VIRTUAL_INPUT')
    D.require(graph <= set(current), 'GRAPH_NOT_PINNED')
    for label, path in [('review', args.review), ('typecheck', args.typecheck), ('affected', args.affected)]:
        report = i.obj(path, 'evidence/'+label+'.json')
        report_binding(report, label, current, D.digest(pin_data), front['htmlSha256'], args.source_commit)
    commit = args.source_commit
    D.require(re.fullmatch(r'[0-9a-f]{40}', commit) and git('rev-parse', '--verify', 'HEAD').decode().strip() == commit and git('rev-parse', '--verify', 'refs/heads/main').decode().strip() == commit, 'CURRENT_LOCAL_MAIN_COMMIT_REQUIRED')
    hashes, blobs = {}, {}
    for name in sorted(set(prior_pins) | set(current) | set(CONFIG)):
        D.safe(name)
        tree = git('ls-tree', commit, '--', name).decode().split()
        D.require(len(tree) >= 4 and tree[0] in ('100644', '100755') and tree[1] == 'blob', 'REGULAR_GIT_BLOB_REQUIRED')
        data = git('show', commit+':'+name)
        h = D.digest(data)
        if name in current or name in CONFIG:
            D.require(i.read(D.regular(REPO, name)) == data, 'CURRENT_FRONTEND_NOT_COMMITTED '+name)
        if name in current:
            D.require(h == current[name], 'COMPILER_PIN_VS_COMMIT '+name)
        if name in prior_pins and h != prior_pins[name]:
            D.require(name in intentional and h == intentional[name], 'UNAPPROVED_PRIOR_SOURCE_DRIFT '+name)
        hashes[name], blobs[name] = h, tree[2]
        i.add('source-snapshot/'+name, data)
    # Prior-only files come from commit blobs, not experimental uncommitted backend work.
    # No fallback snapshot can bypass the new commit blob/hash equality above.
    baseline_assets = D.rows_map(b['baselineAssets'], 'relative')
    for name, h in baseline_assets.items():
        D.require(D.digest(i.read(D.regular(baseline_dir, name))) == h, 'CAPTURED_OLD_ASSET_CHANGED')
    i.add('index-before.html', i.read(baseline_dir/'index.html'))
    D.require(D.digest(i.payload['index-before.html']) == D.BEFORE_SHA, 'BEFORE_HTML_BINDING')
    file_map = {r['relative']: r['sha256'] for r in files}
    D.require(len(files) == len(file_map) == 5 and 'index.html' in file_map, 'FIVE_FILE_ALLOWLIST')
    for name, h in file_map.items():
        D.require(name == 'index.html' or (len(D.safe(name).parts) == 2 and name.startswith('assets/') and h in name and name not in baseline_assets), 'ADDITIVE_HASHED_ASSET')
        data = i.read(D.regular(candidate, name))
        D.require(D.digest(data) == h, 'CANDIDATE_FILE_SHA')
        i.add('candidate/'+name, data)
    reloc = parts['relocations']
    D.require(len(reloc) == 3 and set(reloc.values()) == {'/'+n for n in file_map if n.endswith('.js')}, 'THREE_JS_RELOCATIONS')
    for name in ('workbench-0-build-proof.json', 'workbench-1-build-proof.json', 'layout-build-proof.json'):
        p = evidence[name]
        D.require(reloc.get(p['beforeUrl']) == p['url'] and baseline_assets.get(p['beforeUrl'].lstrip('/')) == p['beforeSha256'], 'INVERSE_RELOCATION')
        if name.startswith('workbench'):
            D.require(p['oldLivePropertiesByteUnchanged'] is True and p['readonlyScopeBridgeAdded'] is False and p['originalGlobalDelegateByteUnchanged'] is True, 'NO_NEW_NATIVE_BFF_BRIDGE')
        inverse(p, i.read(D.regular(baseline_dir, p['beforeUrl'].lstrip('/'))), i.payload['candidate/'+p['url'].lstrip('/')])
    css = evidence['css-selector-proof.json']
    D.require(all(css[k] is True for k in ('oldPrefixByteIdentical', 'onlyReferenceSelectors', 'allOldStylesheetAssetsByteRetained')) and current[css['sourcePath']] == css['sourceSha256'] and file_map[parts['cssUrl'].lstrip('/')] == css['newCssSha256'], 'SCOPED_CSS_BINDING')
    html_check(i.payload['index-before.html'], i.payload['candidate/index.html'], evidence['html-patches.json'], reloc, parts['cssUrl'])
    dependencies = evidence['static-dependencies.json']
    D.require(isinstance(dependencies, list) and dependencies and len(dependencies) == len(set(dependencies)) and len(dependencies) <= 512 and set(dependencies) <= {'/'+n for n in baseline_assets} | {'/'+n for n in file_map if n != 'index.html'}, 'STATIC_DEPENDENCY_SCOPE')
    for name in ('static-release.py', 'prepare-static.py'):
        i.add(name, i.read(TOOLS/name))
    for name in BUILDER_TOOLS:
        i.add('tools/'+name, i.read(D.regular(TOOLS, name)))
    receipt = {'status': 'PREPARED_GIT_SOURCE_MATCH', 'sourceCommit': commit, 'gitCommit': commit, 'branch': 'main', 'sourceHashes': hashes, 'sourceBlobIds': blobs, 'sourceFiles': len(hashes), 'previousSourceFiles': 100, 'intentionalFrontendOverrides': sorted(k for k in intentional if k in prior_pins and hashes[k] != prior_pins[k]), 'frontendCompilerGraph': sorted(graph), 'files': files, 'htmlSha256': front['htmlSha256'], 'adminApiSha256': D.API_SHA['admin'], 'frontApiSha256': D.API_SHA['front']}
    i.add('git-source-receipt.json', D.encoded(receipt))
    manifest = {'schema': 1, 'phase': 'phase1-static-navigation-reference-ui', 'ownerTask': D.TASK, 'opsRoot': str(D.ROOT), 'publicRoot': str(D.PUBLIC), 'sourceCommit': commit, 'sourceBranch': 'main', 'beforeHtmlSha256': D.BEFORE_SHA, 'htmlSha256': front['htmlSha256'], 'files': files, 'sourceHashes': hashes, 'sourceBlobIds': blobs, 'dependencies': dependencies, 'packageHashes': {n: D.digest(data) for n, data in sorted(i.payload.items())}}
    i.add('manifest.json', D.encoded(manifest))
    i.unchanged()
    D.require(not args.output.exists() and not args.output.resolve().is_relative_to(REPO) and not str(args.output.resolve()).startswith('/opt/'), 'NEW_OFFLINE_OUTPUT_OUTSIDE_REPO_REQUIRED')
    args.output.mkdir(parents=True)
    for name, data in i.payload.items():
        p = args.output/D.safe(name)
        p.parent.mkdir(parents=True, exist_ok=True)
        D.atomic(p, data, 0o600)
    mh = D.sha(args.output/'manifest.json')
    D.package(args.output, mh)
    archive = args.output.with_suffix('.tar.gz')
    D.require(not archive.exists(), 'ARCHIVE_ALREADY_EXISTS')
    with tarfile.open(archive, 'w:gz') as t:
        for name in sorted(i.payload):
            t.add(args.output/name, arcname=name, recursive=False)
    i.unchanged()
    D.atomic(Path(str(archive)+'.sha256'), (D.sha(archive)+'  '+archive.name+'\n').encode(), 0o600)
    D.atomic(args.output/'manifest.sha256', (mh+'  manifest.json\n').encode(), 0o600)
    return {'status': 'PREPARED', 'packageDirectory': str(args.output), 'archive': str(archive), 'archiveSha256': D.sha(archive), 'manifestSha256': mh, 'sourceCommit': commit, 'sourceFiles': len(hashes), 'files': 5, 'productionReads': 0, 'productionWrites': 0, 'processReloads': 0}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--candidate', type=Path, default=WORK/'frontend-candidate')
    p.add_argument('--source-pins', type=Path, default=WORK/'frontend-candidate/source-pins.json')
    p.add_argument('--baseline', type=Path, required=True, help='fresh --capture output, not the old 05:24 report')
    p.add_argument('--baseline-dir', type=Path, default=WORK/'baseline')
    p.add_argument('--previous-receipt', type=Path, default=WORK/'baseline/previous-source-receipt.json')
    p.add_argument('--source-commit', required=True)
    p.add_argument('--review', type=Path, required=True)
    p.add_argument('--typecheck', type=Path, required=True)
    p.add_argument('--affected', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    print(json.dumps(prepare(args), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'status': 'failed', 'reason': str(error)}, ensure_ascii=False))
        raise SystemExit(1)
