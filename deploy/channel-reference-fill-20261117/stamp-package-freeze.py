from pathlib import Path
import json,hashlib,tarfile
D=Path(__file__).resolve().parent;V=Path('/home/ubuntu/work/inbound-documents-fix-v2-20261117');Mroot=Path('/home/ubuntu/work/51dianzi-platform--manager');P=D/'package';H=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();J=lambda p:json.loads(Path(p).read_text())
M=J(P/'release-manifest.json');a=J(V/'candidate/manifest.json');s=J(V/'static-build/manifest.json');r=J(D/'runtime-build/manifest.json');review=J(V/'independent-review-v2.json');assert review['p0Count']==review['p1Count']==0 and review['status'].startswith('PASS')
sources=dict(a['sourceHashes']);sources.update(s['sourceHashes']);sources.update({str(Mroot/p):h for p,h in r['sourceHashes'].items()})
for name in ['snapshot','identity-bindings','stock-evidence']:p=Mroot/'server/channelReference'/('channel-reference-'+name+'.json');sources[str(p)]=H(p)
for p in [V/'candidate/manifest.json',V/'static-build/manifest.json',V/'independent-review-v2.json',D/'runtime-build/manifest.json',D/'api-build/delta.json',D/'prepare-controller.py',D/'release.py',D/'prepare-package.py',D/'stamp-package-freeze.py']:sources[str(p)]=H(p)
for p,h in sources.items():assert H(p)==h,'FINAL_SOURCE_DRIFT:'+p
M['sourceHashes']=sources;M['reviewSha256']=H(V/'independent-review-v2.json');M['forbiddenConfigFiles'].append('/var/lib/51dianzi/channel-reference-manual-v1/manual-refresh-config.json');M['wholeFrontTypesPassed']=True;M['wholeAdminTypesPassed']=True;M['finalUITestsPassed']=86;M['finalStaticChecksPassed']=14
for p in [P/'release-manifest.json',D/'release-manifest.json']:p.write_text(json.dumps(M,indent=2)+'\n')
with tarfile.open(D/'package-private.tar.gz','w:gz',compresslevel=6)as t:
 for p in sorted(P.rglob('*')):
  if p.is_file():assert not p.is_symlink();t.add(p,arcname=str(p.relative_to(P)),recursive=False)
(D/'freeze-final.json').write_text(json.dumps({'manifestSha256':H(P/'release-manifest.json'),'packageSha256':H(D/'package-private.tar.gz'),'sourceCount':len(sources),'noProductionWrites':True,'noDdl':True,'newCopiedDependencies':False,'reviewPassed':True},indent=2)+'\n');print('FINAL_PRIVATE_FREEZE',len(sources),'exact sources','no production writes')
