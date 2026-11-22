#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('/home/ubuntu/work/channel-release-20261121-1837/manager/node_modules/typescript');
const scope='header-ui-release-20261122-1928';
const root='/home/ubuntu/work/'+scope;
const capture=path.resolve(process.argv[2]||root+'/capture');
const out=path.resolve(process.argv[3]||root+'/customer-analysis/native-candidate');
if(capture!==root+'/capture'||!out.startsWith(root+'/customer-analysis/'))throw Error('Only fresh capture and independent customer-analysis output are allowed');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
const records=JSON.parse(fs.readFileSync(capture+'/records.json','utf8'));
const env=JSON.parse(fs.readFileSync(capture+'/environment.json','utf8'));
const active=[...new Set(Object.values(env.adminImports).filter(v=>typeof v==='string'&&/BusinessWorkbenchPage.*\.js$/.test(v)))].sort();
assert(active.length===2,'Expected exactly two active native BusinessWorkbench factories');
const sourceDir='/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/platform/client/src/pages/';
const sourcePins={
 [sourceDir+'CustomerDetail.tsx']:'99a8341d757865c96727c7d1cd37e1737419ffde3fe793b7c5177a742368278e',
 [sourceDir+'CustomerDetailReadability.css']:'73a368ebc9ae5389eaeea06a5050defcd785d26c5e76ab63b05a6584eda16c77'
};
for(const [p,h] of Object.entries(sourcePins))assert(hash(fs.readFileSync(p))===h,'Source pin drift: '+p);
const sourceText=fs.readFileSync(sourceDir+'CustomerDetail.tsx','utf8');
for(const n of ['inspectedCustomer','readAcknowledged','newInformationError','customer-detail-read-status'])assert(!sourceText.includes(n),'Source UI removal missing: '+n);
assert(sourceText.includes('ref={newInformationRow.ref}')&&sourceText.includes('acknowledgeOnVisible: true')&&sourceText.includes('retainUnreadWhileVisible: false'),'Source visible confirmation hook/ref missing');
fs.mkdirSync(out+'/assets',{recursive:true});fs.mkdirSync(out+'/evidence',{recursive:true});
function byteMap(text){const map=new Uint32Array(text.length+1);let b=0;for(let i=0;i<text.length;i++){map[i]=b;const c=text.charCodeAt(i);if(c>=0xd800&&c<=0xdbff&&i+1<text.length&&text.charCodeAt(i+1)>=0xdc00&&text.charCodeAt(i+1)<=0xdfff){map[i+1]=b+3;b+=4;i++;}else b+=c<128?1:c<2048?2:3;map[i+1]=b;}return map;}
function parse(text,label){const sf=ts.createSourceFile(label,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert(sf.parseDiagnostics.length===0,'Syntax diagnostics in '+label);return sf;}
function scan(sf,map){const funcs=[],literals=[],ids=[],decls=[];function visit(n){if(ts.isFunctionLike(n)&&n.body)funcs.push({node:n,kind:ts.SyntaxKind[n.kind],name:n.name?.getText(sf)||'<anonymous>',start:map[n.getStart(sf)],end:map[n.end]});if(ts.isStringLiteral(n)&&n.text==='customer-detail-read-status')literals.push(n);if(ts.isIdentifier(n))ids.push(n);if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name))decls.push(n);ts.forEachChild(n,visit);}visit(sf);return {funcs,literals,ids,decls};}
const assets=[],replacements={},evidence=[];
for(let factoryIndex=0;factoryIndex<active.length;factoryIndex++){
 const url=active[factoryIndex];const entries=Object.entries(records).filter(([,r])=>r.path?.endsWith('/dist/public'+url));assert(entries.length===1,'Native record must be unique: '+url);
 const [recordKey,record]=entries[0];const input=path.join(capture,path.basename(record.local||recordKey+'.js'));assert(input.startsWith(capture+'/'),'Capture path boundary');
 const raw=fs.readFileSync(input);assert(hash(raw)===record.sha256&&raw.length===record.size,'Fresh recorded input mismatch: '+url);
 const text=raw.toString('utf8'),map=byteMap(text),sf=parse(text,input),old=scan(sf,map);
 assert(old.literals.length===6,'Expected six render branches in one status subtree');
 const roots=new Set();for(const n of old.literals){let a=n;while(a.parent&&!(ts.isArrayLiteralExpression(a.parent)&&ts.isConditionalExpression(a)))a=a.parent;assert(a.parent,'Missing status conditional array');roots.add(a);}
 assert(roots.size===1,'Expected one unique status ConditionalExpression');const branch=[...roots][0];let fn=branch.parent;while(fn&&!ts.isFunctionDeclaration(fn))fn=fn.parent;
 assert(fn?.name?.text==='IM','Unexpected customer render function');
 let wrapper=fn.parent;while(wrapper&&!(ts.isFunctionDeclaration(wrapper)&&wrapper.name?.text==='__CW_CUSTOMER_GET'))wrapper=wrapper.parent;assert(wrapper,'Status node outside native customer factory');
 const array=branch.parent;assert(array.elements.indexOf(branch)===2&&array.elements.length===3&&array.elements[1].kind===ts.SyntaxKind.NullKeyword,'Unexpected target children structure');
 const fnText=fn.getText(sf);assert(fnText.includes('ref:__apDetailRow.ref')&&fnText.includes('customer-profile-tight'),'Customer main row ref missing');
 const names=['__apInspectedCustomer','__apReadAcknowledged','__apInformationError'];
 const bindings=names.map(name=>{const ds=old.decls.filter(n=>n.name.text===name&&n.getStart(sf)>=fn.getStart(sf)&&n.end<=fn.end);assert(ds.length===1,'UI binding is not unique: '+name);const d=ds[0];const refs=old.ids.filter(n=>n.text===name);assert(refs.every(n=>n===d.name||(n.getStart(sf)>=branch.getStart(sf)&&n.end<=branch.end)),'Unexpected reference outside UI target: '+name);return d;});
 assert(bindings.every(n=>n.parent===bindings[0].parent),'UI bindings not in one declaration list');const list=bindings[0].parent.declarations;const bi=list.indexOf(bindings[0]);assert(bindings.every((n,i)=>list[bi+i]===n)&&bi>0&&bi+3<list.length,'UI bindings not contiguous and bounded');
 const patches=[
 {purpose:'remove-three-ui-only-bindings',astKind:'VariableDeclaration',astNames:names,astUniqueCounts:[1,1,1],start:map[bindings[0].getStart(sf)],end:map[bindings[2].end]+1,replacement:Buffer.alloc(0)},
 {purpose:'remove-customer-name-status-render-branch',astKind:'ConditionalExpression',astUniqueCounts:[1],start:map[branch.getStart(sf)]-1,end:map[branch.end],replacement:Buffer.alloc(0)}
 ].sort((a,b)=>a.start-b.start);
 assert(raw[patches[0].end-1]===44&&raw[patches[1].start]===44,'Required comma byte mismatch');
 const info=n=>({kind:ts.SyntaxKind[n.kind],name:n.name?.getText(sf),utf16Start:n.getStart(sf),utf16End:n.end,byteStart:map[n.getStart(sf)],byteEnd:map[n.end],sha256:hash(raw.subarray(map[n.getStart(sf)],map[n.end]))});
 const protectedNames=['__apDetailBusiness','__apDetailReady','__apDetailRows','__apDetailRow'];const protectedNodes=protectedNames.map(name=>{const ds=old.decls.filter(n=>n.name.text===name&&n.getStart(sf)>=fn.getStart(sf)&&n.end<=fn.end);assert(ds.length===1,'Protected binding uniqueness: '+name);return ds[0];});
 assert(protectedNodes[2].getText(sf).includes('acknowledgeOnVisible: true')&&protectedNodes[2].getText(sf).includes('retainUnreadWhileVisible: false')&&protectedNodes[2].getText(sf).includes('expectedAccountKey:'),'Native visible acknowledgment hook changed');
 assert(protectedNodes[1].getText(sf).includes('contextVerification.state === "verified"')&&protectedNodes[1].getText(sf).includes('staffPrincipal.enterpriseId')&&protectedNodes[1].getText(sf).includes('frontUser.id'),'Ready authorization gate missing');
 let edited=raw;for(const p of [...patches].reverse())edited=Buffer.concat([edited.subarray(0,p.start),p.replacement,edited.subarray(p.end)]);
 const shift=pos=>pos-patches.reduce((sum,p)=>sum+(p.end<=pos?p.end-p.start:0),0);
 const newText=edited.toString('utf8'),newMap=byteMap(newText),newSf=parse(newText,'candidate-'+factoryIndex),after=scan(newSf,newMap);
 assert(after.literals.length===0,'Status render class remains');for(const name of names)assert(!after.ids.some(n=>n.text===name),'Deleted UI binding remains');
 const nodeAt=new Map(after.funcs.map(n=>[n.start+':'+n.end+':'+n.kind,n]));const unchangedFunctions=[],targetOrContainingFunctions=[];
 for(const f of old.funcs){const overlaps=patches.filter(p=>p.start<f.end&&p.end>f.start);if(overlaps.length){targetOrContainingFunctions.push({...f,node:undefined,reason:overlaps.some(p=>f.start<=p.start&&f.end>=p.end)?'target render function or lexical ancestor containing allowed deletion':'function inside deleted UI branch',sha256:hash(raw.subarray(f.start,f.end))});continue;}const ns=shift(f.start),ne=shift(f.end);const nf=nodeAt.get(ns+':'+ne+':'+f.kind);assert(nf,'Non-target AST function correspondence missing');const h=hash(raw.subarray(f.start,f.end));assert(hash(edited.subarray(ns,ne))===h,'Non-target function byte hash changed');unchangedFunctions.push({kind:f.kind,name:f.name,oldStart:f.start,oldEnd:f.end,newStart:ns,newEnd:ne,sha256:h});}
 const protectedEvidence=protectedNodes.map(n=>{const p=info(n);assert(hash(edited.subarray(shift(p.byteStart),shift(p.byteEnd)))===p.sha256,'Protected node changed');return {...p,retained:true};});
 const guardTokens=['T=se({mounted:!0,generation:0,identity:S,active:!1})','T.current.identity!==S','T.current.generation===be&&T.current.identity===st','A_({identityKey:S,getMode:','ref:__apDetailRow.ref'];
 const guardEvidence=guardTokens.map(token=>{const i=text.indexOf(token,map[fn.getStart(sf)]?fn.getStart(sf):0);assert(i>=fn.getStart(sf)&&i<fn.end&&text.indexOf(token,i+1)>=fn.end||i>=fn.getStart(sf)&&i<fn.end&&text.indexOf(token,i+1)===-1,'Protected guard anchor uniqueness');const start=map[i],end=map[i+token.length];assert(raw.subarray(start,end).equals(edited.subarray(shift(start),shift(end))),'Guard anchor changed');return {token,start,end,sha256:hash(raw.subarray(start,end)),retained:true};});
 let inverse=edited;for(const p of [...patches].reverse()){const s=shift(p.start);inverse=Buffer.concat([inverse.subarray(0,s),raw.subarray(p.start,p.end),inverse.subarray(s)]);}assert(inverse.equals(raw),'Complete inverse bytes mismatch');
 const patchEvidence=patches.map((p,i)=>{const b=raw.subarray(p.start,p.end),file=out+'/evidence/factory-'+factoryIndex+'-patch-'+i+'-inverse.bin';fs.writeFileSync(file,b);return {...p,replacement:'',oldByteLength:b.length,oldSha256:hash(b),inverseLocal:file,inverseBase64:b.toString('base64'),newStart:shift(p.start),newEnd:shift(p.start)};});
 const hashFile=out+'/evidence/factory-'+factoryIndex+'-function-hashes.json';fs.writeFileSync(hashFile,JSON.stringify({unchangedFunctions,targetOrContainingFunctions},null,2)+'\n');
 const sha256=hash(edited),name='BusinessWorkbenchPage-customer-status-removal-'+factoryIndex+'-'+sha256.slice(0,16)+'.js';const local=out+'/assets/'+name;fs.writeFileSync(local,edited);const newURL='/assets/'+name;
 assets.push({side:'admin',local,url:newURL,sha256,size:edited.length});replacements[url]=newURL;
 evidence.push({factoryIndex,recordKey,input,inputURL:url,inputSha256:record.sha256,inputSize:raw.length,renderFunction:info(fn),nativeFactory:info(wrapper),statusClassLiteralCountBefore:6,statusClassLiteralCountAfter:0,branch:info(branch),patches:patchEvidence,completeInverseByteEqual:true,inverseSha256:hash(inverse),nonTargetFunctionsHashEqual:true,nonTargetFunctionCount:unchangedFunctions.length,allOriginalFunctionCount:old.funcs.length,targetOrContainingFunctionCount:targetOrContainingFunctions.length,functionHashesLocal:hashFile,functionHashesSha256:hash(fs.readFileSync(hashFile)),protectedNodes:protectedEvidence,protectedGuards:guardEvidence,allOtherBytesUnchanged:true,syntaxParseDiagnostics:0,cssHandledByParent:true});
 console.log('READY factory '+factoryIndex+' '+sha256+'; '+unchangedFunctions.length+' non-target function hashes retained');
}
for(const [p,h] of Object.entries(sourcePins))assert(hash(fs.readFileSync(p))===h,'Source changed while building');
const manifest={scope,status:'CUSTOMER_NATIVE_READY_NOT_ASSEMBLED_NOT_PUBLISHED',capture,assets,replacements,sourcePins,allowedSource:Object.keys(sourcePins),checks:{freshCaptureOnly:true,astUniqueTarget:true,completeInverseBytes:true,nonTargetFunctionHashesUnchanged:true,visibleAcknowledgmentHookRetained:true,mainRowRefRetained:true,newInformationDetailReadyRetained:true,receiptGuardRetained:true,noCSSHiding:true,noFullBuild:true,noSourceEdits:true,noAPIOrDatabaseChanges:true},evidence};
fs.writeFileSync(out+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');console.log('MANIFEST '+out+'/manifest.json');
