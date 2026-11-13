import fs from 'node:fs';
import ts from 'typescript';
import {transform} from 'esbuild';
const R='/home/ubuntu/work/manager', O='/home/ubuntu/task-recovery/inquiry-reception-release-20261113/admin-static';
const audit=JSON.parse(fs.readFileSync(O+'/baseline-runtime-audit.json'));
export const parse=(s,name='x.js')=>ts.createSourceFile(name,s,99,true,ts.ScriptKind.JS);
export function nodes(a,p){let out=[];function v(n){if(p(n))out.push(n);n.forEachChild(v)}v(a);return out;}
export const read=f=>fs.readFileSync(f,'utf8');
export async function mapping(rel,liveFile,label){
 const source=read(R+'/'+rel), result=await transform(source,{loader:rel.endsWith('tsx')?'tsx':'ts',jsx:'automatic',target:'es2020'});let text=result.code; const temp=parse(text);
 const reactNames=temp.statements.filter(ts.isImportDeclaration).filter(n=>n.moduleSpecifier.text==='react').flatMap(n=>n.importClause?.namedBindings?.elements??[]).map(n=>n.name.text);
 for(const n of temp.statements.filter(ts.isImportDeclaration).reverse())text=text.slice(0,n.getStart(temp))+text.slice(n.end);
 text=text.replace(/\b(jsx|jsxs|Fragment)\b/g,'e.$1'); for(const n of reactNames)text=text.replace(new RegExp('\\b'+n+'\\b','g'),'c.'+n);
 text=text.replace(/^import .*;\n/gm,'');text=(await transform(text,{loader:'js',minifySyntax:true,minifyWhitespace:true,target:'es2020'})).code;
 const sa=parse(text), live=read(liveFile), la=parse(live);
 const imports=temp.statements.filter(ts.isImportDeclaration).flatMap(n=>{let out=[];if(n.importClause?.name)out.push({name:n.importClause.name.text,export:'default',path:n.moduleSpecifier.text});for(const x of n.importClause?.namedBindings?.elements??[])out.push({name:x.name.text,export:x.propertyName?.text??x.name.text,path:n.moduleSpecifier.text});return out});
 const globals=new Set([...imports.map(n=>n.name),...sa.statements.filter(n=>ts.isFunctionDeclaration(n)||ts.isClassDeclaration(n)).map(n=>n.name?.text),...sa.statements.filter(ts.isVariableStatement).flatMap(n=>n.declarationList.declarations.filter(x=>ts.isIdentifier(x.name)).map(x=>x.name.text))]);
 function tokens(a){const skip=nodes(a,n=>ts.isPropertyAssignment(n)&&n.name.getText(a)==='"data-loc"').map(n=>[n.getStart(a),n.end+1]); const property=new Set(nodes(a,n=>ts.isIdentifier(n)&&(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n||ts.isPropertyAssignment(n.parent)&&n.parent.name===n)).map(n=>n.getStart(a)));let arr=[];function leaf(n){const kids=n.getChildren(a);if(kids.length){kids.forEach(leaf);return;}const kind=n.kind,raw=n.getText(a),pos=n.getStart(a);if(!raw||skip.some(([s,e])=>pos>=s&&pos<e))return;arr.push({key:kind===ts.SyntaxKind.Identifier&&!property.has(pos)?'ID':raw,raw,pos,kind});}leaf(a);return arr;}
 const st=tokens(sa),lt=tokens(la), counts={};
 for(const width of [13,9,5]){const idx=new Map();for(let i=0;i<=lt.length-width;i++){const k=lt.slice(i,i+width).map(t=>t.key).join(' ');let v=idx.get(k);if(!v)idx.set(k,v=[]);v.push(i);}for(let i=0;i<=st.length-width;i++){const k=st.slice(i,i+width).map(t=>t.key).join(' '),match=idx.get(k);if(match?.length!==1)continue;for(let j=0;j<width;j++){const t=st[i+j],l=lt[match[0]+j];if(globals.has(t.raw)&&t.kind===ts.SyntaxKind.Identifier&&l.kind===ts.SyntaxKind.Identifier){counts[t.raw]??={};counts[t.raw][l.raw]=(counts[t.raw][l.raw]??0)+width;}}}}
 const ranked=Object.fromEntries([...globals].map(k=>[k,Object.entries(counts[k]??{}).sort((a,b)=>b[1]-a[1]).slice(0,5)]));
 const funcs=la.statements.filter(n=>ts.isFunctionDeclaration(n)||ts.isClassDeclaration(n)).map(n=>({name:n.name?.text,start:n.getStart(la),end:n.end,locs:[...n.getText(la).matchAll(/client\/src\/[^"']+/g)].map(x=>x[0]).filter(x=>x.includes(label)).slice(0,3),prefix:n.getText(la).slice(0,220)})).filter(n=>n.locs.length);
 fs.writeFileSync(O+'/mapping-'+label.replace(/\W/g,'')+'.json',JSON.stringify({rel,imports,ranked,funcs},null,2));fs.writeFileSync(O+'/source-'+label.replace(/\W/g,'')+'.js',text);
 return {imports,ranked,funcs,sa,la,text,live};
}
if(process.argv[1]===new URL(import.meta.url).pathname){for(const [rel,lf,label] of [['client/src/business/platform/client/src/pages/ChatPage.tsx',audit.runtime[0].file,'ChatPage'],['client/src/business/BusinessWorkbenchPage.tsx',audit.runtime[0].file,'BusinessWorkbenchPage'],['client/src/pages/OfficialChannelInventory.tsx','/home/ubuntu/task-recovery/inquiry-reception-release-20261113/live/admin-static'+audit.official[0].url,'OfficialChannelInventory']]){const m=await mapping(rel,lf,label);console.log(label,JSON.stringify(Object.fromEntries(m.imports.map(i=>[i.name,m.ranked[i.name]]))));console.log(m.funcs.map(f=>[f.name,f.locs[0],f.prefix]));}}
