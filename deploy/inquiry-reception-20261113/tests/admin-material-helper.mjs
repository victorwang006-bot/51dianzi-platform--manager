import vm from 'node:vm';
import ts from 'typescript';
import {tree,nodes,sha} from './admin-candidate-helper.mjs';
// Extract declarations from the actual nested Host module lexical scope. Only the
// proven existing runtime aliases are DI cutoffs; management helpers and UI stay actual.
export function sliceMaterialHost(text,seeds,overrides={},name='actual-material-host.js'){
 const t=tree(text,name),getter=nodes(t.ast,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='__d51_material_host_get');
 if(getter.length!==1)throw Error('ONE_ACTUAL_MATERIAL_HOST_GETTER:'+getter.length);
 const scope=getter[0].parent,declarations=new Map();
 for(const n of scope.statements){if((ts.isFunctionDeclaration(n)||ts.isClassDeclaration(n))&&n.name)declarations.set(n.name.text,n);if(ts.isVariableStatement(n))for(const d of n.declarationList.declarations)if(ts.isIdentifier(d.name))declarations.set(d.name.text,d);}
 const selected=new Set(),injected=new Set(),todo=[...seeds];
 while(todo.length){const k=todo.pop();if(Object.hasOwn(overrides,k)){injected.add(k);continue;}if(selected.has(k))continue;const decl=declarations.get(k);if(!decl)throw Error('ACTUAL_HOST_UNBOUND:'+k);selected.add(k);
  function visit(n){if(ts.isIdentifier(n)){const sym=t.checker.getSymbolAtLocation(n);for(const d of sym?.declarations??[]){const key=d.name?.text;if(declarations.get(key)===d){if(Object.hasOwn(overrides,key))injected.add(key);else todo.push(key);}else if(ts.isImportSpecifier(d)||ts.isImportClause(d)){if(!Object.hasOwn(overrides,key))throw Error('ACTUAL_HOST_UNBOUND_IMPORT:'+key);injected.add(key);}}}n.forEachChild(visit);}visit(decl);
 }
 const snippets=[...selected].map(k=>declarations.get(k)).sort((a,b)=>a.pos-b.pos).map(n=>ts.isVariableDeclaration(n)?`${n.parent.flags&ts.NodeFlags.Const?'const':n.parent.flags&ts.NodeFlags.Let?'let':'var'} ${n.getText(t.ast)};`:n.getText(t.ast));
 const code=snippets.join('\n')+'\n;globalThis.__materialActual={'+seeds.map(k=>JSON.stringify(k)+':'+k).join(',')+'};';
 const context=vm.createContext({...globalThis,console,Error,setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask,AbortController,AbortSignal,URL,URLSearchParams,TextEncoder,TextDecoder,window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator,Event:globalThis.Event,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame,...overrides});
 vm.runInContext(code,context,{filename:name,timeout:30000});
 return {exports:context.__materialActual,context,code,proof:{name,sourceSha256:sha(text),scopeSha256:sha(scope.getText(t.ast)),selectedDeclarations:[...selected],injectedLexicals:[...injected],sliceSha256:sha(code),actualNestedLexicalScope:true}};
}
