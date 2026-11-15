#!/usr/bin/env node
'use strict';
// Existing daemon ONLY: never pm2.connect/start/restart or global reload.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT='/opt/ops/20261115-manual-reference-edit-JfFQcJM',OLD='/opt/ops/20261115-customer-origin-edit-JfFQcJM',OWNER='JfFQcJMqqFudyf4S9Egg7M',COORD='/opt/ops/51-project-release-coordination-20261027.json';
const ADMIN='/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/index.js',FRONT='/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js',PUBLIC='/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public',IDS=[190,193,194,200,191,192];
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),digest=x=>sha(JSON.stringify(canonical(x)));
function noLinks(f){for(let p=path.resolve(f);;p=path.dirname(p)){const s=fs.lstatSync(p,{throwIfNoEntry:false});assert(!s?.isSymbolicLink(),'SYMLINK_REFUSED');if(p===path.dirname(p))break;}}
function bytes(f){noLinks(f);assert(fs.statSync(f).isFile(),'REGULAR_FILE_REQUIRED');return fs.readFileSync(f);}
function pin(f,h){assert(/^[0-9a-f]{64}$/.test(h));const b=bytes(f);assert.equal(sha(b),h,'FULL_PIN_DRIFT '+f);return b;}
function inside(n){assert(/^[A-Za-z0-9._/-]+$/.test(n)&&!n.split('/').some(x=>['','.','..'].includes(x)));return ROOT+'/'+n;}
const project=r=>({id:r.pm_id,name:r.name,pid:r.pid,status:r.pm2_env.status,script:r.pm2_env.pm_exec_path,cwd:r.pm2_env.pm_cwd,execMode:r.pm2_env.exec_mode,environmentHash:digest(r.pm2_env.env||{})});
const config=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!['pid','status'].includes(k)));
function verifyRows(rows,before,owned,{allowOffline=false,changed=[]}={}){
 assert.equal(rows.length,12);assert.equal(before.length,12);assert.equal(new Set(rows.map(r=>r.id)).size,12);assert.equal(new Set(before.map(r=>r.id)).size,12);
 for(const b of before){const r=rows.find(r=>r.id===b.id);assert(r,'PROCESS_ID_REMOVED');if(!IDS.includes(b.id)){assert.deepEqual(r,b,'OTHER6_ALL_FIELDS_PID_FROZEN');continue;}
 const front=[190,193,194,200].includes(b.id);assert.equal(b.script,front?FRONT:ADMIN);assert.equal(b.name,front?'dianzi51':'dianzi51-admin');assert.equal(b.execMode,'cluster_mode');assert.equal(b.status,'online');assert(b.pid>0);assert.deepEqual(config(r),config(b),'TARGET_ENV_CWD_SCRIPT_MODE_FROZEN');if(!owned.has(b.id))assert.deepEqual(r,b,'UNOWNED_TARGET_PID_FROZEN');if(!allowOffline||!owned.has(b.id)){assert.equal(r.status,'online');assert(r.pid>0);}if(changed.includes(b.id))assert.notEqual(r.pid,b.pid,'TARGET_PID_MUST_CHANGE');}
 return rows;
}
function productionGuards(manifestSha,attempt,id,rollback){
 const m=JSON.parse(pin(inside('manifest.json'),manifestSha));assert.equal(m.contractVersion,'manual-reference-edit-release-v1');assert.equal(m.runtimeRoot,ROOT);assert.equal(m.priorRuntimeRoot,OLD);assert.equal(m.ownerTask,OWNER);assert.deepEqual(m.ownedIds,IDS);assert.deepEqual(m.apiPaths,{admin:ADMIN,front:FRONT});assert.equal(m.publicRoot,PUBLIC);assert.deepEqual(m.backendFiles.map(r=>[r.kind,r.path,r.ownedIds]),[['front',FRONT,[190,193,194,200]],['admin',ADMIN,[191,192]]]);
 function check(){
  const guard='/var/lib/51dianzi/channel-reference-manual-v1/manual-refresh-config.json';assert.deepEqual(m.manualDisabledGuard,{path:guard,expected:'absent'});noLinks(guard);assert(!fs.lstatSync(guard,{throwIfNoEntry:false}),'MANUAL_CONFIG_APPEARED');
  const s=JSON.parse(bytes(inside('activation-state.json')));assert.equal(s.manifestSha256,manifestSha);assert.equal(s.attemptId,attempt);assert.equal(s.ownerTask,OWNER);assert(['applying','recovering'].includes(s.phase));assert.equal(s.driverPid,process.ppid,'ONLY_CURRENT_LOCK_HOLDING_DRIVER_CHILD');
  const co=pin(COORD,s.coordOwnedSha256);assert(co.equals(pin(inside('coordination-owned.json'),s.coordOwnedSha256)));const c=JSON.parse(co);assert.equal(c.shared_release_active,true);assert.equal(c.window.owner_task,OWNER);assert.equal(c.window.task,OWNER);assert.equal(c.window.attemptId,attempt);assert.equal(c.window.nonce,s.nonce);assert.equal(c.window.manifestSha256,manifestSha);
  const owned=new Set();for(const r of s.intents){assert(IDS.includes(r.id));assert.equal(r.attemptId,attempt);assert.equal(r.ownerTask,OWNER);assert(['forward','rollback'].includes(r.direction));const api=m.backendFiles.find(a=>a.ownedIds.includes(r.id));assert.equal(r.apiHash,api[r.direction==='forward'?'sha256':'beforeSha256']);owned.add(r.id);}assert(owned.has(id));const last=s.intents.at(-1);assert.equal(last.id,id);assert.equal(last.direction,rollback?'rollback':'forward','EXACT_LATEST_DURABLE_DIRECTIONAL_INTENT');
  assert.deepEqual(JSON.parse(bytes(inside('release-owner.json'))),{ownerTask:OWNER,runtimeRoot:ROOT,manifestSha256:manifestSha,inputContractSha256:s.inputContractSha256,nonce:s.rootOwnershipNonce});
  for(const [n,h] of Object.entries(m.packageHashes))pin(inside(n),h);assert.equal(sha(bytes(__filename)),m.packageHashes['attached-reloader.cjs'],'ACTUAL_RELOADER_PIN');pin(inside('manifest.json'),manifestSha);
  assert.deepEqual(m.runtimeHelpers.map(r=>r.relative).sort(),['channel-reference-service.mjs','channel-reference-snapshot.json','channel-reference-worker.mjs']);for(const r of m.runtimeHelpers)pin(inside(r.relative),r.sha256);
  const apiExpected={};for(const a of m.backendFiles){apiExpected[a.path]=a[rollback?'beforeSha256':'sha256'];assert.equal(s.filesInstalled[a.kind],!rollback);pin(a.path,apiExpected[a.path]);}
  pin(PUBLIC+'/index.html',m.beforeHtmlSha256);for(const r of m.baselineAssets)pin(PUBLIC+'/'+r.relative,r.sha256);
  for(const r of [...m.legacyFrozenFiles,...m.protectedFiles,...m.protectedEnvFiles]){
   if(r.path===COORD){assert.equal(r.sha256,m.capturedCoordSha256);assert(pin(COORD,s.coordOwnedSha256).equals(co),'OWNED_COORD_DOUBLE_CHECK');}
   else if(apiExpected[r.path]){assert.equal(r.sha256,m.backendFiles.find(a=>a.path===r.path).beforeSha256,'MUTABLE_CAPTURED_GUARD_PIN_MISMATCH');pin(r.path,apiExpected[r.path]);}
   else if(r.path===PUBLIC+'/index.html'){assert.equal(r.sha256,m.beforeHtmlSha256);pin(r.path,m.beforeHtmlSha256);}
   else pin(r.path,r.sha256);
  }
  return {state:s,owned};
 }
 return {before:m.baselineProcesses,check};
}
const call=fn=>new Promise((resolve,reject)=>fn((e,v)=>e?reject(e):resolve(v)));
async function attached(pm2,fn){
 assert.equal(typeof pm2.Client?.pingDaemon,'function');assert.equal(typeof pm2.Client?.launchRPC,'function');await new Promise((resolve,reject)=>pm2.Client.pingDaemon(alive=>alive===true?resolve():reject(Error('EXISTING_PM2_DAEMON_REQUIRED_NO_STARTUP_FALLBACK'))));
 try{await call(cb=>pm2.Client.launchRPC(cb));assert.equal(typeof pm2.Client.client?.call,'function');return await fn(()=>call(cb=>pm2.Client.client.call('getMonitorData',{},cb)),id=>call(cb=>pm2.Client.client.call('reloadProcessId',{id,env:{}},cb)));}finally{pm2.disconnect();}
}
async function execute(o,{pm2,guards,sleep=ms=>new Promise(r=>setTimeout(r,ms)),clock=()=>Date.now()}={}){
 if(o.mode!=='snapshot'){assert(IDS.includes(o.id));assert(guards);guards.check();}pm2=pm2||require('/usr/local/lib/node_modules/pm2');
 return attached(pm2,async(list,reload)=>{
  if(o.mode==='snapshot'){const rows=(await list()).map(project).sort((a,b)=>a.id-b.id);assert.equal(rows.length,12);assert.equal(new Set(rows.map(r=>r.id)).size,12);return rows;}
  const {owned}=guards.check(),before=(await list()).map(project);verifyRows(before,guards.before,owned,{allowOffline:o.mode==='rollback'});const pid=before.find(r=>r.id===o.id).pid;guards.check();await reload(o.id);const until=clock()+90000;
  do{guards.check();const rows=(await list()).map(project);verifyRows(rows,guards.before,owned,{allowOffline:true});if(rows.every(r=>r.status==='online'&&r.pid>0)&&rows.find(r=>r.id===o.id).pid!==pid){verifyRows(rows,guards.before,owned,{changed:[o.id]});guards.check();return {mode:o.mode,id:o.id,method:'reloadProcessId',environmentOverlayKeys:[],beforeRPCPid:pid,processes:rows.sort((a,b)=>a.id-b.id),allOnline:true};}await sleep(250);}while(clock()<until);throw Error('EXACT_TARGET_ALL_ONLINE_TIMEOUT');
 });
}
async function main(argv=process.argv.slice(2)){
 if(argv.length===1&&argv[0]==='--snapshot'){console.log(JSON.stringify(await execute({mode:'snapshot'})));return;}
 const rollback=argv[0]==='--rollback';if(rollback)argv=argv.slice(1);assert(argv.length===6&&argv[0]==='--manifest-sha256'&&argv[2]==='--attempt'&&argv[4]==='--id');assert(/^[0-9a-f]{64}$/.test(argv[1])&&/^[A-Za-z0-9_-]{16,96}$/.test(argv[3])&&/^(190|191|192|193|194|200)$/.test(argv[5]));const id=Number(argv[5]);console.log(JSON.stringify(await execute({mode:rollback?'rollback':'forward',id},{guards:productionGuards(argv[1],argv[3],id,rollback)})));
}
module.exports={execute,attached,verifyRows,productionGuards,project,digest,canonical,IDS,main};
if(require.main===module)main().catch(e=>{console.error('EXACT_EXISTING_DAEMON_RELOAD_ABORT: '+e.message);process.exitCode=1;});
