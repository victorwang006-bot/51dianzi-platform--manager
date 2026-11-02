import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/useMobile";
import {
  Archive,
  Database,
  BarChart3,
  Boxes,
  ClipboardList,
  Contact,
  LogOut,
  PackagePlus,
  PanelLeft,
  ReceiptText,
  MessagesSquare,
  ShieldAlert,
  Store,
  ShoppingCart,
  Truck,
  User,
  UserCog,
  Users,
  Warehouse,
} from "lucide-react";
import { MessageSquare } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { buildBusinessNavigationTarget } from "@/lib/businessNavigation";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Logo } from "./Logo";
import { AdminWorkbenchNavigation } from "./admin/AdminWorkbenchNavigation";
import { getAdminWorkbenchNavigationRoute } from "./admin/adminWorkbenchNavigationModel";
import {
  preloadAdminRoute,
  type AdminNavigationChunk,
} from "@/lib/adminRouteChunks";
import {
  hasAdminPermission,
  type AdminPermission,
  type AdminRole,
} from "@shared/adminPermissions";
import {
  hasBusinessWorkbenchCapability,
  type BusinessWorkbenchCapability,
} from "@/lib/businessWorkbenchCapabilities";
import {
  getBusinessNavigationDisplayState,
  getBusinessNavigationQueryKey,
  shouldRetryBusinessNavigation,
  type BusinessNavigationDisplayState,
} from "@/lib/businessNavigationQuery";
import {
  ADMIN_NOTIFICATION_MODULE_BY_PATH,
  type AdminNotificationModule,
} from "@shared/adminModuleNotifications";
import { useQuery } from "@tanstack/react-query";

type MenuItem = {
  icon: typeof Database;
  label: string;
  path: string;
  /** Native admin page authorization only. */
  permission?: AdminPermission;
  /** Bound portal-staff projection only; never copied into adminPermissions. */
  workbenchCapability?: BusinessWorkbenchCapability;
  /** Display-only staff fallback; it is OR-ed with native admin permission. */
  fallbackWorkbenchCapability?: BusinessWorkbenchCapability;
  chunk?: AdminNavigationChunk;
  nested: boolean;
  notificationModule?: AdminNotificationModule;
};

const menuGroups: Array<{ label: string; items: MenuItem[] }> = [
  {
    label: "库存管理",
    items: [
      {
        icon: Boxes,
        label: "我的库存",
        path: "/workbench/inventory",
        workbenchCapability: "inventory.read",
        nested: false,
      },
      {
        icon: PackagePlus,
        label: "发布库存",
        path: "/workbench/publish",
        workbenchCapability: "inventory.publish",
        nested: false,
      },
      {
        icon: Warehouse,
        label: "入库管理",
        path: "/workbench/inbound",
        workbenchCapability: "inventory.inbound",
        nested: false,
      },
      {
        icon: Archive,
        label: "渠道库存",
        path: "/workbench/channel-inventory",
        permission: "officialInventory.read",
        chunk: "officialChannelInventory",
        nested: false,
      },
    ],
  },
  {
    label: "客户管理",
    items: [
      {
        icon: Contact,
        label: "客户列表",
        path: "/workbench/customers",
        workbenchCapability: "customers.manage",
        nested: false,
      },
      {
        icon: ClipboardList,
        label: "客户需求",
        path: "/workbench/customer-demands",
        workbenchCapability: "customers.manage",
        nested: false,
      },
      {
        icon: ReceiptText,
        label: "销售订单",
        path: "/workbench/orders",
        workbenchCapability: "crm.sales_orders",
        nested: false,
      },
      {
        icon: Truck,
        label: "出库管理",
        path: "/workbench/outbound",
        workbenchCapability: "marketplace.seller",
        nested: false,
      },
      {
        icon: MessageSquare,
        label: "询价接待",
        path: "/workbench/inquiries",
        workbenchCapability: "inquiry.receive",
        nested: false,
      },
    ],
  },
  {
    label: "采购管理",
    items: [
      {
        icon: ClipboardList,
        label: "采购需求",
        path: "/workbench/procurement-demands",
        workbenchCapability: "procurement.demands",
        nested: false,
      },
      {
        icon: ReceiptText,
        label: "采购订单",
        path: "/workbench/procurement-orders",
        workbenchCapability: "procurement.orders",
        nested: false,
      },
    ],
  },
  {
    label: "运营管理",
    items: [
      {
        icon: Store,
        label: "商户管理",
        path: "/merchants",
        permission: "merchants.read",
        chunk: "merchants",
        nested: false,
        notificationModule: "merchants",
      },
      {
        icon: Database,
        label: "物料数据库",
        path: "/",
        permission: "materials.read",
        chunk: "materials",
        nested: false,
      },
      {
        icon: ShoppingCart,
        label: "平台订单",
        path: "/orders",
        permission: "orders.read",
        chunk: "orders",
        nested: false,
        notificationModule: "orders",
      },
      {
        icon: MessageSquare,
        label: "消息中心",
        path: "/messages",
        permission: "messages.read",
        chunk: "messages",
        nested: false,
      },
      {
        icon: MessagesSquare,
        label: "评价管理",
        path: "/reviews",
        permission: "logs.read",
        chunk: "reviews",
        nested: false,
        notificationModule: "reviews",
      },
      {
        icon: Users,
        label: "平台用户",
        path: "/portal-users",
        permission: "portalUsers.read",
        chunk: "portalUsers",
        nested: false,
        notificationModule: "portalUsers",
      },
      {
        icon: BarChart3,
        label: "运营数据",
        path: "/analytics",
        permission: "analytics.read",
        chunk: "analytics",
        nested: false,
      },
    ],
  },
  {
    label: "系统设置",
    items: [
      {
        icon: UserCog,
        label: "员工与权限",
        path: "/staff",
        permission: "admins.manage",
        fallbackWorkbenchCapability: "enterprise.members.manage",
        chunk: "staff",
        nested: false,
      },
      {
        icon: Store,
        label: "公司信息",
        path: "/workbench/company-info",
        workbenchCapability: "company.read",
        nested: false,
      },
      {
        icon: ClipboardList,
        label: "员工操作记录",
        path: "/workbench/user-records",
        workbenchCapability: "enterprise.members.manage",
        nested: false,
      },
      {
        icon: ShieldAlert,
        label: "异常日志",
        path: "/exception-logs",
        permission: "logs.read",
        chunk: "exceptionLogs",
        nested: false,
      },
    ],
  },
];

const allMenuItems = menuGroups.flatMap(g => g.items);
const isMenuPathActive = (location: string, path: string) =>
  location === path || (path !== "/" && location.startsWith(`${path}/`));

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 220;
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;

const adminRoleLabels: Record<string, string> = {
  super_admin: "超级管理员",
  operation: "平台运营",
  merchant_mgr: "商户管理",
  customer_svc: "客服/售后",
  risk_control: "风控审核",
  finance: "财务结算",
  auditor: "审计人员",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    return <DashboardLayoutSkeleton />;
  }

  if (user.role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-6 p-8 max-w-md w-full text-center">
          <Logo className="h-12 w-auto object-contain" />
          <ShieldAlert className="h-12 w-12 text-amber-500" />
          <h1 className="text-xl font-semibold">暂无访问权限</h1>
          <p className="text-sm text-muted-foreground">
            您的账号（{user.name || user.email || "未知"}
            ）尚未被授予后台管理权限。 请联系平台超级管理员为您分配角色后再试。
          </p>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function BusinessNavigationStatus({
  state,
  isRetrying,
  onRetry,
}: {
  state: BusinessNavigationDisplayState;
  isRetrying: boolean;
  onRetry: () => void;
}) {
  if (state.status === "ready") return null;

  if (state.status === "loading") {
    return (
      <div
        aria-live="polite"
        aria-busy="true"
        className="mx-2 mb-2 flex items-center gap-2 rounded-md border border-sidebar-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
        data-business-navigation-state="loading"
      >
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-muted-foreground/40"
        />
        <span>正在核验业务入口…</span>
      </div>
    );
  }

  if (state.status === "empty") {
    return (
      <div
        aria-live="polite"
        aria-disabled="true"
        className="mx-2 mb-2 rounded-md border border-sidebar-border px-3 py-2 text-xs text-muted-foreground"
        data-business-navigation-state="empty"
      >
        当前账号暂无业务工作台入口
      </div>
    );
  }

  return (
    <div
      aria-live="assertive"
      className="mx-2 mb-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground"
      data-business-navigation-state="error"
    >
      <p>业务工作台暂时不可用，未显示业务入口。</p>
      <button
        type="button"
        aria-label="只读重新获取业务导航"
        className="mt-1 text-xs font-medium text-primary underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isRetrying}
        onClick={onRetry}
      >
        {isRetrying ? "重试中…" : "重试"}
      </button>
    </div>
  );
}

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const activeNavigationRoute = getAdminWorkbenchNavigationRoute(location);
  const isMobile = useIsMobile();
  const adminRole = (user as { adminRole?: AdminRole } | null)?.adminRole ?? "";
  const adminPermissions = (user as { permissions?: string[] } | null)
    ?.permissions;
  const trpcUtils = trpc.useUtils();
  const accountId = user?.id;
  const hasCurrentAccount = accountId !== undefined && accountId !== null;
  const businessNavigationQuery = useQuery({
    queryKey: getBusinessNavigationQueryKey(accountId),
    // Use the tRPC proxy client so this request goes through the dedicated
    // business.navigation httpLink configured in main.tsx, not the batch.
    queryFn: ({ signal }) =>
      trpcUtils.client.business.navigation.query(undefined, { signal }),
    enabled: hasCurrentAccount,
    retry: shouldRetryBusinessNavigation,
    refetchOnWindowFocus: true,
  });
  const businessNavigationState = getBusinessNavigationDisplayState({
    enabled: hasCurrentAccount,
    isPending: businessNavigationQuery.isPending,
    isSuccess: businessNavigationQuery.isSuccess,
    isError: businessNavigationQuery.isError,
    data: businessNavigationQuery.data,
  });
  const workbenchCapabilities = businessNavigationState.workbenchCapabilities;
  const canManageProfile = hasAdminPermission(
    adminRole,
    "profile.manage",
    adminPermissions
  );
  const accountRoleLabel =
    adminRoleLabels[(user as { adminRole?: string })?.adminRole ?? ""] ??
    "管理员";
  const visibleMenuItems = menuGroups.flatMap(group =>
    group.items.filter(item => {
      if (
        item.path === "/workbench/channel-inventory" &&
        user?.hasNativeAdminAccount !== true
      )
        return false;
      const hasNativeAdminPermission =
        item.permission !== undefined &&
        hasAdminPermission(adminRole, item.permission, adminPermissions);
      const hasWorkbenchPermission =
        item.workbenchCapability !== undefined &&
        hasBusinessWorkbenchCapability(
          workbenchCapabilities,
          item.workbenchCapability
        );
      const hasFallbackWorkbenchPermission =
        item.fallbackWorkbenchCapability !== undefined &&
        hasBusinessWorkbenchCapability(
          workbenchCapabilities,
          item.fallbackWorkbenchCapability
        );

      return (
        hasNativeAdminPermission ||
        hasWorkbenchPermission ||
        hasFallbackWorkbenchPermission
      );
    })
  );
  const canReadMessages = hasAdminPermission(
    adminRole,
    "messages.read",
    adminPermissions
  );
  // 消息未读总数（侧边栏角标，30 秒轮询）
  const { data: unreadData } = trpc.message.unreadCount.useQuery(undefined, {
    enabled: canReadMessages,
    refetchInterval: canReadMessages ? 30000 : false,
  });
  const unreadTotal = unreadData?.total ?? 0;
  const canReadAnyNotifiedModule = [
    "merchants.read",
    "orders.read",
    "logs.read",
    "portalUsers.read",
  ].some(permission =>
    hasAdminPermission(
      adminRole,
      permission as AdminPermission,
      adminPermissions
    )
  );
  const { data: moduleNotificationData } =
    trpc.moduleNotification.summary.useQuery(undefined, {
      enabled: canReadAnyNotifiedModule,
      refetchInterval: canReadAnyNotifiedModule ? 30000 : false,
    });
  const moduleNotificationCounts = moduleNotificationData?.counts ?? {
    merchants: 0,
    orders: 0,
    reviews: 0,
    portalUsers: 0,
  };
  const activeNotificationModule = Object.entries(
    ADMIN_NOTIFICATION_MODULE_BY_PATH
  ).find(([path]) => isMenuPathActive(location, path))?.[1];
  const lastMarkedModuleRef = useRef<AdminNotificationModule | null>(null);
  const markModuleSeen = trpc.moduleNotification.markSeen.useMutation({
    onMutate: async ({ module }) => {
      await trpcUtils.moduleNotification.summary.cancel();
      const previous = trpcUtils.moduleNotification.summary.getData();
      trpcUtils.moduleNotification.summary.setData(undefined, current =>
        current
          ? {
              ...current,
              counts: { ...current.counts, [module]: 0 },
            }
          : current
      );
      return { previous };
    },
    onError: (_error, variables, context) => {
      if (context?.previous) {
        trpcUtils.moduleNotification.summary.setData(
          undefined,
          context.previous
        );
      }
      if (lastMarkedModuleRef.current === variables.module) {
        lastMarkedModuleRef.current = null;
      }
    },
    onSettled: () => trpcUtils.moduleNotification.summary.invalidate(),
  });

  useEffect(() => {
    if (!activeNotificationModule) {
      lastMarkedModuleRef.current = null;
      return;
    }
    if (lastMarkedModuleRef.current === activeNotificationModule) return;
    lastMarkedModuleRef.current = activeNotificationModule;
    markModuleSeen.mutate({ module: activeNotificationModule });
  }, [activeNotificationModule]);

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };
    const handleMouseUp = () => setIsResizing(false);
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r-0"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-16 justify-center border-b border-sidebar-border">
            <div className="flex items-center gap-2 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="切换导航"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed ? (
                <div className="flex items-center gap-2.5 min-w-0">
                  <Logo className="h-9 w-auto shrink-0 object-contain" />
                  <div className="flex flex-col min-w-0 gap-0.5">
                    <span className="font-bold tracking-tight truncate text-base text-primary leading-none">
                      51电子网
                    </span>
                    <span className="text-[11px] text-muted-foreground truncate leading-none">
                      后台管理系统
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0 py-2">
            <BusinessNavigationStatus
              state={businessNavigationState}
              isRetrying={businessNavigationQuery.isFetching}
              onRetry={() => {
                void businessNavigationQuery.refetch();
              }}
            />
            <AdminWorkbenchNavigation
              items={visibleMenuItems}
              renderItem={item => {
                const isActive =
                  activeNavigationRoute?.canonicalPath === item.path;
                const badgeCount =
                  item.path === "/messages"
                    ? unreadTotal
                    : item.notificationModule
                      ? moduleNotificationCounts[item.notificationModule]
                      : 0;
                const showUnread = badgeCount > 0;
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => {
                        if (item.notificationModule) {
                          lastMarkedModuleRef.current = item.notificationModule;
                          markModuleSeen.mutate({
                            module: item.notificationModule,
                          });
                        }
                        const navigationTarget =
                          item.path === "/workbench/channel-inventory"
                            ? item.path
                            : buildBusinessNavigationTarget(
                                `${window.location.pathname}${window.location.search}`,
                                item.path
                              );
                        if (navigationTarget !== null)
                          setLocation(navigationTarget);
                      }}
                      onPointerEnter={() => {
                        if (item.chunk) preloadAdminRoute(item.chunk);
                      }}
                      onFocus={() => {
                        if (item.chunk) preloadAdminRoute(item.chunk);
                      }}
                      tooltip={item.label}
                      className={`h-9 transition-all sidebar-menu-item ${item.nested ? "ml-6 w-[calc(100%-1.5rem)] border-l border-sidebar-border pl-2 group-data-[collapsible=icon]:ml-0 group-data-[collapsible=icon]:w-auto" : ""} ${isActive ? "sidebar-item-active" : "font-normal"}`}
                    >
                      <item.icon
                        className={`h-4 w-4 ${isActive ? "text-primary" : ""}`}
                      />
                      <span>{item.label}</span>
                      {showUnread && (
                        <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-medium text-white">
                          {badgeCount > 99 ? "99+" : badgeCount}
                        </span>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              }}
              location={location}
              accountId={accountId ?? "signed-out"}
              collapsed={isCollapsed && !isMobile}
            />
          </SidebarContent>

          <SidebarFooter className="p-3 border-t border-sidebar-border">
            <button
              type="button"
              onClick={toggleSidebar}
              title={isCollapsed ? "展开导航" : "收起导航"}
              aria-label={isCollapsed ? "展开导航" : "收起导航"}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring group-data-[collapsible=icon]:justify-center"
            >
              <PanelLeft
                className={`h-4 w-4 shrink-0 transition-transform ${isCollapsed ? "rotate-180" : ""}`}
              />
              <span className="group-data-[collapsible=icon]:hidden">
                {isCollapsed ? "展开导航" : "收起导航"}
              </span>
            </button>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            {isMobile ? (
              <SidebarTrigger className="h-9 w-9 shrink-0 rounded-lg bg-background" />
            ) : null}
            <nav
              aria-label="当前位置"
              className="flex min-w-0 items-center gap-2 text-sm"
            >
              <span className="truncate font-medium text-foreground">
                {activeNavigationRoute?.groupLabel ?? "后台管理"}
              </span>
              <span aria-hidden="true" className="text-muted-foreground">
                /
              </span>
              <span className="truncate text-muted-foreground">
                {activeNavigationRoute?.label ?? "概览"}
              </span>
            </nav>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onPointerEnter={() => {
                  if (canManageProfile) preloadAdminRoute("profile");
                }}
                onFocus={() => {
                  if (canManageProfile) preloadAdminRoute("profile");
                }}
                className="flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Avatar className="h-8 w-8 border shrink-0">
                  <AvatarFallback className="bg-primary text-xs font-medium text-primary-foreground">
                    {user?.name?.charAt(0).toUpperCase() || "管"}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden min-w-0 text-left sm:block">
                  <p className="max-w-28 truncate text-sm font-medium leading-none">
                    {user?.name || "-"}
                  </p>
                  <p className="mt-1 max-w-28 truncate text-xs text-muted-foreground">
                    {accountRoleLabel}
                  </p>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {canManageProfile ? (
                <DropdownMenuItem
                  onClick={() => setLocation("/profile")}
                  className="cursor-pointer"
                >
                  <User className="mr-2 h-4 w-4" />
                  <span>个人信息</span>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                onClick={logout}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span>退出登录</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="min-h-[calc(100svh-3.5rem)] flex-1 bg-background p-6">
          {children}
        </main>
      </SidebarInset>
    </>
  );
}
