'use strict';
const vm=require('node:vm');
const {MySqlDialect}=require('drizzle-orm/mysql-core');
const {TRPCError}=require('@trpc/server');
const C=require('./core.cjs');
const {ts,assert,sha,walk,refs,uniqueNode,property}=C;
const dialect=new MySqlDialect();
const json=x=>JSON.stringify(x);
function nativeVM(p,roots,overrides={}){
 const required=new Map(),external=new Map();
 function add(d){if(required.has(d.name)||Object.hasOwn(overrides,d.name))return;if(d.import){external.set(d.name,d);return;}required.set(d.name,d);let n=d.node;if(ts.isVariableDeclaration(n)&&!n.initializer){n=uniqueNode(p.sf,q=>ts.isBinaryExpression(q)&&q.operatorToken.kind===ts.SyntaxKind.EqualsToken&&ts.isIdentifier(q.left)&&p.symbolAt(q.left)===d.symbol,'native-init '+d.name);d={...d,assignment:n};required.set(d.name,d);}for(const r of refs(p,n))if(r.name!==d.name)add(r);}
 for(const root of roots)add(p.byName(root));
 const sandbox={...overrides,console:{log(){},error(){},warn(){}},Buffer,URL,TextEncoder,TextDecoder,process:{env:Object.freeze({})}};
 for(const [name,d] of external){assert(['drizzle-orm','drizzle-orm/mysql-core','zod','@trpc/server','node:crypto','crypto','node:async_hooks'].includes(d.import),'UNSAFE_VM_IMPORT '+d.import);const mod=require(d.import);sandbox[name]=d.exported==='*'?mod:d.exported==='default'?(mod.default||mod):mod[d.exported];assert(sandbox[name]!==undefined,'VM_EXTERNAL_EXPORT '+name);}
 const declarations=[...required.values()].sort((a,b)=>a.node.getStart(p.sf)-b.node.getStart(p.sf));
 const code=declarations.map(d=>ts.isVariableDeclaration(d.node)?'var '+(d.assignment?d.node.name.text+' = '+d.assignment.right.getText(p.sf):d.node.getText(p.sf))+';':d.node.getText(p.sf)).join('\n');
 const ctx=vm.createContext(sandbox,{codeGeneration:{strings:false,wasm:false}});
 vm.runInContext(code,ctx,{timeout:5000});
 return {ctx,sandbox,required:[...required.keys()],nativeDeclarations:declarations.map(d=>({name:d.name,module:d.module,sha256:sha(d.node.getText(p.sf))})),invoke:async(name,...args)=>{sandbox.__fn=name;sandbox.__args=args;return await vm.runInContext('globalThis[__fn](...__args)',ctx,{timeout:5000});}};
}
const baseScope={enterpriseId:101,dataOwnerUserId:501,actorUserId:701,isOwner:false,inventoryDataScope:'own',permissionSnapshot:true};
const officialScope=()=>({...baseScope,officialActor:{adminAccountId:901,bindingVersion:3,requestId:'synthetic_customer_inventory_20261114',inventoryPermissions:{read:true,write:false,note:true,publish:false,customerScopeRead:true,channelProfileTeamRead:{enterpriseId:101,teamId:801,actorUserId:701,ownerUserIds:[701],read:true,teamRole:'leader',businessTeamLeaderRead:false}}}});
function transport(state={}){
 const queries=[],events=[];let txOpen=false;
 const material=(id,channel)=>({id,uploadBatchId:null,partNumber:'SYNTHETIC-MODEL',brand:'SYNTHETIC',qty:10,dateCode:'24+',price:'1.00',currency:'CNY',taxIncluded:true,leadTime:null,revision:1,industryCode:null,companyChannelId:channel,noteCount:0,updatedAt:'2026-11-14',createdAt:'2026-11-14',isMine:true,canViewSource:state.noSource?0:1,recorderAdminAccountId:null});
 const execute=async query=>{
  assert(txOpen,'SQL_OUTSIDE_SYNTHETIC_TX');const q=dialect.sqlToQuery(query.getSQL?query.getSQL():query);const text=q.sql,values=q.params;queries.push({text,values});assert(!/\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP|TRUNCATE)\b/i.test(text.replace(/FOR UPDATE/g,'')),'NON_READ_SQL');
  let rows;
  if(text.includes('FROM enterprises')&&text.includes('SELECT id, superAdminUserId'))rows=state.crossTenant?[]:[{id:101,superAdminUserId:501,crmDataOwnerUserId:501}];
  else if(text.includes('FROM enterprise_members em INNER JOIN users'))rows=[{id:601,userId:701,status:'active',role:'member',loginDisabled:0}];
  else if(text.includes('SELECT permissionKey FROM enterprise_member_permissions'))rows=[{permissionKey:'inventory.manage'},...(!state.noCrm?[{permissionKey:'customers.manage'}]:[])];
  else if(text.includes('SELECT teamId, teamRole FROM enterprise_team_members'))rows=[{teamId:801,teamRole:state.member?'member':'leader'}];
  else if(text.includes('SELECT id, status FROM enterprise_teams'))rows=[{id:801,status:'active'}];
  else if(text.includes('FROM enterprise_member_module_access'))rows=[{readAllowed:state.noInventory&&values.includes('stocks')?0:1,writeAllowed:1,dataScope:state.member?'self':'team',revision:1}];
  else if(text.includes('SELECT tm.id, tm.teamId, tm.teamRole'))rows=[{id:811,teamId:801,teamRole:state.member?'member':'leader'}];
  else if(text.includes('SELECT DISTINCT m.responsible_user_id AS ownerUserId'))rows=[];
  else if(text.includes('SELECT c.id FROM crm_customers c')){events.push('crm-authorized');rows=state.missingCustomer?[]:[{id:301}];}
  else if(text.includes('AS bindingCount')){events.push('binding-count');rows=[{bindingCount:state.zero?0:2}];}
  else if(text.includes('SELECT COUNT(*) AS total')){events.push('stock-count');rows=[{total:state.zero?0:2}];}
  else if(text.includes('m.part_number AS partNumber')&&text.includes('ORDER BY')){events.push('stock-page');rows=state.zero?[]:[material(1001,1101),material(1002,1102)];}
  else if(text.includes('SELECT customerId FROM crm_customer_supply_channels'))rows=[{customerId:state.wrongCompany?302:301}];
  else if(text.includes('SELECT supply_customer.id, supply_customer.name'))rows=state.companyDenied?[]:[{id:state.wrongCompany?302:301,name:'Synthetic Authorized Company',industryCode:null,version:1,archivedAt:null}];
  else if(text.includes('SELECT primaryContactId, legacyContactPresent'))rows=[];
  else if(text.includes('SELECT contactName, phone FROM crm_customer_contacts'))rows=[];
  else if(text.includes('AS published')||text.includes(' AS canPublish'))rows=[];
  else if(text.includes('SELECT m.id')&&text.includes('LIMIT 1'))rows=state.channelDenied?[]:[{id:1001}];
  else throw new Error('UNHANDLED_SYNTHETIC_SQL '+text.slice(0,240));
  return [rows,[]];
 };
 const db={execute,rollback(){throw new Error('synthetic rollback marker');},transaction:async fn=>{assert(!txOpen,'NESTED_TX');txOpen=true;events.push('tx-start');try{return await fn(db);}finally{events.push('tx-end');txOpen=false;}}};
 return {db,queries,events};
}
async function runChecks(build){
 const checks=[],log=[];let count=0;
 const check=(name,details)=>{count++;checks.push({name,passed:true,...details});log.push('PASS '+name);};
 const front=build.results.front.candidate,admin=build.results.admin.candidate;
 const frontProp=property(front,'createChannelInventoryRouter','listTeamMaterials');
 const schema=uniqueNode(frontProp,n=>ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='input','front schema').arguments[0];
 const schemaRefs=refs(front,schema).map(d=>d.name),schemaContext=nativeVM(front,schemaRefs);
 const frontSchema=vm.runInContext(schema.getText(front.sf),schemaContext.ctx,{timeout:1000});
 const adminContext=nativeVM(admin,['channelInventoryListBusinessInputSchema']);
 const adminSchema=adminContext.sandbox.channelInventoryListBusinessInputSchema;
 for(const [label,s] of [['front',frontSchema],['BFF',adminSchema]]){
  assert(s.safeParse({customerId:301}).success&&s.safeParse({}).success,'VALID_LIST_SCHEMA '+label);
  for(const value of [null,'301',0,-1,1.5,Number.MAX_SAFE_INTEGER+1])assert(!s.safeParse({customerId:value}).success,'INVALID_CUSTOMER_ACCEPTED '+label);
  for(const field of ['enterpriseId','actorUserId','dataOwnerUserId','customerScopeRead','officialActor','inventoryPermissions','channelProfileTeamRead','canViewSource','bindingCount'])assert(!s.safeParse({customerId:301,[field]:true}).success,'AUTHORITY_FIELD_ACCEPTED '+label+' '+field);
  check(label+' actual candidate strict customerId and authority-field rejection',{cases:17,legacyGlobalInputAccepted:true});
 }
 async function list(p,state={},input={},scope=officialScope()){
  const t=transport(state),v=nativeVM(p,['createChannelTeamInventoryService'],{getDb:async()=>t.db});
  const service=await v.invoke('createChannelTeamInventoryService',{getDb:async()=>t.db});
  let result,error;try{result=await service.listTeamMaterials(scope,{page:1,pageSize:20,...input});}catch(e){error=e;}
  return {result,error,...t,native:v.nativeDeclarations,closure:v.required};
 }
 const exact=await list(front,{}, {customerId:301});assert(!exact.error,'CUSTOMER_NATIVE_SQL '+exact.error?.stack);assert(exact.result.customerId===301&&exact.result.bindingCount===2&&exact.result.items.length===2,'CUSTOMER_RESULT_PROOF');
 const filtered=exact.queries.filter(q=>q.text.includes('customer_inventory_link'));
 assert(filtered.some(q=>q.text.includes('AS bindingCount'))&&filtered.some(q=>q.text.includes('COUNT(*) AS total'))&&filtered.some(q=>q.text.includes('ORDER BY')),'BINDING_IN_ALL_QUERIES');
 for(const q of filtered){assert(q.text.includes('customer_inventory_link.channelId = m.channel_id')&&q.text.includes('customer_inventory_link.enterpriseId = c.enterprise_id')&&q.text.includes('customer_inventory_link.dataOwnerUserId = c.data_owner_user_id'),'FULL_LINK_CORRELATION');assert(q.values.includes(101)&&q.values.includes(501)&&q.values.includes(301),'BOUND_CUSTOMER_TENANT_OWNER');assert(!q.text.includes('Synthetic Authorized Company'),'NO_NAME_MATCH');}
 assert(exact.events.indexOf('crm-authorized')<exact.events.indexOf('binding-count'),'AUTH_BEFORE_STOCK');assert(exact.result.items.every(i=>i.company.id===301&&i.company.name==='Synthetic Authorized Company'&&i.canViewSource===true),'AUTHORIZED_COMPANY_PROJECTION');
 check('actual candidate native SQL exact confirmed multi-channel binding, count/page and company projection',{bindingCount:2,queryCount:exact.queries.length,nativeDeclarations:exact.native.length,onlySyntheticSQLTransport:true});
 for(const [state,code] of [[{noCrm:true},'FORBIDDEN'],[{missingCustomer:true},'NOT_FOUND'],[{noInventory:true},'FORBIDDEN'],[{companyDenied:true},'FORBIDDEN'],[{wrongCompany:true},'FORBIDDEN'],[{noSource:true},'FORBIDDEN']]){const r=await list(front,state,{customerId:301});assert(r.error?.code===code,'FAIL_CLOSED '+json(state)+' '+r.error?.stack);if(state.noCrm||state.missingCustomer||state.noInventory)assert(!r.events.includes('stock-page'),'STOCK_BEFORE_AUTH');check('native customer fail closed '+json(state),{code});}
 const signed=officialScope();signed.officialActor.inventoryPermissions.customerScopeRead=false;const noSigned=await list(front,{}, {customerId:301},signed);assert(noSigned.error?.code==='FORBIDDEN'&&!noSigned.events.includes('stock-page'),'SIGNED_CUSTOMER_SCOPE');check('actual native signed customer scope required',{});
 const zero=await list(front,{zero:true},{customerId:301});assert(!zero.error&&zero.result.bindingCount===0&&zero.result.items.length===0,'ZERO_BINDING');check('authorized zero binding returns real empty proof',{});
 const globalOld=await list(build.baselines.front,{},{}),globalNew=await list(front,{},{});assert(!globalOld.error&&!globalNew.error,'GLOBAL_ERROR '+globalOld.error?.stack+' '+globalNew.error?.stack);assert(json(globalOld.queries)===json(globalNew.queries),'GLOBAL_SQL_CHANGED');
 const scrub=x=>({...x,items:x.items.map(({company,...v})=>v)});assert(json(scrub(globalOld.result))===json(scrub(globalNew.result)),'GLOBAL_RESULT_CHANGED');assert(globalNew.result.customerId===undefined&&globalNew.result.bindingCount===undefined,'GLOBAL_CUSTOMER_PROOF_LEAK');check('old global scope SQL and existing DTO semantics retained',{sameSQL:true,sameExistingFields:true,additiveCompanyProjection:globalNew.result.items.some(i=>'company'in i)});
 assert(globalNew.result.items.every(item=>item.company?.id===301&&item.company?.name==='Synthetic Authorized Company'),'GLOBAL_AUTHORIZED_COMPANY_MISSING');
 for(const state of [{noSource:true},{noCrm:true}]){const old=await list(build.baselines.front,state,{}),fresh=await list(front,state,{});assert(!old.error&&!fresh.error,'GLOBAL_DENIED_COMPANY_ERROR');assert(json(old.queries)===json(fresh.queries)&&json(scrub(old.result))===json(scrub(fresh.result)),'GLOBAL_DENIED_SCOPE_CHANGED');assert(fresh.result.items.length===old.result.items.length&&fresh.result.items.every(item=>item.company===null),'GLOBAL_PRIVATE_COMPANY_LEAK');}
 check('global company field is additive and null without current source or CRM permission',{unauthorizedRowsRetained:true,noPrivateSourceNameFallback:true});
 return {checks,log,caseGroups:count,nativeClosure:exact.native,sqlEvidence:exact.queries,realDatabaseUsed:false,onlySyntheticFixtures:true};
}
module.exports={nativeVM,transport,runChecks,officialScope};

async function bffAndBootChecks(build){
 const checks=[],log=[];const check=(name,detail={})=>{checks.push({name,passed:true,...detail});log.push('PASS '+name);};
 const admin=build.results.admin.candidate,front=build.results.front.candidate;
 const adminRefs=[...refs(admin,admin.byName('withCurrentBusinessAuthorization').node),...refs(admin,admin.byName('forwardBusinessMethod').node)];
 const nativeName=(name)=>{const a=[...new Set(adminRefs.filter(d=>d.name===name||d.name.endsWith('_'+name)).map(d=>d.name))];assert(a.length===1,'BFF_OVERRIDE_BINDING '+name);return a[0];};
 function bff(state={}){
  const events=[],commands=[],merchantChecks=[];
  const scope={scopeVersion:9,modulePermissions:['business.inventory.read','business.orders.read',...(!state.noCustomers?['business.customers.read']:[]),...(!state.noInventoryWrite?['business.inventory.write']:[])]};if(state.noInventory)scope.modulePermissions=scope.modulePermissions.filter(x=>x!=='business.inventory.read');
  const db={withBusinessAuthorizationFence:async(_input,fn)=>{events.push('fence-start');try{return await fn();}finally{events.push('fence-end');}},getActiveBusinessMerchantScope:async()=>scope,recordBusinessCommandAccess:async input=>{events.push('audit:'+input.method);}};
  const overrides={};
  overrides[nativeName('namespace_db')]=db;
  overrides[nativeName('requireBusinessAdminAccount')]=()=>({id:901});
  overrides[nativeName('requireCurrentBusinessStaffBinding')]=async()=>({frontUserId:701,bindingVersion:3});
  overrides[nativeName('currentOfficialInventoryPermissions')]=async()=>({read:!state.noOfficial,write:true,publish:true,note:true,customerScopeRead:true});
  overrides[nativeName('withOfficialChannelProfileRead')]=async(_ctx,_user,fn)=>fn({ownerUserIds:[701],teamId:801});
  overrides[nativeName('assertBusinessMerchantAccess')]=async(_ctx,_merchant,module,mode,projection)=>{merchantChecks.push({module,mode,officialReadProjection:projection});return {id:201,enterpriseId:101};};
  overrides[nativeName('businessMerchantIdFromContext')]=()=>201;
  overrides[nativeName('businessEnterpriseBindingFromMerchant')]=m=>({enterpriseId:m.enterpriseId,merchantId:m.id});
  overrides[nativeName('businessAuditActor')]=()=>({operatorId:901,operatorName:'Synthetic Admin',operatorRole:'admin'});
  overrides[nativeName('callPlatformBusinessCommand')]=async input=>{commands.push(input);events.push('upstream');return Object.hasOwn(state,'result')?state.result:{customerId:301,bindingCount:2,items:[{id:1001,canViewSource:true,company:{id:301,name:'Synthetic Authorized Company'},recorderAdminAccountId:null}],total:1,page:1,pageSize:20,pageCount:1};};
  overrides[nativeName('officialRecorderNames')]=async()=>new Map();
  overrides[nativeName('previewFactoryMaterialReceptionResultSchema')]={safeParse:x=>({success:true,data:x})};
  overrides[nativeName('__D51_TEST_ORDER_ARCHIVE')]={applyBusinessTestOrderArchives:async x=>{events.push('archive');return x;}};
  const v=nativeVM(admin,['withCurrentBusinessAuthorization','forwardBusinessMethod'],overrides);
  return {v,events,commands,merchantChecks};
 }
 async function invoke(state,input={customerId:301,page:1,pageSize:20},method='channelInventory.listTeamMaterials'){
  const b=bff(state);let result,error;try{result=await b.v.invoke('forwardBusinessMethod',{user:{id:901}},input,{method,module:method.startsWith('order.')?'orders':'inventory',mode:'read'});}catch(e){error=e;}return {...b,result,error};
 }
 const good=await invoke({});assert(!good.error,'BFF_CUSTOMER '+good.error?.stack);assert(good.merchantChecks[0].officialReadProjection===false,'CUSTOMER_NATIVE_BYPASS');assert(good.commands[0].officialInventoryPermissions.customerScopeRead===true&&good.commands[0].staffUserId===701&&good.commands[0].bindingVersion===3,'SIGNED_SCOPE_PROJECTION');assert(good.events[0]==='fence-start'&&good.events.at(-1)==='fence-end'&&good.events.includes('audit:channelInventory.listTeamMaterials'),'FENCE_AUDIT_PRESERVATION');check('actual BFF customer inventory scope intersection and bound signed command projection',{actualCandidateDeclarations:true,currentIdentityBoundarySynthetic:true,signedPayloadFieldPropagated:true});
 for(const state of [{noCustomers:true},{noInventory:true},{noOfficial:true}]){const r=await invoke(state);assert(r.error?.code==='FORBIDDEN'&&!r.commands.length,'BFF_FAIL_CLOSED '+json(state)+' '+r.error?.stack);check('actual BFF fresh scope fail closed '+json(state));}
 const global=await invoke({noCustomers:true,result:{items:[{id:1001,canViewSource:false,company:null}],total:1}},{});assert(!global.error&&global.commands.length===1&&global.merchantChecks[0].officialReadProjection===true&&global.commands[0].officialInventoryPermissions.customerScopeRead===false,'BFF_GLOBAL_NATIVE_SCOPE');check('global native official inventory read remains available without CRM scope');
 for(const result of [{customerId:302,bindingCount:2,items:[]},{customerId:301,bindingCount:-1,items:[]},{customerId:301,bindingCount:0,items:[{canViewSource:true}]},{customerId:301,bindingCount:1,items:[{canViewSource:false}]},{customerId:301,bindingCount:1,items:[{canViewSource:true,company:{id:302}}]}]){const r=await invoke({result});assert(r.error?.code==='INTERNAL_SERVER_ERROR','BFF_SCOPE_PROOF_ACCEPTED');}check('actual BFF rejects wrong, missing-source or inconsistent customer result proof',{cases:5});
 const archive=await invoke({result:{items:[]}}, {},'order.sellerOrders');assert(!archive.error&&archive.events.includes('archive')&&archive.events.includes('audit:order.sellerOrders'),'ARCHIVE_REGRESSION');check('original order archive and command audit branch remains executed');
 // Real tRPC construction, native inventory router and native target service. No database is opened.
 const trpc=require('@trpc/server').initTRPC.create();let dbCalls=0,unrelatedConstructions=0;
 const overrides={getDb:async()=>{dbCalls++;throw new Error('BOOT_MUST_NOT_OPEN_DB');},protectedProcedure:trpc.procedure,router:trpc.router};
 const nativeFactories=['createChannelInventoryService','createChannelNotesService','createChannelInventoryExportService','createChannelInventoryCollaborationService','createChannelInventorySourceService','createChannelInventoryManagementService','createCustomerSupplyService','createChannelFactoryPublicationService'];
 for(const name of nativeFactories)overrides[name]=()=>{unrelatedConstructions++;return new Proxy({}, {get:()=>()=>{throw new Error('UNRELATED_ROUTE_MUST_NOT_EXECUTE');}});};
 const routerCall=uniqueNode(front.sf,n=>ts.isCallExpression(n)&&n.expression.getText(front.sf)==='createChannelInventoryRouter','actual-original-router-call');
 const teamArgument=routerCall.arguments[0];assert(ts.isPropertyAccessExpression(teamArgument)&&teamArgument.name.text==='registerInsertedRecord','NATIVE_REGISTER_TEAM_ARGUMENT');
 overrides[teamArgument.expression.getText(front.sf)]={registerInsertedRecord:()=>{throw new Error('READ_BOOT_MUST_NOT_REGISTER_RECORD');}};
 const routerVariable=routerCall.parent;assert(ts.isVariableDeclaration(routerVariable),'ORIGINAL_ROUTER_INIT_VARIABLE');
 const boot=nativeVM(front,[routerVariable.name.text],overrides);
 const constructed=boot.sandbox[routerVariable.name.text];assert(constructed?._def?.procedures?.listTeamMaterials,'NATIVE_ROUTER_CONSTRUCTION');const actualSchema=constructed._def.procedures.listTeamMaterials._def.inputs[0];assert(actualSchema.safeParse({customerId:301}).success&&!actualSchema.safeParse({customerId:'301'}).success,'BOOT_ACTUAL_SCHEMA');assert(dbCalls===0&&unrelatedConstructions===8,'BOOT_FACTORY_INVOCATIONS');
 const helper=front.byName('customerTeamInventoryBindingPredicate').node;assert(ts.isFunctionDeclaration(helper)&&helper.getStart(front.sf)>routerCall.getStart(front.sf),'HOISTED_HELPER_AFTER_REAL_INIT');assert(typeof boot.sandbox.customerTeamInventoryBindingPredicate==='function','HOISTED_HELPER_AVAILABLE');
 check('actual original-position router construction, schema and native target service boot order',{actualTRPC:true,originalRouterCallBytePreserved:true,newHelperFunctionHoisted:true,newHelperAfterRouterInit:true,dbCalls:0,otherFactoryConstructorsOnlySynthetic:true,newRootProvider:false});
 return {checks,log,boot:{routerCallOffset:routerCall.getStart(front.sf),newHelperOffset:helper.getStart(front.sf),nativeBootDeclarations:boot.required.length,dbCalls}};
}
module.exports.bffAndBootChecks=bffAndBootChecks;
