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
  FileText,
  LogOut,
  PackagePlus,
  PanelLeft,
  ReceiptText,
  Send,
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
  ADMIN_NOTIFICATION_MODULE_BY_PATH,
  type AdminNotificationModule,
} from "@shared/adminModuleNotifications";

type MenuItem = {
  icon: typeof Database;
  label: string;
  path: string;
  /** Native admin page authorization only. */
  permission?: AdminPermission;
  /** Bound portal-staff projection only; never copied into adminPermissions. */
  workbenchCapability?: BusinessWorkbenchCapability;
  chunk?: AdminNavigationChunk;
  nested: boolean;
  notificationModule?: AdminNotificationModule;
};

const menuGroups: Array<{ label: string; items: MenuItem[] }> = [
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
        label: "订单管理",
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
        label: "用户管理",
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
        workbenchCapability: "inventory.channel",
        nested: false,
      },
    ],
  },
  {
    label: "客户管理",
    items: [
      {
        icon: Contact,
        label: "客户管理",
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
        label: "询价聊天",
        path: "/workbench/chat",
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
    label: "用户中心",
    items: [
      {
        icon: Users,
        label: "成员管理",
        path: "/workbench/add-user",
        workbenchCapability: "enterprise.members.manage",
        nested: false,
      },
      {
        icon: ClipboardList,
        label: "成员记录",
        path: "/workbench/user-records",
        workbenchCapability: "enterprise.members.manage",
        nested: false,
      },
      {
        icon: FileText,
        label: "公司信息",
        path: "/workbench/company-info",
        workbenchCapability: "company.read",
        nested: false,
      },
      {
        icon: User,
        label: "个人信息",
        path: "/profile",
        permission: "profile.manage",
        chunk: "profile",
        nested: false,
      },
    ],
  },
  {
    label: "系统管理",
    items: [
      {
        icon: UserCog,
        label: "后台用户管理",
        path: "/admins",
        permission: "admins.manage",
        chunk: "admins",
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
  const activeMenuItem = allMenuItems.find(item =>
    isMenuPathActive(location, item.path)
  );
  const isMobile = useIsMobile();
  const adminRole = ((user as { adminRole?: AdminRole } | null)?.adminRole ??
    "super_admin") as AdminRole;
  const adminPermissions = (user as { permissions?: string[] } | null)
    ?.permissions;
  const trpcUtils = trpc.useUtils();
  const { data: businessNavigation } = trpc.business.navigation.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: true,
  });
  const workbenchCapabilities = businessNavigation?.workbenchCapabilities;
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
  ].some(permission => hasAdminPermission(
    adminRole,
    permission as AdminPermission,
    adminPermissions,
  ));
  const { data: moduleNotificationData } = trpc.moduleNotification.summary.useQuery(undefined, {
    enabled: canReadAnyNotifiedModule,
    refetchInterval: canReadAnyNotifiedModule ? 30000 : false,
  });
  const moduleNotificationCounts = moduleNotificationData?.counts ?? {
    merchants: 0,
    orders: 0,
    reviews: 0,
    portalUsers: 0,
  };
  const activeNotificationModule = Object.entries(ADMIN_NOTIFICATION_MODULE_BY_PATH)
    .find(([path]) => isMenuPathActive(location, path))?.[1];
  const lastMarkedModuleRef = useRef<AdminNotificationModule | null>(null);
  const markModuleSeen = trpc.moduleNotification.markSeen.useMutation({
    onMutate: async ({ module }) => {
      await trpcUtils.moduleNotification.summary.cancel();
      const previous = trpcUtils.moduleNotification.summary.getData();
      trpcUtils.moduleNotification.summary.setData(undefined, current => current ? {
        ...current,
        counts: { ...current.counts, [module]: 0 },
      } : current);
      return { previous };
    },
    onError: (_error, variables, context) => {
      if (context?.previous) {
        trpcUtils.moduleNotification.summary.setData(undefined, context.previous);
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
            <AdminWorkbenchNavigation
              items={menuGroups.flatMap(group =>
                group.items.filter(item =>
                  item.workbenchCapability
                    ? hasBusinessWorkbenchCapability(workbenchCapabilities, item.workbenchCapability)
                    : item.permission !== undefined
                      && hasAdminPermission(adminRole, item.permission, adminPermissions)
                )
              )}
              renderItem={item => {
                const isActive = isMenuPathActive(location, item.path);
                const badgeCount = item.path === "/messages"
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
                          markModuleSeen.mutate({ module: item.notificationModule });
                        }
                        const navigationTarget = buildBusinessNavigationTarget(
                          `${window.location.pathname}${window.location.search}`,
                          item.path,
                        );
                        if (navigationTarget !== null) setLocation(navigationTarget);
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
              accountId={user?.id ?? "unknown-admin"}
              collapsed={isCollapsed && !isMobile}
            />
          </SidebarContent>

          <SidebarFooter className="p-3 border-t border-sidebar-border">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-9 w-9 border shrink-0">
                    <AvatarFallback className="text-xs font-medium bg-primary text-primary-foreground">
                      {user?.name?.charAt(0).toUpperCase() || "管"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none">
                      {user?.name || "-"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">
                      {adminRoleLabels[
                        (user as { adminRole?: string })?.adminRole ?? ""
                      ] ?? "管理员"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>退出登录</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />
              <div className="flex items-center gap-3">
                <Logo className="h-8 w-auto object-contain" />
                <span className="tracking-tight text-foreground font-medium">
                  {activeMenuItem?.label ?? "菜单"}
                </span>
              </div>
            </div>
          </div>
        )}
        <main className="flex-1 p-6 bg-background min-h-screen">
          {children}
        </main>
      </SidebarInset>
    </>
  );
}
