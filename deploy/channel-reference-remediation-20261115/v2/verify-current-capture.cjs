#!/usr/bin/env node
'use strict';
// Offline capture only, no app-source reads/compilation/production calls.
const C=require('./scoped-core.cjs'),F=require('./frontend-scoped.cjs'),B=require('./build-nextrelease.cjs');
function verify(dir,pin){
 C.assert(dir.startsWith('/home/ubuntu/work/channel-reference-remediation-20261115/baseline/'));
 const r=B.currentBaseline(dir,pin),b=r.b,admin=C.pinned(dir+'/admin-index.js',b.api.admin),d=C.nativeImport(admin);C.verifyDelta(admin,d.after,d.proof);
 const map=F.mapOf(C.pinned(dir+'/index.html',b.beforeHtmlSha256).toString('utf8')).map,urls=[...new Set(Object.values(map.imports).filter(x=>/\/BusinessWorkbenchPage-[01]-channel-reference-adjustments-/.test(x)))].sort();C.assert.equal(urls.length,2);
 const assetPins=Object.fromEntries(b.baselineAssets.map(x=>[x.relative,x.sha256])),bridges=urls.map(u=>F.bridge(C.pinned(C.inside(dir,u.slice(1)),assetPins[u.slice(1)]).toString('utf8')));C.assert.deepEqual(bridges[0].raw,bridges[1].raw);
 return {contractVersion:'channel-remediation-current-capture-offline-check-v1',status:'PASS',ready:false,fixtureOnly:false,scope:'captured current bytes and native AST inverse only; not application/runtime/UI/production acceptance',baselineDir:dir,baselineReportSha256:pin,sourceCommit:b.sourceCommit,sourceUnionCount:Object.keys(b.sourceHashes).length,priorSourceUnionCount:Object.keys(b.priorSourceHashes).length,baselineAssetCount:b.baselineAssets.length,capturedAtUtc:b.capturedAtUtc,currentWorkbenchUrls:urls,nativeLiveBindingsSha256:bridges[0].liveSha256,apiImportLiteralSlices:d.proof.patches.length,protectedApiDeclarations:d.proof.protectedDeclarationCountObserved,apiImportInverse:d.proof,applicationCompiled:false,serviceCompiled:false,producerExecuted:false,activeProducerAccepted:false,productionExecuted:false};
}
if(require.main===module){const a=process.argv.slice(2);C.assert(a.length===4&&a[0]==='--baseline'&&a[2]==='--sha256');try{console.log(JSON.stringify(verify(a[1],a[3]),null,2));}catch(e){console.error('CAPTURE_OFFLINE_CHECK_ABORT: '+e.stack);process.exitCode=1;}}
module.exports={verify};
