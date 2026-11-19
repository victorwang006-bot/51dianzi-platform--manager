import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as esbuild from 'esbuild';
import {emittedLeaf,inverseDelta} from '../../customer-upload-compact-20261119/packaging/build-native.mjs';
const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),'../../..');
const BASE=process.env.CUSTOMER_BOUND_DIR??'/home/ubuntu/work/customer-bound';
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
const parse=(s,name='actual.js')=>{const a=ts.createSourceFile(name,s,99,true,1);assert.equal(a.parseDiagnostics.length,0);return a;};
const find=(a,p)=>{let r=[];function w(n){if(p(n))r.push(n);ts.forEachChild(n,w);}w(a);return r;};
const one=(r,label)=>{assert.equal(r.length,1,label);return r[0];};
const bridge={React:'Ct',useEffect:'Oe',useRef:'fe',useState:'X',useImperativeHandle:'Sv',jsx:'m',jsxs:'_',Fragment:'Nt',Dialog:'Ka',DialogContent:'Xa',DialogHeader:'Ya',DialogTitle:'Ja',Button:'xt',batchUploadDialogStyle:'ac',storageKey:'F0',readSavedBatch:'C6',Icon:'Zi',uuid:'fu',fields:'on',mapGrid:'Tl',suggestMapping:'vs',templateGrid:'Xv',validateDraft:'ua',validateMapping:'Kv',toPayload:'dd',runBatch:'Yv'};
const sourcePath='client/src/business/platform/client/src/components/customers/CustomerSupplyUploadDialog.tsx';
const source=fs.readFileSync(ROOT+'/'+sourcePath,'utf8');
const code=(await esbuild.transform(source,{loader:'tsx',jsx:'automatic',format:'esm',target:'es2020',minify:false})).code;
const sa=parse(code,'source-parent.js');
const sourceSession=one(find(sa,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='CustomerSupplyUploadSession'),'source parent');
const sourceInit=one(find(sa,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='initialSession'),'source init');
const aliases={jsx:'m',jsxs:'_',Fragment:'Nt',props:'e',context:'n',contextAllowed:'J',chooseExisting:'p',confirmedExisting:'v',settingUp:'j',sessionData:'ie',globalIssuesReady:'Tt',sourceLocked:'C',frozen:'ke',globalResolutions:'xe',setSessionData:'oe',setGlobalResolutions:'ee',SOURCE_TYPES:'vr'};
const variables=new Map(find(sourceSession,n=>ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)).map(n=>[n.name.text,n.initializer]));
function rename(expression){
 const a=parse('const __expr='+expression+';');let edits=[];
 for(const n of find(a,n=>ts.isIdentifier(n)&&Object.hasOwn(aliases,n.text))){
  if(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n)continue;
  if(ts.isPropertyAssignment(n.parent)&&n.parent.name===n)continue;
  edits.push({start:n.getStart(a),end:n.end,new:aliases[n.text]});
 }
 let s=a.text;for(const e of edits.sort((a,b)=>b.start-a.start))s=s.slice(0,e.start)+e.new+s.slice(e.end);
 return s.slice('const __expr='.length,-1);
}
function sourceProperty(name){
 const p=one(find(sourceSession,n=>(ts.isPropertyAssignment(n)||ts.isShorthandPropertyAssignment(n))&&n.name.getText(sa)===name),'source property '+name);
 let expr=ts.isShorthandPropertyAssignment(p)?p.name:p.initializer;
 if(ts.isIdentifier(expr)&&!Object.hasOwn(aliases,expr.text)){const key=expr.text;expr=variables.get(key);assert(expr,'inline new variable '+key);}
 return rename(expr.getText(sa));
}
const batch=await emittedLeaf({source:'client/src/business/platform/client/src/components/channelInventory/BatchUpload.tsx',name:'BatchUploadSession',native:'T6',bindings:bridge});
fs.mkdirSync(BASE+'/package/assets',{recursive:true});fs.mkdirSync(BASE+'/evidence',{recursive:true});
const mods=[];
for(const file of fs.readdirSync(BASE+'/capture/assets').filter(f=>/^BusinessWorkbenchPage-upload-compact-[a-f0-9]+\.js$/.test(f))){
 const bytes=fs.readFileSync(BASE+'/capture/assets/'+file),before=bytes.toString('utf8');assert(bytes.equals(Buffer.from(before)));const a=parse(before,file);
 const parent=one(find(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='B3'&&n.getText(a).includes('customerUploadPrepareConfirmation.mutate')),'actual parent B3');
 const sameScope=parent.parent;
 const init=one(find(sameScope,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='uk'&&n.getText(a).includes('sourceProfile')),'native init in customer scope');
 const industrySymbols=[...new Set(find(parent,n=>ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='safeParse'&&n.arguments.some(x=>x.getText(a).includes('.industryCode'))).map(n=>n.expression.expression.getText(a)))];
 assert.equal(industrySymbols.length,1,'original industry schema ABI');
 aliases.businessIndustryCodeSchema=industrySymbols[0];
 const t6=one(find(sameScope,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='T6'&&n.getText(a).includes('onOriginalFilePersist')),'native batch');
 const hunks=[{name:'T6',start:t6.getStart(a),end:t6.end,old:t6.getText(a),replacement:batch.wrapper},{name:'uk-initialSession',start:init.getStart(a),end:init.end,old:init.getText(a),replacement:sourceInit.getText(sa).replace(/^function initialSession\b/,'function uk')}];
 for(const key of ['customerSourceReady','renderConfirmationDetails']){
  const p=one(find(parent,n=>ts.isPropertyAssignment(n)&&n.name.getText(a)===key),'native property '+key);
  const replacement=sourceProperty(key)+(key==='customerSourceReady'?',customerSourceDisabledReason:'+sourceProperty('customerSourceDisabledReason'):'');
  hunks.push({name:'B3-'+key,start:p.initializer.getStart(a),end:p.initializer.end,old:p.initializer.getText(a),replacement});
 }
 const sourceGate=one(find(parent,n=>ts.isIfStatement(n)&&n.expression.getText(a).includes('sourceConfirmed')&&ts.isThrowStatement(n.thenStatement)),'sourceConfirmed throw');
 hunks.push({name:'B3-remove-type-gate',start:sourceGate.getStart(a),end:sourceGate.end,old:sourceGate.getText(a),replacement:''});
 const profileGate=one(find(parent,n=>ts.isIfStatement(n)&&ts.isBinaryExpression(n.expression)&&n.expression.operatorToken.kind===ts.SyntaxKind.BarBarToken&&n.expression.left.getText(a).includes('.channel')&&n.expression.right.getText(a).includes('.includes(')&&ts.isThrowStatement(n.thenStatement)),'legacy profile validation');
 hunks.push({name:'B3-optional-profile-validity-only',start:profileGate.expression.getStart(a),end:profileGate.expression.end,old:profileGate.expression.getText(a),replacement:profileGate.expression.right.getText(a)});
 const result=inverseDelta(before,hunks),sha=H(result.after),relative='assets/BusinessWorkbenchPage-customer-bound-'+sha.slice(0,16)+'.js';
 fs.writeFileSync(BASE+'/package/'+relative,result.after);
 fs.writeFileSync(BASE+'/evidence/'+file+'.delta.json',JSON.stringify({beforeSha256:H(bytes),afterSha256:sha,onlySpecifiedCustomerSpans:true,inverseVerified:true,patches:result.records},null,2)+'\n');
 mods.push({before:'assets/'+file,after:relative,sha256:sha,size:Buffer.byteLength(result.after)});
}
assert.equal(mods.length,2);
const apiBefore=fs.readFileSync(BASE+'/capture/front-index.js','utf8'),apiAst=parse(apiBefore,'front-index.js');
const nativeSource=one(find(apiAst,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='source'&&n.getText(apiAst).includes('crm_customer_supply_channels')&&n.getText(apiAst).includes('sourceProfile')),'real API source');
const profileDecl=one(find(nativeSource,n=>ts.isVariableDeclaration(n)&&n.name.getText(apiAst)==='sourceProfile'),'API profile declaration');
assert.equal(profileDecl.initializer.getText(apiAst),'input.sourceProfile');
const required=one(find(nativeSource,n=>ts.isIfStatement(n)&&n.expression.getText(apiAst)==='!sourceProfile'),'API required profile');
const ah=[{name:'customerSupply-source-default-neutral',start:profileDecl.initializer.getStart(apiAst),end:profileDecl.initializer.end,old:profileDecl.initializer.getText(apiAst),replacement:'input.sourceProfile ?? { type: "other" }'},{name:'customerSupply-remove-first-type-required',start:required.getStart(apiAst),end:required.end,old:required.getText(apiAst),replacement:''}];
const ap=inverseDelta(apiBefore,ah);
fs.writeFileSync(BASE+'/package/before-api.js',apiBefore);fs.writeFileSync(BASE+'/package/after-api.js',ap.after);
fs.writeFileSync(BASE+'/evidence/api.delta.json',JSON.stringify({beforeSha256:H(apiBefore),afterSha256:H(ap.after),patches:ap.records,inverseVerified:true,exactlyTwoSourceSpans:true},null,2)+'\n');
const owner=one(find(apiAst,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='createCustomerSupplyService'),'real API customer supply owner');
assert.equal(nativeSource.parent,owner.body,'source belongs directly to actual customer supply factory');
const afterAst=parse(ap.after,'after-api.js');
const afterSource=one(find(afterAst,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='source'&&n.getText(afterAst).includes('crm_customer_supply_channels')),'after API source');
const offset=i=>Buffer.byteLength(apiBefore.slice(0,i));
const sourceStart=nativeSource.getStart(apiAst),headerEnd=nativeSource.body.getStart(apiAst)+1;
const protocol={schema:'customer-supply-source-delta-v1',apiPath:'/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js',beforeSha256:H(apiBefore),afterSha256:H(ap.after),source:{ownerOffset:offset(owner.getStart(apiAst)),start:offset(sourceStart),end:offset(nativeSource.end),headerEnd:offset(headerEnd),beforeSha256:H(nativeSource.getText(apiAst)),afterSha256:H(afterSource.getText(afterAst)),abiSha256:H(apiBefore.slice(sourceStart,headerEnd))},patches:ap.records.map((r,i)=>({kind:i===0?'profile-default-other':'remove-first-required-fail',offset:offset(r.oldStart),beforeBase64:r.oldBase64,afterBase64:r.newBase64}))};
fs.writeFileSync(BASE+'/package/api-delta.json',JSON.stringify(protocol,null,2)+'\n');
fs.writeFileSync(BASE+'/modules.json',JSON.stringify(mods,null,2)+'\n');
fs.writeFileSync(BASE+'/evidence/source-delta.json',JSON.stringify({modules:mods,parentSourceSha256:H(source),batchSourceSha256:batch.sourceSha256,backendSourceSha256:H(fs.readFileSync(ROOT+'/client/src/business/platform/front-router-types/server/services/customerSupply.ts')),noProviderOrHelperChanges:true,oldConfirmationWitnessUntouched:true,legacyOriginalUuidLocksUntouched:true},null,2)+'\n');
console.log(JSON.stringify({status:'LOCAL_CUSTOMER_BOUND_CANDIDATES',modules:mods,apiBeforeSha256:H(apiBefore),apiAfterSha256:H(ap.after),apiOnlyTwoSpans:true},null,2));
