import { describe, expect, it } from "vitest";
import {
  ADMIN_WORKBENCH_NAVIGATION_GROUPS,
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
  it("按平台七项路径顺序分组，并保留原项目对象", () => {
    const items: TestItem[] = [
      { path: "/analytics", label: "运营数据", permission: "analytics.read" },
      { path: "/profile", label: "个人信息", permission: "profile.manage" },
      { path: "/merchants", label: "商户管理", permission: "merchants.read" },
      { path: "/", label: "物料数据库", permission: "materials.read" },
      { path: "/portal-users", label: "用户管理", permission: "portalUsers.read" },
      { path: "/reviews", label: "评价管理", permission: "reviews.read" },
      { path: "/orders", label: "订单管理", permission: "orders.read" },
      { path: "/messages", label: "消息中心", permission: "messages.read" },
      { path: "/not-a-menu", label: "不应出现", permission: "none" },
    ];
    const platformItems = [
      items[2],
      items[4],
      items[6],
      items[7],
      items[5],
      items[3],
      items[0],
    ];
    const groups = groupAdminWorkbenchNavigationItems(items);

    expect(ADMIN_WORKBENCH_NAVIGATION_GROUPS).toHaveLength(2);
    expect(groups).toEqual([
      {
        id: "platform",
        label: "平台管理",
        items: platformItems,
      },
      {
        id: "system",
        label: "系统管理",
        items: [items[1]],
      },
    ]);
    platformItems.forEach((item, index) => {
      expect(groups[0].items[index]).toBe(item);
    });
  });

  it("先接收过滤后的项目，完全无权限时不输出空分组", () => {
    expect(groupAdminWorkbenchNavigationItems([])).toEqual([]);
    expect(
      groupAdminWorkbenchNavigationItems([
        { path: "/orders", label: "订单管理", permission: "orders.read" },
      ])
    ).toEqual([
      {
        id: "platform",
        label: "平台管理",
        items: [
          { path: "/orders", label: "订单管理", permission: "orders.read" },
        ],
      },
    ]);
  });

  it("详情路径打开其所属组，根路径只精确匹配而不吞掉其他路由", () => {
    expect(findAdminWorkbenchNavigationGroupId("/")).toBe("platform");
    expect(findAdminWorkbenchNavigationGroupId("/merchants/merchant-240")).toBe(
      "platform"
    );
    expect(findAdminWorkbenchNavigationGroupId("/orders/1001")).toBe(
      "platform"
    );
    expect(findAdminWorkbenchNavigationGroupId("/analytics/monthly")).toBe(
      "platform"
    );
    expect(findAdminWorkbenchNavigationGroupId("/admins/7")).toBe("system");
    expect(findAdminWorkbenchNavigationGroupId("/unrelated")).toBeNull();

    const allCollapsed = {
      platform: false,
      system: false,
    };
    expect(autoOpenAdminWorkbenchNavigationGroup(allCollapsed, "/orders/1001")).toEqual({
      ...allCollapsed,
      platform: true,
    });
    expect(autoOpenAdminWorkbenchNavigationGroup(allCollapsed, "/admins/7")).toEqual({
      ...allCollapsed,
      system: true,
    });
  });
});

describe("后台工作台导航展开状态存储", () => {
  it("按账号使用独立存储键，不会在账号间沿用展开状态", () => {
    const storage = createStorage();
    const firstAccount = {
      ...createDefaultAdminWorkbenchNavigationExpandedGroups(),
      platform: false,
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

  it("读取旧三组状态时忽略旧键，保留系统管理状态", () => {
    const storage = createStorage();
    storage.values.set(
      getAdminWorkbenchNavigationStorageKey("admin-legacy"),
      JSON.stringify({
        "users-merchants": false,
        transactions: false,
        "data-operations": false,
        system: false,
      })
    );

    expect(
      readAdminWorkbenchNavigationExpandedGroups("admin-legacy", storage)
    ).toEqual({
      platform: true,
      system: false,
    });
  });

  it("保存新的合并状态时只持久化平台管理和系统管理", () => {
    const storage = createStorage();
    const expandedGroups = {
      platform: false,
      system: true,
    };

    writeAdminWorkbenchNavigationExpandedGroups(
      "admin-merged",
      expandedGroups,
      storage
    );

    expect(
      storage.values.get(getAdminWorkbenchNavigationStorageKey("admin-merged"))
    ).toBe(JSON.stringify(expandedGroups));
    expect(
      readAdminWorkbenchNavigationExpandedGroups("admin-merged", storage)
    ).toEqual(expandedGroups);
  });
});
