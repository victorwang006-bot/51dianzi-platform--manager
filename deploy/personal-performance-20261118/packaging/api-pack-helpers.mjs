import fs from 'node:fs';
import {ts,parse,nodes,H,assert,adapt,bytesDelta,patch} from './current-tools/native-core.mjs';
/** API-only adaptation: imports/export lists are not executable slot bodies, remove before mapping expression-valued native aliases. */
export function apiCompiledSource(snapshot,file,map={}) {
  let code=ts.transpileModule(snapshot.read(file),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const a=parse(code);
  code=bytesDelta(code,a.statements.filter(n=>ts.isImportDeclaration(n)||ts.isExportDeclaration(n)).map(n=>patch(a,n,'','API slot adapter excludes source imports and export lists'))).candidate.toString();
  code=code.replace(/^export\s+(?=(?:async\s+)?function|const|let|var|class)/gm,'');
  return parse(adapt(code,map));
}
export function nativeOwner(a,name){
  const rows=nodes(a,n=>(ts.isFunctionDeclaration(n)||ts.isVariableDeclaration(n)||ts.isClassDeclaration(n)||ts.isImportSpecifier(n)||ts.isNamespaceImport(n))&&n.name?.text===name).filter(n=>n.parent===a||ts.isVariableDeclaration(n)&&n.parent?.parent?.parent===a||ts.isImportSpecifier(n)||ts.isNamespaceImport(n));
  assert(rows.length===1,'EXACT_TOPLEVEL_NATIVE_OWNER '+name+' '+rows.length);return rows[0];
}
export function bridgeFor(a,baseline,bindings){
  const requiredKeys=Object.keys(bindings),provenance=requiredKeys.map(key=>{const actualExpression=bindings[key],n=nativeOwner(a,actualExpression);return{key,actualExpression,ownerSha256:H(n.getText(a)),baselineSha256:H(baseline),kind:ts.SyntaxKind[n.kind]};});
  return{contents:requiredKeys.map(k=>'export const '+k+'=__native.'+k+';').join('\n'),requiredKeys,provenance};
}
export const apiToolHashes=()=>Object.fromEntries([new URL(import.meta.url).pathname].map(p=>[p,H(fs.readFileSync(p))]));
