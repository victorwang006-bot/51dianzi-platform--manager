import assert from "node:assert/strict";
import dotenv from "dotenv";
import {MysqlZhijieSourceAdapter} from "../../server/zhijie/source";
import {MysqlZhijieAccessStore} from "../../server/zhijie/store";
import {validateAccess,scopeOwner,readableModules,hasSourcePermission} from "../../server/zhijie/policy";
import {ZHIJIE_MODULES,type ZhijieStaffAccess} from "../../shared/zhijieBusiness";

dotenv.config({path:"/opt/config/dianzi51-admin/runtime.env",override:true,quiet:true});
assert.equal(new URL(process.env.DATABASE_URL!).pathname,"/dianzi51_admin");
const store=new MysqlZhijieAccessStore();
const checks:Record<string,boolean>={};
try{
 const source=await new MysqlZhijieSourceAdapter().loadSnapshot();
 checks.schemaReady=await store.isSchemaReady();assert(checks.schemaReady);
 const grantsBefore=await store.listStaff();
 const auditsBefore=await store.listAudits(50);
 const adminAccounts=await store.listAdminAccounts();
 const members=source.members.filter(x=>x.status==="active"),teams=source.teams.filter(x=>x.status==="active");assert(members.length>0);assert(teams.length>0);
 // Hypothetical candidates exist only in memory; no grant(), insert or update is called.
 const ordinary=members.find(x=>!x.isOwner&&hasSourcePermission(x,"customers.manage"))??members.find(x=>hasSourcePermission(x,"customers.manage"));assert(ordinary);
 const candidate:ZhijieStaffAccess={adminUserId:1,sourceMemberId:ordinary.memberId,sourceUserId:ordinary.userId,role:"employee",teamIds:[],grants:{customers:["read"]},status:"active",revision:1};
 checks.employeeOwnOnly=validateAccess(candidate,ordinary,source.teams).ok&&scopeOwner(candidate,source.teams)?.kind==="self";assert(checks.employeeOwnOnly);
 checks.employeeCannotWiden=!validateAccess({...candidate,teamIds:[teams[0].id]},ordinary,source.teams).ok;assert(checks.employeeCannotWiden);
 checks.noGrantNoBusiness=readableModules({...candidate,grants:{}},ordinary).length===0;assert(checks.noGrantNoBusiness);
 checks.disabledDenied=scopeOwner({...candidate,status:"disabled"},source.teams)===null&&readableModules({...candidate,status:"disabled"},ordinary).length===0;assert(checks.disabledDenied);
 checks.sourceSuspendedDenied=!validateAccess(candidate,{...ordinary,status:"suspended"},source.teams).ok;assert(checks.sourceSuspendedDenied);
 const leader=members.find(x=>x.teamId&&teams.some(t=>t.id===x.teamId&&t.leaderUserId===x.userId));assert(leader);
 const manager={...candidate,sourceMemberId:leader.memberId,sourceUserId:leader.userId,role:"team_manager" as const,teamIds:[leader.teamId!],grants:{}};
 checks.teamManagerUsesExistingPrimaryTeam=validateAccess(manager,leader,source.teams).ok&&scopeOwner(manager,source.teams)?.kind==="team";assert(checks.teamManagerUsesExistingPrimaryTeam);
 const senior={...candidate,role:"department_manager" as const,teamIds:teams.map(t=>t.id)};
 checks.seniorExplicitExistingTeams=validateAccess(senior,ordinary,source.teams).ok&&scopeOwner(senior,source.teams)?.kind==="teams";assert(checks.seniorExplicitExistingTeams);
 checks.emptySeniorScopeDenied=!validateAccess({...senior,teamIds:[]},ordinary,source.teams).ok;assert(checks.emptySeniorScopeDenied);
 const nonexistent=Math.max(...source.teams.map(t=>t.id))+999999;
 checks.nonexistentTeamDenied=!validateAccess({...senior,teamIds:[nonexistent]},ordinary,source.teams).ok;assert(checks.nonexistentTeamDenied);
 checks.noDefaultModuleGrant=ZHIJIE_MODULES.every(m=>!readableModules({...candidate,grants:{}},ordinary).includes(m.id));assert(checks.noDefaultModuleGrant);
 const grantsAfter=await store.listStaff(),auditsAfter=await store.listAudits(50);
 assert.deepEqual(grantsAfter,grantsBefore);assert.deepEqual(auditsAfter,auditsBefore);checks.accessAndAuditUnchanged=true;
 const result={time:new Date().toISOString(),method:"ECS direct read-only data-interface and in-memory policy verification",checks,sourceMembers:source.members.length,activeTeams:teams.length,activeAdminAccounts:adminAccounts.filter(x=>x.status==="active").length,savedBusinessAuthorizations:grantsBefore.length,auditCountReturned:auditsBefore.length,createdSessions:false,changedAuthorizations:false,changedBusinessData:false,browserAuthenticatedFlowTested:false};
 console.log(JSON.stringify(result));
}catch(error){
 console.error(JSON.stringify({acceptanceFailed:true,code:(error as {code?:string}).code??"ASSERTION_OR_SOURCE_ERROR",message:"只读验收发现问题；未生成登录Token、未修改授权或业务数据。"}));process.exitCode=1;
}finally{
 await (store as unknown as {pool:{end():Promise<void>}}).pool.end();
}
