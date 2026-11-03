import { describe, expect, it } from "vitest";
import { ADMIN_WORKBENCH_NAVIGATION_GROUPS } from "./adminWorkbenchNavigationModel";
import {
  ADMIN_WORKSPACE_DEFINITIONS,
  getAdminWorkspaceForLocation,
  getAdminWorkspaceNavigationRoute,
  getAdminWorkspaceNavigationState,
  getAdminWorkspaceNavigationTarget,
  getAdminWorkspacePathname,
  groupAdminBusinessNavigationItems,
  groupAdminWorkspaceNavigationItems,
} from "./adminWorkspaceNavigationModel";

const officialPaths = ADMIN_WORKBENCH_NAVIGATION_GROUPS.flatMap(
  group => group.paths
);
const items = officialPaths.map(path => ({
  path,
  label: `label:${path}`,
  permission: `permission:${path}`,
  chunk: ["/teams", "/role-templates", "/permission-audit"].includes(path)
    ? "organization"
    : `chunk:${path}`,
}));
const visible = (...paths: string[]) =>
  items.filter(item => paths.includes(item.path));

describe("业务第二行展示分组（不更改canonical和工作区首个目标）", () => {
  it("五入口完整覆盖现有业务菜单且子项只出现一次", () => {
    const entries = groupAdminBusinessNavigationItems([...items].reverse());
    expect(
      entries.map(entry =>
        entry.kind === "direct" ? entry.item.path : entry.label
      )
    ).toEqual([
      "/workbench/channel-inventory",
      "客户与销售",
      "库存管理",
      "采购管理",
      "/workbench/company-info",
    ]);
    const groupedPaths = entries.flatMap(entry =>
      entry.kind === "direct"
        ? [entry.item.path]
        : entry.items.map(item => item.path)
    );
    expect(groupedPaths).toEqual([
      "/workbench/channel-inventory",
      "/workbench/customers",
      "/workbench/customer-demands",
      "/workbench/inquiries",
      "/workbench/orders",
      "/workbench/inventory",
      "/workbench/publish",
      "/workbench/inbound",
      "/workbench/outbound",
      "/workbench/procurement-demands",
      "/workbench/procurement-orders",
      "/workbench/company-info",
    ]);
    expect([...groupedPaths].sort()).toEqual(
      [...ADMIN_WORKSPACE_DEFINITIONS[0].paths].sort()
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
    ).toEqual(["customers", "inventory"]);
    expect(
      entries.flatMap(entry =>
        entry.kind === "group" ? entry.items : [entry.item]
      )
    ).toEqual([
      authorized.find(item => item.path === "/workbench/inquiries"),
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

describe("正式后台顶部工作区菜单", () => {
  it("完整保留正式菜单且每条恰好出现一次，没有未注册路径或别名假入口", () => {
    const paths = ADMIN_WORKSPACE_DEFINITIONS.flatMap(
      workspace => workspace.paths
    );
    expect([...paths].sort()).toEqual([...officialPaths].sort());
    expect(new Set(paths).size).toBe(officialPaths.length);
    expect(
      groupAdminWorkspaceNavigationItems([...items].reverse()).flatMap(
        workspace => workspace.items
      )
    ).toHaveLength(items.length);
    expect(paths).not.toContain("/profile");
    expect(paths).not.toContain("/admins");
    expect(paths).not.toContain("/workbench/add-user");
    expect(paths).not.toContain("/unregistered-team-demo");
    expect(paths).not.toContain("/templates");
    expect(paths).toEqual(
      expect.arrayContaining(["/teams", "/role-templates", "/permission-audit"])
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
      "/workbench/customer-demands",
      "/workbench/orders",
      "/workbench/inventory",
      "/workbench/publish",
      "/workbench/inbound",
      "/workbench/outbound",
      "/workbench/inquiries",
      "/workbench/procurement-demands",
      "/workbench/procurement-orders",
      "/workbench/company-info",
    ]);
  });

  it("运营保留原七项并追加异常日志，组织包含五个真实菜单", () => {
    const groups = groupAdminWorkspaceNavigationItems(items);
    expect(groups.map(group => [group.id, group.label])).toEqual([
      ["business", "业务工作台"],
      ["operations", "平台运营"],
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
    expect(groups[2].items.map(item => item.path)).toEqual([
      "/staff",
      "/teams",
      "/role-templates",
      "/permission-audit",
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
    for (const path of ["/teams", "/role-templates", "/permission-audit"]) {
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
    ["/workbench/inventory", "business", "/workbench/inventory"],
    ["/workbench/publish/42/edit", "business", "/workbench/publish"],
    ["/workbench/customers/new/8", "business", "/workbench/customers"],
    ["/workbench/customers/8", "business", "/workbench/customers"],
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
    ["/workbench/company-info", "business", "/workbench/company-info"],
    ["/staff/7", "organization", "/staff"],
    ["/teams", "organization", "/teams"],
    ["/role-templates", "organization", "/role-templates"],
    ["/permission-audit", "organization", "/permission-audit"],
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
    ["/workbench/company", "business", "/workbench/company-info"],
    ["/workbench", "business", "/workbench/inventory"],
  ])("%s 归属 %s 并选中 %s", (location, workspaceId, canonicalPath) => {
    const state = getAdminWorkspaceNavigationState(items, location);
    expect(state.route).toMatchObject({ workspaceId, canonicalPath });
    expect(state.activeWorkspace?.id).toBe(workspaceId);
    expect(state.activeItem?.path).toBe(canonicalPath);
    expect(getAdminWorkspaceForLocation(location)?.id).toBe(workspaceId);
  });

  it("个人资料属于组织，但不伪造菜单、不错误选中员工页", () => {
    const state = getAdminWorkspaceNavigationState(
      items,
      "/profile?tab=security"
    );
    expect(state.route).toMatchObject({
      workspaceId: "organization",
      canonicalPath: "/profile",
    });
    expect(state.activeWorkspace?.id).toBe("organization");
    expect(state.activeItem).toBeNull();
    expect(state.activeWorkspace?.items.map(item => item.path)).toEqual([
      "/staff",
      "/teams",
      "/role-templates",
      "/permission-audit",
      "/workbench/user-records",
    ]);
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
    expect(state.activeItem?.path).toBe("/workbench/publish");
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
    expect(state.activeWorkspace?.items.map(item => item.path)).toEqual([
      "/workbench/company-info",
    ]);
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
