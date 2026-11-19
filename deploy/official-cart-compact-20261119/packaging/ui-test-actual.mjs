import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {P,FR,H,ts,parse,assert} from './core.mjs';
const C=process.argv[2]||P+'/ui-candidate/candidate-ui',m=JSON.parse(fs.readFileSync(C+'/manifest.json')),checks=[];
const check=(name,v)=>{assert(v,name);checks.push({name,passed:true});};
for(const f of m.files){const b=fs.readFileSync(f.local);check('content-address '+f.url,H(b)===f.sha256&&f.url.includes(f.sha256));parse(b.toString());}
const config=JSON.parse(fs.readFileSync(P+'/ui-final-freeze.json'));
for(const p of m.patches){const proof=JSON.parse(fs.readFileSync(C+'/'+p.id+'-delta.json'));let b=fs.readFileSync(C+p.url);for(const d of [...proof.patches].reverse()){check('inverse span '+p.id+':'+d.newStart,b.subarray(d.newStart,d.newEnd).toString('base64')===d.newBase64);b=Buffer.concat([b.subarray(0,d.newStart),Buffer.from(d.oldBase64,'base64'),b.subarray(d.newEnd)]);}check('whole-native inverse '+p.id,H(b)===config.inputs[p.id].sha256);}
const html=fs.readFileSync(C+'/index.html','utf8'),im=JSON.parse(html.match(/<script\b[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/)[1]);
function resolve(spec,from){let u=new URL(spec,'https://offline.invalid'+from).pathname;for(const[scope,map]of Object.entries(im.scopes).filter(([scope])=>from.startsWith(scope)).sort((a,b)=>b[0].length-a[0].length))if(Object.hasOwn(map,u))return map[u];return im.imports[u]||u;}
const rootURL=m.root.url, rootOriginal=config.inputs.main.url;
for(const from of [...Object.keys(im.scopes),...m.files.map(f=>f.url)]){const resolved=resolve(rootOriginal,from);check('same-root singleton '+from,resolved===rootURL);}
for(const p of m.patches){check('global direct current asset redirects '+p.id,resolve(p.originalURL,'/assets/local-qa-root.js')===p.url);}
const cart=m.patches.find(p=>p.id==='cart'),ct=fs.readFileSync(C+cart.url,'utf8');check('ordinary heading only native g.length>0',ct.includes('g.length>0&&e.jsx("h2",{className:"ordinary-cart-group-heading"'));check('native ordinary section no new hook',!ct.includes('new QueryClient'));
const leaf=fs.readFileSync(m.files[0].local,'utf8');check('root-only official empty-state direct-child CSS present',leaf.includes('.cart-wrap:has(>.official-cart-section):not(:has(>.ordinary-cart-group-heading))>.steps')&&leaf.includes('))>.cart-layout{display:none}'));
const req=createRequire(FR+'/package.json'),React=req('react'),jsx=req('react/jsx-runtime'),skipToken=Symbol('frozen-native-skip'),noop=()=>{};
const useQueryClient=()=>{throw Error('hook must not run during module/factory creation')},useQuery=useQueryClient;
const root={r:React,j:jsx,al:{createPortal:noop},a:{useUtils:noop},L:noop,u:noop,g:noop,ac:useQuery,b:useQueryClient,d:Object.assign(noop,{error:noop,custom:noop,dismiss:noop}),__OfficialMallSkipToken:skipToken};
const nativeDialog=Object.fromEntries(['b','c','d','e','f','g'].map(k=>[k,noop]));
const context=vm.createContext({console,setTimeout,clearTimeout,setInterval,clearInterval,URL,URLSearchParams,AbortController,BigInt,TextEncoder,TextDecoder,crypto:globalThis.crypto});
const cache=new Map();function synthetic(url,values){if(cache.has(url))return cache.get(url);const mod=new vm.SyntheticModule(Object.keys(values),function(){for(const[k,v]of Object.entries(values))this.setExport(k,v);},{identifier:url,context});cache.set(url,mod);return mod;}
const mod=new vm.SourceTextModule(leaf,{identifier:m.files[0].url,context});await mod.link(async(spec)=>{if(spec===rootURL)return synthetic(spec,root);if(spec===config.inputs.dialog.url)return synthetic(spec,nativeDialog);if(spec.includes('MallLoginDialog-'))return synthetic(spec,{default:noop});if(spec.includes('PaymentMethodIcon-'))return synthetic(spec,{P:noop});throw Error('unexpected runtime import '+spec);});await mod.evaluate();
const ns=mod.namespace,host={React,jsx,trpc:root.a,Link:root.L,useLocation:root.u,skipToken};const bound=ns.createOfficialSearchResultsFactory(host);check('legacy six-slot factory callable',typeof bound.OfficialMallSearchResults==='function');check('cart section callable',typeof ns.OfficialCartSection==='function');check('same QueryClient count adapter callable',typeof ns.useCombinedCartCount==='function');
let rejects=false;try{ns.createOfficialSearchResultsFactory({...host,React:{...React}})}catch(e){rejects=String(e).includes('six-slot ABI mismatch')}check('reject different React identity',rejects);
rejects=false;try{ns.createOfficialSearchResultsFactory({...host,skipToken:Symbol('different')})}catch(e){rejects=String(e).includes('six-slot ABI mismatch')}check('reject different skipToken identity',rejects);
check('no bundled singleton inputs',!Object.keys(JSON.parse(fs.readFileSync(C+'/cartUI-metafile.json')).inputs).some(p=>p.includes('/node_modules/')&&/\/(?:react(?:-dom)?\/|@trpc\/|@tanstack\/|sonner\/|@radix-ui\/)/.test(p)));
const result={status:'passed',testCount:checks.length,checks,browser:false,realRPC:false,rootBytesChanged:false,inheritedMissing:m.checks.inheritedMissing};fs.writeFileSync(P+'/ui-tests-actual.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,testCount:checks.length,files:m.files.length,inheritedMissing:m.checks.inheritedMissing.length}));
