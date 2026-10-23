import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
import { build } from 'esbuild';
const R=path.dirname(new URL(import.meta.url).pathname);
const S=process.env.D51_ADMIN_SOURCE||path.resolve(R,'../../client/src');
const O=path.join(R,'dist');fs.mkdirSync(O,{recursive:true});
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const namespace='assets/51-ordering-information-a40a0c1191ff8253';
const main='/'+namespace+'/index-BOdW8NbX.js';
const files=[];
function save(prefix,content,more={}){const name=prefix+'-'+hash(content).slice(0,16)+'.js';fs.writeFileSync(path.join(O,name),content);const file={name,sha256:hash(content),...more};files.push(file);return '/assets/'+name;}
const coreBuild=await build({entryPoints:[path.join(S,'lib/adminPageMemory.ts')],bundle:true,write:false,platform:'browser',format:'esm',target:'es2020',minify:true});
const core=save('AdminPageMemory-core',coreBuild.outputFiles[0].text);
const modules={
  'react':`import{r as R}from"${main}";export const {useState,useEffect,useLayoutEffect,useRef,useCallback,useMemo,useSyncExternalStore}=R;export default R;`,
  'react/jsx-runtime':`import{j as J}from"${main}";export const {jsx,jsxs,Fragment}=J;`,
  'wouter':`export {w as useLocation} from "${main}";`,
  '@/lib/trpc':`export {t as trpc} from "${main}";`,
  '@/_core/hooks/useAuth':`export {p as useAuth} from "${main}";`,
};
const runtimeBuild=await build({stdin:{contents:'export * from "./hooks/useAdminPageMemory";export * from "./components/admin/MerchantNavigation";',resolveDir:S,sourcefile:'admin-memory-runtime.ts'},bundle:true,write:false,platform:'browser',format:'esm',target:'es2020',jsx:'automatic',minify:true,external:[main],plugins:[{name:'actual-live-runtime',setup(b){b.onResolve({filter:/^(react(?:\/jsx-runtime)?|wouter|@\/lib\/trpc|@\/_core\/hooks\/useAuth)$/},a=>({path:a.path,namespace:'live'}));b.onLoad({filter:/.*/,namespace:'live'},a=>({contents:modules[a.path],loader:'js'}));b.onResolve({filter:/^@\/lib\/adminPageMemory$/},()=>({path:core,external:true}));b.onResolve({filter:/^@\//},a=>({path:path.join(S,a.path.slice(2))+(a.path.endsWith('useAdminPageMemory')?'.ts':'.tsx')}));}}]});
const runtime=save('AdminPageMemory-runtime',runtimeBuild.outputFiles[0].text);
const imports={};const pages=[];
for(const [name,original] of [['Merchants','Merchants-DJDebSyd.js'],['MerchantDetail','MerchantDetail-DaCXJBhL.js']]){
 const oldPath=namespace+'/'+original,raw=fs.readFileSync(path.join(R,'baseline',oldPath),'utf8'),sf=ts.createSourceFile(original,raw,99,true,1),changes=[];
 const add=(start,end,text,reason)=>changes.push({start,end,text,reason});
 const expr=(node,text,reason)=>add(node.getStart(sf),node.end,text,reason);
 for(const n of sf.statements)if(ts.isImportDeclaration(n)&&n.moduleSpecifier.text.startsWith('./'))expr(n.moduleSpecifier,JSON.stringify('/'+namespace+'/'+n.moduleSpecifier.text.slice(2)),'keep exact original dependency');
 const ex=sf.statements.filter(ts.isExportDeclaration).at(-1),defaultName=ex.exportClause.elements.find(e=>e.name.text==='default').propertyName.text;
 const f=sf.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===defaultName);if(!f)throw Error('default component not found');
 add(0,0,`import * as AM from ${JSON.stringify(runtime)};\n`,'single live hook runtime');
 if(name==='Merchants'){
  add(f.body.getStart(sf)+1,f.body.getStart(sf)+1,'const amReady=AM.useAdminPageMemory();const[amPageSize,amSetPageSize]=AM.useAdminUrlState("pageSize",20);','account scope before state slots');
  let slot=0,queryCount=0,paginationCount=0,rowCount=0;
  function walk(n){
   if(ts.isVariableDeclaration(n)&&n.initializer&&ts.isCallExpression(n.initializer)&&n.initializer.expression.getText(sf)==='r.useState'){
    const names=['page','search','searchInput','createdAtFilter','salesOwnerFilter'];if(slot<5){const key=names[slot],fn=key==='searchInput'?'useAdminRememberedState':'useAdminUrlState';expr(n.initializer,`AM.${fn}(${JSON.stringify(key)},${n.initializer.arguments[0].getText(sf)})`,'remember browser field '+key);}slot++;
   }
   if(ts.isCallExpression(n)&&n.expression.getText(sf)==='$.merchant.list.useQuery'){
    const text=n.arguments[0].getText(sf).replace('pageSize:20','pageSize:amPageSize');expr(n,`AM.useAdminBoundQuery($.merchant.list.useQuery(${text},AM.freshAdminListOptions({},amReady)),t,amPageSize,a)`,'fresh fetch before position restoration');queryCount++;
   }
   if(ts.isCallExpression(n)&&n.expression.getText(sf)==='e.jsx'&&n.arguments[0]?.getText(sf)==='Jt'){
    expr(n,`e.jsx(AM.MerchantPagination,{page:t,pageSize:amPageSize,total:h.total,onPageChange:a,onPageSizeChange:size=>{amSetPageSize(size);a(1)}})`,'jump page and adjustable page size');paginationCount++;
   }
   if(ts.isCallExpression(n)&&/^e\.jsx[s]?$/.test(n.expression.getText(sf))&&n.arguments[0]?.getText(sf)==='"tr"'&&n.arguments[1]&&ts.isObjectLiteralExpression(n.arguments[1])&&n.arguments[2]){
    const key=n.arguments[2].getText(sf);if(key==='o.id'){add(n.arguments[1].getStart(sf)+1,n.arguments[1].getStart(sf)+1,'"data-page-memory-row":`merchant:${o.id}`,','source row anchor');rowCount++;}
   }
   n.forEachChild(walk);
  }walk(f);
  if(slot!==17||queryCount!==1||paginationCount!==1||rowCount!==1)throw Error(JSON.stringify({name,slot,queryCount,paginationCount,rowCount}));
 }else{
  add(f.body.getStart(sf)+1,f.body.getStart(sf)+1,'AM.useAdminPageMemory();','detail uses actual admin identity');
  let returns=0,nav=0;
  function walk(n){
   if(ts.isCallExpression(n)&&n.expression.getText(sf)==='t'&&n.arguments[0]?.getText(sf)==='"/merchants"'){expr(n,'AM.returnToPageSource(t,"/merchants")','return actual source');returns++;}
   if(ts.isStringLiteral(n)&&n.text.trim()==='返回商户列表')expr(n,JSON.stringify(n.text.replace('返回商户列表','返回上一页')),'honest back label');
   if(ts.isCallExpression(n)&&/^e\.jsx[s]?$/.test(n.expression.getText(sf))&&n.arguments[1]&&ts.isObjectLiteralExpression(n.arguments[1])){
    const properties=n.arguments[1].properties;const value=properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(sf)==='value');
    const onChange=properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(sf)==='onValueChange');
    if(value?.initializer.getText(sf)==='c'&&onChange){add(n.getStart(sf),n.getStart(sf),'e.jsxs(p.Fragment,{children:[e.jsx(AM.MerchantSequentialNavigation,{merchantId:s}),','detail sequential view without changing source');add(n.end,n.end,']})','close detail navigation group');nav++;}
   }
   n.forEachChild(walk);
  }walk(f);if(returns!==2||nav!==1)throw Error(JSON.stringify({name,returns,nav}));
 }
 changes.sort((a,b)=>b.start-a.start||b.end-a.end);
 for(let i=1;i<changes.length;i++)if(changes[i].end>changes[i-1].start)throw Error('overlapping edits '+name);
 let patched=raw;for(const p of changes)patched=patched.slice(0,p.start)+p.text+patched.slice(p.end);
 const url=save(name+'-page-memory',patched,{original:oldPath,oldSha256:hash(raw),edits:changes});imports['/'+oldPath]=url;pages.push({name,original:oldPath,url});
}
const oldHtml=fs.readFileSync(path.join(R,'baseline/index.html'),'utf8');
if(hash(oldHtml)!=='881f829481422d91883cfb5e26d87fa27d982d53e0d95ea023396f30e7dda0b9')throw Error('not actual live baseline');
const originalScript=oldHtml.match(/<script[^>]*type="module"[^>]*src="[^"]+"[^>]*><\/script>/)?.[0];if(!originalScript)throw Error('startup absent');
const bootstrap=`<script type="importmap">${JSON.stringify({imports})}</script>\n<script type="module">import{installPageMemory}from${JSON.stringify(core)};installPageMemory();</script>\n`;
const html=oldHtml.replace(originalScript,bootstrap+originalScript);fs.writeFileSync(path.join(O,'index.html'),html);
const manifest={oldHtmlSha256:hash(oldHtml),newHtmlSha256:hash(html),main,core,runtime,imports,pages,files,scope:'Only actual admin frontend memory/pagination; no backend, CRM, CSS, Nginx or process change'};
fs.writeFileSync(path.join(O,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({html:manifest.newHtmlSha256,core,runtime,files:files.length,imports,pages},null,2));
