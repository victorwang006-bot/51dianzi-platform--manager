import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as drizzle from 'drizzle-orm';
import * as core from 'drizzle-orm/mysql-core';
import * as crypto from 'node:crypto';
import * as zod from 'zod';
import * as trpc from '@trpc/server';
const require=createRequire('/home/ubuntu/work/51dianzi-platform/package.json');
const ts=require('typescript');
const allowed={'drizzle-orm':drizzle,'drizzle-orm/mysql-core':core,'node:crypto':crypto,'crypto':crypto,'zod':zod,'@trpc/server':trpc};
/** Never evaluates a bundle prefix, import, startup, init_schema(), server or poller.
 * Select only named declarations plus pure lexical dependencies. The schema assignment
 * statements come from the frozen native init_schema block, not recompiled source.
 * getDb and every DB executor must be explicitly injected by the harness. */
export function candidateABI(file,names,injected={},procedure=null) {
 const text=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 if(ast.parseDiagnostics.length)throw Error('candidate parse failed');
 const defs=new Map(),imports=new Map();
 for(const n of ast.statements){
  if(ts.isImportDeclaration(n)){
   const pkg=n.moduleSpecifier.text,cl=n.importClause;
   if(cl?.name)imports.set(cl.name.text,{pkg,key:'default'});
   if(cl?.namedBindings&&ts.isNamedImports(cl.namedBindings))for(const i of cl.namedBindings.elements)imports.set(i.name.text,{pkg,key:i.propertyName?.text??i.name.text});
   if(cl?.namedBindings&&ts.isNamespaceImport(cl.namedBindings))imports.set(cl.namedBindings.name.text,{pkg,key:'*'});
  }
  if((ts.isFunctionDeclaration(n)||ts.isClassDeclaration(n))&&n.name)defs.set(n.name.text,{node:n,code:text.slice(n.getStart(),n.end),offset:n.getStart()});
  if(ts.isVariableStatement(n))for(const d of n.declarationList.declarations)if(ts.isIdentifier(d.name)&&d.initializer){defs.set(d.name.text,{node:d,code:'var '+text.slice(d.getStart(),d.end)+';',offset:d.getStart()});
   if(ts.isCallExpression(d.initializer)&&d.initializer.expression.text==='__esm'){
    const obj=d.initializer.arguments?.[0];const method=obj?.properties?.find(x=>ts.isMethodDeclaration(x));
    if(!method)throw Error('native pure assignment block ABI');
    for(const s of method.body.statements)if(ts.isExpressionStatement(s)&&ts.isBinaryExpression(s.expression)&&ts.isIdentifier(s.expression.left)){
     const k=s.expression.left.text;defs.set(k,{node:s,code:'var '+text.slice(s.getStart(),s.end),offset:s.getStart()});
    }
   }
  }
 }
 if(procedure){
  const router=defs.get(procedure.router)?.node?.initializer;
  const obj=router?.arguments?.[0],props=obj?.properties?.filter(p=>p.name?.text===procedure.property);
  if(props?.length!==1||!props[0].initializer)throw Error('exact procedure ABI');
  const n=props[0].initializer;defs.set('__offlineSelectedProcedure',{node:n,code:'var __offlineSelectedProcedure = '+text.slice(n.getStart(),n.end)+';',offset:n.getStart()});
 }
 const context={console,Buffer,URL,TextEncoder,TextDecoder,process:{env:{},cwd:()=>{throw Error('cwd forbidden')}},...injected};
 const selected=new Map();
 function add(name){
  if(Object.hasOwn(context,name)||selected.has(name))return;
  if(imports.has(name)){const {pkg,key}=imports.get(name),mod=allowed[pkg];if(!mod)throw Error('unsafe external dependency denied: '+name+' from '+pkg);context[name]=key==='*'?mod:key==='default'?(mod.default??mod):mod[key];return;}
  const def=defs.get(name);if(!def)return;
  if(/^(init_|start|main$|getDb$)/.test(name))throw Error('unsafe initializer denied: '+name);
  selected.set(name,def);
  const locals=new Set();
  function binding(n){if(ts.isIdentifier(n))locals.add(n.text);else if(ts.isObjectBindingPattern(n)||ts.isArrayBindingPattern(n))for(const e of n.elements)if(e.name)binding(e.name)}
  function collect(n){if(ts.isParameter(n)||ts.isVariableDeclaration(n)&&n!==def.node)binding(n.name);ts.forEachChild(n,collect)}collect(def.node);
  function visit(n){if(ts.isIdentifier(n)){
   const p=n.parent,property=ts.isPropertyAccessExpression(p)&&p.name===n||(ts.isPropertyAssignment(p)||ts.isMethodDeclaration(p)||ts.isPropertyDeclaration(p))&&p.name===n;
   const declaration=(ts.isVariableDeclaration(p)||ts.isParameter(p)||ts.isFunctionDeclaration(p)||ts.isClassDeclaration(p))&&p.name===n;
   if(!property&&!declaration&&!locals.has(n.text))add(n.text);
  }ts.forEachChild(n,visit)}visit(def.node);
 }
 names.forEach(add);
 const ordered=[...selected.entries()].sort((a,b)=>a[1].offset-b[1].offset);
 const code=ordered.map(([,d])=>d.code).join('\n')+'\n({'+names.join(',')+'})';
 const value=new vm.Script(code,{filename:file+':selected-native-ABI'}).runInNewContext(context,{timeout:3000});
 return {value,selected:ordered.map(([name,d])=>({name,offset:d.offset,bytes:d.code.length})),text,ast};
}
export function exactCandidateFunction(file,name,injected) {return candidateABI(file,[name],injected).value[name]}
export function exactWorkerHook(file,functionName) {
 const text=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===functionName);if(!fn)throw Error('worker function ABI');
 const matches=[];function visit(n){if(ts.isExpressionStatement(n)&&text.slice(n.getStart(),n.end).startsWith('await __mallNative20261116.invalidateMallInventoryConfirmation'))matches.push(n);ts.forEachChild(n,visit)}visit(fn);
 if(matches.length!==1)throw Error('worker hook ABI '+functionName);
 const node=matches[0],statement=text.slice(node.getStart(),node.end);
 const parents=[];for(let p=node.parent;p&&p!==fn;p=p.parent)if(ts.isIfStatement(p))parents.push(text.slice(p.expression.getStart(),p.expression.end));
 return {statement,guards:parents,run:(vars)=>new vm.Script('(async()=>{'+statement+'})()').runInNewContext(vars,{timeout:1000})};
}
