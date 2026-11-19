import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import * as esbuild from 'esbuild';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const REPO=path.resolve(HERE,'../../..');
const BASE=process.env.UPLOAD_COMPACT_DIR??'/home/ubuntu/work/upload-compact';
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
const parse=(s,file='live.js')=>{const a=ts.createSourceFile(file,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(a.parseDiagnostics.length,0,`syntax: ${file}`);return a;};
const nodes=(a,p)=>{const out=[];function w(n){if(p(n))out.push(n);ts.forEachChild(n,w);}w(a);return out;};
const one=(arr,label)=>{assert.equal(arr.length,1,`${label}: unique AST node`);return arr[0];};
const common={React:'Ct',useEffect:'Oe',useRef:'fe',useState:'X',useImperativeHandle:'Sv',jsx:'m',jsxs:'_',Fragment:'Nt',Dialog:'Ka',DialogContent:'Xa',DialogHeader:'Ya',DialogTitle:'Ja',Button:'xt',batchUploadDialogStyle:'ac'};
const batch={...common,storageKey:'F0',readSavedBatch:'C6',Icon:'Zi',uuid:'fu',fields:'on',mapGrid:'Tl',suggestMapping:'vs',templateGrid:'Xv',validateDraft:'ua',validateMapping:'Kv',toPayload:'dd',runBatch:'Yv'};
const history={...common,trpc:'St',customerSupplySessionSuffix:'cs',customerUploadDownloadSchema:'Qw',customerUploadHistoryListSchema:'Jw',customerUploadManageMarkSchema:'Uf',customerUploadResultSchema:'Mf',CustomerSupplyUploadDialog:'jf',downloadedFile:'Zg',fileInput:'el',historyStates:'Lf',parseResult:'rk',resultGuide:'ik',resultSubmission:'nk',savePrivateFile:'Wg',uuid:'qr'};
const specs=[
 {source:'client/src/business/platform/client/src/components/channelInventory/BatchUpload.tsx',name:'BatchUploadSession',native:'T6',bindings:batch,markers:['onOriginalFilePersist','onCreateCustomerBatch','dialogControlsRef']},
 {source:'client/src/business/platform/client/src/components/customers/CustomerUploadHistoryDialog.tsx',name:'HistorySession',native:'z3',bindings:history,markers:['customerUploadHistoryList.query','customerUploadHistoryGet.query','customerUploadReconcileBatch.mutate']}
];
export async function emittedLeaf(spec){
 const source=fs.readFileSync(path.join(REPO,spec.source),'utf8');
 const result=await esbuild.transform(source,{loader:'tsx',jsx:'automatic',format:'esm',target:'es2020',minify:false});
 const a=parse(result.code,spec.source+'.js');
 let leaf=one(nodes(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text===spec.name),spec.name).getText(a);
 // Preserve the already-loaded native SheetJS instance. No new dependency graph or transport.
 leaf=leaf.replaceAll('import("xlsx")','Promise.resolve().then(() => (nc(), rc))');
 assert(!leaf.includes('import('),'no unresolved dynamic imports in customer leaf');
 const bindings=Object.entries(spec.bindings).map(([k,v])=>`${k}=${v}`).join(',');
 const wrapper=`function ${spec.native}(props){const ${bindings};\n${leaf}\nreturn ${spec.name}(props);}`;
 parse(wrapper);
 return {sourcePath:spec.source,sourceSha256:H(source),compiledSha256:H(leaf),leaf,wrapper};
}
export function inverseDelta(before,hunks){
 let after=before,shift=0;const records=[];
 for(const h of [...hunks].sort((a,b)=>a.start-b.start)){
  assert.equal(before.slice(h.start,h.end),h.old,'exact original leaf');
  const newStart=h.start+shift;shift+=h.replacement.length-(h.end-h.start);
  records.push({name:h.name,oldStart:h.start,oldEnd:h.end,newStart,newEnd:newStart+h.replacement.length,oldSha256:H(h.old),newSha256:H(h.replacement),oldBase64:Buffer.from(h.old).toString('base64'),newBase64:Buffer.from(h.replacement).toString('base64')});
 }
 for(const h of [...hunks].sort((a,b)=>b.start-a.start))after=after.slice(0,h.start)+h.replacement+after.slice(h.end);
 let reversed=after;
 for(const r of [...records].reverse()){
  assert.equal(reversed.slice(r.newStart,r.newEnd),Buffer.from(r.newBase64,'base64').toString(),'inverse leaf preimage');
  reversed=reversed.slice(0,r.newStart)+Buffer.from(r.oldBase64,'base64').toString()+reversed.slice(r.newEnd);
 }
 assert.equal(reversed,before,'all outside-leaf UTF8 bytes preserved');
 assert(Buffer.from(reversed).equals(Buffer.from(before)),'entire byte inverse');
 parse(after);
 return {after,records};
}
export async function build(){
 fs.mkdirSync(BASE+'/package/assets',{recursive:true});fs.mkdirSync(BASE+'/evidence',{recursive:true});
 const compiled=await Promise.all(specs.map(emittedLeaf));
 const baselineFiles=fs.readdirSync(BASE+'/capture/assets').filter(f=>/^BusinessWorkbenchPage-customer-upload-retry-[a-f0-9]+\.js$/.test(f));
 assert.equal(baselineFiles.length,2,'both actual admin Workbench references');
 const modules=[];const originalHashes={};
 for(const file of baselineFiles){
  const beforeBytes=fs.readFileSync(BASE+'/capture/assets/'+file),before=beforeBytes.toString('utf8');assert(beforeBytes.equals(Buffer.from(before)));
  const a=parse(before,file);const hunks=[];
  for(let i=0;i<specs.length;i++){
   const spec=specs[i],n=one(nodes(a,x=>ts.isFunctionDeclaration(x)&&x.name?.text===spec.native&&spec.markers.every(k=>x.getText(a).includes(k))),file+': '+spec.native);
   const old=n.getText(a);if(originalHashes[spec.native])assert.equal(H(old),originalHashes[spec.native],'both native copies use exact same leaf ABI');else originalHashes[spec.native]=H(old);
   let scope=n.parent;assert(ts.isBlock(scope),'actual lexical customer factory block');
   const immediate=[];function scan(x){if(ts.isFunctionDeclaration(x)){immediate.push(x);return;}if(ts.isVariableDeclaration(x)){immediate.push(x);return;}ts.forEachChild(x,scan);}for(const st of scope.statements)scan(st);
   const abi={};
   for(const native of new Set(Object.values(spec.bindings))){
    const v=one(immediate.filter(x=>ts.isIdentifier(x.name)&&x.name.text===native),`native ABI ${native}`);abi[native]={sha256:H(v.getText(a)),head:v.getText(a).slice(0,160)};
   }
   assert.equal(abi.Ct.head,'Ct=__customerLive.React','original host React, no second provider');
   if(spec.native==='T6')assert(old.includes('Bt.current')&&old.includes('be && Bt.current?.file === V')===false,'native persisted-file retry closure remains structurally known');
   hunks.push({name:spec.native,start:n.getStart(a),end:n.end,old,replacement:compiled[i].wrapper});
   fs.writeFileSync(BASE+'/evidence/'+file+'-'+spec.native+'-abi.json',JSON.stringify(abi,null,2)+'\n');
  }
  const {after,records}=inverseDelta(before,hunks),sha=H(after),relative=`assets/BusinessWorkbenchPage-upload-compact-${sha.slice(0,16)}.js`;
  fs.writeFileSync(BASE+'/package/'+relative,after);
  const delta={input:'assets/'+file,output:relative,beforeSha256:H(beforeBytes),afterSha256:sha,patches:records,inverseVerified:true,onlyTwoCustomerLeafFunctions:true};
  fs.writeFileSync(BASE+'/evidence/'+file+'.delta.json',JSON.stringify(delta,null,2)+'\n');
  modules.push({before:'assets/'+file,after:relative,sha256:sha,size:Buffer.byteLength(after)});
 }
 const sourceEvidence=compiled.map(({sourcePath,sourceSha256,compiledSha256})=>({sourcePath,sourceSha256,compiledSha256}));
 fs.writeFileSync(BASE+'/evidence/source-delta.json',JSON.stringify({modules,sources:sourceEvidence,noNewProvider:true,nativeQueueAndSchemasReused:true,noBackendChanges:true},null,2)+'\n');
 fs.writeFileSync(BASE+'/modules.json',JSON.stringify(modules,null,2)+'\n');
 console.log(JSON.stringify({status:'LOCAL_NATIVE_CANDIDATES',modules,sources:sourceEvidence},null,2));return modules;
}
if(process.argv[1]===fileURLToPath(import.meta.url))await build();
