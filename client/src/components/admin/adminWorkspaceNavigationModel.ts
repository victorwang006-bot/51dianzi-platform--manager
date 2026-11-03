import {
  ADMIN_WORKBENCH_NAVIGATION_GROUPS,
  getAdminWorkbenchNavigationRoute,
  isAdminWorkbenchNavigationRouteMatch,
  type AdminWorkbenchNavigationItem,
} from "./adminWorkbenchNavigationModel";

export type AdminWorkspaceId = "business" | "operations" | "organization";
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

function pathsForGroup(id: string): readonly string[] {
  return (
    ADMIN_WORKBENCH_NAVIGATION_GROUPS.find(group => group.id === id)?.paths ??
    []
  );
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
        "/workbench/customer-demands",
        "/workbench/orders",
        "/workbench/inventory",
        "/workbench/publish",
        "/workbench/inbound",
        "/workbench/outbound",
        "/workbench/inquiries",
        ...pathsForGroup("procurement"),
        "/workbench/company-info",
      ],
    },
    {
      id: "operations",
      label: "平台运营",
      paths: [...pathsForGroup("operations"), "/exception-logs"],
    },
    {
      id: "organization",
      label: "组织与权限",
      paths: ["/staff", "/teams", "/role-templates", "/permission-audit", "/workbench/user-records"],
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
  // /workbench is the existing inventory landing route, not a new menu target.
  const canonicalLocation =
    pathname === "/workbench"
      ? "/workbench/inventory"
      : (businessAlias?.canonicalPath ?? pathname);
  const route = getAdminWorkbenchNavigationRoute(canonicalLocation);
  if (!route) return null;

  const workspaceId =
    route.canonicalPath === "/profile"
      ? "organization"
      : ADMIN_WORKSPACE_DEFINITIONS.find(workspace =>
          workspace.paths.includes(route.canonicalPath)
        )?.id;
  if (!workspaceId) return null;

  return {
    pathname,
    canonicalPath: route.canonicalPath,
    workspaceId,
    label: route.label,
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
