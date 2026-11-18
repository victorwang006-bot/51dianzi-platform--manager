import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {H,assert,one,parse,nodes,declaration,ts,bytesDelta,verifyInverse,saveJSON} from '/home/ubuntu/work/commission-simple-20261118/packaging/current-tools/native-core.mjs';
export {H,assert,one,parse,nodes,declaration,ts,bytesDelta,verifyInverse,saveJSON};
export const D=path.dirname(fileURLToPath(import.meta.url)),I=D+'/inputs',O=D+'/candidate';
export const FR='/home/ubuntu/work/sales-20261117/platform',GEN='/home/ubuntu/work/sales-20261117/manager/deploy/official-mall-native-v10/build-front-static.mjs';
export const sourcePaths=[FR+'/client/src/pages/SearchPage.tsx',FR+'/client/src/lib/officialMallNavigation.ts',GEN];
export const oldSearch='/assets/SearchPage-merchant-restore-cf0bda2b1bae0073.js',rootURL='/assets/main-nav-without-self-1e7f3c8fd3e382b0.js';
export const inputHashes=Object.freeze({
 'current-index.html':'e1685a7a752cb8e02d1ef74282abe78a0db7bb7125d0b64542007faf1214bc44',
 'current-search.js':'cf0bda2b1bae007337d4ccd10a7b4f722bda6365a3b9b9a075e746c39d31b607',
 'current-catalog.js':'0950ab04107ec94e76a59107032a5faa7072f0cbda33fb37911c4225171c99db',
 'current-root.js':'1e7f3c8fd3e382b03a7210fef485d34e5eae5199f4a525c3a7fa1c7f921e20f8',
 'current-ui.js':'ef99355486670c458862b844dfecb3bd5158bbe33209e1bf364c7d935ba63183',
 'current-merchant.css':'0629f82af4c805834baf68a9ce183dc20e42d9c96f88d3d913395d15efd8da47',
 'source-before.tsx':'86451e5f9e5254d721555ff52c576db5c8e6d76d446b65a2a8469d168ddaaa9d',
 'generator-before.mjs':'17f1c71e697bce9c41d97a0a912248babf60dfef21daaea1186fe4db855228ed',
 'native-core-before.mjs':'5a25e0bb7a527c094cf61856dc1d3ecc874f9357e42910b0ac0d35df4922ba72'
});
export function inputs(){return Object.fromEntries(Object.entries(inputHashes).map(([name,h])=>{const b=fs.readFileSync(I+'/'+name);assert(H(b)===h,'INPUT CAS '+name);return[name,b];}));}
export function importMap(html){return JSON.parse(one([...html.matchAll(/<script[^>]+type="importmap"[^>]*>(.*?)<\/script>/gs)],'single actual importmap')[1]);}
export function resolveMap(spec,parent,map){
 const origin='https://51dianzi.com',url=u=>new URL(u,origin).href;
 const absolute=/^(?:\.|\/|https?:)/.test(spec)?new URL(spec,url(parent)).href:spec;
 function match(mp){for(const key of Object.keys(mp||{}).sort((a,b)=>b.length-a.length)){
  const k=/^(?:\.|\/|https?:)/.test(key)?url(key):key;
  if(absolute===k||(k.endsWith('/')&&absolute.startsWith(k))){const target=mp[key];assert(typeof target==='string','blocked importmap entry');return url(target)+(k.endsWith('/')?absolute.slice(k.length):'');}
 }}
 const parentURL=url(parent);
 for(const scope of Object.keys(map.scopes||{}).sort((a,b)=>b.length-a.length))if(parentURL.startsWith(url(scope))){const r=match(map.scopes[scope]);if(r)return new URL(r).pathname;}
 const r=match(map.imports);return r?new URL(r).pathname:new URL(absolute).pathname;
}
export function currentFreeze(){const f=JSON.parse(fs.readFileSync(D+'/source-freeze.json'));for(const[p,h]of Object.entries(f.files))assert(H(fs.readFileSync(p))===h,'SOURCE/TOOL FROZEN CAS '+p);return f;}
export function verifySourceOnly(oldSource,newSource){
 const oa=parse(oldSource,'old.tsx'),na=parse(newSource,'SearchPage.tsx');
 const of=declaration(oa,'SearchPage'),nf=declaration(na,'SearchPage');
 const oc=one(nodes(of,n=>ts.isConditionalExpression(n)),'old source conditional'),nc=one(nodes(nf,n=>ts.isConditionalExpression(n)),'new source conditional');
 assert(oc.whenTrue.getText(oa)===nc.whenTrue.getText(na),'source Catalog expression exact');
 const addedImport=one(na.statements.filter(n=>ts.isImportDeclaration(n)&&n.moduleSpecifier.text==='@/lib/officialMallNavigation'),'one new type-free source helper import');
 const recovered=newSource.slice(0,addedImport.getFullStart())+newSource.slice(addedImport.end);
 const ra=parse(recovered,'recovered.tsx'),rc=one(nodes(declaration(ra,'SearchPage'),n=>ts.isConditionalExpression(n)),'recovered source conditional');
 const inverse=recovered.slice(0,rc.whenFalse.getStart(ra))+oc.whenFalse.getText(oa)+recovered.slice(rc.whenFalse.end);
 assert(inverse===oldSource,'source bytes outside added import and ordinary return exact');
 assert(declaration(oa,'OrdinaryInventorySearchPage').getText(oa)===declaration(na,'OrdinaryInventorySearchPage').getText(na),'source merchant render exact');
 return {sourceSelfExpressionExact:true,ordinaryInventorySourceExact:true,outsideSourceTwoHunksExact:true};
}
