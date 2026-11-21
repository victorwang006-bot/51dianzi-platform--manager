#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const W=path.dirname(new URL(import.meta.url).pathname);
const R='/home/ubuntu/work/channel-release-20261121-1837/manager';
const B='/home/ubuntu/work/customer-unread-hotfix-20261121-2353/candidate/assets';
const O=process.argv[2] ? path.resolve(process.argv[2]) : W+'/candidate';
const req=createRequire(R+'/package.json'),ts=req('typescript');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const read=p=>fs.readFileSync(p,'utf8');
const parse=(s,name='native.js')=>{const a=ts.createSourceFile(name,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(a.parseDiagnostics.length,0,'syntax '+name);return a;};
const nodes=(a,p)=>{const r=[];function walk(n){if(p(n))r.push(n);ts.forEachChild(n,walk);}walk(a);return r;};
const one=(xs,name)=>{assert.equal(xs.length,1,'unique '+name);return xs[0];};
const prop=(o,k)=>o.properties.find(n=>ts.isPropertyAssignment(n)&&n.name.text===k);
const cls=(n,k)=>ts.isObjectLiteralExpression(n)&&prop(n,'className')?.initializer.text===k;
function apply(before,patches){
 patches.sort((a,b)=>a.start-b.start);let end=-1,shift=0;
 for(const p of patches){assert(p.start>=end,'non-overlapping');end=p.end;assert.equal(before.slice(p.start,p.end),p.before);p.afterStart=p.start+shift;p.afterEnd=p.afterStart+p.after.length;shift+=p.after.length-p.before.length;}
 let after=before;for(const p of [...patches].reverse())after=after.slice(0,p.start)+p.after+after.slice(p.end);
 let inverse=after;for(const p of [...patches].reverse())inverse=inverse.slice(0,p.afterStart)+p.before+inverse.slice(p.afterEnd);
 assert.equal(inverse,before,'exact inverse of ALL original bytes');parse(after);return after;
}
const source=R+'/client/src/business/platform/client/src/pages/CustomerList.tsx',cssSource=R+'/client/src/business/platform/client/src/pages/CustomerList.css';
const sourcePins=Object.fromEntries([source,cssSource].map(f=>[f,hash(fs.readFileSync(f))]));
assert(read(source).includes('minWidth: "var(--customer-list-table-min-width, 1312px)"'));
assert(!read(source).includes('Math.max(30, ...displayedCustomerRows'));
assert(read(source).includes('customer-list-name-statuses'));
fs.mkdirSync(O+'/assets',{recursive:true});fs.mkdirSync(O+'/evidence',{recursive:true});
const assets=[],modules=[];
for(const [index,pin]of [[0,'792e2858756474bb402383109593bbc591386761656a1fb5ccf6c63d12a96c32'],[1,'6ffe72a5d81423eabfc6040604662ffc92788fa2ec83de4ad2f4f065e5c4278e']]){
 const input=B+'/BusinessWorkbenchPage-unread-hotfix-'+pin.slice(0,16)+'.js',before=read(input);assert.equal(hash(before),pin,'current exact released baseline');
 const a=parse(before),func=one(nodes(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text===(index?'vt':'Jw')&&n.getText(a).includes('__apUnreadOnly')),'actual list');
 if(index){let n=func.parent,ok=false;while(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='__CW_CUSTOMER_LIST_UPDATED_20261116_GET')ok=true;n=n.parent;}assert(ok,'reject stale vt');}
 const patches=[],patch=(n,after,reason)=>patches.push({start:n.getStart(a),end:n.end,before:n.getText(a),after,reason});
 const table=one(nodes(func,n=>cls(n,'admin-table-readable customer-list-table')),'table');
 const style=prop(table,'style').initializer;assert(ts.isObjectLiteralExpression(style));const min=prop(style,'minWidth').initializer;
 assert(min.getText(a).includes('Math.max(30')&&min.getText(a).includes('1108px'));
 patch(min,JSON.stringify('var(--customer-list-table-min-width, 1312px)'),'data-independent finite table width');
 const statuses=one(nodes(func,n=>cls(n,'mt-0.5 flex items-center gap-1.5')),'original status slot');
 const children=prop(statuses,'children').initializer;assert(ts.isArrayLiteralExpression(children));assert.equal(children.elements.length,2);
 const [incomplete,archived]=children.elements;assert(ts.isConditionalExpression(incomplete)&&ts.isConditionalExpression(archived));
 const call=statuses.parent;assert(ts.isCallExpression(call)&&call.arguments[1]===statuses);
 const statusText=call.getText(a),oldClass=prop(statuses,'className').initializer.getText(a);
 const newStatus=statusText.replace(oldClass,JSON.stringify('customer-list-name-statuses mt-0.5 flex items-center gap-1.5'));
 patch(call,'('+incomplete.condition.getText(a)+'||'+archived.condition.getText(a)+')?'+newStatus+':null','omit empty status wrapper; preserve all original status branches');
 assert(patches.every(p=>p.start>=func.getStart(a)&&p.end<=func.end),'only actual list table/status slots');
 const nameLine=one(nodes(func,n=>cls(n,'customer-list-name-line')),'name slot');assert(nameLine.getText(a).includes('AdminNewInformationRowBadge'),'native unread already inline');
 const result=one(nodes(func,n=>ts.isVariableDeclaration(n)&&n.name.getText(a)===(index?'C':'ue')),'result gate');assert(ts.isConditionalExpression(result.initializer),'prior ternary result repair kept');
 const actions=one(nodes(func,n=>cls(n,'customer-list-filter-actions')),'inline filter actions');assert(actions.getText(a).includes('customer-list-unread-filter'));
 const after=apply(before,patches),aa=parse(after);
 const ff=one(nodes(aa,n=>ts.isFunctionDeclaration(n)&&n.name?.text===func.name.text&&n.getText(aa).includes('__apUnreadOnly')),'changed actual list');
 for(const [label,oldNode]of [['name',nameLine],['result',result],['filterActions',actions]])assert(after.includes(oldNode.getText(a)),label+' exact original bytes preserved');
 const sha=hash(after),url='/assets/BusinessWorkbenchPage-customer-layout-'+sha.slice(0,16)+'.js',local=O+url;fs.writeFileSync(local,after);
 fs.writeFileSync(O+'/evidence/workbench-'+index+'.json',JSON.stringify({index,input,inputSHA:pin,output:local,outputSHA:sha,originalListSHA:hash(func.getText(a)),outputListSHA:hash(ff.getText(aa)),checks:{allBytesExactInverse:true,onlyActualListSlots:true,nameTitleStarUnreadBytesPreserved:true,inlineCheckboxBytesPreserved:true,ternaryResultGateBytesPreserved:true,allNonLayoutBytesPreserved:true,noNewImports:true},patches:patches.map(p=>({...p,before:undefined,after:undefined,beforeBase64:Buffer.from(p.before).toString('base64'),afterBase64:Buffer.from(p.after).toString('base64')}))},null,2)+'\n');
 modules.push({index,input,url:'/assets/'+path.basename(input),beforeSHA:pin,afterURL:url,afterSHA:sha,local,patchCount:patches.length});assets.push({side:'admin',url,local,sha256:sha,size:Buffer.byteLength(after)});
 console.log('WB'+index+' exact inverse PASS '+sha);
}
const cssInput=B+'/customer-unread-hotfix-0cd15c6df7928beb.css',cssBefore=read(cssInput);assert.equal(hash(cssBefore),'0cd15c6df7928bebd39997c7b2ab33d8acb964926a3197340099ae87101eb11b');
const baseline=read(W+'/baseline/CustomerList.css'),current=read(cssSource);assert(current.startsWith(baseline),'source CSS append only');
const suffix=current.slice(baseline.length);assert(suffix.includes('customer-layout-20261122 BEGIN'));
const foundationEnd=current.indexOf('/* Workbench release: geometry only, retain existing typography and eight columns. */');assert(foundationEnd>0,'audited local foundation boundary');
const foundation=current.slice(0,foundationEnd);assert(foundation.includes('.customer-list-table-inner[data-slot="table-container"]')&&foundation.includes('position: sticky')&&foundation.includes('.customer-list-col-actions'),'complete scroll/sticky/colgroup foundation');
assert(suffix.includes('--customer-list-demand-width: 128px')&&suffix.includes('--customer-list-actions-width: 88px'),'latest finite column variables win');
const css=cssBefore+'\n/* source-derived customer table foundation; no historic header/subgrid rules */\n'+foundation+'\n'+suffix;assert.equal(css.slice(0,cssBefore.length),cssBefore,'entire previous CSS preserved');
fs.writeFileSync(W+'/layout-foundation.css',foundation);
const cssSHA=hash(css),cssURL='/assets/customer-layout-'+cssSHA.slice(0,16)+'.css',cssLocal=O+cssURL;fs.writeFileSync(cssLocal,css);fs.writeFileSync(W+'/layout-suffix.css',suffix);
assets.push({side:'admin',url:cssURL,local:cssLocal,sha256:cssSHA,size:Buffer.byteLength(css)});
for(const[f,pin]of Object.entries(sourcePins))assert.equal(hash(fs.readFileSync(f)),pin,'source remains frozen during build');
const manifest={scope:'customer-layout-20261122',status:'BUILT_NOT_PUBLISHED',sourcePins,modules,assets,css:{input:cssInput,inputSHA:hash(cssBefore),output:cssLocal,outputSHA:cssSHA,cssURL,suffix:W+'/layout-suffix.css',foundation:W+'/layout-foundation.css',foundationSHA:hash(foundation),previousCSSExactPrefix:true,localScrollStickyFoundationIncluded:true,historicHeaderRulesExcluded:true},checks:{exactNativeInverse:true,noWholePageCompileReplacement:true,noHTMLAssembly:true,noNavigationOrRuntimeReferenceChanges:true,noNewDependencies:true},handoff:'Notification agent may serially apply its detail-only patch to modules[].local; parent owns integration, references and release.'};
fs.writeFileSync(W+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');console.log('MANIFEST '+W+'/manifest.json');
