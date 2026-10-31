import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { Route, Router, Switch, useLocation, useSearch } from "wouter";
import { trpc as adminTrpc } from "../lib/trpc";
import DashboardLayout from "../components/DashboardLayout";
import BusinessUserRecordsPage from "./BusinessUserRecordsPage";
import BusinessContentFrame from "./BusinessContentFrame";
import {
  BusinessScopeProvider,
  useBusinessScope,
  type BusinessSessionCapabilities,
  type BusinessStaffPrincipal,
  type ReadyBusinessStaffPrincipal,
} from "./BusinessScope";
import {
  businessScopeTrpc,
  createBusinessScopeTrpcClient,
  createBusinessTrpcClient,
  trpc,
} from "./api/business-trpc";
import {
  businessNavigationHrefs,
  useBusinessLocation,
} from "./api/business-wouter";
import {
  BUSINESS_CHAT_PERSONAL_FLOW_MESSAGES,
} from "./BusinessChatContract";
import {
  BusinessWorkbenchAccessProvider,
  BusinessWorkbenchRouteGate,
  businessContextMatchesMerchant,
} from "./BusinessWorkbenchAccessGate";
import type { BusinessWorkbenchCapability } from "../lib/businessWorkbenchCapabilities";
import AddUser from "./platform/client/src/pages/AddUser";
import ChatPage from "./platform/client/src/pages/ChatPage";
import ChannelInventoryHost from "./platform/client/src/pages/ChannelInventoryHost";
import CompanyInfo from "./platform/client/src/pages/CompanyInfo";
import CrmSalesOrders from "./platform/client/src/pages/CrmSalesOrders";
import CustomerCreate from "./platform/client/src/pages/CustomerCreate";
import CustomerDemands from "./platform/client/src/pages/CustomerDemands";
import CustomerDetail from "./platform/client/src/pages/CustomerDetail";
import CustomerList from "./platform/client/src/pages/CustomerList";
import DemandQuotes from "./platform/client/src/pages/DemandQuotes";
import EditInventory from "./platform/client/src/pages/EditInventory";
import EnterpriseInquiryInbox from "./platform/client/src/pages/EnterpriseInquiryInbox";
import InboundManagement from "./platform/client/src/pages/InboundManagement";
import MyInventory from "./platform/client/src/pages/MyInventory";
import OutboundManagement from "./platform/client/src/pages/OutboundManagement";
import ProcurementDemands from "./platform/client/src/pages/ProcurementDemands";
import ProcurementOrders from "./platform/client/src/pages/ProcurementOrders";
import PublishInventory from "./platform/client/src/pages/PublishInventory";

export type BusinessWorkbenchPageProps = {
  /** Optional host-supplied official merchant ID. It cannot select another workspace. */
  merchantId?: number;
  /** Parent route base, normally /workbench. */
  routeBase?: string;
};

const OFFICIAL_ZHIJIE_MERCHANT_ID = 30061;

type MerchantChoice = {
  id: number;
  merchantNo: string;
  companyName: string;
  crmStatus: string;
  registrationRegion: string;
  canWrite: boolean;
};

type BusinessContextContract = {
  /** Returned for the exact header-selected merchant, never a navigation union. */
  merchant?: { id?: unknown; canWrite?: unknown };
  staffPrincipal: BusinessStaffPrincipal;
  /** BFF capability contract; absent/false means the feature is not integrated. */
  sessionCapabilities?: BusinessSessionCapabilities;
  capabilities?: BusinessSessionCapabilities;
  /** Current merchant's BFF read projection of real front capabilities. */
  workbenchCapabilities?: unknown;
  /** Current merchant's BFF scope-write + real-front-capability intersection. */
  writeCapabilities?: unknown;
};

function workbenchBase(routeBase?: string): string {
  const fallback = "/workbench";
  if (!routeBase) return fallback;
  const normalized = routeBase.trim().replace(/\/+$/, "") || "/";
  return normalized.startsWith("/") && !/[?#\\\s]/.test(normalized) ? normalized : fallback;
}

function numberFromMerchantInput(value: unknown): number | null {
  const candidate = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : null;
}

function queryMerchantId(search: string): number | null {
  const merchantIds = new URLSearchParams(search).getAll("merchantId");
  return merchantIds.length === 1 ? numberFromMerchantInput(merchantIds[0]) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Runtime validation preserves the boundary if a partially deployed BFF returns stale JSON. */
function readyStaffPrincipal(value: unknown): ReadyBusinessStaffPrincipal | null {
  if (!isRecord(value) || value.status !== "ready") return null;
  const frontendUserId = numberFromMerchantInput(value.frontendUserId);
  const adminAccountId = numberFromMerchantInput(value.adminAccountId);
  const enterpriseId = numberFromMerchantInput(value.enterpriseId);
  if (!frontendUserId || !adminAccountId || !enterpriseId || !isRecord(value.user)) return null;
  const userId = numberFromMerchantInput(value.user.id);
  // The BFF must prove its principal and returned PublicAuthUser are the same actor.
  if (userId !== frontendUserId) return null;
  return value as unknown as ReadyBusinessStaffPrincipal;
}

function contextCapabilities(value: unknown): BusinessSessionCapabilities {
  if (!isRecord(value)) return {};
  const raw = isRecord(value.sessionCapabilities)
    ? value.sessionCapabilities
    : isRecord(value.capabilities)
      ? value.capabilities
      : {};
  return Object.fromEntries(Object.entries(raw).filter(([, enabled]) => typeof enabled === "boolean")) as BusinessSessionCapabilities;
}

function AccessState({ title, detail }: { title: string; detail: string }) {
  return (
    <section className="m-5 max-w-3xl rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950" role="status">
      <h1 className="text-base font-semibold">{title}</h1>
      <p className="mt-2 leading-6">{detail}</p>
    </section>
  );
}

function BusinessChannelInventoryRoute() {
  return (
    <BusinessContentFrame>
      <ChannelInventoryHost />
    </BusinessContentFrame>
  );
}

function UnmatchedBusinessPath() {
  return (
    <AccessState
      title="未识别的业务工作台路径"
      detail="该路径没有对应的已迁入前台业务页面；系统不会将未知路径静默回退到库存页。"
    />
  );
}

function BusinessChatRoute() {
  const { sessionCapabilities } = useBusinessScope();
  if (sessionCapabilities.receptionReady !== true) {
    return (
      <AccessState
        title="企业接待尚未完成安全就绪"
        detail="只有当前企业重新核验真实绑定的前台员工已具备企业接待权限后，才会打开企业接待；系统不会启用个人聊天能力或改用后台账号、其他数据负责人。"
      />
    );
  }
  return (
    <ChatPage
      businessReception={{
        requiredPermission: "inquiry.receive",
        personalFlowMessages: BUSINESS_CHAT_PERSONAL_FLOW_MESSAGES,
      }}
    />
  );
}

/** The admin workbench is the explicitly selected full business mode. */
function BusinessOutboundRoute() {
  return <OutboundManagement readOnly={false} />;
}

type BusinessRouteRequirement = {
  capability: BusinessWorkbenchCapability;
  requiresWrite?: boolean;
};

/**
 * This maps only UI availability. The BFF method dispatcher and the original
 * front procedure remain the actual authorization checks. In particular,
 * marketplace seller flow never borrows CRM sales-order capability.
 */
function businessRouteRequirement(location: string): BusinessRouteRequirement | null {
  const pathname = location.split(/[?#]/, 1)[0] || "/";
  if (pathname === "/" || pathname === "/inventory") return { capability: "inventory.read" };
  if (pathname === "/publish" || /^\/publish\/[^/]+\/edit$/.test(pathname)) {
    return { capability: "inventory.publish", requiresWrite: true };
  }
  if (pathname === "/inbound") return { capability: "inventory.inbound", requiresWrite: true };
  if (pathname === "/channel-inventory") return { capability: "inventory.channel" };
  if (pathname === "/customers/new" || pathname.startsWith("/customers/new/")) {
    return { capability: "customers.manage", requiresWrite: true };
  }
  if (pathname === "/customers") return { capability: "customers.manage" };
  if (pathname.startsWith("/customers/")) return { capability: "customers.manage", requiresWrite: true };
  if (pathname === "/customer-demands") return { capability: "customers.manage" };
  if (pathname === "/orders" || pathname === "/sales-orders") return { capability: "crm.sales_orders" };
  if (pathname === "/outbound") return { capability: "marketplace.seller" };
  if (pathname === "/chat" || pathname === "/inquiries") return { capability: "inquiry.receive" };
  if (pathname === "/procurement-demands" || pathname === "/procurement/demands" || pathname === "/demand-quotes") {
    return { capability: "procurement.demands" };
  }
  if (pathname === "/procurement-orders/create") return { capability: "procurement.orders", requiresWrite: true };
  if (pathname.startsWith("/procurement-orders") || pathname === "/procurement/orders") {
    return { capability: "procurement.orders" };
  }
  if (pathname === "/add-user") return { capability: "enterprise.members.manage", requiresWrite: true };
  if (pathname === "/user-records") return { capability: "enterprise.members.manage" };
  if (pathname === "/company-info" || pathname === "/company") return { capability: "company.read" };
  return null;
}

function BusinessRoutes() {
  const [location] = useLocation();
  const requirement = businessRouteRequirement(location);
  const routes = (
    <Switch>
      <Route path="/" component={MyInventory} />
      <Route path="/inventory" component={MyInventory} />
      <Route path="/publish/:id/edit" component={EditInventory} />
      <Route path="/publish" component={PublishInventory} />
      <Route path="/inbound" component={InboundManagement} />
      <Route path="/channel-inventory" component={BusinessChannelInventoryRoute} />
      <Route path="/customers/new/:id" component={CustomerCreate} />
      <Route path="/customers/new" component={CustomerCreate} />
      <Route path="/customers/:id" component={CustomerDetail} />
      <Route path="/customers" component={CustomerList} />
      <Route path="/customer-demands" component={CustomerDemands} />
      <Route path="/orders" component={CrmSalesOrders} />
      <Route path="/sales-orders" component={CrmSalesOrders} />
      <Route path="/outbound" component={BusinessOutboundRoute} />
      <Route path="/chat" component={BusinessChatRoute} />
      <Route path="/procurement-demands" component={ProcurementDemands} />
      <Route path="/procurement/demands" component={ProcurementDemands} />
      <Route path="/procurement-orders/quote" component={ProcurementOrders} />
      <Route path="/procurement-orders/accepted" component={ProcurementOrders} />
      <Route path="/procurement-orders/create" component={ProcurementOrders} />
      <Route path="/procurement-orders" component={ProcurementOrders} />
      <Route path="/procurement/orders" component={ProcurementOrders} />
      <Route path="/demand-quotes" component={DemandQuotes} />
      <Route path="/add-user" component={AddUser} />
      <Route path="/user-records" component={BusinessUserRecordsPage} />
      <Route path="/company-info" component={CompanyInfo} />
      <Route path="/company" component={CompanyInfo} />
      <Route path="/inquiries" component={EnterpriseInquiryInbox} />
      <Route component={UnmatchedBusinessPath} />
    </Switch>
  );
  return requirement ? (
    <BusinessWorkbenchRouteGate capability={requirement.capability} requiresWrite={requirement.requiresWrite}>
      {routes}
    </BusinessWorkbenchRouteGate>
  ) : routes;
}

function BusinessContextGate({
  merchantId,
  routeBase,
  queryClient,
  domainClient,
}: {
  merchantId: number;
  routeBase: string;
  queryClient: QueryClient;
  domainClient: ReturnType<typeof createBusinessTrpcClient>;
}) {
  const contextQuery = businessScopeTrpc.context.useQuery(undefined, { retry: false });
  const rawContext = contextQuery.data as BusinessContextContract | undefined;
  const principal = readyStaffPrincipal(rawContext?.staffPrincipal);
  const capabilities = contextCapabilities(rawContext);
  const contextMerchant = rawContext?.merchant;

  if (contextQuery.isLoading) {
    return <AccessState title="正在核验业务主体绑定" detail="在确认商户、企业和工作人员绑定前，系统不会进入业务页面。" />;
  }
  if (contextQuery.isError) {
    return <AccessState title="业务上下文不可用" detail={contextQuery.error.message || "当前商户和工作人员会话未能通过核验。"} />;
  }
  if (!principal) {
    return <AccessState title="未绑定前台业务主体" detail="当前后台工作人员尚未获得与该商户匹配的真实前台员工身份；系统不会改用后台账号、企业负责人或伪造角色。" />;
  }
  if (!businessContextMatchesMerchant(merchantId, contextMerchant)) {
    return <AccessState title="业务上下文与当前商户不一致" detail="系统拒绝使用其他商户的权限信息；请重新打开智捷工作区，以重新核验当前绑定和访问范围。" />;
  }

  return (
    <trpc.Provider client={domainClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <BusinessScopeProvider merchantId={merchantId} staffPrincipal={principal} sessionCapabilities={capabilities}>
          <BusinessWorkbenchAccessProvider
            merchantId={merchantId}
            merchantCanWrite={contextMerchant?.canWrite === true}
            workbenchCapabilities={rawContext?.workbenchCapabilities}
            writeCapabilities={rawContext?.writeCapabilities}
          >
            <Router base={routeBase} hook={useBusinessLocation} hrefs={businessNavigationHrefs}>
              <BusinessRoutes />
            </Router>
          </BusinessWorkbenchAccessProvider>
        </BusinessScopeProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

function ScopedBusinessWorkbench({ merchantId, routeBase }: { merchantId: number; routeBase: string }) {
  const queryClient = useMemo(() => new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  }), [merchantId]);
  const domainClient = useMemo(() => createBusinessTrpcClient(merchantId), [merchantId]);
  const contextClient = useMemo(() => createBusinessScopeTrpcClient(merchantId), [merchantId]);

  useEffect(() => () => queryClient.clear(), [queryClient]);

  return (
    <businessScopeTrpc.Provider client={contextClient} queryClient={queryClient}>
      <BusinessContextGate merchantId={merchantId} routeBase={routeBase} queryClient={queryClient} domainClient={domainClient} />
    </businessScopeTrpc.Provider>
  );
}

/** Native same-DOM workbench for the one approved internal official merchant. */
function BusinessWorkbenchContent({ merchantId, routeBase }: BusinessWorkbenchPageProps) {
  const search = useSearch();
  const merchantList = adminTrpc.business.merchants.useQuery({ page: 1, pageSize: 100 }, { retry: false });
  const hasQueryMerchantId = new URLSearchParams(search).has("merchantId");
  const hasExplicitMerchant = merchantId !== undefined || hasQueryMerchantId;
  const requestedId = merchantId === undefined ? queryMerchantId(search) : numberFromMerchantInput(merchantId);
  const merchants: MerchantChoice[] = merchantList.data?.data ?? [];
  const officialMerchant = merchants.find(merchant => merchant.id === OFFICIAL_ZHIJIE_MERCHANT_ID) ?? null;
  const base = workbenchBase(routeBase);

  if (merchantList.isLoading) {
    return <AccessState title="正在加载授权商户" detail="在读取后台业务可见范围前，不会请求任何前台领域接口。" />;
  }
  if (merchantList.isError) {
    return <AccessState title="无法读取授权商户" detail={merchantList.error.message || "请确认当前后台会话已获得业务上下文权限。"} />;
  }
  if (hasExplicitMerchant && requestedId !== OFFICIAL_ZHIJIE_MERCHANT_ID) {
    return <AccessState title="请求的业务商户不可用" detail="后台业务工作区仅限智捷官方商户；指定的其他商户不能在此工作区中打开。" />;
  }
  if (!officialMerchant) {
    return <AccessState title="智捷官方工作区不可用" detail="智捷官方商户当前不可见、未完成业务绑定或已失去访问授权。系统不会改用负责人或其他商户。" />;
  }
  return <ScopedBusinessWorkbench merchantId={officialMerchant.id} routeBase={base} />;
}

export default function BusinessWorkbenchPage(props: BusinessWorkbenchPageProps) {
  return (
    <DashboardLayout>
      <BusinessWorkbenchContent {...props} />
    </DashboardLayout>
  );
}
