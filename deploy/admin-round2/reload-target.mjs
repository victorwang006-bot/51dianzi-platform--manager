#!/usr/bin/env node
/** Default plan. Server-local only; no ecosystem write, pm2 save, worker, migration, backend rollback. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { RELEASE, OLD, TARGETS, hash, list, summaries, stableEqual, canonical } from './runtime-contract.mjs';
const require=createRequire(import.meta.url);
async function main() {
 const args=process.argv.slice(2);
 if(!args.length||args.includes('--help')) {console.log('Plan only: --snapshot (read-only PM2) OR --apply --authorize-production --release /opt/releases/'+RELEASE+' --side front|admin --state /opt/ops/'+RELEASE+'/state.json');return;}
 if(args.length===1&&args[0]==='--snapshot'){console.log(JSON.stringify(summaries(list())));return;}
 const expected=['--apply','--authorize-production','--release','--side','--state'];
 for(let i=0;i<args.length;i++){assert.ok(expected.includes(args[i]));if(['--release','--side','--state'].includes(args[i]))assert.ok(args[++i]);}
 const val=f=>args[args.indexOf(f)+1],side=val('--side'),release=val('--release'),statePath=val('--state');
 assert.ok(args.includes('--apply')&&args.includes('--authorize-production'));
 assert.ok(TARGETS[side]);assert.equal(release,'/opt/releases/'+RELEASE);assert.equal(statePath,'/opt/ops/'+RELEASE+'/state.json');
 const state=JSON.parse(fs.readFileSync(statePath)),coord=JSON.parse(fs.readFileSync('/opt/ops/51-project-release-coordination-20261027.json'));
 assert.equal(state.phase,'activating_'+side);assert.equal(coord.admin_round2_owner,RELEASE);assert.equal(coord.shared_release_active,true);
 const m=JSON.parse(fs.readFileSync('/opt/ops/'+RELEASE+'/manifest.json'));assert.equal(hash(fs.readFileSync('/opt/ops/'+RELEASE+'/manifest.json')),state.manifestSha256);
 const target=release+'/'+side+'/dist/index.js',api=m.apis.find(a=>a.path===side+'/dist/index.js');assert.equal(hash(fs.readFileSync(target)),api.sha256);
 const before=summaries(list());assert.equal(canonical(before),canonical(state.lastProcesses),'snapshot changed before helper');
 const contract=TARGETS[side],targetRows=list().filter(p=>p.name===contract.name).sort((a,b)=>a.pm_id-b.pm_id);
 assert.deepEqual(targetRows.map(p=>p.pm_id),contract.ids);
 for(const row of targetRows){assert.equal(row.pm2_env.pm_exec_path,OLD+'/'+side+'/dist/index.js');assert.equal(row.pm2_env.pm_cwd,contract.cwd);assert.equal(row.pm2_env.exec_mode,'cluster_mode');assert.equal(row.pm2_env.status,'online');}
 const pm2=require('/usr/local/lib/node_modules/pm2');await new Promise((resolve,reject)=>pm2.connect(e=>e?reject(e):resolve()));
 try {
  const changed=new Set();
  for(const row of targetRows){
   // Exact verified PM2 Reload.js/current_conf contract; env is passed verbatim.
   await new Promise((resolve,reject)=>pm2.Client.executeRemote('reloadProcessId',{id:row.pm_id,env:{current_conf:{pm_exec_path:target,env:row.pm2_env.env}}},e=>e?reject(e):resolve()));
   changed.add(row.pm_id);const after=summaries(list());assert.equal(after.length,before.length);
   for(const b of before){const a=after.find(x=>x.id===b.id);assert.ok(a);if(changed.has(b.id)){assert.ok(stableEqual(a,b));assert.equal(a.script,target);assert.equal(a.sha256,api.sha256);assert.equal(a.status,'online');assert.notEqual(a.pid,b.pid);assert.equal(a.restarts,b.restarts+1);}else assert.equal(canonical(a),canonical(b),'non-target identity/config/source/env drift');}
   // Publisher records complete phase; any helper failure forces STOP/manual partial-state inspection.
  }
  console.log(JSON.stringify({side,processes:summaries(list()),targetedSequentialReload:true,environmentRetained:true}));
 }finally{pm2.disconnect();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('STOP: targeted reload failed; inspect sanitized state. Never restore old API/tombstone-blind bundles.');process.exitCode=1;});
