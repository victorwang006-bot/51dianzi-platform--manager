#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';
import {sliceActual,tree,nodes,read,json,sha} from './tests/admin-candidate-helper.mjs';
import {sliceMaterialHost} from './tests/admin-material-helper.mjs';
const O='/home/ubuntu/task-recovery/inquiry-reception-release-20261113/admin-material-overlay';
const write=(f,v)=>fs.writeFileSync(O+'/'+f,typeof v==='string'?v:JSON.stringify(v,null,2)+'\n');
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://offline.invalid/workbench/channel-inventory',pretendToBeVisual:true});
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});
for(const k of ['window','document','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Event','MouseEvent','Node','localStorage','sessionStorage'])globalThis[k]=dom.window[k];
Object.assign(globalThis,{React,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:f=>setTimeout(()=>f(Date.now()),0),cancelAnimationFrame:clearTimeout});
const {createRoot}=await import('react-dom/client');
const proof=json(O+'/build-admin-material-proof.json'),manifest=json(O+'/files.admin-material-overlay.json');
const native=sliceActual(read(proof.domainSingletonProof.runtimeFile),['TS','CS','zS','ql','eT','nT','bi'],{O:React},'actual-existing-H-and-native-query.js');
const {TS:QueryClient,CS:QueryClientProvider,eT:H,nT:personal,bi:observable}=native.exports;
assert.notEqual(H,personal);
const results=[],extractions=[native.proof];let active=null;
const actualCache=new Map();
const clean=v=>JSON.parse(JSON.stringify(v));
const row=(id=41)=>({id,revision:2,partNumber:'LM358',brand:'TI',qty:1200,price:'12.300',canPublish:true,publicationStatus:'unpublished',reception:{status:'ready',recipientName:'伪造列表owner姓名',responsibilityVersion:999},sourceFactoryName:'不可信来源厂名',ownerName:'不可信老板',customerContact:'不能回铺客户联系人'});
const ready=(name='真实责任员工 王工',version=7)=>({reception:{status:'ready',recipientName:name,responsibilityVersion:version}});
const receipt=input=>({materialId:input.materialId,revision:input.expectedRevision,status:'published',publicId:'ocp_'+'a'.repeat(32)});
const tick=()=>new Promise(r=>setTimeout(r,25));
async function test(label,fn){try{await fn();results.push({label,status:'PASS'});console.log('PASS',label);}catch(e){results.push({label,status:'FAIL',error:e.stack});throw e;}}
function verifyBytes(p){const before=read(p.inputFile),after=read(p.outputFile);assert.equal(sha(before),p.beforeSha256);assert.equal(sha(after),p.afterSha256);let inverse=after;for(const e of [...p.edits].reverse()){assert.equal(inverse.slice(e.outStart,e.outEnd),e.text);inverse=inverse.slice(0,e.outStart)+e.before+inverse.slice(e.outEnd);}assert.equal(inverse,before);for(const x of p.partitions){const b=before.slice(x.beforeStart,x.beforeEnd),a=after.slice(x.afterStart,x.afterEnd);assert.equal(a,b);assert.equal(sha(a),x.sha256);}}
async function fixture(record,domain){
 const text=read(record.file),evidence=proof.proofs.find(p=>p.outputFile===record.file).bindingEvidence.find(d=>d.domain===domain);
 const getter=domain==='actual-host'?'__d51_material_host_get':'__d51_material_get';
 const seeds=[getter,evidence.hook,evidence.confirmation,evidence.disabled,evidence.price];
 const name=record.targetRelative.split('/').at(-1);
 const key=record.sha256+':'+domain;
 let actual=actualCache.get(key);
 if(!actual){actual=domain==='actual-host'?sliceMaterialHost(text,seeds,{se:React,c:jsx.jsx,s:jsx.jsxs,Ee:jsx.Fragment,je:H},name+'-host.js'):sliceActual(text,seeds,{c:React,e:jsx,H,Xe:React},name+'-original.js');actualCache.set(key,actual);extractions.push(actual.proof);}
 const get=actual.exports[getter];assert.equal(get(),get());
 const state={reads:[],writes:[],pending:[],mode:'ready',previewResult:ready(),previewError:null,publishMode:'success',completes:0,authErrors:[],isCurrent:true,lastHook:null};
 const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 const trpcClient=H.createClient({links:[()=>({op})=>observable(observer=>{
  const rec={path:op.path,type:op.type,input:clean(op.input),signal:op.signal,aborted:false};
  (op.type==='query'?state.reads:state.writes).push(rec);
  if(op.path!=='channelInventory.previewFactoryMaterialReception'&&op.path!=='channelInventory.publishFactoryMaterial')throw Error('UNAUTHORIZED_OTHER_METHOD:'+op.path);
  const abort=()=>{rec.aborted=true;};op.signal?.addEventListener('abort',abort);
  const send=value=>{observer.next({result:{data:value}});observer.complete();};
  const pending={rec,resolve:send,reject:error=>observer.error(error)};
  if(op.type==='query'){
   if(state.mode==='hold')state.pending.push(pending);
   else queueMicrotask(()=>state.previewError?observer.error(state.previewError):send(state.previewResult));
  }else if(state.publishMode==='hold')state.pending.push(pending);
  else if(state.publishMode==='uncertain')queueMicrotask(()=>observer.error(new Error('网络结果尚未确认')));
  else if(state.publishMode==='malformed')queueMicrotask(()=>send({...receipt(op.input),revision:999}));
  else queueMicrotask(()=>send(receipt(op.input)));
  return ()=>op.signal?.removeEventListener('abort',abort);
 })]});
 let props={rows:[row(41),row(42),row(43)],context:{expectedEnterpriseId:9,expectedActorUserId:7},scopeKey:'enterprise9:actor7',authorized:true,available:true,proofReady:true,proofVersion:10,isCurrent:()=>state.isCurrent,onComplete:async()=>{state.completes++;},onAuthorizationError:e=>state.authErrors.push(e)};
 function Harness(){const hook=actual.exports[evidence.hook](props);state.lastHook=hook;return React.createElement(React.Fragment,null,props.rows.map(r=>React.createElement('div',{'data-row':r.id,key:r.id},hook.action(r))),hook.dialog);}
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const node=()=>React.createElement(QueryClientProvider,{client},React.createElement(H.Provider,{client:trpcClient,queryClient:client},React.createElement(Harness)));
 async function render(changes={}){props={...props,...changes};await React.act(async()=>{root.render(node());await tick();});await settle();}
 async function settle(){await React.act(async()=>{await tick();});}
 async function click(selector){const b=host.querySelector(selector);assert.ok(b,'exists '+selector);await React.act(async()=>{b.click();await tick();});await settle();return b;}
 async function resolve(p,value){await React.act(async()=>{p.resolve(value);await tick();});await settle();}
 await render();
 return {actual,evidence,get,state,host,client,render,settle,click,resolve,get props(){return props;},async dispose(){await React.act(async()=>{root.unmount();await tick();});client.clear();host.remove();}};
}
try{
 await test('release overlay: input CAS + source component pin + fullbytes inverse/unchanged partitions + only exact two material domains',async()=>{
  assert.equal(manifest.length,3);for(const f of manifest)assert.equal(sha(fs.readFileSync(f.file)),f.sha256);
  assert.ok(proof.sourceFiles.some(p=>p.file.endsWith('/FactoryMaterialPublish.tsx')));assert.ok(proof.sourceFiles.some(p=>p.file.endsWith('/channelFactoryPublication.ts')));
  for(const p of proof.proofs){verifyBytes(p);assert.equal(p.edits.length,10);assert.equal(p.edits.filter(e=>e.reason.includes('exact-source-function')).length,8);assert.equal(p.bindingEvidence.length,2);for(const e of p.bindingEvidence){for(const k of e.preservedLexicals){const found=nodes(tree(read(p.outputFile)).ast,n=>ts.isFunctionDeclaration(n)&&n.name?.text===k.name&&sha(n.getText())===k.sha256);assert.ok(found.length,'preserved actual '+k.name);}
   if(e.domain==='actual-host'){assert.ok(e.actualHookCaller.includes('rows:En'));assert.ok(e.actualHookCaller.includes('authorized:u.frontUser.role'));assert.ok(e.actualHookCaller.includes('onAuthorizationError:u.onAuthorizationError'));}else assert.equal(e.dataLocCount,18);}}
  const hp=json(proof.htmlProofFile);verifyBytes(hp);assert.equal(hp.allNonImportmapBytesUnchanged,true);assert.ok(hp.resolutionProof.length>50);
  const fi=json(O+'/factory-material.json');assert.ok(Object.keys(fi.metafile.inputs).some(k=>k.includes('channelFactoryPublication')));assert.ok(Object.keys(fi.metafile.inputs).some(k=>k.includes('zod')));assert.ok(!Object.keys(fi.metafile.inputs).some(k=>/node_modules\/(react|@trpc|@tanstack)\//.test(k)));
  assert.equal(proof.domainSingletonProof.business.export,'F');assert.equal(proof.domainSingletonProof.personal.export,'V');assert.ok(proof.domainSingletonProof.business.linkText.includes('/api/business-trpc'));assert.ok(proof.domainSingletonProof.business.linkText.includes('x-business-merchant-id'));
 });
 for(const record of manifest.filter(f=>f.kind==='asset'))for(const domain of ['original-data-loc','actual-host']){
  const prefix=record.targetRelative.includes('-0-')?'WB0':'WB1';const label=prefix+'/'+domain;
  let a=active=await fixture(record,domain),{state,host}=a;
  await test(label+':source disabled/price/label + no query until one row selected + original qty/brand snapshot and strict context + native H query options',async()=>{
   const disabled=a.actual.exports[a.evidence.disabled],price=a.actual.exports[a.evidence.price];assert.equal(disabled(row(),true),undefined);assert.ok(disabled({...row(),canPublish:false,isOwner:true,canEdit:true},true));assert.ok(disabled(row(),false));for(const qty of [null,0,-1,1.5,2147483648])assert.ok(disabled({...row(),qty},true));assert.ok(disabled({...row(),brand:' '},true));assert.ok(disabled({...row(),partNumber:'　'},true));assert.ok(disabled({...row(),revision:0},true));assert.ok(disabled({...row(),publicationStatus:'published'},true));assert.equal(price('12.300'),'12.300');for(const p of [null,'0','0.000','-1','001.1','1e2'])assert.equal(price(p),undefined);
   assert.equal(state.reads.length,0);assert.equal(a.client.getQueryCache().getAll().length,0);assert.equal(host.querySelectorAll('[data-factory-publish-action]').length,3);
   state.mode='hold';await a.click('[data-row="42"] [data-factory-publish-action]');assert.equal(state.reads.length,1);assert.equal(state.writes.length,0);assert.deepEqual(state.reads[0].input,{materialId:42,expectedRevision:2,expectedEnterpriseId:9,expectedActorUserId:7});assert.ok(state.reads[0].signal instanceof AbortSignal);assert.ok(host.textContent.includes('正在核验'));assert.equal(host.querySelector('.ci-primary').disabled,true);
   assert.ok(host.querySelector('.ci-publish-preview').textContent.includes('1,200'));assert.ok(host.querySelector('.ci-publish-preview').textContent.includes('TI'));assert.ok(host.querySelector('.ci-publish-preview').textContent.includes('¥12.300'));assert.ok(!host.textContent.includes('伪造列表owner姓名'));assert.ok(!host.textContent.includes('不能回铺客户联系人'));
   const q=a.client.getQueryCache().getAll()[0];assert.equal(q.options.gcTime,0);assert.equal(q.options.staleTime,0);assert.equal(q.options.retry,false);assert.equal(q.options.refetchOnWindowFocus,false);assert.equal(q.options.refetchOnMount,'always');assert.equal(q.options.trpc.abortOnUnmount,true);
   await a.resolve(state.pending.shift(),ready('真实责任员工 李工',11));assert.ok(host.querySelector('[data-factory-reception-preview]').textContent.includes('实际由真实责任员工 李工接待'));assert.equal(host.querySelector('.ci-primary').disabled,false);assert.equal(state.reads.length,1);assert.equal(state.writes.length,0);
  });await a.dispose();
  a=active=await fixture(record,domain);({state,host}=a);
  await test(label+':pending configuration explicit; missing/error/untrusted preview fails closed without owner/contact fallback',async()=>{
   state.previewResult={reception:{status:'pending',recipientName:null,responsibilityVersion:0,reason:'尚未配置真实责任员工'}};await a.click('[data-row="41"] [data-factory-publish-action]');assert.ok(host.textContent.includes('接待待配置：尚未配置真实责任员工'));assert.ok(host.textContent.includes('前台询价不显示投递成功'));assert.ok(!host.textContent.includes('伪造列表owner姓名'));assert.equal(host.querySelector('.ci-primary').disabled,false);await a.click('.ci-icon-close');
   for(const invalid of [{reception:{status:'ready',recipientName:'伪造员工',responsibilityVersion:0}},{reception:{status:'ready',recipientName:'伪造员工',responsibilityVersion:'7'}},{reception:{status:'ready',recipientName:null,responsibilityVersion:7}},{reception:ready().reception,ownerName:'extra'}]){state.previewResult=invalid;await a.click('[data-row="41"] [data-factory-publish-action]');assert.equal(host.querySelector('.ci-primary').disabled,true);assert.ok(host.querySelector('[role="alert"]').textContent.includes('接待证据未能核验'));await a.click('.ci-primary');assert.equal(state.writes.length,0);await a.click('.ci-icon-close');}
   state.previewError=new Error('当前员工绑定未通过核验');await a.click('[data-row="41"] [data-factory-publish-action]');assert.equal(host.querySelector('.ci-primary').disabled,true);assert.ok(host.textContent.includes('不能据此确认询价可投递'));assert.equal(state.writes.length,0);
  });await a.dispose();
  a=active=await fixture(record,domain);({state,host}=a);
  await test(label+':one publish UUID/CAS + success receipt followed by read-only re-preview; no assignment or inquiry mutation',async()=>{
   await a.click('[data-row="41"] [data-factory-publish-action]');await a.click('.ci-primary');assert.equal(state.writes.length,1);const payload=state.writes[0].input;assert.deepEqual(Object.keys(payload).sort(),['expectedActorUserId','expectedEnterpriseId','expectedRevision','materialId','requestId'].sort());assert.equal(payload.expectedEnterpriseId,9);assert.equal(payload.expectedActorUserId,7);assert.match(payload.requestId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);assert.equal(state.completes,1);assert.equal(host.querySelector('[data-row="41"] [data-factory-publish-action]').disabled,true);
   state.previewResult=ready('当前重核验 张工',13);await a.click('[data-row="41"] [data-factory-reception-action]');assert.equal(host.querySelector('h2').textContent,'材料接待预览');assert.equal(host.querySelector('.ci-primary').textContent,'关闭');assert.ok(host.textContent.includes('当前重核验 张工'));assert.ok(host.textContent.includes('已有分工与旧询价不随发布改派'));assert.equal(state.reads.length,2);await a.click('.ci-primary');assert.equal(state.writes.length,1);assert.equal(state.completes,1);assert.ok(!host.querySelector('[role="dialog"]'));assert.ok(state.writes.every(r=>r.path==='channelInventory.publishFactoryMaterial'));
  });await a.dispose();
  a=active=await fixture(record,domain);({state,host}=a);
  await test(label+':initially published readonly and fail-closed row ownership/permission',async()=>{
   await a.render({rows:[{...row(),publicationStatus:'published'}]});assert.equal(state.reads.length,0);assert.equal(host.querySelector('[data-factory-publish-action]').disabled,true);await a.click('[data-factory-reception-action]');assert.equal(host.querySelector('h2').textContent,'材料接待预览');await a.click('.ci-primary');assert.equal(state.writes.length,0);
   await a.render({rows:[{...row(),publicationStatus:'published',canPublish:false,isOwner:true,canEdit:true}]});assert.equal(host.querySelector('[data-factory-reception-action]'),null);await a.render({rows:[row()],authorized:false});assert.equal(host.querySelector('[data-factory-publish-action]').disabled,true);assert.equal(state.writes.length,0);
  });await a.dispose();
  a=active=await fixture(record,domain);({state,host}=a);
  await test(label+':uncertain request busy dedup + locked exact requestId retry and frozen qty/brand source snapshot',async()=>{
   await a.click('[data-row="41"] [data-factory-publish-action]');state.publishMode='hold';await a.click('.ci-primary');await a.click('.ci-primary');assert.equal(state.writes.length,1);const first=clean(state.writes[0].input),pending=state.pending.shift();await React.act(async()=>{pending.reject(new Error('网络提交结果未确认'));await tick();});await a.settle();assert.equal(host.querySelector('.ci-primary').textContent,'按原请求重试');assert.equal(host.querySelector('.ci-icon-close').disabled,true);assert.equal(state.completes,0);
   await a.render({rows:[{...row(),revision:3,brand:'ST',qty:5},row(42),row(43)]});assert.ok(host.querySelector('.ci-publish-preview').textContent.includes('1,200'));assert.ok(host.querySelector('.ci-publish-preview').textContent.includes('TI'));state.publishMode='success';await a.click('.ci-primary');assert.equal(state.writes.length,2);assert.deepEqual(state.writes[1].input,first);assert.equal(state.completes,1);
  });await a.dispose();
  a=active=await fixture(record,domain);({state,host}=a);
  await test(label+':malformed receipt cannot become success and retries exact original UUID/CAS',async()=>{
   await a.click('[data-row="41"] [data-factory-publish-action]');state.publishMode='malformed';await a.click('.ci-primary');assert.equal(state.completes,0);assert.equal(host.querySelector('.ci-primary').textContent,'按原请求重试');state.publishMode='success';await a.click('.ci-primary');assert.deepEqual(state.writes[1].input,state.writes[0].input);assert.equal(state.completes,1);
  });await a.dispose();
  a=active=await fixture(record,domain);({state,host}=a);
  await test(label+':preview abort on enterprise/actor transition + stale evidence never changes new dialog or creates receipt',async()=>{
   state.mode='hold';await a.click('[data-row="41"] [data-factory-publish-action]');const old=state.pending.shift();await a.render({scopeKey:'enterprise10:actor8',context:{expectedEnterpriseId:10,expectedActorUserId:8}});assert.equal(old.rec.signal.aborted,true);assert.equal(host.querySelector('[role="dialog"]'),null);await a.resolve(old,ready('迟到旧企业员工',99));assert.ok(!host.textContent.includes('迟到旧企业员工'));assert.equal(state.completes,0);assert.equal(state.writes.length,0);
   state.mode='ready';state.previewResult=ready('新企业员工',14);await a.click('[data-row="41"] [data-factory-publish-action]');assert.deepEqual(state.reads.at(-1).input,{materialId:41,expectedRevision:2,expectedEnterpriseId:10,expectedActorUserId:8});assert.ok(host.textContent.includes('新企业员工'));assert.ok(!host.textContent.includes('迟到旧企业员工'));
  });await a.dispose();
  a=active=await fixture(record,domain);({state,host}=a);
  await test(label+':late publish cross-enterprise cannot submit/alter receipt/onComplete; fresh permission revocation aborts selected preview',async()=>{
   await a.click('[data-row="41"] [data-factory-publish-action]');state.publishMode='hold';await a.click('.ci-primary');const old=state.pending.shift();await a.render({scopeKey:'enterprise10:actor8',context:{expectedEnterpriseId:10,expectedActorUserId:8}});await a.resolve(old,receipt(old.rec.input));assert.equal(state.completes,0);assert.equal(host.querySelector('[data-row="41"] [data-factory-publish-action]').disabled,false);assert.equal(host.querySelector('[data-row="41"] [data-factory-reception-action]'),null);
   state.mode='hold';await a.click('[data-row="41"] [data-factory-publish-action]');const preview=state.pending.shift();await a.render({rows:[{...row(),canPublish:false},row(42),row(43)],proofReady:true});assert.equal(preview.rec.signal.aborted,true);assert.equal(host.querySelector('[role="dialog"]'),null);assert.equal(state.writes.length,1);assert.equal(state.completes,0);
  });await a.dispose();active=null;
 }
 // Test run does not hide final parent/Layout input changes: stop and rebuild if changed.
 for(const p of proof.allInputPins)assert.equal(sha(fs.readFileSync(p.file)),p.sha256,'INPUT_DRIFT_AFTER_TEST_REBUILD:'+p.file);
 write('actual-material-extractions.json',extractions);
 write('verify-admin-material-results.json',{status:'PASS',tests:results.length,results,candidateFiles:manifest,extractionsFile:O+'/actual-material-extractions.json',actualCapturedBusinessSingleton:'eT / H import F',actualCapturedNativeQueryProvider:true,actualCapturedTRPCHooksAndProvider:true,DIOnly:'One terminating local observable link; no mock material hooks, no mock InventoryConfirmation, no mock management helpers. Existing captured H, native QueryClient and providers are executed.',noProductionOrBrowser:true});
 console.log(JSON.stringify({status:'PASS',tests:results.length}));
}catch(e){console.error(e.stack);write('verify-admin-material-results.json',{status:'FAIL',error:e.stack,results});process.exitCode=1;}finally{if(active)await active.dispose();dom.window.close();}
// Captured production query code owns long GC timers; all test roots/clients are
// already disposed, so end this finite offline runner rather than await those timers.
process.exit(process.exitCode??0);
