'use strict';
// Pure, offline primitives. No old driver imports, production IO or mutable globals.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),ts=require('typescript');
const ROOT='/opt/ops/20261115-channel-reference-remediation-cSy4W28-v4';
const OLD='/opt/ops/20261115-channel-reference-remediation-cSy4W28-v3';
const WORK='/home/ubuntu/work/channel-reference-remediation-20261115/deploy-prep-v4-brand';
const P='client/src/business/platform/client/src/';
const SOURCE_FILES=new Set(['ChannelInventoryHost.tsx','ChannelInventoryHost.css','ChannelReferenceCell.tsx','channelReferenceModel.ts','ChannelInventoryHost.referenceRefresh.ts'].map(n=>P+'pages/'+n));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function relative(n){assert(typeof n==='string'&&/^[A-Za-z0-9._/-]{1,512}$/.test(n)&&!n.split('/').some(x=>['','.','..'].includes(x))&&!path.isAbsolute(n),'SAFE_RELATIVE_REQUIRED');return n;}
function regular(file){file=path.resolve(file);for(let p=file;;p=path.dirname(p)){assert(!fs.lstatSync(p).isSymbolicLink(),'SYMLINK_REFUSED '+p);if(path.dirname(p)===p)break;}assert(fs.lstatSync(file).isFile(),'REGULAR_FILE_REQUIRED');return fs.readFileSync(file);}
function inside(dir,n){const f=path.join(path.resolve(dir),relative(n));assert(f.startsWith(path.resolve(dir)+path.sep),'PATH_ESCAPE');return f;}
function pinned(file,h){assert(/^[0-9a-f]{64}$/.test(h),'FULL_SHA_REQUIRED');const b=regular(file);assert.equal(sha(b),h,'PIN_DRIFT '+file);return b;}
const json=f=>JSON.parse(regular(f));
function parse(text,n='native.js',kind=ts.ScriptKind.JS){const a=ts.createSourceFile(n,text,ts.ScriptTarget.Latest,true,kind);assert.equal(a.parseDiagnostics.length,0,'PARSE_DIAGNOSTICS '+n);return a;}
function nodes(a,p){const out=[];function v(n){if(p(n))out.push(n);n.forEachChild(v);}v(a);return out;}
function one(a,p,label){const out=Array.isArray(a)?a.filter(p):nodes(a,p);assert.equal(out.length,1,'ONE '+label);return out[0];}
function offset(text,n){return Buffer.byteLength(text.slice(0,n));}
function editNode(text,a,n,after,reason){return {start:offset(text,n.getStart(a)),end:offset(text,n.end),before:Buffer.from(n.getText(a)),after:Buffer.from(after),reason};}
function delta(before,patches){
 before=Buffer.from(before);patches=patches.map(p=>({...p,before:Buffer.from(p.before),after:Buffer.from(p.after)})).sort((a,b)=>a.start-b.start||a.end-b.end);
 let cursor=0,at=0;const parts=[],inverse=[],unchanged=[];
 for(const p of patches){assert(Number.isSafeInteger(p.start)&&Number.isSafeInteger(p.end)&&p.start>=cursor&&p.end>=p.start&&p.end<=before.length,'OVERLAPPING_OR_INVALID_SLICE');assert(before.subarray(p.start,p.end).equals(p.before),'ACTUAL_BEFORE_SLICE_MISMATCH');const gap=before.subarray(cursor,p.start);parts.push(gap);unchanged.push({beforeStart:cursor,beforeEnd:p.start,afterStart:at,afterEnd:at+gap.length,sha256:sha(gap)});at+=gap.length;inverse.push({...p,afterStart:at,afterEnd:at+p.after.length});parts.push(p.after);at+=p.after.length;cursor=p.end;}
 const tail=before.subarray(cursor);parts.push(tail);unchanged.push({beforeStart:cursor,beforeEnd:before.length,afterStart:at,afterEnd:at+tail.length,sha256:sha(tail)});const after=Buffer.concat(parts);
 let restored=after;for(const p of [...inverse].reverse())restored=Buffer.concat([restored.subarray(0,p.afterStart),p.before,restored.subarray(p.afterEnd)]);assert(restored.equals(before),'EXACT_INVERSE_FAILED');
 for(const p of unchanged)assert(before.subarray(p.beforeStart,p.beforeEnd).equals(after.subarray(p.afterStart,p.afterEnd)),'UNMODIFIED_BYTES_CHANGED');
 return {after,proof:{encoding:'UTF-8 byte offsets (not JS character offsets)',beforeSha256:sha(before),afterSha256:sha(after),exactInverse:true,allUnmodifiedBytesPreserved:true,patches:inverse.map(p=>({start:p.start,end:p.end,afterStart:p.afterStart,afterEnd:p.afterEnd,beforeBase64:p.before.toString('base64'),afterBase64:p.after.toString('base64'),beforeSha256:sha(p.before),afterSha256:sha(p.after),reason:p.reason})),unchangedPartitions:unchanged}};
}
function verifyDelta(before,after,p){assert.equal(sha(before),p.beforeSha256);assert.equal(sha(after),p.afterSha256);const result=delta(before,p.patches.map(x=>({start:x.start,end:x.end,before:Buffer.from(x.beforeBase64,'base64'),after:Buffer.from(x.afterBase64,'base64'),reason:x.reason})));assert(result.after.equals(after));for(const [k,v] of Object.entries(result.proof))assert.deepEqual(v,p[k],'INVERSE_CORE_FIELD_CHANGED '+k);}
function nativeImport(before){
 const text=before.toString('utf8'),a=parse(text),imports=a.statements.filter(ts.isImportDeclaration);
 const n=one(imports,x=>x.moduleSpecifier.text===OLD+'/channel-reference-service.mjs','existing fixed helper import');
 const named=n.importClause?.namedBindings;assert(named&&ts.isNamedImports(named)&&named.elements.length===1&&named.elements[0].name.text==='__channelReferenceLookup'&&named.elements[0].propertyName?.text==='lookupChannelReferences','FIXED_IMPORT_BINDING');
 assert.equal(imports[0],n,'JUST_DEPLOYED_FIRST_IMPORT_POSITION');
 const d=delta(before,[editNode(text,a,n.moduleSpecifier,JSON.stringify(ROOT+'/channel-reference-service.mjs'),'ONLY current fixed helper module string')]);
 const z=parse(d.after.toString('utf8')),newImports=z.statements.filter(ts.isImportDeclaration);
 assert.equal(newImports.length,imports.length);assert.equal(newImports[0].moduleSpecifier.text,ROOT+'/channel-reference-service.mjs');
 assert.deepEqual(newImports.slice(1).map(x=>x.getText(z)),imports.slice(1).map(x=>x.getText(a)),'ALL_OTHER_IMPORTS_BYTE_FROZEN');
 // Whole remainder exact, including 1092 originals, current additions and all guards.
 const declarations=nodes(a,x=>(ts.isFunctionDeclaration(x)||ts.isClassDeclaration(x)||ts.isVariableDeclaration(x))&&x.name).filter(x=>x.getStart(a)>=n.end);
 const afterSet=new Set(nodes(z,x=>(ts.isFunctionDeclaration(x)||ts.isClassDeclaration(x)||ts.isVariableDeclaration(x))&&x.name).map(x=>x.getText(z)));
 for(const x of declarations)assert(afterSet.has(x.getText(a)),'DECLARATION_CHANGED '+x.name.getText(a));
 d.proof.scope='one existing module literal only; no API/guard compilation';d.proof.protectedDeclarationCountObserved=declarations.length;
 return d;
}
function sourceScope(oldDir,newDir,prior,pins,allow){return require('./source-contract.cjs').validate(oldDir,newDir,prior,pins,allow);}

module.exports={fs,path,crypto,assert,ts,ROOT,OLD,WORK,P,SOURCE_FILES,sha,relative,regular,inside,pinned,json,parse,nodes,one,offset,editNode,delta,verifyDelta,nativeImport,sourceScope};
