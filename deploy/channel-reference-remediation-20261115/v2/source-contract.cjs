'use strict';
// Exact generated descriptors require parent pin approval; no wildcard owner grants.
const C=require('./scoped-core.cjs');
const {ts,assert,sha,parse,pinned,inside,regular,P}=C;
const FRONT=new Set(['ChannelInventoryHost.tsx','ChannelInventoryHost.css','ChannelReferenceCell.tsx','channelReferenceModel.ts','channelReferenceModel.test.ts','ChannelInventoryHost.reference.render.test.ts','ChannelInventoryHost.remediation.test.ts','ChannelInventoryHost.referenceRefresh.ts','ChannelInventoryHost.referenceRefresh.test.ts','ChannelInventoryHost.remediation.render.test.ts'].map(n=>P+'pages/'+n));
const SHARED=new Set(['shared/channelReference.ts','shared/channelReferenceBrand.ts','shared/channelReferenceBrand.test.ts','shared/channelReferenceRefresh.ts']);
const BACKEND=new Set(['service','worker','browserPage','snapshot','requestPacing','publicPage','lcscPage','lcscSearchPage','ickeyPage','quoteValidation','nativeWorker','referenceStore','manualRefresh','manualRefreshConfig','service.test','worker.test','browserPage.test','snapshot.test','publicPage.test','lcscPage.test','lcscSearchPage.test','ickeyPage.test','brandAliases.test','manualRefresh.test','realBrandRegression.test','defaultLookup.test','manualRefreshConfig.test'].map(n=>'server/channelReference/'+n+'.ts'));
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
module.exports={FRONT,SHARED,BACKEND,eligible,owners,describe,detect,validate};
