import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Router as WouterRouter, Switch, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { DashboardLayoutSkeleton } from "./components/DashboardLayoutSkeleton";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import {
  LazyAdmins,
  LazyAnalytics,
  LazyExceptionLogs,
  LazyForbidden,
  LazyLogin,
  LazyMaterials,
  LazyMerchantDetail,
  LazyMerchants,
  LazyMessages,
  LazyNotFound,
  LazyOrders,
  LazyPortalUsers,
  LazyProfile,
  LazyReviews,
} from "./lib/adminRouteChunks";
import {
  hasAdminPermission,
  type AdminPermission,
  type AdminRole,
} from "@shared/adminPermissions";
import { Suspense, useEffect } from "react";
import {
  createAdminLoginPath,
  readAdminLoginReturnPath,
} from "./lib/adminRoutes";

function RouteFallback() {
  return <DashboardLayoutSkeleton />;
}

function LazyScreen({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

/**
 * 认证门卫：未登录访问受保护页面时重定向到独立 /login 路由，
 * 同时保留原目标地址；业务页面不会在未认证状态下挂载或预加载。
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (loading || user) return;
    const search = typeof window === "undefined" ? "" : window.location.search;
    setLocation(createAdminLoginPath(location, search), { replace: true });
  }, [loading, location, setLocation, user]);

  if (loading) return <RouteFallback />;
  if (!user) return <RouteFallback />;
  return <>{children}</>;
}

function LoginRoute() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const returnPath = readAdminLoginReturnPath(
    typeof window === "undefined" ? "" : window.location.search
  );

  useEffect(() => {
    if (!loading && user) {
      setLocation(returnPath, { replace: true });
    }
  }, [loading, returnPath, setLocation, user]);

  if (loading || user) return <RouteFallback />;
  return (
    <LazyScreen>
      <LazyLogin />
    </LazyScreen>
  );
}

function PermissionGate({
  permission,
  children,
}: {
  permission: AdminPermission;
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const role = (user?.adminRole ?? "super_admin") as AdminRole;
  const permissions = (user as { permissions?: string[] } | null)?.permissions;
  if (hasAdminPermission(role, permission, permissions)) return <>{children}</>;

  return (
    <LazyScreen>
      <LazyForbidden />
    </LazyScreen>
  );
}

const MaterialsRoute = () => (
  <PermissionGate permission="materials.read">
    <LazyScreen>
      <LazyMaterials />
    </LazyScreen>
  </PermissionGate>
);
const MerchantsRoute = () => (
  <PermissionGate permission="merchants.read">
    <LazyScreen>
      <LazyMerchants />
    </LazyScreen>
  </PermissionGate>
);
const MerchantDetailRoute = () => (
  <PermissionGate permission="merchants.read">
    <LazyScreen>
      <LazyMerchantDetail />
    </LazyScreen>
  </PermissionGate>
);
const MessagesRoute = () => (
  <PermissionGate permission="messages.read">
    <LazyScreen>
      <LazyMessages />
    </LazyScreen>
  </PermissionGate>
);
const PortalUsersRoute = () => (
  <PermissionGate permission="portalUsers.read">
    <LazyScreen>
      <LazyPortalUsers />
    </LazyScreen>
  </PermissionGate>
);
const AdminsRoute = () => (
  <PermissionGate permission="admins.manage">
    <LazyScreen>
      <LazyAdmins />
    </LazyScreen>
  </PermissionGate>
);
const OrdersRoute = () => (
  <PermissionGate permission="orders.read">
    <LazyScreen>
      <LazyOrders />
    </LazyScreen>
  </PermissionGate>
);
const ProfileRoute = () => (
  <PermissionGate permission="profile.manage">
    <LazyScreen>
      <LazyProfile />
    </LazyScreen>
  </PermissionGate>
);
const ExceptionLogsRoute = () => (
  <PermissionGate permission="logs.read">
    <LazyScreen>
      <LazyExceptionLogs />
    </LazyScreen>
  </PermissionGate>
);
const ReviewsRoute = () => (
  <PermissionGate permission="logs.read">
    <LazyScreen>
      <LazyReviews />
    </LazyScreen>
  </PermissionGate>
);
const AnalyticsRoute = () => (
  <PermissionGate permission="analytics.read">
    <LazyScreen>
      <LazyAnalytics />
    </LazyScreen>
  </PermissionGate>
);
const NotFoundRoute = () => (
  <LazyScreen>
    <LazyNotFound />
  </LazyScreen>
);

/** 部署 base 路径（如 /admin），本地开发为空字符串 */
const ROUTER_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function AppRoutes() {
  const [location] = useLocation();
  if (location.split("?")[0] === "/login") return <LoginRoute />;

  return (
    <AuthGate>
      <Switch>
        <Route path={"/"} component={MaterialsRoute} />
        <Route path={"/merchants"} component={MerchantsRoute} />
        <Route path={"/merchants/:id"} component={MerchantDetailRoute} />
        <Route path={"/messages"} component={MessagesRoute} />
        <Route path={"/portal-users"} component={PortalUsersRoute} />
        <Route path={"/orders"} component={OrdersRoute} />
        <Route path={"/orders/:id"} component={OrdersRoute} />
        <Route path={"/admins"} component={AdminsRoute} />
        <Route path={"/reviews"} component={ReviewsRoute} />
        <Route path={"/exception-logs"} component={ExceptionLogsRoute} />
        <Route path={"/analytics"} component={AnalyticsRoute} />
        <Route path={"/profile"} component={ProfileRoute} />
        <Route path={"/404"} component={NotFoundRoute} />
        <Route component={NotFoundRoute} />
      </Switch>
    </AuthGate>
  );
}

function Router() {
  return (
    <WouterRouter base={ROUTER_BASE}>
      <AppRoutes />
    </WouterRouter>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
