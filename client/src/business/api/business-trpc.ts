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
 * Scope bootstrap and the root read-only navigation projection must not wait
 * indefinitely for an incomplete BFF HTTP response. Domain requests retain
 * their existing transport semantics.
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
    let settled = false;
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) globalThis.clearTimeout(timer);
      upstreamSignal?.removeEventListener("abort", onUpstreamAbort);
    };
    const onUpstreamAbort = () => {
      controller.abort();
      // Unmount/cancel belongs to React Query, not to the timeout UI. It must
      // also release this listener/timer if a Response body ignores abort.
      cleanup();
    };
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = globalThis.setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new BusinessScopeRequestTimeoutError());
      }, timeoutMs);
    });
    if (upstreamSignal?.aborted) onUpstreamAbort();
    else
      upstreamSignal?.addEventListener("abort", onUpstreamAbort, {
        once: true,
      });

    try {
      // fetch() resolves as soon as response headers arrive. Keep the same
      // deadline alive for tRPC's later Response.json() call, otherwise a
      // chunked 200 response with a body that never ends leaves the gate
      // pending forever despite the apparent timeout.
      const response = await Promise.race([
        fetchImpl(input, {
          ...(init ?? {}),
          credentials: "include",
          signal: controller.signal,
        }),
        deadline,
      ]);
      const readJson = response.json.bind(response);
      Object.defineProperty(response, "json", {
        configurable: true,
        value: async () => {
          try {
            return await Promise.race([readJson(), deadline]);
          } catch (error) {
            // Aborting a native body reader can synchronously reject json()
            // with AbortError before the deadline promise wins the race. Once
            // our own deadline fired, the UI must receive the same bounded,
            // retryable timeout regardless of that implementation ordering.
            if (timedOut) throw new BusinessScopeRequestTimeoutError();
            throw error;
          } finally {
            cleanup();
          }
        },
      });
      return response;
    } catch (error) {
      cleanup();
      if (timedOut) throw new BusinessScopeRequestTimeoutError();
      throw error;
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
