from pathlib import Path
import json, subprocess, gzip, base64, hashlib
D=Path(__file__).resolve().parent
inputs=json.loads((D/'current-inputs.json').read_text())
ssh=['ssh','-i','/home/ubuntu/.ssh/51-ecs.pem','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','ControlPath=none','-o','ConnectTimeout=15','root@47.97.108.147']
code='''from pathlib import Path
import json,hashlib,gzip,base64
S=Path(STATIC_ROOT); names=MODULE_NAMES
html=(S/'index.html').read_bytes()
print(json.dumps({'html':base64.b64encode(gzip.compress(html)).decode(),'htmlSha256':hashlib.sha256(html).hexdigest(),'modules':{n:hashlib.sha256((S/n.lstrip('/')).read_bytes()).hexdigest()for n in names}}))
'''.replace('STATIC_ROOT',repr(inputs['staticRoot'])).replace('MODULE_NAMES',repr([a['url']for a in inputs['assets']]))
r=subprocess.run(ssh+['python3 -'],input=code.encode(),capture_output=True,timeout=90);assert r.returncode==0,r.stderr.decode()[-1000:]
x=json.loads(r.stdout);html=gzip.decompress(base64.b64decode(x.pop('html')))
assert hashlib.sha256(html).hexdigest()==x['htmlSha256']
for a in inputs['assets']:
 assert hashlib.sha256(Path(a['local']).read_bytes()).hexdigest()==a['sha256']==x['modules'][a['url']],'CURRENT_MODULE_DRIFT'
 assert a['url'].encode()in html,'CURRENT_MODULE_NOT_IN_HTML_MAP'
(D/'before.html').write_bytes(html);(D/'baseline.json').write_text(json.dumps(x,indent=2)+'\n')
print(json.dumps({'status':'real-html-and-two-current-modules-frozen','htmlSha256':x['htmlSha256'],'moduleCount':len(x['modules'])}))
