'use strict';
// Finite exact parent-final-input policy. No production IO, network or application writes.
const C=require('./scoped-core.cjs'),S=require('./source-contract.cjs'),R=require('./runtime-scoped.cjs');
const {assert,path,sha,pinned,inside}=C;
const triples=rows=>rows.map(({relative,beforeSha256,afterSha256})=>({relative,beforeSha256,afterSha256})).sort((a,b)=>a.relative<b.relative?-1:a.relative>b.relative?1:0);
function finalInput(input){
 const parent=JSON.parse(pinned(input.parentFinalInputsPin.file,input.parentFinalInputsPin.sha256));
 assert.equal(parent.contractVersion,'channel-remediation-v4-brand-parent-final-inputs-v1');assert.equal(parent.finalizedForOfflineBuild,true,'WAIT_PARENT_FINAL_DATA_AND_SOURCE');assert.equal(parent.productionAuthorized,false);
 for(const n of ['sourceHashes','approvedSourceDeltas','expectedDataSummary','snapshotAfter','allowedChangedRecordKeys','oldSuccessByteProofPin','actualTSValidationPin','actualTSExecutionPin'])assert.deepEqual(input[n],parent[n],'EXACT_PARENT_FINAL_INPUT '+n);
 assert.equal(parent.baselineReportSha256,input.baselineReportSha256);assert.equal(parent.runtimeRoot,input.runtimeRoot);assert.equal(input.appFrozen,true,'NO_APPLICATION_SOURCE_WRITES');
 const e=input.expectedDataSummary;assert.deepEqual(Object.keys(e).sort(),['newSuccessCount','totalSuccessCount','changedRecordCount','changedSourcePairCount','sourceSuccessCounts'].sort());
 for(const n of ['newSuccessCount','totalSuccessCount','changedRecordCount','changedSourcePairCount'])assert(Number.isSafeInteger(e[n])&&e[n]>0);
 assert.equal(e.totalSuccessCount,189+e.newSuccessCount);assert.equal(e.sourceSuccessCounts.lcsc+e.sourceSuccessCounts.ickey,e.totalSuccessCount);assert(e.changedSourcePairCount<=588);assert(e.changedRecordCount<=294);
 const ts=JSON.parse(pinned(input.actualTSValidationPin.file,input.actualTSValidationPin.sha256)),execution=JSON.parse(pinned(input.actualTSExecutionPin.file,input.actualTSExecutionPin.sha256));assert.equal(execution.actualExitCode,0);assert.equal(ts.snapshotSha256,input.snapshotAfter.sha256);assert.equal(ts.validation.sourceCount,588);assert.equal(ts.validation.allValid,true);assert.equal(ts.validation.positiveCount,e.totalSuccessCount);
 for(const n of ['shared/channelReferenceBrand.ts','server/channelReference/snapshot.ts'])assert.deepEqual(Object.entries(ts.sourceHashesAtBuild).filter(([p])=>p===n||p.endsWith('/'+n)).map(([,h])=>h),[input.sourceHashes[n]],'ACTUAL_TS_FINAL_BRAND_SOURCE_PIN');
 return parent;
}
function sourceChanges(baseDir,input,b){
 assert.equal(Object.keys(input.sourceHashes).length,147);assert.deepEqual(Object.keys(input.sourceHashes).sort(),Object.keys(b.sourceHashes).sort(),'SOURCE147_PATH_SET_NO_ADD_REMOVE');
 S.approvedBrandDeltas(b.sourceHashes,input.sourceHashes,input.approvedSourceDeltas);
 const actual=C.sourceScope(inside(baseDir,'source-snapshot'),input.sourceDir,b.sourceHashes,input.sourceHashes,input.authorizedSourceDeltas);assert.deepEqual(triples(actual),triples(input.approvedSourceDeltas));return actual;
}
function recordKeys(document,oldData,newData,expected){
 assert.deepEqual(Object.keys(document).sort(),['onlyNonSourceChange','allowedChangedSourcePairs','candidateSha256','beforeSha256'].sort());assert.equal(document.onlyNonSourceChange,'/generatedAt');assert.equal(document.beforeSha256,sha(oldData));assert.equal(document.candidateSha256,sha(newData));
 const prior=JSON.parse(oldData),next=JSON.parse(newData),rows=document.allowedChangedSourcePairs;assert(Array.isArray(rows));assert.equal(rows.length,expected.changedSourcePairCount);assert.equal(new Set(rows.map(r=>r.sourcePairKey)).size,rows.length);
 const approved=new Set(),keys=new Set();for(const r of rows){
  assert.deepEqual(Object.keys(r).sort(),['recordIndex','partNumber','brand','source','sourcePairKey','recordKey'].sort());assert(Number.isSafeInteger(r.recordIndex)&&r.recordIndex>=0);assert(['lcsc','ickey'].includes(r.source));assert.equal(r.recordKey,r.partNumber+'\u0000'+r.brand);assert.equal(r.sourcePairKey,r.recordKey+'\u0000'+r.source);
  for(const data of [prior,next]){const record=data.records[r.recordIndex];assert(record);assert.equal(record.partNumber,r.partNumber);assert.equal(record.brand,r.brand);}
  const p=prior.records[r.recordIndex],q=next.records[r.recordIndex];assert(p.references[r.source].status!=='ok','OLD_SUCCESS_CANNOT_BE_DELTA');assert.equal(q.references[r.source].status,'ok','APPROVED_NEW_SUCCESS_ONLY');
  assert.notDeepEqual({reference:p.references[r.source],evidence:p.evidence[r.source]},{reference:q.references[r.source],evidence:q.evidence[r.source]},'NO_UNUSED_SOURCE_PAIR_APPROVAL');approved.add(r.sourcePairKey);keys.add(R.recordKey(r));
 }
 assert.equal(keys.size,expected.changedRecordCount);assert.equal(rows.length,expected.newSuccessCount);
 assert.deepEqual({...prior,generatedAt:null,records:null},{...next,generatedAt:null,records:null},'ONLY_GENERATED_AT_TOPLEVEL_DELTA');assert.equal(prior.records.length,next.records.length);
 for(let i=0;i<prior.records.length;i++){
  const p=prior.records[i],q=next.records[i];assert.deepEqual({...p,references:null,evidence:null},{...q,references:null,evidence:null},'RECORD_IDENTITY_AND_ALL_METADATA_FROZEN '+i);
  for(const source of ['lcsc','ickey'])if(!approved.has(p.partNumber+'\u0000'+p.brand+'\u0000'+source)){assert.deepEqual(p.references[source],q.references[source],'UNAPPROVED_QUOTE_PAIR '+i+' '+source);assert.deepEqual(p.evidence[source],q.evidence[source],'UNAPPROVED_EVIDENCE_PAIR '+i+' '+source);}
 }
 return [...keys];
}
function runtimeContract(oldCandidate,old,newPins,prior,approved){
 const deltas=S.approvedBrandDeltas(prior,newPins,approved),c=JSON.parse(pinned(inside(oldCandidate,'runtime-build-contract.json'),old.packageHashes['runtime-build-contract.json'])),frozen=JSON.parse(JSON.stringify(c));
 assert(Object.hasOwn(c.serviceGraphSourceHashes,S.SNAPSHOT_CORE),'ORIGINAL_SERVICE_GRAPH_ALREADY_CONTAINS_SNAPSHOT_CORE');
 for(const field of ['serviceGraphSourceHashes','workerGraphSourceHashes']){
  assert(Object.hasOwn(c[field],S.BRAND),'ORIGINAL_RUNTIME_GRAPH_ALREADY_CONTAINS_BRAND');
  for(const [n,h] of Object.entries(c[field])){assert.equal(h,prior[n],'ACTUAL_V3_COMPILE_GRAPH_PIN');if(newPins[n]!==h){assert(S.BRAND_RUNTIME.has(n)&&deltas.some(r=>r.relative===n&&r.beforeSha256===h&&r.afterSha256===newPins[n]),'ONLY_EXACT_APPROVED_BRAND_OR_SNAPSHOT_RUNTIME_HASH');c[field][n]=newPins[n];}else assert.equal(c[field][n],frozen[field][n],'UNCHANGED_RUNTIME_SOURCE_HASH_FREEZE');}
  assert.deepEqual(Object.keys(c[field]),Object.keys(frozen[field]),'EXACT_ORIGINAL_RUNTIME_GRAPH_PATHS');
 }
 assert.deepEqual({...c,serviceGraphSourceHashes:null,workerGraphSourceHashes:null},{...frozen,serviceGraphSourceHashes:null,workerGraphSourceHashes:null},'ORIGINAL_ENTRIES_BUILTINS_CONFIG_AND_GRAPH_CONTRACT_FREEZE');return c;
}
function nativeInputsUnchanged(oldCandidate,old,prior,next,changes){
 S.approvedBrandDeltas(prior,next,triples(changes));
 const meta=JSON.parse(pinned(inside(oldCandidate,'host-metafile.json'),old.packageHashes['host-metafile.json'])),inputs=Object.keys(meta.inputs);
 for(const n of S.BRAND_RUNTIME)assert(!inputs.some(p=>p===n||p.endsWith('/'+n)),'BRAND_AND_SNAPSHOT_CORE_NOT_IN_NATIVE_GRAPH');
 for(const row of changes){assert(S.BRAND_ALLOWED.has(row.relative),'FINITE_NATIVE_EXCLUDED_SOURCE_DELTA_ONLY');assert(!inputs.some(n=>n===row.relative||n.endsWith('/'+row.relative)),'SOURCE_DELTA_IN_NATIVE_GRAPH');}
 for(const n of Object.keys(prior).filter(n=>n.startsWith('client/')||['package.json','pnpm-lock.yaml','tsconfig.json'].includes(n)))assert.equal(next[n],prior[n],'NATIVE_SOURCE_AND_CONFIG_BYTE_FREEZE');
 return {nativeCompileInputsUnchanged:true,nativeOutputBytesUnchanged:true,backendBrandAndEvidenceUrlSourceDeltas:true};
}
module.exports={triples,finalInput,sourceChanges,recordKeys,runtimeContract,nativeInputsUnchanged};
