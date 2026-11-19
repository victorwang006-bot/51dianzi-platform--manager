#!/usr/bin/env node
/** Local-only leaf patcher. Reads capture and current source; writes ONLY below HERE. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import * as esbuild from 'esbuild';

export const HERE=path.dirname(fileURLToPath(import.meta.url));
export const REPO=path.resolve(HERE,'../..');
export const BASE=path.resolve(process.env.BASE??'/home/ubuntu/work/upload-history/capture/assets');
export const OUT=path.resolve(process.env.OUT??path.join(HERE,'build'));
const COMPONENTS=path.join(REPO,'client/src/business/platform/client/src/components/customers');
const BASELINE_HASHES={'BusinessWorkbenchPage-customer-bound-d66aeccb471e1441.js':'d66aeccb471e1441e930cf6cad280b5336b18a12408c6a7b040b3de8270f3f55','BusinessWorkbenchPage-customer-bound-dc9725b434fc715f.js':'dc9725b434fc715f12cc451798aa239d09cca9ecb9668e19e8de2af327ada3f7'};
export const H=b=>crypto.createHash('sha256').update(b).digest('hex');
export const parse=(s,file='live.js')=>{const a=ts.createSourceFile(file,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(a.parseDiagnostics.length,0,`syntax: ${file}`);return a;};
export const nodes=(a,p)=>{const out=[];function w(n){if(p(n))out.push(n);ts.forEachChild(n,w);}w(a);return out;};
export const one=(arr,label)=>{assert.equal(arr.length,1,`${label}: unique AST node`);return arr[0];};
export const bindings={React:'Ct',useEffect:'Oe',useRef:'fe',useState:'X',jsx:'m',jsxs:'_',Fragment:'Nt',trpc:'St',customerUploadDownloadSchema:'Qw',customerUploadHistoryListSchema:'Jw',Dialog:'Ka',DialogContent:'Xa',DialogHeader:'Ya',DialogTitle:'Ja',batchUploadDialogStyle:'ac',savePrivateFile:'Wg',downloadedFile:'Zg'};
function confined(target){
 const rel=path.relative(HERE,target);assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel),'all generated files must stay in new deploy directory');
 for(let p=target;;p=path.dirname(p)){assert(!fs.existsSync(p)||!fs.lstatSync(p).isSymbolicLink(),`output symlink refused: ${p}`);if(p===path.dirname(p))break;}
 return target;
}
function json(name,obj){fs.writeFileSync(confined(path.join(OUT,name)),JSON.stringify(obj,null,2)+'\n');}
function validUtf8(bytes){const s=bytes.toString('utf8');assert(bytes.equals(Buffer.from(s)),'strict UTF8 byte roundtrip');return s;}
function noModuleLoads(code,label){const a=parse(code,label);assert(!nodes(a,n=>ts.isImportDeclaration(n)||ts.isExportDeclaration(n)||ts.isImportEqualsDeclaration(n)||(ts.isCallExpression(n)&&(n.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(n.expression)&&n.expression.text==='require'))).length,`no unresolved import/require: ${label}`);}
function freeIdentifiers(wrapper){
 // TypeScript's symbol resolver catches free lexical names without bundling ANY host module.
 const name=path.join(HERE,'__virtual_history_abi.js');
 const text=Object.values(bindings).map(n=>`var ${n};`).join('\n')+'\n'+wrapper;
 const host=ts.createCompilerHost({allowJs:true,target:ts.ScriptTarget.ES2022});
 const read=host.readFile.bind(host),exists=host.fileExists.bind(host),get=host.getSourceFile.bind(host);
 host.readFile=f=>f===name?text:read(f);host.fileExists=f=>f===name||exists(f);
 host.getSourceFile=(f,l,onError,newFile)=>f===name?ts.createSourceFile(f,text,l,true,ts.ScriptKind.JS):get(f,l,onError,newFile);
 const program=ts.createProgram([name],{allowJs:true,target:ts.ScriptTarget.ES2022,noEmit:true},host),a=program.getSourceFile(name),checker=program.getTypeChecker();
 const missing=nodes(a,n=>ts.isIdentifier(n)&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n)&&!((ts.isPropertyAssignment(n.parent)||ts.isMethodDeclaration(n.parent))&&n.parent.name===n)&&!checker.getSymbolAtLocation(n));
 assert.deepEqual([...new Set(missing.map(n=>n.text))],[],'no unbound identifiers in replacement wrapper');
}
export async function emittedLeaf(){
 const sourcePath=path.resolve(process.env.HISTORY_SOURCE??path.join(COMPONENTS,'CustomerUploadHistoryDialog.tsx'));
 const source=fs.readFileSync(sourcePath,'utf8');
 const src=ts.createSourceFile(sourcePath,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);assert.equal(src.parseDiagnostics.length,0);
 const allowed=new Set([...Object.keys(bindings),'zipSync']);
 const runtimeImports=[];
 for(const imp of src.statements.filter(ts.isImportDeclaration)){
  const clause=imp.importClause;
  if(!clause){assert.equal(imp.moduleSpecifier.text,'./CustomerUploadHistory.css','only known CSS side effect import');continue;}
  if(clause.isTypeOnly)continue;
  if(clause.name)runtimeImports.push({name:clause.name.text,module:imp.moduleSpecifier.text});
  if(clause.namedBindings){assert(ts.isNamedImports(clause.namedBindings),'namespace import not allowed');for(const s of clause.namedBindings.elements)if(!s.isTypeOnly)runtimeImports.push({name:s.name.text,imported:s.propertyName?.text??s.name.text,module:imp.moduleSpecifier.text});}
 }
 assert(runtimeImports.every(s=>allowed.has(s.name)),'HistorySession imports outside authorised ABI refused');
 assert.deepEqual(runtimeImports.filter(s=>s.module==='fflate'),[{name:'zipSync',imported:'zipSync',module:'fflate'}],'only zipSync imported from fflate');
 const transformed=await esbuild.transform(source,{loader:'tsx',jsx:'automatic',format:'esm',target:'es2020',minify:false});
 const a=parse(transformed.code);const leaf=one(nodes(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='HistorySession'),'HistorySession').getText(a);
 noModuleLoads(leaf,'HistorySession');
 // zipSync ONLY is bundled separately; host React/trpc/schemas/helpers are lexical aliases.
 const zip=await esbuild.build({stdin:{contents:'export { zipSync } from "fflate";',resolveDir:REPO,sourcefile:'history-zip-only-entry.js',loader:'js'},write:false,bundle:true,format:'iife',globalName:'__uploadHistoryZip',platform:'browser',target:'es2020',minify:true,treeShaking:true,metafile:true,legalComments:'none'});
 assert.equal(zip.outputFiles.length,1);const zipCode=zip.outputFiles[0].text;
 const zipInputs=Object.keys(zip.metafile.inputs);assert(zipInputs.every(n=>path.basename(n)==='history-zip-only-entry.js'||/node_modules\/.*fflate\//.test(n)),'zip bundle may include only fflate');
 noModuleLoads(zipCode,'zip-only IIFE');
 const wrapper=`function z3(props){\n${zipCode}\nconst ${Object.entries(bindings).map(([k,v])=>`${k}=${v}`).join(',')},zipSync=__uploadHistoryZip.zipSync;\n${leaf}\nreturn HistorySession(props);\n}`;
 noModuleLoads(wrapper,'native z3 wrapper');freeIdentifiers(wrapper);
 return {sourcePath,sourceSha256:H(source),compiledSha256:H(leaf),runtimeImports,zipInputs,zipSha256:H(zipCode),zipCode,leaf,wrapper};
}
// Reused exact inverse-delta records from compact task; strengthened overlap validation.
export function inverseDelta(before,hunks){
 let after=before,shift=0;const records=[];let end=-1;
 for(const h of [...hunks].sort((a,b)=>a.start-b.start)){
  assert(h.start>=end&&h.end>=h.start,'nonoverlapping exact edits');end=h.end;
  assert.equal(before.slice(h.start,h.end),h.old,'exact original leaf');
  const newStart=h.start+shift;shift+=h.replacement.length-(h.end-h.start);
  records.push({name:h.name,oldStart:h.start,oldEnd:h.end,newStart,newEnd:newStart+h.replacement.length,oldSha256:H(h.old),newSha256:H(h.replacement),oldBase64:Buffer.from(h.old).toString('base64'),newBase64:Buffer.from(h.replacement).toString('base64')});
 }
 for(const h of [...hunks].sort((a,b)=>b.start-a.start))after=after.slice(0,h.start)+h.replacement+after.slice(h.end);
 let reversed=after;
 for(const r of [...records].reverse()){
  assert.equal(reversed.slice(r.newStart,r.newEnd),Buffer.from(r.newBase64,'base64').toString(),'inverse leaf preimage');
  reversed=reversed.slice(0,r.newStart)+Buffer.from(r.oldBase64,'base64').toString()+reversed.slice(r.newEnd);
 }
 assert.equal(reversed,before,'all outside approved ranges UTF8 bytes preserved');
 assert(Buffer.from(reversed).equals(Buffer.from(before)),'entire byte inverse');parse(after);
 return {after,records};
}
function scopeDeclarations(scope){
 const immediate=[];function scan(x){if(ts.isFunctionDeclaration(x)||ts.isVariableDeclaration(x)){immediate.push(x);return;}ts.forEachChild(x,scan);}
 for(const st of scope.statements)scan(st);return immediate;
}
function literalHunk(a,n,name){
 const old=n.getText(a);
 const replacement=old.includes('解析历史')?old.replaceAll('解析历史','上传历史'):old.replace(/\\u89e3\\u6790\\u5386\\u53f2/ig,m=>m.replace(/\\u89e3/i,'\\u4E0A').replace(/\\u6790/i,'\\u4F20'));
 assert.notEqual(old,replacement,'literal encoded form not recognised; fail closed');
 assert.equal(one(nodes(parse(replacement),ts.isStringLiteral),'replacement literal').text,n.text.replaceAll('解析历史','上传历史'),'only decoded target text changes');
 return {name,start:n.getStart(a),end:n.end,old,replacement};
}
export function patchModule(before,file,compiled){
 const a=parse(before,file);
 const history=one(nodes(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='z3'&&['customerUploadHistoryList.query','customerUploadHistoryGet.query'].every(k=>n.getText(a).includes(k))),file+': native z3');
 const scope=history.parent;assert(ts.isBlock(scope),'actual lexical customer factory block');
 const decls=scopeDeclarations(scope),functions=decls.filter(ts.isFunctionDeclaration);
 const abi={};for(const native of new Set(Object.values(bindings))){const n=one(decls.filter(x=>ts.isIdentifier(x.name)&&x.name.text===native),`native ABI ${native}`);abi[native]={sha256:H(n.getText(a)),head:n.getText(a).slice(0,160)};}
 assert.equal(abi.Ct.head,'Ct=__customerLive.React','original host React, no second provider');
 const supply=one(functions.filter(n=>['customer-workbench-panel','customerSupplySummary','customerSupplyContext'].every(k=>n.getText(a).includes(k))&&nodes(n,x=>ts.isStringLiteral(x)&&x.text==='客户渠道库存').length===1),'semantic CustomerWorkbenchSupply');
 const button=one(nodes(supply,n=>ts.isCallExpression(n)&&n.arguments.length>=2&&ts.isStringLiteral(n.arguments[0])&&n.arguments[0].text==='button'&&ts.isObjectLiteralExpression(n.arguments[1])&&n.arguments[1].properties.some(p=>ts.isPropertyAssignment(p)&&p.name.getText(a)==='children'&&ts.isStringLiteral(p.initializer)&&p.initializer.text==='解析历史')&&n.arguments[1].properties.some(p=>ts.isPropertyAssignment(p)&&p.name.getText(a)==='onClick')),'Supply history button');
 const buttonText=one(button.arguments[1].properties.filter(p=>ts.isPropertyAssignment(p)&&p.name.getText(a)==='children'),'button children').initializer;
 const parseUpload=one(functions.filter(n=>['customer-parse-upload','persistOriginal','onDirtyChange','onBusyChange'].every(k=>n.getText(a).includes(k))),'semantic CustomerParseUpload');
 const tip=one(nodes(parseUpload,n=>ts.isStringLiteral(n)&&n.text.includes('解析历史')&&n.text.includes('原文件与任务仍保存在服务端')&&n.text.includes('查看')),'CustomerParseUpload history hint');
 const hunks=[{name:'z3/HistorySession',start:history.getStart(a),end:history.end,old:history.getText(a),replacement:compiled.wrapper},literalHunk(a,buttonText,'CustomerWorkbenchSupply/button-label'),literalHunk(a,tip,'CustomerParseUpload/hint-label')];
 const t6=one(functions.filter(n=>n.name?.text==='T6'),'protected T6');
 assert(hunks.every(h=>h.end<=t6.getStart(a)||h.start>=t6.end),'T6 must remain completely untouched');
 assert.deepEqual(hunks.filter(h=>h.name!=='z3/HistorySession').map(h=>parse(h.old).statements.length),[1,1]);
 const result=inverseDelta(before,hunks);
 return {...result,abi,semanticTargets:{history:'z3',supply:supply.name.text,parseUpload:parseUpload.name.text},protectedFunctions:{T6Sha256:H(t6.getText(a)),supplyBeforeSha256:H(supply.getText(a)),parseUploadBeforeSha256:H(parseUpload.getText(a))}};
}
export function scopedCss(source){
 // Only simple style rules and responsive @media containers are admitted.
 function walk(text){let output='',cursor=0;while(cursor<text.length){const open=text.indexOf('{',cursor);if(open<0){assert(!text.slice(cursor).trim(),'unexpected CSS tail');break;}const selector=text.slice(cursor,open).trim();let level=1,end=open+1;for(;end<text.length&&level;end++){if(text[end]==='{')level++;if(text[end]==='}')level--;}assert.equal(level,0,'balanced CSS');const body=text.slice(open+1,end-1);
  if(selector.startsWith('@media ')){const nested=walk(body);if(nested.trim())output+=`${selector} {\n${nested}}\n`;}
  else {assert(!selector.startsWith('@')&&!body.includes('{'),'only scoped style and @media rules');const selectors=selector.split(',').map(s=>s.trim());
   if(selectors.every(s=>/^\.customer-parse-upload(?=[\s.:#\[>+~]|$)/.test(s))){/* intentionally excluded */}
   else {assert(selectors.every(s=>/^\.customer-upload-history(?=[\s.:#\[>+~]|$)/.test(s)),'every selector must begin with .customer-upload-history');assert(!selector.includes('customer-parse-upload')&&!body.includes('customer-parse-upload'),'parse CSS excluded');output+=`${selector} {${body}}\n`;}
  }cursor=end;
 }return output;}
 const css='/* Upload history 20261119: history-only override, no parse-upload rules. */\n'+walk(source);
 assert(css.includes('.customer-upload-history'));assert(!css.includes('.customer-parse-upload'));return css;
}
export function htmlDelta(before,modules,cssRelative){
 let after=before;const counts={};
 for(const m of modules){const old='/'+m.before,newUrl='/'+m.after;const ob=Buffer.from(old),nb=Buffer.from(newUrl);assert(!before.includes(nb),'new URL absent');const occurrences=[...before.toString('utf8').matchAll(new RegExp(old.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'))];assert(occurrences.length>0,'old URL referenced');
  // Byte positions, not substring filenames; preserve the exact enclosing quote.
  let start=0,count=0;for(;;){const pos=before.indexOf(ob,start);if(pos<0)break;const q=before.subarray(pos-1,pos);assert(pos>0&&(q.equals(Buffer.from('"'))||q.equals(Buffer.from("'")))&&before.subarray(pos+ob.length,pos+ob.length+1).equals(q),'URL must be entire quoted reference');start=pos+ob.length;count++;}
  counts[old]=count;after=Buffer.from(after.toString('utf8').replaceAll(old,newUrl));
 }
 assert.equal(after.toString('utf8').split('</head>').length,2,'one head close');assert(!before.includes(Buffer.from('/'+cssRelative)));
 const link=`<link rel="stylesheet" href="/${cssRelative}">\n`;after=Buffer.from(after.toString('utf8').replace('</head>',link+'</head>'));
 return {after,counts,link};
}
export async function build(){
 confined(OUT);assert(!fs.existsSync(OUT),'fresh OUT required; do not overwrite frozen package');
 const htmlPath=path.join(path.dirname(BASE),'admin-index.html'),beforeHtmlBytes=fs.readFileSync(htmlPath),beforeHtml=validUtf8(beforeHtmlBytes);
 const files=Object.keys(BASELINE_HASHES).sort();
 for(const file of files)assert(beforeHtml.includes('"/assets/'+file+'"')||beforeHtml.includes("'/assets/"+file+"'"),'each explicitly selected current module has full quoted HTML reference');
 const compiled=await emittedLeaf();
 const candidates=files.map(file=>{const bytes=fs.readFileSync(path.join(BASE,file));assert.equal(H(bytes),BASELINE_HASHES[file],'exact approved captured asset SHA256');const before=validUtf8(bytes),patched=patchModule(before,file,compiled);return {file,bytes,...patched};});
 assert.equal(H(candidates[0].records.find(r=>r.name==='z3/HistorySession').oldBase64),H(candidates[1].records.find(r=>r.name==='z3/HistorySession').oldBase64),'same z3 native ABI in both copies');
 const cssSourcePath=path.join(COMPONENTS,'CustomerUploadHistory.css'),cssSource=fs.readFileSync(cssSourcePath,'utf8'),css=Buffer.from(scopedCss(cssSource)),cssRelative=`assets/customer-upload-history-${H(css).slice(0,16)}.css`;
 // All validation above is read-only. No partial directory is created on missing ABI.
 fs.mkdirSync(confined(path.join(OUT,'package/assets')),{recursive:true,mode:0o700});fs.mkdirSync(confined(path.join(OUT,'package/evidence')),{mode:0o700});fs.chmodSync(OUT,0o700);fs.chmodSync(OUT+'/package',0o700);
 const modules=[];
 for(const c of candidates){const bytes=Buffer.from(c.after),sha=H(bytes),relative=`assets/BusinessWorkbenchPage-upload-history-${sha.slice(0,16)}.js`;fs.writeFileSync(confined(path.join(OUT,'package',relative)),bytes);modules.push({before:'assets/'+c.file,after:relative,sha256:sha,size:bytes.length});
  json('package/evidence/'+c.file+'.delta.json',{input:'assets/'+c.file,output:relative,beforeSha256:H(c.bytes),afterSha256:sha,patches:c.records,offsetUnits:'UTF16-code-units; reconstruct UTF8 for SHA256',inverseVerified:true,onlyHistoryLeafAndTwoLiteralRanges:true,semanticTargets:c.semanticTargets,protectedFunctions:c.protectedFunctions});json('package/evidence/'+c.file+'.abi.json',c.abi);
 }
 assert.equal(new Set(modules.map(m=>m.after)).size,2,'two distinct new assets');
 fs.writeFileSync(confined(path.join(OUT,'package',cssRelative)),css);
 const {after,counts,link}=htmlDelta(beforeHtmlBytes,modules,cssRelative);
 fs.writeFileSync(confined(path.join(OUT,'package/before-index.html')),beforeHtmlBytes);fs.writeFileSync(confined(path.join(OUT,'package/after-index.html')),after);
 const assets=modules.map(m=>({relative:m.after,sha256:m.sha256,size:m.size})).concat({relative:cssRelative,sha256:H(css),size:css.length});
 json('modules.json',modules);json('assets.json',assets);json('replacements.json',modules.map(m=>({before:'/'+m.before,after:'/'+m.after})));fs.writeFileSync(confined(path.join(OUT,'css-relative.txt')),cssRelative+'\n');
 json('package/evidence/source-delta.json',{sourcePath:compiled.sourcePath,sourceSha256:compiled.sourceSha256,compiledSha256:compiled.compiledSha256,runtimeImports:compiled.runtimeImports,zipOnly:{sha256:compiled.zipSha256,inputs:compiled.zipInputs,bundle:'separate esbuild IIFE in z3 wrapper'},cssSourcePath,cssSourceSha256:H(cssSource),cssSha256:H(css),noHostModuleCopied:true,noUnresolvedImports:true,noNewProvider:true,noBackendChanges:true});
 json('package/evidence/reference-counts.json',{counts,canonicalCssLink:link,beforeHtmlSha256:H(beforeHtmlBytes),afterHtmlSha256:H(after),onlyFullQuotedResourceUrlsAndIndependentCssLink:true});
 fs.writeFileSync(confined(path.join(OUT,'package/evidence/build-native.mjs')),fs.readFileSync(fileURLToPath(import.meta.url)));fs.writeFileSync(confined(path.join(OUT,'package/evidence/controller-adaptation.json')),fs.readFileSync(path.join(HERE,'controller-adaptation.json')));
 console.log(JSON.stringify({status:'LOCAL_NATIVE_CANDIDATES_NOT_DEPLOYED',output:OUT,modules,assets,beforeHtmlSha256:H(beforeHtmlBytes),afterHtmlSha256:H(after),testsNotRunByBuild:true},null,2));return modules;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await build();
