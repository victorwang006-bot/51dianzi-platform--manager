import fs from 'node:fs';
import ts from 'typescript';
const p=process.argv[2],text=fs.readFileSync(p,'utf8'),sf=ts.createSourceFile(p,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
for(const n of sf.statements){
 if(ts.isFunctionDeclaration(n)){
  const body=n.getText(sf);
  if(body.includes('permission')&&body.includes('menuGroups')||body.includes('"/login"')&&body.includes('"/merchants"')||body.includes('"业务管理"')||body.includes('"sidebar-content"')||body.includes('"暂无访问权限"'))console.log('FUNCTION',n.name?.text,body.slice(0,900));
 }
 if(ts.isVariableStatement(n)){
  const body=n.getText(sf);if(body.includes('label:"业务管理"')||body.includes('label:"系统"'))console.log('MENUS',body.slice(0,2200));
 }
}
