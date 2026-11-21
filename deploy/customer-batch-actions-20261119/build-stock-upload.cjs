#!/usr/bin/env node
'use strict';
// Offline: one native context leaf, helper nested lexically; no entrypoint execution.
const C=require('../customer-inventory-backend-20261114/core.cjs');
const {fs,path,ts,sha,assert,read,walk,parse,uniqueNode,applyPatches,moduleName,refs}=C;
const {mapper}=require('./backend-builder.cjs');
const esbuild=require('esbuild');
const cp=require('node:child_process');
const ROOT=path.resolve(__dirname,'../..');
const REL='client/src/business/platform/front-router-types/server/services/customerSupply.ts';
const BASE=process.env.CUSTOMER_STOCK_BASE,OUT=process.env.CUSTOMER_STOCK_API_OUT;
assert(BASE&&OUT&&!fs.existsSync(OUT),'EXPLICIT_BASE_FRESH_OUTPUT');
function put(n,b){const p=path.join(OUT,n);fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,b);}
function json(n,d){put(n,JSON.stringify(d,null,2)+'\n');}
(async()=>{
 const bytes=fs.readFileSync(path.join(ROOT,REL)),sourceSha256=sha(bytes);
 const result=await esbuild.transform(bytes.toString(),{loader:'ts',format:'esm',target:'es2020',minify:false,legalComments:'none',sourcefile:REL});
 const p=parse(path.join(OUT,'inputs/source',REL+'.js'),result.code,moduleName(REL));
 const context=uniqueNode(p.byName('createCustomerSupplyService').node,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='context','source.context');
 const helper=p.byName('ownBoundUploadChannel').node;
 const at=context.body.getStart(p.sf)+1;
 const combined=result.code.slice(0,at)+'\n'+helper.getText(p.sf)+'\n'+result.code.slice(at);
 const ref=parse(path.join(OUT,'inputs/source',REL+'.js'),combined,moduleName(REL));
 ref.sourceFile=path.join(OUT,'inputs/source',REL);ref.module=moduleName(REL);
 const node=uniqueNode(ref.byName('createCustomerSupplyService').node,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='context','combined.context');
 const compiled={p:ref,relative:REL,sourceSha256,compiledSha256:sha(result.code)};
 const lock={inputRoot:path.join(OUT,'inputs')};
 const before=fs.readFileSync(path.join(BASE,'front-api.js'));assert(Buffer.from(before.toString()).equals(before));
 const old=parse(path.join(BASE,'front-api.js'),before.toString());
 const native=uniqueNode(old.byName('createCustomerSupplyService').node,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='context','native.context');
 compiled.compiledSha256=sha(combined);
 const mapped=mapper(old,compiled,lock,['createCustomerSupplyService','writeFence']).extract(node);
 const applied=applyPatches(old.text,[{name:'supply.context.ownBoundUploadPreparation',start:native.getStart(old.sf),end:native.end,text:mapped.text,source:mapped.source}]);
 const after=parse(path.join(OUT,'front-candidate.mjs'),applied.text);const protections=[];
 for(const d of old.decls){const a=d.node.getStart(old.sf),b=d.node.end;if(a<=native.getStart(old.sf)&&b>=native.end)continue;
  const fresh=after.decls.filter(n=>n.name===d.name);assert(fresh.length===1&&fresh[0].node.getText(after.sf)===d.node.getText(old.sf),'NON_TARGET_GLOBAL '+d.name);protections.push({name:d.name,module:d.module,sha256:sha(d.node.getText(old.sf))});}
 assert(old.sf.statements.filter(ts.isImportDeclaration).map(n=>n.getText(old.sf)).join('\n')===after.sf.statements.filter(ts.isImportDeclaration).map(n=>n.getText(after.sf)).join('\n'),'IMPORT_BYTES');
 const freshContext=uniqueNode(after.byName('createCustomerSupplyService').node,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='context','candidate.context');
 const known=new Set(refs(after,after.byName('createCustomerSupplyService').node).map(d=>d.name));
 const bindings=mapped.source.bindings;
 for(const b of bindings)assert(known.has(b.runtimeName),'MAPPED_NATIVE_SYMBOL '+b.runtimeName);
 const nested=uniqueNode(freshContext,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ownBoundUploadChannel','candidate.local.helper');
 assert(nested.getText(after.sf).includes('inventoryScopeWrite')&&nested.getText(after.sf).includes('upload_link.customerId'),'HELPER_WRITE_FENCE');
 const patches=applied.manifest.map(p=>({...p,oldText:old.text.slice(p.start,p.end),newText:applied.text.slice(p.newStart,p.newEnd)}));
 put('compiled-source/original.js',result.code);put('compiled-source/lexical-context.js',combined);
 put('before-front-api.js',before);put('after-front-api.js',applied.text);put('front-candidate.mjs',applied.text);put('inputs/source/'+REL,bytes);
 cp.execFileSync(process.execPath,['--check',path.join(OUT,'front-candidate.mjs')],{stdio:'pipe'});
 json('front-patch-records.json',{format:'customer-batch-native-patches-v1',baseline:{sha256:sha(before),bytes:before.length,capturedPath:path.join(BASE,'front-api.js'),productionPath:'/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js'},candidate:{sha256:sha(applied.text),bytes:Buffer.byteLength(applied.text)},patches,inverse:applied.inverse,importsAllByteIdentical:true,nonTargetDeclarationsAllByteIdentical:true,nonTargetDeclarationCount:protections.length,nonTargetDeclarationDigest:sha(JSON.stringify(protections)),strictNewIdentifiersResolved:true,entrypointExecuted:false,actualDatabaseAccess:false});
 json('build-evidence.json',{status:'OFFLINE_ONE_CONTEXT_PATCH_NOT_DEPLOYED',sourceSha256,builderSha256:sha(read(__filename)),originalCompilerAndMapperReused:true,nativeContextOnly:true,nestedHelperExactCheckedInDeclaration:true,adminApiUntouched:true,inverse:applied.inverse,nodeCheck:true,noRuntimeLoads:true,bindings});
 assert(sha(fs.readFileSync(path.join(ROOT,REL)))===sourceSha256,'SOURCE_RACE');
 console.log(JSON.stringify({status:'OFFLINE_NATIVE_UPLOAD_FIX_BUILT_NOT_DEPLOYED',frontBeforeSha256:sha(before),frontAfterSha256:sha(applied.text),patchNames:patches.map(p=>p.name),unchangedBytes:applied.inverse.unchangedBytes,adminApiUntouched:true},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
