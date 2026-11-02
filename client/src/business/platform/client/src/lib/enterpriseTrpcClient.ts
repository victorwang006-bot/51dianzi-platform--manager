import { httpLink } from "@trpc/client";
import superjson from "superjson";
import { COOKIE_NAME } from "../../../shared/const";
import { getAnalyticsVisitorId } from "./analyticsIdentity";
import { trpc } from "../../../../api/business-trpc";

export type EnterpriseRequestSnapshot = Readonly<{
  enterpriseId?: number;
  applicationId?: string;
  newEnterpriseApplication?: boolean;
}>;

/** Shared legacy auth/visitor headers for root and enterprise-scoped clients. */
export function defaultTrpcHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  try {
    headers["x-51dianzi-visitor"] = getAnalyticsVisitorId();
  } catch {
    // Privacy mode/local-storage failure cannot block a normal request.
  }
  try {
    const raw = sessionStorage.getItem("manus-cookie");
    if (raw) {
      const prefix = `${COOKIE_NAME}=`;
      const pair = raw.split(";").find(value => value.trim().startsWith(prefix));
      const token = pair?.trim().slice(prefix.length);
      if (token) headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // sessionStorage unavailable
  }
  return headers;
}

export const trpcFetch: typeof globalThis.fetch = (input, init) =>
  globalThis.fetch(input, { ...(init ?? {}), credentials: "include" });

export function enterpriseHeaders(snapshot: EnterpriseRequestSnapshot): Record<string, string> {
  const headers = defaultTrpcHeaders();
  if (snapshot.newEnterpriseApplication || snapshot.applicationId) {
    // A new application intentionally has no enterprise id; mixed contexts are invalid.
    headers["x-51dianzi-new-enterprise"] = "1";
    if (snapshot.applicationId) headers["x-51dianzi-application-id"] = snapshot.applicationId;
    return headers;
  }
  if (snapshot.enterpriseId) {
    headers["x-51dianzi-enterprise-id"] = String(snapshot.enterpriseId);
  }
  return headers;
}

/**
 * A scope owns an immutable HTTP client and a distinct QueryClient. httpLink avoids
 * batching requests constructed under different identities, including queued writes.
 */
export function createEnterpriseScopedTrpcClient(snapshot: EnterpriseRequestSnapshot) {
  const fixedSnapshot = Object.freeze({ ...snapshot });
  return trpc.createClient({
    links: [
      httpLink({
        url: "/api/trpc",
        transformer: superjson,
        headers: () => enterpriseHeaders(fixedSnapshot),
        fetch: trpcFetch,
      }),
    ],
  });
}
