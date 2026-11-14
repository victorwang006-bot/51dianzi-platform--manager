'use strict';
const C=require('./customer-profile-compact-core-20261114.cjs'),esbuild=require('esbuild');
const {fs,path,assert,ts,REPO,BASE,OUT,read,sha,parse,nodes,one,top}=C;
const P='client/src/business/platform/client/src/';
const bridgeSources=[
 'client/src/business/api/business-trpc','react-dom','wouter','client/src/business/BusinessScope',
 P+'hooks/usePageIdentity',P+'lib/pageMemory',P+'hooks/usePageMemory','client/src/business/api/business-auth',
 'client/src/business/api/business-enterprise-session','client/src/business/BusinessContentFrame','sonner',P+'lib/utils','date-fns/locale',
 P+'hooks/useCustomerCreateDraft',P+'components/customers/CustomerSupplyUploadDialog',
 ...['dialog','input','calendar','popover','textarea','select','button','table'].map(s=>P+'components/ui/'+s),
 'client/src/components/admin/UnifiedAdminPage',...['checkbox','label','dropdown-menu'].map(s=>P+'components/ui/'+s),
];
const reactNames=['Children','Component','Fragment','Profiler','PureComponent','StrictMode','Suspense','act','cache','cloneElement','createContext','createElement','createRef','forwardRef','isValidElement','lazy','memo','startTransition','use','useActionState','useCallback','useContext','useDebugValue','useDeferredValue','useEffect','useId','useImperativeHandle','useInsertionEffect','useLayoutEffect','useMemo','useOptimistic','useReducer','useRef','useState','useSyncExternalStore','useTransition','version'];
function bindings(){
 const urls=JSON.parse(read(BASE+'/active-workbenches.json')),a=parse(read(BASE+urls[1]));
 const cap=one(a,n=>ts.isVariableDeclaration(n)&&n.name.getText(a)==='__customer_workbench_manager_v1','deployed customer factory');
 assert(ts.isCallExpression(cap.initializer)&&ts.isObjectLiteralExpression(cap.initializer.arguments[0]));
 const obj=cap.initializer.arguments[0],raw={};for(const p of obj.properties){assert(ts.isPropertyAssignment(p));raw[p.name.text]=p.initializer.getText(a);}
 const modules={};for(const[k,v]of Object.entries(raw)){const m=k.match(/^bridge_(\d+)_(.*)$/);if(m){const source=bridgeSources[Number(m[1])];assert(source,'unmapped deployed bridge '+k);(modules[source]??={})[m[2]]={key:k,expression:v};}}
 // New upload owner must enter candidate from source; never reuse older upload source.
 delete modules[P+'components/customers/CustomerSupplyUploadDialog'];
 const ir=top(a,'__d51_ir_w_get');const live=one(ir,n=>ts.isVariableDeclaration(n)&&n.name.getText(a)==='__live','native business singleton table');
 const irProps=Object.fromEntries(live.initializer.properties.filter(ts.isPropertyAssignment).map(n=>[n.name.text,n.initializer.getText(a)]));
 modules['client/src/business/api/business-wouter']={useBusinessLocation:{key:'useBusinessLocation',expression:irProps.useBusinessLocation},businessNavigationHrefs:{key:'businessNavigationHrefs',expression:irProps.businessNavigationHrefs}};
 modules['client/src/business/BusinessWorkbenchAccessGate']={useBusinessWorkbenchAccess:{key:'useBusinessWorkbenchAccess',expression:'Ty'}};
 const separator=one(a,n=>ts.isFunctionDeclaration(n)&&n.parent===a&&n.getText(a).includes('"dropdown-menu-separator"'),'production dropdown separator');
 modules[P+'components/ui/dropdown-menu'].DropdownMenuSeparator={key:'DropdownMenuSeparator',expression:separator.name.text};
 modules['client/src/lib/utils']=modules[P+'lib/utils'];
 const evidence=[];
 for(const[i,url]of urls.entries()){
  const text=read(BASE+url),ast=parse(text),declarations=new Map();for(const n of nodes(ast,n=>(ts.isFunctionDeclaration(n)||ts.isClassDeclaration(n)||ts.isVariableDeclaration(n))&&n.name&&ts.isIdentifier(n.name)&&((ts.isVariableDeclaration(n)&&n.parent.parent.parent===ast)||n.parent===ast)))declarations.set(n.name.text,n);
  for(const n of ast.statements.filter(ts.isImportDeclaration)){const cl=n.importClause;if(cl?.name)declarations.set(cl.name.text,n);if(cl?.namedBindings){if(ts.isNamespaceImport(cl.namedBindings))declarations.set(cl.namedBindings.name.text,n);else for(const e of cl.namedBindings.elements)declarations.set(e.name.text,n);}}
  for(const[source,exports]of Object.entries(modules))for(const[name,row]of Object.entries(exports)){const root=row.expression.split('.')[0];assert(declarations.has(root),'missing baseline native '+i+' '+source+' '+name+' '+root);evidence.push({module:i,url,source,export:name,expression:row.expression,ownerSha256:sha(declarations.get(root).getText(ast)),proof:'exact deployed customer native bridge; root exists in each active module'});}
 }
 return {urls,modules,react:raw.React,jsx:raw.jsx,deployedBridgeObjectSha256:sha(obj.getText(a)),evidence};
}
function local(request,dir){if(request.startsWith('@/'))return path.resolve(REPO,'client/src',request.slice(2));if(request.startsWith('@shared/'))return path.resolve(REPO,'shared',request.slice(8));if(request.startsWith('.'))return path.resolve(dir,request);if(path.isAbsolute(request))return request;return null;}
function strip(f){return f.replace(/\.[cm]?[jt]sx?$/,'');}
async function compileCustomerFactory({minify=true,sourceCommit=null}={}){
 const b=bindings(),pins=new Map(),css=new Set(),used=new Set(),virtuals=new Map();
 const snapshot=f=>{f=path.resolve(f);if(!pins.has(f)){const rel=path.relative(REPO,f);const bytes=sourceCommit&&f.startsWith(REPO+'/')&&!f.includes('/node_modules/')?require('node:child_process').execFileSync('git',['show',sourceCommit+':'+rel],{cwd:REPO,maxBuffer:10*1024*1024}):fs.readFileSync(f);pins.set(f,bytes);}return pins.get(f).toString('utf8');};
 virtuals.set('react','const R=__customerLive.React;export default R;'+reactNames.map(n=>`export const ${n}=R.${n};`).join('\n'));
 virtuals.set('react/jsx-runtime','export const jsx=__customerLive.jsx.jsx;export const jsxs=__customerLive.jsx.jsxs;export const Fragment=__customerLive.jsx.Fragment;');
 for(const[source,exports]of Object.entries(b.modules))virtuals.set(source,Object.entries(exports).map(([name,row])=>`const B_${name}=__customerLive[${JSON.stringify(row.key)}];if(B_${name}===undefined)throw Error(${JSON.stringify('Missing native '+source+':'+name)});export {B_${name} as ${name}};`).join('\n'));
 const entries={CustomerDetail:[P+'pages/CustomerDetail.tsx','default'],CustomerSalesOrders:[P+'pages/CrmSalesOrders.tsx','CustomerSalesOrders'],CustomerDemandHistory:[P+'components/customerDemands/CustomerDemandHistory.tsx','CustomerDemandHistory'],CustomerDemandDialog:[P+'components/customerDemands/CustomerDemandDialog.tsx','CustomerDemandDialog'],CustomerDemandBomDialog:[P+'components/customerDemands/CustomerDemandBomDialog.tsx','CustomerDemandBomDialog'],CustomerWorkbenchSupply:[P+'components/customers/CustomerWorkbenchSupply.tsx','CustomerWorkbenchSupply'],CustomerChannelInventory:[P+'components/customers/CustomerChannelInventory.tsx','CustomerChannelInventory'],customerInventoryInput:[P+'components/customers/CustomerChannelInventory.tsx','customerInventoryInput'],verifiedCustomerInventory:[P+'components/customers/CustomerChannelInventory.tsx','verifiedCustomerInventory'],customerWorkbenchTab:[P+'components/customers/customerWorkbench.ts','customerWorkbenchTab'],customerWorkbenchLocation:[P+'components/customers/customerWorkbench.ts','customerWorkbenchLocation']};
 entries.ChannelInventoryHost=[P+'pages/ChannelInventoryHost.tsx','default'];
 entries.factoryMaterialPublishDisabledReason=[P+'components/channelInventory/FactoryMaterialPublish.tsx','factoryMaterialPublishDisabledReason'];
 entries.FactoryMaterialPublishConfirmation=[P+'components/channelInventory/FactoryMaterialPublish.tsx','FactoryMaterialPublishConfirmation'];
 for(const name of ['createDemandBomTemplate','appendDemandBomItems','DEMAND_BOM_FIELDS','assertDemandBomFile'])entries[name]=[P+'components/customerDemands/customerDemandBom.ts',name];
 const entry=Object.entries(entries).map(([as,[file,name]])=>`export {${name} as ${as}} from ${JSON.stringify('./'+file)};`).join('\n');
 const result=await esbuild.build({absWorkingDir:REPO,stdin:{contents:entry,sourcefile:'customer-workbench-scoped-entry.mjs',resolveDir:REPO,loader:'js'},bundle:true,write:false,format:'iife',globalName:'__CUSTOMER_WORKBENCH_EXPORTS',platform:'browser',target:'es2020',jsx:'automatic',minify,metafile:true,legalComments:'none',define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent',plugins:[{name:'customer-workbench-production-singletons',setup(build){
  build.onResolve({filter:/.*/},args=>{if(args.namespace==='customer-native'||args.namespace==='customer-css')return;
   const resolved=local(args.path,args.resolveDir),key=resolved?strip(path.relative(REPO,resolved)):args.path;
   if(/\.css$/.test(args.path)){assert(resolved&&fs.existsSync(resolved));snapshot(resolved);css.add(resolved);return{path:resolved,namespace:'customer-css'};}
   if(virtuals.has(key)){used.add(key);return{path:key,namespace:'customer-native'};}
   if(/^react(?:-dom)?(?:\/|$)|^wouter(?:\/|$)|^@trpc\/|^@tanstack\/react-query/.test(args.path))throw Error('Unbridged root/provider/API '+args.path+' from '+args.importer);
   if(resolved&&/(?:BusinessScope|BusinessWorkbench(?:Session|Page|AccessGate)|BusinessContentFrame|business-trpc|useAuth|EnterpriseSessionContext|usePageMemory|usePageIdentity|pageMemory|customerCreateDraftStore)\.[jt]sx?$/.test(resolved+'.ts'))throw Error('Unbridged singleton source '+resolved);
   if(resolved&&/(?:\/server\/|\/front-router-types\/)/.test(resolved))throw Error('Runtime server input forbidden '+resolved);
  });
  build.onLoad({filter:/.*/,namespace:'customer-native'},args=>({contents:virtuals.get(args.path),loader:'js'}));
  build.onLoad({filter:/.*/,namespace:'customer-css'},()=>({contents:'',loader:'js'}));
  build.onLoad({filter:/\.[cm]?[jt]sx?$/,namespace:'file'},args=>({contents:snapshot(args.path),loader:/tsx$/.test(args.path)?'tsx':/ts$/.test(args.path)?'ts':/jsx$/.test(args.path)?'jsx':'js',resolveDir:path.dirname(args.path)}));
 }}]});
 assert.equal(result.outputFiles.length,1);const code=result.outputFiles[0].text;
 const forbidden=Object.keys(result.metafile.inputs).filter(f=>!f.startsWith('customer-native:')&&!f.startsWith('customer-css:')&&(/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:react(?:-dom)?\/|wouter\/|@trpc\/|@tanstack\/react-query\/)/.test(f)||/(?:BusinessScope|BusinessWorkbench(?:Session|Page|AccessGate)|BusinessContentFrame|business-trpc|useAuth|EnterpriseSessionContext|usePageMemory|usePageIdentity|pageMemory|customerCreateDraftStore)\.[jt]sx?$/.test(f)));
 assert.deepEqual(forbidden,[],'copied singleton modules');assert(!/\b(?:createRoot|hydrateRoot|createTRPCReact|createTRPCClient)\s*\(/.test(code),'new root/API');
 const sourceHashes={};for(const[f,bytes]of pins){assert(sourceCommit||fs.readFileSync(f).equals(bytes),'source changed during compile '+f);if(f.startsWith(REPO+'/')&&!f.includes('/node_modules/'))sourceHashes[path.relative(REPO,f)]=sha(bytes);}
 const live={React:b.react,jsx:b.jsx};for(const source of used)for(const row of Object.values(b.modules[source]??{}))live[row.key]=row.expression;
 result.metafile.customerFactory={exports:Object.keys(entries),nativeReference:'__customerLive',live,bridges:[...used].sort(),bridgeEvidence:b.evidence.filter(r=>used.has(r.source)),deployedBridgeObjectSha256:b.deployedBridgeObjectSha256,cssImports:[...css].map(f=>path.relative(REPO,f)).sort(),checks:{noCopiedReact:true,noCopiedScope:true,noCopiedAuth:true,noCopiedPageMemory:true,noCopiedApi:true,noNewRoot:true,noNewProvider:true,sourceSnapshotStable:true},forbiddenNativeApiInputs:forbidden};
 return{code,metafile:result.metafile,sourceHashes,bindings:b,live};
}
module.exports={bindings,compileCustomerFactory};
