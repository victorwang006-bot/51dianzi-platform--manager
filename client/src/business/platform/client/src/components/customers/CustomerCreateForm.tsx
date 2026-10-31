import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { ConfirmDialog } from "./ConfirmDialog";
import { CustomerOwnershipLookup } from "./CustomerOwnershipLookup";
import { CustomerFields } from "./CustomerFields";
import { validateCustomerForm, type CustomerFieldErrors } from "./customerValidation";
import { EMPTY_CUSTOMER_FORM, customerPayloadFingerprint, errorMessage, isDuplicateConflict, makeCustomerRequestId, type CustomerFormState } from "./customerUtils";
import { trpc } from "../../../../../api/business-trpc";

export type CustomerCreateSaveMode = "close" | "continue";
export type CustomerCreateState = { dirty: boolean; busy: boolean };
type Props = {
  onCancel: () => void;
  onSaved: (result: { id: number; mode: CustomerCreateSaveMode }) => void;
  onStateChange: (state: CustomerCreateState) => void;
};
const secondary = "h-8 border-slate-300 bg-white px-3 text-xs text-slate-700 shadow-none hover:bg-slate-50";

export function CustomerCreateForm({ onCancel, onSaved, onStateChange }: Props) {
  const contextQuery = trpc.customer.context.useQuery();
  const [form, setForm] = useState<CustomerFormState>(EMPTY_CUSTOMER_FORM);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<CustomerFieldErrors>({});
  const [duplicateNotice, setDuplicateNotice] = useState("");
  const [pendingDuplicateConfirmation, setPendingDuplicateConfirmation] = useState<CustomerCreateSaveMode | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const requestIdRef = useRef(makeCustomerRequestId());
  const payloadFingerprintRef = useRef<string | null>(null);
  const defaultAssignee = contextQuery.data?.canManageAll ? String(contextQuery.data.actorUserId) : "";
  useEffect(() => {
    if (!defaultAssignee || form.assignedUserId) return;
    setForm(current => current.assignedUserId ? current : { ...current, assignedUserId: defaultAssignee });
  }, [defaultAssignee, form.assignedUserId]);
  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('[data-customer-field="name"]')?.focus({ preventScroll: true });
  }, []);
  const createMutation = trpc.customer.create.useMutation();
  const busy = saving || createMutation.isPending;
  const dirty = (Object.keys(form) as Array<keyof CustomerFormState>).some(key => key === "assignedUserId"
    ? (form.assignedUserId || defaultAssignee) !== defaultAssignee
    : form[key] !== EMPTY_CUSTOMER_FORM[key]);
  useEffect(() => onStateChange({ dirty, busy }), [dirty, busy, onStateChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const resolveRequestId = () => {
    const fingerprint = customerPayloadFingerprint(form);
    if (payloadFingerprintRef.current !== fingerprint) {
      requestIdRef.current = makeCustomerRequestId();
      payloadFingerprintRef.current = fingerprint;
    }
    return requestIdRef.current;
  };
  const save = async (mode: CustomerCreateSaveMode, confirmDuplicate = false) => {
    if (savingRef.current || createMutation.isPending || !contextQuery.data || contextQuery.isError) return;
    const parsed = validateCustomerForm(form);
    setFieldErrors(parsed.errors);
    setFormError("");
    if (!parsed.success) return;
    setDuplicateNotice("");
    savingRef.current = true;
    setSaving(true);
    try {
      const result = await createMutation.mutateAsync({ data: parsed.data, initialFollowUp: form.initialFollowUp.trim(), requestId: resolveRequestId(), confirmDuplicate });
      toast.success(result.replayed ? "已确认保存" : "客户已保存");
      setPendingDuplicateConfirmation(null);
      if (mode === "continue") {
        setForm({ ...EMPTY_CUSTOMER_FORM, assignedUserId: defaultAssignee });
        setFieldErrors({});
        setDuplicateNotice("");
        payloadFingerprintRef.current = null;
        requestIdRef.current = makeCustomerRequestId();
      }
      onSaved({ id: result.id, mode });
    } catch (error) {
      if (!confirmDuplicate && isDuplicateConflict(error)) {
        setDuplicateNotice("系统发现相似客户，请确认是否继续录入；无权限客户的资料不会展示。");
        setPendingDuplicateConfirmation(mode);
      } else setFormError(errorMessage(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  // Focus after the pending state clears so the input is no longer disabled.
  useEffect(() => {
    if (!busy && !dirty) formRef.current?.querySelector<HTMLInputElement>('[data-customer-field="name"]')?.focus({ preventScroll: true });
  }, [busy, dirty]);
  const saveDisabled = busy || contextQuery.isPending || contextQuery.isError;
  const assignee = contextQuery.data?.members.find(member => member.userId === contextQuery.data?.actorUserId)?.name;

  return <>
    <form ref={formRef} noValidate onSubmit={event => { event.preventDefault(); void save("close"); }} className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-testid="customer-create-form">
      <div className="border-b border-slate-100 px-3 py-3 sm:px-4">
        <h2 id="customer-entry-heading" className="text-sm font-semibold text-slate-800">录入客户</h2>
        <p className="mt-1 text-xs text-muted-foreground">客户名称、联系人和电话必填，其他资料可后续补充。</p>
      </div>
      <div className="p-3 sm:p-4">
        {contextQuery.isError && <InlineError message={errorMessage(contextQuery.error)} />}
        {formError && <InlineError message={formError} />}
        {duplicateNotice && <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{duplicateNotice}</p>}
        <CustomerFields value={form} onChange={setForm} members={contextQuery.data?.members ?? []} canManageAll={Boolean(contextQuery.data?.canManageAll)} currentAssigneeName={assignee} nameAction={<CustomerOwnershipLookup companyName={form.name} disabled={saveDisabled} />} includeInitialFollowUp disabled={busy} fieldErrors={fieldErrors} />
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-3 py-3 sm:px-4">
        <Button type="button" size="sm" variant="outline" className={secondary} disabled={busy} onClick={onCancel}>取消</Button>
        <Button type="button" size="sm" variant="outline" className={secondary} disabled={saveDisabled} onClick={() => void save("continue")}>保存并继续</Button>
        <Button type="submit" size="sm" className="h-8 bg-[#185FA5] px-4 text-xs text-white shadow-none hover:bg-[#0C447C]" disabled={saveDisabled}>{busy ? "保存中…" : "保存"}</Button>
      </div>
    </form>
    {pendingDuplicateConfirmation && <ConfirmDialog title="确认录入相似客户？" description="确认后按当前信息继续保存；无权限的既有客户资料不会展示。" confirmLabel="确认并继续保存" error={formError} busy={busy} onCancel={() => setPendingDuplicateConfirmation(null)} onConfirm={() => void save(pendingDuplicateConfirmation, true)} />}
  </>;
}
function InlineError({ message }: { message: string }) {
  return <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{message}</div>;
}
