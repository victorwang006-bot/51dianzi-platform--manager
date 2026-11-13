#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),ts=require('typescript');
const C=require('./business-orders-compact-core-20261114.cjs');
const {BASE,OUT,read,sha,parse,nodes,one,write,apply,finishHTML}=C;
const prop=(obj,name)=>one(obj,n=>ts.isPropertyAssignment(n)&&n.parent===obj&&(ts.isIdentifier(n.name)||ts.isStringLiteral(n.name))&&n.name.text===name,'property '+name);
const callProp=(call,name)=>prop(call.arguments[1],name);
const byString=(root,name,text)=>one(root,n=>ts.isPropertyAssignment(n)&&(ts.isIdentifier(n.name)||ts.isStringLiteral(n.name))&&n.name.text===name&&ts.isStringLiteral(n.initializer)&&n.initializer.text===text,name+'='+text);
const jsxCall=p=>{assert(ts.isCallExpression(p.parent.parent));return p.parent.parent};
const top=(a,name)=>one(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text===name&&n.parent===a,name);
const beforeUrls=JSON.parse(read(BASE+'/selected-urls.json')),workbenches=beforeUrls.filter(s=>s.includes('BusinessWorkbenchPage')),records=[],relocations={},proofs=[];
assert.equal(workbenches.length,2);
for(const [idx,beforeUrl] of workbenches.entries()){
 const before=read(BASE+beforeUrl),a=parse(before),native=top(a,'op');
 const f=idx===0?native:one(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='sN','shared SalesOrdersContent');
 const embedded=idx===1?'o':null,edits=[];
 const patch=(node,after,label)=>edits.push({label,start:node.getStart(a),end:node.end,before:node.getText(a),after});
 const header=jsxCall(byString(f,'title','业务订单')),record=callProp(header,'actions').initializer;
 patch(header,'null','remove complete visible global title/description node without spacing');
 const pageClass=one(f,n=>ts.isPropertyAssignment(n)&&n.name.getText(a)==='className'&&n.initializer.getText(a).includes('crm-sales-orders-page min-w-0 space-y-3'),'page class');
 if(embedded){
  const label=prop(pageClass.parent,'aria-label').initializer;assert(ts.isConditionalExpression(label));assert.equal(label.whenFalse.getText(a),'void 0');
  patch(label.whenFalse,'"业务订单"','accessible global page label; preserve embedded label exactly');
 }else edits.push({label:'accessible global page label without adding a title element',start:pageClass.end,end:pageClass.end,before:'',after:',"aria-label":"业务订单"'});
 const filter=jsxCall(byString(f,'className','crm-sales-orders-filters'));
 const filterRow=callProp(filter,'children').initializer;
 const filters=callProp(filterRow,'children').initializer;assert(ts.isArrayLiteralExpression(filters));
 const filterButton=one(filters,n=>ts.isCallExpression(n)&&n.parent===filters&&n.arguments.length===2&&ts.isObjectLiteralExpression(n.arguments[1])&&nodes(n.arguments[1],p=>ts.isStringLiteral(p)&&p.text==='筛选').length===1,'filter button');
 assert.equal(filterButton.parent,filters);
 const button=embedded?`${embedded}?null:${record.getText(a)}`:record.getText(a);
 edits.push({label:'move original record action after filter with original handler and permission scope',start:filterButton.end,end:filterButton.end,before:'',after:','+button});
 const colgroup=one(f,n=>ts.isCallExpression(n)&&n.arguments.length===2&&ts.isStringLiteral(n.arguments[0])&&n.arguments[0].text==='colgroup','main list colgroup');
 const cols=callProp(colgroup,'children').initializer;assert(ts.isArrayLiteralExpression(cols));assert.equal(cols.elements.length,9);
 const newCols=cols.elements.map((n,i)=>{
  if(i===2)return embedded?`${embedded}?${n.getText(a)}:null`:null;
  const width={1:22,3:12,8:16}[i];if(!width)return n.getText(a);
  const style=embedded?`${embedded}?void 0:{width:"${width}%"}`:`{width:"${width}%"}`;
  const s=n.getText(a),offset=n.arguments[1].end-1-n.getStart(a);return s.slice(0,offset)+',style:'+style+s.slice(offset);
 }).filter(s=>s!==null);
 patch(cols,'['+newCols.join(',')+']','global eight widths; preserve embedded nine widths exactly');
 const customer=byString(f,'children','客户 / 需求').initializer;
 patch(customer,embedded?`${embedded}?${customer.getText(a)}:"客户"`:'"客户"','global customer label; retain embedded label and demand number');
 const projectHead=jsxCall(byString(f,'children','项目'));
 patch(projectHead,embedded?`${embedded}?${projectHead.getText(a)}:null`:'null','project header only embedded');
 const projectCell=one(f,n=>ts.isCallExpression(n)&&n.arguments.length===2&&ts.isObjectLiteralExpression(n.arguments[1])&&n.arguments[1].properties.some(p=>ts.isPropertyAssignment(p)&&p.name.getText(a)==='title'&&/\.projectName\|\|/.test(p.initializer.getText(a))),'project cell');
 patch(projectCell,embedded?`${embedded}?${projectCell.getText(a)}:null`:'null','project cell only embedded; detail/data untouched');
 const result=apply(before,edits,`workbench-${idx}`),after=result.after,newA=parse(after);
 // Entire marketplace root and unrelated declarations remain byte-identical.
 const oldMall=top(a,'uI'),newMall=top(newA,'uI');assert.equal(oldMall.getText(a),newMall.getText(newA));
 const newNative=top(newA,'op');if(idx===1)assert.equal(newNative.getText(newA),native.getText(a));
 const replacementFunction=one(newA,n=>ts.isFunctionDeclaration(n)&&n.name?.text===f.name.text, f.name.text);
 const oldReturn=one(f.body,n=>ts.isReturnStatement(n)&&n.parent===f.body,'last render return'),newReturn=one(replacementFunction.body,n=>ts.isReturnStatement(n)&&n.parent===replacementFunction.body,'last render return');
 assert.equal(before.slice(f.getStart(a),oldReturn.getStart(a)),after.slice(replacementFunction.getStart(newA),newReturn.getStart(newA)),'all hooks/queries/mutation setup unchanged');
 const url='/assets/BusinessWorkbenchPage-business-compact-'+idx+'-'+sha(after)+'.js';write(url,after);records.push({relative:url.slice(1),sha256:sha(after)});relocations[beforeUrl]=url;
 const proof={...result.proof,idx,beforeUrl,url,functionName:f.name.text,embeddedSymbol:embedded,recordButton:record.getText(a),mallBytesUnchanged:true,hooksQueriesMutationSetupUnchanged:true,originalWrapperUnchanged:idx===1,onlyGlobalBusinessUIChanged:true};write(`workbench-${idx}-build-proof.json`,proof);proofs.push(proof);
}
const entryFrom=beforeUrls.find(s=>!s.includes('BusinessWorkbenchPage'));assert(entryFrom);
const entry=read(BASE+entryFrom),entryTo=path.posix.dirname(entryFrom)+'/index-business-compact-'+sha(entry)+'.js';write(entryTo,entry);records.unshift({relative:entryTo.slice(1),sha256:sha(entry)});relocations[entryFrom]=entryTo;
write('entry-build-proof.json',{beforeUrl:entryFrom,url:entryTo,sha256:sha(entry),allBytesUnchanged:true});finishHTML(relocations,records,null,entryFrom);
write('candidate-proof.json',{status:'PASS',onlyGlobalBusinessUIChanged:true,unrelatedNativeBytesUnchanged:true,mallBytesUnchanged:true,embeddedBehaviorUnchanged:true,scopeAndArchiveUnchanged:true,backendChanges:0,databaseOperations:0,permissionChanges:0,processReloads:0,productionWrites:0,files:records.length,workbenches:proofs});
console.log(JSON.stringify({status:'PASS',files:records.length,workbenches:proofs.map(x=>({idx:x.idx,patches:x.patches,sha256:x.sha256}))}));
