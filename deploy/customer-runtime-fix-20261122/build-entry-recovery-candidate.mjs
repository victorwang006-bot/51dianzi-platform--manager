import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {ts,H,parse,nodes,specs,resolve} from '../admin-new-information-v1/build-page-markers.mjs';
const W=process.argv[2];assert(W&&path.isAbsolute(W),'Absolute output directory required');const R='/home/ubuntu/work/channel-release-20261121-1837/manager',A='/home/ubuntu/work/customer-runtime-audit-20261122-1137';
const evidence=JSON.parse(fs.readFileSync(A+'/orders/actual-import-resolution.json','utf8'));
const before=fs.readFileSync(A+'/orders/'+path.basename(evidence.entry),'utf8');assert.equal(H(before),evidence.entrySHA);
const oldAST=parse(before),source=fs.readFileSync(R+'/client/src/App.tsx','utf8'),boundary=fs.readFileSync(R+'/client/src/components/ErrorBoundary.tsx','utf8');
const sourceAST=ts.createSourceFile('App.tsx',source,99,true,ts.ScriptKind.TSX),boundaryAST=ts.createSourceFile('ErrorBoundary.tsx',boundary,99,true,ts.ScriptKind.TSX);
const one=(xs,label)=>{assert.equal(xs.length,1,label);return xs[0];};
const srcFn=name=>one(nodes(sourceAST,n=>ts.isFunctionDeclaration(n)&&n.name?.text===name),name).getText(sourceAST);
const cls=one(nodes(boundaryAST,n=>ts.isClassDeclaration(n)&&n.name?.text==='ErrorBoundary'),'source boundary').getText(boundaryAST);
assert(!before.includes('__d51RouteErrorRecovery1148'));
const aliases={React:'O',Component:'O.Component',cn:'O0',AlertTriangle:'m2',RotateCcw:'p2',ErrorBoundary:'y2',useLocation:'Oi',useSearch:'yT',useAuth:'ko',DEFAULT_ADMIN_PATH:'$f',PermissionGate:'un',LazyScreen:'ce',LazyOrders:'iE',RouteErrorBoundary:'__d51RouteErrorRecovery1148',OrdersRoute:'__d51OrdersRoute1148'};
function compile(text){
 const result=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React,jsxFactory:'O.createElement'},transformers:{after:[context=>root=>{function visit(n){if(ts.isIdentifier(n)&&aliases[n.text]){const alias=aliases[n.text];return alias.includes('.')?ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(alias.split('.')[0]),alias.split('.')[1]):ts.factory.createIdentifier(alias);}return ts.visitEachChild(n,visit,context);}return ts.visitNode(root,visit);} ]},fileName:'recovery.tsx',reportDiagnostics:true});assert.equal(result.diagnostics?.length??0,0);return result.outputText.replaceAll('import.meta.env.BASE_URL','(F2+"/")').replace(/^export \{\};\s*$/gm,'');
}
const oldClass=one(nodes(oldAST,n=>ts.isClassDeclaration(n)&&n.name?.text==='y2'),'actual boundary y2');
const oldOrders=one(nodes(oldAST,n=>ts.isVariableDeclaration(n)&&n.name?.text==='xv'),'actual Orders route xv');
const oldRouter=one(nodes(oldAST,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='W2'),'actual W2 router');
assert(oldClass.getText(oldAST).includes('An unexpected error occurred'));
assert(oldOrders.getText(oldAST).includes('permission:"orders.read"'));
assert(oldRouter.getText(oldAST).includes('base:F2'));
const compiledClass=compile(cls),compiledOrders=compile(srcFn('OrdersRoute')),compiledRecovery=compile(srcFn('RouteErrorBoundary'));
// Native bindings were verified directly in this exact entry: O, Oi, yT, ko, y2, un, ce, iE, $f, z0, F2, $2.
const patches=[{node:oldClass,text:compiledClass,reason:'same O.Component/React instance; Chinese manual recovery and resetKeys'}, {node:oldOrders,text:'xv=()=>__d51OrdersRoute1148()',reason:'existing permission gate retained; local Orders boundary'}, {node:oldRouter,text:compiledOrders+'\n'+compiledRecovery+'\nfunction W2(){return O.createElement(z0,{base:F2},O.createElement(__d51RouteErrorRecovery1148,null,O.createElement($2,null)));}',reason:'route/account observer remains outside caught AppRoutes; existing Wouter and auth hooks'}].map(p=>({start:p.node.getStart(oldAST),end:p.node.end,before:p.node.getText(oldAST),after:p.text,reason:p.reason})).sort((a,b)=>a.start-b.start);
let after=before;for(const p of [...patches].reverse())after=after.slice(0,p.start)+p.after+after.slice(p.end);
let shift=0;for(const p of patches){p.afterStart=p.start+shift;p.afterEnd=p.afterStart+p.after.length;shift+=p.after.length-p.before.length;}
let inverse=after;for(const p of [...patches].reverse())inverse=inverse.slice(0,p.afterStart)+p.before+inverse.slice(p.afterEnd);assert.equal(inverse,before);parse(after);assert.deepEqual(specs(before),specs(after));
const hash=H(after),url=path.posix.dirname(evidence.entry)+'/index-error-recovery-'+hash.slice(0,16)+'.js',local=W+'/'+path.basename(url);
const html=fs.readFileSync(A+'/public-current-index.html','utf8');assert.equal(H(html),evidence.htmlSHA);const map=JSON.parse([...html.matchAll(/<script[^>]*type="importmap"[^>]*>([\s\S]*?)<\/script>/g)][0][1]);
const newMap=structuredClone(map),mappingChanges=[];
for(const [scope,table]of [['imports',newMap.imports],...Object.entries(newMap.scopes)])for(const[k,v]of Object.entries(table))if(v===evidence.entry){table[k]=url;mappingChanges.push({scope,key:k,before:v,after:url});}
newMap.imports[evidence.entry]=url;
newMap.scopes[url]=structuredClone(newMap.scopes[evidence.entry]);
const orders=JSON.parse(fs.readFileSync(W+'/orders-candidate-manifest.json','utf8'));
newMap.scopes[url][orders.normalizedSpecifier]=orders.candidate.url;
if(orders.candidateDependencyScope)newMap.scopes[orders.candidate.url]=structuredClone(orders.candidateDependencyScope.table);
// Any entry aliases inside inherited leaf scopes must resolve to the same new root instance.
for(const table of [newMap.imports,...Object.values(newMap.scopes)])for(const[k,v]of Object.entries(table))if(v===evidence.entry)table[k]=url;
const deps=specs(before).map(spec=>({specifier:spec,before:resolve(spec,evidence.entry,map),after:resolve(spec,url,newMap)}));
for(const dep of deps)assert.equal(dep.after,dep.before===evidence.entry?url:dep.before===orders.old.url?orders.candidate.url:dep.before,dep.specifier);
const exported=a=>nodes(a,n=>ts.isExportDeclaration(n)).map(n=>n.getText(a));assert.deepEqual(exported(parse(after)),exported(oldAST));
fs.writeFileSync(local,after);fs.writeFileSync(W+'/entry-recovery-patches.json',JSON.stringify(patches,null,2)+'\n');
fs.writeFileSync(W+'/entry-recovery-native-definitions.js',compiledClass+'\n'+compiledOrders+'\n'+compiledRecovery+'\n');
const manifest={status:'UNINTEGRATED_STATIC_CANDIDATE_REQUIRES_PARENT_GRAPH_QA',old:{url:evidence.entry,sha256:H(before)},candidate:{url,local,sha256:hash,bytes:Buffer.byteLength(after)},htmlBaseSHA256:evidence.htmlSHA,sourceHashes:{App:H(source),ErrorBoundary:H(boundary)},patchCount:3,patchFile:W+'/entry-recovery-patches.json',checks:{inverseVerified:true,allOutsidePatchBytesPreserved:true,staticImportSpecifiersUnchanged:true,exportSurfaceUnchanged:true,noNewReact:true,noNewQueryClient:true,noNewTRPC:true,existingNativeAuthAndPermissionGates:true},mappingChanges,requiredExtraMapping:{key:evidence.entry,value:url},newEntryScope:{key:url,table:newMap.scopes[url]},ordersCandidate:orders.candidate,dependencyResolution:deps,notes:['Do not switch HTML alone: all effective entry aliases must target the new entry, avoiding two entry React instances.','Parent must combine own runtime/badge/layout candidates and rerun exact longest-scope single resolution for graph.','No HTML, old immutable asset or production receipt was written.','Source component tests pass; native static definitions still need controlled DOM test before acceptance.']};
fs.writeFileSync(W+'/entry-recovery-candidate-manifest.json',JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({sha256:hash,url,aliases:mappingChanges.length,dependencies:deps.length,status:manifest.status},null,2));
