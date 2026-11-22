import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// Offline, captured-runtime incremental assembler. Never imports static-core or
// starts an API. Only this script and backend-candidate/ are writable by its owner.
const W = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function option(name, fallback) { const i=args.indexOf(name); return i<0 ? fallback : args[i+1]; }
const AR = path.resolve(option('--manager', '/home/ubuntu/work/channel-release-20261121-1837/manager'));
const FR = path.resolve(AR, '../platform');
const C = path.resolve(option('--capture', W+'/capture'));
const O = path.resolve(option('--out', W+'/backend-candidate'));
const compileOnly = args.includes('--compile-only');
const customerFile = option('--customer-runtime', undefined);
const req = createRequire(AR+'/package.json');
const ts = req('typescript'), esbuild = req('esbuild');
const H = value => createHash('sha256').update(value).digest('hex');
const read = file => fs.readFileSync(file,'utf8');
const assert = (value, message) => { if (!value) throw Error(message); };
const one = (items, message) => { assert(items.length===1,message+': '+items.length); return items[0]; };
assert(O===W+'/backend-candidate', 'Output must remain in owned backend-candidate/');
const pins={}, capturePins={}, snapshots=new Map();
function pin(file, capture=false) {
  const text=read(file), hash=H(text), store=capture?capturePins:pins;
  assert(!store[file] || store[file]===hash, 'Source changed on second read: '+file);
  store[file]=hash; snapshots.set(file,text); return text;
}
function stable() { for(const [file,hash] of Object.entries({...pins,...capturePins})) assert(H(fs.readFileSync(file))===hash,'SOURCE_DRIFT: '+file); }
function parse(text, name='runtime.mjs') {
  const ast=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true,name.endsWith('.ts')?ts.ScriptKind.TS:ts.ScriptKind.JS);
  assert(!ast.parseDiagnostics.length,'Syntax: '+name+' '+ast.parseDiagnostics.map(x=>ts.flattenDiagnosticMessageText(x.messageText,' ')).join('; ')); return ast;
}
function nodes(ast, predicate) { const out=[]; function walk(n){if(predicate(n))out.push(n);n.forEachChild(walk);}walk(ast);return out; }
function decl(ast,name) { return one(nodes(ast,n=>(ts.isFunctionDeclaration(n)||ts.isClassDeclaration(n)||ts.isVariableDeclaration(n))&&n.name?.text===name),'unique declaration '+name); }
function delta(original, patches) {
  const sorted=[...patches].sort((a,b)=>a.start-b.start||a.end-b.end);
  sorted.forEach((p,i)=>{assert(original.slice(p.start,p.end)===p.before,'Exact preimage '+p.reason);if(i)assert(sorted[i-1].end<=p.start,'Overlapping patches');});
  let next=original;
  for(const p of [...sorted].reverse()) next=next.slice(0,p.start)+p.after+next.slice(p.end);
  let offset=0;
  const records=sorted.map(p=>{const afterStart=p.start+offset;offset+=p.after.length-p.before.length;return {...p,afterStart,afterEnd:afterStart+p.after.length,beforeSha256:H(p.before),afterSha256:H(p.after),beforeByteStart:Buffer.byteLength(original.slice(0,p.start)),beforeByteEnd:Buffer.byteLength(original.slice(0,p.end))};});
  let inverse=next;
  for(const p of [...records].reverse()){assert(inverse.slice(p.afterStart,p.afterEnd)===p.after,'Exact inverse preimage');inverse=inverse.slice(0,p.afterStart)+p.before+inverse.slice(p.afterEnd);}
  assert(inverse===original,'Exact inverse differs');
  let b=0,a=0; const outside=[];
  for(const p of records){assert(original.slice(b,p.start)===next.slice(a,p.afterStart),'Outside patch bytes differ');outside.push({beforeStart:b,beforeEnd:p.start,afterStart:a,afterEnd:p.afterStart,sha256:H(original.slice(b,p.start))});b=p.end;a=p.afterEnd;}
  assert(original.slice(b)===next.slice(a),'Final outside bytes differ');outside.push({beforeStart:b,beforeEnd:original.length,afterStart:a,afterEnd:next.length,sha256:H(original.slice(b))});
  return {next,patches:records,beforeSha256:H(original),afterSha256:H(next),outside,inverseVerified:true,outsideHunksVerified:true};
}
function write(file, content) { fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content); }
function json(file, object) { write(file,JSON.stringify(object,null,2)+'\n'); }
function saveDelta(role,result) { json(O+'/'+role+'-delta.json',{...result,next:undefined,astExact:true}); }
function syntaxNode(file) { const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'}); assert(r.status===0,'node --check '+file+' '+r.stderr); }

// A failed rerun must never leave a previously successful manifest deployable.
json(O+'/manifest.json',{status:'assembling-not-deployable',scope:'offline incremental assembler',startedAt:new Date().toISOString()});
write(O+'/assembly-notes.md','# Assembly in progress\n\nNot deployable until all source stability, inverse, ABI, AST and syntax checks complete.\n');
const records=JSON.parse(pin(C+'/records.json',true));
assert(Object.keys(records).length===31,'Expected fresh 31-file capture');
function captured(key) { const r=records[key];assert(r?.local,'Missing capture '+key);const text=pin(r.local,true);assert(H(text)===r.sha256,'Capture SHA '+key);return {...r,text}; }
const oldApi=captured('admin-api'), oldRuntime=captured('dependency-4'), contracts=captured('dependency-5');
const contractName=path.basename(contracts.path);
assert(contractName==='newInformation.contracts.'+contracts.sha256+'.runtime.mjs','Original content-addressed contract');
assert(path.basename(oldRuntime.path)==='newInformation.admin.'+oldRuntime.sha256+'.runtime.mjs','Original content-addressed admin runtime');
const oa=parse(oldRuntime.text), aa=parse(oldApi.text);
const oldFactory=decl(oa,'createNativeNewInformationRuntime');
const oldBody=oldFactory.body.statements;
const factoryCall=one(nodes(aa,n=>ts.isCallExpression(n)&&n.expression.text==='__createNewInformationAdmin'),'Actual __createNewInformationAdmin call');
assert(factoryCall.arguments.length===1&&ts.isObjectLiteralExpression(factoryCall.arguments[0]),'Native injection literal');
const nativeProvided=factoryCall.arguments[0].properties.map(n=>n.name.text);
const originalReturn=one(oldBody.filter(ts.isReturnStatement),'Original factory return');
const returnNames=originalReturn.expression.properties.map(n=>n.name.text);
assert(JSON.stringify(returnNames)===JSON.stringify(['newInformation','createAdminNewInformationRouterForSource','createAdminNewInformationSourceForContext','createAdminNewInformationService','readBusinessNewInformationFacts','createMallNewInformationReader']),'Original return ABI');
const actualImport=one(aa.statements.filter(n=>ts.isImportDeclaration(n)&&n.importClause?.namedBindings&&ts.isNamedImports(n.importClause.namedBindings)&&n.importClause.namedBindings.elements.some(e=>e.name.text==='__createNewInformationAdmin')),'Actual admin runtime import alias');
assert(path.basename(actualImport.moduleSpecifier.text)===path.basename(oldRuntime.path),'Actual admin import points captured runtime');

// Reference compilation is bounded by the same native ABI. Only selected actual
// source declarations are deployed, never this reference closure as a replacement.
const bridges=new Map(), virtual=new Map();
const bridge=(file,names)=>bridges.set(file,'export const {'+names.join(',')+'}=native;');
bridge(AR+'/server/db.ts',['getDb','withBusinessAuthorizationFence','getAdminUserById','getAdminUserPermissions','getActiveBusinessStaffBinding','getActiveBusinessMerchantScope','getBusinessWorkbenchMerchantById','getAdminUserSalesScopeCodes']);
bridge(AR+'/server/_core/trpc.ts',['router','adminProcedure']);
bridge(AR+'/server/businessAccess.ts',['businessEnterpriseBindingFromMerchant','businessScopeAllows','getBusinessWorkbenchMerchantIds']);
bridge(AR+'/server/services/officialChannelAccess.ts',['loadOfficialAccess','assertOfficialRecordAction','officialTeamPredicate','officialActorFromContext']);
bridge(AR+'/drizzle/schema.ts',['adminStaffArchives','materials']);
bridge(AR+'/drizzle/officialChannelSchema.ts',['officialChannelTeams']);
const businessFile=AR+'/server/businessRouter.ts', businessText=pin(businessFile), ba=parse(businessText,businessFile);
const fixed={'customer.newInformationFacts':'customers','channelInventory.newInformationFacts':'inventory','enterprise.inquiryNewInformationFacts':'inquiries','customerDemand.procurementNewInformationFacts':'procurement','inbound.newInformationFacts':'inventory','crmSalesOrder.newInformationFacts':'orders','order.sellerNewInformationFacts':'orders'};
virtual.set(businessFile,`import {createHash,randomUUID} from 'node:crypto';import {TRPCError} from '@trpc/server';import {newInformationFactsInputSchema,newInformationFactsResultSchema} from './new-native-contract';const db=native;const withCurrentBusinessAuthorization=native.withCurrentBusinessAuthorization,businessAuditActor=native.businessAuditActor,businessEnterpriseBindingFromMerchant=native.businessEnterpriseBindingFromMerchant,callPlatformBusinessCommand=native.callPlatformBusinessCommand;export const BUSINESS_NEW_INFORMATION_READS=${JSON.stringify(fixed)};\n${decl(ba,'readBusinessNewInformationFacts').getText(ba)}\n`);
bridges.set(AR+'/server/new-native-contract.ts',`export {newInformationFactsInputSchema,newInformationFactsResultSchema} from './${contractName}';`);
const platformFile=AR+'/server/platformOrderApi.ts', platformText=pin(platformFile), pa=parse(platformText,platformFile);
const privatePlatformNames=['getConfig','PlatformOrderNewInformationError','callPlatformOrderNewInformation','getPlatformOrderNewInformationFacts'];
virtual.set(platformFile,pa.statements.filter(ts.isImportDeclaration).map(n=>n.getText(pa)).join('\n')+'\n'+privatePlatformNames.map(name=>decl(pa,name).getText(pa)).join('\n')+'\n');
assert(!decl(pa,'getPlatformOrderNewInformationFacts').getText(pa).includes('callPlatformOrder<'),'Facts must use private transport, not native.callPlatformOrder');
const coreFile=AR+'/server/services/adminNewInformation.ts';
const sourceFile=AR+'/server/services/adminNewInformationSources.ts';
const diagFile=AR+'/server/services/adminNewInformationDiagnostics.ts';
for(const file of [coreFile,sourceFile,diagFile])pin(file);
// These source realms are bridged (not bundled), but their actual before/after
// hashes are recorded so a concurrent write cannot pass as the frozen source.
for(const file of bridges.keys()) if(fs.existsSync(file))pin(file);
const entry=`import {createAdminNewInformationRouterForSource} from './server/routers/adminNewInformation';import {createAdminNewInformationSourceForContext} from './server/services/adminNewInformationSources';import {createAdminNewInformationService} from './server/services/adminNewInformation';import {readBusinessNewInformationFacts} from './server/businessRouter';import {createMallNewInformationReader} from './server/services/adminNewInformationSources/mall';import {safeAdminNewInformationError,withAdminNewInformationDiagnosticSink} from './server/services/adminNewInformationDiagnostics';export const newInformation=createAdminNewInformationRouterForSource({source:createAdminNewInformationSourceForContext});export {createAdminNewInformationRouterForSource,createAdminNewInformationSourceForContext,createAdminNewInformationService,readBusinessNewInformationFacts,createMallNewInformationReader,safeAdminNewInformationError,withAdminNewInformationDiagnosticSink};`;
const allowExternal=new Set(['node:crypto','crypto','@trpc/server','zod','drizzle-orm','drizzle-orm/mysql-core','node:async_hooks','./'+contractName]);
const build=await esbuild.build({stdin:{contents:entry,resolveDir:AR,sourcefile:'admin-reference.ts',loader:'ts'},bundle:true,write:false,platform:'node',target:'node20',format:'esm',packages:'external',metafile:true,legalComments:'none',plugins:[{name:'captured-native-reference',setup(b){
  b.onResolve({filter:/.*/},arg=>{
    if(arg.path==='./'+contractName)return {path:arg.path,external:true};
    let f=arg.path.startsWith('@shared/')?path.join(AR,'shared',arg.path.slice(8))+'.ts':arg.path.startsWith('.')?path.resolve(arg.resolveDir,arg.path):null;
    if(f&&!path.extname(f))f+='.ts';
    if(f===AR+'/shared/adminNewInformationFacts.ts'||f===FR+'/shared/adminNewInformationFacts.ts')return {path:'./'+contractName,external:true};
    if(f&&bridges.has(f))return {path:f,namespace:'native-bridge'};
    if(f&&virtual.has(f))return {path:f,namespace:'narrow-source'};
    if(f)return {path:f,namespace:'pinned-source'};
  });
  b.onLoad({filter:/.*/,namespace:'native-bridge'},arg=>({contents:bridges.get(arg.path),loader:'ts',resolveDir:path.dirname(arg.path)}));
  b.onLoad({filter:/.*/,namespace:'narrow-source'},arg=>({contents:virtual.get(arg.path),loader:'ts',resolveDir:path.dirname(arg.path)}));
  b.onLoad({filter:/.*/,namespace:'pinned-source'},arg=>({contents:pin(arg.path),loader:'ts',resolveDir:path.dirname(arg.path)}));
}}]});
const reference=build.outputFiles[0].text;
const ca=parse(reference,'compiled.mjs');
// Reference closure is not deployed; external admission is validated below only
// for bound imports actually used by the selected deployed source sections.
for(const imp of ca.statements.filter(ts.isImportDeclaration))assert(typeof imp.moduleSpecifier.text==='string','Static external module name');
stable();
fs.mkdirSync(O,{recursive:true});
json(O+'/compile-metafile.json',build.metafile);
write(O+'/compiled-admin.reference.mjs',reference);
if(compileOnly){
  json(O+'/compile-only.json',{status:'reference-only-not-deployable',sourcePins:pins,capturePins,sha256:H(reference),noStartup:true,noDatabase:true});
  console.log(JSON.stringify({status:'compile-only',reference:O+'/compiled-admin.reference.mjs',sourcePins:Object.keys(pins).length}));
  process.exit(0);
}

// Resolve each identifier to its bound symbol. External bindings are matched by
// module + imported name, and local top-level aliases by full module suffix +
// declaration name. Shorthand properties preserve their original property key.
function checkerFor(text,name) {
  const ast=parse(text,name);
  const options={allowJs:true,checkJs:true,noLib:true,noResolve:true,target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext};
  const host=ts.createCompilerHost(options);
  host.getSourceFile=file=>file===name?ast:undefined;host.fileExists=file=>file===name;host.readFile=file=>file===name?text:undefined;
  const program=ts.createProgram([name],options,host);return {ast,checker:program.getTypeChecker()};
}
const bound=checkerFor(reference,'/compiled.mjs'), cAst=bound.ast, checker=bound.checker;
function moduleKey(header) { const m=/\/(server|drizzle|shared)\/(.*)$/.exec(header);return m?m[1]+'/'+m[2]:header.replace(/^\/\/ /,''); }
function modules(text,statements,ast) {
  const headers=[...text.matchAll(/^\/\/ (?:native-bridge:|narrow-source:|pinned-source:)?[^\n]+\.(?:ts|mjs)$/gm)].map(m=>({at:m.index,key:moduleKey(m[0])}));
  return statements.map(stmt=>({stmt,module:headers.filter(h=>h.at<stmt.getStart(ast)).at(-1)?.key??'__helpers'}));
}
const oldGroups=modules(oldRuntime.text,oldBody,oa), compiledGroups=modules(reference,cAst.statements,cAst);
function declared(stmt) {
  const out=[];
  const names=n=>{if(ts.isIdentifier(n))out.push(n);else if(ts.isObjectBindingPattern(n)||ts.isArrayBindingPattern(n))for(const e of n.elements)if(ts.isBindingElement(e))names(e.name);};
  if(ts.isVariableStatement(stmt))for(const d of stmt.declarationList.declarations)names(d.name);
  else if(ts.isFunctionDeclaration(stmt)||ts.isClassDeclaration(stmt))if(stmt.name)names(stmt.name);
  return out;
}
const base=name=>name.replace(/\d+$/,'');
const oldLocals=new Map();
for(const {stmt,module} of oldGroups)for(const id of declared(stmt)){const key=module+'#'+base(id.text);const values=oldLocals.get(key)??[];values.push(id.text);oldLocals.set(key,values);}
function importBindings(ast) {
  const result=[];
  for(const stmt of ast.statements.filter(ts.isImportDeclaration)){
    const mod=stmt.moduleSpecifier.text, clause=stmt.importClause;
    if(clause?.name)result.push({module:mod,imported:'default',id:clause.name});
    if(clause?.namedBindings&&ts.isNamedImports(clause.namedBindings))for(const e of clause.namedBindings.elements)result.push({module:mod,imported:e.propertyName?.text??e.name.text,id:e.name});
    if(clause?.namedBindings&&ts.isNamespaceImport(clause.namedBindings))result.push({module:mod,imported:'*',id:clause.namedBindings.name});
  }
  return result;
}
const oldImports=importBindings(oa), compiledImports=importBindings(cAst), renames=new Map(), aliasMap=[];
const newImports=[];
const selectedSymbols=new Set(compiledGroups.filter(g=>g.module==='server/services/adminNewInformationDiagnostics.ts'||g.module==='server/platformOrderApi.ts'||g.module==='server/services/adminNewInformation.ts'&&declared(g.stmt).some(id=>id.text==='createAdminNewInformationService')||g.module==='server/services/adminNewInformationSources.ts'&&declared(g.stmt).some(id=>['prove','createAdminNewInformationSourceForContext'].includes(id.text))).flatMap(g=>nodes(g.stmt,ts.isIdentifier).map(id=>checker.getSymbolAtLocation(id))));
for(const binding of compiledImports){
  const available=oldImports.filter(x=>x.module===binding.module&&x.imported===binding.imported);
  if(available.length){const target=available[0].id.text;renames.set(checker.getSymbolAtLocation(binding.id),target);aliasMap.push({kind:'external',module:binding.module,imported:binding.imported,compiled:binding.id.text,captured:target});}
  else if(selectedSymbols.has(checker.getSymbolAtLocation(binding.id))) {assert(binding.module==='node:async_hooks'&&binding.imported==='AsyncLocalStorage','Only new external is Node AsyncLocalStorage: '+binding.module+'#'+binding.imported);newImports.push(binding);}
}
for(const {stmt,module} of compiledGroups)for(const id of declared(stmt)){
  const available=oldLocals.get(module+'#'+base(id.text));
  if(available){const target=one(available,'unique old local '+module+'#'+id.text);renames.set(checker.getSymbolAtLocation(id),target);if(target!==id.text)aliasMap.push({kind:'local',module,compiled:id.text,captured:target});}
}
// The current source moved the fixed module array into a constants file. It is
// still the original captured constant/schema realm, never compiled anew here.
for(const {stmt,module} of compiledGroups.filter(g=>g.module==='shared/adminNewInformationConstants.ts'))for(const id of declared(stmt))if(id.text==='ADMIN_NEW_INFORMATION_MODULES'){
  const target=one(oldLocals.get('shared/adminNewInformation.ts#ADMIN_NEW_INFORMATION_MODULES')??[],'Captured original module constant');
  renames.set(checker.getSymbolAtLocation(id),target);
  aliasMap.push({kind:'preserved-original-constant',module,compiled:id.text,captured:target});
}
for(const {stmt,module} of compiledGroups)for(const id of declared(stmt)){
  const symbol=checker.getSymbolAtLocation(id);
  if(!selectedSymbols.has(symbol))continue;
  assert(renames.has(symbol)||['server/services/adminNewInformationDiagnostics.ts','server/platformOrderApi.ts'].includes(module),'Selected root symbol lacks exact module ABI mapping: '+module+'#'+id.text);
}
function renamed(node) {
  const start=node.getStart(cAst), text=node.getText(cAst), patches=[];
  for(const id of nodes(node,ts.isIdentifier)){
    let symbol=checker.getSymbolAtLocation(id);
    if(ts.isShorthandPropertyAssignment(id.parent)) symbol=checker.getShorthandAssignmentValueSymbol(id.parent);
    const target=renames.get(symbol);
    if(target&&target!==id.text){
      const isShorthand=ts.isShorthandPropertyAssignment(id.parent);
      patches.push({start:id.getStart(cAst)-start,end:id.end-start,before:id.text,after:isShorthand?id.text+': '+target:target,reason:'Bound-symbol ABI mapping'});
    }
  }
  return delta(text,patches).next;
}
function byModuleDecl(groups,module,name,ast) {
  const matches=[];
  for(const group of groups.filter(g=>g.module===module))for(const id of declared(group.stmt))if(base(id.text)===name)matches.push({stmt:group.stmt,id});
  return one(matches,'module declaration '+module+'#'+name);
}
const selected=[['server/services/adminNewInformation.ts','createAdminNewInformationService'],['server/services/adminNewInformationSources.ts','prove'],['server/services/adminNewInformationSources.ts','createAdminNewInformationSourceForContext']];
const runtimePatches=selected.map(([module,name])=>{
  const previous=byModuleDecl(oldGroups,module,name,oa).stmt, current=byModuleDecl(compiledGroups,module,name,cAst).stmt;
  assert(ts.isFunctionDeclaration(previous)&&ts.isFunctionDeclaration(current),'Exact selected function section '+name);
  return {start:previous.getStart(oa),end:previous.end,before:previous.getText(oa),after:renamed(current),reason:'Pinned-source compiled exact function '+module+'#'+name};
});
const platformModule='server/platformOrderApi.ts';
const oldPlatform=oldGroups.filter(g=>g.module===platformModule), newPlatform=compiledGroups.filter(g=>g.module===platformModule);
assert(oldPlatform.length&&newPlatform.length,'Private platform transport module found');
const ps=oldPlatform[0].stmt.getStart(oa),pe=oldPlatform.at(-1).stmt.end;
assert(oldRuntime.text.slice(ps,pe).includes('callPlatformOrder = native.callPlatformOrder'),'Original native transport slot');
let platformAfter=newPlatform.filter(g=>!ts.isImportDeclaration(g.stmt)&&!ts.isExportDeclaration(g.stmt)).map(g=>renamed(g.stmt)).join('\n');
assert(!platformAfter.includes('native.callPlatformOrder'),'Dedicated facts private transport, no native bypass');
// Preserve the original dormant bridge property and initialization as well as the
// entire main-API injection list; the facts function never calls this binding.
const originalTransportVar=one(oldPlatform.filter(g=>declared(g.stmt).some(id=>id.text==='callPlatformOrder')),'Original transport bridge variable').stmt;
const originalTransportAssignment=one(nodes(oldPlatform.at(-1).stmt,n=>ts.isExpressionStatement(n)&&n.getText(oa)==='callPlatformOrder = native.callPlatformOrder;'),'Original transport bridge assignment');
const pAst=parse(platformAfter), pInit=decl(pAst,'init_platformOrderApi');
const pInitBody=one(nodes(pInit,n=>ts.isMethodDeclaration(n)&&n.body),'Private platform initializer').body;
platformAfter=delta(platformAfter,[{start:pInitBody.getStart(pAst)+1,end:pInitBody.getStart(pAst)+1,before:'',after:'\n'+originalTransportAssignment.getText(oa)+'\n',reason:'Original captured native property bridge, not a second transport'}]).next;
platformAfter=originalTransportVar.getText(oa)+'\n'+platformAfter;
assert(!/function (?:getPlatformOrderStats|listPlatformOrders|getPlatformOrderDetail|callPlatformOrder)\(/.test(platformAfter),'No public platform order helper bundled');
runtimePatches.push({start:ps,end:pe,before:oldRuntime.text.slice(ps,pe),after:platformAfter,reason:'Pinned private facts-only platform transport module section'});
const diagModule='server/services/adminNewInformationDiagnostics.ts';
const diagGroups=compiledGroups.filter(g=>g.module===diagModule);
assert(diagGroups.length>5,'Complete compiled diagnostics module');
const diagCode=diagGroups.filter(g=>!ts.isImportDeclaration(g.stmt)&&!ts.isExportDeclaration(g.stmt)).map(g=>renamed(g.stmt)).join('\n');
// Every diagnostics initializer must run before the first service construction.
const diagInitializer=diagGroups.flatMap(g=>declared(g.stmt)).find(id=>/^init_adminNewInformationDiagnostics\d*$/.test(id.text));
const diagAnchor=one(oldGroups.filter(g=>g.module==='__helpers'&&declared(g.stmt).some(id=>id.text==='__export')),'Factory helper insertion anchor').stmt.end;
runtimePatches.push({start:diagAnchor,end:diagAnchor,before:'',after:'\n\n// '+diagFile+' (pinned compiled additive diagnostics)\n'+diagCode+'\n'+(diagInitializer?diagInitializer.text+'();\n':''),reason:'Single actual-source diagnostics module, native fence remains injected'});
if(newImports.length){assert(newImports.length===1,'Exactly one new external import');const b=newImports[0];runtimePatches.push({start:0,end:0,before:'',after:`import { AsyncLocalStorage${b.id.text==='AsyncLocalStorage'?'':' as '+b.id.text} } from "node:async_hooks";\n`,reason:'Allowlisted actual diagnostic Node ALS import'});}
// No factory return edits: existing six ABI keys, order, and exact bytes stay intact.
const runtimeDelta=delta(oldRuntime.text,runtimePatches), nextRuntime=runtimeDelta.next;
const na=parse(nextRuntime), newFactory=decl(na,'createNativeNewInformationRuntime');
assert(one(newFactory.body.statements.filter(ts.isReturnStatement),'new factory return').getText(na)===originalReturn.getText(oa),'Original return object byte-identical');
function nativeReferences(ast) {
  return [...new Set(nodes(ast,n=>ts.isPropertyAccessExpression(n)&&n.expression.text==='native').map(n=>n.name.text).concat(nodes(ast,n=>ts.isVariableDeclaration(n)&&n.initializer?.text==='native'&&ts.isObjectBindingPattern(n.name)).flatMap(n=>n.name.elements.map(e=>e.propertyName?.text??e.name.text))).concat(nodes(ast,n=>ts.isBinaryExpression(n)&&n.right.text==='native'&&ts.isObjectLiteralExpression(n.left)).flatMap(n=>n.left.properties.map(p=>p.name.text))))].sort();
}
const required=nativeReferences(na), oldRequired=nativeReferences(oa);
assert(JSON.stringify(required)===JSON.stringify(oldRequired),'Native runtime injection property ABI unchanged');
for(const key of required)assert(nativeProvided.includes(key),'Missing actual native ABI '+key);
assert(!nextRuntime.includes('businessAuthorizationFence.ts'),'Do not bundle native fence implementation');
const runtimeName='newInformation.admin.'+H(nextRuntime)+'.runtime.mjs';
const apiDelta=delta(oldApi.text,[{start:actualImport.moduleSpecifier.getStart(aa)+1,end:actualImport.moduleSpecifier.end-1,before:actualImport.moduleSpecifier.text,after:'../runtime/'+runtimeName,reason:'ONLY actual __createNewInformationAdmin import URL'}]);
parse(apiDelta.next);
assert(decl(parse(apiDelta.next),'appRouter').getText(parse(apiDelta.next))===decl(aa,'appRouter').getText(aa),'Captured admin route graph unchanged');
const newCall=one(nodes(parse(apiDelta.next),n=>ts.isCallExpression(n)&&n.expression.text==='__createNewInformationAdmin'),'New native call');
assert(newCall.getText()===factoryCall.getText(aa),'Native injection list exact bytes unchanged');

// Static free-name audit with TS binding (no execution): newly copied root symbols
// must resolve to a declaration within this runtime, an original module import,
// or a fixed standard Node/global name. Unknown identifiers fail closed.
const audit=checkerFor(nextRuntime,'/candidate.mjs');
const globals=new Set(['native','Object','Array','Set','Map','Promise','Number','String','Boolean','Math','JSON','Date','RegExp','Error','TypeError','Buffer','process','console','performance','fetch','AbortSignal','undefined','Infinity','NaN','Intl','BigInt','encodeURIComponent']);
const unresolved=[];
for(const id of nodes(audit.ast,ts.isIdentifier)){
  const p=id.parent;
  if((ts.isPropertyAccessExpression(p)&&p.name===id)||(ts.isPropertyAssignment(p)&&p.name===id)||(ts.isBindingElement(p)&&p.propertyName===id)||ts.isImportSpecifier(p)||ts.isExportSpecifier(p)||ts.isMethodDeclaration(p)&&p.name===id||ts.isPropertyDeclaration(p)&&p.name===id)continue;
  if(!audit.checker.getSymbolAtLocation(id)&&!globals.has(id.text))unresolved.push({name:id.text,offset:id.getStart(audit.ast)});
}
assert(!unresolved.length,'Unresolved native alias: '+JSON.stringify(unresolved));
const originalApiRoutes=decl(aa,'appRouter').getText(aa);
const runtimeFile=O+'/runtime/'+runtimeName;
stable();
write(runtimeFile,nextRuntime);write(O+'/admin-api.js',apiDelta.next);
saveDelta('runtime',runtimeDelta);saveDelta('admin',apiDelta);
json(O+'/exactinverse.json',{runtime:{beforeSha256:runtimeDelta.beforeSha256,afterSha256:runtimeDelta.afterSha256,inverseVerified:true,patches:runtimeDelta.patches.map(p=>({start:p.afterStart,end:p.afterEnd,before:p.after,after:p.before}))},admin:{beforeSha256:apiDelta.beforeSha256,afterSha256:apiDelta.afterSha256,inverseVerified:true,patches:apiDelta.patches.map(p=>({start:p.afterStart,end:p.afterEnd,before:p.after,after:p.before}))}});
let front;
if(customerFile){
  const customer=pin(path.resolve(customerFile),true), name=path.basename(customerFile);
  assert(name==='customerPicker.'+H(customer)+'.runtime.mjs','Customer runtime content-addressed filename');
  parse(customer);const oldFront=captured('front-api'),fa=parse(oldFront.text);
  const fImport=one(fa.statements.filter(n=>ts.isImportDeclaration(n)&&n.moduleSpecifier.text.includes('/customerPicker.')),'Actual customerPicker front import');
  assert(path.basename(fImport.moduleSpecifier.text)===path.basename(records['dependency-13'].path),'Actual captured customerPicker import');
  const fd=delta(oldFront.text,[{start:fImport.moduleSpecifier.getStart(fa)+1,end:fImport.moduleSpecifier.end-1,before:fImport.moduleSpecifier.text,after:'../runtime/'+name,reason:'ONLY actual customerPicker runtime import URL'}]);
  parse(fd.next);write(O+'/front-api.js',fd.next);saveDelta('front',fd);write(O+'/runtime/'+name,customer);
  front={path:oldFront.path,local:O+'/front-api.js',beforeSHA:fd.beforeSha256,afterSHA:fd.afterSha256,size:Buffer.byteLength(fd.next),runtime:{path:path.dirname(records['dependency-13'].path)+'/'+name,local:O+'/runtime/'+name,sha256:H(customer),size:Buffer.byteLength(customer)}};
}
syntaxNode(runtimeFile);syntaxNode(O+'/admin-api.js');if(front){syntaxNode(front.local);syntaxNode(front.runtime.local);}
stable();
// Successful reruns leave only this freeze's intended runtime allowlist. Failed
// attempts never erase old artifacts, but their manifest is non-deployable.
const intendedRuntimeNames=new Set([runtimeName,...(front?[path.basename(front.runtime.local)]:[])]);
for(const name of fs.readdirSync(O+'/runtime'))if(!intendedRuntimeNames.has(name))fs.rmSync(O+'/runtime/'+name,{force:true});
if(!front)for(const name of ['front-api.js','front-delta.json'])fs.rmSync(O+'/'+name,{force:true});
fs.rmSync(O+'/compile-only.json',{force:true});
const manifest={scope:'customer-unread-picker-and-admin-sales-503-sanitized-diagnostics',status:'offline-assembled-not-deployed',sourceRoots:{manager:AR,platform:FR},sourcePins:pins,capturePins,
  api:{admin:{path:oldApi.path,local:O+'/admin-api.js',beforeSHA:apiDelta.beforeSha256,afterSHA:apiDelta.afterSha256,size:Buffer.byteLength(apiDelta.next),hunks:1},...(front?{front}:{})},
  runtimes:[{path:path.dirname(oldRuntime.path)+'/'+runtimeName,local:runtimeFile,sha256:H(nextRuntime),size:Buffer.byteLength(nextRuntime)},...(front?[front.runtime]:[])],
  existingFiles:[{path:contracts.path,sha256:contracts.sha256,unchanged:true}],
  dependencies:{admin:{provided:nativeProvided,required,oldRequired,injectionListByteIdentical:true,returnKeys:returnNames,returnByteIdentical:true},externalAliasMap:aliasMap,newExternalAllowlist:['node:async_hooks#AsyncLocalStorage']},
  deployedSourceSections:[...selected.map(([module,name])=>({path:AR+'/'+module,declaration:name})),{path:platformFile,declarations:privatePlatformNames},{path:diagFile,declarations:'complete single compiled module'}],
  diagnostics:{moduleCopies:1,traceStorageDeclarations:diagGroups.flatMap(g=>declared(g.stmt)).filter(id=>id.text==='storage').length,privateFactsTransport:true,nativeFenceImplementationBundled:false,privateExportsAdded:false,fenceStages:'native default fence wrapper observes operation versus post-operation cleanup; original native fence does not gain new lease/connect/lock/unlock instrumentation'},
  targets:{adminApi:oldApi.path,oldAdminRuntime:oldRuntime.path,existingFactsContract:contracts.path,frontHandling:front?'one import hunk':'not handled; parent front assembler may operate independently'},
  checks:{typescriptParse:true,nodeSyntax:true,routeGraphSha256:H(originalApiRoutes),routeGraphUnchanged:true,inverseVerified:true,outsideHunksVerified:true,sourceStableBeforeAfter:true,boundSymbolAliases:true,noUnresolvedNames:true,originalNativeAbi:true,noApiStartup:true,noDatabase:true,noBrowser:true,noGit:true,noSSH:true,noProductionWrites:true,noHtmlWrites:true,noContractCompilation:true,noOldGeneratorExecution:true},
  runtimePolicy:'Incremental old actual df1b13 runtime: three exact function replacements, old private facts module replacement, additive source-compiled diagnostics and one allowlisted ALS import. All outside hunks preserved byte-for-byte; actual admin API changes only one import URL.'};
json(O+'/manifest.json',manifest);
write(O+'/assembly-notes.md',`# Offline incremental backend assembly\n\nStatus: ${manifest.status}.\n\nRun from any directory: \`node ${W}/backend-native.mjs\`. Default is **admin only**. For reference-only compile use \`--compile-only\`. To handle front's single customerPicker import in this builder, append \`--customer-runtime /absolute/path/customerPicker.SHA.runtime.mjs\`. Parent may instead assemble front independently. Output directory is restricted to this window's backend-candidate. Rerun only after source owner reports stable; all before/after source and capture hashes are pinned and drift is fatal.\n\nRuntime: \`${runtimeName}\`. The only admin API hunk changes the actual \`__createNewInformationAdmin\` import. No main API blocks, HTML, facts contract, native injection list, native fence lease pool, original router/store/schema/permission declarations, or factory return are rebuilt. All original native properties are required and provided.\n\n## Actual source sections deployed\n\n${manifest.deployedSourceSections.map(s=>'- '+s.path+': '+(s.declaration??JSON.stringify(s.declarations))).join('\n')}\n\nReference compiler may read other source dependencies for mapping, but their output is not deployed. Bound symbols are AST-renamed by module/imported name (externals) and complete source-module suffix/declaration (locals). Any undefined alias fails closed. \`exactinverse.json\` and both delta files contain exact patch preimages; outside spans have matching SHA-256.\n\nDiagnostics is one actual-source module and uses native injected fence exclusively. The old public order stats/list/detail transport remains in the captured main API; only newInformationFacts uses its dedicated private source transport. Source diagnostic storage/sink instances are taken unchanged from the real diagnostics source. No synthetic business implementation is handwritten.\n\n## Checks and limits\n\nTypeScript parse, Node syntax, symbol resolution, unchanged original route graph, exact inverse/outside bytes, native ABI, and stable source/capture pins passed. No old API execution, database, browser, SSH, Git, production operation, migration, permission write, or real mark was performed. Tests of business behavior are the source owner's responsibility. This does not claim to fix or determine the underlying historical sales 503 cause.\n\nFront: ${manifest.targets.frontHandling}.\n`);
console.log(JSON.stringify({status:manifest.status,adminRuntime:runtimeName,runtimeHunks:runtimePatches.length,adminHunks:1,front:manifest.targets.frontHandling,manifest:O+'/manifest.json',sourcePins:Object.keys(pins).length},null,2));
