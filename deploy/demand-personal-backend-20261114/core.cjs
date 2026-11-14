'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const ts = require('typescript');
const path = require('node:path');
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const assert = (v, m) => { if (!v) throw new Error(m); };
const read = f => fs.readFileSync(f, 'utf8');
const walk = (n, fn) => { fn(n); ts.forEachChild(n, c => walk(c, fn)); };
const BUILTINS = new Set('undefined Array Boolean Date Error JSON Map Math Number Object Promise RegExp Set String Symbol BigInt Buffer console process URL Uint8Array parseInt parseFloat isNaN Infinity NaN globalThis'.split(' '));
function isRef(n) {
 const p=n.parent;
 if(ts.isPropertyAccessExpression(p)&&p.name===n)return false;
 if((ts.isPropertyAssignment(p)||ts.isMethodDeclaration(p)||ts.isPropertyDeclaration(p))&&p.name===n&&!ts.isComputedPropertyName(p.name))return false;
 if((ts.isVariableDeclaration(p)||ts.isParameter(p)||ts.isFunctionDeclaration(p)||ts.isFunctionExpression(p)||ts.isClassDeclaration(p)||ts.isBindingElement(p))&&p.name===n)return false;
 if(ts.isBindingElement(p)&&p.propertyName===n)return false;
 if(ts.isImportSpecifier(p)||ts.isImportClause(p)||ts.isNamespaceImport(p)||ts.isExportSpecifier(p))return false;
 return true;
}
function parse(file,text=read(file),moduleOverride) {
 const opts={allowJs:true,noLib:true,noResolve:true,target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext};
 const sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),host=ts.createCompilerHost(opts);
 host.getSourceFile=f=>f===file?sf:undefined;
 const checker=ts.createProgram([file],opts,host).getTypeChecker();
 assert(!sf.parseDiagnostics.length,'AST_PARSE '+file);
 const mods=[...text.matchAll(/^\/\/ ([^\r\n]+(?:\.ts|\.tsx|\.js|\.json))\r?$/gm)].map(m=>({pos:m.index,module:m[1]}));
 function moduleAt(n){if(moduleOverride)return moduleOverride;let lo=0,hi=mods.length;while(lo<hi){const mid=(lo+hi)>>>1;if(mods[mid].pos<=n.getStart(sf))lo=mid+1;else hi=mid;}return mods[lo-1]?.module;}
 const decls=[];
 const add=(node,name,extra={})=>{if(ts.isIdentifier(name))decls.push({node,name:name.text,module:moduleAt(node),symbol:checker.getSymbolAtLocation(name),...extra});};
 for(const s of sf.statements){
  if((ts.isFunctionDeclaration(s)||ts.isClassDeclaration(s))&&s.name)add(s,s.name);
  if(ts.isVariableStatement(s))for(const d of s.declarationList.declarations)add(d,d.name);
  if(ts.isImportDeclaration(s)){const c=s.importClause,pkg=s.moduleSpecifier.text;if(c?.name)add(c,c.name,{import:pkg,exported:'default'});const b=c?.namedBindings;if(b){if(ts.isNamespaceImport(b))add(b,b.name,{import:pkg,exported:'*'});else for(const n of b.elements)add(n,n.name,{import:pkg,exported:n.propertyName?.text||n.name.text});}}
 }
 const symbols=new Map(decls.filter(d=>d.symbol).map(d=>[d.symbol,d]));
 const symbolAt=n=>ts.isShorthandPropertyAssignment(n.parent)&&n.parent.name===n?checker.getShorthandAssignmentValueSymbol(n.parent):checker.getSymbolAtLocation(n);
 const byName=name=>{const a=decls.filter(d=>d.name===name);assert(a.length===1,'NONUNIQUE_GLOBAL '+name+' '+a.length);return a[0];};
 return {file,text,sf,checker,decls,symbols,symbolAt,byName,moduleAt};
}
function uniqueNode(owner,predicate,label){const found=[];walk(owner,n=>{if(predicate(n))found.push(n);});assert(found.length===1,'UNIQUE_SLOT '+label+' count='+found.length);return found[0];}
function method(p,owner,name){return uniqueNode(p.byName(owner).node,n=>ts.isMethodDeclaration(n)&&n.name?.text===name,owner+'.'+name);}
function property(p,owner,name){return uniqueNode(p.byName(owner).node,n=>ts.isPropertyAssignment(n)&&n.name?.text===name,owner+'.'+name);}
function variable(p,owner,name){return uniqueNode(p.byName(owner).node,n=>ts.isVariableDeclaration(n)&&n.name?.text===name,owner+'.'+name);}
function refs(p,node){const out=new Map();walk(node,n=>{if(!ts.isIdentifier(n)||!isRef(n))return;const d=p.symbols.get(p.symbolAt(n));if(d)out.set(d.name,d);});return [...out.values()];}
const moduleName=f=>f.replace(/^client\/src\/business\/platform\/front-router-types\//,'').replace(/^client\/src\/business\/platform\/shared\//,'shared/');
const baseName=n=>n.replace(/\d+$/,'');
function createMapper(old,ref,repo,added=[],contextOwners=[]){
 const bindings=new Map(),contextRefs=contextOwners.flatMap(n=>refs(old,old.byName(n).node));
 function resolve(d){if(bindings.has(d.symbol))return bindings.get(d.symbol);let matches=[],rule,expectedModule,exported=d.exported||d.name;
  if(added.includes(d.name)){assert(!old.decls.some(o=>o.name===d.name),'NEW_COLLISION '+d.name);const b={source:d,runtimeName:d.name,rule:'allowlisted-new',new:true};bindings.set(d.symbol,b);return b;}
  if(d.import?.startsWith('.'))expectedModule=moduleName(path.relative(repo,path.resolve(path.dirname(ref.sourceFile),d.import+'.ts')));
  else if(!d.import)expectedModule=ref.module;
  const spelling=o=>baseName(o.name)===exported||o.name.endsWith('_'+exported)||o.name.endsWith('_namespace_'+d.name);
  if(d.import&&!d.import.startsWith('.')){
   matches=contextRefs.filter(o=>(o.import===d.import&&o.exported===d.exported)||o.name.endsWith('_import_'+exported));rule='owner-native-external';
   if(!matches.length){matches=old.decls.filter(o=>o.import===d.import&&o.exported===d.exported&&o.module===ref.module);rule='same-module-external';}
   if(!matches.length){matches=old.decls.filter(o=>o.import===d.import&&o.exported===d.exported);rule='exact-external-export';}
  }else{
   matches=old.decls.filter(o=>o.module===expectedModule&&spelling(o));rule='module-export';
   if(!matches.length){matches=contextRefs.filter(spelling);rule='native-owner-export';}
   if(!matches.length&&d.exported==='*'){matches=contextRefs.filter(o=>o.name.endsWith('_namespace_'+d.name));rule='native-owner-namespace';}
  }
  matches=[...new Map(matches.map(o=>[o.name,o])).values()];
  assert(matches.length===1,'UNMAPPED_OR_AMBIGUOUS '+ref.module+' '+d.name+' '+expectedModule+' '+matches.map(o=>o.name));
  const target=matches[0],b={source:d,target,runtimeName:target.name,rule};bindings.set(d.symbol,b);return b;
 }
 function extract(node,{locals={},renameDeclaration=false}={}){
  const start=node.getStart(ref.sf),end=node.end,edits=[],used=new Map(),sites=[];
  walk(node,n=>{if(!ts.isIdentifier(n))return;const s=ref.symbolAt(n),d=ref.symbols.get(s);
   if(renameDeclaration&&n===node.name){const b=resolve(ref.byName(n.text));if(b.runtimeName!==n.text)edits.push({start:n.getStart(ref.sf),end:n.end,text:b.runtimeName});}
   if(!isRef(n))return;
   if(d){if(d.node.getStart(ref.sf)>=start&&d.node.end<=end)return;const b=resolve(d);used.set(d.name,b);const value=b.runtimeName;sites.push({sourceName:d.name,runtimeName:value,sourceOffset:n.getStart(ref.sf)-start});if(value!==n.text)edits.push({start:n.getStart(ref.sf),end:n.end,text:ts.isShorthandPropertyAssignment(n.parent)?n.text+': '+value:value});}
   else if(s){const ds=s.declarations||[];if(ds.every(d=>d.getStart(ref.sf)>=start&&d.end<=end))return;assert(Object.hasOwn(locals,n.text),'OUTSIDE_LOCAL '+n.text);const value=locals[n.text];if(value!==n.text)edits.push({start:n.getStart(ref.sf),end:n.end,text:value});}
   else assert(BUILTINS.has(n.text),'UNBOUND_SOURCE '+n.text);
  });
  let text=ref.text.slice(start,end);for(const e of edits.sort((a,b)=>b.start-a.start))text=text.slice(0,e.start-start)+e.text+text.slice(e.end-start);
  return {text,referenceStart:start,referenceEnd:end,identifierOnlyEdits:edits,bindings:[...used.values()].map(b=>({sourceName:b.source.name,sourceModule:b.source.module,import:b.source.import,exported:b.source.exported,runtimeName:b.runtimeName,runtimeModule:b.target?.module,rule:b.rule,new:!!b.new})),sites};
 }
 return {resolve,extract,bindings};
}
function applyPatches(old,patches){
 patches.sort((a,b)=>a.start-b.start);let text='',cursor=0;const manifest=[];
 for(const p of patches){assert(p.start>=cursor&&p.end>=p.start,'OVERLAP '+p.name);const oldText=old.slice(p.start,p.end);text+=old.slice(cursor,p.start);const newStart=text.length;text+=p.text;manifest.push({name:p.name,start:p.start,end:p.end,newStart,newEnd:text.length,oldSha256:sha(oldText),newSha256:sha(p.text),oldByteStart:Buffer.byteLength(old.slice(0,p.start)),oldByteEnd:Buffer.byteLength(old.slice(0,p.end)),newByteStart:Buffer.byteLength(text.slice(0,newStart)),newByteEnd:Buffer.byteLength(text),source:p.source});cursor=p.end;}
 text+=old.slice(cursor);let restored=text;for(let i=manifest.length-1;i>=0;i--){const p=manifest[i];assert(sha(restored.slice(p.newStart,p.newEnd))===p.newSha256,'CANDIDATE_PATCH_HASH');restored=restored.slice(0,p.newStart)+old.slice(p.start,p.end)+restored.slice(p.newEnd);}
 assert(Buffer.from(restored).equals(Buffer.from(old)),'BYTE_INVERSE_FAILED');
 let unchangedBytes=0,oldAt=0,newAt=0;for(const p of manifest){const a=old.slice(oldAt,p.start),b=text.slice(newAt,p.newStart);assert(a===b,'UNCHANGED_REGION_DRIFT');unchangedBytes+=Buffer.byteLength(a);oldAt=p.end;newAt=p.newEnd;}assert(old.slice(oldAt)===text.slice(newAt),'UNCHANGED_TAIL_DRIFT');unchangedBytes+=Buffer.byteLength(old.slice(oldAt));
 return {text,manifest,inverse:{byteExact:true,sha256:sha(restored),unchangedBytes,allOutsideSlotsByteIdentical:true}};
}
module.exports={fs,ts,path,sha,assert,read,walk,parse,uniqueNode,method,property,variable,refs,createMapper,applyPatches,moduleName};
