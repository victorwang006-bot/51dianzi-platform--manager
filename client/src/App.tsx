import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Router as WouterRouter, Switch, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { DashboardLayoutSkeleton } from "./components/DashboardLayoutSkeleton";
import DashboardLayout from "./components/DashboardLayout";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Admins from "./pages/Admins";
import Login from "./pages/Login";
import Materials from "./pages/Materials";
import MerchantDetail from "./pages/MerchantDetail";
import Merchants from "./pages/Merchants";
import Messages from "./pages/Messages";
import Orders from "./pages/Orders";
import { ShieldAlert } from "lucide-react";
import {
  hasAdminPermission,
  type AdminPermission,
  type AdminRole,
} from "@shared/adminPermissions";
import { useEffect } from "react";
import {
  createAdminLoginPath,
  readAdminLoginReturnPath,
} from "./lib/adminRoutes";

/**
 * 认证门卫：未登录访问受保护页面时重定向到独立 /login 路由，
 * 同时保留原目标地址；业务页面不会在未认证状态下挂载。
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (loading || user) return;
    const search = typeof window === "undefined" ? "" : window.location.search;
    setLocation(createAdminLoginPath(location, search), { replace: true });
  }, [loading, location, setLocation, user]);

  if (loading) return <DashboardLayoutSkeleton />;
  if (!user) return <DashboardLayoutSkeleton />;
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

  if (loading || user) return <DashboardLayoutSkeleton />;
  return <Login />;
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
  if (hasAdminPermission(role, permission)) return <>{children}</>;

  return (
    <DashboardLayout>
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="max-w-md text-center">
          <ShieldAlert className="mx-auto h-12 w-12 text-amber-500" />
          <h1 className="mt-4 text-xl font-semibold">暂无访问权限</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            当前后台角色没有访问此模块的权限，请从侧边栏选择已授权模块，或联系超级管理员调整角色。
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}

const MaterialsRoute = () => (
  <PermissionGate permission="materials.read"><Materials /></PermissionGate>
);
const MerchantsRoute = () => (
  <PermissionGate permission="merchants.read"><Merchants /></PermissionGate>
);
const MerchantDetailRoute = () => (
  <PermissionGate permission="merchants.read"><MerchantDetail /></PermissionGate>
);
const MessagesRoute = () => (
  <PermissionGate permission="messages.read"><Messages /></PermissionGate>
);
const AdminsRoute = () => (
  <PermissionGate permission="admins.manage"><Admins /></PermissionGate>
);
const OrdersRoute = () => (
  <PermissionGate permission="orders.read"><Orders /></PermissionGate>
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
        <Route path={"/orders"} component={OrdersRoute} />
        <Route path={"/orders/:id"} component={OrdersRoute} />
        <Route path={"/admins"} component={AdminsRoute} />
        <Route path={"/404"} component={NotFound} />
        <Route component={NotFound} />
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
