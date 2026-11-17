import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {parse,nodes,ts,resolve,specs} from '/home/ubuntu/work/admin-new-info-v1-20261117/build-page-markers.mjs';
const D=path.dirname(new URL(import.meta.url).pathname), H=s=>crypto.createHash('sha256').update(s).digest('hex');
const inputs=JSON.parse(fs.readFileSync(D+'/current-inputs.json','utf8')), base=JSON.parse(fs.readFileSync(D+'/baseline.json','utf8'));
const html=fs.readFileSync(D+'/before.html','utf8');assert.equal(H(html),base.htmlSha256);
const match=[...html.matchAll(/<script[^>]*type="importmap"[^>]*>([\s\S]*?)<\/script>/g)];assert.equal(match.length,1);
const oldMap=JSON.parse(match[0][1]),map=structuredClone(oldMap),modules=[],rewrites={};
fs.mkdirSync(D+'/candidate',{recursive:true});
for(const asset of inputs.assets){
 const before=fs.readFileSync(asset.local,'utf8');assert.equal(H(before),asset.sha256);const ast=parse(before,asset.url), patches=[],functions=[];
 const declarations=nodes(ast,n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)==='__niPageRows');
 const selected=declarations.filter(n=>/^\([\w$]+\.data\.items\?\?\[\]\)$/.test(n.initializer.getText(ast)));assert.equal(selected.length,2,'exactly main CRM and embedded CRM per real factory');
 for(const declaration of selected){
  let fn=declaration;while(fn&&!ts.isFunctionDeclaration(fn))fn=fn.parent;assert(fn&&fn.getText(ast).includes('crmSalesOrder.list.useQuery'),'CRM-only owner');
  const expression=declaration.initializer,old=expression.getText(ast);patches.push({start:expression.getStart(ast),end:expression.end,before:old,after:old.replace('.data.items','.data?.items'),kind:'nullable-current-CRM-data'});
  const call=nodes(fn,n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)==='__niRows');assert.equal(call.length,1);const options=call[0].initializer.arguments[0];const ref=options.properties.filter(n=>ts.isPropertyAssignment(n)&&n.name.getText(ast)==='refs');assert.equal(ref.length,1);const value=ref[0].initializer;assert(value.getText(ast).startsWith('__niPageRows.map('));
  patches.push({start:value.getStart(ast),end:value.end,before:value.getText(ast),after:'__niListReady?'+value.getText(ast)+':[]',kind:'only-current-readable-page-notification-refs'});
  functions.push({name:fn.name.text,beforeNodeSha256:H(fn.getText(ast)),query:old.match(/^\(([\w$]+)/)[1]});
 }
 patches.sort((a,b)=>a.start-b.start);let shift=0;
 for(const [i,p]of patches.entries()){if(i)assert(p.start>=patches[i-1].end);assert.equal(before.slice(p.start,p.end),p.before);p.beforeByteStart=Buffer.byteLength(before.slice(0,p.start));p.beforeByteEnd=Buffer.byteLength(before.slice(0,p.end));p.afterStart=p.start+shift;p.afterEnd=p.afterStart+p.after.length;shift+=p.after.length-p.before.length;}
 let after=before;for(const p of [...patches].reverse())after=after.slice(0,p.start)+p.after+after.slice(p.end);
 let inverse=after;for(const p of [...patches].reverse())inverse=inverse.slice(0,p.afterStart)+p.before+inverse.slice(p.afterEnd);assert.equal(inverse,before);parse(after);
 const next= '/assets/BusinessWorkbenchPage-orders-empty-safe-'+H(after).slice(0,16)+'.js',local=D+'/candidate/'+path.basename(next);fs.writeFileSync(local,after);rewrites[asset.url]=next;
 modules.push({oldUrl:asset.url,newUrl:next,oldLocal:asset.local,newLocal:local,beforeSha256:H(before),afterSha256:H(after),bytes:Buffer.byteLength(after),patches,functions,allOtherBytesUnchanged:true});
}
assert.equal(modules.reduce((n,m)=>n+m.functions.length,0),4);
for(const table of [map.imports,...Object.values(map.scopes??{})])for(const [key,value]of Object.entries(table))table[key]=rewrites[value]??value;
for(const [from,to]of Object.entries(rewrites)){map.imports[from]=to;const applicable=Object.keys(oldMap.scopes??{}).filter(s=>from.startsWith(s)).sort((a,b)=>b.length-a.length);if(applicable.length){map.scopes??={};map.scopes[to]=structuredClone(map.scopes[applicable[0]]);for(const [k,v]of Object.entries(map.scopes[to]))map.scopes[to][k]=rewrites[v]??v;}}
for(const module of modules)for(const spec of specs(fs.readFileSync(module.oldLocal,'utf8'))){const old=resolve(spec,module.oldUrl,oldMap);assert.equal(resolve(spec,module.newUrl,map),rewrites[old]??old,'same existing singletons/dependencies '+spec);}
for(const [key,value]of Object.entries(oldMap.imports))assert.equal(map.imports[key],rewrites[value]??value);
for(const [scope,table]of Object.entries(oldMap.scopes??{}))for(const [key,value]of Object.entries(table))assert.equal(map.scopes[scope][key],rewrites[value]??value);
const newMap=JSON.stringify(map),afterHtml=html.replace(match[0][1],newMap);assert.equal(afterHtml.replace(newMap,match[0][1]),html);fs.writeFileSync(D+'/candidate/index.html',afterHtml);
const sourceNames=['client/src/business/platform/client/src/pages/CrmSalesOrders.tsx','deploy/admin-new-information-v1/build-page-markers.mjs'];const sourceHashes=Object.fromEntries(sourceNames.map(p=>[p,H(fs.readFileSync('/home/ubuntu/work/51dianzi-platform--manager/'+p))]));
const manifest={scope:'orders-four-nullable-data-static-only',staticRoot:inputs.staticRoot,protectedEntries:inputs.protectedEntries,oldHtmlSha256:H(html),newHtmlSha256:H(afterHtml),modules,rewrites,sourceHashes,checks:{exactlyFourCRMFunctions:true,exactlyEightSmallPatches:true,htmlImportmapOnly:true,noNewRuntimeOrProvider:true,originalDataIsolationAndQueriesPreserved:true,originalAttachmentReferenceNavigationAndCssPreserved:true,noApiDatabaseWorkerChanges:true}};
assert.equal(modules.reduce((n,m)=>n+m.patches.length,0),8);fs.writeFileSync(D+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({status:'candidate-built',functions:modules.map(m=>m.functions.map(f=>f.name)),modules:modules.map(m=>m.newUrl),allOtherModuleBytesUnchanged:true}));
