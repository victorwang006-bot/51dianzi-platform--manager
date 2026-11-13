#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
import {build} from 'esbuild';
import {tree,nodes} from './tests/admin-candidate-helper.mjs';
export const O='/home/ubuntu/task-recovery/inquiry-reception-release-20261113/admin-material-overlay';
const A='/home/ubuntu/task-recovery/inquiry-reception-release-20261113/admin-static';
const L='/home/ubuntu/task-recovery/inquiry-reception-release-20261113/live/admin-static';
const R='/home/ubuntu/work/manager';
const SOURCE=R+'/client/src/business/platform/client/src/components/channelInventory/FactoryMaterialPublish.tsx';
const SHARED=R+'/client/src/business/platform/shared/channelFactoryPublication.ts';
const MAIN=L+'/assets/20261106-one-click-review-images-v11-admin-4ebf4856da0f/index-demand-navigation-bb20946d992bbfe5.js';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const assert=(x,m)=>{if(!x)throw Error(m)};
const pins=new Map();
function pinned(f){const b=fs.readFileSync(f);if(pins.has(f))assert(pins.get(f)===sha(b),'INPUT_DRIFT_READ:'+f);pins.set(f,sha(b));return b.toString('utf8');}
function write(f,v){fs.mkdirSync(path.dirname(O+'/'+f),{recursive:true});fs.writeFileSync(O+'/'+f,typeof v==='string'?v:JSON.stringify(v,null,2)+'\n');}
const textOf=(t,n)=>n.getText(t.ast);
const prop=(n,k)=>ts.isPropertyAssignment(n)&&(ts.isStringLiteral(n.name)?n.name.text:n.name.getText())===k;
function one(a,m){assert(a.length===1,m+':'+a.length);return a[0];}
function locateHostMaterial(t){
 const host=t.declarations.get('__admin_workbench_host_v1');assert(host,'ACTUAL_HOST_FACTORY');
 const hook=one(nodes(host,n=>ts.isFunctionDeclaration(n)&&nodes(n,x=>prop(x,'data-factory-publish-action')).length),'HOST_HOOK_BY_ACTION');
 const declaration=n=>{const s=t.checker.getSymbolAtLocation(n);return one(s?.declarations??[],'HOST_LEXICAL:'+n.text);};
 const dialogCall=one(nodes(hook,n=>ts.isCallExpression(n)&&n.arguments.length>=2&&ts.isIdentifier(n.arguments[0])&&ts.isObjectLiteralExpression(n.arguments[1])&&nodes(n.arguments[1],x=>prop(x,'onPublished')).length),'HOST_CONFIRM_MAPPING');
 const confirm=declaration(dialogCall.arguments[0]);
 const disabledCall=one(nodes(confirm,n=>ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.arguments[0]?.getText(t.ast).endsWith('.row')&&n.arguments.length===2),'HOST_DISABLED');
 const priceCall=one(nodes(confirm,n=>ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.arguments[0]?.getText(t.ast).endsWith('.row.price')),'HOST_PRICE');
 const request=one(nodes(confirm,n=>prop(n,'requestId')),'HOST_REQUEST').initializer.expression;
 const errorCall=one(nodes(confirm,n=>ts.isCallExpression(n)&&n.arguments[1]&&ts.isStringLiteral(n.arguments[1])&&n.arguments[1].text==='发布结果尚未确认。'),'HOST_ERROR');
 const definitiveCall=one(nodes(confirm,n=>ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.arguments.length===1&&ts.isPrefixUnaryExpression(n.parent)&&n.parent.operator===ts.SyntaxKind.ExclamationToken),'HOST_DEFINITIVE');
 const uiCall=one(nodes(confirm,n=>ts.isCallExpression(n)&&n.arguments.length>=2&&ts.isIdentifier(n.arguments[0])&&ts.isObjectLiteralExpression(n.arguments[1])&&nodes(n.arguments[1],x=>prop(x,'confirmLabel')).length),'HOST_ORIGINAL_CONFIRMATION');
 const mutation=one(nodes(confirm,n=>ts.isCallExpression(n)&&n.expression.getText(t.ast).endsWith('.channelInventory.publishFactoryMaterial.useMutation')),'HOST_DOMAIN_MUTATION');
 const trpcNode=mutation.expression.expression.expression.expression;
 assert(declaration(trpcNode).initializer?.getText(t.ast)==='__live.trpc','HOST_BUSINESS_TRPC_BRIDGE');
 const state=one(nodes(hook,n=>ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.parent?.name&&ts.isArrayBindingPattern(n.parent.name)).slice(0,1),'HOST_STATE');
 const stateDecl=declaration(state.expression),reactNode=stateDecl.initializer.expression;
 assert(stateDecl.initializer.name.text==='useState'&&declaration(reactNode).initializer?.getText(t.ast)==='__live.React','HOST_EXISTING_REACT');
 const jsxDecl=declaration(dialogCall.expression);assert(jsxDecl.initializer?.getText(t.ast)==='__live.jsx.jsx','HOST_EXISTING_JSX');
 const jsxS=one(nodes(host,n=>ts.isVariableDeclaration(n)&&n.initializer?.getText(t.ast)==='__live.jsx.jsxs'),'HOST_JSXS').name.text;
 const fragment=one(nodes(host,n=>ts.isVariableDeclaration(n)&&n.initializer?.getText(t.ast)==='__live.jsx.Fragment'),'HOST_FRAGMENT').name.text;
 const disabled=declaration(disabledCall.expression),price=declaration(priceCall.expression),ui=declaration(uiCall.arguments[0]);
 const bindings={React:reactNode.text,jsx:`{jsx:${dialogCall.expression.text},jsxs:${jsxS},Fragment:${fragment}}`,trpc:trpcNode.text,InventoryConfirmation:ui.name.text,inventoryRequestId:request.text,inventoryError:errorCall.expression.text,inventoryDefinitiveFailure:definitiveCall.expression.text};
 const symbol=t.checker.getSymbolAtLocation(hook.name);const callers=nodes(host,n=>ts.isIdentifier(n)&&t.checker.getSymbolAtLocation(n)===symbol&&ts.isCallExpression(n.parent));assert(callers.length===1,'ONE_REAL_HOST_HOOK_CALL');
 const outer=host.initializer.arguments[0];assert(ts.isObjectLiteralExpression(outer),'HOST_EXISTING_PROVIDER_BRIDGE_OBJECT');
 assert(one(outer.properties.filter(n=>prop(n,'trpc')),'HOST_OUTER_TRPC').initializer.getText(t.ast)==='H','HOST_H_IMPORT_SINGLETON');
 assert(one(outer.properties.filter(n=>prop(n,'React')),'HOST_OUTER_REACT').initializer.getText(t.ast)==='c','HOST_OUTER_REACT_C');
 return {domain:'actual-host',getter:'__d51_material_host_get',hook:hook.name.text,confirm:confirm.name.text,disabled:disabled.name.text,price:price.name.text,bindings,decls:new Map([hook,confirm,disabled,price].map(n=>[n.name.text,n])),insertion:disabled.getStart(t.ast),proof:{domain:'actual-host',hook:hook.name.text,confirmation:confirm.name.text,disabled:disabled.name.text,price:price.name.text,bindings,hostFactory:'__admin_workbench_host_v1',actualHookCaller:callers[0].parent.getText(t.ast),outerExistingBridge:outer.getText(t.ast),preservedLexicals:[ui,declaration(request),declaration(errorCall.expression),declaration(definitiveCall.expression)].map(n=>({name:n.name.text,start:n.getStart(t.ast),end:n.end,sha256:sha(textOf(t,n)),text:textOf(t,n)}))}};
}
export function locateMaterial(text){
 const t=tree(text,'actual-material.js');
 const functions=[...t.declarations.values()].filter(ts.isFunctionDeclaration);
 const hook=one(functions.filter(n=>nodes(n,x=>prop(x,'data-factory-publish-action')).length),'HOOK_BY_DATA_ACTION');
 const calls=nodes(hook,ts.isCallExpression);
 const dialogCall=one(calls.filter(n=>ts.isPropertyAccessExpression(n.expression)&&/jsx|jsxs/.test(n.expression.name.text)&&ts.isIdentifier(n.arguments[0])&&ts.isObjectLiteralExpression(n.arguments[1])&&nodes(n.arguments[1],x=>prop(x,'onPublished')).length),'CONFIRM_BY_JSX_MAPPING');
 const confirm=t.declarations.get(dialogCall.arguments[0].text);assert(confirm&&ts.isFunctionDeclaration(confirm),'CONFIRM_DECLARATION');
 const mutationCall=one(nodes(confirm,n=>ts.isCallExpression(n)&&n.expression.getText(t.ast).endsWith('.channelInventory.publishFactoryMaterial.useMutation')),'ACTUAL_DOMAIN_MUTATION');
 const trpc=mutationCall.expression.expression.expression.expression.getText(t.ast);
 const disabled=one(nodes(confirm,n=>ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.arguments[0]?.getText(t.ast).endsWith('.row')&&n.arguments.length===2),'DISABLED_BY_ROW_CALL').expression.text;
 const price=one(nodes(confirm,n=>ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.arguments[0]?.getText(t.ast).endsWith('.row.price')),'PRICE_BY_ROW_PRICE').expression.text;
 const request=one(nodes(confirm,n=>prop(n,'requestId')),'REQUEST_PROPERTY').initializer.expression.text;
 const error=one(nodes(confirm,n=>ts.isCallExpression(n)&&n.arguments[1]&&ts.isStringLiteral(n.arguments[1])&&n.arguments[1].text==='发布结果尚未确认。'),'ERROR_BY_FALLBACK').expression.text;
 const definitive=one(nodes(confirm,n=>ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.arguments.length===1&&ts.isPrefixUnaryExpression(n.parent)&&n.parent.operator===ts.SyntaxKind.ExclamationToken),'DEFINITIVE_BY_LOCK').expression.text;
 const ui=one(nodes(confirm,n=>ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='jsxs'&&ts.isIdentifier(n.arguments[0])&&ts.isObjectLiteralExpression(n.arguments[1])&&nodes(n.arguments[1],x=>prop(x,'confirmLabel')).length),'INVENTORY_CONFIRMATION_JSX').arguments[0].text;
 const react=one([...new Set(nodes(hook,n=>ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='useState').map(n=>n.expression.expression.text))],'REACT_BINDING');
 const jsx=dialogCall.expression.expression.text;
 for(const k of [disabled,price,request,error,definitive,ui])assert(t.declarations.has(k),'UNBOUND_LOCAL:'+k);
 for(const k of [react,jsx,trpc])assert(t.imports.has(k),'UNBOUND_IMPORT:'+k);
 assert(t.imports.get(trpc).export==='F','BUSINESS_IMPORT_NOT_F');
 assert(t.imports.get(react).export==='r'&&t.imports.get(jsx).export==='j','REACT_JSX_ORIGIN');
 const locs=nodes(t.ast,n=>prop(n,'data-loc')&&ts.isStringLiteral(n.initializer)&&n.initializer.text.includes('/FactoryMaterialPublish.tsx:'));
 assert(locs.length===18,'EXPECTED_18_MATERIAL_DATA_LOCS:'+locs.length);
 const bindings={React:react,jsx,trpc,InventoryConfirmation:ui,inventoryRequestId:request,inventoryError:error,inventoryDefinitiveFailure:definitive};
 const top={domain:'original-data-loc',getter:'__d51_material_get',hook:hook.name.text,confirm:confirm.name.text,disabled,price,bindings,decls:t.declarations,insertion:t.ast.statements.filter(ts.isImportDeclaration).at(-1).end,proof:{domain:'original-data-loc',hook:hook.name.text,confirmation:confirm.name.text,disabled,price,bindings,dataLocCount:locs.length,hookSha256:sha(textOf(t,hook)),confirmationSha256:sha(textOf(t,confirm)),imports:Object.fromEntries([react,jsx,trpc].map(k=>[k,t.imports.get(k)])),preservedLexicals:[ui,request,error,definitive].map(k=>({name:k,start:t.declarations.get(k).getStart(t.ast),end:t.declarations.get(k).end,sha256:sha(textOf(t,t.declarations.get(k))),text:textOf(t,t.declarations.get(k))}))}};
 return {t,domains:[top,locateHostMaterial(t)]};
}
function apply(before,edits,id){
 edits.sort((a,b)=>a.start-b.start||a.end-b.end);for(let i=1;i<edits.length;i++)assert(edits[i].start>=edits[i-1].end,'OVERLAP:'+id);
 let after='',cursor=0;const out=[];for(const e of edits){assert(before.slice(e.start,e.end)===e.before,'EDIT_CAS:'+e.reason);after+=before.slice(cursor,e.start);const outStart=after.length;after+=e.text;out.push({...e,outStart,outEnd:after.length,beforeSha256:sha(e.before),afterSha256:sha(e.text)});cursor=e.end;}after+=before.slice(cursor);
 let inverse=after;for(const e of [...out].reverse()){assert(inverse.slice(e.outStart,e.outEnd)===e.text,'INVERSE_CAS');inverse=inverse.slice(0,e.outStart)+e.before+inverse.slice(e.outEnd);}assert(inverse===before,'FULLBYTES_INVERSE');
 const partitions=[];cursor=0;let offset=0;for(const e of out){const old=before.slice(cursor,e.start),now=after.slice(cursor+offset,e.outStart);assert(old===now,'UNCHANGED_PARTITION');partitions.push({beforeStart:cursor,beforeEnd:e.start,afterStart:cursor+offset,afterEnd:e.outStart,sha256:sha(old)});offset+=e.text.length-e.before.length;cursor=e.end;}assert(before.slice(cursor)===after.slice(cursor+offset),'UNCHANGED_TAIL');partitions.push({beforeStart:cursor,beforeEnd:before.length,afterStart:cursor+offset,afterEnd:after.length,sha256:sha(before.slice(cursor))});
 return {after,proof:{id,beforeSha256:sha(before),afterSha256:sha(after),fullbytesInverse:true,unchangedPartition:true,partitions,edits:out}};
}
async function compile(){
 const source=pinned(SOURCE);pinned(SHARED);
 const runtimeImports=new Map([
 ['react','export default __live.React;export const {useState,useEffect,useRef}=__live.React;'],
 ['react/jsx-runtime','export const {jsx,jsxs,Fragment}=__live.jsx;'],
 ['../../../../../api/business-trpc','export const trpc=__live.trpc;'],
 ['./ChannelInventoryManagementPanel','export const InventoryConfirmation=__live.InventoryConfirmation;'],
 ['./management','export const {inventoryError,inventoryDefinitiveFailure,inventoryRequestId}=__live;'],
 ]);
 const result=await build({stdin:{contents:`export {factoryMaterialPublishDisabledReason,factoryMaterialReceptionLabel,factoryMaterialPublicPrice,useFactoryMaterialPublish,FactoryMaterialPublishConfirmation} from ${JSON.stringify(SOURCE)};`,resolveDir:R,sourcefile:'material-overlay-entry.mjs'},bundle:true,write:false,format:'iife',globalName:'__materialExports',platform:'browser',target:'es2020',jsx:'automatic',minify:true,metafile:true,plugins:[{name:'exact-material-source-lexical-bridge',setup(b){
  b.onResolve({filter:/.*/},args=>{if(runtimeImports.has(args.path))return {path:args.path,namespace:'bridge'};if(args.path==='zod')return null;if(args.path===SOURCE)return {path:SOURCE,namespace:'source'};if(args.importer===SOURCE&&args.path==='../../../../shared/channelFactoryPublication')return {path:SHARED,namespace:'source'};if(args.namespace==='source')throw Error('NONLOCAL_MATERIAL_IMPORT:'+args.path);});
  b.onLoad({filter:/.*/,namespace:'bridge'},args=>({contents:runtimeImports.get(args.path),loader:'js'}));
  b.onLoad({filter:/.*/,namespace:'source'},args=>({contents:pinned(args.path),loader:args.path.endsWith('tsx')?'tsx':'ts',resolveDir:path.dirname(args.path)}));
 }}]});
 assert(result.outputFiles.length===1,'SINGLE_LOCAL_IIFE');
 for(const key of Object.keys(result.metafile.inputs)){assert(!/node_modules\/(?:react|@tanstack|@trpc)\//.test(key),'DUPLICATE_RUNTIME:'+key);if(fs.existsSync(R+'/'+key))pinned(R+'/'+key);else if(path.isAbsolute(key)&&fs.existsSync(key))pinned(key);}
 const code=result.outputFiles[0].text;write('factory-material.js',code);write('factory-material.json',{sha256:sha(code),metafile:result.metafile,entry:SOURCE,sourceSha256:sha(source),exports:['factoryMaterialPublishDisabledReason','factoryMaterialReceptionLabel','factoryMaterialPublicPrice','useFactoryMaterialPublish','FactoryMaterialPublishConfirmation'],runtimePolicy:'Only existing React c / JSX e / business-domain H / InventoryConfirmation Cm / management helpers. Zod is pure bundled shared schema. No QueryClient or BusinessScope created.'});return code;
}
function importSpecs(text){const t=tree(text);return [...new Set(nodes(t.ast,n=>(ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier||ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword).map(n=>n.moduleSpecifier??n.arguments[0]).filter(ts.isStringLiteral).map(n=>n.text))];}
function htmlOverlay(before,relocations,wbInputs){
 const match=one([...before.matchAll(/<script\b[^>]*type=["']importmap["'][^>]*>(.*?)<\/script>/gs)],'ONE_IMPORTMAP');const oldMap=JSON.parse(match[1]),map=structuredClone(oldMap);
 const canon=(s,r)=>new URL(s,'https://offline.invalid'+r).pathname;
 const resolve=(s,r,m)=>{const k=/^[/.]/.test(s)?canon(s,r):s;for(const sec of [...Object.keys(m.scopes??{}).filter(k=>r.startsWith(k)).sort((a,b)=>b.length-a.length).map(k=>m.scopes[k]),m.imports??{}]){if(Object.hasOwn(sec,k))return sec[k];}return k;};
 for(const sec of [map.imports,...Object.values(map.scopes??{})])for(const [k,v]of Object.entries(sec))if(relocations[v])sec[k]=relocations[v];
 const resolution=[];for(const inp of wbInputs){const oldUrl='/'+inp.targetRelative,newUrl=relocations[oldUrl];map.imports[oldUrl]=newUrl;map.scopes??={};const sec={...(map.scopes[oldUrl]??{})};for(const spec of importSpecs(inp.before)){const oldTarget=resolve(spec,oldUrl,oldMap);sec[/^[/.]/.test(spec)?canon(spec,newUrl):spec]=relocations[oldTarget]??oldTarget;}map.scopes[newUrl]=sec;for(const spec of importSpecs(inp.before)){const oldTarget=resolve(spec,oldUrl,oldMap),target=resolve(spec,newUrl,map);assert(target===(relocations[oldTarget]??oldTarget),'RELATIVE_RELOCATION:'+spec);resolution.push({oldRef:oldUrl,newRef:newUrl,spec,oldTarget,target});}}
 for(const [k,v] of Object.entries(oldMap.imports))assert(map.imports[k]===(relocations[v]??v),'OLD_IMPORT_KEY:'+k);
 for(const [s,sec]of Object.entries(oldMap.scopes??{}))for(const [k,v]of Object.entries(sec))assert(map.scopes[s][k]===(relocations[v]??v),'OLD_SCOPE_KEY:'+s+':'+k);
 const start=match.index+match[0].indexOf(match[1]);const p=apply(before,[{start,end:start+match[1].length,before:match[1],text:JSON.stringify(map),reason:'existing-importmap-current-workbench-only-relocation'}],'html');
 return {...p,extra:{oldMap,map,resolutionProof:resolution,oldImportmapKeysScopesRetained:true,cssUnchanged:true,allNonImportmapBytesUnchanged:true}};
}
function singletonProof(main){const t=tree(main,'actual-domain-runtime.js');const exportBinding=key=>{const n=one(nodes(t.ast,n=>ts.isExportSpecifier(n)&&n.name.text===key),'RUNTIME_EXPORT:'+key);return n.propertyName?.text??n.name.text;};const business=exportBinding('F'),personal=exportBinding('V');assert(business!==personal,'BUSINESS_PERSONAL_DISTINCT');const businessDecl=t.declarations.get(business),personalDecl=t.declarations.get(personal);assert(businessDecl?.initializer?.getText(t.ast)==='sd()'&&personalDecl?.initializer?.getText(t.ast)==='sd()','EXISTING_SINGLETON_INITIALIZERS');const factory=one([...t.declarations.values()].filter(n=>ts.isFunctionDeclaration(n)&&n.getText(t.ast).includes(business+'.createClient')),'EXISTING_BUSINESS_CLIENT_FACTORY');const link=one(nodes(factory,n=>ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text!==business&&n.expression.text!=='sd'),'BUSINESS_LINK');const linkDecl=t.declarations.get(link.expression.text);assert(linkDecl,'BUSINESS_LINK_DECL');const linkText=textOf(t,linkDecl);assert(/business|scope|api/.test(linkText),'BUSINESS_LINK_EVIDENCE');return {runtimeFile:MAIN,runtimeSha256:sha(main),business:{importLocal:'H',export:'F',singleton:business,declaration:textOf(t,businessDecl),clientFactory:textOf(t,factory),linkBinding:link.expression.text,linkSha256:sha(linkText),linkText},personal:{importLocal:'oi',export:'V',singleton:personal,declaration:textOf(t,personalDecl)},distinctExistingSingletons:true};}
async function main(){
 fs.mkdirSync(O,{recursive:true});
 const manifestText=pinned(A+'/files.admin-static.json'),manifest=JSON.parse(manifestText);
 for(const f of manifest)assert(sha(Buffer.from(pinned(f.file)))===f.sha256,'MANIFEST_SHA:'+f.file);
 const wb=manifest.filter(f=>f.kind==='asset'&&path.basename(f.targetRelative).startsWith('BusinessWorkbenchPage'));assert(wb.length===2,'TWO_CURRENT_WB');
 const html=one(manifest.filter(f=>f.kind==='html'&&f.targetRelative==='index.html'),'CURRENT_HTML');
 const code=await compile(),domain=singletonProof(pinned(MAIN));
 const records=[],proofs=[],relocations={},wbInputs=[];
 for(let idx=0;idx<wb.length;idx++){
  const inp=wb[idx],before=pinned(inp.file),loc=locateMaterial(before),edits=[];
  for(const domain of loc.domains){
   for(const [old,method]of [[domain.disabled,'factoryMaterialPublishDisabledReason'],[domain.price,'factoryMaterialPublicPrice'],[domain.hook,'useFactoryMaterialPublish'],[domain.confirm,'FactoryMaterialPublishConfirmation']]){const n=domain.decls.get(old);edits.push({start:n.getStart(loc.t.ast),end:n.end,before:textOf(loc.t,n),text:`function ${old}(...args){return ${domain.getter}().${method}(...args)}`,reason:domain.domain+':exact-source-function:'+method});}
   const bridge=Object.entries(domain.bindings).map(([k,v])=>JSON.stringify(k)+':'+v).join(',');
   const instance=domain.getter+'_instance';
   const insertion=`\nlet ${instance};function ${domain.getter}(){if(!${instance}){const __materialBindings={${bridge}};${instance}=(function(__live){${code}\nreturn __materialExports;})(__materialBindings);}return ${instance};}\n`;
   edits.push({start:domain.insertion,end:domain.insertion,before:'',text:insertion,reason:domain.domain+':source-material-local-IIFE-existing-lexical-bridge'});
  }
  const p=apply(before,edits,'workbench-material-'+idx);assert(!tree(p.after).ast.parseDiagnostics.length,'PARSE_AFTER');
  const h=sha(p.after),relative='assets/BusinessWorkbenchPage-material-reception-'+idx+'-'+h+'.js';write('candidate/'+relative,p.after);
  records.push({file:O+'/candidate/'+relative,targetRelative:relative,kind:'asset',sha256:h,beforeSha256:inp.sha256,replacesTargetRelative:inp.targetRelative});relocations['/'+inp.targetRelative]='/'+relative;
  proofs.push({...p.proof,inputFile:inp.file,outputFile:records.at(-1).file,bindingEvidence:loc.domains.map(d=>d.proof),originalImportsPreserved:true,oldFactoryListAndOwnerPermissionProvenancePreserved:true});wbInputs.push({...inp,before});
 }
 const hp=htmlOverlay(pinned(html.file),relocations,wbInputs);write('candidate/index.html',hp.after);records.push({file:O+'/candidate/index.html',targetRelative:'index.html',kind:'html',sha256:sha(hp.after),beforeSha256:html.sha256});write('html-material-relocation-proof.json',{...hp.proof,...hp.extra,inputFile:html.file,outputFile:O+'/candidate/index.html'});
 // Full CAS of every manifest/source/runtime dependency read in this run, before emitting a usable manifest.
 for(const [f,h]of pins)assert(sha(fs.readFileSync(f))===h,'INPUT_DRIFT_FINAL_STOP_REBUILD:'+f);
 write('files.admin-material-overlay.json',records);
 write('build-admin-material-proof.json',{status:'BUILT',offlineOnly:true,inputManifestFile:A+'/files.admin-static.json',inputManifestSha256:sha(manifestText),inputRecords:manifest,sourceFiles:[...pins].filter(([f])=>f.startsWith(R+'/client/')).map(([file,sha256])=>({file,sha256})),allInputPins:[...pins].map(([file,sha256])=>({file,sha256})),relocations,domainSingletonProof:domain,proofs,htmlProofFile:O+'/html-material-relocation-proof.json',factoryFile:O+'/factory-material.js',scope:'Exactly four old FactoryMaterialPublish functions in each of original data-loc and actual ChannelInventoryHost lexical domains + source-local IIFEs + current importmap relocation. No CSS/API/DB/production/Git/SSH/browser. Existing content-addressed inputs retained.'});
 try{fs.unlinkSync(O+'/build-admin-material-error.json');}catch(e){if(e.code!=='ENOENT')throw e;}
 console.log(JSON.stringify({status:'BUILT',files:records.length,relocations}));
}
if(process.argv[1]===import.meta.filename||path.resolve(process.argv[1]??'')===new URL(import.meta.url).pathname)main().catch(e=>{write('build-admin-material-error.json',{status:'STOP_REBUILD',error:e.stack});try{fs.unlinkSync(O+'/files.admin-material-overlay.json');}catch{}console.error(e.stack);process.exitCode=1;});
