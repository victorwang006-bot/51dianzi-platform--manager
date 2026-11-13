'use strict';
const C=require('./core.cjs');
const {fs,ts,path,sha,assert,read,walk,parse,uniqueNode,method,property,variable,refs,createMapper,applyPatches,moduleName}=C;
const esbuild=require('esbuild');
const SOURCE_PATHS={adminInput:'server/channelInventoryListBusinessInput.ts',adminBusiness:'server/businessRouter.ts',frontService:'client/src/business/platform/front-router-types/server/services/channelTeamInventory.ts',frontRouter:'client/src/business/platform/front-router-types/server/routers/channelInventory.ts'};
const PINNED={admin:'b1169a0f1c14c54fc3e2903c92d2a09c104708f6db783e3ea5ef9541357e2157',front:'aa3b208401045baac11bc7806e97b1332d63bc5e650c763ebaaa6c49dfeeb0c0'};
async function compile(repo,key){const relative=SOURCE_PATHS[key],file=path.join(repo,relative),text=read(file),result=await esbuild.transform(text,{loader:'ts',format:'esm',target:'es2020',minify:false,sourcefile:relative,sourcemap:'external',legalComments:'none'});const p=parse(file+'.compiled.js',result.code,moduleName(relative));p.sourceFile=file;p.module=moduleName(relative);return {p,meta:{sourceFile:file,sourceSha256:sha(text),compiledSha256:sha(result.code),sourceMapSha256:sha(result.map),compiler:'esbuild.transform',esbuildVersion:esbuild.version,options:{loader:'ts',format:'esm',target:'es2020',minify:false,bundle:false},inputFiles:[file],entrypointExecuted:false},map:result.map};}
function sourceEvidence(c,e){return {...c.meta,compiledStart:e.referenceStart,compiledEnd:e.referenceEnd,mappedSha256:sha(e.text),identifierOnlyEdits:e.identifierOnlyEdits,bindings:e.bindings};}
async function make({repo,baselineDir}){
 const compiled={};for(const key of Object.keys(SOURCE_PATHS))compiled[key]=await compile(repo,key);
 const baselines={};for(const key of ['admin','front']){const file=path.join(baselineDir,key+'-index.js'),bytes=fs.readFileSync(file);assert(sha(bytes)===PINNED[key],'LIVE_BASELINE_PIN '+key);const p=parse(file,bytes.toString('utf8'));assert(bytes.equals(Buffer.from(p.text)),'BASELINE_UTF8');baselines[key]=p;}
 const results={},selections={};
 for(const key of ['admin','front']){
  const old=baselines[key],patches=[],records=[];
  const sources=key==='admin'?['adminInput','adminBusiness']:['frontService','frontRouter'];
  const maps=Object.fromEntries(sources.map(k=>[k,createMapper(old,compiled[k].p,repo,k==='frontService'?['customerTeamInventoryBindingPredicate']:[],key==='admin'?['withCurrentBusinessAuthorization','forwardBusinessMethod','channelInventoryListBusinessInputSchema']:['createChannelTeamInventoryService','createChannelInventoryRouter'])]));
  function patch(name,start,end,sourceKey,node,options={}){const e=maps[sourceKey].extract(node,options),text=options.prefix?options.prefix+e.text+(options.suffix||''):e.text;const evidence=sourceEvidence(compiled[sourceKey],e);patches.push({name,start,end,text,source:evidence});records.push({name,text:e.text,...e,sourceKey});}
  function replace(name,oldNode,sourceKey,newNode,options={}){patch(name,oldNode.getStart(old.sf),oldNode.end,sourceKey,newNode,options);}
  if(key==='admin'){
   const input=compiled.adminInput.p,business=compiled.adminBusiness.p;
   const oldSchema=old.byName('channelInventoryListBusinessInputSchema').node,newSchema=input.byName('channelInventoryListBusinessInputSchema').node;
   const sourceCustomer=uniqueNode(newSchema,n=>ts.isPropertyAssignment(n)&&n.name?.text==='customerId','adminSchema.customerId');
   assert(!oldSchema.getText(old.sf).includes('customerId'),'BASELINE_CUSTOMER_ALREADY_PRESENT');
   const anchor=uniqueNode(oldSchema,n=>ts.isPropertyAssignment(n)&&n.name?.text==='channelId','adminSchema.channelId');
   patch('channelInventoryListBusinessInputSchema.customerId',anchor.end,anchor.end,'adminInput',sourceCustomer,{prefix:',\n  '});
   const oldProjection=variable(old,'withCurrentBusinessAuthorization','officialReadProjection'),freshProjection=variable(business,'withCurrentBusinessAuthorization','officialReadProjection');
   replace('withCurrentBusinessAuthorization.officialReadProjection',oldProjection.initializer,'adminBusiness',freshProjection.initializer,{locals:Object.fromEntries(['officialInventoryPermissions','capability','contextProjection','profileRead','nativeReadMethods'].map(x=>[x,x]))});
   const condition=p=>uniqueNode(p.byName('withCurrentBusinessAuthorization').node,n=>ts.isIfStatement(n)&&n.expression.getText(p.sf).includes('isCustomerSupplyBusinessMethod'),'customer-scope-condition').expression;
   replace('withCurrentBusinessAuthorization.customerScopeIntersection',condition(old),'adminBusiness',condition(business),{locals:{capability:'capability',scope:'scope'}});
   const freshCustomer=variable(business,'forwardBusinessMethod','customerInventory');
   const oldCall=uniqueNode(old.byName('forwardBusinessMethod').node,n=>ts.isCallExpression(n)&&n.expression.getText(old.sf)==='withCurrentBusinessAuthorization','admin-forward-call');
   const returnStatement=oldCall.parent;
   assert(ts.isReturnStatement(returnStatement),'FORWARD_RETURN_SLOT');
   patch('forwardBusinessMethod.customerInventoryContext',returnStatement.getStart(old.sf),returnStatement.getStart(old.sf),'adminBusiness',freshCustomer,{prefix:'const ',suffix:';\n    ',locals:{params:'params',capability:'capability'}});
   const newCall=uniqueNode(business.byName('forwardBusinessMethod').node,n=>ts.isCallExpression(n)&&n.expression.getText(business.sf)==='withCurrentBusinessAuthorization','source-forward-call');
   replace('forwardBusinessMethod.customerInventoryAuthorizationArgument',oldCall.arguments[2],'adminBusiness',newCall.arguments[2],{locals:{capability:'capability',customerInventory:'customerInventory'}});
   const proof=uniqueNode(business.byName('forwardBusinessMethod').node,n=>ts.isIfStatement(n)&&n.expression.getText(business.sf)==='customerInventory','source-result-proof');
   const listOuter=p=>uniqueNode(p.byName('forwardBusinessMethod').node,n=>ts.isIfStatement(n)&&n.expression.getText(p.sf).startsWith('capability.method === "channelInventory.listTeamMaterials"'),'list-result-outer');
   const oldListOuter=listOuter(old),sourceListOuter=listOuter(business);
   replace('forwardBusinessMethod.customerInventoryNonObjectGuardCondition',oldListOuter.expression,'adminBusiness',sourceListOuter.expression,{locals:{capability:'capability',customerInventory:'customerInventory',result:'result'}});
   const resultGuard=uniqueNode(sourceListOuter,n=>ts.isIfStatement(n)&&n.expression.getText(business.sf).startsWith('!result'),'source-nonobject-guard');
   const oldPage=variable(old,'forwardBusinessMethod','page');
   patch('forwardBusinessMethod.customerInventoryNonObjectGuard',oldPage.parent.parent.getStart(old.sf),oldPage.parent.parent.getStart(old.sf),'adminBusiness',resultGuard,{locals:{result:'result'}});
   const names=variable(old,'forwardBusinessMethod','names');
   patch('forwardBusinessMethod.customerInventoryResultProof',names.parent.parent.getStart(old.sf),names.parent.parent.getStart(old.sf),'adminBusiness',proof,{suffix:'\n            ',prefix:'',locals:{result:'result',params:'params',customerInventory:'customerInventory',page:'page'}});
  }else{
   const service=compiled.frontService.p,router=compiled.frontRouter.p;
   const oldMethod=method(old,'createChannelTeamInventoryService','listTeamMaterials'),newMethod=method(service,'createChannelTeamInventoryService','listTeamMaterials');
   const localNames={input:'input',scope:'scope',tx:'tx',predicates:'predicates',bindingCount:'bindingCount',row:'row',company:'company2',leader:'leader'};
   const findIf=(node,p,match,label)=>uniqueNode(node,n=>ts.isIfStatement(n)&&match(n.expression.getText(p.sf)),label);
   const oldAllowed=uniqueNode(oldMethod,n=>ts.isVariableDeclaration(n)&&n.name?.text==='allowed','old-allowed').initializer;
   const newAllowed=uniqueNode(newMethod,n=>ts.isVariableDeclaration(n)&&n.name?.text==='allowed','new-allowed').initializer;
   replace('listTeamMaterials.allowedCustomerId',oldAllowed,'frontService',newAllowed);
   const validation=findIf(newMethod,service,t=>t.startsWith('input.customerId')&&t.includes('Number.isSafeInteger'),'customer-id-validation');
   const oldIndustry=findIf(oldMethod,old,t=>t.startsWith('input.industryCode')&&t.includes('safeParse'),'old-industry-validation');
   patch('listTeamMaterials.validateCustomerId',oldIndustry.getStart(old.sf),oldIndustry.getStart(old.sf),'frontService',validation,{prefix:'',suffix:'\n      ',locals:localNames});
   const sourceBinding=uniqueNode(newMethod,n=>ts.isVariableDeclaration(n)&&n.name?.text==='bindingCount','source-binding-count');
   const customerBlock=findIf(newMethod,service,t=>t==='input.customerId !== void 0','source-customer-block');
   const oldChannel=findIf(oldMethod,old,t=>t==='input.channelId !== void 0','old-channel-block');
   const bindingExtract=maps.frontService.extract(customerBlock,{locals:localNames});
   const bindingVar=maps.frontService.extract(sourceBinding,{locals:localNames});
   patches.push({name:'listTeamMaterials.customerCRMAndBindingIntersection',start:oldChannel.getStart(old.sf),end:oldChannel.getStart(old.sf),text:'let '+bindingVar.text+';\n        '+bindingExtract.text+'\n        ',source:sourceEvidence(compiled.frontService,bindingExtract)});
   const newChannel=findIf(newMethod,service,t=>t==='input.channelId !== void 0','source-channel-block');
   const channelExtract=maps.frontService.extract(newChannel,{locals:localNames});
   patches.push({name:'listTeamMaterials.customerChannelFilterWithOriginalGlobalFallback',start:oldChannel.getStart(old.sf),end:oldChannel.end,text:'if (input.customerId !== undefined) {\n'+channelExtract.text+'\n} else {\n'+oldChannel.getText(old.sf)+'\n}',source:{...sourceEvidence(compiled.frontService,channelExtract),baselineFallbackSha256:sha(oldChannel.getText(old.sf)),astComposition:'fixed customer branch, source exact channel AST, original global channel AST'}});
   const integrity=findIf(newMethod,service,t=>t.startsWith('input.customerId')&&t.includes('row.canViewSource'),'customer-company-integrity');
   const oldPush=uniqueNode(oldMethod,n=>ts.isCallExpression(n)&&n.expression.getText(old.sf)==='projected.push','old-projection-push');
   patch('listTeamMaterials.customerCompanyIntegrity',oldPush.parent.getStart(old.sf),oldPush.parent.getStart(old.sf),'frontService',integrity,{locals:localNames});
   const sourceCompany=uniqueNode(newMethod,n=>ts.isPropertyAssignment(n)&&n.name?.text==='company','source-company-projection');
       const sourceCompanyExtract=maps.frontService.extract(sourceCompany,{locals:localNames});
       const oldObject=oldPush.arguments[0];assert(ts.isObjectLiteralExpression(oldObject),'OLD_PROJECTED_OBJECT');
       const before=oldObject.properties[0].getStart(old.sf);
       patches.push({name:'listTeamMaterials.authorizedCompanyProjection',start:before,end:before,text:sourceCompanyExtract.text+',\n            ',source:{...sourceEvidence(compiled.frontService,sourceCompanyExtract),astComposition:'additive source-authorized company field in global and customer modes; original scope and DTO fields retained'}});
       const sourceResult=uniqueNode(newMethod,n=>ts.isSpreadAssignment(n)&&n.expression.getText(service.sf).includes('bindingCount'),'source-customer-result-proof');
       const oldReturn=uniqueNode(oldMethod,n=>ts.isReturnStatement(n)&&n.expression&&ts.isObjectLiteralExpression(n.expression)&&n.expression.properties.some(p=>p.name?.text==='canFilterSource'),'old-page-return').expression;
       const at=oldReturn.properties[oldReturn.properties.length-1].end;
   patch('listTeamMaterials.customerResultProof',at,at,'frontService',sourceResult,{prefix:', ',locals:localNames});
   const helper=service.byName('customerTeamInventoryBindingPredicate').node;
   patch('customerTeamInventoryBindingPredicate',old.text.length,old.text.length,'frontService',helper,{prefix:'\n\n// customer-inventory source-bound helper (offline candidate)\n',suffix:'\n',renameDeclaration:true});
   const freshProp=property(router,'createChannelInventoryRouter','listTeamMaterials'),oldProp=property(old,'createChannelInventoryRouter','listTeamMaterials');
   const schemaOwner=router.decls.find(d=>d.name==='teamMaterialsSchema')?.node||freshProp;
   const customer=uniqueNode(schemaOwner,n=>ts.isPropertyAssignment(n)&&n.name?.text==='customerId','front-list.customerId');
   const anchor=uniqueNode(oldProp,n=>ts.isPropertyAssignment(n)&&n.name?.text==='channelId','front-list.channelId');
   assert(!oldProp.getText(old.sf).includes('customerId'),'BASELINE_FRONT_CUSTOMER_PRESENT');
   patch('createChannelInventoryRouter.listTeamMaterials.customerId',anchor.end,anchor.end,'frontRouter',customer,{prefix:', '});
  }
  const applied=applyPatches(old.text,patches),candidate=parse(key+'-candidate.mjs',applied.text);
  // Every inserted global must resolve to the exact existing/native or explicitly added declaration.
  const captures=[];
  for(const p of applied.manifest){const rangeNodes=[];walk(candidate.sf,n=>{if(ts.isIdentifier(n)&&n.getStart(candidate.sf)>=p.newStart&&n.end<=p.newEnd)rangeNodes.push(n);});const expected=new Set(p.source.bindings.map(b=>b.runtimeName));for(const n of rangeNodes){if(!C.isRef){} const d=candidate.symbols.get(candidate.symbolAt(n));if(d&&expected.has(n.text))assert(d===candidate.byName(n.text),'GLOBAL_CAPTURE '+n.text);}captures.push({slot:p.name,expectedNativeGlobals:[...expected],nativeBindingsPreserved:true});}
  const protections=[];for(const d of old.decls){if(d.import)continue;const start=d.node.getStart(old.sf),end=d.node.end;if(applied.manifest.some(p=>p.start<end&&p.end>start||p.start===p.end&&p.start>start&&p.start<end))continue;const fresh=candidate.decls.find(n=>n.name===d.name);assert(fresh&&fresh.node.getText(candidate.sf)===d.node.getText(old.sf),'UNRELATED_DECLARATION_CHANGED '+d.name);protections.push({name:d.name,module:d.module,sha256:sha(d.node.getText(old.sf))});}
  selections[key]=records;
  results[key]={text:applied.text,old,candidate,manifest:{baseline:{file:old.file,sha256:PINNED[key],bytes:Buffer.byteLength(old.text)},candidate:{sha256:sha(applied.text),bytes:Buffer.byteLength(applied.text)},patches:applied.manifest,inverse:applied.inverse,globalCaptureChecks:captures,unchangedDeclarationCount:protections.length,unchangedDeclarationDigest:sha(JSON.stringify(protections)),targetOwners:key==='admin'?['channelInventoryListBusinessInputSchema','withCurrentBusinessAuthorization','forwardBusinessMethod']:['createChannelTeamInventoryService.listTeamMaterials','createChannelInventoryRouter.listTeamMaterials.customerId','customerTeamInventoryBindingPredicate'],nonTargetDeclarationsByteIdentical:true},maps};
 }
 return {results,compiled,baselines,selections};
}
module.exports={make,compile,SOURCE_PATHS,PINNED};
