import { describe, expect, it, vi } from "vitest";
import {
  adminPermissionsForUpdate,
  evaluateBffReadiness,
  STAFF_PERMISSION_TABS,
  staffPermissionTab,
  staffDraftForPage,
  readStaffBusinessOrganization,
  staffBusinessTeamGuard,
  staffDraftFromRow,
  mergeStaffRows,
  parseStaffBinding,
  protectedStaffErpKeys,
  readStaffMerchantSelection,
  runGuardedStaffErpMutation,
  selectOfficialStaffMerchant,
  staffChangePreview,
  staffErpPermissionPreview,
  staffRowNeedsAssociation,
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

  it("普通后台操作权限保存保留独立官方四权限，不把它们混入ERP或可见操作控件", () => {
    const official = ["officialInventory.read", "officialInventory.write", "officialInventory.publish", "officialInventory.note"];
    expect(adminPermissionsForUpdate([...official, "profile.manage"], ["messages.read"], "operation"))
      .toEqual(expect.arrayContaining([...official, "profile.manage", "messages.read"]));
  });

  it("列表展示只显示前两项真实 ERP 权限，并把其余项交给统一配置窗口", () => {
    const preview = staffErpPermissionPreview({
      member: {
        ...member,
        permissionKeys: ["inventory.manage", "inquiry.receive", "sales_orders.manage"],
      },
    });
    expect(preview).toEqual({ labels: ["我的库存", "询价接待"], remaining: 1, total: 3 });
    expect(staffErpPermissionPreview({ member: { ...member, isOwner: true } }))
      .toEqual({ labels: ["全部 ERP 权限"], remaining: 0, total: 1 });
    expect(staffErpPermissionPreview({ member: undefined })).toEqual({ labels: [], remaining: 0, total: 0 });
  });

  it("待关联仅由真实合并行的后台账号和企业成员缺失状态决定", () => {
    expect(staffRowNeedsAssociation({ admin, member })).toBe(false);
    expect(staffRowNeedsAssociation({ admin })).toBe(true);
    expect(staffRowNeedsAssociation({ member })).toBe(true);
  });
});

describe("五页签与同源业务团队模型", () => {
  const context = {
    merchantId: 30061,
    enterpriseId: 15,
    frontendUserId: 20,
    capabilities: ["enterprise.members.manage"],
    writeCapabilities: ["enterprise.members.manage"],
  };
  const organization = {
    enterprise: { id: 15, name: "测试企业" },
    actorUserId: 20,
    canManage: true,
    teams: [{ id: 11, name: "智捷团队1", status: "active", revision: 2 }],
    members: [
      {
        userId: 88,
        teamId: 11,
        teamRole: "member" as const,
        revision: 6,
        status: "active",
        enterpriseRole: "member",
      },
    ],
  };
  const access = {
    available: true,
    canManageMembers: true,
    actorIsOwner: true,
    currentUserId: 20,
    grantableKeys: ["inventory.manage"] as const,
  };
  const row: StaffRow = {
    key: "admin:7",
    admin,
    member,
    binding: { adminUserId: 7, frontUserId: 88, bindingVersion: 1 },
    bindingState: "bound",
    scopeState: "ready",
    bff: { state: "ready", missingPermissions: [], detail: "verified" },
  };
  it("五个真实页签合并员工资料/成员与ERP/scope，不新增权限键", () => {
    expect(STAFF_PERMISSION_TABS.map(tab => tab.label)).toEqual([
      "员工资料",
      "平台权限",
      "渠道库存",
      "业务ERP",
      "账号与安全",
    ]);
    expect(staffPermissionTab("member")).toBe("basic");
    expect(staffPermissionTab("scope")).toBe("erp");
  });
  it("保存当前页时其他页草稿不纳入请求", () => {
    const baseline = staffDraftFromRow(row);
    const draft = {
      ...baseline,
      adminRole: "super_admin",
      inventoryDataScope: "enterprise" as const,
    };
    expect(staffDraftForPage("admin", draft, baseline)).toEqual({
      ...baseline,
      adminRole: "super_admin",
    });
    expect(staffDraftForPage("erp", draft, baseline)).toEqual({
      ...baseline,
      inventoryDataScope: "enterprise",
    });
    expect(staffDraftForPage("official-team", draft, baseline)).toEqual(
      baseline
    );
  });
  it("业务组织严格校验企业和真实操作者，保留成员revision而非从官方组推导", () => {
    const result = readStaffBusinessOrganization(organization, context);
    expect(result.members[0]).toMatchObject({
      userId: 88,
      teamId: 11,
      revision: 6,
    });
    expect(() =>
      readStaffBusinessOrganization(
        { ...organization, actorUserId: 88 },
        context
      )
    ).toThrow();
    expect(() =>
      readStaffBusinessOrganization(organization, {
        ...context,
        enterpriseId: 99,
      })
    ).toThrow();
    expect(() =>
      readStaffBusinessOrganization(
        {
          ...organization,
          members: [{ ...organization.members[0], revision: undefined }],
        },
        context
      )
    ).toThrow();
    expect(() => readStaffBusinessOrganization(organization, null)).toThrow();
  });
  it("业务团队保存同时要求真实admin↔front绑定、原canManage与BFF前置核验", () => {
    expect(staffBusinessTeamGuard(row, access, organization).allowed).toBe(
      true
    );
    for (const unsafe of [
      { ...row, binding: null },
      { ...row, bindingState: "unbound" as const },
      {
        ...row,
        binding: { adminUserId: 7, frontUserId: 99, bindingVersion: 1 },
      },
      {
        ...row,
        bff: {
          state: "scope-incomplete" as const,
          missingPermissions: [],
          detail: "missing",
        },
      },
      { ...row, scopeState: "error" as const },
    ])
      expect(staffBusinessTeamGuard(unsafe, access, organization).allowed).toBe(
        false
      );
    expect(
      staffBusinessTeamGuard(row, access, { ...organization, canManage: false })
        .allowed
    ).toBe(false);
    expect(
      staffBusinessTeamGuard(
        row,
        { ...access, currentUserId: 99 },
        organization
      ).allowed
    ).toBe(false);
    expect(
      staffBusinessTeamGuard(row, access, { ...organization, members: [] })
        .allowed
    ).toBe(false);
  });
});
