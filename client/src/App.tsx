import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Router as WouterRouter, Switch } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { DashboardLayoutSkeleton } from "./components/DashboardLayoutSkeleton";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Admins from "./pages/Admins";
import Login from "./pages/Login";
import Materials from "./pages/Materials";
import MerchantDetail from "./pages/MerchantDetail";
import Merchants from "./pages/Merchants";
import Messages from "./pages/Messages";

/**
 * 认证门卫：未登录时直接渲染登录页，业务页面组件不挂载，
 * 从源头避免未登录状态触发受保护查询产生 "Please login (10001)" 报错。
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <DashboardLayoutSkeleton />;
  if (!user) return <Login />;
  return <>{children}</>;
}

/** 部署 base 路径（如 /admin），本地开发为空字符串 */
const ROUTER_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function Router() {
  return (
    <WouterRouter base={ROUTER_BASE}>
      <AuthGate>
        <Switch>
          <Route path={"/"} component={Materials} />
          <Route path={"/merchants"} component={Merchants} />
          <Route path={"/merchants/:id"} component={MerchantDetail} />
          <Route path={"/messages"} component={Messages} />
          <Route path={"/admins"} component={Admins} />
          <Route path={"/404"} component={NotFound} />
          {/* Final fallback route */}
          <Route component={NotFound} />
        </Switch>
      </AuthGate>
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
