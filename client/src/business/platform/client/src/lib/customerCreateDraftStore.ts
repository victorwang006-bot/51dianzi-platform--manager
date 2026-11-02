import type { ContactDraft } from "../components/customers/customerContacts";
import type { CustomerFormState } from "../components/customers/customerUtils";
import { installAuthSessionClearListener } from "./authSessionEvents";
import { PAGE_IDENTITY_CHANGED_EVENT } from "./pageMemory";

/** Dispatched by the business workbench only after a real binding/access loss. */
export const CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT = "d51:customer-entry-drafts-invalidated";

export type CustomerCreateSaveMode = "close" | "continue";
export type CustomerCreatePendingKind = "saving" | "duplicate" | "unknown";

export type CustomerCreateRequest = {
  fingerprint: string;
  requestId: string;
};

export type CustomerCreatePendingSave = CustomerCreateRequest & {
  kind: CustomerCreatePendingKind;
  mode: CustomerCreateSaveMode;
  confirmDuplicate: boolean;
};

export type CustomerCreateDraft = {
  /** Changes whenever a cleared identity starts a fresh draft. Async work must match it. */
  token: string;
  form: CustomerFormState;
  contacts: ContactDraft[];
  request: CustomerCreateRequest | null;
  pendingSave: CustomerCreatePendingSave | null;
};

export type CustomerCreateCompletion = {
  id: number;
  mode: CustomerCreateSaveMode;
};

type DraftEntry = {
  draft: CustomerCreateDraft | null;
  completion: CustomerCreateCompletion | null;
};

const EMPTY_ENTRY: DraftEntry = { draft: null, completion: null };
const entries = new Map<string, DraftEntry>();
const listeners = new Set<() => void>();

function token() {
  return globalThis.crypto?.randomUUID?.()
    ?? `customer-draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function cloneContacts(contacts: ContactDraft[]): ContactDraft[] {
  return contacts.map(contact => ({
    ...contact,
    methods: contact.methods.map(method => ({ ...method })),
  }));
}

function cloneDraft(draft: CustomerCreateDraft): CustomerCreateDraft {
  return {
    ...draft,
    form: { ...draft.form },
    contacts: cloneContacts(draft.contacts),
    request: draft.request ? { ...draft.request } : null,
    pendingSave: draft.pendingSave ? { ...draft.pendingSave } : null,
  };
}

function publish(identity: string, entry: DraftEntry) {
  if (!entry.draft && !entry.completion) entries.delete(identity);
  else entries.set(identity, entry);
  listeners.forEach(listener => listener());
}

/**
 * Customer form bodies are deliberately held only in this module's memory.
 * They never enter pageMemory, URLs, localStorage, or sessionStorage.
 */
export function customerCreateDraftEntry(identity: string | null): DraftEntry {
  return identity ? entries.get(identity) ?? EMPTY_ENTRY : EMPTY_ENTRY;
}

/** A pending context may resume only the one previously verified namespace. */
export function customerCreateDraftIdentityForNamespace(namespace: string | null): string | null {
  if (!namespace) return null;
  const prefix = `${namespace}:customer-create:`;
  const matches = Array.from(entries.keys()).filter(identity => identity.startsWith(prefix));
  return matches.length === 1 ? matches[0] : null;
}

export function subscribeCustomerCreateDrafts(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Applies an edit under a concrete identity. A fresh token is minted only when
 * the caller starts after a clear/invalidation; it is the fence for late saves.
 */
export function updateCustomerCreateDraft(
  identity: string,
  fallback: Omit<CustomerCreateDraft, "token">,
  update: (draft: CustomerCreateDraft) => CustomerCreateDraft,
): CustomerCreateDraft {
  const existing = entries.get(identity)?.draft;
  const base: CustomerCreateDraft = existing
    ? cloneDraft(existing)
    : { ...fallback, token: token(), form: { ...fallback.form }, contacts: cloneContacts(fallback.contacts) };
  const next = cloneDraft(update(base));
  // A caller must not accidentally carry a token from another identity/draft.
  next.token = base.token;
  publish(identity, { draft: next, completion: null });
  return next;
}

export function clearCustomerCreateDraft(identity: string | null) {
  if (!identity || !entries.has(identity)) return;
  publish(identity, EMPTY_ENTRY);
}

/** Remove every previous identity's business body after an identity transition. */
export function retainOnlyCustomerCreateDraftIdentity(identity: string | null) {
  let changed = false;
  for (const key of Array.from(entries.keys())) {
    if (identity && key === identity) continue;
    entries.delete(key);
    changed = true;
  }
  if (changed) listeners.forEach(listener => listener());
}

/** Clear all sensitive form bodies, pending request ids, and completion notices. */
export function clearAllCustomerCreateDrafts() {
  if (!entries.size) return;
  entries.clear();
  listeners.forEach(listener => listener());
}

/**
 * Marks a successful request only if it belongs to the still-current draft
 * instance. A late response can therefore never close or replace a new draft.
 */
export function completeCustomerCreateDraft(
  identity: string,
  draftToken: string,
  completion: CustomerCreateCompletion,
): boolean {
  const entry = entries.get(identity);
  if (!entry?.draft || entry.draft.token !== draftToken) return false;
  publish(identity, { draft: null, completion: { ...completion } });
  return true;
}

export function consumeCustomerCreateCompletion(identity: string | null) {
  if (!identity) return;
  const entry = entries.get(identity);
  if (!entry?.completion) return;
  publish(identity, { draft: entry.draft, completion: null });
}

/** Applies a retry-state transition only to the request's original draft. */
export function replaceCustomerCreatePendingSave(
  identity: string,
  draftToken: string,
  pendingSave: CustomerCreatePendingSave | null,
): boolean {
  const entry = entries.get(identity);
  if (!entry?.draft || entry.draft.token !== draftToken) return false;
  publish(identity, {
    draft: {
      ...cloneDraft(entry.draft),
      pendingSave: pendingSave ? { ...pendingSave } : null,
    },
    completion: null,
  });
  return true;
}

/** Test-only reset; production flows always use identity-scoped cleanup. */
export function __resetCustomerCreateDraftStoreForTests() {
  clearAllCustomerCreateDrafts();
}

// This module is loaded only by customer-entry UI. Once loaded, logout must
// still clear its in-memory data even if that route has already unmounted.
if (typeof window !== "undefined") {
  installAuthSessionClearListener(clearAllCustomerCreateDrafts);
  window.addEventListener(CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT, clearAllCustomerCreateDrafts);
  window.addEventListener(PAGE_IDENTITY_CHANGED_EVENT, clearAllCustomerCreateDrafts);
}
