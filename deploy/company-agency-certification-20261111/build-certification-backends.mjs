import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const BASE='/home/ubuntu/51-inspection';
const require=createRequire(path.join(BASE,'platform-github/package.json'));
const {build}=require('esbuild');
const OUT=path.join(BASE,'certification-candidate-backends');
fs.mkdirSync(OUT,{recursive:true});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const records=[];
for(const [side,repo] of [['front','platform-github'],['admin','manager-github']]){
 const real=path.join(BASE,repo),before=path.join(BASE,'certification-source-before',side);
 const roots=[['before',before],['after',real]];
 for(const [state,root] of roots){
  const outfile=path.join(OUT,`${side}-${state}-index.js`);
  const options={absWorkingDir:root,entryPoints:['server/_core/index.ts'],platform:'node',packages:'external',bundle:true,format:'esm',outfile,metafile:true,nodePaths:[path.join(real,'node_modules')],logLevel:'warning'};
  if(side==='admin')options.external=['./vite-dev'];
  if(side==='front')options.plugins=[{name:'bundle-address-region-dictionary',setup(builder){builder.onResolve({filter:/^@province-city-china\/level\/level\.json$/},()=>({path:require.resolve('@province-city-china/level/level.json')}));}}];
  const result=await build(options);execFileSync('node',['--check',outfile]);
  const sourceInputs=Object.keys(result.metafile.inputs).filter(input=>!input.includes('node_modules')).map(input=>{const file=path.resolve(root,input);return{path:path.relative(root,file),sha256:sha(fs.readFileSync(file))};});
  records.push({side,state,entry:'server/_core/index.ts',file:path.basename(outfile),sha256:sha(fs.readFileSync(outfile)),size:fs.statSync(outfile).size,sourceInputs,externalImports:result.metafile.outputs[Object.keys(result.metafile.outputs)[0]].imports.filter(input=>input.external).map(input=>input.path)});
  console.log(`${side} ${state} parsed, ${sourceInputs.length} source inputs, sha ${records.at(-1).sha256}`,true);
 }
}
const sourceDeltas=[];
for(const side of ['front','admin']){
 const old=records.find(r=>r.side===side&&r.state==='before'),fresh=records.find(r=>r.side===side&&r.state==='after'),oldMap=new Map(old.sourceInputs.map(r=>[r.path,r.sha256]));
 sourceDeltas.push({side,changedBackendInputs:fresh.sourceInputs.filter(r=>oldMap.get(r.path)!==r.sha256),newImports:fresh.externalImports.filter(x=>!old.externalImports.includes(x))});
}
const manifest={status:'offline-source-bundles-built-not-production-candidates',buildTool:'existing-esbuild-settings',records,sourceDeltas,notPerformed:['No service startup or DB access','No production dependency install','No environment config change','No worker build or replacement','No SSH upload or publish'],limitations:['Production backend provenance still requires fresh ECS access and source/bundle comparison','Only source-before/source-after local bundles; must not overwrite production baseline without exact approval']};
fs.writeFileSync(path.join(OUT,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(sourceDeltas,null,2));
