'use strict';
// Only the actual service tail's snapshot binding is compiled, never its live worker prefix.
const C=require('./scoped-core.cjs'),esbuild=require('esbuild');
const {fs,path,assert,ts,sha,pinned,inside,parse,one}=C;
function defaultBinding(sourceDir,pins){
 const n='server/channelReference/service.ts',bytes=pinned(inside(sourceDir,n),pins[n]),text=bytes.toString('utf8'),a=parse(text,n,ts.ScriptKind.TS);
 const imp=one(a.statements,x=>ts.isImportDeclaration(x)&&x.moduleSpecifier.text==='./snapshot','snapshot factory import');
 assert.equal(imp.importClause?.namedBindings?.elements?.length,1);assert.equal(imp.importClause.namedBindings.elements[0].name.text,'createChannelReferenceSnapshotService');
 const declarations=a.statements.flatMap(x=>ts.isVariableStatement(x)?[...x.declarationList.declarations]:[]);
 const service=one(declarations,x=>x.name.getText(a)==='service','snapshot default service');assert(ts.isCallExpression(service.initializer)&&service.initializer.expression.getText(a)==='createChannelReferenceSnapshotService'&&service.initializer.arguments.length===0);
 const lookup=one(declarations,x=>x.name.getText(a)==='lookupChannelReferences','actual lookup export');assert(ts.isPropertyAccessExpression(lookup.initializer)&&lookup.initializer.getText(a)==='service.lookup');
 const statement=one(a.statements,x=>ts.isVariableStatement(x)&&x.declarationList.declarations.includes(lookup),'export lookup statement');assert(statement.modifiers?.some(x=>x.kind===ts.SyntaxKind.ExportKeyword));
 const serviceStatement=one(a.statements,x=>ts.isVariableStatement(x)&&x.declarationList.declarations.includes(service),'default factory statement');assert.equal(serviceStatement.declarationList.declarations.length,1);assert.equal(statement.declarationList.declarations.length,1);
 assert.deepEqual(a.statements.slice(-3),[imp,serviceStatement,statement],'EXACT_FINAL_THREE_SERVICE_BINDING_STATEMENTS');
 const fragment=text.slice(imp.getStart(a),statement.end),slices=[imp,serviceStatement,statement].map(x=>({start:C.offset(text,x.getStart(a)),end:C.offset(text,x.end),sha256:sha(x.getText(a)),source:x.getText(a)}));
 return {sourceFile:n,sourceSha256:sha(bytes),factory:'createChannelReferenceSnapshotService()',export:'lookupChannelReferences = service.lookup',sourceBindingSha256:sha(statement.getText(a)),fragmentSha256:sha(fragment),fragment,slices,executed:false};
}
async function compileRuntime(sourceDir,pins){
 const reads={},binding=defaultBinding(sourceDir,pins),entry='// Generated verbatim from pinned actual service.ts final AST statements.\n'+binding.fragment+'\n';
 const allowed=new Set(['server/channelReference/snapshot.ts','shared/channelReferenceBrand.ts']);
 const result=await esbuild.build({absWorkingDir:sourceDir,stdin:{contents:entry,sourcefile:'service-snapshot-tail.synthetic.ts',resolveDir:path.join(sourceDir,'server/channelReference'),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'node22',metafile:true,logLevel:'silent',plugins:[{name:'pinned-readonly-snapshot-fragment-graph',setup(build){
  build.onResolve({filter:/^node:/},args=>{assert(['node:fs','node:fs/promises','node:crypto'].includes(args.path),'ONLY_READONLY_SNAPSHOT_BUILTINS');return {path:args.path,external:true};});
  build.onLoad({filter:/\.[cm]?[jt]s$/,namespace:'file'},args=>{const n=path.relative(sourceDir,args.path).split(path.sep).join('/');assert(allowed.has(n),'ONLY_SNAPSHOT_PURE_MATCHER_GRAPH '+n);assert(pins[n],'UNPINNED_RUNTIME_SOURCE '+n);const b=pinned(args.path,pins[n]);reads[n]=sha(b);return {contents:b.toString('utf8'),loader:'ts',resolveDir:path.dirname(args.path)};});
 }}]});
 assert.equal(result.outputFiles.length,1);assert(reads['server/channelReference/snapshot.ts']);assert(reads['shared/channelReferenceBrand.ts']);
 const outputs=Object.values(result.metafile.outputs);assert.equal(outputs.length,1);assert(outputs[0].exports.includes('lookupChannelReferences'));for(const r of outputs[0].imports)assert(r.external&&['node:fs','node:fs/promises','node:crypto'].includes(r.path));
 for(const [n,h] of Object.entries(reads))pinned(inside(sourceDir,n),h);pinned(inside(sourceDir,binding.sourceFile),binding.sourceSha256);
 return {bytes:Buffer.from(result.outputFiles[0].contents),metafile:result.metafile,sourceHashes:reads,binding,syntheticEntry:Buffer.from(entry),syntheticEntrySha256:sha(entry),scope:'verbatim actual service final factory/default lookup fragment plus unchanged whole snapshot.ts and pure shared matcher; fixed sibling JSON reader only; no service live prefix/worker/app/network/DB',executed:false};
}
function recordKey(r){assert(typeof r.partNumber==='string'&&typeof r.brand==='string','RAW_RECORD_IDENTITY');return JSON.stringify([r.partNumber,r.brand]);}
function validateSnapshot(oldBytes,newBytes,allowed){
 const old=JSON.parse(oldBytes),next=JSON.parse(newBytes);assert.equal(old.schemaVersion,1);assert.equal(next.schemaVersion,old.schemaVersion);assert.equal(next.collectionMode,old.collectionMode);assert(Array.isArray(next.records));
 const index=rows=>{const m=new Map();for(const r of rows){const k=recordKey(r);assert(!m.has(k),'DUPLICATE_RAW_RECORD_IDENTITY');m.set(k,r);}return m;};const a=index(old.records),b=index(next.records);assert.deepEqual([...a.keys()].sort(),[...b.keys()].sort(),'NO_PRIVATE_IDENTITY_EXPANSION_OR_REMOVAL');
 assert(Array.isArray(allowed)&&new Set(allowed).size===allowed.length,'EXPLICIT_DATA_DELTA_KEYS');const scope=new Set(allowed),changed=[],retained=[];let newSuccess=0,nullableSuccess=0;
 for(const [k,prior] of a){const current=b.get(k);assert.deepEqual(Object.keys(current).sort(),Object.keys(prior).sort(),'NO_RECORD_SCHEMA_EXPANSION');
  for(const source of ['lcsc','ickey']){const p=prior.references[source],q=current.references[source];assert(q&&q.source===source);assert(!['pending','error'].includes(q.status),'NO_PENDING_OR_ERROR_DATA');if(p.status==='ok'){assert.deepEqual(q,p,'OLD_SUCCESS_QUOTE_CHANGED '+k+' '+source);assert.deepEqual(current.evidence[source],prior.evidence[source],'OLD_SUCCESS_EVIDENCE_CHANGED '+k+' '+source);retained.push({key:k,source,sha256:sha(JSON.stringify(p))});}else if(q.status==='ok')newSuccess++;
   if(q.status==='ok'&&q.stockQuantity===null)nullableSuccess++;assert(q.stockQuantity===null||(Number.isSafeInteger(q.stockQuantity)&&q.stockQuantity>=0),'STOCK_NULL_OR_INDEPENDENT_NONNEGATIVE_INTEGER');
   if(q.unitPrice!==null){assert(typeof q.unitPrice==='string'&&/^\d+(?:\.\d+)?$/.test(q.unitPrice),'DECIMAL_PRICE_STRING_REQUIRED');}for(const tier of q.tiers||[])assert(typeof tier.unitPrice==='string'&&/^\d+(?:\.\d+)?$/.test(tier.unitPrice),'TIER_PRICE_STRING_REQUIRED');
  }
  if(JSON.stringify(current)!==JSON.stringify(prior)){assert(scope.has(k),'DATA_CHANGE_OUTSIDE_APPROVED_KEYS '+k);changed.push(k);}else assert(!scope.has(k),'UNUSED_DATA_DELTA_APPROVAL '+k);
 }
 assert.deepEqual(changed.sort(),allowed.slice().sort(),'EXACT_APPROVED_DATA_CHANGES_REQUIRED');
 return {beforeSha256:sha(oldBytes),afterSha256:sha(newBytes),recordCount:b.size,sourceCount:b.size*2,changedRecordKeys:changed,oldSuccessReferencesRetained:retained.length,newSuccessReferences:newSuccess,successReferences:retained.length+newSuccess,nullableSuccessReferences:nullableSuccess,retainedSuccessReferences:retained,rawIdentitiesPreserved:true,allOldSuccessfulQuotesAndEvidenceExact:true,decimalStringsPreserved:true,source:'parent pinned mechanical extraction/finite alias inputs; this tool did not collect/DB/write live records'};
}
module.exports={defaultBinding,compileRuntime,recordKey,validateSnapshot};
