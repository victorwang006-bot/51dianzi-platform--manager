#!/usr/bin/env node
/** OFFLINE ONLY. Parent must finish agents and authorize freeze. No application entry is executed. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { assembleHtml, BASELINE, RELEASE, sha, cleanEnv, chooseTests, CONFIG, projectionContract, validateProjectionSql } from './lib.mjs';
const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repos = { admin: path.resolve(toolDir, '../..'), front: '/home/ubuntu/51dianzi-platform' };
const roots = ['client','shared','server','drizzle','scripts','tests','patches','attached_assets','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','vite.config.ts','vitest.config.ts','deploy/schema-migrations.txt','deploy/ecs-release.sh','deploy/ecs-release-from-git.sh'];
const treeSha = rows => sha(JSON.stringify(rows));
const json = async (p, v) => { await fs.mkdir(path.dirname(p), {recursive:true}); await fs.writeFile(p, JSON.stringify(v,null,2)+'\n', {mode:0o600}); };
const toolOwnedTemporary = new Set(['.round3-vitest.config.mjs','.round3-test-isolation.mjs']);
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
  return result;
}
async function freeze(work, baselineDir) {
  const projection=projectionContract(); // fail before costly snapshot when backend contract remains pending

  for(const repo of Object.values(repos)) assert.ok(work!==repo&&!work.startsWith(repo+'/'),'work must be outside shared repos');
  const sources={}; for(const [side,repo] of Object.entries(repos)) { const files=await listFiles(repo); sources[side]={repository:repo,commit:git(repo,'rev-parse','HEAD'),branch:git(repo,'branch','--show-current'),gitStatus:git(repo,'status','--short'),files,treeSha256:treeSha(files),dependencies:await deps(repo)}; }
  for(const f of CONFIG.frontProtectedSource) assert.ok(sources.front.files.some(x=>x.path===f.path&&x.sha256===f.sha256),'front Home/source drift: '+f.path);
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
  const record={schemaVersion:3,release:RELEASE,frozenAt:new Date().toISOString(),sourceSha256,sources,toolFiles:await toolEvidence(),baseline:BASELINE,envFilesLoaded:false,sourceReadyExplicitlyConfirmedByCaller:true,agentsCompleteNotIndependentlyClaimed:true,typedMirror:Object.fromEntries(Object.entries(sources).map(([side,v])=>[side,{kind:"exact-unmodified-typed-source-copy",files:v.files.filter(f=>/\.tsx?$/.test(f.path)),treeSha256:treeSha(v.files.filter(f=>/\.tsx?$/.test(f.path)))}])),workingTreeSnapshotNotClaimedCommitted:true,nodeVersion:process.version};
  await json(path.join(runDir,'freeze.json'),record);
  console.log(JSON.stringify({status:'frozen-offline-not-yet-tested',freezeRecord:path.join(runDir,'freeze.json'),sourceSha256},null,2));
}
async function verifyFreeze(record,runDir) {
  assert.equal(record.schemaVersion,3); assert.equal(record.release,RELEASE); assert.deepEqual(record.baseline,BASELINE);
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
  const evidence={kind,side,command:[command,...args],cwd,startedAt,finishedAt:new Date().toISOString(),exitCode:r.status,signal:r.signal,log:path.basename(logPath),logSha256:sha(await fs.readFile(logPath)),envFilesLoaded:false,networkBlockedByPreload:true};
  await json(logPath+'.result.json',evidence); if(r.error||r.status!==0) throw Error(`actual ${side} ${kind} failed: ${logPath}`); return evidence;
}
async function build(recordPath) {
  const runDir=path.dirname(recordPath), bytes=await fs.readFile(recordPath), record=JSON.parse(bytes); projectionContract(); await verifyFreeze(record,runDir);
  const pkg=path.join(runDir,'package'), evidenceDir=path.join(pkg,'evidence');
  assert.ok(!await fs.stat(pkg).then(()=>true,()=>false),'build directory exists: inspect failed/complete build, do not replay');
  await fs.mkdir(evidenceDir,{recursive:true}); const home=path.join(runDir,'private-home'); await fs.mkdir(home,{mode:0o700});
  await fs.writeFile(path.join(evidenceDir,'freeze.json'),bytes); const checks=[];
  await fs.copyFile(path.join(runDir,'baseline/processes.json'),path.join(evidenceDir,'processes-baseline.json'));

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
      if(side==='front') assert.ok(suite.selected.some(p=>/factoryChannel|FactoryChannel|channelFactory/i.test(p)),'Factory regression absent');
      await json(path.join(evidenceDir,`${side}-regression-suite.json`),suite);
      const setup=path.join(source,'.round3-test-isolation.mjs'); await fs.copyFile(path.join(toolDir,'test-isolation.mjs'),setup);
      const config=path.join(source,'.round3-vitest.config.mjs');
      await fs.writeFile(config,`import original from './vitest.config.ts';import {snapshotAliases} from ${JSON.stringify(path.join(toolDir,'snapshot-alias.mjs'))};export default {...original,resolve:{...original.resolve,alias:snapshotAliases(${JSON.stringify(source)},${JSON.stringify(path.join(runDir,'admin'))})},esbuild:{...original.esbuild,jsx:'automatic'},test:{...original.test,include:${JSON.stringify(suite.selected)},setupFiles:[${JSON.stringify(setup)}],fileParallelism:false,maxWorkers:1,minWorkers:1}};\n`);
      await json(path.join(evidenceDir,`${side}-snapshot-test-alias.json`),{snapshotRoot:source,adminSnapshot:path.join(runDir,'admin'),aliasPolicy:'importer-scoped frozen @ / @shared / @assets; ../admin sibling stays exact snapshot',generatedConfigSha256:sha(await fs.readFile(config)),sourceEdits:false});
      checks.push(await run(process.execPath,[path.join(source,'node_modules/vitest/vitest.mjs'),'run','--config',config],source,path.join(evidenceDir,`${side}-regression-tests.log`),home,'vitest',side,'test'));
    }
    const namespaces=Object.fromEntries(['admin','front'].map(side=>[side,`${RELEASE}-${side}-${record.sourceSha256.slice(0,12)}`]));
    const assets=[],htmls={},rootPublic=[],requiredModules={admin:['client/src/components/admin/AdminWorkspaceNavigation.tsx','client/src/components/DashboardLayout.tsx','client/src/business/platform/client/src/pages/CustomerList.tsx','client/src/business/platform/client/src/pages/ChannelInventoryHost.tsx','client/src/pages/Staff.tsx','client/src/business/platform/client/src/components/channelInventory/FactoryMaterialPublish.tsx'],front:['client/src/pages/FactoryChannelPage.tsx']};
    const captured=await captureBaseline(path.join(runDir,'baseline'));
    for(const side of ['admin','front']) {
      const namespace=namespaces[side],frontend=path.join(runDir,`${side}-frontend`);
      checks.push(await run(process.execPath,[path.join(toolDir,'vite-worker.mjs'),path.join(runDir,side),frontend,namespace,path.join(evidenceDir,`${side}-rollup-modules.json`)],path.join(runDir,side),path.join(evidenceDir,`${side}-frontend-build.log`),home,'vite',side));
      const modules=JSON.parse(await fs.readFile(path.join(evidenceDir,`${side}-rollup-modules.json`))),bundled=new Set(modules.flatMap(c=>c.modules));
      for(const n of requiredModules[side])assert.ok(bundled.has(n),`current module not bundled: ${side}/${n}`);assert.ok(![...bundled].some(p=>p.startsWith('server/')),'server in frontend graph');
      async function copy(dir,rel='') {for(const n of (await fs.readdir(path.join(dir,rel))).sort()){const r=path.join(rel,n),p=path.join(dir,r),st=await fs.lstat(p);assert.ok(!st.isSymbolicLink());if(st.isDirectory()){await copy(dir,r);continue;}assert.ok(st.isFile()&&!/\.(?:map|html)$/.test(n));const b=await fs.readFile(p),publicPath=`assets/${namespace}/${r}`,name=`static/${side}/${publicPath}`;await fs.mkdir(path.dirname(path.join(pkg,name)),{recursive:true});await fs.writeFile(path.join(pkg,name),b);assets.push({side,publicPath,path:name,sha256:sha(b),bytes:b.length});}}
      await copy(path.join(frontend,'assets',namespace));assert.ok(assets.filter(a=>a.side===side).length>=2);
      const builtHtml=await fs.readFile(path.join(frontend,'index.html'),'utf8');
      const assembled=assembleHtml(captured[`${side}-index.html`].toString(),builtHtml,namespace,BASELINE[`${side}-index.html`],side);const htmlPath=`candidate-${side}-index.html`;await fs.writeFile(path.join(pkg,htmlPath),assembled.html);await json(path.join(evidenceDir,`${side}-html-edits.json`),assembled.edits);htmls[side]={path:htmlPath,sha256:sha(assembled.html),bytes:Buffer.byteLength(assembled.html)};
      await fs.copyFile(path.join(frontend,'.vite/manifest.json'),path.join(evidenceDir,`${side}-vite-manifest.json`));
      // Public files are evidence only. Never copy to root public, even if a build logo differs.
      for(const f of record.sources[side].files.filter(f=>f.path.startsWith('client/public/'))){const name=f.path.slice('client/public/'.length);assert.ok(name!=='index.html');const b=await fs.readFile(path.join(frontend,name));assert.equal(sha(b),f.sha256,'built public differs from frozen source');rootPublic.push({side,path:name,sha256:f.sha256,bytes:f.bytes});}
    }
    const apis=[];
    for(const side of ['front','admin']) {
      const out=path.join(pkg,side,'dist/index.js');
      checks.push(await run(process.execPath,[path.join(toolDir,'build-service.mjs'),path.join(runDir,side),out,side],path.join(runDir,side),path.join(evidenceDir,`${side}-api-build.log`),home,'esbuild',side));
      const b=await fs.readFile(out); apis.push({path:`${side}/dist/index.js`,sha256:sha(b),bytes:b.length}); await fs.rename(out+'.metafile.json',path.join(evidenceDir,`${side}-esbuild-metafile.json`));
    }
    await verifyFreeze(record,runDir); await json(path.join(evidenceDir,'checks.json'),checks);
    await json(path.join(pkg,'build-state.json'),{status:'complete-offline',release:RELEASE,productionDeploymentPerformed:false});
    const ddl=[],projection=projectionContract();
    for(const rel of [projection.runner,projection.sql]) {
      const f=record.sources.front.files.find(x=>x.path===rel);assert.ok(f,`parent-reviewed projection source absent: ${rel}`);const b=await fs.readFile(path.join(runDir,'front',rel));assert.equal(sha(b),f.sha256);
      if(rel===projection.sql)validateProjectionSql(b,projection);else assert.ok(!/dotenv|from-ecosystem-config|createRequire|require\(/.test(b.toString()),'projection runner must not load ENV/config');
      const out=`front/${rel}`;await fs.mkdir(path.dirname(path.join(pkg,out)),{recursive:true});await fs.writeFile(path.join(pkg,out),b);ddl.push({path:out,sha256:sha(b),bytes:b.length});
    }
    const toolArtifacts=[];
    for(const t of record.toolFiles) {const b=await fs.readFile(path.join(toolDir,t.path));assert.equal(sha(b),t.sha256);const out=`tools/${t.path}`;await fs.mkdir(path.dirname(path.join(pkg,out)),{recursive:true});await fs.writeFile(path.join(pkg,out),b);toolArtifacts.push({path:out,sha256:sha(b),bytes:b.length});}
    const evidence=[]; for(const n of (await fs.readdir(evidenceDir)).sort()) {const b=await fs.readFile(path.join(evidenceDir,n));evidence.push({path:`evidence/${n}`,sha256:sha(b),bytes:b.length});}
    await verifyFreeze(record,runDir);
    const manifest={schemaVersion:3,release:RELEASE,kind:'combined-api-dual-static',sourceSha256:record.sourceSha256,sources:Object.fromEntries(Object.entries(record.sources).map(([s,v])=>[s,{commit:v.commit,treeSha256:v.treeSha256}])),sourceFreezeSha256:sha(bytes),namespaces,baseline:BASELINE,assets,apis,ddl,projection,toolArtifacts,builtRootPublicEvidenceOnly:rootPublic,htmls,evidence,checks,requiredModules,guard:{actualChecksPassed:checks.length===8&&checks.every(c=>c.exitCode===0),sourceStable:true,isolatedNoEnvFiles:true,networkBlockedInTests:true,oldHtmlOtherBytesPreserved:true,oldAssetsNeverDeleted:true,productionDeploymentPerformed:false,productionBrowserVerified:false,databaseTestsPassed:false},generatedAt:new Date().toISOString(),qaRequiredBeforeApply:['Parent exact frozen source + manifest approval','Authorized React fixture interaction QA, labelled fixture, not production browser','API compatibility and front projection DDL reviewed separately; schema-only phase requires explicit parent authorization']};
    await json(path.join(pkg,'manifest.json'),manifest); console.log(JSON.stringify({status:'complete-offline',packageDir:pkg,manifest:path.join(pkg,'manifest.json'),manifestSha256:sha(await fs.readFile(path.join(pkg,'manifest.json')))},null,2));
  } catch(e) { await json(path.join(pkg,'build-state.json'),{status:'failed-STOP',release:RELEASE,error:e.message,completedChecks:checks,productionDeploymentPerformed:false}); throw e; }
}
async function main() {
  const args=process.argv.slice(2),value=f=>args[args.indexOf(f)+1]; const allowed=new Set(['--help','--freeze','--build','--agents-complete','--work','--baseline','--freeze-record']);
  for(let i=0;i<args.length;i++){assert.ok(allowed.has(args[i]),`unknown option ${args[i]}`);if(['--work','--baseline','--freeze-record'].includes(args[i]))assert.ok(args[++i]&&!args[i].startsWith('--'));}
  if(!args.length||args.includes('--help')) {console.log('OFFLINE ONLY\n--freeze --agents-complete [--work /home/ubuntu/backend-optimization/round3/builds] [--baseline /home/ubuntu/backend-optimization/round3/baseline]\n--build --freeze-record /absolute/run/freeze.json\nNo current source is frozen unless caller explicitly confirms source ready. This tool does not independently claim agentsComplete. Existing build directory cannot be replayed.');return;}
  assert.equal(Number(args.includes('--freeze'))+Number(args.includes('--build')),1);
  if(args.includes('--freeze')) {assert.ok(args.includes('--agents-complete'),'STOP: agents must finish before freeze');await freeze(path.resolve(args.includes('--work')?value('--work'):'/home/ubuntu/backend-optimization/round3/builds'),path.resolve(args.includes('--baseline')?value('--baseline'):'/home/ubuntu/backend-optimization/round3/baseline'));}
  else {assert.ok(args.includes('--freeze-record'));await build(path.resolve(value('--freeze-record')));}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(`STOP: ${e.message}`);process.exitCode=1;});
