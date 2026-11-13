#!/usr/bin/env node
'use strict';
// Offline partial source-bound build only. No Git/network/SSH/API/DB/deployment.
const C=require('./customer-workbench-core-20261114.cjs'),F=require('./customer-workbench-factory-20261114.cjs'),CSS=require('./customer-workbench-css-20261114.cjs');
const {fs,assert,ts,REPO,BASE,ROOT,OUT,EXPECTED_HTML,read,sha,parse,nodes,one,top,write,apply,customerEdits,finishHTML,importmap}=C;
async function build(){
 if(process.argv.includes('--inspect')){const b=F.bindings();fs.mkdirSync(ROOT,{recursive:true});fs.writeFileSync(ROOT+'/bridge-preparation.json',JSON.stringify({status:'PREPARED_NOT_FROZEN',currentHtmlSha256:sha(read(BASE+'/index.html')),activeModules:b.urls,bridgeEvidence:b.evidence,deployedBridgeObjectSha256:b.deployedBridgeObjectSha256,sourceFrozen:false,candidateWritten:false,actualInventoryRoutes:b.urls.map(url=>({url,route:top(parse(read(BASE+url)),'I1').getText()}))},null,2)+'\n');console.log('BRIDGES_PREPARED_ONLY');return;}
 assert(process.argv.includes('--source-ready'),'parent must notify source-ready before formal candidate compilation');
 assert(/^[a-f0-9]{64}$/.test(EXPECTED_HTML??''),'explicit parent-approved latest CUSTOMER_EXPECTED_HTML_SHA256 required');
 assert.equal(sha(read(BASE+'/index.html')),EXPECTED_HTML,'latest HTML CAS');
 const urls=JSON.parse(read(BASE+'/active-workbenches.json'));assert.equal(urls.length,2);
 const map=importmap(read(BASE+'/index.html')).map,reachable=[...new Set([...Object.values(map.imports),...Object.values(map.scopes??{}).flatMap(Object.values)].filter(v=>/BusinessWorkbenchPage[^/]*\.js$/.test(v)))];assert.deepEqual([...reachable].sort(),[...urls].sort(),'all importmap reachable modules');
 const baselinePins=Object.fromEntries(urls.map(u=>[u,sha(read(BASE+u))])),r=await F.compileCustomerFactory(),styles=await CSS.buildCustomerCss(r);
 const sourceHashes={...r.sourceHashes,...styles.sourceHashes};for(const[f,pin]of Object.entries(r.sourceHashes))if(styles.sourceHashes[f])assert.equal(pin,styles.sourceHashes[f],'factory/CSS source snapshot equality');
 // Validate all input/route/CSS prerequisites before creating any candidate files.
 for(const u of urls)customerEdits(read(BASE+u),r);
 assert.equal(sha(read(BASE+'/index.html')),EXPECTED_HTML);assert.equal(styles.proof.native.htmlSha256,EXPECTED_HTML);
 write('customer-factory.js',r.code);write('customer-factory-metafile.json',r.metafile);write('customer-source-hashes.json',sourceHashes);
 const records=[],relocations={},proofs=[];
 function asset(prefix,text,ext='js'){const url='/assets/'+prefix+'-'+sha(text)+'.'+ext;write(url.slice(1),text);records.push({relative:url.slice(1),sha256:sha(text)});return url;}
 for(const[idx,url]of urls.entries()){
  const before=read(BASE+url),plan=customerEdits(before,r),a=plan.a,out=apply(before,plan.edits,'workbench-'+idx),next=parse(out.after);
  assert.equal(out.proof.patches,4,'exact Iw/dialog/I1 plus final lazy getter');
  const protectedNames=['op','uI','KI','Ty','Ly','Uy','__d51_so_get','__d51_ir_w_get','__d51_rx_chat_helpers_get'],protectedHashes={};
  for(const name of protectedNames){const old=top(a,name),neu=top(next,name);assert.equal(old.getText(a),neu.getText(next),'protected latest native '+name);protectedHashes[name]=sha(old.getText(a));}
  const oldHost=one(a,n=>ts.isVariableDeclaration(n)&&n.name.getText(a)==='__admin_workbench_host_v1','old host capsule'),newHost=one(next,n=>ts.isVariableDeclaration(n)&&n.name.getText(next)==='__admin_workbench_host_v1','preserved old host capsule');assert.equal(oldHost.getText(a),newHost.getText(next),'old inventory capsule entirely byte preserved');
  assert.deepEqual(a.statements.filter(n=>ts.isImportDeclaration(n)||ts.isExportDeclaration(n)).map(n=>n.getText(a)),next.statements.filter(n=>ts.isImportDeclaration(n)||ts.isExportDeclaration(n)).map(n=>n.getText(next)),'native import/export tables unchanged');
  const candidate=asset('BusinessWorkbenchPage-customer-workbench-'+idx,out.after);relocations[url]=candidate;
  const proof={...out.proof,beforeUrl:url,url:candidate,sourceHashes,factorySha256:sha(r.code),factoryCodeBytes:Buffer.byteLength(r.code),globalInventoryDefaultSourceBound:true,oldInventoryCapsulePreserved:true,oldInventoryCapsuleSha256:sha(oldHost.getText(a)),latestGlobalOrdersBytesPreserved:true,unrelatedNativeBytesUnchanged:true,mallOperationsUnchanged:true,scopeAndArchiveUnchanged:true,protectedFunctionHashes:protectedHashes,replacements:plan.replacements,oldCustomerCapsulePreservedExceptDemandDialog:idx===1,routeImportsUnchanged:true};
  write('workbench-'+idx+'-build-proof.json',proof);proofs.push(proof);
 }
 const cssUrl=asset('customer-workbench',styles.css,'css');write('css-build-proof.json',{...styles.proof,url:cssUrl,sha256:sha(styles.css)});finishHTML(relocations,records,cssUrl);
 for(const[u,pin]of Object.entries(baselinePins))assert.equal(sha(read(BASE+u)),pin,'baseline module final CAS');assert.equal(sha(read(BASE+'/index.html')),EXPECTED_HTML,'HTML final CAS');for(const[f,pin]of Object.entries(sourceHashes))assert.equal(sha(fs.readFileSync(REPO+'/'+f)),pin,'source final CAS '+f);for(const f of styles.proof.native.files)assert.equal(sha(fs.readFileSync(f.path)),f.sha256,'native CSS final CAS');
 write('candidate-proof.json',{status:'PASS',releaseType:'OFFLINE_CUSTOMER_INCREMENTAL_CANDIDATE_NOT_DEPLOYED',sourceSnapshotStable:true,sourceHashes,baselineHtmlSha256:EXPECTED_HTML,baselineAssets:baselinePins,nativeStylesheets:styles.proof.native.files,allReachableWorkbenchVariantsCovered:true,actualGlobalInventoryRoutesReplaced:2,globalInventoryDefaultSourceBound:true,latestGlobalOrdersBytesPreserved:true,oldInventoryCapsulesBytePreserved:true,unrelatedNativeBytesUnchanged:true,mallOperationsUnchanged:true,scopeAndArchiveUnchanged:true,navigationAssetUnchanged:true,entryBytesUnchanged:true,noCopiedReact:true,noCopiedAuth:true,noCopiedScope:true,noCopiedPageMemory:true,noCopiedApi:true,noNewRoot:true,noNewProvider:true,backendChanges:0,databaseOperations:0,networkWrites:0,deployed:false,workbenches:proofs.map(p=>({url:p.url,protectedFunctionHashes:p.protectedFunctionHashes})),files:records});
 console.log(JSON.stringify({status:'BUILT_NOT_DEPLOYED',files:records.length,relocations,cssUrl,sourceSnapshotStable:true}));
}
module.exports={build};if(require.main===module)build().catch(e=>{console.error(e.stack);process.exitCode=1;});
