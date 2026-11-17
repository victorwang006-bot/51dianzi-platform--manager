from pathlib import Path
import json,subprocess
D=Path(__file__).resolve().parent;stage=json.loads((D/'stage-location.json').read_text());root=stage['root']
remote=r'''from pathlib import Path
import json,subprocess,shutil,os
R=Path(ROOT);M=json.loads((R/'release-manifest.json').read_text());rows=json.loads(subprocess.check_output(['pm2','jlist']));out={}
for role,d in M['databases'].items():
 P=R/('runtime-check-'+role);P.mkdir(mode=0o700,exist_ok=True);mods=[x for x in M['add']if x['kind']=='runtime'and x['role']==role]
 for x in mods:shutil.copyfile(R/x['source'],P/Path(x['target']).name)
 q=P/'node_modules';target=Path(d['packageCwd'])/'node_modules';assert target.is_dir(),'ORIGINAL_NODE_MODULES_MISSING'
 if not q.exists():q.symlink_to(target,target_is_directory=True)
 assert q.resolve()==target.resolve()
 process=next(x for x in rows if x['name']==d['processName']);e=process['pm2_env'];vals={**e,**e.get('env',{})}
 env={'PATH':'/usr/bin:/bin'}
 for key in ['JWT_SECRET','PORTAL_API_KEY']:
  if key in vals:env[key]=vals[key]
 own=next(x for x in mods if '.contracts.'not in Path(x['target']).name)
 code="""import{createRequire}from'node:module';import{pathToFileURL}from'node:url';const req=createRequire(process.argv[1]+'/package.json');const{initTRPC}=req('@trpc/server'),{sql}=req('drizzle-orm');const t=initTRPC.create();const fail=()=>{throw Error('OLD_DATABASE_OR_BUSINESS_CALL_FORBIDDEN_IN_RUNTIME_CHECK')};const base={getDb:fail,router:t.router,adminProcedure:t.procedure,TEAM_MATERIAL_FROM:sql``,crmSalesOrderNewInformationAccess:{requireAccess:fail,scopeWhere:fail,normalizeCreatedAt:fail}};const native=new Proxy(base,{get:(o,k)=>k in o?o[k]:fail});const mod=await import(pathToFileURL(process.argv[1]+'/'+process.argv[2]).href);if(typeof mod.createNativeNewInformationRuntime!=='function')throw Error('FACTORY_EXPORT_MISSING');const value=mod.createNativeNewInformationRuntime(native);if(process.argv[3]==='admin'){for(const n of['summary','inspect','markDisplayed'])if(!value.newInformation._def.record[n])throw Error('NATIVE_ROUTER_CTOR_MISSING:'+n);}else{for(const n of['recordCrmCustomerCreationFact','recordCrmCustomerAssignmentFact','recordDemandFirstSubmissionOrigin','recordCrmSalesCreationOrigin'])if(typeof value[n]!=='function')throw Error('TRUSTED_METADATA_HELPER_MISSING:'+n);}console.log(JSON.stringify({role:process.argv[3],runtimeLoaded:true,factoryConstructed:true,originalProductionDependencies:true,noOldStartup:true,noDatabaseOrBusinessCall:true}));"""
 r=subprocess.run(['node','--input-type=module','-e',code,str(P),Path(own['target']).name,role],env=env,capture_output=True,timeout=35);assert r.returncode==0,'NEW_RUNTIME_REAL_DEPENDENCY_LOAD_FAILED:'+r.stderr.decode()[-700:];out[role]=json.loads(r.stdout)
print(json.dumps(out))
'''.replace('ROOT',repr(root))
ssh=['ssh','-i','/home/ubuntu/.ssh/51-ecs.pem','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','ControlPath=none','-o','ConnectTimeout=15','-o','ServerAliveInterval=10','-o','ServerAliveCountMax=3','root@47.97.108.147']
r=subprocess.run(ssh+['python3 -'],input=remote.encode(),capture_output=True,timeout=95);(D/'production-runtime-check.log').write_bytes(r.stdout+r.stderr);assert r.returncode==0,r.stderr.decode()[-800:];x=json.loads(r.stdout);(D/'production-runtime-check.json').write_text(json.dumps(x,indent=2)+'\n');print(json.dumps(x))
