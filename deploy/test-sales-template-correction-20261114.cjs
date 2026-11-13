#!/usr/bin/env node
'use strict';
// AST-extracted actual candidate code only. All data and IO are inert fixtures.
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),jsx=require('react/jsx-runtime'),{JSDOM}=require('jsdom');
const C=require('./sales-template-correction-core-20261114.cjs');
const M=require('./sales-template-mall-patch-20261114.cjs');
const {OUT,BASE,read,sha,parse,nodes,one}=C;
const inputs=JSON.parse(read(OUT+'/files.json')),results=[];
const deny=()=>{throw new Error('Network or production writes forbidden in fixture tests')};
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://offline.invalid/'});
for(const key of ['window','document','Node','HTMLElement','Event','MouseEvent','MutationObserver'])global[key]=dom.window[key];
global.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=require('react-dom/client');
const top=(a,name)=>one(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text===name&&n.parent===a,name);
const variable=(a,name)=>one(a,n=>ts.isVariableDeclaration(n)&&n.name.getText(a)===name&&n.parent.parent.parent===a,name);
const prop=M.property;
function context(extra={}){return vm.createContext({window,document,URL,URLSearchParams,console,setTimeout,clearTimeout,queueMicrotask,fetch:deny,XMLHttpRequest:deny,...extra})}
function frame({children,...props}){return jsx.jsx('div',{...props,children})}
async function test(name,fn){try{await fn();results.push({name,status:'PASS'})}catch(error){results.push({name,status:'FAIL',error:error.stack});console.error(name,error.stack)}}
async function mount(component,props){const host=document.createElement('div');document.body.append(host);const root=createRoot(host);await React.act(async()=>root.render(jsx.jsx(component,props)));return{host,close:async()=>{await React.act(async()=>root.unmount());host.remove()}}}
async function click(el){assert(el);await React.act(async()=>el.click())}
const statuses={pending:{label:'待付款'},paid:{label:'待发货'},shipped:{label:'已发货'},done:{label:'已完成'},refund:{label:'售后'},refunded:{label:'已退款'},cancel:{label:'已取消'}};
const orders=Array.from({length:12},(_,i)=>({id:i+1,orderNo:'FIXTURE-'+(i+1),status:i===0?'pending':'paid',totalAmount:'10.10',taxAmount:'0.1',shippingFee:'0',receiver:'OFFLINE',receiverPhone:'001234',receiverAddress:'FIXTURE',deliveryMethod:'express',createdAt:'2026-11-14',items:[{id:i+1,partNumber:'MOCK-'+(i+1),qty:'1',unitPrice:'10.10'}]}));
(async()=>{
 await test('all five candidate hashes match recorded manifest',async()=>{assert.equal(inputs.length,5);for(const item of inputs)assert.equal(sha(fs.readFileSync(OUT+'/'+item.relative)),item.sha256)});
 for(let idx=0;idx<2;idx++){
  const proof=JSON.parse(read(OUT+`/workbench-${idx}-build-proof.json`)),text=read(OUT+proof.url),a=parse(text),mall=top(a,'uI'),map=proof.mallMappings;
  await test(`bundle${idx}: exact business baseline including original wrapper/native module`,async()=>{
   const original=parse(read(BASE+proof.originalBusinessAsset));assert.equal(top(a,'op').getText(a),top(original,'op').getText(original));
   const before=parse(read(BASE+proof.beforeUrl));
   const customName='__customer_workbench_manager_v1';
   const oldCustom=nodes(before,n=>ts.isVariableDeclaration(n)&&n.name.getText(before)===customName);
   const newCustom=nodes(a,n=>ts.isVariableDeclaration(n)&&n.name.getText(a)===customName);
   assert.equal(oldCustom.length,newCustom.length);if(oldCustom.length)assert.equal(oldCustom[0].getText(before),newCustom[0].getText(a));
   assert.equal(nodes(a,n=>ts.isIdentifier(n)&&n.text==='__SU_CRM_GET').length,0);
  });
  await test(`bundle${idx}: exact inverse preserves every byte outside approved edits`,async()=>{
   let inverse=text;const patches=JSON.parse(read(OUT+`/workbench-${idx}-patches.json`));
   for(const p of [...patches].reverse()){assert.equal(text.slice(p.afterStart,p.afterEnd),p.after);inverse=inverse.slice(0,p.afterStart)+p.before+inverse.slice(p.afterEnd)}
   assert.equal(inverse,read(BASE+proof.beforeUrl));
   const before=parse(read(BASE+proof.beforeUrl));
   for(const name of ['Ty','Ly','Uy','KI','__d51_so_get','__d51_ir_w_get',map.exportToExcel])assert.equal(top(a,name).getText(a),top(before,name).getText(before));
  });
  const x=context({c:React,e:jsx,H:{useUtils:()=>({order:{sellerOrders:{invalidate:async()=>{}}}}),order:new Proxy({sellerOrders:{useQuery:()=>({data:orders,isLoading:false})},expressCos:{useQuery:()=>({data:[]})},tracks:{useQuery:()=>({data:[]})}},{get:(t,k)=>t[k]??{useMutation:()=>({isPending:false,mutate:deny})}})},M:{success:()=>{},warning:()=>{},info:()=>{},error:()=>{}},Fo:statuses,hx:{pending:'text-blue-600',paid:'text-green-600'},Zs:frame,xa:({children,...p})=>frame({...p,className:'aui-page '+p.className,children}),gs:frame,rn:frame,Ot:()=>null,_g:()=>null,pr:()=>null,Ao:String,ri:String,jd:String,Ms:Number,rt:v=>Number(v).toFixed(2),Fn:()=>false});
  for(const name of ['Cc','go','ho','__SU_MALL_AMOUNTS'])vm.runInContext('var '+variable(a,name).getText(a)+';',x);
  const exportCalls=[];x[map.exportToExcel]=async rows=>exportCalls.push(rows);
  vm.runInContext(mall.getText(a),x);
  let mounted;
  await test(`bundle${idx}: actual mall renders independent filter, export toolbar, original eight columns and status dots`,async()=>{
   mounted=await mount(x.uI,{readOnly:true});const h=mounted.host;
   assert(h.querySelector('.sales-order-filter-card'));
   assert(!h.querySelector('.sales-order-table-card .sales-order-filter-card'));
   assert(h.querySelector('.sales-order-table-card .sales-order-list-toolbar'));
   assert(h.querySelector('input[aria-label="搜索商城订单"]'));
   assert.equal(h.querySelectorAll('thead th').length,8);
   assert(h.querySelector('.sales-order-status-dot'));
   assert([...h.querySelectorAll('button')].some(b=>b.textContent==='更多'));
   assert(!h.querySelector('.aui-page-header'));
  });
  if(mounted){
   await test(`bundle${idx}: actual next/previous pagination keeps all filtered results exportable`,async()=>{
    const h=mounted.host,buttons=()=>[...h.querySelectorAll('.sales-order-pagination button')];
    assert.equal(buttons()[0].textContent,'上一页');assert(buttons()[0].disabled);
    await click(buttons()[1]);assert(h.querySelector('.sales-order-pagination').textContent.includes('第 2 / 2 页'));
    assert(buttons()[1].disabled);assert.equal(h.querySelectorAll('tbody > tr').length,2);
    await click(h.querySelector('.sales-order-list-toolbar button'));assert.equal(exportCalls.at(-1).length,12);
    await click(buttons()[0]);assert.equal(h.querySelectorAll('tbody > tr').length,10);
   });
   await test(`bundle${idx}: actual status selector filters rows without changing underlying fixture data`,async()=>{
    const select=mounted.host.querySelector('select[aria-label="商城订单状态"]');
    await React.act(async()=>{select.value='pending';select.dispatchEvent(new Event('change',{bubbles:true}))});
    assert.equal(select.value,'pending');assert.equal(mounted.host.querySelectorAll('tbody > tr').length,1);
    await click(mounted.host.querySelector('.sales-order-list-toolbar button'));assert.equal(exportCalls.at(-1).length,1);
    assert.equal(orders.length,12);
   });
   await mounted.close();
  }
 }
 await test('stylesheet is exclusively scoped to mall and never targets restored business page',async()=>{
  const proof=JSON.parse(read(OUT+'/css-build-proof.json'));assert(proof.onlyMallPageScoped);
  const css=read(OUT+proof.url);assert(!css.includes('crm-sales-orders-page'));
  assert(css.includes('.aui-page.erp-ui.sales-order-page .sales-order-filter-card'));
 });
 await test('entry/homepage and import-map dependency preservation proofs pass',async()=>{
  const p=JSON.parse(read(OUT+'/entry-build-proof.json'));assert.equal(read(OUT+p.url),read(BASE+p.beforeUrl));
  assert.equal(JSON.parse(read(OUT+'/dependency-resolution-proof.json')).status,'PASS');
  assert(JSON.parse(read(OUT+'/html-build-proof.json')).exactInverse);
 });
 const failed=results.filter(r=>r.status==='FAIL');
 const report={status:failed.length?'FAIL':'PASS',actualCandidateBytesExecuted:true,tests:results.length,failed:failed.length,results,inputs,productionWrites:0,networkCalls:0,coverageLimits:['Actual mall roots execute under inert fixture IO; no production APIs or writes.','Business native/page wrapper byte restoration verified against exact pre-redesign files; original business module retained.','No production browser pixel/computed-style or logged-in acceptance claimed.']};
 fs.writeFileSync(OUT+'/actual-candidate-tests.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,tests:report.tests,failed:report.failed}));dom.window.close();if(failed.length)process.exitCode=1;
})().catch(error=>{console.error(error.stack);dom.window.close();process.exitCode=1});
