#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { RELEASE, OLD, TARGETS, hash, list } from './runtime-contract.mjs';
const args=process.argv.slice(2);
if(!args.length||args.includes('--help')) console.log('Plan only. Explicit --apply --authorize-production required; parent-reviewed CREATE admin_staff_archives only. No ENV read in plan.');
else {
 try {
  assert.deepEqual(args,['--apply','--authorize-production']);
  const pkg='/opt/ops/'+RELEASE,state=JSON.parse(fs.readFileSync(pkg+'/state.json')),m=JSON.parse(fs.readFileSync(pkg+'/manifest.json')),coord=JSON.parse(fs.readFileSync('/opt/ops/51-project-release-coordination-20261027.json'));
  assert.equal(state.phase,'migrating');assert.equal(coord.shared_release_active,true);assert.equal(coord.admin_round2_owner,RELEASE);assert.equal(hash(fs.readFileSync(pkg+'/manifest.json')),state.manifestSha256);
  for(const a of m.ddl) assert.equal(hash(fs.readFileSync('/opt/releases/'+RELEASE+'/'+a.path)),a.sha256);
  const rows=list().filter(x=>x.name===TARGETS.admin.name);assert.deepEqual(rows.map(x=>x.pm_id).sort((a,b)=>a-b),TARGETS.admin.ids);
  for(const p of rows) {assert.equal(p.pm2_env.pm_exec_path,OLD+'/admin/dist/index.js');assert.equal(p.pm2_env.status,'online');}
  const url=rows[0].pm2_env.env?.DATABASE_URL;assert.ok(typeof url==='string'&&url.length);for(const p of rows) assert.equal(p.pm2_env.env?.DATABASE_URL,url);
  // The only credential transfer is this transient child environment. It is never written/printed.
  const env={PATH:process.env.PATH,HOME:'/nonexistent',NODE_ENV:'production',DATABASE_URL:url};
  const result=spawnSync(process.execPath,['/opt/releases/'+RELEASE+'/admin/scripts/apply-admin-staff-archives.mjs','--apply'],{env,encoding:'utf8',timeout:120000,maxBuffer:1024*1024});
  assert.equal(result.status,0);assert.ok(!result.error);const receipt=JSON.parse(result.stdout.trim());assert.equal(receipt.ok,true);assert.equal(receipt.table,'admin_staff_archives');assert.equal(receipt.businessDataWrites,false);assert.equal(receipt.existingTablesChanged,false);assert.equal(receipt.sqlSha256,m.ddl.find(a=>a.path.endsWith('.sql')).sha256);
  console.log(JSON.stringify(receipt));
 }catch{console.error('STOP: schema-only phase failed; output/credentials suppressed. Inspect sidecar schema; no automatic rollback or replay.');process.exitCode=1;}
}
