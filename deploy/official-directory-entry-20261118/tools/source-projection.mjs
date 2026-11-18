import {ts,parse,nodes,declaration,one,assert,bytesDelta,H} from '/home/ubuntu/work/commission-simple-20261118/packaging/current-tools/native-core.mjs';

export function projectSourceRoute(source, helper, oldOrdinary='a.jsx(K1,{})') {
  const sourceAst=parse(source,'SearchPage.tsx'), route=declaration(sourceAst,'SearchPage');
  const returned=one(nodes(route,n=>ts.isReturnStatement(n)),'source route return');
  assert(ts.isConditionalExpression(returned.expression),'source route conditional');
  const normal=returned.expression.whenFalse;
  assert(ts.isJsxFragment(normal),'normal source Fragment');
  const merchant=one(nodes(normal,n=>ts.isJsxSelfClosingElement(n)&&n.tagName.getText(sourceAst)==='OrdinaryInventorySearchPage'),'merchant source element');
  const helperAst=parse(helper,'officialMallNavigation.ts'), fn=declaration(helperAst,'createOfficialMallSearchUrl');
  const functionText=fn.getText(helperAst).replace(/^export\s+/, '');
  const pureHelper=ts.transpileModule(functionText,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext}}).outputText.trim();
  parse(pureHelper);
  assert(!/\b(import|export|require)\b/.test(pureHelper),'pure helper has no runtime dependencies');
  const normalText=normal.getText(sourceAst);
  const start=merchant.tagName.getStart(sourceAst)-normal.getStart(sourceAst);
  const withK1=normalText.slice(0,start)+'K1'+normalText.slice(start+merchant.tagName.getText(sourceAst).length);
  const compiled=ts.transpileModule('function __DirectoryEntry(state){return '+withK1+';}',{fileName:'projection.tsx',compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const ca=parse(compiled), imports=ca.statements.filter(ts.isImportDeclaration);
  assert(imports.length===1&&imports[0].moduleSpecifier.text==='react/jsx-runtime','only JSX runtime projection import');
  const alias=Object.fromEntries(imports[0].importClause.namedBindings.elements.map(e=>[e.name.text,'a.'+(e.propertyName?.text||e.name.text)]));
  const ret=one(nodes(declaration(ca,'__DirectoryEntry'),n=>ts.isReturnStatement(n)),'compiled normal return');
  const exp=ret.expression;
  let expr=exp.getText(ca);
  const edits=nodes(exp,n=>ts.isIdentifier(n)&&alias[n.text]).map(n=>({start:n.getStart(ca)-exp.getStart(ca),end:n.end-exp.getStart(ca),before:n.getText(ca),after:alias[n.text],reason:'use existing native JSX singleton'}));
  expr=bytesDelta(expr,edits).candidate.toString();
  const ea=parse(expr), merchantCall=one(nodes(ea,n=>ts.isCallExpression(n)&&n.arguments[0]?.getText(ea)==='K1'),'native ordinary call');
  expr=bytesDelta(expr,[{start:merchantCall.getStart(ea),end:merchantCall.end,before:merchantCall.getText(ea),after:oldOrdinary,reason:'preserve original ordinary expression exact bytes'}]).candidate.toString();
  assert(!expr.includes('react/jsx-runtime'),'no new JSX runtime import');
  return {pureHelper,normalExpression:expr,sourceSelfExpression:returned.expression.whenTrue.getText(sourceAst),sourceHashes:{SearchPage:H(source),officialMallNavigation:H(helper)},helperSha256:H(pureHelper),ordinarySha256:H(expr)};
}
