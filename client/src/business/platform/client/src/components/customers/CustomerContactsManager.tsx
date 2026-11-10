import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { trpc } from "../../../../../api/business-trpc";
import type {
  ContactChangeResult,
  ContactsAddInput,
  ContactsEditInput,
  ContactsListInput,
  ContactsSetPrimaryInput,
  ContactsStopInput,
} from "../../../../shared/customerContacts";
import { CustomerContactDraftFields } from "./CustomerContactFields";
import {
  contactErrorMessage,
  contactInput,
  draftFromContact,
  emptyContact,
  formatContactMethod,
  isDuplicateContactConflict,
  isUnknownContactOutcome,
  validateContact,
  withCustomerContactScope,
  type ContactDraft,
  type ContactRecord,
  type ContactsListData,
  type CustomerContactScope,
} from "./customerContacts";
import { makeCustomerRequestId } from "./customerUtils";

type EditorState =
  | { kind: "add"; draft: ContactDraft; initialFingerprint: string; requestId: string }
  | { kind: "edit"; draft: ContactDraft; initialFingerprint: string; contact: ContactRecord; requestId: string };
type PendingAction =
  | { kind: "add"; requestId: string; fingerprint: string; payload: Omit<ContactsAddInput, "expectedActorUserId" | "expectedEnterpriseId" | "requestId" | "confirmDuplicate">; confirmDuplicate?: boolean }
  | { kind: "edit"; requestId: string; fingerprint: string; payload: Omit<ContactsEditInput, "expectedActorUserId" | "expectedEnterpriseId" | "requestId" | "confirmDuplicate">; confirmDuplicate?: boolean }
  | { kind: "stop"; requestId: string; fingerprint: string; payload: Omit<ContactsStopInput, "expectedActorUserId" | "expectedEnterpriseId" | "requestId"> }
  | { kind: "primary"; requestId: string; fingerprint: string; payload: Omit<ContactsSetPrimaryInput, "expectedActorUserId" | "expectedEnterpriseId" | "requestId"> };

const secondary = "h-8 border-slate-300 bg-white px-3 text-xs text-slate-700 shadow-none hover:bg-slate-50";

// Compare raw editor fields, not the trimmed mutation payload: invalid/incomplete
// fields are still private unsaved work, and returning to the baseline is clean.
const draftFingerprint = (draft: ContactDraft) => JSON.stringify({ name: draft.name,
  department: draft.department, position: draft.position,
  methods: draft.methods.map(method => ({ type: method.type, value: method.value, label: method.label ?? "" })),
  isPrimary: draft.isPrimary });

export type CustomerContactsManagerProps = {
  customerId: number;
  open: boolean;
  onClose: () => void;
  scope: CustomerContactScope | null;
  scopeReady: boolean;
  identityKey: string;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
};

export function CustomerContactsManager({ customerId, open, onClose, scope, scopeReady, identityKey, onDirtyChange, onBusyChange }: CustomerContactsManagerProps) {
  const utils = trpc.useUtils();
  const queryInput: ContactsListInput = scope
    ? withCustomerContactScope(scope, { customerId })
    : { customerId, expectedActorUserId: 0, expectedEnterpriseId: 0 };
  const listQuery = trpc.customer.contactsList.useQuery(queryInput, {
    enabled: open && scopeReady && Boolean(scope) && Number.isSafeInteger(customerId) && customerId > 0,
    retry: false,
    staleTime: 0,
  });
  const addMutation = trpc.customer.contactsAdd.useMutation();
  const editMutation = trpc.customer.contactsEdit.useMutation();
  const stopMutation = trpc.customer.contactsStop.useMutation();
  const primaryMutation = trpc.customer.contactsSetPrimary.useMutation();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorErrors, setEditorErrors] = useState<Record<string, string>>({});
  const [stopTarget, setStopTarget] = useState<ContactRecord | null>(null);
  const [replacementContactId, setReplacementContactId] = useState("");
  const [duplicateAction, setDuplicateAction] = useState<PendingAction | null>(null);
  const [unknownAction, setUnknownAction] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const sessionKey = `${identityKey}:${customerId}:${scopeReady && scope ? `${scope.actorUserId}:${scope.enterpriseId}` : "blocked"}`;
  const activeIdentityRef = useRef(sessionKey);
  const previousIdentityRef = useRef(sessionKey);
  const generationRef = useRef({ key: sessionKey, value: 0 });
  if (generationRef.current.key !== sessionKey) {
    generationRef.current = { key: sessionKey, value: generationRef.current.value + 1 };
  }
  const mutationGenerationRef = useRef(generationRef.current.value);
  const mountedRef = useRef(true);
  const operationRef = useRef(false);
  const callbacksRef = useRef({ onDirtyChange, onBusyChange });
  callbacksRef.current = { onDirtyChange, onBusyChange };
  activeIdentityRef.current = sessionKey;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      callbacksRef.current.onDirtyChange?.(false);
      callbacksRef.current.onBusyChange?.(false);
    };
  }, []);

  useEffect(() => {
    if (previousIdentityRef.current === sessionKey) return;
    previousIdentityRef.current = sessionKey;
    operationRef.current = false;
    setBusy(false);
    setEditor(null);
    setEditorErrors({});
    setStopTarget(null);
    setReplacementContactId("");
    setDuplicateAction(null);
    setUnknownAction(null);
    setError("");
    setNotice("");
    callbacksRef.current.onDirtyChange?.(false);
    callbacksRef.current.onBusyChange?.(false);
    // Do not leave another account/enterprise looking at a stale contacts result.
    void utils.customer.contactsList.reset();
    onClose();
  }, [sessionKey, onClose, utils]);

  const data = listQuery.data;
  const activeContacts = useMemo(() => (data?.contacts ?? []).filter(contact => !contact.stoppedAt), [data?.contacts]);
  const mutationPending = mutationGenerationRef.current === generationRef.current.value
    && (addMutation.isPending || editMutation.isPending || stopMutation.isPending || primaryMutation.isPending);
  const locked = busy || mutationPending || Boolean(duplicateAction) || Boolean(unknownAction);
  const isArchived = Boolean(data?.customer.archivedAt);
  const actionsDisabled = locked || !scopeReady || !scope || isArchived || Boolean(listQuery.isFetching);
  const validSession = scopeReady && Boolean(scope) && previousIdentityRef.current === sessionKey;
  const dirty = validSession && Boolean(editor && draftFingerprint(editor.draft) !== editor.initialFingerprint);

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange?.(validSession && locked); }, [validSession, locked, onBusyChange]);

  const requestDiscard = (action: () => void) => {
    if (operationRef.current || locked) return;
    if (dirty && !window.confirm("联系人有未保存的修改。确定放弃修改吗？")) return;
    setEditor(null);
    setEditorErrors({});
    setStopTarget(null);
    setReplacementContactId("");
    action();
  };
  const close = () => requestDiscard(onClose);
  const beginEditor = (contact?: ContactRecord) => requestDiscard(() => {
    const draft = contact ? draftFromContact(contact) : emptyContact(false);
    setError(""); setEditorErrors({});
    const baseline = { draft, initialFingerprint: draftFingerprint(draft), requestId: makeCustomerRequestId() };
    setEditor(contact ? { ...baseline, kind: "edit", contact } : { ...baseline, kind: "add" });
  });

  const refresh = async (isCurrent: () => boolean) => {
    if (!isCurrent()) return;
    try {
      await Promise.all([
        utils.customer.contactsList.invalidate(queryInput),
        utils.customer.contactsSummary.invalidate(),
        utils.customer.list.invalidate(),
        utils.customer.get.invalidate({ id: customerId }),
      ]);
      if (!isCurrent()) return;
      const refreshed = await listQuery.refetch();
      if (refreshed && typeof refreshed === "object" && "error" in refreshed && refreshed.error) throw refreshed.error;
    } catch {
      if (isCurrent()) setNotice("操作已由服务器确认，但刷新失败。请刷新页面确认，不要重复提交。");
    }
  };

  const run = async (action: PendingAction) => {
    const duplicateConfirmation = (action.kind === "add" || action.kind === "edit")
      && Boolean(action.confirmDuplicate);
    const retryingPending = unknownAction?.requestId === action.requestId
      || (duplicateAction?.requestId === action.requestId && duplicateConfirmation);
    if (operationRef.current || locked && !retryingPending || !scope || !scopeReady) return;
    const scopeAtStart = sessionKey;
    const generationAtStart = generationRef.current.value;
    const isCurrent = () => mountedRef.current && activeIdentityRef.current === scopeAtStart
      && generationRef.current.value === generationAtStart;
    operationRef.current = true;
    mutationGenerationRef.current = generationAtStart;
    callbacksRef.current.onBusyChange?.(true);
    setBusy(true);
    setError("");
    try {
      let result: ContactChangeResult;
      if (action.kind === "add") {
        result = await addMutation.mutateAsync(withCustomerContactScope(scope, {
          ...action.payload,
          requestId: action.requestId,
          confirmDuplicate: Boolean(action.confirmDuplicate),
        }));
      } else if (action.kind === "edit") {
        result = await editMutation.mutateAsync(withCustomerContactScope(scope, {
          ...action.payload,
          requestId: action.requestId,
          confirmDuplicate: Boolean(action.confirmDuplicate),
        }));
      } else if (action.kind === "stop") {
        result = await stopMutation.mutateAsync(withCustomerContactScope(scope, {
          ...action.payload,
          requestId: action.requestId,
        }));
      } else {
        result = await primaryMutation.mutateAsync(withCustomerContactScope(scope, {
          ...action.payload,
          requestId: action.requestId,
        }));
      }
      if (!isCurrent()) return;
      setDuplicateAction(null);
      setUnknownAction(null);
      setEditor(null);
      setStopTarget(null);
      setReplacementContactId("");
      setNotice(result.replayed ? "已确认操作结果。" : "已保存。");
      await refresh(isCurrent);
    } catch (caught) {
      if (!isCurrent()) return;
      if ((action.kind === "add" || action.kind === "edit") && !action.confirmDuplicate && isDuplicateContactConflict(caught)) {
        setDuplicateAction({ ...action, confirmDuplicate: true });
      } else if (isUnknownContactOutcome(caught)) {
        setUnknownAction(action);
      } else {
        setError(contactErrorMessage(caught));
      }
    } finally {
      if (isCurrent()) {
        operationRef.current = false;
        setBusy(false);
      }
    }
  };

  const submitEditor = () => {
    if (!editor || !scope || actionsDisabled) return;
    const nextErrors = validateContact(editor.draft);
    setEditorErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    const contact = contactInput(editor.draft);
    const action: PendingAction = editor.kind === "add"
      ? {
        kind: "add",
        requestId: editor.requestId,
        fingerprint: JSON.stringify(contact),
        payload: { customerId, contact },
      }
      : {
        kind: "edit",
        requestId: editor.requestId,
        fingerprint: JSON.stringify(contact),
        payload: { customerId, contactId: editor.contact.id, version: editor.contact.version, contact },
      };
    void run(action);
  };

  const beginStop = (contact: ContactRecord) => {
    requestDiscard(() => {
      setError("");
      setStopTarget(contact);
      setReplacementContactId("");
    });
  };
  const submitStop = () => {
    if (!stopTarget || activeContacts.length <= 1) return;
    if (stopTarget.isPrimary && !replacementContactId) {
      setError("停用主联系人时必须选择另一位有效联系人。");
      return;
    }
    void run({
      kind: "stop",
      requestId: makeCustomerRequestId(),
      fingerprint: `${stopTarget.id}:${stopTarget.version}:${replacementContactId}`,
      payload: {
        customerId,
        contactId: stopTarget.id,
        version: stopTarget.version,
        ...(replacementContactId ? { replacementContactId } : {}),
      },
    });
  };

  return <Dialog open={open} onOpenChange={next => { if (!next) close(); }}>
    <DialogContent className="flex max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:w-full" showCloseButton={!locked} onEscapeKeyDown={event => { event.preventDefault(); close(); }} onInteractOutside={event => { event.preventDefault(); close(); }}>
      <DialogHeader className="border-b border-slate-100 px-4 py-3 pr-11">
        <DialogTitle className="text-base text-slate-800">客户联系人</DialogTitle>
        <DialogDescription className="text-xs">可查看联系人历史；新增、编辑、停用和设主均由当前客户权限与服务端能力决定。</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 overflow-y-auto p-4 text-xs">
        {!scopeReady ? <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800" role="status">登录身份或企业上下文已变化，已关闭联系人读取。</p> : null}
        {error ? <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700" role="alert">{error}</p> : null}
        {notice ? <p className="mb-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-[#185FA5]" role="status">{notice}</p> : null}
        {duplicateAction ? <ActionBanner title="确认保留相似联系人或联系方式？" text="确认后会按当前内容保存，不会自动合并或覆盖。" confirmLabel="确认保存" disabled={busy || mutationPending} onCancel={() => setDuplicateAction(null)} onConfirm={() => void run(duplicateAction)} /> : null}
        {unknownAction ? <ActionBanner title="正在确认操作结果" text="网络结果未知。请使用同一请求编号重试，避免重复写入。" confirmLabel="使用相同请求重试" disabled={busy || mutationPending} hideCancel onConfirm={() => void run(unknownAction)} /> : null}
        {listQuery.isPending || listQuery.isLoading ? <p className="flex items-center justify-center gap-2 py-10 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />正在加载联系人…</p> : listQuery.isError ? <div className="py-8 text-center"><p className="text-red-700">读取联系人失败：{contactErrorMessage(listQuery.error)}</p><Button type="button" size="sm" variant="outline" className="mt-3 h-8 text-xs" onClick={() => void listQuery.refetch()}>重试</Button></div> : data && validSession ? <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div><strong className="text-sm text-slate-800">{data.customer.name}</strong><p className="mt-0.5 text-[11px] text-slate-500">有效联系人 {activeContacts.length} 位{isArchived ? " · 客户已归档，仅可查看历史" : ""}</p></div>
            {data.canAdd && !isArchived ? <Button type="button" size="sm" className="h-8 bg-[#185FA5] px-3 text-xs hover:bg-[#0C447C]" disabled={actionsDisabled} onClick={() => beginEditor()}>＋ 添加联系人</Button> : null}
          </div>
          {editor ? <section className="mb-3 rounded-md border border-blue-200 bg-blue-50/30 p-3">
            <div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-xs font-semibold text-slate-800">{editor.kind === "add" ? "添加联系人" : "编辑联系人"}</h3><button type="button" className="text-xs text-[#185FA5] hover:underline disabled:text-slate-400" disabled={locked} onClick={() => requestDiscard(() => {})}>取消编辑</button></div>
            <CustomerContactDraftFields contact={editor.draft} disabled={actionsDisabled} errors={editorErrors} onChange={draft => setEditor(current => current ? { ...current, draft } : current)} />
            <div className="mt-3 flex justify-end gap-2"><Button type="button" size="sm" variant="outline" className={secondary} disabled={locked} onClick={() => requestDiscard(() => {})}>取消</Button><Button type="button" size="sm" className="h-8 bg-[#185FA5] px-3 text-xs hover:bg-[#0C447C]" disabled={actionsDisabled} onClick={submitEditor}>{busy ? "保存中…" : "保存联系人"}</Button></div>
          </section> : null}
          <section className="overflow-hidden rounded-md border border-slate-200">
            <div className="border-b border-slate-100 bg-slate-50 px-3 py-2"><h3 className="text-xs font-semibold text-slate-800">联系人列表</h3></div>
            {data.contacts.length ? data.contacts.map(contact => <ContactRow key={contact.id} contact={contact} actionsDisabled={actionsDisabled} activeCount={activeContacts.length} onEdit={() => beginEditor(contact)} onSetPrimary={() => requestDiscard(() => void run({ kind: "primary", requestId: makeCustomerRequestId(), fingerprint: `${contact.id}:${contact.version}`, payload: { customerId, contactId: contact.id, version: contact.version } }))} onStop={() => beginStop(contact)} />) : <p className="p-5 text-center text-slate-500">暂无联系人</p>}
          </section>
          {stopTarget ? <section className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
            <h3 className="text-xs font-semibold text-amber-900">确认停用“{stopTarget.name}”</h3>
            {activeContacts.length <= 1 ? <p className="mt-2 text-xs text-red-700">最后一位有效联系人不能停用。</p> : null}
            {stopTarget.isPrimary ? <label className="mt-2 block text-xs text-slate-700">主联系人必须选择有效替代人<select aria-label="主联系人替代人" className="mt-1 h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs" value={replacementContactId} disabled={locked} onChange={event => setReplacementContactId(event.target.value)}><option value="">请选择替代联系人</option>{activeContacts.filter(contact => contact.id !== stopTarget.id).map(contact => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></label> : null}
            <div className="mt-3 flex justify-end gap-2"><Button type="button" size="sm" variant="outline" className={secondary} disabled={locked} onClick={() => setStopTarget(null)}>取消</Button><Button type="button" size="sm" className="h-8 bg-red-700 px-3 text-xs text-white hover:bg-red-800" disabled={actionsDisabled || activeContacts.length <= 1 || stopTarget.isPrimary && !replacementContactId} onClick={submitStop}>确认停用</Button></div>
          </section> : null}
        </> : null}
      </div>
      <DialogFooter className="border-t border-slate-100 px-4 py-3"><Button type="button" size="sm" variant="outline" className={secondary} disabled={locked} onClick={close}>关闭</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function ContactRow({ contact, actionsDisabled, activeCount, onEdit, onSetPrimary, onStop }: { contact: ContactRecord; actionsDisabled: boolean; activeCount: number; onEdit: () => void; onSetPrimary: () => void; onStop: () => void }) {
  const metadata = [contact.department, contact.position].filter(Boolean).join(" · ");
  const actionable = contact.canEdit && !contact.stoppedAt;
  return <article className="border-t border-slate-100 px-3 py-3 first:border-t-0">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><strong className="break-words text-slate-800">{contact.name}</strong>{contact.isPrimary && !contact.stoppedAt ? <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-[#185FA5]">主联系人</span> : null}{contact.stoppedAt ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">已停用</span> : null}</div><p className="mt-1 text-[11px] text-slate-500">{metadata || "未填写部门/职位"}</p><p className="mt-1 break-all leading-5 text-slate-700">{contact.methods.map(formatContactMethod).join("；") || "未填写联系方式"}</p>{contact.stoppedAt ? <p className="mt-1 text-[11px] text-slate-400">停用时间：{new Date(contact.stoppedAt).toLocaleString("zh-CN", { hour12: false })}</p> : null}</div>{actionable ? <div className="flex shrink-0 flex-wrap gap-x-2 gap-y-1"><button type="button" className="text-xs text-[#185FA5] hover:underline disabled:text-slate-400" disabled={actionsDisabled} onClick={onEdit}>编辑</button>{!contact.isPrimary ? <button type="button" className="text-xs text-[#185FA5] hover:underline disabled:text-slate-400" disabled={actionsDisabled} onClick={onSetPrimary}>设为主联系人</button> : null}<button type="button" className="text-xs text-red-700 hover:underline disabled:text-slate-400" title={activeCount <= 1 ? "最后一位有效联系人不能停用" : undefined} disabled={actionsDisabled || activeCount <= 1} onClick={onStop}>停用</button></div> : null}</div>
  </article>;
}

function ActionBanner({ title, text, confirmLabel, disabled, hideCancel = false, onCancel, onConfirm }: { title: string; text: string; confirmLabel: string; disabled: boolean; hideCancel?: boolean; onCancel?: () => void; onConfirm: () => void }) {
  return <section className="mb-3 rounded border border-amber-200 bg-amber-50 p-3"><h3 className="text-xs font-semibold text-amber-900">{title}</h3><p className="mt-1 text-xs leading-5 text-amber-800">{text}</p><div className="mt-2 flex justify-end gap-2">{!hideCancel ? <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={disabled} onClick={onCancel}>取消</Button> : null}<Button type="button" size="sm" className="h-7 bg-[#185FA5] px-2 text-[11px] hover:bg-[#0C447C]" disabled={disabled} onClick={onConfirm}>{confirmLabel}</Button></div></section>;
}
