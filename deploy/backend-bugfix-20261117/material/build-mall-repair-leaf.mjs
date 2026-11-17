import fs from 'node:fs';import crypto from 'node:crypto';import ts from 'typescript';import {transform} from 'esbuild';
if(!process.argv[2]||!process.argv[3])throw Error('Usage: node build-mall-repair-leaf.mjs <frozen-live-leaf> <new-output-directory>');
const baseline=process.argv[2],out=process.argv[3];
const before=fs.readFileSync(baseline,'utf8'),sha=s=>crypto.createHash('sha256').update(s).digest('hex'),assert=(v,m)=>{if(!v)throw Error(m)};
assert(sha(before)==='ab0ad625d60050cde1e75f4f36bc0ecbb7501be8a4220b358040586eebfd7e8b','ACTUAL_LEAF_SHA');
const parse=s=>{const a=ts.createSourceFile('leaf.js',s,99,true,1);assert(!a.parseDiagnostics.length,'SYNTAX');return a},a=parse(before);
const nodes=(node,p)=>{let out=[];function v(n){if(p(n))out.push(n);ts.forEachChild(n,v)}v(node);return out},one=(x,m)=>{assert(x.length===1,m+':'+x.length);return x[0]};
const main=one(nodes(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='Lf'&&n.getText(a).includes('officialMall.status.query')),'ACTUAL_MAIN'),edits=[];
const add=(start,end,after,reason)=>edits.push({start,end,before:before.slice(start,end),after,reason});
function exact(old,after,reason){const slice=main.getText(a),positions=[...slice.matchAll(new RegExp(old.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'))];assert(positions.length===1,'EXACT_'+reason+':'+positions.length);const start=main.getStart(a)+positions[0].index;add(start,start+old.length,after,reason)}
const policyFile=new URL('../../../shared/officialMallSuggestPolicy.ts',import.meta.url),policy=fs.readFileSync(policyFile,'utf8');
const p=parse((await transform(policy,{loader:'ts',format:'esm'})).code),helper=one(nodes(p,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='officialMallCreateTeam'),'POLICY');
add(main.getStart(a),main.getStart(a),helper.getText(p).replace(/^export /,'')+'\n','shared_team_policy_only');
const debounce=one(nodes(main,n=>ts.isCallExpression(n)&&n.expression.getText(a)==='Rt'&&n.getText(a).includes('setTimeout')),'ONE_DEBOUNCE');
add(debounce.getStart(a),debounce.getStart(a),'const __createTeam=officialMallCreateTeam(s,xe),__effectiveTeamId=__createTeam.teamId;let[__suggestBrand,__setSuggestBrand]=Ue("");','local_team_and_brand_state');
exact('setTimeout(()=>na(Ee.partNumber.trim()),250)','setTimeout(()=>{na(Ee.partNumber.trim());__setSuggestBrand(Ee.brand.trim())},500)','500ms_both_fields');
exact('[Ee.partNumber]','[Ee.partNumber,Ee.brand]','both_field_dependencies');
exact('nt.length>0&&nt===Ee.partNumber.trim()','nt.length>=3&&nt===Ee.partNumber.trim()&&__suggestBrand===Ee.brand.trim()','minimum_and_current_generation');
exact('Ei={query:nt,brand:Ee.brand.trim()||void 0}','Ei={query:nt,brand:__suggestBrand||void 0}','debounced_brand');
exact('originalTeamId:(v==="create"||v==="import"?xe:void 0)','originalTeamId:(v==="create"||v==="import"?__effectiveTeamId:void 0)','receipt_actual_team');
for(const method of ['create','importRows']){
 const call=one(nodes(main,n=>ts.isCallExpression(n)&&n.expression.getText(a)==='a.client.officialMall.'+method+'.mutate'),'MUTATE_'+method);
 const spread=one(nodes(call.arguments[0],n=>ts.isSpreadAssignment(n)&&n.getText(a).includes('teamId:xe')),'TEAM_SPREAD_'+method);
 add(spread.getStart(a),spread.end,'...(__effectiveTeamId?{teamId:__effectiveTeamId}:{})','explicit_valid_team_'+method);
}
const run=one(nodes(main,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ht'),'WRITE_GATE');
add(run.body.getStart(a)+1,run.body.getStart(a)+1,'if((v==="create"||v==="import")&&__createTeam.problem){Z(__createTeam.problem);me.current=__createTeam.problem;return "rejected";}','no_team_uuid_not_created');
const teamCall=one(nodes(main,n=>ts.isCallExpression(n)&&n.arguments[0]?.text==='label'&&n.arguments[1]?.getText(a).includes('className:"mall-team"')),'TEAM_UI');let team=teamCall;while(ts.isBinaryExpression(team.parent))team=team.parent;
const newTeam='q.kind==="create"&&s?.scope.isSuperAdmin&&!!s.teams?.length&&le("label",{className:"mall-team",children:["归属团队",le("select",{"aria-label":"归属官方团队",disabled:Oe||!u||!!y||!!k||s.teams.length===1,value:__effectiveTeamId??"",onChange:v=>Q(v.target.value?Number(v.target.value):void 0),children:[s.teams.length>1&&W("option",{value:"",children:"请选择有效官方团队"}),s.teams.map(v=>W("option",{value:v.id,children:v.name},v.id))]}),s.teams.length===1&&W("small",{children:"已自动选择唯一有效官方团队；保存时服务端再次核验。"})]}),q.kind==="create"&&__createTeam.problem&&W("p",{className:"mall-form-error",role:"alert",children:__createTeam.problem}),(q.kind==="edit"||q.kind==="create"&&ve==="manual")&&W("p",{className:"mall-hint",children:"型号至少输入3个字符，停顿500毫秒后查询；精确型号优先，未命中再提供有限前缀候选。联想失败或未命中不影响手工保存。"})';
add(team.getStart(a),team.end,newTeam,'single_multi_zero_active_team_ui');
const primary=nodes(main,n=>ts.isCallExpression(n)&&n.arguments[0]?.text==='button'&&ts.isObjectLiteralExpression(n.arguments[1])&&n.arguments[1].properties.some(p=>ts.isPropertyAssignment(p)&&p.name.getText(a)==='className'&&p.initializer.text==='mall-primary'));
assert(primary.length===2,'TWO_PRIMARY_ACTIONS');for(const button of primary){const d=one(button.arguments[1].properties.filter(p=>ts.isPropertyAssignment(p)&&p.name.getText(a)==='disabled'),'PRIMARY_DISABLED');add(d.initializer.getStart(a),d.initializer.end,'('+d.initializer.getText(a)+')||(q.kind==="create"&&!!__createTeam.problem)','team_save_gate');}
edits.sort((x,y)=>x.start-y.start||x.end-y.end);let result='',cursor=0;for(const e of edits){assert(e.start>=cursor,'OVERLAP');assert(before.slice(e.start,e.end)===e.before,'CAS');result+=before.slice(cursor,e.start);e.outputStart=result.length;result+=e.after;e.outputEnd=result.length;cursor=e.end}result+=before.slice(cursor);parse(result);
let inverse=result;for(const e of [...edits].reverse()){assert(inverse.slice(e.outputStart,e.outputEnd)===e.after,'INVERSE_CAS');inverse=inverse.slice(0,e.outputStart)+e.before+inverse.slice(e.outputEnd)}assert(inverse===before,'FULL_BYTES_INVERSE');
assert(result.slice(0,before.indexOf('export function'))===before.slice(0,before.indexOf('export function')),'NI_IMPORT_RETAINED');
const hash=sha(result),name='OfficialMall-model-team-repair-'+hash.slice(0,16)+'.js';fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/'+name,result);
const proof={offlineOnly:true,file:out+'/'+name,beforeSha256:sha(before),afterSha256:hash,replacesUrl:'/assets/OfficialMall-new-information-ab0ad625d60050cd.js',candidateUrl:'/assets/'+name,fullBytesInverse:true,existingReactTRPCAuthNewInformationBridgePreserved:true,allUnrelatedBytesPreserved:true,edits};fs.writeFileSync(out+'/leaf-proof.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({file:proof.file,sha256:hash,edits:edits.length,inverse:true}));
