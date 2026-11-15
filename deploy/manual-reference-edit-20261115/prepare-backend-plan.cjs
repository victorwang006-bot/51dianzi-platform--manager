#!/usr/bin/env node
'use strict';
// Local draft only: no source mutation, compilation, approval, SSH or production IO.
const C=require('./scoped-core.cjs'),B=require('./build-candidate.cjs'),A=require('./build-actual-patches.cjs');
const {fs,path,sha,regular,pinned,parse,assert}=C;
const enc=x=>JSON.stringify(x,null,2)+'\n';
function main(a){assert(a.length===8&&a[0]==='--baseline'&&a[2]==='--baseline-sha256'&&a[4]==='--source'&&a[6]==='--out');const base=path.resolve(a[1]),q=B.baseline(base,a[3]),source=path.resolve(a[5]),out=path.resolve(a[7]);assert(!fs.existsSync(out));
 const p={contractVersion:'manual-reference-edit-backend-plan-v1',runtimeRoot:B.ROOT,ownerTask:B.OWNER,approved:false,fixtureOnly:false,sourceMappingApprovedByParent:false,sourceDir:source,sourceHashes:null,backends:{}};const rows={};
 for(const kind of ['front','admin']){const input=base+'/'+kind+'-index.js',b=pinned(input,q.b.api[kind]),ast=parse(b.toString());rows[kind]=ast.statements.map(n=>({owner:A.named(n,ast),kind:C.ts.SyntaxKind[n.kind],startChar:n.getStart(ast),endChar:n.end,startByte:C.offset(b.toString(),n.getStart(ast)),endByte:C.offset(b.toString(),n.end),sha256:sha(n.getText(ast))}));p.backends[kind]={inputPath:input,beforeSha256:q.b.api[kind],approvedOwners:[],approvedAddedOwners:[],spans:[]};}
 fs.mkdirSync(out,{mode:0o700});fs.writeFileSync(out+'/backend-plan.DRAFT.json',enc(p),{flag:'wx',mode:0o600});for(const kind of ['front','admin'])fs.writeFileSync(out+'/'+kind+'-owners.json',enc(rows[kind]),{flag:'wx',mode:0o600});console.log(enc({status:'DRAFT_ONLY_NO_APPROVAL',output:out,owners:Object.fromEntries(Object.entries(rows).map(([k,r])=>[k,r.length])),sourceDir:source,productionExecuted:false}));}
if(require.main===module){try{main(process.argv.slice(2));}catch(e){console.error('BACKEND_PLAN_DRAFT_ABORT: '+e.stack);process.exitCode=1;}}
module.exports={main};
