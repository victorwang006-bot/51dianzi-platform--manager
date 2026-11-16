from pathlib import Path
D=Path(__file__).resolve().parent
source=Path('/home/ubuntu/work/self-operated-mall-plan-20261116/route-fix/apply.py').read_text()
source=source.replace("R=Path('/opt/ops/20261116-mall-outer-route-fix')", "R=Path('/opt/ops/20261117-mall-native-nav-fix')")
source=source.replace("assert m['scope']=='mall-outer-router-404-only'", "assert m['scope']=='mall-native-global-navigation-two-conditions-only'")
a=source.index('# One byte insertion');b=source.index('subprocess.run([',a)
source=source[:a]+'''# Exactly two original navigation conditions; every other byte remains frozen.
before=old.read_bytes();candidate=(R/m['files'][0]['name']).read_bytes();expected=before
assert len(m['patch'])==2 and m['checks']['nativeMallPermissionAndAccountGateUnchanged'] and m['checks']['rootEntryLeafAndCssUnchanged']
for p in sorted(m['patch'],key=lambda x:x['beforeByteStart'],reverse=True):
 i=p['beforeByteStart'];j=p['beforeByteEnd'];assert before[i:j]==p['before'].encode();assert p['before'] in ['enabled:u&&o.split(/[?#]/,1)[0]!=="/workbench/mall-materials",retry:So','Ao({enabled:u&&o.split(/[?#]/,1)[0]!=="/workbench/mall-materials",isPending:w.isPending'];assert p['after']==p['before'].replace('&&o.split(/[?#]/,1)[0]!=="/workbench/mall-materials"','');expected=expected[:i]+p['after'].encode()+expected[j:]
assert candidate==expected,'NON_NAVIGATION_BYTE_CHANGE'
''' +source[b:]
source=source.replace("'/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/public/index.html'", "'/opt/releases/20261031-homepage-banner-v39/front/dist/public/index.html',str(S/m['rootEntry'].lstrip('/')),str(S/m['nativeLeaf'].lstrip('/')),str(S/m['nativeCss'].lstrip('/'))")
source=source.replace("'oneOuterRouteOnly':True", "'twoNavigationConditionsOnly':True")
compile(source,'apply.py','exec');(D/'apply.py').write_text(source)
print('STATIC_CONTROLLER_READY_NO_API_OR_DB_OPERATIONS')
