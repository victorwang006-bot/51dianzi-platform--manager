import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Admins from "./pages/Admins";
import Alerts from "./pages/Alerts";
import AuditLogs from "./pages/AuditLogs";
import Finance from "./pages/Finance";
import Home from "./pages/Home";
import MerchantDetail from "./pages/MerchantDetail";
import Merchants from "./pages/Merchants";
import Orders from "./pages/Orders";
import Products from "./pages/Products";
import Refunds from "./pages/Refunds";
import RiskControl from "./pages/RiskControl";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/merchants"} component={Merchants} />
      <Route path={"/merchants/:id"} component={MerchantDetail} />
      <Route path={"/products"} component={Products} />
      <Route path={"/orders"} component={Orders} />
      <Route path={"/refunds"} component={Refunds} />
      <Route path={"/finance"} component={Finance} />
      <Route path={"/risk"} component={RiskControl} />
      <Route path={"/alerts"} component={Alerts} />
      <Route path={"/audit"} component={AuditLogs} />
      <Route path={"/admins"} component={Admins} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
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
