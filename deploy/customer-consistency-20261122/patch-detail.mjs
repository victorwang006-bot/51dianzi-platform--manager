#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const R='/home/ubuntu/work/channel-release-20261121-1837/manager';
const req=createRequire(R+'/package.json'),ts=req('typescript'),esbuild=req('esbuild');
const [input,outDir]=process.argv.slice(2);assert(input&&path.isAbsolute(input)&&outDir&&path.isAbsolute(outDir),'Usage: node patch-detail.mjs /absolute/input-WB.js /absolute/output-directory');
const sourcePath=R+'/client/src/business/platform/client/src/pages/CustomerDetail.tsx';
const H=x=>crypto.createHash('sha256').update(x).digest('hex'),parse=(s,n='native.js')=>{const a=ts.createSourceFile(n,s,99,true,1);assert.equal(a.parseDiagnostics.length,0,'syntax '+n);return a;};
const nodes=(a,p)=>{const out=[];function walk(n){if(p(n))out.push(n);ts.forEachChild(n,walk);}walk(a);return out;};
const one=(xs,label)=>{assert.equal(xs.length,1,label);return xs[0];};
const named=(a,f,key)=>one(nodes(f,n=>ts.isVariableDeclaration(n)&&n.name.getText(a)===key),'unique declaration '+key);
const prop=(o,key)=>o.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.text===key);
const expr=s=>{const n=parse('const __expr=('+s+');').statements[0].declarationList.declarations[0].initializer.expression;function synth(x){ts.setTextRange(x,{pos:-1,end:-1});ts.forEachChild(x,synth);}synth(n);return n;};
const printer=ts.createPrinter({removeComments:true});
function mapped(node,a,map){const result=ts.transform(node,[context=>root=>{const visit=n=>{if(ts.isShorthandPropertyAssignment(n)&&map[n.name.text])return ts.factory.createPropertyAssignment(n.name,expr(map[n.name.text]));if(ts.isIdentifier(n)&&map[n.text]){const p=n.parent;if(ts.isPropertyAccessExpression(p)&&p.name===n||ts.isPropertyAssignment(p)&&p.name===n)return n;return expr(map[n.text]);}return ts.visitEachChild(n,visit,context);};return ts.visitNode(root,visit);}]);const out=printer.printNode(ts.EmitHint.Unspecified,result.transformed[0],a);result.dispose();return out;}
const map={newInformationDetailReady:'__apDetailReady',newInformationRows:'__apDetailRows',newInformationRow:'__apDetailRow',inspectedCustomer:'__apInspectedCustomer',readAcknowledged:'__apReadAcknowledged',newInformationError:'__apInformationError',jsx:'l',jsxs:'p'};
const source=fs.readFileSync(sourcePath,'utf8'),sourceSHA=H(source),{code}=await esbuild.transform(source,{loader:'tsx',jsx:'automatic',format:'esm',target:'es2020',minify:false,legalComments:'none'}),sa=parse(code,'source-detail.js');
const sd=one(nodes(sa,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='CustomerDetailPage'),'source CustomerDetailPage');
const sourceStatus=one(nodes(sd,n=>ts.isConditionalExpression(n)&&n.condition.getText(sa).startsWith('!newInformationDetailReady || newInformationRow.verificationState')),'source status root');
const before=fs.readFileSync(input,'utf8'),a=parse(before,input),detail=one(nodes(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='IM'&&n.getText(a).includes('__apDetailRow')),'real final IM');
assert(detail.getText(a).includes('customer-profile-tight')&&detail.getText(a).includes('isFetchedAfterMount'));
const main=one(nodes(detail,n=>ts.isCallExpression(n)&&n.arguments[0]?.text==='main'&&ts.isObjectLiteralExpression(n.arguments[1])&&prop(n.arguments[1],'className')?.initializer.text?.includes('customer-profile-tight')),'actual successful detail main');
assert.equal(prop(main.arguments[1],'ref')?.initializer.getText(a),'__apDetailRow.ref','successful main native ref retained');
for(const n of nodes(detail,n=>ts.isCallExpression(n)&&n.arguments[0]?.text==='main'&&ts.isObjectLiteralExpression(n.arguments[1])))if(n!==main)assert(!prop(n.arguments[1],'ref'),'loading/error main cannot ack');
const titleBox=one(nodes(detail,n=>ts.isObjectLiteralExpression(n)&&prop(n,'className')?.initializer.text==='min-w-0'&&prop(n,'children')?.initializer.getText(a).includes('customer-detail-name')),'actual title host');
const children=prop(titleBox,'children').initializer;assert(ts.isArrayLiteralExpression(children));
const status=one(children.elements.filter(n=>ts.isConditionalExpression(n)&&n.getText(a).includes('__apReadAcknowledged')&&n.getText(a).includes('customer-detail-read-status')),'actual notification status root');
const acknowledged=named(a,detail,'__apReadAcknowledged');
const replacements=[{start:acknowledged.initializer.getStart(a),end:acknowledged.initializer.end,after:mapped(named(sa,sd,'readAcknowledged').initializer,sa,map),reason:'source row verification includes current notification identity; no cached false proof bypass'}, {start:status.getStart(a),end:status.end,after:mapped(sourceStatus,sa,map),reason:'source detail visible checking/blocked/missing/failed/confirmed/top-sync status; accepted retry is summary-only'}].filter(p=>before.slice(p.start,p.end)!==p.after);
let shift=0,last=-1;for(const p of replacements.sort((x,y)=>x.start-y.start)){assert(p.start>=last);last=p.end;p.before=before.slice(p.start,p.end);assert.notEqual(p.before,p.after);assert(p.start>=detail.getStart(a)&&p.end<=detail.end,'patch only real detail notification slots');p.afterStart=p.start+shift;p.afterEnd=p.afterStart+p.after.length;shift+=p.after.length-p.before.length;}
let after=before;for(const p of [...replacements].reverse())after=after.slice(0,p.start)+p.after+after.slice(p.end);
let inverse=after;for(const p of [...replacements].reverse()){assert.equal(inverse.slice(p.afterStart,p.afterEnd),p.after);inverse=inverse.slice(0,p.afterStart)+p.before+inverse.slice(p.afterEnd);}assert(Buffer.from(inverse).equals(Buffer.from(before)),'whole WB exact inverse');const aa=parse(after,'patched-WB.js');
const nextDetail=one(nodes(aa,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='IM'&&n.getText(aa).includes('__apDetailRow')),'patched real IM');
// Remaining detail business code and all surrounding bytes are retained by exact inverse.
const nativeGuardTokens=['Hv','Iw','FM','.__apDetailRow'];const wiring={};for(const token of nativeGuardTokens.slice(0,3)){assert(before.includes(token)&&after.includes(token));wiring[token]=true;}
const declared=new Set(),used=new Set();function binding(n){if(ts.isIdentifier(n))declared.add(n.text);else if(ts.isObjectBindingPattern(n)||ts.isArrayBindingPattern(n))for(const e of n.elements)if(ts.isBindingElement(e))binding(e.name);}
function free(f,sf){declared.clear();used.clear();function walk(n){if(ts.isVariableDeclaration(n)||ts.isParameter(n))binding(n.name);if(ts.isFunctionDeclaration(n)&&n.name)declared.add(n.name.text);if(ts.isIdentifier(n)){const p=n.parent;if(!(ts.isPropertyAccessExpression(p)&&p.name===n||ts.isPropertyAssignment(p)&&p.name===n||ts.isBindingElement(p)&&p.propertyName===n))used.add(n.text);}ts.forEachChild(n,walk);}walk(f);return [...used].filter(x=>!declared.has(x)).sort();}
const beforeFree=free(detail,a),afterFree=free(nextDetail,aa);assert.deepEqual(afterFree,beforeFree,'no new native free ABI symbols');
const sha256=H(after),url='/assets/BusinessWorkbenchPage-customer-consistency-'+sha256.slice(0,16)+'.js',local=outDir+'/'+path.basename(url);fs.mkdirSync(outDir,{recursive:true});fs.writeFileSync(local,after);
const fixture=outDir+'/native-IM-'+sha256.slice(0,16)+'.js';fs.writeFileSync(fixture,nextDetail.getText(aa)+'\n');
const evidence={input,inputSHA:H(before),output:{url,local,sha256,size:Buffer.byteLength(after)},sourcePath,sourceSHA,builderSHA:H(fs.readFileSync(new URL(import.meta.url))),fixture,IMBeforeSHA:H(detail.getText(a)),IMAfterSHA:H(nextDetail.getText(aa)),wiring,beforeFree,afterFree,patches:replacements.map(p=>({...p,beforeSHA:H(p.before),afterSHA:H(p.after),beforeBase64:Buffer.from(p.before).toString('base64'),afterBase64:Buffer.from(p.after).toString('base64')})),checks:{onlyTwoNotificationSlots:true,wholeWBInverseExact:true,outsideSlotsBytesUnchanged:true,noWholePageFunctionReplacement:true,noNativeImportsOrReactQueryChanges:true,successfulMainRefRetained:true,errorLoadingNoRef:true,currentMountPermissionsBusinessGuardsRetained:true,contactsBusinessCodeRetained:true,noNewFreeABI:true}};
assert.equal(H(fs.readFileSync(sourcePath)),sourceSHA,'source stable');const evidencePath=outDir+'/detail-patch-'+sha256.slice(0,16)+'.json';fs.writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({status:'DETAIL_PATCHED',...evidence.output,fixture,evidencePath,checks:evidence.checks}));
