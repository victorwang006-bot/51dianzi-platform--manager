import fs from 'node:fs';import {createRequire}from'node:module';
const req=createRequire('/home/ubuntu/work/resume-frontend/platform/package.json');export const ts=req('typescript'),eb=req('esbuild');
export function need(v,m){if(!v)throw Error(m)}
export function program(text,name='snippet.js'){
 const file=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);need(!file.parseDiagnostics.length,'PARSE '+name);
 const host={getSourceFile:f=>f===name?file:undefined,getDefaultLibFileName:()=>'',writeFile:()=>{},getCurrentDirectory:()=>'',getDirectories:()=>[],fileExists:f=>f===name,readFile:f=>f===name?text:undefined,getCanonicalFileName:f=>f,useCaseSensitiveFileNames:()=>true,getNewLine:()=> '\n'};
 const p=ts.createProgram([name],{allowJs:true,noLib:true,noResolve:true},host);return{file,checker:p.getTypeChecker()};
}
export function walk(n,f){f(n);ts.forEachChild(n,c=>walk(c,f))}
export function functions(a,name){const v=[];walk(a,n=>{if(ts.isFunctionDeclaration(n)&&n.name?.text===name)v.push(n)});return v}
function fixedId(n){const p=n.parent;return(ts.isPropertyAccessExpression(p)&&p.name===n)||(ts.isPropertyAssignment(p)&&p.name===n)||(ts.isBindingElement(p)&&p.propertyName===n)||(ts.isMethodDeclaration(p)&&p.name===n);}
export function explicitKeys(text){
 const {file}=program(text);const result=ts.transform(file,[ctx=>{const visit=n=>{
  if(ts.isBindingElement(n)&&ts.isObjectBindingPattern(n.parent)&&!n.propertyName&&!n.dotDotDotToken&&ts.isIdentifier(n.name))return ts.factory.updateBindingElement(n,n.dotDotDotToken,ts.factory.createIdentifier(n.name.text),n.name,n.initializer);
  if(ts.isShorthandPropertyAssignment(n)){need(!n.objectAssignmentInitializer,'NO_DEFAULT_SHORTHAND');return ts.factory.createPropertyAssignment(n.name.text,n.name);}
  return ts.visitEachChild(n,visit,ctx);
 };return n=>ts.visitNode(n,visit)}]);const out=ts.createPrinter({removeComments:true}).printFile(result.transformed[0]);result.dispose();return out;
}
export function alphaEqual(left,right){
 const l=program(explicitKeys(left),'l.js'),r=program(explicitKeys(right),'r.js'),lm=new Map(),rm=new Map(),free={},local=[];let count=0;
 function symbol(a,n){const s=a.checker.getSymbolAtLocation(n);return s&&s.declarations?.length?s:null}
 function rec(x,y,loc){need(x.kind===y.kind,`AST_KIND ${loc} ${ts.SyntaxKind[x.kind]} != ${ts.SyntaxKind[y.kind]}`);
  if(ts.isIdentifier(x)){
   const fixed=fixedId(x),f2=fixedId(y);need(fixed===f2,'ID_ROLE '+loc);
   if(fixed){need(x.text===y.text,'PROPERTY '+loc+' '+x.text+' != '+y.text);return}
   const a=symbol(l,x),b=symbol(r,y);need(!!a===!!b,'LOCAL_FREE_ROLE '+loc+' '+x.text+' != '+y.text);
   if(a){if(!lm.has(a)){need(!rm.has(b),'NOT_BIJECTIVE '+loc);lm.set(a,b);rm.set(b,a);local.push({source:x.text,compiled:y.text,declarationKinds:a.declarations.map(d=>ts.SyntaxKind[d.kind])});}need(lm.get(a)===b&&rm.get(b)===a,'SYMBOL_MAPPING '+loc)}
   else{if(!(x.text in free)){need(!Object.values(free).includes(y.text),'FREE_NOT_BIJECTIVE '+loc);free[x.text]=y.text;}need(free[x.text]===y.text,'FREE_MAPPING '+loc)}return;
  }
  if(ts.isStringLiteralLike(x)||ts.isNumericLiteral(x)||ts.isRegularExpressionLiteral(x)){need(x.text===y.text,`LITERAL ${loc} ${JSON.stringify(x.text)} != ${JSON.stringify(y.text)}`);return}
  const xc=x.getChildren(l.file),yc=y.getChildren(r.file);need(xc.length===yc.length,`CHILD_COUNT ${loc} ${xc.length} != ${yc.length} ${x.getText(l.file).slice(0,120)} / ${y.getText(r.file).slice(0,120)}`);
  for(let i=0;i<xc.length;i++){count++;rec(xc[i],yc[i],loc+'/'+ts.SyntaxKind[x.kind]+':'+i)}
 }
 rec(l.file,r.file,'root');return{matched:true,nodes:count,localSymbols:local,freeIdentifiers:free};
}
export async function compileFunction(source,fnName){
 const a=ts.createSourceFile('source.tsx',source,99,true,ts.ScriptKind.TSX),fn=functions(a,fnName);need(fn.length===1,'SOURCE_ONE_FUNCTION '+fnName);
 const defines={OFFICIAL_QUANTITY_MAX:'2147483647',...(fnName==='OfficialSearchCard'?{Zap:'__SEED_LUCIDE.Zap',ShoppingCart:'__SEED_LUCIDE.ShoppingCart'}:{})};
 const out=await eb.build({stdin:{contents:'export '+fn[0].getText(a).replace(/^export /,''),loader:'tsx'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2020',jsx:'automatic',minifySyntax:true,minifyWhitespace:true,minifyIdentifiers:false,metafile:true,treeShaking:true,logLevel:'silent',define:defines,plugins:[{name:'isolated-no-runtime',setup(build){
  build.onResolve({filter:/.*/},args=>{need(args.path==='react/jsx-runtime','NO_ADDITIONAL_IMPORT '+args.path);return{path:'jsx-host',namespace:'seed-host'}});
  build.onLoad({filter:/.*/,namespace:'seed-host'},()=>({contents:'export const jsx=__SEED_JSX,jsxs=__SEED_JSXS,Fragment=__SEED_FRAGMENT;',loader:'js'}));
 }}]});
 need(Object.keys(out.metafile.inputs).every(k=>k==='<stdin>'||k==='seed-host:jsx-host'),'ISOLATED_INPUTS_ONLY');
 const p=program(out.outputFiles[0].text),fns=p.file.statements.filter(ts.isFunctionDeclaration);need(fns.length===1,'ONE_COMPILED_FUNCTION');return fns[0].getText(p.file);
}
