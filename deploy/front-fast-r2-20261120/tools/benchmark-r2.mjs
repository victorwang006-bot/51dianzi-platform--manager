import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const STAGE='/opt/ops/front-fast-r2-20261120-qp4e5jVm';
const helper='officialTechnical.d5f5ad0d5f3315d4a09632784bbcdd05ddc750d92e05668f04615184eaabad62.runtime.mjs';
const worker='officialTechnicalReader.5bc25bdc88d72450d6725156f60a99dfb181a1fa19de152e9e2287578a088404.worker.mjs';
const {createOfficialTechnicalPreparedStore,closeOfficialTechnicalReaderWorkers}=await import(pathToFileURL(STAGE+'/tools/'+helper));
const source=await fs.readFile(STAGE+'/prepared-candidate.json');const doc=JSON.parse(source);const H=x=>crypto.createHash('sha256').update(x).digest('hex');
assert.equal(H(source),'87910d282ec0a2a1b76235bbc4462ef98049d8228b7400de66a8bb6091ef4faf');assert.equal(doc.entries.length,20002);
const target=doc.entries.filter(e=>['STM8S003F3P6TR','W25N04KVZEIR'].includes(e.identity.partNumber));assert.equal(target.length,2);
const sample=[...target,...doc.entries.filter(e=>!target.includes(e)).slice(0,28)];
const store=createOfficialTechnicalPreparedStore(STAGE+'/prepared-candidate.json',{workerPath:STAGE+'/tools/'+worker});
let previous=performance.now(),heartbeats=[];const timer=setInterval(()=>{const now=performance.now();heartbeats.push(Math.max(0,now-previous-2));previous=now},2);
const cold=performance.now();const warmProof=await store.warmUp();const coldReadyMs=performance.now()-cold;clearInterval(timer);
assert.equal(warmProof.loads,1);assert.equal(warmProof.storeSha256,H(source));assert.equal(warmProof.entries,20002);
const warmThirty=[],concurrencyTen=[];
function equal(actual){assert.deepEqual(actual,sample.map(e=>e.technicalResource))}
for(let i=0;i<100;i++){const t=performance.now();equal(await store.lookup(sample.map(e=>e.identity)));warmThirty.push(performance.now()-t)}
for(let batch=0;batch<10;batch++)await Promise.all(Array.from({length:10},async()=>{const t=performance.now();equal(await store.lookup(sample.map(e=>e.identity)));concurrencyTen.push(performance.now()-t)}));
await new Promise(r=>setTimeout(r,75));assert.equal((await store.warmUp()).loads,1);equal(await store.lookup(sample.map(e=>e.identity)));
// Atomic same-size/mtime replacement must invalidate the path-version cache.
const privatePath=STAGE+'/bench-store.json';await fs.writeFile(privatePath,source,{flag:'wx',mode:0o600});const privateStore=createOfficialTechnicalPreparedStore(privatePath,{workerPath:STAGE+'/tools/'+worker});await privateStore.warmUp();
const stat=await fs.stat(privatePath);const broken=Buffer.from(source.toString().replace('"schemaVersion":1','"schemaVersion":2'));assert.equal(broken.length,source.length);
const tmp=STAGE+'/bench-next.json';await fs.writeFile(tmp,broken,{flag:'wx',mode:0o600});await fs.utimes(tmp,stat.atime,stat.mtime);await fs.rename(tmp,privatePath);
await assert.rejects(privateStore.warmUp());const bad=await privateStore.lookup(target.map(e=>e.identity));assert.ok(bad.every(x=>x.state==='unavailable'&&x.resource===null&&x.parameterVersion===null));
await fs.writeFile(tmp,source,{flag:'wx',mode:0o600});await fs.rename(tmp,privatePath);await privateStore.warmUp();assert.deepEqual(await privateStore.lookup(target.map(e=>e.identity)),target.map(e=>e.technicalResource));
assert.equal(H(await fs.readFile(STAGE+'/prepared-candidate.json')),H(source));
store.close();privateStore.close();closeOfficialTechnicalReaderWorkers();
console.log(JSON.stringify({status:'pass-private-candidate-real-compiled-worker',environment:'production-host-private-process-no-active-writes',storeSha256:H(source),entries:doc.entries.length,bytes:source.length,coldReadyMs,heartbeatDelaySamples:heartbeats,warmThirtySamples:warmThirty,concurrencyTenSamples:concurrencyTen,warmProof,quietReusesIndex:true,sameSizeMtimeAtomicBadVersionFailClosed:true,freshVersionRecovers:true,activeStoreWrites:0,businessDatabaseWrites:0,environmentWrites:0,processReloads:0}));
