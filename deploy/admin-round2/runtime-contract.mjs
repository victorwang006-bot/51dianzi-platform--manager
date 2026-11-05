import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
export const RELEASE = '20261105-admin-compact-priority-v2';
export const OLD = '/opt/releases/20261104-channel-inventory-ci-management-v1';
export const TARGETS = {front:{name:'dianzi51',ids:[190,193,194,200],cwd:'/opt/releases/20261031-forum-quote-v34/front'},admin:{name:'dianzi51-admin',ids:[191,192],cwd:'/opt/releases/20261031-wechat-chat-entry-v33/admin'}};
export const hash = b => crypto.createHash('sha256').update(b).digest('hex');
export function sorted(v) {return Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;}
export const canonical = v => JSON.stringify(sorted(v));
// EXACT previous prepare-runtime-config helper bookkeeping exclusion.
const volatile = new Set(['NODE_APP_INSTANCE','pm_id','unique_id','restart_time','unstable_restarts','created_at','pm_uptime','status','pm_exec_path','script']);
export function environment(p) {const env=p.pm2_env.env;if(!env||typeof env!=='object')throw Error('missing env');return Object.fromEntries(Object.entries(env).filter(([k])=>!volatile.has(k)));}
const keys=['args','node_args','exec_interpreter','exec_mode','instances','instance_var','increment_var','append_env_to_name','autorestart','watch','ignore_watch','watch_options','max_memory_restart','min_uptime','max_restarts','restart_delay','exp_backoff_restart_delay','kill_timeout','listen_timeout','wait_ready','shutdown_with_message','treekill','pm_out_log_path','pm_err_log_path','merge_logs','log_date_format','time','cron_restart','vizion','source_map_support','disable_logs','uid','gid','namespace'];
export function runtime(p) {const e=p.pm2_env,v=Object.fromEntries(keys.filter(k=>e[k]!==undefined).map(k=>[k,e[k]]));for(const k of ['pm_out_log_path','pm_err_log_path','pm_pid_path'])if(typeof v[k]==='string')v[k]=v[k].replace(new RegExp(`-${e.pm_id??p.pm_id}(\\.[^./]+)$`),'$1');return v;}
// Python's legacy json.dumps(env, sort_keys=True) encoding; output only hashes.
function pyjson(v) {if(v===null)return 'null';if(Array.isArray(v))return '['+v.map(pyjson).join(', ')+']';if(typeof v==='object')return '{'+Object.keys(v).sort().map(k=>pyjson(k)+': '+pyjson(v[k])).join(', ')+'}';if(typeof v==='string')return JSON.stringify(v).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));return JSON.stringify(v);}
export function summary(p) {const e=p.pm2_env;return {id:p.pm_id,name:p.name,pid:p.pid,script:e.pm_exec_path,sha256:hash(fs.readFileSync(e.pm_exec_path)),cwd:e.pm_cwd,status:e.status,restarts:e.restart_time,mode:e.exec_mode,envHash:hash(canonical(environment(p))),configHash:hash(canonical(runtime(p))),legacyEnvHashes:[hash(pyjson(e.env)),hash(canonical(e.env))]};}
export function list() {const r=spawnSync('pm2',['jlist'],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024});if(r.status!==0||r.error)throw Error('PM2 snapshot failed');const rows=JSON.parse(r.stdout);if(!Array.isArray(rows))throw Error('PM2 shape');return rows;}
export const summaries=rows=>rows.map(summary).sort((a,b)=>a.id-b.id);
export function stableEqual(a,b) {return ['id','name','cwd','mode','envHash','configHash'].every(k=>a[k]===b[k]);}
