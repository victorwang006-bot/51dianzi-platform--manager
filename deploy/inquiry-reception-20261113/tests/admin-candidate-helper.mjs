import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
export const OUT=process.env.ADMIN_CANDIDATE_OUT||'/home/ubuntu/task-recovery/inquiry-reception-release-20261113/admin-static';
export const LIVE='/home/ubuntu/task-recovery/inquiry-reception-release-20261113/live/admin-static';
export const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
export const read=f=>fs.readFileSync(f,'utf8');
export const json=f=>JSON.parse(read(f));
export const write=(f,x)=>fs.writeFileSync(OUT+'/'+f,typeof x==='string'?x:JSON.stringify(x,null,2)+'\n');
export function tree(text,name='candidate.js') {
 const host=ts.createCompilerHost({allowJs:true,noResolve:true,noLib:true});
 host.getSourceFile=(f,v)=>f===name?ts.createSourceFile(f,text,v,true,ts.ScriptKind.JS):undefined;
 host.fileExists=f=>f===name;host.readFile=f=>f===name?text:undefined;
 const program=ts.createProgram([name],{allowJs:true,noResolve:true,noLib:true},host),ast=program.getSourceFile(name),checker=program.getTypeChecker();
 const declarations=new Map(),imports=new Map();
 for(const n of ast.statements){
  if(ts.isImportDeclaration(n)) {const spec=n.moduleSpecifier.text;const ic=n.importClause;if(ic?.name)imports.set(ic.name.text,{spec,export:'default'});for(const x of ic?.namedBindings?.elements??[])imports.set(x.name.text,{spec,export:x.propertyName?.text??x.name.text});continue;}
  if((ts.isFunctionDeclaration(n)||ts.isClassDeclaration(n))&&n.name)declarations.set(n.name.text,n);
  if(ts.isVariableStatement(n))for(const d of n.declarationList.declarations)if(ts.isIdentifier(d.name))declarations.set(d.name.text,d);
 }
 return {ast,checker,declarations,imports};
}
// Dependency selection uses TypeScript's lexical symbol resolver, not substring guesses.
export function sliceActual(text,seeds,overrides={},name='candidate.js'){
 const t=tree(text,name), selected=new Set(),need=new Set(),todo=[...seeds];
 while(todo.length){const key=todo.pop();if(Object.hasOwn(overrides,key)){need.add(key);continue;}if(selected.has(key))continue;
  const decl=t.declarations.get(key);if(!decl)throw Error('DI_UNBOUND_ACTUAL_LEXICAL:'+key+':'+name);selected.add(key);
  function visit(n){if(ts.isIdentifier(n)){const sym=t.checker.getSymbolAtLocation(n);for(const d of sym?.declarations??[]){if(ts.isImportSpecifier(d)){const k=d.name.text;if(Object.hasOwn(overrides,k))need.add(k);else throw Error('DI_UNBOUND_IMPORT:'+k+':'+name);}else if(ts.isImportClause(d)){const k=d.name?.text;if(Object.hasOwn(overrides,k))need.add(k);else throw Error('DI_UNBOUND_IMPORT:'+k+':'+name);}else if(t.declarations.get(d.name?.text)===d)todo.push(d.name.text);}}n.forEachChild(visit);}visit(decl);
 }
 const ordered=[...selected].map(k=>t.declarations.get(k)).sort((a,b)=>a.pos-b.pos);
 const snippets=ordered.map(n=>ts.isVariableDeclaration(n)?`${n.parent.flags&ts.NodeFlags.Const?'const':n.parent.flags&ts.NodeFlags.Let?'let':'var'} ${n.getText(t.ast)};`:n.getText(t.ast).replace(/^export\s+(default\s+)?/,''));
 const code=snippets.join('\n')+'\n;globalThis.__actual={'+seeds.map(k=>JSON.stringify(k)+':'+k).join(',')+'};';
 const context=vm.createContext({...globalThis,console,setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask,AbortController,AbortSignal,URL,URLSearchParams,DOMException,TextEncoder,TextDecoder,window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator,localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage,Event:globalThis.Event,FileReader:globalThis.FileReader,File:globalThis.File,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame,...overrides});
 vm.runInContext(code,context,{filename:name,timeout:30000});
 return {exports:context.__actual,context,proof:{name,sourceSha256:sha(text),selectedDeclarations:[...selected],injectedLexicals:[...need],sliceSha256:sha(code)},code};
}
export function nodes(ast,p){const out=[];function visit(n){if(p(n))out.push(n);n.forEachChild(visit);}visit(ast);return out;}
