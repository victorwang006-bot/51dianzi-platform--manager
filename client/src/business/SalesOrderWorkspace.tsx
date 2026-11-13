import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useBusinessScope } from "./BusinessScope";
import { BusinessWorkbenchRouteGate, useBusinessWorkbenchAccess } from "./BusinessWorkbenchAccessGate";
import CrmSalesOrders from "./platform/client/src/pages/CrmSalesOrders";
import OutboundManagement from "./platform/client/src/pages/OutboundManagement";
import {
  SALES_ORDER_SOURCES,
  readRememberedSalesOrderSource,
  rememberSalesOrderSource,
  resolveSalesOrderSource,
  salesOrderSourceTarget,
} from "../lib/salesOrderWorkspace";

/** This workspace must remain inside the original verified BFF providers. */
export default function SalesOrderWorkspace() {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const { contextVerification } = useBusinessScope();
  const access = useBusinessWorkbenchAccess();
  const identity = contextVerification.identity;
  const hash = typeof window === "undefined" ? "" : window.location.hash;
  const current = `${location.split(/[?#]/, 1)[0]}${search ? `?${search}` : ""}${hash}`;
  const sources = {
    mall: access.readCapabilities.includes("marketplace.seller"),
    business: access.readCapabilities.includes("crm.sales_orders"),
  };
  const selection = resolveSalesOrderSource(current, sources, readRememberedSalesOrderSource(identity));
  const source = selection.source;

  useEffect(() => {
    if (!source || !selection.allowed) return;
    rememberSalesOrderSource(identity, source);
    // Make the selected source explicit so history, breadcrumbs and later
    // permission revocations cannot silently reinterpret an existing page.
    if (!selection.explicit) {
      // The original CRM child may already have consumed demandNo/keyword in
      // its effect. Never restore that stale query over its explicit business URL.
      if (typeof window !== "undefined" && window.location.search.replace(/^\?/, "") !== search.replace(/^\?/, "")) return;
      navigate(salesOrderSourceTarget(current, source, location.split(/[?#]/, 1)[0]), { replace: true });
    }
  }, [identity, source, selection.allowed, selection.explicit, current, location, navigate, search]);

  return (
    <section data-sales-order-workspace="" data-order-source={source ?? "invalid"}>
      <nav className="admin-workspace-nav__tabs admin-workspace-nav__tabs--modules" aria-label="销售订单来源">
        {SALES_ORDER_SOURCES.filter(entry => sources[entry.value]).map(entry => (
          <button key={entry.value} type="button" className="admin-workspace-nav__tab admin-workspace-nav__module"
            data-order-source-tab={entry.value} data-active={source === entry.value ? "true" : "false"}
            aria-current={source === entry.value ? "page" : undefined}
            onClick={() => navigate(salesOrderSourceTarget(current, entry.value))}>
            {entry.label}
          </button>
        ))}
      </nav>
      {source ? (
        <BusinessWorkbenchRouteGate capability={source === "mall" ? "marketplace.seller" : "crm.sales_orders"}>
          {source === "mall" ? <OutboundManagement readOnly={false} /> : <CrmSalesOrders />}
        </BusinessWorkbenchRouteGate>
      ) : (
        <section className="m-5 rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950" role="status">
          {selection.explicit ? "未识别的销售订单来源；系统不会改用其他来源权限。" : "当前商户未获销售订单访问范围。"}
        </section>
      )}
    </section>
  );
}

function OutboundRedirect() {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const hash = typeof window === "undefined" ? "" : window.location.hash;
  const current = `${location}${search ? `?${search}` : ""}${hash}`;
  useEffect(() => {
    navigate(salesOrderSourceTarget(current, "mall"), { replace: true });
  }, [current, navigate]);
  return <section className="m-5 text-sm text-muted-foreground" role="status">正在打开商城订单…</section>;
}

/** The old URL remains seller-authorized; redirect never consumes a CRM grant. */
export function LegacyOutboundRoute() {
  return <BusinessWorkbenchRouteGate capability="marketplace.seller"><OutboundRedirect /></BusinessWorkbenchRouteGate>;
}
