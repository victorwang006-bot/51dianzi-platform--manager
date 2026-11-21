import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const R='/home/ubuntu/work/channel-release-20261121-1837/manager',W='/home/ubuntu/work/customer-consistency-release-20261122-0034/layout';
const req=createRequire(R+'/package.json'),es=req('esbuild'),ts=req('typescript');
let test=fs.readFileSync('/home/ubuntu/work/customer-unread-hotfix-20261121-2353/tests/native-regression.cjs','utf8');
const split=test.indexOf('(async()=>{\n let failed=false;');
const harness=test.slice(0,split).replace("const ROOT='/home/ubuntu/work/customer-unread-hotfix-20261121-2353';",`const ROOT=${JSON.stringify(W)};`).replace("const input=process.argv[2]||`${ROOT}/capture`;",`const input=${JSON.stringify(W+'/tests/native-input')};`);
const manifest=JSON.parse(fs.readFileSync(W+'/manifest.json'));
// Optional explicit final integrated WB paths affect only QA fixture inputs.
const selected=process.argv.slice(2);
if(selected.length!==0&&selected.length!==2)throw Error('Provide both absolute final WB0/WB1 paths or neither');
const modules=manifest.modules.map(m=>({...m,local:selected[m.index]||m.local}));
for(const m of modules)if(!path.isAbsolute(m.local)||!fs.existsSync(m.local))throw Error('Missing absolute native QA input: '+m.local);
fs.mkdirSync(W+'/tests/native-input',{recursive:true});
for(const m of modules)fs.copyFileSync(m.local,W+'/tests/native-input/workbench-'+m.index+'.js');
fs.writeFileSync(W+'/tests/native-test.cjs',harness+'\nmodule.exports={extract,NativeRun,success,makeRow};\n');
const native=req(W+'/tests/native-test.cjs');
// The original full function and its literal helpers, not a rewritten JSX demo.
const ex=[];
for(const m of modules){const s=fs.readFileSync(m.local,'utf8'),a=ts.createSourceFile('native.js',s,99,true);let f;function v(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===(m.index?'vt':'Jw')&&n.getText(a).includes('__apUnreadOnly'))f=n;ts.forEachChild(n,v);}v(a);const old=fs.readFileSync(W+'/baseline/native-wb'+m.index+'.js','utf8');
 // Helper extraction uses the same AST implementation from the previous native suite.
 process.argv[2]=m.local;process.argv[3]=m.local;const extracted=native.extract(m.index);
 const ha=ts.createSourceFile('helpers.js',extracted.helpers,99,true);
 extracted.helperNames=ha.statements.flatMap(n=>ts.isFunctionDeclaration(n)?[n.name.text]:ts.isVariableStatement(n)?n.declarationList.declarations.map(d=>d.name.text):[]);
 ex.push(extracted);
}
fs.writeFileSync(W+'/tests/native-extract.json',JSON.stringify(ex.map(({text,metadata,helpers,helperNames})=>({text,metadata,helpers,helperNames})),null,2));
let browserClass=test.slice(test.indexOf('const clone='),split);
browserClass=browserClass.replace('this.vm=vm.createContext(ctx,{name:`offline WB${wb}`});','this.vm=ctx;');
browserClass=browserClass.replaceAll('vm.runInContext(', 'browserEvaluate(');
browserClass=browserClass.replace('browserEvaluate(ex.helpers,this.vm,{timeout:1000});',"Object.assign(this.vm,browserEvaluate(ex.helpers+'\\n;({'+ex.helperNames.join(',')+'})',this.vm));");
// browserEvaluate executes these pinned native bytes in an explicit offline namespace.
fs.writeFileSync(W+'/tests/native-browser-runtime.mjs',`const assert=Object.assign((v,m)=>{if(!v)throw Error(m)},{equal:(a,b,m)=>{if(a!==b)throw Error(m)},ok:(a,m)=>{if(!a)throw Error(m)},deepEqual:(a,b,m)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(m)}});\nconst browserEvaluate=(code,ctx)=>Function('ctx','with(ctx){return eval('+JSON.stringify(code)+')}')(ctx);\n${browserClass}\nexport {NativeRun,success,makeRow};\n`);
const prefix=R+'/client/src/business/platform/client/src';
const entry=`
import React from 'react';import {createRoot}from'react-dom/client';import {jsx,jsxs,Fragment}from'react/jsx-runtime';
import {NativeRun,success,makeRow}from'./native-browser-runtime.mjs';
import * as memory from '${prefix}/lib/pageMemory';
import {usePageMemory,useRememberedState,useListPositionRestore}from'${prefix}/hooks/usePageMemory';
import * as Table from '${prefix}/components/ui/table';
import * as Select from '${prefix}/components/ui/select';
import {Button}from'${prefix}/components/ui/button';import {Input}from'${prefix}/components/ui/input';
import {AdminPage,AdminDataPanel}from'${R}/client/src/components/admin/UnifiedAdminPage';
import {CompactListToolbar}from'${prefix}/components/ui/CompactListToolbar';
import {CustomerSupplyCell}from'${prefix}/components/customers/CustomerSupplyCell';
import {CustomerSupplyAction}from'${prefix}/components/customers/CustomerSupplyAction';
import {CustomerContactsSummary}from'${prefix}/components/customers/CustomerContactsSummary';
import {AdminNewInformationRowBadge}from'${R}/client/src/components/admin/AdminNewInformationBadge';
import {Star,Loader2,Plus,ChevronUp,ChevronDown}from'lucide-react';
const config=await(await fetch('/native-extract.json')).json();
const wb=Number(new URLSearchParams(location.search).get('wb')||0),run=new NativeRun(wb,config[wb]);
window.__nativeRun=run;window.__memory=memory;window.__fixtureTRPC=run.trpc;window.__fixtureErrors=[];
const common={enterpriseId:7,actorUserId:101};const cache=new Map();
function rows(page){return [0,1,2,3].map((n)=>({...makeRow(11+n),name:page===2?'合成离线长公司名称（并非真实客户）'.repeat(8)+n:'离线公司'+n,contactName:'王工',phone:'13800000000',incomplete:n===2,archivedAt:n===3?'2026-01-01':null}));}
run.trpc.customer.list.useQuery=(input,options)=>{run.listInput=input;run.listOptions=options;const k=JSON.stringify(input);if(!cache.has(k)){let items=rows(input.page);if(input.customerIds)items=items.filter(r=>input.customerIds.includes(r.id));cache.set(k,success({items,total:40}));}const data=cache.get(k);return {...data,refetch:async()=>data};};
run.trpc.customer.contactsList={useQuery:()=>success({contacts:[]})};
run.utils.client.channelInventory.customerSupplySummary.query=async({customerIds})=>({canWrite:true,items:customerIds.map((customerId)=>({customerId,canUpload:true,canViewStock:customerId!==12,channelId:customerId+100,materialCount:128}))});
run.unreadMode='success';run.vm.__NI.useAdminNewInformationContextUnreadRefs=()=>({available:true,customerIds:[11,12,13,14],retry:async()=>{},error:null});
run.vm.__NI.useAdminNewInformationContextRows=()=>({query:{isError:false},getRow:ref=>({isNew:ref==='customer:11',ref:()=>{}})});
run.vm.__NI.AdminNewInformationRowBadge=AdminNewInformationRowBadge;
run.vm.__CC20261118Factory=()=>({verified:(q,r)=>r&&q.isSuccess,needs:r=>r.incomplete===true});
const Forbidden=p=>jsx('div',{role:'status',children:'离线夹具不执行真实录入或上传'});
const layout=p=>p.children;
const mappings=wb===0?{Zs:layout,xa:AdminPage,Ba:CustomerSupplyAction,__d51CompactListToolbar:CompactListToolbar,Vs:Select.Select,Xs:Select.SelectTrigger,Gs:Select.SelectValue,Js:Select.SelectContent,as:Select.SelectItem,ze:Input,te:Button,Ot:ChevronDown,Kx:ChevronUp,dn:Plus,Ww:Forbidden,gs:AdminDataPanel,ts:Loader2,au:Star,la:Table.Table,oa:Table.TableHeader,_s:Table.TableRow,es:Table.TableHead,ia:Table.TableBody,Je:Table.TableCell,Qw:CustomerContactsSummary,Xw:CustomerSupplyCell,Vw:Forbidden,Xo:Forbidden}:{ot:layout,yt:AdminPage,B:CustomerSupplyAction,bt:CompactListToolbar,_:Button,Ze:ChevronUp,Xe:Plus,F:Select.Select,R:Select.SelectTrigger,A:Select.SelectValue,N:Select.SelectContent,g:Select.SelectItem,pe:Input,ve:Star,Je:ChevronDown,nt:Forbidden,xe:AdminDataPanel,_e:Loader2,ht:Table.Table,Lt:Table.TableHeader,Ie:Table.TableRow,I:Table.TableHead,St:Table.TableBody,x:Table.TableCell,at:CustomerContactsSummary,mt:CustomerSupplyCell,ut:Forbidden,gt:Forbidden};
Object.assign(run.vm,mappings,{document,window});
const nav=(url)=>{memory.flushPagePosition();history.pushState({},'',url);render();};
run.vm.on=run.vm.et=()=>[location.pathname,nav];
run.vm.fa=run.vm.je=usePageMemory;
run.vm.ps=run.vm.O=useRememberedState;
run.vm.c=React;run.vm.M=React.useState;run.vm.K=React.useMemo;run.vm.b=React.useRef;run.vm.h=React.useEffect;
run.vm.e={jsx,jsxs,Fragment};run.vm.t=jsx;run.vm.n=jsxs;
// Verified against current vt and __cwCustomerListUpdatedLive import bridge:
// qe(query, ready) restores position; we() confirms filters, matching source imports.
run.vm.tb=run.vm.qe=useListPositionRestore;
run.vm.de=memory.customerFiltersRequireConfirmation;run.vm.z=memory.pageMemoryContext;
run.vm.we=memory.confirmCustomerFilters;
run.vm.nd=run.vm._t='customer-list-control min-w-[64px] border-slate-300 bg-white px-3 text-slate-700 shadow-none';
const root=createRoot(document.getElementById('root'),{onUncaughtError:e=>window.__fixtureErrors.push(String(e.stack||e))});
function NativePage(){React.useSyncExternalStore(memory.subscribePageMemory,memory.pageMemoryEpoch,()=>0);return run.fn();}
function App(){if(location.pathname.includes('/customers/')||location.pathname.includes('/channels/'))return jsx('button',{id:'fixture-return',onClick:()=>memory.returnToPageSource(nav,'/customers'),children:'返回客户列表（离线）'});return jsx('div',{className:'admin-workspace-shell', 'data-admin-layout':'top-two-level-v1',children:jsx('main',{className:'admin-workspace-shell__main admin-unified-content',children:jsx('div',{'data-business-context-verification':'verified',children:jsx('div',{'data-business-context-content':true,children:jsx('div',{className:'business-native-content',children:jsx(NativePage,{})})})})})});}
function render(){root.render(jsx(App,{}));}window.addEventListener('popstate',render);render();window.__fixtureReady=true;
`;
fs.writeFileSync(W+'/tests/browser-entry.tsx',entry);
await es.build({entryPoints:[W+'/tests/browser-entry.tsx'],outfile:W+'/tests/browser-fixture.js',bundle:true,format:'esm',platform:'browser',jsx:'automatic',target:'es2022',alias:{'@':R+'/client/src','@shared':R+'/shared'},loader:{'.css':'empty'},plugins:[{name:'offline-only',setup(b){b.onResolve({filter:/business-trpc$/},()=>({path:'trpc',namespace:'offline'}));b.onResolve({filter:/usePageIdentity$/},()=>({path:'identity',namespace:'offline'}));b.onResolve({filter:/^@\/lib\/adminNewInformation$/},()=>({path:'badge-context',namespace:'offline'}));b.onLoad({filter:/.*/,namespace:'offline'},a=>({contents:a.path==='trpc'?'export const trpc={useUtils:(...x)=>window.__fixtureTRPC.useUtils(...x),customer:{contactsList:{useQuery:(...x)=>window.__fixtureTRPC.customer.contactsList.useQuery(...x)}}};':a.path==='identity'?"export const usePageIdentity=()=> 'offline:7:101';":'export const useAdminNewInformationRowContext=()=>null;'}));}}]});
console.log('Browser fixture compiled: full native list plus actual React Table, toolbar, contacts, supply and badge; bounded offline business and identity mocks.');
