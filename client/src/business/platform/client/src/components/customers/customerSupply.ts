import { useMemo } from "react";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../front-router-types/server/routers";
import { trpc } from "../../../../../api/business-trpc";
import { useBusinessScope } from "../../../../../BusinessScope";
import type { CustomerContactScope } from "./customerContacts";
import type { Payload } from "../channelInventory/import";
import type { BatchEntry, BatchReceipt } from "../channelInventory/queue";

export type SupplyInputs = inferRouterInputs<AppRouter>["channelInventory"];
export type SupplyOutputs = inferRouterOutputs<AppRouter>["channelInventory"];
export type SupplyContext = SupplyOutputs["customerSupplyContext"];
/** Null is a masked/pending UI count, never an assertion that the source has zero stock. */
export type SupplySummary = Omit<SupplyOutputs["customerSupplySummary"]["items"][number], "materialCount"> & { materialCount: number | null };
export type SupplyCreateInput = SupplyInputs["createCustomerMaterial"];
export type SourceProfile = NonNullable<SupplyCreateInput["sourceProfile"]>;
export type SupplyIdentity = { enterpriseId: number; actorUserId: number; key: string };

export function useCustomerSupplyAuthority(scope: CustomerContactScope | null, scopeReady: boolean) {
  const business = useBusinessScope();
  // The root session owns identity verification and query-cache isolation. This
  // consumer must not turn window focus/reconnect/remount into another check.
  const enterpriseQuery = trpc.enterprise.me.useQuery(undefined, {
    enabled: scopeReady && Boolean(scope), retry: false, staleTime: Infinity,
    refetchInterval: false, refetchOnWindowFocus: false,
    refetchOnReconnect: false, refetchOnMount: false,
  });
  const summary = enterpriseQuery.data;
  const ready = scopeReady && Boolean(scope)
    && !enterpriseQuery.isError && summary?.enterprise?.id === scope?.enterpriseId
    && summary?.currentUserId === scope?.actorUserId
    && (!summary?.member || summary.member.status === "active")
    && business.contextVerification.identity === business.storageScope;
  const permissionKeys: readonly string[] = summary?.permissionKeys ?? [];
  // Native source-read and material-write are independent. Do not require a
  // source-read grant to upload; every command rechecks the intersection server-side.
  const canWrite = ready && business.officialInventoryPermissions.write
    && Boolean(summary?.isOwner || permissionKeys.includes("inventory.manage"));
  const key = JSON.stringify({ mode: "customer-supply-v15", scope: business.storageScope,
    verification: business.contextVerification.identity,
    authorization: business.contextVerification.authorizationVersion,
    readVersion: business.contextVerification.readVersion,
    native: business.officialInventoryPermissions,
    enterpriseId: scope?.enterpriseId, actorUserId: scope?.actorUserId,
    crmManageAll: scope?.canManageAll,
    member: summary?.member ? { id: summary.member.id, role: summary.member.role, status: summary.member.status,
      inventoryDataScope: summary.member.inventoryDataScope, permissionVersion: summary.member.permissionVersion } : null,
    permissionVersion: summary?.permissionVersion,
    permissions: [...permissionKeys].sort(), owner: summary?.isOwner, ready, canWrite });
  const identity = useMemo<SupplyIdentity | null>(() => ready && scope
    ? { enterpriseId: scope.enterpriseId, actorUserId: scope.actorUserId, key } : null, [key, ready, scope]);
  return { identity, canWrite, canRead: ready && business.officialInventoryPermissions.read,
    failed: enterpriseQuery.isError, retry: () => enterpriseQuery.refetch(),
    onAuthorizationError: business.onAuthorizationError };
}

export function customerSupplySessionSuffix(identity: SupplyIdentity, customerId: number) {
  return `customer-supply-v15:${identity.enterpriseId}:${identity.actorUserId}:${customerId}:${encodeURIComponent(identity.key)}`;
}

/** Explicit allowlist: virtual BatchUpload channelId is local-only and MUST NOT leave the wrapper. */
export function customerMaterialInput(payload: Payload, requestId: string, identity: SupplyIdentity,
  customerId: number, expectedCustomerVersion: SupplyCreateInput["expectedCustomerVersion"], sourceProfile?: SourceProfile): SupplyCreateInput {
  return {
    customerId, expectedCustomerVersion,
    expectedEnterpriseId: identity.enterpriseId, expectedActorUserId: identity.actorUserId,
    ...(sourceProfile ? { sourceProfile } : {}),
    partNumber: payload.partNumber, brand: payload.brand, qty: payload.qty,
    dateCode: payload.dateCode, price: payload.price, currency: payload.currency,
    taxIncluded: payload.taxIncluded, leadTime: payload.leadTime, note: payload.note, requestId,
  };
}

export function supplyReceipt(value: unknown, customerId: number): BatchReceipt {
  if (!value || typeof value !== "object") throw new Error("上传回执未确认，请按原批次重试。");
  const receipt = value as Partial<BatchReceipt>;
  if (receipt.customerId !== customerId || !Number.isSafeInteger(receipt.channelId)
    || (receipt.channelId ?? 0) <= 0 || typeof receipt.idempotent !== "boolean" || !receipt.item) {
    throw new Error("上传回执身份不匹配，请按原请求确认，不会新建批次。");
  }
  return { item: receipt.item, idempotent: receipt.idempotent, channelId: receipt.channelId!, customerId };
}

export function completedSupplyChannel(entries: readonly BatchEntry[], customerId: number): number | null {
  const receipts = entries.filter(entry => entry.status === "success").map(entry => entry.receipt);
  if (!receipts.length || receipts.some(receipt => !receipt || receipt.customerId !== customerId
    || !Number.isSafeInteger(receipt.channelId) || receipt.channelId <= 0)) return null;
  const ids = new Set(receipts.map(receipt => receipt!.channelId));
  return ids.size === 1 ? receipts[0]!.channelId : null;
}

export function supplyLocation(channelId: number, tab: "channels" | "materials") {
  if (!Number.isSafeInteger(channelId) || channelId <= 0) throw new Error("无效渠道身份");
  return `/channel-inventory?supplyChannelId=${channelId}&supplyTab=${tab}`;
}

export function parseSupplyLocation(search: string): { channelId: number; tab: "channels" | "materials" } | null {
  const params = new URLSearchParams(search);
  if (!params.has("supplyChannelId") && !params.has("supplyTab")) return null;
  const raw = params.get("supplyChannelId") ?? "";
  const channelId = Number(raw);
  const tab = params.get("supplyTab");
  return /^\d+$/.test(raw) && Number.isSafeInteger(channelId) && channelId > 0
    && (tab === "channels" || tab === "materials")
    ? { channelId, tab } : { channelId: 0, tab: "channels" as const };
}
