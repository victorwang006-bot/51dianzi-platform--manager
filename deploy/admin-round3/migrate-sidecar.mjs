#!/usr/bin/env node
/** Front PM2 in-memory ENV only. No ecosystem evaluation, .env, admin archive or business DML. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RELEASE, OLD, TARGETS, hash, list } from './runtime-contract.mjs';
import { projectionContract, validateProjectionSql } from './lib.mjs';
export function frontUrl(rows,key) {
 const target=rows.filter(x=>x.name===TARGETS.front.name).sort((a,b)=>a.pm_id-b.pm_id);assert.deepEqual(target.map(x=>x.pm_id),TARGETS.front.ids);
 for(const p of target){assert.equal(p.pm2_env.pm_exec_path,OLD+'/front/dist/index.js');assert.equal(p.pm2_env.pm_cwd,TARGETS.front.cwd);assert.equal(p.pm2_env.status,'online');}
 const url=target[0].pm2_env.env?.[key];assert.ok(typeof url==='string'&&url.length);for(const p of target)assert.equal(p.pm2_env.env?.[key],url);return url;
}
export function safeReceipt(receipt,p,sqlSha256) {
 assert.equal(receipt.ok,true);assert.deepEqual([...receipt.tables].sort(),[...p.tables].sort());assert.equal(receipt.businessDataWrites,false);assert.equal(receipt.existingTablesChanged,false);assert.equal(receipt.sqlSha256,sqlSha256);
 return {ok:true,tables:p.tables,sqlSha256,businessDataWrites:false,existingTablesChanged:false,credentialSource:'actual-front-PM2-memory',envFilesLoaded:false,productionBrowserVerified:false};
}
async function main() {
 const args=process.argv.slice(2);if(!args.length||args.includes('--help')){console.log('Plan only. Requested backend runner/JSON receipt pending until release-config is ready. Explicit --apply --authorize-production + parent hash review; CREATE only front projection tables. No PM2/DB/ENV read in plan.');return;}
 assert.deepEqual(args,['--apply','--authorize-production']);assert.equal(process.geteuid(),0);
 const p=projectionContract(),pkg='/opt/ops/'+RELEASE,state=JSON.parse(fs.readFileSync(pkg+'/state.json')),m=JSON.parse(fs.readFileSync(pkg+'/manifest.json')),coord=JSON.parse(fs.readFileSync('/opt/ops/51-project-release-coordination-20261027.json')),q=JSON.parse(fs.readFileSync(pkg+'/qa-approval.json'));
 assert.equal(state.phase,'migrating');assert.equal(coord.shared_release_active,true);assert.equal(coord.admin_round3_owner,RELEASE);assert.equal(hash(fs.readFileSync(pkg+'/manifest.json')),state.manifestSha256);
 assert.equal(q.manifestSha256,state.manifestSha256);assert.equal(q.ddlReviewApproved,true);assert.equal(hash(fs.readFileSync(pkg+'/qa-approval.json')),state.qaApprovalSha256);assert.deepEqual(q.ddlArtifactHashes,Object.fromEntries(m.ddl.map(a=>[a.path,a.sha256])));assert.deepEqual(m.projection,p);
 for(const a of m.ddl)assert.equal(hash(fs.readFileSync('/opt/releases/'+RELEASE+'/'+a.path)),a.sha256);
 const sqlSha256=m.ddl.find(a=>a.path==='front/'+p.sql).sha256;validateProjectionSql(fs.readFileSync('/opt/releases/'+RELEASE+'/front/'+p.sql),p);
 const url=frontUrl(list(),p.dbEnvKey);const env={PATH:process.env.PATH,HOME:'/nonexistent',NODE_ENV:'production',[p.dbEnvKey]:url};
 const result=spawnSync(process.execPath,['/opt/releases/'+RELEASE+'/front/'+p.runner,...p.runnerArgs],{env,encoding:'utf8',timeout:120000,maxBuffer:1024*1024});assert.equal(result.status,0);assert.ok(!result.error);
 console.log(JSON.stringify(safeReceipt(JSON.parse(result.stdout.trim()),p,sqlSha256)));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('STOP: front schema-only phase failed; credentials/output suppressed. Preserve partial schema/new APIs; no automatic rollback/replay.');process.exitCode=1;});
