#!/usr/bin/env node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import * as icons from 'lucide-react';
import {cva} from 'class-variance-authority';
import {sliceActual,tree,nodes,read,json,write,sha,OUT,LIVE} from './tests/admin-candidate-helper.mjs';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://offline.invalid/workbench/inquiries',pretendToBeVisual:true});
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});
for(const k of ['window','document','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Event','MouseEvent','Node','localStorage','sessionStorage','File','FileReader'])globalThis[k]=dom.window[k];
Object.assign(globalThis,{React,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:fn=>setTimeout(()=>fn(Date.now()),0),cancelAnimationFrame:clearTimeout});
dom.window.HTMLElement.prototype.scrollIntoView=function(){};
const {createRoot}=await import('react-dom/client');
const runtime=sliceActual(read(LIVE+'/assets/20261106-one-click-review-images-v11-admin-4ebf4856da0f/index-demand-navigation-bb20946d992bbfe5.js'),['TS','CS','zS','ql','U0'],{O:React},'captured-react-query.js');
const erp=sliceActual(read(LIVE+'/assets/20261106-one-click-review-images-v11-admin-4ebf4856da0f/erpPermissions-Bcn5P1RI.js'),['s','a','d'],{},'captured-erp.js').exports;
const {TS:QueryClient,CS:QueryClientProvider,zS:useQuery,ql:useQueryClient}=runtime.exports;
const build=json(OUT+'/build-admin-proof.json'),factoryInfo=json(OUT+'/factory-workbench.json');
const results=[],extractions=[];let activeCandidate=null;
const nullUI=()=>null;
const containerUI=({children})=>React.createElement(React.Fragment,null,children);
const conversation={id:11,otherUserId:22,otherUserName:'采购客户',otherUserOriginalName:'采购客户',otherCompanyProfileSupplierId:null,otherUserAvatar:null,isService:false,remarkName:null,lastMessageAt:new Date('2026-11-13T00:00:00Z'),lastMessagePreview:'请确认交期',currentRound:1,endedAt:null,endedByUserId:null,pinned:false,groupName:null,groupIds:[],unreadCount:2};
const rows=[{id:1,inventoryId:null,conversationId:11,buyerName:'采购客户',buyerCompanyName:'真实客户企业',partNumber:'LM358',brand:'TI',quantity:null,status:'open',createdAt:new Date(),lastActivityAt:new Date(),sourceFactoryName:'来源工厂标签',assigneeName:'真实接待员工'},{id:2,conversationId:99,inventoryId:123,buyerName:'他人采购客户',partNumber:'NE555',brand:'TI',quantity:100,status:'replied',createdAt:new Date(),lastActivityAt:new Date()}];
function fixture(){
 const state={search:'',permission:true,owner:false,messagesError:false,reads:[],mutations:[],client:null,contextResult:null,session:null};
 function result(path,input){
  if(path==='enterprise.me')return {isOwner:state.owner,permissionKeys:state.permission?['inquiry.receive']:['inventory.edit']};
  if(path==='enterprise.inquiryInbox')return {rows:input?.page>1?[{...rows[0],id:101,partNumber:'第二页型号',buyerName:'第二页客户'}]:rows,total:101,page:input?.page??1,pageSize:100};
  if(path==='chat.listConversations')return [conversation];
  if(path==='chat.listGroups'||path==='chat.listTrashedGroups')return [];
  if(path==='chat.getMessages'){if(state.messagesError)throw Object.assign(new Error('denied messages'),{data:{businessFailure:'BUSINESS_RESOURCE_FORBIDDEN'}});return {messages:[{id:55,conversationId:11,senderId:22,msgType:'inquiry',content:JSON.stringify({partNumber:'LM358',brand:'TI',qty:null}),createdAt:new Date()},{id:56,conversationId:11,senderId:22,msgType:'text',content:'原会话买方消息',createdAt:new Date()}],peerLastReadMessageId:0};}
  if(path==='publicReview.state')return {status:'not_eligible'};
  if(path==='chat.getTotalUnread')return {total:999};
  if(path==='chat.markRead')return {totalUnread:0};
  if(path==='chat.sendMessage')return {ok:true,message:{id:77,conversationId:input.conversationId,senderId:7,msgType:input.msgType,content:input.content,clientMessageId:input.clientMessageId,createdAt:new Date()}};
  if(path==='chat.uploadAttachment')return {id:66,kind:'file',originalName:'inquiry.pdf',mimeType:'application/pdf',byteSize:3,url:null};
  if(path==='context')return state.contextResult;
  if(path==='merchants')return {data:[{id:30061,companyName:'智捷',canWrite:true}]};
  return undefined;
 }
 const queryKey=(path,input)=>[[...path.split('.')],{input,type:'query'}];
 const proc=path=>new Proxy(Object.create(null),{get(_t,key){
  if(typeof key!=='string')return undefined;
  if(key==='client')return proc('');
  if(key==='useQuery')return (input,options={})=>{
   state.reads.push({kind:'hook',path,input,options});
   if(path==='context')return {data:state.contextResult,isLoading:false,isFetching:false,isError:false,refetch:async()=>result(path,input)};
   if(path==='merchants')return {data:result(path,input),isLoading:false,isFetching:false,isError:false,refetch:async()=>result(path,input)};
   // The domain tRPC surface is DI, but its subscription/cache is the captured native runtime.
   return useQuery({queryKey:queryKey(path,input),queryFn:async()=>{state.reads.push({kind:'request',path,input,options});return result(path,input)??null;},retry:false,...options});
  };
  if(key==='useMutation')return config=>({isPending:false,mutate(input,callbacks){state.mutations.push({path,input});const x=result(path,input);config?.onSuccess?.(x,input);callbacks?.onSuccess?.(x,input);},async mutateAsync(input){state.mutations.push({path,input});const x=result(path,input);await config?.onSuccess?.(x,input);return x;}});
  if(key==='query'||key==='fetch')return async(input,options)=>{state.reads.push({kind:'request',path,input,options});return result(path,input);};
  if(key==='getData')return input=>state.client?.getQueryData(queryKey(path,input));
  if(key==='setData')return (input,updater)=>state.client?.setQueryData(queryKey(path,input),updater);
  if(key==='invalidate')return ()=>state.client?.invalidateQueries({queryKey:[[...path.split('.')]]});
  if(key==='cancel')return ()=>state.client?.cancelQueries({queryKey:[[...path.split('.')]]});
  return proc(path?path+'.'+key:key);
 }});
 const trpc=new Proxy(Object.create(null),{get(_t,key){if(key==='useUtils')return ()=>proc('');if(key==='Provider')return containerUI;if(key==='createClient')return ()=>({fixture:true});return typeof key==='string'?proc(key):undefined;}});
 return {state,trpc,result,queryKey};
}
const principal=(enterpriseId=9,bindingVersion=1)=>({status:'ready',frontendUserId:7,adminAccountId:8,enterpriseId,bindingVersion,user:{id:7,name:'真实接待员工',crmAccess:true}});
const expected=(enterpriseId=9,bindingVersion=1)=>`business-domain:v1:staff:7:admin:8:enterprise:${enterpriseId}:merchant:30061:binding:${bindingVersion}`;
async function createCandidate(url){
 const f=fixture(),text=read(OUT+'/candidate'+url),t=tree(text,'actual-workbench.js');
 const coreNames=new Set(['BusinessScopeProvider','useBusinessScope','useAuth','ChatPage','BusinessContentFrame','MessageBubble','BusinessWorkbenchSession','useBusinessWorkbenchSession','createBusinessRequestCancellation','isBusinessAuthorizationError','isBusinessSecurityError','businessDomainScope','businessContextMatchesMerchant','readyStaffPrincipal','contextCapabilities','contextOfficialInventoryPermissions','hasExactCapability','customerEntryPermissionFingerprint','capabilityProjectionFingerprint','businessAccessFingerprint','verifiedBusinessContext','businessRouteRequirement','useSessionContextRevalidation']);
 const routeUI=new Set(['BusinessUserRecordsPage','CustomerList','MyInventory','ProcurementDemands','DemandQuotes','AddUser','ProcurementOrders','EditInventory','PublishInventory','CompanyInfo','CustomerCreate','InboundManagement','CustomerDemands','CustomerDetail','CrmSalesOrders','BusinessChannelInventoryRoute','UnmatchedBusinessPath','BusinessOutboundRoute','EnterpriseScopedChatPage','EnterpriseChatScopedProviders','InquiryEnterpriseSelectionGate','InquiryEnterpriseMismatchGate','ContactProfileSheet','MallLoginDialog','ImageLightbox']);
 const overrides={c:React,e:jsx,H:f.trpc,oi:f.trpc,zc:erp.a,vg:erp.s,jg:erp.d,Wh:f.trpc,Dx:()=>[['auth','me'],{type:'query'}],Ex:QueryClient,li:QueryClientProvider,__d51IRNativeUseQuery:useQuery,Mx:useQueryClient,Ls:runtime.exports.U0,Tx:cva,Ox:{},Yh:()=>({}),Rx:()=>({}),hf:React.createContext(null),il:null};
 // Explicit DI cutoffs for unrelated imported UI/transport only. Local chat and guards stay actual.
 for(const [k] of t.imports)if(!Object.hasOwn(overrides,k))overrides[k]=icons.X;
 for(const ent of factoryInfo.entries){const k=ent.binding;if(routeUI.has(ent.name))overrides[k]=nullUI;else if(!t.declarations.has(k)&&!Object.hasOwn(overrides,k))overrides[k]=nullUI;}
 Object.assign(overrides,{Tc:({children,href})=>React.createElement('a',{href},children),on:()=>['/inquiries',value=>{f.state.search=value.split('?')[1]??'';}],ec:()=>f.state.search,Oy:undefined,ui:undefined,Qa:undefined,Av:undefined,Zs:undefined,Tv:undefined,Od:value=>{f.state.pageMemory=value;},Ly:containerUI,Uy:containerUI,Vh:containerUI,Gh:containerUI,Ss:({path,component:Comp,children})=>path==='/inquiries'?(Comp?React.createElement(Comp):typeof children==='function'?children():children):null});
 for(const k of ['Oy','ui','Qa','Av','Zs','Tv'])delete overrides[k];
 // Non-core avatars/dialog wrappers are UI fixtures; message bubble itself is original AST.
 Object.assign(overrides,{__d51_ir_legacy_chat:props=>React.createElement('div',{'data-legacy-chat':true},String(props?.fixture??'')),Qo:({name})=>React.createElement('span',{'data-avatar':name},name),Ou:nullUI,uv:nullUI,y0:nullUI,M:{success(){},error(){},info(){}},am:icons.ArrowLeft,pr:icons.Search,di:icons.RefreshCw,vt:icons.X});
 const actual=sliceActual(text,['__d51_ir_w_get','Oy','Qa','Av','Po','QI','VI','Sx','JI','ZI','eP','sP','tP','BusinessReceptionNavigationBadge','_y','zy','_I','Hh'],overrides,'actual-'+url.split('/').at(-1));
 const exp=actual.exports,get=exp.__d51_ir_w_get;assert.equal(get(),get(),'getter singleton');
 assert.equal(get().ChatPageContent, get().ChatPageContent);
 extractions.push(actual.proof);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});f.state.client=client;
 const provider=(key,enterpriseId=9,storageOwner=true,bindingVersion=1,children=React.createElement('div',{'data-consumer':key},key))=>React.createElement(exp.Oy,{key,merchantId:30061,staffPrincipal:principal(enterpriseId,bindingVersion),sessionCapabilities:{receptionReady:true},contextVerificationState:'verified',authorizationVersion:'a1',storageOwner,children});
 async function render(node){await React.act(async()=>{root.render(node);await new Promise(r=>setTimeout(r,30));});}
 async function reception(canReply=true){await render(React.createElement(QueryClientProvider,{client},provider('page',9,true,1,React.createElement(exp.QI,{canReply}))));}
 async function settle(canReply=true){for(let i=0;i<4;i++)await reception(canReply);}
 async function clear(){await render(null);client.clear();f.state.reads.length=0;f.state.mutations.length=0;f.state.search='';f.state.owner=false;f.state.permission=true;f.state.messagesError=false;}
 async function click(label){const b=[...host.querySelectorAll('button')].find(b=>b.textContent.replace(/\s/g,'')===label.replace(/\s/g,''));assert.ok(b,'button:'+label);await React.act(async()=>b.click());}
 async function setInput(node,value){assert.ok(node,'input exists');const p=node.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(node,value);await React.act(async()=>node.dispatchEvent(new Event('input',{bubbles:true})));}
 return {f,text,actual,exp,get,host,root,client,provider,render,reception,settle,clear,click,setInput,async dispose(){await React.act(async()=>root.unmount());exp.zy();client.clear();host.remove();}};
}
async function test(label,fn){console.log('RUN',label);try{await fn();results.push({label,status:'PASS'});write('layout-verification-progress.json',{status:'RUNNING',results});console.log('PASS',label);}catch(e){results.push({label,status:'FAIL',error:e.stack});write('layout-verification-progress.json',{status:'FAIL',results});throw e;}}
const layoutUrl=Object.values(build.relocations).find(x=>x.includes('DashboardLayout')),layoutText=read(OUT+'/candidate'+layoutUrl),layoutTree=tree(layoutText,'actual-layout.js'),layoutProof=build.proofs.find(x=>x.id==='layout');
let layoutRoot=null,layoutHost=null;const moduleCandidates=new Map();
try{
 const expectedTarget=Object.values(build.relocations).filter(x=>x.includes('BusinessWorkbench'))[1];
 for(const url of Object.values(build.relocations).filter(x=>x.includes('BusinessWorkbench'))){
  const candidate=await createCandidate(url);activeCandidate=candidate;moduleCandidates.set(url,candidate);
  await test(url.includes('-0-')?'workbench-0 actual public badge export/factory':'workbench-1 actual public badge export/factory',async()=>{
   const exported=candidate.exp.BusinessReceptionNavigationBadge;
   assert.equal(candidate.get(),candidate.get());
   const pt=tree(candidate.text),publicDecl=pt.declarations.get('BusinessReceptionNavigationBadge');assert.equal(publicDecl.getText(pt.ast),'export function BusinessReceptionNavigationBadge(){return __d51_ir_w_get().BusinessReceptionNavigationBadge()}');
   assert.equal(exported().type,candidate.get().BusinessReceptionNavigationBadge().type);
   candidate.f.state.contextResult={merchant:{id:30061,canWrite:true},enterprise:{id:9},staffPrincipal:principal(),sessionCapabilities:{receptionReady:true},workbenchCapabilities:['inquiry.receive'],writeCapabilities:['inquiry.receive'],authorizationVersion:'a1',officialInventoryPermissions:{read:false,write:false,note:false,authorizationVersion:'a1'}};
   candidate.client.setQueryData([['auth','me'],{type:'query'}],{id:8});
   for(let i=0;i<4;i++)await candidate.render(React.createElement(QueryClientProvider,{client:candidate.client},React.createElement(exported)));
   assert.equal(candidate.host.querySelector('.inquiry-reception-nav-badge')?.textContent,'2');assert.equal(candidate.actual.context.il,null);
   assert.ok(!candidate.f.state.reads.some(x=>x.path==='chat.getTotalUnread'));assert.equal(candidate.f.state.mutations.length,0);
  });
 }
 const active=moduleCandidates.get(expectedTarget);assert.ok(active);activeCandidate=active;
 const importCalls=[],synthetics=new Map(),lazyContext=vm.createContext({c:React,a:jsx});
 const lazyText=layoutProof.edits.find(x=>x.reason==='lazy-badge-original-React-no-eager-module-cycle').text;
 vm.runInContext(lazyText+'\nglobalThis.__lazy=__d51_ir_layout_lazy;globalThis.__badge=__d51_ir_layout_badge;',lazyContext,{filename:'actual-layout-lazy.js',importModuleDynamically:async spec=>{
  importCalls.push(spec);const finalMap=json(OUT+'/html-relocation-proof.json').map;const resolved=finalMap.imports?.[spec]??spec;assert.equal(resolved,expectedTarget,'actual dynamic import URL resolves verified workbench-1 through native importmap');const c=moduleCandidates.get(resolved);assert.ok(c,'only existing actual candidate module allowed');
  let m=synthetics.get(spec);if(!m){m=new vm.SyntheticModule(['BusinessReceptionNavigationBadge'],function(){this.setExport('BusinessReceptionNavigationBadge',c.exp.BusinessReceptionNavigationBadge);},{context:lazyContext,identifier:spec});await m.link(()=>{throw Error('unexpected synthetic dependency');});await m.evaluate();synthetics.set(spec,m);}return m;
 }});
 assert.equal(importCalls.length,0,'factory initialization does not eagerly import');
 const layoutState={location:'/workbench/inquiries?merchantId=30061',caps:['inquiry.receive','inventory.read','customers.manage','crm.sales_orders'],permissions:['messages.read','merchants.read'],navigation:[],reads:[],preloads:[]};
 const nativeLocation=sliceActual(read(LIVE+'/assets/admin-list-location-db1bfac861e62ccff0feefed4e69f00deeb4ac329b22c41164e38f24f589a0f9.js'),['getAdminListLocationLayout'],{},'original-list-location-helper.js');
 const permissionSource=read(LIVE+'/assets/20261106-one-click-review-images-v11-admin-4ebf4856da0f/index-demand-navigation-bb20946d992bbfe5.js'),permissionTree=tree(permissionSource);
 const permissionExport=nodes(permissionTree.ast,ts.isExportSpecifier).find(n=>n.name.text==='h');assert.ok(permissionExport);const permissionName=permissionExport.propertyName?.text??permissionExport.name.text;
 const permissions=sliceActual(permissionSource,[permissionName],{},'original-admin-permission.js');
 const layoutOverrides={};for(const [key] of layoutTree.imports)layoutOverrides[key]=icons.X;
 Object.assign(layoutOverrides,{c:React,a:jsx,E:icons.createLucideIcon,__d51_ir_layout_badge:lazyContext.__badge,__d51ListLocationLayout:nativeLocation.exports.getAdminListLocationLayout,ct:()=>({user:{id:8,name:'管理员',adminRole:'customer_svc',permissions:layoutState.permissions,hasNativeAdminAccount:true},logout(){}}),cn:()=>[layoutState.location,value=>layoutState.navigation.push(value)],dn:()=>'',he:permissions.exports[permissionName],un:()=>true,Ae:chunk=>layoutState.preloads.push(chunk),ln:()=>({isPending:false,isSuccess:true,isError:false,isFetching:false,data:{workbenchCapabilities:layoutState.caps},refetch(){}}),So:()=>false,yo:()=>null,bo:(_from,target)=>target});
 const util={client:{business:{navigation:{query:async()=>({workbenchCapabilities:layoutState.caps})}}},moduleNotification:{summary:{cancel:async()=>{},getData:()=>({counts:{merchants:3}}),setData(){},invalidate(){}}}};
 layoutOverrides.me={useUtils:()=>util,message:{unreadCount:{useQuery:(_input,options)=>{layoutState.reads.push({path:'message.unreadCount',options});return {data:{total:120}};}}},moduleNotification:{summary:{useQuery:(_input,options)=>{layoutState.reads.push({path:'moduleNotification.summary',options});return {data:{counts:{merchants:3,orders:0,reviews:0,portalUsers:0}}};}},markSeen:{useMutation:()=>({mutate(){}})}}};
 for(const key of ['po','mo','ho','Xe','Gn','Vn'])layoutOverrides[key]=containerUI;layoutOverrides.lt=nullUI;layoutOverrides.Po=nullUI;
 const layoutActual=sliceActual(layoutText,['To','Co','_o','__admin_workbench_nav_v1'],layoutOverrides,'actual-patched-layout-render.js');extractions.push(layoutActual.proof,nativeLocation.proof,permissions.proof);
 layoutHost=document.createElement('div');document.body.append(layoutHost);layoutRoot=createRoot(layoutHost);
 async function renderLayout(){await React.act(async()=>{layoutRoot.render(React.createElement(QueryClientProvider,{client:active.client},React.createElement(layoutActual.exports.To,{children:React.createElement('section',{'data-retained-page':true},'原页面')})));await new Promise(r=>setTimeout(r,35));});}
 const primary=()=>layoutHost.querySelector('button[data-workspace-nav-target="inquiries"][data-navigation-level="1"]');
 await test('actual patched To + original WorkspaceTabs standalone primary entry + real lazy module badge',async()=>{
  for(let i=0;i<4;i++)await renderLayout();assert.ok(primary());assert.equal(primary().getAttribute('data-active'),'true');assert.equal(primary().getAttribute('aria-current'),'page');assert.equal(primary().querySelector('.inquiry-reception-nav-badge')?.textContent,'2');
  assert.equal(importCalls.length,1);assert.equal(lazyContext.__lazy._payload._result.default,active.exp.BusinessReceptionNavigationBadge,'React.lazy resolved default is actual verified export function');
  assert.ok(layoutHost.querySelector('[data-retained-page]'));assert.ok(!layoutHost.querySelector('button[data-workspace-dropdown-item="/workbench/inquiries"]'));
  assert.deepEqual([...layoutHost.querySelectorAll('[data-admin-navigation="current-location"] li')].map(n=>n.textContent),['询价接待']);assert.equal(active.actual.context.il,null);assert.ok(!active.f.state.reads.some(x=>x.path==='chat.getTotalUnread'));
 });
 await test('actual primary click invokes original authorized router exactly once; preload remains original',async()=>{
  const navs=layoutState.navigation.length;await React.act(async()=>primary().click());assert.equal(layoutState.navigation.length,navs+1);assert.equal(layoutState.navigation.at(-1),'/workbench/inquiries');
  const p=layoutState.preloads.length;await React.act(async()=>primary().focus());assert.equal(layoutState.preloads.length,p,'inquiry has no chunk; no synthesized preload or query');
 });
 await test('actual old chat deep link canonical primary active + inquiry-only current location',async()=>{
  layoutState.location='/workbench/chat?conversationId=11#retained';for(let i=0;i<2;i++)await renderLayout();assert.equal(primary().getAttribute('aria-current'),'page');assert.deepEqual([...layoutHost.querySelectorAll('[data-admin-navigation="current-location"] li')].map(n=>n.textContent),['询价接待']);assert.equal(layoutHost.querySelector('[data-workspace-nav-target="business"]')?.getAttribute('data-active'),'false');
 });
 await test('actual preserved business sales dropdown has orders only, no inquiry; original R notification/messages fallback',async()=>{
  layoutState.location='/workbench/orders';await renderLayout();const business=layoutHost.querySelector('[data-workspace-nav-target="business"]');assert.ok(business);await React.act(async()=>business.click());
  const sales=layoutHost.querySelector('[data-workspace-group="customers"]');assert.ok(sales);assert.ok(sales.textContent.includes('销售管理'));assert.ok(!sales.textContent.includes('询价'));await React.act(async()=>sales.click());assert.ok(layoutHost.querySelector('[data-workspace-dropdown-item="/workbench/orders"]'));assert.equal(layoutHost.querySelectorAll('[data-workspace-dropdown-item="/workbench/inquiries"]').length,0);
  layoutState.location='/messages';await renderLayout();await React.act(async()=>layoutHost.querySelector('[data-workspace-nav-target="operations"]').click());const transactions=layoutHost.querySelector('[data-workspace-group="transactions-services"]');assert.ok(transactions);await React.act(async()=>transactions.click());assert.equal(layoutHost.querySelector('[data-workspace-dropdown-item="/messages"]')?.querySelector('span')?.textContent,'99+');
  const basic=layoutHost.querySelector('[data-workspace-group="basic-data"]');await React.act(async()=>basic.click());assert.equal(layoutHost.querySelector('[data-workspace-dropdown-item="/merchants"]')?.querySelector('span')?.textContent,'3');
 });
 await test('actual parent permission/capability snapshot cannot synthesize hidden inquiry or leave stale menu/location',async()=>{
  layoutState.caps=['inventory.read','crm.sales_orders'];layoutState.location='/workbench/inquiries';await renderLayout();assert.equal(primary(),null);assert.equal(layoutHost.querySelector('[data-admin-navigation="current-location"]'),null);assert.equal(layoutHost.querySelector('[data-workspace-dropdown="layer"]'),null);
  layoutState.caps=['inquiry.receive'];layoutState.permissions=[];for(let i=0;i<2;i++)await renderLayout();assert.ok(primary());assert.equal(layoutHost.querySelector('[data-workspace-nav-target="business"]'),null);
 });
 await test('candidate CSS exactly scoped appended original red badge rule matches actual navigation DOM',async()=>{
  for(let i=0;i<4;i++)await renderLayout();assert.ok(primary().querySelector('.inquiry-reception-nav-badge'));
  const proof=json(OUT+'/navigation-css-proof.json'),css=read(OUT+'/candidate'+proof.candidateCSSUrl);assert.equal(sha(css),proof.candidateCSSSha256);assert.ok(css.endsWith(proof.compiledSelector));assert.equal(sha(css.slice(0,-proof.compiledSelector.length)),proof.receptionCSSSha256);
  const style=document.createElement('style');style.textContent=css;document.head.append(style);const badge=primary().querySelector('.inquiry-reception-nav-badge');const rules=[...style.sheet.cssRules].filter(rule=>rule.selectorText?.includes('.inquiry-reception-nav-badge'));assert.equal(rules.length,1);assert.ok(badge.matches(rules[0].selectorText),'actual Layout badge CSS selector coverage');
  const computed=window.getComputedStyle(badge);assert.equal(computed.display,'inline-flex');assert.equal(computed.height,'18px');assert.equal(computed.backgroundColor,'rgb(211, 47, 47)');assert.equal(computed.color,'rgb(255, 255, 255)');style.remove();
 });
 write('layout-verification.json',{status:'PASS',offlineOnly:true,verification:'Actual patched To and original embedded WorkspaceTabs/AdminWorkspaceLocation AST with real installed React.lazy/Suspense, actual dynamic import callback to matching captured candidate public export; original captured QueryClient/useQuery and permission/location helpers, jsdom, transport/unrelated UI DI. No source fixture.',results,layoutSha256:sha(layoutText),layoutUrl,lazyTarget:expectedTarget,lazyImportCalls:importCalls,coreModuleHashes:[...moduleCandidates].map(([url,c])=>({url,sha256:sha(c.text)})),runtimeExtraction:runtime.proof,candidateExtractions:extractions});
}catch(e){write('layout-verification.json',{status:'FAIL',offlineOnly:true,results,error:e.stack,layoutUrl,layoutSha256:sha(layoutText),candidateExtractions:extractions});console.error(e.stack);process.exitCode=1;}
finally{if(layoutRoot)await React.act(async()=>layoutRoot.unmount());for(const candidate of moduleCandidates.values())await candidate.dispose();dom.window.close();}
process.exit(process.exitCode??0);
