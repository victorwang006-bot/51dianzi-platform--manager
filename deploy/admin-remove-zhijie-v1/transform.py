"""Pure, fail-closed inverse of the isolated Zhijie frontend/API rollout."""
import json
import re

MAP = re.compile(r'(<script\s+type="importmap">)([\s\S]*?)(</script>)')


def restore_html(current, original, manifest):
    now_match = MAP.search(current)
    old_match = MAP.search(original)
    assert now_match and old_match and len(MAP.findall(current)) == 1
    current_map = json.loads(now_match.group(2))
    original_map = json.loads(old_match.group(2))
    mappings = current_map['imports']
    original_mappings = original_map['imports']
    main_key = manifest['mainOriginal']
    layout_key = manifest['layoutOriginal']
    current_main = mappings[main_key]
    current_layout = mappings[layout_key]
    old_layout = original_mappings[layout_key]
    assert current_main.startswith('/assets/Admin-main-zhijie-')
    assert current_layout.startswith('/assets/DashboardLayout-zhijie-')
    assert main_key not in original_mappings, 'unexpected original main mapping'
    assert current.count('src="' + current_main + '"') == 1
    content = now_match.group(2)
    # The inserted self-entry is removed without reserializing other entries.
    entry = re.compile(r'(?P<left>,?)\s*' + re.escape(json.dumps(main_key)) +
                       r'\s*:\s*' + re.escape(json.dumps(current_main)) +
                       r'\s*(?P<right>,?)')
    content, count = entry.subn(
        lambda m: ',' if m.group('left') and m.group('right') else '', content)
    assert count == 1
    assert content.count(json.dumps(current_layout)) == 1
    content = content.replace(json.dumps(current_layout), json.dumps(old_layout), 1)
    expected_map = json.loads(json.dumps(current_map))
    del expected_map['imports'][main_key]
    expected_map['imports'][layout_key] = old_layout
    assert json.loads(content) == expected_map
    restored = current[:now_match.start(2)] + content + current[now_match.end(2):]
    restored = restored.replace('src="' + current_main + '"', 'src="' + main_key + '"', 1)
    removed_css = []
    for prefix in ['ZhijieBusiness-', 'AdminSidebar-layout-fixed-']:
        link = re.compile(r'<link\b[^>]*href="(/assets/' + re.escape(prefix) +
                          r'[^"/]+\.css)"[^>]*>')
        matches = link.findall(restored)
        assert len(matches) == 1, (prefix, matches)
        removed_css.extend(matches)
        restored, count = link.subn('', restored)
        assert count == 1
    assert 'Admin-main-zhijie-' not in restored
    assert 'DashboardLayout-zhijie-' not in restored
    assert '/assets/ZhijieBusiness-' not in restored
    remaining = json.loads(MAP.search(restored).group(2))['imports']
    untouched = {k: v for k, v in mappings.items() if k not in [main_key, layout_key]}
    assert all(remaining[k] == v for k, v in untouched.items())
    assert len(remaining) == len(mappings) - 1
    return restored, {
        'restoredMain': main_key, 'oldZhijieMain': current_main,
        'layoutKey': layout_key, 'restoredLayout': old_layout,
        'oldZhijieLayout': current_layout,
        'removedStylesheets': removed_css,
        'unrelatedImportMappingsPreserved': untouched,
        'method': 'current HTML targeted inverse, not whole old HTML replacement',
    }


def retire_nginx(current):
    block = re.compile(
        r'    # Zhijie phase-one access API:[^\n]*\n'
        r'    location \^~ /api/zhijie/ \{\n[\s\S]*?^    \}\n(?:\n)?', re.M)
    matches = block.findall(current)
    assert len(matches) == 1 and 'proxy_pass http://127.0.0.1:3019;' in matches[0]
    replacement = (
        '    # Retired Zhijie module: no page or business API remains available.\n'
        '    location = /zhijie { return 404; }\n'
        '    location ^~ /zhijie/ { return 404; }\n'
        '    location = /api/zhijie { return 404; }\n'
        '    location ^~ /api/zhijie/ { return 404; }\n\n'
    )
    restored, count = block.subn(lambda _: replacement, current)
    assert count == 1
    assert restored.replace(replacement, matches[0], 1) == current
    assert 'proxy_pass http://127.0.0.1:3019;' not in restored
    return restored
