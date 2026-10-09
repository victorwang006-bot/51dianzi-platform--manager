#!/usr/bin/env python3
"""Merge a complete fresh admin public build over the verified analytics-copy history without changing old resources."""
import argparse, hashlib, json, re, shutil, sys
from pathlib import Path

OLD_INDEX_SHA = "86babb216f3c43b69ca7a149a9d44a63e7096318ab5d498dca6d443b6b2a34a9"
ENTRY_RE = re.compile(r'<script type="module" crossorigin src="(/assets/(?:index|main)-[A-Za-z0-9_-]+\.js(?:\?badge=[a-f0-9]+)?)"></script>')
CSS_RE = re.compile(r'<link rel="stylesheet" crossorigin href="(/assets/(?:index|main)-[A-Za-z0-9_-]+\.css)">')
MAP_RE = re.compile(r'^[ \t]*<script type="importmap">([^<]+)</script>\n?', re.M)
STYLE_RE = re.compile(r'<style\b[^>]*>.*?</style>', re.S)

def sha_bytes(data): return hashlib.sha256(data).hexdigest()
def digest(path): return sha_bytes(path.read_bytes())

def file_map(root, rel=Path('.'), out=None):
    out = {} if out is None else out
    for item in sorted((root / rel).iterdir(), key=lambda x: x.name):
        name = item.relative_to(root).as_posix()
        if item.is_symlink(): raise AssertionError(f'symlink forbidden in public tree: {name}')
        if item.is_dir(): file_map(root, item.relative_to(root), out)
        elif item.is_file(): out[name] = item
        else: raise AssertionError(f'nonregular public entry: {name}')
    return out

def tree_digest(root, rel=Path('.'), state=None):
    state = hashlib.sha256() if state is None else state
    for item in sorted((root / rel).iterdir(), key=lambda x: x.name):
        name = item.relative_to(root).as_posix()
        if item.is_symlink(): raise AssertionError(f'symlink forbidden in tree: {name}')
        if item.is_dir():
            state.update(f'D\0{name}\n'.encode())
            tree_digest(root, item.relative_to(root), state)
        elif item.is_file():
            data = item.read_bytes()
            state.update(f'F\0{name}\0{len(data)}\0{sha_bytes(data)}\n'.encode())
        else: raise AssertionError(f'nonregular tree entry: {name}')
    return state.hexdigest()

def unique(regex, text, label):
    found = regex.findall(text)
    if len(found) != 1: raise AssertionError(f'{label} must occur exactly once, got {len(found)}')
    return found[0]

def main_name(ref):
    if '?' in ref: ref = ref.split('?', 1)[0]
    return ref.removeprefix('/')

def remove_once(text, token, label):
    if text.count(token) != 1: raise AssertionError(f'{label} occurrence drift')
    return text.replace(token, '', 1)

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--old', required=True); p.add_argument('--build', required=True); p.add_argument('--output', required=True)
    p.add_argument('--old-tree-sha', required=True)
    a = p.parse_args()
    old, build, out = map(lambda x: Path(x).resolve(), (a.old, a.build, a.output))
    if not re.fullmatch(r'[a-f0-9]{64}', a.old_tree_sha): raise SystemExit('old-tree-sha must be sha256')
    if out.exists() or len({old, build, out}) != 3: raise SystemExit('output must be a distinct, nonexistent directory')
    if digest(old / 'index.html') != OLD_INDEX_SHA or tree_digest(old) != a.old_tree_sha:
        raise SystemExit('verified admin analytics-copy static baseline drifted')

    old_files, build_files = file_map(old), file_map(build)
    old_html, build_html = (old / 'index.html').read_text(), (build / 'index.html').read_text()
    old_entry_ref, build_entry_ref = unique(ENTRY_RE, old_html, 'old module entry'), unique(ENTRY_RE, build_html, 'fresh module entry')
    old_css_ref, build_css_ref = unique(CSS_RE, old_html, 'old stylesheet'), unique(CSS_RE, build_html, 'fresh stylesheet')
    old_entry = unique(re.compile(r'<script type="module" crossorigin src="/assets/(?:index|main)-[A-Za-z0-9_-]+\.js(?:\?badge=[a-f0-9]+)?"></script>'), old_html, 'old module tag')
    build_entry = unique(re.compile(r'<script type="module" crossorigin src="/assets/(?:index|main)-[A-Za-z0-9_-]+\.js"></script>'), build_html, 'fresh module tag')
    old_css = unique(re.compile(r'<link rel="stylesheet" crossorigin href="/assets/(?:index|main)-[A-Za-z0-9_-]+\.css">'), old_html, 'old stylesheet tag')
    build_css = unique(re.compile(r'<link rel="stylesheet" crossorigin href="/assets/(?:index|main)-[A-Za-z0-9_-]+\.css">'), build_html, 'fresh stylesheet tag')
    old_maps = list(MAP_RE.finditer(old_html))
    if len(old_maps) != 1: raise SystemExit(f'old analytics import map must occur exactly once, got {len(old_maps)}')
    old_map_tag, old_map_json = old_maps[0].group(0), old_maps[0].group(1)
    if MAP_RE.search(build_html): raise SystemExit('fresh HTML must not replace the verified analytics import map')
    old_imports = json.loads(old_map_json).get('imports')
    if not isinstance(old_imports, dict) or len(old_imports) != 2: raise SystemExit('analytics import-map alias count drifted')
    old_styles, build_styles = STYLE_RE.findall(old_html), STYLE_RE.findall(build_html)
    if build_styles: raise SystemExit('fresh HTML added inline styles; reconcile explicitly instead of silently dropping them')
    if build_entry_ref == old_entry_ref or build_css_ref == old_css_ref: raise SystemExit('fresh admin entry/CSS did not change')
    new_main, new_css = main_name(build_entry_ref), main_name(build_css_ref)
    if new_main not in build_files or new_css not in build_files: raise SystemExit('fresh entry/CSS missing from build')
    # This literal survives the supported bundled login layout and proves the fresh entry still carries the full-height login source.
    if b'min-h-screen' not in (build / new_main).read_bytes(): raise SystemExit('fresh main lacks login full-height source marker')

    old_normal = remove_once(old_html, old_map_tag, 'old import map')
    for style in old_styles: old_normal = remove_once(old_normal, style, 'old inline style')
    old_normal = old_normal.replace(old_entry, build_entry, 1).replace(old_css, build_css, 1)
    if old_normal != build_html: raise SystemExit('fresh admin HTML differs beyond approved entry/CSS and preserved importmap/style blocks')

    for name, path in old_files.items():
        if name == 'index.html' or name not in build_files: continue
        if digest(path) != digest(build_files[name]): raise SystemExit(f'fresh build collides with old resource at {name}')
    out.mkdir()
    for name, path in old_files.items():
        if name == 'index.html': continue
        target = out / name; target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(path, target)
    for name, path in build_files.items():
        if name == 'index.html' or name in old_files: continue
        target = out / name; target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(path, target)
    merged_html = old_html.replace(old_entry, build_entry, 1).replace(old_css, build_css, 1)
    (out / 'index.html').write_text(merged_html)
    for item in sorted(out.rglob('*')):
        if item.is_symlink() or not (item.is_file() or item.is_dir()): raise SystemExit(f'bad merged entry: {item}')
        item.chmod(0o644 if item.is_file() else 0o755)
    out.chmod(0o755)
    if digest(out / 'index.html') != sha_bytes(merged_html.encode()): raise SystemExit('merged index write mismatch')
    if (out / new_main).read_bytes() != (build / new_main).read_bytes() or (out / new_css).read_bytes() != (build / new_css).read_bytes():
        raise SystemExit('fresh active entry/CSS mismatch after merge')
    print(json.dumps({
        'oldTree': a.old_tree_sha, 'newTree': tree_digest(out),
        'oldIndexSha': OLD_INDEX_SHA, 'indexSha': digest(out / 'index.html'),
        'newMain': new_main, 'newMainSha': digest(out / new_main),
        'newCss': new_css, 'newCssSha': digest(out / new_css),
        'oldImportMapAliases': len(old_imports), 'preservedInlineStyleTags': len(old_styles),
        'loginFullheightMarker': 'min-h-screen', 'oldFiles': len(old_files), 'buildFiles': len(build_files), 'combinedFiles': len(file_map(out)),
    }, sort_keys=True))
if __name__ == '__main__': main()
