#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
import {build,transform} from 'esbuild';
import {parse,nodes,read} from './build-admin-mapping.mjs';
import {patchOriginalNavigation} from './patch-admin-layout-navigation.mjs';
const R='/home/ubuntu/work/manager',O='/home/ubuntu/task-recovery/inquiry-reception-release-20261113/admin-static',L='/home/ubuntu/task-recovery/inquiry-reception-release-20261113/live/admin-static';
const audit=JSON.parse(read(O+'/baseline-runtime-audit.json'));
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const assert=(v,m)=>{if(!v)throw Error(m)};
const write=(f,x)=>{fs.mkdirSync(path.dirname(O+'/'+f),{recursive:true});fs.writeFileSync(O+'/'+f,typeof x==='string'?x:JSON.stringify(x,null,2)+'\n')};
const mappings=Object.fromEntries(['ChatPage','BusinessWorkbenchPage','OfficialChannelInventory'].map(k=>[k,JSON.parse(read(O+'/mapping-'+k+'.json'))]));
function aliases(label,overrides={}){return {...Object.fromEntries(Object.entries(mappings[label].ranked).filter(([k,v])=>v.length).map(([k,v])=>[k,v[0][0]])),...overrides};}
const chat=aliases('ChatPage',{readMarketQuoteChatDraft:'Yy',useLocation:'on',QueryClientProvider:'li',useEnterpriseSession:'kf',InquiryEnterpriseChooserDialog:'m0',NOTO_CHAT_STICKERS:'Mf',chatNotoPackIcon:'Df',chatEmojiPackIcon:'T0',chatYayatuanPackIcon:'U0',chatBusinessPackIcon:'q0',chatStickerPickerIcon:'L0',MallLoginDialog:'Ou',Combine:'Vg',Copy:'ef',ImageIcon:'Fg',RotateCcw:'wd',EnterpriseScopedChatPage:'Fv',ChatPage:'Av'});
const wb=aliases('BusinessWorkbenchPage',{BusinessScopeProvider:'Oy',BusinessContentFrame:'Zs',ChannelInventoryHost:'__admin_workbench_host_v1.default',BusinessChatRoute:'QI',BusinessContextVerificationBoundary:'XI',BusinessWorkbenchPage:'zP',OFFICIAL_ZHIJIE_MERCHANT_ID:'vo'});
const official=aliases('OfficialChannelInventory',{readOfficialStock:'Yn',Plus:'vn',OfficialInventoryReception:null,officialReceptionDescription:null});
const sourceFiles=[],bridgeProof=[];
function source(f){const file=R+'/client/src/'+f;sourceFiles.push({file,sha256:sha(read(file))});return read(file);}
function subset(file,label,selected,overrides={}){
 const s=source(file),a=ts.createSourceFile(file,s,99,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS),map={...(label?({ChatPage:chat,BusinessWorkbenchPage:wb,OfficialChannelInventory:official}[label]):{}),...overrides};
 let text='';for(const n of a.statements){if(ts.isImportDeclaration(n)||ts.isInterfaceDeclaration(n)||ts.isTypeAliasDeclaration(n)){text+=n.getText(a)+'\n';continue;}
 if(ts.isFunctionDeclaration(n)||ts.isClassDeclaration(n)){const name=n.name?.text;if(selected.includes(name))text+=n.getText(a).replace(/^export default /,'').replace(/^export /,'')+'\n';else if(map[name])text+=`const ${name}=__live.${name};\n`;continue;}
 if(ts.isVariableStatement(n)){for(const d of n.declarationList.declarations){const name=d.name.getText(a);if(selected.includes(name))text+=`const ${d.getText(a)};\n`;else if(map[name])text+=`const ${name}=__live.${name};\n`;}}
 }
 text+='export {'+selected.filter(n=>!['ReceptionObserverContext'].includes(n)).join(',')+'};\n';return {file:R+'/client/src/'+file,text,map};
}
const chatEntry=subset('business/platform/client/src/pages/ChatPage.tsx','ChatPage',['ChatPageContent']);
const wbSelect=['BusinessChatRoute','BusinessRoutes','ReceptionNavigationUnread','VerifiedBusinessWorkbench','BusinessContextGate','ScopedBusinessWorkbench','BusinessWorkbenchDiscovery','BusinessWorkbenchContent','SessionBusinessWorkbenchContent','BusinessReceptionNavigationBadge','ReceptionObserverContext','AccessState','BusinessLoadingState','BusinessContextVerificationBoundary'];
const wbEntry=subset('business/BusinessWorkbenchPage.tsx','BusinessWorkbenchPage',wbSelect);
const officialEntry=subset('pages/OfficialChannelInventory.tsx','OfficialChannelInventory',['OfficialChannelInventory','Pager']);
let scopeText=source('business/BusinessScope.tsx').replace(/const BusinessScopeContext = createContext<BusinessScopeValue \| null>\(null\);/,'const BusinessScopeContext=__live.BusinessScopeContext;').replace(/let activeStorageScope: string \| null = null;/,'').replace(/\bactiveStorageScope\b/g,'__live.scope.current');
let sessionText=source('business/BusinessWorkbenchSession.ts');const sessionAst=ts.createSourceFile('session.ts',sessionText,99,true,ts.ScriptKind.TS);sessionText='const businessQueryClientConsumers=new WeakMap();\n'+sessionAst.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='retainBusinessQueryClient').getText(sessionAst);
 sessionText+='\n'+['BUSINESS_CONTEXT_STALE_TIME','createBusinessRequestCancellation','isBusinessAuthorizationError','isBusinessSecurityError','resetBusinessWorkbenchSessionsForTests','useBusinessWorkbenchSession'].map(n=>`export const ${n}=__live.${n};`).join('\n');
const virtual=new Map([[chatEntry.file,chatEntry.text],[wbEntry.file,wbEntry.text],[officialEntry.file,officialEntry.text],[R+'/client/src/business/BusinessScope.tsx',scopeText],[R+'/client/src/business/BusinessWorkbenchSession.ts',sessionText]]);
const special=new Set(['business/InquiryReception.tsx','business/useInquiryReception.ts','business/InquiryReceptionModel.ts','business/BusinessChatContract.ts','components/OfficialInventoryReception.tsx']);
const usedBridges=new Map();
function bridgeContent(importer,spec){let conf=importer.includes('Official')?official:importer.endsWith('ChatPage.tsx')?chat:wb;let data={};
 if(spec==='react')return 'export default __live.React;export const {Children,Component,Fragment,Suspense,lazy,createElement,forwardRef,createContext,useContext,useState,useEffect,useLayoutEffect,useMemo,useRef,useCallback,useSyncExternalStore}=__live.React;';
 if(spec==='react/jsx-runtime')return 'export const {jsx,jsxs,Fragment}=__live.jsx;';
 if(spec==='@tanstack/react-query')return 'export const QueryClient=__live.QueryClient,QueryClientProvider=__live.QueryClientProvider,useQuery=__live.useQuery;';
 const all=[...mappings.ChatPage.imports,...mappings.BusinessWorkbenchPage.imports,...mappings.OfficialChannelInventory.imports];
 if(importer.endsWith('InquiryReception.tsx'))conf={...chat,ArrowLeft:'am',Search:'pr',RefreshCw:'di',Info:'ig',Volume2:'dg',VolumeX:'mg',X:'vt',BusinessContentFrame:'Zs'};
 if(importer.endsWith('useInquiryReception.ts'))conf={trpc:'H',useBusinessScope:'Qa'};
 if(importer.endsWith('BusinessScope.tsx'))conf={setPageMemoryScope:'Od'};
 if(importer.endsWith('OfficialInventoryReception.tsx'))conf=official;
 // Resolve source import spelling through AST: never infer export names from a minified module.
 const content=virtual.get(importer)??read(importer);const a=ts.createSourceFile(importer,content,99,true,importer.endsWith('tsx')?4:3);
 const decl=a.statements.find(n=>ts.isImportDeclaration(n)&&n.moduleSpecifier.text===spec);assert(decl,'BRIDGE_IMPORT_DECL:'+importer+':'+spec);
 const items=[];if(decl.importClause?.name)items.push({name:decl.importClause.name.text,export:'default'});
 for(const n of decl.importClause?.namedBindings?.elements??[])if(!n.isTypeOnly)items.push({name:n.name.text,export:n.propertyName?.text??n.name.text});
 for(const n of items){let binding=conf[n.name];if(spec.includes('BusinessContentFrame'))binding='Zs';if(spec.includes('ChatPage'))binding='Av';if(spec.includes('business-trpc')&&n.name==='trpc')binding='H';if(spec.includes('BusinessScope')&&!spec.includes('scope-trpc'))binding=n.name==='BusinessScopeProvider'?'Oy':n.name==='useBusinessScope'?'Qa':null;if(n.name==='retainBusinessQueryClient')binding='retainBusinessQueryClient';
 if(!binding)data[n.export]='/* @__PURE__ */ (()=>__MISSING_'+n.name+')()';else{data[n.export]='__live.'+n.name;usedBridges.set(n.name,{name:n.name,binding,importer,spec});}}
 return Object.entries(data).map(([k,v])=>k==='default'?`export default ${v};`:`export const ${k}=${v};`).join('\n');
}
async function compile(mode){usedBridges.clear();const entry=mode==='workbench'?`export {ChatPageContent} from ${JSON.stringify(chatEntry.file)};export {BusinessScopeProvider} from ${JSON.stringify(R+'/client/src/business/BusinessScope.tsx')};export {retainBusinessQueryClient} from ${JSON.stringify(R+'/client/src/business/BusinessWorkbenchSession.ts')};export {${wbSelect.filter(n=>n!=='ReceptionObserverContext').join(',')}} from ${JSON.stringify(wbEntry.file)};`: `export {OfficialChannelInventory,Pager} from ${JSON.stringify(officialEntry.file)};`;
 const result=await build({stdin:{contents:entry,resolveDir:R,sourcefile:'admin-reception-'+mode+'.mjs'},bundle:true,write:false,format:'iife',globalName:'__exports',platform:'browser',target:'es2020',minify:true,jsx:'automatic',metafile:true,plugins:[{name:'audited-live-lexical-import-cutoff',setup(b){
 b.onResolve({filter:/.*/},args=>{if(args.kind==='entry-point')return;const spec=args.path,importer=args.importer;
 if(virtual.has(spec))return{path:spec,namespace:'source'};
 if(spec.includes('/node_modules/lucide-react/'))return{path:spec,namespace:'iconlib'};
 if(args.namespace==='iconlib'&&spec!=='react')return{path:path.resolve(path.dirname(importer),spec),namespace:'iconlib'};
 if(spec==='lucide-react'&&importer.endsWith('InquiryReception.tsx'))return{path:'reception-new-icons',namespace:'newicons'};
 if(spec==='xlsx')return{path:path.posix.dirname(audit.official[0].url)+'/xlsx-DGuHH-KN.js',external:true};
 if(spec.startsWith(R+'/client/src/')&&special.has(spec.slice((R+'/client/src/').length)))return{path:spec,namespace:'source'};
 if(spec.endsWith('.css'))return{path:spec,namespace:'empty'};
 let abs=spec.startsWith('@/')?R+'/client/src/'+spec.slice(2):spec.startsWith('.')?path.resolve(path.dirname(importer),spec):null;
 if(abs){const found=[abs,abs+'.tsx',abs+'.ts',abs+'/index.ts'].find(f=>virtual.has(f)||fs.existsSync(f));if(found&&special.has(found.slice((R+'/client/src/').length)))return{path:found,namespace:'source'};if(found&&virtual.has(found)&&!found.endsWith('BusinessScope.tsx')&&!found.endsWith('ChatPage.tsx'))return{path:found,namespace:'source'};}
 if(mode==='workbench'&&/EnterpriseInquiryInbox$/.test(spec))return{path:'inbox',namespace:'inbox'};
 return{path:JSON.stringify({importer,spec}),namespace:'bridge'};});
 b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'',loader:'js'}));
 b.onLoad({filter:/.*/,namespace:'newicons'},()=>({contents:`export {default as Info} from "${R}/node_modules/lucide-react/dist/esm/icons/info.js";export {default as Volume2} from "${R}/node_modules/lucide-react/dist/esm/icons/volume-2.js";export {default as VolumeX} from "${R}/node_modules/lucide-react/dist/esm/icons/volume-x.js";export const ArrowLeft=__live.ArrowLeft,RefreshCw=__live.RefreshCw,Search=__live.Search,X=__live.X;`,loader:'js'}));
 b.onResolve({filter:/\/node_modules\/lucide-react\//},args=>({path:args.path,namespace:'iconlib'}));
 b.onLoad({filter:/.*/,namespace:'iconlib'},args=>({contents:read(args.path),loader:'js',resolveDir:path.dirname(args.path)}));
 b.onLoad({filter:/.*/,namespace:'inbox'},()=>({contents:`import InquiryReception from ${JSON.stringify(R+'/client/src/business/InquiryReception.tsx')}; export default InquiryReception;`,loader:'js'}));
 b.onLoad({filter:/.*/,namespace:'source'},args=>({contents:virtual.get(args.path)??source(args.path.slice((R+'/client/src/').length)),loader:args.path.endsWith('tsx')?'tsx':'ts',resolveDir:path.dirname(args.path)}));
 b.onLoad({filter:/.*/,namespace:'bridge'},args=>{const x=JSON.parse(args.path);return{contents:bridgeContent(x.importer,x.spec),loader:'js'}});
 }}]});
 const code=result.outputFiles[0].text;assert(!code.includes('__MISSING_'),'UNPROVEN_BINDING:'+code.match(/__MISSING_\w+/g));assert(result.outputFiles.length===1,'SINGLE_FACTORY');
 const localMap=mode==='workbench'?{...chat,...wb,ArrowLeft:'am',RefreshCw:'di',Search:'pr',BusinessScopeContext:'hf',QueryClient:'Ex',QueryClientProvider:'li',useQuery:'__NATIVE_USE_QUERY__',setPageMemoryScope:'Od'}:{...official,QueryClient:'__UNUSED__',QueryClientProvider:'__UNUSED__',useQuery:'__UNUSED__'};
 const names=new Set([...usedBridges.keys(),...Object.keys(localMap),...Object.keys((mode==='workbench'?chatEntry:officialEntry).map),...(mode==='workbench'?Object.keys(wbEntry.map):[])]);
 const entries=[...names].filter(n=>!['jsx','jsxs','Fragment','React','QueryClient','QueryClientProvider','useQuery','BusinessScopeContext'].includes(n)&&code.includes('__live.'+n)).map(name=>({name,binding:usedBridges.get(name)?.binding??localMap[name]}));for(const n of entries)assert(n.binding,'BINDING:'+n.name);
 const info={mode,code,entries,metafile:result.metafile};write('factory-'+mode+'.js',code);write('factory-'+mode+'.json',{entries,metafile:result.metafile,sha256:sha(code)});return info;
}
function apply(before,edits,id){edits.sort((a,b)=>a.start-b.start||a.end-b.end);for(let i=1;i<edits.length;i++)assert(edits[i].start>=edits[i-1].end,'OVERLAP:'+id);let after='',cursor=0,outEdits=[];for(const e of edits){assert(before.slice(e.start,e.end)===e.before,'CAS:'+e.reason);after+=before.slice(cursor,e.start);const outStart=after.length;after+=e.text;outEdits.push({...e,outStart,outEnd:after.length,beforeSha256:sha(e.before),afterSha256:sha(e.text)});cursor=e.end;}after+=before.slice(cursor);let inverse=after;for(const e of [...outEdits].reverse()){assert(inverse.slice(e.outStart,e.outEnd)===e.text,'INVERSE_CAS');inverse=inverse.slice(0,e.outStart)+e.before+inverse.slice(e.outEnd);}assert(inverse===before,'FULLBYTES_INVERSE');const partitions=[];cursor=0;let offset=0;for(const e of outEdits){const s=before.slice(cursor,e.start),out=after.slice(cursor+offset,e.outStart);assert(s===out,'NONPATCH_PARTITION');partitions.push({start:cursor,end:e.start,sha256:sha(s)});offset+=e.text.length-e.before.length;cursor=e.end;}assert(before.slice(cursor)===after.slice(cursor+offset),'NONPATCH_TAIL');partitions.push({start:cursor,end:before.length,sha256:sha(before.slice(cursor))});const a=parse(after);assert(!a.parseDiagnostics.length,'PARSE_AFTER:'+id);return{after,proof:{id,beforeSha256:sha(before),afterSha256:sha(after),fullbytesInverse:true,partitions,edits:outEdits}};}
const records=[],proofs=[],relocations={};
function saveAsset(prefix,bytes,ext='js'){const h=sha(bytes),relative='assets/'+prefix+'-'+h+'.'+ext;write('candidate/'+relative,bytes);records.push({file:O+'/candidate/'+relative,targetRelative:relative,kind:'asset',sha256:h});return'/'+relative;}
function functions(a){return Object.fromEntries(a.statements.filter(ts.isFunctionDeclaration).map(n=>[n.name.text,n]));}
function factoryInsertion(info,lexical,id){const entries=info.entries.filter(n=>info.code.includes('__live.'+n.name));const obj=entries.map(n=>{let expr=lexical[n.name]??n.binding;return JSON.stringify(n.name)+':'+expr}).join(',');return`\nlet __d51_ir_${id}_instance;function __d51_ir_${id}_get(){if(!__d51_ir_${id}_instance){const __live={React:c,jsx:e,${id==='w'?'QueryClient:Ex,QueryClientProvider:li,useQuery:__d51IRNativeUseQuery,BusinessScopeContext:hf,scope:{get current(){return il},set current(v){il=v}},':''}${obj}};${info.code}\n__d51_ir_${id}_instance=__exports;}return __d51_ir_${id}_instance;}\n`;}
async function main(){
 if(process.argv.includes('--layout-only')||fs.existsSync(O+'/core-frozen-manifest.json')){
  const frozen=JSON.parse(read(O+'/core-frozen-manifest.json'));
  for(const record of frozen.records)assert(sha(fs.readFileSync(record.file))===record.sha256,'FROZEN_CORE_HASH:'+record.file);
  for(const pin of frozen.sourceFiles)assert(sha(read(pin.file))===pin.sha256,'FROZEN_CORE_SOURCE:'+pin.file);
  records.push(...frozen.records);proofs.push(...frozen.proofs);Object.assign(relocations,frozen.relocations);sourceFiles.push(...frozen.sourceFiles);
  await layoutAndHtml();write('files.admin-static.json',records);write('build-admin-proof.json',{status:'BUILT',offlineOnly:true,buildMode:'stable-frozen-core-layout-only',sourceFiles:[...new Map(sourceFiles.map(x=>[x.file,x])).values()],relocations,proofs,limitations:['No deployment, browser, SSH or database used. Core candidate bytes frozen against existing actual 18 PASS; Official verification recorded separately.']});console.log(JSON.stringify({status:'BUILT',buildMode:'stable-frozen-core-layout-only',files:records.length,relocations}));return;
 }
 const w=await compile('workbench');const off=await compile('official');
 // Native useQuery is located by the actual QueryClient runtime module's AST export.
 const mainUrl='/assets/20261106-one-click-review-images-v11-admin-4ebf4856da0f/index-demand-navigation-bb20946d992bbfe5.js';const main=read(L+mainUrl),mainAst=parse(main);const queryDecl=mainAst.statements.filter(ts.isFunctionDeclaration).find(n=>n.getText(mainAst).includes('queryObserver')&&n.getText(mainAst).includes('useBaseQuery'));
 const nativeFn=nodes(mainAst,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='zS')[0];assert(nativeFn&&nativeFn.getText(mainAst)==='function zS(n,r){return _o(n,Ll,r)}','NATIVE_USE_QUERY_WRAPPER');
 const nativeBase=nodes(mainAst,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='_o')[0];assert(nativeBase&&nativeBase.getText(mainAst).includes('_optimisticResults')&&nativeBase.getText(mainAst).includes('useSyncExternalStore'),'NATIVE_USE_QUERY_BASE');
 const nativeExport=mainAst.statements.filter(ts.isExportDeclaration).flatMap(n=>n.exportClause?.elements??[]).find(n=>n.propertyName?.text==='zS');let nativeUseQuery=nativeExport?.name.text;
 // Candidate closure proof resolves the original native useQuery alias; fail rather than bundling a second query implementation.
 write('native-query-search.json',{queryDecl:queryDecl?.name.text,functions:mainAst.statements.filter(ts.isFunctionDeclaration).filter(n=>/QueryObserver|useBaseQuery/.test(n.getText(mainAst))).map(n=>({name:n.name.text,text:n.getText(mainAst).slice(0,600)}))});
 assert(nativeUseQuery,'NATIVE_USE_QUERY_EXPORT_NOT_YET_RESOLVED');
 for(let idx=0;idx<2;idx++){const target=audit.runtime.filter(x=>x.chatContent)[idx],before=read(target.file),a=parse(before),f=functions(a),edits=[];const add=(n,text)=>edits.push({start:n.getStart(a),end:n.end,before:n.getText(a),text,reason:'source-function:'+n.name.text});
 for(const [name,newName]of Object.entries({Oy:'BusinessScopeProvider',QI:'BusinessChatRoute',VI:'BusinessRoutes',Sx:'VerifiedBusinessWorkbench',JI:'BusinessContextGate',ZI:'ScopedBusinessWorkbench',eP:'BusinessWorkbenchDiscovery',sP:'BusinessWorkbenchContent',tP:'SessionBusinessWorkbenchContent'}))add(f[name],`function ${name}(...args){return __d51_ir_w_get().${newName}(...args)}`);
 add(f.Po,`function Po(props){if(props.receptionConversation)return __d51_ir_w_get().ChatPageContent(props);return __d51_ir_legacy_chat(props)}\n`+f.Po.getText(a).replace(/^function Po\(/,'function __d51_ir_legacy_chat('));
 const side=factoryInsertion(w,{retainBusinessQueryClient:'__d51_ir_w_get().retainBusinessQueryClient'},'w').replace('retainBusinessQueryClient:__d51_ir_w_get().retainBusinessQueryClient,','');edits.push({start:0,end:0,before:'',text:`import {${nativeUseQuery} as __d51IRNativeUseQuery} from ${JSON.stringify(mainUrl)};\n`+side,reason:'local-source-factory-and-native-query-bridge'});
 edits.push({start:before.length,end:before.length,before:'',text:'\nexport function BusinessReceptionNavigationBadge(){return __d51_ir_w_get().BusinessReceptionNavigationBadge()}\n',reason:'new-badge-export-keep-original-export-binding'});
 const p=apply(before,edits,'workbench-'+idx),url=saveAsset('BusinessWorkbenchPage-inquiry-reception-'+idx,p.after);proofs.push(p.proof);relocations[target.url]=url;
 }
 const target=audit.official[0],before=read(L+target.url),a=parse(before),f=functions(a),edits=[];for(const [name,method]of [['La','OfficialChannelInventory'],['Nn','Pager']])edits.push({start:f[name].getStart(a),end:f[name].end,before:f[name].getText(a),text:`function ${name}(...args){return __d51_ir_o_get().${method}(...args)}`,reason:'official-source-function:'+name});edits.push({start:0,end:0,before:'',text:factoryInsertion(off,{},'o'),reason:'official-local-factory'});const p=apply(before,edits,'official'),u=saveAsset('OfficialChannelInventory-inquiry-reception',p.after);proofs.push(p.proof);relocations[target.url]=u;
 await layoutAndHtml();write('files.admin-static.json',records);write('build-admin-proof.json',{status:'BUILT',offlineOnly:true,sourceFiles:[...new Map(sourceFiles.map(x=>[x.file,x])).values()],relocations,proofs,limitations:['No deployment, browser, SSH or database used. Runtime verification is recorded separately.']});console.log(JSON.stringify({status:'BUILT',files:records.length,relocations}));
}
async function layoutAndHtml(){
 const target=audit.runtime.find(x=>x.url.includes('DashboardLayout')),before=read(target.file),a=parse(before),badges=nodes(a,n=>ts.isPropertyAssignment(n)&&n.name.getText(a)==='renderBadge');assert(badges.length===1&&badges[0].initializer.getText(a)==='R','LAYOUT_RENDER_BADGE');
 const activeW=audit.runtime.filter(x=>x.chatContent)[1],url=relocations[activeW.url];
 const init=`\nconst __d51_ir_layout_lazy=c.lazy(()=>import(${JSON.stringify(url)}).then(m=>({default:m.BusinessReceptionNavigationBadge})));function __d51_ir_layout_badge(){return a.jsx(c.Suspense,{fallback:null,children:a.jsx(__d51_ir_layout_lazy,{})})}\n`;
 const edits=[{start:0,end:0,before:'',text:init,reason:'lazy-badge-original-React-no-eager-module-cycle'},{start:badges[0].initializer.getStart(a),end:badges[0].initializer.end,before:'R',text:'item=>item.path==="/workbench/inquiries"?a.jsx(__d51_ir_layout_badge,{}):R(item)',reason:'inquiry-badge-only-original-renderBadge-fallback'}];
 const navSource=source('components/admin/AdminWorkspaceNavigation.tsx'),navModel=source('components/admin/adminWorkspaceNavigationModel.ts');
 edits.push(...patchOriginalNavigation(before,a,navSource,navModel));
 const p=apply(before,edits,'layout'),newUrl=saveAsset('DashboardLayout-inquiry-reception',p.after);proofs.push(p.proof);relocations[target.url]=newUrl;
 const receptionCSS=(await transform(source('business/InquiryReception.css'),{loader:'css',minify:true})).code;
 const navigationSource=source('components/admin/AdminWorkspaceNavigation.css');
 const navigationRules=[...navigationSource.matchAll(/\.admin-workspace-nav \.inquiry-reception-nav-badge\s*\{[^{}]*\}/g)];
 assert(navigationRules.length===1,'EXACT_INQUIRY_NAV_BADGE_SELECTOR');
 const liveNavigationRule=navigationRules[0][0].replace('.admin-workspace-nav .inquiry-reception-nav-badge','.admin-workspace-nav .inquiry-reception-nav-badge, [data-admin-navigation="unified-dropdown"] .inquiry-reception-nav-badge');
 const navigationCSS=(await transform(liveNavigationRule,{loader:'css',minify:true})).code;
 const css=receptionCSS+navigationCSS,cssUrl=saveAsset('inquiry-reception',css,'css');
 write('navigation-css-proof.json',{sourceFile:R+'/client/src/components/admin/AdminWorkspaceNavigation.css',sourceSha256:sha(navigationSource),sourceSelector:navigationRules[0][0],compiledSelector:navigationCSS,receptionCSSSha256:sha(receptionCSS),candidateCSSSha256:sha(css),candidateCSSUrl:cssUrl,scope:'Only inquiry navigation badge selector appended; all other original admin layout CSS remains byte-identical.'});
 const html=read(L+'/index.html'),match=[...html.matchAll(/<script\b[^>]*type=["']importmap["'][^>]*>(.*?)<\/script>/gs)];assert(match.length===1,'IMPORTMAP_SINGLE');const oldMap=JSON.parse(match[0][1]),map=structuredClone(oldMap);
 const origin='https://offline.invalid',canon=(spec,ref)=>new URL(spec,origin+ref).pathname;
 function resolve(spec,ref,m){const key=spec.startsWith('/')||spec.startsWith('.')?canon(spec,ref):spec;for(const section of [...Object.keys(m.scopes??{}).filter(s=>ref.startsWith(s)).sort((x,y)=>y.length-x.length).map(s=>m.scopes[s]),m.imports]){if(Object.hasOwn(section,key))return section[key];}return key;}
 for(const section of [map.imports,...Object.values(map.scopes??{})])for(const [k,v]of Object.entries(section))if(relocations[v])section[k]=relocations[v];
 for(const [oldUrl,newUrl]of Object.entries(relocations)){map.imports[oldUrl]=newUrl;const oldText=read(L+oldUrl),ast=parse(oldText);const specs=nodes(ast,n=>(ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier||ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword).map(n=>n.moduleSpecifier??n.arguments[0]).filter(ts.isStringLiteral).map(n=>n.text);const sec={...(map.scopes?.[oldUrl]??{})};for(const spec of specs){const oldTarget=resolve(spec,oldUrl,oldMap);sec[canon(spec,newUrl)]=relocations[oldTarget]??oldTarget;}map.scopes??={};map.scopes[newUrl]=sec;}
 const resolutionProof=[];for(const [oldUrl,newUrl]of Object.entries(relocations)){const ast=parse(read(L+oldUrl));for(const n of nodes(ast,n=>ts.isImportDeclaration(n)&&n.moduleSpecifier)){const spec=n.moduleSpecifier.text,oldTarget=resolve(spec,oldUrl,oldMap),after=resolve(spec,newUrl,map),expected=relocations[oldTarget]??oldTarget;assert(after===expected,'IMPORT_RELOCATION:'+spec);resolutionProof.push({oldRef:oldUrl,newRef:newUrl,spec,oldTarget,target:after});}}
 for(const [k,v]of Object.entries(oldMap.imports))assert(map.imports[k]===(relocations[v]??v),'OLD_IMPORT_KEY');for(const [s,sec]of Object.entries(oldMap.scopes))for(const [k,v]of Object.entries(sec))assert(map.scopes[s][k]===(relocations[v]??v),'OLD_SCOPE_KEY');
 const cssTag=`<link rel="stylesheet" href="${cssUrl}" data-inquiry-reception="20261113">\n`;const after=html.replace(match[0][1],JSON.stringify(map)).replace('</head>',cssTag+'</head>');assert(after.replace(JSON.stringify(map),match[0][1]).replace(cssTag,'')===html,'HTML_INVERSE_FULLBYTES');write('candidate/index.html',after);records.push({file:O+'/candidate/index.html',targetRelative:'index.html',kind:'html',sha256:sha(after),beforeSha256:sha(html)});write('html-relocation-proof.json',{beforeSha256:sha(html),afterSha256:sha(after),fullbytesInverse:true,oldKeysScopesOrderRetained:true,resolutionProof,oldMap,map});
}
main().catch(e=>{write('build-admin-error.json',{error:e.stack});console.error(e.stack);process.exitCode=1});
