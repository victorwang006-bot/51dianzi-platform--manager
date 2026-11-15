#!/usr/bin/env node
'use strict';
// Static parse/binding and pure synthetic fragment fixtures only. No bundle execution,
// production/native session claims, HTTP, DB, reload, SSH, application edits or Git.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),crypto=require('crypto'),vm=require('node:vm');
const REPO='/home/ubuntu/work/51dianzi-platform--manager',ts=require(REPO+'/node_modules/typescript');
const {sql}=require(REPO+'/node_modules/drizzle-orm'),{MySqlDialect}=require(REPO+'/node_modules/drizzle-orm/mysql-core'),{z}=require(REPO+'/node_modules/zod');
const D=__dirname,E=D+'/backend-compile-evidence-final',O=D+'/backend-patches-final',SOURCE='/home/ubuntu/work/manual-reference-edit-20261115/source-final';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),json=p=>JSON.parse(fs.readFileSync(p));
const result=json(E+'/build-result.json'),records=[];
function nodes(root,p){const r=[];function w(n){if(p(n))r.push(n);ts.forEachChild(n,w);}w(root);return r;}
function one(a,label){assert.equal(a.length,1,label);return a[0];}
function program(text){const f='/__actual_patched_api__.js',options={allowJs:true,checkJs:false,noResolve:true,noLib:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext};const a=ts.createSourceFile(f,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(a.parseDiagnostics.length,0);const h=ts.createCompilerHost(options);h.getSourceFile=n=>n===f?a:undefined;h.readFile=n=>n===f?text:undefined;h.fileExists=n=>n===f;h.writeFile=()=>{};const p=ts.createProgram([f],options,h);return {a,c:p.getTypeChecker()};}
const globals=new Set(['Array','Set','Map','Number','Object','String','Error','undefined']);
for(const kind of ['front','admin']){
 const bytes=fs.readFileSync(O+'/patched-'+kind+'-index.js'),proof=json(O+'/'+kind+'-patchproof.json');assert.equal(sha(bytes),proof.afterSha256);assert.equal(proof.status,'await_parent_review');assert.equal(proof.approved,false);const {a,c}=program(bytes.toString('utf8'));const checks=[];
 const importSymbol=(name)=>{const spec=one(nodes(a,n=>ts.isImportSpecifier(n)&&n.name.text===name),'actual import '+name);return c.getSymbolAtLocation(spec.name);};
 const zName=proof.lexicalMapping.z.nativeName,zSymbol=importSymbol(zName);const schema=one(a.statements.filter(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(a)==='teamMaterialPublicUpdateFields')),'actual schema');
 for(const field of ['manualReferenceLcsc','manualReferenceIckey']){const prop=one(nodes(schema,n=>ts.isPropertyAssignment(n)&&n.name.getText(a)===field),'actual manual field');for(const n of nodes(prop,x=>ts.isIdentifier(x)&&x.text===zName))assert.equal(c.getSymbolAtLocation(n),zSymbol,'manual schema native Zod binding');checks.push(field+' binds '+zName);}
 if(kind==='front'){
  const sqlName=proof.lexicalMapping.sql.nativeName,sqlSymbol=importSymbol(sqlName);const err=one(a.statements.filter(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(a)==='ChannelInventoryError')),'actual error class').declarationList.declarations[0];const errSymbol=c.getSymbolAtLocation(err.name);
  for(const name of result.reports.front.addedOwners.map(x=>x.name)){const fn=one(a.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name.text===name),'actual added helper');let sqlCount=0,errorCount=0;for(const id of nodes(fn,ts.isIdentifier)){if(id.text===sqlName){assert.equal(c.getSymbolAtLocation(id),sqlSymbol);sqlCount++;}if(id.text==='ChannelInventoryError'){assert.equal(c.getSymbolAtLocation(id),errSymbol);errorCount++;}}checks.push({helper:name,sqlBinding:sqlCount,errorBinding:errorCount});}
  // Check the exact inserted ranges in the actual bundle, including tx/scope/row/
  // updated/input/items and the newly declared manualReferences. A reference must
  // bind to an existing/new AST declaration, not an accidental unresolved alias.
  let charShift=0;for(const s of proof.spans){const start=s.start+charShift,end=start+s.inserted.length;let count=0;for(const id of nodes(a,n=>ts.isIdentifier(n)&&n.getStart(a)>=start&&n.end<=end)){
   const parent=id.parent;if(ts.isPropertyAccessExpression(parent)&&parent.name===id||ts.isPropertyAssignment(parent)&&parent.name===id)continue;
   if(globals.has(id.text))continue;const sym=c.getSymbolAtLocation(id);assert(sym&&sym.declarations?.length,'inserted identifier resolves '+s.id+':'+id.text);count++;
  }checks.push({span:s.id,resolvedIdentifierCount:count});charShift+=s.inserted.length-(s.end-s.start);}
 }
 records.push({kind,wholeSyntax:true,checks});
}
for(const [n,h]of Object.entries(result.sourceHashes)){assert.equal(sha(fs.readFileSync(path.join(SOURCE,n))),h,'final frozen source exact '+n);assert.equal(sha(fs.readFileSync(path.join(E,'source-snapshot',n))),h);}
// Evaluate ONLY newly generated transform fragments with synthetic dependencies.
// The acquired bundles are parsed, never evaluated/imported.
const fragment=fs.readFileSync(E+'/fragments/front-manual-sql-helpers.js','utf8');class SyntheticError extends Error{constructor(code,message){super(message);this.code=code;}}
const context=vm.createContext({sql86:sql,ChannelInventoryError:SyntheticError});vm.runInContext(fragment,context);let fixtureChecks=0;
function ok(f){f();fixtureChecks++;}
async function fixtures(){
 const precise='999999999999999.123456789012';ok(()=>assert.equal(context.channelInventoryManualReferenceValuesFrom({manualReferenceLcsc:precise}).manualReferenceLcsc,precise));ok(()=>assert.equal(context.channelInventoryManualReferenceValuesFrom({manualReferenceLcsc:'0'}).manualReferenceLcsc,'0'));ok(()=>assert.equal(context.channelInventoryManualReferenceValuesFrom({}).manualReferenceIckey,null));
 for(const bad of [1,-1,'-0','01','1e3','1.1234567890123'])ok(()=>assert.throws(()=>context.channelInventoryManualReferenceValuesFrom({manualReferenceLcsc:bad})));
 const queries=[],scope={enterpriseId:1,dataOwnerUserId:99,actorUserId:202,officialActor:{adminAccountId:303}},dialect=new MySqlDialect();const tx={execute:async q=>{const c=dialect.sqlToQuery(q);queries.push(c);return [[{materialId:101,manualReferenceLcsc:precise,manualReferenceIckey:null}],[]];}};
 assert.equal((await context.readChannelInventoryManualReferences(tx,scope,[])).size,0);fixtureChecks++;assert.equal(queries.length,0);fixtureChecks++;
 const read=await context.readChannelInventoryManualReferences(tx,scope,[101,101]);assert.equal(read.get(101).manualReferenceLcsc,precise);fixtureChecks++;assert.deepEqual(queries[0].params,[1,99,101]);fixtureChecks++;assert(/FOR UPDATE$/.test(queries[0].sql));fixtureChecks++;
 await assert.rejects(context.readChannelInventoryManualReferences(tx,scope,[0]));fixtureChecks++;
 queries.length=0;await context.upsertChannelInventoryManualReferences(tx,scope,101,{});assert.equal(queries.length,0);fixtureChecks++;
 await context.upsertChannelInventoryManualReferences(tx,scope,101,{manualReferenceLcsc:null});assert.deepEqual(queries[0].params,[1,99,101,null,null,202,303]);fixtureChecks++;const dup=queries[0].sql.split('ON DUPLICATE KEY UPDATE')[1];assert(dup.includes('manualReferenceLcsc = VALUES')&&!dup.includes('manualReferenceIckey = VALUES'));fixtureChecks++;
 for(const kind of ['front','admin']){const map=result.reports[kind],code=fs.readFileSync(E+'/fragments/'+kind+'-schema-manual-two-prices.js','utf8');const alias=kind==='front'?'z59':'z6',ctx=vm.createContext({[alias]:z});vm.runInContext('var fields={'+code+'};',ctx);for(const field of ['manualReferenceLcsc','manualReferenceIckey']){const sch=ctx.fields[field];for(const value of [undefined,null,'0',' 1.2300 ',precise]){assert(sch.safeParse(value).success);fixtureChecks++;}for(const value of [1,'-1','01','1e3','.5','1.']){assert(!sch.safeParse(value).success);fixtureChecks++;}}}
 const r={status:'PASS',fixtureOnly:true,actualPatchedBundlesParsedOnly:true,wholeBundleExecution:false,sourceFinalExactlyMatches:true,sourceHashes:result.sourceHashes,lexicalBindingChecks:records,syntheticFragmentChecks:fixtureChecks,productionExecuted:false};fs.writeFileSync(E+'/native-static-and-fragment-qa.json',JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify(r,null,2));
}
fixtures().catch(e=>{console.error(e.stack);process.exitCode=1;});
