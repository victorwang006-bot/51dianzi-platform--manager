import { hasAdminPermission, type AdminRole } from "@shared/adminPermissions";
import {
  ADMIN_WORKBENCH_NAVIGATION_GROUPS,
  getAdminWorkbenchNavigationRoute,
  isAdminWorkbenchNavigationRouteMatch,
  type AdminWorkbenchNavigationItem,
} from "./adminWorkbenchNavigationModel";

/** Native auth projection only; BFF binding/enterprise/team checks stay mandatory. */
export function hasAdminChannelInventoryRead(user: {
  hasNativeAdminAccount?: unknown;
  adminRole?: unknown;
  permissions?: unknown;
} | null | undefined): boolean {
  return user?.hasNativeAdminAccount === true && hasAdminPermission(
    user.adminRole as AdminRole | undefined,
    "officialInventory.read",
    Array.isArray(user.permissions) ? user.permissions.filter((key): key is string => typeof key === "string") : undefined,
  );
}

export type AdminWorkspaceId = "business" | "operations" | "personal" | "organization";
export type AdminWorkspaceNavigationItem = AdminWorkbenchNavigationItem;

export type AdminWorkspaceDefinition = {
  id: AdminWorkspaceId;
  label: string;
  paths: readonly string[];
};

export type AdminWorkspace<T extends AdminWorkspaceNavigationItem> = {
  id: AdminWorkspaceId;
  label: string;
  items: T[];
};

export type AdminBusinessNavigationGroupId =
  | "customers"
  | "inventory"
  | "procurement";

export type AdminOperationsNavigationGroupId =
  | "basic-data"
  | "transactions-services"
  | "data-monitoring";

export type AdminWorkspaceNavigationGroupId =
  | AdminBusinessNavigationGroupId
  | AdminOperationsNavigationGroupId;

export type AdminWorkspaceModuleNavigationEntry<
  T extends AdminWorkspaceNavigationItem,
  Id extends AdminWorkspaceNavigationGroupId = AdminWorkspaceNavigationGroupId,
> =
  | { kind: "direct"; item: T }
  | {
      kind: "group";
      id: Id;
      label: string;
      items: T[];
    };

export type AdminBusinessNavigationEntry<T extends AdminWorkspaceNavigationItem> =
  AdminWorkspaceModuleNavigationEntry<T, AdminBusinessNavigationGroupId>;

function pathsForGroup(id: string): readonly string[] {
  return (
    ADMIN_WORKBENCH_NAVIGATION_GROUPS.find(group => group.id === id)?.paths ??
    []
  );
}

/** Dropdown presentation only. Customers/inventory have independent primary
 * entries; keep their canonical route context and legacy targets below intact. */
const BUSINESS_MODULE_ENTRIES = [
  {
    kind: "group",
    id: "customers",
    label: "销售管理",
    paths: [
      "/workbench/orders",
    ],
  },
  {
    kind: "group",
    id: "inventory",
    label: "库存管理",
    paths: [
      "/workbench/inbound",
      "/workbench/outbound",
    ],
  },
  {
    kind: "group",
    id: "procurement",
    label: "采购管理",
    paths: pathsForGroup("procurement"),
  },
] as const;

const OPERATIONS_MODULE_ENTRIES = [
  {
    kind: "group",
    id: "basic-data",
    label: "基础资料",
    paths: ["/merchants", "/materials", "/portal-users"],
  },
  {
    kind: "group",
    id: "transactions-services",
    label: "交易与服务",
    paths: ["/orders", "/messages", "/reviews"],
  },
  {
    kind: "group",
    id: "data-monitoring",
    label: "数据与监控",
    paths: ["/analytics", "/exception-logs"],
  },
] as const;

/** Only intersect with parent-authorized items. Never synthesize a menu or a fallback. */
function groupNavigationItems<
  T extends AdminWorkspaceNavigationItem,
  Id extends AdminWorkspaceNavigationGroupId,
>(items: readonly T[], entries: readonly (
  | { kind: "direct"; path: string }
  | { kind: "group"; id: Id; label: string; paths: readonly string[] }
)[]): AdminWorkspaceModuleNavigationEntry<T, Id>[] {
  const itemByPath = new Map(items.map(item => [item.path, item]));
  return entries.flatMap<AdminWorkspaceModuleNavigationEntry<T, Id>>(
    entry => {
      if (entry.kind === "direct") {
        const item = itemByPath.get(entry.path);
        return item ? [{ kind: "direct", item }] : [];
      }
      const visibleItems = entry.paths.flatMap(path => {
        const item = itemByPath.get(path);
        return item ? [item] : [];
      });
      return visibleItems.length
        ? [
            {
              kind: "group",
              id: entry.id,
              label: entry.label,
              items: visibleItems,
            },
          ]
        : [];
    }
  );
}

export function groupAdminBusinessNavigationItems<T extends AdminWorkspaceNavigationItem>(
  items: readonly T[]
): AdminBusinessNavigationEntry<T>[] {
  return groupNavigationItems(items, BUSINESS_MODULE_ENTRIES);
}

export function groupAdminOperationsNavigationItems<T extends AdminWorkspaceNavigationItem>(
  items: readonly T[]
): AdminWorkspaceModuleNavigationEntry<T, AdminOperationsNavigationGroupId>[] {
  return groupNavigationItems(items, OPERATIONS_MODULE_ENTRIES);
}

/** Both grouped workspaces share presentation and interaction; organization stays flat. */
export function groupAdminWorkspaceModuleNavigationItems<T extends AdminWorkspaceNavigationItem>(
  items: readonly T[], workspaceId: AdminWorkspaceId
): AdminWorkspaceModuleNavigationEntry<T>[] {
  return workspaceId === "business" ? groupAdminBusinessNavigationItems(items)
    : workspaceId === "operations" ? groupAdminOperationsNavigationItems(items) : [];
}

/** Presentation only. The original menu model remains the canonical menu source. */
export const ADMIN_WORKSPACE_DEFINITIONS: readonly AdminWorkspaceDefinition[] =
  [
    {
      id: "business",
      label: "业务工作台",
      paths: [
        "/workbench/channel-inventory",
        "/workbench/customers",
        "/workbench/orders",
        "/workbench/inbound",
        "/workbench/outbound",
        "/workbench/inquiries",
        ...pathsForGroup("procurement"),
      ],
    },
    {
      id: "personal",
      label: "个人中心",
      paths: ["/profile"],
    },
    {
      id: "operations",
      label: "平台运营",
      paths: [...pathsForGroup("operations"), "/exception-logs"],
    },
    {
      id: "organization",
      label: "组织与权限",
      paths: [
        "/staff",
        "/teams",
        "/workbench/user-records",
      ],
    },
  ];

/** These are real legacy pages in App/BusinessWorkbenchPage, not extra menu items. */
const BUSINESS_ROUTE_ALIASES: readonly {
  path: string;
  canonicalPath: string;
}[] = [
  { path: "/workbench/sales-orders", canonicalPath: "/workbench/orders" },
  {
    path: "/workbench/procurement/demands",
    canonicalPath: "/workbench/procurement-demands",
  },
  {
    path: "/workbench/procurement/orders",
    canonicalPath: "/workbench/procurement-orders",
  },
  {
    path: "/workbench/demand-quotes",
    canonicalPath: "/workbench/procurement-demands",
  },
  { path: "/workbench/company", canonicalPath: "/workbench/company-info" },
];

export type AdminWorkspaceNavigationRoute = {
  pathname: string;
  canonicalPath: string;
  workspaceId: AdminWorkspaceId;
  label: string;
  isAlias: boolean;
};

/** Ignore the query for active state only; never rewrite the parent's navigation URL. */
export function getAdminWorkspacePathname(location: string): string {
  const pathname = location.split(/[?#]/, 1)[0];
  return pathname?.startsWith("/") ? pathname.replace(/\/+$/, "") || "/" : "";
}

/** Frontend entry retirement only. Targets still enforce their original permissions/BFF scope. */
export function getClosedAdminEntryNavigationTarget(location: string): string | null {
  const pathname = getAdminWorkspacePathname(location);
  const destination = pathname === "/role-templates" || pathname === "/permission-audit"
    ? "/staff"
    : pathname === "/workbench" ? "/workbench/customers"
    : pathname === "/workbench/inventory" ||
        pathname === "/workbench/publish" || /^\/workbench\/publish\/[^/]+\/edit$/.test(pathname)
      ? "/workbench/channel-inventory" : null;
  if (!destination) return null;

  // Restore only one legal candidate selection, never a query-supplied grant,
  // returnTo URL, stale page mode or a locally inferred merchant/enterprise.
  const queryLocation = location.split("#", 1)[0];
  const search = queryLocation.includes("?") ? queryLocation.slice(queryLocation.indexOf("?") + 1) : "";
  const merchantIds = new URLSearchParams(search).getAll("merchantId");
  const merchantId = merchantIds[0];
  return merchantIds.length === 1 && /^\d+$/.test(merchantId) &&
      Number.isSafeInteger(Number(merchantId)) && Number(merchantId) > 0
    ? `${destination}?merchantId=${encodeURIComponent(merchantId)}` : destination;
}

export function groupAdminWorkspaceNavigationItems<
  T extends AdminWorkspaceNavigationItem,
>(items: readonly T[]): AdminWorkspace<T>[] {
  const itemByPath = new Map(items.map(item => [item.path, item]));
  return ADMIN_WORKSPACE_DEFINITIONS.flatMap(workspace => {
    const visibleItems = workspace.paths.flatMap(path => {
      const item = itemByPath.get(path);
      return item ? [item] : [];
    });
    return visibleItems.length
      ? [{ id: workspace.id, label: workspace.label, items: visibleItems }]
      : [];
  });
}

export function getAdminWorkspaceNavigationRoute(
  location: string
): AdminWorkspaceNavigationRoute | null {
  const pathname = getAdminWorkspacePathname(location);
  if (!pathname) return null;

  const businessAlias = BUSINESS_ROUTE_ALIASES.find(alias =>
    isAdminWorkbenchNavigationRouteMatch(pathname, alias.path)
  );
  // Retired entries and the legacy landing resolve only to still-open routes.
  const canonicalLocation =
    getClosedAdminEntryNavigationTarget(pathname) ??
    businessAlias?.canonicalPath ?? pathname;
  const route = getAdminWorkbenchNavigationRoute(canonicalLocation);
  if (!route) return null;

  const workspaceId =
    route.canonicalPath === "/profile"
      ? "personal"
      : route.canonicalPath === "/workbench/company-info"
        ? "business" // Legacy route context only; never a visible menu item.
      : ADMIN_WORKSPACE_DEFINITIONS.find(workspace =>
          workspace.paths.includes(route.canonicalPath)
        )?.id;
  if (!workspaceId) return null;

  return {
    pathname,
    canonicalPath: route.canonicalPath,
    workspaceId,
    label: route.canonicalPath === "/profile" ? "个人中心" : route.label,
    isAlias: route.isAlias || canonicalLocation !== pathname,
  };
}

/** Route context only, never permission filtering. Returns null for an unknown URL. */
export function getAdminWorkspaceForLocation(
  location: string
): AdminWorkspaceDefinition | null {
  const route = getAdminWorkspaceNavigationRoute(location);
  return (
    ADMIN_WORKSPACE_DEFINITIONS.find(
      workspace => workspace.id === route?.workspaceId
    ) ?? null
  );
}

export function getAdminWorkspaceNavigationState<
  T extends AdminWorkspaceNavigationItem,
>(items: readonly T[], location: string) {
  const workspaces = groupAdminWorkspaceNavigationItems(items);
  const route = getAdminWorkspaceNavigationRoute(location);
  // A route context is not an authorization grant. Do not fall back to another
  // workspace or a hidden module when a URL is unknown/permission was revoked.
  const activeWorkspace =
    workspaces.find(workspace => workspace.id === route?.workspaceId) ?? null;
  const activeItem =
    activeWorkspace?.items.find(item => item.path === route?.canonicalPath) ??
    null;
  return { workspaces, route, activeWorkspace, activeItem };
}

/** Returns the original visible item, leaving query handling and all side effects to the parent. */
export function getAdminWorkspaceNavigationTarget<
  T extends AdminWorkspaceNavigationItem,
>(items: readonly T[], workspaceId: AdminWorkspaceId): T | null {
  return (
    groupAdminWorkspaceNavigationItems(items).find(
      workspace => workspace.id === workspaceId
    )?.items[0] ?? null
  );
}
