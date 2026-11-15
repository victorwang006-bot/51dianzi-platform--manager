#!/usr/bin/env node
'use strict';
// Entire fixture under mkdtemp; synthetic bundles only, no production or application writes.
const C=require('./scoped-core.cjs'),A=require('./build-actual-patches.cjs'),B=require('./build-candidate.cjs');
const {fs,path,sha,assert,parse}=C,os=require('node:os');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'manual-patch-fixture-')),source=path.join(dir,'source');fs.mkdirSync(source);const hashes={};
for(let j=0;j<172;j++){const n='fixture'+j+'.ts',b=Buffer.from('export const value'+j+'='+j+';\n');fs.writeFileSync(path.join(source,n),b);hashes[n]=sha(b);}
const before=Buffer.from('import {sql} from "drizzle-orm";\nfunction target(){return "旧值";}\nfunction protectedNative(){return 3;}\n');
for(const kind of ['front','admin']){A.PINS[kind]=sha(before);fs.writeFileSync(path.join(dir,kind+'.js'),before);}
const replacement=Buffer.from('function manualReferenceSql(){return sql`SELECT 1`;}\nfunction target(){return "新值";}');fs.writeFileSync(path.join(dir,'fragment.js'),replacement);
const sf=parse(before.toString()),n=A.owner(sf,'target'),p={contractVersion:'manual-reference-edit-backend-plan-v1',runtimeRoot:B.ROOT,ownerTask:B.OWNER,approved:true,fixtureOnly:false,sourceMappingApprovedByParent:true,sourceDir:source,sourceHashes:hashes,backends:{}};
for(const kind of ['front','admin'])p.backends[kind]={inputPath:path.join(dir,kind+'.js'),beforeSha256:sha(before),approvedOwners:['target'],approvedAddedOwners:['manualReferenceSql'],spans:[{id:'replace',owner:'target',ownerBeforeSha256:sha(n.getText(sf)),mode:'replace-owner',removedSha256:sha(n.getText(sf)),insertedPin:{file:path.join(dir,'fragment.js'),sha256:sha(replacement)},sources:['fixture0.ts']}]};
function save(){const b=Buffer.from(JSON.stringify(p));fs.writeFileSync(path.join(dir,'plan.json'),b);return sha(b);}
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
try{
 test('native exact-owner addition and full UTF8 inverse',()=>{const r=A.build(path.join(dir,'plan.json'),save(),path.join(dir,'out'));assert.equal(r.reports.front.spans,1);const proof=JSON.parse(fs.readFileSync(path.join(dir,'out/front-patchproof.json')));assert.equal(proof.verification.fullInverseRecovered,true);});
 test('unapproved plan fails closed',()=>{p.approved=false;assert.throws(()=>A.build(path.join(dir,'plan.json'),save(),path.join(dir,'reject1')),/APPROVAL/);p.approved=true;});
 test('new owners require exact separate approval',()=>{p.backends.front.approvedAddedOwners=[];assert.throws(()=>A.build(path.join(dir,'plan.json'),save(),path.join(dir,'reject2')),/EXACT_APPROVED_NEW/);p.backends.front.approvedAddedOwners=['manualReferenceSql'];});
 test('removed slice SHA cannot be forged',()=>{p.backends.front.spans[0].removedSha256='a'.repeat(64);assert.throws(()=>A.build(path.join(dir,'plan.json'),save(),path.join(dir,'reject3')),/REMOVED_BYTE/);p.backends.front.spans[0].removedSha256=sha(n.getText(sf));});
 test('API imports cannot be added',()=>{const bad=Buffer.from('import {bad} from "bad";\n'+replacement);fs.writeFileSync(path.join(dir,'fragment.js'),bad);p.backends.front.spans[0].insertedPin.sha256=sha(bad);assert.throws(()=>A.build(path.join(dir,'plan.json'),save(),path.join(dir,'reject4')),/API_IMPORT/);fs.writeFileSync(path.join(dir,'fragment.js'),replacement);p.backends.front.spans[0].insertedPin.sha256=sha(replacement);});
 test('duplicate and overlapping spans refuse',()=>{p.backends.front.spans.push({...p.backends.front.spans[0],id:'overlap'});assert.throws(()=>A.build(path.join(dir,'plan.json'),save(),path.join(dir,'reject5')),/OVERLAPPING/);p.backends.front.spans.pop();});
 test('output directory cannot be replayed',()=>{assert.throws(()=>A.build(path.join(dir,'plan.json'),save(),path.join(dir,'out')),/NEW_LOCAL_PATCH/);});
 test('runtime-symbol mapping requires approval',()=>{p.sourceMappingApprovedByParent=false;assert.throws(()=>A.build(path.join(dir,'plan.json'),save(),path.join(dir,'reject6')),/MAPPING_REQUIRES/);});
 fs.writeFileSync(path.join(__dirname,'backend-fixture-qa.json'),JSON.stringify({status:'PASS',fixtureOnly:true,count,testedBuilderSha256:sha(fs.readFileSync(path.join(__dirname,'build-actual-patches.cjs'))),productionExecuted:false},null,2)+'\n');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
