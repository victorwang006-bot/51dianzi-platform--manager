export type AdminWorkbenchNavigationItem = {
  path: string;
  label: string;
};

export type AdminWorkbenchNavigationGroupId =
  | "operations"
  | "inventory"
  | "customers"
  | "procurement"
  | "user-center"
  | "system";

export type AdminWorkbenchNavigationGroupDefinition = {
  id: AdminWorkbenchNavigationGroupId;
  label: string;
  paths: readonly string[];
};

export type AdminWorkbenchNavigationGroup<T extends AdminWorkbenchNavigationItem> = {
  id: AdminWorkbenchNavigationGroupId;
  label: string;
  items: T[];
};

/**
 * 后台唯一侧栏的导航事实源。
 *
 * 运营页面继续使用其原始路由；业务工作台页面统一使用 /workbench 前缀。
 * 不在此模型中折叠或伪造企业业务页面，页面的真实 staff/BFF 权限仍由路由和服务端复核。
 */
export const ADMIN_WORKBENCH_NAVIGATION_GROUPS: readonly AdminWorkbenchNavigationGroupDefinition[] = [
  {
    id: "operations",
    label: "运营管理",
    paths: [
      "/merchants",
      "/",
      "/orders",
      "/messages",
      "/reviews",
      "/portal-users",
      "/analytics",
    ],
  },
  {
    id: "inventory",
    label: "库存管理",
    paths: [
      "/workbench/inventory",
      "/workbench/publish",
      "/workbench/inbound",
      "/workbench/channel-inventory",
    ],
  },
  {
    id: "customers",
    label: "客户管理",
    paths: [
      "/workbench/customers",
      "/workbench/customer-demands",
      "/workbench/orders",
      "/workbench/outbound",
      "/workbench/chat",
    ],
  },
  {
    id: "procurement",
    label: "采购管理",
    paths: [
      "/workbench/procurement-demands",
      "/workbench/procurement-orders",
    ],
  },
  {
    id: "user-center",
    label: "用户中心",
    paths: [
      "/workbench/add-user",
      "/workbench/user-records",
      "/workbench/company-info",
      // 这里复用后台 staff Profile；不使用前台用户资料页冒充工作人员资料。
      "/profile",
    ],
  },
  {
    id: "system",
    label: "系统管理",
    paths: ["/admins", "/exception-logs"],
  },
] as const;

export const ADMIN_BUSINESS_WORKBENCH_PATHS = ADMIN_WORKBENCH_NAVIGATION_GROUPS
  .filter(group => ["inventory", "customers", "procurement", "user-center"].includes(group.id))
  .flatMap(group => group.paths.filter(path => path.startsWith("/workbench/")));

export type AdminWorkbenchNavigationExpandedGroups = Record<
  AdminWorkbenchNavigationGroupId,
  boolean
>;

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

const STORAGE_PREFIX = "admin-workbench-navigation:v1:expanded";

export function createDefaultAdminWorkbenchNavigationExpandedGroups(): AdminWorkbenchNavigationExpandedGroups {
  return ADMIN_WORKBENCH_NAVIGATION_GROUPS.reduce(
    (expandedGroups, group) => {
      expandedGroups[group.id] = true;
      return expandedGroups;
    },
    {} as AdminWorkbenchNavigationExpandedGroups
  );
}

export function groupAdminWorkbenchNavigationItems<
  T extends AdminWorkbenchNavigationItem,
>(items: readonly T[]): AdminWorkbenchNavigationGroup<T>[] {
  const itemByPath = new Map(items.map(item => [item.path, item]));

  return ADMIN_WORKBENCH_NAVIGATION_GROUPS.reduce<
    AdminWorkbenchNavigationGroup<T>[]
  >((groups, group) => {
    const groupItems = group.paths.flatMap(path => {
      const item = itemByPath.get(path);
      return item ? [item] : [];
    });

    if (groupItems.length > 0) {
      groups.push({
        id: group.id,
        label: group.label,
        items: groupItems,
      });
    }

    return groups;
  }, []);
}

export function isAdminWorkbenchNavigationRouteMatch(
  location: string,
  path: string
): boolean {
  // The materials root must only match the root itself; otherwise it would
  // incorrectly claim every admin route before its real group can match.
  if (path === "/") {
    return location === "/";
  }

  return location === path || location.startsWith(`${path}/`);
}

export function findAdminWorkbenchNavigationGroupId(
  location: string
): AdminWorkbenchNavigationGroupId | null {
  for (const group of ADMIN_WORKBENCH_NAVIGATION_GROUPS) {
    if (
      group.paths.some(path =>
        isAdminWorkbenchNavigationRouteMatch(location, path)
      )
    ) {
      return group.id;
    }
  }

  return null;
}

export function isAdminBusinessWorkbenchPath(location: string): boolean {
  return ADMIN_BUSINESS_WORKBENCH_PATHS.some(path =>
    isAdminWorkbenchNavigationRouteMatch(location, path)
  );
}

export function autoOpenAdminWorkbenchNavigationGroup(
  expandedGroups: AdminWorkbenchNavigationExpandedGroups,
  location: string
): AdminWorkbenchNavigationExpandedGroups {
  const groupId = findAdminWorkbenchNavigationGroupId(location);
  if (!groupId || expandedGroups[groupId]) {
    return expandedGroups;
  }

  return {
    ...expandedGroups,
    [groupId]: true,
  };
}

export function getAdminWorkbenchNavigationStorageKey(
  accountId: string | number
): string {
  return `${STORAGE_PREFIX}:${String(accountId)}`;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeExpandedGroups(
  value: unknown
): AdminWorkbenchNavigationExpandedGroups {
  const defaults = createDefaultAdminWorkbenchNavigationExpandedGroups();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const storedGroups = value as Record<string, unknown>;
  for (const group of ADMIN_WORKBENCH_NAVIGATION_GROUPS) {
    const storedValue = storedGroups[group.id];
    if (typeof storedValue === "boolean") {
      defaults[group.id] = storedValue;
    }
  }

  return defaults;
}

export function readAdminWorkbenchNavigationExpandedGroups(
  accountId: string | number,
  storage: StorageLike | null = getBrowserStorage()
): AdminWorkbenchNavigationExpandedGroups {
  if (!storage) {
    return createDefaultAdminWorkbenchNavigationExpandedGroups();
  }

  try {
    const value = storage.getItem(getAdminWorkbenchNavigationStorageKey(accountId));
    return value === null
      ? createDefaultAdminWorkbenchNavigationExpandedGroups()
      : normalizeExpandedGroups(JSON.parse(value));
  } catch {
    return createDefaultAdminWorkbenchNavigationExpandedGroups();
  }
}

export function writeAdminWorkbenchNavigationExpandedGroups(
  accountId: string | number,
  expandedGroups: AdminWorkbenchNavigationExpandedGroups,
  storage: StorageLike | null = getBrowserStorage()
): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      getAdminWorkbenchNavigationStorageKey(accountId),
      JSON.stringify(normalizeExpandedGroups(expandedGroups))
    );
  } catch {
    // Private browsing, storage quota failures, and disabled storage must not
    // prevent the admin navigation from rendering.
  }
}
