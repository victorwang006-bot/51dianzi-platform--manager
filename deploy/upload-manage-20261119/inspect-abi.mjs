import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
const nodes=(a,p)=>{const out=[];function walk(n){if(p(n))out.push(n);ts.forEachChild(n,walk);}walk(a);return out;};
const one=(a,label)=>{assert.equal(a.length,1,label);return a[0];};
const file=path.join(HERE,'inputs/assets/BusinessWorkbenchPage-upload-history-50b4bb692f995bbf.js');
const bytes=fs.readFileSync(file),text=bytes.toString('utf8');
assert.equal(H(bytes),'50b4bb692f995bbf4fdc6d25f1e76240e769f9c115949986ac9472cb12a704d3');
const a=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const history=one(nodes(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='z3'&&n.getText(a).includes('customerUploadHistoryGet.query')),'customer history factory');
const scope=history.parent,decls=[];
function scan(n){if(ts.isFunctionDeclaration(n)||ts.isVariableDeclaration(n)){decls.push(n);return;}ts.forEachChild(n,scan);}
for(const st of scope.statements)scan(st);
const report={file,sha256:H(bytes),scopeStart:scope.getStart(a),scopeEnd:scope.end,
 declarations:decls.map(n=>({name:n.name?.getText(a),kind:ts.SyntaxKind[n.kind],start:n.getStart(a),end:n.end,sha256:H(n.getText(a)),head:n.getText(a).slice(0,220)}))};
fs.writeFileSync(path.join(HERE,'evidence/abi-inspection.json'),JSON.stringify(report,null,2)+'\n');
for(const name of ['T6','B3','mk','V3','U3','uk','bk']){
 const n=one(decls.filter(n=>n.name?.getText(a)===name),'decl '+name);
 fs.writeFileSync(path.join(HERE,'evidence/native-'+name+'.js'),n.getText(a)+'\n');
 console.log(name,n.getStart(a),n.end,n.getText(a).slice(0,900));
}
console.log('BRIDGE',decls.filter(n=>n.getText(a).includes('__customerLive')).map(n=>n.getText(a)).join('\n'));
