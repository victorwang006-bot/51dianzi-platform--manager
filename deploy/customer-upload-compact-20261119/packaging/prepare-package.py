#!/usr/bin/env python3
"""Prepare local HTML/CSS assets only. No ECS connection or publication."""
import hashlib,json,pathlib,subprocess,shutil
ROOT=pathlib.Path(__file__).resolve().parents[3]
BASE=pathlib.Path('/home/ubuntu/work/upload-compact')
H=lambda b:hashlib.sha256(b).hexdigest()
mods=json.loads((BASE/'modules.json').read_text())
diff=subprocess.check_output(['git','--no-pager','diff','--color=never','--no-ext-diff','HEAD','--','client/src/business/platform/client/src/components/customers/CustomerUploadHistory.css'],cwd=ROOT,text=True)
lines=[s[1:] for s in diff.splitlines() if s.startswith('+') and not s.startswith('+++')]
assert lines and all(s.startswith('.customer-upload-history ') for s in lines),'only explicitly scoped history overrides'
css=('/* Customer upload compact 20261119: only history dialog overrides. */\n'+'\n'.join(lines)+'\n').encode()
relative='assets/customer-upload-compact-'+H(css)[:16]+'.css'
(BASE/'package'/relative).write_bytes(css)
before=(BASE/'capture/admin-index.html').read_bytes();after=before
for module in mods:
    assert module['before'].encode() in after
    after=after.replace(module['before'].encode(),module['after'].encode())
link=('<link rel="stylesheet" href="/'+relative+'">\n').encode()
assert after.count(b'</head>')==1
after=after.replace(b'</head>',link+b'</head>')
(BASE/'package/before-index.html').write_bytes(before);(BASE/'package/after-index.html').write_bytes(after)
assets=[{'relative':m['after'],'sha256':m['sha256'],'size':m['size']} for m in mods]+[{'relative':relative,'sha256':H(css),'size':len(css)}]
used={a['relative'] for a in assets}
for p in (BASE/'package/assets').iterdir():
    if 'assets/'+p.name not in used:p.unlink()
(BASE/'assets.json').write_text(json.dumps(assets,indent=2)+'\n')
(BASE/'replacements.json').write_text(json.dumps([{'before':'/'+m['before'],'after':'/'+m['after']} for m in mods],indent=2)+'\n')
(BASE/'css-relative.txt').write_text(relative+'\n')
(BASE/'package/evidence').mkdir(exist_ok=True)
for p in (BASE/'evidence').glob('*.json'):shutil.copyfile(p,BASE/'package/evidence'/p.name)
shutil.copyfile(BASE/'all-tests.log',BASE/'package/evidence/all-tests.log')
shutil.copyfile(BASE/'native-tests.log',BASE/'package/evidence/native-tests.log')
print(json.dumps({'status':'LOCAL_PACKAGE','assets':assets,'beforeHtmlSha256':H(before),'afterHtmlSha256':H(after)},indent=2))
