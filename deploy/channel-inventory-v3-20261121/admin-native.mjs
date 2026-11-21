#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
import esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { inventory, common } from '../upload-manage-20261119/native-abi.mjs';
import { H, parse, nodes, one, declarations, noLoads, noFreeIdentifiers, inverseDelta, htmlDelta } from '../upload-manage-20261119/build-support.mjs';
const R=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),W=path.dirname(R),C=W+'/capture',O=W+'/admin-candidate';
assert(!fs.existsSync(O),'fresh candidate output required');
const pub='client/src/business/platform/client/src/components/channelInventory/FactoryMaterialPublish.tsx';
const specs=[
 {name:'CustomerChannelInventory',native:'mk',source:'client/src/business/platform/client/src/components/customers/CustomerChannelInventory.tsx',bindings:inventory},
 {name:'useFactoryMaterialPublish',native:'Cf',source:pub,bindings:{...common,trpc:'St',factoryMaterialPublishDisabledReason:'zw',FactoryMaterialPublishConfirmation:'N3'}},
 {name:'FactoryMaterialPublishConfirmation',native:'N3',source:pub,bindings:{...common,trpc:'St',InventoryConfirmation:'gu',inventoryDefinitiveFailure:'ys',inventoryError:'Rn',inventoryRequestId:'Dn',previewFactoryMaterialReceptionResultSchema:'Bw',factoryMaterialPublishDisabledReason:'zw',factoryMaterialPublicPrice:'T3',factoryMaterialReceptionLabel:'C3'}},
];
const write=(p,b)=>{const f=O+'/'+p;fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,b);};
const json=(p,x)=>write(p,JSON.stringify(x,null,2)+'\n');
const compiled=[],sources={};
for(const spec of specs){
 const s=fs.readFileSync(R+'/'+spec.source,'utf8');sources[spec.source]=H(s);
 const {code}=await esbuild.transform(s,{loader:'tsx',jsx:'automatic',format:'esm',target:'es2020',minify:false,legalComments:'none'});
 const a=parse(code,spec.source),n=one(a.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text===spec.name),spec.name);
 const leaf=n.getText(a).replace(/^export\s+/,'');
 const aliases=Object.entries(spec.bindings).filter(([a,b])=>a!==b).map(([a,b])=>`${a}=${b}`).join(',');
 const wrapper=`function ${spec.native}(props){const ${aliases};\n${leaf}\nreturn ${spec.name}(props);}`;
 noLoads(wrapper);noFreeIdentifiers(wrapper,spec.bindings);compiled.push({...spec,wrapper,compiledSha256:H(leaf)});
}
const maps=JSON.parse(fs.readFileSync(C+'/admin-map.json','utf8'));
function resolve(p){let seen=new Set();while(maps[p]&&!seen.has(p)){seen.add(p);p=maps[p];}return p;}
const urls=[...new Set(Object.entries(maps).filter(([k])=>k.includes('BusinessWorkbenchPage')).map(([,v])=>resolve(v)))].sort();
assert.equal(urls.length,2,'exact two live business native modules');
const records=JSON.parse(fs.readFileSync(C+'/records.json','utf8')),modules=[];
for(const url of urls){
 const b=fs.readFileSync(C+'/admin'+url),s=b.toString('utf8');assert(b.equals(Buffer.from(s)),'strict UTF8');assert.equal(H(b),records['admin'+url].sha256);
 const a=parse(s,url),history=one(nodes(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='z3'&&n.getText(a).includes('customerUploadHistoryGet.query')),'live history');
 const scope=history.parent;assert(ts.isBlock(scope));let owner=scope;while(owner&&!ts.isVariableDeclaration(owner))owner=owner.parent;
 assert.equal(owner?.name?.getText(a),'__CHANNEL_REFERENCE_HOST_EXPORTS');const ds=declarations(scope),fscope=ds.filter(ts.isFunctionDeclaration),hunks=[],abi={};
 for(const c of compiled){
  const n=one(fscope.filter(n=>n.name?.text===c.native),'live '+c.native);
  assert(n.getText(a).includes(c.native==='mk'?'customer-channel-inventory':c.native==='Cf'?'data-factory-publish-action':'publishFactoryMaterial'), 'native semantic identity '+c.native);
  for(const [name,native] of Object.entries(c.bindings)){
   const d=one(ds.filter(n=>n.name?.getText(a)===native),'native ABI '+name+'='+native);abi[name]={native,sha256:H(d.getText(a)),head:d.getText(a).slice(0,180)};
  }
  hunks.push({name:c.name,start:n.getStart(a),end:n.end,old:n.getText(a),replacement:c.wrapper});
 }
 const protectedNames=['T6','B3','z3','bk','ok','Z3'];const protectedFunctions={};
 for(const name of protectedNames){const n=one(fscope.filter(n=>n.name?.text===name),'protected '+name);assert(hunks.every(h=>h.end<=n.getStart(a)||h.start>=n.end));protectedFunctions[name]=H(n.getText(a));}
 const d=inverseDelta(s,hunks),afterAst=parse(d.after),afterHistory=one(nodes(afterAst,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='z3'&&n.getText(afterAst).includes('customerUploadHistoryGet.query')),'after history');
 const afterDecls=declarations(afterHistory.parent);for(const [name,sha] of Object.entries(protectedFunctions))assert.equal(H(one(afterDecls.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name),'after protected '+name).getText(afterAst)),sha);
 const bytes=Buffer.from(d.after),next='/assets/BusinessWorkbenchPage-channel-v3-'+H(bytes).slice(0,16)+'.js';write('package'+next,bytes);
 modules.push({before:url.slice(1),after:next.slice(1),sha256:H(bytes),size:bytes.length});
 json('evidence/'+path.basename(url)+'.json',{beforeSha256:H(b),afterSha256:H(bytes),patches:d.records,abi,protectedFunctions,forwardVerified:true,inverseVerified:true,allBytesOutsideAuthorizedFunctionsUnchanged:true});
}
const sourceCss='client/src/business/platform/client/src/components/customers/CustomerChannelInventory.css',css=fs.readFileSync(R+'/'+sourceCss);sources[sourceCss]=H(css);
const suffix=css.toString().split('/* Approved channel publication controls; no global inventory/mall selectors. */')[1];assert(suffix&&suffix.includes('.customer-channel-inventory'));
const cssBytes=Buffer.from('/* Channel inventory publication v3 only. */\n'+suffix),cssUrl='assets/channel-inventory-admin-v3-'+H(cssBytes).slice(0,16)+'.css';write('package/'+cssUrl,cssBytes);
const before=fs.readFileSync(C+'/admin-index.html');assert.equal(H(before),records['admin-index.html'].sha256);
const d=htmlDelta(before,modules,cssUrl);write('package/before-index.html',before);write('package/index.html',d.after);
for(const [f,sha] of Object.entries(sources))assert.equal(H(fs.readFileSync(R+'/'+f)),sha,'source freeze '+f);
const assets=modules.map(m=>({url:'/'+m.after,sha256:m.sha256,size:m.size})).concat({url:'/'+cssUrl,sha256:H(cssBytes),size:cssBytes.length});
json('manifest.json',{kind:'admin-static',scope:'channel-inventory-v3-20261121',htmlBeforeSHA:H(before),htmlAfterSHA:H(d.after),root:'/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public',modules,assets,sources,builderSHA:H(fs.readFileSync(fileURLToPath(import.meta.url))),wholeNativeInverse:true,wholeHtmlInverse:true,noNewProvider:true,noLibraryCopies:true});
json('evidence/html.json',{counts:d.counts,link:d.link,wholeInverseExact:true});
console.log(JSON.stringify({status:'ADMIN_CHANNEL_NATIVE_CANDIDATE_BUILT',modules:modules.length,functionsPerModule:specs.length,assets:assets.length,htmlSha256:H(d.after),output:O},null,2));
