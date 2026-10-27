import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
import {build} from 'esbuild';
const root=path.dirname(new URL(import.meta.url).pathname), project=path.resolve(root,'../..'),out=path.join(root,'dist');fs.mkdirSync(out,{recursive:true});
const mainOriginal='/assets/51-ordering-information-a40a0c1191ff8253/index-BOdW8NbX.js';
const layoutOriginal='/assets/51-ordering-information-a40a0c1191ff8253/DashboardLayout-D56MNqM7.js';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const files=[];
function save(prefix,content,extension='js'){const name=prefix+'-'+hash(content).slice(0,16)+'.'+extension;fs.writeFileSync(path.join(out,name),content);files.push({name,sha256:hash(content)});return '/assets/'+name;}
const stubs={
 'react':`import{r as R}from ${JSON.stringify(mainOriginal)};export default R;export const {useState,useEffect,useLayoutEffect,useRef,useCallback,useMemo,useContext,createContext,useReducer,useId,useSyncExternalStore,forwardRef,createElement,Fragment,Suspense,lazy}=R;`,
 'react/jsx-runtime':`import{j as J}from ${JSON.stringify(mainOriginal)};export const {jsx,jsxs,Fragment}=J;`,
 'wouter':`export{w as useLocation}from ${JSON.stringify(mainOriginal)};`,
 '@/_core/hooks/useAuth':`export{p as useAuth}from ${JSON.stringify(mainOriginal)};`,
 '@/components/DashboardLayout':`export{D as default}from ${JSON.stringify(layoutOriginal)};`,
 '@/lib/adminRouteChunks':`export function preloadAdminRoute(){return false;}`,
};
const plugin={name:'single-actual-admin-runtime',setup(b){b.onResolve({filter:/^(react(?:\/jsx-runtime)?|wouter|@\/_core\/hooks\/useAuth|@\/components\/DashboardLayout|@\/lib\/adminRouteChunks)$/},a=>({path:a.path,namespace:'actual'}));b.onLoad({filter:/.*/,namespace:'actual'},a=>({contents:stubs[a.path],loader:'js'}));}};
const styles=[];
async function compile(entry,prefix){const result=await build({absWorkingDir:project,entryPoints:[entry],outfile:path.join(out,'virtual.js'),bundle:true,write:false,platform:'browser',format:'esm',target:'es2020',jsx:'automatic',minify:true,external:[mainOriginal,layoutOriginal],plugins:[plugin]});const js=result.outputFiles.find(f=>f.path.endsWith('.js'));if(!js)throw Error('missing module '+entry);for(const f of result.outputFiles.filter(f=>f.path.endsWith('.css')))styles.push(save(prefix,f.text,'css'));return save(prefix,js.text);}
const page=await compile('client/src/pages/zhijie/ZhijieBusiness.tsx','ZhijieBusiness');
const nav=await compile('client/src/components/ZhijieSidebar.tsx','ZhijieSidebar');
function ast(text,file){return ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);}
function replaceEdits(text,edits){edits.sort((a,b)=>b.start-a.start);for(let i=1;i<edits.length;i++)if(edits[i].end>edits[i-1].start)throw Error('overlap');for(const e of edits)text=text.slice(0,e.start)+e.text+text.slice(e.end);return text;}
const oldMain=fs.readFileSync(path.join(root,'baseline/index-BOdW8NbX.js'),'utf8');
const oldLayout=fs.readFileSync(path.join(root,'baseline/DashboardLayout-live.js'),'utf8');
const oldHtml=fs.readFileSync(path.join(root,'baseline/index.html'),'utf8');
function patchMain(){const sf=ast(oldMain,'main.js');const edits=[];let routes=0;
 function visit(n){if(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword&&ts.isStringLiteral(n.arguments[0])&&n.arguments[0].text.startsWith('./'))edits.push({start:n.arguments[0].getStart(sf),end:n.arguments[0].end,text:JSON.stringify(path.posix.dirname(mainOriginal)+'/'+n.arguments[0].text.slice(2))});if(ts.isObjectLiteralExpression(n)){const loc=n.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(sf)==='"data-loc"');if(loc?.initializer?.text==='client/src/App.tsx:194'){const children=n.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(sf)==='children');if(!children||!ts.isArrayLiteralExpression(children.initializer))throw Error('route children changed');edits.push({start:children.initializer.getStart(sf)+1,end:children.initializer.getStart(sf)+1,text:'N.jsx(Ne,{path:"/zhijie",component:__ZhijieScreen}),N.jsx(Ne,{path:"/zhijie/:module",component:__ZhijieScreen}),'});routes++;}}n.forEachChild(visit);}visit(sf);if(routes!==1)throw Error('route target not unique');
 for(const n of sf.statements)if(ts.isImportDeclaration(n)&&n.moduleSpecifier.text.startsWith('./'))edits.push({start:n.moduleSpecifier.getStart(sf),end:n.moduleSpecifier.end,text:JSON.stringify(path.posix.dirname(mainOriginal)+'/'+n.moduleSpecifier.text.slice(2))});
 // Insert after import declarations: page executes only when selected, avoiding eager cycles.
 const routerFunction=sf.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='DA');if(!routerFunction)throw Error('actual router not found');
 const at=routerFunction.getStart(sf);
 edits.push({start:at,end:at,text:`\nconst __ZhijieLazy=E.lazy(()=>import(${JSON.stringify(page)}));function __ZhijieScreen(){return E.createElement(E.Suspense,{fallback:E.createElement("div",{style:{padding:24,fontSize:13}},"正在加载智捷业务…")},E.createElement(__ZhijieLazy));}\n`});
 return save('Admin-main-zhijie',replaceEdits(oldMain,edits));}
function patchLayout(){const sf=ast(oldLayout,'layout.js'),edits=[];let targets=0;
 function visit(n){if(ts.isObjectLiteralExpression(n)){const loc=n.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(sf)==='"data-loc"');if(loc?.initializer?.text==='client/src/components/DashboardLayout.tsx:391'){const children=n.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(sf)==='children');if(!children)throw Error('no sidebar children');const current=children.initializer.getText(sf);edits.push({start:children.initializer.getStart(sf),end:children.initializer.end,text:`[${current},pe.createElement(__ZhijieNavEntry,{key:"zhijie-business"})]`});targets++;}}n.forEachChild(visit);}visit(sf);if(targets!==1)throw Error('sidebar target not unique');
 const at=sf.statements.filter(ts.isImportDeclaration).at(-1)?.end||0;edits.push({start:at,end:at,text:`\nconst __ZhijieNavLazy=pe.lazy(()=>import(${JSON.stringify(nav)}));function __ZhijieNavEntry(){return pe.createElement(pe.Suspense,{fallback:null},pe.createElement(__ZhijieNavLazy));}\n`});
 return save('DashboardLayout-zhijie',replaceEdits(oldLayout,edits));}
const main=patchMain(),layout=patchLayout();
let html=oldHtml;const maps=Array.from(html.matchAll(/<script type="importmap">([\s\S]*?)<\/script>/g));if(maps.length!==1)throw Error('expected unique current importmap');
const mapping=JSON.parse(maps[0][1]);const oldMapping={...mapping.imports};mapping.imports={...mapping.imports,[mainOriginal]:main,[layoutOriginal]:layout};html=html.replace(maps[0][0],'<script type="importmap">'+JSON.stringify(mapping)+'</script>');
if(!html.includes(`src="${mainOriginal}"`))throw Error('actual startup changed');html=html.replace(`src="${mainOriginal}"`,`src="${main}"`);
html=html.replace('</head>',styles.map(url=>`<link rel="stylesheet" href="${url}">`).join('\n')+'\n</head>');fs.writeFileSync(path.join(out,'index.html'),html);
for(const [url,value] of Object.entries(oldMapping))if(url!==layoutOriginal&&mapping.imports[url]!==value)throw Error('protected map changed');
const manifest={oldHtmlSha256:hash(oldHtml),newHtmlSha256:hash(html),mainOriginal,layoutOriginal,oldMainSha256:hash(oldMain),oldLayoutSha256:hash(oldLayout),main,layout,page,nav,styles,imports:mapping.imports,protectedImports:oldMapping,files,scope:'Add Zhijie routes and authorized navigation only; original admin UI/CRM/map patches preserved; business data disconnected'};fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({modules:files.length,main,layout,page,nav,styles,html:manifest.newHtmlSha256},null,2));
