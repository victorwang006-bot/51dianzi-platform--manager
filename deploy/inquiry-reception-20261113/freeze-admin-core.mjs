#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {OUT,LIVE,json,read,sha,write,tree,nodes} from './tests/admin-candidate-helper.mjs';
const runtime=json(OUT+'/runtime-verification.json'),build=json(OUT+'/build-admin-proof.json');
assert.equal(runtime.status,'PASS');assert.equal(runtime.results.length,18);
const relocations=Object.fromEntries(Object.entries(runtime.candidateRelocations).filter(([k,v])=>!/DashboardLayout/.test(v)));
const officialPath=OUT+'/official-runtime-verification.json';
if(fs.existsSync(officialPath)){
 const official=json(officialPath);assert.equal(official.status,'PASS');assert.equal(official.results.length,12);assert.equal(sha(fs.readFileSync(official.candidateFile)),official.candidateSha256,'independently verified Official candidate bytes');
 const original=Object.keys(relocations).find(k=>k.includes('OfficialChannelInventory'));assert.ok(original);assert.ok(official.candidateFile.startsWith(OUT+'/candidate/'));relocations[original]=official.candidateFile.slice((OUT+'/candidate').length);
}
const proofs=[],records=[];
for(const [oldUrl,url] of Object.entries(relocations)){
 const before=read(LIVE+oldUrl),after=read(OUT+'/candidate'+url),p=build.proofs.find(x=>x.beforeSha256===sha(before));assert.ok(p);
 const insertionEnd=after.indexOf(before.slice(0,160));assert.ok(insertionEnd>0,'first original bytes locate');
 let cursor=0,out='',offset=0;const edits=[];
 for(const e of p.edits){const text=e.start===0&&e.end===0?after.slice(0,insertionEnd):e.text;out+=before.slice(cursor,e.start);const outStart=out.length;out+=text;edits.push({...e,text,outStart,outEnd:out.length,beforeSha256:sha(e.before),afterSha256:sha(text)});cursor=e.end;}
 out+=before.slice(cursor);assert.equal(out,after,'reconstructed frozen original candidate');
 let inverse=after;for(const e of [...edits].reverse())inverse=inverse.slice(0,e.outStart)+e.before+inverse.slice(e.outEnd);assert.equal(inverse,before);
 proofs.push({...p,afterSha256:sha(after),edits});records.push({file:OUT+'/candidate'+url,targetRelative:url.slice(1),kind:'asset',sha256:sha(after)});
}
write('core-frozen-manifest.json',{status:'FROZEN',basis:'Existing actual workbench runtime-verification 18 PASS; Official candidate selected only from independently PASS/hash-verified Official result when present. Recovered exact fullbytes CAS edits checked forward and inverse. Core bytes immutable after this snapshot.',sourceFiles:build.sourceFiles.filter(x=>!x.file.endsWith('AdminWorkspaceNavigation.css')&&!x.file.endsWith('InquiryReception.css')&&!x.file.endsWith('AdminWorkspaceNavigation.tsx')&&!x.file.endsWith('adminWorkspaceNavigationModel.ts')),records,proofs,relocations});
for(const mode of ['workbench','official']){
 const record=records.find(x=>mode==='workbench'?x.targetRelative.includes('Workbench'):x.targetRelative.includes('Official'));
 const t=tree(read(record.file)),getter=t.declarations.get(mode==='workbench'?'__d51_ir_w_get':'__d51_ir_o_get');assert.ok(getter);
 const statement=nodes(getter,n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(t.ast)==='__exports'))[0];assert.ok(statement);
 const code=statement.getText(t.ast)+'\n',info=json(OUT+'/factory-'+mode+'.json');
 write('factory-'+mode+'.js',code);write('factory-'+mode+'.json',{...info,sha256:sha(code),actualFrozenCandidate:{file:record.file,sha256:record.sha256,getterSha256:sha(getter.getText(t.ast)),extractedFactoryStatementSha256:sha(code)}});
}
console.log(JSON.stringify({status:'FROZEN',files:records.map(x=>({target:x.targetRelative,sha256:x.sha256}))}));
