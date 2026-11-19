import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import ts from 'typescript';
import {JSDOM} from 'jsdom';
import React, {act} from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as XLSX from 'xlsx';
const BASE=process.env.UPLOAD_COMPACT_DIR??'/home/ubuntu/work/upload-compact';
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'https://offline.invalid/',pretendToBeVisual:true});
const w=dom.window;
for(const k of ['window','document','sessionStorage','localStorage','File','Blob','Event','MouseEvent','HTMLElement','HTMLInputElement','HTMLSelectElement'])Object.defineProperty(globalThis,k,{value:k==='window'?w:k==='document'?w.document:w[k],configurable:true});
Object.defineProperty(globalThis,'navigator',{value:w.navigator,configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const forbidden=()=>{throw Error('REAL_NETWORK_OR_WRITE_FORBIDDEN');};globalThis.fetch=forbidden;w.fetch=forbidden;globalThis.XMLHttpRequest=class{constructor(){forbidden();}};
w.confirm=()=>true;globalThis.confirm=w.confirm;
w.File.prototype.arrayBuffer=function(){return new Promise((resolve,reject)=>{const r=new w.FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsArrayBuffer(this);});};
const {createRoot}=await import('react-dom/client');
const passes=[];
const identity={enterpriseId:31,actorUserId:7,key:'offline-user-7'};
const hid='409817e6-fed8-4e92-b12d-e9cb5013b563';
const fileId='aaa817e6-fed8-4e92-b12d-e9cb5013b563';
let calls=[],getAllowed=true,listBusy=false;
let detailReplies=[];
let reconcileReply=null;
const history=()=>({historyId:hid,customerId:801,customerName:'匿名客户',mode:'standard',state:'awaiting_confirmation',revision:1,latestVersionId:null,latestVersionNo:0,createdAt:'2026-11-19T09:12:41.000Z',originalFile:{fileId,fileName:'原物料.xlsx',byteSize:111,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',sha256:'a'.repeat(64)},uploadedBy:{frontUserId:7,displayName:'匿名上传人'},stats:{sourceRowCount:6,resultRowCount:0,successCount:0,pendingCount:0,unknownCount:0,excludedCount:0,remainingMaterialCount:null},capabilities:{canDownload:true,canConfirm:getAllowed,canManage:false,canCancel:false,canUploadResult:false}});
const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['型号','品牌','数量','DC'],['ONE','TI',4000,'24+'],['TWO','ADI',20,'25+']]),'首表');const bytes=XLSX.write(wb,{type:'array',bookType:'xlsx'});
const rpc={
 customerUploadHistoryList:{query:async input=>{calls.push(['list',input]);if(listBusy)await new Promise(r=>setTimeout(r,20));return {items:[history()],nextCursor:null,canManage:false};}},
 customerUploadHistoryGet:{query:async input=>{calls.push(['get',input]);return detailReplies.length?detailReplies.shift():{history:history(),originalSheets:[],versions:[],selectedVersion:null,confirmation:null};}},
 customerUploadDownload:{mutate:async input=>{calls.push(['download',input]);return {fileName:'原物料.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',byteSize:bytes.byteLength,base64:Buffer.from(bytes).toString('base64')};}},
 customerSupplyContext:{query:async input=>{calls.push(['context',input]);return {customer:{id:801,name:'匿名客户',version:1,archivedAt:null,industryCode:'electronic_components'},channel:{id:11,name:'原客户来源',active:true,revision:1},canUpload:true};}},
 customerUploadReconcileBatch:{mutate:async input=>{calls.push(['reconcile',input]);return reconcileReply??{};}}
};
const trpc={customerDemand:{suggestPartNumbers:{useQuery:()=>({data:[],isFetching:false,isError:false})}},useUtils:()=>({client:{channelInventory:new Proxy(rpc,{get:(target,key)=>key in target?target[key]:{query:forbidden,mutate:forbidden}})},channelInventory:new Proxy({},{get:()=>({invalidate:async()=>{}})})})};
const div=({children,className,style,...p})=>React.createElement('div',{className,style,...Object.fromEntries(Object.entries(p).filter(([k])=>k.startsWith('data-')||k.startsWith('aria-')))},children);
const button=({children,variant,size,className,...p})=>React.createElement('button',{className,...p},children);
const bridge=new Proxy({React,jsx:jsxRuntime,bridge_0_trpc:trpc,bridge_2_useLocation:()=>['/',()=>{}],bridge_21_Button:button,bridge_3_useBusinessScope:()=>({storageScope:'offline',officialInventoryPermissions:{note:false,read:true,write:true}}),bridge_7_useAuth:()=>({}),bridge_8_useOptionalEnterpriseSession:()=>null},{get:(target,key)=>key in target?target[key]:div});
function factory(file){
 const text=fs.readFileSync(file,'utf8'),a=ts.createSourceFile('actual.js',text,99,true,1);assert.equal(a.parseDiagnostics.length,0);let found=[];
 function scan(n){if(ts.isVariableDeclaration(n)&&n.name?.text==='__CHANNEL_REFERENCE_HOST_EXPORTS')found.push(n);ts.forEachChild(n,scan);}scan(a);assert.equal(found.length,1);
 const code=found[0].initializer.getText(a);assert.equal(code.split('return i2(q3);').length,2);
 const testCode=code.replace('return i2(q3);','return {BatchUpload:T6,HistorySession:z3,Supply:jf};');
 const cap=new Function('__customerLive',`return ${testCode};`)(bridge);
 return {cap,sha256:H(text),factorySha256:H(code),seam:'only native factory return exposed for offline test; native lexical helpers/SheetJS/queue/schemas unchanged'};
}
const mount=document.getElementById('root');let root=createRoot(mount);
const settle=async()=>{await act(async()=>{await new Promise(r=>setTimeout(r,35));});};
const render=async(comp,props)=>{await act(async()=>root.render(React.createElement(comp,props)));await settle();};
const click=async name=>{const n=[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===name);assert(n&&!n.disabled,`enabled button: ${name}`);await act(async()=>n.dispatchEvent(new w.MouseEvent('click',{bubbles:true})));await settle();};
const choose=async(label,value)=>{const n=document.querySelector(`[aria-label="${label}"]`);assert(n);await act(async()=>{Object.getOwnPropertyDescriptor(w.HTMLSelectElement.prototype,'value').set.call(n,value);n.dispatchEvent(new w.Event('change',{bubbles:true}));});await settle();};
const close=async()=>{await act(async()=>root.unmount());sessionStorage.clear();mount.replaceChildren();root=createRoot(mount);};
const modules=JSON.parse(fs.readFileSync(BASE+'/modules.json'));
for(const module of modules){
 const actual=factory(BASE+'/package/'+module.after),cap=actual.cap;calls=[];
 let confirmation;
 const batchProps={channels:[{id:11,name:'原客户来源',active:true}],channelTotal:1,initialChannelId:11,enterpriseId:31,actorUserId:7,fixedSource:true,sourceLabel:'匿名客户',customerSourceReady:true,storageKeySuffix:'offline-native',dialogMode:'content',onClose:()=>{},onComplete:()=>{},isCurrent:()=>true,onDirtyChange:()=>{},onBusyChange:()=>{},onLoadMoreChannels:()=>{},loadingMoreChannels:false,onOriginalFilePersist:async()=>({sessionData:{history:{historyId:hid}},rows:[2,3].map(row=>({row,metadata:{logicalRowId:crypto.randomUUID(),rowId:crypto.randomUUID(),sourceRefs:[{sheetIndex:0,sheetName:'首表',rowNumber:row,originalRowHash:'b'.repeat(64)}],issues:[]}}))}),onCreateCustomerBatch:async(input,c)=>{calls.push(['prepare',input]);confirmation=c;return {id:81,channelId:11,batchCode:crypto.randomUUID(),revision:1};},onCreate:async(payload,requestId,id)=>{calls.push(['create',payload,requestId,id]);return {idempotent:false};},renderSingleEntry:()=>null,renderParseEntry:()=>{throw Error('PARSING_MUST_NOT_START_AUTOMATICALLY');}};
 await render(cap.BatchUpload,batchProps);
 const file=new w.File([bytes],'原物料.xlsx');Object.defineProperty(file,'arrayBuffer',{value:async()=>bytes});const input=document.querySelector('[aria-label="上传库存表格"]');assert(input);Object.defineProperty(input,'files',{value:[file],configurable:true});await act(async()=>input.dispatchEvent(new w.Event('change',{bubbles:true})));await settle();
 assert(document.querySelector('.ci-batch-preview'),'actual native SheetJS leads straight to preview');assert(!document.body.textContent.includes('预览并校验'),'no forced mapping step');
 let submit=[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='确认导入 2 条');assert(submit?.disabled,'currency not guessed');assert.equal(document.querySelector('[aria-label="明确确认本次核对币种为CNY"]').tagName,'SELECT');
 await choose('明确确认本次核对币种为CNY','CNY');await click('确认导入 2 条');assert.equal(calls.filter(x=>x[0]==='create').length,2);assert.equal(confirmation.confirmedDrafts[0].draft.dateCode,'24+');assert.equal(confirmation.confirmedDrafts[0].draft.currency,'CNY');assert.equal(calls.find(x=>x[0]==='create')[2],confirmation.confirmedDrafts[0].rowRequestId);assert(document.querySelector('.ci-batch-result')?.textContent.includes('2 / 2'),'result uses actual local callback receipts');
 passes.push({case:'native spreadsheet→review→explicit CNY→original queue receipts',...actual,module:module.after,cap:undefined});await close();
 calls=[];getAllowed=true;
 await render(cap.HistorySession,{customerId:801,identity,isCurrent:()=>true,onClose:()=>{},onComplete:()=>{},onAuthorizationError:e=>{throw e;}});
 assert(document.body.textContent.includes('待核对'),'unprepared standard task pending review');assert(!document.querySelector('tbody')?.textContent.includes(hid),'full UUID removed from list');assert(!document.querySelector('tbody')?.textContent.includes('成功0'),'no zero-success misleading statistics');
 await click('继续导入');assert.deepEqual(calls.find(c=>c[0]==='get')[1],{expectedEnterpriseId:31,expectedActorUserId:7,historyId:hid});assert.equal(calls.find(c=>c[0]==='download')[1].files[0].historyId,hid);assert(!calls.some(c=>['prepare','create'].includes(c[0])),'history continue only opens original evidence, does not write inventory');
 passes.push({case:'native history direct authorized original-task continuation',module:module.after,sha256:actual.sha256,factorySha256:actual.factorySha256});await close();
 calls=[];
 const rowRequestId=crypto.randomUUID(),confirmedDetail={history:{...history(),state:'partially_imported'},originalSheets:[],versions:[],selectedVersion:null,confirmation:{confirmationId:crypto.randomUUID(),batchRequestId:crypto.randomUUID(),versionId:null,createdAt:history().createdAt,batch:{id:81,batchCode:crypto.randomUUID(),revision:1,channelId:11,customerId:801},excludedRows:[],entries:[{logicalRowId:crypto.randomUUID(),rowId:crypto.randomUUID(),rowRequestId,uploadBatchId:81,status:'unknown',payload:{expectedEnterpriseId:31,expectedActorUserId:7,customerId:801,expectedCustomerVersion:1,channelId:11,uploadBatchId:81,requestId:rowRequestId,partNumber:'ONE',brand:'TI',qty:4,price:'1',currency:'CNY',taxIncluded:null,dateCode:null,leadTime:null,note:null}}]}};
 detailReplies=[confirmedDetail,{...confirmedDetail,confirmation:null},{...confirmedDetail,confirmation:null}];
 reconcileReply={history:confirmedDetail.history,entries:confirmedDetail.confirmation.entries,batch:confirmedDetail.confirmation.batch};
 await render(cap.HistorySession,{customerId:801,identity,isCurrent:()=>true,onClose:()=>{},onComplete:()=>{},onAuthorizationError:()=>{}});
 await click('详情');assert(document.querySelector('[role="alert"]')?.textContent.includes('原确认映射'),'detail reconcile losing confirmation must fail closed');
 const continueButton=[...document.querySelectorAll('button')].find(n=>['继续导入','继续处理'].includes(n.textContent.trim()));
 if(continueButton&&!continueButton.disabled){await act(async()=>continueButton.dispatchEvent(new w.MouseEvent('click',{bubbles:true})));await settle();}
 assert(!calls.some(c=>['download','prepare','create'].includes(c[0])),'seen original confirmation cannot be bypassed via details→continue');
 passes.push({case:'native detail confirmation witness blocks missing mapping and original-file rebuild',module:module.after,sha256:actual.sha256,factorySha256:actual.factorySha256});await close();detailReplies=[];
}
await act(async()=>root.unmount());w.close();
fs.writeFileSync(BASE+'/evidence/native-tests.json',JSON.stringify({status:'passed',realNetworkCalls:0,realDatabaseWrites:0,checks:passes},null,2)+'\n');console.log(JSON.stringify({status:'passed',tests:passes.length,realNetworkCalls:0,modules:modules.map(m=>m.sha256)},null,2));
