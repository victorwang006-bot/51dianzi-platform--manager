import { describe, expect, it } from "vitest";
import {
  ADMIN_BUSINESS_WORKBENCH_PATHS,
  ADMIN_WORKBENCH_NAVIGATION_GROUPS,
  ADMIN_WORKBENCH_NAVIGATION_ROUTE_ALIASES,
  autoOpenAdminWorkbenchNavigationGroup,
  createDefaultAdminWorkbenchNavigationExpandedGroups,
  findAdminWorkbenchNavigationGroupId,
  getAdminWorkbenchNavigationRoute,
  getAdminWorkbenchNavigationStorageKey,
  getLegacyAdminWorkbenchNavigationStorageKey,
  groupAdminWorkbenchNavigationItems,
  isAdminBusinessWorkbenchPath,
  readAdminWorkbenchNavigationExpandedGroups,
  writeAdminWorkbenchNavigationExpandedGroups,
  type StorageLike,
} from "./adminWorkbenchNavigationModel";

type TestItem = {
  path: string;
  label: string;
  permission: string;
};

function createStorage(): StorageLike & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

const navigationItems: TestItem[] = [
  { path: "/analytics", label: "运营数据", permission: "analytics.read" },
  {
    path: "/workbench/procurement-orders",
    label: "采购订单",
    permission: "business.procurement.read",
  },
  { path: "/merchants", label: "商户管理", permission: "merchants.read" },
  {
    path: "/workbench/inventory",
    label: "我的库存",
    permission: "business.inventory.read",
  },
  {
    path: "/workbench/customer-demands",
    label: "客户需求",
    permission: "business.customers.read",
  },
  { path: "/materials", label: "物料数据库", permission: "materials.read" },
  { path: "/staff", label: "员工与权限", permission: "admins.manage" },
  {
    path: "/workbench/company-info",
    label: "公司信息",
    permission: "business.users.read",
  },
  {
    path: "/workbench/publish",
    label: "发布库存",
    permission: "business.inventory.read",
  },
  {
    path: "/workbench/customers",
    label: "客户列表",
    permission: "business.customers.read",
  },
  {
    path: "/workbench/procurement-demands",
    label: "采购需求",
    permission: "business.procurement.read",
  },
  { path: "/orders", label: "平台订单", permission: "orders.read" },
  { path: "/messages", label: "消息中心", permission: "messages.read" },
  { path: "/reviews", label: "评价管理", permission: "logs.read" },
  { path: "/portal-users", label: "平台用户", permission: "portalUsers.read" },
  {
    path: "/workbench/inbound",
    label: "入库管理",
    permission: "business.inventory.read",
  },
  {
    path: "/workbench/channel-inventory",
    label: "渠道库存",
    permission: "business.inventory.read",
  },
  {
    path: "/workbench/orders",
    label: "销售订单",
    permission: "business.orders.read",
  },
  {
    path: "/workbench/outbound",
    label: "出库管理",
    permission: "business.orders.read",
  },
  {
    path: "/workbench/inquiries",
    label: "询价接待",
    permission: "business.customers.read",
  },
  {
    path: "/workbench/user-records",
    label: "员工操作记录",
    permission: "business.users.read",
  },
  { path: "/exception-logs", label: "异常日志", permission: "logs.read" },
  { path: "/not-a-menu", label: "不应出现", permission: "none" },
];

function item(path: string): TestItem {
  const result = navigationItems.find(candidate => candidate.path === path);
  if (!result) throw new Error(`missing test item: ${path}`);
  return result;
}

describe("后台工作台导航分组", () => {
  it("严格按库存、客户、采购、运营、系统设置五组和固定路径顺序分组", () => {
    const groups = groupAdminWorkbenchNavigationItems(navigationItems);

    expect(ADMIN_WORKBENCH_NAVIGATION_GROUPS.map(group => group.id)).toEqual([
      "inventory",
      "customers",
      "procurement",
      "operations",
      "system",
    ]);
    expect(groups).toEqual([
      {
        id: "inventory",
        label: "库存管理",
        items: [
          item("/workbench/inventory"),
          item("/workbench/publish"),
          item("/workbench/inbound"),
          item("/workbench/channel-inventory"),
        ],
      },
      {
        id: "customers",
        label: "客户管理",
        items: [
          item("/workbench/customers"),
          item("/workbench/orders"),
          item("/workbench/outbound"),
          item("/workbench/inquiries"),
        ],
      },
      {
        id: "procurement",
        label: "采购管理",
        items: [
          item("/workbench/procurement-demands"),
          item("/workbench/procurement-orders"),
        ],
      },
      {
        id: "operations",
        label: "运营管理",
        items: [
          item("/merchants"),
          item("/materials"),
          item("/orders"),
          item("/messages"),
          item("/reviews"),
          item("/portal-users"),
          item("/analytics"),
        ],
      },
      {
        id: "system",
        label: "系统设置",
        items: [
          item("/staff"),
          item("/workbench/company-info"),
          item("/workbench/user-records"),
          item("/exception-logs"),
        ],
      },
    ]);
  });

  it("仅接收过滤后的项目，完全无权限时不输出空分组", () => {
    expect(groupAdminWorkbenchNavigationItems([])).toEqual([]);
    expect(
      groupAdminWorkbenchNavigationItems([
        {
          path: "/workbench/orders",
          label: "销售订单",
          permission: "business.orders.read",
        },
      ])
    ).toEqual([
      {
        id: "customers",
        label: "客户管理",
        items: [
          {
            path: "/workbench/orders",
            label: "销售订单",
            permission: "business.orders.read",
          },
        ],
      },
    ]);
  });

  it("详情、编辑和创建路径打开所属组，根路径不吞掉其他路由", () => {
    expect(findAdminWorkbenchNavigationGroupId("/")).toBeNull();
    expect(getAdminWorkbenchNavigationRoute("/")).toBeNull();
    expect(findAdminWorkbenchNavigationGroupId("/materials")).toBe("operations");
    expect(getAdminWorkbenchNavigationRoute("/materials")).toMatchObject({
      canonicalPath: "/materials",
      label: "物料数据库",
      isAlias: false,
    });
    expect(findAdminWorkbenchNavigationGroupId("/merchants/merchant-240")).toBe(
      "operations"
    );
    expect(
      findAdminWorkbenchNavigationGroupId("/workbench/publish/42/edit")
    ).toBe("inventory");
    expect(findAdminWorkbenchNavigationGroupId("/workbench/customers/88")).toBe(
      "customers"
    );
    expect(
      findAdminWorkbenchNavigationGroupId("/workbench/procurement-orders/quote")
    ).toBe("procurement");
    expect(
      findAdminWorkbenchNavigationGroupId(
        "/workbench/procurement-orders/accepted"
      )
    ).toBe("procurement");
    expect(
      findAdminWorkbenchNavigationGroupId(
        "/workbench/procurement-orders/create"
      )
    ).toBe("procurement");
    expect(findAdminWorkbenchNavigationGroupId("/staff/7")).toBe("system");
    expect(findAdminWorkbenchNavigationGroupId("/unrelated")).toBeNull();

    const allCollapsed = createDefaultAdminWorkbenchNavigationExpandedGroups();
    expect(
      autoOpenAdminWorkbenchNavigationGroup(
        allCollapsed,
        "/workbench/orders/1001"
      )
    ).toEqual({
      ...allCollapsed,
      customers: true,
    });
    expect(
      autoOpenAdminWorkbenchNavigationGroup(allCollapsed, "/staff/7")
    ).toEqual({
      ...allCollapsed,
      system: true,
    });
  });

  it("旧人员和个人资料路由是显式别名，只将员工与权限作为侧栏入口", () => {
    expect(ADMIN_WORKBENCH_NAVIGATION_ROUTE_ALIASES).toEqual([
      {
        path: "/admins",
        canonicalPath: "/staff",
        groupId: "system",
        label: "员工与权限",
      },
      {
        path: "/workbench/add-user",
        canonicalPath: "/staff",
        groupId: "system",
        label: "员工与权限",
      },
      {
        path: "/workbench/chat",
        canonicalPath: "/workbench/inquiries",
        groupId: "customers",
        label: "询价接待",
      },
      {
        path: "/workbench/customer-demands",
        canonicalPath: "/workbench/customers",
        groupId: "customers",
        label: "客户需求",
      },
      {
        path: "/profile",
        canonicalPath: "/profile",
        groupId: "system",
        label: "个人信息",
      },
    ]);
    expect(findAdminWorkbenchNavigationGroupId("/admins/7")).toBe("system");
    expect(findAdminWorkbenchNavigationGroupId("/workbench/add-user")).toBe(
      "system"
    );
    expect(findAdminWorkbenchNavigationGroupId("/workbench/chat")).toBe(
      "customers"
    );
    expect(findAdminWorkbenchNavigationGroupId("/profile")).toBe("system");
    expect(getAdminWorkbenchNavigationRoute("/admins/7")).toMatchObject({
      canonicalPath: "/staff",
      label: "员工与权限",
      isAlias: true,
    });
    expect(getAdminWorkbenchNavigationRoute("/profile")).toMatchObject({
      canonicalPath: "/profile",
      label: "个人信息",
      isAlias: true,
    });
    expect(getAdminWorkbenchNavigationRoute("/workbench/chat")).toMatchObject({
      canonicalPath: "/workbench/inquiries",
      label: "询价接待",
      isAlias: true,
    });
    expect(getAdminWorkbenchNavigationRoute("/workbench/customer-demands")).toMatchObject({ canonicalPath: "/workbench/customers", label: "客户需求", groupId: "customers", isAlias: true });
    expect(groupAdminWorkbenchNavigationItems(navigationItems).flatMap(group => group.items.map(item => item.path))).not.toContain("/workbench/customer-demands");
    expect(isAdminBusinessWorkbenchPath("/workbench/customer-demands")).toBe(true);
    expect(
      ADMIN_WORKBENCH_NAVIGATION_GROUPS.flatMap(group => group.paths)
    ).toContain("/staff");
    expect(
      ADMIN_WORKBENCH_NAVIGATION_GROUPS.flatMap(group => group.paths)
    ).not.toContain("/admins");
    expect(
      ADMIN_WORKBENCH_NAVIGATION_GROUPS.flatMap(group => group.paths)
    ).not.toContain("/workbench/add-user");
    expect(
      ADMIN_WORKBENCH_NAVIGATION_GROUPS.flatMap(group => group.paths)
    ).not.toContain("/workbench/chat");
    expect(
      ADMIN_WORKBENCH_NAVIGATION_GROUPS.flatMap(group => group.paths)
    ).not.toContain("/profile");
  });

  it("登记全部商户业务工作台路径，包括隐藏的 add-user 别名", () => {
    expect(ADMIN_BUSINESS_WORKBENCH_PATHS).toEqual([
      "/workbench/inventory",
      "/workbench/publish",
      "/workbench/inbound",
      "/workbench/customers",
      "/workbench/customer-demands",
      "/workbench/orders",
      "/workbench/outbound",
      "/workbench/inquiries",
      "/workbench/chat",
      "/workbench/procurement-demands",
      "/workbench/procurement-orders",
      "/workbench/add-user",
      "/workbench/user-records",
      "/workbench/company-info",
    ]);
    expect(isAdminBusinessWorkbenchPath("/workbench/publish/42/edit")).toBe(
      true
    );
    expect(
      isAdminBusinessWorkbenchPath("/workbench/procurement-orders/create")
    ).toBe(true);
    expect(isAdminBusinessWorkbenchPath("/workbench/add-user")).toBe(true);
    expect(isAdminBusinessWorkbenchPath("/workbench/channel-inventory")).toBe(
      false
    );
    expect(isAdminBusinessWorkbenchPath("/profile")).toBe(false);
  });
});

describe("后台工作台导航展开状态存储", () => {
  it("未保存时五组均收起，当前路由再自动打开所属组", () => {
    const defaults = createDefaultAdminWorkbenchNavigationExpandedGroups();
    expect(defaults).toEqual({
      inventory: false,
      customers: false,
      procurement: false,
      operations: false,
      system: false,
    });
    expect(
      autoOpenAdminWorkbenchNavigationGroup(defaults, "/workbench/inquiries")
    ).toEqual({
      ...defaults,
      customers: true,
    });
    expect(
      autoOpenAdminWorkbenchNavigationGroup(defaults, "/workbench/chat")
    ).toEqual({
      ...defaults,
      customers: true,
    });
  });

  it("按账号使用独立 v2 存储键，保留各自的主动展开设置", () => {
    const storage = createStorage();
    const firstAccount = {
      ...createDefaultAdminWorkbenchNavigationExpandedGroups(),
      inventory: true,
      system: true,
    };

    writeAdminWorkbenchNavigationExpandedGroups(
      "admin-1",
      firstAccount,
      storage
    );

    expect(
      readAdminWorkbenchNavigationExpandedGroups("admin-1", storage)
    ).toEqual(firstAccount);
    expect(
      readAdminWorkbenchNavigationExpandedGroups("admin-2", storage)
    ).toEqual(createDefaultAdminWorkbenchNavigationExpandedGroups());
    expect(getAdminWorkbenchNavigationStorageKey("admin-1")).toContain(":v2:");
    expect(getAdminWorkbenchNavigationStorageKey("admin-1")).not.toBe(
      getAdminWorkbenchNavigationStorageKey("admin-2")
    );
  });

  it("迁移 v1 时只带入 false 组并立即写入 v2，避免继承旧版全展开默认值", () => {
    const storage = createStorage();
    storage.values.set(
      getLegacyAdminWorkbenchNavigationStorageKey("admin-legacy"),
      JSON.stringify({
        inventory: true,
        customers: true,
        procurement: true,
        operations: true,
        system: false,
        "user-center": false,
      })
    );

    const migrated = readAdminWorkbenchNavigationExpandedGroups(
      "admin-legacy",
      storage
    );
    expect(migrated).toEqual(
      createDefaultAdminWorkbenchNavigationExpandedGroups()
    );
    expect(
      storage.values.get(getAdminWorkbenchNavigationStorageKey("admin-legacy"))
    ).toBe(
      JSON.stringify(createDefaultAdminWorkbenchNavigationExpandedGroups())
    );
  });

  it("存储损坏、不可读取或不可写入时回退默认状态而不抛错", () => {
    const storage = createStorage();
    storage.values.set(getAdminWorkbenchNavigationStorageKey(7), "not-json");

    expect(readAdminWorkbenchNavigationExpandedGroups(7, storage)).toEqual(
      createDefaultAdminWorkbenchNavigationExpandedGroups()
    );

    const unavailableStorage: StorageLike = {
      getItem() {
        throw new Error("storage disabled");
      },
      setItem() {
        throw new Error("storage disabled");
      },
    };

    expect(() =>
      writeAdminWorkbenchNavigationExpandedGroups(
        7,
        createDefaultAdminWorkbenchNavigationExpandedGroups(),
        unavailableStorage
      )
    ).not.toThrow();
    expect(
      readAdminWorkbenchNavigationExpandedGroups(7, unavailableStorage)
    ).toEqual(createDefaultAdminWorkbenchNavigationExpandedGroups());
  });

  it("保存时只持久化当前五组状态到 v2", () => {
    const storage = createStorage();
    const expandedGroups = {
      inventory: false,
      customers: true,
      procurement: false,
      operations: true,
      system: false,
    };

    writeAdminWorkbenchNavigationExpandedGroups(
      "admin-five-groups",
      expandedGroups,
      storage
    );

    expect(
      storage.values.get(
        getAdminWorkbenchNavigationStorageKey("admin-five-groups")
      )
    ).toBe(JSON.stringify(expandedGroups));
    expect(
      readAdminWorkbenchNavigationExpandedGroups("admin-five-groups", storage)
    ).toEqual(expandedGroups);
  });
});
