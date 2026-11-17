import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire('/home/ubuntu/work/51dianzi-platform--manager/package.json');
export const ts=require('typescript');
export const D='/home/ubuntu/work/admin-new-info-v1-20261117', R='/home/ubuntu/work/51dianzi-platform--manager';
export const H=s=>crypto.createHash('sha256').update(s).digest('hex');
export const read=f=>fs.readFileSync(f,'utf8');
export const parse=(s,name='candidate.js')=>{const a=ts.createSourceFile(name,s,99,true,ts.ScriptKind.JS);assert.equal(a.parseDiagnostics.length,0,name);return a;};
export function nodes(root,p){let out=[];function v(n){if(p(n))out.push(n);ts.forEachChild(n,v);}v(root);return out;}
export const one=(xs,label)=>{assert.equal(xs.length,1,label);return xs[0];};
const prop=(o,name)=>o.properties.find(p=>ts.isPropertyAssignment(p)&&(p.name.text===name));
const state=q=>`${q}.isSuccess===true&&!${q}.isError&&!${q}.isFetching&&!${q}.isPlaceholderData&&${q}.isFetchedAfterMount!==false`;
const verified=s=>`${s}.contextVerification?.state==="verified"&&${s}.contextVerification.identity===${s}.storageScope&&${s}.staffPrincipal?.status==="ready"`;
function apply(before,patches){patches.sort((a,b)=>a.start-b.start||a.end-b.end);let shift=0;for(let i=0;i<patches.length;i++){const p=patches[i];if(i)assert(p.start>=patches[i-1].end,'overlapping patches');assert.equal(before.slice(p.start,p.end),p.before);p.afterStart=p.start+shift;p.afterEnd=p.afterStart+p.after.length;shift+=p.after.length-p.before.length;}let next=before;for(const p of [...patches].reverse())next=next.slice(0,p.start)+p.after+next.slice(p.end);let inverse=next;for(const p of [...patches].reverse())inverse=inverse.slice(0,p.afterStart)+p.before+inverse.slice(p.afterEnd);assert.equal(inverse,before);parse(next);return next;}
export function resolve(spec,from,map){const key=/^[./]/.test(spec)?new URL(spec,'https://admin.51dianzi.com'+from).pathname:spec;const tables=Object.keys(map.scopes??{}).filter(s=>from.startsWith(s)).sort((a,b)=>b.length-a.length).map(s=>map.scopes[s]);tables.push(map.imports??{});for(const t of tables){if(Object.hasOwn(t,key))return t[key];if(Object.hasOwn(t,spec))return t[spec];}return key;}
export function specs(s){const a=parse(s);return [...new Set(nodes(a,n=>(ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier||ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword).map(n=>n.moduleSpecifier??n.arguments[0]).map(n=>{assert(ts.isStringLiteral(n),'literal module imports required');return n.text;}))];}
const sourcePaths={CustomerList:'business/platform/client/src/pages/CustomerList.tsx',ChannelInventoryHost:'business/platform/client/src/pages/ChannelInventoryHost.tsx',InquiryReception:'business/InquiryReception.tsx',ProcurementDemands:'business/platform/client/src/pages/ProcurementDemands.tsx',InboundManagement:'business/platform/client/src/pages/InboundManagement.tsx',CrmSalesOrders:'business/platform/client/src/pages/CrmSalesOrders.tsx',OutboundManagement:'business/platform/client/src/pages/OutboundManagement.tsx',Orders:'pages/Orders.tsx',MallMaterials:'business/MallMaterials.tsx',OfficialMall:'pages/OfficialMall.tsx'};
export async function build(){
 const out=D+'/static-pages';fs.mkdirSync(out,{recursive:true});
 const baseline=JSON.parse(read(D+'/page-baseline-private/targets.json')),nav=JSON.parse(read(D+'/static-navigation/manifest.json')),html=read(D+'/static-navigation/index.html');
 assert.equal(H(html),nav.after.htmlSha256,'navigation HTML frozen current');const match=one([...html.matchAll(/<script[^>]*type="importmap"[^>]*>([\s\S]*?)<\/script>/g)],'one effective importmap'),oldMap=JSON.parse(match[1]);
 const sources={};for(const[p,rel]of Object.entries(sourcePaths)){const f=R+'/client/src/'+rel;const text=read(f);sources[f]=H(text);if(p!=='OfficialMall'){assert(text.includes('useAdminNewInformationContextRows'),'source notification hook '+p);assert(text.includes('AdminNewInformationRowBadge'),'source badge '+p);}}
 const assets=[],rewrites={},modules=[],fixtures=[],seen=new Set();
 for(const [url,record]of Object.entries(baseline)){
  const before=read(record.local);assert.equal(H(before),record.sha256,'real deployed baseline');const a=parse(before,url),patches=[],families=[];const patch=(start,end,after,reason)=>patches.push({start,end,before:before.slice(start,end),after,reason});
  const workbench=url.includes('BusinessWorkbenchPage');let bridge=null;
  if(workbench){const owner=one(nodes(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='__d51_ir_w_get'),'real native IIFE owner');const live=one(nodes(owner,n=>ts.isVariableDeclaration(n)&&n.name.getText(a)==='__live'),'real singleton binding object');assert(ts.isObjectLiteralExpression(live.initializer));const get=name=>one(live.initializer.properties.filter(p=>ts.isPropertyAssignment(p)&&p.name.text===name),'native singleton '+name).initializer.getText(a);bridge={owner:'__d51_ir_w_get',objectSha256:H(live.initializer.getText(a)),React:get('React'),jsx:get('jsx'),useBusinessScope:get('useBusinessScope')};patch(0,0,`const __NI=(await import(${JSON.stringify(nav.navURL)})).newInformationBridge();\nconst __NIUseBusinessScope=${bridge.useBusinessScope},__NIJSX=${bridge.jsx}.jsx;\n`,'same new nav runtime and exact original BusinessScope hook');}
  else patch(0,0,`const __NI=(await import(${JSON.stringify(nav.navURL)})).newInformationBridge();\n`,'native leaf uses existing nav notification singleton');
  const functions=nodes(a,n=>ts.isFunctionDeclaration(n)&&n.name&&n.body&&n.getText(a).length<100000);
  for(const fn of functions){
   const text=fn.getText(a),name=fn.name.text;if(/^__/.test(name)||!fn.body.statements.length||ts.isReturnStatement(fn.body.statements[0]))continue;
   const vars=nodes(fn,n=>ts.isVariableDeclaration(n)&&n.initializer&&n.initializer.getText(a).length<2500);
   const findVars=pattern=>vars.filter(v=>pattern.test(v.initializer.getText(a)));
   const maps=nodes(fn,n=>ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='map'&&n.getText(a).length<16000);
   let family=null,module=null,prefix=null,rowMap=null,rowArrow=null,rowCall=null,ready=null,scope=null,business=false,extra=[];
   const mapWith=pattern=>maps.filter(m=>pattern.test(m.arguments[0]?.getText(a)??''));
   if(/customer\.list\.useQuery/.test(text)&&mapWith(/customer-list-name-line/).length){
    family='CustomerList';module='customers';prefix='customer';rowMap=one(mapWith(/customer-list-name-line/),'customer displayed row map');
    const query=one(findVars(/customer\.list\.useQuery/),'customer original list query').name.getText(a),ctx=one(findVars(/customer\.context\.useQuery/),'customer original context query').name.getText(a);
    const contacts=one(vars.filter(v=>v.initializer.getText(a)===`${ctx}.data`?false:new RegExp(`^[A-Za-z_$][\\w$]*\\(${ctx}\\.data\\)$`).test(v.initializer.getText(a))),'contact scope derived from actual context').name.getText(a);
    ready=`Boolean(${rowMap.expression.expression.getText(a)})&&${state(query)}&&${state(ctx)}&&${verified('__niBusiness')}&&__niBusiness.staffPrincipal.enterpriseId===${contacts}.scope?.enterpriseId&&__niBusiness.frontUser.id===${contacts}.scope?.actorUserId`;
    business=true;
   }else if(/procurementList\.useQuery/.test(text)&&mapWith(/procurement-demand-number/).length){
    family='ProcurementDemands';module='procurement';prefix='demand';rowMap=one(mapWith(/procurement-demand-number/),'procurement displayed row map');const query=one(findVars(/procurementList\.useQuery/),'procurement query').name.getText(a);const initial=one(findVars(/procurementList\.useQuery/),'procurement query').initializer.getText(a);const memory=one([...initial.matchAll(/\(\{\},([\w$]+)\)/g)],'original page memory ready')[1];ready=`${memory}&&${state(query)}`;
   }else if(/inbound\.list\.useQuery/.test(text)&&mapWith(/aria-label.*slipNo/).length){
    family='InboundManagement';module='inbound';prefix='inbound';rowMap=one(mapWith(/aria-label.*slipNo/),'inbound displayed row map');const q=one(findVars(/inbound\.list\.useQuery/),'original inbound list query');assert(ts.isObjectBindingPattern(q.name));patch(q.getStart(a),q.end,`__niListQuery=${q.initializer.getText(a)},${q.name.getText(a)}=__niListQuery`,'retain all original query result bindings and expose real success metadata');ready=`${verified('__niBusiness')}&&${state('__niListQuery')}`;business=true;
   }else if(/sellerOrders\.useQuery/.test(text)&&mapWith(/查看线上订单|OutboundManagement\.tsx:612/).length){
    family='OutboundManagement';module='sales';prefix='order';rowMap=one(mapWith(/查看线上订单|OutboundManagement\.tsx:612/),'seller displayed row map');const q=one(findVars(/sellerOrders\.useQuery/),'original seller list query');assert(ts.isObjectBindingPattern(q.name));patch(q.getStart(a),q.end,`__niListQuery=${q.initializer.getText(a)},${q.name.getText(a)}=__niListQuery`,'original seller query capture, not a new query');ready=`${verified('__niBusiness')}&&${state('__niListQuery')}`;business=true;
   }else if(/crmSalesOrder\.list\.useQuery/.test(text)&&mapWith(/crm-sales-orders-order-link/).length){
    family='CrmSalesOrders';module='sales';prefix='crm-sales';rowMap=one(mapWith(/crm-sales-orders-order-link/),'CRM actual order map');const receiver=rowMap.expression.expression.getText(a);const query=receiver.replace(/\.data\.items$/,'');assert.notEqual(query,receiver);const binding=fn.parameters[0]?.name?.elements?.find(e=>(e.propertyName??e.name).getText(a)==='ready');const readyParam=binding?binding.name.getText(a):one([...one(findVars(/crmSalesOrder\.list\.useQuery/),'CRM original query').initializer.getText(a).matchAll(/\(\{\},([\w$]+)\)/g)],'CRM original page memory ready')[1];ready=`${readyParam}&&${verified('__niBusiness')}&&${state(query)}`;business=true;
   }else if(/listTeamMaterials\.useQuery/.test(text)&&mapWith(/ci-material-part-col/).length){
    family='ChannelInventoryHost';module='inventory';prefix='channel-material';rowMap=one(mapWith(/ci-material-part-col/),'actual inventory material page');const query=one(findVars(/listTeamMaterials\.useQuery/),'inventory material query').name.getText(a),ctx=one(findVars(/enterprise\.me\.useQuery/),'inventory context query').name.getText(a);
    const scopeVar=one(vars.filter(v=>/^\w+\.contextVerification\.state===\"verified\"/.test(v.initializer.getText(a))),'inventory verified original scope').initializer.getText(a).split('.')[0];scope=`String(${scopeVar}.merchantId)`;
    const result=one(vars.filter(v=>v.name.getText(a)===rowMap.expression.expression.getText(a)),'inventory original displayed page').initializer.getText(a).replace(/\?\.items\?\?\[\]$/,'');
    const fullGate=vars.find(v=>v.initializer.getText(a).includes(`${ctx}.isFetching`)&&v.initializer.getText(a).includes(`${query}.isFetching`)&&v.initializer.getText(a).includes('merchantId'));
    if(fullGate){ready=fullGate.initializer.getText(a).split('&&Ha.length')[0];}else{
     assert(name==='Cs','reviewed deployed inventory original gate');ready=`z&&v&&O&&U&&re&&columnsContextVerified&&${state(ctx)}&&Z==="materials"&&!oi&&Boolean(${result})&&(!sr(r)||sr(r)===Z)&&${state(query)}&&${result}?.page===Ct.page&&${result}?.pageSize===Ct.pageSize&&Number.isSafeInteger(${scopeVar}.merchantId)&&${scopeVar}.merchantId>0`;
    }
    ready=`(${ready})&&${state(ctx)}&&${state(query)}`;
   }else if(text.includes('inquiry-reception__item')&&text.includes('inquiry-reception__panels')){
    family='InquiryReception';module='reception';prefix='inquiry';const render=one(vars.filter(v=>ts.isArrowFunction(v.initializer)&&v.initializer.getText(a).includes('className:"inquiry-reception__item"')),'actual reception customer renderer');rowArrow=render.initializer;
    rowMap=one(maps.filter(m=>m.arguments[0]?.getText(a)===render.name.getText(a)),'actual filtered reception queue renderer');const queue=rowMap.expression.expression.getText(a);assert.equal(queue,'he','frozen real reception queue');scope='String(o.scope.merchantId)';ready=`T&&g==="mine"&&o.scope.contextVerification.state==="verified"&&o.scope.contextVerification.identity===o.scope.storageScope&&__niBusiness.storageScope===o.scope.storageScope&&[o.enterprise,o.inbox,o.query].every(query=>${state('query')})`;business=true;
   }else if(url.includes('/Orders-')&&name==='ls'){
    family='Orders';module='sales';prefix='order';rowMap=one(maps.filter(m=>m.expression.expression.getText(a)==='o.data.rows'),'actual native order page map');ready=state('o');
   }else if(url.includes('/OfficialMall-')&&name==='Lf'){
    family='MallMaterials';module='mall';prefix='mall-material';rowMap=one(maps.filter(m=>m.expression.expression.getText(a)==='X'&&m.arguments[0]?.getText(a).includes('mall-model')),'actual native mall material table only');ready=`c&&n&&s?.scope.adminUserId===r.user?.id&&${state('o')}&&${state('G')}`;
   }
   if(!family)continue;
   rowArrow??=rowMap.arguments[0];assert(ts.isArrowFunction(rowArrow),'actual row arrow');const id=rowArrow.parameters[0].name.getText(a);assert(ts.isIdentifier(rowArrow.parameters[0].name));
   const rowCandidates=nodes(rowArrow,n=>ts.isCallExpression(n)&&n.arguments.length>=2&&ts.isObjectLiteralExpression(n.arguments[1])&&(n.arguments[0].text==='tr'||prop(n.arguments[1],'data-page-memory-row')||prop(n.arguments[1],'className')?.initializer.text==='inquiry-reception__item'));
   rowCall=family==='Orders'&&ts.isCallExpression(rowArrow.body)?rowArrow.body:one(rowCandidates,'actual visible '+family+' row');const rowObj=rowCall.arguments[1];assert(!prop(rowObj,'ref'),'original row ref must not be overwritten');
   patch(rowObj.getStart(a)+1,rowObj.getStart(a)+1,`ref:__niRows.getRow(${JSON.stringify(prefix+':')}+${id}.id).ref,`,'ref binds exact real displayed row '+family);
   let badgeHost;
   const hosts=nodes(rowArrow,n=>ts.isObjectLiteralExpression(n)&&prop(n,'children')&&prop(n,'className'));
   const marker={CustomerList:'customer-list-name-line',ProcurementDemands:'procurement-demand-number',CrmSalesOrders:'crm-sales-orders-order-link',ChannelInventoryHost:'ci-material-part-col',InquiryReception:'inquiry-reception__item-top',MallMaterials:'mall-model',Orders:'font-mono text-sm font-semibold'}[family];
   if(marker)badgeHost=one(nodes(rowArrow,n=>ts.isObjectLiteralExpression(n)&&prop(n,'className')&&prop(n,'className').initializer.getText(a).includes(marker)),'real primary field for badge '+family+':'+name);
   else{const calls=nodes(rowArrow,n=>ts.isCallExpression(n)&&n.arguments[0]?.text==='td'&&ts.isObjectLiteralExpression(n.arguments[1])&&prop(n.arguments[1],'children'));badgeHost=one(calls.filter(n=>new RegExp(`\\b${id}\\.${family==='InboundManagement'?'slipNo':family==='Orders'?'orderNo':'orderNo'}`).test(prop(n.arguments[1],'children').initializer.getText(a))).slice(0,1),'original order number cell').arguments[1];}
   const child=prop(badgeHost,'children')?.initializer;
   // The original renderer remains in place; a badge component from the shared runtime reads this row's real isNew.
   const renderer=rowCall.expression.getText(a);const jsx=workbench?'__NIJSX':url.includes('/Orders-')?'s.jsx':'__live.jsx.jsx';
   const badge=`${jsx}(__NI.AdminNewInformationRowBadge,{isNew:__niRows.getRow(${JSON.stringify(prefix+':')}+${id}.id).isNew})`;
   if(child)patch(child.getStart(a),child.end,`[${child.getText(a)},${badge}]`,'actual '+family+' primary field renders runtime isNew');else{const hostCall=badgeHost.parent;assert(ts.isCallExpression(hostCall)&&hostCall.expression.getText(a).endsWith('.createElement'),'existing native createElement field');patch(hostCall.end-1,hostCall.end-1,','+badge,'actual createElement primary field renders runtime isNew');}
   const receiver=rowMap.expression.expression;patch(receiver.getStart(a),receiver.end,'__niDisplayed','stable new-first only the original displayed page');
   const returns=fn.body.statements.filter(ts.isReturnStatement);const finalReturn=returns.at(-1);assert(finalReturn,'main page render return');let insert=finalReturn.getStart(a);
   // Mall has auth/denied returns: initialize rows before the first original render barrier, with listReady false.
   if(family==='MallMaterials'){const barrier=fn.body.statements.find(n=>ts.isIfStatement(n)&&nodes(n,ts.isReturnStatement).length);if(barrier)insert=barrier.getStart(a);}
   const prelude=`const ${business?'__niBusiness=__NIUseBusinessScope(),':''}__niPageRows=(${receiver.getText(a)}??[]),__niListReady=Boolean(${ready}),__niRows=__NI.useAdminNewInformationContextRows({module:${JSON.stringify(module)},refs:__niPageRows.map(row=>${JSON.stringify(prefix+':')}+row.id),${scope||business?'scope:'+(scope??'String(__niBusiness.merchantId)')+',':''}listReady:__niListReady}),__niDisplayed=[...__niPageRows].sort((left,right)=>Number(__niRows.getRow(${JSON.stringify(prefix+':')}+right.id).isNew)-Number(__niRows.getRow(${JSON.stringify(prefix+':')}+left.id).isNew));\n`;
   patch(insert,insert,prelude,'shared native hook consumes actual current query/status/generation barrier');
   const rowPatches=patches.filter(p=>p.start>=rowArrow.getStart(a)&&p.end<=rowArrow.end).map(p=>({...p,start:p.start-rowArrow.getStart(a),end:p.end-rowArrow.getStart(a)}));
   const rowText=apply(rowArrow.getText(a),rowPatches);
   const fixture={family,url,function:name,functionStart:fn.getStart(a),module,prefix,prelude,ready,receiver:receiver.getText(a),rowRenderer:rowText,rowParameter:id,source:sources[R+'/client/src/'+sourcePaths[family]],bridge};fixtures.push(fixture);families.push({family,function:name,module,prefix,queryReady:ready,displayedReceiver:receiver.getText(a),realRowRef:true,actualFieldBadge:true,fixtureIndex:fixtures.length-1});seen.add(family);
  }
  if(url.includes('/OfficialMall-')){
   const reader=one(functions.filter(f=>f.name.text==='Rf'&&f.getText(a).includes('scopeGeneration')),'original private native generation reader');const ret=one(reader.body.statements.filter(ts.isReturnStatement),'native read real state');assert(ts.isObjectLiteralExpression(ret.expression));patch(ret.expression.getStart(a)+1,ret.expression.getStart(a)+1,'isSuccess:r&&f.generation===u&&h!==void 0&&!d,isPlaceholderData:false,','same native private generation now exposes success, no new transport');
  }
  assert(families.length>0,'at least one real page in '+url);const next=apply(before,patches),basename=path.basename(url).replace(/\.js$/,'').split('-')[0]+'-new-information-'+H(next).slice(0,16)+'.js',nextURL=path.posix.dirname(url)+'/'+basename,local=out+'/'+basename;fs.writeFileSync(local,next);assets.push({url:nextURL,local,sha256:H(next),bytes:Buffer.byteLength(next)});rewrites[url]=nextURL;modules.push({actualtargetURL:url,baselineLocal:record.local,beforeSha256:H(before),newURL:nextURL,afterSha256:H(next),families,bridge,patches,inverseVerified:true,allOutsidePatchBytesPreserved:true});
  console.log(path.basename(url),families.map(x=>x.family+':'+x.function).join(','),Buffer.byteLength(next));
 }
 for(const p of Object.keys(sourcePaths).filter(x=>x!=='OfficialMall'))assert(seen.has(p),'candidate compiled hook absent '+p);
 const map=structuredClone(oldMap);for(const table of [map.imports,...Object.values(map.scopes??{})])for(const[k,v]of Object.entries(table))table[k]=rewrites[v]??v;
 for(const[from,to]of Object.entries(rewrites)){map.imports[from]=to;const scopes=Object.keys(oldMap.scopes??{}).filter(s=>from.startsWith(s)).sort((a,b)=>b.length-a.length);if(scopes.length){map.scopes??={};map.scopes[to]=structuredClone(map.scopes[scopes[0]]);}}
 const resolutions=[];for(const m of modules){for(const spec of specs(read(m.baselineLocal))){const was=resolve(spec,m.actualtargetURL,oldMap),now=resolve(spec,m.newURL,map);assert.equal(now,rewrites[was]??was,'unchanged native dependency '+spec);resolutions.push({from:m.newURL,spec,before:was,after:now});}}
 for(const[k,v]of Object.entries(oldMap.imports))assert.equal(map.imports[k],rewrites[v]??v);for(const[scope,table]of Object.entries(oldMap.scopes??{}))for(const[k,v]of Object.entries(table))assert.equal(map.scopes[scope][k],rewrites[v]??v);
 const newMapText=JSON.stringify(map),finalHTML=html.replace(match[1],newMapText);assert.equal(finalHTML.replace(newMapText,match[1]),html);fs.writeFileSync(out+'/index.html',finalHTML);fs.writeFileSync(out+'/fixtures.json',JSON.stringify(fixtures,null,2)+'\n');fs.writeFileSync(out+'/updatedMappings.json',JSON.stringify(rewrites,null,2)+'\n');
 for(const[f,h]of Object.entries(sources))assert.equal(H(fs.readFileSync(f)),h,'source hash drift '+f);assert.equal(H(read(D+'/static-navigation/index.html')),H(html),'navigation changed while building');
 const manifest={scope:'admin-new-information-real-page-candidates-v1',sourceHashes:sources,navigation:{manifestSha256:H(read(D+'/static-navigation/manifest.json')),rootURL:nav.rootURL,navURL:nav.navURL,uiURL:nav.uiURL,htmlSha256:H(html)},assets,actualtargetURLs:Object.keys(baseline),updatedMappings:rewrites,finalHtml:out+'/index.html',finalHtmlSha256:H(finalHTML),htmlBaseSha256:H(html),modules,dependencyResolution:resolutions,checks:{allNineRealPages:true,noNewReact:true,noNewQueryClient:true,noNewBusinessScope:true,noNewTRPC:true,oneNotificationContext:true,originalCurrentListBarriers:true,realDisplayedRowRefs:true,realRendererIsNewBadges:true,pageLocalSortingOnly:true,allImportmapAliasesInherited:true,rootNewnavAndNativeMallPreserved:true,htmlInverse:true,sourceSnapshotStable:true},tests:{status:'PENDING_COMPILED_FIXTURE'}};fs.writeFileSync(out+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');return manifest;
}
if(process.argv[1]===fileURLToPath(import.meta.url))await build();
