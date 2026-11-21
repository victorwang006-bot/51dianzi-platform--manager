#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const R='/home/ubuntu/work/channel-release-20261121-1837/manager';
const W='/home/ubuntu/work/customer-consistency-release-20261122-0034';
const ts=createRequire(R+'/package.json')('typescript');
const H=x=>crypto.createHash('sha256').update(x).digest('hex');
const read=p=>fs.readFileSync(p,'utf8');
const json=p=>JSON.parse(read(p));
const parse=(s,n)=>{const a=ts.createSourceFile(n,s,99,true,1);assert.equal(a.parseDiagnostics.length,0,n+' parse');return a;};
const nodes=(a,p)=>{const out=[];function walk(n){if(p(n))out.push(n);ts.forEachChild(n,walk);}walk(a);return out;};
const one=(a,msg)=>{assert.equal(a.length,1,msg);return a[0];};
const manifest=json(W+'/layout/manifest.json');
const report={status:'PASS',scope:'Read-only static checks; only QA fixture/scripts edited',sourcePins:{},layout:[],aliasBindings:{},notificationGuards:{}};
for(const [p,pin]of Object.entries(manifest.sourcePins)){const actual=H(fs.readFileSync(p));assert.equal(actual,pin,'layout source pin');report.sourcePins[p]=actual;}
for(const m of manifest.modules){
 const before=read(m.input),after=read(m.local),receipt=json(W+'/layout/candidate/evidence/workbench-'+m.index+'.json');
 assert.equal(H(before),m.beforeSHA);assert.equal(H(after),m.afterSHA);assert.equal(receipt.patches.length,2);
 let inverse=after;
 for(const p of [...receipt.patches].sort((a,b)=>b.afterStart-a.afterStart)){
  const old=Buffer.from(p.beforeBase64,'base64').toString(),next=Buffer.from(p.afterBase64,'base64').toString();
  assert.equal(inverse.slice(p.afterStart,p.afterEnd),next,'exact current slot bytes');
  inverse=inverse.slice(0,p.afterStart)+old+inverse.slice(p.afterEnd);
 }
 assert(Buffer.from(inverse).equals(Buffer.from(before)),'all outside-slot WB bytes unchanged');
 const a=parse(after,'WB'+m.index),f=one(nodes(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text===(m.index?'vt':'Jw')&&n.getText(a).includes('__apUnreadOnly')),'one actual current list');
 assert(f.getText(a).includes('var(--customer-list-table-min-width, 1312px)'));
 assert(!f.getText(a).includes('Math.max(30'));
 assert(f.getText(a).includes('customer-list-name-statuses'));
 assert(f.getText(a).includes('customer-list-unread-filter'));
 report.layout.push({wb:m.index,beforeSHA:m.beforeSHA,afterSHA:m.afterSHA,exactInverse:true,patchCount:2,slots:receipt.patches.map(p=>p.reason),listFunction:f.name.text,listSHA:H(f.getText(a))});
 if(m.index===1){
  let parent=f.parent;while(parent&&!ts.isFunctionDeclaration(parent))parent=parent.parent;
  assert.equal(parent.name.text,'__CW_CUSTOMER_LIST_UPDATED_20261116_GET');
  const declarations=nodes(parent,n=>ts.isVariableDeclaration(n)&&/^(qe|we)$/.test(n.name.getText(a))&&n.initializer?.getText(a).includes('__cwCustomerListUpdatedLive'));
  const binding=Object.fromEntries(declarations.map(n=>[n.name.text,n.initializer.argumentExpression.text]));
  assert.equal(binding.qe,'client/src/business/platform/client/src/hooks/usePageMemory#useListPositionRestore');
  assert.equal(binding.we,'client/src/business/platform/client/src/lib/pageMemory#confirmCustomerFilters');
  const calls=nodes(f,n=>ts.isCallExpression(n)&&/^(qe|we)$/.test(n.expression.getText(a))).map(n=>({alias:n.expression.getText(a),arguments:n.arguments.map(x=>x.getText(a)),text:n.getText(a)}));
  assert.equal(calls.filter(n=>n.alias==='qe'&&n.arguments.length===2).length,1);
  assert.equal(calls.filter(n=>n.alias==='we'&&n.arguments.length===0).length,2);
  const fixture=read(W+'/layout/tests/build-browser-fixture.mjs');
  assert(fixture.includes('run.vm.tb=run.vm.qe=useListPositionRestore;'));
  assert(fixture.includes('run.vm.we=memory.confirmCustomerFilters;'));
  report.aliasBindings={binding,calls,fixtureSHA:H(fixture),correction:'Only offline QA alias binding swapped; native module and actual pageMemory unchanged'};
 }
}
const oldCSS=read(manifest.css.input),css=read(manifest.css.output),suffix=read(manifest.css.suffix);
const foundation=read(manifest.css.foundation);
assert.equal(H(oldCSS),manifest.css.inputSHA);assert.equal(H(css),manifest.css.outputSHA);assert.equal(H(foundation),manifest.css.foundationSHA);
assert.equal(css,oldCSS+'\n/* source-derived customer table foundation; no historic header/subgrid rules */\n'+foundation+'\n'+suffix);
const cssSource=read(R+'/client/src/business/platform/client/src/pages/CustomerList.css'),cssBefore=read(W+'/layout/baseline/CustomerList.css');
assert.equal(cssSource,cssBefore+suffix);
assert.equal(foundation,cssSource.slice(0,cssSource.indexOf('/* Workbench release: geometry only, retain existing typography and eight columns. */')));
assert(foundation.includes('.customer-list-table-inner[data-slot="table-container"]')&&foundation.includes('overflow: visible')&&foundation.includes('position: sticky')&&foundation.includes('.customer-list-col-actions'));
assert(!foundation.includes('customer-list-wide')&&!foundation.includes('subgrid'),'historic header rules excluded');
assert(suffix.includes('--customer-list-demand-width: 128px')&&suffix.includes('--customer-list-actions-width: 88px'));
report.css={exactPreviousPrefix:true,exactSourceSuffix:true,sourceDerivedLocalFoundation:true,foundationSHA:manifest.css.foundationSHA,historicHeaderRulesExcluded:true,sha256:manifest.css.outputSHA};
const detailPath=R+'/client/src/business/platform/client/src/pages/CustomerDetail.tsx';
const detail=read(detailPath),detailBefore=read(W+'/notification/before/CustomerDetail.tsx');
const main=detail.match(/<main ref=\{newInformationRow.ref\}[^>]+>/g),oldMain=detailBefore.match(/<main ref=\{newInformationRow.ref\}[^>]+>/g);
assert.deepEqual(main,oldMain);assert.equal(main.length,1);
const early=detail.slice(detail.indexOf('  if (!validId) return'),detail.indexOf('  const currentAssignee ='));
assert(!early.includes('ref='));
assert(detail.includes('newInformationRow.verificationState === "confirmed"'));
const libPath=R+'/client/src/lib/adminNewInformation.tsx',lib=read(libPath),libBefore=read(W+'/notification/before/adminNewInformation.tsx');
const retry=s=>s.slice(s.indexOf('    retryDisplayed: async () => {'),s.indexOf('\n/** TWO integration surfaces.'));
assert.equal(retry(lib),retry(libBefore),'original fresh inspect retry and guards retained');
const mark=s=>s.slice(s.indexOf('function rejectedMark('),s.indexOf('\n// Shared ONLY'));
assert.equal(mark(lib),mark(libBefore),'positive accepted contract retained');
assert(lib.includes('invalidateDisplayed(state.access.token!, state.options.module, state.scope)'));
const incoming=lib.slice(lib.indexOf('tabChannel.onmessage ='),lib.indexOf('      } catch { /* Local registrations'));
assert(!incoming.includes('postMessage'));assert(incoming.includes('refreshDisplayed('));
report.notificationGuards={successfulMainRefUnchanged:true,errorLoadingNoRef:true,freshReceiptRetryBytesUnchanged:true,positiveAcceptedContractBytesUnchanged:true,incomingBroadcastHasNoRebroadcast:true};
for(const p of [detailPath,libPath,R+'/client/src/components/admin/AdminNewInformationBadge.tsx',R+'/client/src/components/admin/AdminNewInformationMenuBadge.tsx'])report.sourcePins[p]=H(fs.readFileSync(p));
fs.writeFileSync(W+'/evidence/final-static-review.json',JSON.stringify(report,null,2)+'\n');
console.log('STATIC PASS: source pins, 2 native layout slots per WB, exact inverse/CSS suffix, true WB1 alias bridge/calls, unchanged main/accepted/fresh-receipt retry guards.');
