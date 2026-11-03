import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { useCustomerCreateDraft, useCustomerCreateDraftIdentity } from "../../hooks/useCustomerCreateDraft";
import type { CustomerCreatePendingSave, CustomerCreateSaveMode } from "../../lib/customerCreateDraftStore";
import { ConfirmDialog } from "./ConfirmDialog";
import { CustomerOwnershipLookup } from "./CustomerOwnershipLookup";
import { CustomerFields } from "./CustomerFields";
import { CustomerContactsDrafts } from "./CustomerContactFields";
import {
  contactErrorMessage,
  contactInput,
  customerContactBaseData,
  emptyContact,
  isDuplicateContactConflict,
  isUnknownContactOutcome,
  useCustomerContactScope,
  validateContactSet,
  validateCustomerContactBase,
  withCustomerContactScope,
  type ContactDraft,
} from "./customerContacts";
import {
  EMPTY_CUSTOMER_FORM,
  makeCustomerRequestId,
  type CustomerFormState,
} from "./customerUtils";
import type { CustomerFieldErrors } from "./customerValidation";
import { trpc } from "../../../../../api/business-trpc";

export type { CustomerCreateSaveMode } from "../../lib/customerCreateDraftStore";
export type CustomerCreateState = { dirty: boolean; busy: boolean };
type Props = {
  /** Hides the panel while preserving its identity-scoped draft. */
  onCollapse: () => void;
  /** Runs only after the operator explicitly abandons the draft. */
  onDiscarded: () => void;
  onSaved: (result: { id: number; mode: CustomerCreateSaveMode }) => void;
  onStateChange: (state: CustomerCreateState) => void;
  /** Parent closes immediately when an account, enterprise, or binding changes. */
  onIdentityInvalidated?: () => void;
  /** Lets CustomerList and the form share one already-verified namespace. */
  draftIdentity?: string | null;
};

const secondary = "h-8 border-slate-300 bg-white px-3 text-xs text-slate-700 shadow-none hover:bg-slate-50";

export function CustomerCreateForm({
  onCollapse,
  onDiscarded,
  onSaved,
  onStateChange,
  onIdentityInvalidated,
  draftIdentity: suppliedDraftIdentity,
}: Props) {
  const contextQuery = trpc.customer.context.useQuery();
  const { scope, ready: scopeReady } = useCustomerContactScope(contextQuery.data);
  const computedDraftIdentity = useCustomerCreateDraftIdentity(scope, scopeReady, contextQuery.isPending && !contextQuery.isError);
  const draftIdentity = suppliedDraftIdentity === undefined ? computedDraftIdentity : suppliedDraftIdentity;
  const createMutation = trpc.customer.createMulti.useMutation();
  const defaultAssignee = contextQuery.data?.canManageAll ? String(contextQuery.data.actorUserId ?? "") : "";
  const fallback = useMemo(() => ({
    form: { ...EMPTY_CUSTOMER_FORM, assignedUserId: defaultAssignee },
    contacts: [emptyContact(true)],
    request: null,
    pendingSave: null,
  }), [defaultAssignee]);
  const {
    draft,
    hasStoredDraft,
    update: updateDraft,
    clear: clearDraft,
    complete: completeDraft,
    consumeCompletion,
    replacePending,
  } = useCustomerCreateDraft(draftIdentity, fallback);
  const form = draft.form;
  const contacts = draft.contacts;
  const pendingSave = draft.pendingSave;
  const [formError, setFormError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const activeDraftIdentityRef = useRef(draftIdentity);
  const knownReadyIdentityRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const formRef = useRef<HTMLFormElement>(null);

  activeDraftIdentityRef.current = draftIdentity;

  const setForm = useCallback<Dispatch<SetStateAction<CustomerFormState>>>(next => {
    updateDraft(current => ({
      ...current,
      form: typeof next === "function" ? next(current.form) : next,
    }));
  }, [updateDraft]);
  const setContacts = useCallback<Dispatch<SetStateAction<ContactDraft[]>>>(next => {
    updateDraft(current => ({
      ...current,
      contacts: typeof next === "function" ? next(current.contacts) : next,
    }));
  }, [updateDraft]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const previous = knownReadyIdentityRef.current;
    if (previous && previous !== draftIdentity) onIdentityInvalidated?.();
    if (draftIdentity) knownReadyIdentityRef.current = draftIdentity;
  }, [draftIdentity, onIdentityInvalidated]);

  useEffect(() => {
    if (!defaultAssignee || form.assignedUserId) return;
    setForm(current => current.assignedUserId ? current : { ...current, assignedUserId: defaultAssignee });
  }, [defaultAssignee, form.assignedUserId, setForm]);

  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('[data-customer-field="name"]')?.focus({ preventScroll: true });
  }, []);

  const pristineContact = contacts.length === 1
    && contacts[0].isPrimary
    && !contacts[0].name.trim()
    && !contacts[0].department.trim()
    && !contacts[0].position.trim()
    && contacts[0].methods.length === 1
    && !contacts[0].methods[0]?.value.trim()
    && !contacts[0].methods[0]?.label?.trim();
  const dirty = (Object.keys(form) as Array<keyof CustomerFormState>).some(key => key === "assignedUserId"
    ? (form.assignedUserId || defaultAssignee) !== defaultAssignee
    : form[key] !== EMPTY_CUSTOMER_FORM[key]) || !pristineContact;
  const busy = saving || createMutation.isPending || Boolean(pendingSave);

  useEffect(() => onStateChange({ dirty, busy }), [busy, dirty, onStateChange]);
  // Preserve the original continuous-entry focus after pending inputs re-enable.
  useEffect(() => {
    if (!busy && !dirty) formRef.current?.querySelector<HTMLInputElement>('[data-customer-field="name"]')?.focus({ preventScroll: true });
  }, [busy, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const validate = () => {
    const next = {
      ...validateCustomerContactBase(form),
      ...validateContactSet(contacts),
    };
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const save = async (mode: CustomerCreateSaveMode, forced?: CustomerCreatePendingSave) => {
    if (savingRef.current || createMutation.isPending || !scope || !scopeReady || !draftIdentity || contextQuery.isPending || contextQuery.isError) return;
    if (!forced && pendingSave) return;
    if (!forced && !validate()) return;
    const data = customerContactBaseData(form);
    const contactPayload = contacts.map(contact => ({ ...contactInput(contact), isPrimary: contact.isPrimary }));
    const fingerprint = JSON.stringify({
      scope: `${scope.enterpriseId}:${scope.actorUserId}`,
      data,
      contacts: contactPayload,
      initialFollowUp: form.initialFollowUp.trim(),
    });
    if (forced && forced.fingerprint !== fingerprint) {
      // A legacy/changed frozen payload may already have committed. Never unlock it
      // or reuse its requestId with the upgraded form payload.
      setFormError("请先核对客户保存结果；原请求已保留，勿重复录入。");
      return;
    }
    const persisted = updateDraft(current => {
      const request = forced
        ? { requestId: forced.requestId, fingerprint: forced.fingerprint }
        : current.request?.fingerprint === fingerprint
          ? current.request
          : { fingerprint, requestId: makeCustomerRequestId() };
      return {
        ...current,
        request,
        pendingSave: {
          kind: "saving",
          mode,
          requestId: request.requestId,
          fingerprint: request.fingerprint,
          confirmDuplicate: Boolean(forced?.confirmDuplicate),
        },
      };
    });
    if (!persisted?.request) return;
    const requestId = persisted.request.requestId;
    const draftToken = persisted.token;
    const scopeAtStart = draftIdentity;
    savingRef.current = true;
    setSaving(true);
    setFormError("");
    try {
      const result = await createMutation.mutateAsync(withCustomerContactScope(scope, {
        data,
        contacts: contactPayload,
        initialFollowUp: form.initialFollowUp.trim(),
        requestId,
        confirmDuplicate: Boolean(forced?.confirmDuplicate),
      }));
      const accepted = activeDraftIdentityRef.current === scopeAtStart
        && completeDraft(draftToken, { id: Number(result.id), mode });
      if (!accepted) return;
      if (!mountedRef.current) return;
      setErrors({});
      setFormError("");
      toast.success(result.replayed ? "已确认保存" : "客户已保存");
      // The mounted parent can act immediately. A parent that was unmounted
      // consumes the completion from the same identity when it returns.
      consumeCompletion();
      onSaved({ id: Number(result.id), mode });
    } catch (error) {
      if (activeDraftIdentityRef.current !== scopeAtStart) return;
      if (!forced?.confirmDuplicate && isDuplicateContactConflict(error)) {
        replacePending(draftToken, {
          kind: "duplicate",
          mode,
          requestId,
          fingerprint,
          confirmDuplicate: true,
        });
      } else if (isUnknownContactOutcome(error)) {
        replacePending(draftToken, {
          kind: "unknown",
          mode,
          requestId,
          fingerprint,
          confirmDuplicate: Boolean(forced?.confirmDuplicate),
        });
      } else {
        replacePending(draftToken, null);
        if (mountedRef.current) setFormError(contactErrorMessage(error));
      }
    } finally {
      if (mountedRef.current && activeDraftIdentityRef.current === scopeAtStart) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };

  const discard = () => {
    if (busy) return;
    clearDraft();
    setErrors({});
    setFormError("");
    setConfirmDiscard(false);
    onDiscarded();
  };
  const requestDiscard = () => {
    if (busy) return;
    if (dirty) setConfirmDiscard(true);
    else discard();
  };

  const saveDisabled = busy || contextQuery.isPending || contextQuery.isError || !scopeReady || !draftIdentity;
  const assignee = contextQuery.data?.members.find(member => member.userId === contextQuery.data?.actorUserId)?.name;
  const customerErrors = errors as CustomerFieldErrors;
  const preservingNotice = hasStoredDraft && !dirty && !pendingSave ? "已保留草稿" : null;

  return <>
    <form ref={formRef} noValidate onSubmit={event => { event.preventDefault(); void save("close"); }} className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-testid="customer-create-form">
      <div className="border-b border-slate-100 px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="customer-entry-heading" className="text-sm font-semibold text-slate-800">录入客户</h2>
          {preservingNotice ? <span className="text-[11px] text-slate-500" role="status">{preservingNotice}</span> : null}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">客户基本资料与联系人分开维护；每位联系人均需姓名和至少一种有效联系方式。</p>
      </div>
      <div className="p-3 sm:p-4">
        {contextQuery.isError ? <InlineError message={contactErrorMessage(contextQuery.error)} /> : null}
        {!scopeReady && !contextQuery.isPending && !contextQuery.isError ? <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">当前登录身份或企业上下文尚未确认，已暂停保存。</p> : null}
        {pendingSave?.kind === "saving" ? <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">正在保存本次客户资料；切换页面后会继续使用同一请求编号确认结果。</p> : null}
        {formError ? <InlineError message={formError} /> : null}
        <CustomerFields value={form} onChange={setForm} members={contextQuery.data?.members ?? []} canManageAll={Boolean(contextQuery.data?.canManageAll)} currentAssigneeName={assignee} nameAction={<CustomerOwnershipLookup companyName={form.name} disabled={saveDisabled} />} includeInitialFollowUp includeLegacyContactFields={false} disabled={saveDisabled} fieldErrors={customerErrors} />
      </div>
      <CustomerContactsDrafts contacts={contacts} setContacts={setContacts} disabled={saveDisabled} errors={errors} />
      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-3 py-3 sm:px-4">
        <Button type="button" size="sm" variant="outline" className={secondary} disabled={busy} onClick={onCollapse}>收起</Button>
        <Button type="button" size="sm" variant="outline" className={secondary} disabled={busy} onClick={requestDiscard}>放弃填写</Button>
        <Button type="button" size="sm" variant="outline" className={secondary} disabled={saveDisabled} onClick={() => void save("continue")}>保存并继续</Button>
        <Button type="submit" size="sm" className="h-8 bg-[#185FA5] px-4 text-xs text-white shadow-none hover:bg-[#0C447C]" disabled={saveDisabled}>{saving || createMutation.isPending ? "保存中…" : "保存"}</Button>
      </div>
    </form>
    {pendingSave?.kind === "duplicate" ? <ConfirmDialog title="确认保留相似联系人或联系方式？" description="确认后会按当前资料保存，不会自动合并或覆盖；无权限的既有客户资料不会展示。" confirmLabel="确认并继续保存" error={formError} busy={saving || createMutation.isPending} onCancel={() => replacePending(draft.token, null)} onConfirm={() => void save(pendingSave.mode, pendingSave)} /> : null}
    {pendingSave?.kind === "unknown" ? <ConfirmDialog title="正在确认保存结果" description="网络结果未知。为避免重复录入，内容已锁定；请使用同一请求编号确认结果。" confirmLabel="使用相同内容重试" error={formError} busy={saving || createMutation.isPending} onCancel={() => undefined} onConfirm={() => void save(pendingSave.mode, pendingSave)} /> : null}
    {confirmDiscard ? <ConfirmDialog title="放弃未保存的客户信息？" description="放弃后会明确清空当前客户资料、全部联系人和首次跟进备注。" confirmLabel="放弃填写" onCancel={() => setConfirmDiscard(false)} onConfirm={discard} /> : null}
  </>;
}

function InlineError({ message }: { message: string }) {
  return <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{message}</div>;
}
