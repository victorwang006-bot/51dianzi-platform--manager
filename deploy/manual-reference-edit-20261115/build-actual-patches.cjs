#!/usr/bin/env node
'use strict';
// OFFLINE ONLY. Mature previous builder's finite AST ownership/byte-partition/inverse
// engine; all previous feature recipes REMOVED. No acquired bundle import/execution.
// Final JS fragments and source->native-name mapping must be independently approved.
const C=require('./scoped-core.cjs'),B=require('./build-candidate.cjs');
const {fs,path,ts,assert,sha,pinned,regular,inside,parse}=C;
const PINS={front:'132c2a9924da37ccb50fadeb014865400df5cddf8d2255594631041cb1718538',admin:'50f425a421f4ad44f4a9f91744ec168b61c2103303ba54d0cc7fe67576563b9f'};
const enc=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');
function named(n,a){return ts.isFunctionDeclaration(n)?n.name?.text:ts.isVariableStatement(n)?n.declarationList.declarations.map(d=>d.name.getText(a)).join(','):n.kind+':'+sha(n.getText(a));}
function owner(a,name){return C.one(a.statements,n=>named(n,a)===name,'unique actual native AST owner '+name);}
function methods(a,n,name){return C.one(n,x=>ts.isMethodDeclaration(x)&&x.name.getText(a)===name,'unique owned method '+name);}
function imports(a){return C.nodes(a,n=>((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier)||(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword)).map(n=>n.getText(a));}
function build(planFile,planSha,out){
 const pb=pinned(planFile,planSha),p=JSON.parse(pb);assert.equal(p.contractVersion,'manual-reference-edit-backend-plan-v1');assert.equal(p.runtimeRoot,B.ROOT);assert.equal(p.ownerTask,B.OWNER);assert.equal(p.approved,true,'PARENT_FINAL_BACKEND_PLAN_APPROVAL_REQUIRED');assert.equal(p.fixtureOnly,false);assert.equal(p.sourceMappingApprovedByParent,true,'NATIVE_SQL_AND_RUNTIME_IDENTIFIER_MAPPING_REQUIRES_REVIEW');
 const source=path.resolve(p.sourceDir);assert(!fs.existsSync(source+'/.git')&&!fs.existsSync(source+'/node_modules'),'FROZEN_SOURCE_SNAPSHOT_ONLY');assert(p.sourceHashes&&Object.keys(p.sourceHashes).length>=172,'COMPLETE_PRIOR172_SOURCE_PLUS_NEW_REQUIRED');
 for(const [n,h] of Object.entries(p.sourceHashes))pinned(inside(source,n),h);
 assert.deepEqual(Object.keys(p.backends).sort(),['admin','front']);assert(!fs.existsSync(out),'NEW_LOCAL_PATCH_OUTPUT_ONLY');const files={},reports={};
 for(const kind of ['front','admin']){
  const s=p.backends[kind];assert.equal(s.beforeSha256,PINS[kind]);const inputPath=path.resolve(s.inputPath),baseline=pinned(inputPath,PINS[kind]),text=baseline.toString('utf8');assert(Buffer.from(text).equals(baseline));const sf=parse(text);assert(Array.isArray(s.spans)&&s.spans.length>0);
  const edits=[];assert.equal(new Set(s.spans.map(x=>x.id)).size,s.spans.length,'UNIQUE_SPAN_IDS');
  for(const e of s.spans){
   const n=owner(sf,e.owner);assert.equal(sha(n.getText(sf)),e.ownerBeforeSha256,'EXACT_NATIVE_OWNER_PIN '+e.owner);
   assert(Array.isArray(e.sources)&&e.sources.length>0&&new Set(e.sources).size===e.sources.length);for(const name of e.sources){C.relative(name);assert(p.sourceHashes[name],'SPAN_SOURCE_NOT_APPROVED '+name);}
   const inserted=pinned(e.insertedPin.file,e.insertedPin.sha256).toString('utf8');let start,end;
   if(e.mode==='insert-before-owner'){start=n.getStart(sf);end=start;}
   else if(e.mode==='insert-after-owner'){start=n.end;end=start;}
   else if(e.mode==='replace-owner'){start=n.getStart(sf);end=n.end;}
   else {
    const target=e.method?methods(sf,n,e.method):n;assert(!e.method||ts.isFunctionDeclaration(n),'METHOD_OWNER_MUST_BE_FUNCTION');
    if(e.mode==='replace-method'){assert(e.method);start=target.getStart(sf);end=target.end;}
    else {assert.equal(e.mode,'replace-anchor');assert(typeof e.needle==='string'&&e.needle.length>0);const own=target.getText(sf),at=own.indexOf(e.needle);assert(at>=0&&own.indexOf(e.needle,at+1)<0,'UNIQUE_EXACT_NATIVE_ANCHOR '+e.id);start=target.getStart(sf)+at;end=start+e.needle.length;}
   }
   assert(start>=n.getStart(sf)&&end<=n.end,'OWNER_SLICE_BOUNDS');const removed=text.slice(start,end);assert.equal(sha(removed),e.removedSha256,'EXACT_REMOVED_BYTE_PIN');
   edits.push({id:e.id,owner:e.owner,start,end,inserted,source:e.sources.join(' + '),ownerBeforeSha256:e.ownerBeforeSha256,insertedArtifactSha256:e.insertedPin.sha256});
  }
  // Original builder's forward partition + full inverse engine, with overlap refusal.
  edits.sort((a,b)=>a.start-b.start||a.end-b.end);
  const spans=edits.map(e=>({...e,offset:Buffer.byteLength(text.slice(0,e.start)),removed:text.slice(e.start,e.end),removedByteLength:Buffer.byteLength(text.slice(e.start,e.end)),insertedByteLength:Buffer.byteLength(e.inserted),beforeSha256:sha(text.slice(e.start,e.end)),insertedSha256:sha(e.inserted)}));
  let cursor=0,shift=0;const parts=[];
  for(const e of spans){assert(e.offset>=cursor,'OVERLAPPING_NATIVE_SPANS');assert.equal(sha(baseline.subarray(e.offset,e.offset+e.removedByteLength)),e.beforeSha256);e.afterOffset=e.offset+shift;parts.push(baseline.subarray(cursor,e.offset),Buffer.from(e.inserted));cursor=e.offset+e.removedByteLength;shift+=e.insertedByteLength-e.removedByteLength;}
  parts.push(baseline.subarray(cursor));const patched=Buffer.concat(parts),afterSf=parse(patched.toString());assert.deepEqual(imports(sf),imports(afterSf),'ALL_REFERENCE_AND_API_IMPORT_AST_TEXT_FROZEN');
  const inverse=spans.map(e=>({id:e.id,owner:e.owner,offset:e.afterOffset,removedByteLength:e.insertedByteLength,removed:e.inserted,inserted:e.removed,beforeSha256:e.insertedSha256}));
  cursor=0;const recovered=[];for(const e of inverse){assert.equal(sha(patched.subarray(e.offset,e.offset+e.removedByteLength)),e.beforeSha256);recovered.push(patched.subarray(cursor,e.offset),Buffer.from(e.inserted));cursor=e.offset+e.removedByteLength;}recovered.push(patched.subarray(cursor));assert(Buffer.concat(recovered).equals(baseline),'FULL_INVERSE_EQUALITY');
  const observed=[...new Set(spans.map(e=>e.owner))].sort();assert.deepEqual(observed,s.approvedOwners.slice().sort(),'EXACT_APPROVED_NATIVE_OWNER_SET');
  const beforeNames=new Set(sf.statements.map(n=>named(n,sf))),added=afterSf.statements.map(n=>named(n,afterSf)).filter(n=>!beforeNames.has(n)).sort();assert.deepEqual(added,s.approvedAddedOwners.slice().sort(),'EXACT_APPROVED_NEW_SQL_HELPER_OWNERS');
  const untouched=sf.statements.filter(n=>!observed.includes(named(n,sf)));for(const n of untouched)assert.equal(owner(afterSf,named(n,sf)).getText(afterSf),n.getText(sf),'UNRELATED_TOP_LEVEL_OWNER_FROZEN');
  const protectedOwners=['originalActorClaims','officialMaterialCreator','officialMaterialRecorderAdminAccountId','continued20261112_channelSourceReadEligibility'].filter(name=>sf.statements.some(n=>named(n,sf)===name));
  for(const name of protectedOwners)assert.equal(owner(sf,name).getText(sf),owner(afterSf,name).getText(afterSf),'ORIGINAL_SECURITY_EVIDENCE_FROZEN '+name);
  const proof={schemaVersion:1,kind,inputPath,beforeSha256:PINS[kind],afterSha256:sha(patched),spans,inverse,protectedOwners:protectedOwners.map(name=>({name,sha256:sha(owner(sf,name).getText(sf)),byteIdentical:true})),verification:{baselineDoublePinned:true,uniqueAstOwners:true,wholeBundleSyntax:true,fullInverseRecovered:true,untouchedBytesPreserved:true},parentBackendPlanSha256:planSha,sourceHashes:p.sourceHashes,scope:'Offline precise native owners only; no whole build/import, DB/SSH/reload; source-to-native mapping is separately parent-approved'};
  const spec={candidatePin:{file:'memory',sha256:sha(patched)},proofPin:{file:'memory',sha256:sha(enc(proof))},approvedOwners:s.approvedOwners,approvedAddedOwners:s.approvedAddedOwners};
  // Full generated normalization is checked again by prepare-build-input/build-candidate.
  files['baseline-'+kind+'-index.js']=baseline;files['patched-'+kind+'-index.js']=patched;files[kind+'-patchproof.json']=enc(proof);reports[kind]={beforeSha256:PINS[kind],afterSha256:sha(patched),spans:spans.length,approvedOwners:s.approvedOwners,approvedAddedOwners:s.approvedAddedOwners};pinned(inputPath,PINS[kind]);
 }
 pinned(planFile,planSha);for(const [n,h] of Object.entries(p.sourceHashes))pinned(inside(source,n),h);for(const s of Object.values(p.backends))for(const e of s.spans)pinned(e.insertedPin.file,e.insertedPin.sha256);
 files['parent-backend-plan.json']=pb;fs.mkdirSync(out,{mode:0o700});for(const [n,b] of Object.entries(files))fs.writeFileSync(inside(out,n),b,{flag:'wx',mode:0o600});
 for(const kind of ['front','admin']){const s=p.backends[kind];B.backend(files['baseline-'+kind+'-index.js'],{candidatePin:{file:inside(out,'patched-'+kind+'-index.js'),sha256:sha(files['patched-'+kind+'-index.js'])},proofPin:{file:inside(out,kind+'-patchproof.json'),sha256:sha(files[kind+'-patchproof.json'])},approvedOwners:s.approvedOwners,approvedAddedOwners:s.approvedAddedOwners},kind);}
 return {status:'OFFLINE_EXACT_PATCH_BUILT_REQUIRES_FINAL_NATIVE_QA',output:out,reports,productionExecuted:false};
}
if(require.main===module){try{const a=process.argv.slice(2);assert(a.length===6&&a[0]==='--plan'&&a[2]==='--sha256'&&a[4]==='--out');console.log(JSON.stringify(build(a[1],a[3],path.resolve(a[5])),null,2));}catch(e){console.error('MANUAL_REFERENCE_BACKEND_ABORT: '+e.stack);process.exitCode=1;}}
module.exports={build,named,owner,PINS};
