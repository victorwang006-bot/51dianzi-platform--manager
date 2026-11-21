import { salesOrderDraftPayloadSchema } from "../../../shared/crmSalesOrderDrafts";
import { hasLockedSalesOrderDraft } from "./salesOrderDraftRecovery";
import {
  salesOrderDraftKey,
  type StoredSalesOrderDraft,
} from "./salesOrderDraftStore";

export type PreservedSalesOrderDraft = StoredSalesOrderDraft & {
  archiveId: string;
};
const prefix = (identity: string) =>
  `${salesOrderDraftKey(identity)}:preserved:`;
const validId = (id: string) => /^[a-zA-Z0-9_-]{8,100}$/.test(id);

export function loadPreservedSalesOrderDraft(
  identity: string,
  archiveId: string
): PreservedSalesOrderDraft | null {
  if (typeof window === "undefined" || !validId(archiveId)) return null;
  try {
    const raw = window.localStorage.getItem(prefix(identity) + archiveId);
    if (!raw) return null;
    const value = JSON.parse(raw);
    const parsed = salesOrderDraftPayloadSchema.safeParse(value.payload);
    if (
      !parsed.success ||
      hasLockedSalesOrderDraft(parsed.data) ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0 ||
      !Number.isFinite(value.savedAt)
    )
      return null;
    return {
      archiveId,
      payload: parsed.data,
      revision: value.revision,
      savedAt: value.savedAt,
      dirty: value.dirty === true,
    };
  } catch {
    return null;
  }
}

export function listPreservedSalesOrderDrafts(
  identity: string
): PreservedSalesOrderDraft[] {
  if (typeof window === "undefined") return [];
  try {
    const start = prefix(identity);
    const drafts: PreservedSalesOrderDraft[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(start)) continue;
      const draft = loadPreservedSalesOrderDraft(
        identity,
        key.slice(start.length)
      );
      if (draft) drafts.push(draft);
    }
    return drafts.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

/** Synchronous write + complete readback, under an exclusive random key; never overwrite. */
export function preserveSalesOrderDraft(
  identity: string,
  value: StoredSalesOrderDraft
): PreservedSalesOrderDraft | null {
  if (typeof window === "undefined" || hasLockedSalesOrderDraft(value.payload))
    return null;
  try {
    const archiveId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}_${Math.random().toString(36).slice(2, 18)}`;
    if (!validId(archiveId)) return null;
    const key = prefix(identity) + archiveId;
    if (window.localStorage.getItem(key) !== null) return null;
    const payload = salesOrderDraftPayloadSchema.parse(value.payload);
    const raw = JSON.stringify({ ...value, payload });
    window.localStorage.setItem(key, raw);
    if (window.localStorage.getItem(key) !== raw) return null;
    const restored = loadPreservedSalesOrderDraft(identity, archiveId);
    return restored &&
      JSON.stringify(restored.payload) === JSON.stringify(payload)
      ? restored
      : null;
  } catch {
    return null;
  }
}
