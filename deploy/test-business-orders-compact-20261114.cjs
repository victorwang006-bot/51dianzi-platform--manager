#!/usr/bin/env node
'use strict';
// Execute only AST-extracted actual render nodes with inert data. Never run bundles' top-level/API code.
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm'),ts=require('typescript'),React=require('react'),jsx=require('react/jsx-runtime'),{renderToStaticMarkup}=require('react-dom/server'),{JSDOM}=require('jsdom');
const C=require('./business-orders-compact-core-20261114.cjs'),{BASE,OUT,read,sha,parse,nodes,one}=C;
const results=[],deny=()=>{throw Error('Production IO forbidden')},noop=()=>{};
const prop=(obj,key)=>one(obj,n=>ts.isPropertyAssignment(n)&&n.parent===obj&&(ts.isIdentifier(n.name)||ts.isStringLiteral(n.name))&&n.name.text===key,'prop '+key);
const cp=(call,key)=>prop(call.arguments[1],key).initializer;
const isJSXCall=n=>ts.isCallExpression(n)&&n.arguments.length>=2&&ts.isObjectLiteralExpression(n.arguments[1])&&(/^(e\.(jsx|jsxs)|s|l)$/.test(n.expression.getText()));
const classCall=(f,text)=>one(f,n=>isJSXCall(n)&&n.arguments[1].properties.some(p=>ts.isPropertyAssignment(p)&&p.name.getText()==='className'&&ts.isStringLiteral(p.initializer)&&p.initializer.text===text),'section '+text);
const fOf=(a,name)=>one(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text===name,'function '+name);
const tableClass='crm-sales-orders-table admin-table-readable w-full table-fixed',filterClass='crm-sales-orders-filters',pageClass='crm-sales-orders-page min-w-0 space-y-3';
function pageOf(f){const p=one(f,n=>ts.isPropertyAssignment(n)&&n.name.getText()==='className'&&n.initializer.getText().includes(pageClass),'page');return p.parent.parent}
const row={id:1,orderNumber:'OFFLINE-ORDER',customerName:'离线客户',demandNo:'OFFLINE-DEMAND',projectName:'OFFLINE-PROJECT',totalAmount:'10.10',status:'confirmed',paymentStatus:'unpaid',shipmentStatus:'unshipped',createdAt:'2026-11-14'};
function html(element){return renderToStaticMarkup(element)}
function fixture(a,f,idx,embedded=false,canWrite=true){
 const table=classCall(f,tableClass),filter=classCall(f,filterClass),p=pageOf(f),events=[];
 const ctx={fetch:deny,XMLHttpRequest:deny,console,React,String,e:jsx,s:jsx.jsx,l:jsx.jsxs};
 const roots=[table,filter,p];
 for(const root of roots)for(const n of nodes(root,n=>ts.isIdentifier(n))){if(!(n.text in ctx))ctx[n.text]=noop;}
 // JSX component stand-ins only: preserve props/children as simple native elements.
 const frame=tag=>({children,variant,size,containerClassName,onValueChange,...props})=>jsx.jsx(tag,{...props,children});
 for(const root of [table,filter])for(const n of nodes(root,isJSXCall)){if(ts.isIdentifier(n.arguments[0]))ctx[n.arguments[0].text]=frame('span')}
 const bind=(n,tag)=>ctx[n.arguments[0].text]=frame(tag);
 bind(table,'table');const blocks=cp(table,'children').elements;bind(blocks[1],'thead');bind(blocks[2],'tbody');
 const headingRow=cp(blocks[1],'children');bind(headingRow,'tr');
 for(const n of nodes(cp(headingRow,'children'),isJSXCall))bind(n,'th');
 const mapper=cp(blocks[2],'children'),rowArrow=mapper.arguments[0],rowCall=rowArrow.body;bind(rowCall,'tr');
 for(const cell of cp(rowCall,'children').elements){const direct=ts.isConditionalExpression(cell)?cell.whenTrue:cell;if(isJSXCall(direct))bind(direct,'td')}
 const filterRow=cp(filter,'children'),filterChildren=cp(filterRow,'children');bind(filter,'section');
 const input=filterChildren.elements[0];bind(input,'input');
 const buttonCalls=nodes(filterRow,n=>isJSXCall(n)&&n.arguments[1].properties.some(p=>ts.isPropertyAssignment(p)&&p.name.getText()==='type'&&p.initializer.getText()==='"button"'));
 for(const b of buttonCalls)bind(b,'button');
 for(const e of nodes(table,n=>ts.isElementAccessExpression(n)&&ts.isIdentifier(n.expression)))ctx[e.expression.text]=new Proxy({},{get:()=> '离线状态'});
 // non-JSX status/amount/date functions remain local deterministic formatters.
 for(const n of nodes(table,n=>ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&!isJSXCall(n)&&n.expression.text!=='String'))ctx[n.expression.text]=value=>String(value??'');
 const data={data:{items:[row],total:1},isLoading:false,isError:false,isFetching:false};
 if(idx===0)Object.assign(ctx,{Ee:data,l:'',m:'all',i:'',ao:'original-blue-button',Er:'original-secondary-button',p:1,we:1,N:v=>events.push(['entry',v]),os:()=>events.push(['filter']),x:v=>events.push(['page',v]),f:v=>events.push(['view',v])});
 else Object.assign(ctx,{$:data,o:embedded?{customer:{name:'离线客户',archivedAt:null}}:undefined,q:canWrite,p:'',k:'',m:'all',I:1,le:1,Rd:'original-blue-button',Ji:'original-secondary-button',V:v=>events.push(['entry',v]),js:()=>events.push(['filter']),A:v=>events.push(['page',v]),x:v=>events.push(['view',v])});
 const sandbox=vm.createContext(ctx),execute=n=>vm.runInContext('('+n.getText(a)+')',sandbox,{timeout:1000});
 return {table,filter,p,execute,events,sandbox};
}
function walk(element,predicate,out=[]){if(!element||typeof element!=='object')return out;if(predicate(element))out.push(element);const children=element.props?.children;if(Array.isArray(children))children.forEach(c=>walk(c,predicate,out));else walk(children,predicate,out);return out}
function test(name,fn){try{fn();results.push({name,status:'PASS'})}catch(e){results.push({name,status:'FAIL',error:e.stack});console.error(name,e.stack)}}
for(let idx=0;idx<2;idx++){
 const proof=JSON.parse(read(OUT+`/workbench-${idx}-build-proof.json`)),before=read(BASE+proof.beforeUrl),after=read(OUT+proof.url),a=parse(after),oldA=parse(before),f=fOf(a,proof.functionName),oldF=fOf(oldA,proof.functionName);
 test(`bundle${idx}: exact inverse and unchanged hooks/mall/wrapper`,()=>{let inverse=after;for(const p of JSON.parse(read(OUT+`/workbench-${idx}-patches.json`)).reverse()){assert.equal(after.slice(p.afterStart,p.afterEnd),p.after);inverse=inverse.slice(0,p.afterStart)+p.before+inverse.slice(p.afterEnd)}assert.equal(inverse,before);assert(proof.hooksQueriesMutationSetupUnchanged&&proof.mallBytesUnchanged);if(idx===1)assert.equal(fOf(a,'op').getText(a),fOf(oldA,'op').getText(oldA))});
 const x=fixture(a,f,idx),tableElement=x.execute(x.table),filterElement=x.execute(x.filter);
 const dom=new JSDOM(html(tableElement)+html(filterElement)),doc=dom.window.document;
 test(`bundle${idx}: global actual eight columns, demand preserved, project absent`,()=>{assert.deepEqual([...doc.querySelectorAll('thead th')].map(n=>n.textContent),['订单号','客户','金额（含税）','状态','收款','出货','录入时间','操作']);assert.equal(doc.querySelectorAll('tbody tr:first-child > td').length,8);assert.equal(doc.querySelectorAll('col').length,8);assert(doc.querySelector('tbody').textContent.includes(row.demandNo));assert(!doc.querySelector('tbody').textContent.includes(row.projectName));const cols=doc.querySelectorAll('col');assert.equal(cols[1].style.width,'22%');assert.equal(cols[2].style.width,'12%');assert.equal(cols[7].style.width,'16%')});
 test(`bundle${idx}: original blue record follows filter, wrapping retained, click opens original state`,()=>{const buttons=[...doc.querySelectorAll('.crm-sales-orders-filters button')];assert.deepEqual(buttons.map(b=>b.textContent),['筛选','录入销售订单']);assert(buttons[1].className.includes('original-blue-button'));assert(doc.querySelector('.crm-sales-orders-filters .flex-wrap'));const entry=walk(filterElement,e=>e.props?.className==='original-blue-button')[0];entry.props.onClick();assert.deepEqual(x.events,[['entry',true]])});
 test(`bundle${idx}: page first effective child is filter; no heading or spacer; accessible page label`,()=>{const p=x.p,children=cp(p,'children').elements;const first=children.map(n=>x.execute(n)).find(v=>v!==null&&v!==false&&v!==undefined);assert.equal(first.props.className,filterClass);const label=cp(p,'aria-label');assert.equal(x.execute(label),'业务订单');assert.equal(nodes(f,n=>ts.isPropertyAssignment(n)&&n.name.getText()==='title'&&ts.isStringLiteral(n.initializer)&&n.initializer.text==='业务订单').length,0)});
 test(`bundle${idx}: row actions/status/date/pagination and all dialogs unchanged`,()=>{const oldTable=classCall(oldF,tableClass),oldBlocks=cp(oldTable,'children').elements,oldMapper=cp(oldBlocks[2],'children'),oldRow=oldMapper.arguments[0].body;const oldCells=cp(oldRow,'children').elements,newCells=cp(cp(cp(x.table,'children').elements[2],'children').arguments[0].body,'children').elements;for(const i of [0,1,3,4,5,6,7,8])assert.equal(newCells[i].getText(a),oldCells[i].getText(oldA));const pageBefore=pageOf(oldF),oldChildren=cp(pageBefore,'children').elements,newChildren=cp(x.p,'children').elements;for(let i=idx===1?4:3;i<oldChildren.length;i++)assert.equal(newChildren[i].getText(a),oldChildren[i].getText(oldA));const ret=(ff,aa)=>one(ff.body,n=>ts.isReturnStatement(n)&&n.parent===ff.body,'render return');const oldRet=ret(oldF,oldA),newRet=ret(f,a);const oldPage=pageBefore,newPage=x.p;assert.equal(oldA.text.slice(oldPage.end,oldRet.end),a.text.slice(newPage.end,newRet.end))});
 dom.window.close();
 if(idx===1)for(const canWrite of [true,false]){
  test(`shared embedded ${canWrite?'write':'read-only'}: actual nine-column and filter DOM byte-identical`,()=>{const x=fixture(a,f,idx,true,canWrite),old=fixture(oldA,oldF,idx,true,canWrite);assert.equal(html(x.execute(x.table)),html(old.execute(old.table)));assert.equal(html(x.execute(x.filter)),html(old.execute(old.filter)));const d=new JSDOM(html(x.execute(x.table))+html(x.execute(x.filter)));assert.equal(d.window.document.querySelectorAll('thead th').length,9);assert(d.window.document.querySelector('tbody').textContent.includes(row.projectName));assert.equal(d.window.document.querySelectorAll('col[style]').length,0);assert.equal(d.window.document.querySelectorAll('.crm-sales-orders-filters button').length,canWrite?2:1);d.window.close();assert.equal(x.execute(cp(x.p,'aria-label')),old.execute(cp(old.p,'aria-label')));});
 }
}
test('four asset hashes and untouched entry/importmap scopes/CSS',()=>{const files=JSON.parse(read(OUT+'/files.json'));assert.equal(files.length,4);for(const f of files)assert.equal(sha(fs.readFileSync(OUT+'/'+f.relative)),f.sha256);const e=JSON.parse(read(OUT+'/entry-build-proof.json'));assert.equal(read(BASE+e.beforeUrl),read(OUT+e.url));const h=JSON.parse(read(OUT+'/html-build-proof.json'));assert(h.exactInverse&&h.preservedOldImportsAndScopes);assert.equal(h.onlyNewStylesheet,null);assert.equal(JSON.parse(read(OUT+'/dependency-resolution-proof.json')).status,'PASS');});
const failed=results.filter(r=>r.status==='FAIL').length,report={status:failed?'FAIL':'PASS',tests:results.length,failed,results,actualCandidateRenderNodesExecuted:true,networkCalls:0,productionWrites:0,coverageLimits:['Actual AST-extracted table/filter/page-label render nodes executed with inert local fixtures; no bundled application top-level or network access.','Embedded rendered table/filter DOM compared byte-for-byte to deployed baseline for both write/read-only permissions.','No production logged-in browser or pixel/computed-style acceptance claimed.']};
fs.writeFileSync(OUT+'/actual-candidate-tests.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,tests:report.tests,failed}));if(failed)process.exitCode=1;
