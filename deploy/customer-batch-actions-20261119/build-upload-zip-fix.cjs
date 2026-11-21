#!/usr/bin/env node
'use strict';
// Offline expression patch: retain the entire native inspector and every other API byte.
const C=require('../customer-inventory-backend-20261114/core.cjs');
const {fs,path,ts,sha,assert,read,parse,uniqueNode,applyPatches,moduleName}=C;
const {mapper}=require('./backend-builder.cjs');
const esbuild=require('esbuild'),cp=require('node:child_process');
const ROOT=path.resolve(__dirname,'../..');
const REL='client/src/business/platform/front-router-types/server/services/customerUploadPrivateStorage.ts';
const BASE=process.env.CUSTOMER_UPLOAD_BASE,OUT=process.env.CUSTOMER_UPLOAD_API_OUT;
assert(BASE&&OUT&&!fs.existsSync(OUT),'EXPLICIT_BASE_FRESH_OUTPUT');
function put(n,b){const p=path.join(OUT,n);fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,b);}
function json(n,d){put(n,JSON.stringify(d,null,2)+'\n');}
(async()=>{
 const bytes=fs.readFileSync(path.join(ROOT,REL)),sourceSha256=sha(bytes);
 const transformed=await esbuild.transform(bytes.toString(),{loader:'ts',format:'esm',target:'es2020',minify:false,legalComments:'none',sourcefile:REL});
 const ref=parse(path.join(OUT,'inputs/source',REL+'.js'),transformed.code,moduleName(REL));ref.sourceFile=path.join(OUT,'inputs/source',REL);ref.module=moduleName(REL);
 const sourceZip=ref.byName('checkedZip').node;
 const expression=p=>ts.isBinaryExpression(p)&&p.operatorToken.kind===ts.SyntaxKind.AmpersandToken&&p.left.getText(p.getSourceFile())==='flags'&&ts.isPrefixUnaryExpression(p.right)&&p.right.operator===ts.SyntaxKind.TildeToken;
 const fresh=uniqueNode(sourceZip,expression,'source ZIP flag expression');
 assert(fresh.getText(ref.sf)==='flags & ~(2056 | (method === 8 ? 6 : 0))','SOURCE_METHOD8_ONLY_FLAGS');
 const before=fs.readFileSync(path.join(BASE,'front-api.js'));assert(Buffer.from(before.toString()).equals(before),'UTF8');const old=parse(path.join(BASE,'front-api.js'),before.toString());
 const nativeZip=uniqueNode(old.sf,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='checkedZip','native checkedZip');
 const native=uniqueNode(nativeZip,expression,'native ZIP flag expression');assert(native.getText(old.sf)==='flags & ~2056','EXACT_NATIVE_BAD_MASK');
 for(const name of ['flags','method']){
  const sourceId=uniqueNode(fresh,n=>ts.isIdentifier(n)&&n.text===name,'source '+name),symbol=ref.symbolAt(sourceId);
  assert(symbol&&symbol.declarations.every(d=>d.getStart(ref.sf)>sourceZip.getStart(ref.sf)&&d.end<sourceZip.end),'SOURCE_LOCAL_FLAGS_METHOD');
 }
 const mapped=mapper(old,{p:ref,relative:REL,sourceSha256,compiledSha256:sha(transformed.code)},{inputRoot:path.join(OUT,'inputs')}).extract(fresh,{flags:'flags',method:'method'});
 assert(mapped.source.bindings.length===0&&mapped.source.identifierOnlyEdits.length===0,'NO_GLOBAL_OR_IDENTIFIER_REBINDING');
 const applied=applyPatches(old.text,[{name:'privateStorage.checkedZip.deflateCompressionFlags',start:native.getStart(old.sf),end:native.end,text:mapped.text,source:mapped.source}]);
 const after=parse(path.join(OUT,'front-candidate.mjs'),applied.text),protections=[];
 for(const d of old.decls){const a=d.node.getStart(old.sf),b=d.node.end;if(a<=native.getStart(old.sf)&&b>=native.end)continue;const fresh=after.decls.filter(n=>n.name===d.name);assert(fresh.length===1&&fresh[0].node.getText(after.sf)===d.node.getText(old.sf),'NON_TARGET '+d.name);protections.push({name:d.name,module:d.module,sha256:sha(d.node.getText(old.sf))});}
 assert(old.sf.statements.filter(ts.isImportDeclaration).map(n=>n.getText(old.sf)).join('\n')===after.sf.statements.filter(ts.isImportDeclaration).map(n=>n.getText(after.sf)).join('\n'),'IMPORTS');
 const patches=applied.manifest.map(p=>({...p,oldText:old.text.slice(p.start,p.end),newText:applied.text.slice(p.newStart,p.newEnd)}));
 put('compiled-source/private-storage.js',transformed.code);put('before-front-api.js',before);put('after-front-api.js',applied.text);put('front-candidate.mjs',applied.text);put('inputs/source/'+REL,bytes);
 cp.execFileSync(process.execPath,['--check',path.join(OUT,'front-candidate.mjs')],{stdio:'pipe'});
 json('front-patch-records.json',{format:'customer-batch-native-patches-v1',baseline:{sha256:sha(before),bytes:before.length,capturedPath:path.join(BASE,'front-api.js'),productionPath:'/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js'},candidate:{sha256:sha(applied.text),bytes:Buffer.byteLength(applied.text)},patches,inverse:applied.inverse,importsAllByteIdentical:true,nonTargetDeclarationsAllByteIdentical:true,nonTargetDeclarationCount:protections.length,nonTargetDeclarationDigest:sha(JSON.stringify(protections)),strictNewIdentifiersResolved:true,entrypointExecuted:false,actualDatabaseAccess:false});
 json('build-evidence.json',{status:'OFFLINE_ZIP_FLAGS_EXPRESSION_ONLY_NOT_DEPLOYED',sourceSha256,builderSha256:sha(read(__filename)),originalCompilerAndMapperReused:true,expressionOnly:true,oldExpression:native.getText(old.sf),newExpression:mapped.text,adminApiUntouched:true,inverse:applied.inverse,nodeCheck:true,globalBindingsChanged:false});
 assert(sha(fs.readFileSync(path.join(ROOT,REL)))===sourceSha256,'SOURCE_RACE');console.log(JSON.stringify({frontBeforeSha256:sha(before),frontAfterSha256:sha(applied.text),changedExpressions:1,unchangedBytes:applied.inverse.unchangedBytes},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
