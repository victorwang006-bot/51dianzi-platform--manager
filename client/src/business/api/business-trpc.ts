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

function createBusinessTransport(merchantId?: number) {
  return httpBatchLink({
    url: "/api/business-trpc",
    transformer: superjson,
    headers: () => merchantId === undefined
      ? {}
      : { "x-business-merchant-id": String(merchantId) },
    fetch(input, init) {
      return globalThis.fetch(input, { ...(init ?? {}), credentials: "include" });
    },
  });
}

/** Typed client for proxied front-office business procedures. */
export function createBusinessTrpcClient(merchantId: number) {
  return trpc.createClient({ links: [createBusinessTransport(merchantId)] });
}

/** Typed client for BFF-only merchants/context bootstrap procedures. */
export function createBusinessScopeTrpcClient(merchantId?: number) {
  return businessScopeTrpc.createClient({ links: [createBusinessTransport(merchantId)] });
}
