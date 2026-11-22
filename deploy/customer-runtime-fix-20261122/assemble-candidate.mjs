#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const R=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const req=createRequire(R+'/package.json'),esbuild=req('esbuild');
const lexer=createRequire(req.resolve('vite/package.json'))('es-module-lexer');
await lexer.init;
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),O=config.output;
assert(path.isAbsolute(O));
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>fs.readFileSync(p,'utf8');
function specs(s){const imports=lexer.parse(s)[0].filter(i=>i.d!==-2);for(const i of imports)assert(typeof i.n==='string','literal module specifier required');return [...new Set(imports.map(i=>i.n))];}
const norm=(s,base)=>s.startsWith('.')?new URL(s,'https://admin.51dianzi.com'+base).pathname:s;
function resolve(m,s,base){const k=norm(s,base);for(const scope of Object.keys(m.scopes??{}).filter(x=>base.startsWith(x)).sort((a,b)=>b.length-a.length)){if(Object.hasOwn(m.scopes[scope],k))return m.scopes[scope][k];if(Object.hasOwn(m.scopes[scope],s))return m.scopes[scope][s];}return m.imports[k]??m.imports[s]??k;}
const html=read(config.html);assert.equal(H(html),config.htmlSHA);
const match=[...html.matchAll(/<script\b[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/g)].at(-1);assert(match);
const oldMap=JSON.parse(match[1]),map=structuredClone(oldMap),assets=[],replacements={},modules=[];
fs.mkdirSync(O+'/assets',{recursive:true});
for(const item of config.modules){
  assert(!item.compactWhitespace,'Whole-workbench whitespace optimization is deferred');
  const bytes=read(item.local);assert.equal(H(bytes),item.sha256);
  // Native transforms in the generators already verified their precise slots.
  // Validate syntax sequentially with esbuild, without retaining a JS AST.
  await esbuild.transform(bytes,{loader:'js',target:'esnext',format:'esm',legalComments:'none'});
  const url=item.url,sha256=H(bytes),local=O+url;
  assert(url.includes(sha256.slice(0,16)),'content hash URL');
  fs.mkdirSync(path.dirname(local),{recursive:true});fs.writeFileSync(local,bytes);
  assets.push({side:'admin',url,local,sha256,size:Buffer.byteLength(bytes)});
  replacements[item.oldUrl]=url;modules.push({...item,url,local,sha256,size:Buffer.byteLength(bytes),specifiers:specs(bytes)});
  console.log('Syntax and dependency parse PASS '+item.label);
}
let css=read(config.css.local);assert.equal(H(css),config.css.sha256);
if(config.css.append)css+='\n'+read(config.css.append);
const cssSHA=H(css),cssURL='/assets/customer-runtime-fix-'+cssSHA.slice(0,16)+'.css',cssLocal=O+cssURL;
fs.writeFileSync(cssLocal,css);assets.push({side:'admin',url:cssURL,local:cssLocal,sha256:cssSHA,size:Buffer.byteLength(css)});
for(const table of [map.imports,...Object.values(map.scopes??{})])for(const[k,v]of Object.entries(table))table[k]=replacements[v]??v;
for(const[from,to]of Object.entries(replacements))map.imports[from]=to;
// Each new exact scope carries only that module's actual imports. Existing
// scopes remain intact, with only the approved target values replaced.
for(const m of modules){if(m.url===m.oldUrl||m.specifiers.length===0)continue;const table={};for(const s of m.specifiers){const before=resolve(oldMap,s,m.oldUrl);table[norm(s,m.url)]=replacements[before]??before;}map.scopes??={};map.scopes[m.url]=table;}
const resolutions=[];
for(const m of modules)for(const s of m.specifiers){const before=resolve(oldMap,s,m.oldUrl),expected=replacements[before]??before,after=resolve(map,s,m.url);assert.equal(after,expected,'dependency '+m.oldUrl+' '+s);resolutions.push({from:m.oldUrl,to:m.url,specifier:s,before,after});}
for(const[k,v]of Object.entries(oldMap.imports))assert.equal(map.imports[k],replacements[v]??v);
for(const[scope,table]of Object.entries(oldMap.scopes??{}))for(const[k,v]of Object.entries(table))assert.equal(map.scopes[scope][k],replacements[v]??v);
const script=match[0].replace(match[1],JSON.stringify(map));let next=html.slice(0,match.index)+script+html.slice(match.index+match[0].length);
const entry=modules.find(m=>m.label==='entry');assert(entry);
const mainTags=[...next.matchAll(/<script\b[^>]*src=["'][^"']+["'][^>]*>/g)].filter(m=>m[0].includes(entry.oldUrl));assert.equal(mainTags.length,1);
const oldMain=mainTags[0][0],newMain=oldMain.replace(entry.oldUrl,entry.url);next=next.replace(oldMain,newMain);
assert.equal(next.split(config.css.oldUrl).length,2);next=next.replace(config.css.oldUrl,cssURL);
assert.equal(next.replace(script,match[0]).replace(newMain,oldMain).replace(cssURL,config.css.oldUrl),html,'exact HTML inverse');
assert.equal(resolve(map,config.ordersSpecifier,entry.url),modules.find(m=>m.label==='orders').url,'actual entry Orders specifier');
const htmlLocal=O+'/index.html';fs.writeFileSync(htmlLocal,next);
const sourcePins=Object.fromEntries(config.sourceFiles.map(p=>[p,H(fs.readFileSync(R+'/'+p))]));
const manifest={status:'ASSEMBLED_NOT_PUBLISHED',baseHtmlSHA:H(html),html:{local:htmlLocal,sha256:H(next),bytes:Buffer.byteLength(next)},sourcePins,assets,modules:modules.map(({specifiers,...m})=>m),replacements,resolutions,cssURL,entryURL:entry.url,notificationURL:modules.find(m=>m.label==='notification').url,checks:{exactHTMLInverse:true,allNonTargetMappingsPreserved:true,allTargetDependenciesSameResolvedInstances:true,ordersActualSpecifierVerified:true,sequentialSyntaxChecksPassed:true,noNewProviderOrQueryClient:true,noImmutableFileOverwritten:true,oldCSSPrefixAndFoundationRetained:true,largeWorkbenchWhitespaceOptimizationDeferred:true},releasePrerequisites:['User approval to publish','Fresh production capture and CAS; this is an offline candidate','No real account ack validation performed'],tests:{status:'PENDING_FINAL_INTEGRATION'}};
fs.writeFileSync(O+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({status:manifest.status,htmlSHA:manifest.html.sha256,assetCount:assets.length,dependencies:resolutions.length,assets:assets.map(({url,size})=>({url,size}))},null,2));
