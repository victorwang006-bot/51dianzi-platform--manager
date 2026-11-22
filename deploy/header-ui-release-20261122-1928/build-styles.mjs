#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const W=path.dirname(new URL(import.meta.url).pathname),R='/home/ubuntu/work/channel-release-20261121-1837/manager',req=createRequire(R+'/package.json'),postcss=req('postcss'),H=x=>crypto.createHash('sha256').update(x).digest('hex');
const C=JSON.parse(fs.readFileSync(W+'/capture/records.json')),records=Object.values(C).filter(x=>x.path.includes('/assets/procurement-notification-redesign-')&&x.path.endsWith('.css'));
assert.equal(records.length,1);
const rec=records[0],old=fs.readFileSync(rec.local,'utf8');assert.equal(H(old),rec.sha256);
const patches=[];
postcss.parse(old).walkRules(n=>{
 if(!n.selector.includes('admin-new-information-status'))return;
 // PostCSS end.offset is exclusive in the installed version. Exact source text,
 // not an assumed endpoint convention, determines each byte-preserving splice.
 const before=n.toString(),start=n.source.start.offset,end=start+before.length;
 assert.equal(old.slice(start,end),before,'EXACT_STATUS_RULE_SOURCE');
 assert(Math.abs(end-n.source.end.offset)<=1,'POSTCSS_ENDPOINT_CONTRACT');
 patches.push({start,end,before,after:'',selector:n.selector});
});
assert.equal(patches.length,12,'EXACT_PRIOR_STATUS_RULE_SET');
let next=old;
for(const p of [...patches].reverse())next=next.slice(0,p.start)+next.slice(p.end);
let inverse=next;
for(const p of patches)inverse=inverse.slice(0,p.start)+p.before+inverse.slice(p.start);
assert.equal(inverse,old,'FULL_CSS_BYTE_INVERSE');assert(!next.includes('admin-new-information-status'));
const basePath=R+'/client/src/components/admin/AdminWorkspaceNavigation.css',headerPath=R+'/client/src/components/admin/AdminHeaderNavigation.css';
const base=fs.readFileSync(basePath,'utf8'),header=fs.readFileSync(headerPath,'utf8');
const suffix='\n/* header-ui-release-20261122-1928: source-derived navigation and header-only layout */\n'+base+'\n'+header;
const preserved=next;next+=suffix;postcss.parse(next);assert.equal(next.slice(0,-suffix.length),preserved);
const sha=H(next),url='/assets/header-notification-removal-'+sha.slice(0,16)+'.css',local=W+'/styles-candidate'+url;
fs.mkdirSync(path.dirname(local),{recursive:true});fs.writeFileSync(local,next);
const manifest={scope:'header-ui-release-20261122-1928',assets:[{local,url,sha256:sha,size:Buffer.byteLength(next)}],cssURL:url,oldCSSURL:'/assets/'+path.basename(rec.path),replacements:{},sourcePins:{[headerPath]:H(header),[basePath]:H(base)},patches,suffix:{baseSourceSHA:H(base),headerSourceSHA:H(header),sha256:H(suffix),bytes:Buffer.byteLength(suffix)},checks:{onlyStatusRulesDeleted:true,priorProcurementAndBadgeRulesBytePreserved:true,fullByteInverse:true,sourceNavigationAndHeaderSuffixExact:true,allOtherNativeCssFilesRetained:true},tests:{cssParse:true,deletedStatusRules:patches.length},note:'Customer auxiliary JSX and source CSS deleted by approved commit; historic immutable CSS layers retained unchanged to preserve native page styles, no CSS hiding.'};
fs.writeFileSync(W+'/styles-candidate/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({status:'EXACT_STATUS_CSS_REMOVAL_PLUS_SOURCE_HEADER',url,rules:patches.length,size:Buffer.byteLength(next)}));
