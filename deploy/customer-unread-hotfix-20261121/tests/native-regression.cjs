'use strict';
// Offline only: extracts and executes the entire original deployed list function.
// Imported hooks, utilities and JSX/components are explicit mocks; function bytes are unchanged.
// No browser, networking, SSH, Git, source modification or real business calls.
const fs=require('fs');
const vm=require('vm');
const crypto=require('crypto');
const assert=require('assert/strict');
const {createRequire}=require('module');
const req=createRequire('/home/ubuntu/work/channel-release-20261121-1837/manager/package.json');
const ts=req('typescript');
const ROOT='/home/ubuntu/work/customer-unread-hotfix-20261121-2353';
const input=process.argv[2]||`${ROOT}/capture`;
const baseline=process.argv.includes('--baseline');
const report={input,mode:baseline?'baseline expected failure':'candidate full native function',offline:true,limits:['Only parent native list functions execute; imported components are opaque JSX objects.','TRPC and unread hooks are readonly mock responses, not actual backend authorization tests.','Full native useEffect callbacks execute; actual DOM/React renderer does not.'],workbenches:[]};
function extract(wb){
 const file=fs.statSync(input).isDirectory()?`${input}/workbench-${wb}.js`:(wb===1&&process.argv[3]&&!process.argv[3].startsWith('--')?process.argv[3]:input);
 const source=fs.readFileSync(file,'utf8');
 const sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 assert.equal(sf.parseDiagnostics.length,0,'bundle parses');
 const found=[];
 function visit(n,chain=[]){
  if(ts.isFunctionDeclaration(n)&&n.name?.text===(wb===0?'Jw':'vt')&&n.getText(sf).includes('__apUnreadOnly')){
   if(wb===1&&!chain.some(a=>ts.isFunctionDeclaration(a)&&a.name?.text==='__CW_CUSTOMER_LIST_UPDATED_20261116_GET')) throw Error('Reject legacy vt outside actual updated list module');
   found.push({node:n,chain});
  }
  ts.forEachChild(n,c=>visit(c,[...chain,n]));
 }
 visit(sf); assert.equal(found.length,1,'exactly one deployed unread native list');
 const {node,chain}=found[0],text=node.getText(sf),start=node.getStart(sf);
 const localSF=ts.createSourceFile('native.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const line=sf.getLineAndCharacterOfPosition(start).line+1;
 const metadata={file,functionName:node.name.text,byteOffset:Buffer.byteLength(source.slice(0,start)),charOffset:start,line,functionBytes:Buffer.byteLength(text),bundleSHA256:crypto.createHash('sha256').update(source).digest('hex'),functionSHA256:crypto.createHash('sha256').update(text).digest('hex'),module:wb===1?'__CW_CUSTOMER_LIST_UPDATED_20261116_GET':'production top-level Jw',unmodifiedFunction:true};
 const inner=localSF.statements[0];
 // Pull actual adjacent helper literals/functions from the native lexical module (not guessed replacements).
 const block=chain.at(-1),siblings=(block?.statements)||sf.statements;
 const requested=new Set(wb===0?['td','Fp','nd','_d','ql','nc','Rc']:['Te','$t','_t','Ct','st','rt','ue','Be']);
 const actualHelpers=[];
 for(const stmt of siblings){
  if(ts.isVariableStatement(stmt)) for(const d of stmt.declarationList.declarations) if(ts.isIdentifier(d.name)&&requested.has(d.name.text)&&d.initializer) actualHelpers.push(`var ${d.name.text}=${d.initializer.getText(sf)};`);
  if(ts.isFunctionDeclaration(stmt)&&requested.has(stmt.name?.text)) actualHelpers.push(stmt.getText(sf));
 }
 return {text,metadata,helpers:actualHelpers.join('\n'),inner};
}
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const equalDeps=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
class Hooks {
 constructor(){this.slots=[];this.cursor=0;this.pending=[];this.dirty=false;this.remembered=new Map();this.renderCount=0;}
 begin(){this.cursor=0;this.pending=[];this.dirty=false;this.renderCount++;}
 useState=(init)=>{const idx=this.cursor++;if(!this.slots[idx])this.slots[idx]={kind:'state',value:typeof init==='function'?init():init};const s=this.slots[idx];assert.equal(s.kind,'state','hook order');return[s.value,(next)=>{const v=typeof next==='function'?next(s.value):next;if(!Object.is(v,s.value)){s.value=v;this.dirty=true;}}];};
 useRef=(init)=>{const idx=this.cursor++;if(!this.slots[idx])this.slots[idx]={kind:'ref',value:{current:init}};assert.equal(this.slots[idx].kind,'ref');return this.slots[idx].value;};
 useMemo=(fn,deps)=>{const idx=this.cursor++;const old=this.slots[idx];if(old)assert.equal(old.kind,'memo');if(!old||!equalDeps(old.deps,deps))this.slots[idx]={kind:'memo',value:fn(),deps};return this.slots[idx].value;};
 useEffect=(fn,deps)=>{const idx=this.cursor++;const old=this.slots[idx];if(old)assert.equal(old.kind,'effect');if(!old||!equalDeps(old.deps,deps)){this.slots[idx]={kind:'effect',deps,cleanup:old?.cleanup};this.pending.push(()=>{this.slots[idx].cleanup?.();const cleanup=fn();this.slots[idx].cleanup=typeof cleanup==='function'?cleanup:null;});}};
 rememberedState=(key,init)=>{const slot=this.cursor++;if(!this.slots[slot])this.slots[slot]={kind:'remembered',key};assert.equal(this.slots[slot].key,key,'remembered order');if(!this.remembered.has(key))this.remembered.set(key,typeof init==='function'?init():init);return[this.remembered.get(key),(next)=>{const old=this.remembered.get(key),val=typeof next==='function'?next(old):next;if(!Object.is(val,old)){this.remembered.set(key,val);this.dirty=true;}}];};
 commit(){for(const e of this.pending)e();}
 dispose(){for(const s of this.slots)if(s?.kind==='effect')s.cleanup?.();}
}
function jsx(type,props,key){return {__jsx:true,type,props:props||{},key:key??null};}
function nodes(tree){const out=[],seen=new Set();function walk(x){if(!x||typeof x!=='object'||seen.has(x))return;seen.add(x);if(x.__jsx){out.push(x);for(const [k,v] of Object.entries(x.props))if(!['ref'].includes(k)&&typeof v!=='function')walk(v);}else if(Array.isArray(x))x.forEach(walk);}walk(tree);return out;}
function text(tree){if(tree==null||typeof tree==='boolean')return '';if(typeof tree==='string'||typeof tree==='number')return String(tree);if(Array.isArray(tree))return tree.map(text).join('');if(tree.__jsx)return text(tree.props.children)+text(tree.props.actions)+text(tree.props.extra)+text(tree.props.message);return '';}
function checkbox(tree){const all=nodes(tree).filter(x=>(x.props.type==='checkbox'||typeof x.props.onCheckedChange==='function'||x.props.role==='checkbox')&&typeof x.props.checked==='boolean');assert.equal(all.length,1,'exactly one unread checkbox in actual returned JSX');return all[0];}
function check(tree,value){const p=checkbox(tree).props;if(p.onCheckedChange)p.onCheckedChange(value);else {assert.equal(typeof p.onChange,'function');p.onChange({target:{checked:value}});}}
function makeRow(id,enterpriseId=7){return {id,enterpriseId,name:`OFFLINE_CUSTOMER_${id}`,industryCode:'manufacturing',assignedUserId:101,assignedName:'Offline actor',starUserId:null,isStarred:false,archivedAt:null,version:1,grade:'A',stage:'new',contactName:'Offline contact',phone:'000'};}
function success(data){return {data,isSuccess:true,isError:false,isPending:false,isLoading:false,isFetching:false,isPlaceholderData:false,isFetchedAfterMount:true,status:'success'};}
class NativeRun {
 constructor(wb,ex){
  this.wb=wb;this.ex=ex;this.hooks=new Hooks();this.history=[];this.step='init';this.readonlyAudit=[];this.currentAudit=[];this.unreadMode='pending';this.listOverride=null;this.contextOverride=null;this.rowsError=false;this.unreadRetry=0;this.listRetry=0;this.mutationCalls=0;this.lastTree=null;
  this.context=success({enterpriseId:7,actorUserId:101,canManageAll:true,canReadAll:true,canReadEnterprise:true,canReadTeam:false,members:[{userId:101,name:'Offline actor'}],teams:[]});
  this.scope={ready:true,scope:{enterpriseId:7,actorUserId:101},identityKey:'7:101'};
  this.business={merchantId:7,storageScope:'enterprise:7:actor:101',contextVerification:{state:'verified',identity:'enterprise:7:actor:101'},staffPrincipal:{enterpriseId:7,adminAccountId:'offline-admin-7'},frontUser:{id:101}};
  this.supply={identity:{enterpriseId:7,actorUserId:101,key:'7:101'},canRead:true,canWrite:true,failed:false,onAuthorizationError:()=>{},retry:()=>Promise.resolve()};
  this.star={ready:true,failed:false,busy:false,targets:[],blocked:false,canSet:()=>true,observeRows:rows=>this.observedRows=rows.map(r=>r.id),refresh:()=>{},retry:()=>{},toggle:()=>{throw Error('Business mutation forbidden');}};
  const audit=(method,args)=>{const e={step:this.step,method,args:clone(args)};this.readonlyAudit.push(e);this.currentAudit.push(e);};
  const reset=()=>Promise.resolve();
  this.utils={customer:{list:{invalidate:()=>{audit('mock.customer.list.invalidate');return Promise.resolve();},fetch:()=>{throw Error('Unexpected fetch: no real business authorized');}},contactsSummary:{reset},contactsList:{reset}},client:{channelInventory:{customerSupplySummary:{query:async args=>{audit('mock.customerSupplySummary.query',args);return {canWrite:true,items:args.customerIds.map(customerId=>({customerId,canUpload:true,canViewStock:true,channelId:customerId+100,materialCount:2}))};}}}}};
  const prohibited=()=>{this.mutationCalls++;throw Error('Any business/unread mutation prohibited');};
  this.trpc={useUtils:()=>this.utils,customer:{context:{useQuery:()=>this.contextOverride||this.context},list:{useQuery:(input,options)=>{audit('mock.customer.list.useQuery',{input,options});this.listInput=input;this.listOptions=options;let result=this.listOverride;
    if(!result){const unread=Array.isArray(input.customerIds);const data=unread?{items:[makeRow(22),makeRow(24)],total:5}:{items:[makeRow(11),makeRow(12)],total:83};result=success(data);}
    return {...result,refetch:()=>{this.listRetry++;audit('mock.customer.list.refetch');return Promise.resolve(result);}};
  }},contactsSummary:{useQuery:(args,options)=>{audit('mock.customer.contactsSummary.useQuery',{input:args,options});return success({items:[]});}},mutation:prohibited}};
  const NI={useAdminNewInformationContextUnreadRefs:args=>{audit('mock.unreadRefs',args);this.unreadArgs=args;const available=this.unreadMode==='success'||this.unreadMode==='empty';const ids=this.unreadMode==='success'?[22,24,29,30,31]:available?[]:undefined;return {available,customerIds:ids,error:this.unreadMode==='error'?new Error('OFFLINE_UNREAD_FAILURE'):null,retry:()=>{this.unreadRetry++;audit('mock.unreadRefs.retry');this.unreadMode='pending';this.hooks.dirty=true;}};},useAdminNewInformationContextRows:args=>{audit('mock.unreadRows',args);this.rowArgs=args;assert.equal(args.acknowledgeOnVisible,false);assert.equal(args.retainUnreadWhileVisible,false);return {query:{isError:this.rowsError,refetch:()=>{audit('mock.unreadRows.refetch');this.rowsError=false;return Promise.resolve();}},getRow:ref=>({isNew:ref==='customer:22'||ref==='customer:24',ref:()=>{}})};},AdminNewInformationRowBadge:'AdminNewInformationRowBadge',acknowledge:prohibited,clear:prohibited,markRead:prohibited};
  const defaults={keyword:'',grade:'',stage:'',scope:'mine',assignedUserId:'',due:'all',archived:false,starredOnly:false,updatedFrom:'',updatedTo:''};
  const scoped=(scope,args)=>({...args,expectedEnterpriseId:scope.enterpriseId,expectedActorUserId:scope.actorUserId});
  const ctx={console,URLSearchParams,AbortController,document:{activeElement:null,getElementById:()=>null},__NI:NI,__NIUseBusinessScope:()=>this.business,__CC20261118Factory:()=>({verified:(q,ready)=>ready&&q.isSuccess&&!q.isError&&!q.isPlaceholderData,needs:()=>false}),Date,Map,Set,JSON,Number,String,Boolean,Promise,Error};
  if(wb===0)Object.assign(ctx,{fa:()=>true,on:()=>['/customers',()=>{throw Error('Navigation outside offline test');}],ec:()=>'',H:this.trpc,_m:()=>this.scope,Uv:()=>this.supply,c:this.hooks,nh:()=>({scope:this.scope.scope}),_d:{},ah:()=>({completion:null}),ps:this.hooks.rememberedState,$w:()=>this.star,ua:(x)=>x,tb:()=>{},Ra:scoped,td:defaults,Fp:20,nd:'native-test-control',ql:['A','B'],nc:['new'],Rc:{new:'新客户'},e:{jsx,jsxs:jsx,Fragment:'Fragment'},kl:()=> 'Offline industry',$m:x=>x?.value||'',Zw:()=>'',ir:{safeParse:()=>({success:true})},gm:(id,tab)=>`/channels/${id}?tab=${tab}`,Ht:e=>e?.message||String(e),M:{warning:()=>{}}});
  else Object.assign(ctx,{je:()=>true,et:()=>['/customers',()=>{throw Error('Navigation outside offline test');}],tt:()=>'',Y:this.trpc,ct:()=>this.scope,pt:()=>this.supply,M:this.hooks.useState,Ye:()=>({scope:this.scope.scope}),K:this.hooks.useMemo,Ct:{},ze:()=>({completion:null}),O:this.hooks.rememberedState,b:this.hooks.useRef,h:this.hooks.useEffect,de:()=>false,Qe:()=>this.star,Be:()=>null,Te:defaults,$t:20,_t:'native-test-control',st:['A','B'],rt:['new'],ue:{new:'新客户'},Ve:x=>x,qe:()=>{},dt:scoped,z:()=>this.scope.identityKey,we:()=>{},Ee:{warning:()=>{}},t:jsx,n:jsx,Ue:()=> 'Offline industry',lt:x=>x?.value||'',us:()=>'',wt:{safeParse:()=>({success:true})},me:(id,tab)=>`/customers/${id}?tab=${tab}`,ft:(id,tab)=>`/channels/${id}?tab=${tab}`,Me:e=>e?.message||String(e)});
  const components=wb===0?'Zs xa Ba Vs Xs Gs Js as __d51CompactListToolbar ze te Ot Kx dn Ww Ap gs ts la oa _s es ia Je Qw au Xw Vw Xo':'ot yt B bt _ Ze Xe F R A N g pe Je nt Gt xe _e ht Lt Ie I St x at ve mt ut gt';
  for(const name of components.split(' '))if(!(name in ctx))ctx[name]=`component:${name}`;
  if(wb===1)ctx.__cwCustomerListUpdatedLive={
   'client/src/business/platform/shared/crmCustomers#CUSTOMER_GRADES':['A','B','C','D'],
   'client/src/business/platform/shared/crmCustomers#CUSTOMER_STAGE_LABELS':{new:'新线索',following:'跟进中',quoted:'报价中',won:'已成交',paused:'暂缓',invalid:'无效'},
   'client/src/business/platform/shared/crmCustomers#CUSTOMER_STAGES':['new','following','quoted','won','paused','invalid'],
   'client/src/business/platform/client/src/components/customers/customerUtils#EMPTY_CUSTOMER_FORM':{}
  };
  // Explicit VM context rejects unknown globals; no catch-all Proxy/fallback behavior.
  this.vm=vm.createContext(ctx,{name:`offline WB${wb}`});
  // Exact helper initializers from native module are attempted; imported helper data is explicitly mocked above.
  if(ex.helpers){try{vm.runInContext(ex.helpers,this.vm,{timeout:1000});this.actualHelpersExecuted=true;}catch(error){throw Error(`Actual helper eval blocker: ${error.message}`);}}
  this.fn=vm.runInContext(`(${ex.text})`,this.vm,{timeout:1000,filename:ex.metadata.file,lineOffset:ex.metadata.line-1});assert.equal(this.fn.name,ex.metadata.functionName);
 }
 async render(step){this.step=step;this.currentAudit=[];let tree;for(let i=0;i<20;i++){this.hooks.begin();tree=this.fn();assert.ok(tree?.__jsx,'full native list reached original return JSX');this.hooks.commit();await new Promise(r=>setImmediate(r));if(!this.hooks.dirty)break;if(i===19)throw Error('Mock hooks did not settle within 20 full function renders');}this.lastTree=tree;assert.equal(this.mutationCalls,0);return tree;}
 record(step,tree,expected={}){
  const all=nodes(tree),ids=all.filter(x=>x.props['data-page-memory-row']!==undefined).map(x=>Number(x.props['data-page-memory-row']));
  const content=text(tree);const totalMatch=content.match(/共\s*(\d+)\s*条/);const total=totalMatch?Number(totalMatch[1]):null;
  const enabled=Boolean(this.listOptions?.enabled),selected=checkbox(tree).props.checked;
  const rec={step,fullFunctionReturnedJSX:true,noMapException:true,checked:selected,listQueryEnabled:enabled,listInput:clone(this.listInput),rowIds:ids,nativeObservedRows:this.observedRows,unreadRowsInput:clone(this.rowArgs),unreadRefsInput:clone(this.unreadArgs),serverTotalRendered:total,text:content,renderCount:this.hooks.renderCount,mutations:this.mutationCalls,events:clone(this.currentAudit)};
  if(!baseline){
   const group=all.find(x=>x.props.className==='customer-list-filter-actions');
   assert.ok(group,'original native toolbar filter action group exists');
   assert.ok(Array.isArray(group.props.children)&&nodes(group.props.children[0]).includes(checkbox(tree)),'unread control is first native toolbar filter-action child');
   assert.equal(all.some(x=>x.props.className==='customer-list-unread-controls'),false,'old standalone control removed');
   rec.checkboxLocation='first child of original customer-list-filter-actions';
   rec.checkboxHandler=typeof checkbox(tree).props.onChange==='function'?'native onChange event.target.checked':'onCheckedChange';
  }
  if(expected.ids)assert.deepEqual(ids,expected.ids,`${step}: no out-of-scope/cache rows`);
  if('enabled'in expected)assert.equal(enabled,expected.enabled,`${step}: query gate`);
  if('checked'in expected)assert.equal(selected,expected.checked,`${step}: checkbox`);
  if('total'in expected)assert.equal(total,expected.total,`${step}: use original backend total, not local count`);
  if(expected.includes)assert.ok(content.includes(expected.includes),`${step}: expected status text`);
  if(selected)assert.deepEqual(clone(this.listInput.customerIds),this.unreadMode==='success'?[22,24,29,30,31]:[],`${step}: exact ID constraint`);
  else assert.equal(Object.hasOwn(this.listInput,'customerIds'),false,'cancel removes narrowing input');
  assert.deepEqual(clone(this.rowArgs.refs),ids.map(id=>`customer:${id}`),'bad cache rows never reach unread-row hook');
  assert.equal(this.rowArgs.acknowledgeOnVisible,false);assert.equal(this.rowArgs.retainUnreadWhileVisible,false);
  assert.equal(this.listInput.expectedEnterpriseId,7);assert.equal(this.listInput.expectedActorUserId,101);
  assert.equal(this.listOptions.placeholderData,undefined,'no placeholder reuse');
  this.history.push(rec);return rec;
 }
 async suite(){
  this.hooks.remembered.set('page',3);
  let tree=await this.render('unchecked');this.record('unchecked',tree,{checked:false,enabled:true,ids:[11,12],total:83});
  assert.equal(this.listInput.page,3,'native remembered pagination is preserved before toggle');
  check(tree,true);this.listOverride=success({items:[makeRow(11),makeRow(12)],total:83});
  tree=await this.render('checked-pending-stale-cache');this.record('checked-pending-stale-cache',tree,{checked:true,enabled:false,ids:[],includes:'正在核验未读客户'});
  assert.equal(this.listInput.page,1,'actual checkbox handler resets original native page state');
  this.unreadMode='success';this.listOverride={data:undefined,isSuccess:false,isPending:true,isLoading:true,isError:false,isFetching:true,isPlaceholderData:false,isFetchedAfterMount:false};
  tree=await this.render('ids-ready-list-pending');this.record('ids-ready-list-pending',tree,{checked:true,enabled:true,ids:[]});
  this.listOverride=null;tree=await this.render('success');this.record('success',tree,{checked:true,enabled:true,ids:[22,24],total:5});
  // Force an explicit stale/mis-narrowed backend response: not permitted to leak even though query succeeds.
  this.listOverride=success({items:[makeRow(11),makeRow(22)],total:83});
  tree=await this.render('server-narrowing-violation');this.record('server-narrowing-violation',tree,{checked:true,enabled:true,ids:[],includes:'后台未正确限定未读客户'});
  const retries=nodes(tree).filter(x=>typeof x.props.onRetry==='function');assert.equal(retries.length,1);retries[0].props.onRetry();assert.equal(this.unreadRetry,1);assert.equal(this.listRetry,1);
  tree=await this.render('narrowing-retry-pending');this.record('narrowing-retry-pending',tree,{checked:true,enabled:false,ids:[]});
  this.unreadMode='empty';this.listOverride=success({items:[makeRow(22),makeRow(24)],total:5});
  tree=await this.render('true-empty-stale-cache');this.record('true-empty-stale-cache',tree,{checked:true,enabled:false,ids:[],includes:'没有未读客户'});
  this.unreadMode='error';tree=await this.render('unread-failed-stale-cache');this.record('unread-failed-stale-cache',tree,{checked:true,enabled:false,ids:[],includes:'OFFLINE_UNREAD_FAILURE'});
  const errorRetry=nodes(tree).filter(x=>typeof x.props.onRetry==='function');assert.equal(errorRetry.length,1);errorRetry[0].props.onRetry();assert.equal(this.unreadRetry,2);
  tree=await this.render('unread-retry-pending');this.record('unread-retry-pending',tree,{checked:true,enabled:false,ids:[],includes:'正在核验未读客户'});
  this.unreadMode='success';this.listOverride=null;tree=await this.render('retry-success');this.record('retry-success',tree,{checked:true,enabled:true,ids:[22,24],total:5});
  this.rowsError=true;tree=await this.render('unread-row-verification-failure');this.record('unread-row-verification-failure',tree,{checked:true,enabled:true,ids:[22,24],total:5,includes:'未读提醒不会被清除'});
  const badgeRetry=nodes(tree).find(x=>text(x)==='重试未读核验');assert.equal(typeof badgeRetry?.props.onClick,'function');badgeRetry.props.onClick();
  tree=await this.render('unread-row-retry-success');this.record('unread-row-retry-success',tree,{checked:true,enabled:true,ids:[22,24],total:5});
  this.listOverride=success({items:[makeRow(22,999)],total:1});tree=await this.render('foreign-enterprise-result');this.record('foreign-enterprise-result',tree,{checked:true,enabled:true,ids:[]});
  this.listOverride=null;tree=await this.render('foreign-recovery');this.record('foreign-recovery',tree,{checked:true,enabled:true,ids:[22,24],total:5});
  this.listOverride={...success({items:[makeRow(22),makeRow(24)],total:5}),isError:true,isSuccess:false,error:new Error('OFFLINE_LIST_FAILURE')};
  tree=await this.render('list-failure-stale-data');this.record('list-failure-stale-data',tree,{checked:true,enabled:true,ids:[],includes:'OFFLINE_LIST_FAILURE'});
  this.listOverride=null;tree=await this.render('before-cancel');check(tree,false);
  tree=await this.render('cancel');this.record('cancel',tree,{checked:false,enabled:true,ids:[11,12],total:83});
  assert.equal(this.unreadArgs.enabled,false,'cancel stops unread-ID query');assert.equal(this.mutationCalls,0,'no acknowledge/mark-read/clear/business mutations');
  this.hooks.dispose();return this.history;
 }
}
(async()=>{
 let failed=false;
 for(const wb of [0,1]){
  const result={wb};report.workbenches.push(result);let run;
  try{const ex=extract(wb);result.source=ex.metadata;run=new NativeRun(wb,ex);result.helpers=ex.helpers;result.helpersExecuted=run.actualHelpersExecuted;
   if(baseline){let tree=await run.render('baseline-unchecked');run.record('baseline-unchecked',tree,{checked:false,enabled:true,ids:[11,12],total:83});check(tree,true);run.listOverride=success({items:[makeRow(11),makeRow(12)],total:83});let thrown;
    try{await run.render('baseline-checked-pending');}catch(error){thrown=error;}
    assert.ok(thrown&&thrown.name==='TypeError'&&/map/.test(thrown.message),'production baseline expected genuine full-function map TypeError');result.status='EXPECTED_FAILURE_REPRODUCED';result.error={name:thrown.name,message:thrown.message,stack:thrown.stack};result.history=run.history;result.audit=run.readonlyAudit;console.log(`WB${wb} ${ex.metadata.functionName}: EXPECTED FAILURE ${thrown.name}: ${thrown.message}`);
    result.expectedFailures=[{state:'pending',...result.error}];
    for(const mode of ['empty','error','success']){
     const rerun=new NativeRun(wb,ex);
     try{const initial=await rerun.render('baseline-unchecked');check(initial,true);rerun.unreadMode=mode;rerun.listOverride=success({items:[makeRow(11),makeRow(12)],total:83});let error;
      try{await rerun.render(`baseline-${mode}`);}catch(e){error=e;}
      assert.ok(error&&error.name==='TypeError'&&/map/.test(error.message),`baseline ${mode} reproduces native map TypeError`);
      const state=mode==='success'?'server-narrowing-violation':mode;
      result.expectedFailures.push({state,name:error.name,message:error.message,stack:error.stack});
      console.log(`WB${wb} ${ex.metadata.functionName}: EXPECTED FAILURE ${state}: ${error.message}`);
     }finally{rerun.hooks.dispose();}
    }
   }else {result.history=await run.suite();result.status='PASS_FULL_NATIVE_FUNCTION';result.audit=run.readonlyAudit;console.log(`WB${wb} ${ex.metadata.functionName}: PASS ${result.history.length} native JSX-interactive states, ${run.hooks.renderCount} full renders`);}
  }catch(error){failed=true;result.status='FAIL_OR_BLOCKER';result.error={name:error.name,message:error.message,stack:error.stack};if(run){result.history=run.history;result.audit=run.readonlyAudit;}console.error(`WB${wb} FAIL_OR_BLOCKER: ${error.stack}`);}
  finally{run?.hooks.dispose();}
 }
 report.status=failed?'FAIL_OR_BLOCKER':baseline?'EXPECTED_BASELINE_FAILURES_REPRODUCED':'PASS_FULL_NATIVE_FUNCTION';
 const outfile=`${ROOT}/tests/native-${baseline?'baseline':'candidate'}-report.json`;
 fs.writeFileSync(outfile,JSON.stringify(report,null,2)+'\n');console.log(`REPORT ${outfile}`);process.exitCode=failed?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
