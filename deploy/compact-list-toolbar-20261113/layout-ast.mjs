import fs from 'node:fs';
import {createRequire} from 'node:module';
export const require=createRequire('/home/ubuntu/work/51dianzi-platform--manager/package.json');export const ts=require('typescript');
export const assert=(v,msg)=>{if(!v)throw Error(msg);};
export const nodes=(n,test)=>{const out=[];function walk(x){if(test(x))out.push(x);ts.forEachChild(x,walk);}walk(n);return out;};
export const prop=(obj,name)=>obj&&ts.isObjectLiteralExpression(obj)?obj.properties.find(x=>ts.isPropertyAssignment(x)&&(ts.isIdentifier(x.name)?x.name.text:ts.isStringLiteral(x.name)?x.name.text:null)===name)?.initializer:undefined;
export const props=call=>call&&ts.isCallExpression(call)&&call.arguments[1]&&ts.isObjectLiteralExpression(call.arguments[1])?call.arguments[1]:undefined;
export const children=call=>prop(props(call),'children');
export const one=(items,msg)=>{assert(items.length===1,msg+':'+items.length);return items[0];};
export function parse(text,file='module.js'){const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert(!ast.parseDiagnostics.length,'PARSE:'+file);return ast;}
export function inspect(){const rows=JSON.parse(fs.readFileSync('/home/ubuntu/task-recovery/compact-list-20261113/selected-runtime-locations.json'));for(const row of rows){const title=row.url.includes('Staff-')?'员工与权限':row.url.includes('Merchants-')?'商户管理':'客户列表';const text=fs.readFileSync(row.file,'utf8'),ast=parse(text,row.url);const header=one(nodes(ast,x=>ts.isCallExpression(x)&&prop(props(x),'title')?.text===title),'HEADER:'+title);let array=header.parent;while(array&&!ts.isArrayLiteralExpression(array))array=array.parent;console.log('\nPAGE',title);console.log('HEADER',header.getText(ast));if(array)console.log('TOP CHILDREN',array.elements.map((x,i)=>({i,start:x.getStart(ast),end:x.end,text:x.getText(ast).slice(0,220)})));if(title==='客户列表')console.log('CUSTOMER FILTER AREA',text.slice(header.end,header.end+7300));}}
if(process.argv.includes('--inspect'))inspect();
