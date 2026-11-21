import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const D = path.dirname(new URL(import.meta.url).pathname), O=D+'/backend-candidate';
const M=JSON.parse(fs.readFileSync(O+'/manifest.json','utf8'));
const req=createRequire(M.sourceRoots.manager+'/package.json');
const ts=req('typescript'), trpc=req('@trpc/server'), drizzle=req('drizzle-orm'), mysql=req('drizzle-orm/mysql-core'), zod=req('zod');
const H=s=>createHash('sha256').update(s).digest('hex'), read=p=>fs.readFileSync(p,'utf8');
const assert=(v,m)=>{if(!v)throw Error(m);}, results=[];
async function test(name,run){try{await run();results.push({name,passed:true});console.log('PASS '+name);}catch(e){results.push({name,passed:false,error:e.message});console.error('FAIL '+name+': '+e.stack);}}
const allowed={'zod':zod,'@trpc/server':trpc,'drizzle-orm':drizzle,'drizzle-orm/mysql-core':mysql,'node:crypto':req('node:crypto'),'crypto':req('node:crypto')};
async function loadRuntime(file){
  const modules=new Map(),context=vm.createContext({console,Buffer,URL,TextEncoder,TextDecoder,AbortController,setTimeout,clearTimeout,process:{env:{JWT_SECRET:'offline-unread-native-only'}},fetch:()=>{throw Error('NETWORK_FORBIDDEN');},Date,Map,Set,Array,Object,JSON,Number,String,RegExp,Promise,Error});
  async function get(f){if(modules.has(f))return modules.get(f);const mod=new vm.SourceTextModule(read(f),{context,identifier:f});modules.set(f,mod);await mod.link(async spec=>{
    if(spec.startsWith('.'))return get(path.resolve(path.dirname(f),spec));
    assert(allowed[spec],'unsafe native external '+spec);const key='external:'+spec;if(modules.has(key))return modules.get(key);
    const exports=Object.keys(allowed[spec]);if(!exports.includes('default'))exports.push('default');const synthetic=new vm.SyntheticModule(exports,function(){for(const k of exports)this.setExport(k,k==='default'?(allowed[spec].default??allowed[spec]):allowed[spec][k]);},{context});modules.set(key,synthetic);return synthetic;
  });return mod;}
  const mod=await get(file);await mod.evaluate({timeout:5000});return mod.namespace;
}
function candidateABI(file,names,injected={}){
  const text=read(file),ast=ts.createSourceFile(file,text,99,true,1),defs=new Map(),imports=new Map();assert(!ast.parseDiagnostics.length,'candidate syntax');
  for(const n of ast.statements){
    if(ts.isImportDeclaration(n)){const pkg=n.moduleSpecifier.text,cl=n.importClause;if(cl?.name)imports.set(cl.name.text,{pkg,key:'default'});if(cl?.namedBindings&&ts.isNamedImports(cl.namedBindings))for(const i of cl.namedBindings.elements)imports.set(i.name.text,{pkg,key:i.propertyName?.text??i.name.text});if(cl?.namedBindings&&ts.isNamespaceImport(cl.namedBindings))imports.set(cl.namedBindings.name.text,{pkg,key:'*'});}
    if((ts.isFunctionDeclaration(n)||ts.isClassDeclaration(n))&&n.name)defs.set(n.name.text,{node:n,code:n.getText(ast),offset:n.getStart(ast)});
    if(ts.isVariableStatement(n))for(const d of n.declarationList.declarations)if(ts.isIdentifier(d.name)&&d.initializer)defs.set(d.name.text,{node:d,code:'var '+d.getText(ast)+';',offset:d.getStart(ast)});
  }
  const context={console,Buffer,URL,TextEncoder,TextDecoder,process:{env:{}},fetch:()=>{throw Error('NETWORK_FORBIDDEN');},...injected},selected=new Map();
  function add(name){if(Object.hasOwn(context,name)||selected.has(name))return;if(imports.has(name)){const {pkg,key}=imports.get(name);assert(allowed[pkg],'unsafe selected import '+pkg);context[name]=key==='*'?allowed[pkg]:key==='default'?(allowed[pkg].default??allowed[pkg]):allowed[pkg][key];return;}
    const def=defs.get(name);if(!def)return;assert(!/^(init_|start|main$|getDb$)/.test(name),'unsafe initializer '+name);selected.set(name,def);const locals=new Set();
    function binding(n){if(ts.isIdentifier(n))locals.add(n.text);else if(ts.isObjectBindingPattern(n)||ts.isArrayBindingPattern(n))for(const e of n.elements)if(e.name)binding(e.name);}
    function collect(n){if(ts.isParameter(n)||ts.isVariableDeclaration(n)&&n!==def.node)binding(n.name);ts.forEachChild(n,collect);}collect(def.node);
    function visit(n){if(ts.isIdentifier(n)){const p=n.parent,prop=ts.isPropertyAccessExpression(p)&&p.name===n||(ts.isPropertyAssignment(p)||ts.isMethodDeclaration(p)||ts.isPropertyDeclaration(p))&&p.name===n;const declaration=(ts.isVariableDeclaration(p)||ts.isParameter(p)||ts.isFunctionDeclaration(p)||ts.isClassDeclaration(p))&&p.name===n;if(!prop&&!declaration&&!locals.has(n.text))add(n.text);}ts.forEachChild(n,visit);}visit(def.node);
  }
  names.forEach(add);const ordered=[...selected.entries()].sort((a,b)=>a[1].offset-b[1].offset);const code=ordered.map(([,d])=>d.code).join('\n')+'\n({'+names.join(',')+'})';
  return new vm.Script(code,{filename:file+':only-selected-ABI'}).runInNewContext(context,{timeout:3000});
}
const mod=await loadRuntime(M.runtimes[0].local),t=trpc.initTRPC.context().create();
const native=Object.fromEntries(M.dependencies.admin.map(k=>[k,()=>{throw Error('REAL_NATIVE_OPERATION_FORBIDDEN '+k);} ]));
Object.assign(native,{router:t.router,adminProcedure:t.procedure,adminStaffArchives:drizzle.sql.raw('admin_staff_archives'),materials:drizzle.sql.raw('materials'),officialChannelTeams:drizzle.sql.raw('official_channel_teams')});
const admin=mod.createNativeNewInformationRuntime(native), viewer={adminUserId:7,sessionVersion:3};
const scope={identity:'admin:7:test-full-scope',version:'authorization:v1',actorKey:'admin:7'};
const event=(id,version='v1',extra={})=>({id,version,occurredAt:'2026-11-17T01:00:00.000Z',historical:false,...extra});
function fixture(){
  const states=new Map();const store={withModule(v,m,run){return this.withModules(v,[m],s=>run(s.get(m)));},async withModules(v,ms,run){const working=new Map(ms.map(m=>{const old=states.get(m);return [m,{initialized:old?.initialized??false,seen:new Set(old?.seen??[]),lastSummary:{...(old?.lastSummary??{count:0,available:true})}}];}));const result=await run(working);for(const [m,s]of working)states.set(m,s);return result;}};
  const rows=new Map(),calls=[];let failModule;
  const source={list:async i=>{if(i.module===failModule)throw Error('OFFLINE_SOURCE_FAILED');return {available:true,scope,items:rows.get(i.module)??[],snapshot:'stable-full'};},lookup:async i=>{calls.push(i);return {available:true,scope,items:(rows.get(i.module)??[]).filter(row=>i.refs.includes(row.id)&&(i.scope===undefined||row.id!=='foreign'))};}};
  const service=admin.createAdminNewInformationService({source,store,secret:'offline-native-only',now:()=>Date.parse('2026-11-17T01:00:01.000Z'),withViewerFence:async(v,run)=>run()});
  return {service,states,rows,calls,fail:m=>{failModule=m;}};
}
await test('all hashes/source pins and exact API/runtime inverse/outside hunks; facts contract retained',async()=>{
  for(const [p,h]of Object.entries(M.sourcePins))assert(H(fs.readFileSync(p))===h,'source drift '+p);
  for(const r of M.runtimes)assert(H(fs.readFileSync(r.local))===r.sha256,'runtime hash');
  for(const role of ['admin','front','runtime']){const d=JSON.parse(read(O+'/'+role+'-delta.json'));const f=role==='runtime'?M.runtimes[0].local:M.api[role].local;let s=read(f);for(const p of [...d.patches].reverse()){assert(s.slice(p.afterStart,p.afterEnd)===p.after,'inverse preimage '+role);s=s.slice(0,p.afterStart)+p.before+s.slice(p.afterEnd);}const original=role==='runtime'?D+'/capture/new-information-admin.runtime.mjs':D+'/capture/'+role+'-api.js';assert(s===read(original),'inverse bytes '+role);}
});
await test('native original factory exposes unreadRefs query and retains local-admin entry rejects',async()=>{
  assert(Object.keys(admin.newInformation._def.procedures).sort().join(',')==='inspect,markDisplayed,summary,unreadRefs','route ABI');
  assert(admin.newInformation._def.procedures.unreadRefs._def.type==='query','read only query');
  for(const ctx of [{},{user:{id:7,role:'admin',openId:'oauth:7'},adminAccount:{id:7,status:'active',sessionVersion:3}}]){let rejected=false;try{await admin.newInformation.createCaller(ctx).unreadRefs({module:'customers'});}catch(e){rejected=e.code==='UNAUTHORIZED';}assert(rejected,'local entry rejects');}
});
await test('default core fence uses the captured native withBusinessAuthorizationFence ABI without DB',async()=>{
  const calls=[];
  const bridged=mod.createNativeNewInformationRuntime({...native,withBusinessAuthorizationFence:async(key,run)=>{calls.push(key);return run();}});
  const state={initialized:true,seen:new Set(),lastSummary:{count:0,available:true}};
  const store={withModule:async(v,m,run)=>run(state)};
  const source={list:async()=>({available:true,scope,items:[],snapshot:'whole-source'}),lookup:async()=>{throw Error('not needed');}};
  const service=bridged.createAdminNewInformationService({source,store,secret:'offline-native-fence'});
  const result=await service.unreadRefs(viewer,{module:'customers'});
  assert(result.available&&result.refs.length===0&&calls.length===1&&calls[0].adminUserId===7,'default captured native fence called');
});
await test('compiled native core complete refs, merchant batches <=100, exact versions and no seen writes',async()=>{
  const f=fixture();f.rows.set('customers',[...Array.from({length:205},(_,i)=>event('customer:'+i)),event('foreign'),event('self','v1',{actorKey:'admin:7'})]);
  const all=await f.service.unreadRefs(viewer,{module:'customers'});assert(all.refs.length===206,'full source refs');
  const selected=await f.service.unreadRefs(viewer,{module:'customers',scope:'17'});assert(selected.refs.length===205,'scoped full intersection');
  assert(f.calls.length===3&&f.calls.every(c=>c.refs.length<=100&&c.scope==='17'),'bounded lookup');assert(f.states.get('customers').seen.size===0&&!f.states.get('customers').initialized,'query cannot mark/initialize');
  f.rows.set('customers',Array.from({length:2001},(_,i)=>event('c:'+i)));let rejected=false;try{await f.service.unreadRefs(viewer,{module:'customers'});}catch(e){rejected=e.code==='SERVICE_UNAVAILABLE';}assert(rejected,'overflow unavailable');
});
await test('compiled native receipt v2 count key dedup and accepted duplicates retained with authoritative lastSummary',async()=>{
  const f=fixture();f.rows.set('reception',[event('i:1','created:1',{countKey:'conversation:1'}),event('i:1','message:2',{countKey:'conversation:1'}),event('i:2','v1',{countKey:'conversation:1'})]);
  await f.service.summary(viewer);const row=(await f.service.inspect(viewer,{module:'reception',refs:['i:1']})).items[0];
  assert(JSON.parse(Buffer.from(row.receipt.split('.')[0],'base64url')).v===2,'compound v2');
  const result=await f.service.markDisplayed(viewer,{receipts:[row.receipt,row.receipt]});assert(result.marked===2&&result.accepted===2,'shape accepted');assert(f.states.get('reception').lastSummary.count===1,'not physical subtraction');
});
await test('compiled native fresh scan failure rolls back all modules and retries without losing later versions',async()=>{
  const f=fixture();f.rows.set('customers',[event('c:1')]);f.rows.set('sales',[event('s:1')]);await f.service.summary(viewer);
  const c=(await f.service.inspect(viewer,{module:'customers',refs:['c:1']})).items[0].receipt,s=(await f.service.inspect(viewer,{module:'sales',refs:['s:1']})).items[0].receipt;
  const before=f.states.get('customers');f.fail('sales');let rejected=false;try{await f.service.markDisplayed(viewer,{receipts:[c,s]});}catch(e){rejected=e.code==='SERVICE_UNAVAILABLE';}
  assert(rejected&&f.states.get('customers')===before&&before.seen.size===0,'atomic failure');f.fail(undefined);f.rows.set('sales',[event('s:1'),event('s:1','later:2')]);
  const result=await f.service.markDisplayed(viewer,{receipts:[c,s]});assert(result.marked===2&&f.states.get('sales').lastSummary.count===1&&f.states.get('customers').lastSummary.count===0,'retry and later unread');
});
await test('actual admin/front customer schemas inherit identical strict optional <=2000 IDs contract',async()=>{
  for(const role of ['admin','front']){const {customerListInputSchema:schema}=candidateABI(M.api[role].local,['customerListInputSchema']);assert(schema.parse({}).customerIds===undefined,'omission');assert(schema.parse({customerIds:[]}).customerIds.length===0,'empty');assert(schema.parse({customerIds:Array.from({length:2000},(_,i)=>i+1)}).customerIds.length===2000,'2000');for(const ids of [[0],[-1],[1.5],['1'],Array(2001).fill(1)])assert(!schema.safeParse({customerIds:ids}).success,'strict IDs');}
});
await test('actual native front list IDs share COUNT/page WHERE, paginate intersection and [] authorizes then returns real empty',async()=>{
  const dialect=new mysql.MySqlDialect();let authorized=true;const statements=[];const data=Array.from({length:65},(_,i)=>({id:i+1,enterpriseId:1,assignedUserId:10,createdByUserId:10,name:'needle-'+(i+1),archivedAt:null,createdAt:'2026-11-01',updatedAt:'2026-11-15',version:1}));
  const executor={async execute(sql){const q=dialect.sqlToQuery(sql);statements.push(q);const clause=/c\.id IN \(([^)]+)\)/.exec(q.sql);const before=clause?(q.sql.slice(0,q.sql.indexOf(clause[0])).match(/\?/g)??[]).length:0;const ids=clause?q.params.slice(before,before+(clause[1].match(/\?/g)??[]).length):undefined;const rows=data.filter(r=>!q.sql.includes('AND FALSE')&&(ids===undefined||ids.includes(r.id))).sort((a,b)=>b.id-a.id);if(q.sql.includes('COUNT(*)'))return [[{total:rows.length}],[]];const [limit,offset]=q.params.slice(-2);return [rows.slice(offset,offset+limit),[]];}};
  const access={actorPolicy:{read:true,scope:'enterprise'},targetPolicy:{read:true,scope:'enterprise'}};
  const selected=candidateABI(M.api.front.local,['listCustomers','customerListInputSchema'],{crmCustomerPolicyWhere:()=>drizzle.sql`c.enterpriseId = ${1}`,withCustomerStarAccess:async(v,id,run)=>{if(!authorized)throw new trpc.TRPCError({code:'FORBIDDEN'});return run(executor,access);},withCustomerAssigneeStarAccess:async()=>{throw Error('not selected mode');},customerSelect:()=>drizzle.sql`SELECT c.id, c.enterpriseId FROM crm_customers c`,mapCustomer:r=>r});
  const scope={enterpriseId:1,actorUserId:10,canManageAll:false},ids=Array.from({length:31},(_,i)=>i+10),pages=[];
  for(const page of [1,2,3])pages.push(await selected.listCustomers(scope,selected.customerListInputSchema.parse({scope:'all',customerIds:ids,page})));
  assert(pages.map(p=>p.total+':'+p.items.length).join(',')==='31:20,31:11,31:0','full count/page intersection');
  const [count,page]=statements;assert(count.sql.slice(count.sql.indexOf('WHERE'))===page.sql.slice(page.sql.indexOf('WHERE'),page.sql.indexOf('ORDER BY')).trimEnd()+'\n  ','same exact WHERE');
  const empty=await selected.listCustomers(scope,selected.customerListInputSchema.parse({customerIds:[],page:3}));assert(empty.total===0&&empty.items.length===0,'real empty');
  authorized=false;let rejected=false;const before=statements.length;try{await selected.listCustomers(scope,selected.customerListInputSchema.parse({customerIds:[]}));}catch(e){rejected=e.code==='FORBIDDEN';}assert(rejected&&statements.length===before,'empty IDs cannot bypass auth');
});
const report={scope:'isolated actual compiled runtime and selected native API slots',passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,tests:results,noApiStartup:true,noRealDb:true,noNetwork:true};
fs.writeFileSync(O+'/abi-results.json',JSON.stringify(report,null,2)+'\n');M.abiTests={passed:report.passed,failed:report.failed,resultsSha256:H(read(O+'/abi-results.json'))};M.checks.selectedNativeABITests=report.failed===0;fs.writeFileSync(O+'/manifest.json',JSON.stringify(M,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,failed:report.failed}));if(report.failed)process.exitCode=1;
