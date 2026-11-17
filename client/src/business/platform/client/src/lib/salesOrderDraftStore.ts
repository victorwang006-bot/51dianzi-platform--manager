import {
  salesOrderDraftPayloadSchema,
  type SalesOrderDraftPayload,
} from "../../../shared/crmSalesOrderDrafts";
import {
  salesOrderCreateSchema,
  salesOrderCompanyStockCreateSchema,
} from "../../../shared/crmSalesOrders";

export type StoredSalesOrderDraft = {
  payload: SalesOrderDraftPayload;
  revision: number;
  savedAt: number;
  dirty: boolean;
};
const PREFIX = "d51:sales-order-draft:v1:";
export function salesOrderDraftKey(identity: string) {
  return `${PREFIX}${encodeURIComponent(identity)}`;
}
export function loadSalesOrderDraft(
  identity: string | null
): StoredSalesOrderDraft | null {
  if (!identity || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(salesOrderDraftKey(identity));
    if (!raw) return null;
    const value = JSON.parse(raw);
    const payload = salesOrderDraftPayloadSchema.safeParse(value.payload);
    if (
      !payload.success ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0 ||
      !Number.isFinite(value.savedAt)
    )
      return null;
    return {
      payload: payload.data,
      revision: value.revision,
      savedAt: value.savedAt,
      dirty: value.dirty === true,
    };
  } catch {
    return null;
  }
}
export function saveSalesOrderDraft(
  identity: string | null,
  value: StoredSalesOrderDraft
): boolean {
  if (!identity || typeof window === "undefined") return false;
  try {
    const payload = salesOrderDraftPayloadSchema.parse(value.payload);
    window.localStorage.setItem(
      salesOrderDraftKey(identity),
      JSON.stringify({ ...value, payload })
    );
    return true;
  } catch {
    return false;
  }
}
/** Explicit conflict recovery keeps the old editable form locally; never backs up/drops a pending request. */
export function backupSalesOrderDraft(identity: string, value: StoredSalesOrderDraft): boolean {
  if (typeof window === "undefined" || pendingSalesOrderRequest(value.payload)) return false;
  try {
    const payload = salesOrderDraftPayloadSchema.parse(value.payload);
    window.localStorage.setItem(`${salesOrderDraftKey(identity)}:conflict-backup`, JSON.stringify({ ...value, payload }));
    return true;
  } catch {
    return false;
  }
}
export function clearSalesOrderDraft(identity: string | null) {
  if (!identity || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(salesOrderDraftKey(identity));
  } catch {
    /* A success tombstone is also retained by the hook. */
  }
}
export function pendingSalesOrderRequest(
  payload: SalesOrderDraftPayload | null | undefined
) {
  return payload?.source === "company_stock"
    ? payload.company?.uncertain
    : payload?.form?.pendingRequest;
}
/** A malformed frozen request must stay locked; never silently reinterpret it as an editable draft. */
export function validatePendingSalesOrderRequest(
  payload: SalesOrderDraftPayload
) {
  const pending = pendingSalesOrderRequest(payload);
  if (!pending) return null;
  const result =
    payload.source === "company_stock"
      ? salesOrderCompanyStockCreateSchema.safeParse(pending)
      : salesOrderCreateSchema.safeParse(pending);
  return result.success ? result.data : null;
}
export function draftPayloadEqual(
  left: SalesOrderDraftPayload,
  right: SalesOrderDraftPayload
) {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map(key => [
                key,
                canonical((value as Record<string, unknown>)[key]),
              ])
          )
        : value;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
/** Server is authoritative, except a locally frozen in-flight create must never be dropped. */
export function chooseSalesOrderDraft(
  server: StoredSalesOrderDraft | null,
  local: StoredSalesOrderDraft | null,
  emptyRevision?: number
) {
  if (local?.payload.form?.completed === true) {
    // A failed delete must not revive the exact order that already succeeded.
    // A different server draft belongs to newer work and remains authoritative.
    const { completed: _completed, ...form } = local.payload.form;
    const original = { ...local.payload, form };
    return {
      draft:
        !server ||
        server.payload.form?.completed === true ||
        draftPayloadEqual(server.payload, original)
          ? null
          : server,
      conflict: false,
    };
  }
  // A verified tombstone is not an unread/offline server. Preserve old work for
  // inspection, but never rebase it (including a delayed first save at 0) onto
  // a later deletion's CAS token. Same-token dirty edits belong to a new draft.
  if (
    !server &&
    local &&
    emptyRevision !== undefined &&
    local.revision !== emptyRevision
  )
    return { draft: local, conflict: true };
  if (server?.payload.form?.completed === true) server = null;
  if (local && pendingSalesOrderRequest(local.payload)) {
    if (server && !draftPayloadEqual(server.payload, local.payload))
      return { draft: local, conflict: true };
    return { draft: server ?? local, conflict: false };
  }
  if (
    local?.dirty &&
    server &&
    !draftPayloadEqual(server.payload, local.payload)
  ) {
    return { draft: local, conflict: local.revision !== server.revision };
  }
  return { draft: server ?? local, conflict: false };
}
