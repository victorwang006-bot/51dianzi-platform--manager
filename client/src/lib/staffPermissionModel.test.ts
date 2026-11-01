import { describe, expect, it, vi } from "vitest";
import {
  adminPermissionsForUpdate,
  evaluateBffReadiness,
  mergeStaffRows,
  parseStaffBinding,
  protectedStaffErpKeys,
  readStaffMerchantSelection,
  runGuardedStaffErpMutation,
  selectOfficialStaffMerchant,
  staffChangePreview,
  type StaffRow,
  toggleStaffErpPermission,
  validateStaffBusinessContext,
  validateStaffEnterpriseSummary,
  type StaffAdminAccount,
  type StaffEnterpriseMember,
} from "./staffPermissionModel";

const admin: StaffAdminAccount = {
  id: 7,
  username: "operator-a",
  displayName: "运营 A",
  email: null,
  phone: null,
  adminRole: "merchant_mgr",
  status: "active",
  permissions: ["merchants.read", "profile.manage"],
};

const member: StaffEnterpriseMember = {
  memberId: 9,
  userId: 88,
  displayName: "前台员工 A",
  phone: null,
  role: "member",
  status: "active",
  permissionKeys: ["inventory.manage"],
  inventoryDataScope: "own",
  isOwner: false,
};

describe("staff permission model", () => {
  it("对 URL merchantId fail closed，并且只接受导航实际返回的官方商户", () => {
    expect(readStaffMerchantSelection("?merchantId=30061&merchantId=30061").status).toBe("invalid");
    expect(readStaffMerchantSelection("?merchantId=3.0061").status).toBe("invalid");
    expect(readStaffMerchantSelection("?merchantId=30062").status).toBe("invalid");
    const selection = readStaffMerchantSelection("");
    expect(selectOfficialStaffMerchant({ merchants: [] }, selection).merchantId).toBeNull();
    expect(selectOfficialStaffMerchant({ merchants: [{ id: 30061 }] }, selection).merchantId).toBe(30061);
  });

  it("要求 ready principal、精确后台账号、前台用户、企业和商户以及成员管理读写能力", () => {
    const valid = {
      merchant: { id: 30061 },
      enterprise: { id: 3 },
      staffPrincipal: {
        status: "ready",
        frontendUserId: 88,
        adminAccountId: 7,
        enterpriseId: 3,
        user: { id: 88 },
      },
      workbenchCapabilities: ["enterprise.members.manage"],
      writeCapabilities: ["enterprise.members.manage"],
    };
    expect(validateStaffBusinessContext(valid, 7, 30061).context).not.toBeNull();
    expect(validateStaffBusinessContext({ ...valid, staffPrincipal: { ...valid.staffPrincipal, adminAccountId: 8 } }, 7, 30061).context).toBeNull();
    expect(validateStaffBusinessContext({ ...valid, writeCapabilities: [] }, 7, 30061).context).toBeNull();
    expect(validateStaffBusinessContext({ ...valid, enterprise: { id: 4 } }, 7, 30061).context).toBeNull();
    expect(validateStaffBusinessContext({ ...valid, enterprise: undefined }, 7, 30061).context).toBeNull();
  });

  it("企业摘要必须属于已核验的同一企业和前台员工，错位时停止成员读取与设置", () => {
    const context = { merchantId: 30061, enterpriseId: 3, frontendUserId: 88, capabilities: ["enterprise.members.manage"], writeCapabilities: ["enterprise.members.manage"] };
    const summary = { enterprise: { id: 3 }, currentUserId: 88 };
    expect(validateStaffEnterpriseSummary(summary, context)).toBe(true);
    expect(validateStaffEnterpriseSummary({ ...summary, enterprise: { id: 4 } }, context)).toBe(false);
    expect(validateStaffEnterpriseSummary({ ...summary, currentUserId: 89 }, context)).toBe(false);
    expect(validateStaffEnterpriseSummary({ currentUserId: 88 }, context)).toBe(false);
    expect(validateStaffEnterpriseSummary(summary, null)).toBe(false);
  });

  it("非所有者遇到超出可授予范围的既有权限时锁定整个权限集合，不能通过无关勾选误撤权", () => {
    const current = ["inventory.manage"] as const;
    const grantable = ["enterprise.members.manage", "inquiry.receive"] as const;
    expect(protectedStaffErpKeys(current, grantable, false)).toEqual(["inventory.manage"]);
    expect(toggleStaffErpPermission(current, "inquiry.receive", grantable, false)).toEqual(["inventory.manage"]);
    expect(toggleStaffErpPermission(current, "inventory.manage", grantable, false)).toEqual(["inventory.manage"]);
    expect(protectedStaffErpKeys(current, ["inventory.manage"], true)).toEqual([]);
  });

  it("可授予权限正常勾选时保留完整原集合及客户管理依赖，不添加未授权项目", () => {
    const grantable = ["inventory.manage", "inquiry.receive", "customers.manage", "customers.manage_all"] as const;
    expect(toggleStaffErpPermission(["inventory.manage"], "inquiry.receive", grantable, false)).toEqual(["inventory.manage", "inquiry.receive"]);
    expect(toggleStaffErpPermission([], "customers.manage_all", grantable, false)).toEqual(["customers.manage", "customers.manage_all"]);
    expect(toggleStaffErpPermission(["inventory.manage"], "procurement.orders", grantable, false)).toEqual(["inventory.manage"]);
  });

  it("只通过 binding.frontUserId 与 member.userId 合并，不按显示名合并", () => {
    const rows = mergeStaffRows({
      admins: [admin],
      members: [member, { ...member, memberId: 10, userId: 89, displayName: "运营 A" }],
      bindings: new Map([[7, { state: "bound" as const, binding: { adminUserId: 7, frontUserId: 88, bindingVersion: 1 } }]]),
      scopes: new Map([[7, { merchantId: 30061, modulePermissions: ["business.context.read", "business.inventory.read", "business.inventory.write"] }]]),
      expectedMerchantId: 30061,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].member?.userId).toBe(88);
    expect(rows[1].admin).toBeUndefined();
    expect(rows[1].member?.userId).toBe(89);
  });

  it("拒绝不属于查询目标后台账号的 binding，并在合并和 BFF 计算中再次校验", () => {
    expect(parseStaffBinding({ adminUserId: 8, frontUserId: 88, bindingVersion: 1 }, 7)).toBeNull();
    expect(parseStaffBinding({ adminUserId: 7, frontUserId: 88, bindingVersion: 1 }, 7)).toEqual({ adminUserId: 7, frontUserId: 88, bindingVersion: 1 });

    const mismatched = { adminUserId: 8, frontUserId: 88, bindingVersion: 1 };
    const readiness = evaluateBffReadiness({
      admin,
      member,
      binding: mismatched,
      bindingState: "bound",
      scopeState: "ready",
      scope: { merchantId: 30061, modulePermissions: ["business.context.read", "business.inventory.read", "business.inventory.write"] },
      expectedMerchantId: 30061,
    });
    expect(readiness.state).toBe("unlinked");

    const rows = mergeStaffRows({
      admins: [admin],
      members: [member],
      bindings: new Map([[7, { state: "bound" as const, binding: mismatched }]]),
      scopes: new Map([[7, { state: "ready" as const, scope: { merchantId: 30061, modulePermissions: ["business.context.read"] } }]]),
      expectedMerchantId: 30061,
    });
    expect(rows[0]).toMatchObject({ admin, binding: null, member: undefined });
    expect(rows[0].bff.state).not.toBe("ready");
  });

  it("ERP 勾选不替代 BFF scope，准确报告缺少的 read/write 范围", () => {
    const readiness = evaluateBffReadiness({
      admin,
      member,
      binding: { adminUserId: 7, frontUserId: 88, bindingVersion: 1 },
      bindingState: "bound",
      scopeState: "ready",
      scope: { merchantId: 30061, modulePermissions: ["business.context.read", "business.inventory.read"] },
      expectedMerchantId: 30061,
    });
    expect(readiness.state).toBe("scope-incomplete");
    expect(readiness.missingPermissions).toEqual(["business.inventory.write"]);

    const wrongMerchant = evaluateBffReadiness({
      admin,
      member,
      binding: { adminUserId: 7, frontUserId: 88, bindingVersion: 1 },
      bindingState: "bound",
      scopeState: "ready",
      scope: { merchantId: 30062, modulePermissions: ["business.context.read", "business.inventory.read", "business.inventory.write"] },
      expectedMerchantId: 30061,
    });
    expect(wrongMerchant.state).toBe("scope-unavailable");
  });

  it("只有可信 bound、精确商户 active scope 和 ready BFF 才执行 ERP mutation", async () => {
    const access = {
      available: true,
      canManageMembers: true,
      actorIsOwner: true,
      currentUserId: 99,
      grantableKeys: ["inventory.manage"] as const,
    };
    const readyRow: StaffRow = {
      key: "admin:7",
      admin,
      member,
      binding: { adminUserId: 7, frontUserId: 88, bindingVersion: 1 },
      bindingState: "bound",
      scope: { merchantId: 30061, modulePermissions: ["business.context.read", "business.inventory.read", "business.inventory.write"] },
      scopeState: "ready",
      bff: { state: "ready", missingPermissions: [], detail: "verified" },
    };
    const unsafeRows: Array<[string, StaffRow]> = [
      ["目标未绑定", { ...readyRow, binding: null, bindingState: "unbound", bff: { state: "unlinked", missingPermissions: [], detail: "unbound" } }],
      ["目标缺少商户 scope", { ...readyRow, scope: null, scopeState: "missing", bff: { state: "scope-unavailable", missingPermissions: ["business.context.read"], detail: "missing scope" } }],
      ["scope 查询失败", { ...readyRow, scope: null, scopeState: "error", bff: { state: "checking", missingPermissions: [], detail: "scope error" } }],
      ["binding admin ID 错配", { ...readyRow, binding: { adminUserId: 8, frontUserId: 88, bindingVersion: 1 } }],
    ];

    for (const [, unsafeRow] of unsafeRows) {
      const mutation = vi.fn(async () => "sent");
      const result = await runGuardedStaffErpMutation(unsafeRow, access, mutation);
      expect(result.allowed).toBe(false);
      expect(mutation).not.toHaveBeenCalled();
    }

    const mutation = vi.fn(async () => "sent");
    const result = await runGuardedStaffErpMutation(readyRow, access, mutation);
    expect(result).toMatchObject({ allowed: true, value: "sent" });
    expect(mutation).toHaveBeenCalledOnce();
  });

  it("变更预览稳定排序，并在后台更新时保留固定 profile.manage", () => {
    const preview = staffChangePreview(
      { adminRole: "merchant_mgr", adminPermissions: ["merchants.read"], erpPermissionKeys: ["inventory.manage"], inventoryDataScope: "own" },
      { adminRole: "merchant_mgr", adminPermissions: ["merchants.read", "messages.read"], erpPermissionKeys: ["inventory.publish"], inventoryDataScope: "enterprise" },
    );
    expect(preview.adminAdded).toEqual(["messages.read"]);
    expect(preview.erpRemoved).toEqual(["inventory.manage"]);
    expect(preview.scopeChanged).toBe(true);
    expect(adminPermissionsForUpdate(["profile.manage", "business.inventory.read"], ["messages.write"], "merchant_mgr"))
      .toEqual(expect.arrayContaining(["profile.manage", "business.inventory.read", "messages.read", "messages.write"]));
  });
});
