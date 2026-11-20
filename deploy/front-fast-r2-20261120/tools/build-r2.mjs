import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire,builtinModules} from 'node:module';
import {fileURLToPath} from 'node:url';
const ROOT=path.dirname(fileURLToPath(import.meta.url)),P=ROOT+'/platform',M=ROOT+'/manager';
const O=ROOT+'/remote-evidence/original-stage/package',OLD=ROOT+'/remote-evidence/old-source',B=ROOT+'/r2-build';
const req=createRequire(P+'/package.json'),esbuild=req('esbuild'),ts=req('typescript');
const H=x=>crypto.createHash('sha256').update(x).digest('hex');
const need=(x,m)=>{if(!x)throw Error(m)};
const read=p=>fs.readFileSync(p);
const save=(p,x)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,typeof x==='string'||Buffer.isBuffer(x)||x instanceof Uint8Array?x:JSON.stringify(x,null,2)+'\n')};
const F='/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front',A='/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin';
const oldNames={helper:'officialTechnical.9b8758fe8f8b42c4c33eb6c4931656baa901bf48717b1a9df26a0ed1b0e3bba8.runtime.mjs',front:'officialMall.front.0228652b747000065cdc706661a225fc8f2194a10a0900a7c88dc1174c3d3724.runtime.mjs',admin:'officialMall.admin.inline.73650c633f4a76ea7133bf528c4b8cc28abe4626836a085a0dbc464a9cdd0641.runtime.mjs'};
const sources={},files=[],proofs={};
function seal(){return{name:'sealed-r2-sources',setup(b){b.onLoad({filter:/\.(ts|js|mjs|cjs|json)$/},a=>{const bytes=read(a.path);sources[a.path]=H(bytes);return{contents:bytes.toString(),loader:a.path.endsWith('.json')?'json':a.path.endsWith('.ts')?'ts':'js',resolveDir:path.dirname(a.path)}})}}}
function standalone(meta){for(const o of Object.values(meta.outputs))for(const i of o.imports)need(!i.external||i.path.startsWith('node:')||builtinModules.includes(i.path),'UNBUNDLED_NONNODE_DEPENDENCY '+i.path)}
function parse(data,label){const ast=ts.createSourceFile(label,data.toString(),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);need(!ast.parseDiagnostics.length,'JS_PARSE '+label);return ast}
function patch(before,edits,target){
 const raw=Buffer.from(before);const rows=edits.map(e=>{const x=Buffer.from(e.before),y=Buffer.from(e.after),at=raw.indexOf(x);need(x.length&&at>0&&raw.indexOf(x,at+1)<0,'UNIQUE_PATCH '+e.reason);return{kind:e.kind??'runtime-pointer',offset:at,beforeBase64:x.toString('base64'),afterBase64:y.toString('base64')}}).sort((a,b)=>a.offset-b.offset);
 let last=0,growth=0;const out=[],inverse=[];
 for(const r of rows){const old=Buffer.from(r.beforeBase64,'base64'),next=Buffer.from(r.afterBase64,'base64');need(r.offset>=last,'PATCH_NO_OVERLAP');out.push(raw.subarray(last,r.offset),next);inverse.push({at:r.offset+growth,old,next});growth+=next.length-old.length;last=r.offset+old.length}out.push(raw.subarray(last));const after=Buffer.concat(out);let restored=after;
 for(const r of inverse.reverse()){need(restored.subarray(r.at,r.at+r.next.length).equals(r.next),'INVERSE_SPAN');restored=Buffer.concat([restored.subarray(0,r.at),r.old,restored.subarray(r.at+r.next.length)])}need(restored.equals(raw),'FULL_BYTES_INVERSE');
 return{bytes:after,proof:{schema:'inline-byte-delta-v1',path:target,beforeSha256:H(raw),afterSha256:H(after),patches:rows}};
}
function add(role,bytes,root,prefix,suffix){const name=prefix+H(bytes)+suffix,local=B+'/runtimes/'+name;save(local,bytes);files.push({role,path:root+'/runtime/'+name,packageFile:'runtimes/'+name,sha256:H(bytes),size:bytes.length,mode:0o644,uid:0,gid:0});return{name,bytes,local}}
fs.mkdirSync(B,{recursive:true});
const base={bundle:true,write:false,format:'esm',platform:'node',target:'node22',treeShaking:true,metafile:true,plugins:[seal()]};
const w=await esbuild.build({...base,entryPoints:[P+'/newserver/services/officialTechnicalReaderWorker.ts']});standalone(w.metafile);
const worker=add('runtime-worker',w.outputFiles[0].contents,F,'officialTechnicalReader.','.worker.mjs');
files.push({...files.at(-1),path:A+'/runtime/'+worker.name});save(B+'/worker-metafile.json',w.metafile);
const frontEntry=`export {createOfficialTechnicalPreparedStore,DEFAULT_OFFICIAL_TECHNICAL_STORE_PATH} from ${JSON.stringify(P+'/newserver/services/officialTechnicalPreparedStore.ts')};\nexport {closeOfficialTechnicalReaderWorkers} from ${JSON.stringify(P+'/newserver/services/officialTechnicalReader.ts')};`;
const fh=await esbuild.build({...base,stdin:{contents:frontEntry,resolveDir:P,loader:'ts',sourcefile:'hot-reader-entry.ts'},define:{__OFFICIAL_TECHNICAL_READER_WORKER_FILE__:JSON.stringify('./'+worker.name)}});standalone(fh.metafile);
const frontHelper=add('front-helper',fh.outputFiles[0].contents,F,'officialTechnical.','.runtime.mjs');save(B+'/front-helper-metafile.json',fh.metafile);
const nativeBefore=read(OLD+'/'+oldNames.front).toString(),ast=parse(nativeBefore,'old-native-front');
const funcs=[];function visit(n){if(ts.isFunctionDeclaration(n)&&n.name)funcs.push(n);ts.forEachChild(n,visit)}visit(ast);
function one(name){const a=funcs.filter(n=>n.name.text===name);need(a.length===1,'ONE_NATIVE_FUNCTION '+name);return a[0]}
const store=one('createOfficialTechnicalPreparedStore'),service=one('createOfficialMallPublicService');
const nativeEdits=[{before:nativeBefore.slice(store.getStart(ast),store.end),after:'function createOfficialTechnicalPreparedStore(path = DEFAULT_OFFICIAL_TECHNICAL_STORE_PATH, options = {}) { return __hotCreatePreparedStore(path, options); }',reason:'delegate only prepared-store helper'},
 {before:'  const technicalLookup = dependencies.technicalLookup ?? createOfficialTechnicalPreparedStore().lookup;',after:'  const technicalStore = dependencies.technicalLookup ? null : createOfficialTechnicalPreparedStore(dependencies.technicalStorePath, {workerPath: dependencies.technicalWorkerPath});\n  const technicalLookup = dependencies.technicalLookup ?? technicalStore.lookup;\n  const ready = technicalStore ? technicalStore.warmUp() : Promise.resolve();\n  void ready.catch(() => {});',reason:'worker prewarm ready without changing request budget'},
 {before:'return { officialMall: createOfficialMallPublicRouter({ ...native, service }), createService: createOfficialMallPublicService };',after:'return { officialMall: createOfficialMallPublicRouter({ ...native, service }), createService: createOfficialMallPublicService, ready: service.ready ?? Promise.resolve(), close: () => service.close?.() };',reason:'same existing runtime plus ready ABI'}];
const returns=service.body.statements.filter(ts.isReturnStatement);need(returns.length===1&&ts.isObjectLiteralExpression(returns[0].expression),'NATIVE_SERVICE_RETURN');
// The unique complete return-object prefix anchors readiness insertion, never a broad textual replace.
const open=returns[0].expression.getStart(ast);const prefix=nativeBefore.slice(returns[0].getStart(ast),open+1);
const firstMethod=returns[0].expression.properties[0];need(ts.isMethodDeclaration(firstMethod)&&firstMethod.body,'FIRST_SERVICE_METHOD');
const methodPrefix=nativeBefore.slice(firstMethod.getStart(ast),firstMethod.body.getStart(ast)+1);
const fullPrefix=nativeBefore.slice(returns[0].getStart(ast),firstMethod.body.getStart(ast)+1);
nativeEdits.push({before:fullPrefix,after:prefix+'\n    ready,\n    close: () => technicalStore?.close(),\n    '+methodPrefix,reason:'expose service ready'});
const nativePatched=patch(nativeBefore,nativeEdits,F+'/runtime/'+oldNames.front);proofs.frontNative=nativePatched.proof;
const nativeBytes=Buffer.concat([Buffer.from(`import {createOfficialTechnicalPreparedStore as __hotCreatePreparedStore} from "./${frontHelper.name}";\n`),nativePatched.bytes]);
parse(nativeBytes,'new-native-front');const frontNative=add('front-runtime',nativeBytes,F,'officialMall.front.','.runtime.mjs');
const adminEntry=`export {officialTechnicalPreparation,finishOfficialTechnicalSourceCommit} from ${JSON.stringify(M+'/server/services/officialTechnicalPreparation.ts')};\nexport {createOfficialTechnicalPreparedStore,DEFAULT_OFFICIAL_TECHNICAL_STORE_PATH} from ${JSON.stringify(M+'/server/services/officialTechnicalPreparedStore.ts')};\nexport {readOfficialTechnicalDictionaryRows,OFFICIAL_TECHNICAL_DICTIONARY_COLUMNS} from ${JSON.stringify(M+'/server/services/officialTechnicalDictionary.ts')};\nexport {projectPreparedOfficialTechnical,officialTechnicalIdentitySchema} from ${JSON.stringify(M+'/server/services/officialTechnicalResource.ts')};`;
const ah=await esbuild.build({...base,stdin:{contents:adminEntry,resolveDir:M,loader:'ts',sourcefile:'technical-fast-manager-entry.ts'},packages:'external',define:{__OFFICIAL_TECHNICAL_READER_WORKER_FILE__:JSON.stringify('./'+worker.name)}});
const adminHelper=add('technical-helper',ah.outputFiles[0].contents,A,'officialTechnical.','.runtime.mjs');save(B+'/admin-helper-metafile.json',ah.metafile);
need(!/createPool|listen\(/.test(ah.outputFiles[0].text),'INERT_ADMIN_HELPER');
const mall=patch(read(OLD+'/'+oldNames.admin),[{before:'./'+oldNames.helper,after:'./'+adminHelper.name,reason:'admin only technical pointer'}],A+'/runtime/'+oldNames.admin);proofs.adminNative=mall.proof;
const adminNative=add('admin-runtime',mall.bytes,A,'officialMall.admin.inline.','.runtime.mjs');
const admin=patch(read(O+'/preimages/admin-api.bin'),[{before:'../runtime/'+oldNames.helper,after:'../runtime/'+adminHelper.name,reason:'admin technical preparation pointer'},{before:'../runtime/'+oldNames.admin,after:'../runtime/'+adminNative.name,reason:'admin mall pointer'}],A+'/dist/index.js');proofs.adminAPI=admin.proof;
const ready='  // A new cluster worker cannot listen until its current technical snapshot is validated.\n  const __technicalWarm = await __officialMallNativeV10.ready;\n  console.info("[official-technical-prewarm] " + JSON.stringify({pid:process.pid,...__technicalWarm}));\n';
const anchor='  server.listen(port, "127.0.0.1", () => {';
const front=patch(read(O+'/preimages/front-api.bin'),[{before:'../runtime/'+oldNames.front,after:'../runtime/'+frontNative.name,reason:'front mall pointer'},{before:anchor,after:ready+anchor,reason:'ready before listener',kind:'prelisten-await'}],F+'/dist/index.js');proofs.frontAPI=front.proof;
for(const p of front.proof.patches)if(p.kind==='prelisten-await'){need(Buffer.from(p.beforeBase64,'base64').toString()===anchor,'PRELISTEN_ANCHOR');p.beforeBase64='';p.afterBase64=Buffer.from(ready).toString('base64')}
for(const [role,x] of [['admin-api',admin],['front-api',front]]){parse(x.bytes,role);save(B+'/postimages/'+role+'.bin',x.bytes);save(B+'/deltas/'+role+'.json',x.proof)}
const verifierFiles={};
for(const name of ['source-verifier','prewarm-verifier']){
 let source=read(P+'/deploy/front-fast-20261120/builders/'+name+'.ts').toString().replaceAll('/home/ubuntu/work/platform',P).replaceAll('XM2KNK1vALW96zjrdihS3h','qp4e5jVmsAp0UHKwymyD5X');
 save(B+'/'+name+'.ts',source);
 const built=await esbuild.build({...base,stdin:{contents:source,resolveDir:P,loader:'ts',sourcefile:name+'.ts'},banner:{js:'import {createRequire as __fastRequire} from "node:module";\nconst require=__fastRequire(import.meta.url);'}});standalone(built.metafile);
 const bytes=built.outputFiles[0].contents;save(B+'/evidence/'+name+'.mjs',bytes);verifierFiles[name]={file:'evidence/'+name+'.mjs',sha256:H(bytes)};save(B+'/'+name+'-metafile.json',built.metafile);
}
const prep=await esbuild.build({...base,entryPoints:[P+'/scripts/prepare-w25n04kvzeir-technical.ts'],banner:{js:'import {createRequire as __technicalRequire} from "node:module";\nconst require=__technicalRequire(import.meta.url);'}});standalone(prep.metafile);save(B+'/prepare-complaint-datasheets.mjs',prep.outputFiles[0].contents);save(B+'/preparer-metafile.json',prep.metafile);
for(const [p,d]of Object.entries(sources))need(H(read(p))===d,'SOURCE_DRIFT '+p);
for(const f of files)parse(read(B+'/'+f.packageFile),f.path);
const result={schema:'front-fast-r2-build-v1',status:'built-not-reviewed-not-deployed',files,sourceHashes:sources,proofs,verifiers:verifierFiles,preparerSha256:H(prep.outputFiles[0].contents),frontReadyInsertionBase64:Buffer.from(ready).toString('base64'),frontListenAnchorBase64:Buffer.from(anchor).toString('base64'),builderSha256:H(read(fileURLToPath(import.meta.url))),technicalDeadlineMs:150,activeWrites:0,databaseWrites:0,reloads:0};
save(B+'/manifest.json',result);console.log(JSON.stringify({status:result.status,files,verifiers:verifierFiles,sourceCount:Object.keys(sources).length},null,2));
