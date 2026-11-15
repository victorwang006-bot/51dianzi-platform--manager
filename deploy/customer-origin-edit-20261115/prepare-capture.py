#!/usr/bin/env python3
"""Offline only. Never SSH. Build exact fresh-capture contract from downloaded root/private snapshot.
Raw private PM2 data is consumed, never copied into output or printed.
"""
import argparse, hashlib, json, pathlib, re, sys
sys.dont_write_bytecode=True
ROOT='/opt/ops/20261115-customer-origin-edit-JfFQcJM'
OLD='/opt/ops/20261115-inventory-compact-edit-cSy4W28'
COORD='/opt/ops/51-project-release-coordination-20261027.json'
sha=lambda b:hashlib.sha256(b).hexdigest()
enc=lambda x:(json.dumps(x,ensure_ascii=False,indent=2)+'\n').encode()
def need(ok,msg):
    if not ok:raise RuntimeError(msg)
def regular(p):
    p=pathlib.Path(p)
    for q in [p,*p.parents]:need(not q.is_symlink(),'SYMLINK_REFUSED')
    need(p.is_file(),'REGULAR_FILE_REQUIRED '+str(p));return p.read_bytes()
def canon(x):
    if isinstance(x,dict):return {k:canon(x[k]) for k in sorted(x)}
    if isinstance(x,list):return [canon(v) for v in x]
    return x
def project(r):
    e=r['pm2_env'];return {'id':r['pm_id'],'name':r['name'],'pid':r['pid'],'status':e['status'],'script':e['pm_exec_path'],'cwd':e['pm_cwd'],'execMode':e['exec_mode'],'environmentHash':sha(json.dumps(canon(e.get('env',{})),ensure_ascii=False,separators=(',',':')).encode())}
def prepare(a):
    old=pathlib.Path(a.previous);raw=json.loads(regular(a.private));m=json.loads(regular(old/'manifest.json'));state=json.loads(regular(old/'activation-state.json'))
    need(m==raw['manifest.json'] and state==raw['activation-state.json'],'DOWNLOADED_ROOT_PRIVATE_CURRENT_MISMATCH')
    need(m['runtimeRoot']==OLD and m['contractVersion']=='inventory-compact-edit-release-v1' and m['fixtureOnly'] is False,'CURRENT_ROOT_REQUIRED')
    need(state['phase']=='verified' and state.get('closeIntent') is False,'CURRENT_VERIFIED_REQUIRED')
    rows=sorted([project(r) for r in raw['processes']],key=lambda r:r['id'])
    need(len(rows)==12 and len({r['id'] for r in rows})==12 and all(r['status']=='online' and r['pid']>0 for r in rows),'CURRENT_12_ONLINE_REQUIRED')
    done={x['id']:x['pid'] for x in state['completed'] if x['direction']=='forward'}
    for r in rows:
        b=next(x for x in m['baselineProcesses'] if x['id']==r['id'])
        need(r==({**b,'pid':done[r['id']]} if r['id'] in (190,193,194,200) else b),'CURRENT_LIFECYCLE_PROCESS_PROOF')
    coord=regular(old/'coordination-owned.json') # verified close differs; use full exact private serialization only if hash matches state
    actual=enc(raw['coord']);need(sha(actual)==state['coordClosedSha256'],'COORD_PRIVATE_SERIALIZATION_NOT_EXACT_REQUEST_RAW_COORD_BYTES')
    need(raw['coord']['shared_release_active'] is False,'COORD_BUSY')
    tree=[]
    for p in old.rglob('*'):
        need(not p.is_symlink(),'TREE_SYMLINK_REFUSED')
        if p.is_file():tree.append([p.relative_to(old).as_posix(),sha(regular(p))])
        else:need(p.is_dir(),'TREE_NONREGULAR')
    tree.sort()
    for n,h in m['packageHashes'].items():need(sha(regular(old/n))==h,'DOWNLOADED_PACKAGE_DRIFT '+n)
    need(sha(regular(old/'input-contract.json'))==m['inputContractSha256'],'CURRENT_INPUT_PIN')
    for n,h in m['sourceHashes'].items():need(sha(regular(old/'source-snapshot'/n))==h,'CURRENT_UI_SOURCE_PIN')
    for n,h in m['independentSourceHashes'].items():need(sha(regular(old/'independent-source-snapshot'/n))==h,'CURRENT_INDEPENDENT_SOURCE_PIN')
    need(len(m['sourceHashes'])==148 and len(m['independentSourceHashes'])==2,'CURRENT_148_PLUS_2_REQUIRED')
    extras=json.loads(regular(a.protected))
    need(isinstance(extras,list) and len(extras)>0 and all(set(x)=={'path','sha256'} and x['path'].startswith('/') and re.fullmatch('[0-9a-f]{64}',x['sha256']) for x in extras),'PARENT_PROTECTED_ENV_FILE_HASH_ROWS_REQUIRED')
    c={'contractVersion':'customer-origin-edit-capture-contract-v1','currentRuntimeRoot':OLD,'newRuntimeRoot':ROOT,'ownerTask':'JfFQcJMqqFudyf4S9Egg7M','metadataPins':{n:sha(regular(old/n)) for n in ['manifest.json','input-contract.json','activation-state.json','release-owner.json','release-driver.py','attached-admin-reloader.cjs']},'currentRootTree':tree,'coordPath':COORD,'coordSha256':state['coordClosedSha256'],'preflightProcesses':rows,'protectedEnvFiles':extras,'api':{'front':m['backendFiles'][0]['sha256'],'admin':m['untouchedAdminApiSha256']},'htmlSha256':m['htmlSha256'],'manualDisabledGuard':m['manualDisabledGuard'],'requiredSourceGraphCounts':{'ui':148,'independent':2}}
    out=pathlib.Path(a.out);need(not out.exists(),'NEW_OUTPUT_ONLY');out.write_bytes(enc(c));out.chmod(0o600)
    print(json.dumps({'contract':str(out),'sha256':sha(enc(c)),'processCount':12,'environmentValuesExported':False}))
def main():
    p=argparse.ArgumentParser();p.add_argument('--previous',required=True);p.add_argument('--private',required=True);p.add_argument('--protected',required=True,help='parent-read-only protected env file path+sha256 rows, no values');p.add_argument('--out',required=True);prepare(p.parse_args())
if __name__=='__main__':
    try:main()
    except Exception as e:print('PREPARE_CAPTURE_ABORT: '+str(e),file=sys.stderr);sys.exit(1)
