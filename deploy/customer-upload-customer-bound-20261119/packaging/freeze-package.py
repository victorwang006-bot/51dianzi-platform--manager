#!/usr/bin/env python3
"""Freeze an already prepared, freshly captured customer-bound package offline."""
import pathlib,hashlib,json,shutil,datetime,os,stat
BASE=pathlib.Path(os.environ.get('CUSTOMER_BOUND_DIR','/home/ubuntu/work/customer-bound'))
ROOT=pathlib.Path(__file__).resolve().parents[3];PKG=BASE/'package'
H=lambda b:hashlib.sha256(b).hexdigest()
controller=ROOT/'deploy/customer-upload-customer-bound-20261119/validation/release.py'
capture_bytes=(BASE/'capture/fresh.json').read_bytes();c=json.loads(capture_bytes)
assert c['controllerSha256']==H(controller.read_bytes())
assert c['ownerTask']=='PnHdmd0yBiQfYpcPRYWNvD' and c['scope']=='customer-upload-customer-bound-20261119-PnHdmd0yBi'
age=(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(c['capturedAtUtc'])).total_seconds();assert 0<=age<400,age
r5=json.loads((BASE/'task2-r5/final-live-handoff.json').read_text());pins=json.loads((BASE/'task2-r5/current-full-file-pins.json').read_text());links=json.loads((BASE/'task2-r5/seven-fixed-links.json').read_text())['records']
assert c['coordSha256']==r5['coordinatorSha256']
for name,digest in pins.items():
    record=c['protectedFiles'].get(name);assert record is not None,name
    if record['kind']=='file':assert record['sha256']==digest,name
    else:
        assert name in links and record['kind']=='symlink',name
        assert record['targetRecord']['sha256']==digest,name
for name,old in links.items():
    record=c['protectedFiles'][name];assert record['kind']==old['kind'] and record['link']==old['link'] and record['target']==old['target'],name
    for key in ['dev','ino','nlink','uid','gid','statmode','size','mtimeNs','ctimeNs']:
        assert record[key]==old[key],(name,key)
    if record['kind']=='directory-symlink':assert record['targetRoot']==old['targetRoot'],name
    else:
        target=record['targetRecord'];actual={key:target[key] for key in ['dev','ino','uid','gid']};actual['mode']=stat.S_IMODE(target['statmode']);assert actual==old['targetRoot'],name
old_processes={p['id']:p for p in r5['processSnapshot']['processes']}
assert len(c['processes'])==len(old_processes)==12
for process in c['processes']:
    prior=old_processes[process['id']]
    assert all(process[key]==prior[key] for key in ['id','pid','name','script','cwd','status']),process['id']
    assert process['rawProcEnvironSha256']==r5['processSnapshot']['environments'][str(process['id'])]['fullRawSha256'],process['id']
assert c['protectedFiles'][c['frontRoot']+'/index.html']['sha256']==r5['htmlSha256']
assert c['beforeHtmlSha256']==r5['adminHtmlSha256'] and c['beforeApiSha256']==r5['currentAPIHashes']['front']
(PKG/'capture.json').write_bytes(capture_bytes)
for name in ['source-independent-review.json','controller-tests.json','adapter-readonly-proof.json','typecheck-receipt.json']:
    shutil.copyfile(BASE/'evidence'/name,PKG/'evidence'/name)
for name in ['native-tests.json','customer-bound-native-tests.json','controller-tests.json','typecheck-receipt.json']:
    d=json.loads((PKG/'evidence'/name).read_text());assert d['status']=='passed',name
source_review=json.loads((PKG/'evidence/source-independent-review.json').read_text());assert source_review['status']=='passed' and source_review['independent'] is True
assert H((PKG/'before-index.html').read_bytes())==c['beforeHtmlSha256']
assert H((PKG/'before-api.js').read_bytes())==c['beforeApiSha256']
modules=json.loads((BASE/'modules.json').read_text());assert len(modules)==2
files={p.relative_to(PKG).as_posix():H(p.read_bytes()) for p in sorted(PKG.rglob('*')) if p.is_file() and p.name not in ['manifest.json','review.json']}
manifest={'ownerTask':c['ownerTask'],'scope':c['scope'],'captureSha256':H(capture_bytes),'controllerSha256':H(controller.read_bytes()),'beforeHtmlSha256':c['beforeHtmlSha256'],'afterHtmlSha256':H((PKG/'after-index.html').read_bytes()),'beforeApiSha256':c['beforeApiSha256'],'afterApiSha256':H((PKG/'after-api.js').read_bytes()),'apiDeltaSha256':H((PKG/'api-delta.json').read_bytes()),'assets':[{'relative':m['after'],'sha256':m['sha256'],'size':m['size']} for m in modules],'replacements':[{'before':'/'+m['before'],'after':'/'+m['after']} for m in modules],'cssRelative':None,'packageFiles':files}
raw=(json.dumps(manifest,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n').encode();(PKG/'manifest.json').write_bytes(raw)
print(json.dumps({'status':'FROZEN_NOT_APPLIED','manifestSha256':H(raw),'controllerSha256':manifest['controllerSha256'],'captureSha256':manifest['captureSha256'],'r5RegularFilesProtected':len(pins),'fixedLinksProtected':len(links),'fullCaptureFiles':len(c['protectedFiles']),'manifest':str(PKG/'manifest.json')},ensure_ascii=False,indent=2))
