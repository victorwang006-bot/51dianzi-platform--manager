#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root='/home/ubuntu/nav-hierarchy',out=path.join(root,'release');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const top=JSON.parse(await fs.readFile(path.join(root,'navigation-overlay/manifest.json'),'utf8'));
const channel=JSON.parse(await fs.readFile(path.join(root,'channel-overlay/manifest.json'),'utf8'));
assert.equal(top.originalImportsExportsPreserved,true);assert.equal(channel.originalImportsExportsPreserved,true);
assert.equal(top.allOtherChunkBytesPreserved,true);assert.equal(channel.allOtherChunkBytesPreserved,true);
assert.equal(top.noRuntimeOrServerDependencies,true);assert.equal(channel.noRuntimeOrServerDependencies,true);
assert.equal(channel.existingChannelManagementCssUnchanged,true);assert.equal(top.oldCssBytesPreserved,true);
const baseline={...top.baseline};for(const[name,digest]of Object.entries(channel.baseline)){if(Object.hasOwn(baseline,name))assert.equal(baseline[name],digest);baseline[name]=digest;}
const cssName='channel-inventory-management-6180ba0776bef02e.css',cssBytes=await fs.readFile(path.join(root,'baseline',cssName));
assert.equal(sha(cssBytes),'6180ba0776bef02e9c256c349be63feeb15235246fb3340121d9dbd2b7cd9980');baseline[cssName]=sha(cssBytes);
for(const[name,digest]of Object.entries(baseline))assert.equal(sha(await fs.readFile(path.join(root,'baseline',name))),digest,'baseline drift '+name);
const sourceFiles=new Map();for(const f of [...top.sourceFiles,top.cssSource,...channel.sourceFiles]){assert.equal(sha(await fs.readFile(f.name)),f.sha256,'source drift '+f.name);if(sourceFiles.has(f.name))assert.equal(sourceFiles.get(f.name),f.sha256);sourceFiles.set(f.name,f.sha256);}
const html=(await fs.readFile(path.join(root,'baseline/index.html'))).toString('utf8');
const matches=[...html.matchAll(/<script type="importmap">([\s\S]*?)<\/script>/g)];assert.equal(matches.length,1);const oldMap=matches[0],map=JSON.parse(oldMap[1]);
const importMapUpdates={
 '/assets/DashboardLayout-QH4rPiOH.js':{before:'/assets/DashboardLayout-workbench-dropdown-669cfca6147567e8.js',after:'/assets/'+top.outputs.js.name},
 '/assets/BusinessWorkbenchPage-DZYOmou-.js':{before:'/assets/BusinessWorkbenchPage-ci-management-948d4fff464c76cf.js',after:'/assets/'+channel.outputs.js.name},
};
for(const[key,change]of Object.entries(importMapUpdates)){assert.equal(map.imports[key],change.before,'old map drift');map.imports[key]=change.after;}
const newMap=`<script type="importmap">${JSON.stringify(map)}</script>`;
let candidate=html.replace(oldMap[0],newMap);
const insertion=`<!-- workspace-hierarchy-nav-v1:start -->\n<link rel="stylesheet" href="/assets/${top.outputs.css.name}">\n<!-- workspace-hierarchy-nav-v1:end -->\n`;
assert.ok(!html.includes('workspace-hierarchy-nav-v1:start'));const moduleTags=[...candidate.matchAll(/<script type="module"[^>]*src="\/assets\/index-CG0lkwm6\.js"[^>]*>/g)];assert.equal(moduleTags.length,1);candidate=candidate.slice(0,moduleTags[0].index)+insertion+candidate.slice(moduleTags[0].index);
assert.equal(candidate.replace(insertion,'').replace(newMap,oldMap[0]),html,'unrelated HTML bytes changed');
const restoredMap=JSON.parse(JSON.stringify(map));for(const[key,change]of Object.entries(importMapUpdates))restoredMap.imports[key]=change.before;assert.deepEqual(restoredMap,JSON.parse(oldMap[1]),'other map entries changed');
await fs.mkdir(out,{recursive:true});
for(const[dir,item]of [['navigation-overlay',top.outputs.js],['navigation-overlay',top.outputs.css],['channel-overlay',channel.outputs.js]]){const b=await fs.readFile(path.join(root,dir,item.name));assert.equal(sha(b),item.sha256);await fs.writeFile(path.join(out,item.name),b);}
await fs.writeFile(path.join(out,'candidate-index.html'),candidate);
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const manifest={schemaVersion:1,release:'20261105-workspace-hierarchy-nav-v1',generatedAt:new Date().toISOString(),sourceBase:'5b8cc0cddd5832e45eaf492fea5d37cdd08ce827',sourceCommit,baseline,
 outputs:{js:top.outputs.js,channel:channel.outputs.js,css:top.outputs.css,html:{name:'candidate-index.html',sha256:sha(candidate),bytes:Buffer.byteLength(candidate)}},importMapUpdates,
 channelInventoryBusinessFunctionsPreserved:true,originalImportsExportsPreserved:true,allOtherChunkBytesPreserved:true,allOtherHtmlBytesPreserved:true,oldCssBytesPreserved:true,noRuntimeOrServerDependencies:true,
 allowedAdditionalImports:top.allowedAdditionalImports,sourceFiles:[...sourceFiles].map(([name,sha256])=>({name,sha256})),
 deploymentToolSha256:sha(await fs.readFile(path.join(repo,'deploy/deploy-workspace-hierarchy.py'))),
 buildToolSha256:sha(await fs.readFile(path.join(repo,'deploy/build-workspace-hierarchy-overlay.mjs'))),
 channelBuildToolSha256:sha(await fs.readFile(path.join(repo,'deploy/build-channel-topnav-overlay.mjs'))),
 channelInitialSsr:channel.smoke??channel.ssrSmoke??null,
 baselineManagementCssCaptured:true,qa:{authenticatedProductionBusinessWrites:false,readOnlyCompiledModuleCheckRequired:true}
};
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({ok:true,sourceCommit,outputs:manifest.outputs,onlyTwoMappingsChanged:true,oldCssBytesPreserved:true}));
