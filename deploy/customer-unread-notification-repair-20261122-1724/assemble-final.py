#!/usr/bin/env python3
import hashlib,json,subprocess
from pathlib import Path
W=Path(__file__).resolve().parent;ROOT=Path('/home/ubuntu/work/channel-release-20261121-1837')
J=lambda p:json.loads(Path(p).read_text());H=lambda b:hashlib.sha256(b).hexdigest()
a=J(W/'backend-candidate/manifest.json');f=J(W/'front-candidate/manifest.json');c=J(W/'customer/manifest.json');d=J(W/'diagnostics-tests-results.json');t=J(W/'types/results.json');s=J(W/'candidate-runtime-tests.json')
assert a['status']=='offline-assembled-not-deployed' and s['status']=='PASS_ACTUAL_CANDIDATE_OFFLINE_NATIVE'
assert c['tests']['status']=='PASS_OFFLINE_RUNTIME_ROUTER_READER' and c['tests']['caseCount']==18
assert d['totalPassed']==112 and d['piiCanaryInLogs']is False and t['managerES2020ExitCode']==0
assert all('TS2802' in e and 'MapIterator<string>' in e for e in t['standardErrors']), 'UNEXPECTED_STANDARD_ERROR'
sourcePins=dict(a['sourcePins']);sourcePins.update(f['sourcePins']);sourcePins.update(J(W/'diagnostics-sourcepins.json')['sourceHashes'])
for p,sha in c['sourceSHAs'].items():sourcePins[str(ROOT/'platform'/p)]=sha
for p,sha in sourcePins.items():assert H(Path(p).read_bytes())==sha,'SOURCE_PIN_DRIFT '+p
commits={side:subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT/repo,text=True).strip()for side,repo in [('front','platform'),('admin','manager')]}
for side,repo in [('front','platform'),('admin','manager')]:
 assert subprocess.check_output(['git','status','--porcelain'],cwd=ROOT/repo,text=True).strip()=='','WORKTREE_NOT_CLEAN '+side
apis=[f['api'],dict(a['api']['admin'],side='admin')];runtimes=[f['runtime'],dict(a['runtimes'][0],side='admin')]
for row in apis:assert H(Path(row['local']).read_bytes())==row['afterSHA'] and len(Path(row['local']).read_bytes())==row['size']
for row in runtimes:assert H(Path(row['local']).read_bytes())==row['sha256'] and len(Path(row['local']).read_bytes())==row['size']
records=J(W/'capture/records.json')
final={'scope':W.name,'authorization':'2026-11-22 17:24 user approved implementation and production release','sourceCommits':commits,'sourcePins':sourcePins,'apis':apis,'runtimes':runtimes,'assets':[],'unchangedHTML':{s:{'sha256':records[s+'-html']['sha256'],'path':records[s+'-html']['path']}for s in ['front','admin']},'tests':{'status':'TARGETED_NATIVE_PASS_WITH_DISCLOSED_LIMITS','customerRouterRuntimeCases':18,'diagnosticsSourceAndCompatibilityCases':112,'actualCandidateFactoryCases':6,'typeResults':t},'checks':{'singleImportPerAPI':True,'runtimeIncrementalOnly':True,'outsideExactAndInverse':True,'nativeDependenciesAndReturnUnchanged':True,'sameFactsContractRealm':True,'newFencePool':False,'originalPublicOrderTransportChanged':False},'limitations':['Synthetic identities, authorization gates, stores, SELECT executors and upstream transport in offline tests; not production customer filter MySQL proof','Historical sales inspect 503 cause remains OPEN; diagnostics is not a claim to have fixed it','Original native fence operation and post-callback cleanup observable; no new lease/connect/lock/unlock hooks deployed','No business test writes, DDL, DML tests or permissions changes; normal application startup/reload database writes are not asserted absent']}
(W/'final').mkdir(exist_ok=True);(W/'final/manifest.json').write_text(json.dumps(final,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':'FINAL_CANDIDATES_FROZEN','sourceCommits':commits,'apis':[{k:r[k]for k in ['side','afterSHA']}for r in apis],'runtimes':[{k:r[k]for k in ['side','sha256']}for r in runtimes]},ensure_ascii=False))
