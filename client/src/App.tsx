import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Admins from "./pages/Admins";
import Materials from "./pages/Materials";
import MerchantDetail from "./pages/MerchantDetail";
import Merchants from "./pages/Merchants";
function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Materials} />
      <Route path={"/merchants"} component={Merchants} />
      <Route path={"/merchants/:id"} component={MerchantDetail} />
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
