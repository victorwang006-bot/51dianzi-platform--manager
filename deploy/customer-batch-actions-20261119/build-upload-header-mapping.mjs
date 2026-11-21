#!/usr/bin/env node
/** Offline-only native customer upload leaf. Existing shell, inventory and other handlers stay byte-exact. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as esbuild from 'esbuild';
import postcss from 'postcss';
import { batch } from '../upload-manage-20261119/native-abi.mjs';
import { H, parse, nodes, one, declarations, noLoads, noFreeIdentifiers, inverseDelta, htmlDelta } from '../upload-manage-20261119/build-support.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const BASE=process.env.CUSTOMER_UPLOAD_BASE, OUT=process.env.CUSTOMER_UPLOAD_UI_OUT;
assert(BASE && OUT && !fs.existsSync(OUT),'explicit existing baseline and fresh output required');
const file='client/src/business/platform/client/src/components/channelInventory/BatchUpload.tsx';
const cssFile='client/src/business/platform/client/src/components/channelInventory/batch.css';
const bindings={...batch,nc:'nc',rc:'rc'};
function put(n,b){const p=path.join(OUT,n);fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,b);}
function json(n,d){put(n,JSON.stringify(d,null,2)+'\n');}
const source=fs.readFileSync(path.join(ROOT,file),'utf8');
const transformed=await esbuild.transform(source,{loader:'tsx',jsx:'automatic',format:'esm',target:'es2020',minify:false});
const compiled=parse(transformed.code,file);
let leaf=one(compiled.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='BatchUploadSession'),'source BatchUploadSession').getText(compiled).replace(/^export\s+/,'');
assert.equal(leaf.split('import("xlsx")').length,4,'three inherited uses of the same spreadsheet dependency');
leaf=leaf.replaceAll('import("xlsx")','Promise.resolve().then(() => (nc(), rc))');
const aliases=Object.entries(bindings).filter(([a,b])=>a!==b).map(([a,b])=>`${a}=${b}`).join(',');
const wrapper=`function T6(props){\nconst ${aliases};\n${leaf}\nreturn BatchUploadSession(props);\n}`;
noLoads(wrapper);noFreeIdentifiers(wrapper,bindings);
function customerScope(ast){const history=one(nodes(ast,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='z3'&&n.getText(ast).includes('customerUploadHistoryGet.query')),'native history');const scope=history.parent;assert(ts.isBlock(scope));let owner=scope;while(owner&&!ts.isVariableDeclaration(owner))owner=owner.parent;assert.equal(owner?.name?.getText(ast),'__CHANNEL_REFERENCE_HOST_EXPORTS');return scope;}
const beforeHtml=fs.readFileSync(path.join(BASE,'admin-index.html'));
const names=[...new Set(beforeHtml.toString().match(/assets\/BusinessWorkbenchPage-customer-batch-[a-f0-9]+\.js/g))].map(n=>path.basename(n)).sort();
assert.equal(names.length,2,'two actually referenced native workbench assets');
const modules=[];
for(const name of names){
 const bytes=fs.readFileSync(path.join(BASE,'assets',name));assert(H(bytes).startsWith(name.match(/([a-f0-9]+)\.js$/)[1]));
 const before=bytes.toString();assert(Buffer.from(before).equals(bytes));
 const ast=parse(before,name),decls=declarations(customerScope(ast)),native=one(decls.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='T6'),'native upload leaf'),abi={};
 for(const [key,value] of Object.entries(bindings)){const n=one(decls.filter(n=>n.name?.getText(ast)===value),'ABI '+key+'='+value);abi[key]={native:value,sha256:H(n.getText(ast)),head:n.getText(ast).slice(0,160)};}
 assert.equal(abi.React.head,'Ct=__customerLive.React');
 const {after,records}=inverseDelta(before,[{name:'T6/BatchUploadSession',start:native.getStart(ast),end:native.end,old:native.getText(ast),replacement:wrapper}]);
 const sha256=H(after),relative=`assets/BusinessWorkbenchPage-customer-batch-${sha256.slice(0,16)}.js`;
 put('package/'+relative,after);json('package/evidence/'+name+'.delta.json',{input:'assets/'+name,output:relative,beforeSha256:H(bytes),afterSha256:sha256,patches:records,inverseVerified:true,allBytesOutsideCustomerFunctionsUnchanged:true});
 json('package/evidence/'+name+'.abi.json',abi);modules.push({before:'assets/'+name,after:relative,sha256,size:Buffer.byteLength(after)});
}
const cssSource=fs.readFileSync(path.join(ROOT,cssFile),'utf8');
const marker='/* Manual source-column mapping stays inside the customer upload table. */';
assert.equal(cssSource.split(marker).length,2,'one customer-only CSS delta');
const css=marker+cssSource.split(marker)[1];const cssAst=postcss.parse(css);
cssAst.walkAtRules(n=>assert.equal(n.name,'media'));
cssAst.walkRules(n=>assert(/^\.customer-supply-dialog(?=[\s.:#\[>+~]|$)/.test(n.selector),'customer-only CSS '+n.selector));
assert(!/url\s*\(|@import|@font-face/i.test(css),'no new assets or global loads');
const cssRelative=`assets/customer-batch-actions-${H(css).slice(0,16)}.css`;put('package/'+cssRelative,css);
const html=htmlDelta(beforeHtml,modules,cssRelative);put('package/before-index.html',beforeHtml);put('package/after-index.html',html.after);
const assets=modules.map(m=>({relative:m.after,sha256:m.sha256,size:m.size})).concat({relative:cssRelative,sha256:H(css),size:Buffer.byteLength(css)});
json('modules.json',modules);json('assets.json',assets);json('replacements.json',modules.map(m=>({before:'/'+m.before,after:'/'+m.after})));put('css-relative.txt',cssRelative+'\n');
json('package/evidence/html.json',{beforeSha256:H(beforeHtml),afterSha256:H(html.after),counts:html.counts,link:html.link,inverseVerified:true});
for(const module of modules){const text=fs.readFileSync(path.join(OUT,'package',module.after),'utf8');assert(text.includes('__customerBatchFailures')&&text.includes('CustomerUploadFailuresDialog'),'inherited failure recovery remains included byte-exact');}
json('package/evidence/source-files.json',{sourceHashes:{[file]:H(source),[cssFile]:H(cssSource)},sourceStableDuringBuild:true,embeddedFailuresIncluded:true,compiler:'esbuild.transform',esbuildVersion:esbuild.version,builderSha256:H(fs.readFileSync(fileURLToPath(import.meta.url)))});
json('package/evidence/sources.json',[{file,name:'BatchUploadSession',native:'T6',sourceSha256:H(source),compiledSha256:H(leaf)}]);
put('compiled-upload-leaf.js',leaf+'\n');
assert.equal(H(fs.readFileSync(path.join(ROOT,file))),H(source));assert.equal(H(fs.readFileSync(path.join(ROOT,cssFile))),H(cssSource));
console.log(JSON.stringify({status:'OFFLINE_CUSTOMER_UPLOAD_LEAF_BUILT_NOT_DEPLOYED',modules,assets},null,2));
