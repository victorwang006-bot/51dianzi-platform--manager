import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
const [mode,manifestPath,expectedSha]=process.argv.slice(2);
if(!['--check','--activate','--rollback'].includes(mode))throw Error('INVALID_MODE');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const raw=fs.readFileSync(manifestPath);if(!/^[a-f0-9]{64}$/.test(expectedSha)||hash(raw)!==expectedSha)throw Error('MANIFEST_SHA');
const m=JSON.parse(raw),ops=path.dirname(manifestPath),coordPath='/opt/ops/51-project-release-coordination-20261027.json';
if(m.taskId!=='BlmCjd8I4BDSkoDJ2xSDxj'||m.scopeId!=='compact-three-list-toolbars'||m.adminPublicRoot!=='/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public')throw Error('SCOPE_IDENTITY');
const shaFile=p=>hash(fs.readFileSync(p));
const atomic=(p,data,bits)=>{const prior=fs.existsSync(p)?fs.statSync(p):null;const temp=p+'.compact-next-'+process.pid;const fd=fs.openSync(temp,'wx',bits);try{if(prior)fs.fchownSync(fd,prior.uid,prior.gid);fs.fchmodSync(fd,bits);fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,p);};
const save=(name,data)=>atomic(path.join(ops,name),Buffer.from(JSON.stringify(data,null,2)+'\n'),0o600);
const readCoord=()=>JSON.parse(fs.readFileSync(coordPath));
const cmd=(name,args)=>{const r=spawnSync(name,args,{encoding:'utf8',timeout:15000,maxBuffer:16*1024*1024});if(r.status!==0||r.error)throw Error('COMMAND_FAILED:'+name);return r.stdout;};
function processSnapshot(){return JSON.parse(cmd('pm2',['jlist'])).map(p=>{const e=p.pm2_env;return{id:p.pm_id,name:p.name,pid:p.pid,status:e.status,execPath:e.pm_exec_path,cwd:e.pm_cwd,execMode:e.exec_mode,interpreter:e.exec_interpreter,args:e.args||[],nodeArgs:e.node_args||[],environmentSha256:hash(JSON.stringify(Object.fromEntries(Object.entries(e.env||{}).sort(([a],[b])=>a.localeCompare(b))))),execSha256:shaFile(e.pm_exec_path)};}).sort((a,b)=>a.id-b.id);}
function validate(active=false){
 const html=m.html;if(html.target!==m.adminPublicRoot+'/index.html'||fs.realpathSync(html.target)!==html.target||shaFile(html.target)!==(active?html.sha256:html.baselineSha256))throw Error('HTML_CAS');
 if(shaFile(path.join(ops,html.staged))!==html.sha256)throw Error('HTML_CANDIDATE_SHA');
 if(m.newAssets.length!==5)throw Error('EXACT_FIVE_NEW_ASSETS');
 for(const a of m.newAssets){if(!a.target.startsWith(m.adminPublicRoot+'/assets/')||a.target.includes('/../')||!path.basename(a.target).includes(a.sha256.slice(0,12))||shaFile(path.join(ops,a.staged))!==a.sha256)throw Error('ASSET_CONTRACT');if(active&&!fs.existsSync(a.target))throw Error('ASSET_MISSING');if(fs.existsSync(a.target)&&shaFile(a.target)!==a.sha256)throw Error('ASSET_COLLISION');}
 for(const p of m.protectedStaticFiles)if(shaFile(p.path)!==p.sha256)throw Error('ORIGINAL_STATIC_DRIFT:'+p.path);
}
function noOtherWindow(){const c=readCoord();if(c.shared_release_active||['open','active'].includes(c.window?.status))throw Error('ANOTHER_RELEASE_ACTIVE');if(shaFile(coordPath)!==m.coordinatorBaselineSha256)throw Error('COORDINATOR_CAS');}
function coord(status,extra={}){const c=readCoord();if(status==='open'){noOtherWindow();c.window_history||=[];if(c.window)c.window_history.push(c.window);c.window={owner_task:m.taskId,scope:m.scopeId,manifestSha256:expectedSha,opsDir:ops,status,openedAtUtc:new Date().toISOString(),userRequestedImplementation:true};c.shared_release_active=true;}else{if(c.window?.owner_task!==m.taskId||c.window?.manifestSha256!==expectedSha)throw Error('COORDINATOR_OWNERSHIP');c.window={...c.window,status,closedAtUtc:new Date().toISOString(),...extra};c.shared_release_active=false;}c.updated_at=new Date().toISOString();atomic(coordPath,Buffer.from(JSON.stringify(c,null,2)+'\n'),fs.statSync(coordPath).mode&0o777);}
async function health(port){const host=port===3000?'51dianzi.com':'admin.51dianzi.com';return new Promise((resolve,reject)=>{const r=http.get({hostname:'127.0.0.1',port,path:'/api/trpc/system.health?input='+encodeURIComponent(JSON.stringify({json:{timestamp:0}})),headers:{Host:host,Origin:'https://'+host,Referer:'https://'+host+'/', 'User-Agent':'Mozilla/5.0 Chrome/131.0.0.0'}},res=>{let body='';res.on('data',b=>{body+=b;if(body.length>10000)r.destroy(Error('HEALTH_BOUND'));});res.on('end',()=>{let data;try{data=JSON.parse(body);}catch{}if(res.statusCode!==200||data?.result?.data?.json?.ok!==true)reject(Error('HEALTH_FAILED:'+port));else resolve({port,status:200,ok:true});});});r.setTimeout(10000,()=>r.destroy(Error('HEALTH_TIMEOUT')));r.on('error',reject);});}
const baseline=processSnapshot(),dumpSha=shaFile('/root/.pm2/dump.pm2');
if(baseline.some(p=>p.status!=='online'))throw Error('EXISTING_PROCESS_NOT_ONLINE');
const unchanged=()=>{if(JSON.stringify(processSnapshot())!==JSON.stringify(baseline)||shaFile('/root/.pm2/dump.pm2')!==dumpSha)throw Error('PROTECTED_PROCESS_OR_BOOT_DUMP_CHANGED');};
async function rollback(why){const backup=path.join(ops,'backups','index.html');if(shaFile(backup)!==m.html.baselineSha256)throw Error('ROLLBACK_BACKUP_SHA');const actual=shaFile(m.html.target);if(![m.html.baselineSha256,m.html.sha256].includes(actual))throw Error('ROLLBACK_HTML_CONCURRENT_DRIFT');if(actual!==m.html.baselineSha256)atomic(m.html.target,fs.readFileSync(backup),m.html.mode);validate(false);unchanged();const checks=[await health(3000),await health(3001)];save('rolled-back.json',{why,manifestSha256:expectedSha,health:checks,restoredHTMLSha256:m.html.baselineSha256});coord('rolled_back',{receipt:ops+'/rolled-back.json'});}
if(mode==='--check'){validate(false);noOtherWindow();unchanged();console.log(JSON.stringify({preflight:true,manifestSha256:expectedSha,health:[await health(3000),await health(3001)],productionModified:false,apiOrWorkerReloaded:false}));}
else if(mode==='--rollback')await rollback('explicit rollback');
else{
 validate(false);noOtherWindow();
 const approval=JSON.parse(fs.readFileSync(path.join(ops,'approval.json')));if(approval.taskId!==m.taskId||approval.manifestSha256!==expectedSha||approval.releaseId!==m.releaseId||approval.scopeId!==m.scopeId||approval.userRequestedImplementation!==true||approval.fixedVersionApproved!==true)throw Error('EXPLICIT_FIXED_VERSION_APPROVAL_REQUIRED');
 fs.mkdirSync(path.join(ops,'backups'),{mode:0o700});fs.copyFileSync(m.html.target,path.join(ops,'backups','index.html'),fs.constants.COPYFILE_EXCL);save('runtime-before.json',{processes:baseline,pm2DumpSha256:dumpSha});coord('open');
 try{
  for(const a of m.newAssets)if(!fs.existsSync(a.target)){fs.mkdirSync(path.dirname(a.target),{recursive:true,mode:0o755});atomic(a.target,fs.readFileSync(path.join(ops,a.staged)),0o644);}
  console.log('New content-addressed assets installed; no old JS/CSS file replaced');
  if(shaFile(m.html.target)!==m.html.baselineSha256)throw Error('LATE_HTML_CAS');atomic(m.html.target,fs.readFileSync(path.join(ops,m.html.staged)),m.html.mode);
  validate(true);unchanged();const checks=[await health(3000),await health(3001)];
  const receipt={releaseId:m.releaseId,manifestSha256:expectedSha,sourceCommits:m.sourceCommits,releaseCommits:m.releaseCommits,artifacts:[m.html,...m.newAssets].map(a=>({path:a.target,sha256:shaFile(a.target)})),health:checks,allProcessesAndExecFilesUnchanged:true,pm2DumpUnchanged:true,apiOrWorkerReloaded:false,productionDatabaseEdited:false,verifiedAtUtc:new Date().toISOString()};save('verified.json',receipt);coord('verified',{receipt:ops+'/verified.json'});console.log(JSON.stringify(receipt));
 }catch(e){console.error('Static activation failed; restore only this HTML',e.message);await rollback(e.message);throw e;}
}
