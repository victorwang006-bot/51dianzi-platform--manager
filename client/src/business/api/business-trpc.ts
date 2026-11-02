import { httpBatchLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import superjson from "superjson";
import type { BusinessRouter } from "../../../../server/businessRouter";
import type { AppRouter } from "../platform/front-router-types/server/routers";

/**
 * Domain procedures keep the exact front-office AppRouter type surface. The
 * browser still talks only to /api/business-trpc; the BFF owns the static
 * allow-list and derives enterprise, real staff actor and permissions per call.
 * `AppRouter` is a type-only import, therefore copied front/server code is never
 * emitted into the browser bundle.
 */
export const trpc = createTRPCReact<AppRouter>();

/**
 * This narrow router is deliberately separate. It only bootstraps the admin BFF
 * merchant selection/context; it must never replace the domain AppRouter above.
 */
export const businessScopeTrpc = createTRPCReact<BusinessRouter>();

/**
 * Context is the workbench's only pre-render BFF request. Bound it so a lost
 * browser-to-BFF connection cannot leave the fail-closed loading gate pending
 * forever. Domain requests retain their existing transport semantics.
 */
export const BUSINESS_SCOPE_REQUEST_TIMEOUT_MS = 10_000;

export class BusinessScopeRequestTimeoutError extends Error {
  constructor() {
    super("业务主体绑定核验请求超时，请重试");
    this.name = "BusinessScopeRequestTimeoutError";
  }
}

type BusinessFetch = typeof globalThis.fetch;

/**
 * Compose the caller's cancellation signal with a deadline instead of
 * replacing it. React Query can therefore cancel an unmounted workbench while
 * a hung request still becomes a bounded, retryable error for mounted pages.
 */
export function createBoundedBusinessScopeFetch(
  fetchImpl: BusinessFetch = globalThis.fetch,
  timeoutMs = BUSINESS_SCOPE_REQUEST_TIMEOUT_MS
): BusinessFetch {
  return async (input, init) => {
    const controller = new AbortController();
    const upstreamSignal = init?.signal;
    let timedOut = false;
    const onUpstreamAbort = () => controller.abort();
    if (upstreamSignal?.aborted) controller.abort();
    else
      upstreamSignal?.addEventListener("abort", onUpstreamAbort, {
        once: true,
      });
    const timer = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      return await fetchImpl(input, {
        ...(init ?? {}),
        credentials: "include",
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) throw new BusinessScopeRequestTimeoutError();
      throw error;
    } finally {
      globalThis.clearTimeout(timer);
      upstreamSignal?.removeEventListener("abort", onUpstreamAbort);
    }
  };
}

function createBusinessTransport(
  merchantId?: number,
  fetchImpl: BusinessFetch = globalThis.fetch
) {
  return httpBatchLink({
    url: "/api/business-trpc",
    transformer: superjson,
    headers: () =>
      merchantId === undefined
        ? {}
        : { "x-business-merchant-id": String(merchantId) },
    fetch(input, init) {
      return fetchImpl(input, { ...(init ?? {}), credentials: "include" });
    },
  });
}

/** Typed client for proxied front-office business procedures. */
export function createBusinessTrpcClient(merchantId: number) {
  return trpc.createClient({ links: [createBusinessTransport(merchantId)] });
}

/** Typed client for BFF-only merchants/context bootstrap procedures. */
export function createBusinessScopeTrpcClient(
  merchantId?: number,
  options?: { fetch?: BusinessFetch; timeoutMs?: number }
) {
  return businessScopeTrpc.createClient({
    links: [
      createBusinessTransport(
        merchantId,
        createBoundedBusinessScopeFetch(options?.fetch, options?.timeoutMs)
      ),
    ],
  });
}
