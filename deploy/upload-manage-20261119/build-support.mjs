import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
export const HERE=path.dirname(fileURLToPath(import.meta.url));
export const REPO=path.resolve(HERE,'../..');
export const H=b=>crypto.createHash('sha256').update(b).digest('hex');
export const parse=(s,file='native.js')=>{const a=ts.createSourceFile(file,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(a.parseDiagnostics.length,0,'syntax '+file);return a;};
export const nodes=(a,p)=>{const out=[];function walk(n){if(p(n))out.push(n);ts.forEachChild(n,walk);}walk(a);return out;};
export const one=(a,label)=>{assert.equal(a.length,1,'unique AST '+label);return a[0];};
export function confined(p){p=path.resolve(p);const rel=path.relative(HERE,p);assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel),'only current deploy directory writable');for(let q=p;;q=path.dirname(q)){assert(!fs.existsSync(q)||!fs.lstatSync(q).isSymbolicLink(),'output symlink refused '+q);if(q===path.dirname(q))break;}return p;}
export function readUtf8(p){const bytes=fs.readFileSync(p),text=bytes.toString('utf8');assert(bytes.equals(Buffer.from(text)),'strict UTF8 '+p);return {bytes,text};}
export function noLoads(code){const a=parse(code);assert(!nodes(a,n=>ts.isImportDeclaration(n)||ts.isExportDeclaration(n)||ts.isImportEqualsDeclaration(n)||(ts.isCallExpression(n)&&(n.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(n.expression)&&n.expression.text==='require'))).length,'no imports, exports, require or module loads');}
export function noFreeIdentifiers(wrapper,aliases){
 const name=path.join(HERE,'__virtual_upload_manage_abi.js'),text=[...new Set(Object.values(aliases))].map(n=>`var ${n};`).join('\n')+'\n'+wrapper;
 const options={allowJs:true,target:ts.ScriptTarget.ES2022,noEmit:true};
 const host=ts.createCompilerHost(options),read=host.readFile.bind(host),exists=host.fileExists.bind(host),get=host.getSourceFile.bind(host);
 host.readFile=f=>f===name?text:read(f);host.fileExists=f=>f===name||exists(f);host.getSourceFile=(f,l,e,n)=>f===name?ts.createSourceFile(f,text,l,true,ts.ScriptKind.JS):get(f,l,e,n);
 const program=ts.createProgram([name],options,host),a=program.getSourceFile(name),checker=program.getTypeChecker();
 const missing=nodes(a,n=>ts.isIdentifier(n)&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n)&&!((ts.isPropertyAssignment(n.parent)||ts.isMethodDeclaration(n.parent))&&n.parent.name===n)&&!checker.getSymbolAtLocation(n));
 assert.deepEqual([...new Set(missing.map(n=>n.text))],[],'replacement free identifiers');
}
export function declarations(scope){const out=[];function scan(n){if(ts.isFunctionDeclaration(n)||ts.isVariableDeclaration(n)){out.push(n);return;}ts.forEachChild(n,scan);}for(const st of scope.statements)scan(st);return out;}
export function inverseDelta(before,hunks){
 const sorted=[...hunks].sort((a,b)=>a.start-b.start);let end=-1,shift=0;const records=[];
 for(const h of sorted){assert(h.start>=end&&h.end>h.start,'nonoverlap');end=h.end;assert.equal(before.slice(h.start,h.end),h.old,'exact original span');assert.notEqual(h.old,h.replacement,'only truly changed spans');const newStart=h.start+shift;shift+=h.replacement.length-h.old.length;
 records.push({name:h.name,oldStart:h.start,oldEnd:h.end,newStart,newEnd:newStart+h.replacement.length,oldSha256:H(h.old),newSha256:H(h.replacement),oldBase64:Buffer.from(h.old).toString('base64'),newBase64:Buffer.from(h.replacement).toString('base64')});}
 let after=before;for(const h of [...sorted].reverse())after=after.slice(0,h.start)+h.replacement+after.slice(h.end);
 let reversed=after;for(const r of [...records].reverse()){assert.equal(reversed.slice(r.newStart,r.newEnd),Buffer.from(r.newBase64,'base64').toString());reversed=reversed.slice(0,r.newStart)+Buffer.from(r.oldBase64,'base64').toString()+reversed.slice(r.newEnd);}
 assert(Buffer.from(reversed).equals(Buffer.from(before)),'whole file inverse bytes');
 let forward=before;for(const r of [...records].reverse())forward=forward.slice(0,r.oldStart)+Buffer.from(r.newBase64,'base64').toString()+forward.slice(r.oldEnd);
 assert(Buffer.from(forward).equals(Buffer.from(after)),'whole file forward bytes');parse(after);return {after,records};
}
export function scopedCss(source,roots,{extractOnly=false}={}){
 source=source.replace(/\/\*[\s\S]*?\*\//g,'');
 function walk(text){let out='',cursor=0;while(cursor<text.length){const open=text.indexOf('{',cursor);if(open<0){assert(!text.slice(cursor).trim(),'CSS tail');break;}const selector=text.slice(cursor,open).trim();let level=1,end=open+1;for(;end<text.length&&level;end++){if(text[end]==='{')level++;if(text[end]==='}')level--;}assert.equal(level,0,'balanced CSS');const body=text.slice(open+1,end-1);
 if(selector.startsWith('@media ')){const nested=walk(body);if(nested.trim())out+=`${selector} {\n${nested}}\n`;}
 else{const allowed=selector.split(',').every(s=>roots.some(root=>new RegExp('^\\.'+root+'(?=[\\s.:#\\[>+~]|$)').test(s.trim())));if(!extractOnly||allowed){assert(!selector.startsWith('@')&&!body.includes('{'),'simple CSS only');assert(allowed,'every CSS selector scoped to customer-only root');out+=`${selector} {${body}}\n`;}}
 cursor=end;}return out;}return walk(source);
}
export function htmlDelta(before,modules,cssRelative){let after=Buffer.from(before);const counts={};for(const m of modules){const old='/'+m.before,newUrl='/'+m.after,ob=Buffer.from(old),nb=Buffer.from(newUrl);assert(!before.includes(nb),'new URL absent');let start=0,count=0;for(;;){const p=before.indexOf(ob,start);if(p<0)break;const q=before.subarray(p-1,p);assert(p>0&&(q.equals(Buffer.from('"'))||q.equals(Buffer.from("'")))&&before.subarray(p+ob.length,p+ob.length+1).equals(q),'entire quoted URL only');start=p+ob.length;count++;}assert(count>0,'old URL present');counts[old]=count;after=Buffer.from(after.toString('utf8').replaceAll(old,newUrl));}let link=null;if(cssRelative){assert.equal(after.toString('utf8').split('</head>').length,2);assert(!before.includes(Buffer.from('/'+cssRelative)));link=`<link rel="stylesheet" href="/${cssRelative}">\n`;after=Buffer.from(after.toString('utf8').replace('</head>',link+'</head>'));}let reverse=after;if(link)reverse=Buffer.from(reverse.toString('utf8').replace(link,''));for(const m of modules)reverse=Buffer.from(reverse.toString('utf8').replaceAll('/'+m.after,'/'+m.before));assert(reverse.equals(before),'HTML full bytes inverse');return {after,counts,link};}
