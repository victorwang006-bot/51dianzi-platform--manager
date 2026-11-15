#!/usr/bin/env python3
"""Executed in memory with fresh-capture primitives, existing locks, read-only snapshot."""
def preflight():
    with locks():
        need(not pathlib.Path(ROOT).exists() and not pathlib.Path(ROOT+'-candidate').exists(),'NEW_ROOT_AND_CANDIDATE_MUST_BE_ABSENT')
        mb=pin(OLD+'/manifest.json',CURRENT_MANIFEST);m=json.loads(mb)
        need(m['contractVersion']=='customer-origin-edit-release-v1' and m['runtimeRoot']==OLD and m['fixtureOnly'] is False,'EXACT_CURRENT_MANIFEST')
        need(len(m['sourceHashes'])==172 and len(m['hostCompileSourceHashes'])==25 and len(m['packageHashes'])==361,'SOURCE172_HOST25_PACKAGE361')
        s=json.loads(regular(OLD+'/activation-state.json'));need(s['phase']=='verified' and s.get('closeIntent') is False and s['manifestSha256']==CURRENT_MANIFEST,'VERIFIED_CLOSED_CURRENT_ROOT')
        coord=pin(COORD,s['coordClosedSha256']);c=json.loads(coord)
        need(c['shared_release_active'] is False and c['window']['opsDir']==OLD and c['window']['attemptId']==s['attemptId'] and c['window']['manifestSha256']==CURRENT_MANIFEST,'CLOSED_CURRENT_COORDINATOR')
        api={r['kind']:r['sha256'] for r in m['backendFiles']}
        need(api=={'front':'132c2a9924da37ccb50fadeb014865400df5cddf8d2255594631041cb1718538','admin':'50f425a421f4ad44f4a9f91744ec168b61c2103303ba54d0cc7fe67576563b9f'},'EXPLICIT_FRONT_ADMIN_CURRENT_PINS')
        need(m['htmlSha256']=='d82c4cc0b8e4c36ffc01aded663b4def29263dc269db166830b22c40ac77e7a6','EXPLICIT_CURRENT_HTML_PIN')
        for kind,p in [('front',FRONT),('admin',ADMIN)]:pin(p,api[kind])
        pin(PUBLIC+'/index.html',m['htmlSha256'])
        names=['manifest.json','input-contract.json','activation-state.json','release-owner.json','release-driver.py','attached-reloader.cjs']
        pins={n:sha(regular(OLD+'/'+n)) for n in names}
        need(pins['input-contract.json']==m['inputContractSha256'],'INPUT_CONTRACT_PIN')
        for n in ['release-driver.py','attached-reloader.cjs']:need(pins[n]==m['packageHashes'][n]==m['controlsPackageHashes'][n],'CONTROL_PIN')
        rows=snapshot(pins['attached-reloader.cjs']);done={r['id']:r['pid'] for r in s['completed'] if r['direction']=='forward'}
        need(set(r['id'] for r in rows)=={0,190,191,192,193,194,200,201,202,203,204,205},'EXACT_PRODUCTION_ID_SET')
        for r in rows:
            b=next(x for x in m['baselineProcesses'] if x['id']==r['id']);need(r==({**b,'pid':done[r['id']]} if r['id'] in (190,193,194,200,191,192) else b),'VERIFIED_SIX_PID_COMPLETIONS_AND_OTHER6_FROZEN')
        env=m['protectedEnvFiles'];need(len(env)>0,'PROTECTED_ENV_REQUIRED')
        for r in env:pin(r['path'],r['sha256'])
        result={'contractVersion':'manual-reference-edit-capture-contract-v1','currentRuntimeRoot':OLD,'newRuntimeRoot':ROOT,'ownerTask':'JfFQcJMqqFudyf4S9Egg7M','metadataPins':pins,'currentRootTree':tree(OLD),'coordPath':COORD,'coordSha256':sha(coord),'preflightProcesses':rows,'protectedEnvFiles':env,'api':api,'htmlSha256':m['htmlSha256'],'manualDisabledGuard':m['manualDisabledGuard'],'requiredSourceGraphCounts':{'source':172,'host':25}}
        pin(OLD+'/manifest.json',CURRENT_MANIFEST);pin(COORD,s['coordClosedSha256']);need(snapshot(pins['attached-reloader.cjs'])==rows,'PREFLIGHT_SNAPSHOT_RACE')
        sys.stdout.buffer.write(enc(result))
preflight()
