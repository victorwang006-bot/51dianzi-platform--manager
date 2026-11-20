#!/usr/bin/env python3
"""Read-only after the ONE-SHOT job finishes. No replay, reload, prepare or DB writes."""
from pathlib import Path
import sys,copy,json
STAGE=Path('/opt/ops/front-fast-r2-20261120-qp4e5jVm')
sys.path.insert(0,str(STAGE/'controller'))
import release as c
h=c.h
ctl=c.Controller();cfg=ctl.cfg
with h.locked(cfg):
    rb=h.regular(cfg.receipt/'confirmed.json');receipt=h.decode(rb)
    h.need(receipt['status']=='verified' and receipt['ownerTask']==c.s.OWNER and receipt['scope']==c.s.SCOPE,'FINAL_VERIFIED_OWN_RECEIPT_REQUIRED')
    h.need(not (cfg.receipt/'failure.json').exists() and not (cfg.receipt/'failure.json').is_symlink(),'FINAL_FAILURE_OVERRIDES_SUCCESS')
    coord=h.regular(cfg.coord);coord_record=h.describe(cfg.coord);state=ctl.coord_closed(coord)
    h.need(h.H(coord)==receipt['closedCoordSha256'] and state['window']['nonce']==receipt['nonce'] and state['window']['outcome']=='verified','FINAL_EXACT_OWN_CLOSED_COORD_BINDING')
    mb=h.regular(cfg.package/'manifest.json');m=h.decode(mb);review=h.regular(cfg.package/'review.json')
    h.need(h.H(mb)==receipt['manifestSha256'] and h.H(review)==receipt['reviewSha256'] and ctl.controller_hash==receipt['controllerSha256'],'FINAL_ALL_FIXED_PINS')
    capture=h.decode(h.regular(cfg.package/'capture.json'))
    first=ctl.snapshot()
    h.need(first['processes']==receipt['processesAfter'],'FINAL_CONFIRMED_PROCESS_DRIFT')
    expected=copy.deepcopy(capture['protectedFiles']);targetsha={}
    last_store_sha=receipt['sourceVerificationEvents'][-1]['storeSha256']
    for t in m['targets']:
        p=Path(t['path']);record=h.describe(p);before=capture['targets'][t['role']]
        digest=last_store_sha if t['role']=='technical-store' else t['afterSha256']
        h.need(record['sha256']==digest and record['kind']=='file' and record['nlink']==1,'FINAL_TARGET_POSTIMAGE_HASH')
        h.need(all(record[k]==before[k] for k in ('uid','gid','statmode','dev')),'FINAL_TARGET_STABLE_PERMISSIONS')
        expected[str(p)]=record;targetsha[t['role']]=digest
    for f in m['newFiles']:
        p=Path(f['path']);record=h.describe(p)
        h.need(record['sha256']==f['sha256'] and record['uid']==f['uid'] and record['gid']==f['gid'] and record['nlink']==1 and record['size']==f['size'],'FINAL_IMMUTABLE_CONTENT_PERMISSIONS')
        if str(p) in capture['protectedFiles']:h.need(record==capture['protectedFiles'][str(p)],'FINAL_CAPTURED_RETAINED_FULL_METADATA')
        expected[str(p)]=record
    h.need(first['protectedFiles']==expected and first['protectedDirectories']==capture['protectedDirectories'] and first['servingRoots']==capture['servingRoots'],'FINAL_OTHER_FILES_FULL_META_AND_ROOTS')
    doc=h.decode(h.regular(cfg.targets['technical-store']));targets=c.target_entries(doc)
    business=[]
    for part,e in targets.items():
        raw,elapsed=c.list_get(part);items=c.response_items(raw)
        h.need(len(items)==1 and items[0]['publicId']==e['identity']['publicId'] and items[0]['partNumber']==part and items[0]['technicalResource']==e['technicalResource'],'FINAL_TRUE_BUSINESS_READY_DTO')
        r=e['technicalResource']['resource'];h.need(e['technicalResource']['state']=='ready' and r['parameters'] and r['datasheetUrl'],'FINAL_READY_PARAMS_PDF')
        business.append(dict(partNumber=part,publicId=e['identity']['publicId'],elapsedMs=elapsed,parameterCount=len(r['parameters']),datasheetUrl=r['datasheetUrl'],responseSha256=h.H(raw)))
    for host,path in [('51dianzi.com',cfg.html),('admin.51dianzi.com',cfg.public/'index.html')]:h.need(h.H(h.http_get(host,''))==h.H(h.regular(path)),'FINAL_ORIGIN_HTML_HASH')
    second=ctl.snapshot();h.need(second==first and h.regular(cfg.coord)==coord and h.describe(cfg.coord)==coord_record and h.regular(cfg.receipt/'confirmed.json')==rb,'FINAL_AFTER_ALL_IO_CAS')
    sourceflags={p:v['sha256'] for p,v in second['protectedFiles'].items() if p.startswith('/opt/ops/official') and p.endswith('.json') and v.get('kind')=='file'}
    result=dict(status='verified-closed-readonly-reconfirmed',ownerTask=c.s.OWNER,scope=c.s.SCOPE,receiptPath=str(cfg.receipt/'confirmed.json'),receiptSha256=h.H(rb),manifestSha256=receipt['manifestSha256'],reviewSha256=receipt['reviewSha256'],controllerSha256=receipt['controllerSha256'],closedCoordSha256=h.H(coord),coordRecordSha256=h.H(h.encode(coord_record)),targetSha256=targetsha,adminHtmlSha256=h.H(h.regular(cfg.public/'index.html')),sourceFlagSha256=sourceflags,processes=[dict(id=p['id'],pid=p['pid'],name=p['name'],restarts=p['restarts'],rawProcEnvironSha256=p['rawProcEnvironSha256']) for p in first['processes']],protectedFileCount=len(second['protectedFiles']),unknownOtherFileDrift=0,retainedAssetsFullMetadataExact=True,otherSixRawExact=True,sourceVerificationCount=len(receipt['sourceVerificationEvents']),business=business,productionWrites=0,reloads=0,coordinationClosed=True)
    sys.stdout.buffer.write(h.encode(result))
