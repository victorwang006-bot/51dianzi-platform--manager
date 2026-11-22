import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const R='/home/ubuntu/work/channel-release-20261121-1837/manager';
const O='/home/ubuntu/work/customer-unread-notification-repair-release-20261122-1724';
const req=createRequire(R+'/package.json'), esbuild=req('esbuild'), ts=req('typescript');
const z=req('zod').z, sqlRealm=req('drizzle-orm'), {TRPCError}=req('@trpc/server');
const bridges=new Map();
function bridge(file,names){bridges.set(path.join(R,file),'export const {'+names.join(',')+'}=native;');}
bridge('server/db.ts',['getDb','withBusinessAuthorizationFence','getAdminUserById','getAdminUserPermissions','getActiveBusinessStaffBinding','getActiveBusinessMerchantScope','getBusinessWorkbenchMerchantById','getAdminUserSalesScopeCodes']);
bridge('drizzle/adminNewInformationSchema.ts',['adminNewInformationStates','adminNewInformationSeen']);
bridge('drizzle/schema.ts',['adminStaffArchives']);
bridge('server/businessAccess.ts',['businessEnterpriseBindingFromMerchant','businessScopeAllows','getBusinessWorkbenchMerchantIds']);
bridge('server/businessRouter.ts',['readBusinessNewInformationFacts']);
bridge('server/services/adminNewInformationSources/mall.ts',['createMallNewInformationReader']);
bridge('server/services/officialChannelAccess.ts',['loadOfficialAccess','assertOfficialRecordAction','officialTeamPredicate','officialActorFromContext']);
const built=await esbuild.build({stdin:{contents:`import {createAdminNewInformationService} from './server/services/adminNewInformation';import {createAdminNewInformationSourceForContext} from './server/services/adminNewInformationSources';import {getPlatformOrderNewInformationFacts} from './server/platformOrderApi';import {withAdminNewInformationDiagnosticSink,safeAdminNewInformationError} from './server/services/adminNewInformationDiagnostics';export {createAdminNewInformationService,createAdminNewInformationSourceForContext,getPlatformOrderNewInformationFacts,withAdminNewInformationDiagnosticSink,safeAdminNewInformationError};`,resolveDir:R,sourcefile:'offline-native-compat.ts',loader:'ts'},bundle:true,write:false,platform:'node',target:'node20',format:'esm',packages:'external',metafile:true,plugins:[{name:'offline-native-injected-realms',setup(b){
 b.onResolve({filter:/.*/},arg=>{
  if(arg.path==='@trpc/server')return{path:'trpc',namespace:'realm'};
  if(arg.path==='zod')return{path:'zod',namespace:'realm'};
  if(arg.path==='drizzle-orm')return{path:'sql',namespace:'realm'};
  if(arg.path.startsWith('.')){let p=path.resolve(arg.resolveDir,arg.path);if(!path.extname(p))p+='.ts';if(bridges.has(p))return{path:p,namespace:'native-bridge'};}
 });
 b.onLoad({filter:/.*/,namespace:'realm'},a=>({contents:a.path==='trpc'?'export const TRPCError=native.TRPCError;':a.path==='zod'?'export const z=native.z;':'export const {and,eq}=native;',loader:'ts'}));
 b.onLoad({filter:/.*/,namespace:'native-bridge'},a=>({contents:bridges.get(a.path),loader:'ts',resolveDir:path.dirname(a.path)}));
}}]});
let code=built.outputFiles[0].text;
const ast=ts.createSourceFile('offline.mjs',code,99,true,ts.ScriptKind.JS);
assert.equal(ast.parseDiagnostics.length,0);
const imports=ast.statements.filter(ts.isImportDeclaration), exports=ast.statements.filter(ts.isExportDeclaration);
for(const n of imports)assert.ok(n.moduleSpecifier.text.startsWith('node:'),'Only builtins may remain outside native injected factory');
const patches=[...imports,...exports].map(n=>({start:n.getStart(ast),end:n.end})).sort((a,b)=>b.start-a.start);
for(const p of patches)code=code.slice(0,p.start)+code.slice(p.end);
code=imports.map(n=>n.getText(ast)).join('\n')+'\nexport function createOfflineNativeRuntime(native){\n'+code+'\nreturn {createAdminNewInformationService,createAdminNewInformationSourceForContext,getPlatformOrderNewInformationFacts,withAdminNewInformationDiagnosticSink,safeAdminNewInformationError};\n}\n';
const inputs=Object.keys(built.metafile.inputs);
assert.equal(inputs.filter(p=>!p.startsWith('native-bridge:')&&p.endsWith('/server/db.ts')).length,0,'Root db must never be bundled');
assert.equal(inputs.filter(p=>p.endsWith('adminNewInformationDiagnostics.ts')).length,1,'One singleton module for core/source/transport');
assert.ok(!code.includes('MAX_FENCE_LEASES'),'No second native lock pool');
assert.ok(!code.includes('callPlatformOrder("newInformationFacts"'),'Dedicated helper must not be replaced by old native bridge');
fs.writeFileSync(O+'/native-diagnostics-compatibility.runtime.mjs',code);
fs.writeFileSync(O+'/native-diagnostics-compatibility.metafile.json',JSON.stringify(built.metafile,null,2)+'\n');
const {createOfflineNativeRuntime}=await import(pathToFileURL(O+'/native-diagnostics-compatibility.runtime.mjs'));
let fenceCalls=0,cleanupFailure=false;
const native={...sqlRealm,z,TRPCError,getDb(){throw Error('REAL_DATABASE_FORBIDDEN')},withBusinessAuthorizationFence:async(_key,run)=>{fenceCalls++;const result=await run();if(cleanupFailure)throw Object.assign(Error('PRIVATE_CANARY'),{code:'ECONNRESET'});return result;},businessScopeAllows:()=>true,businessEnterpriseBindingFromMerchant:m=>({synthetic:m.id}),getBusinessWorkbenchMerchantIds:()=>[]};
const runtime=createOfflineNativeRuntime(native), account={id:7,sessionVersion:3,status:'active',adminRole:'super_admin'},viewer={adminUserId:7,sessionVersion:3};
const context={adminAccount:account,user:{id:7,openId:'local_admin:7',role:'admin'}};
const records=[], facts={available:true,scope:{identity:'synthetic',version:'v1'},items:[],snapshot:'s1'};
const oldFetch=globalThis.fetch, oldEnv={PLATFORM_API_BASE:process.env.PLATFORM_API_BASE,PORTAL_API_KEY:process.env.PORTAL_API_KEY};
let mode='503';const requests=[];
globalThis.fetch=async(url,init)=>{requests.push({procedure:new URL(url).pathname,signalPresent:!!init.signal});return new Response(JSON.stringify(mode==='ok'?[{result:{data:{json:facts}}}]:[{error:{json:{message:'PRIVATE_CANARY',data:{code:'UNAUTHORIZED'}}}}]),{status:mode==='ok'?200:503});};
process.env.PLATFORM_API_BASE='http://offline.invalid';process.env.PORTAL_API_KEY='SYNTHETIC_SECRET';
const source=runtime.createAdminNewInformationSourceForContext(context,{getDb:async()=>({}),getAdminUserById:async()=>account,getAdminUserPermissions:async()=>['orders.read'],isAccountArchived:async()=>false,configuredMerchantIds:()=>[],getAdminSalesStaffCodes:async()=>undefined});
const state={initialized:true,seen:new Set(),lastSummary:{count:7,available:true}};
const store={withModule:async(_v,_m,run)=>run(state),withModules:async(_v,ms,run)=>run(new Map(ms.map(m=>[m,state])))};
const service=runtime.createAdminNewInformationService({source,store,secret:'SYNTHETIC_SECRET'});
const results=[];
try {
 const error=await runtime.withAdminNewInformationDiagnosticSink(r=>records.push(r),()=>service.inspect(viewer,{module:'sales',refs:['order:1']}).catch(e=>e));
 assert.ok(error instanceof TRPCError,'Must use injected native TRPCError realm');assert.equal(error.code,'SERVICE_UNAVAILABLE');assert.equal(error.message,'新增信息核验暂不可用，请稍后重试');
 assert.ok(records.some(r=>r.sourceKind==='nativeOrders'&&r.phase==='entryRead'&&r.error?.httpStatus===503&&r.error.upstreamTrpcCode==='UNAUTHORIZED'),'Dedicated native helper evidence must join core trace');
 assert.equal(new Set(records.map(r=>r.traceId)).size,1);assert.ok(records.every(r=>!JSON.stringify(r).includes('PRIVATE_CANARY')&&!JSON.stringify(r).includes('SYNTHETIC_SECRET')));
 results.push({name:'bundled_private_native_transport_trace_and_native_trpc_realm',passed:true});
 mode='ok';records.length=0;assert.deepEqual(await runtime.withAdminNewInformationDiagnosticSink(r=>records.push(r),()=>service.inspect(viewer,{module:'sales',refs:['order:1']})),{items:[]});assert.equal(records.length,1);
 results.push({name:'native_success_one_end_original_two_argument_fence',passed:true});
 cleanupFailure=true;records.length=0;const e=await runtime.withAdminNewInformationDiagnosticSink(r=>records.push(r),()=>service.inspect(viewer,{module:'sales',refs:['order:1']}).catch(e=>e));assert.equal(e.code,'SERVICE_UNAVAILABLE');assert.ok(records.some(r=>r.phase==='cleanup'&&r.error?.mysqlCode==='ECONNRESET'));
 results.push({name:'old_native_fence_post_callback_cleanup_observed_without_new_pool',passed:true});
} finally {globalThis.fetch=oldFetch;for(const[k,v]of Object.entries(oldEnv))v===undefined?delete process.env[k]:process.env[k]=v;}
// Extract the ORIGINAL production transport function, never import/boot the API.
const capture='/home/ubuntu/work/procurement-demo-restore-release-20261122-1610/capture/admin-api.js';
const original=fs.readFileSync(capture,'utf8'),hash=createHash('sha256').update(original).digest('hex');
assert.equal(hash,'de4e92fa7165ad52c6bbeb93b5b04629d2b548070055002b16337cc4b4930df8');
const originalAST=ts.createSourceFile(capture,original,99,true,ts.ScriptKind.JS),fn=originalAST.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='callPlatformOrder');assert.ok(fn);
const box={getConfig2:()=>({baseUrl:'http://offline.invalid',key:'synthetic'}),AbortSignal:{timeout:()=>undefined},fetch:async()=>({ok:false,status:503,json:async()=>[{error:{json:{message:'old-public-message',data:{code:'UNAUTHORIZED'}}}}]})};
vm.runInNewContext(fn.getText(originalAST)+'\nglobalThis.transport=callPlatformOrder;',box,{timeout:1000});
const oldError=await box.transport('newInformationFacts',{}).catch(e=>e);assert.equal(oldError.message,'old-public-message');assert.equal(oldError.code,undefined);assert.equal(oldError.httpStatus,undefined);
results.push({name:'original_captured_native_transport_mock_proves_evidence_loss_no_api_boot',passed:true});
// Assert all old public-order declarations in edited source remain byte exact.
const current=fs.readFileSync(R+'/server/platformOrderApi.ts','utf8');
const baseline=(await import('node:child_process')).execFileSync('git',['show','HEAD:server/platformOrderApi.ts'],{cwd:R,encoding:'utf8'});
function decls(text){const a=ts.createSourceFile('transport.ts',text,99,true,ts.ScriptKind.TS);return Object.fromEntries(a.statements.filter(ts.isFunctionDeclaration).map(n=>[n.name.text,n.getText(a)]));}
const before=decls(baseline),after=decls(current);for(const name of ['getConfig','callPlatformOrder','getPlatformOrderStats','listPlatformOrders','getPlatformOrderDetail'])assert.equal(after[name],before[name],name+' public compatibility');
results.push({name:'all_original_public_order_functions_byte_exact',passed:true});
const result={mode:'OFFLINE_NATIVE_ABI_MOCK_ONLY',passed:true,tests:results.length,results,networkRequests:0,realDatabaseConnections:0,businessWrites:0,productionActions:0,nativeFenceCalls:fenceCalls,originalCapturedAdminApiSha256:hash,nativeRealmsInjected:['SQL and/eq','Zod z','TRPCError','db/helpers/schema'],oneDiagnosticModule:true,noRootDbBundle:true,noSecondFencePool:true,sourceInputCount:inputs.length,requests};
fs.writeFileSync(O+'/native-diagnostics-compatibility-results.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
