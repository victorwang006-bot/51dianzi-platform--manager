import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { setPageMemoryScope } from "./platform/client/src/lib/pageMemory";
import type { AppRouter } from "./platform/front-router-types/server/routers";

export type BusinessFrontUser = NonNullable<
  inferRouterOutputs<AppRouter>["auth"]["me"]
>;

/** Exact client contract for the audited BFF binding. */
export type ReadyBusinessStaffPrincipal = {
  status: "ready";
  frontendUserId: number;
  user: BusinessFrontUser;
  adminAccountId: number;
  enterpriseId: number;
  bindingVersion: number;
};

export type RequiredBusinessStaffPrincipal = {
  status: "required";
  reason: string;
};

export type BusinessStaffPrincipal =
  | ReadyBusinessStaffPrincipal
  | RequiredBusinessStaffPrincipal;
/** Absent is fail-closed for partially deployed BFF responses. */
export type BusinessSessionCapabilities = Readonly<{
  /** The complete personal-chat capability is intentionally not projected. */
  chat?: false;
  /** A server-proven, inquiry-only enterprise reception surface. */
  receptionReady?: boolean;
}>;

type BusinessScopeValue = {
  merchantId: number;
  /** BFF-bound front-office actor; never the current admin account. */
  frontUser: BusinessFrontUser;
  staffPrincipal: ReadyBusinessStaffPrincipal;
  sessionCapabilities: BusinessSessionCapabilities;
  /** UI-only cache/draft namespace. Authorization stays exclusively in the BFF. */
  storageScope: string;
};

const BusinessScopeContext = createContext<BusinessScopeValue | null>(null);
let activeStorageScope: string | null = null;

export function businessStorageScope(): string | null {
  return activeStorageScope;
}

export function useBusinessScope(): BusinessScopeValue {
  const value = useContext(BusinessScopeContext);
  if (!value) {
    throw new Error(
      "BusinessScopeProvider is required before rendering a business page"
    );
  }
  return value;
}

export function BusinessScopeProvider({
  merchantId,
  staffPrincipal,
  sessionCapabilities,
  children,
}: {
  merchantId: number;
  staffPrincipal: ReadyBusinessStaffPrincipal;
  sessionCapabilities?: BusinessSessionCapabilities;
  children: ReactNode;
}) {
  const frontUser = staffPrincipal.user;
  // This is UI-only storage, not authorization. Include every BFF-proven
  // principal dimension so a newly bound actor or binding revision cannot
  // restore another customer workspace's remembered filters/position.
  const storageScope = `business-domain:v1:staff:${frontUser.id}:admin:${staffPrincipal.adminAccountId}:enterprise:${staffPrincipal.enterpriseId}:merchant:${merchantId}:binding:${staffPrincipal.bindingVersion}`;
  const capabilities = sessionCapabilities ?? {};
  const value = useMemo<BusinessScopeValue>(
    () => ({
      merchantId,
      frontUser,
      staffPrincipal,
      sessionCapabilities: capabilities,
      storageScope,
    }),
    [merchantId, frontUser, staffPrincipal, capabilities, storageScope]
  );

  // Publish before descendants synchronously restore drafts. There is no
  // fallback key: a cache is always partitioned by the real staff and merchant.
  activeStorageScope = storageScope;

  useEffect(() => {
    activeStorageScope = storageScope;
    setPageMemoryScope(storageScope);
    return () => {
      if (activeStorageScope === storageScope) {
        activeStorageScope = null;
        setPageMemoryScope(null);
      }
    };
  }, [storageScope]);

  return (
    <BusinessScopeContext.Provider value={value}>
      {children}
    </BusinessScopeContext.Provider>
  );
}
