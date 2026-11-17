import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {D,R,H,read,parse,nodes,ts,resolve,specs} from './build-page-markers.mjs';
const out=D+'/static-pages',manifest=JSON.parse(read(out+'/manifest.json')),fixtures=JSON.parse(read(out+'/fixtures.json'));
const tests=[];
const business={merchantId:7,storageScope:'scope-current',contextVerification:{state:'verified',identity:'scope-current'},staffPrincipal:{status:'ready',enterpriseId:17,frontendUserId:23},frontUser:{id:23},officialInventoryPermissions:{read:true}};
const query=()=>({isSuccess:true,isError:false,isFetching:false,isLoading:false,isPlaceholderData:false,isFetchedAfterMount:true});
const rows=[{id:11,name:'fixture old',orderNo:'O-11',orderNumber:'C-11',slipNo:'I-11',demandNo:'D-11',partNumber:'PN-11',brand:'B',qty:10,createdAt:'2026-11-17',status:'submitted',items:[],enterpriseId:17},{id:12,name:'fixture new',orderNo:'O-12',orderNumber:'C-12',slipNo:'I-12',demandNo:'D-12',partNumber:'PN-12',brand:'B',qty:20,createdAt:'2026-11-17',status:'submitted',items:[],enterpriseId:17}];
function pathSet(env,path,value){const keys=path.split('.');let o=env;for(const key of keys.slice(0,-1)){if(!o[key]||typeof o[key]!=='object')o[key]={};o=o[key];}o[keys.at(-1)]=value;}
function identifiers(text){const a=parse(text);return new Set(nodes(a,ts.isIdentifier).filter(n=>!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n)&&!(ts.isPropertyAssignment(n.parent)&&n.parent.name===n)).map(n=>n.text));}
function propertyPath(n){if(ts.isIdentifier(n))return n.text;if(ts.isPropertyAccessExpression(n)){const root=propertyPath(n.expression);return root?root+'.'+n.name.text:null;}return null;}
function readyEnvironment(f){
 const env={Boolean,Number,String,Math,Set,Map};for(const n of identifiers(f.prelude))if(!(n in env))env[n]=true;
 const a=parse('('+f.ready+')');for(const p of nodes(a,ts.isPropertyAccessExpression)){const key=propertyPath(p);if(!key||key.startsWith('__niBusiness.'))continue;const last=p.name.text;const defaults={isSuccess:true,isError:false,isFetching:false,isLoading:false,isPlaceholderData:false,isFetchedAfterMount:true,state:'verified',identity:'scope-current',storageScope:'scope-current',status:'ready',enterpriseId:17,actorUserId:23,frontendUserId:23,merchantId:7,id:23,adminUserId:23,current:'/fixture',key:'scope-current',page:1,pageSize:2};if(Object.hasOwn(defaults,last))pathSet(env,key,defaults[last]);}
 for(const n of nodes(a,n=>ts.isPrefixUnaryExpression(n)&&n.operator===ts.SyntaxKind.ExclamationToken&&ts.isIdentifier(n.operand)))env[n.operand.text]=false;
 const qs=[...f.ready.matchAll(/([\w$]+(?:\.[\w$]+)*)\.isSuccess/g)].map(m=>m[1]);for(const q of qs)pathSet(env,q,{...query(),...(typeof q==='string'&&typeof env[q]==='object'?env[q]:{})});
 const receiver=f.receiver.replaceAll('?.','.');pathSet(env,receiver,structuredClone(rows));
 // The fixture models only this real page; all identity/query fields are stubs, never live network/DB data.
 env.__NIUseBusinessScope=()=>structuredClone(business);
 if(f.family==='ChannelInventoryHost'){
  const scope=f.prelude.match(/scope:String\(([\w$]+)\.merchantId\)/)?.[1];if(scope)env[scope]=structuredClone(business);
  if(f.function==='Cs'){env.Z='materials';env.sr=()=>undefined;env.Ct={page:1,pageSize:2};env.r='/fixture';}
  else{env.ee='materials';env.Si=()=>undefined;env.Se={key:'scope-current'};env.re='scope-current';env.xn={page:1,pageSize:2};env.Yc=2;env.r='/fixture';env.es={current:'/fixture'};}
  const result=receiver.includes('.')?receiver.split('.').slice(0,-1).join('.'):null;
  if(!result){const actual=f.function==='Cs'?'vt':'Ur';env[actual]={page:1,pageSize:2,items:structuredClone(rows)};}
 }
 if(f.family==='InquiryReception'){env.o={scope:structuredClone(business),enterprise:query(),inbox:query(),query:query()};env.g='mine';env.T=true;env.he=structuredClone(rows);}
 if(f.family==='MallMaterials'){env.o=query();env.G=query();env.c=true;env.n=true;env.s={scope:{adminUserId:23}};env.r={user:{id:23}};env.X=structuredClone(rows);}
 return {env,queryPaths:qs};
}
function executePrelude(f,env){const calls=[],witnesses=[],presentation=new Map();const badge=p=>({type:'span',props:{'data-admin-new-information':'row',hidden:!p.isNew},isNew:p.isNew});env.__NI={AdminNewInformationRowBadge:badge,useAdminNewInformationContextRows(options){calls.push(options);return {getRow(id){if(!presentation.has(id))presentation.set(id,{isNew:id.endsWith(':12'),ref(node){witnesses.push({id,node});}});return presentation.get(id);}};}};
 const script=new vm.Script(`(()=>{${f.prelude}return {pageRows:__niPageRows,ready:__niListReady,displayed:__niDisplayed,information:__niRows};})()`);const result=script.runInNewContext(env,{timeout:1000});assert.equal(calls.length,1,'single shared hook invocation');return {result,calls,witnesses,badge,presentation,env};}
let universal;
const jsx=(type,props,key)=>{if(typeof type==='function'&&type.__badge===true)return type(props);return {type,props:props??{},key};};
universal=new Proxy(function(...args){if(args.length>=2&&args[1]&&typeof args[1]==='object'&&!Array.isArray(args[1]))return jsx(...args);return universal;},{get(t,key){if(key===Symbol.toPrimitive)return()=>'';if(key===Symbol.iterator)return function*(){};if(key==='jsx'||key==='jsxs'||key==='createElement')return jsx;if(key==='Fragment')return 'fragment';if(key==='has'||key==='some'||key==='includes')return()=>false;if(key==='map'||key==='filter')return()=>[];if(key==='join')return()=>'';if(key==='get')return()=>universal;if(key==='length')return 0;return universal;}});
function renderRow(f,prelude){const env={...prelude.env,Number,String,Math,Date,Set,Map};for(const n of identifiers('('+f.rowRenderer+')'))if(!(n in env)||env[n]===true)env[n]=universal;
 env.__niRows=prelude.result.information;env.__NIJSX=jsx;env.__NI=prelude.env.__NI;env.__NI.AdminNewInformationRowBadge.__badge=true;
 const actualJSX={jsx,jsxs:jsx,Fragment:'fragment'};env.__live={React:{createElement:(type,props,...children)=>jsx(type,{...props,children}),...actualJSX},jsx:actualJSX};if(f.bridge){env[f.bridge.jsx]=actualJSX;}else if(f.family==='Orders')env.s=actualJSX;
 // Existing non-notification JSX bindings are native; use a DOM-shaped fixture for their rendering only.
 const ast=parse('('+f.rowRenderer+')');for(const c of nodes(ast,n=>ts.isCallExpression(n)&&n.arguments.length>=2&&ts.isObjectLiteralExpression(n.arguments[1]))){const exp=c.expression;if(ts.isIdentifier(exp))env[exp.text]=jsx;else if(ts.isPropertyAccessExpression(exp)&&ts.isIdentifier(exp.expression)&&['jsx','jsxs'].includes(exp.name.text))env[exp.expression.text]=actualJSX;}
 const render=new vm.Script('('+f.rowRenderer+')').runInNewContext(env,{timeout:1000});let trees=[];
 for(const row of rows){const tree=render(structuredClone(row),0);assert(tree&&tree.props,'actual compiled row renderer returns JSX');assert.equal(typeof tree.props.ref,'function','real root row ref, not a proof/sentinel');const node={tagName:f.family==='InquiryReception'?'BUTTON':'TR',isConnected:true,getBoundingClientRect:()=>({top:20,bottom:60,left:0,right:600,width:600,height:40})};tree.props.ref(node);const badges=[];function visit(v){if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach(visit);return;}if(v.props?.['data-admin-new-information']==='row')badges.push(v);visit(v.props?.children);}visit(tree);assert.equal(badges.length,1,'one real inline row badge '+f.family+':'+f.function);assert.equal(badges[0].isNew,row.id===12,'compiled renderer reads hook isNew, no static number');trees.push({id:row.id,tagName:node.tagName,isNew:badges[0].isNew});}
 assert.deepEqual(prelude.witnesses.map(x=>x.id),rows.map(r=>f.prefix+':'+r.id));return trees;
}
try{
 for(const f of fixtures){
  const {env,queryPaths}=readyEnvironment(f),ok=executePrelude(f,env);if(!ok.result.ready){console.log('NOT_READY',f.ready);const debug={...env,__niBusiness:env.__NIUseBusinessScope?.()};for(const clause of f.ready.split('&&'))try{console.log(clause,vm.runInNewContext(clause.replace(/^\(/,'').replace(/\)$/,''),debug));}catch{}}assert.equal(ok.result.ready,true,f.family+':'+f.function+' current successful displayed page');assert.deepEqual(Array.from(ok.calls[0].refs),rows.map(r=>f.prefix+':'+r.id));assert.deepEqual(Array.from(ok.result.displayed,r=>r.id),[12,11],'stable new-first page-local');assert.equal(ok.result.pageRows.length,2,'no all-page expansion');if(ok.calls[0].scope!==undefined)assert.equal(ok.calls[0].scope,'7','scope only original merchant ID');const rendered=renderRow(f,ok);
  const negative=[];for(const field of ['isError','isFetching','isPlaceholderData','isSuccess','isFetchedAfterMount']){
   const {env:bad}=readyEnvironment(f);if(f.family==='InquiryReception'){for(const k of ['enterprise','inbox','query'])bad.o[k][field]=!['isSuccess','isFetchedAfterMount'].includes(field);}else{for(const q of queryPaths){const keys=q.split('.');let x=bad;for(const key of keys)x=x[key];if(x&&typeof x==='object')x[field]=!['isSuccess','isFetchedAfterMount'].includes(field);}}
   const checked=executePrelude(f,bad);assert.equal(checked.result.ready,false,field+' fails closed '+f.family+':'+f.function);negative.push(field);
  }
  if(f.prelude.includes('__NIUseBusinessScope')){const {env:bad}=readyEnvironment(f);bad.__NIUseBusinessScope=()=>({...business,storageScope:'different-current',contextVerification:{state:'verified',identity:'old-scope'}});assert.equal(executePrelude(f,bad).result.ready,false,'original identity generation barrier');negative.push('identity switch');}
  tests.push({family:f.family,function:f.function,status:'PASS',sharedHookCalls:1,displayedRefs:rows.map(r=>f.prefix+':'+r.id),realRenderedWitnesses:rendered,negativeStates:negative,pageLocalSort:true});console.log('PASS',f.family+':'+f.function,negative.join(','));
 }
 const html=read(out+'/index.html'),map=JSON.parse(html.match(/<script[^>]*type="importmap"[^>]*>([\s\S]*?)<\/script>/)[1]);assert.equal(H(html),manifest.finalHtmlSha256);const nav=JSON.parse(read(D+'/static-navigation/manifest.json'));assert.equal(manifest.navigation.navURL,nav.navURL,'latest final nav');
 const baseMap=JSON.parse(read(D+'/static-navigation/index.html').match(/<script[^>]*type="importmap"[^>]*>([\s\S]*?)<\/script>/)[1]);
 for(const m of manifest.modules){
  const s=read(manifest.assets.find(a=>a.url===m.newURL).local);assert.equal(H(s),m.afterSha256);
  assert(s.includes('newInformationBridge();'),'actual compiled native runtime bridge');assert(s.includes(JSON.stringify(nav.navURL)),'latest singleton nav import');
  assert.equal((s.match(/getAdminNewInformationRuntime/g)||[]).length,0,'leaf cannot initialize Context');
  for(const spec of specs(read(m.baselineLocal))){const previous=resolve(spec,m.actualtargetURL,baseMap);assert.equal(resolve(spec,m.newURL,map),manifest.updatedMappings[previous]??previous);}
 }
 for(const[f,h]of Object.entries(manifest.sourceHashes))assert.equal(H(fs.readFileSync(f)),h,'final source freeze');
 manifest.tests={status:'PASS_COMPILED_ROW_AND_LIST_BARRIER_FIXTURES',fixtures:tests.length,tests,scope:'stub native React/query metadata and DOM-shaped row witnesses; no browser/network/business writes; actual compiled row renderer executed'};fs.writeFileSync(out+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');fs.writeFileSync(out+'/test-results.json',JSON.stringify(manifest.tests,null,2)+'\n');console.log('PASS ALL',tests.length,'compiled actual row fixtures');
}catch(error){fs.writeFileSync(out+'/test-results.json',JSON.stringify({status:'FAIL',passed:tests,error:String(error),stack:error.stack},null,2)+'\n');console.error(error.stack);process.exitCode=1;}
