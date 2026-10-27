import { describe, it, expect } from "vitest";
import {validateAccess,readableModules,hasSourcePermission} from "./zhijie/policy";
import type {ZhijieSourceMember,ZhijieStaffAccess,ZhijieTeam} from "../shared/zhijieBusiness";
const member:ZhijieSourceMember={memberId:2,userId:200,name:"隔离测试成员",status:"active",teamId:10,sourcePermissions:["customers.manage","procurement.orders","inventory.manage"],isOwner:false};
const team:ZhijieTeam={id:10,name:"隔离测试组",leaderUserId:200,status:"active"};
const access:ZhijieStaffAccess={adminUserId:2,sourceMemberId:2,sourceUserId:200,role:"employee",teamIds:[],grants:{customers:["read"]},status:"active",revision:1};
describe("原权威权限与敏感能力",()=>{
 it("企业所有者有权威ERP能力但没有后台grant仍不能读",()=>{const owner={...member,isOwner:true,sourcePermissions:[]};expect(hasSourcePermission(owner,"customers.manage")).toBe(true);expect(readableModules({...access,grants:{}},owner)).toEqual([]);});
 it("普通员工不能分配他人",()=>{expect(validateAccess({...access,grants:{customers:["read","assign"]}},member,[team]).ok).toBe(false);});
 it("仅库存维护不能获得发布",()=>{expect(validateAccess({...access,grants:{inventory:["read","publish"]}},member,[team]).ok).toBe(false);});
 it("岗位不会让一般成员取得印章能力",()=>{expect(validateAccess({...access,role:"department_manager",teamIds:[10],grants:{templates:["read","seal"]}},member,[team]).ok).toBe(false);});
 it("维护必须同时有读权限",()=>{expect(validateAccess({...access,grants:{customers:["maintain"]}},member,[team]).ok).toBe(false);});
 it("停用后无模块，源权限撤销也无模块",()=>{expect(readableModules({...access,status:"disabled"},member)).toEqual([]);expect(readableModules(access,{...member,sourcePermissions:[]})).toEqual([]);});
});
