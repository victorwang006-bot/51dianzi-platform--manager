import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AR,FR,H,read,assert,one,parse,nodes,ts,esbuild,delta,exact} from './static-core.mjs';
const D=path.dirname(fileURLToPath(import.meta.url)), O=D+'/native';
const sourceHashes={}, compiled={}, dependencies={}, pin=p=>{sourceHashes[p]=H(fs.readFileSync(p));return read(p)};
const allowedPackages=new Set(['node:crypto','crypto','@trpc/server','zod','drizzle-orm','drizzle-orm/mysql-core']);
const fixed={
 'customer.newInformationFacts':['customers','CUSTOMER_READ'],
 'channelInventory.newInformationFacts':['inventory','CHANNEL_INVENTORY_BUSINESS_METHOD_POLICIES["channelInventory.newInformationFacts"]'],
 'enterprise.inquiryNewInformationFacts':['inquiries','INQUIRY_RECEIVE_READ'],
 'customerDemand.procurementNewInformationFacts':['procurement','PROCUREMENT_DEMAND_READ'],
 'inbound.newInformationFacts':['inventory','INVENTORY_INBOUND_READ'],
 'crmSalesOrder.newInformationFacts':['orders','SALES_ORDER_READ'],
 'order.sellerNewInformationFacts':['orders','READ'],
};
const basename=f=>path.basename(f);
function decl(a,name){return one(nodes(a,n=>(ts.isFunctionDeclaration(n)||ts.isVariableDeclaration(n))&&n.name?.text===name),'actual declaration '+name)}
function object(a,name){const d=decl(a,name);assert(ts.isCallExpression(d.initializer)&&ts.isObjectLiteralExpression(d.initializer.arguments[0]),'router object '+name);return d.initializer.arguments[0]}
function fieldPatch(s,a,name,addition){const ob=object(a,name);return {start:ob.getStart(a)+1,end:ob.getStart(a)+1,before:'',after:'\n'+addition+'\n',reason:'fixed protected query registration '+name}}
function narrowSource(file,names){const text=pin(file),a=parse(text,file);return a.statements.filter(ts.isImportDeclaration).map(n=>n.getText(a)).join('\n')+'\n'+names.map(name=>{const d=decl(a,name);if(ts.isFunctionDeclaration(d))return d.getText(a).replace(/^export\s+/, '');return 'const '+d.getText(a)+';'}).join('\n')+'\nexport {'+names.join(',')+'};\n'}
function transpile(s){return ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText}
function insertStatementAfterCall(original,a,fnName,callName,after,reason){const f=decl(a,fnName);const st=one(nodes(f,n=>ts.isExpressionStatement(n)&&ts.isAwaitExpression(n.expression)&&ts.isCallExpression(n.expression.expression)&&n.expression.expression.expression.text===callName),reason+' anchor');return{start:st.end,end:st.end,before:'',after:'\n'+after,reason}}
async function compileModule(label,entry,repo,bridges=new Map(),virtual=new Map(),factory=false,returns='{}'){
 const inputs=[];
 const result=await esbuild.build({stdin:{contents:entry,resolveDir:repo,sourcefile:label+'.ts',loader:'ts'},bundle:true,write:false,platform:'node',target:'node20',format:'esm',packages:'external',metafile:true,legalComments:'none',plugins:[{name:'bounded-native-abi',setup(b){
  b.onResolve({filter:/.*/},arg=>{
   if(arg.path=== './'+compiled.contracts?.name)return{path:arg.path,external:true};
   let p=arg.path.startsWith('@shared/')?path.join(repo,'shared',arg.path.slice(8))+'.ts':arg.path.startsWith('.')?path.resolve(arg.resolveDir,arg.path):null;
   if(p&&!path.extname(p))p+='.ts';
   if(p===FR+'/shared/adminNewInformationFacts.ts'||p===AR+'/shared/adminNewInformationFacts.ts')return {path:'./'+compiled.contracts.name,external:true};
   if(p&&bridges.has(p))return{path:p,namespace:'native-bridge'};
   if(p&&virtual.has(p))return{path:p,namespace:'narrow-source'};
   if(p)return{path:p};
  });
  b.onLoad({filter:/.*/,namespace:'native-bridge'},a=>({contents:bridges.get(a.path),loader:'ts',resolveDir:path.dirname(a.path)}));
  b.onLoad({filter:/.*/,namespace:'narrow-source'},a=>({contents:virtual.get(a.path),loader:'ts',resolveDir:path.dirname(a.path)}));
 }}]});
 let text=result.outputFiles[0].text,a=parse(text),imports=a.statements.filter(ts.isImportDeclaration),exports=a.statements.filter(ts.isExportDeclaration);
 for(const i of imports){const p=i.moduleSpecifier.text;assert(allowedPackages.has(p)||p==='./'+compiled.contracts.name,'unknown runtime external '+p);if(!p.startsWith('.'))assert(fs.existsSync(path.join(repo,'node_modules',p.split('/')[0],p.split('/')[1]??''))||p.startsWith('node:')||p==='crypto','external package must exist in original node_modules '+p)}
 if(factory){const patches=exports.map(n=>({start:n.getStart(a),end:n.end,before:n.getText(a),after:'',reason:'factory exports'}));for(const n of imports)patches.push({start:n.getStart(a),end:n.end,before:n.getText(a),after:'',reason:'module imports remain outside factory'});text=imports.map(n=>n.getText(a)).join('\n')+'\nexport function createNativeNewInformationRuntime(native) {\n'+delta(text,patches).next+'\nreturn '+returns+';\n}\n';}
 parse(text);const name='newInformation.'+label+'.'+H(text)+'.runtime.mjs';fs.writeFileSync(O+'/'+name,text);
 for(const p of Object.keys(result.metafile.inputs)){const f=p.replace(/^(native-bridge|narrow-source):/,'');if(path.isAbsolute(f)&&fs.existsSync(f)&&!f.includes('/node_modules/'))pin(f);else if(fs.existsSync(path.resolve(f))&&!f.includes('/node_modules/'))pin(path.resolve(f));}
 compiled[label]={name,sha256:H(text),bytes:Buffer.byteLength(text),inputs:Object.keys(result.metafile.inputs)};return {text,name};
}
function bridge(map,file,names){map.set(file,'export const {'+names.join(',')+'}=native;');}
function oldPatchFunction(s,a,name,changes){const d=decl(a,name),before=d.getText(a);let after=before;for(const [old,next] of changes){assert(after.split(old).length===2,'unique function change '+name+' '+old);after=after.replace(old,next)}return{start:d.getStart(a),end:d.end,before,after,reason:'bounded original function update '+name}}
function sourceCall(file,call){const s=pin(file),a=parse(s,file);return one(nodes(a,n=>ts.isExpressionStatement(n)&&ts.isAwaitExpression(n.expression)&&ts.isCallExpression(n.expression.expression)&&n.expression.expression.expression.text===call), 'trusted new hook '+call).getText(a)}
async function buildFront(){
 const s=read(D+'/baseline/frontApi.js'),a=parse(s),bridges=new Map(),virtual=new Map();
 bridge(bridges,FR+'/server/db.ts',['getDb','buildAdminOrderConditions','sellerOrderReadWhere']);
 bridge(bridges,FR+'/server/services/crmCustomers.ts',['resolveCrmCustomerPolicy','crmCustomerPolicyWhere','crmCustomerStoredTimeIso']);
 bridge(bridges,FR+'/server/services/customerDemands.ts',['requireProcurementAccess','crmProcurementDemandWhere','procurementTenantDemandExists','procurementFactIso']);
 bridge(bridges,FR+'/server/services/crmSalesOrders.ts',['crmSalesOrderNewInformationAccess']);
 bridge(bridges,FR+'/server/services/channelInventory.ts',['ChannelInventoryError']);
 bridge(bridges,FR+'/server/services/channelInventoryOriginalActor.ts',['officialMaterialRecorderAdminAccountId']);
 bridge(bridges,FR+'/server/services/channelTeamInventoryAccess.ts',['resolveTeamInventoryVisibility','TEAM_MATERIAL_FROM','teamInventoryAll','teamInventoryRows']);
 bridge(bridges,FR+'/server/services/inboundProcurementAccess.ts',['inboundProcurementIdentity','resolveInboundProcurementAccess','inboundProcurementWhere']);
 for(const [f,names] of [['enterpriseBusinessHandoff.ts',['enterpriseInquiryInboxFactsPredicate']],['businessConversationScope.ts',['assertScope','businessConversationFactsPredicate']]])virtual.set(FR+'/server/services/'+f,narrowSource(FR+'/server/services/'+f,names));
 const entry=`
 import {createCustomersNewInformationFactsReader} from './server/services/adminNewInformationSources/customers';
 import {createInventoryNewInformationSource} from './server/services/adminNewInformationSources/inventory';
 import {createInboundNewInformationFactsReader} from './server/services/adminNewInformationSources/inbound';
 import {createProcurementNewInformationSource} from './server/services/adminNewInformationSources/procurement';
 import {createCrmSalesNewInformationReader,createSellerSalesNewInformationReader,createNativeSalesNewInformationReader} from './server/services/adminNewInformationSources/sales';
 import {createReceptionNewInformationReader,readReceptionExistingServiceUserId} from './server/services/adminNewInformationSources/reception';
 import {recordCrmCustomerAssignmentFact,recordCrmCustomerCreationFact} from './server/services/crmCustomerAssignments';
 import {recordDemandFirstSubmissionOrigin,recordCrmSalesCreationOrigin} from './server/services/adminNewInformationOrigins';
 import {enterpriseInquiryInboxFactsPredicate} from './server/services/enterpriseBusinessHandoff';
 import {businessConversationFactsPredicate} from './server/services/businessConversationScope';
 import {sql} from 'drizzle-orm';
 const customer=createCustomersNewInformationFactsReader({getDb:native.getDb,resolvePolicy:native.resolveCrmCustomerPolicy,policyWhere:native.crmCustomerPolicyWhere,toIso:native.crmCustomerStoredTimeIso});
 const inventory=createInventoryNewInformationSource({getDb:native.getDb});
 const inbound=createInboundNewInformationFactsReader({getDb:native.getDb});
 const procurement=createProcurementNewInformationSource();
 const crmSales=createCrmSalesNewInformationReader(),sellerSales=createSellerSalesNewInformationReader(),nativeSales=createNativeSalesNewInformationReader();
 const reception=createReceptionNewInformationReader({getDb:native.getDb,actorUserId:ctx=>ctx.user.id,requireActiveEnterpriseScope:(id,tx)=>{if(typeof tx.select!=='function')throw new Error('Invalid native permission transaction ABI');return native.requireActiveEnterpriseScope(id,tx)},inquiryInboxPredicate:enterpriseInquiryInboxFactsPredicate,businessConversationPredicate:businessConversationFactsPredicate,
 async resolveChatListReadContext(tx,id){const view=await native.resolveAccountSupportView(tx,id,undefined);const ordinaryConversationScope=view.supportOnlyWithoutEnterpriseSelection?sql\`FALSE\`:sql\`(\${native.conversationIdentityScopeSql('c',id,view.identity)} OR \${native.chatTransitionPendingListScopeSql('c',id,view.identity)})\`;const serviceUserId=await readReceptionExistingServiceUserId(tx);return{ordinaryConversationScope,serviceUserId,canonicalize:entries=>native.chatTransitionCanonicalizeListEntries(tx,id,view.identity,serviceUserId,[...entries])}}});
 export {customer,inventory,inbound,procurement,crmSales,sellerSales,nativeSales,reception,recordCrmCustomerAssignmentFact,recordCrmCustomerCreationFact,recordDemandFirstSubmissionOrigin,recordCrmSalesCreationOrigin};`;
 const r=await compileModule('front',entry,FR,bridges,virtual,true,'{customer,inventory,inbound,procurement,crmSales,sellerSales,nativeSales,reception,recordCrmCustomerAssignmentFact,recordCrmCustomerCreationFact,recordDemandFirstSubmissionOrigin,recordCrmSalesCreationOrigin}');
 const patches=[{start:0,end:0,before:'',after:`import {createNativeNewInformationRuntime as __createNewInformationFront} from '../runtime/${r.name}';\nimport {newInformationFactsInputSchema as __newFactsInput,newInformationFactsResultSchema as __newFactsResult} from '../runtime/${compiled.contracts.name}';\n`,reason:'isolated new facts runtimes'}];
 const root=decl(a,'appRouter'),start=root.parent.parent.getStart(a);
 const deps={getDb:'getDb',buildAdminOrderConditions:'buildAdminOrderConditions',sellerOrderReadWhere:'(id)=>eq(orders.sellerId,id)',resolveCrmCustomerPolicy:'resolveCrmCustomerPolicy',crmCustomerPolicyWhere:'crmCustomerPolicyWhere',crmCustomerStoredTimeIso:'iso',requireProcurementAccess:'requireProcurementAccess',crmProcurementDemandWhere:'crmProcurementDemandWhere',procurementTenantDemandExists:'procurementTenantDemandExists',procurementFactIso:'iso3',crmSalesOrderNewInformationAccess:'{requireAccess:requireSalesOrderAccess,scopeWhere:orderScopeWhere,normalizeCreatedAt:iso5}',ChannelInventoryError:'ChannelInventoryError',officialMaterialRecorderAdminAccountId:'officialMaterialRecorderAdminAccountId',resolveTeamInventoryVisibility:'resolveTeamInventoryVisibility',TEAM_MATERIAL_FROM:'TEAM_MATERIAL_FROM',teamInventoryAll:'teamInventoryAll',teamInventoryRows:'teamInventoryRows',inboundProcurementIdentity:'__procurementInbound20261115.inboundProcurementIdentity',resolveInboundProcurementAccess:'__procurementInbound20261115.resolveInboundProcurementAccess',inboundProcurementWhere:'__procurementInbound20261115.inboundProcurementWhere',requireActiveEnterpriseScope:'requireActiveEnterpriseScope',resolveAccountSupportView:'resolveAccountSupportView',conversationIdentityScopeSql:'conversationIdentityScopeSql',chatTransitionPendingListScopeSql:'chatTransitionPendingListScopeSql',chatTransitionCanonicalizeListEntries:'chatTransitionCanonicalizeListEntries'};
 dependencies.front=deps;
 patches.push({start,end:start,before:'',after:'const __newInformationFront=__createNewInformationFront({'+Object.entries(deps).map(([k,v])=>k+':'+v).join(',')+'});\n',reason:'factory after actual original native declarations'});
 const make=(procedure,run)=>`__newFactsInput).output(__newFactsResult).query(({ctx,input})=>${run})`;
 patches.push(fieldPatch(s,a,'customerRouter','newInformationFacts: customerProcedure.input('+make('', '__newInformationFront.customer(scopeFor(ctx),input)')+','));
 patches.push(fieldPatch(s,a,'customerDemandRouter','procurementNewInformationFacts: procurementProcedure.input('+make('', '__newInformationFront.procurement({...scopeFor2(ctx),staffDelegation:ctx.staffDelegation},input)')+','));
 patches.push(fieldPatch(s,a,'crmSalesOrderRouter','newInformationFacts: salesOrderProcedure.input('+make('', '__newInformationFront.crmSales(scopeFor3(ctx),input)')+','));
 patches.push(fieldPatch(s,a,'orderRouter','sellerNewInformationFacts: protectedProcedure.input('+make('', '__newInformationFront.sellerSales(ctx.user.id,input)')+','));
 patches.push(fieldPatch(s,a,'inboundRouter','newInformationFacts: inventoryInboundProcedure.input('+make('', '__newInformationFront.inbound(ctx,input)')+','));
 patches.push(fieldPatch(s,a,'enterpriseRouter','inquiryNewInformationFacts: protectedProcedure.input('+make('', '__newInformationFront.reception(ctx,input)')+','));
 patches.push(fieldPatch(s,a,'internalOrderRouter','newInformationFacts: publicProcedure.input(__newFactsInput.extend({salesStaffCodes:salesStaffCodesInput}).strict()).output(__newFactsResult).query(({ctx,input})=>{requirePortalKey2(ctx.req?.headers);return __newInformationFront.nativeSales(input.salesStaffCodes,{refs:input.refs})}),'));
 // The ORIGINAL signed-path readProcedure is retained, never a separate unsafe channel router.
 const channel=decl(a,'createChannelInventoryRouter');const ob=one(nodes(channel,n=>ts.isReturnStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.text==='router'),'original safe channel router').expression.arguments[0];
 patches.push({start:ob.getStart(a)+1,end:ob.getStart(a)+1,before:'',after:'\nnewInformationFacts:readProcedure.input(__newFactsInput).output(__newFactsResult).query(async({ctx,input})=>{try{return await __newInformationFront.inventory.newInformationFacts(scopeFromContext(ctx),input)}catch(error){return asTrpcError(error)}}),\n',reason:'exact original channel signed read middleware query'});
 patches.push(oldPatchFunction(s,a,'scopeFor',[['actorUserId: ctx.user.id,','actorUserId: ctx.user.id,\n    staffDelegation: ctx.staffDelegation,']]));
 for(const name of ['scopeFor2','scopeFor3']) patches.push(oldPatchFunction(s,a,name,[['actorUserId: ctx.user.id }','actorUserId: ctx.user.id, staffDelegation: ctx.staffDelegation }']]));
 patches.push(insertStatementAfterCall(s,a,'saveCustomerDemand','insertAudit2',transpile(sourceCall(FR+'/server/services/customerDemands.ts','recordDemandFirstSubmissionOrigin')).replaceAll('recordDemandFirstSubmissionOrigin(', '__newInformationFront.recordDemandFirstSubmissionOrigin('),'same original transaction first submitted native origin'));
 patches.push(insertStatementAfterCall(s,a,'createSalesOrder','insertAudit3',transpile(sourceCall(FR+'/server/services/crmSalesOrders.ts','recordCrmSalesCreationOrigin')).replaceAll('recordCrmSalesCreationOrigin(', '__newInformationFront.recordCrmSalesCreationOrigin('),'same original transaction CRM creation native origin'));
 patches.push(insertStatementAfterCall(s,a,'createCustomer','registerCustomerRecord',transpile(sourceCall(FR+'/server/services/crmCustomers.ts','recordCrmCustomerCreationFact')).replaceAll('recordCrmCustomerCreationFact(', '__newInformationFront.recordCrmCustomerCreationFact('),'same transaction trusted customer creation metadata'));
 patches.push(insertStatementAfterCall(s,a,'transferCustomer','syncCrmCustomerAssignmentOwner',transpile(sourceCall(FR+'/server/services/crmCustomers.ts','recordCrmCustomerAssignmentFact')).replaceAll('recordCrmCustomerAssignmentFact(', '__newInformationFront.recordCrmCustomerAssignmentFact('),'same transaction actual customer transfer frozen facts'));
 const handoff=decl(a,'transferHandoffCustomers'),ret=one(nodes(handoff,n=>ts.isReturnStatement(n)&&n.expression?.text==='count'),'handoff success return');
 const src=pin(FR+'/server/services/crmCustomerHandoff.ts'),sa=parse(src,FR+'/server/services/crmCustomerHandoff.ts'),loop=one(nodes(sa,n=>ts.isForOfStatement(n)&&n.getText(sa).includes('await recordCrmCustomerAssignmentFact(')),'handoff new same executor hook');
 patches.push({start:ret.getStart(a),end:ret.getStart(a),before:'',after:transpile(loop.getText(sa)).replaceAll('recordCrmCustomerAssignmentFact(', '__newInformationFront.recordCrmCustomerAssignmentFact('),reason:'member handoff same locked executor append and demand freezing'});
 // Original helper optional-db update; only named functions, preserve all other old API text.
 for(const name of ['getMemberPermissionKeys','resolveEnterprisePermissionScope','requireActiveEnterpriseScope']){
  const f=decl(parse(pin(FR+'/server/services/enterprisePermissions.ts'),FR+'/server/services/enterprisePermissions.ts'),name);
  assert(f.parameters.length===2,'parent same-transaction enterprise permission ABI not ready '+name);
  const original=decl(a,name);let code=original.getText(a);
  code=code.replace(name+'('+original.parameters[0].name.text+')',name+'('+original.parameters[0].name.text+', readDatabase)');
  if(name!=='requireActiveEnterpriseScope')code=code.replace('const db = await requireDb();','const db = readDatabase ?? await requireDb();');
  if(name==='resolveEnterprisePermissionScope')code=code.replace('getMemberPermissionKeys(context.member.id)','getMemberPermissionKeys(context.member.id, readDatabase)');
  if(name==='requireActiveEnterpriseScope')code=code.replace('resolveEnterprisePermissionScope(userId)','resolveEnterprisePermissionScope(userId, readDatabase)');
  assert(code!==original.getText(a),'same tx helper delta '+name);
  // Preserve original eq8/and7/asc4/TRPCError2 and every original permission branch.
  patches.push({start:original.getStart(a),end:original.end,before:original.getText(a),after:code,reason:'original enterprise permission helper optional same-transaction db '+name});
 }
 // Add fixed native IDs and original capabilities, retaining every old entry and verifier.
 for(const name of ['BUSINESS_METHOD_IDS','CHANNEL_INVENTORY_BUSINESS_METHOD_IDS','NATIVE_TEAM_READ_METHODS']){
  const d=decl(a,name);assert(ts.isArrayLiteralExpression(d.initializer),'closed method array '+name);const methods=name==='BUSINESS_METHOD_IDS'?Object.keys(fixed).filter(x=>!x.startsWith('channelInventory.')):['channelInventory.newInformationFacts'];const at=d.initializer.getStart(a)+1;
  patches.push({start:at,end:at,before:'',after:methods.map(JSON.stringify).join(',')+',',reason:'exact closed native method IDs '+name});
 }
 const policies=decl(a,'CHANNEL_INVENTORY_BUSINESS_METHOD_POLICIES').initializer;assert(ts.isObjectLiteralExpression(policies),'closed policy object');const at=policies.getStart(a)+1;
 patches.push({start:at,end:at,before:'',after:'"channelInventory.newInformationFacts":{mode:"read",permission:"inventory.manage"},',reason:'new channel exact read policy'});
 const caps=decl(a,'BUSINESS_METHOD_CAPABILITIES');const capAt=caps.parent.parent.end;
 patches.push({start:capAt,end:capAt,before:'',after:'\n'+Object.entries(fixed).map(([m,[,v]])=>'BUSINESS_METHOD_CAPABILITIES['+JSON.stringify(m)+']='+v+';').join('\n')+'\n',reason:'fixed 7 methods use original realm capabilities'});
 finish('front',s,patches);
}
async function buildAdmin(){
 const s=read(D+'/baseline/adminApi.js'),a=parse(s),bridges=new Map(),virtual=new Map();
 const dbNames=['getDb','withBusinessAuthorizationFence','getAdminUserById','getAdminUserPermissions','getActiveBusinessStaffBinding','getActiveBusinessMerchantScope','getBusinessWorkbenchMerchantById','getAdminUserSalesScopeCodes'];
 bridge(bridges,AR+'/server/db.ts',dbNames);
 bridge(bridges,AR+'/server/_core/trpc.ts',['router','adminProcedure']);
 bridge(bridges,AR+'/server/businessAccess.ts',['businessEnterpriseBindingFromMerchant','businessScopeAllows','getBusinessWorkbenchMerchantIds']);
 bridge(bridges,AR+'/server/services/officialChannelAccess.ts',['loadOfficialAccess','assertOfficialRecordAction','officialTeamPredicate','officialActorFromContext']);
 bridge(bridges,AR+'/drizzle/schema.ts',['adminStaffArchives','materials']);
 bridge(bridges,AR+'/drizzle/officialChannelSchema.ts',['officialChannelTeams']);
 virtual.set(AR+'/server/businessRouter.ts',`import {createHash,randomUUID} from 'node:crypto';import {TRPCError} from '@trpc/server';import {newInformationFactsInputSchema,newInformationFactsResultSchema} from './new-native-contract';const db=native;const withCurrentBusinessAuthorization=native.withCurrentBusinessAuthorization,businessAuditActor=native.businessAuditActor,businessEnterpriseBindingFromMerchant=native.businessEnterpriseBindingFromMerchant,callPlatformBusinessCommand=native.callPlatformBusinessCommand;\nexport const BUSINESS_NEW_INFORMATION_READS=${JSON.stringify(Object.fromEntries(Object.entries(fixed).map(([k,[m]])=>[k,m])))};\n${transpile(decl(parse(pin(AR+'/server/businessRouter.ts'),AR+'/server/businessRouter.ts'),'readBusinessNewInformationFacts').getText()).replace(/^export\s+/,'')}\nexport {readBusinessNewInformationFacts};`);
 bridges.set(AR+'/server/new-native-contract.ts',`export {newInformationFactsInputSchema,newInformationFactsResultSchema} from './${compiled.contracts.name}';`);
 const pf=pin(AR+'/server/platformOrderApi.ts'),pa=parse(pf,AR+'/server/platformOrderApi.ts');virtual.set(AR+'/server/platformOrderApi.ts','const callPlatformOrder=native.callPlatformOrder;\n'+transpile(decl(pa,'getPlatformOrderNewInformationFacts').getText()));
 const entry=`import {createAdminNewInformationRouterForSource} from './server/routers/adminNewInformation';import {createAdminNewInformationSourceForContext} from './server/services/adminNewInformationSources';import {createAdminNewInformationService} from './server/services/adminNewInformation';import {readBusinessNewInformationFacts} from './server/businessRouter';import {createMallNewInformationReader} from './server/services/adminNewInformationSources/mall';export const newInformation=createAdminNewInformationRouterForSource({source:createAdminNewInformationSourceForContext});export {createAdminNewInformationRouterForSource,createAdminNewInformationSourceForContext,createAdminNewInformationService,readBusinessNewInformationFacts,createMallNewInformationReader};`;
 const r=await compileModule('admin',entry,AR,bridges,virtual,true,'{newInformation,createAdminNewInformationRouterForSource,createAdminNewInformationSourceForContext,createAdminNewInformationService,readBusinessNewInformationFacts,createMallNewInformationReader}');
 const root=decl(a,'appRouter'),start=root.parent.parent.getStart(a);
 const deps=Object.fromEntries([...dbNames,'router','adminProcedure','businessEnterpriseBindingFromMerchant','businessScopeAllows','getBusinessWorkbenchMerchantIds','loadOfficialAccess','assertOfficialRecordAction','officialTeamPredicate','officialActorFromContext','adminStaffArchives','materials','officialChannelTeams','withCurrentBusinessAuthorization','businessAuditActor','callPlatformBusinessCommand','callPlatformOrder'].map(n=>[n,n]));dependencies.admin=deps;
 const patches=[{start:0,end:0,before:'',after:`import {createNativeNewInformationRuntime as __createNewInformationAdmin} from '../runtime/${r.name}';\nimport {newInformationFactsInputSchema as __newFactsInput,newInformationFactsResultSchema as __newFactsResult} from '../runtime/${compiled.contracts.name}';\n`,reason:'isolated admin core registry facts runtime'}, {start,end:start,before:'',after:'const __newInformationAdmin=__createNewInformationAdmin({'+Object.entries(deps).map(([k,v])=>k+':'+v).join(',')+'});\n',reason:'actual native default source/account fence dependencies'},fieldPatch(s,a,'appRouter','newInformation:__newInformationAdmin.newInformation,')];
 const f=decl(a,'withCurrentBusinessAuthorization'),guard='\nif(withinNotificationViewerFence && !(capability.method && '+JSON.stringify(Object.keys(fixed))+'.includes(capability.method))) throw new __ir_admin_d67f0938_import_TRPCError({code:"FORBIDDEN",message:"无效通知读取"});\n';
 let text=f.getText(a);assert(text.includes('const account = requireBusinessAdminAccount(ctx);'),'original auth account guard');text=text.replace('ctx, merchantId, capability, operation)','ctx, merchantId, capability, operation, withinNotificationViewerFence = false)');text=text.replace('const account = requireBusinessAdminAccount(ctx);','const account = requireBusinessAdminAccount(ctx);'+guard);text=text.replace('return __ir_admin_d67f0938_namespace_db.withBusinessAuthorizationFence({ adminUserId: account.id, merchantId }, async () => {','const readAuthorized = async () => {');
 assert(text!==f.getText(a)&&text.includes('const readAuthorized = async () => {'),'native auth fenced branch anchor');
 const closing=text.lastIndexOf('});');assert(closing>=0,'auth final closure');text=text.slice(0,closing)+'};\nreturn withinNotificationViewerFence ? readAuthorized() : __ir_admin_d67f0938_namespace_db.withBusinessAuthorizationFence({adminUserId:account.id,merchantId},readAuthorized);'+text.slice(closing+3);
 text=text.replace('const nativeReadMethods = [','const nativeReadMethods = ["channelInventory.newInformationFacts",');parse(text);
 patches.push({start:f.getStart(a),end:f.end,before:f.getText(a),after:text,reason:'server-only exact7 branch skips ONLY already-held notification account fence; current auth unchanged'});
 // Root business readers retain original authorization; schema return occurs BEFORE audit DML.
 const fw=decl(a,'forwardBusinessMethod'),anchor=one(nodes(fw,n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.text==='binding')),'original forward authorized callback');
 patches.push({start:anchor.getStart(a),end:anchor.getStart(a),before:'',after:'if('+JSON.stringify(Object.keys(fixed))+'.includes(capability.method)){ const raw=await callPlatformBusinessCommand({binding:businessEnterpriseBindingFromMerchant(merchant),staffUserId:staffBinding.frontUserId,bindingVersion:staffBinding.bindingVersion,adminActor:{id:businessAuditActor(ctx).operatorId,name:businessAuditActor(ctx).operatorName,role:businessAuditActor(ctx).operatorRole},requestId:__ir_admin_d67f0938_import_randomUUID(),method:capability.method,params:__newFactsInput.parse(params),officialInventoryPermissions}); return __newFactsResult.parse(raw); }\n',reason:'strict new source reads return before original generic audit DML'});
 for(const [method,[module]] of Object.entries(fixed)){
  const [ns,key]=method.split('.');const bo=object(a,'businessRouter');const prop=one(bo.properties.filter(p=>p.name?.text===ns),'actual business namespace '+ns);const ob=ts.isIdentifier(prop.initializer)?object(a,prop.initializer.text):prop.initializer.arguments[0];assert(ts.isObjectLiteralExpression(ob),'business namespace literal '+ns);const at=ob.getStart(a)+1;
  patches.push({start:at,end:at,before:'',after:`\n${key}: protectedProcedure.input(__newFactsInput).output(__newFactsResult).query(({ctx,input})=>forwardBusinessMethod(ctx,input,{method:${JSON.stringify(method)},module:${JSON.stringify(module)},mode:'read'})),\n`,reason:'real business BFF fixed query '+method});
 }
 finish('admin',s,patches);
}
function finish(role,s,patches){const d=delta(s,patches);fs.writeFileSync(O+'/'+role+'Api.js',d.next);fs.writeFileSync(O+'/'+role+'-delta.json',JSON.stringify({beforeSha256:H(s),afterSha256:H(d.next),inverseVerified:d.inverseVerified,patches:d.patches},null,2)+'\n');console.log(role+' API bounded delta '+patches.length+' hunks, inverse exact');}
assert(!fs.existsSync(O),'fresh native output required; move previous freeze explicitly before rebuild');fs.mkdirSync(O,{recursive:true});
// One shared compiled facts contract; all readers/routes refer to the SAME schema instance.
const facts=pin(FR+'/shared/adminNewInformationFacts.ts');
const c=await esbuild.build({stdin:{contents:facts,resolveDir:FR,loader:'ts',sourcefile:'adminNewInformationFacts.ts'},bundle:true,write:false,platform:'node',target:'node20',format:'esm',packages:'external',legalComments:'none'});const ct=c.outputFiles[0].text;parse(ct);const cn='newInformation.contracts.'+H(ct)+'.runtime.mjs';fs.writeFileSync(O+'/'+cn,ct);compiled.contracts={name:cn,sha256:H(ct),bytes:Buffer.byteLength(ct)};
await buildFront();await buildAdmin();
for(const f of ['customer','channelInventory','customerDemand','inbound','crmSalesOrder','order','internalOrder','enterprise'])pin(FR+'/server/routers/'+f+'.ts');
for(const f of ['internalBusinessOfficialInventory','adminNewInformationFacts'])pin(FR+'/shared/'+f+'.ts');
pin(FR+'/server/services/internalBusinessDelegation.ts');
pin(AR+'/server/routers.ts');
for(const[p,h]of Object.entries(sourceHashes))assert(H(fs.readFileSync(p))===h,'source drift '+p);
fs.writeFileSync(O+'/manifest.json',JSON.stringify({scope:'admin-new-information-v1',compiled,dependencies,sourceHashes,api:{front:{before:H(read(D+'/baseline/frontApi.js')),after:H(read(O+'/frontApi.js'))},admin:{before:H(read(D+'/baseline/adminApi.js')),after:H(read(O+'/adminApi.js'))}},checks:{inverseOutsideHunks:true,syntax:true,noWorkerChanges:true,noStartupLoaded:true,noOldApiRebuild:true,packagesFromOriginalNodeModules:true},fixedMethods:Object.keys(fixed)},null,2)+'\n');console.log('Frozen native candidates complete; run check-native.mjs, not old API startup.');
