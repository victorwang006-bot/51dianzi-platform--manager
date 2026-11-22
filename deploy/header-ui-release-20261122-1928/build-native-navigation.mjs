#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const O=path.dirname(new URL(import.meta.url).pathname), W=path.dirname(O);
const R='/home/ubuntu/work/channel-release-20261121-1837/manager';
const capture=process.argv[2]??W+'/capture';
const req=createRequire(R+'/package.json'), ts=req('typescript'), esbuild=req('esbuild');
const H=x=>crypto.createHash('sha256').update(x).digest('hex');
const J=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const scope='header-ui-release-20261122-1928';
const sourcePins={}, allowedSource=[], exclusions=[];
function pin(p){const full=path.resolve(R,p);sourcePins[full]=H(fs.readFileSync(full));if(!allowedSource.includes(full))allowedSource.push(full);return full;}
const parse=(s,kind=ts.ScriptKind.JS)=>{const a=ts.createSourceFile('input',s,ts.ScriptTarget.Latest,true,kind);assert.equal(a.parseDiagnostics.length,0,'syntax diagnostics');return a;};
function nodes(n,f){const out=[];function v(x){if(f(x))out.push(x);ts.forEachChild(x,v);}v(n);return out;}
const one=(xs,label)=>{assert.equal(xs.length,1,label);return xs[0];};
function prune(p,s){
 const a=parse(s,ts.ScriptKind.TSX),drops=[];
 if(p.endsWith('/AdminWorkspaceNavigation.tsx')){
  for(const n of a.statements){
   if(ts.isImportDeclaration(n)&&n.moduleSpecifier.text==='./InquiryReceptionNavigationBadge')drops.push(n);
   if(ts.isFunctionDeclaration(n)&&n.name?.text==='ModuleTabs')drops.push(n);
  }
  assert.equal(drops.length,2,'only unused badge import and ModuleTabs pruned');
  assert(s.includes('export { WorkspaceTabs as AdminWorkspaceTabs, ModuleTabs as AdminModuleTabs };'));
  s=s.replace('export { WorkspaceTabs as AdminWorkspaceTabs, ModuleTabs as AdminModuleTabs };','export { WorkspaceTabs as AdminWorkspaceTabs };');
 }else if(p.endsWith('/adminWorkspaceNavigationModel.ts')){
  for(const n of a.statements){
   if(ts.isImportDeclaration(n)&&n.moduleSpecifier.text==='@shared/adminPermissions')drops.push(n);
   if(ts.isFunctionDeclaration(n)&&n.name?.text==='hasAdminChannelInventoryRead')drops.push(n);
  }
  assert.equal(drops.length,2,'unused permission projection excluded; native grants remain original');
 }
 for(const n of drops.sort((a,b)=>b.getStart()-a.getStart())){const start=n.getStart(a),end=n.end;exclusions.push({source:p,start,end,sha256:H(s.slice(start,end)),name:n.name?.text??n.moduleSpecifier?.text,reason:'Unused export/import removed in memory only; never compiled business code'});s=s.slice(0,start)+s.slice(end);}
 return s;
}
const permitted=new Set([
 'client/src/components/admin/AdminWorkspaceNavigation.tsx',
 'client/src/components/admin/adminWorkspaceNavigationModel.ts',
 'client/src/components/admin/adminWorkbenchNavigationModel.ts',
 'client/src/components/admin/adminListLocationLayout.ts',
 'client/src/lib/channelInventoryNavigation.ts',
 'client/src/lib/salesOrderWorkspace.ts',
 'client/src/lib/adminWorkspaceDropdownWidth.ts',
 'client/src/lib/adminHeaderNavigationLayout.ts',
 'shared/beijingTime.ts'
]);
const virtual={react:'export const {useEffect,useLayoutEffect,useId,useRef,useState}=__live.React;', 'react/jsx-runtime':'export const {jsx,jsxs,Fragment}=__live.jsx;'};
fs.mkdirSync(O+'/assets',{recursive:true});
const result=await esbuild.build({absWorkingDir:R,stdin:{contents:'export {WorkspaceTabs,AdminWorkspaceTabs} from "./client/src/components/admin/AdminWorkspaceNavigation.tsx";',resolveDir:R,sourcefile:'header-navigation-entry.ts',loader:'ts'},bundle:true,write:false,format:'iife',globalName:'__AdminHeaderNavigationExports',platform:'browser',target:'es2020',jsx:'automatic',minify:false,metafile:true,legalComments:'none',plugins:[{name:'strict-navigation-source-and-native-bridge',setup(b){
 b.onResolve({filter:/.*/},a=>{
  if(virtual[a.path])return{path:a.path,namespace:'native'};
  if(a.path.endsWith('.css'))return{path:a.path,namespace:'excluded-css'};
  assert(!/InquiryReceptionNavigationBadge|businessScope|trpc|react-query|react-dom/i.test(a.path),'business/provider import refused: '+a.path);
  let base=a.path.startsWith('@shared/')?R+'/shared/'+a.path.slice(8):a.path.startsWith('@/')?R+'/client/src/'+a.path.slice(2):a.path.startsWith('.')?path.resolve(a.resolveDir,a.path):null;
  assert(base,'package import refused: '+a.path);
  const full=[base,base+'.ts',base+'.tsx',base+'/index.ts',base+'/index.tsx'].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
  assert(full,'unresolved '+a.path);assert(permitted.has(path.relative(R,full)),'non-navigation source refused '+full);
  return{path:full};
 });
 b.onLoad({filter:/.*/,namespace:'native'},a=>({contents:virtual[a.path],loader:'js'}));
 b.onLoad({filter:/.*/,namespace:'excluded-css'},()=>({contents:'',loader:'js'}));
 b.onLoad({filter:/\.[jt]sx?$/,namespace:'file'},a=>{pin(a.path);return{contents:prune(a.path,fs.readFileSync(a.path,'utf8')),loader:a.path.endsWith('.tsx')?'tsx':'ts'};});
}}]});
const runtime='export function createAdminHeaderNavigation(__live){\nif(!__live?.React?.useLayoutEffect||!__live?.jsx?.jsx||!__live?.jsx?.jsxs)throw new Error("native React/JSX bridge required");\n'+result.outputFiles[0].text+'\nreturn __AdminHeaderNavigationExports;\n}\n';
parse(runtime);assert(!/new QueryClient|createTRPCReact|AdminNewInformation|InquiryReceptionNavigationBadge/.test(runtime));
assert(runtime.includes('getAdminHeaderNavigationLayout'));
const assets=[];
function save(prefix,b,ext='js'){const sha256=H(b),url='/assets/'+prefix+'-'+sha256+'.'+ext,local=O+'/assets/'+path.basename(url);fs.writeFileSync(local,b);assets.push({side:'admin',url,local,sha256,size:Buffer.byteLength(b)});return url;}
const runtimeURL=save('AdminHeaderNavigation-'+scope,runtime);
fs.writeFileSync(O+'/bundle-metafile.json',JSON.stringify(result.metafile,null,2)+'\n');
const navCss=pin('client/src/components/admin/AdminWorkspaceNavigation.css');
const listCss=pin('client/src/components/admin/AdminListPage.css');
const cssURL=save('AdminHeaderNavigation-'+scope,fs.readFileSync(navCss),'css');
// Supplied separately: parent decides whether to append unchanged AdminListPage CSS.
const listCssURL=save('AdminListPage-source-'+scope,fs.readFileSync(listCss),'css');
const records=J(capture+'/records.json'),env=J(capture+'/environment.json');
const navs=[...new Set(Object.entries(env.adminImports).filter(([k,v])=>(k+v).includes('DashboardLayout')).map(([,v])=>v))];
const beforeURL=one(navs,'single current resolved native Dashboard');
const rec=one(Object.values(records).filter(r=>r.path.endsWith(beforeURL)),'current Dashboard record');
const beforeBytes=fs.readFileSync(rec.local),before=beforeBytes.toString('utf8');assert.equal(H(beforeBytes),rec.sha256);
assert.equal(Buffer.compare(Buffer.from(before),beforeBytes),0,'lossless UTF8 input');
const a=parse(before);
const init=one(nodes(a,n=>ts.isVariableDeclaration(n)&&n.name?.text==='__NI'),'native singleton declaration');
assert(ts.isCallExpression(init.initializer));
const live=init.initializer.arguments[0];assert(ts.isObjectLiteralExpression(live));
const aliases={};for(const key of ['React','jsx'])aliases[key]=one(live.properties.filter(p=>p.name?.text===key),'native '+key+' alias').initializer.getText(a);
let initStmt=init;while(initStmt.parent&&!ts.isVariableStatement(initStmt))initStmt=initStmt.parent;assert(ts.isVariableStatement(initStmt));
const singletonImport=one(a.statements.filter(n=>ts.isImportDeclaration(n)&&n.importClause?.getText(a).includes('__NICreate')),'NI factory import retained');
const header=one(nodes(a,n=>ts.isCallExpression(n)&&n.arguments[0]?.text==='header'&&n.arguments[1]?.properties?.some(p=>p.name?.text==='className'&&p.initializer.text==='admin-workspace-shell__header')),'native header');
const childProp=one(header.arguments[1].properties.filter(p=>p.name?.text==='children'),'header children');
const children=childProp.initializer;assert(ts.isArrayLiteralExpression(children));assert.equal(children.elements.length,4,'brand Tabs Status account exact ABI');
const [logo,tabs,status,account]=children.elements;assert(ts.isCallExpression(tabs)&&ts.isObjectLiteralExpression(tabs.arguments[1]));
assert(ts.isCallExpression(status)&&status.arguments[0].getText(a)==='__NI.AdminNewInformationStatus');assert(ts.isCallExpression(account));
const tabProps=tabs.arguments[1];
for(const key of ['items','location','onNavigate','onPreload','renderBadge'])one(tabProps.properties.filter(p=>p.name?.text===key),'preserved '+key);
assert(!tabProps.properties.some(p=>p.name?.text==='accountMenu'));
assert(!before.includes('__HeaderUICreate')&&!before.includes('__HeaderUINav'));
const oldTabsComponent=tabs.arguments[0].getText(a),accountExpression=account.getText(a),propsExpression=tabProps.getText(a);
const newTabs=tabs.expression.getText(a)+'(__HeaderUINav,'+propsExpression.slice(0,-1)+',accountMenu:'+accountExpression+'})';
const patches=[
 {start:0,end:0,after:'import {createAdminHeaderNavigation as __HeaderUICreate} from '+JSON.stringify(runtimeURL)+';\n',reason:'Independent source-only navigation factory import'},
 {start:initStmt.end,end:initStmt.end,after:'\nconst __HeaderUINav=__HeaderUICreate({React:'+aliases.React+',jsx:'+aliases.jsx+'}).AdminWorkspaceTabs;\n',reason:'Reuse EXACT existing native React and JSX aliases; NI statement unchanged'},
 {start:tabs.getStart(a),end:account.end,after:newTabs,reason:'Replace original Tabs; preserve all original props and account expression; remove standalone Status and account siblings'}
].sort((a,b)=>a.start-b.start);
let shift=0;for(const p of patches){p.before=before.slice(p.start,p.end);p.afterStart=p.start+shift;p.afterEnd=p.afterStart+p.after.length;p.byteStart=Buffer.byteLength(before.slice(0,p.start));p.byteEnd=Buffer.byteLength(before.slice(0,p.end));shift+=p.after.length-p.before.length;}
let after=before;for(const p of [...patches].reverse())after=after.slice(0,p.start)+p.after+after.slice(p.end);
let inverse=after;for(const p of [...patches].reverse()){assert.equal(inverse.slice(p.afterStart,p.afterEnd),p.after);inverse=inverse.slice(0,p.afterStart)+p.before+inverse.slice(p.afterEnd);}
assert.equal(Buffer.compare(Buffer.from(inverse),beforeBytes),0,'full byte inverse');
let cursor=0,afterCursor=0;for(const p of patches){assert.equal(Buffer.compare(Buffer.from(before.slice(cursor,p.start)),Buffer.from(after.slice(afterCursor,p.afterStart))),0,'outside patch bytes');cursor=p.end;afterCursor=p.afterEnd;}assert.equal(before.slice(cursor),after.slice(afterCursor));
const nextAST=parse(after),nextHeader=one(nodes(nextAST,n=>ts.isCallExpression(n)&&n.arguments[0]?.text==='header'),'after header'),nextChildren=one(nextHeader.arguments[1].properties.filter(p=>p.name?.text==='children'),'after header children').initializer;
assert.equal(nextChildren.elements.length,2);assert.equal(nextChildren.elements[0].getText(nextAST),logo.getText(a));
const nextProps=nextChildren.elements[1].arguments[1];assert.equal(one(nextProps.properties.filter(p=>p.name?.text==='accountMenu'),'accountMenu').initializer.getText(nextAST),accountExpression);
for(const p of tabProps.properties)assert.equal(one(nextProps.properties.filter(n=>n.name?.text===p.name?.text),'original prop exact').getText(nextAST),p.getText(a));
assert(after.includes(singletonImport.getText(a)));assert(after.includes(initStmt.getText(a)));
const afterURL=save('DashboardLayout-'+scope,after);
const pinDashboard=R+'/client/src/components/DashboardLayout.tsx';sourcePins[pinDashboard]=H(fs.readFileSync(pinDashboard));
for(const [p,h]of Object.entries(sourcePins))assert.equal(H(fs.readFileSync(p)),h,'sources stayed frozen');
// Offline bridge test: no DOM, network, query client, or site compilation.
const runtimeModule=await import(pathToFileURL(assets.find(x=>x.url===runtimeURL).local).href+'?offline=1');
const fakeHooks={useEffect(){},useLayoutEffect(){},useId(){return 'offline';},useRef(v){return {current:v};},useState(v){return [v,()=>{}];}};
const fakeJSX={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:Symbol.for('react.fragment')};
const bridge=runtimeModule.createAdminHeaderNavigation({React:fakeHooks,jsx:fakeJSX});assert.equal(bridge.WorkspaceTabs,bridge.AdminWorkspaceTabs);
const sentinel={originalAccount:true};const node=bridge.AdminWorkspaceTabs({items:[],location:'/profile',onNavigate(){throw Error('unexpected navigate');},accountMenu:sentinel});assert(node);
const checks={syntax:true,navFullByteInverse:true,outsideSlotsExact:true,originalReactJSXQuerySingletons:true,noBundledReactQueryTRPC:true,noNewQueryClient:true,noBusinessScopeImported:true,noNIStatusBundled:true,originalProviderAndReadGatesExact:true,allHistoricalHandlersPreserved:true,exactOriginalAccountExpression:true,allOriginalNavigationPropsExact:true,headerChildrenLogoNewNavOnly:true,NIImportAndFactoryCallUntouched:true,sourceFreeze:true,offlineFactoryBridgeUnit:true,noWholeSiteBuild:true};
const manifest={scope,status:'NAVIGATION_READY_NOT_ASSEMBLED_NOT_PUBLISHED',capture,assets,replacements:{[beforeURL]:afterURL},sourcePins,allowedSource,exclusions,runtimeURL,cssURL,optionalListCssURL:listCssURL,nav:{beforeURL,beforeSHA:rec.sha256,afterURL,afterSHA:H(after),local:assets.find(x=>x.url===afterURL).local,nativeAliases:aliases,originalTabsComponent:oldTabsComponent,originalHeaderChildren:4,newHeaderChildren:2,accountExpressionSHA:H(accountExpression),originalPropsSHA:H(propsExpression),patches:patches.map(p=>({...p,beforeSHA:H(p.before),afterSHA:H(p.after)}))},checks,tests:{status:'SOURCE_FACTORY_SYNTAX_AND_OFFLINE_BRIDGE_PASS'},parentIntegration:['Parent alone rewrites NI singleton import URL; this candidate intentionally leaves it untouched.','Preserve original import aliases and scope; parent alone updates importmap and assembly/publication.','Append source navigation CSS after existing native CSS; optional list CSS is separate and is not automatically linked.','No original source/native capture is modified.']};
fs.writeFileSync(O+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({status:manifest.status,scope,assets:assets.map(({url,size})=>({url,size})),checks},null,2));
