#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');
const C=require('./sales-template-correction-core-20261114.cjs');
const {REPO,BASE,OUT,read,sha,parse,nodes,one,write,apply,finishHTML}=C;
const M=require('./sales-template-mall-patch-20261114.cjs');
const manifest=JSON.parse(read(path.dirname(BASE)+'/previous-manifest.json'));
const verified=JSON.parse(read(path.dirname(BASE)+'/previous-verified.json'));
const records=[],relocations={},proofs=[];
function asset(prefix,text,directory='/assets/',ext='js'){
 const url=directory+prefix+'-'+sha(text)+'.'+ext;write(url.slice(1),text);records.push({relative:url.slice(1),sha256:sha(text)});return url;
}
function top(ast,name){return one(ast,n=>ts.isFunctionDeclaration(n)&&n.name?.text===name&&n.parent===ast,'top-level '+name)}
function edit(node,ast,after,reason){return{start:node.getStart(ast),end:node.end,before:node.getText(ast),after,reason}}
async function build(){
 const urls=JSON.parse(read(BASE+'/selected-urls.json'));
 const entry=urls.find(url=>url.includes('index-sales-unified-'));assert(entry);
 relocations[entry]=asset('index-sales-business-template',read(BASE+entry),entry.slice(0,entry.lastIndexOf('/')+1));
 write('entry-build-proof.json',{beforeUrl:entry,url:relocations[entry],exactBytesUnchanged:true,sha256:sha(read(BASE+entry)),defaultCustomerHomepageUnchanged:true});
 for(let idx=0;idx<2;idx++){
  const current=urls.find(url=>url.includes('BusinessWorkbenchPage-sales-unified-'+idx));assert(current);
  const previous=manifest.baselineAssets.find(x=>x.relative.includes('BusinessWorkbenchPage-navigation-compact-'+idx));assert(previous);
  assert.equal(sha(read(BASE+'/'+previous.relative)),previous.sha256,'pre-redesign baseline changed');
  const before=read(BASE+current),original=read(BASE+'/'+previous.relative),ast=parse(before),oldAst=parse(original);
  const oldBusiness=top(oldAst,'op'),currentBusiness=top(ast,'op');
  assert.equal(currentBusiness.getText(ast),'function op(props){return __SU_CRM_GET().CrmSalesOrders(props);}');
  const getter=top(ast,'__SU_CRM_GET');
  const instance=one(ast,n=>ts.isVariableStatement(n)&&n.parent===ast&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='__SU_CRM_INSTANCE'),'source factory instance');
  assert.equal(instance.declarationList.declarations.length,1);
  const mapping=JSON.parse(read(REPO+`/deploy/sales-unified-evidence-20261113/workbench-${idx}-build-proof.json`)).mallMappings;
  const iconAsset=manifest.baselineAssets.find(x=>x.relative.includes('BusinessWorkbenchPage-navigation-compact-0'));
  const iconAst=parse(read(BASE+'/'+iconAsset.relative));
  const iconBusiness=top(iconAst,'op');
  const mall=await M.patchMall(before,iconBusiness.getText(iconAst),mapping);
  const edits=[edit(currentBusiness,ast,oldBusiness.getText(oldAst),'restore exact pre-redesign business page including all old columns and operations'),edit(getter,ast,'','remove replaced business presentation factory only'),edit(instance,ast,'','remove unused factory instance only'),...mall.edits];
  const result=apply(before,edits,'workbench-'+idx),next=parse(result.after);
  assert.equal(top(next,'op').getText(next),oldBusiness.getText(oldAst),'business not exact old runtime');
  assert(!nodes(next,n=>ts.isIdentifier(n)&&n.text==='__SU_CRM_GET').length,'orphan source factory reference');
  for(const name of ['Ty','Ly','Uy','KI','__d51_so_get','__d51_ir_w_get','__d51_rx_chat_helpers_get',mapping.exportToExcel]){
   assert.equal(top(next,name).getText(next),top(ast,name).getText(ast),'unrelated native function '+name);
  }
  const oldMall=top(ast,'uI'),newMall=top(next,'uI');
  const beforeReturn=oldMall.body.statements.find(ts.isReturnStatement),afterReturn=newMall.body.statements.find(ts.isReturnStatement);
  assert.equal(before.slice(oldMall.getStart(ast),beforeReturn.getStart(ast)),result.after.slice(newMall.getStart(next),afterReturn.getStart(next)),'mall body/handlers changed');
  const beforePage=M.jsx(oldMall,ast,'erp-ui sales-order-page'),afterPage=M.jsx(newMall,next,'erp-ui sales-order-page');
  const beforeChildren=M.property(beforePage.arguments[1],'children').initializer.elements,afterChildren=M.property(afterPage.arguments[1],'children').initializer.elements;
  assert.equal(afterChildren.length,beforeChildren.length+1,'only one standalone filter added');
  assert.deepEqual(beforeChildren.slice(3).map(n=>n.getText(ast)),afterChildren.slice(4).map(n=>n.getText(next)),'native dialogs/menu changed');
  const trigger=M.jsx(newMall,next,'inbound-row-menu');
  assert.equal(M.property(trigger.arguments[1],'onClick').initializer.getText(next),mall.proof.originalTriggerOnClick,'native trigger handler changed');
  const candidate=asset('BusinessWorkbenchPage-business-template-'+idx,result.after);relocations[current]=candidate;
  const proof={...result.proof,beforeUrl:current,url:candidate,originalBusinessAsset:'/'+previous.relative,businessNativeExactlyRestored:true,businessNativeSha256:sha(oldBusiness.getText(oldAst)),businessSourceSha256:sha(read(REPO+'/client/src/business/platform/client/src/pages/CrmSalesOrders.tsx')),unrelatedNativeBytesUnchanged:true,mallOperationsUnchanged:true,scopeAndArchiveUnchanged:true,mallMappings:mapping,mallProof:mall.proof};
  write('workbench-'+idx+'-build-proof.json',proof);proofs.push(proof);
 }
 const css=read(REPO+'/client/src/business/platform/client/src/pages/OutboundManagement.css');
 const marker='/* Mall-only overrides: use the original business list tokens';
 const start=css.indexOf(marker);assert(start>=0,'mall-only CSS section missing');
 const only=css.slice(start);
 const selectors=[...only.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/(?:^|})\s*([^{}]+?)\s*\{/gm)].map(m=>m[1].trim()).filter(s=>!s.startsWith('@'));
 assert(selectors.length>5);assert(selectors.every(s=>s.split(',').every(p=>p.trim().startsWith('.aui-page.erp-ui.sales-order-page'))),'CSS must only target mall page');
 assert(!only.includes('crm-sales-orders-page'),'business CSS forbidden');
 const cssUrl=asset('sales-mall-business-template',only,'/assets/','css');
 write('css-build-proof.json',{url:cssUrl,sourceSha256:sha(css),onlyMallPageScoped:true,selectors:selectors.length});
 finishHTML(relocations,records,cssUrl,entry);
 assert.equal(records.length,5);
 assert.equal(sha(read(BASE+'/index-before.html')),verified.htmlSha256);
 const businessSource=read(REPO+'/client/src/business/platform/client/src/pages/CrmSalesOrders.tsx');
 const originalSource=require('node:child_process').execFileSync('git',['show','a3fa1a4^:client/src/business/platform/client/src/pages/CrmSalesOrders.tsx'],{cwd:REPO,encoding:'utf8'});
 assert.equal(businessSource,originalSource,'business source must restore exactly');
 const proof={status:'PASS',businessNativeExactlyRestored:true,businessSourceExactlyRestored:true,unrelatedNativeBytesUnchanged:true,mallOperationsUnchanged:true,scopeAndArchiveUnchanged:true,navigationAssetUnchanged:true,backendChanges:0,databaseOperations:0,workbenches:proofs.map(p=>({url:p.url,businessNativeSha256:p.businessNativeSha256})),files:records};
 write('candidate-proof.json',proof);
 console.log(JSON.stringify({status:'BUILT',files:records.length,businessNativeExactlyRestored:true,relocations}));
}
module.exports={build};if(require.main===module)build().catch(error=>{console.error(error.stack);process.exitCode=1});
