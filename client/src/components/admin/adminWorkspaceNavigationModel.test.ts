import { describe, expect, it } from "vitest";
import { ADMIN_WORKBENCH_NAVIGATION_GROUPS } from "./adminWorkbenchNavigationModel";
import {
  ADMIN_WORKSPACE_DEFINITIONS,
  hasAdminChannelInventoryRead,
  getAdminWorkspaceForLocation,
  getAdminWorkspaceNavigationRoute,
  getAdminWorkspaceNavigationState,
  getAdminWorkspaceNavigationTarget,
  getAdminWorkspacePathname,
  groupAdminBusinessNavigationItems,
  groupAdminOperationsNavigationItems,
  groupAdminWorkspaceNavigationItems,
} from "./adminWorkspaceNavigationModel";

const officialPaths = ADMIN_WORKBENCH_NAVIGATION_GROUPS.flatMap(
  group => group.paths
);
const items = [...officialPaths, "/profile"].map(path => ({
  path,
  label: `label:${path}`,
  permission: `permission:${path}`,
  chunk: ["/teams", "/role-templates", "/permission-audit"].includes(path)
    ? "organization"
    : `chunk:${path}`,
}));
const visible = (...paths: string[]) =>
  items.filter(item => paths.includes(item.path));

describe("业务下拉展示分组（独立客户和库存不重复，不更改canonical和历史目标）", () => {
  it("三组仅保留销售管理、出入库和采购，询价独立，子项只出现一次", () => {
    const entries = groupAdminBusinessNavigationItems([...items].reverse());
    expect(
      entries.map(entry =>
        entry.kind === "direct" ? entry.item.path : entry.label
      )
    ).toEqual([
      "销售管理",
      "库存管理",
      "采购管理",
    ]);
    const groupedPaths = entries.flatMap(entry =>
      entry.kind === "direct"
        ? [entry.item.path]
        : entry.items.map(item => item.path)
    );
    expect(groupedPaths).toEqual([
      "/workbench/orders",
      "/workbench/inbound",
      "/workbench/outbound",
      "/workbench/procurement-demands",
      "/workbench/procurement-orders",
    ]);
    expect([...groupedPaths].sort()).toEqual(
      [...ADMIN_WORKSPACE_DEFINITIONS[0].paths].filter(path => !["/workbench/customers", "/workbench/channel-inventory", "/workbench/inquiries"].includes(path)).sort()
    );
    expect(new Set(groupedPaths).size).toBe(groupedPaths.length);
    for (const entry of entries) {
      for (const item of entry.kind === "direct" ? [entry.item] : entry.items) {
        expect(item).toBe(items.find(original => original.path === item.path));
      }
    }
  });

  it("仅显示父授权原条目，空组及未知路径隐藏，不创建别名或运营菜单", () => {
    const authorized = Object.freeze(
      visible("/workbench/inquiries", "/workbench/outbound", "/analytics")
    );
    const entries = groupAdminBusinessNavigationItems(authorized);
    expect(
      entries.map(entry =>
        entry.kind === "group" ? entry.id : entry.item.path
      )
    ).toEqual(["inventory"]);
    expect(
      entries.flatMap(entry =>
        entry.kind === "group" ? entry.items : [entry.item]
      )
    ).toEqual([
      authorized.find(item => item.path === "/workbench/outbound"),
    ]);
    expect(groupAdminBusinessNavigationItems([])).toEqual([]);
    expect(
      groupAdminBusinessNavigationItems([
        { path: "/workbench/chat", label: "别名不是可授权菜单" },
        { path: "/not-registered", label: "未知" },
      ])
    ).toEqual([]);
  });
});

describe("客户需求旧链接兼容，不产生独立菜单", () => {
  it("keeps the old route context but never synthesizes a demand item", () => {
    const authorized = [...items, { path: "/workbench/customer-demands", label: "客户需求", permission: "customers.manage", chunk: "legacy" }];
    expect(groupAdminWorkspaceNavigationItems(authorized).flatMap(workspace => workspace.items.map(item => item.path))).not.toContain("/workbench/customer-demands");
    expect(groupAdminBusinessNavigationItems(authorized).flatMap(entry => entry.kind === "direct" ? [entry.item.path] : entry.items.map(item => item.path))).not.toContain("/workbench/customer-demands");
    expect(getAdminWorkspaceNavigationState(authorized, "/workbench/customer-demands?merchantId=31")).toMatchObject({ route: { pathname: "/workbench/customer-demands", canonicalPath: "/workbench/customers", label: "客户需求", isAlias: true, workspaceId: "business" }, activeItem: { path: "/workbench/customers" } });
    expect(groupAdminWorkspaceNavigationItems(authorized.filter(item => item.path === "/workbench/customer-demands"))).toEqual([]);
  });
});

describe("平台运营三级展示分组", () => {
  it("三组覆盖八个真实叶子且保留原对象，不混入销售订单或重复条目", () => {
    const entries = groupAdminOperationsNavigationItems([...items, ...items].reverse());
    expect(entries.map(entry => entry.kind === "group" ? [entry.id, entry.label, entry.items.map(item => item.path)] : []))
      .toEqual([
        ["basic-data", "基础资料", ["/merchants", "/materials", "/portal-users"]],
        ["transactions-services", "交易与服务", ["/orders", "/messages", "/reviews"]],
        ["data-monitoring", "数据与监控", ["/analytics", "/exception-logs"]],
      ]);
    const leaves = entries.flatMap(entry => entry.kind === "group" ? entry.items : [entry.item]);
    expect(new Set(leaves.map(item => item.path)).size).toBe(8);
    for (const item of leaves) expect(item).toBe(items.find(original => original.path === item.path));
    expect(leaves.map(item => item.path)).not.toContain("/workbench/orders");
  });

  it("先消费原角色可见叶再分组，空组隐藏且不补入同组无权叶", () => {
    const authorized = Object.freeze(visible("/portal-users", "/orders", "/workbench/orders"));
    const entries = groupAdminOperationsNavigationItems(authorized);
    expect(entries.map(entry => entry.kind === "group" ? [entry.id, entry.items.map(item => item.path)] : []))
      .toEqual([["basic-data", ["/portal-users"]], ["transactions-services", ["/orders"]]]);
    expect(groupAdminOperationsNavigationItems([])).toEqual([]);
    expect(groupAdminOperationsNavigationItems([{ path: "/orders-extra", label: "未知" }])).toEqual([]);
  });

  it("company-info及旧别名保留路由上下文，但不合成菜单、叶子或跳转目标", () => {
    const company = visible("/workbench/company-info");
    expect(groupAdminBusinessNavigationItems(company)).toEqual([]);
    expect(groupAdminWorkspaceNavigationItems(company)).toEqual([]);
    expect(getAdminWorkspaceNavigationTarget(company, "business")).toBeNull();
    for (const location of ["/workbench/company-info", "/workbench/company?merchantId=31"]) {
      const state = getAdminWorkspaceNavigationState(items, location);
      expect(state.route).toMatchObject({ workspaceId: "business", canonicalPath: "/workbench/company-info" });
      expect(state.activeItem).toBeNull();
      expect(state.workspaces.flatMap(workspace => workspace.items.map(item => item.path))).not.toContain("/workbench/company-info");
    }
  });
});

describe("正式后台顶部工作区菜单", () => {
  it("除公司信息外完整保留正式菜单且每条恰好出现一次，没有别名假入口", () => {
    const paths = ADMIN_WORKSPACE_DEFINITIONS.flatMap(
      workspace => workspace.paths
    );
    const expectedPaths = [...officialPaths.filter(path => !["/workbench/company-info", "/workbench/inventory", "/workbench/publish", "/role-templates", "/permission-audit"].includes(path)), "/profile"];
    expect([...paths].sort()).toEqual([...expectedPaths].sort());
    expect(new Set(paths).size).toBe(expectedPaths.length);
    expect(
      groupAdminWorkspaceNavigationItems([...items].reverse()).flatMap(
        workspace => workspace.items
      )
    ).toHaveLength(expectedPaths.length);
    expect(paths).toContain("/profile");
    expect(paths).not.toContain("/admins");
    expect(paths).not.toContain("/workbench/add-user");
    expect(paths).not.toContain("/unregistered-team-demo");
    expect(paths).not.toContain("/templates");
    expect(paths).toEqual(
      expect.arrayContaining(["/teams", "/staff"])
    );
  });

  it("业务将库存三项移到销售订单后，渠道库存优先且其余项相对顺序不变", () => {
    const workspace = groupAdminWorkspaceNavigationItems(
      [...items].reverse()
    )[0];
    expect(workspace.id).toBe("business");
    expect(workspace.items.map(item => item.path)).toEqual([
      "/workbench/channel-inventory",
      "/workbench/customers",
      "/workbench/orders",
      "/workbench/inbound",
      "/workbench/outbound",
      "/workbench/inquiries",
      "/workbench/procurement-demands",
      "/workbench/procurement-orders",
    ]);
  });

  it("运营保留原七项并追加异常日志，组织包含五个真实菜单", () => {
    const groups = groupAdminWorkspaceNavigationItems(items);
    expect(groups.map(group => [group.id, group.label])).toEqual([
      ["business", "业务工作台"],
      ["operations", "平台运营"],
      ["personal", "个人中心"],
      ["organization", "组织与权限"],
    ]);
    expect(groups[1].items.map(item => item.path)).toEqual([
      "/merchants",
      "/materials",
      "/orders",
      "/messages",
      "/reviews",
      "/portal-users",
      "/analytics",
      "/exception-logs",
    ]);
    expect(groups[2].items.map(item => item.path)).toEqual(["/profile"]);
    expect(groups[3].items.map(item => item.path)).toEqual([
      "/staff",
      "/teams",
      "/workbench/user-records",
    ]);
  });

  it("严格消费已过滤菜单并保留对象及标签、权限、chunk 等原始属性", () => {
    const authorized = Object.freeze(
      visible("/analytics", "/workbench/outbound")
    );
    const groups = groupAdminWorkspaceNavigationItems(authorized);
    expect(groups.map(group => group.id)).toEqual(["business", "operations"]);
    expect(groups[0].items[0]).toBe(
      authorized.find(item => item.path === "/workbench/outbound")
    );
    expect(groups[1].items[0]).toBe(
      authorized.find(item => item.path === "/analytics")
    );
    for (const path of ["/teams"]) {
      const original = Object.freeze(items.find(item => item.path === path)!);
      const [workspace] = groupAdminWorkspaceNavigationItems(
        Object.freeze([original])
      );
      expect(workspace.id).toBe("organization");
      expect(workspace.items).toHaveLength(1);
      expect(workspace.items[0]).toBe(original);
      expect(workspace.items[0]).toEqual({
        path,
        label: `label:${path}`,
        permission: `permission:${path}`,
        chunk: "organization",
      });
      expect(
        getAdminWorkspaceNavigationState(visible("/staff"), path).activeItem
      ).toBeNull();
      expect(
        getAdminWorkspaceNavigationState(visible("/analytics"), path)
          .activeWorkspace
      ).toBeNull();
    }
    expect(groupAdminWorkspaceNavigationItems([])).toEqual([]);
    expect(
      groupAdminWorkspaceNavigationItems([
        { path: "/unregistered-team-demo", label: "不可伪造" },
      ])
    ).toEqual([]);
  });

  it("每个工作区切换目标为首个可见真实菜单，无许可则没有跳转目标", () => {
    const subset = visible(
      "/workbench/company-info",
      "/workbench/orders",
      "/analytics",
      "/workbench/user-records"
    );
    expect(getAdminWorkspaceNavigationTarget(subset, "business")).toBe(
      subset.find(item => item.path === "/workbench/orders")
    );
    expect(getAdminWorkspaceNavigationTarget(subset, "operations")?.path).toBe(
      "/analytics"
    );
    expect(
      getAdminWorkspaceNavigationTarget(subset, "organization")?.path
    ).toBe("/workbench/user-records");
    expect(
      getAdminWorkspaceNavigationTarget(visible("/staff"), "business")
    ).toBeNull();
    expect(getAdminWorkspaceNavigationTarget([], "operations")).toBeNull();
  });
});

describe("实际路由驱动两级选中态", () => {
  it.each([
    ["/materials", "operations", "/materials"],
    ["/orders/42", "operations", "/orders"],
    ["/merchants/8", "operations", "/merchants"],
    ["/exception-logs/9", "operations", "/exception-logs"],
    ["/workbench/inventory", "business", "/workbench/channel-inventory"],
    ["/workbench/publish/42/edit", "business", "/workbench/channel-inventory"],
    ["/workbench/customers/new/8", "business", "/workbench/customers"],
    ["/workbench/customers/8", "business", "/workbench/customers"],
    ["/workbench/customer-demands", "business", "/workbench/customers"],
    ["/workbench/orders/8", "business", "/workbench/orders"],
    [
      "/workbench/procurement-orders/quote",
      "business",
      "/workbench/procurement-orders",
    ],
    [
      "/workbench/procurement-orders/accepted",
      "business",
      "/workbench/procurement-orders",
    ],
    [
      "/workbench/procurement-orders/create",
      "business",
      "/workbench/procurement-orders",
    ],
    ["/staff/7", "organization", "/staff"],
    ["/teams", "organization", "/teams"],
    ["/role-templates", "organization", "/staff"],
    ["/permission-audit", "organization", "/staff"],
    ["/workbench/user-records", "organization", "/workbench/user-records"],
    ["/admins/7", "organization", "/staff"],
    ["/workbench/add-user", "organization", "/staff"],
    ["/workbench/chat", "business", "/workbench/inquiries"],
    ["/workbench/sales-orders", "business", "/workbench/orders"],
    [
      "/workbench/procurement/demands",
      "business",
      "/workbench/procurement-demands",
    ],
    [
      "/workbench/procurement/orders",
      "business",
      "/workbench/procurement-orders",
    ],
    ["/workbench/demand-quotes", "business", "/workbench/procurement-demands"],
    ["/workbench", "business", "/workbench/customers"],
  ])("%s 归属 %s 并选中 %s", (location, workspaceId, canonicalPath) => {
    const state = getAdminWorkspaceNavigationState(items, location);
    expect(state.route).toMatchObject({ workspaceId, canonicalPath });
    expect(state.activeWorkspace?.id).toBe(workspaceId);
    expect(state.activeItem?.path).toBe(canonicalPath);
    expect(getAdminWorkspaceForLocation(location)?.id).toBe(workspaceId);
  });

  it("个人中心独立归属并选中本人入口，不错误选中员工页", () => {
    const state = getAdminWorkspaceNavigationState(
      items,
      "/profile?tab=security"
    );
    expect(state.route).toMatchObject({
      workspaceId: "personal",
      canonicalPath: "/profile",
    });
    expect(state.activeWorkspace?.id).toBe("personal");
    expect(state.activeItem).toBe(items.find(item => item.path === "/profile"));
    expect(state.activeWorkspace?.items.map(item => item.path)).toEqual(["/profile"]);
  });

  it.each([
    "/",
    "/?merchantId=8",
    "/not-a-menu",
    "/unregistered-team-demo",
    "/orders-extra",
    "/workbench/customers-extra",
    "/workbenchx",
    "https://example.com/staff",
  ])("未知路径 %s 不误命中根路径或任意入口", location => {
    expect(getAdminWorkspaceNavigationRoute(location)).toBeNull();
    expect(
      getAdminWorkspaceNavigationState(items, location).activeWorkspace
    ).toBeNull();
    expect(
      getAdminWorkspaceNavigationState(items, location).activeItem
    ).toBeNull();
  });

  it("查询、hash、末尾斜杠不影响上下文，不修改回调目标的任何 query", () => {
    expect(getAdminWorkspacePathname("/")).toBe("/");
    expect(getAdminWorkspacePathname("/?merchantId=8#content")).toBe("/");
    expect(
      getAdminWorkspacePathname(
        "/workbench/publish/42/edit/?merchantId=8#content"
      )
    ).toBe("/workbench/publish/42/edit");
    const state = getAdminWorkspaceNavigationState(
      items,
      "/workbench/publish/42/edit?merchantId=8&returnTo=%2Fstaff#content"
    );
    expect(state.activeItem?.path).toBe("/workbench/channel-inventory");
    expect(
      getAdminWorkspaceNavigationState(items, "/materials?merchantId=8")
        .activeItem?.path
    ).toBe("/materials");
    const target = getAdminWorkspaceNavigationTarget(items, "business");
    expect(target).toBe(
      items.find(item => item.path === "/workbench/channel-inventory")
    );
    expect(target?.path).toBe("/workbench/channel-inventory");
  });

  it("隐藏模块及别名不会因路由命中而获得入口或被错误选中", () => {
    const state = getAdminWorkspaceNavigationState(
      visible("/workbench/company-info", "/analytics"),
      "/workbench/orders"
    );
    expect(state.activeWorkspace).toBeNull();
    expect(state.activeItem).toBeNull();
    const denied = getAdminWorkspaceNavigationState(
      visible("/analytics"),
      "/admins/7"
    );
    expect(denied.route?.workspaceId).toBe("organization");
    expect(denied.activeWorkspace).toBeNull();
    expect(denied.activeItem).toBeNull();
    expect(getAdminWorkspaceNavigationState([], "/profile").workspaces).toEqual(
      []
    );
  });

  it("重新计算时跟随路由及权限变化，不依赖缓存的本地选择状态", () => {
    expect(
      getAdminWorkspaceNavigationState(items, "/staff").activeWorkspace?.id
    ).toBe("organization");
    expect(
      getAdminWorkspaceNavigationState(items, "/workbench/orders")
        .activeWorkspace?.id
    ).toBe("business");
    expect(
      getAdminWorkspaceNavigationState(visible("/analytics"), "/staff")
        .activeWorkspace
    ).toBeNull();
  });
});


describe("渠道库存真实 native read 准入", () => {
  it("普通 native 员工必须有精确 officialInventory.read，ERP能力和其他native动作不能替代", () => {
    const account = { hasNativeAdminAccount: true, adminRole: "merchant_mgr" };
    for (const permissions of [[], ["business.inventory.read"], ["inventory.manage"], ["officialInventory.write"], ["officialInventory.note"]]) {
      expect(hasAdminChannelInventoryRead({ ...account, permissions })).toBe(false);
    }
    expect(hasAdminChannelInventoryRead({ ...account, permissions: ["officialInventory.read"] })).toBe(true);
  });
  it("真实超级管理员按角色解析全部权限，但OAuth兼容super_admin不能伪装native账号", () => {
    expect(hasAdminChannelInventoryRead({ hasNativeAdminAccount: true, adminRole: "super_admin", permissions: [] })).toBe(true);
    expect(hasAdminChannelInventoryRead({ hasNativeAdminAccount: false, adminRole: "super_admin", permissions: ["officialInventory.read"] })).toBe(false);
    expect(hasAdminChannelInventoryRead({ adminRole: "super_admin" })).toBe(false);
    expect(hasAdminChannelInventoryRead(null)).toBe(false);
  });
  it("撤回read后不会被菜单原有排序/路由选中状态重新授予", () => {
    const account = { hasNativeAdminAccount: true, adminRole: "merchant_mgr", permissions: ["officialInventory.read"] };
    const channel = visible("/workbench/channel-inventory");
    expect(getAdminWorkspaceNavigationState(hasAdminChannelInventoryRead(account) ? channel : [], "/workbench/channel-inventory").activeItem?.path).toBe("/workbench/channel-inventory");
    account.permissions = [];
    expect(getAdminWorkspaceNavigationState(hasAdminChannelInventoryRead(account) ? channel : [], "/workbench/channel-inventory").activeItem).toBeNull();
  });
});
