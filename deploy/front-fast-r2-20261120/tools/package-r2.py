from pathlib import Path
import sys,json,hashlib,base64
R=Path('/home/ubuntu/work/resume-frontend');B=R/'r2-build';O=R/'remote-evidence/original-stage/package';PKG=R/'r2-package';C=R/'controller-r2'
sys.path.insert(0,str(C));import release as c
h=c.h;s=c.s
H=h.H;E=h.encode

def get(p):return json.loads(Path(p).read_bytes())
def put(name,data):
    p=PKG/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)

mode=sys.argv[1]
if mode=='prepare':
    assert not PKG.exists(),'NEW_LOCAL_PACKAGE_INITIAL_ONLY'
    PKG.mkdir(mode=0o700)
    build=get(B/'manifest.json');original=get(O/'manifest.json');bindings=get(C/'bindings.json')
    new=build['files']+[f for f in original['newFiles'] if f['role']=='asset']
    assert len(new)==11 and len({f['path'] for f in new})==11
    for f in new:
        raw=((O if f['role']=='asset' else B)/f['packageFile']).read_bytes()
        assert H(raw)==f['sha256'] and len(raw)==f['size']
        put(f['packageFile'],raw)
    for role in s.TARGET_ROLES:
        before=(O/'preimages'/f'{role}.bin').read_bytes()
        if role in ['front-api','admin-api']:
            after=(B/'postimages'/f'{role}.bin').read_bytes();delta=get(B/'deltas'/f'{role}.json')
            c.byte_delta(before,after,delta,s.Config().targets[role])
        elif role=='main-html':
            after=(O/'postimages/main-html.bin').read_bytes();delta=get(O/'deltas/main-html.json')
            c.byte_delta(before,after,delta,s.Config().targets[role])
        else:
            after=(R/'r2-private/prepared-candidate.json').read_bytes();delta=c.store_delta(before,after,s.Config().targets[role])
        put(f'preimages/{role}.bin',before);put(f'postimages/{role}.bin',after);put(f'deltas/{role}.json',E(delta))
    sources=dict(build['sourceHashes'])
    for p in [R/'build-r2.mjs',R/'package-r2.py',R/'benchmark-r2.mjs',B/'source-verifier.ts',B/'prewarm-verifier.ts']:
        sources[str(p)]=H(p.read_bytes())
    assert all(H(Path(p).read_bytes())==v for p,v in sources.items())
    logs={}
    for p in [R/'frontend-tests.log',R/'business-notes/patch/tests-final.log',R/'manager-v4-tests.log',R/'typecheck-v4.log',R/'manager-typecheck-v4.log',R/'controller-r2/test-results-r2.txt',R/'close-recovery-tests.log']:
        assert p.is_file() and p.stat().st_size>0;logs[str(p)]=H(p.read_bytes())
    consumed={'schema':'r2-business-source-and-evidence-v1','sources':sources,'testLogHashes':logs,'builderManifestSha256':H((B/'manifest.json').read_bytes()),'retainedStaticManifestSha256':H((O/'evidence/static-manifest.json').read_bytes()),'workerBenchmarkSha256':H((R/'r2-private/server-benchmark.json').read_bytes())}
    source_bundle=H(E(consumed));put('evidence/business-source-manifest.json',E(consumed))
    for name in ['frontend-manifest.json','static-manifest.json','frontend-controller-incremental-review.json']:
        put('evidence/historical-'+name,(O/'evidence'/name).read_bytes())
    put('evidence/backend-manifest.json',E(build));put('evidence/server-benchmark.json',(R/'r2-private/server-benchmark.json').read_bytes())
    put('evidence/controller-audit.md',(C/'README-R2.md').read_bytes())
    put('evidence/business-patch-review.md',(R/'business-notes/patch/README.md').read_bytes())
    for name in ['source-verifier','prewarm-verifier']:put(f'evidence/{name}.mjs',(B/'evidence'/f'{name}.mjs').read_bytes())
    proof=get(R/'r2-private/source-proof.json');proof['schema']='inline-store-source-verification-v1';proof.pop('sourceTickets')
    c.R.technical_store((PKG/'postimages/technical-store.bin').read_bytes(),E(proof),False)
    put('evidence/store-source-verification.json',E(proof))
    put('evidence/html-references.json',E({'schema':'fast-html-references-v1','before':c.html_refs((PKG/'preimages/main-html.bin').read_bytes()),'after':c.html_refs((PKG/'postimages/main-html.bin').read_bytes())}))
    put('evidence/build-proof.json',E({'schema':'fast-build-proof-v1','technicalDeadlineMs':150,'frontAwaitBeforeListen':True,'rejectPrewarmPreventsListen':True,'currentFileAcrossTickets':True,'noFirstPaintWaitAdded':True,'financialAndInventoryBytesPreserved':True,'scopeReviewed':True,'sourceBundleSha256':source_bundle}))
    bindings.update(files=[{k:f[k] for k in ['role','path','packageFile']} for f in new],evidenceFiles=sorted(p.relative_to(PKG).as_posix() for p in (PKG/'evidence').iterdir() if p.is_file()),sourceVerifier=build['verifiers']['source-verifier'],prewarmVerifier=build['verifiers']['prewarm-verifier'],frontReadyInsertionBase64=build['frontReadyInsertionBase64'],frontListenAnchorBase64=build['frontListenAnchorBase64'],businessSourceBundleSha256=source_bundle)
    assert bindings['htmlDeltaSha256']==H((PKG/'deltas/main-html.json').read_bytes())
    (C/'bindings.json').write_bytes(E(bindings));(R/'r2-newfiles.json').write_bytes(E(new));(R/'r2-controller-bundle.json').write_bytes(E(c.bundle()))
    print(json.dumps({'status':'new-bindings-package-prepared-no-capture','newFiles':len(new),'businessSourceBundleSha256':source_bundle,'controllerSha256':c.bundle()['controllerSha256']}))
elif mode=='finalize':
    raw=(R/'r2-capture.json').read_bytes();cap=h.decode(raw);bundle=c.bundle();put('capture.json',raw)
    targets=[]
    for role in s.TARGET_ROLES:
        before=(PKG/'preimages'/f'{role}.bin').read_bytes();after=(PKG/'postimages'/f'{role}.bin').read_bytes()
        assert H(before)==cap['targets'][role]['sha256'], 'FRESH_TARGET_CHANGED '+role
        targets.append({'role':role,'path':str(s.Config().targets[role]),'beforeFile':f'preimages/{role}.bin','afterFile':f'postimages/{role}.bin','deltaFile':f'deltas/{role}.json','beforeSha256':H(before),'afterSha256':H(after)})
    manifest={'schema':'fast-manifest-v1','ownerTask':s.OWNER,'scope':s.SCOPE,'ttlSeconds':s.TTL,'sourceFiles':bundle['sourceFiles'],'referenceSourceFiles':bundle['referenceSourceFiles'],'controllerSha256':bundle['controllerSha256'],'bindingsSha256':bundle['bindingsSha256'],'captureSha256':H(raw),'fullMetaSha256':cap['fullMetaSha256'],'coordSha256':cap['coordSha256'],'targets':targets,'newFiles':get(R/'r2-newfiles.json'),'reloadIds':list(s.RELOAD_IDS),'storePolicy':s.STORE_POLICY,'sourceVerification':s.SOURCE_SEQUENCE,'forbiddenBusinessChanges':s.FORBIDDEN,'packageFiles':{p.relative_to(PKG).as_posix():H(p.read_bytes()) for p in PKG.rglob('*') if p.is_file() and p.name not in ['manifest.json','review.json']}}
    put('manifest.json',E(manifest));(R/'r2-final-pins.json').write_bytes(E({'manifestSha256':H(E(manifest)),'controllerSha256':bundle['controllerSha256'],'captureSha256':H(raw),'capturedAtUtc':cap['capturedAtUtc']}));print((R/'r2-final-pins.json').read_text())
else:raise RuntimeError('MODE_REQUIRED')
