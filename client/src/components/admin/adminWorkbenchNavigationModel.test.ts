import { describe, expect, it } from "vitest";
import {
  ADMIN_BUSINESS_WORKBENCH_PATHS,
  ADMIN_WORKBENCH_NAVIGATION_GROUPS,
  autoOpenAdminWorkbenchNavigationGroup,
  createDefaultAdminWorkbenchNavigationExpandedGroups,
  findAdminWorkbenchNavigationGroupId,
  getAdminWorkbenchNavigationStorageKey,
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
  { path: "/workbench/procurement-orders", label: "采购订单", permission: "business.procurement.read" },
  { path: "/profile", label: "个人信息", permission: "profile.manage" },
  { path: "/merchants", label: "商户管理", permission: "merchants.read" },
  { path: "/workbench/inventory", label: "我的库存", permission: "business.inventory.read" },
  { path: "/workbench/customer-demands", label: "客户需求", permission: "business.customers.read" },
  { path: "/", label: "物料数据库", permission: "materials.read" },
  { path: "/admins", label: "后台用户管理", permission: "admins.manage" },
  { path: "/workbench/company-info", label: "公司信息", permission: "business.users.read" },
  { path: "/workbench/publish", label: "发布库存", permission: "business.inventory.read" },
  { path: "/workbench/customers", label: "客户管理", permission: "business.customers.read" },
  { path: "/workbench/procurement-demands", label: "采购需求", permission: "business.procurement.read" },
  { path: "/workbench/add-user", label: "成员管理", permission: "business.users.read" },
  { path: "/orders", label: "订单管理", permission: "orders.read" },
  { path: "/messages", label: "消息中心", permission: "messages.read" },
  { path: "/reviews", label: "评价管理", permission: "logs.read" },
  { path: "/portal-users", label: "用户管理", permission: "portalUsers.read" },
  { path: "/workbench/inbound", label: "入库管理", permission: "business.inventory.read" },
  { path: "/workbench/channel-inventory", label: "渠道库存", permission: "business.inventory.read" },
  { path: "/workbench/orders", label: "销售订单", permission: "business.orders.read" },
  { path: "/workbench/outbound", label: "出库管理", permission: "business.orders.read" },
  { path: "/workbench/chat", label: "询价聊天", permission: "business.customers.read" },
  { path: "/workbench/user-records", label: "成员记录", permission: "business.users.read" },
  { path: "/exception-logs", label: "异常日志", permission: "logs.read" },
  { path: "/not-a-menu", label: "不应出现", permission: "none" },
];

function item(path: string): TestItem {
  const result = navigationItems.find(candidate => candidate.path === path);
  if (!result) throw new Error(`missing test item: ${path}`);
  return result;
}

describe("后台工作台导航分组", () => {
  it("严格按运营、库存、客户、采购、用户中心、系统六组和固定路径顺序分组", () => {
    const groups = groupAdminWorkbenchNavigationItems(navigationItems);

    expect(ADMIN_WORKBENCH_NAVIGATION_GROUPS.map(group => group.id)).toEqual([
      "operations",
      "inventory",
      "customers",
      "procurement",
      "user-center",
      "system",
    ]);
    expect(groups).toEqual([
      {
        id: "operations",
        label: "运营管理",
        items: [
          item("/merchants"),
          item("/"),
          item("/orders"),
          item("/messages"),
          item("/reviews"),
          item("/portal-users"),
          item("/analytics"),
        ],
      },
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
          item("/workbench/customer-demands"),
          item("/workbench/orders"),
          item("/workbench/outbound"),
          item("/workbench/chat"),
        ],
      },
      {
        id: "procurement",
        label: "采购管理",
        items: [item("/workbench/procurement-demands"), item("/workbench/procurement-orders")],
      },
      {
        id: "user-center",
        label: "用户中心",
        items: [
          item("/workbench/add-user"),
          item("/workbench/user-records"),
          item("/workbench/company-info"),
          item("/profile"),
        ],
      },
      {
        id: "system",
        label: "系统管理",
        items: [item("/admins"), item("/exception-logs")],
      },
    ]);
  });

  it("先接收过滤后的项目，完全无权限时不输出空分组", () => {
    expect(groupAdminWorkbenchNavigationItems([])).toEqual([]);
    expect(
      groupAdminWorkbenchNavigationItems([
        { path: "/workbench/orders", label: "销售订单", permission: "business.orders.read" },
      ])
    ).toEqual([
      {
        id: "customers",
        label: "客户管理",
        items: [
          { path: "/workbench/orders", label: "销售订单", permission: "business.orders.read" },
        ],
      },
    ]);
  });

  it("详情、编辑、报价和创建路径打开所属组，根路径不吞掉其他路由", () => {
    expect(findAdminWorkbenchNavigationGroupId("/")).toBe("operations");
    expect(findAdminWorkbenchNavigationGroupId("/merchants/merchant-240")).toBe("operations");
    expect(findAdminWorkbenchNavigationGroupId("/workbench/publish/42/edit")).toBe("inventory");
    expect(findAdminWorkbenchNavigationGroupId("/workbench/customers/88")).toBe("customers");
    expect(findAdminWorkbenchNavigationGroupId("/workbench/procurement-orders/quote")).toBe("procurement");
    expect(findAdminWorkbenchNavigationGroupId("/workbench/procurement-orders/accepted")).toBe("procurement");
    expect(findAdminWorkbenchNavigationGroupId("/workbench/procurement-orders/create")).toBe("procurement");
    expect(findAdminWorkbenchNavigationGroupId("/profile")).toBe("user-center");
    expect(findAdminWorkbenchNavigationGroupId("/admins/7")).toBe("system");
    expect(findAdminWorkbenchNavigationGroupId("/unrelated")).toBeNull();

    const allCollapsed = Object.fromEntries(
      ADMIN_WORKBENCH_NAVIGATION_GROUPS.map(group => [group.id, false])
    ) as ReturnType<typeof createDefaultAdminWorkbenchNavigationExpandedGroups>;
    expect(autoOpenAdminWorkbenchNavigationGroup(allCollapsed, "/workbench/orders/1001")).toEqual({
      ...allCollapsed,
      customers: true,
    });
    expect(autoOpenAdminWorkbenchNavigationGroup(allCollapsed, "/admins/7")).toEqual({
      ...allCollapsed,
      system: true,
    });
  });

  it("登记了唯一工作台前缀下的所有业务入口", () => {
    expect(ADMIN_BUSINESS_WORKBENCH_PATHS).toEqual([
      "/workbench/inventory",
      "/workbench/publish",
      "/workbench/inbound",
      "/workbench/channel-inventory",
      "/workbench/customers",
      "/workbench/customer-demands",
      "/workbench/orders",
      "/workbench/outbound",
      "/workbench/chat",
      "/workbench/procurement-demands",
      "/workbench/procurement-orders",
      "/workbench/add-user",
      "/workbench/user-records",
      "/workbench/company-info",
    ]);
    expect(isAdminBusinessWorkbenchPath("/workbench/publish/42/edit")).toBe(true);
    expect(isAdminBusinessWorkbenchPath("/workbench/procurement-orders/create")).toBe(true);
    expect(isAdminBusinessWorkbenchPath("/profile")).toBe(false);
  });
});

describe("后台工作台导航展开状态存储", () => {
  it("按账号使用独立存储键，不会在账号间沿用展开状态", () => {
    const storage = createStorage();
    const firstAccount = {
      ...createDefaultAdminWorkbenchNavigationExpandedGroups(),
      inventory: false,
    };

    writeAdminWorkbenchNavigationExpandedGroups("admin-1", firstAccount, storage);

    expect(readAdminWorkbenchNavigationExpandedGroups("admin-1", storage)).toEqual(
      firstAccount
    );
    expect(readAdminWorkbenchNavigationExpandedGroups("admin-2", storage)).toEqual(
      createDefaultAdminWorkbenchNavigationExpandedGroups()
    );
    expect(getAdminWorkbenchNavigationStorageKey("admin-1")).not.toBe(
      getAdminWorkbenchNavigationStorageKey("admin-2")
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
    expect(readAdminWorkbenchNavigationExpandedGroups(7, unavailableStorage)).toEqual(
      createDefaultAdminWorkbenchNavigationExpandedGroups()
    );
  });

  it("读取旧平台分组状态时忽略已删除键，但保留同名系统管理状态", () => {
    const storage = createStorage();
    storage.values.set(
      getAdminWorkbenchNavigationStorageKey("admin-legacy"),
      JSON.stringify({
        platform: false,
        "users-merchants": false,
        transactions: false,
        "data-operations": false,
        system: false,
      })
    );

    expect(
      readAdminWorkbenchNavigationExpandedGroups("admin-legacy", storage)
    ).toEqual({
      operations: true,
      inventory: true,
      customers: true,
      procurement: true,
      "user-center": true,
      system: false,
    });
  });

  it("保存时仅持久化当前六组状态", () => {
    const storage = createStorage();
    const expandedGroups = {
      operations: false,
      inventory: true,
      customers: false,
      procurement: true,
      "user-center": false,
      system: true,
    };

    writeAdminWorkbenchNavigationExpandedGroups(
      "admin-six-groups",
      expandedGroups,
      storage
    );

    expect(
      storage.values.get(getAdminWorkbenchNavigationStorageKey("admin-six-groups"))
    ).toBe(JSON.stringify(expandedGroups));
    expect(
      readAdminWorkbenchNavigationExpandedGroups("admin-six-groups", storage)
    ).toEqual(expandedGroups);
  });
});
