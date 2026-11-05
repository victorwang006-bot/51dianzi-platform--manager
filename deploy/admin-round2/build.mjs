#!/usr/bin/env node
/** OFFLINE ONLY. Parent must finish agents and authorize freeze. No application entry is executed. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { assembleHtml, BASELINE, RELEASE, sha, cleanEnv, chooseTests } from './lib.mjs';
const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repos = { admin: path.resolve(toolDir, '../..'), front: '/home/ubuntu/51dianzi-platform' };
const roots = ['client','shared','server','drizzle','scripts','tests','patches','attached_assets','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','vite.config.ts','vitest.config.ts','deploy/schema-migrations.txt','deploy/ecs-release.sh','deploy/ecs-release-from-git.sh'];
const treeSha = rows => sha(JSON.stringify(rows));
const json = async (p, v) => { await fs.mkdir(path.dirname(p), {recursive:true}); await fs.writeFile(p, JSON.stringify(v,null,2)+'\n', {mode:0o600}); };
const toolOwnedTemporary = new Set(['.round2-vitest.config.mjs','.round2-test-isolation.mjs']);
export async function listFiles(root) {
  const rows = [];
  async function visit(rel) {
    assert.ok(!/(^|\/)(?:\.env(?:\.|$)|\.git(?:\/|$)|node_modules(?:\/|$))|\.(?:pem|key|p12)$/i.test(rel), `secret/non-source name forbidden: ${rel}`);
    const p = path.join(root,rel), st = await fs.lstat(p);
    assert.ok(!st.isSymbolicLink(), `source symlink forbidden: ${rel}`);
    if (st.isDirectory()) { for (const n of (await fs.readdir(p)).sort()) await visit(path.join(rel,n)); }
    else { assert.ok(st.isFile()); const b = await fs.readFile(p); rows.push({path:rel,sha256:sha(b),bytes:b.length}); }
  }
  const configs=(await fs.readdir(root)).filter(n=>!toolOwnedTemporary.has(n)&&/^(?:.*\.config\.(?:ts|mts|mjs|cjs|json)|tsconfig(?:\.[^.]+)?\.json)$/.test(n));
  for (const r of [...new Set([...roots,...configs])]) { try { await visit(r); } catch(e) { if (e.code !== 'ENOENT' || ['client','shared','server','drizzle','package.json','pnpm-lock.yaml','tsconfig.json','vite.config.ts','vitest.config.ts'].includes(r)) throw e; } }
  return rows.sort((a,b)=>a.path.localeCompare(b.path));
}
async function toolEvidence() {
  const rows=[]; for (const name of (await fs.readdir(toolDir)).filter(n=>/\.(?:mjs|py|json|md)$/.test(n)).sort()) rows.push({path:name,sha256:sha(await fs.readFile(path.join(toolDir,name)))}); return rows;
}
async function deps(repo) {
  const rows=[]; for(const n of ['typescript','vitest','vite','esbuild','react','react-dom']) { const p=path.join(repo,'node_modules',n,'package.json'), b=await fs.readFile(p); rows.push({name:n,version:JSON.parse(b).version,sha256:sha(b),realpath:await fs.realpath(p)}); } return rows;
}
function git(repo,...args) { return execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim(); }
async function captureBaseline(dir) {
  const result={}; for(const [n,h] of Object.entries(BASELINE)) { const b=await fs.readFile(path.join(dir,n)); assert.equal(sha(b),h,`baseline drift: ${n}`); result[n]=b; }
  const publicFiles=JSON.parse(result['public-baseline.json']);
  for(const [n,h] of Object.entries(publicFiles)) { assert.ok(!n.includes('..')&&!path.isAbsolute(n)); const b=await fs.readFile(path.join(dir,n)); assert.equal(sha(b),h,`public baseline drift: ${n}`); result[n]=b; }
  return result;
}
async function freeze(work, baselineDir) {
  for(const repo of Object.values(repos)) assert.ok(work!==repo&&!work.startsWith(repo+'/'),'work must be outside shared repos');
  const sources={}; for(const [side,repo] of Object.entries(repos)) { const files=await listFiles(repo); sources[side]={repository:repo,commit:git(repo,'rev-parse','HEAD'),branch:git(repo,'branch','--show-current'),gitStatus:git(repo,'status','--short'),files,treeSha256:treeSha(files),dependencies:await deps(repo)}; }
  const sourceSha256=sha(JSON.stringify(Object.fromEntries(Object.entries(sources).map(([s,v])=>[s,v.treeSha256]))));
  const runDir=path.join(work,`${sourceSha256.slice(0,12)}-${Date.now()}`); await fs.mkdir(runDir,{recursive:true,mode:0o700});
  for(const [side,info] of Object.entries(sources)) {
    const destRoot=path.join(runDir,side); await fs.mkdir(destRoot);
    for(const f of info.files) { const b=await fs.readFile(path.join(info.repository,f.path)); assert.equal(sha(b),f.sha256,`source changed during freeze ${side}/${f.path}`); const dest=path.join(destRoot,f.path); await fs.mkdir(path.dirname(dest),{recursive:true}); await fs.writeFile(dest,b); }
    assert.equal(treeSha(await listFiles(info.repository)),info.treeSha256,'shared source drift during freeze');
    assert.equal(treeSha(await listFiles(destRoot)),info.treeSha256,'snapshot mismatch');
    await fs.symlink(path.join(info.repository,'node_modules'),path.join(destRoot,'node_modules'),'dir');
  }
  // front/server/*.tsx ../../admin/client imports resolve to the frozen manager, not live source.
  const captured=await captureBaseline(baselineDir); for(const [n,b] of Object.entries(captured)) {const p=path.join(runDir,'baseline',n); await fs.mkdir(path.dirname(p),{recursive:true}); await fs.writeFile(p,b);}
  const record={schemaVersion:2,release:RELEASE,frozenAt:new Date().toISOString(),sourceSha256,sources,toolFiles:await toolEvidence(),baseline:BASELINE,envFilesLoaded:false,agentsCompleteConfirmedByCaller:true,workingTreeSnapshotNotClaimedCommitted:true,nodeVersion:process.version};
  await json(path.join(runDir,'freeze.json'),record);
  console.log(JSON.stringify({status:'frozen-offline-not-yet-tested',freezeRecord:path.join(runDir,'freeze.json'),sourceSha256},null,2));
}
async function verifyFreeze(record,runDir) {
  assert.equal(record.schemaVersion,2); assert.equal(record.release,RELEASE); assert.deepEqual(record.baseline,BASELINE);
  for(const [side,info] of Object.entries(record.sources)) {
    assert.equal(info.repository,repos[side]); assert.equal(treeSha(await listFiles(path.join(runDir,side))),info.treeSha256,'frozen source drift');
    assert.equal(treeSha(await listFiles(info.repository)),info.treeSha256,'shared source drift: re-freeze required');
    assert.equal(git(info.repository,'rev-parse','HEAD'),info.commit,'HEAD moved after freeze'); assert.deepEqual(await deps(info.repository),info.dependencies,'dependency manifest drift');
    assert.equal(await fs.realpath(path.join(runDir,side,'node_modules')),await fs.realpath(path.join(info.repository,'node_modules')));
  }
  assert.equal(sha(JSON.stringify(Object.fromEntries(Object.entries(record.sources).map(([s,v])=>[s,v.treeSha256])))),record.sourceSha256,'combined source digest mismatch');
  assert.deepEqual(await toolEvidence(),record.toolFiles,'tool changed since freeze'); await captureBaseline(path.join(runDir,'baseline'));
}
async function run(command,args,cwd,logPath,home,kind,side,mode='production') {
  console.log(`Running ${side} ${kind}; log ${logPath}`); const fd=await fs.open(logPath,'w',0o600); let r; const startedAt=new Date().toISOString();
  try { r=spawnSync(command,args,{cwd,env:cleanEnv(home,mode),stdio:['ignore',fd.fd,fd.fd],timeout:15*60*1000}); } finally {await fd.close();}
  const evidence={kind,side,command:[command,...args],cwd,startedAt,finishedAt:new Date().toISOString(),exitCode:r.status,signal:r.signal,log:path.basename(logPath),logSha256:sha(await fs.readFile(logPath)),envFilesLoaded:false};
  await json(logPath+'.result.json',evidence); if(r.error||r.status!==0) throw Error(`actual ${side} ${kind} failed: ${logPath}`); return evidence;
}
async function build(recordPath) {
  const runDir=path.dirname(recordPath), bytes=await fs.readFile(recordPath), record=JSON.parse(bytes); await verifyFreeze(record,runDir);
  const pkg=path.join(runDir,'package'), evidenceDir=path.join(pkg,'evidence');
  assert.ok(!await fs.stat(pkg).then(()=>true,()=>false),'build directory exists: inspect failed/complete build, do not replay');
  await fs.mkdir(evidenceDir,{recursive:true}); const home=path.join(runDir,'private-home'); await fs.mkdir(home,{mode:0o700});
  await fs.writeFile(path.join(evidenceDir,'freeze.json'),bytes); const checks=[];
  await fs.copyFile(path.join(runDir,'baseline/processes.json'),path.join(evidenceDir,'processes-baseline.json'));
  await fs.copyFile(path.join(runDir,'baseline/public-baseline.json'),path.join(evidenceDir,'public-baseline.json'));
  await json(path.join(pkg,'build-state.json'),{status:'running',release:RELEASE,productionDeploymentPerformed:false});
  try {
    for(const side of ['admin','front']) {
      const source=path.join(runDir,side);
      checks.push(await run(process.execPath,[path.join(source,'node_modules/typescript/bin/tsc'),'--noEmit','--incremental','false'],source,path.join(evidenceDir,`${side}-typecheck.log`),home,'tsc',side));
      const suite=chooseTests(record.sources[side].files);
      // Direct connector tests are skipped explicitly even if filename does not say mysql.
      for(const name of [...suite.selected]) { const text=await fs.readFile(path.join(source,name),'utf8'); if(/(?:mysql\.create(?:Pool|Connection)|createPool\(|createConnection\()/m.test(text)) {suite.selected=suite.selected.filter(x=>x!==name);suite.dbSkipped.push({path:name,status:'skipped',reason:'Direct database connector; no isolated DB connection supplied.'});} }
      assert.ok(suite.selected.length>0,`no ${side} related nonDB regressions`);
      if(side==='admin') for(const family of [/navigation/i,/Customer/i,/ChannelInventory/i,/memory/i,/staff/i,/archive/i]) assert.ok(suite.selected.some(p=>family.test(p)),`required regression family absent: ${family}`);
      await json(path.join(evidenceDir,`${side}-regression-suite.json`),suite);
      const setup=path.join(source,'.round2-test-isolation.mjs'); await fs.copyFile(path.join(toolDir,'test-isolation.mjs'),setup);
      const config=path.join(source,'.round2-vitest.config.mjs');
      await fs.writeFile(config,`import original from './vitest.config.ts';export default {...original,esbuild:{...original.esbuild,jsx:'automatic'},test:{...original.test,include:${JSON.stringify(suite.selected)},setupFiles:[${JSON.stringify(setup)}],fileParallelism:false,maxWorkers:1,minWorkers:1}};\n`);
      checks.push(await run(process.execPath,[path.join(source,'node_modules/vitest/vitest.mjs'),'run','--config',config],source,path.join(evidenceDir,`${side}-regression-tests.log`),home,'vitest',side,'test'));
    }
    const namespace=`${RELEASE}-${record.sourceSha256.slice(0,12)}`, frontend=path.join(runDir,'frontend');
    checks.push(await run(process.execPath,[path.join(toolDir,'vite-worker.mjs'),path.join(runDir,'admin'),frontend,namespace,path.join(evidenceDir,'rollup-modules.json')],path.join(runDir,'admin'),path.join(evidenceDir,'frontend-build.log'),home,'vite','admin'));
    const modules=JSON.parse(await fs.readFile(path.join(evidenceDir,'rollup-modules.json'))), bundled=new Set(modules.flatMap(c=>c.modules));
    const requiredModules=['client/src/components/admin/AdminWorkspaceNavigation.tsx','client/src/components/DashboardLayout.tsx','client/src/business/platform/client/src/pages/CustomerList.tsx','client/src/business/platform/client/src/pages/ChannelInventoryHost.tsx','client/src/pages/Staff.tsx'];
    for(const n of requiredModules) assert.ok(bundled.has(n),`current module not bundled: ${n}`); assert.ok(![...bundled].some(p=>p.startsWith('server/')),'server in frontend graph');
    const assets=[];
    async function copy(dir,rel='') {for(const n of (await fs.readdir(path.join(dir,rel))).sort()) {const r=path.join(rel,n),p=path.join(dir,r),st=await fs.lstat(p); assert.ok(!st.isSymbolicLink()); if(st.isDirectory()){await copy(dir,r);continue;} assert.ok(st.isFile()&&!/\.(?:map|html)$/.test(n)); const b=await fs.readFile(p),name=`assets/${namespace}/${r}`; await fs.mkdir(path.dirname(path.join(pkg,name)),{recursive:true}); await fs.writeFile(path.join(pkg,name),b); assets.push({path:name,sha256:sha(b),bytes:b.length});}}
    await copy(path.join(frontend,'assets',namespace)); assert.ok(assets.length>=2);
    const builtHtml=await fs.readFile(path.join(frontend,'index.html'),'utf8'), captured=await captureBaseline(path.join(runDir,'baseline'));
    const assembled=assembleHtml(captured['index.html'].toString(),builtHtml,namespace); await fs.writeFile(path.join(pkg,'candidate-index.html'),assembled.html); await json(path.join(evidenceDir,'html-edits.json'),assembled.edits);
    await fs.copyFile(path.join(frontend,'.vite/manifest.json'),path.join(evidenceDir,'vite-manifest.json'));
    const rootAssets=record.sources.admin.files.filter(f=>f.path.startsWith('client/public/')).map(f=>({...f,path:f.path.slice('client/public/'.length)}));
    for(const a of rootAssets) {assert.ok(!a.path.startsWith('assets/')&&a.path!=='index.html','root assets whitelist');assert.equal(sha(await fs.readFile(path.join(frontend,a.path))),a.sha256);}
    const apis=[];
    for(const side of ['front','admin']) {
      const out=path.join(pkg,side,'dist/index.js');
      checks.push(await run(process.execPath,[path.join(toolDir,'build-service.mjs'),path.join(runDir,side),out,side],path.join(runDir,side),path.join(evidenceDir,`${side}-api-build.log`),home,'esbuild',side));
      const b=await fs.readFile(out); apis.push({path:`${side}/dist/index.js`,sha256:sha(b),bytes:b.length}); await fs.rename(out+'.metafile.json',path.join(evidenceDir,`${side}-esbuild-metafile.json`));
    }
    await verifyFreeze(record,runDir); await json(path.join(evidenceDir,'checks.json'),checks);
    await json(path.join(pkg,'build-state.json'),{status:'complete-offline',release:RELEASE,productionDeploymentPerformed:false});
    const ddl=[];
    for(const name of ['apply-admin-staff-archives.mjs','20261105-admin-staff-archives.sql']) {
      const rel=`scripts/${name}`,f=record.sources.admin.files.find(x=>x.path===rel); assert.ok(f,`parent-reviewed sidecar script absent: ${rel}`);
      const b=await fs.readFile(path.join(runDir,'admin',rel));assert.equal(sha(b),f.sha256);
      const out=`admin/scripts/${name}`;await fs.mkdir(path.dirname(path.join(pkg,out)),{recursive:true});await fs.writeFile(path.join(pkg,out),b);ddl.push({path:out,sha256:sha(b),bytes:b.length});
    }
    const toolArtifacts=[];
    for(const t of record.toolFiles) {const b=await fs.readFile(path.join(toolDir,t.path));assert.equal(sha(b),t.sha256);const out=`tools/${t.path}`;await fs.mkdir(path.dirname(path.join(pkg,out)),{recursive:true});await fs.writeFile(path.join(pkg,out),b);toolArtifacts.push({path:out,sha256:sha(b),bytes:b.length});}
    const evidence=[]; for(const n of (await fs.readdir(evidenceDir)).sort()) {const b=await fs.readFile(path.join(evidenceDir,n));evidence.push({path:`evidence/${n}`,sha256:sha(b),bytes:b.length});}
    await verifyFreeze(record,runDir);
    const manifest={schemaVersion:2,release:RELEASE,kind:'combined-api-manager-static',sourceSha256:record.sourceSha256,sources:Object.fromEntries(Object.entries(record.sources).map(([s,v])=>[s,{commit:v.commit,treeSha256:v.treeSha256}])),sourceFreezeSha256:sha(bytes),namespace,baseline:BASELINE,publicBaseline:JSON.parse(captured['public-baseline.json']),assets,apis,ddl,toolArtifacts,rootAssetsMustRemainUnchanged:rootAssets,html:{path:'candidate-index.html',sha256:sha(assembled.html),bytes:Buffer.byteLength(assembled.html)},evidence,checks,requiredModules,guard:{actualChecksPassed:checks.length===7&&checks.every(c=>c.exitCode===0),sourceStable:true,isolatedNoEnvFiles:true,networkBlockedInTests:true,oldHtmlOtherBytesPreserved:true,oldAssetsNeverDeleted:true,productionDeploymentPerformed:false,productionBrowserVerified:false,databaseTestsPassed:false},generatedAt:new Date().toISOString(),qaRequiredBeforeApply:['Parent exact frozen source + manifest approval','Authorized React fixture interaction QA, labelled fixture, not production browser','API compatibility and archive sidecar DDL reviewed separately; schema-only phase requires explicit parent authorization']};
    await json(path.join(pkg,'manifest.json'),manifest); console.log(JSON.stringify({status:'complete-offline',packageDir:pkg,manifest:path.join(pkg,'manifest.json'),manifestSha256:sha(await fs.readFile(path.join(pkg,'manifest.json')))},null,2));
  } catch(e) { await json(path.join(pkg,'build-state.json'),{status:'failed-STOP',release:RELEASE,error:e.message,completedChecks:checks,productionDeploymentPerformed:false}); throw e; }
}
async function main() {
  const args=process.argv.slice(2),value=f=>args[args.indexOf(f)+1]; const allowed=new Set(['--help','--freeze','--build','--agents-complete','--work','--baseline','--freeze-record']);
  for(let i=0;i<args.length;i++){assert.ok(allowed.has(args[i]),`unknown option ${args[i]}`);if(['--work','--baseline','--freeze-record'].includes(args[i]))assert.ok(args[++i]&&!args[i].startsWith('--'));}
  if(!args.length||args.includes('--help')) {console.log('OFFLINE ONLY\n--freeze --agents-complete [--work /home/ubuntu/backend-optimization/round2/builds] [--baseline /home/ubuntu/backend-optimization/round2/baseline]\n--build --freeze-record /absolute/run/freeze.json\nNo current source is frozen unless caller explicitly confirms agents complete. Existing build directory cannot be replayed.');return;}
  assert.equal(Number(args.includes('--freeze'))+Number(args.includes('--build')),1);
  if(args.includes('--freeze')) {assert.ok(args.includes('--agents-complete'),'STOP: agents must finish before freeze');await freeze(path.resolve(args.includes('--work')?value('--work'):'/home/ubuntu/backend-optimization/round2/builds'),path.resolve(args.includes('--baseline')?value('--baseline'):'/home/ubuntu/backend-optimization/round2/baseline'));}
  else {assert.ok(args.includes('--freeze-record'));await build(path.resolve(value('--freeze-record')));}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(`STOP: ${e.message}`);process.exitCode=1;});
