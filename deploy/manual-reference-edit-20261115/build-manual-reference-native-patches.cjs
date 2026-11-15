#!/usr/bin/env node
'use strict';
// OFFLINE ONLY: actual TS/esbuild AST fragments on exact current front/admin bytes.
// Never execute/import/rebuild acquired API bundles. No SSH, DB, reload, Git or approval.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const REPO='/home/ubuntu/work/51dianzi-platform--manager';
const ts=require(REPO+'/node_modules/typescript'),esbuild=require(REPO+'/node_modules/esbuild');
const C=require('./scoped-core.cjs'),B=require('./build-candidate.cjs'),P=require('./build-actual-patches.cjs');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const enc=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');
const BASE_SHA='e403665e1541ebd044d4fd382019565602cfb028961a40d5a988de4e09a13884';
const DIR='client/src/business/platform/front-router-types/server/services/';
const SOURCES={schema:'client/src/business/platform/shared/channelInventoryCollaboration.ts',collaboration:DIR+'channelInventoryCollaboration.ts',team:DIR+'channelTeamInventory.ts',manual:DIR+'channelInventoryManualReference.ts'};
const ALLOWED={front:['teamMaterialPublicUpdateFields','teamMaterialPublicFrom','authorizedMaterial','createChannelInventoryCollaborationService','teamMaterialFrom','createChannelTeamInventoryService'],admin:['teamMaterialPublicUpdateFields']};
const ADDED={front:['channelInventoryManualReferenceValuesFrom','readChannelInventoryManualReferences','upsertChannelInventoryManualReferences'],admin:[]};
const parse=(text,kind=ts.ScriptKind.JS)=>{const a=ts.createSourceFile('isolated.'+(kind===ts.ScriptKind.TS?'ts':'js'),text,ts.ScriptTarget.Latest,true,kind);assert.equal(a.parseDiagnostics.length,0,'AST syntax');return a;};
const one=(arr,label)=>{assert.equal(arr.length,1,label);return arr[0];};
function nodes(root,p){const out=[];function walk(n){if(p(n))out.push(n);ts.forEachChild(n,walk);}walk(root);return out;}
function owner(a,name){return one(a.statements.filter(n=>P.named(n,a)===name),'unique owner '+name);}
function func(a,name){const n=owner(a,name);assert(ts.isFunctionDeclaration(n));return n;}
function prop(a,n,name){return one(nodes(n,x=>ts.isPropertyAssignment(x)&&x.name.getText(a)===name),'property '+name);}
function method(a,n,name){return one(nodes(n,x=>ts.isMethodDeclaration(x)&&x.name.getText(a)===name),'method '+name);}
function statements(a,n,p,label){return one(nodes(n,x=>ts.isStatement(x)&&p(x.getText(a),x)),'statement '+label);}
function program(a,imports=''){
 const filename='/__offline_lexical__.ts';const text=imports+a.text;
 const sf=ts.createSourceFile(filename,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const opts={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,noResolve:true,noLib:true};
 const host=ts.createCompilerHost(opts);host.getSourceFile=(f)=>f===filename?sf:undefined;host.fileExists=f=>f===filename;host.readFile=f=>f===filename?text:undefined;host.writeFile=()=>{};
 const p=ts.createProgram([filename],opts,host);return {sf,checker:p.getTypeChecker(),prefix:imports.length};
}
function lexicalRename(raw,map,wrapper='functions'){
 const prefix=wrapper==='properties'?'const __fragment = {\n':wrapper==='statements'?'function __fragment(tx,scope,row,updated,input,items){\n':'';
 const suffix=wrapper==='properties'?'\n};':wrapper==='statements'?'\n}':'';
 const decl='import { '+Object.keys(map).join(', ')+' } from "__offline_native_bindings__";\n';
 const p=program({text:prefix+raw+suffix},decl),importNode=p.sf.statements[0];assert(ts.isImportDeclaration(importNode));
 const symbols=new Map(importNode.importClause.namedBindings.elements.map(n=>[p.checker.getSymbolAtLocation(n.name),n.name.text]));
 const edits=[];for(const n of nodes(p.sf,ts.isIdentifier)){
  const sourceName=symbols.get(p.checker.getSymbolAtLocation(n));if(!sourceName||n.getStart(p.sf)<p.prefix+prefix.length||n.end>p.prefix+prefix.length+raw.length)continue;
  edits.push({start:n.getStart(p.sf)-p.prefix-prefix.length,end:n.end-p.prefix-prefix.length,before:sourceName,after:map[sourceName]});
 }
 let out=raw;for(const e of edits.slice().sort((a,b)=>b.start-a.start))out=out.slice(0,e.start)+e.after+out.slice(e.end);
 parse(prefix+out+suffix);return {code:out,references:edits};
}
function importEvidence(a,root,exportName,moduleName){
 const references=nodes(root,n=>ts.isIdentifier(n)&&n.text===exportName);assert(references.length>0,'actual reference '+exportName);
 const imp=one(a.statements.filter(n=>ts.isImportDeclaration(n)&&n.moduleSpecifier.text===moduleName&&n.importClause?.namedBindings&&ts.isNamedImports(n.importClause.namedBindings)&&n.importClause.namedBindings.elements.some(e=>e.name.text===exportName)),'actual imported binding '+exportName);
 const spec=one(imp.importClause.namedBindings.elements.filter(e=>e.name.text===exportName),'import spec');
 return {nativeName:exportName,module:moduleName,exportName:spec.propertyName?.text||spec.name.text,importText:imp.getText(a),importSha256:sha(imp.getText(a)),referenceOwner:P.named(root,a),referenceOwnerSha256:sha(root.getText(a)),referenceCount:references.length};
}
function aliases(a,kind){
 const schema=owner(a,'teamMaterialPublicUpdateFields'),price=prop(a,schema,'price');
 const z=one([...new Set(nodes(price,n=>ts.isIdentifier(n)&&/^z\d*$/.test(n.text)).map(n=>n.text))],'z price root');
 const out={z:importEvidence(a,schema,z,'zod')};assert.equal(out.z.exportName,'z');
 if(kind==='front'){
  const auth=func(a,'authorizedMaterial'),tags=nodes(auth,ts.isTaggedTemplateExpression);const sql=one([...new Set(tags.map(n=>n.tag.getText(a)).filter(x=>/^sql\d*$/.test(x)))],'native authorized SQL');
  out.sql=importEvidence(a,auth,sql,'drizzle-orm');assert.equal(out.sql.exportName,'sql');
  const err=owner(a,'ChannelInventoryError');assert(ts.isVariableStatement(err));assert.equal(err.declarationList.declarations[0].name.getText(a),'ChannelInventoryError');
  const service=func(a,'createChannelInventoryCollaborationService');assert(nodes(service,n=>ts.isNewExpression(n)&&n.expression.getText(a)==='ChannelInventoryError').length>0);
  out.ChannelInventoryError={nativeName:'ChannelInventoryError',declarationOwner:'ChannelInventoryError',declarationSha256:sha(err.getText(a)),referenceOwner:'createChannelInventoryCollaborationService',referenceOwnerSha256:sha(service.getText(a))};
 }
 return out;
}
function stripExport(a,n){let t=n.getText(a);for(const m of (n.modifiers||[]).filter(m=>m.kind===ts.SyntaxKind.ExportKeyword||m.kind===ts.SyntaxKind.DefaultKeyword).sort((x,y)=>y.pos-x.pos)){const s=m.getStart(a)-n.getStart(a),e=m.end-n.getStart(a);t=t.slice(0,s)+t.slice(e);}return t;}
async function build(args){
 const source=path.resolve(args.source),base=path.resolve(args.baseline),out=path.resolve(args.out),evidence=path.resolve(args.evidence);
 assert.equal(args.baselineSha256,BASE_SHA);assert(!fs.existsSync(out)&&!fs.existsSync(evidence),'new local output/evidence only');
 const q=B.baseline(base,BASE_SHA),sourceBytes={},sourceHashes={};for(const [key,n]of Object.entries(SOURCES)){const bytes=fs.readFileSync(path.join(source,n));assert(Buffer.from(bytes.toString('utf8')).equals(bytes),'source UTF8');sourceBytes[key]=bytes;sourceHashes[n]=sha(bytes);}
 const evidenceFiles={},compileRecords={};
 async function compiled(key,names){
  const a=parse(sourceBytes[key].toString(),ts.ScriptKind.TS),selected=names.map(n=>owner(a,n));const input=selected.map(n=>stripExport(a,n)).join('\n\n');
  const result=await esbuild.transform(input,{loader:'ts',target:'es2022',charset:'utf8',minify:false,treeShaking:false,sourcefile:SOURCES[key]});assert.equal(result.warnings.length,0);
  const filename='transforms/'+key+'.js';evidenceFiles[filename]=Buffer.from(result.code);evidenceFiles['transforms/'+key+'.input.ts']=Buffer.from(input+'\n');
  compileRecords[key]={source:SOURCES[key],sourceSha256:sourceHashes[SOURCES[key]],owners:selected.map(n=>({name:P.named(n,a),sourceOwnerSha256:sha(n.getText(a))})),inputSha256:sha(input+'\n'),outputSha256:sha(result.code),esbuildOptions:{loader:'ts',target:'es2022',charset:'utf8',minify:false,treeShaking:false},output:filename};return parse(result.code);
 }
 const schema=await compiled('schema',['teamMaterialPublicUpdateFields']),collab=await compiled('collaboration',['teamMaterialPublicFrom','authorizedMaterial','createChannelInventoryCollaborationService']),team=await compiled('team',['teamMaterialFrom','createChannelTeamInventoryService']),manual=await compiled('manual',ADDED.front);
 const fragments={};
 function fragment(id,code,key,wrapper,map){const r=lexicalRename(code,map,wrapper),file='fragments/'+id+'.js';evidenceFiles[file]=Buffer.from(r.code+'\n');fragments[id]={file,sha256:sha(r.code+'\n'),semanticCodeSha256:sha(r.code),source:SOURCES[key],sourceSha256:sourceHashes[SOURCES[key]],transform:compileRecords[key].output,transformSha256:compileRecords[key].outputSha256,wrapper,lexicalMap:map,renamedReferences:r.references};return r.code;}
 const files={},reports={},backendSpecs={},plans={};
 for(const kind of ['front','admin']){
  const inputPath=path.join(base,kind+'-index.js'),baseline=fs.readFileSync(inputPath),text=baseline.toString('utf8');assert.equal(sha(baseline),P.PINS[kind]);assert(Buffer.from(text).equals(baseline));const a=parse(text),maps=aliases(a,kind);evidenceFiles['maps/'+kind+'-lexical-map.json']=enc(maps);
  const draft=JSON.parse(fs.readFileSync(path.join(__dirname,'backend-plan-draft/'+kind+'-owners.json')));for(const name of ALLOWED[kind])assert.equal(sha(owner(a,name).getText(a)),one(draft.filter(x=>x.owner===name),'draft '+name).sha256,'native draft owner pin');
  const edits=[];
  function insert(id,name,pos,code,key,wrapper='statements',map={}){const n=owner(a,name);assert(pos>=n.getStart(a)&&pos<=n.end);const native=fragment(kind+'-'+id,code,key,wrapper,map);edits.push({id,owner:name,start:pos,end:pos,inserted:'\n'+native+'\n',source:SOURCES[key],ownerBeforeSha256:sha(n.getText(a)),fragment:fragments[kind+'-'+id]});}
  const sc=owner(a,'teamMaterialPublicUpdateFields');insert('schema-manual-two-prices','teamMaterialPublicUpdateFields',prop(a,sc,'taxIncluded').getStart(a),['manualReferenceLcsc','manualReferenceIckey'].map(n=>prop(schema,owner(schema,'teamMaterialPublicUpdateFields'),n).getText(schema)+',').join('\n'),'schema','properties',{z:maps.z.nativeName});
  if(kind==='front'){
   insert('manual-sql-helpers','teamMaterialPublicFrom',owner(a,'teamMaterialPublicFrom').getStart(a),ADDED.front.map(n=>func(manual,n).getText(manual)).join('\n\n'),'manual','functions',{sql:maps.sql.nativeName,ChannelInventoryError:'ChannelInventoryError'});
   for(const [key,name]of [['collaboration','teamMaterialPublicFrom'],['team','teamMaterialFrom']]){const js=key==='collaboration'?collab:team;const spread=one(nodes(func(js,name),n=>ts.isSpreadAssignment(n)&&n.expression.getText(js)==='channelInventoryManualReferenceValuesFrom(row)'),'actual source spread');const anchor=key==='collaboration'?'leadTime':'industryCode';insert(name+'-manual-projection',name,prop(a,owner(a,name),anchor).getStart(a),spread.getText(js)+',',key,'properties',{});}
   const auth=owner(a,'authorizedMaterial');const srcAuth=func(collab,'authorizedMaterial');const read=statements(collab,srcAuth,t=>t.startsWith('Object.assign(row,')&&t.includes('readChannelInventoryManualReferences'),'authorized manual enrichment');const ret=one(nodes(auth,n=>ts.isReturnStatement(n)&&n.expression?.getText(a)==='row'),'authorized final return');insert('authorized-manual-after-gates','authorizedMaterial',ret.getStart(a),read.getText(collab),'collaboration');
   const service=owner(a,'createChannelInventoryCollaborationService'),update=method(a,service,'updateTeamMaterial'),srcUpdate=method(collab,func(collab,'createChannelInventoryCollaborationService'),'updateTeamMaterial');
   const upsert=statements(collab,srcUpdate,t=>t.startsWith('await upsertChannelInventoryManualReferences('),'manual upsert');const updated=statements(a,update,t=>t.startsWith('const updated ='),'updated reselect');const cas=statements(a,update,(t,n)=>ts.isIfStatement(n)&&t.includes('affectedRows')&&t.includes('conflict3()'),'original CAS guard');assert(cas.end<updated.getStart(a));insert('manual-upsert-after-cas','createChannelInventoryCollaborationService',updated.getStart(a),upsert.getText(collab),'collaboration');
   const reread=statements(collab,srcUpdate,t=>t.startsWith('Object.assign(updated,')&&t.includes('readChannelInventoryManualReferences'),'updated manual read');const channel=statements(a,update,t=>t.startsWith('updated.channelName ='),'updated channel name');const notFound=statements(a,update,t=>t==='if (!updated) notFound();','existing update notFound');assert(notFound.end<=channel.getStart(a));insert('manual-read-before-audit','createChannelInventoryCollaborationService',channel.getStart(a),reread.getText(collab),'collaboration');
   const list=method(a,owner(a,'createChannelTeamInventoryService'),'listTeamMaterials'),srcList=method(team,func(team,'createChannelTeamInventoryService'),'listTeamMaterials');assert(nodes(list,n=>ts.isIdentifier(n)&&n.text==='manualReferences').length===0,'new local must not collide');
   const manualDecl=statements(team,srcList,t=>t.startsWith('const manualReferences ='),'batch manual declaration');const forRows=one(nodes(list,n=>ts.isForOfStatement(n)&&n.expression.getText(a)==='items'),'authorized item loop');const publications=statements(a,list,t=>t.startsWith('const publications ='),'publication enrichment');assert(publications.end<=forRows.getStart(a));insert('list-authorized-batch-manual-read','createChannelTeamInventoryService',forRows.getStart(a),manualDecl.getText(team),'team');
   const assign=statements(team,srcList,t=>t.startsWith('Object.assign(row, manualReferences.'),'list manual assignment');assert(ts.isBlock(forRows.statement));insert('list-manual-price-enrichment','createChannelTeamInventoryService',forRows.statement.statements[0].getStart(a),assign.getText(team),'team');
  }
  edits.sort((x,y)=>x.start-y.start||x.end-y.end);const spans=edits.map(e=>({...e,offset:Buffer.byteLength(text.slice(0,e.start)),removed:text.slice(e.start,e.end),removedByteLength:Buffer.byteLength(text.slice(e.start,e.end)),insertedByteLength:Buffer.byteLength(e.inserted),beforeSha256:sha(text.slice(e.start,e.end)),insertedSha256:sha(e.inserted)}));
  let cursor=0,shift=0;const parts=[];for(const e of spans){assert(e.offset>=cursor,'no overlap');e.afterOffset=e.offset+shift;parts.push(baseline.subarray(cursor,e.offset),Buffer.from(e.inserted));cursor=e.offset+e.removedByteLength;shift+=e.insertedByteLength-e.removedByteLength;}parts.push(baseline.subarray(cursor));const patched=Buffer.concat(parts);assert(Buffer.from(patched.toString('utf8')).equals(patched));const after=parse(patched.toString('utf8'));
  const inverse=spans.map(e=>({id:e.id,owner:e.owner,offset:e.afterOffset,removedByteLength:e.insertedByteLength,removed:e.inserted,inserted:e.removed,beforeSha256:e.insertedSha256}));cursor=0;const recovered=[];for(const e of inverse){assert.equal(sha(patched.subarray(e.offset,e.offset+e.removedByteLength)),e.beforeSha256);recovered.push(patched.subarray(cursor,e.offset),Buffer.from(e.inserted));cursor=e.offset+e.removedByteLength;}recovered.push(patched.subarray(cursor));assert(Buffer.concat(recovered).equals(baseline),'complete UTF8 inverse');
  assert.deepEqual([...new Set(spans.map(e=>e.owner))].sort(),ALLOWED[kind].slice().sort());const beforeNames=a.statements.map(n=>P.named(n,a)),afterNames=after.statements.map(n=>P.named(n,after)),existing=new Set(beforeNames);assert.deepEqual(afterNames.filter(n=>existing.has(n)),beforeNames,'existing owner order');assert.deepEqual(afterNames.filter(n=>!existing.has(n)).sort(),ADDED[kind].slice().sort());const afterExisting=after.statements.filter(n=>existing.has(P.named(n,after)));for(let i=0;i<a.statements.length;i++){const n=a.statements[i];if(!ALLOWED[kind].includes(P.named(n,a)))assert.equal(afterExisting[i].getText(after),n.getText(a),'untouched native owner at '+i);}
  // Every edit is insertion only; all existing owner bytes, including native-only
  // security checks, source filters, CAS/audit/retry code, are retained in order.
  assert(spans.every(e=>e.removedByteLength===0));
  const protectedOwners=a.statements.filter(n=>ts.isFunctionDeclaration(n)&&(/reference|price/i.test(n.name?.text)||['originalActorClaims','officialMaterialCreator','officialMaterialRecorderAdminAccountId','continued20261112_channelSourceReadEligibility'].includes(n.name?.text))).map(n=>{assert.equal(owner(after,n.name.text).getText(after),n.getText(a));return {name:n.name.text,sha256:sha(n.getText(a)),byteIdentical:true};});
  const proof={schemaVersion:1,kind,inputPath,beforeSha256:sha(baseline),afterSha256:sha(patched),spans,inverse,protectedOwners,verification:{baselineDoublePinned:true,uniqueAstOwners:true,wholeBundleSyntax:true,fullInverseRecovered:true,untouchedBytesPreserved:true,allExistingOwnerOrderPreserved:true,allSpansInsertOnly:true},status:'await_parent_review',approved:false,sourceMappingApprovedByParent:false,sourceHashes,baselineReportSha256:BASE_SHA,lexicalMapping:maps,compiler:{name:'esbuild.transform',version:esbuild.version,typescriptVersion:ts.version,records:compileRecords},scope:'Offline exact actual TS/esbuild AST lexical insertions only; no whole API build/import, SSH, DB, reload, commit or parent approval'};
  files['baseline-'+kind+'-index.js']=baseline;files['patched-'+kind+'-index.js']=patched;files[kind+'-patchproof.json']=enc(proof);
  backendSpecs[kind]={changed:true,candidatePin:{file:path.join(out,'patched-'+kind+'-index.js'),sha256:sha(patched)},proofPin:{file:path.join(out,kind+'-patchproof.json'),sha256:sha(files[kind+'-patchproof.json'])},approvedOwners:ALLOWED[kind],approvedAddedOwners:ADDED[kind]};
  plans[kind]={inputPath,beforeSha256:sha(baseline),proposedOwners:ALLOWED[kind],proposedAddedOwners:ADDED[kind],spans:spans.map(e=>({id:e.id,owner:e.owner,ownerBeforeSha256:e.ownerBeforeSha256,mode:'exact-insert',start:e.start,end:e.end,removedSha256:e.beforeSha256,insertedSha256:e.insertedSha256,fragment:e.fragment,sources:[e.source]}))};
  reports[kind]={beforeSha256:sha(baseline),afterSha256:sha(patched),spanCount:spans.length,changedOwners:ALLOWED[kind].map(name=>({name,beforeSha256:sha(owner(a,name).getText(a)),afterSha256:sha(owner(after,name).getText(after))})),addedOwners:ADDED[kind].map(name=>({name,sha256:sha(owner(after,name).getText(after))})),protectedOwnerCount:protectedOwners.length};
 }
 const frozenReferenceSources=[];for(const [n,h]of Object.entries(q.prior))if(n.startsWith('server/channelReference/')||['server/channelReferenceRouter.ts','shared/channelReference.ts','shared/channelReferenceBrand.ts','shared/channelReferenceRefresh.ts'].includes(n)){const old=C.pinned(path.join(base,'source-snapshot',n),h),live=fs.readFileSync(path.join(source,n));assert(old.equals(live),'reference source bytes frozen '+n);frozenReferenceSources.push({path:n,sha256:h,byteIdentical:true});}
 const frozenHelpers=q.b.runtimeHelpers.map(r=>{const b=C.pinned(path.join(base,r.relative),r.sha256);return {...r,bytes:b.length,byteIdentical:true,recompiled:false};});
 for(const [key,n]of Object.entries(SOURCES))assert(fs.readFileSync(path.join(source,n)).equals(sourceBytes[key]),'source double pin');B.baseline(base,BASE_SHA);
 for(const [key,n]of Object.entries(SOURCES))evidenceFiles['source-snapshot/'+n]=sourceBytes[key];
 const result={status:'await_parent_review',approved:false,sourceMappingApprovedByParent:false,productionExecuted:false,baselineDir:base,baselineReportSha256:BASE_SHA,sourceDir:source,sourceHashes,reports,backendSpecs,frozenReferenceSources,frozenHelpers,artifacts:Object.fromEntries(Object.entries(files).map(([n,b])=>[n,{path:path.join(out,n),sha256:sha(b),bytes:b.length}])),builderPin:{path:__filename,sha256:sha(fs.readFileSync(__filename))}};
 evidenceFiles['compile-provenance.json']=enc({status:'await_parent_review',sourceHashes,compilerRecords:compileRecords,fragments});evidenceFiles['exact-plan.await-parent-review.json']=enc({status:'await_parent_review',approved:false,sourceMappingApprovedByParent:false,sourceHashes,backends:plans});evidenceFiles['build-result.json']=enc(result);
 fs.mkdirSync(out,{mode:0o700});for(const [n,b]of Object.entries(files))fs.writeFileSync(path.join(out,n),b,{flag:'wx',mode:0o600});fs.mkdirSync(evidence,{mode:0o700});for(const [n,b]of Object.entries(evidenceFiles)){const f=path.join(evidence,n);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,b,{flag:'wx',mode:0o600});}
 for(const kind of ['front','admin'])B.backend(files['baseline-'+kind+'-index.js'],backendSpecs[kind],kind);return result;
}
if(require.main===module){const argv=process.argv.slice(2),a={};assert(argv.length===10);for(let i=0;i<argv.length;i+=2){const key={'--source':'source','--baseline':'baseline','--baseline-sha256':'baselineSha256','--out':'out','--evidence':'evidence'}[argv[i]];assert(key&&!a[key]);a[key]=argv[i+1];}build(a).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error('OFFLINE_NATIVE_PATCH_ABORT: '+e.stack);process.exitCode=1;});}
module.exports={build,SOURCES,ALLOWED,ADDED,lexicalRename};
