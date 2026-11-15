'use strict';
// Offline reference-service/worker graph only. Never bundles the admin/main API.
// Full current source is shipped, but config/cache provisioning and live producer
// acceptance are explicitly NOT performed by this module.
const C=require('./scoped-core.cjs'),esbuild=require('esbuild');
const {fs,path,assert,ts,sha,pinned,inside,parse}=C;
const ELIGIBLE=require('./source-contract.cjs');
function validateContract(sourceDir,pins,c){
 assert(c&&c.contractVersion==='channel-remediation-disabled-runtime-build-v1','EXACT_DISABLED_RUNTIME_BUILD_CONTRACT_REQUIRED');
 assert.equal(c.mode,'manual-default-disabled');assert.equal(c.serviceEntry,'server/channelReference/service.ts');assert.equal(c.workerEntry,'server/channelReference/worker.ts');
 assert.equal(c.workerBasename,'channel-reference-worker.mjs');assert.equal(c.configProvisioned,false);assert.equal(c.cacheProvisioned,false);assert.equal(c.activeProducerAccepted,false);
 assert(Array.isArray(c.externalBuiltins)&&new Set(c.externalBuiltins).size===c.externalBuiltins.length);assert(c.externalBuiltins.every(n=>/^node:[a-z_]+(?:\/promises)?$/.test(n)),'NODE_BUILTINS_ONLY_NO_UNPINNED_PACKAGE');
 for(const graph of [c.serviceGraphSourceHashes,c.workerGraphSourceHashes]){
  assert(graph&&Object.keys(graph).length>0,'EXACT_INDEPENDENT_GRAPH_HASH_SET_REQUIRED');
  for(const [n,h] of Object.entries(graph)){assert(ELIGIBLE.eligible(n)&&!n.includes('.test.')&&!n.endsWith('.html'),'REFERENCE_RUNTIME_SOURCE_ONLY '+n);assert.equal(h,pins[n],'GRAPH_SOURCE_FREEZE_BINDING '+n);pinned(inside(sourceDir,n),h);}
 }
 assert.equal(c.serviceGraphSourceHashes[c.serviceEntry],pins[c.serviceEntry]);assert.equal(c.workerGraphSourceHashes[c.workerEntry],pins[c.workerEntry]);
 assert.equal(c.effectiveServiceExport,'lookupChannelReferences');
 return c;
}
function defaultBinding(sourceDir,pins,c){
 c=validateContract(sourceDir,pins,c);
 const n=c.serviceEntry,bytes=pinned(inside(sourceDir,n),pins[n]),text=bytes.toString('utf8'),a=parse(text,n,ts.ScriptKind.TS);
 const statements=a.statements.filter(s=>s.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)&&((s.name?.text===c.effectiveServiceExport)||(ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>d.name.getText(a)===c.effectiveServiceExport))));
 assert.equal(statements.length,1,'ONE_ACTUAL_DEFAULT_SERVICE_EXPORT');
 const statement=statements[0];
 return {sourceFile:n,sourceSha256:sha(bytes),export:c.effectiveServiceExport,sourceBindingSha256:sha(statement.getText(a)),slices:[{start:C.offset(text,statement.getStart(a)),end:C.offset(text,statement.end),sha256:sha(statement.getText(a)),source:statement.getText(a)}],fullActualEntryCompiled:true,manualDefaultDisabled:true,activeProducerAccepted:false,executed:false};
}
async function compileOne(sourceDir,pins,entry,graph,externalBuiltins){
 const reads={},externals=new Set(externalBuiltins);
 const result=await esbuild.build({absWorkingDir:sourceDir,entryPoints:[inside(sourceDir,entry)],bundle:true,write:false,format:'esm',platform:'node',target:'node22',metafile:true,logLevel:'silent',legalComments:'none',plugins:[{name:'pinned-reference-only-disabled-graph',setup(build){
  build.onResolve({filter:/^node:/},args=>{assert(externals.has(args.path),'UNAPPROVED_NODE_BUILTIN '+args.path);return {path:args.path,external:true};});
  build.onResolve({filter:/^[^./]/},args=>{if(!args.path.startsWith('node:')&&!path.isAbsolute(args.path))throw Error('EXTERNAL_PACKAGE_OR_ALIAS_REFUSED '+args.path);});
  build.onLoad({filter:/.*/,namespace:'file'},args=>{const n=path.relative(sourceDir,args.path).split(path.sep).join('/');assert(Object.hasOwn(graph,n),'SOURCE_OUTSIDE_APPROVED_REFERENCE_GRAPH '+n);const b=pinned(args.path,graph[n]);assert.equal(pins[n],graph[n]);reads[n]=sha(b);return {contents:b.toString('utf8'),loader:n.endsWith('.tsx')?'tsx':'ts',resolveDir:path.dirname(args.path)};});
 }}]});
 assert.equal(result.outputFiles.length,1);assert.deepEqual(reads,graph,'EXACT_COMPILED_SOURCE_GRAPH_NO_UNUSED_OR_MISSING_PIN');
 const outputs=Object.values(result.metafile.outputs);assert.equal(outputs.length,1);for(const r of outputs[0].imports)assert(r.external&&externals.has(r.path),'ONLY_APPROVED_BUILTIN_RUNTIME_IMPORTS');
 for(const [n,h] of Object.entries(reads))pinned(inside(sourceDir,n),h);
 return {bytes:Buffer.from(result.outputFiles[0].contents),metafile:result.metafile,sourceHashes:reads,exports:outputs[0].exports};
}
async function compileRuntime(sourceDir,pins,c){
 const binding=defaultBinding(sourceDir,pins,c);
 const service=await compileOne(sourceDir,pins,c.serviceEntry,c.serviceGraphSourceHashes,c.externalBuiltins),worker=await compileOne(sourceDir,pins,c.workerEntry,c.workerGraphSourceHashes,c.externalBuiltins);
 assert(service.exports.includes(c.effectiveServiceExport),'REAL_DEFAULT_EXPORT_NOT_COMPILED');
 return {...service,binding,workerBytes:worker.bytes,workerMetafile:worker.metafile,workerSourceHashes:worker.sourceHashes,workerSha256:sha(worker.bytes),runtimeContract:c,syntheticEntry:Buffer.from('// No synthetic runtime substitution; actual pinned full service entry compiled.\n'),syntheticEntrySha256:sha(Buffer.from('// No synthetic runtime substitution; actual pinned full service entry compiled.\n')),scope:'full actual reference-service graph and private compiled sibling worker only; manual default disabled, no config/cache provisioning, no live producer execution/acceptance, no app/main/API compilation',executed:false};
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
module.exports={validateContract,defaultBinding,compileRuntime,recordKey,validateSnapshot};
