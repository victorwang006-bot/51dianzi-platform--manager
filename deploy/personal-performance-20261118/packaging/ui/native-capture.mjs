import fs from 'node:fs';
import vm from 'node:vm';
import {H,ts,assert,parse,nodes} from '../current-tools/native-core.mjs';
export function captureNative(entry,roots,env={}) {
 const text=fs.readFileSync(entry,'utf8'),file=pathName(entry),a=parse(text,file);
 const host={getSourceFile:f=>f===file?a:undefined,getDefaultLibFileName:()=>'',writeFile:()=>{},getCurrentDirectory:()=>'',getDirectories:()=>[],fileExists:f=>f===file,readFile:f=>f===file?text:undefined,getCanonicalFileName:f=>f,useCaseSensitiveFileNames:()=>true,getNewLine:()=> '\n'};
 const program=ts.createProgram([file],{allowJs:true,noLib:true,noResolve:true,checkJs:false},host),checker=program.getTypeChecker();
 const top=new Map();for(const statement of a.statements){if(ts.isFunctionDeclaration(statement)&&statement.name)top.set(statement.name.text,statement);if(ts.isClassDeclaration(statement)&&statement.name)top.set(statement.name.text,statement);if(ts.isVariableStatement(statement))for(const n of statement.declarationList.declarations)if(ts.isIdentifier(n.name))top.set(n.name.text,n);}
 const chosen=new Map();function add(name){if(chosen.has(name))return;const n=top.get(name);assert(n,'NATIVE_DECLARATION_MISSING '+name);chosen.set(name,n);for(const id of nodes(n,ts.isIdentifier)){const sym=checker.getSymbolAtLocation(id);for(const d of sym?.declarations??[])if(top.get(id.text)===d&&id.text!==name)add(id.text);}}
 for(const name of roots)add(name);
 const records=[...chosen].sort(([,a],[,b])=>a.pos-b.pos).map(([name,n])=>({name,sha256:H(n.getText(a)),code:ts.isVariableDeclaration(n)?'var '+n.getText(a)+';':n.getText(a)}));
 assert(!records.some(r=>/createRoot\([^)]*getElementById|__vite__mapDeps/.test(r.code)),'ROOT_STARTUP_DECLARATION_FORBIDDEN');
 const context=vm.createContext(env);new vm.Script(records.map(r=>r.code).join('\n')+'\nthis.__capture={'+roots.map(n=>JSON.stringify(n)+':'+n).join(',')+'};',{filename:entry+':pure-factory-closure'}).runInContext(context,{timeout:15000});
 return {context,values:env.__capture,evidence:{entry,entrySha256:H(text),roots,declarations:records.map(({code,...r})=>r),wholeEntryExecuted:false,rootAppStarted:false}};
}
function pathName(p){return p.endsWith('.js')?p:p+'.js';}
