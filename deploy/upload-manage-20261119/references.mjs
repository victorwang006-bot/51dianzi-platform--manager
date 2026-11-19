import fs from 'node:fs';
import ts from 'typescript';
import {HERE,parse,nodes,one} from './build-support.mjs';
const a=parse(fs.readFileSync(HERE+'/inputs/assets/BusinessWorkbenchPage-upload-history-50b4bb692f995bbf.js','utf8'));
const history=one(nodes(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='z3'&&n.getText(a).includes('customerUploadHistoryGet.query')),'history');
const decls=[];function scan(n){if(ts.isFunctionDeclaration(n)||ts.isVariableDeclaration(n)){decls.push(n);return;}ts.forEachChild(n,scan);}for(const st of history.parent.statements)scan(st);
let output='';
for(const name of ['T6','B3','mk']){
 const n=one(decls.filter(n=>n.name?.getText(a)===name),name),refs=new Set(nodes(n,ts.isIdentifier).map(n=>n.text));
 output+='\nTARGET '+name+'\n';
 for(const d of decls.filter(d=>refs.has(d.name?.getText(a))&&d!==n))output+=d.name.getText(a)+' '+d.getText(a).slice(0,700)+'\n';
}
for(const d of decls.filter(d=>d.getStart(a)>=5198900&&d.getStart(a)<=5217430))output+='\nNEAR '+d.getText(a).slice(0,700)+'\n';
fs.writeFileSync(HERE+'/evidence/references.txt',output);console.log(output);
