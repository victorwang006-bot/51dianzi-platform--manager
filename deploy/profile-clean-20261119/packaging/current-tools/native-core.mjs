import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {createRequire} from 'node:module';
export const BASE='/home/ubuntu/work/profile-clean-20261119',AR='/home/ubuntu/work/commission-simple-20261118/manager',FR='/home/ubuntu/work/commission-simple-20261118/platform';
const req=createRequire(FR+'/package.json');
export const ts=req('typescript'),esbuild=req('esbuild');
export const H=b=>crypto.createHash('sha256').update(b).digest('hex');
export const assert=(v,m)=>{if(!v)throw Error(m);};
export const one=(xs,m)=>{assert(xs.length===1,m+': '+xs.length);return xs[0];};
export function parse(s,n='actual.js'){const a=ts.createSourceFile(n,s,99,true,n.endsWith('.tsx')?4:n.endsWith('.ts')?3:1);assert(!a.parseDiagnostics.length,'SYNTAX '+n);return a;}
export function nodes(a,p){const r=[];function walk(n){if(p(n))r.push(n);n.forEachChild(walk);}walk(a);return r;}
export function declaration(a,name){return one(nodes(a,n=>(ts.isFunctionDeclaration(n)||ts.isVariableDeclaration(n))&&n.name?.text===name),'DECLARATION '+name);}
export const patch=(a,n,after,reason)=>({start:n.getStart(a),end:n.end,before:n.getText(a),after,reason});
export function bytesDelta(original,patches,{javascript=true}={}){
 const input=Buffer.isBuffer(original)?original:Buffer.from(original),text=input.toString('utf8');assert(Buffer.from(text).equals(input),'EXACT_UTF8');const ps=[...patches].sort((a,b)=>a.start-b.start||a.end-b.end);let offset=0;
 const records=ps.map((p,i)=>{assert(text.slice(p.start,p.end)===p.before,'PREIMAGE '+p.reason);if(i)assert(ps[i-1].end<=p.start,'OVERLAPPING_HUNKS');const byteStart=Buffer.byteLength(text.slice(0,p.start)),byteEnd=Buffer.byteLength(text.slice(0,p.end)),old=Buffer.from(p.before),next=Buffer.from(p.after),newByteStart=byteStart+offset;offset+=next.length-old.length;return{byteStart,byteEnd,newByteStart,newByteEnd:newByteStart+next.length,oldBase64:old.toString('base64'),newBase64:next.toString('base64'),oldSha256:H(old),newSha256:H(next),reason:p.reason};});
 let candidate=input;for(const p of [...records].reverse())candidate=Buffer.concat([candidate.subarray(0,p.byteStart),Buffer.from(p.newBase64,'base64'),candidate.subarray(p.byteEnd)]);verifyInverse(candidate,input,{patches:records});if(javascript)parse(candidate.toString());return{candidate,records,beforeSha256:H(input),afterSha256:H(candidate),inverseVerified:true};
}
export function verifyInverse(candidate,baseline,delta){let b=Buffer.from(candidate);for(const p of [...delta.patches].reverse()){assert(b.subarray(p.newByteStart,p.newByteEnd).equals(Buffer.from(p.newBase64,'base64')),'INVERSE_CANDIDATE_PREIMAGE');b=Buffer.concat([b.subarray(0,p.newByteStart),Buffer.from(p.oldBase64,'base64'),b.subarray(p.newByteEnd)]);}assert(b.equals(baseline),'EXACT_BYTE_INVERSE');}
export function compilerClosure(){
 const files={[fs.realpathSync(process.execPath)]:H(fs.readFileSync(process.execPath))},roots=new Set();for(const name of ['typescript','esbuild']){let d=path.dirname(fs.realpathSync(req.resolve(name)));while(!fs.existsSync(d+'/package.json')||JSON.parse(fs.readFileSync(d+'/package.json')).name!==name)d=path.dirname(d);roots.add(d);}
 const platform=path.resolve(path.dirname(fs.realpathSync(req.resolve('esbuild'))),'../../@esbuild');if(fs.existsSync(platform))for(const n of fs.readdirSync(platform))roots.add(fs.realpathSync(platform+'/'+n));
 function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=d+'/'+e.name;if(e.name==='node_modules')continue;if(e.isDirectory())walk(f);else if(e.isFile())files[fs.realpathSync(f)]=H(fs.readFileSync(f));}}for(const d of roots)walk(d);return Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)));
}
export function saveJSON(p,v){fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n',{mode:0o600});}
