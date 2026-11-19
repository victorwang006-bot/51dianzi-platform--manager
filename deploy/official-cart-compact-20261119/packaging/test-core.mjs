import test from 'node:test';
import strict from 'node:assert/strict';
import {P,H,delta,parse,declaration,selectedSource,freeze,write,save} from './core.mjs';
let passed=0;
function check(name,fn){test(name,()=>{fn();passed++;});}
check('UTF8 multibyte inverse proof preserves all untouched bytes',()=>{const s='const 中文="原支付";\nfunction oldNative(){return 2;}\n';const at=s.indexOf('2;'),d=delta(Buffer.from(s),[{start:at,end:at+1,before:'2',after:'3',reason:'test minimal literal'}]);strict.equal(d.proof.inverseVerified,true);strict.equal(d.proof.beforeSha256,H(s));strict.equal(d.text,s.replace('2;','3;'));});
check('multiple insertions use original offsets and exact inverse',()=>{const s='abcdef',d=delta(s,[{start:1,end:1,before:'',after:'新',reason:'a'},{start:4,end:5,before:'e',after:'长字节',reason:'b'}]);strict.equal(d.text,'a新bcd长字节f');strict.equal(d.proof.inverseVerified,true);});
check('changed preimage and overlapping edits fail closed',()=>{strict.throws(()=>delta('abc',[{start:1,end:2,before:'x',after:'z'}]),/PREIMAGE/);strict.throws(()=>delta('abc',[{start:0,end:2,before:'ab',after:'x'},{start:1,end:3,before:'bc',after:'y'}]),/PREIMAGE/);});
check('same-offset insertions cannot reorder silently',()=>{strict.throws(()=>delta('abc',[{start:1,end:1,before:'',after:'x'},{start:1,end:1,before:'',after:'y'}]),/PREIMAGE/);});
check('AST source selection omits unrelated large constants',()=>{const s='import {useState} from "react";\nconst forbiddenBigData=[1,2,3];\nexport default function CartPage(){return useState(1);}\n';const selected=selectedSource('fixture.tsx',s,['CartPage']);strict.ok(!selected.includes('forbiddenBigData'));strict.equal(declaration(parse(selected,'fixture.tsx'),'CartPage').name.text,'CartPage');});
check('application output writes are rejected before filesystem use',()=>{strict.throws(()=>write('/home/ubuntu/work/sales-20261117/platform/DO_NOT_CREATE','x'),/PACKAGING_OUTPUT_ONLY/);});
check('draft config cannot compile or implicitly freeze edited sources',()=>{const p=P+'/test-draft-freeze.json';save(p,{schema:'cart-compact-freeze-v1',phase:'draft',approvedSourceFreeze:false});strict.throws(()=>freeze(p,'ui'),/WAIT_EXPLICIT_PARENT_SOURCE_FREEZE/);});
test.after(()=>save(P+'/tool-tests.json',{status:'passed',count:passed,compiledSource:false,sourceFreeze:false,network:false,db:false,production:false,scope:'only AST/delta/writer/fail-closed unit tests'}));
