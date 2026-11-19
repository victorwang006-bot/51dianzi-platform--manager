'use strict';
const C=require('../customer-inventory-backend-20261114/core.cjs');
const {fs,ts,path,sha,assert,parse,walk,property,refs}=C;
const vm=require('node:vm');
const {allowedWrite,METHODS}=require('./backend-builder.cjs');
const Z=require('zod'),D=require('drizzle-orm'),XLSX=require('xlsx'),crypto=require('node:crypto');
const out=process.argv[2];assert(out,'Usage: backend-test.cjs /home/ubuntu/work/customer-batch/backend-candidate');
const result={format:'customer-batch-native-vm-tests-v1',entrypointExecuted:false,actualDatabaseAccess:false,transport:'in-memory canned SqlExecutor only',tests:[]};
function ok(name,details={}){result.tests.push({name,passed:true,...details});}
function declText(p,name){const d=p.byName(name);return ts.isVariableDeclaration(d.node)?`var ${name} = ${d.node.initializer.getText(p.sf)};`:d.node.getText(p.sf);}
function load(p,c,name){vm.runInContext(declText(p,name),c,{timeout:3000});}
function loadTree(p,c,name,seen=new Set()){const d=p.byName(name);if(seen.has(name)||d.import)return;seen.add(name);for(const r of refs(p,d.node))if(r!==d&&!r.import)loadTree(p,c,r.name,seen);load(p,c,name);}
function stmtSQL(q){return q.toQuery({casing:{getColumnCasing:x=>x.name},escapeName:x=>'`'+x+'`',escapeParam:()=>'? ',escapeString:x=>JSON.stringify(x)});}
const sqlText=q=>stmtSQL(q).sql;
const scope={enterpriseId:1,dataOwnerUserId:2,actorUserId:3,isOwner:false,inventoryDataScope:'own',permissionSnapshot:true};
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const refsRow=[{sheetIndex:0,sheetName:'Sheet1',rowNumber:2,originalRowHash:crypto.createHash('sha256').update('["=1+1"]').digest('hex')}];
const canonicalEntry={logicalRowId:uuid(1),rowId:uuid(2),rowRequestId:uuid(3),uploadBatchId:7,payload:{expectedEnterpriseId:1,expectedActorUserId:3,customerId:8,expectedCustomerVersion:1,requestId:uuid(3),uploadBatchId:7,channelId:9,partNumber:'=1+1',brand:'test',qty:1,dateCode:null,price:'1.20',currency:'CNY',taxIncluded:null,leadTime:null,note:null},sourceRefs:refsRow,status:'pending',createPayloadHash:'a'.repeat(64)};
const frozen={confirmationId:uuid(4),versionId:null,batchRequestId:uuid(5),batch:{id:7,revision:1,batchCode:uuid(6),channelId:9,customerId:8},entries:[canonicalEntry],excludedRows:[],resolvedIssues:[],sourceCoverage:null,createdAt:new Date().toISOString(),originalFileHash:'b'.repeat(64),eligibleComplete:false,batchCreatePayloadHash:'c'.repeat(64)};
const histRow={history_id:uuid(7),enterprise_id:1,data_owner_user_id:2,customer_id:8,uploaded_by_user_id:3,uploaded_by_admin_account_id:null,frozen_data:JSON.stringify(frozen)};
async function rejects(fn,code,label){let e;try{await fn();}catch(x){e=x;}assert(e&&(!code||e.code===code),label+' expected '+code+' got '+(e&&e.stack));return e;}
async function main(){
 const front=parse(path.join(out,'front-candidate.mjs')),admin=parse(path.join(out,'admin-candidate.mjs'));
 const fManifest=JSON.parse(fs.readFileSync(path.join(out,'front-patch-records.json'))),aManifest=JSON.parse(fs.readFileSync(path.join(out,'admin-patch-records.json')));
 for(const [key,p,m] of [['front',front,fManifest],['admin',admin,aManifest]]){
  let restored=p.text;for(const r of [...m.patches].reverse()){assert(sha(restored.slice(r.newStart,r.newEnd))===r.newSha256,'PATCH_NEW_HASH');restored=restored.slice(0,r.newStart)+r.oldText+restored.slice(r.newEnd);}assert(sha(restored)===m.baseline.sha256,'INVERSE '+key);ok(key+'.byte-exact-inverse',{baselineSha256:m.baseline.sha256});
 }
 const c=vm.createContext({Buffer,console,process:{env:{NODE_ENV:'test'}},Intl,URL,TextEncoder,TextDecoder});
 for(const p of [front]){for(const d of p.decls.filter(d=>d.import)){const pkg=['zod','drizzle-orm','xlsx','fflate','node:crypto','node:fs','node:fs/promises','node:path','node:os','node:zlib','@trpc/server'].includes(d.import)?require(d.import):null;if(!pkg)continue;c[d.name]=d.exported==='*'?pkg:d.exported==='default'?(pkg.default||pkg):pkg[d.exported];}}
 // Real native classes/canonical hash are isolated and evaluated, never platform entrypoints.
 for(const name of ['ChannelInventoryError','canonicalChannelInventoryJson','channelInventoryPayloadHash'])load(front,c,name);
 const facade=fManifest.patches.find(p=>p.name==='history.approved-local-namespace').source.facades;
 const nativeIdentities={};for(const f of facade){if(Object.hasOwn(c,f.runtimeName))continue;const spy=async()=>{throw new Error('UNEXPECTED_NATIVE_CALL '+f.runtimeName);};c[f.runtimeName]=spy;nativeIdentities[f.runtimeName]=spy;}
 // Exact native validation schema also uses its original field-set object.
 for(const name of ['channelMaterialCreateFields','createCustomerMaterialSchema']){
 loadTree(front,c,name);
 }
 // Scope-preserving providers may be mocked only at their external transport/authorization boundaries.
 c.resolveTeamInventoryVisibility=async()=>({access:{read:true,write:true},predicates:[],leader:false});
 c.resolveChannelInventoryAuthority=async()=>({read:true,write:true});
 c.currentReadExecutor=tx=>({execute:q=>tx.execute(q.getSQL()),rollback(){throw new Error('not a transaction');}});
 c.mallInventoryMethodRequirement=()=>null;c.__mallNative20261116={mallInventoryMethodRequirement:()=>null};
 for(const name of ['CHANNEL_INVENTORY_BUSINESS_METHOD_IDS','CHANNEL_INVENTORY_BUSINESS_METHOD_POLICIES','isChannelInventoryBusinessMethodId','NATIVE_FACTORY_PUBLISH_METHODS','NATIVE_TEAM_READ_METHODS','officialInventoryMethodRequirement'])load(front,c,name);
 for(const name of METHODS)assert(c.CHANNEL_INVENTORY_BUSINESS_METHOD_IDS.includes('channelInventory.'+name),'CLOSED_IDS');assert(c.CHANNEL_INVENTORY_BUSINESS_METHOD_POLICIES['channelInventory.'+METHODS[0]].mode==='read','EXPORT_POLICY');assert(c.CHANNEL_INVENTORY_BUSINESS_METHOD_POLICIES['channelInventory.'+METHODS[1]].mode==='write','REPAIR_POLICY');assert(c.officialInventoryMethodRequirement('channelInventory.'+METHODS[0])==='read','EXPORT_GRANT');assert(c.officialInventoryMethodRequirement('channelInventory.'+METHODS[1])==='write','REPAIR_GRANT');assert(c.officialInventoryMethodRequirement('channelInventory.unapproved')===null,'CLOSED_REJECT');ok('front.exact2-native-policy-and-single-repair-write-requirement');
 // The new repair fence is the actual original writeFence function, not a reconstructed provider.
 for(const name of ['rows12','fail11','writeFence','assertCustomerSupplyRepairWriteFence'])load(front,c,name);
 const fenceQueries=[];const fenceTx={execute:async q=>{const t=sqlText(q);fenceQueries.push(t);if(t.includes('FROM enterprise_team_members tm'))return [{id:1,teamId:5}];if(t.includes('FROM channel_inventory_channels c'))return [{id:9,active:1,type:'factory',teamId:5,currentOwnerUserId:3,revision:1}];throw new Error('FENCE_QUERY '+t);}};
 const source=await c.assertCustomerSupplyRepairWriteFence(fenceTx,scope,9);assert(source.id===9&&fenceQueries.length===2,'REPAIR_FENCE_NATIVE');ok('front.repair-wrapper-reuses-original-live-writeFence');
 c.createCustomerSupplyService=()=>({});
 load(front,c,'__cuh_20261115_bxz_front');
 const h=c.__cuh_20261115_bxz_front;
 assert(h&&h.customerUploadProblemsExportSchema&&h.customerUploadRepairPrepareConfirmationSchema,'NEW_SCHEMA_EXPORTS');
 const before=h.customerUploadProblemsExportSchema.parse({expectedEnterpriseId:1,expectedActorUserId:3,historyId:uuid(7)});assert(before.historyId===uuid(7),'EXPORT_SCHEMA');
 assert(!h.customerUploadRepairPrepareConfirmationSchema.safeParse({}).success,'REPAIR_STRICT_SCHEMA');
 assert(h.customerUploadIsSkippedProblem({reason:'跳过问题行：人工待补全'}),'SKIPPED_PROBLEM');assert(!h.customerUploadIsSkippedProblem({reason:'明确范围排除'}),'RANGE_NOT_REPAIR');
 ok('history.new-exact-schema-exports-and-skipped-only-classifier');
 // Every facade runtime symbol must resolve to the original global, not a shadow inside the bundle.
 const ns=front.byName('__cuh_20261115_bxz_front').node;const bindingChecks=[];for(const f of facade){const expected=front.byName(f.runtimeName);let seen=0;walk(ns,n=>{if(ts.isIdentifier(n)&&n.text===f.runtimeName){if((ts.isPropertyAssignment(n.parent)||ts.isPropertyAccessExpression(n.parent))&&n.parent.name===n)return;const s=front.symbolAt(n);if(s){assert(s===expected.symbol,'NATIVE_CAPTURE_SHADOW '+f.runtimeName);seen++;}}});assert(seen>0,'NATIVE_CAPTURE_MISSING '+f.runtimeName);bindingChecks.push({runtimeName:f.runtimeName,nativeModule:f.runtimeModule,globalIdentitySites:seen});}ok('history.fixed-facades-preserve-original-global-symbol-identity',{bindings:bindingChecks});
 // XLSX is the real existing import. Validate sheet semantics, formula text and exact request identities.
 const dto={historyId:uuid(7),revision:2,customerName:'客户A',originalFile:{sha256:'b'.repeat(64)},batchClosed:false};
 const version={versionId:uuid(8),issues:[],rows:[{rowId:uuid(2),logicalRowId:uuid(1),sourceRefs:refsRow,candidate:canonicalEntry.payload,disposition:'pending',excludeReason:null,issues:[]}]};
 const exported=h.customerUploadProblemsWorkbook(dto,version,null);assert(exported.mimeType==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'&&exported.problemCount===1&&exported.definitiveFailedCount===0,'XLSX_META');const wb=XLSX.read(Buffer.from(exported.base64,'base64'),{type:'buffer'});assert(wb.SheetNames.join('|')==='说明|问题行|待核实原请求|版本级问题','XLSX_SHEETS');assert(wb.Sheets['问题行'].E2.t==='s'&&wb.Sheets['问题行'].E2.v==='=1+1'&&!wb.Sheets['问题行'].E2.f,'FORMULA_INJECTION');ok('history.ProblemsExport-real-XLSX-formula-text-and-four-sheets');
 const confirmation={...frozen,versionId:version.versionId,entries:[{...canonicalEntry,status:'unknown'},{...canonicalEntry,logicalRowId:uuid(50),status:'success'}],excludedRows:[{logicalRowId:uuid(51),reason:'明确范围排除',sourceRefs:refsRow},{logicalRowId:uuid(52),reason:'跳过问题行：未知币种',sourceRefs:refsRow}]};const ex2=h.customerUploadProblemsWorkbook(dto,version,confirmation);assert(ex2.problemCount===1&&ex2.verificationCount===1&&ex2.definitiveFailedCount===0,'EXPORT_RECEIPT_SEMANTICS');ok('history.export-excludes-success-scope-and-keeps-unknown-verification-only');
 const manifest={sheets:[{sheetIndex:0,sheetName:'Sheet1',rows:[{rowNumber:2,originalRowHash:refsRow[0].originalRowHash,originalContent:'["=1+1"]',cells:['=1+1']}]}]};
 const overlapping={...frozen,excludedRows:[{logicalRowId:uuid(9),reason:'跳过问题行：未知字段',sourceRefs:refsRow}]};assert((await rejects(()=>h.assertCustomerUploadRepairSources(overlapping,[],manifest),'PRECONDITION_FAILED','SOURCE_OVERLAP')) instanceof c.ChannelInventoryError,'NATIVE_CLASS_IDENTITY');ok('history.repair-physical-row-overlap-rejected-with-original-native-error-class');
 let dbCalls=[];const tx={execute:async q=>{const text=sqlText(q);dbCalls.push(text);if(text.includes('SELECT h.*,cf.frozen_data'))return [histRow];if(text.includes('SELECT r.actor_user_id,r.result_data'))return [];throw new Error('UNEXPECTED_SQL '+text);}};
 await h.lockCustomerUploadFormalCreate(tx,scope,{uploadBatchId:7,channelId:9,requestId:uuid(3)},'a'.repeat(64));assert(dbCalls.length===2,'FORMAL_MAPPED');
 for(const input of [{uploadBatchId:7,channelId:9,requestId:uuid(30)},{channelId:9,requestId:uuid(3)},{uploadBatchId:70,channelId:9,requestId:uuid(3)}])await rejects(()=>h.lockCustomerUploadFormalCreate(tx,scope,input,'a'.repeat(64)),'CONFLICT','UNMAPPED_OR_OMITTED');await rejects(()=>h.lockCustomerUploadFormalCreate(tx,scope,{uploadBatchId:7,channelId:9,requestId:uuid(3)},'d'.repeat(64)),'CONFLICT','CHANGED_PAYLOAD');ok('history.formal-fence-mapped-original-only-omitted-batch-and-newcapacity-denial');
 c.lockCustomerUploadFormalCreate=h.lockCustomerUploadFormalCreate;c.lockCustomerUploadFormalHistory=h.lockCustomerUploadFormalHistory;
 c.trustedCustomerCreationContexts=new WeakSet();c.requiredDatabase=async getDb=>getDb();c.lockAndRevalidateMutationScope=async()=>{};c.databaseFailure=()=>new Error('Unexpected database failure');let batchLocks=0;c.lockMaterialUploadBatch=async()=>{batchLocks++;throw new Error('PAST_FORMAL_FENCE');};
 load(front,c,'createChannelInventoryService');const nativeService=c.createChannelInventoryService({getDb:async()=>({transaction:async fn=>fn(tx)}),registerTeamRecord:async()=>{throw new Error('NO_WRITES');}});
 await rejects(()=>nativeService.createMaterial(scope,{...canonicalEntry.payload,requestId:uuid(30)}),'CONFLICT','NATIVE_GENERIC_FENCE');assert(batchLocks===0,'FENCE_BEFORE_CAPACITY');ok('native.createMaterial-actual-factory-denies-unmapped-before-batch-lock-and-write');
 load(front,c,'reconcileMaterialCreate');await rejects(()=>c.reconcileMaterialCreate({transaction:async fn=>fn(tx)},scope,uuid(30),'d'.repeat(64),{...canonicalEntry.payload,requestId:uuid(30)}),'CONFLICT','NATIVE_REPLAY_FENCE');assert(batchLocks===0,'REPLAY_PRELOCK');ok('native.reconcileMaterialCreate-actual-native-function-fence-before-batch-lock');
 // Management list is the actual native factory with its untouched transaction wrapper.
 c.linkedCompanyReadGate=async()=>D.sql`TRUE`;c.linkedCompany=async()=>({linked:false});for(const name of ['rows10','all','bool','batchCurrentMembership','BATCH_FROM','activeChannelMaterial']){const d=front.decls.find(d=>d.name===name);if(d&&!Object.hasOwn(c,name))load(front,c,name);}
 const mgRefs=refs(front,front.byName('createChannelInventoryManagementService').node);for(const d of mgRefs){if(Object.hasOwn(c,d.name))continue;if(d.import)continue;if(d.name==='parse11'||d.name==='parse10'||d.name==='parse9')load(front,c,d.name);else c[d.name]=async()=>{throw new Error('UNEXPECTED_MANAGEMENT_HELPER '+d.name);};}
 // Resolve exactly the helpers referenced by mapped list method, never guessing suffixes.
 const list=property;const listMethod=C.method(front,'createChannelInventoryManagementService','listUploadBatches');for(const d of refs(front,listMethod)){if(d.import)continue;if(d.name==='ChannelInventoryError')continue;if(['resolveTeamInventoryVisibility','linkedCompanyReadGate','linkedCompany'].includes(d.name))continue;if(d.name==='listUploadBatchesSchema')loadTree(front,c,d.name);else if(d.name.startsWith('parse')||d.name.startsWith('rows')||d.name.startsWith('bool')||d.name==='teamInventoryRows'||d.name==='teamInventoryAll'||d.name==='batchCurrentMembership'||d.name==='BATCH_FROM'||d.name==='activeChannelMaterial')load(front,c,d.name);}load(front,c,'fail10');
 // Schema primitives resolve using their actual declaration dependency identities.
 const schema=front.byName('listUploadBatchesSchema');function loadDeps(d,seen=new Set()){if(seen.has(d.name)||d.import)return;seen.add(d.name);for(const x of refs(front,d.node)){if(x!==d)loadDeps(x,seen);}load(front,c,d.name);}loadDeps(schema);
 load(front,c,'createChannelInventoryManagementService');const listQueries=[];const mg= c.createChannelInventoryManagementService({getDb:async()=>({transaction:async fn=>fn({execute:async q=>{const t=sqlText(q);listQueries.push(stmtSQL(q));return t.includes('SELECT COUNT(*) AS total')?[{total:0}]:[];}})})});
 const listed=await mg.listUploadBatches(scope,{customerId:8,expectedEnterpriseId:1,expectedActorUserId:3,page:1,pageSize:20});assert(listed.total===0&&listQueries.length===2,'MG_LIST');for(const q of listQueries){assert(q.sql.includes('batch_customer_link.customerId')&&q.sql.includes('batch_customer_link.inventoryResponsibleUserId = c.responsible_user_id'),'CUSTOMER_INTERSECTION');assert(q.params.includes(8),'CUSTOMER_ID_BOUND');}ok('native.management-list-real-method-customer-intersection-shared-count-page');
 // Isolated admin router construction records transport capability but never calls it.
 const a=vm.createContext({Buffer,Object,Array,console});for(const d of admin.decls.filter(d=>d.import==='zod'))a[d.name]=Z;loadTree(admin,a,'channelMaterialCreateFields');load(admin,a,'__cuh_20261115_bxz_admin');const registry=a.__cuh_20261115_bxz_admin.CUSTOMER_UPLOAD_HISTORY_INPUT_SCHEMAS;for(const name of METHODS)assert(registry['channelInventory.'+name],'ADMIN_REGISTRY');ok('admin.shared-exact2-schema-registry');
 const calls=[];a.publicProcedure={input:s=>({mutation:fn=>({transport:'mutation',schema:s,run:fn})})};a.businessInputSchema=method=>registry[method];a.forwardBusinessMethod=(ctx,input,cap)=>{calls.push({ctx,input,cap});return 'MOCK_TRANSPORT';};load(admin,a,'customerUploadProblemsExportMutation');const command=a.customerUploadProblemsExportMutation();assert(command.transport==='mutation','EXPORT_MUTATION');command.run({ctx:{mock:true},input:{mock:true}});assert(calls[0].cap.method==='channelInventory.customerUploadProblemsExport'&&calls[0].cap.mode==='read','READONLY_FIXED_METHOD');ok('admin.export-fixed-read-authorized-mutation-no-selector-mock-transport');
 for(const name of METHODS){const n=property(admin,'channelInventoryBusinessRouter',name);const txt=n.getText(admin.sf);assert(name===METHODS[0]?txt.includes('customerUploadProblemsExportMutation()'):txt.includes('businessMutation("channelInventory.customerUploadRepairPrepareConfirmation", "inventory")'),'ADMIN_EXACT_ROOT '+name);}
 ok('admin.root-router-exact2-no-generic-selector');
 result.passed=true;fs.writeFileSync(allowedWrite(path.join(out,'vm-tests.json')),JSON.stringify(result,null,2)+'\n');console.log('VM native offline tests passed:',result.tests.length);
}
main().catch(e=>{result.passed=false;result.error=e.stack;fs.writeFileSync(allowedWrite(path.join(out,'vm-tests.json')),JSON.stringify(result,null,2)+'\n');console.error(e.stack);process.exitCode=1;});
