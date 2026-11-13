#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {OUT,LIVE,read,json,write,sha,tree,nodes} from './tests/admin-candidate-helper.mjs';
const build=json(OUT+'/build-admin-proof.json'),htmlProof=json(OUT+'/html-relocation-proof.json'),manifest=json(OUT+'/files.admin-static.json'),baseline=json(OUT+'/baseline-files.sha256.json');
const origin='https://offline.invalid';
const canon=(s,ref)=>{const u=new URL(s,origin+ref);return u.origin===origin?u.pathname+u.search:u.href;};
const localPath=s=>s.split(/[?#]/)[0];
function resolve(spec,ref,map){let key=/^(\.|\/|https?:)/.test(spec)?canon(spec,ref):spec;
 for(const section of [...Object.keys(map.scopes??{}).filter(s=>ref.startsWith(s)).sort((a,b)=>b.length-a.length).map(s=>map.scopes[s]),map.imports??{}]){
  if(Object.hasOwn(section,key))return section[key];
  for(const k of Object.keys(section).filter(k=>k.endsWith('/')&&key.startsWith(k)).sort((a,b)=>b.length-a.length))return section[k]+key.slice(k.length);
 }
 return key;
}
function specs(text,url){const ast=tree(text,url).ast;assert.equal(ast.parseDiagnostics.length,0,'parse:'+url);const edges=[],unknown=[];
 for(const n of nodes(ast,n=>(ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier||ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword)){
  const s=n.moduleSpecifier??n.arguments[0];if(!s||!ts.isStringLiteralLike(s)){unknown.push({ref:url,expression:n.getText(ast)});continue;}
  edges.push({spec:s.text,kind:ts.isImportDeclaration(n)?'literal-import':ts.isExportDeclaration(n)?'literal-export':'literal-dynamic-import'});
 }
 return {ast,edges,unknown};
}
const records=new Map(baseline.map(x=>[x.url,{file:x.file,sha256:x.sha256,baseline:true}]));
const supplementalPath=OUT+'/supplemental-baseline/supplemental-files.json',supplemental=json(supplementalPath);
assert.equal(supplemental.readOnly,true,'supplemental read-only capture');
assert.equal(supplemental.target,'admin','supplemental target');
for(const f of supplemental.records){
 assert.equal(f.sourceKind,'file','supplemental original remote file');
 assert.ok(f.sourcePath.startsWith('/opt/releases/')&&f.sourcePath.includes('/admin/dist/public/'),'proven remote release path');
 assert.equal(path.resolve(f.file),path.resolve(OUT+'/supplemental-baseline'+f.url),'supplemental URL/file match');
 assert.ok(!records.has(f.url),'supplemental does not replace 135 captured files');
 const raw=fs.readFileSync(f.file);assert.equal(raw.length,f.bytes);assert.equal(sha(raw),f.sha256,'supplemental original hash:'+f.url);
 if(f.url.endsWith('.png'))assert.equal(raw.subarray(0,8).toString('hex'),'89504e470d0a1a0a','PNG signature');
 if(f.url.endsWith('.ico'))assert.equal(raw.subarray(0,4).toString('hex'),'00000100','ICO signature');
 if(f.url.endsWith('.css'))assert.ok(!/^\s*(?:<!doctype|<html)/i.test(raw.toString()),'CSS not HTML fallback');
 records.set(f.url,{...f,supplemental:true});
}
for(const f of manifest){assert.equal(sha(fs.readFileSync(f.file)),f.sha256,'candidate hash:'+f.file);records.set('/'+f.targetRelative,f);}
const checks=[],edges=[],unknown=[],missing=[],external=[],visited=new Set(),queue=[];
function edge(ref,spec,kind,module=false){const target=module?resolve(spec,ref,htmlProof.map):canon(spec,ref);edges.push({ref,spec,kind,target});if(/^(data:|blob:|#)/.test(target))return;if(/^https?:/.test(target)){external.push({ref,spec,kind,target});return;}if(target.startsWith('/'))queue.push(target);else unknown.push({ref,spec,kind,target});}
try{
 assert.equal(baseline.length,135,'captured baseline manifest count');
 for(const f of baseline)assert.equal(sha(fs.readFileSync(f.file)),f.sha256,'baseline remains unchanged:'+f.url);
 checks.push({name:'135 captured baseline files unchanged raw bytes',status:'PASS'});
 checks.push({name:'separate original remote supplemental capture provenance/hash/signature',status:'PASS',records:supplemental.records.length,manifestSha256:sha(read(supplementalPath))});
 for(const p of build.proofs){const oldUrl=Object.keys(build.relocations).find(k=>fs.existsSync(LIVE+k)&&sha(read(LIVE+k))===p.beforeSha256);assert.ok(oldUrl,'proof baseline:'+p.id);const old=read(LIVE+oldUrl),after=read(OUT+'/candidate'+build.relocations[oldUrl]);let inverse=after;
  if(p.overlayLayer){const overlay=p.overlayLayer;assert.equal(sha(inverse),overlay.afterSha256,'overlay final hash');assert.equal(overlay.beforeSha256,p.afterSha256,'overlay chains exact stage-A preimage');for(const e of [...overlay.edits].reverse()){assert.equal(inverse.slice(e.outStart,e.outEnd),e.text);assert.equal(sha(e.before),e.beforeSha256);inverse=inverse.slice(0,e.outStart)+e.before+inverse.slice(e.outEnd);}assert.equal(sha(inverse),overlay.beforeSha256,'overlay inverse raw bytes');checks.push({name:p.id+': material overlay fullbytes inverse and exact stage-A chain',status:'PASS'});}
  assert.equal(sha(inverse),p.afterSha256);for(const e of [...p.edits].reverse()){assert.equal(inverse.slice(e.outStart,e.outEnd),e.text);assert.equal(sha(e.before),e.beforeSha256);inverse=inverse.slice(0,e.outStart)+e.before+inverse.slice(e.outEnd);}assert.equal(inverse,old,'FULLBYTES_INVERSE:'+p.id);
  const oldAst=specs(old,oldUrl).ast,newAst=specs(after,build.relocations[oldUrl]).ast;
  const oldImports=oldAst.statements.filter(ts.isImportDeclaration).map(n=>n.getText(oldAst));const newImports=newAst.statements.filter(ts.isImportDeclaration).map(n=>n.getText(newAst));for(const imp of oldImports)assert.ok(newImports.includes(imp),'original literal import bytes preserved');
  const oldExports=oldAst.statements.filter(ts.isExportDeclaration).map(n=>n.getText(oldAst));const newExports=newAst.statements.filter(ts.isExportDeclaration).map(n=>n.getText(newAst));for(const exp of oldExports)assert.ok(newExports.includes(exp),'original export bytes preserved');
  if(p.id.startsWith('workbench')){const po=oldAst.statements.find(n=>n.name?.text==='Po'),legacy=newAst.statements.find(n=>n.name?.text==='__d51_ir_legacy_chat');assert.equal(legacy.getText(newAst).replace(/^function __d51_ir_legacy_chat\(/,'function Po('),po.getText(oldAst),'personal Po full bytes retained');for(const name of ['Av','Tv','Qa','Zs','_y'])assert.equal(newAst.statements.find(n=>n.name?.text===name).getText(newAst),oldAst.statements.find(n=>n.name?.text===name).getText(oldAst),'core bridge actual original '+name);}
  checks.push({name:p.id+': forward/inverse fullbytes + original imports/exports + core bridge originals',status:'PASS'});
 }
 const html=read(OUT+'/candidate/index.html'),oldHtml=read(LIVE+'/index.html');assert.equal(sha(html),htmlProof.afterSha256);assert.equal(sha(oldHtml),htmlProof.beforeSha256);
 const importmaps=[...html.matchAll(/<script\b[^>]*type=["']importmap["'][^>]*>(.*?)<\/script>/gs)];assert.equal(importmaps.length,1);assert.deepEqual(JSON.parse(importmaps[0][1]),htmlProof.map);
 const oldMapRaw=[...oldHtml.matchAll(/<script\b[^>]*type=["']importmap["'][^>]*>(.*?)<\/script>/gs)][0][1];
 const cssTag=html.match(/<link rel="stylesheet" href="([^"]+)" data-inquiry-reception="20261113">\n/)[0];assert.equal(html.replace(importmaps[0][1],oldMapRaw).replace(cssTag,''),oldHtml,'HTML raw byte restoration');
 assert.deepEqual(Object.keys(htmlProof.map.scopes).slice(0,Object.keys(htmlProof.oldMap.scopes).length),Object.keys(htmlProof.oldMap.scopes),'original scopes order');
 for(const [section,values]of [['imports',htmlProof.oldMap.imports],...Object.entries(htmlProof.oldMap.scopes)]){const updated=section==='imports'?htmlProof.map.imports:htmlProof.map.scopes[section];assert.deepEqual(Object.keys(updated).slice(0,Object.keys(values).length),Object.keys(values),'key order:'+section);for(const[k,v]of Object.entries(values))assert.equal(updated[k],build.relocations[v]??v,'mapping directed values only:'+k);}
 // All baseline module imports, dynamic imports and exports are checked, not merely candidate ones.
 let relocationResolutionCount=0;
 for(const f of baseline.filter(x=>x.url.endsWith('.js'))){const oldRef=f.url,newRef=build.relocations[oldRef]??oldRef;for(const e of specs(read(f.file),oldRef).edges){const before=resolve(e.spec,oldRef,htmlProof.oldMap),after=resolve(e.spec,newRef,htmlProof.map);assert.equal(after,build.relocations[before]??before,'all-baseline resolution '+oldRef+' '+e.spec);relocationResolutionCount++;}}
 checks.push({name:'HTML raw fullbytes + old key/scopes/order + all module relocation resolutions',status:'PASS',resolutionCount:relocationResolutionCount});
 // Start from HTML resource tags, every importmap target, every preserved baseline file and current candidate.
 // This strict whole-manifest superset also certifies otherwise lazy/inactive original feature assets.
 for(const m of html.matchAll(/<(script|link|img)\b[^>]*\b(src|href)=["']([^"']+)["'][^>]*>/g)){
  if(m[3].startsWith('#'))continue;edge('/index.html',m[3],m[1]==='script'?'html-script':m[1]==='link'?'html-link':'html-image',m[1]==='script');
 }
 for(const section of [htmlProof.map.imports,...Object.values(htmlProof.map.scopes)])for(const[k,v]of Object.entries(section)){if(v.startsWith('/'))edge('/index.html',v,'importmap-target');else if(!v.endsWith('/'))unknown.push({kind:'nonlocal-importmap-target',key:k,target:v});}
 for(const url of records.keys())queue.push(url);
 while(queue.length){const url=queue.shift(),u=localPath(url);if(visited.has(u))continue;visited.add(u);const record=records.get(u);if(!record){missing.push({url:u,refs:edges.filter(x=>localPath(x.target)===u).slice(0,12)});continue;}
  if(u.endsWith('.js')){const text=read(record.file),{ast,edges:moduleEdges,unknown:modUnknown}=specs(text,u);unknown.push(...modUnknown);for(const e of moduleEdges)edge(u,e.spec,e.kind,true);
   // Vite mapDeps are fetched through root URL concatenation, not importmap resolution.
   for(const n of nodes(ast,ts.isStringLiteralLike))if(/^assets\/[^\s]+\.(?:js|css|webp|png|jpe?g|svg|woff2?|ttf|ico)(?:[?#].*)?$/.test(n.text))edge(u,'/'+n.text,n.parent&&ts.isArrayLiteralExpression(n.parent)?'vite-mapDeps/preload-array':'js-static-asset-string');
   for(const n of nodes(ast,ts.isStringLiteralLike))if(/^\/assets\/[^\s]+\.(?:js|css|webp|png|jpe?g|svg|woff2?|ttf|ico)(?:[?#].*)?$/.test(n.text)&&!moduleEdges.some(e=>e.spec===n.text))edge(u,n.text,'js-absolute-asset-string');
   for(const n of nodes(ast,n=>ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text==='__vite__mapDeps')){const argument=n.arguments[0];if(!argument||!ts.isArrayLiteralExpression(argument)||argument.elements.some(x=>!ts.isNumericLiteral(x)))unknown.push({ref:u,kind:'unproven-mapDeps-indices',expression:n.getText(ast)});}
  }else if(u.endsWith('.css')){const text=read(record.file).replace(/\/\*[\s\S]*?\*\//g,'');for(const m of text.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/g)){if(/^(data:|#)/.test(m[2]))continue;edge(u,m[2],'css-url-asset');}for(const m of text.matchAll(/@import\s+["']([^"']+)["']/g))edge(u,m[1],'css-import');}
 }
 const closure={status:missing.length||unknown.length?'BLOCKED':'PASS',offlineOnly:true,proofScope:'All 135 preserved baseline files + separate hash/provenance-verified original remote supplemental capture + six current candidates; AST literal import/export/dynamic import, all importmap targets, Vite mapDeps/preload arrays, HTML resource tags, JS /assets literals and CSS url()/@import. No production/network/browser execution.',baselineFileCount:baseline.length,supplementalFileCount:supplemental.records.length,supplementalManifestSha256:sha(read(supplementalPath)),candidateFileCount:manifest.length,visitedCount:visited.size,edgeCount:edges.length,edgeKinds:Object.fromEntries([...new Set(edges.map(x=>x.kind))].map(k=>[k,edges.filter(x=>x.kind===k).length])),checks,missing,unknown,external,edges,candidateRelocations:build.relocations,manifest};
 write('candidate-static-closure.json',closure);assert.equal(closure.status,'PASS','STATIC_CLOSURE:'+JSON.stringify({missing,unknown}));
 checks.push({name:'complete static assets dependency closure',status:'PASS'});
 write('static-verification.json',{status:'PASS',offlineOnly:true,checks,candidateRelocations:build.relocations,manifest});
 console.log(JSON.stringify({status:'PASS',files:manifest.length,baseline:baseline.length,visited:visited.size,edges:edges.length,kinds:closure.edgeKinds}));
}catch(e){write('static-verification.json',{status:'FAIL',offlineOnly:true,checks,error:e.stack,missing,unknown});console.error(e.stack);process.exitCode=1;}
