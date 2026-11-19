import fs from 'node:fs';
import path from 'node:path';
import {P,H,ts,assert,one,parse,nodes,declaration,pin,freeze,delta,write,save} from './core.mjs';
import {compileClosed} from './compile-closed.mjs';
const text=x=>fs.readFileSync(x,'utf8');
function exportMap(a){const m={};for(const n of a.statements)if(ts.isExportDeclaration(n)&&n.exportClause&&ts.isNamedExports(n.exportClause))for(const e of n.exportClause.elements)m[e.name.text]=e.propertyName?.text||e.name.text;return m;}
function sourceNode(a,name,match){return one(nodes(declaration(a,name),match),'EXACT_NATIVE_'+name);}
function editNode(a,n,after,reason){return {start:n.getStart(a),end:n.end,before:n.getText(a),after,reason};}
function resolveImport(im,spec,from){const u=new URL(spec,'https://offline.invalid'+from).pathname;const maps=Object.entries(im.scopes||{}).filter(([scope])=>from.startsWith(scope)).sort((a,b)=>b[0].length-a[0].length).map(x=>x[1]);maps.push(im.imports||{});for(const map of maps){if(Object.hasOwn(map,u))return map[u];for(const key of Object.keys(map).filter(k=>k.endsWith('/')&&u.startsWith(k)).sort((a,b)=>b.length-a.length))return map[key]+u.slice(key.length);}return u;}
export async function buildActualUI(config){
 const lock=freeze(config,'ui'),{c}=lock;assert(c.ui.actualCaptureBuild===true&&c.ui.hostIdentityApproved===true,'ACTUAL_UI_APPROVAL');
 const input=k=>pin(c.inputs[k].local,c.inputs[k].sha256).toString();
 const root=parse(input('routeRoot')), rootExports=exportMap(root), expected={r:'_',j:'Q',a:'zn',d:'Uw',al:'gw',u:'Hi',g:'TT',ac:'D1',b:'zi',L:'sC'};
 for(const[k,v]of Object.entries(expected))assert(rootExports[k]===v,'NATIVE_PUBLIC_EXPORT_IDENTITY '+k);
 assert(declaration(root,'D1').getText(root)==='function D1(n,a){return Is(n,to,a)}','NATIVE_USEQUERY_FUNCTION');
 assert(declaration(root,'zi').getText(root).includes('_.useContext(xg)'),'NATIVE_USEQUERYCLIENT_CONTEXT');
 assert(declaration(root,'Is').getText(root).includes('f=zi(l)'),'SAME_QUERYCLIENT_HOOK_CHAIN');
 const dialog=parse(input('dialog')), dm=exportMap(dialog);for(const[k,v]of Object.entries({b:'Dn',c:'Nn',d:'Pn',e:'An',f:'On',g:'Tn'}))assert(dm[k]===v,'DIALOG_ALIAS '+k);
 const r=await compileClosed(lock,c.ui.module,'ui');
 const nativeBase=path.posix.dirname(c.inputs.main.url), rootURL=c.inputs.routeRoot.url;
 const shell=`import * as root from ${JSON.stringify(rootURL)};
import * as dialog from ${JSON.stringify(c.inputs.dialog.url)};
import MallLoginDialog from ${JSON.stringify(nativeBase+'/MallLoginDialog-B9eOYLSy.js')};
import {P as PaymentMethodIcon} from ${JSON.stringify(nativeBase+'/PaymentMethodIcon-D3E3ZhcR.js')};
${r.leaf}
const host={React:root.r,jsx:root.j,ReactDOM:root.al,trpc:root.a,Link:root.L,useLocation:root.u,useAuth:root.g,useQuery:root.ac,useQueryClient:root.b,toast:root.d,MallLoginDialog,PaymentMethodIcon,Dialog:{Dialog:dialog.b,DialogContent:dialog.c,DialogHeader:dialog.d,DialogTitle:dialog.e,DialogDescription:dialog.f,DialogFooter:dialog.g}};
const bound=createOfficialCartUIFactory(host).instantiate(host);
export const OfficialCartSection=bound.OfficialCartSection;
export const useCombinedCartCount=bound.useCombinedCartCount;
export function createOfficialSearchResultsFactory(live){if(live.React!==host.React||live.jsx!==host.jsx||live.trpc!==host.trpc||live.Link!==host.Link||live.useLocation!==host.useLocation||live.skipToken!==root.__OfficialMallSkipToken)throw Error('Frozen same-host six-slot ABI mismatch');return {OfficialMallSearchResults:bound.OfficialMallSearchResults};}
`;
 parse(shell);const uiURL='/assets/official-cart-ui-'+H(shell)+'.js', patches=[];
 function nativePatch(key,edits,mutatedFunctions){const before=input(key),a=parse(before),d=delta(before,edits),next=parse(d.text),protectedDeclarations=[];for(const s of a.statements){const ds=ts.isFunctionDeclaration(s)&&s.name?[s]:ts.isVariableStatement(s)?[...s.declarationList.declarations].filter(d=>ts.isIdentifier(d.name)):[];for(const n of ds){const name=n.name.text;if(mutatedFunctions.includes(name))continue;const t=declaration(next,name).getText(next);assert(t===n.getText(a),'UNCHANGED_NATIVE_DECLARATION '+key+':'+name);protectedDeclarations.push({name,sha256:H(t)});}}
  assert(JSON.stringify(exportMap(a))===JSON.stringify(exportMap(next)),'PRESERVE_NATIVE_EXPORT_ABI '+key);
  const url=path.posix.dirname(c.inputs[key].url)+'/'+key+'-official-cart-'+H(d.bytes)+'.js';patches.push({key,url,originalURL:c.inputs[key].url,...d,protectedDeclarations});return url;}
 const searchText=input('search'), sa=parse(searchText), searchFactory=declaration(sa,'K1');
 const oldFactory=one(sa.statements.filter(n=>ts.isImportDeclaration(n)&&n.moduleSpecifier.text===c.inputs.wrapper.url),'OLD_WRAPPER_IMPORT');
 const count=sourceNode(sa,'K1',n=>ts.isCallExpression(n)&&n.expression.getText(sa)==='D.cart.count.useQuery');
 const style=one(nodes(searchFactory,n=>(ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateExpression(n))&&n.getText(sa).includes('.srch-root{')),'SEARCH_STYLE');
 const sourceSearch=lock.load(Object.keys(c.sourceFiles).find(p=>p.endsWith('/client/src/pages/SearchPage.tsx')));
 const css=sourceSearch.split('\n').filter(l=>l.includes('1280px')||l.includes('max-width:1232px')||l.includes('@media(max-width:760px){.srch-root>')).join('\n');assert(css.includes('max-width:1280px')&&css.length<3000,'SOURCE_COMPACT_CSS');
 const searchURL=nativePatch('search',[
 {start:0,end:0,before:'',after:'import {useCombinedCartCount as __useCombinedCartCount} from '+JSON.stringify(uiURL)+';\n',reason:'source-bound same-root count hook import only'},
 editNode(sa,oldFactory.moduleSpecifier,JSON.stringify(uiURL),'same six-slot factory import replacement'),
 editNode(sa,count,'__useCombinedCartCount('+count.getText(sa)+')','presentation-only sum using existing ordinary query and native existing queryClient'),
 {start:style.end-1,end:style.end-1,before:'',after:'\n'+css+'\n',reason:'frozen source 1280px scoped CSS append only'}
 ],['K1']);
 const navText=input('nav'),na=parse(navText),nc=sourceNode(na,'q',n=>ts.isCallExpression(n)&&n.expression.getText(na)==='L.cart.count.useQuery');
 const navURL=nativePatch('nav',[
 {start:0,end:0,before:'',after:'import {useCombinedCartCount as __useCombinedCartCount} from '+JSON.stringify(uiURL)+';\n',reason:'same-host official count hook import'},
 editNode(na,nc,'__useCombinedCartCount('+nc.getText(na)+')','frontend-sum only; original native count query unchanged inside call')
 ],['q']);
 const cartText=input('cart'),ca=parse(cartText),cart=declaration(ca,'st'),wrap=one(nodes(cart,n=>ts.isObjectLiteralExpression(n)&&n.properties.some(p=>p.name?.text==='className'&&p.initializer?.text==='cart-wrap')),'CART_WRAP');
 const children=one(wrap.properties.filter(p=>p.name?.text==='children'),'CART_CHILDREN').initializer;assert(ts.isArrayLiteralExpression(children),'CART_CHILD_ARRAY');const crumb=children.elements[0];assert(H(crumb.getText(ca))==='2c2a66d8bed3aa07ad334adac687e957bc04c2c7a249c8d59aa66bec2701be7f','CRUMB_EXACT_PREIMAGE');
 const cartURL=nativePatch('cart',[
 {start:0,end:0,before:'',after:'import {OfficialCartSection as __OfficialCartSection} from '+JSON.stringify(uiURL)+';\n',reason:'source-bound official leaf only'},
 {start:crumb.end,end:crumb.end,before:'',after:',e.jsx(__OfficialCartSection,{ordinaryGroupCount:Ke.length,ordinaryStage:C}),g.length>0&&e.jsx("h2",{className:"ordinary-cart-group-heading",children:"普通商户 · 企业对公转账"})',reason:'two approved new siblings after breadcrumb; all native ordinary expressions unchanged'}
 ],['st']);
 const html=input('frontHtml'), match=one([...html.matchAll(/<script\b[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/g)],'ONE_IMPORTMAP');
 const im=JSON.parse(match[1]), beforeIm=structuredClone(im), rewrites={[c.inputs.search.url]:searchURL,[c.inputs.cart.url]:cartURL,[c.inputs.nav.url]:navURL};
 const counts={};for(const old of Object.keys(rewrites))counts[old]=html.split(old).length-1;
 assert(counts[c.inputs.search.url]===13&&counts[c.inputs.cart.url]===3&&counts[c.inputs.nav.url]===5,'HTML_CAPTURE_REFERENCE_COUNTS');
 for(const map of [im.imports,...Object.values(im.scopes)])for(const[k,v]of Object.entries(map))if(rewrites[v])map[k]=rewrites[v];
 for(const p of patches)if(beforeIm.scopes[p.originalURL])im.scopes[p.url]=structuredClone(im.scopes[p.originalURL]);
 // Old scopes can contain entry-to-entry aliases. All mapping VALUES must be terminal candidate URLs.
 for(const [old,next]of Object.entries(rewrites))im.imports[old]=next;
 const imText=JSON.stringify(im), start=match.index+match[0].indexOf(match[1]),hd=delta(html,[{start,end:start+match[1].length,before:match[1],after:imText,reason:'replace only import-map data with exact target rewrites and inherited candidate scopes'}]);
 const unresolvedValues=[];for(const[scope,map]of [['imports',im.imports],...Object.entries(im.scopes)])for(const[k,v]of Object.entries(map))if(rewrites[v])unresolvedValues.push({scope,k,v});assert(!unresolvedValues.length,'NO_LEFTOVER_ENTRY_ALIAS');
 const captureByURL=new Map();for(const x of Object.values(c.inputs))if(x.url)captureByURL.set(x.url,x);for(const x of Object.values(c.inputs)){const m=x.local.match(/\/front\/dist\/public(\/.*)$/);if(m)captureByURL.set(m[1],x);}
 const generated=new Map([[uiURL,shell],...patches.map(p=>[p.url,p.text])]);
 const importChecks=[],inheritedMissing=[];for(const[url,s]of generated){const a=parse(s);for(const n of a.statements)if(ts.isImportDeclaration(n)){const spec=n.moduleSpecifier.text,resolved=resolveImport(im,spec,url),available=generated.has(resolved)||captureByURL.has(resolved);if(!available){const p=patches.find(p=>p.url===url);assert(p&&resolveImport(beforeIm,spec,p.originalURL)===resolved,'NEW_UNRESOLVED_CANDIDATE_IMPORT '+url+' -> '+spec+' -> '+resolved);inheritedMissing.push({from:url,spec,resolved,inheritedFrom:p.originalURL});}importChecks.push({from:url,spec,resolved,capturedSha256:captureByURL.get(resolved)?.sha256||(generated.has(resolved)?H(generated.get(resolved)):null),available});}}
 const rootIdentityChecks=[];for(const[from,s]of generated){const a=parse(s);for(const n of a.statements)if(ts.isImportDeclaration(n)&&/main(?:-D3xcYX4O|-nav-without-self)/.test(n.moduleSpecifier.text)){const resolved=resolveImport(im,n.moduleSpecifier.text,from);assert(resolved===rootURL,'NO_SPLIT_ROOT '+from);rootIdentityChecks.push({from,spec:n.moduleSpecifier.text,resolved});}}
 const cssRefs=[...new Set([...html.matchAll(/(?:href|["'])\s*=??\s*["'](\/assets\/[^"']+\.css)["']/g)].map(m=>m[1]))];
 const styles=JSON.parse(lock.load(P+'/capture-ui-slots.json')).styles.allCurrentHTMLCSSReferences;assert(styles.length===6&&styles.every(x=>captureByURL.has(x.url)),'ALL_SIX_STYLES_CAPTURED');
 const out=P+'/'+c.ui.outputName;assert(!fs.existsSync(out),'FRESH_UI_CANDIDATE_OUTPUT');lock.verify();
 write(out+uiURL,shell);save(out+'/cartUI-metafile.json',r.metafile);for(const p of patches){write(out+p.url,p.bytes);save(out+'/'+p.key+'-delta.json',p.proof);}write(out+'/index.html',hd.bytes);save(out+'/html-delta.json',hd.proof);
 const manifest={schema:'cart-offline-ui-actual-v1',status:inheritedMissing.length?'offline-candidate-built-inherited-capture-inputs-missing':'offline-parent-review-required-not-published',configSha256:lock.configSha256,freezeApproval:c.freezeApproval,sourceBinding:c.sourceBinding,sourceFiles:c.sourceFiles,sourcePreimages:c.sourcePreimages,toolHashes:c.toolHashes,dependencyHashes:c.dependencyHashes,capturedInputs:Object.keys(c.inputs).length,countStrategy:c.ui.countStrategy,root:{url:rootURL,sha256:c.inputs.routeRoot.sha256,exportAliases:expected,queryHook:'D1 -> Is -> zi -> React.useContext(xg)',rootExportAddition:false,rootBytesChanged:false},modules:[{url:uiURL,sha256:H(shell),bytes:Buffer.byteLength(shell),loadedClosure:r.loadedClosure,bridges:r.bridges}],patches:patches.map(p=>({id:p.key,url:p.url,originalURL:p.originalURL,sha256:H(p.bytes),bytes:p.bytes.length,beforeSha256:p.proof.beforeSha256,inverseVerified:p.proof.inverseVerified,deltaSpans:p.proof.patches.length,protectedDeclarations:p.protectedDeclarations})),html:{sha256:H(hd.bytes),inverseVerified:true,referenceCounts:counts,rewrites,scopesAdded:patches.filter(p=>beforeIm.scopes[p.originalURL]).map(p=>p.url),noLeftoverAliasValues:true},checks:{jsParseErrors:0,importChecks,inheritedMissing,completeCapturedDirectImportGraph:inheritedMissing.length===0,rootIdentityChecks,allSixCurrentCSS:styles,duplicateSingletonInputs:[],nativeOrdinaryOutsideApprovedDeltasByteExact:true},limitations:['No browser, production, POST, DB, SSH, Git, deployment or real payment execution.','Native hook/provider identity statically proven; inherited missing captures explicitly listed; parent must perform browser and mocked real RPC grammar acceptance.','Ordinary native count cached result unchanged; frontend data projection only.']};
 manifest.files=[{url:uiURL,sha256:H(shell),bytes:Buffer.byteLength(shell),local:out+uiURL},...patches.map(p=>({url:p.url,sha256:H(p.bytes),bytes:p.bytes.length,local:out+p.url}))];
 save(out+'/manifest.json',manifest);lock.verify();console.log(JSON.stringify({out,htmlSha256:manifest.html.sha256,uiURL,patches:manifest.patches.map(({protectedDeclarations,...p})=>p),parseErrors:0,imports:importChecks.length},null,2));return manifest;
}
