from pathlib import Path
import subprocess
D=Path(__file__).resolve().parent
code=r'''from pathlib import Path
import json,subprocess
stage=Path('/opt/ops/20261117-official-mall-native-v10');m=json.loads((stage/'release-manifest.json').read_text());checks=[]
for role in ['admin','front']:
 api=next(x['target']for x in m['replace']if x['kind']=='api'and '/'+role+'/dist/'in x['target'])
 deps=Path(api).parent.parent/'node_modules';assert deps.exists(),'PROD_DEPENDENCIES_MISSING'
 tmp=stage/('module-check-'+role);tmp.mkdir(mode=0o700,exist_ok=True);link=tmp/'node_modules'
 if not link.exists():link.symlink_to(deps,target_is_directory=True)
 for f in m['add']:
  if f['kind']!='runtime'or '/'+role+'/runtime/'not in f['target']:continue
  p=stage/f['source'];assert p.exists(),'STAGED_RUNTIME_MISSING';dest=tmp/p.name;dest.write_bytes(p.read_bytes())
  command='const m=await import('+json.dumps(str(dest))+ ");if(!Object.values(m).some(x=>typeof x==='function'))throw Error('FACTORY_MISSING');console.log('MODULE_LOAD_OK')"
  r=subprocess.run(['node','--input-type=module','-e',command],cwd=tmp,capture_output=True,timeout=25)
  assert r.returncode==0,r.stderr.decode()[-400:];checks.append({'role':role,'factoryModuleLoaded':True})
print(json.dumps({'runtimeChecks':checks,'noApiServerOrWorkerStarted':True,'privateStageOnly':True}))
'''
compile(code,'remote-check-production-runtime','exec')
ssh=['ssh','-i','/home/ubuntu/.ssh/51-ecs.pem','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','ControlPath=none','-o','ConnectTimeout=15','root@47.97.108.147','python3 -'];r=subprocess.run(ssh,input=code.encode(),capture_output=True,timeout=100);assert r.returncode==0,r.stderr.decode()[-600:];(D/'runtime-production-load-check.json').write_bytes(r.stdout);print(r.stdout.decode())
