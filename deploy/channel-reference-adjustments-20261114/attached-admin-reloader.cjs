#!/usr/bin/env node
'use strict';
// New namespace only. Never calls pm2.connect/start/restart/reload-all or old wrapper.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT='/opt/ops/20261114-channel-reference-adjustments-YFqDo2A',COORD='/opt/ops/51-project-release-coordination-20261027.json';
const ADMIN='/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/index.js',IDS=[191,192];
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function bytes(f){for(let p=path.resolve(f);;p=path.dirname(p)){assert(!fs.lstatSync(p).isSymbolicLink(),'SYMLINK_REFUSED');if(p===path.dirname(p))break;}assert(fs.statSync(f).isFile());return fs.readFileSync(f);}
function pin(f,h){assert(/^[0-9a-f]{64}$/.test(h));const b=bytes(f);assert.equal(sha(b),h,'BYTE_PIN_DRIFT '+f);return b;}
function inside(n){assert(/^[A-Za-z0-9._/-]+$/.test(n)&&!n.split('/').some(s=>['','.','..'].includes(s)));return ROOT+'/'+n;}
const project=row=>({id:row.pm_id,name:row.name,pid:row.pid,status:row.pm2_env.status,script:row.pm2_env.pm_exec_path,cwd:row.pm2_env.pm_cwd,execMode:row.pm2_env.exec_mode,environmentHash:digest(row.pm2_env.env||{})});
const config=row=>Object.fromEntries(Object.entries(row).filter(([k])=>!['pid','status'].includes(k)));
function verifyRows(current,before,owned,{allowOffline=false,changed=[]}={}){
 assert.equal(before.length,12);assert.equal(current.length,12);assert.equal(new Set(current.map(x=>x.id)).size,12);assert.equal(new Set(before.map(x=>x.id)).size,12);
 for(const old of before){const row=current.find(x=>x.id===old.id);assert(row,'PROCESS_ID_REMOVED');if(!IDS.includes(old.id)){assert.deepEqual(row,old,'NON_TARGET_PROCESS_FROZEN '+old.id);continue;}
 assert.equal(old.name,'dianzi51-admin');assert.equal(old.script,ADMIN);assert.equal(old.execMode,'cluster_mode');assert.equal(old.status,'online');assert(old.pid>0);assert.deepEqual(config(row),config(old),'TARGET_CONFIG_ENV_CWD_SCRIPT_FROZEN');
 if(!owned.has(old.id))assert.deepEqual(row,old,'UNINTENDED_TARGET_CHANGED');if(!allowOffline||!owned.has(old.id)){assert.equal(row.status,'online');assert(row.pid>0);}if(changed.includes(old.id))assert.notEqual(row.pid,old.pid,'TARGET_PID_NOT_CHANGED');
 }
 return current;
}
function ownedIds(state,manifest,attempt,rollback){
 assert.equal(state.attemptId,attempt);assert.equal(state.ownerTask,manifest.ownerTask);assert(Array.isArray(state.intents));const owned=new Set();
 for(const x of state.intents){assert.equal(x.attemptId,attempt);assert.equal(x.ownerTask,state.ownerTask);assert(IDS.includes(x.id));assert(['forward','rollback'].includes(x.direction));assert.equal(x.apiHash,manifest.backendFiles[0][x.direction==='forward'?'sha256':'beforeSha256']);owned.add(x.id);}
 return owned;
}
function productionGuards(manifestSha,attempt,id,rollback){
 const manifest=JSON.parse(pin(inside('manifest.json'),manifestSha));assert.equal(manifest.contractVersion,'channel-reference-adjustments-v1');assert.equal(manifest.runtimeRoot,ROOT);assert.equal(manifest.backendFiles.length,1);const backend=manifest.backendFiles[0];assert.equal(backend.path,ADMIN);assert.deepEqual(backend.ownedIds,IDS);
 function check(){
 const state=JSON.parse(bytes(inside('activation-state.json')));assert.equal(state.manifestSha256,manifestSha);assert.equal(state.attemptId,attempt);assert.equal(state.ownerTask,manifest.ownerTask);assert(['applying','recovering','recovery-required'].includes(state.phase));
 const coord=pin(COORD,state.coordOwnedSha256);assert(coord.equals(bytes(inside('coordination-owned.json'))),'FULL_COORDINATION_BYTES_CAS');const co=JSON.parse(coord);assert.equal(co.shared_release_active,true);assert.equal(co.window.owner_task,state.ownerTask);assert.equal(co.window.task,state.ownerTask);assert.equal(co.window.attemptId,attempt);assert.equal(co.window.nonce,state.nonce);assert.equal(co.window.manifestSha256,manifestSha);
 const owned=ownedIds(state,manifest,attempt,rollback);assert(owned.has(id),'PERSISTED_INTENT_REQUIRED');assert(state.intents.some(x=>x.id===id&&x.direction===(rollback?'rollback':'forward')),'DIRECTIONAL_INTENT_REQUIRED');
 assert.deepEqual(manifest.runtimeHelpers.map(x=>x.relative).sort(),['channel-reference-service.mjs','channel-reference-snapshot.json']);for(const x of manifest.runtimeHelpers)pin(inside(x.relative),x.sha256);
 const owner=JSON.parse(bytes(inside('release-owner.json')));assert.deepEqual(owner,{ownerTask:state.ownerTask,runtimeRoot:ROOT,manifestSha256:manifestSha,inputContractSha256:state.inputContractSha256,nonce:state.rootOwnershipNonce},'ROOT_OWNERSHIP_NONCE');
 for(const x of manifest.baselineAssets)pin(manifest.publicRoot+'/'+x.relative,x.sha256);pin(manifest.publicRoot+'/index.html',manifest.beforeHtmlSha256);pin(manifest.apiPaths.front,manifest.untouchedFrontApiSha256);
 pin(ADMIN,backend[rollback?'beforeSha256':'sha256']);pin(inside('manifest.json'),manifestSha);for(const [n,h] of Object.entries(manifest.packageHashes))pin(inside(n),h);for(const x of [...manifest.protectedFiles,...manifest.legacyFrozenFiles])pin(x.path,x.sha256);
 return {state,owned};
 }
 return {before:manifest.baselineProcesses,check};
}
function promiseCall(fn){return new Promise((resolve,reject)=>fn((err,value)=>err?reject(err):resolve(value)));}
async function attached(pm2,fn){
 assert.equal(typeof pm2.Client?.pingDaemon,'function');assert.equal(typeof pm2.Client?.launchRPC,'function');
 await new Promise((resolve,reject)=>pm2.Client.pingDaemon(alive=>alive===true?resolve():reject(Error('EXISTING_PM2_DAEMON_REQUIRED'))));
 try{await promiseCall(cb=>pm2.Client.launchRPC(cb));assert.equal(typeof pm2.Client.client?.call,'function');const list=()=>promiseCall(cb=>pm2.Client.client.call('getMonitorData',{},cb));return await fn(list,(id)=>promiseCall(cb=>pm2.Client.client.call('reloadProcessId',{id,env:{}},cb)));}finally{pm2.disconnect();}
}
async function execute(options,{pm2,guards,sleep=ms=>new Promise(r=>setTimeout(r,ms)),clock=()=>Date.now()}={}){
 if(options.mode!=='snapshot'){assert(IDS.includes(options.id));assert(guards);guards.check();}
 // Production loads the only allowed existing-daemon API after byte checks.
 pm2=pm2||require('/usr/local/lib/node_modules/pm2');
 return attached(pm2,async(list,reload)=>{
 if(options.mode==='snapshot'){const rows=(await list()).map(project).sort((a,b)=>a.id-b.id);assert.equal(rows.length,12);assert.equal(new Set(rows.map(x=>x.id)).size,12);return {mode:'snapshot',processes:rows,attachedExistingDaemonOnly:true};}
 const {owned}=guards.check(),beforeRPC=(await list()).map(project);verifyRows(beforeRPC,guards.before,owned,{allowOffline:options.mode==='rollback'});const beforePid=beforeRPC.find(x=>x.id===options.id).pid;guards.check();
 await reload(options.id);const deadline=clock()+90_000;let after;
 do{guards.check();after=(await list()).map(project);verifyRows(after,guards.before,owned,{allowOffline:true});if(after.every(x=>x.status==='online'&&x.pid>0)&&after.find(x=>x.id===options.id).pid!==beforePid){verifyRows(after,guards.before,owned,{changed:[options.id]});guards.check();return {mode:options.mode,id:options.id,method:'reloadProcessId',environmentOverlayKeys:[],beforeRPCPid:beforePid,processes:after.sort((a,b)=>a.id-b.id),allOnline:true};}await sleep(250);}while(clock()<deadline);
 throw Error('EXACT_TARGET_ALL_ONLINE_TIMEOUT');
 });
}
async function main(argv=process.argv.slice(2)){
 if(argv.length===1&&argv[0]==='--snapshot'){const r=await execute({mode:'snapshot'});console.log(JSON.stringify(r.processes));return;}
 const rollback=argv[0]==='--rollback';if(rollback)argv=argv.slice(1);assert(argv.length===6&&argv[0]==='--manifest-sha256'&&argv[2]==='--attempt'&&argv[4]==='--id');assert(/^[0-9a-f]{64}$/.test(argv[1])&&/^[A-Za-z0-9_-]{16,96}$/.test(argv[3])&&/^(191|192)$/.test(argv[5]));const id=Number(argv[5]);const result=await execute({mode:rollback?'rollback':'forward',id},{guards:productionGuards(argv[1],argv[3],id,rollback)});console.log(JSON.stringify(result));
}
module.exports={main,execute,attached,verifyRows,ownedIds,project,digest,config,productionGuards};
if(require.main===module)main().catch(e=>{console.error('EXACT_ATTACHED_RELOAD_ABORT: '+e.message);process.exitCode=1;});
