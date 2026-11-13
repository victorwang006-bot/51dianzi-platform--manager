#!/usr/bin/env node
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import * as icons from 'lucide-react';
import {cva} from 'class-variance-authority';
import {sliceActual,tree,read,json,write,sha,OUT,LIVE} from './tests/admin-candidate-helper.mjs';
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
async function test(label,fn){try{await fn();results.push({label,status:'PASS'});console.log('PASS',label);}catch(e){results.push({label,status:'FAIL',error:e.stack});console.error('FAIL',label,e.stack);throw e;}}
try{
 for(const url of Object.values(build.relocations).filter(x=>x.includes('BusinessWorkbench'))){
  const a=await createCandidate(url),{f,exp,host,client}=a;activeCandidate=a;const prefix=url.includes('-0-')?'workbench-0':'workbench-1';
  await test(prefix+':actual queue all pages + three panes + real lucide SVG',async()=>{await a.settle();assert.equal(host.querySelectorAll('.inquiry-reception__item').length,2);assert.ok(host.textContent.includes('真实客户企业'));assert.ok(!host.textContent.includes('他人采购客户'));assert.ok(host.textContent.includes('数量待确认'));assert.equal(f.state.mutations.length,0);assert.ok(f.state.reads.some(x=>x.path==='enterprise.inquiryInbox'&&x.input?.page===2));assert.ok(host.querySelector('.inquiry-reception__queue'));assert.ok(host.querySelector('.inquiry-reception__summary'));assert.ok(host.querySelector('.inquiry-reception__conversation'));assert.ok(host.querySelector('svg.lucide-volume-x'));await a.click('提示音关');assert.ok(host.querySelector('svg.lucide-volume2'));assert.equal(host.querySelector('h1'),null);await a.setInput(host.querySelector('[aria-label="搜索客户或型号"]'),'第二页型号');assert.equal(host.querySelectorAll('.inquiry-reception__item').length,1);});
  await a.clear();
  await test(prefix+':original Av/Po + Tv messages + same conversation reply and attachment',async()=>{f.state.search='conversationId=11';await a.settle();assert.ok(host.textContent.includes('原会话买方消息'));assert.ok(host.querySelector('svg.lucide-info'));assert.ok(host.querySelector('[data-testid="chat-message-row"]'));assert.ok(host.querySelector('[data-reception-conversation="11"]'));assert.ok(f.state.mutations.some(x=>x.path==='chat.markRead'&&x.input.conversationId===11));await a.setInput(host.querySelector('textarea'),'接待同一会话回复');await a.click('发送');assert.ok(f.state.mutations.some(x=>x.path==='chat.sendMessage'&&x.input.conversationId===11&&x.input.content==='接待同一会话回复'));const fi=host.querySelector('input[type="file"][accept^=".pdf"]');assert.ok(fi);Object.defineProperty(fi,'files',{configurable:true,value:[new File(['PDF'],'inquiry.pdf',{type:'application/pdf'})]});await React.act(async()=>{fi.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,40));});assert.ok(f.state.mutations.some(x=>x.path==='chat.uploadAttachment'&&x.input.conversationId===11));assert.ok(f.state.mutations.some(x=>x.path==='chat.sendMessage'&&x.input.msgType==='file'&&x.input.conversationId===11));assert.ok(!host.textContent.includes('发报价单'));assert.ok(!host.textContent.includes('新建分组'));assert.ok(!f.state.reads.some(x=>['chat.getServiceUser','forum.unreadState','enterprise.myInvitations'].includes(x.path)&&x.options?.enabled));assert.ok(!f.state.mutations.some(x=>['chat.getOrCreateConversation','chat.startInventoryInquiry'].includes(x.path)));});
  await a.clear();
  await test(prefix+':authorized readonly messages, no reply/attachment',async()=>{f.state.search='conversationId=11';await a.settle(false);assert.ok(host.textContent.includes('原会话买方消息'));assert.equal(host.querySelector('textarea').disabled,true);assert.ok(host.textContent.includes('当前企业范围仅可查看接待'));assert.ok(!f.state.mutations.some(x=>['chat.sendMessage','chat.uploadAttachment'].includes(x.path)));});
  await a.clear();
  await test(prefix+':supervision never reads others or markRead',async()=>{f.state.owner=true;f.state.search='conversationId=99';await a.settle();const sel=host.querySelector('[aria-label="接待查看范围"]');assert.ok(sel);await React.act(async()=>{sel.value='team';sel.dispatchEvent(new Event('change',{bubbles:true}));});await a.settle();assert.ok(host.textContent.includes('他人采购客户'));assert.ok(host.textContent.includes('监督查看不会成为参与人'));assert.equal(host.querySelector('textarea'),null);assert.ok(!f.state.reads.some(x=>x.path==='chat.getMessages'&&x.input?.conversationId===99));assert.equal(f.state.mutations.length,0);});
  await a.clear();
  await test(prefix+':inventory grants cannot receive and failed messages never markRead',async()=>{f.state.permission=false;await a.settle();assert.ok(host.textContent.includes('库存权限不能代替'));assert.equal(host.querySelector('textarea'),null);await a.clear();f.state.messagesError=true;f.state.search='conversationId=11&merchantId=30061';await a.settle();assert.ok(host.textContent.includes('消息加载失败'));assert.ok(!f.state.mutations.some(x=>x.path==='chat.markRead'));await a.click('返回队列');await a.settle();assert.equal(f.state.search,'merchantId=30061');});
  await a.clear();
  await test(prefix+':actual Oy scope owner survives either provider, observer never owns, final clears',async()=>{await a.render([a.provider('page'),a.provider('second')]);assert.equal(a.actual.context.il,expected());assert.equal(f.state.pageMemory,expected());await a.render([a.provider('page')]);assert.equal(a.actual.context.il,expected());assert.equal(f.state.pageMemory,expected());await a.render([]);assert.equal(a.actual.context.il,null);assert.equal(f.state.pageMemory,null);await a.render([a.provider('page'),a.provider('second')]);await a.render([a.provider('second')]);assert.equal(a.actual.context.il,expected());await a.render([a.provider('observer',88,false)]);assert.equal(a.actual.context.il,null);assert.equal(f.state.pageMemory,null);await a.render([a.provider('page'),a.provider('observer',88,false)]);assert.equal(a.actual.context.il,expected());await a.render([a.provider('observer',88,false)]);assert.equal(a.actual.context.il,null);await a.render([a.provider('old',9),a.provider('current',10,true,2)]);assert.equal(a.actual.context.il,expected(10,2));await a.render([a.provider('old',9)]);assert.equal(a.actual.context.il,null);});
  await a.clear();
  await test(prefix+':actual native query cache subscription + authorized unread source',async()=>{await a.render(React.createElement(QueryClientProvider,{client},a.provider('nav',9,false,1,React.createElement(a.get().ReceptionNavigationUnread))));await a.render(React.createElement(QueryClientProvider,{client},a.provider('nav',9,false,1,React.createElement(a.get().ReceptionNavigationUnread))));assert.equal(host.querySelector('.inquiry-reception-nav-badge').textContent,'2');assert.equal(a.actual.context.il,null);assert.ok(!f.state.reads.some(x=>x.path==='chat.getTotalUnread'));await React.act(async()=>{client.setQueryData(f.queryKey('chat.listConversations',undefined),[{...conversation,unreadCount:120}]);await new Promise(r=>setTimeout(r,20));});assert.equal(host.querySelector('.inquiry-reception-nav-badge').textContent,'99+');await a.render(React.createElement(QueryClientProvider,{client},React.createElement(exp.Oy,{merchantId:30061,staffPrincipal:principal(),sessionCapabilities:{receptionReady:false},contextVerificationState:'verified',storageOwner:false},React.createElement(a.get().ReceptionNavigationUnread))));assert.equal(host.querySelector('.inquiry-reception-nav-badge'),null);});
  await a.clear();
  await a.clear();
  await test(prefix+':actual discovery/context/domain guards share query consumers; final cancel only',async()=>{
   f.state.contextResult={merchant:{id:30061,canWrite:true},enterprise:{id:9},staffPrincipal:principal(),sessionCapabilities:{receptionReady:true},workbenchCapabilities:['inquiry.receive'],writeCapabilities:['inquiry.receive'],authorizationVersion:'a1',officialInventoryPermissions:{read:false,write:false,note:false,authorizationVersion:'a1'}};
   client.setQueryData([['auth','me'],{type:'query'}],{id:8});
   const Capture=()=>{f.state.session=exp._y().session;return null;};
   const pair=(page=true,badge=true)=>React.createElement(QueryClientProvider,{client},[React.createElement(Capture,{key:'capture'}),page?React.createElement(exp.sP,{key:'page'}):null,badge?React.createElement(exp.BusinessReceptionNavigationBadge,{key:'badge'}):null]);
   for(let i=0;i<4;i++)await a.render(pair());
   const session=f.state.session;assert.ok(session);assert.ok(session.authorization);assert.equal(session.authorization,exp._I(30061,f.state.contextResult,8).verifiedBranchKey);
   const resources=session.domainResources(session.authorization);f.state.client=resources.client;
   assert.ok(host.querySelector('[data-inquiry-reception]'));assert.ok(host.querySelector('.inquiry-reception-nav-badge'));assert.equal(a.actual.context.il,expected());
   const counts=new Map();for(const qc of [session.discovery,session.context,resources.client]){counts.set(qc,0);const orig=qc.cancelQueries.bind(qc);qc.cancelQueries=(...args)=>{counts.set(qc,counts.get(qc)+1);return orig(...args);};}
   await a.render(pair(true,false));for(const qc of counts.keys())assert.equal(counts.get(qc),0,'badge leave does not cancel');assert.equal(a.actual.context.il,expected());
   await a.render(pair(true,true));await a.render(pair(false,true));for(const qc of counts.keys())assert.equal(counts.get(qc),0,'page leave does not cancel observer');assert.equal(a.actual.context.il,null);assert.ok(host.querySelector('.inquiry-reception-nav-badge'));
   await a.render(pair(false,false));for(const qc of counts.keys())assert.equal(counts.get(qc),1,'last consumer cancels once');
   await a.render(pair(true,true));assert.equal(a.actual.context.il,expected());
   resources.client.setQueryData(['sensitive-before-revoke'],{secret:'old-enterprise'});
   await React.act(async()=>{session.onAuthorizationError({data:{businessFailure:'BUSINESS_RESOURCE_FORBIDDEN'}});});assert.equal(session.denied,false,'resource refusal is not session revocation');
   await React.act(async()=>{session.onAuthorizationError({data:{businessFailure:'STAFF_BINDING_INVALID'}});await new Promise(r=>setTimeout(r,15));});
   assert.equal(session.denied,true);assert.equal(session.authorization,null);assert.equal(resources.abort.signal.aborted,true);assert.equal(resources.client.getQueryCache().getAll().length,0);assert.equal(session.context.getQueryCache().getAll().length,0);assert.equal(session.discovery.getQueryCache().getAll().length,0);assert.equal(a.actual.context.il,null);assert.equal(host.querySelector('[data-inquiry-reception]'),null);assert.equal(host.querySelector('.inquiry-reception-nav-badge'),null);assert.equal(host.querySelectorAll('h1').length,1,'only page refusal renders, observer emits nothing');
   await a.render(React.createElement(QueryClientProvider,{client},React.createElement(exp.BusinessReceptionNavigationBadge)));assert.equal(host.textContent,'','denied standalone observer is silent');
   f.state.client=client;
  });
  await a.clear();
  await test(prefix+':actual Po retains personal fallback and inquiry gate fails closed',async()=>{
   await a.render(React.createElement(exp.Po,{fixture:'personal-preserved'}));assert.equal(host.querySelector('[data-legacy-chat]').textContent,'personal-preserved');
   await a.render(React.createElement(exp.Oy,{merchantId:30061,staffPrincipal:principal(),sessionCapabilities:{receptionReady:false},contextVerificationState:'verified'},React.createElement(exp.QI,{canReply:true})));assert.ok(host.textContent.includes('企业接待尚未完成安全就绪'));assert.equal(host.querySelector('textarea'),null);
  });
  await a.dispose();activeCandidate=null;
 }
 write('runtime-verification.json',{status:'PASS',offlineOnly:true,verification:'Actual candidate AST getters/wrappers with captured original TS QueryClient, CS provider, zS/_o/Ll native useQuery; installed React + jsdom, DI tRPC transport and unrelated UI.',candidateRelocations:build.relocations,results,runtimeExtraction:runtime.proof,candidateExtractions:extractions});
}catch(e){write('runtime-verification.json',{status:'FAIL',offlineOnly:true,results,runtimeExtraction:runtime.proof,candidateExtractions:extractions,error:e.stack});process.exitCode=1;}
finally{if(activeCandidate)await activeCandidate.dispose();dom.window.close();}

// Captured application runtime owns retained background query timers; this is a finite offline CLI.
process.exit(process.exitCode ?? 0);
