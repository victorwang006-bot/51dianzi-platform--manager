import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
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

export type CustomerCreateSaveMode = "close" | "continue";
export type CustomerCreateState = { dirty: boolean; busy: boolean };
type Props = {
  onCancel: () => void;
  onSaved: (result: { id: number; mode: CustomerCreateSaveMode }) => void;
  onStateChange: (state: CustomerCreateState) => void;
  /** Parent closes immediately when an account or enterprise switch invalidates this draft. */
  onIdentityInvalidated?: () => void;
};

type PendingSave = {
  mode: CustomerCreateSaveMode;
  requestId: string;
  fingerprint: string;
  confirmDuplicate: boolean;
};

const secondary = "h-8 border-slate-300 bg-white px-3 text-xs text-slate-700 shadow-none hover:bg-slate-50";

export function CustomerCreateForm({ onCancel, onSaved, onStateChange, onIdentityInvalidated }: Props) {
  const contextQuery = trpc.customer.context.useQuery();
  const { scope, ready: scopeReady, identityKey } = useCustomerContactScope(contextQuery.data);
  const createMutation = trpc.customer.createMulti.useMutation();
  const [form, setForm] = useState<CustomerFormState>(EMPTY_CUSTOMER_FORM);
  const [contacts, setContacts] = useState<ContactDraft[]>(() => [emptyContact(true)]);
  const [formError, setFormError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingDuplicate, setPendingDuplicate] = useState<PendingSave | null>(null);
  const [unknownSave, setUnknownSave] = useState<PendingSave | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const requestRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const activeIdentityRef = useRef(identityKey);
  const knownReadyIdentityRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const formRef = useRef<HTMLFormElement>(null);

  activeIdentityRef.current = identityKey;
  const defaultAssignee = contextQuery.data?.canManageAll ? String(contextQuery.data.actorUserId ?? "") : "";

  const resetDraft = () => {
    setForm({ ...EMPTY_CUSTOMER_FORM, assignedUserId: defaultAssignee });
    setContacts([emptyContact(true)]);
    setErrors({});
    setFormError("");
    setPendingDuplicate(null);
    setUnknownSave(null);
    requestRef.current = null;
    savingRef.current = false;
    setSaving(false);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (knownReadyIdentityRef.current && knownReadyIdentityRef.current !== identityKey) {
      resetDraft();
      onIdentityInvalidated?.();
    }
    if (scopeReady) knownReadyIdentityRef.current = identityKey;
  }, [identityKey, onIdentityInvalidated, scopeReady]);

  useEffect(() => {
    if (!defaultAssignee || form.assignedUserId) return;
    setForm(current => current.assignedUserId ? current : { ...current, assignedUserId: defaultAssignee });
  }, [defaultAssignee, form.assignedUserId]);

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
  const busy = saving || createMutation.isPending || Boolean(pendingDuplicate) || Boolean(unknownSave);

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

  const resolveRequestId = (fingerprint: string) => {
    if (!requestRef.current || requestRef.current.fingerprint !== fingerprint) {
      requestRef.current = { fingerprint, requestId: makeCustomerRequestId() };
    }
    return requestRef.current.requestId;
  };

  const validate = () => {
    const next = {
      ...validateCustomerContactBase(form),
      ...validateContactSet(contacts),
    };
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const save = async (mode: CustomerCreateSaveMode, forced?: PendingSave) => {
    if (savingRef.current || createMutation.isPending || !scope || !scopeReady || contextQuery.isPending || contextQuery.isError) return;
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
      setFormError("内容已变化，不能确认原保存请求。请重新保存。");
      setPendingDuplicate(null);
      setUnknownSave(null);
      return;
    }
    const requestId = forced?.requestId ?? resolveRequestId(fingerprint);
    const scopeAtStart = identityKey;
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
      if (!mountedRef.current || activeIdentityRef.current !== scopeAtStart) return;
      setPendingDuplicate(null);
      setUnknownSave(null);
      toast.success(result.replayed ? "已确认保存" : "客户已保存");
      if (mode === "continue") resetDraft();
      onSaved({ id: Number(result.id), mode });
    } catch (error) {
      if (!mountedRef.current || activeIdentityRef.current !== scopeAtStart) return;
      if (!forced?.confirmDuplicate && isDuplicateContactConflict(error)) {
        setPendingDuplicate({ mode, requestId, fingerprint, confirmDuplicate: true });
      } else if (isUnknownContactOutcome(error)) {
        setUnknownSave({ mode, requestId, fingerprint, confirmDuplicate: Boolean(forced?.confirmDuplicate) });
      } else {
        setFormError(contactErrorMessage(error));
      }
    } finally {
      if (mountedRef.current && activeIdentityRef.current === scopeAtStart) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };

  const saveDisabled = busy || contextQuery.isPending || contextQuery.isError || !scopeReady;
  const assignee = contextQuery.data?.members.find(member => member.userId === contextQuery.data?.actorUserId)?.name;
  const customerErrors = errors as CustomerFieldErrors;

  return <>
    <form ref={formRef} noValidate onSubmit={event => { event.preventDefault(); void save("close"); }} className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-testid="customer-create-form">
      <div className="border-b border-slate-100 px-3 py-3 sm:px-4">
        <h2 id="customer-entry-heading" className="text-sm font-semibold text-slate-800">录入客户</h2>
        <p className="mt-1 text-xs text-muted-foreground">客户基本资料与联系人分开维护；每位联系人均需姓名和至少一种有效联系方式。</p>
      </div>
      <div className="p-3 sm:p-4">
        {contextQuery.isError ? <InlineError message={contactErrorMessage(contextQuery.error)} /> : null}
        {!scopeReady && !contextQuery.isPending && !contextQuery.isError ? <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">当前登录身份或企业上下文尚未确认，已暂停保存。</p> : null}
        {formError ? <InlineError message={formError} /> : null}
        <CustomerFields value={form} onChange={setForm} members={contextQuery.data?.members ?? []} canManageAll={Boolean(contextQuery.data?.canManageAll)} currentAssigneeName={assignee} nameAction={<CustomerOwnershipLookup companyName={form.name} disabled={saveDisabled} />} includeInitialFollowUp includeLegacyContactFields={false} disabled={busy} fieldErrors={customerErrors} />
      </div>
      <CustomerContactsDrafts contacts={contacts} setContacts={setContacts} disabled={saveDisabled} errors={errors} />
      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-3 py-3 sm:px-4">
        <Button type="button" size="sm" variant="outline" className={secondary} disabled={busy} onClick={onCancel}>取消</Button>
        <Button type="button" size="sm" variant="outline" className={secondary} disabled={saveDisabled} onClick={() => void save("continue")}>保存并继续</Button>
        <Button type="submit" size="sm" className="h-8 bg-[#185FA5] px-4 text-xs text-white shadow-none hover:bg-[#0C447C]" disabled={saveDisabled}>{saving || createMutation.isPending ? "保存中…" : "保存"}</Button>
      </div>
    </form>
    {pendingDuplicate ? <ConfirmDialog title="确认保留相似联系人或联系方式？" description="确认后会按当前资料保存，不会自动合并或覆盖；无权限的既有客户资料不会展示。" confirmLabel="确认并继续保存" error={formError} busy={saving || createMutation.isPending} onCancel={() => setPendingDuplicate(null)} onConfirm={() => void save(pendingDuplicate.mode, pendingDuplicate)} /> : null}
    {unknownSave ? <ConfirmDialog title="正在确认保存结果" description="网络结果未知。为避免重复录入，内容已锁定；请使用同一请求编号确认结果。" confirmLabel="使用相同内容重试" busy={saving || createMutation.isPending} onCancel={() => undefined} onConfirm={() => void save(unknownSave.mode, unknownSave)} /> : null}
  </>;
}

function InlineError({ message }: { message: string }) {
  return <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{message}</div>;
}
