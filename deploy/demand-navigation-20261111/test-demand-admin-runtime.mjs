#!/usr/bin/env node
/** Only whitelisted function declarations run; no full production module/import/query/network execution. */
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const ROOT='/home/ubuntu/51-inspection',OUT=ROOT+'/candidate-admin',req=createRequire(ROOT+'/manager-github/package.json');
const ts=req('typescript'),React=req('react'),jsx=req('react/jsx-runtime'),{renderToStaticMarkup}=req('react-dom/server');
const read=p=>fs.readFileSync(p,'utf8'),sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const manifest=JSON.parse(read(OUT+'/manifest.json')),asset=manifest.files.find(r=>r.id==='workbench'),code=read(OUT+'/assets/'+asset.file);
assert.equal(sha(code),asset.sha256);
const ast=ts.createSourceFile('candidate.js',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
assert.ok(!code.includes('ProcurementDemands.tsx:297'),'compiled procurement tab removed');
assert.ok(!code.includes('DemandQuotes.tsx:77'),'compiled received-quotes tab removed');
const names=['Cx','wI','Hb','lw','$b','NI','CI','jI'];
const funcs=names.map(name=>{const n=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(n,'missing '+name);return n;});
const noop=()=>{},deny=()=>{throw Error('Forbidden fixture side effect');};
const box=tag=>({children,className,title,...p})=>React.createElement(tag,{className,title,...Object.fromEntries(Object.entries(p).filter(([k,v])=>k.startsWith('data-')||k.startsWith('aria-')||['href','disabled'].includes(k)))},children);
const blank=()=>null,ctx={console,Date,Intl,Math,Map,Set,Object,Array,String,Number,Boolean,JSON,Promise};
function walk(n,fn){fn(n);ts.forEachChild(n,x=>walk(x,fn));}
for(const f of funcs)walk(f,n=>{if(ts.isIdentifier(n)&&!(n.text in ctx))ctx[n.text]=blank;});
const demand={id:41,demandNo:'SSR-DEMAND-41',projectName:'REAL-PROJECT-DETAIL-ONLY',createdAt:'2026-11-01T00:02:59Z',status:'submitted',priority:'urgent',firstPartNumber:'PART-SSR',firstBrand:'BRAND',firstQty:10,firstQtyUnit:'片',firstDeliveryRequirement:'现货',salesName:'合成销售',itemCount:1,items:[],note:'   ',currentQuoteCount:1,mySupplierCount:1};
const quote={id:501,version:3,supplierName:'合成供应商',status:'active',updatedAt:'2026-11-01T00:02:59Z',items:[{id:1,demandItemId:1,partNumber:'PART-SSR',qty:10,qtyUnit:'片',unitPrice:'1.5',amount:'15',alternateNo:1}],totalAmount:'15',demandRevision:1,currentDemandRevision:2};
const queries=[];
function api(p=''){return new Proxy(deny,{get(_,k){if(k==='useQuery')return()=>{queries.push(p);return{data:p.endsWith('procurementGet')?demand:p.endsWith('procurementList')?{items:[demand],total:1,page:1}:p.endsWith('quoteList')?{items:[quote],total:1,page:1}:{items:[],total:0,page:1},isLoading:false,isFetching:false,refetch:deny};};if(k==='useMutation')return()=>({mutate:deny,isPending:false});if(k==='useUtils')return()=>api('utils');if(k==='invalidate')return deny;return api(p?p+'.'+String(k):String(k));}});}
Object.assign(ctx,{c:React,e:jsx,H:api(),fa:()=>({}),ps:(_k,d)=>React.useState(d),sc:x=>x,ua:x=>x,jx:20,Qi:20,Ki:20,Nx:'fixture',vx:[{value:'all',label:'全部'}],M:{success:deny,error:deny},te:box('button'),la:box('table'),oa:box('thead'),ia:box('tbody'),_s:box('tr'),Je:box('td'),es:box('th'),ze:box('input')});
for(const k of ['Zs','xa','rn','gs','et','st','tt','kt'])ctx[k]=box('div');
const timeFile=ROOT+'/manager-github/client/src/business/platform/shared/beijingTime.ts',timeSource=read(timeFile),timeAST=ts.createSourceFile('time.ts',timeSource,99,true,ts.ScriptKind.TS);
const timeNames=['toDate','formatBeijingDate','formatBeijingTime','formatBeijingDateTime'];
const timeFunctions=timeAST.statements.filter(n=>ts.isFunctionDeclaration(n)&&timeNames.includes(n.name?.text)).map(n=>n.getText(timeAST).replace(/^export\s+/,''));
assert.equal(timeFunctions.length,4);ctx.BEIJING_TIME_ZONE='Asia/Shanghai';ctx.LOCALE='zh-CN';
vm.createContext(ctx);new vm.Script(ts.transpile(timeFunctions.join('\n'),{target:ts.ScriptTarget.ES2020})+'\nthis.Is=formatBeijingDateTime;').runInContext(ctx,{timeout:1000});
new vm.Script(funcs.map(n=>n.getText(ast)).join('\n')+'\nthis.components={Cx,wI,Hb,lw};').runInContext(ctx,{timeout:1000});
const render=(name,props={})=>renderToStaticMarkup(React.createElement(ctx.components[name],props));
const results=[];function test(name,fn){fn();results.push({name,passed:true});}
ctx.Hb=ctx.components.Hb;
test('compiled ProcurementDemands createdAt Beijing minute, no project subrow, tabs removed, old actions',()=>{const h=render('Cx');assert.ok(h.includes('2026-11-01 08:02'));assert.ok(h.includes('录入时间'));assert.ok(!h.includes(demand.projectName));assert.ok(!h.includes('ProcurementDemands.tsx:415'));assert.ok(!h.includes('ProcurementWorkspaceNav'));for(const s of ['查看','报价','紧急','手动刷新'])assert.ok(h.includes(s));fs.writeFileSync(OUT+'/runtime-procurement.html',h);});
test('compiled detail one create button, true projectName, time, blank note hidden',()=>{const h=render('wI',{id:41,onClose:noop,onQuote:noop});assert.equal((h.match(/新增供应商报价/g)||[]).length,1);assert.ok(h.includes(demand.projectName));assert.ok(h.includes('2026-11-01 08:02'));assert.ok(!h.includes('需求说明'));assert.ok(!h.includes('内部需求，仅供授权'));assert.ok(!h.includes('每家供应商独立报价'));fs.writeFileSync(OUT+'/runtime-detail.html',h);});
test('compiled QuoteList totals and rounds, default hint title only',()=>{const h=render('Hb',{demandId:41,audience:'procurement',onCreate:noop,onEdit:noop});assert.ok(h.includes('1 份'));assert.ok(h.includes('第3轮'));assert.ok(h.includes('title="修改报价将生成下一轮'));assert.ok(!h.replace(/title="[^"]*"/g,'').includes('修改报价将生成下一轮'));assert.ok(!h.includes('每家供应商独立报价'));});
for(const [state,flags,text,audience] of [['withdrawn',{status:'withdrawn'},'已撤回','procurement'],['stale',{needsReconfirmation:true},'旧版报价不能采用，请采购重新确认','procurement'],['accepted',{isAccepted:true,acceptedByName:'合成销售',acceptedAt:'2026-11-01T00:02:59Z'},'已采用','sales'],['active',{},'采用报价','sales']])test('compiled QuoteCard '+state,()=>{const h=render('lw',{quote:{...quote,...flags},audience,onEdit:noop,onAccept:noop,onHistory:noop,onWithdraw:noop});assert.ok(h.includes(text));assert.ok(h.includes('历史（'));if(state==='withdrawn')assert.ok(!h.includes('新一轮'));});
const evidence={passed:true,verifiedAt:new Date().toISOString(),offlineOnly:true,mode:'whitelisted compiled function SSR with synthetic hook/query/component fixtures',assetFile:asset.file,assetSha256:asset.sha256,scriptSha256:sha(read(new URL(import.meta.url).pathname)),extractedFunctions:funcs.map(n=>({name:n.name.text,sha256:sha(n.getText(ast))})),timeSourceSha256:sha(timeSource),results,syntheticQueryPaths:[...new Set(queries)],reactSingleton:true,productionModulesExecuted:false,realQueriesExecuted:false,networkRequests:false,databaseConnected:false,browserVerified:false,limitations:['SSR substitutes UI primitives and query hooks; does not prove CSS layout, hydration, browser interactions or deployed dependency availability.','Mutations/refetch/invalidation throw; event handlers are retained but not invoked.','Quote receipt guards are not newly patched; protected-node byte checks are in verification.json.']};
fs.writeFileSync(OUT+'/runtime-test.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
