#!/usr/bin/env python3
"""Merge exact independent hotfixes against both frozen live Workbench chunks."""
from pathlib import Path
import argparse, base64, copy, hashlib, json, re, subprocess

H = lambda b: hashlib.sha256(b).hexdigest()

def save(p, value):
    p.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def normalized(manifest, baseline):
    text = baseline.decode(); patches = []
    for p in manifest['patches']:
        old = p.get('before', p.get('old'))
        new = p.get('after', p.get('replacement'))
        if 'oldBase64' in p:
            old = base64.b64decode(p['oldBase64']).decode()
            new = base64.b64decode(p['newBase64']).decode()
        if 'oldByteStart' in p:
            start, end = p['oldByteStart'], p['oldByteEnd']
        else:
            def offset(n):
                return len(text.encode('utf-16-le')[:n * 2].decode('utf-16-le').encode())
            start, end = offset(p['start']), offset(p['end'])
        assert baseline[start:end] == old.encode(), 'exact preimage'
        patches.append(dict(oldByteStart=start, oldByteEnd=end,
            oldBase64=base64.b64encode(old.encode()).decode(),
            newBase64=base64.b64encode(new.encode()).decode(), reason=p.get('reason', 'customer session')))
    return dict(beforeSha256=H(baseline), patches=patches)

def main():
    a = argparse.ArgumentParser(); a.add_argument('--root', required=True); a.add_argument('--inbound', required=True)
    a.add_argument('--customers', required=True)
    args = a.parse_args(); root = Path(args.root).resolve(); R = root / 'release'
    assert not (R / 'unified-static.json').exists(), 'ONE_BUILD_ONLY'
    inbound = json.loads(Path(args.inbound).read_text())
    if isinstance(inbound, dict): inbound = inbound.get('modules', [inbound])
    customers = json.loads(Path(args.customers).read_text())
    units = []; origins = {}
    for c in customers:
        original = Path(c['input']).read_bytes(); sha = H(original)
        assert sha == c['beforeSha256']
        matches = [m for m in inbound if (m.get('sourceSha256') or m.get('beforeSha256')) == sha]
        assert len(matches) == 1, 'exact inbound candidate for both live baselines required'
        originalPath = R / ('baseline-' + sha[:16] + '.js'); originalPath.write_bytes(original)
        p1 = R / 'evidence' / ('customer-patches-' + sha[:16] + '.json')
        p2 = R / 'evidence' / ('inbound-patches-' + sha[:16] + '.json')
        save(p1, normalized(json.loads(Path(c['output'] + '.manifest.json').read_text()), original))
        save(p2, normalized(matches[0], original))
        merged = R / ('merged-' + sha[:16] + '.js')
        units.append(dict(base=str(originalPath), expectedSha256=sha, output=str(merged), patchManifests=[str(p1), str(p2)]))
        origins[str(merged)] = '/assets/BusinessWorkbenchPage-company-stock-sales-' + sha[:16] + '.js'
    selection = R / 'merge-selection.json'; save(selection, {'units': units})
    subprocess.run(['python3', str(root / 'merge-local-byte-deltas.py'), str(selection)], check=True, stdout=subprocess.PIPE)
    assets = []; rewrites = {}; deltas = []
    for unit in units:
        p = Path(unit['output']); b = p.read_bytes(); sha = H(b)
        dest = R / 'assets' / ('BusinessWorkbenchPage-unified-bugfix-' + sha[:16] + '.js')
        assert not dest.exists(); p.rename(dest)
        delta = json.loads(Path(str(p) + '.delta.json').read_text())
        delta['output'] = str(dest); delta['url'] = '/assets/' + dest.name
        delta['oldUrl'] = origins[str(p)]; deltaPath = R / 'evidence' / (dest.name + '.delta.json'); save(deltaPath, delta)
        deltas.append(str(deltaPath)); assets.append(dict(url=delta['url'], source=str(dest.relative_to(R)), sha256=sha))
        rewrites[delta['oldUrl']] = delta['url']
    mall = json.loads((R / 'evidence' / 'registration-plan.json').read_text())['static']
    rewrites[mall['oldLeafUrl']] = mall['newLeafUrl']
    leaf = R / 'assets' / Path(mall['file']).name
    assert H(leaf.read_bytes()) == mall['sha256']
    assets.append(dict(url=mall['newLeafUrl'], source=str(leaf.relative_to(R)), sha256=mall['sha256']))
    original = (R / 'admin-baseline.html').read_bytes()
    assert H(original) == 'da8b089944c7c72a48dac45293878bc1a4a440111350e183080e98c9f77ad555'
    text = original.decode(); matches = list(re.finditer(r'<script[^>]*type="importmap"[^>]*>([\s\S]*?)</script>', text))
    assert len(matches) == 1
    span = matches[0]; old = json.loads(span[1]); new = copy.deepcopy(old)
    count = 0
    for table in [new['imports'], *new['scopes'].values()]:
        for key, value in list(table.items()):
            if value in rewrites: table[key] = rewrites[value]; count += 1
    for previous, nextUrl in rewrites.items():
        if previous in new['scopes']:
            assert nextUrl not in new['scopes']; new['scopes'][nextUrl] = copy.deepcopy(new['scopes'][previous])
    assert count > 0
    assert set(new['imports']) == set(old['imports'])
    for key, val in old['imports'].items(): assert new['imports'][key] == rewrites.get(val, val)
    for scope, table in old['scopes'].items():
        assert set(new['scopes'][scope]) == set(table)
        for key, val in table.items(): assert new['scopes'][scope][key] == rewrites.get(val, val)
    raw = json.dumps(new, ensure_ascii=False, separators=(',', ':'))
    result = (text[:span.start(1)] + raw + text[span.end(1):]).encode()
    assert result[:len(text[:span.start(1)].encode())] == text[:span.start(1)].encode()
    assert result.endswith(text[span.end(1):].encode())
    html = R / 'index.html'; html.write_bytes(result)
    save(R / 'evidence' / 'html-map-proof.json', dict(beforeSha256=H(original), afterSha256=H(result),
        rewrites=rewrites, originalImportCount=len(old['imports']), originalScopeCount=len(old['scopes']),
        finalScopeCount=len(new['scopes']), existingKeysAndUnrelatedValuesPreserved=True,
        htmlOutsideImportmapBytesPreserved=True, copiedOriginalScopes=True))
    save(R / 'unified-static.json', dict(status='LOCAL_UNIFIED_PENDING_FINAL_CHECK', assets=assets,
        htmlSha256=H(result), rewrites=rewrites, deltas=deltas))
    print(json.dumps({'assets': assets, 'htmlSha256': H(result), 'rewrittenMappingValues': count}, ensure_ascii=False))

if __name__ == '__main__': main()
