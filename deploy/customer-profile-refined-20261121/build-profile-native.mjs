#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
import postcss from 'postcss';
import { H, parse, nodes, one, inverseDelta, htmlDelta } from '../upload-manage-20261119/build-support.mjs';
const R='/home/ubuntu/51-manager', W='/home/ubuntu/work/customer-profile-refined-20261121-1250', BASE=W+'/offline-before', OUT=W+'/ui-build';
assert(!fs.existsSync(OUT),'fresh output only');
function put(n,b){const p=path.join(OUT,n);fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,b);}
function json(n,b){put(n,JSON.stringify(b,null,2)+'\n');}
function prop(obj,name){return one(obj.properties.filter(p=>ts.isPropertyAssignment(p)&&p.name.getText().replace(/["']/g,'')===name),'property '+name);}
function object(call){return one(call.arguments.filter(ts.isObjectLiteralExpression),'JSX properties');}
function tag(call,name){return ts.isCallExpression(call)&&call.arguments[0]&&ts.isStringLiteral(call.arguments[0])&&call.arguments[0].text===name;}
function cls(call,name){if(!ts.isCallExpression(call)||call.arguments.length!==2||!ts.isObjectLiteralExpression(call.arguments[1]))return false;const p=call.arguments[1].properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText()==='className');return p&&ts.isStringLiteral(p.initializer)&&p.initializer.text===name;}
const beforeHtml=fs.readFileSync(BASE+'/admin-index.html');
const names=[...new Set(beforeHtml.toString().match(/assets\/BusinessWorkbenchPage-customer-batch-[a-f0-9]+\.js/g))].map(p=>path.basename(p)).sort();
assert.equal(names.length,2);
const modules=[];
for(const name of names){
 const bytes=fs.readFileSync(BASE+'/assets/'+name),before=bytes.toString();assert(Buffer.from(before).equals(bytes));assert(H(bytes).startsWith(name.match(/([a-f0-9]+)\.js$/)[1]));
 const ast=parse(before,name),main=one(nodes(ast,n=>tag(n,'main')&&cls(n,'erp-ui customer-detail-compact customer-detail-readable customer-workbench customer-profile-tight')),'live customer detail main');
 let fn=main;while(fn&&!ts.isFunctionDeclaration(fn))fn=fn.parent;assert(fn?.name,'live native detail function');
 const metadata=one(nodes(fn,n=>tag(n,'p')&&cls(n,'customer-detail-meta mt-1')),'live header metadata only');
 const summary=one(nodes(fn,n=>tag(n,'div')&&cls(n,'customer-detail-summary customer-profile-summary')),'live summary');
 const spans=prop(object(summary),'children').initializer;assert(ts.isArrayLiteralExpression(spans)&&spans.elements.length===3);
 const jsx=one(nodes(fn,n=>tag(n,'h1')&&cls(n,'admin-page-title customer-detail-name')),'h1 jsx factory').expression.getText(ast),jsxs=summary.expression.getText(ast);
 const labels=['所属行业','当前阶段','下次跟进'];
 const hunks=[{name:'CustomerDetail/header-meta-removed',start:metadata.getStart(ast),end:metadata.end,old:metadata.getText(ast),replacement:'null'}];
 spans.elements.forEach((span,index)=>{
  assert(tag(span,'span'));const children=prop(object(span),'children').initializer;assert(ts.isArrayLiteralExpression(children)&&children.elements.length===2&&ts.isStringLiteral(children.elements[0]));
  assert.equal(children.elements[0].text,labels[index]+'：');const value=children.elements[1].getText(ast);
  const b=`${jsx}("b",{${index===1?'className:"customer-profile-stage",':''}children:${value}})`;
  const replacement=`${jsxs}("span",{children:[${jsx}("em",{children:${JSON.stringify(labels[index])}}),${b}]})`;
  hunks.push({name:'CustomerDetail/summary-'+index,start:span.getStart(ast),end:span.end,old:span.getText(ast),replacement});
 });
 for(const [label,className] of [['新增需求','crm-btn customer-profile-demand-action'],['管理联系人','crm-btn customer-profile-contact-action']]){
  const button=one(nodes(fn,n=>tag(n,'button')&&(()=>{try{const c=prop(object(n),'children').initializer;return ts.isStringLiteral(c)&&c.text===label;}catch{return false;}})()),'live button '+label);
  const p=prop(object(button),'className').initializer;assert(ts.isStringLiteral(p)&&p.text==='crm-btn crm-btn-primary');
  hunks.push({name:'CustomerDetail/button-visual-'+label,start:p.getStart(ast),end:p.end,old:p.getText(ast),replacement:JSON.stringify(className)});
 }
 assert.equal(hunks.length,6);
 const {after,records}=inverseDelta(before,hunks),sha=H(after),relative='assets/BusinessWorkbenchPage-customer-batch-'+sha.slice(0,16)+'.js';
 const afterAst=parse(after),afterMain=one(nodes(afterAst,n=>tag(n,'main')&&cls(n,'erp-ui customer-detail-compact customer-detail-readable customer-workbench customer-profile-tight')),'after detail');
 let af=afterMain;while(af&&!ts.isFunctionDeclaration(af))af=af.parent;assert.equal(nodes(af,n=>tag(n,'p')&&cls(n,'customer-detail-meta mt-1')).length,0);
 const oldUploads=nodes(ast,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='T6').map(n=>n.getText(ast)),newUploads=nodes(afterAst,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='T6').map(n=>n.getText(afterAst));assert(oldUploads.length>0);assert.deepEqual(oldUploads,newUploads);
 put('package/'+relative,after);json('package/evidence/'+name+'.delta.json',{input:'assets/'+name,output:relative,beforeSha256:H(bytes),afterSha256:sha,patches:records,inverseVerified:true,allOtherNativeBytesUnchanged:true,onlyCustomerDetailDisplayJSX:true,liveNativeFunction:fn.name.text,jsxFactories:{jsx,jsxs},T6UploadSHA:oldUploads.map(H),T6UploadUnchanged:true});
 modules.push({before:'assets/'+name,after:relative,sha256:sha,size:Buffer.byteLength(after)});
}
const file='client/src/business/platform/client/src/pages/CustomerProfileCompact.css',cssSource=fs.readFileSync(R+'/'+file,'utf8'),marker='/* Customer profile refined 20261121: confirmed compact demo, real data and handlers retained. */';
assert.equal(cssSource.split(marker).length,2);const css=marker+cssSource.split(marker)[1];
const ca=postcss.parse(css);ca.walkAtRules(n=>assert.equal(n.name,'media'));ca.walkRules(n=>n.selector.split(',').forEach(s=>assert(s.trim().startsWith('.erp-ui.customer-workbench.customer-profile-tight '),'page-only selector '+s)));assert(!/url\s*\(|@import|@font-face/i.test(css));
const cssRelative='assets/customer-profile-refined-'+H(css).slice(0,16)+'.css';put('package/'+cssRelative,css);
const html=htmlDelta(beforeHtml,modules,cssRelative);put('package/before-index.html',beforeHtml);put('package/after-index.html',html.after);
json('modules.json',modules);json('assets.json',modules.map(m=>({relative:m.after,sha256:m.sha256,size:m.size})).concat({relative:cssRelative,sha256:H(css),size:Buffer.byteLength(css)}));
json('package/evidence/html.json',{beforeSha256:H(beforeHtml),afterSha256:H(html.after),counts:html.counts,link:html.link,inverseVerified:true,previousHeaderMappingCssRetained:html.after.includes('/assets/customer-batch-actions-af6b970e3a2e2e06.css')});
const sourceFiles=['client/src/business/platform/client/src/pages/CustomerDetail.tsx',file];json('package/evidence/source-files.json',{sourceHashes:Object.fromEntries(sourceFiles.map(f=>[f,H(fs.readFileSync(R+'/'+f))])),builderSha256:H(fs.readFileSync(import.meta.filename)),nativeCompiler:'precise TypeScript AST display-JSX transform; original runtime factories, no ABI replacement',sourceScope:'header p removal, 3 summary wrappers, 2 button classes, scoped CSS only',demoFixedDataNotIncluded:true});
console.log(JSON.stringify({status:'OFFLINE_REAL_PROFILE_BUILT_NOT_DEPLOYED',modules,cssRelative,htmlSHA:H(html.after),displaySpansPerAsset:6,allUploadAndOtherBytesExact:true},null,2));
