import { QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { Route, Router, Switch, useLocation, useSearch } from "wouter";
import DashboardLayout from "../components/DashboardLayout";
import BusinessUserRecordsPage from "./BusinessUserRecordsPage";
import BusinessContentFrame from "./BusinessContentFrame";
import {
  BusinessScopeProvider,
  useBusinessScope,
  type BusinessOfficialInventoryPermissions,
  type BusinessSessionCapabilities,
  type BusinessStaffPrincipal,
  type ReadyBusinessStaffPrincipal,
} from "./BusinessScope";
import {
  businessScopeTrpc,
  createBusinessScopeTrpcClient,
  trpc,
} from "./api/business-trpc";
import {
  businessNavigationHrefs,
  useBusinessLocation,
} from "./api/business-wouter";
import {
  BusinessWorkbenchAccessProvider,
  BusinessWorkbenchRouteGate,
  businessContextMatchesMerchant,
} from "./BusinessWorkbenchAccessGate";
import type { BusinessWorkbenchCapability } from "../lib/businessWorkbenchCapabilities";
import {
  BUSINESS_CONTEXT_STALE_TIME,
  createBusinessRequestCancellation,
  isBusinessAuthorizationError,
  isBusinessSecurityError,
  resetBusinessWorkbenchSessionsForTests,
  retainBusinessQueryClient,
  useBusinessWorkbenchSession,
  type BusinessWorkbenchSession,
} from "./BusinessWorkbenchSession";
import AddUser from "./platform/client/src/pages/AddUser";
import { useInquiryReceptionUnread } from "./useInquiryReception";
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
  /** Internal observer shares the exact verified domain QueryClient with the page. */
  receptionObserver?: boolean;
};

const OFFICIAL_ZHIJIE_MERCHANT_ID = 30061;
const ReceptionObserverContext = createContext(false);

export function __resetBusinessAuthorizationMemoryForTests() {
  resetBusinessWorkbenchSessionsForTests();
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
  enterprise?: { id?: unknown };
  staffPrincipal: BusinessStaffPrincipal;
  /** BFF capability contract; absent/false means the feature is not integrated. */
  sessionCapabilities?: BusinessSessionCapabilities;
  capabilities?: BusinessSessionCapabilities;
  /** Current merchant's BFF read projection of real front capabilities. */
  workbenchCapabilities?: unknown;
  /** Current merchant's BFF scope-write + real-front-capability intersection. */
  writeCapabilities?: unknown;
  /** Server-derived native grants intersected with this real business scope. */
  officialInventoryPermissions?: unknown;
  /** Optional server-owned effective team/member/permission revision. */
  authorizationVersion?: unknown;
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

/** A partial deployment cannot grant access without a stable native-grant proof. */
function contextOfficialInventoryPermissions(value: BusinessContextContract): BusinessOfficialInventoryPermissions {
  const raw = value.officialInventoryPermissions;
  if (!isRecord(raw) || typeof raw.authorizationVersion !== "string" || !raw.authorizationVersion) {
    return { read: false, write: false, note: false, authorizationVersion: "" };
  }
  return {
    read: raw.read === true,
    write: raw.read === true && raw.write === true,
    note: raw.read === true && raw.note === true,
    publish: raw.read === true && raw.publish === true,
    authorizationVersion: raw.authorizationVersion,
  };
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
 * A capability projection is authorization state, not merely route metadata.
 * Canonicalize arrays so a reordered identical BFF response keeps the live
 * tree, while every effective read/write projection change gets a fresh
 * provider tree and QueryClient instead of rendering against prior scope data.
 */
function capabilityProjectionFingerprint(value: unknown): string {
  if (!Array.isArray(value)) return "[]";
  return JSON.stringify(
    Array.from(
      new Set(
        value.filter(
          (capability): capability is string => typeof capability === "string"
        )
      )
    ).sort()
  );
}

function businessAccessFingerprint(
  rawContext: BusinessContextContract
): string {
  const sessionCapabilities = Object.entries(contextCapabilities(rawContext))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([capability, enabled]) => `${capability}:${Number(enabled)}`)
    .join(",");
  const user =
    rawContext.staffPrincipal.status === "ready"
      ? rawContext.staffPrincipal.user
      : null;
  const actorAccess = JSON.stringify([
    user?.role,
    user?.loginDisabled,
    user?.crmAccess,
    typeof rawContext.authorizationVersion === "string" ||
    typeof rawContext.authorizationVersion === "number"
      ? rawContext.authorizationVersion
      : null,
  ]);
  return `${customerEntryPermissionFingerprint(rawContext)}:workbench:${capabilityProjectionFingerprint(rawContext.workbenchCapabilities)}:write:${capabilityProjectionFingerprint(rawContext.writeCapabilities)}:session:${sessionCapabilities}:actor:${actorAccess}:official-inventory:${JSON.stringify(contextOfficialInventoryPermissions(rawContext))}`;
}

/**
 * A response is usable only after all of its identity dimensions and its
 * selected-merchant proof agree. `domainScope` is the public, UI-only identity
 * marker for imported front pages; it is never an authorization substitute.
 */
function verifiedBusinessContext(
  merchantId: number,
  rawContext: BusinessContextContract | undefined,
  adminAccountId: number
): VerifiedBusinessContext | null {
  const principal = readyStaffPrincipal(rawContext?.staffPrincipal);
  if (
    !rawContext ||
    !principal ||
    principal.adminAccountId !== adminAccountId ||
    numberFromMerchantInput(rawContext.enterprise?.id) !==
      principal.enterpriseId ||
    !businessContextMatchesMerchant(merchantId, rawContext.merchant)
  ) {
    return null;
  }
  const domainScope = businessDomainScope(merchantId, principal);
  return {
    domainScope,
    verifiedBranchKey: `${domainScope}:${businessAccessFingerprint(rawContext)}`,
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
  const observerOnly = useContext(ReceptionObserverContext);
  if (observerOnly) return null;
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
  const observerOnly = useContext(ReceptionObserverContext);
  if (observerOnly) return null;
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
  const { officialInventoryPermissions } = useBusinessScope();
  if (officialInventoryPermissions.read !== true) {
    return <AccessState title="当前账号无渠道库存查看权限" detail="渠道库存需要服务端核验的原生查看授权、真实员工绑定及当前企业范围；ERP 编辑权限不能代替查看授权。" />;
  }
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

function BusinessChatRoute({ canReply = false }: { canReply?: boolean }) {
  const { sessionCapabilities } = useBusinessScope();
  if (sessionCapabilities.receptionReady !== true) {
    return <AccessState title="企业接待尚未完成安全就绪" detail="必须由当前企业核验真实绑定员工的 inquiry.receive；不会启用个人聊天或借用库存授权。" />;
  }
  return <EnterpriseInquiryInbox canReply={canReply} />;
}

function ReceptionNavigationUnread() {
  const { sessionCapabilities } = useBusinessScope();
  const { total } = useInquiryReceptionUnread(sessionCapabilities.receptionReady === true);
  return total > 0 ? <span className="inquiry-reception-nav-badge" aria-label={`${total} 条企业询价未读`}>{total > 99 ? "99+" : total}</span> : null;
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

function BusinessRoutes({ canReply = false }: { canReply?: boolean }) {
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
      <Route path="/chat">{() => <BusinessChatRoute canReply={canReply} />}</Route>
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
      <Route path="/inquiries">{() => <BusinessChatRoute canReply={canReply} />}</Route>
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

function useSessionContextRevalidation(session: BusinessWorkbenchSession) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPageShow = (event: PageTransitionEvent) => {
      // A normal first-load pageshow follows the initial query. Only a bfcache
      // restore is a re-entry that could otherwise retain an old context.
      if (event.persisted) session.revalidateAfterRestore();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [session]);
}

/** A background proof refresh is not a global editing lock. Every command is
 * still authorized by the BFF; a denied/changed proof tears down this domain. */
export function BusinessContextVerificationBoundary({
  verificationState,
  identity,
  children,
}: {
  verificationState: "verified" | "revalidating";
  identity: string;
  children: ReactNode;
}) {
  const observerOnly = useContext(ReceptionObserverContext);
  if (observerOnly) return <>{children}</>;
  const revalidating = verificationState === "revalidating";
  return (
    <section
      aria-busy={revalidating || undefined}
      data-business-context-verification={verificationState}
      data-business-context-identity={identity}
    >
      <div data-business-context-content="">{children}</div>
    </section>
  );
}

function VerifiedBusinessWorkbench({
  merchantId,
  routeBase,
  receptionObserver = false,
  principal,
  capabilities,
  rawContext,
  verificationState,
  session,
  authorization,
}: {
  merchantId: number;
  routeBase: string;
  receptionObserver?: boolean;
  principal: ReadyBusinessStaffPrincipal;
  capabilities: BusinessSessionCapabilities;
  rawContext: BusinessContextContract;
  verificationState: "verified" | "revalidating";
  session: BusinessWorkbenchSession;
  authorization: string;
}) {
  const domainScope = businessDomainScope(merchantId, principal);
  const resources = session.domainResources(authorization);
  const queryClient = resources.client;
  const reportAuthorizationError = useMemo(
    () => session.authorizationErrorReporter(authorization),
    [session, authorization, resources]
  );
  const domainClient = useMemo(
    () =>
      trpc.createClient({
        links: [
          httpBatchLink({
            url: "/api/business-trpc",
            transformer: superjson,
            headers: () => ({ "x-business-merchant-id": String(merchantId) }),
            async fetch(input, init) {
              const { controller, cleanup } = createBusinessRequestCancellation(
                resources.abort,
                init?.signal
              );
              try {
                const response = await globalThis.fetch(input, {
                  ...(init ?? {}),
                  credentials: "include",
                  signal: controller.signal,
                });
                // httpBatchLink consumes JSON after fetch resolves headers. Keep
                // cancellation alive through that body read, not just headers.
                const readJson = response.json.bind(response);
                Object.defineProperty(response, "json", {
                  configurable: true,
                  value: async () => {
                    try {
                      return await readJson();
                    } finally {
                      cleanup();
                    }
                  },
                });
                return response;
              } catch (error) {
                cleanup();
                throw error;
              }
            },
          }),
        ],
      }),
    [resources, merchantId]
  );

  useEffect(() => retainBusinessQueryClient(queryClient), [queryClient]);

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
          officialInventoryPermissions={contextOfficialInventoryPermissions(rawContext)}
          contextVerificationState={verificationState}
          authorizationVersion={authorization}
          onAuthorizationError={reportAuthorizationError}
          storageOwner={!receptionObserver}
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
                {receptionObserver ? (hasExactCapability(rawContext.workbenchCapabilities, "inquiry.receive") ? <ReceptionNavigationUnread /> : null) : <BusinessRoutes canReply={rawContext.merchant?.canWrite === true && hasExactCapability(rawContext.writeCapabilities, "inquiry.receive")} />}
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
  receptionObserver = false,
  scopeRevalidating = false,
  session,
}: {
  merchantId: number;
  routeBase: string;
  receptionObserver?: boolean;
  /** The merchant-scope BFF is rechecking an already verified selection. */
  scopeRevalidating?: boolean;
  session: BusinessWorkbenchSession;
}) {
  const contextQuery = businessScopeTrpc.context.useQuery(undefined, {
    staleTime: BUSINESS_CONTEXT_STALE_TIME,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    trpc: { abortOnUnmount: true },
  });
  const rawContext = contextQuery.data as BusinessContextContract | undefined;
  const principal = readyStaffPrincipal(rawContext?.staffPrincipal);
  const contextMerchant = rawContext?.merchant;
  const currentVerifiedContext = verifiedBusinessContext(
    merchantId,
    rawContext,
    session.adminAccountId
  );
  // React Query deliberately preserves the last successful `data` on a
  // refetch. Preserve it here only after a completed successful verification;
  // a cache value that never reached this gate has no rendering authority.
  const lastVerifiedContext = useRef<VerifiedBusinessContext | null>(
    currentVerifiedContext?.verifiedBranchKey === session.authorization
      ? currentVerifiedContext
      : null
  );
  const revalidate = useCallback(() => {
    void contextQuery.refetch({ cancelRefetch: false });
  }, [contextQuery.refetch]);
  const verificationInFlight = contextQuery.isFetching || scopeRevalidating;

  const completedAuthorization =
    currentVerifiedContext?.verifiedBranchKey ?? null;
  useLayoutEffect(() => {
    if (
      !contextQuery.isError &&
      (contextQuery.isLoading || contextQuery.isFetching)
    )
      return;
    const confirmed = contextQuery.isError ? null : completedAuthorization;
    if (contextQuery.isError && isBusinessSecurityError(contextQuery.error)) {
      session.onAuthorizationError(contextQuery.error);
      return;
    }
    if (!confirmed) {
      // Transport failure is not permission revocation. Still close the domain
      // conservatively, but preserve local drafts until the identity is proved
      // again (or a later auth/permission change explicitly invalidates them).
      session.invalidateAuthorization(
        !contextQuery.isError || isBusinessSecurityError(contextQuery.error)
      );
    } else session.confirmAuthorization(confirmed);
  }, [
    completedAuthorization,
    contextQuery.isError,
    contextQuery.isFetching,
    contextQuery.isLoading,
    verificationInFlight,
    session,
    contextQuery.error,
  ]);

  // This ref update is derived only from a settled request, so it remains
  // idempotent under Strict Mode while allowing restore to arrive immediately
  // after the successful commit.
  if (!verificationInFlight) {
    lastVerifiedContext.current =
      contextQuery.isError || !currentVerifiedContext
        ? null
        : currentVerifiedContext;
  }

  if (contextQuery.isLoading) {
    return (
      <BusinessLoadingState
        label="正在加载业务工作台…"
        testId="business-context"
      />
    );
  }
  if (verificationInFlight) {
    const retainedContext = lastVerifiedContext.current;
    // Cached data can be present during an error/retry or before the first
    // verified commit. The scope list can also be revalidating. In both cases,
    // render only if it still proves the exact same bound staff, admin account,
    // enterprise, merchant and binding revision, without freezing editing controls.
    if (
      !contextQuery.isError &&
      retainedContext &&
      currentVerifiedContext?.verifiedBranchKey ===
        retainedContext.verifiedBranchKey
    ) {
      return (
        <VerifiedBusinessWorkbench
          key={retainedContext.verifiedBranchKey}
          merchantId={merchantId}
          routeBase={routeBase}
          receptionObserver={receptionObserver}
          principal={retainedContext.principal}
          capabilities={retainedContext.capabilities}
          rawContext={retainedContext.rawContext}
          session={session}
          authorization={retainedContext.verifiedBranchKey}
          verificationState="revalidating"
        />
      );
    }
    return (
      <BusinessLoadingState
        label="正在加载业务工作台…"
        testId="business-context"
      />
    );
  }
  if (contextQuery.isError) {
    return (
      <AccessState
        title={
          isBusinessAuthorizationError(contextQuery.error)
            ? "业务访问授权已失效"
            : isBusinessSecurityError(contextQuery.error)
              ? "业务请求安全核验未通过"
              : "业务上下文暂时无法核验"
        }
        detail={
          contextQuery.error.message || "当前商户和工作人员会话未能通过核验。"
        }
        retrying={verificationInFlight}
        onRetry={revalidate}
      />
    );
  }
  if (
    !principal ||
    !rawContext ||
    principal.adminAccountId !== session.adminAccountId
  ) {
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
          receptionObserver={receptionObserver}
      principal={currentVerifiedContext.principal}
      capabilities={currentVerifiedContext.capabilities}
      rawContext={currentVerifiedContext.rawContext}
      session={session}
      authorization={currentVerifiedContext.verifiedBranchKey}
      verificationState="verified"
    />
  );
}

function ScopedBusinessWorkbench({
  merchantId,
  routeBase,
  receptionObserver = false,
  scopeRevalidating,
  session,
}: {
  merchantId: number;
  routeBase: string;
  receptionObserver?: boolean;
  scopeRevalidating: boolean;
  session: BusinessWorkbenchSession;
}) {
  const queryClient = session.context;
  const contextClient = useMemo(
    () => createBusinessScopeTrpcClient(merchantId),
    [merchantId]
  );

  useEffect(() => retainBusinessQueryClient(queryClient), [queryClient]);

  return (
    <businessScopeTrpc.Provider
      client={contextClient}
      queryClient={queryClient}
    >
      <QueryClientProvider client={queryClient}>
        <BusinessContextGate
          merchantId={merchantId}
          routeBase={routeBase}
          receptionObserver={receptionObserver}
          scopeRevalidating={scopeRevalidating}
          session={session}
        />
      </QueryClientProvider>
    </businessScopeTrpc.Provider>
  );
}

function BusinessWorkbenchDiscovery({
  merchantId,
  routeBase,
  receptionObserver = false,
  session,
}: BusinessWorkbenchPageProps & { session: BusinessWorkbenchSession }) {
  const search = useSearch();
  // `merchants` is an explicitly mounted BusinessRouter procedure at
  // /api/business-trpc. This uses the same BFF-only, bounded transport as
  // `context`; it does not trust a URL value or pick a fallback merchant.
  const merchantList = businessScopeTrpc.merchants.useQuery(
    { page: 1, pageSize: 100 },
    {
      staleTime: BUSINESS_CONTEXT_STALE_TIME,
      gcTime: Infinity,
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
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
    void merchantList.refetch({ cancelRefetch: false });
  }, [merchantList.refetch]);

  useLayoutEffect(() => {
    // A completed denied/error discovery must not leave prior customer drafts
    // eligible for a later render. Ordinary revalidation remains covered by
    // the in-flight boundary below and does not invalidate the same identity.
    if (hasExplicitMerchant && requestedId !== OFFICIAL_ZHIJIE_MERCHANT_ID) {
      session.invalidateAuthorization();
      void session.context.cancelQueries();
      session.context.clear();
      return;
    }
    if (merchantList.isLoading || merchantList.isFetching) return;
    if (
      merchantList.isError &&
      isBusinessAuthorizationError(merchantList.error)
    ) {
      session.onAuthorizationError(merchantList.error);
      return;
    }
    const isUnavailable =
      merchantList.isError ||
      !officialMerchant ||
      (hasExplicitMerchant && requestedId !== OFFICIAL_ZHIJIE_MERCHANT_ID);
    if (isUnavailable) {
      session.invalidateAuthorization(
        !merchantList.isError || isBusinessSecurityError(merchantList.error)
      );
      void session.context.cancelQueries();
      session.context.clear();
    }
  }, [
    hasExplicitMerchant,
    merchantList.isError,
    merchantList.isFetching,
    merchantList.isLoading,
    officialMerchant,
    requestedId,
    session,
    merchantList.error,
  ]);

  // A refetch can retain the previous list. As with context, it has no
  // rendering authority before an initial BFF verification settles. Once a
  // verified selection exists, retain it under the same live boundary while
  // a fresh scope response is pending rather than blanking the whole page.
  if (
    merchantList.isLoading ||
    (merchantList.isFetching && !merchantList.data)
  ) {
    return (
      <BusinessLoadingState
        label="正在加载工作区…"
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
          receptionObserver={receptionObserver}
      scopeRevalidating={merchantList.isFetching}
      session={session}
    />
  );
}

/** Native same-DOM workbench for the one approved internal official merchant. */
function BusinessWorkbenchContent({
  merchantId,
  routeBase,
  receptionObserver = false,
}: BusinessWorkbenchPageProps) {
  const { session, retrySession } = useBusinessWorkbenchSession();
  return !session ? (
    <BusinessLoadingState label="正在加载工作区…" testId="business-session" />
  ) : session.denied ? (
    <AccessState
      title={
        session.denialKind === "session-invalid"
          ? "业务访问授权已失效"
          : "业务请求安全核验未通过"
      }
      detail={
        session.denialKind === "session-invalid"
          ? "服务端已确认当前登录、员工绑定或企业授权失效，旧主体数据已清理。请重新核验。"
          : "服务端拒绝了当前安全核验，但未提供可识别的失效分类；工作区已保守关闭并清理旧数据，请重新核验。"
      }
      onRetry={retrySession}
    />
  ) : (
    <SessionBusinessWorkbenchContent
      key={session.adminAccountId}
      session={session}
      merchantId={merchantId}
      routeBase={routeBase}
          receptionObserver={receptionObserver}
    />
  );
}

function SessionBusinessWorkbenchContent({
  merchantId,
  routeBase,
  receptionObserver = false,
  session,
}: BusinessWorkbenchPageProps & { session: BusinessWorkbenchSession }) {
  const queryClient = session.discovery;
  const discoveryClient = useMemo(() => createBusinessScopeTrpcClient(), []);
  useSessionContextRevalidation(session);

  useEffect(() => retainBusinessQueryClient(queryClient), [queryClient]);

  return (
    <businessScopeTrpc.Provider
      client={discoveryClient}
      queryClient={queryClient}
    >
      <QueryClientProvider client={queryClient}>
        <BusinessWorkbenchDiscovery
          merchantId={merchantId}
          routeBase={routeBase}
          receptionObserver={receptionObserver}
          session={session}
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

/** Mount only beneath root admin auth and the parent-authorized inquiry item. */
export function BusinessReceptionNavigationBadge() {
  return <ReceptionObserverContext.Provider value={true}><BusinessWorkbenchContent receptionObserver /></ReceptionObserverContext.Provider>;
}
