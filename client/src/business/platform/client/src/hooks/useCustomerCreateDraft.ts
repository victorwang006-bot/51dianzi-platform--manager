import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { CustomerContactScope } from "../components/customers/customerContacts";
import type { ContactDraft } from "../components/customers/customerContacts";
import type { CustomerFormState } from "../components/customers/customerUtils";
import {
  clearCustomerCreateDraft,
  completeCustomerCreateDraft,
  consumeCustomerCreateCompletion,
  customerCreateDraftEntry,
  customerCreateDraftIdentityForNamespace,
  replaceCustomerCreatePendingSave,
  retainOnlyCustomerCreateDraftIdentity,
  subscribeCustomerCreateDrafts,
  updateCustomerCreateDraft,
  type CustomerCreateCompletion,
  type CustomerCreateDraft,
  type CustomerCreatePendingSave,
  type CustomerCreateRequest,
} from "../lib/customerCreateDraftStore";
import { usePageIdentity } from "./usePageIdentity";

export type CustomerCreateDraftFallback = {
  form: CustomerFormState;
  contacts: ContactDraft[];
  request: CustomerCreateRequest | null;
  pendingSave: CustomerCreatePendingSave | null;
};

/**
 * `usePageIdentity` is intentionally the root namespace: on the ordinary front
 * it is account + enterprise; in the business workbench it is the BFF-proven
 * staff/admin/enterprise/merchant/binding-version namespace. The additional
 * actor/enterprise fields make the customer procedure's principal explicit.
 */
export function useCustomerCreateDraftIdentity(
  scope: CustomerContactScope | null,
  scopeReady: boolean,
  contextResolving = false,
): string | null {
  const pageIdentity = usePageIdentity();
  return useMemo(() => {
    if (!pageIdentity) return null;
    if (!scopeReady || !scope) {
      return contextResolving ? customerCreateDraftIdentityForNamespace(pageIdentity) : null;
    }
    return `${pageIdentity}:customer-create:actor:${scope.actorUserId}:enterprise:${scope.enterpriseId}:manage-all:${scope.canManageAll ? "yes" : "no"}`;
  }, [contextResolving, pageIdentity, scope, scopeReady]);
}

export function useCustomerCreateDraft(
  identity: string | null,
  fallback: CustomerCreateDraftFallback,
) {
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  const previousIdentity = useRef<string | null>(null);
  const subscribe = useCallback((listener: () => void) => subscribeCustomerCreateDrafts(listener), []);
  const snapshot = useCallback(() => customerCreateDraftEntry(identity), [identity]);
  const entry = useSyncExternalStore(subscribe, snapshot, snapshot);

  // Preserve the active identity through ordinary route unmounts, but physically
  // remove prior bodies when account/enterprise/binding identity changes or fails.
  useEffect(() => {
    const previous = previousIdentity.current;
    if (previous && previous !== identity) clearCustomerCreateDraft(previous);
    retainOnlyCustomerCreateDraftIdentity(identity);
    previousIdentity.current = identity;
  }, [identity]);

  const transientDraft = useMemo<CustomerCreateDraft>(() => ({
    token: "",
    form: { ...fallback.form },
    contacts: fallback.contacts.map(contact => ({
      ...contact,
      methods: contact.methods.map(method => ({ ...method })),
    })),
    request: fallback.request ? { ...fallback.request } : null,
    pendingSave: fallback.pendingSave ? { ...fallback.pendingSave } : null,
  }), [fallback.contacts, fallback.form, fallback.pendingSave, fallback.request]);
  const draft = entry.draft ?? transientDraft;

  const update = useCallback((change: (current: CustomerCreateDraft) => CustomerCreateDraft) => {
    if (!identity) return null;
    return updateCustomerCreateDraft(identity, fallbackRef.current, change);
  }, [identity]);

  const clear = useCallback(() => clearCustomerCreateDraft(identity), [identity]);
  const complete = useCallback((draftToken: string, completion: CustomerCreateCompletion) =>
    Boolean(identity && completeCustomerCreateDraft(identity, draftToken, completion)), [identity]);
  const consumeCompletion = useCallback(() => consumeCustomerCreateCompletion(identity), [identity]);
  const replacePending = useCallback((draftToken: string, pendingSave: CustomerCreatePendingSave | null) =>
    Boolean(identity && replaceCustomerCreatePendingSave(identity, draftToken, pendingSave)), [identity]);

  return {
    draft,
    hasStoredDraft: Boolean(entry.draft),
    completion: entry.completion,
    update,
    clear,
    complete,
    consumeCompletion,
    replacePending,
  };
}
