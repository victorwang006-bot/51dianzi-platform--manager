'use strict';
const C=require('./scoped-core.cjs'),esbuild=require('/home/ubuntu/work/51dianzi-platform--manager/node_modules/esbuild'),postcss=require('/home/ubuntu/work/51dianzi-platform--manager/node_modules/postcss');
const {fs,path,assert,ts,P,sha,parse,nodes,one,pinned,inside,editNode,delta}=C;
const DEPENDENCIES='/home/ubuntu/work/51dianzi-platform--manager';
const bridgeSources=['client/src/business/api/business-trpc','react-dom','wouter','client/src/business/BusinessScope',P+'hooks/usePageIdentity',P+'lib/pageMemory',P+'hooks/usePageMemory','client/src/business/api/business-auth','client/src/business/api/business-enterprise-session','client/src/business/BusinessContentFrame','sonner',P+'lib/utils','date-fns/locale',P+'hooks/useCustomerCreateDraft',P+'components/customers/CustomerSupplyUploadDialog',...['dialog','input','calendar','popover','textarea','select','button','table'].map(s=>P+'components/ui/'+s),'client/src/components/admin/UnifiedAdminPage',...['checkbox','label','dropdown-menu'].map(s=>P+'components/ui/'+s)];
const reactNames=['Children','Component','Fragment','Profiler','PureComponent','StrictMode','Suspense','act','cache','cloneElement','createContext','createElement','createRef','forwardRef','isValidElement','lazy','memo','startTransition','use','useActionState','useCallback','useContext','useDebugValue','useDeferredValue','useEffect','useId','useImperativeHandle','useInsertionEffect','useLayoutEffect','useMemo','useOptimistic','useReducer','useRef','useState','useSyncExternalStore','useTransition','version'];
function finalFactory(a){
 const get=one(a.statements,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='__CW_CUSTOMER_GET','current lazy customer getter');
 const live=one(get,n=>ts.isVariableDeclaration(n)&&n.name.getText(a)==='__customerLive','current live table');assert(ts.isObjectLiteralExpression(live.initializer));
 const factory=one(get,n=>ts.isVariableDeclaration(n)&&n.name.getText(a)==='__CUSTOMER_WORKBENCH_EXPORTS','current full customer initializer');
 let call=factory.initializer;while(ts.isParenthesizedExpression(call))call=call.expression;assert(ts.isCallExpression(call));let f=call.expression;while(ts.isParenthesizedExpression(f))f=f.expression;assert(ts.isArrowFunction(f)&&ts.isBlock(f.body));
 const block=f.body,hostGet=one(block.statements,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='__NAV_CHANNEL_REFERENCE_HOST_GET','existing independent Host getter');
 const hostFactory=one(hostGet,n=>ts.isVariableDeclaration(n)&&n.name.getText(a)==='__CHANNEL_REFERENCE_HOST_EXPORTS','existing Host factory');
 assert(hostGet.getText(a).includes('__NAV_CHANNEL_REFERENCE_HOST_INSTANCE'),'EXISTING_HOST_INSTANCE_GUARD');
 return {get,live,factory,block,hostGet,hostFactory};
}
function bridge(text){
 const a=parse(text),o=finalFactory(a),raw=Object.fromEntries(o.live.initializer.properties.map(p=>{assert(ts.isPropertyAssignment(p));return [p.name.text,p.initializer.getText(a)];}));
 const caps=nodes(a,n=>ts.isVariableDeclaration(n)&&n.name.getText(a)==='__customer_workbench_manager_v1');assert(caps.length<=1,'UNIQUE_LEGACY_BRIDGE_IF_PRESENT');const cap=caps[0];if(cap)assert(ts.isCallExpression(cap.initializer));const modules={};
 for(const p of cap?cap.initializer.arguments[0].properties:o.live.initializer.properties){const m=p.name.text.match(/^bridge_(\d+)_(.*)$/);if(m){const src=bridgeSources[Number(m[1])];assert(src);if(raw[p.name.text]!==undefined)assert.equal(raw[p.name.text],p.initializer.getText(a));(modules[src]??={})[m[2]]={key:p.name.text,expression:p.initializer.getText(a)};}}
 delete modules[P+'components/customers/CustomerSupplyUploadDialog'];
 const ir=one(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='__d51_ir_w_get','existing readonly helper'),il=one(ir,n=>ts.isVariableDeclaration(n)&&n.name.getText(a)==='__live','readonly live');
 const props=Object.fromEntries(il.initializer.properties.map(p=>[p.name.text,p.initializer.getText(a)]));
 modules['client/src/business/api/business-wouter']={useBusinessLocation:{key:'useBusinessLocation',expression:props.useBusinessLocation},businessNavigationHrefs:{key:'businessNavigationHrefs',expression:props.businessNavigationHrefs}};
 modules['client/src/business/BusinessWorkbenchAccessGate']={useBusinessWorkbenchAccess:{key:'useBusinessWorkbenchAccess',expression:'Ty'}};
 modules[P+'components/ui/dropdown-menu'].DropdownMenuSeparator={key:'DropdownMenuSeparator',expression:raw.DropdownMenuSeparator};modules['client/src/lib/utils']=modules[P+'lib/utils'];
 assert.equal(raw.createBusinessScopeTrpcClient,props.createBusinessScopeTrpcClient,'ALREADY_DEPLOYED_SCOPE_BRIDGE_RETAINED');
 modules['client/src/business/api/business-trpc'].createBusinessScopeTrpcClient={key:'createBusinessScopeTrpcClient',expression:raw.createBusinessScopeTrpcClient};
 return {raw,modules,react:raw.React,jsx:raw.jsx,liveSha256:sha(o.live.initializer.getText(a))};
}
async function compileHost(sourceDir,pins,b){
 const used=new Set(),reads=new Map(),dependencyPins={},virtuals=new Map();
 virtuals.set('react','const R=__customerLive.React;export default R;'+reactNames.map(n=>`export const ${n}=R.${n};`).join('\n'));
 virtuals.set('react/jsx-runtime','export const jsx=__customerLive.jsx.jsx;export const jsxs=__customerLive.jsx.jsxs;export const Fragment=__customerLive.jsx.Fragment;');
 for(const [src,exports] of Object.entries(b.modules))virtuals.set(src,Object.entries(exports).map(([name,r])=>`const B_${name}=__customerLive[${JSON.stringify(r.key)}];if(B_${name}===undefined)throw Error(${JSON.stringify('Missing native '+src+':'+name)});export {B_${name} as ${name}};`).join('\n'));
 function local(r,d){if(r.startsWith('@/'))return path.join(sourceDir,'client/src',r.slice(2));if(r.startsWith('@shared/'))return path.join(sourceDir,'shared',r.slice(8));if(r.startsWith('.'))return path.resolve(d,r);if(path.isAbsolute(r))return r;return null;}
 function sourceRead(f){const n=path.relative(sourceDir,f).split(path.sep).join('/');assert(pins[n],'UNPINNED_FACTORY_SOURCE '+n);const bytes=pinned(f,pins[n]);reads.set(n,sha(bytes));return bytes.toString('utf8');}
 function existing(f){for(const q of [f,...['.tsx','.ts','.jsx','.js','.mjs','.cjs','/index.tsx','/index.ts','/index.js'].map(x=>f+x)])if(fs.existsSync(q)&&fs.statSync(q).isFile())return q;throw Error('MISSING_SNAPSHOT_MODULE '+f);}
 const result=await esbuild.build({absWorkingDir:sourceDir,nodePaths:[path.join(DEPENDENCIES,'node_modules')],stdin:{contents:`export {default as ChannelInventoryHost} from "./${P}pages/ChannelInventoryHost.tsx";`,sourcefile:'adjustments-host-entry.mjs',resolveDir:sourceDir,loader:'js'},bundle:true,write:false,format:'iife',globalName:'__CHANNEL_REFERENCE_HOST_EXPORTS',platform:'browser',target:'es2020',jsx:'automatic',minify:true,metafile:true,legalComments:'none',define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent',plugins:[{name:'pinned-current-native-singletons',setup(build){
  build.onResolve({filter:/.*/},args=>{
   if(['current-native','current-css'].includes(args.namespace))return;
   const resolved=local(args.path,args.resolveDir),key=resolved?path.relative(sourceDir,resolved).replace(/\.[cm]?[jt]sx?$/,''):args.path;
   if(virtuals.has(key)){used.add(key);return {path:key,namespace:'current-native'};}
   if(/\.css$/.test(args.path)){assert(resolved);sourceRead(resolved);return {path:resolved,namespace:'current-css'};}
   if(/^react(?:-dom)?(?:\/|$)|^wouter(?:\/|$)|^@trpc\/|^@tanstack\/react-query/.test(args.path))throw Error('UNBRIDGED_ROOT_PROVIDER_API '+args.path);
   if(resolved){assert(!/(?:\/server\/|\/front-router-types\/)/.test(resolved),'RUNTIME_SERVER_GRAPH_REFUSED');assert(!/(?:BusinessScope|BusinessWorkbench(?:Session|Page|AccessGate)|BusinessContentFrame|business-trpc|useAuth|EnterpriseSessionContext|usePageMemory|usePageIdentity|pageMemory|customerCreateDraftStore)\.[jt]sx?$/.test(resolved+'.ts'),'UNBRIDGED_SINGLETON_SOURCE');return {path:existing(resolved)};}
   // esbuild's browser package map (e.g. xlsx fs:false) must remain effective.
   // Every resulting real dependency is still byte-pinned by onLoad below.
   return undefined;
  });
  build.onLoad({filter:/.*/,namespace:'current-native'},args=>({contents:virtuals.get(args.path),loader:'js'}));
  build.onLoad({filter:/.*/,namespace:'current-css'},()=>({contents:'',loader:'js'}));
  build.onLoad({filter:/\.[cm]?[jt]sx?$/,namespace:'file'},args=>{let contents;if(args.path.startsWith(path.resolve(sourceDir)+path.sep))contents=sourceRead(args.path);else {assert(args.path.includes('/node_modules/'),'NON_SNAPSHOT_APP_INPUT');const bytes=C.regular(args.path);dependencyPins[args.path]=sha(bytes);contents=bytes.toString('utf8');}return {contents,loader:/tsx$/.test(args.path)?'tsx':/ts$/.test(args.path)?'ts':/jsx$/.test(args.path)?'jsx':'js',resolveDir:path.dirname(args.path)};});
 }}]});
 assert.equal(result.outputFiles.length,1);const code=result.outputFiles[0].text;assert(!/\b(?:createRoot|hydrateRoot|createTRPCReact|createTRPCClient)\s*\(/.test(code),'NEW_ROOT_OR_API_REFUSED');
 const live={React:b.react,jsx:b.jsx};for(const s of used)for(const r of Object.values(b.modules[s]||{})){assert.equal(b.raw[r.key],r.expression,'USED_BRIDGE_ALREADY_CURRENT '+r.key);live[r.key]=r.expression;}
 for(const [n,h] of reads)pinned(inside(sourceDir,n),h);for(const [f,h] of Object.entries(dependencyPins))pinned(f,h);
 return {code,sourceHashes:Object.fromEntries(reads),dependencyPins,metafile:result.metafile,usedBridges:[...used].sort(),live};
}
function patchHost(before,compiled,nativeCopy=null){const text=before.toString('utf8'),a=parse(text),o=finalFactory(a),b=bridge(text);for(const [k,v] of Object.entries(compiled.live))assert.equal(b.raw[k],v,'CURRENT_BINDING_CHANGED '+k);
 const body='{if(!__NAV_CHANNEL_REFERENCE_HOST_INSTANCE){'+compiled.code+';__NAV_CHANNEL_REFERENCE_HOST_INSTANCE=__CHANNEL_REFERENCE_HOST_EXPORTS;}return __NAV_CHANNEL_REFERENCE_HOST_INSTANCE;}';
 const edits=[editNode(text,a,o.hostGet.body,body,'ONLY existing independent Host getter BODY; fullFactory/live/Uv wrappers frozen')];
 if(nativeCopy){
  assert.equal(nativeCopy.sourceDeclaration,'ChannelInventoryPartNumber');assert.equal(nativeCopy.sourceFile,P+'pages/ChannelInventoryHost.tsx');assert(nativeCopy.nativeName&&/^[A-Za-z_$][\w$]*$/.test(nativeCopy.nativeName));
  const old=one(a,x=>ts.isFunctionDeclaration(x)&&x.name?.text===nativeCopy.nativeName&&sha(x.getText(a))===nativeCopy.beforeDeclarationSha256,'parent pinned existing INFO function');
  assert(old.end<=o.hostGet.body.getStart(a)||old.getStart(a)>=o.hostGet.body.end,'INFO_INSIDE_GETTER_ALREADY_COMPILED_USE_NO_EXTRA_SLICE');
  const code=pinned(nativeCopy.afterFile,nativeCopy.afterSha256).toString('utf8'),z=parse(code),replacement=one(z.statements,ts.isFunctionDeclaration,'single compiled INFO replacement');assert.equal(z.statements.length,1);assert.equal(replacement.name?.text,old.name.text);assert.deepEqual(replacement.parameters.map(p=>p.getText(z)),old.parameters.map(p=>p.getText(a)),'NATIVE_INFO_SIGNATURE_FROZEN');
  assert.equal(nativeCopy.mappingApprovedByParent,true,'INFO_NATIVE_IDENTIFIER_MAPPING_REVIEW_REQUIRED');
  edits.push(editNode(text,a,old,code.trim(),'ONLY parent reviewed pinned current INFO function slice; source compilation/mapping provenance still requires frontend actual-native QA'));
 }
 const d=delta(before,edits),z=parse(d.after.toString('utf8')),n=finalFactory(z);assert.equal(n.live.getText(z),o.live.getText(a));assert.equal(n.hostGet.name.text,o.hostGet.name.text);assert.deepEqual(specs(a),specs(z),'ALL_STATIC_DYNAMIC_IMPORT_STATEMENTS_FROZEN');
 return d;}
function cssRuleChanges(before,after){
 const A=postcss.parse(before.toString('utf8')),B=postcss.parse(after.toString('utf8'));
 function rules(root){const rows=new Map(),counts=new Map();root.walkAtRules(r=>assert(['media','supports'].includes(r.name),'CSS_AT_RULE_REFUSED'));root.walkRules(r=>{const ancestors=[];for(let p=r.parent;p&&p.type!=='root';p=p.parent)ancestors.unshift('@'+p.name+' '+p.params);const context=ancestors.join('|')+'|'+r.selector,index=counts.get(context)||0;counts.set(context,index+1);const key=context+'|occurrence:'+index;rows.set(key,{r,selector:r.selector,ancestors});});return rows;}
 const old=rules(A),next=rules(B),changes=[];
 for(const key of [...new Set([...old.keys(),...next.keys()])].sort()){const x=old.get(key),y=next.get(key);if(x&&y&&x.r.toString()===y.r.toString())continue;changes.push({key,selector:(y||x).selector,ancestors:(y||x).ancestors,beforeRuleSha256:x?sha(x.r.toString()):null,afterRuleSha256:y?sha(y.r.toString()):null});}
 return {changes,old,next};
}
function cssOverlay(before,after,approval){
 assert(after.length>=before.length&&after.subarray(0,before.length).equals(before),'ALL_OLD_CSS_SOURCE_PREFIX_BYTES_FROZEN');
 const {changes,old,next}=cssRuleChanges(before,after);assert(approval&&approval.approvedByParent===true,'EXACT_PARENT_CSS_APPROVAL_REQUIRED');assert.equal(approval.beforeSha256,sha(before));assert.equal(approval.afterSha256,sha(after));assert.deepEqual(approval.changedRules,changes,'EXACT_CHANGED_CSS_SELECTOR_CONTEXT_RULE_BYTES_REQUIRED');assert(Array.isArray(approval.portalSelectors)&&new Set(approval.portalSelectors).size===approval.portalSelectors.length,'EXACT_UNIQUE_PORTAL_SELECTORS');
 const split=s=>{const items=[];let depth=0,start=0;for(let j=0;j<s.length;j++){if('(['.includes(s[j]))depth++;if(')]'.includes(s[j]))depth--;assert(depth>=0);if(s[j]===','&&depth===0){items.push(s.slice(start,j).trim());start=j+1;}}items.push(s.slice(start).trim());return items;};
 const ancestorSelectors=new Set(['.admin-workspace-shell__main:has(.ci-flat-host)','[data-business-context-verification]:has(.ci-flat-host)','[data-business-context-content]:has(.ci-flat-host)','.business-native-content:has(.ci-flat-host)','html:has([data-channel-inventory-host].ci-flat-host)']);const out=[];
 for(const change of changes){for(const selector of split(change.selector)){assert(!/:global|:root/.test(selector),'GLOBAL_CSS_REFUSED');assert(/^\.ci-page\.ci-host(?:\b|-)/.test(selector)||ancestorSelectors.has(selector)||approval.portalSelectors.includes(selector),'NO_REGEX_WIDENING_EXACT_PARENT_PORTAL_SELECTOR '+selector);}
  const y=next.get(change.key);if(!y)continue;const r=y.r;assert(!/url\s*\(|@import|expression\s*\(/i.test(r.toString()),'CSS_EXTERNAL_OR_EXECUTABLE_REFUSED');let text=r.toString();for(const ancestor of [...y.ancestors].reverse())text=ancestor+' {\n'+text+'\n}';out.push(text);
 }
 // Original public CSS is immutable. Exact source rule removals are recorded only;
 // they cannot erase old public declarations and must be exercised by parent native browser QA.
 return Buffer.from(out.length?'/* inventory compact: exact parent-approved Host/portal incremental overrides; all old CSS retained */\n'+out.join('\n')+'\n':'');
}
function mapOf(html){const matches=[...html.matchAll(/<script[^>]*type="importmap"[^>]*>([\s\S]*?)<\/script>/g)];assert.equal(matches.length,1,'ONE_CURRENT_IMPORTMAP');const m=matches[0];return {map:JSON.parse(m[1]),text:m[1],start:m.index+m[0].indexOf(m[1])};}
function resolve(spec,from,map){const key=spec.startsWith('.')||spec.startsWith('/')?new URL(spec,'https://admin.invalid'+from).pathname:spec;for(const scope of Object.keys(map.scopes||{}).filter(x=>from.startsWith(x)).sort((a,b)=>b.length-a.length)){const t=map.scopes[scope];if(Object.hasOwn(t,key))return t[key];if(Object.hasOwn(t,spec))return t[spec];}return map.imports?.[key]??map.imports?.[spec]??key;}
function specs(a){return nodes(a,n=>(ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier||ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword).map(n=>{const x=n.moduleSpecifier??n.arguments[0];assert(ts.isStringLiteral(x));return {spec:x.text,kind:ts.SyntaxKind[n.kind],text:n.getText(a)};});}
function htmlMerge(before,relocations,cssUrl,modules,baseDir,assetPins){
 const text=before.toString('utf8'),old=mapOf(text),newMap=JSON.parse(JSON.stringify(old.map));assert.equal(Object.keys(relocations).length,2,'EXACT_TWO_CURRENT_HOST_MODULES');
 let updated=old.text;const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 for(const [from,to] of Object.entries(relocations)){assert.equal(path.posix.dirname(from),path.posix.dirname(to),'SAME_NATIVE_IMPORT_DIRECTORY');let hits=0;updated=updated.replace(new RegExp('(:\\s*)'+escape(JSON.stringify(from)),'g'),(_,p)=>{hits++;return p+JSON.stringify(to);});assert(hits>0,'ACTUAL_CURRENT_MAPPING_REQUIRED');}
 function append(object,values){if(!values.length)return;const a=ts.parseJsonText('current-importmap.json',updated),root=a.statements[0].expression,obj=one(root.properties,x=>x.name.text===object,'map object').initializer;updated=updated.slice(0,obj.end-1)+','+values.join(',')+updated.slice(obj.end-1);}
 let map=JSON.parse(updated);append('imports',Object.entries(relocations).filter(([f])=>!Object.hasOwn(map.imports,f)).map(([f,t])=>JSON.stringify(f)+':'+JSON.stringify(t)));map=JSON.parse(updated);
 const clones=[];for(const [f,t] of Object.entries(relocations)){const scopes=Object.keys(old.map.scopes||{}).filter(s=>f.startsWith(s)&&!t.startsWith(s)).sort((a,b)=>a.length-b.length);if(scopes.length){assert(!map.scopes[t]);const table=Object.assign({},...scopes.map(s=>map.scopes[s]));clones.push(JSON.stringify(t)+':'+JSON.stringify(table));}}
 append('scopes',clones);map=JSON.parse(updated);
 for(const [k,v] of Object.entries(old.map.imports))assert.equal(map.imports[k],relocations[v]||v);for(const [s,t] of Object.entries(old.map.scopes||{})){assert.deepEqual(Object.keys(map.scopes[s]),Object.keys(t));for(const [k,v] of Object.entries(t))assert.equal(map.scopes[s][k],relocations[v]||v);}
 const edits=[{start:C.offset(text,old.start),end:C.offset(text,old.start+old.text.length),before:Buffer.from(old.text),after:Buffer.from(updated),reason:'ONLY current importmap values, exact oldURL aliases and effective scope clones'}];
 if(cssUrl){assert(cssUrl.startsWith('/assets/')&&cssUrl.endsWith('.css'));const positions=[...text.matchAll(/<\/head>/g)];assert.equal(positions.length,1);const start=C.offset(text,positions[0].index);edits.push({start,end:start,before:Buffer.alloc(0),after:Buffer.from('<link rel="stylesheet" href="'+cssUrl+'">\n'),reason:'append one locally scoped new CSS resource; every old tag/CSS asset frozen'});}
 const d=delta(before,edits),dependencies=[];
 for(const [from,to] of Object.entries(relocations)){const oldBytes=pinned(inside(baseDir,from.slice(1)),assetPins[from.slice(1)]),ob=parse(oldBytes.toString('utf8')),nb=parse(modules[to].toString('utf8'));assert.deepEqual(specs(ob),specs(nb),'ALL_STATIC_DYNAMIC_IMPORT_STATEMENTS_FROZEN');for(const r of specs(ob)){const oldResolved=resolve(r.spec,from,old.map),newResolved=resolve(r.spec,to,map);assert.equal(newResolved,relocations[oldResolved]||oldResolved,'EFFECTIVE_DEPENDENCY_CHANGED');assert(oldResolved.startsWith('/assets/'),'ONLY_CAPTURED_ASSET_DEPENDENCIES');pinned(inside(baseDir,oldResolved.slice(1)),assetPins[oldResolved.slice(1)]);dependencies.push({from,to,spec:r.spec,kind:r.kind,before:oldResolved,after:newResolved});}}
 return {...d,dependencies,relocations,cssUrl:cssUrl||null};
}
module.exports={finalFactory,bridge,compileHost,patchHost,cssRuleChanges,cssOverlay,mapOf,resolve,specs,htmlMerge};
