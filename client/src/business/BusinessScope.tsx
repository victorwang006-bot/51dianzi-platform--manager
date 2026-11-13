import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
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

/** BFF-proven native grants intersected with the current real business scope. */
export type BusinessOfficialInventoryPermissions = Readonly<{
  read: boolean;
  write: boolean;
  note: boolean;
  /** Explicit BFF-proven grant; absent legacy projections cannot publish. */
  publish?: boolean;
  authorizationVersion: string;
}>;

/**
 * Public UI signal for imported front pages. `identity` is derived locally from
 * the BFF-proven scope below; neither field can grant a permission or select a
 * different enterprise. A draft hook may retain in-memory input only while the
 * state is `revalidating`; actual binding/access loss must clear old drafts.
 */
export type BusinessContextVerification = Readonly<{
  state: "verified" | "revalidating";
  identity: string;
  authorizationVersion: string;
  readVersion: string;
}>;

type BusinessScopeValue = {
  merchantId: number;
  /** BFF-bound front-office actor; never the current admin account. */
  frontUser: BusinessFrontUser;
  staffPrincipal: ReadyBusinessStaffPrincipal;
  sessionCapabilities: BusinessSessionCapabilities;
  officialInventoryPermissions: BusinessOfficialInventoryPermissions;
  /** UI-only cache/draft namespace. Authorization stays exclusively in the BFF. */
  storageScope: string;
  /** A background recheck is not an identity or permission change. */
  contextVerification: BusinessContextVerification;
  /** Direct reads must report security failures, just like QueryCache reads. */
  onAuthorizationError: (error: unknown) => void;
};

const BusinessScopeContext = createContext<BusinessScopeValue | null>(null);
/** Consumed by the isolated front customer-entry draft store. */
export const CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT =
  "d51:customer-entry-drafts-invalidated";
let activeStorageScope: string | null = null;
const storageScopeOwners = new Map<string, Set<symbol>>();
const ignoreAuthorizationError = (_error: unknown) => {};

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
  officialInventoryPermissions,
  contextVerificationState,
  authorizationVersion,
  onAuthorizationError = ignoreAuthorizationError,
  storageOwner = true,
  children,
}: {
  merchantId: number;
  staffPrincipal: ReadyBusinessStaffPrincipal;
  sessionCapabilities?: BusinessSessionCapabilities;
  officialInventoryPermissions?: BusinessOfficialInventoryPermissions;
  contextVerificationState: BusinessContextVerification["state"];
  authorizationVersion?: string;
  onAuthorizationError?: (error: unknown) => void;
  /** Navigation reads share authorization, never publish a page's draft identity. */
  storageOwner?: boolean;
  children: ReactNode;
}) {
  const frontUser = staffPrincipal.user;
  // This is UI-only storage, not authorization. Include every BFF-proven
  // principal dimension so a newly bound actor or binding revision cannot
  // restore another customer workspace's remembered filters/position.
  const storageScope = `business-domain:v1:staff:${frontUser.id}:admin:${staffPrincipal.adminAccountId}:enterprise:${staffPrincipal.enterpriseId}:merchant:${merchantId}:binding:${staffPrincipal.bindingVersion}`;
  const capabilities = sessionCapabilities ?? {};
  const effectiveVersion = authorizationVersion ?? storageScope;
  const contextVerification = useMemo<BusinessContextVerification>(
    () => ({ state: contextVerificationState, identity: storageScope,
      authorizationVersion: effectiveVersion, readVersion: effectiveVersion }),
    [contextVerificationState, storageScope, effectiveVersion]
  );
  const value = useMemo<BusinessScopeValue>(
    () => ({
      merchantId,
      frontUser,
      staffPrincipal,
      sessionCapabilities: capabilities,
      officialInventoryPermissions: officialInventoryPermissions ?? { read: false, write: false, note: false, authorizationVersion: "" },
      storageScope,
      contextVerification,
      onAuthorizationError,
    }),
    [
      merchantId,
      frontUser,
      staffPrincipal,
      capabilities,
      officialInventoryPermissions,
      storageScope,
      contextVerification,
      onAuthorizationError,
    ]
  );

  // Publish before descendants synchronously restore drafts. There is no
  // fallback key: a cache is always partitioned by the real staff and merchant.
  // Only a newly published verified proof may become current. An older mounted
  // provider must not restore itself merely because an unrelated sibling leaves.
  const publishedStorageProof = useRef<string | null>(null);
  const storageProof = `${storageScope}|${effectiveVersion}`;
  if (!storageOwner) publishedStorageProof.current = null;
  else if (publishedStorageProof.current !== storageProof) {
    activeStorageScope = storageScope;
    publishedStorageProof.current = storageProof;
  }

  useEffect(() => {
    if (!storageOwner) return;
    const owner = Symbol("business-storage-scope-owner");
    const owners = storageScopeOwners.get(storageScope) ?? new Set<symbol>();
    owners.add(owner);
    storageScopeOwners.set(storageScope, owners);
    activeStorageScope = storageScope;
    setPageMemoryScope(storageScope);
    return () => {
      // Ordinary navigation outside the workbench is not an abandonment.
      // The Gate and global auth invalidate only confirmed binding/access loss.
      owners.delete(owner);
      if (!owners.size) storageScopeOwners.delete(storageScope);
      // Never restore a different old scope when the current generation leaves.
      if (activeStorageScope === storageScope && !owners.size) {
        activeStorageScope = null;
        setPageMemoryScope(null);
      }
    };
  }, [storageScope, storageOwner, effectiveVersion]);

  return (
    <BusinessScopeContext.Provider value={value}>
      {children}
    </BusinessScopeContext.Provider>
  );
}
