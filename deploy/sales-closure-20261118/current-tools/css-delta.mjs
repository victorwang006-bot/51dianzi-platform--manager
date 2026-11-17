import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {AR,H,assert} from './native-core.mjs';
const require=createRequire(AR+'/package.json'),postcss=require('postcss');
export function compileScopedCSSDelta(file,pin){
 const relative=path.relative(AR,file);assert(!relative.startsWith('..'),'CSS source containment');
 const baseGit='f053ca2bee29c72cb69335548381be8289dc0ee8:'+relative;
 const base=execFileSync('git',['show',baseGit],{cwd:AR,encoding:'utf8',maxBuffer:4*1024*1024}),current=pin(file);
 assert(current.startsWith(base),'CSS_NON_APPEND_CHANGE_REQUIRES_EXPLICIT_REVIEW');
 const delta=current.slice(base.length);assert(delta.trim(),'missing appended CSS delta');
 const a=postcss.parse(delta,{from:file});
 a.walkAtRules(rule=>assert(rule.name==='media'||rule.name==='supports','no global CSS at-rule '+rule.name));
 let rules=0;const scopes=':is(.crm-sales-orders-page,.crm-sales-orders-dialog,.crm-sales-orders-embedded)';
 a.walkRules(rule=>{rules++;rule.selectors=rule.selectors.map(s=>{assert(!/(^|[\s,])(html|body|:root)([\s.#:[,]|$)/.test(s),'global selector forbidden '+s);assert(/\.(crm-order-|company-lot-)/.test(s),'only explicit order/dropdown delta selector '+s);return /^\.crm-sales-orders-(?:page|dialog|embedded)\b/.test(s)?s:scopes+' '+s;});});
 assert(rules>0,'CSS delta rules');const code='/* Content-addressed CRM-only appended styles; original global CSS untouched. */\n'+a.toString().trim()+'\n';
 return {code,evidence:{file,baseGit,baseSha256:H(base),sourceSha256:H(current),deltaSha256:H(delta),outputSha256:H(code),appendOnlyVerified:true,rules,scope:scopes,globalCSSNotCopiedOrOverridden:true}};
}
