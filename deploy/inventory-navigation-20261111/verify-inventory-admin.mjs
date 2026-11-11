#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {ROOT,REPO,BEFORE,BASE,TOOLS,OUT,sha,read,parse,edges,requests,factory,factoryParts,resolve,assert,json,write,postcss} from './inventory-builder-core.mjs';
const manifestFile=OUT+'/manifest.json';
function restore(candidate,patches){const ps=[...patches].sort((a,b)=>a.start-b.start||a.end-b.end);let old='',cursor=0,delta=0;for(const p of ps){const at=p.start+delta;assert(candidate.slice(at,at+p.after.length)===p.after,'INVERSE_AFTER_PIN:'+p.label);old+=candidate.slice(cursor,at)+p.before;cursor=at+p.after.length;delta+=p.after.length-p.before.length}return old+candidate.slice(cursor)}
function verify(){
 assert(fs.existsSync(manifestFile),'NO_CANDIDATE_MANIFEST');const m=JSON.parse(read(manifestFile));
 assert(m.schemaVersion===2&&m.candidateWritten===true&&m.sourceFinalized===true&&m.customerComplete===true,'FULL_FORMAL_CANDIDATE_REQUIRED');
 assert(m.deployed===false&&m.guards.noFrontIndexChanged===true,'OFFLINE_ADMIN_ONLY');
 assert(sha(read(ROOT+'/inventory-baseline/current.json'))===m.baselineManifestSha256,'CURRENT_MANIFEST_PIN');
 assert(sha(read(m.actualDiffFile))===m.actualDiffSha256,'ACTUAL_COMMITTED_SOURCE_DIFF_PIN');
 assert(sha(read(TOOLS+'/build-inventory-candidate.mjs'))===m.builderSha256,'EXACT_BUILDER_PIN');
 assert(sha(read(TOOLS+'/inventory-builder-core.mjs'))===m.coreSha256,'EXACT_CORE_PIN');
 const findings=[];
 for(const s of m.sourcePins){
  assert(s.file.startsWith(REPO+'/')&&s.beforeFile.startsWith(BEFORE+'/'),'SOURCE_PATH_SCOPE');
  assert(s.beforeSha256&&s.sha256,'NONNULL_SOURCE_PINS');assert(sha(read(s.file))===s.sha256,'AFTER_SOURCE_PIN');assert(sha(read(s.beforeFile))===s.beforeSha256,'REAL_BEFORE_SOURCE_PIN');
  if(s.beforeKind.startsWith('EXTRACTED_'))assert(s.newSourceAbsenceProven===true&&!fs.existsSync(BEFORE+'/'+s.relative),'EXPLICIT_NEW_SOURCE_ABSENCE');
 }
 for(const r of m.files){
  assert(r.file.endsWith('.js')&&path.basename(r.file)===r.file,'SAFE_JS_NAME');const text=read(OUT+'/assets/'+r.file);assert(sha(text)===r.sha256,'CANDIDATE_SHA:'+r.file);
  const before=read(BASE+'/'+path.basename(r.beforeFile));assert(sha(before)===r.beforeSha256,'BEFORE_CHUNK_SHA');const inverse=restore(text,r.patches);assert(inverse===before&&sha(inverse)===r.beforeSha256,'FULL_INVERSE_BYTE_RESTORE');
  const a=parse(before),b=parse(text);assert(json(edges(a))===json(edges(b)),'IMPORT_EXPORT_BYTE_TABLE');
  for(const p of r.patches){assert(p.beforeSourceSha256&&p.afterSourceSha256&&p.sourceNodeSha256,'PATCH_SOURCE_PIN_REQUIRED');assert(sha(read(p.sourceFile))===p.afterSourceSha256,'PATCH_SOURCE_AFTER_CHANGED');assert(before.slice(p.start,p.end)===p.before,'BEFORE_RANGE_PIN');assert(!/\b(?:createTRPCReact|createTRPCClient|QueryClient|BusinessScopeProvider|createContext|createRoot|hydrateRoot)\s*\(/.test(p.after),'NO_NEW_CONTEXT_CLIENT_PROVIDER')}
  for(const p of r.scaffoldChecks){const x=factoryParts(a,factory(a,p.factory)),y=factoryParts(b,factory(b,p.factory));assert(x.signature===y.signature&&x.returnBridge===y.returnBridge&&x.bridge===y.bridge,'CONTEXT_BRIDGE_SCAFFOLD')}
  findings.push({file:r.file,inverseSHA256:sha(inverse),patches:r.patches.length,importExportByteIdentical:true,factoryFrameworkByteIdentical:true});
 }
 for(const r of m.css){
  assert(path.basename(r.file)===r.file&&r.mode==='scoped-added-rule-only-old-css-preserved','SCOPED_CSS_ONLY');const text=read(OUT+'/assets/'+r.file);assert(sha(text)===r.sha256&&sha(read(r.sourceFile))===r.sourceSha256,'CSS_PIN');
  const rules=[];postcss.parse(text).walkRules(rule=>rules.push(rule));assert(rules.length===1&&rules[0].selector==='.admin-workspace-shell__main .ci-page.ci-host .ci-sr-only','ACCESSIBLE_TITLE_STYLE_ONLY');rules[0].walkDecls(d=>assert(!d.important&&!['display','visibility','font','font-size'].includes(d.prop),'NO_BUSINESS_HIDE_OR_FONT_CHANGE'));
  findings.push({file:r.file,scopedAccessibleTitleOnly:true,oldStylesheetsPreserved:true});
 }
 const original=read(BASE+'/index.html'),candidate=read(OUT+'/index.html'),h=m.htmlReverseProof;assert(sha(original)===m.index.beforeSha256&&sha(candidate)===m.index.sha256,'INDEX_SHA');
 assert(candidate.replace(h.fragment+h.newModule,h.originalModule).replace(h.newTag,h.originalTag)===original,'INDEX_RESTORE_UNRELATED_BYTES');
 assert(h.newModule===h.originalModule&&sha(read(m.unchangedEntry.file))===m.unchangedEntry.sha256,'UNCHANGED_ENTRY_BYTES');
 const beforeMap=m.importmapBefore,afterMap=m.importmapAfter,renames=new Map(m.files.map(r=>[r.beforeURL,r.url]));
 for(const[k,v]of Object.entries(beforeMap.imports))assert(afterMap.imports[k]===(renames.get(v)??v),'GLOBAL_MAPPING_PRESERVE');
 for(const[scope,table]of Object.entries(beforeMap.scopes??{}))for(const[k,v]of Object.entries(table))assert(afterMap.scopes[scope]?.[k]===(renames.get(v)??v),'OLD_SCOPE_MAPPING_PRESERVE');
 for(const r of m.files){
  if(beforeMap.scopes?.[r.beforeURL])for(const[k,v]of Object.entries(beforeMap.scopes[r.beforeURL]))assert(afterMap.scopes[r.url]?.[k]===(renames.get(v)??v),'EXACT_NEW_SCOPE_INHERIT');
  for(const s of requests(parse(read(OUT+'/assets/'+r.file)))){const old=resolve(beforeMap,s,r.beforeURL),fresh=resolve(afterMap,s,r.url);assert(fresh===(renames.get(old)??old),'DEPENDENCY_GRAPH_RESOLUTION');assert(!renames.has(fresh),'NO_TARGET_MAPPING_CHAIN')}
 }
 for(const s of requests(parse(read(m.unchangedEntry.file)))){const old=resolve(beforeMap,s,m.unchangedEntry.url),fresh=resolve(afterMap,s,m.unchangedEntry.url);assert(fresh===(renames.get(old)??old),'ENTRY_DEPENDENCY_RESOLUTION')}
 const report={schemaVersion:2,success:true,offlineOnly:true,candidateWritten:true,deployed:false,manifestSha256:sha(read(manifestFile)),candidateIndexSha256:sha(candidate),sourcePinCount:m.sourcePins.length,findings,graphEdges:m.graphChecks.length,indexInverseByteIdentical:true,unrelatedImportmapMappingsPreserved:true,sourceBeforeAfterPinsVerified:true,browserUsed:false,databaseUsed:false,caveat:'Static inverse/source/graph verification only; actual factory render and action proofs are separate.'};
 write(TOOLS+'/inventory-verification.json',json(report));write(OUT+'/verification.json',json(report));console.log(json(report));
}
try{verify()}catch(e){console.error(e.stack);process.exitCode=1}
