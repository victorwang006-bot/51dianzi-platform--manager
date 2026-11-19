import {objectReader} from './current-tools/head-object.mjs';
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {BASE,AR,H,assert,saveJSON} from './current-tools/native-core.mjs';
const commit='aadc4afcbac4264af357f0e0eb01c4886302fa99',git=fs.realpathSync(AR)+'/.git',out=BASE+'/validation/source-head.json';
assert(!fs.existsSync(out),'HEAD_SNAPSHOT_EXISTS_NO_REPIN');
const head=fs.readFileSync(git+'/HEAD','utf8').trim();const actual=head.startsWith('ref: ')?fs.readFileSync(git+'/'+head.slice(5),'utf8').trim():head;assert(actual===commit,'HEAD_MUST_BE_AUTHORIZED_AADC');
const obj=objectReader(git);
function entry(tree,name){const o=obj(tree);assert(o.type==='tree','TREE');let i=0;while(i<o.data.length){const sp=o.data.indexOf(32,i),nul=o.data.indexOf(0,sp);const n=o.data.subarray(sp+1,nul).toString(),id=o.data.subarray(nul+1,nul+21).toString('hex');if(n===name)return id;i=nul+21;}throw Error('HEAD_PATH_MISSING '+name);}
const c=obj(commit);assert(c.type==='commit','COMMIT');let tree=c.data.toString().match(/^tree ([a-f0-9]{40})\n/)[1];for(const n of ['client','src','pages'])tree=entry(tree,n);
const readonlySourceNames=['Profile.tsx','profileBusinessQuery.ts','profileModel.ts','ProfileBusinessPanel.tsx','ProfileCommissionResults.tsx','ProfileCommissionDrawer.tsx','commissionPresentation.ts'];
const mutableSourceNames=['ProfilePerformanceResults.tsx','ProfileBusinessUi.tsx','ProfileBusiness.css'];
const sourceHashes={},sourcePreimages={},blobIds={};for(const n of [...readonlySourceNames,...mutableSourceNames]){const id=entry(tree,n),o=obj(id);assert(o.type==='blob','SOURCE_BLOB');sourceHashes[AR+'/client/src/pages/'+n]=H(o.data);sourcePreimages[n]=o.data.toString('base64');blobIds[n]=id;}
saveJSON(out,{schemaVersion:'profile-clean-head-preimages-v1',commit,headObserved:actual,sourceRoot:AR+'/client/src/pages/',readonlySourceNames,mutableSourceNames,allowedNewSourceNames:[],allowedTestNames:['Profile.business.ui.test.ts','commissionPresentation.test.ts','ProfileCommissionResults.test.tsx','ProfileCommissionDrawer.test.tsx','ProfilePerformanceResults.test.tsx','ProfileBusinessUi.test.tsx'],sourceHashes,sourcePreimages,blobIds,provenance:'SHA1-verified immutable loose/packed Git objects; no Git process; no worktree source reads',noSourceWrites:true,noGitCommand:true});console.log(JSON.stringify({out,commit,sources:Object.keys(blobIds).length,status:'HEAD_BASELINE_ONLY_NOT_SOURCE_FREEZE_NOT_BUILD'}));
