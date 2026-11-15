'use strict';
// Exact generated descriptors require parent pin approval; no wildcard owner grants.
const C=require('./scoped-core.cjs');
const {ts,assert,sha,parse,pinned,inside,P}=C;
const FRONT=new Set(['ChannelInventoryHost.tsx','ChannelInventoryHost.css','ChannelReferenceCell.tsx','channelInventoryColumns.ts','channelInventoryColumns.test.ts','channelReferenceModel.ts','channelReferenceModel.test.ts','ChannelInventoryHost.referenceRefresh.ts','ChannelInventoryHost.referenceRefresh.test.ts','ChannelInventoryHost.reference.render.test.ts','ChannelInventoryHost.remediation.render.test.ts','ChannelInventoryHost.compact.test.ts','ChannelReferenceCell.compact.test.ts','ChannelInventoryHost.compact.render.test.ts','ChannelInventoryHost.columns.render.test.ts','ChannelInventoryHost.management.render.test.ts','ChannelInventoryHost.render.test.ts','ChannelInventoryHost.flat-edit.render.test.ts'].map(n=>P+'pages/'+n).concat(C.NEW_HOST_FILES));
const PREFIX='client/src/business/platform/';
const BACKEND=new Set(['front-router-types/server/services/channelInventoryCollaboration.ts','front-router-types/server/services/channelTeamInventory.ts','front-router-types/server/services/channelInventoryManualReference.ts','shared/channelInventoryCollaboration.ts','front-router-types/drizzle/channelInventoryManualReferenceTables.ts','front-router-types/drizzle/migrations/20261115_channel_inventory_manual_references.sql'].map(n=>PREFIX+n).concat(['server/channelReference.router.test.ts','server/customerChannelInventory.contract.test.ts','server/inventorySourceProjection.test.ts']));
const SQL=PREFIX+'front-router-types/drizzle/migrations/20261115_channel_inventory_manual_references.sql';
const LOCAL_IMPORT_ADDITIONS={
 [P+'pages/ChannelInventoryHost.tsx']:['import { ChannelInventoryManualReferenceFields } from "./ChannelInventoryManualReferenceFields";','import { manualReferenceDraftFrom, manualReferenceValidation, manualReferencePatch, manualReferenceRetentionKey } from "./manualReferenceEdit";'],
 [P+'pages/ChannelReferenceCell.tsx']:['import { manualReferencePriceValid } from "./manualReferenceEdit";'],
 [PREFIX+'front-router-types/server/services/channelInventoryCollaboration.ts']:['import { channelInventoryManualReferenceValuesFrom, readChannelInventoryManualReferences, upsertChannelInventoryManualReferences } from "./channelInventoryManualReference";'],
 [PREFIX+'front-router-types/server/services/channelTeamInventory.ts']:['import { channelInventoryManualReferenceValuesFrom, readChannelInventoryManualReferences } from "./channelInventoryManualReference";']
};
function eligible(n){return FRONT.has(n)||BACKEND.has(n);}
function localImportContract(n,before,after){
 if(!before.length||!LOCAL_IMPORT_ADDITIONS[n])return;
 const kind=n.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS;
 const b=parse(before.toString('utf8'),n,kind),a=parse(after.toString('utf8'),n,kind);
 const imports=z=>z.statements.filter(ts.isImportDeclaration).map(s=>s.getText(z));
 const old=imports(b),next=imports(a),allow=LOCAL_IMPORT_ADDITIONS[n];
 assert.deepEqual(next.filter(s=>!allow.includes(s)),old,'EXISTING_SOURCE_IMPORTS_AND_ORDER_FROZEN '+n);
 const added=next.filter(s=>allow.includes(s));assert.deepEqual(added,allow,'EXACT_NAMED_LOCAL_IMPORT_ADDITIONS '+n);
 for(const s of a.statements.filter(ts.isImportDeclaration)){if(!allow.includes(s.getText(a)))continue;assert(s.moduleSpecifier.text.startsWith('./')&&s.importClause&&!s.importClause.name&&ts.isNamedImports(s.importClause.namedBindings),'ONLY_REVIEWED_NAMED_LOCAL_IMPORTS '+n);}
}
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
function describe(n,before,after,cssApproval=null){
 assert(eligible(n),'SOURCE_OUTSIDE_EXPLICIT_MANUAL_REFERENCE_TUPLE '+n);
 const descriptor={relative:n,beforeSha256:before.length?sha(before):null,afterSha256:sha(after)};
 if(n.endsWith('.css')){const overlay=require('./frontend-scoped.cjs').cssOverlay(before,after,cssApproval);return {...descriptor,kind:'scoped-css',effectiveOverlaySha256:sha(overlay)};}
 if(n===SQL){assert.equal(before.length,0,'ONLY_NEW_EXACT_SCHEMA_SOURCE_PIN_NO_EXECUTION');return {...descriptor,kind:'verbatim-additive-schema-source',byteLength:after.length,databaseExecution:false};}
 assert(/\.[cm]?[jt]sx?$/.test(n),'ONLY_EXPLICIT_TS_JS_SOURCE_DELTA');localImportContract(n,before,after);
 const b=owners(before,n),a=owners(after,n),bm=new Map(b.owners.map(x=>[x.owner,x])),am=new Map(a.owners.map(x=>[x.owner,x]));
 const changed=[...new Set([...bm.keys(),...am.keys()])].filter(k=>bm.get(k)?.sha256!==am.get(k)?.sha256).map(k=>({owner:k,before:bm.get(k)||null,after:am.get(k)||null}));
 const unchanged=b.owners.filter(x=>am.get(x.owner)?.sha256===x.sha256).map(x=>({owner:x.owner,sha256:x.sha256,beforeStart:x.start,beforeEnd:x.end,afterStart:am.get(x.owner).start,afterEnd:am.get(x.owner).end}));
 return {...descriptor,kind:'exact-top-level-ast-owners',changedOwners:changed,unchangedOwners:unchanged,beforeTailSha256:b.tailSha256,afterTailSha256:a.tailSha256};
}
function detect(oldDir,newDir,prior,pins,cssApproval=null){
 assert(Object.keys(prior).every(n=>Object.hasOwn(pins,n)),'FROZEN_SOURCE_REMOVAL');
 const changes=[];for(const [n,h] of Object.entries(pins)){const before=Object.hasOwn(prior,n)?pinned(inside(oldDir,n),prior[n]):Buffer.alloc(0),after=pinned(inside(newDir,n),h);if(!before.equals(after))changes.push(describe(n,before,after,cssApproval));}
 return changes.sort((a,b)=>a.relative.localeCompare(b.relative));
}
function validate(oldDir,newDir,prior,pins,allow,cssApproval=null){
 assert(Array.isArray(allow)&&new Set(allow.map(x=>x.relative)).size===allow.length,'EXACT_UNIQUE_SOURCE_DESCRIPTORS_REQUIRED');
 const actual=detect(oldDir,newDir,prior,pins,cssApproval);assert.deepEqual(actual,allow,'PRECISE_PARENT_APPROVED_AST_OWNER_HASH_CONTRACT_REQUIRED');
 return actual;
}
module.exports={FRONT,BACKEND,SQL,LOCAL_IMPORT_ADDITIONS,eligible,localImportContract,owners,describe,detect,validate};
