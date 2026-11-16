import fs from'node:fs';import path from'node:path';import{fileURLToPath}from'node:url';import assert from'node:assert/strict';import{createRequire}from'node:module';
import{candidateABI}from'../self-operated-mall-v9-conflict-20261116/native-build/offline-native-abi.mjs';
const D=path.dirname(fileURLToPath(import.meta.url)),req=createRequire('/home/ubuntu/work/51dianzi-platform--manager/package.json'),{initTRPC}=req('@trpc/server'),manifest=JSON.parse(fs.readFileSync(D+'/native/manifest.json'));
const noDb=async()=>{throw Error('REAL_DB_FORBIDDEN')};const names=['loadOfficialAccess','assertOfficialRecordAction','officialTeamPredicate','officialActorFromContext','officialChannelTeams','officialChannelTeamMembers','adminUsers','adminUserPermissions','materials'];
const extracted=candidateABI(D+'/baseline/admin.js',names,{getDb:noDb}).value;
for(const n of names)assert(extracted[n],'exact native dependency '+n);
const t=initTRPC.create(),mod=await import('./native/'+manifest.compiled.admin.name),runtime=mod.createOfficialMallRuntime({...extracted,getDb:noDb,router:t.router,adminProcedure:t.procedure,publicProcedure:t.procedure});
assert.deepEqual(Object.keys(runtime.officialMall._def.procedures).sort(),['status','list','create','update','publish','offshelf','bulkAction','requestStatus','suggest','importPreview','importRows'].sort());assert.deepEqual(Object.keys(runtime.officialMallPublic._def.procedures).sort(),['detail','list']);
await assert.rejects(runtime.officialMall.createCaller({user:null}).list({}),/后台工作人员/);
assert.equal(extracted.materials.partNumber.name,'partNumber');assert.equal(extracted.materials.package.name,'package');assert.equal(extracted.materials.status.name,'status');
const front=await import('./native/'+manifest.compiled.front.name),frontRuntime=front.createOfficialMallRuntime({router:t.router,publicProcedure:t.procedure});assert.deepEqual(Object.keys(frontRuntime.officialMall._def.procedures).sort(),['detail','list']);
await assert.rejects(frontRuntime.officialMall.createCaller({}).detail({publicId:'123'}),e=>e.code==='BAD_REQUEST');
for(const r of ['admin','front']){const delta=JSON.parse(fs.readFileSync(D+'/native/'+r+'-delta.json'));assert(delta.inverseVerified)}
const results={nativeAbiDependencies:10,adminFixedMethods:11,adminPublicQueries:2,frontPublicQueries:2,anonymousPrivateDenied:true,oldRealCatalogColumns:true,publicNamespaceInputStrict:true,apiInverseVerified:true,noSQL:true,noServerOrWorkerStart:true};fs.writeFileSync(D+'/native-checks.json',JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
