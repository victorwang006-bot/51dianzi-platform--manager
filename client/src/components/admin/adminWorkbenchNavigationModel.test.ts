import { describe, expect, it } from "vitest";
import {
  autoOpenAdminWorkbenchNavigationGroup,
  createDefaultAdminWorkbenchNavigationExpandedGroups,
  findAdminWorkbenchNavigationGroupId,
  getAdminWorkbenchNavigationStorageKey,
  groupAdminWorkbenchNavigationItems,
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

describe("后台工作台导航分组", () => {
  it("按批准的四组路径顺序分组，并忽略不属于后台菜单的项目", () => {
    const items: TestItem[] = [
      { path: "/analytics", label: "运营数据", permission: "analytics.read" },
      { path: "/profile", label: "个人信息", permission: "profile.manage" },
      { path: "/merchants", label: "商户管理", permission: "merchants.read" },
      { path: "/", label: "物料数据库", permission: "materials.read" },
      { path: "/portal-users", label: "用户管理", permission: "portalUsers.read" },
      { path: "/not-a-menu", label: "不应出现", permission: "none" },
    ];

    expect(groupAdminWorkbenchNavigationItems(items)).toEqual([
      {
        id: "users-merchants",
        label: "用户与商户",
        items: [items[2], items[4]],
      },
      {
        id: "data-operations",
        label: "数据与运营",
        items: [items[3], items[0]],
      },
      {
        id: "system",
        label: "系统管理",
        items: [items[1]],
      },
    ]);
  });

  it("先接收过滤后的项目，完全无权限时不输出空分组", () => {
    expect(groupAdminWorkbenchNavigationItems([])).toEqual([]);
    expect(
      groupAdminWorkbenchNavigationItems([
        { path: "/orders", label: "订单管理", permission: "orders.read" },
      ])
    ).toEqual([
      {
        id: "transactions",
        label: "交易与服务",
        items: [
          { path: "/orders", label: "订单管理", permission: "orders.read" },
        ],
      },
    ]);
  });

  it("详情路径打开其所属组，根路径只精确匹配而不吞掉其他路由", () => {
    expect(findAdminWorkbenchNavigationGroupId("/")).toBe("data-operations");
    expect(findAdminWorkbenchNavigationGroupId("/merchants/merchant-240")).toBe(
      "users-merchants"
    );
    expect(findAdminWorkbenchNavigationGroupId("/orders/1001")).toBe(
      "transactions"
    );
    expect(findAdminWorkbenchNavigationGroupId("/analytics/monthly")).toBe(
      "data-operations"
    );
    expect(findAdminWorkbenchNavigationGroupId("/unrelated")).toBeNull();

    const allCollapsed = {
      "users-merchants": false,
      transactions: false,
      "data-operations": false,
      system: false,
    };
    expect(autoOpenAdminWorkbenchNavigationGroup(allCollapsed, "/orders/1001")).toEqual({
      ...allCollapsed,
      transactions: true,
    });
  });
});

describe("后台工作台导航展开状态存储", () => {
  it("按账号使用独立存储键，不会在账号间沿用展开状态", () => {
    const storage = createStorage();
    const firstAccount = {
      ...createDefaultAdminWorkbenchNavigationExpandedGroups(),
      "users-merchants": false,
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
});
