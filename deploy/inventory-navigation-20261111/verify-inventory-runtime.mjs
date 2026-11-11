#!/usr/bin/env node
import fs from 'node:fs';
import vm from 'node:vm';
import {BASE,TOOLS,OUT,sha,read,json,parse,nodes,one,factory,apply,assert,ts} from './inventory-builder-core.mjs';
const manifest=JSON.parse(read(OUT+'/manifest.json')),navHost=JSON.parse(read(TOOLS+'/inventory-runtime-factories.json')),customer=JSON.parse(read(TOOLS+'/inventory-customer-proof.json')),plan=JSON.parse(read(TOOLS+'/inventory-customer-patches.json')),statics=JSON.parse(read(OUT+'/verification.json'));
assert(statics.success&&statics.manifestSha256===sha(read(OUT+'/manifest.json')),'STATIC_FINAL_HASH');
assert(navHost.candidateReplayed&&navHost.testedCasesPassed&&navHost.cases.length===12&&navHost.cases.every(t=>t.passed)&&navHost.mutationCalls===0,'NAV_HOST_ACTUAL_CASES');
for(const r of manifest.files){const proof=one(navHost.assets.filter(p=>p.id===r.id),'ACTUAL_ASSET_PROOF');assert(proof.testedAssetSha256===r.sha256,'FINAL_ACTUAL_RUNTIME_HASH')}
assert(customer.completed&&customer.reverseVerified&&customer.tests.length===22&&customer.tests.every(t=>t.passed),'CUSTOMER_ACTUAL_CASES');
const row=one(manifest.files.filter(r=>r.id==='workbench'),'WORKBENCH'),before=read(row.beforeFile),customerOnly=apply(before,plan.patches,'customer-only-runtime-reference').candidate;
assert(sha(customerOnly)===customer.candidateSha256,'CUSTOMER_TESTED_CODE_HASH');
const finalText=read(OUT+'/assets/'+row.file),a=parse(finalText),ca=parse(customerOnly),finalFactory=factory(a,'__customer_workbench_manager_v1'),proofFactory=factory(ca,'__customer_workbench_manager_v1');
assert(finalFactory.getText(a)===proofFactory.getText(ca),'CUSTOMER_FACTORY_MERGE_BYTES_IDENTICAL');
const host=factory(a,'__admin_workbench_host_v1'),yb=one(nodes(host,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='Yb'),'ACTUAL_UPLOAD_COMPONENT');
const jump=one(nodes(yb,n=>ts.isCallExpression(n)&&n.expression.getText(a)==='gi'&&n.arguments[1]?.text==='materials'),'ACTUAL_UPLOAD_RESULT_JUMP');
let callback=jump;while(callback&&!ts.isArrowFunction(callback))callback=callback.parent;assert(callback,'ACTUAL_COMPLETION_CALLBACK');
const fi=one(nodes(host,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='fi'),'ORIGINAL_RECEIPT_SELECTOR'),gi=one(nodes(host,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='gi'),'ORIGINAL_SOURCE_LOCATION');
const oldAst=parse(before),oldHost=factory(oldAst,'__admin_workbench_host_v1'),oldYb=one(nodes(oldHost,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='Yb'),'OLD_UPLOAD_COMPONENT'),p=one(row.patches.filter(p=>p.label==='actual-Supply-Yb-completion-to-materials'),'ONE_RESULT_LITERAL_PATCH'),offset=p.start-oldYb.getStart(oldAst);
assert(oldYb.getText(oldAst).slice(0,offset)+p.after+oldYb.getText(oldAst).slice(offset+p.before.length)===yb.getText(a),'UPLOAD_COMPONENT_ONLY_RESULT_LITERAL_CHANGED');
const completionCases=[];
for(const [name,current,entries,expected]of[
 ['successful single receipt closes portal then targets exact materials',true,[{status:'success',receipt:{customerId:11,channelId:73}}],['complete','close','navigate:/channel-inventory?supplyChannelId=73&supplyTab=materials']],
 ['stale upload callback cannot close or navigate',false,[{status:'success',receipt:{customerId:11,channelId:73}}],[]],
 ['mixed channels are rejected without close or navigation',true,[{status:'success',receipt:{customerId:11,channelId:73}},{status:'success',receipt:{customerId:11,channelId:74}}],['error']]
]){
 const events=[],context={W:()=>current,e:{customerId:11,onComplete:()=>events.push('complete'),onClose:()=>events.push('close')},u:()=>events.push('error'),r:p=>events.push('navigate:'+p),pi:()=>{throw Error('Batch branch outside this single-receipt verifier')},Number,Set,Error};
 const run=vm.runInNewContext(fi.getText(a)+'\n'+gi.getText(a)+'\n('+callback.getText(a)+')',context,{timeout:5000});run(entries);assert(json(events)===json(expected),'COMPLETION_SEQUENCE:'+name);completionCases.push({name,passed:true,events});
}
const report={schemaVersion:3,passed:true,fullCandidate:true,candidateReplayed:true,coverageScope:'Authorized inventory navigation and customer supply deltas, not the entire platform',manifestSha256:sha(read(OUT+'/manifest.json')),candidateIndexSha256:manifest.index.sha256,assets:manifest.files.map(r=>({file:r.file,sha256:r.sha256})),navHostTestsPassed:navHost.cases.length,customerTestsPassed:customer.tests.length,completionTestsPassed:completionCases.length,customerFactorySha256:sha(finalFactory.getText(a)),customerFactoryBytesMatchTestedProof:true,navHostEvidenceSha256:sha(read(TOOLS+'/inventory-runtime-factories.json')),customerEvidenceSha256:sha(read(TOOLS+'/inventory-customer-proof.json')),completionCases,mutationCalls:0,realBusinessWrites:false,browserUsed:false,databaseConnected:false,networkRequests:false,limitations:[...navHost.limitations,...customer.limitations,'Completion proof executes the actual single-receipt callback; batch/restore unchanged behavior is covered by source tests and byte preservation, not real production writes.','No real browser layout, hydration or logged-in production API test was performed.']};
fs.writeFileSync(OUT+'/runtime-test.json',json(report));fs.writeFileSync(TOOLS+'/inventory-runtime-final.json',json(report));console.log(json({passed:true,fullCandidate:true,navHostTests:12,customerTests:22,completionTests:3,manifestSha256:report.manifestSha256}));
