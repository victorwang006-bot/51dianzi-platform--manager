export type AdminWorkbenchNavigationItem = {
  path: string;
  label: string;
};

export type AdminWorkbenchNavigationGroupId =
  | "inventory"
  | "customers"
  | "procurement"
  | "operations"
  | "system";

export type AdminWorkbenchNavigationGroupDefinition = {
  id: AdminWorkbenchNavigationGroupId;
  label: string;
  /** Visible canonical menu paths, in display order. */
  paths: readonly string[];
};

export type AdminWorkbenchNavigationGroup<
  T extends AdminWorkbenchNavigationItem,
> = {
  id: AdminWorkbenchNavigationGroupId;
  label: string;
  items: T[];
};

export type AdminWorkbenchNavigationRouteAlias = {
  /** Legacy/non-sidebar route that should retain its navigation context. */
  path: string;
  /** The canonical visible page, or /profile for the top account menu. */
  canonicalPath: string;
  groupId: AdminWorkbenchNavigationGroupId;
  label: string;
};

export type AdminWorkbenchNavigationRoute = {
  path: string;
  canonicalPath: string;
  groupId: AdminWorkbenchNavigationGroupId;
  groupLabel: string;
  label: string;
  isAlias: boolean;
};

/**
 * 后台唯一侧栏的导航事实源。
 *
 * 运营页面继续使用原始路由；业务工作台页面统一使用 /workbench 前缀。
 * staff 是唯一可点击的人员入口。旧员工和个人资料路径仅作为路由上下文别名，
 * 不会因别名而产生第二个侧栏入口；页面的真实 staff/BFF 权限仍由路由和服务端复核。
 */
export const ADMIN_WORKBENCH_NAVIGATION_GROUPS: readonly AdminWorkbenchNavigationGroupDefinition[] =
  [
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
        "/workbench/inquiries",
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
      id: "system",
      label: "系统设置",
      paths: [
        "/staff",
        "/workbench/company-info",
        "/workbench/user-records",
        "/exception-logs",
      ],
    },
  ] as const;

/**
 * Legacy routes remain explicit navigation aliases for active state, breadcrumbs,
 * automatic group expansion, and business-path authorization detection. They are
 * intentionally absent from group `paths`, so they cannot render duplicate entries.
 */
export const ADMIN_WORKBENCH_NAVIGATION_ROUTE_ALIASES: readonly AdminWorkbenchNavigationRouteAlias[] =
  [
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
      path: "/profile",
      canonicalPath: "/profile",
      groupId: "system",
      label: "个人信息",
    },
  ] as const;

const NAVIGATION_LABEL_BY_PATH: Readonly<Record<string, string>> = {
  "/workbench/inventory": "我的库存",
  "/workbench/publish": "发布库存",
  "/workbench/inbound": "入库管理",
  "/workbench/channel-inventory": "渠道库存",
  "/workbench/customers": "客户列表",
  "/workbench/customer-demands": "客户需求",
  "/workbench/orders": "销售订单",
  "/workbench/outbound": "出库管理",
  "/workbench/inquiries": "询价接待",
  "/workbench/procurement-demands": "采购需求",
  "/workbench/procurement-orders": "采购订单",
  "/merchants": "商户管理",
  "/": "物料数据库",
  "/orders": "平台订单",
  "/messages": "消息中心",
  "/reviews": "评价管理",
  "/portal-users": "平台用户",
  "/analytics": "运营数据",
  "/staff": "员工与权限",
  "/workbench/company-info": "公司信息",
  "/workbench/user-records": "员工操作记录",
  "/exception-logs": "异常日志",
};

/**
 * The complete merchant-business workbench path set. `/workbench/add-user` remains
 * here even though its only visible navigation target is now `/staff`; the official
 * channel-inventory path is deliberately excluded because it is native-admin only.
 */
export const ADMIN_BUSINESS_WORKBENCH_PATHS = [
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
] as const;

export type AdminWorkbenchNavigationExpandedGroups = Record<
  AdminWorkbenchNavigationGroupId,
  boolean
>;

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

const STORAGE_PREFIX_V1 = "admin-workbench-navigation:v1:expanded";
const STORAGE_PREFIX_V2 = "admin-workbench-navigation:v2:expanded";

export function createDefaultAdminWorkbenchNavigationExpandedGroups(): AdminWorkbenchNavigationExpandedGroups {
  return ADMIN_WORKBENCH_NAVIGATION_GROUPS.reduce((expandedGroups, group) => {
    // New accounts start compact; the active route is opened afterwards.
    expandedGroups[group.id] = false;
    return expandedGroups;
  }, {} as AdminWorkbenchNavigationExpandedGroups);
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

export function getAdminWorkbenchNavigationRoute(
  location: string
): AdminWorkbenchNavigationRoute | null {
  for (const group of ADMIN_WORKBENCH_NAVIGATION_GROUPS) {
    const path = group.paths.find(candidate =>
      isAdminWorkbenchNavigationRouteMatch(location, candidate)
    );
    if (path) {
      return {
        path,
        canonicalPath: path,
        groupId: group.id,
        groupLabel: group.label,
        label: NAVIGATION_LABEL_BY_PATH[path] ?? group.label,
        isAlias: false,
      };
    }
  }

  const alias = ADMIN_WORKBENCH_NAVIGATION_ROUTE_ALIASES.find(candidate =>
    isAdminWorkbenchNavigationRouteMatch(location, candidate.path)
  );
  if (!alias) return null;

  const group = ADMIN_WORKBENCH_NAVIGATION_GROUPS.find(
    candidate => candidate.id === alias.groupId
  );
  if (!group) return null;

  return {
    path: alias.path,
    canonicalPath: alias.canonicalPath,
    groupId: alias.groupId,
    groupLabel: group.label,
    label: alias.label,
    isAlias: true,
  };
}

export function findAdminWorkbenchNavigationGroupId(
  location: string
): AdminWorkbenchNavigationGroupId | null {
  return getAdminWorkbenchNavigationRoute(location)?.groupId ?? null;
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
  return `${STORAGE_PREFIX_V2}:${String(accountId)}`;
}

export function getLegacyAdminWorkbenchNavigationStorageKey(
  accountId: string | number
): string {
  return `${STORAGE_PREFIX_V1}:${String(accountId)}`;
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

function migrateV1ExpandedGroups(
  value: unknown
): AdminWorkbenchNavigationExpandedGroups {
  const defaults = createDefaultAdminWorkbenchNavigationExpandedGroups();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const legacyGroups = value as Record<string, unknown>;
  for (const group of ADMIN_WORKBENCH_NAVIGATION_GROUPS) {
    // v1 defaulted every group to true. Only explicit false values are safe to
    // carry forward; otherwise a v1 default would recreate an all-expanded v2 nav.
    if (legacyGroups[group.id] === false) {
      defaults[group.id] = false;
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
    const storageKey = getAdminWorkbenchNavigationStorageKey(accountId);
    const v2Value = storage.getItem(storageKey);
    if (v2Value !== null) {
      return normalizeExpandedGroups(JSON.parse(v2Value));
    }

    const v1Value = storage.getItem(
      getLegacyAdminWorkbenchNavigationStorageKey(accountId)
    );
    if (v1Value === null) {
      return createDefaultAdminWorkbenchNavigationExpandedGroups();
    }

    const migrated = migrateV1ExpandedGroups(JSON.parse(v1Value));
    // Persist the migration so an account retains only intentional v2 choices.
    storage.setItem(storageKey, JSON.stringify(migrated));
    return migrated;
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
