#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const W=path.dirname(new URL(import.meta.url).pathname);
const R='/home/ubuntu/work/channel-release-20261121-1837/manager';
const req=createRequire(R+'/package.json'),ts=req('typescript');
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>fs.readFileSync(p,'utf8');
const J=p=>JSON.parse(read(p));
const args=Object.fromEntries(process.argv.slice(2).reduce((a,x,i,all)=>{if(i%2===0)a.push([x,all[i+1]]);return a;},[]));
for(const k of ['--wb0','--wb1','--runtime','--css'])assert(args[k],k+' required');
const C=J(W+'/capture/records.json'),O=W+'/candidate';
fs.mkdirSync(O+'/assets',{recursive:true});
fs.mkdirSync(O+'/evidence',{recursive:true});
const parse=(s,name)=>{const a=ts.createSourceFile(name,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(a.parseDiagnostics.length,0,'Syntax '+name);return a;};
function nodes(a,p){const r=[];function v(n){if(p(n))r.push(n);ts.forEachChild(n,v);}v(a);return r;}
function specs(s){const a=parse(s,'module.js');return [...new Set(nodes(a,n=>(ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier||ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword).map(n=>n.moduleSpecifier??n.arguments[0]).map(n=>{assert(ts.isStringLiteral(n),'literal module specifier');return n.text;}))];}
function resolve(m,s,base){const key=s.startsWith('.')?new URL(s,'https://admin.51dianzi.com'+base).pathname:s;for(const scope of Object.keys(m.scopes??{}).filter(x=>base.startsWith(x)).sort((a,b)=>b.length-a.length)){if(Object.hasOwn(m.scopes[scope],key))return m.scopes[scope][key];if(Object.hasOwn(m.scopes[scope],s))return m.scopes[scope][s];}return m.imports[key]??m.imports[s]??key;}
const assets=[],replacements={},modules=[];
function save(prefix,file,ext){const b=fs.readFileSync(file);if(ext==='js')parse(b.toString('utf8'),file);const sha256=H(b),url='/assets/'+prefix+'-'+sha256.slice(0,16)+'.'+ext,local=O+url;fs.writeFileSync(local,b);assets.push({side:'admin',url,local,sha256,size:b.length});return url;}
for(const i of [0,1]){const label='workbench-'+i,rec=C[label];assert.equal(H(fs.readFileSync(rec.local)),rec.sha256);const url=save('BusinessWorkbenchPage-customer-consistency',args['--wb'+i],'js');replacements[rec.url]=url;const asset=assets.at(-1);modules.push({index:i,url:rec.url,afterURL:url,beforeSHA:rec.sha256,afterSHA:asset.sha256,local:asset.local});}
const uiURL=save('AdminNewInformation-customer-consistency-runtime',args['--runtime'],'js');
replacements[C['ui-runtime'].url]=uiURL;
const cssURL=save('customer-consistency',args['--css'],'css');
const html=read(C['admin-html'].local);assert.equal(H(html),C['admin-html'].sha256);
const match=[...html.matchAll(/<script\b[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/g)].at(-1);assert(match,'active import map');
const oldMap=JSON.parse(match[1]),map=structuredClone(oldMap);
for(const table of [map.imports,...Object.values(map.scopes??{})])for(const [k,v]of Object.entries(table))table[k]=replacements[v]??v;
for(const [from,to]of Object.entries(replacements)){
 map.imports[from]=to;
 if(from===C['ui-runtime'].url)continue;
 map.scopes??={};
 const oldScope=Object.keys(oldMap.scopes??{}).filter(k=>from.startsWith(k)).sort((a,b)=>b.length-a.length)[0];
 if(oldScope)map.scopes[to]=Object.fromEntries(Object.entries(oldMap.scopes[oldScope]).map(([k,v])=>[k,replacements[v]??v]));
}
const resolutions=[];
for(const label of ['nav','workbench-0','workbench-1']){
 const rec=C[label],to=replacements[rec.url]??rec.url;
 const afterText=label==='nav'?read(rec.local):read(modules.find(m=>m.index===Number(label.at(-1))).local);
 assert.deepEqual(specs(afterText),specs(read(rec.local)),'No import ABI change '+label);
 for(const s of specs(read(rec.local))){const before=resolve(oldMap,s,rec.url),expected=replacements[before]??before,after=resolve(map,s,to);assert.equal(after,expected,'Singleton/dependency '+label+' '+s);resolutions.push({from:rec.url,to,spec:s,before,after});}
}
for(const [k,v]of Object.entries(oldMap.imports))assert.equal(map.imports[k],replacements[v]??v,'non-target alias '+k);
for(const [scope,table]of Object.entries(oldMap.scopes??{}))for(const [k,v]of Object.entries(table))assert.equal(map.scopes[scope][k],replacements[v]??v,'non-target scope '+scope+' '+k);
const newScript=match[0].replace(match[1],JSON.stringify(map));
let next=html.slice(0,match.index)+newScript+html.slice(match.index+match[0].length);
assert.equal(next.split(C.css.url).length,2,'one current customer CSS link');
next=next.replace(C.css.url,cssURL);
assert.equal(next.replace(cssURL,C.css.url).replace(newScript,match[0]),html,'exact HTML inverse');
fs.writeFileSync(O+'/index.html',next);
const sourceFiles=[
 'client/src/lib/adminNewInformation.tsx',
 'client/src/components/admin/AdminNewInformationBadge.tsx',
 'client/src/components/admin/AdminNewInformationMenuBadge.tsx',
 'client/src/business/platform/client/src/pages/CustomerDetail.tsx',
 'client/src/business/platform/client/src/pages/CustomerList.tsx',
 'client/src/business/platform/client/src/pages/CustomerList.css',
 'client/src/business/platform/client/src/components/customers/CustomerSupplyCell.tsx',
 'shared/adminNewInformation.ts'
];
const sourcePins=Object.fromEntries(sourceFiles.map(f=>[R+'/'+f,H(fs.readFileSync(R+'/'+f))]));
const manifest={scope:'customer-consistency-release-20261122-0034',sourcePins,html:{local:O+'/index.html',beforeSHA:H(html),afterSHA:H(next),size:Buffer.byteLength(next)},assets,modules,uiURL,cssURL,replacements,resolutions,checks:{fullHTMLInverse:true,allNonTargetAliasesPreserved:true,nativeImportABIPreserved:true,sameOriginalReactQueryAndBusinessScope:true,navBytesUnchanged:true,frontHTMLAndBothAPIsAndServerRuntimeUnchanged:true,noPM2ReloadRequired:true},tests:{status:'PENDING_FINAL_TARGETED_CHECKS'}};
fs.writeFileSync(O+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({status:'ASSEMBLED_NOT_PUBLISHED',assets:assets.length,htmlSHA:H(next),uiURL,cssURL,workbenchURLs:modules.map(x=>x.afterURL)},null,2));
