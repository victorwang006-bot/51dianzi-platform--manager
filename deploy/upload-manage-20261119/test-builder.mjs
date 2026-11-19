#!/usr/bin/env node
/** Offline structural tests only. Never compile current TSX, build package, network, or business writes. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {HERE,H,patchModule,scopedCss,htmlDelta} from './build-native.mjs';
import {noFreeIdentifiers,noLoads} from './build-support.mjs';
import {specs,baselineHashes} from './native-abi.mjs';
let count=0;function check(label,fn){fn();console.log('PASS '+label);count++;}
const pins={changedTargets:specs.map(s=>s.label)};
const fake=specs.map(spec=>({spec,bindings:spec.bindings,wrapper:`function ${spec.native}(props){ return props; }`}));
for(const [file,hash] of Object.entries(baselineHashes)){
 const before=fs.readFileSync(HERE+'/inputs/assets/'+file,'utf8');
 check(file+' actual approved native pin',()=>assert.equal(H(before),hash));
 check(file+' only authorized spans, protected history/initial/Workbench/Parse, forward/inverse bytes',()=>{const p=patchModule(before,file,fake,pins);assert.equal(p.records.length,4);assert.notEqual(H(p.after),hash);assert.deepEqual(Object.keys(p.protectedFunctions),['z3','uk','bk','ok']);});
 check(file+' three target mode retains original native More bytes',()=>{const p=patchModule(before,file,fake.slice(0,3),{changedTargets:pins.changedTargets.slice(0,3)});assert.equal(p.records.length,3);});
}
check('noFreeIdentifiers good aliases',()=>noFreeIdentifiers('function test(p){const React=Ct;return React.createElement("div",p);}',{React:'Ct'}));
check('noFreeIdentifiers rejects unknown host import',()=>assert.throws(()=>noFreeIdentifiers('function test(){return UnknownHostProvider();}',{})));
check('module load refused',()=>assert.throws(()=>noLoads('function test(){return import("react");}')));
check('customer CSS exact scopes',()=>assert(scopedCss('.customer-channel-inventory .ci-row {color:red}\n.customer-channel-settings {margin:0}', ['customer-channel-inventory','customer-channel-settings']).includes('color:red')));
check('CSS rejects other Host selectors',()=>assert.throws(()=>scopedCss('.ci-host {color:red}', ['customer-channel-inventory'])));
check('CSS allows media customer scopes only',()=>assert(scopedCss('@media (max-width:600px){.customer-channel-inventory input {width:100%}}', ['customer-channel-inventory']).includes('@media')));
check('HTML both complete quoted URL references and independent CSS only',()=>{const input=Buffer.from('<html><head><script>["/assets/BusinessWorkbenchPage-one.js",\'/assets/BusinessWorkbenchPage-two.js\']</script>\n</head><body>unchanged</body></html>');const m=[{before:'assets/BusinessWorkbenchPage-one.js',after:'assets/BusinessWorkbenchPage-new-one.js'},{before:'assets/BusinessWorkbenchPage-two.js',after:'assets/BusinessWorkbenchPage-new-two.js'}];const p=htmlDelta(input,m,'assets/customer-upload-manage.css');assert(p.after.includes(Buffer.from('unchanged')));assert.equal(Object.values(p.counts).join(','),'1,1');});
check('HTML substring URL refused',()=>assert.throws(()=>htmlDelta(Buffer.from('<head>"/assets/BusinessWorkbenchPage-one.js?bad"</head>'),[{before:'assets/BusinessWorkbenchPage-one.js',after:'assets/BusinessWorkbenchPage-new.js'}],null)));
console.log(JSON.stringify({status:'passed',count,kind:'real-baseline-offline-structural-tests-not-runtime-native',realNetworkCalls:0,businessWrites:0,sourceCompiled:false}));
