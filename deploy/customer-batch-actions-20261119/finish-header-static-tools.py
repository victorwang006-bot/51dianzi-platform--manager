#!/usr/bin/env python3
import ast,difflib,hashlib,json,uuid
from pathlib import Path
W=Path('/home/ubuntu/work/customer-upload-header-mapping-20261121-1058');O=W/'static-release';BASE=W/'static-tools-handoff/browser-compat-static-tools-handoff/source';R=Path('/home/ubuntu/51-manager');H=lambda b:hashlib.sha256(b).hexdigest();scope='customer-upload-header-mapping-20261121-6Lfttf6o-1156'
proof={}
for name in ['land-package.py','apply-and-confirm.py']:
 original=(BASE/name).read_text();s=original;changes=[]
 def change(old,new):
  global s
  assert s.count(old)==1,(name,old);s=s.replace(old,new);changes.append({'before':old,'after':new})
 if name=='land-package.py':
  change("O=Path('/home/ubuntu/work/browser-compat-release-20261121-1131');STAGE='/opt/ops/browser-compat-release-20261121-1131';H=lambda b:hashlib.sha256(b).hexdigest()", "O=Path("+repr(str(O))+");STAGE='/opt/ops/"+scope+"';H=lambda b:hashlib.sha256(b).hexdigest()")
  change("front=Path('/opt/releases/20261031-homepage-banner-v39/front/dist/public')", "front=Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public')")
 else:
  change("O=Path('/home/ubuntu/work/browser-compat-release-20261121-1131');STAGE='/opt/ops/browser-compat-release-20261121-1131'", "O=Path("+repr(str(O))+");STAGE='/opt/ops/"+scope+"'")
  change("'scope':'browser-compat-release-20261121-1131'", "'scope':"+repr(scope))
  change("Path('/opt/releases/20261031-homepage-banner-v39/front/dist/public/index.html')", "Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public/index.html')")
 change('import paramiko',"import sys;sys.path.insert(0,'/home/ubuntu/.cache/backend-sftp-lib');import paramiko")
 change("key_filename='/home/ubuntu/.secrets/frontend-deploy.pem'", "key_filename='/home/ubuntu/.cache/backend-ssh.pem'")
 inverse=s
 for c in reversed(changes):inverse=inverse.replace(c['after'],c['before'],1)
 assert inverse==original;compile(s,name,'exec');(O/name).write_text(s);(O/(name+'.delta.patch')).write_text(''.join(difflib.unified_diff(original.splitlines(True),s.splitlines(True),fromfile='original/'+name,tofile='header/'+name)));proof[name]={'originalSHA':H(original.encode()),'actualSHA':H(s.encode()),'wholeInverseExact':True,'changes':changes}
(O/'entry-tool-proof.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n')
m=json.loads((O/'package/manifest.json').read_bytes());m['nonce']=uuid.uuid4().hex;m['toolPins']={'releaseSHA':H((O/'release.py').read_bytes()),'helperSHA':H((O/'safety_core.py').read_bytes()),'landPackageSHA':H((O/'land-package.py').read_bytes()),'applyAndConfirmSHA':H((O/'apply-and-confirm.py').read_bytes()),'confirmPagesSHA':H((O/'confirm-pages.py').read_bytes()),'preparePackageSHA':H((R/'deploy/customer-batch-actions-20261119/prepare-header-package-once.py').read_bytes()),'nativeDependencyBindingSHA':H((R/'deploy/customer-batch-actions-20261119/bind-header-native-deps.py').read_bytes()),'finishToolsSHA':H(Path(__file__).read_bytes())};m['releaseBudget']=json.loads((W/'release-budget.json').read_bytes());m['evidencePins']={str(p.relative_to(W)):H(p.read_bytes()) for p in [W/'offline-result.json',W/'affected-tests.log',W/'compact-corrected-tests.log',W/'typecheck.log',W/'header-mapping-complete-offline.tar.gz',O/'current-static.private.json',O/'native-dependency-binding.json',O/'tool-proof.json',O/'entry-tool-proof.json']}
(O/'package/manifest.json').write_text(json.dumps(m,sort_keys=True,ensure_ascii=False,separators=(',',':'))+'\n');summary=json.loads((O/'package-summary.json').read_bytes());summary.update(manifestSHA=H((O/'package/manifest.json').read_bytes()),releaseSHA=m['toolPins']['releaseSHA'],helperSHA=m['toolPins']['helperSHA']);(O/'package-summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
