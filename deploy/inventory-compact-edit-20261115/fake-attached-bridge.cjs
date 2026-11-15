#!/usr/bin/env node
'use strict';
// Offline fixture bridge only. Never reads a production path or imports PM2.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
async function main(){
 const [base,mh,attempt,target,direction,fail]=process.argv.slice(2);assert(base.startsWith('/home/ubuntu/work/inventory-compact-edit-20261115/deploy/control-tests/driver-fixture-'));const id=Number(target);assert([190,193,194,200].includes(id));
 const map=f=>path.join(base,f.replace(/^\//,''));const fakeFS={lstatSync:(f,o)=>fs.lstatSync(map(f),o),statSync:f=>fs.statSync(map(f)),readFileSync:f=>fs.readFileSync(map(f))};
 const module={exports:{}},ctx={module,exports:module.exports,require:n=>n==='node:fs'?fakeFS:require(n),console,Buffer,setTimeout,process:{argv:[]}};ctx.require.main={};vm.runInNewContext(fs.readFileSync(__dirname+'/attached-admin-reloader.cjs','utf8'),ctx,{filename:'actual-v3-attached-fixture.cjs'});const R=module.exports;
 const projected=JSON.parse(fs.readFileSync(path.join(base,'bridge-processes.json')));const rows=projected.map(r=>({pm_id:r.id,name:r.name,pid:r.pid,pm2_env:{status:r.status,pm_exec_path:r.script,pm_cwd:r.cwd,exec_mode:r.execMode,env:{FIXTURE:String(r.id)}}}));
 const pm2={disconnect(){},Client:{pingDaemon:cb=>cb(true),launchRPC:cb=>cb(null),client:{call(method,args,cb){if(method==='getMonitorData')return cb(null,rows);assert.equal(method,'reloadProcessId');assert.equal(args.id,id);assert.deepEqual(Object.keys(args.env),[]);if(fail==='yes')return cb(Error('FAKE_RPC_FAILURE_'+id));rows.find(r=>r.pm_id===id).pid+=10000;cb(null,{success:true});}}}};
 const guards=R.productionGuards(mh,attempt,id,direction==='rollback');const result=await R.execute({mode:direction,id},{pm2,guards});console.log(JSON.stringify(result.processes));
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1});
