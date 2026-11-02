import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { Route, Router, Switch, useLocation, useSearch } from "wouter";
import DashboardLayout from "../components/DashboardLayout";
import BusinessUserRecordsPage from "./BusinessUserRecordsPage";
import BusinessContentFrame from "./BusinessContentFrame";
import {
  BusinessScopeProvider,
  CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT,
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
import { BUSINESS_CHAT_PERSONAL_FLOW_MESSAGES } from "./BusinessChatContract";
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

// Session UI provenance only. Keeping the signature across ordinary route
// unmounts lets a later verified return invalidate changed permissions safely.
let lastCompletedBusinessAuthorization: string | null = null;
export function __resetBusinessAuthorizationMemoryForTests() {
  lastCompletedBusinessAuthorization = null;
}

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

type VerifiedBusinessContext = {
  domainScope: string;
  /** Replaces the UI branch when customer-entry permission changes for this identity. */
  verifiedBranchKey: string;
  principal: ReadyBusinessStaffPrincipal;
  capabilities: BusinessSessionCapabilities;
  rawContext: BusinessContextContract;
};

function workbenchBase(routeBase?: string): string {
  const fallback = "/workbench";
  if (!routeBase) return fallback;
  const normalized = routeBase.trim().replace(/\/+$/, "") || "/";
  return normalized.startsWith("/") && !/[?#\\\s]/.test(normalized)
    ? normalized
    : fallback;
}

function numberFromMerchantInput(value: unknown): number | null {
  const candidate = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : null;
}

function queryMerchantId(search: string): number | null {
  const merchantIds = new URLSearchParams(search).getAll("merchantId");
  return merchantIds.length === 1
    ? numberFromMerchantInput(merchantIds[0])
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Runtime validation preserves the boundary if a partially deployed BFF returns stale JSON. */
function readyStaffPrincipal(
  value: unknown
): ReadyBusinessStaffPrincipal | null {
  if (!isRecord(value) || value.status !== "ready") return null;
  const frontendUserId = numberFromMerchantInput(value.frontendUserId);
  const adminAccountId = numberFromMerchantInput(value.adminAccountId);
  const enterpriseId = numberFromMerchantInput(value.enterpriseId);
  const bindingVersion = numberFromMerchantInput(value.bindingVersion);
  if (
    !frontendUserId ||
    !adminAccountId ||
    !enterpriseId ||
    !bindingVersion ||
    !isRecord(value.user)
  )
    return null;
  const userId = numberFromMerchantInput(value.user.id);
  // The BFF must prove its principal and returned PublicAuthUser are the same actor.
  if (userId !== frontendUserId) return null;
  return {
    ...value,
    frontendUserId,
    adminAccountId,
    enterpriseId,
    bindingVersion,
  } as unknown as ReadyBusinessStaffPrincipal;
}

function contextCapabilities(value: unknown): BusinessSessionCapabilities {
  if (!isRecord(value)) return {};
  const raw = isRecord(value.sessionCapabilities)
    ? value.sessionCapabilities
    : isRecord(value.capabilities)
      ? value.capabilities
      : {};
  return Object.fromEntries(
    Object.entries(raw).filter(([, enabled]) => typeof enabled === "boolean")
  ) as BusinessSessionCapabilities;
}

/**
 * A domain QueryClient is never shared between a different bound actor, admin
 * session, enterprise or binding revision. The BFF remains authoritative, but
 * this prevents a previously verified customer response from being rendered
 * while a newly selected/revoked binding is being checked.
 */
function businessDomainScope(
  merchantId: number,
  principal: ReadyBusinessStaffPrincipal
): string {
  const bindingVersion = numberFromMerchantInput(principal.bindingVersion);
  if (!bindingVersion) throw new Error("BUSINESS_BINDING_VERSION_REQUIRED");
  return `business-domain:v1:staff:${principal.frontendUserId}:admin:${principal.adminAccountId}:enterprise:${principal.enterpriseId}:merchant:${merchantId}:binding:${bindingVersion}`;
}

function hasExactCapability(value: unknown, capability: string): boolean {
  return Array.isArray(value) && value.some(item => item === capability);
}

/**
 * Only the BFF fields that govern customer-entry availability participate in
 * this key. Stable primitive bits avoid treating a response object recreation
 * as an identity/permission change, while an actual write/read revocation
 * remounts this branch and invalidates the old customer-entry draft.
 */
function customerEntryPermissionFingerprint(
  rawContext: BusinessContextContract
): string {
  const merchantCanWrite = rawContext.merchant?.canWrite === true;
  const customerReadable = hasExactCapability(
    rawContext.workbenchCapabilities,
    "customers.manage"
  );
  const customerWritable =
    merchantCanWrite &&
    hasExactCapability(rawContext.writeCapabilities, "customers.manage");
  return `customer-entry-permissions:v1:merchant-write:${Number(merchantCanWrite)}:read:${Number(customerReadable)}:write:${Number(customerWritable)}`;
}

/**
 * A response is usable only after all of its identity dimensions and its
 * selected-merchant proof agree. `domainScope` is the public, UI-only identity
 * marker for imported front pages; it is never an authorization substitute.
 */
function verifiedBusinessContext(
  merchantId: number,
  rawContext: BusinessContextContract | undefined
): VerifiedBusinessContext | null {
  const principal = readyStaffPrincipal(rawContext?.staffPrincipal);
  if (
    !rawContext ||
    !principal ||
    !businessContextMatchesMerchant(merchantId, rawContext.merchant)
  ) {
    return null;
  }
  return {
    domainScope: businessDomainScope(merchantId, principal),
    verifiedBranchKey: `${businessDomainScope(merchantId, principal)}:${customerEntryPermissionFingerprint(rawContext)}`,
    principal,
    capabilities: contextCapabilities(rawContext),
    rawContext,
  };
}

function AccessState({
  title,
  detail,
  onRetry,
  retrying = false,
  retryTestId = "business-context-retry",
}: {
  title: string;
  detail: string;
  onRetry?: () => void;
  retrying?: boolean;
  retryTestId?: string;
}) {
  return (
    <section
      className="m-5 max-w-3xl rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950"
      role="status"
    >
      <h1 className="text-base font-semibold">{title}</h1>
      <p className="mt-2 leading-6">{detail}</p>
      {onRetry ? (
        <button
          type="button"
          className="mt-3 rounded border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={retrying}
          onClick={onRetry}
          data-business-retry={retryTestId}
          data-business-context-retry={
            retryTestId === "business-context-retry" ? "" : undefined
          }
        >
          {retrying ? "重新核验中…" : "重新核验"}
        </button>
      ) : null}
    </section>
  );
}

/** A normal authorization read is not a permission failure. Keep it neutral. */
function BusinessLoadingState({
  label,
  testId,
}: {
  label: string;
  testId: string;
}) {
  return (
    <section
      className="m-5 flex max-w-3xl items-center gap-3 rounded-lg border border-border bg-muted/30 px-5 py-4 text-sm text-muted-foreground"
      aria-busy="true"
      aria-live="polite"
      data-business-loading={testId}
    >
      <span
        aria-hidden="true"
        className="h-4 w-4 shrink-0 animate-pulse rounded-full bg-muted-foreground/30"
      />
      <span>{label}</span>
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
function businessRouteRequirement(
  location: string
): BusinessRouteRequirement | null {
  const pathname = location.split(/[?#]/, 1)[0] || "/";
  if (pathname === "/" || pathname === "/inventory")
    return { capability: "inventory.read" };
  if (pathname === "/publish" || /^\/publish\/[^/]+\/edit$/.test(pathname)) {
    return { capability: "inventory.publish", requiresWrite: true };
  }
  if (pathname === "/inbound")
    return { capability: "inventory.inbound", requiresWrite: true };
  if (pathname === "/channel-inventory")
    return { capability: "inventory.channel" };
  if (pathname === "/customers/new" || pathname.startsWith("/customers/new/")) {
    return { capability: "customers.manage", requiresWrite: true };
  }
  if (pathname === "/customers") return { capability: "customers.manage" };
  if (pathname.startsWith("/customers/"))
    return { capability: "customers.manage", requiresWrite: true };
  if (pathname === "/customer-demands")
    return { capability: "customers.manage" };
  if (pathname === "/orders" || pathname === "/sales-orders")
    return { capability: "crm.sales_orders" };
  if (pathname === "/outbound") return { capability: "marketplace.seller" };
  if (pathname === "/chat" || pathname === "/inquiries")
    return { capability: "inquiry.receive" };
  if (
    pathname === "/procurement-demands" ||
    pathname === "/procurement/demands" ||
    pathname === "/demand-quotes"
  ) {
    return { capability: "procurement.demands" };
  }
  if (pathname === "/procurement-orders/create")
    return { capability: "procurement.orders", requiresWrite: true };
  if (
    pathname.startsWith("/procurement-orders") ||
    pathname === "/procurement/orders"
  ) {
    return { capability: "procurement.orders" };
  }
  if (pathname === "/add-user")
    return { capability: "enterprise.members.manage", requiresWrite: true };
  if (pathname === "/user-records")
    return { capability: "enterprise.members.manage" };
  if (pathname === "/company-info" || pathname === "/company")
    return { capability: "company.read" };
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
      <Route
        path="/channel-inventory"
        component={BusinessChannelInventoryRoute}
      />
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
      <Route
        path="/procurement-orders/accepted"
        component={ProcurementOrders}
      />
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
    <BusinessWorkbenchRouteGate
      capability={requirement.capability}
      requiresWrite={requirement.requiresWrite}
    >
      {routes}
    </BusinessWorkbenchRouteGate>
  ) : (
    routes
  );
}

function useFocusContextRevalidation(revalidate: () => void) {
  const current = useRef(revalidate);
  current.current = revalidate;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onFocus = () => current.current();
    const onPageShow = (event: PageTransitionEvent) => {
      // A normal first-load pageshow follows the initial query. Only a bfcache
      // restore is a re-entry that could otherwise retain an old context.
      if (event.persisted) current.current();
    };
    // `pageshow` covers a restored workbench document; `focus` covers an
    // already mounted tab. Both transitions must not reuse an old UI gate.
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);
}

/**
 * Keep a previously verified same-identity tree mounted only while a new BFF
 * context request is in flight. `inert` blocks native focus/editing while the
 * capture handlers also cover synthetic/programmatic event dispatch. This is
 * intentionally a UI pause, not a replacement for BFF command authorization.
 */
export function BusinessContextVerificationBoundary({
  verificationState,
  identity,
  children,
}: {
  verificationState: "verified" | "revalidating";
  identity: string;
  children: ReactNode;
}) {
  const revalidating = verificationState === "revalidating";
  const stopWhileRevalidating = useCallback(
    (event: SyntheticEvent<HTMLElement>) => {
      if (!revalidating) return;
      event.preventDefault();
      event.stopPropagation();
    },
    [revalidating]
  );
  const captureProps = revalidating
    ? {
        onClickCapture: stopWhileRevalidating,
        onSubmitCapture: stopWhileRevalidating,
        onBeforeInputCapture: stopWhileRevalidating,
        onInputCapture: stopWhileRevalidating,
        onChangeCapture: stopWhileRevalidating,
        onKeyDownCapture: stopWhileRevalidating,
      }
    : {};

  return (
    <section
      aria-busy={revalidating || undefined}
      data-business-context-verification={verificationState}
      data-business-context-identity={identity}
    >
      {revalidating ? (
        <BusinessLoadingState
          label="正在重新核验业务主体绑定；已暂停编辑和提交。"
          testId="business-context-revalidation"
        />
      ) : null}
      <div
        {...captureProps}
        // Keep the live status outside this subtree so assistive technology can
        // announce the pause even though business controls are inert.
        inert={revalidating || undefined}
        className={revalidating ? "pointer-events-none select-none" : undefined}
        data-business-context-content=""
      >
        {children}
      </div>
    </section>
  );
}

function VerifiedBusinessWorkbench({
  merchantId,
  routeBase,
  principal,
  capabilities,
  rawContext,
  verificationState,
}: {
  merchantId: number;
  routeBase: string;
  principal: ReadyBusinessStaffPrincipal;
  capabilities: BusinessSessionCapabilities;
  rawContext: BusinessContextContract;
  verificationState: "verified" | "revalidating";
}) {
  const domainScope = businessDomainScope(merchantId, principal);
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
        },
      }),
    [domainScope]
  );
  const domainClient = useMemo(
    () => createBusinessTrpcClient(merchantId),
    [domainScope, merchantId]
  );

  useEffect(
    () => () => {
      // The logout route already unmounts this branch. Cancelling here gives the
      // same fail-closed behavior when a focus recheck or identity change removes
      // the branch before an original customer request settles.
      void queryClient.cancelQueries();
      queryClient.clear();
    },
    [queryClient]
  );

  return (
    <trpc.Provider
      client={domainClient}
      queryClient={queryClient}
      abortOnUnmount
    >
      <QueryClientProvider client={queryClient}>
        <BusinessScopeProvider
          merchantId={merchantId}
          staffPrincipal={principal}
          sessionCapabilities={capabilities}
          contextVerificationState={verificationState}
        >
          <BusinessContextVerificationBoundary
            verificationState={verificationState}
            identity={domainScope}
          >
            <BusinessWorkbenchAccessProvider
              merchantId={merchantId}
              merchantCanWrite={rawContext.merchant?.canWrite === true}
              workbenchCapabilities={rawContext.workbenchCapabilities}
              writeCapabilities={rawContext.writeCapabilities}
            >
              <Router
                base={routeBase}
                hook={useBusinessLocation}
                hrefs={businessNavigationHrefs}
              >
                <BusinessRoutes />
              </Router>
            </BusinessWorkbenchAccessProvider>
          </BusinessContextVerificationBoundary>
        </BusinessScopeProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

function BusinessContextGate({
  merchantId,
  routeBase,
}: {
  merchantId: number;
  routeBase: string;
}) {
  const contextQuery = businessScopeTrpc.context.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    trpc: { abortOnUnmount: true },
  });
  const rawContext = contextQuery.data as BusinessContextContract | undefined;
  const principal = readyStaffPrincipal(rawContext?.staffPrincipal);
  const contextMerchant = rawContext?.merchant;
  const currentVerifiedContext = verifiedBusinessContext(
    merchantId,
    rawContext
  );
  // React Query deliberately preserves the last successful `data` on a
  // refetch. Preserve it here only after a completed successful verification;
  // a cache value that never reached this gate has no rendering authority.
  const lastVerifiedContext = useRef<VerifiedBusinessContext | null>(null);
  const revalidate = useCallback(() => {
    void contextQuery.refetch({ cancelRefetch: true });
  }, [contextQuery.refetch]);
  useFocusContextRevalidation(revalidate);

  const completedAuthorization =
    currentVerifiedContext?.verifiedBranchKey ?? null;
  useLayoutEffect(() => {
    if (
      !contextQuery.isError &&
      (contextQuery.isLoading || contextQuery.isFetching)
    )
      return;
    const confirmed = contextQuery.isError ? null : completedAuthorization;
    if (
      !confirmed ||
      (lastCompletedBusinessAuthorization !== null &&
        lastCompletedBusinessAuthorization !== confirmed)
    ) {
      window.dispatchEvent(new Event(CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT));
    }
    lastCompletedBusinessAuthorization = confirmed;
  }, [
    completedAuthorization,
    contextQuery.isError,
    contextQuery.isFetching,
    contextQuery.isLoading,
  ]);

  // This ref update is derived only from a settled request, so it remains
  // idempotent under Strict Mode while allowing focus to arrive immediately
  // after the successful commit.
  if (!contextQuery.isFetching) {
    lastVerifiedContext.current =
      contextQuery.isError || !currentVerifiedContext
        ? null
        : currentVerifiedContext;
  }

  if (contextQuery.isLoading) {
    return (
      <BusinessLoadingState
        label="正在核验业务主体绑定…"
        testId="business-context"
      />
    );
  }
  if (contextQuery.isFetching) {
    const retainedContext = lastVerifiedContext.current;
    // Cached data can be present during an error/retry or before the first
    // verified commit. Render it only if it still proves the exact same bound
    // staff, admin account, enterprise, merchant and binding revision.
    if (
      !contextQuery.isError &&
      retainedContext &&
      currentVerifiedContext?.domainScope === retainedContext.domainScope
    ) {
      return (
        <VerifiedBusinessWorkbench
          key={retainedContext.verifiedBranchKey}
          merchantId={merchantId}
          routeBase={routeBase}
          principal={retainedContext.principal}
          capabilities={retainedContext.capabilities}
          rawContext={retainedContext.rawContext}
          verificationState="revalidating"
        />
      );
    }
    return (
      <BusinessLoadingState
        label="正在核验业务主体绑定…"
        testId="business-context"
      />
    );
  }
  if (contextQuery.isError) {
    return (
      <AccessState
        title="业务上下文不可用"
        detail={
          contextQuery.error.message || "当前商户和工作人员会话未能通过核验。"
        }
        retrying={contextQuery.isFetching}
        onRetry={revalidate}
      />
    );
  }
  if (!principal || !rawContext) {
    return (
      <AccessState
        title="未绑定前台业务主体"
        detail="当前后台工作人员尚未获得与该商户匹配的真实前台员工身份；系统不会改用后台账号、企业负责人或伪造角色。"
      />
    );
  }
  if (!businessContextMatchesMerchant(merchantId, contextMerchant)) {
    return (
      <AccessState
        title="业务上下文与当前商户不一致"
        detail="系统拒绝使用其他商户的权限信息；请重新打开智捷工作区，以重新核验当前绑定和访问范围。"
      />
    );
  }
  if (!currentVerifiedContext) {
    // `principal` and selected merchant checks above make this unreachable in
    // normal operation. Keep a fail-closed branch for malformed partial BFF
    // responses rather than reviving a cached business tree.
    return (
      <AccessState
        title="业务上下文不可用"
        detail="当前商户和工作人员会话未能通过核验。"
      />
    );
  }

  return (
    <VerifiedBusinessWorkbench
      key={currentVerifiedContext.verifiedBranchKey}
      merchantId={merchantId}
      routeBase={routeBase}
      principal={currentVerifiedContext.principal}
      capabilities={currentVerifiedContext.capabilities}
      rawContext={currentVerifiedContext.rawContext}
      verificationState="verified"
    />
  );
}

function ScopedBusinessWorkbench({
  merchantId,
  routeBase,
}: {
  merchantId: number;
  routeBase: string;
}) {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
        },
      }),
    [merchantId]
  );
  const contextClient = useMemo(
    () => createBusinessScopeTrpcClient(merchantId),
    [merchantId]
  );

  useEffect(
    () => () => {
      void queryClient.cancelQueries();
      queryClient.clear();
    },
    [queryClient]
  );

  return (
    <businessScopeTrpc.Provider
      client={contextClient}
      queryClient={queryClient}
    >
      <QueryClientProvider client={queryClient}>
        <BusinessContextGate merchantId={merchantId} routeBase={routeBase} />
      </QueryClientProvider>
    </businessScopeTrpc.Provider>
  );
}

function BusinessWorkbenchDiscovery({
  merchantId,
  routeBase,
}: BusinessWorkbenchPageProps) {
  const search = useSearch();
  // `merchants` is an explicitly mounted BusinessRouter procedure at
  // /api/business-trpc. This uses the same BFF-only, bounded transport as
  // `context`; it does not trust a URL value or pick a fallback merchant.
  const merchantList = businessScopeTrpc.merchants.useQuery(
    { page: 1, pageSize: 100 },
    {
      retry: false,
      refetchOnWindowFocus: false,
      trpc: { abortOnUnmount: true },
    }
  );
  const hasQueryMerchantId = new URLSearchParams(search).has("merchantId");
  const hasExplicitMerchant = merchantId !== undefined || hasQueryMerchantId;
  const requestedId =
    merchantId === undefined
      ? queryMerchantId(search)
      : numberFromMerchantInput(merchantId);
  const merchants: MerchantChoice[] = merchantList.data?.data ?? [];
  const officialMerchant =
    merchants.find(merchant => merchant.id === OFFICIAL_ZHIJIE_MERCHANT_ID) ??
    null;
  const base = workbenchBase(routeBase);
  const retryDiscovery = useCallback(() => {
    void merchantList.refetch({ cancelRefetch: true });
  }, [merchantList.refetch]);

  // A refetch can retain the previous list. As with context, it has no
  // rendering authority until its current BFF verification settles.
  if (merchantList.isLoading || merchantList.isFetching) {
    return (
      <BusinessLoadingState
        label="正在核验授权商户…"
        testId="business-discovery"
      />
    );
  }
  if (merchantList.isError) {
    return (
      <AccessState
        title="无法读取授权商户"
        detail={
          merchantList.error.message || "当前授权商户核验未完成，请重新核验。"
        }
        retrying={merchantList.isFetching}
        onRetry={retryDiscovery}
        retryTestId="business-discovery-retry"
      />
    );
  }
  if (hasExplicitMerchant && requestedId !== OFFICIAL_ZHIJIE_MERCHANT_ID) {
    return (
      <AccessState
        title="请求的业务商户不可用"
        detail="后台业务工作区仅限智捷官方商户；指定的其他商户不能在此工作区中打开。"
      />
    );
  }
  if (!officialMerchant) {
    return (
      <AccessState
        title="未取得可用授权"
        detail="当前未取得可用授权商户、业务绑定或访问范围；系统不会改用负责人、其他商户或默认商户。"
        retrying={merchantList.isFetching}
        onRetry={retryDiscovery}
        retryTestId="business-discovery-retry"
      />
    );
  }
  return (
    <ScopedBusinessWorkbench
      merchantId={officialMerchant.id}
      routeBase={base}
    />
  );
}

/** Native same-DOM workbench for the one approved internal official merchant. */
function BusinessWorkbenchContent({
  merchantId,
  routeBase,
}: BusinessWorkbenchPageProps) {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
        },
      }),
    []
  );
  const discoveryClient = useMemo(() => createBusinessScopeTrpcClient(), []);

  useEffect(
    () => () => {
      void queryClient.cancelQueries();
      queryClient.clear();
    },
    [queryClient]
  );

  return (
    <businessScopeTrpc.Provider
      client={discoveryClient}
      queryClient={queryClient}
    >
      <QueryClientProvider client={queryClient}>
        <BusinessWorkbenchDiscovery
          merchantId={merchantId}
          routeBase={routeBase}
        />
      </QueryClientProvider>
    </businessScopeTrpc.Provider>
  );
}

export default function BusinessWorkbenchPage(
  props: BusinessWorkbenchPageProps
) {
  return (
    <DashboardLayout>
      <BusinessWorkbenchContent {...props} />
    </DashboardLayout>
  );
}
