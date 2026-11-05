#!/usr/bin/env node
/** Ecosystems are opaque protected bytes, never loaded or edited. Only PM2's root dump is boot authority. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { RELEASE, OLD, TARGETS, hash, canonical, list, summaries } from './runtime-contract.mjs';
export const DUMP='/root/.pm2/dump.pm2', UNIT='pm2-root.service';
export const CONFIGS=Object.freeze({
 '/opt/config/dianzi51/ecosystem.config.cjs':'837867818d88fca6d1231d114f994596f47ec05b00476dcea803902682496139',
 '/opt/config/dianzi51-admin/ecosystem.config.cjs':'0ef5729de562e443c1cfc979b6fcab04e9bbb0c1faa9d5b7e4a8ca1504f7035f',
 '/opt/config/dianzi51-admin/ecosystem.config.production.cjs':'e5a88fd1495af4b3ac6f6a536cbdfe1816614fde77550c71323304daf3536142',
});
const commandEnv=()=>({...Object.fromEntries(['PATH','LANG','LC_ALL'].filter(k=>process.env[k]).map(k=>[k,process.env[k]])),HOME:'/root',PM2_HOME:'/root/.pm2'});
function captured(command,args) {const r=spawnSync(command,args,{env:commandEnv(),encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024});assert.equal(r.status,0,'read/save command failed');assert.ok(!r.error);return r.stdout;}
export function fileFingerprint(p) {
 const s=fs.lstatSync(p,{bigint:true});assert.ok(s.isFile()&&!s.isSymbolicLink(),'protected file must be regular');
 assert.ok(fs.constants.O_NOATIME&&fs.constants.O_NOFOLLOW,'Linux no-atime/no-follow required');
 const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOATIME|fs.constants.O_NOFOLLOW);let bytes;
 try {const opened=fs.fstatSync(fd,{bigint:true});assert.equal(opened.ino,s.ino);assert.equal(opened.dev,s.dev);bytes=fs.readFileSync(fd);}finally{fs.closeSync(fd);}
 const out={path:p,realpath:fs.realpathSync(p),sha256:hash(bytes)};
 const after=fs.lstatSync(p,{bigint:true});
 for(const k of ['mode','uid','gid','size','atimeNs','mtimeNs','ctimeNs','birthtimeNs','ino','dev']){out[k]=String(s[k]);assert.equal(after[k],s[k],'protected file changed during hash');}
 return out;
}
export function configSummary(fingerprints) {
 // Fingerprints only: no vm, require(), AST evaluation, env values or config scripts in receipts.
 const sha256=Object.fromEntries(fingerprints.map(f=>[f.path,f]));return {sha256,semanticSha256:hash(canonical(sha256)),configs:[]};
}
export function bootSummary(unitBytes,showBytes) {
 const props=Object.fromEntries(showBytes.toString().trim().split('\n').filter(Boolean).map(line=>{const i=line.indexOf('=');assert.ok(i>0);return [line.slice(0,i),line.slice(i+1)];}));
 assert.equal(props.LoadState,'loaded');assert.equal(props.UnitFileState,'enabled');assert.equal(props.User,'root');
 for(const k of ['EnvironmentFiles','PassEnvironment','UnsetEnvironment','ExecStartPre','ExecStartPost'])assert.equal(props[k]??'','','unsupported boot override');
 const command='/usr/local/lib/node_modules/pm2/bin/pm2';
 // Check disk content too: effective properties alone miss a pending, un-reloaded boot change.
 let section='';const disk={};
 for(let line of unitBytes.toString().replace(/\\\r?\n\s*/g,' ').split('\n')){
  line=line.trim();if(!line||line.startsWith('#')||line.startsWith(';'))continue;
  if(/^\[[^\]]+\]$/.test(line)){section=line;continue;}if(section!=='[Service]')continue;
  const i=line.indexOf('=');assert.ok(i>0,'unsupported unit syntax');const k=line.slice(0,i).trim(),v=line.slice(i+1).trim();
  if(['ExecStart','ExecStartPre','ExecStartPost','EnvironmentFile','PassEnvironment','UnsetEnvironment','Environment'].includes(k)){if(!v)disk[k]=[];else(disk[k]??=[]).push(v);}else disk[k]=v;
 }
 assert.deepEqual(disk.ExecStart,[command+' resurrect'],'on-disk boot must run exact pm2 resurrect');assert.equal(disk.User,'root');
 for(const k of ['ExecStartPre','ExecStartPost','EnvironmentFile','PassEnvironment','UnsetEnvironment'])assert.equal(disk[k]?.length??0,0,'unsupported on-disk boot override');
 assert.match(props.ExecStart,new RegExp('^\\{ path='+command+' ; argv\\[\\]='+command+' resurrect ;[^{}]*\\}$'),'boot must run exact pm2 resurrect, no ecosystem/wrapper');
 const tokens=props.Environment.match(/"(?:\\.|[^"\\])*"|[^\s"]+/g)||[];
 const env={};for(let token of tokens){if(token.startsWith('"'))token=JSON.parse(token);const i=token.indexOf('=');assert.ok(i>0,'invalid unit environment');const k=token.slice(0,i);assert.ok(!(k in env),'duplicate unit environment');env[k]=token.slice(i+1);}
 assert.ok(env.PM2_HOME===undefined||env.PM2_HOME==='/root/.pm2','boot dump home mismatch');
 assert.ok(env.HOME===undefined||env.HOME==='/root','boot root HOME mismatch');
 const diskEnv={};for(const line of disk.Environment||[])for(let token of line.match(/"(?:\\.|[^"\\])*"|[^\s"]+/g)||[]){if(token.startsWith('"'))token=JSON.parse(token);const i=token.indexOf('=');assert.ok(i>0);diskEnv[token.slice(0,i)]=token.slice(i+1);}
 for(const k of ['PM2_HOME','HOME'])assert.equal(diskEnv[k],env[k],'pending on-disk boot home change');
 // User=root defaults to /root/.pm2 when PM2_HOME is absent. Entire effective show output is hash-only.
 return {unit:UNIT,sha256:hash(unitBytes),effectiveSha256:hash(showBytes),kind:'pm2-resurrect',user:'root',pm2Home:'/root/.pm2',dumpPath:DUMP,execStart:command+' resurrect'};
}
function bootCheck() {
 const unit=captured('systemctl',['cat','--no-pager',UNIT]);
 const props=['LoadState','UnitFileState','User','Environment','EnvironmentFiles','PassEnvironment','UnsetEnvironment','ExecStart','ExecStartPre','ExecStartPost'];
 return bootSummary(Buffer.from(unit),Buffer.from(captured('systemctl',['show','--all','--no-pager',...props.map(k=>'--property='+k),UNIT])));
}
const sideOf=e=>Object.keys(TARGETS).find(s=>TARGETS[s].name===e.name);
// Only designated APIs may change their entry and unavoidable reload PID/counter fields.
// Unknown keys, launch settings, application ENV, and ALL non-target rows remain hash-bound.
const bookkeeping=new Set(['pid','pm_uptime','created_at','restart_time','unstable_restarts']);
function normalized(e) {
 const side=sideOf(e);if(!side)return e;
 const allowed=[OLD+'/', '/opt/releases/'+RELEASE+'/'].map(root=>root+side+'/dist/index.js');
 assert.ok(allowed.includes(e.pm_exec_path),'unknown target entry');
 if(e.env?.pm_exec_path!==undefined)assert.ok(allowed.includes(e.env.pm_exec_path),'unknown target env entry bookkeeping');
 const norm=scope=>Object.fromEntries(Object.entries(scope).filter(([k])=>!bookkeeping.has(k)).map(([k,v])=>[k,k==='pm_exec_path'?'<'+side+'-target>':v]));
 const out=norm(e);delete out.axm_monitor;if(e.env)out.env=norm(e.env);return out;
}
export function dumpSummary(bytes) {
 const rows=JSON.parse(bytes);assert.ok(Array.isArray(rows));const scripts={},targetRows={};
 const norm=rows.map(e=>{assert.ok(e&&typeof e==='object'&&!Array.isArray(e));const side=sideOf(e);if(side){assert.equal(typeof e.pm_exec_path,'string');(scripts[side]??=[]).push(e.pm_exec_path);const key=e.instance_var||'NODE_APP_INSTANCE';(targetRows[side]??=[]).push({id:e.pm_id??null,instance:e[key]??e.env?.[key]??null,script:e.pm_exec_path});}return normalized(e);}).sort((a,b)=>canonical(a).localeCompare(canonical(b)));
 for(const v of Object.values(scripts))v.sort();for(const v of Object.values(targetRows))v.sort((a,b)=>canonical(a).localeCompare(canonical(b)));
 const content=rows.map(e=>sideOf(e)?Object.fromEntries(Object.entries(e).filter(([k])=>k!=='axm_monitor')):e).sort((a,b)=>canonical(a).localeCompare(canonical(b)));
 return {sha256:hash(bytes),contentSha256:hash(canonical(content)),semanticSha256:hash(canonical(norm)),scripts,targetRows,rowCount:rows.length};
}
export function savedRows(rows) {
 // PM2 save serializes pm2_env, omitting modules and these daemon-only fields.
 return rows.filter(p=>!p.pm2_env.pmx_module).map(p=>{const e={...p.pm2_env};delete e.instances;delete e.pm_id;delete e.prev_restart_delay;return e;});
}
export function verifyScripts(dump,approvedSides) {
 for(const [side,t] of Object.entries(TARGETS)){
  const expected=(approvedSides.includes(side)?'/opt/releases/'+RELEASE:OLD)+'/'+side+'/dist/index.js';
  assert.deepEqual(dump.scripts[side],Array(t.ids.length).fill(expected),'dump target paths/count mismatch');
  const rows=dump.targetRows[side];assert.equal(rows.length,t.ids.length);
  if(rows.every(r=>r.id!==null))assert.deepEqual(rows.map(r=>r.id).sort((a,b)=>a-b),t.ids,'dump target IDs mismatch');
  else {assert.ok(rows.every(r=>r.id===null),'mixed dump identity');assert.ok(rows.every(r=>r.instance!==null),'dump instance identity missing');assert.equal(new Set(rows.map(r=>canonical(r.instance))).size,t.ids.length,'duplicate dump instance');}
 }
}
export function persistenceGuard(current,before,last) {
 assert.ok(before&&last,'persistence state absent');
 for(const key of ['ecosystem','bootAuthority']){assert.equal(canonical(current[key]),canonical(before[key]),'protected boot/config drift');assert.equal(canonical(current[key]),canonical(last[key]),'last boot/config drift');}
 assert.equal(current.dump.semanticSha256,before.dump.semanticSha256,'dump launch/env/non-target drift');
 assert.equal(canonical(current),canonical(last),'persistence changed between phases');
}
export const snapshot=()=>{
 const fingerprints=Object.entries(CONFIGS).map(([p,h])=>{const f=fileFingerprint(p);assert.equal(f.sha256,h,'captured ecosystem bytes drift');return f;});
 const bootAuthority=bootCheck(),st=fs.lstatSync(DUMP);assert.ok(st.isFile()&&!st.isSymbolicLink(),'boot dump must be regular');
 return {ecosystem:configSummary(fingerprints),bootAuthority,dump:dumpSummary(fs.readFileSync(DUMP))};
};
export function checkBoot(state,side,ops={snapshot,list,summaries}) {
 const previous=side==='front'?[]:['front'],current=ops.snapshot();persistenceGuard(current,state.beforePersistence,state.lastPersistence);verifyScripts(current.dump,previous);
 const rows=ops.list();assert.equal(canonical(ops.summaries(rows)),canonical(state.lastProcesses),'actual PM2 drift before reload');
 const expected=dumpSummary(Buffer.from(JSON.stringify(savedRows(rows))));verifyScripts(expected,previous);
 assert.equal(expected.semanticSha256,state.beforePersistence.dump.semanticSha256,'live launch/env/non-target differs before reload');return current;
}
export function saveFreshDump(state,side,ops={snapshot,list,summaries,save:()=>captured('pm2',['save'])}) {
 const previous=side==='front'?[]:['front'],approved=[...previous,side];
 const before=ops.snapshot();persistenceGuard(before,state.beforePersistence,state.lastPersistence);verifyScripts(before.dump,previous);
 const rows=ops.list();assert.equal(canonical(ops.summaries(rows)),canonical(state.lastProcesses),'actual current PM2 snapshot drift');
 for(const [s,t] of Object.entries(TARGETS)){
  const target=rows.filter(p=>p.name===t.name).sort((a,b)=>a.pm_id-b.pm_id);
  assert.deepEqual(target.map(p=>p.pm_id),t.ids);assert.ok(target.every(p=>p.pm2_env.pm_exec_path===(approved.includes(s)?'/opt/releases/'+RELEASE:OLD)+'/'+s+'/dist/index.js'&&p.pm2_env.status==='online'),'unapproved live target path/status');
 }
 const expected=dumpSummary(Buffer.from(JSON.stringify(savedRows(rows))));verifyScripts(expected,approved);
 assert.equal(expected.semanticSha256,state.beforePersistence.dump.semanticSha256,'live launch/env/non-target cannot be persisted');
 ops.save();const after=ops.snapshot();
 for(const key of ['ecosystem','bootAuthority'])assert.equal(canonical(after[key]),canonical(before[key]),'save changed protected boot/config');
 assert.equal(after.dump.semanticSha256,expected.semanticSha256,'fresh dump differs from actual live config/env');
 assert.equal(after.dump.semanticSha256,state.beforePersistence.dump.semanticSha256);verifyScripts(after.dump,approved);
 // PM2 save should serialize exactly the projected live rows, not stale env/path or unknown fields.
 assert.equal(after.dump.contentSha256,expected.contentSha256,'fresh dump contents differ from live rows');
 assert.equal(canonical(ops.summaries(ops.list())),canonical(state.lastProcesses),'PM2 drift during save');return after;
}
async function main() {
 const args=process.argv.slice(2);if(!args.length||args.includes('--help')){console.log('Plan only. --snapshot hashes three opaque configs, systemd resurrect authority and dump. Explicit --apply --authorize-production --side front|admin --boot-check (legacy --config is validation-only) OR --save. No ecosystem writes.');return;}
 // Fix the helper daemon namespace only; never application ENV. All commands capture output privately.
 process.env.HOME='/root';process.env.PM2_HOME='/root/.pm2';
 if(args.length===1&&args[0]==='--snapshot'){console.log(JSON.stringify(snapshot()));return;}
 assert.equal(args.length,5);assert.equal(args[0],'--apply');assert.equal(args[1],'--authorize-production');assert.equal(args[2],'--side');const side=args[3];assert.ok(TARGETS[side]);assert.ok(['--boot-check','--config','--save'].includes(args[4]));assert.equal(process.geteuid(),0);
 const pkg='/opt/ops/'+RELEASE,state=JSON.parse(fs.readFileSync(pkg+'/state.json')),coord=JSON.parse(fs.readFileSync('/opt/ops/51-project-release-coordination-20261027.json'));
 assert.equal(state.phase,'activating_'+side);assert.equal(coord.admin_round3_owner,RELEASE);assert.equal(coord.shared_release_active,true);
 if(args[4]==='--save')console.log(JSON.stringify(saveFreshDump(state,side)));
 else console.log(JSON.stringify(checkBoot(state,side)));
}
if(process.argv[1]&&path.resolve(process.argv[1])===new URL(import.meta.url).pathname)main().catch(()=>{console.error('STOP: target-only persistence failed. New APIs retained; inspect sanitized state and root resurrect dump.');process.exitCode=1;});
