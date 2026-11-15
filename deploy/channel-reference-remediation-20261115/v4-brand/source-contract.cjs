'use strict';
// Exact generated descriptors require parent pin approval; no wildcard owner grants.
const C=require('./scoped-core.cjs');
const {ts,assert,sha,parse,pinned,inside,regular,P}=C;
const FRONT=new Set(['ChannelInventoryHost.tsx','ChannelInventoryHost.css','ChannelReferenceCell.tsx','channelReferenceModel.ts','channelReferenceModel.test.ts','ChannelInventoryHost.reference.render.test.ts','ChannelInventoryHost.remediation.test.ts','ChannelInventoryHost.referenceRefresh.ts','ChannelInventoryHost.referenceRefresh.test.ts','ChannelInventoryHost.remediation.render.test.ts'].map(n=>P+'pages/'+n));
const SHARED=new Set(['shared/channelReference.ts','shared/channelReferenceBrand.ts','shared/channelReferenceBrand.test.ts','shared/channelReferenceRefresh.ts']);
const BACKEND=new Set(['service','worker','browserPage','snapshot','requestPacing','publicPage','lcscPage','lcscSearchPage','ickeyPage','quoteValidation','nativeWorker','referenceStore','manualRefresh','manualRefreshConfig','service.test','worker.test','browserPage.test','snapshot.test','publicPage.test','lcscPage.test','lcscSearchPage.test','ickeyPage.test','brandAliases.test','manualRefresh.test','realBrandRegression.test','defaultLookup.test','manualRefreshConfig.test'].map(n=>'server/channelReference/'+n+'.ts'));
const BRAND='shared/channelReferenceBrand.ts',SNAPSHOT_CORE='server/channelReference/snapshot.ts';
const SNAPSHOT_BEFORE='ae4057336e956e2bd11c557060833df77685b47e70c98376a8377332c05a272f',SNAPSHOT_AFTER='63df6be84eac7267b621addd083cfe04c433d579979e70bae3c38aae5963f169';
const BRAND_TESTS=Object.freeze(['brandAliases','defaultLookup','manualRefresh','manualRefreshConfig','realBrandRegression','snapshot','worker'].map(n=>'server/channelReference/'+n+'.test.ts'));
const BRAND_ALLOWED=new Set([BRAND,SNAPSHOT_CORE,...BRAND_TESTS]),BRAND_RUNTIME=new Set([BRAND,SNAPSHOT_CORE]);
function approvedBrandDeltas(prior,next,approved){
 assert.equal(Object.keys(prior).length,147);assert.deepEqual(Object.keys(next).sort(),Object.keys(prior).sort(),'EXACT_UNCHANGED_147_PATH_SET');
 assert.equal(prior[SNAPSHOT_CORE],SNAPSHOT_BEFORE,'SNAPSHOT_CORE_ORIGINAL_BEFORE_PIN');
 assert(Array.isArray(approved)&&approved.length>=1&&approved.length<=9,'FINITE_ONE_TO_NINE_SOURCE_DELTAS');assert.equal(new Set(approved.map(r=>r.relative)).size,approved.length);
 const actual=[];for(const n of Object.keys(prior).sort()){for(const h of [prior[n],next[n]])assert(typeof h==='string'&&/^[0-9a-f]{64}$/.test(h),'FULL_SOURCE_SHA_REQUIRED');if(prior[n]!==next[n])actual.push({relative:n,beforeSha256:prior[n],afterSha256:next[n]});}
 for(const r of approved){assert.deepEqual(Object.keys(r).sort(),['relative','beforeSha256','afterSha256'].sort());assert(BRAND_ALLOWED.has(r.relative),'BRAND_OPTIONAL_SNAPSHOT_CORE_OR_EXACT_SEVEN_TESTS_ONLY '+r.relative);assert.equal(r.beforeSha256,prior[r.relative]);assert.equal(r.afterSha256,next[r.relative]);assert.notEqual(r.beforeSha256,r.afterSha256);if(r.relative===SNAPSHOT_CORE)assert.equal(r.afterSha256,SNAPSHOT_AFTER,'PARENT_REVIEWED_SNAPSHOT_CORE_EXACT_AFTER_PIN');}
 assert(approved.some(r=>r.relative===BRAND),'ACTUAL_BRAND_SOURCE_DELTA_REQUIRED');assert.deepEqual(actual,approved.slice().sort((a,b)=>a.relative<b.relative?-1:a.relative>b.relative?1:0),'EXACT_PARENT_APPROVED_SOURCE_DELTA_HASHES');return actual;
}
function eligible(n){return FRONT.has(n)||SHARED.has(n)||BACKEND.has(n)||n==='server/channelReference/fixtures/lcsc-ste145n65m5-public-row.html'||n==='server/channelReference/fixtures/syntheticReferenceFixture.ts';}
function owners(bytes,n){
 if(!bytes.length)return {owners:[],tailSha256:sha(Buffer.alloc(0))};
 const text=bytes.toString('utf8'),a=parse(text,n,n.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS),counts=new Map();
 const rows=a.statements.map(s=>{let key;
  if(ts.isImportDeclaration(s))key='import:'+s.moduleSpecifier.text;
  else if(ts.isExportDeclaration(s))key='export:'+(s.moduleSpecifier?.text||s.exportClause?.getText(a)||'default');
  else if(ts.isVariableStatement(s))key='variable:'+s.declarationList.declarations.map(d=>d.name.getText(a)).join(',');
  else if(s.name)key=ts.SyntaxKind[s.kind]+':'+s.name.getText(a);
  else if(ts.isExpressionStatement(s)&&ts.isCallExpression(s.expression))key='call:'+s.expression.expression.getText(a)+':'+(s.expression.arguments[0]?.getText(a)||'');
  else key=ts.SyntaxKind[s.kind];
  const occurrence=counts.get(key)||0;counts.set(key,occurrence+1);key+=':'+occurrence;
  return {owner:key,kind:ts.SyntaxKind[s.kind],start:C.offset(text,s.getFullStart()),end:C.offset(text,s.end),sha256:sha(s.getFullText(a)),exported:!!s.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)};
 });
 return {owners:rows,tailSha256:sha(bytes.subarray(rows.at(-1)?.end||0))};
}
function describe(n,before,after){
 assert(eligible(n),'SOURCE_OUTSIDE_EXPLICIT_REMEDIATION_TUPLE '+n);
 const descriptor={relative:n,beforeSha256:before.length?sha(before):null,afterSha256:sha(after)};
 if(n.endsWith('.css')){require('./frontend-scoped.cjs').cssOverlay(before,after);return {...descriptor,kind:'scoped-css',effectiveOverlaySha256:sha(require('./frontend-scoped.cjs').cssOverlay(before,after))};}
 if(n.endsWith('.html'))return {...descriptor,kind:'verbatim-public-fixture'};
 const b=owners(before,n),a=owners(after,n),bm=new Map(b.owners.map(x=>[x.owner,x])),am=new Map(a.owners.map(x=>[x.owner,x]));
 const changed=[...new Set([...bm.keys(),...am.keys()])].filter(k=>bm.get(k)?.sha256!==am.get(k)?.sha256).map(k=>({owner:k,before:bm.get(k)||null,after:am.get(k)||null}));
 const unchanged=b.owners.filter(x=>am.get(x.owner)?.sha256===x.sha256).map(x=>({owner:x.owner,sha256:x.sha256,beforeStart:x.start,beforeEnd:x.end,afterStart:am.get(x.owner).start,afterEnd:am.get(x.owner).end}));
 // Every actual top-level owner, including changed import/export and trailing trivia, is explicit.
 return {...descriptor,kind:'exact-top-level-ast-owners',changedOwners:changed,unchangedOwners:unchanged,beforeTailSha256:b.tailSha256,afterTailSha256:a.tailSha256};
}
function detect(oldDir,newDir,prior,pins){
 assert(Object.keys(prior).every(n=>Object.hasOwn(pins,n)),'FROZEN_SOURCE_REMOVAL');
 const changes=[];for(const [n,h] of Object.entries(pins)){const before=Object.hasOwn(prior,n)?pinned(inside(oldDir,n),prior[n]):Buffer.alloc(0),after=pinned(inside(newDir,n),h);if(!before.equals(after))changes.push(describe(n,before,after));}
 return changes.sort((a,b)=>a.relative.localeCompare(b.relative));
}
function validate(oldDir,newDir,prior,pins,allow){
 assert(Array.isArray(allow)&&new Set(allow.map(x=>x.relative)).size===allow.length,'EXACT_UNIQUE_SOURCE_DESCRIPTORS_REQUIRED');
 const actual=detect(oldDir,newDir,prior,pins);assert.deepEqual(actual,allow,'PRECISE_PARENT_APPROVED_AST_OWNER_HASH_CONTRACT_REQUIRED');
 return actual;
}
module.exports={FRONT,SHARED,BACKEND,BRAND,SNAPSHOT_CORE,SNAPSHOT_BEFORE,SNAPSHOT_AFTER,BRAND_TESTS,BRAND_ALLOWED,BRAND_RUNTIME,approvedBrandDeltas,eligible,owners,describe,detect,validate};
