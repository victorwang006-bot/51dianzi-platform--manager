import { BeijingDateTimePicker } from "../customers/BeijingDateTimePicker";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  CUSTOMER_DEMAND_MAX_ITEMS,
  CUSTOMER_DEMAND_STATUS_LABELS,
  CUSTOMER_DEMAND_UNITS,
  customerDemandSaveSchema,
  emptyCustomerDemandData,
  emptyCustomerDemandItem,
  type CustomerDemandData,
  type CustomerDemandItem,
  type CustomerDemandStatus,
} from "../../../../shared/customerDemands";
import { beijingDateTimeLocalToIso, errorMessage, isoToBeijingDateTimeLocal } from "../customers/customerUtils";
import { trpc } from "../../../../../api/business-trpc";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { ConfirmDialog } from "../customers/ConfirmDialog";
import { DemandPartNumberInput, type DemandPartSuggestion } from "./DemandPartNumberInput";
import { DemandQuoteList } from "./DemandQuoteList";
import { DemandRevisionHistory } from "./DemandRevisionHistory";

type CustomerLink = { id: number; name: string; archivedAt?: string | null };
type FormItem = CustomerDemandItem & { _localKey: string };
type DemandForm = Omit<CustomerDemandData, "replyDueAt" | "items"> & { replyDueAt: string; items: FormItem[] };
type FieldErrors = Record<string, string>;
type SaveIntent = "draft" | "submit" | "update";

export type CustomerDemandDialogProps = {
  customer: CustomerLink;
  demandId?: number;
  mode?: "view" | "edit";
  onClose: () => void;
  onSaved?: () => void;
};

const demandApi = trpc.customerDemand;
const compactInput = "h-8 min-w-0 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#185FA5] focus:ring-1 focus:ring-[#185FA5]/25 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";
const labelClass = "mb-1 block text-[11px] font-medium text-slate-600";

function localKey() {
  const uuid = globalThis.crypto?.randomUUID?.().replace(/-/g, "");
  return `demand_${uuid ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`}`.slice(0, 80);
}

function formFromData(data: CustomerDemandData): DemandForm {
  return {
    ...data,
    replyDueAt: isoToBeijingDateTimeLocal(data.replyDueAt),
    // React keys must survive deletion/reordering, rather than following indices.
    items: data.items.map(item => ({ ...item, _localKey: localKey() })),
  };
}

function formFingerprint(form: DemandForm) {
  return JSON.stringify(form);
}

function statusClass(status: CustomerDemandStatus | null) {
  if (status === "processing") return "border-blue-200 bg-blue-50 text-[#185FA5]";
  if (status === "submitted") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function inputError(errors: FieldErrors, path: string) {
  return errors[path] || "";
}

/**
 * Wide, customer-linked material-demand form. It is intentionally mounted only
 * while open: no query or mutation is initiated until a parent opens the dialog.
 */
export function CustomerDemandDialog({ customer, demandId, mode = "edit", onClose, onSaved }: CustomerDemandDialogProps) {
  const initiallyEditable = !demandId;
  const [editingMode, setEditingMode] = useState(mode);
  const [changeReason, setChangeReason] = useState("");
  const [awaitingReplay, setAwaitingReplay] = useState(false);
  const retryIntentRef = useRef<SaveIntent>("draft");
  const [activeDemandId, setActiveDemandId] = useState<number | undefined>(demandId);
  const [form, setForm] = useState<DemandForm>(() => formFromData(emptyCustomerDemandData()));
  const formRef = useRef(form);
  const baselineRef = useRef(formFingerprint(form));
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState("");
  const [saveHint, setSaveHint] = useState("");
  const [demandNo, setDemandNo] = useState("");
  const [status, setStatus] = useState<CustomerDemandStatus | null>(initiallyEditable ? "draft" : null);
  const versionRef = useRef<number | undefined>(undefined);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [savingIntent, setSavingIntent] = useState<SaveIntent | null>(null);
  const savingRef = useRef(false);
  const loadedRef = useRef<string | null>(null);
  const requestKeysRef = useRef(new Map<string, string>());

  const contextQuery = trpc.customer.context.useQuery();
  const detailQuery = demandApi.get.useQuery(
    { id: activeDemandId ?? 0 },
    { enabled: Boolean(activeDemandId) },
  );
  const saveMutation = demandApi.save.useMutation();
  const utils = trpc.useUtils();
  const detail = detailQuery.data;
  // A saved record is never editable until its version and status have arrived.
  // This also prevents a brief empty-form save while the detail query is loading.
  const effectiveStatus = status ?? detail?.status ?? null;
  const readOnly = Boolean(editingMode === "view" || customer.archivedAt || (activeDemandId && (!versionRef.current || detail?.canEdit !== true)));
  const updatingSubmitted = Boolean(activeDemandId && effectiveStatus && effectiveStatus !== "draft");
  const lockedIds = new Set(detail?.lockedItemIds ?? []);
  const itemIsLocked = (item: FormItem) => Boolean(item.id && lockedIds.has(item.id));
  const salesName = useMemo(() => {
    if (detail?.salesName) return detail.salesName;
    const context = contextQuery.data;
    return context?.members?.find(member => member.userId === context.actorUserId)?.name ?? "当前销售";
  }, [contextQuery.data, detail?.salesName]);

  const replaceForm = (updater: (current: DemandForm) => DemandForm) => {
    if (savingRef.current || awaitingReplay) return;
    setForm(current => {
      const next = updater(current);
      formRef.current = next;
      const nextDirty = formFingerprint(next) !== baselineRef.current || Boolean(changeReason.trim());
      dirtyRef.current = nextDirty;
      setDirty(nextDirty);
      return next;
    });
    setSaveHint("");
    setSaveError("");
    setFieldErrors({});
  };

  useEffect(() => {
    if (!detail?.id || !detail.items) return;
    if (detail.version < (versionRef.current ?? 0)) return;
    const data: CustomerDemandData = {
      projectName: detail.projectName ?? "",
      priority: detail.priority ?? "normal",
      replyDueAt: detail.replyDueAt ?? null,
      note: detail.note ?? "",
      items: detail.items ?? [],
    };
    const recordKey = `${detail.id}:${detail.version}`;
    // A refetch may return while the user is editing. Never replace those local values.
    if (loadedRef.current === recordKey || dirtyRef.current || savingRef.current || awaitingReplay) return;
    const loaded = formFromData(data);
    loadedRef.current = recordKey;
    formRef.current = loaded;
    baselineRef.current = formFingerprint(loaded);
    dirtyRef.current = false;
    setForm(loaded);
    setDirty(false);
    setFieldErrors({});
    setSaveError("");
    setDemandNo(detail.demandNo ?? "");
    setStatus(detail.status ?? "draft");
    setChangeReason("");
    versionRef.current = detail.version;
  }, [detail?.id, detail?.version, awaitingReplay]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current || savingRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const requestClose = () => {
    if (savingRef.current) return;
    if (dirtyRef.current) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  const updateHeader = <K extends keyof DemandForm>(key: K, value: DemandForm[K]) => {
    replaceForm(current => ({ ...current, [key]: value }));
  };

  const updateItem = <K extends keyof CustomerDemandItem>(index: number, key: K, value: CustomerDemandItem[K]) => {
    if (readOnly || itemIsLocked(formRef.current.items[index]!)) return;
    replaceForm(current => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item),
    }));
  };

  const addRow = () => {
    if (readOnly || detail?.hasActiveOrders || formRef.current.items.length >= CUSTOMER_DEMAND_MAX_ITEMS) return;
    replaceForm(current => ({ ...current, items: [...current.items, { ...emptyCustomerDemandItem(), _localKey: localKey() }] }));
  };

  const selectPart = (rowKey: string, suggestion: DemandPartSuggestion) => {
    if (readOnly || savingRef.current || formRef.current.items.some(item => item._localKey === rowKey && itemIsLocked(item))) return;
    replaceForm(current => ({ ...current, items: current.items.map(item => item._localKey === rowKey ? {
      ...item, partNumber: suggestion.partNumber,
      brand: suggestion.brand || item.brand, pkg: suggestion.package || item.pkg,
    } : item) }));
  };

  const removeRow = (index: number) => {
    if (readOnly || itemIsLocked(formRef.current.items[index]!) || formRef.current.items.length <= 1) return;
    replaceForm(current => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }));
  };

  const buildInput = (intent: SaveIntent) => {
    const current = formRef.current;
    const replyDueAt = beijingDateTimeLocalToIso(current.replyDueAt);
    const nextErrors: FieldErrors = {};
    if (current.replyDueAt && !replyDueAt) nextErrors.replyDueAt = "请输入有效的北京时间";
    if (intent === "update" && !changeReason.trim()) nextErrors.changeReason = "请填写本次变更说明";
    const data: CustomerDemandData = {
      projectName: current.projectName.trim(),
      priority: current.priority,
      replyDueAt,
      note: current.note.trim(),
      items: current.items.map(({ _localKey, ...item }) => ({
        ...(item.id ? { id: item.id } : {}),
        partNumber: item.partNumber.trim(),
        brand: item.brand.trim(),
        pkg: item.pkg.trim(),
        qty: item.qty,
        qtyUnit: item.qtyUnit,
        deliveryRequirement: item.deliveryRequirement.trim(),
        note: item.note.trim(),
      })),
    };
    const candidate = {
      customerId: customer.id,
      ...(activeDemandId ? { id: activeDemandId, version: versionRef.current } : {}),
      requestId: "pending-request-id",
      intent,
      ...(intent === "update" ? { changeReason: changeReason.trim() } : {}),
      data,
    };
    const parsed = customerDemandSaveSchema.safeParse(candidate);
    if (!parsed.success) {
      parsed.error.issues.forEach(issue => {
        const key = issue.path.join(".");
        nextErrors[key] = issue.message;
      });
    }
    setFieldErrors(nextErrors);
    return { data, errors: nextErrors };
  };

  const save = async (intent: SaveIntent) => {
    if (readOnly || savingRef.current || customer.archivedAt) return;
    const built = buildInput(intent);
    if (Object.keys(built.errors).length > 0) return;
    const version = activeDemandId ? versionRef.current : undefined;
    if (activeDemandId && !version) {
      setSaveError("需求版本已过期，请关闭后重新打开。");
      return;
    }
    const fingerprint = JSON.stringify({ intent, id: activeDemandId ?? null, version: version ?? null, data: built.data, changeReason: intent === "update" ? changeReason.trim() : "" });
    let requestId = requestKeysRef.current.get(fingerprint);
    if (!requestId) {
      requestId = localKey();
      requestKeysRef.current.set(fingerprint, requestId);
    }
    savingRef.current = true;
    retryIntentRef.current = intent;
    setSavingIntent(intent);
    setSaveError("");
    try {
      const result = await saveMutation.mutateAsync({
        customerId: customer.id,
        ...(activeDemandId ? { id: activeDemandId, version } : {}),
        requestId,
        intent,
        ...(intent === "update" ? { changeReason: changeReason.trim() } : {}),
        data: built.data,
      });
      const savedData = formFromData(built.data);
      formRef.current = savedData;
      baselineRef.current = formFingerprint(savedData);
      dirtyRef.current = false;
      setForm(savedData);
      setDirty(false);
      setActiveDemandId(result.id);
      setDemandNo(result.demandNo);
      setStatus(result.status);
      versionRef.current = result.version;
      // The server assigns IDs to newly added rows; hydrate them before the next edit.
      loadedRef.current = null;
      setChangeReason("");
      setAwaitingReplay(false);
      setFieldErrors({});
      // Refresh failures must not change this confirmed mutation outcome.
      void utils.customerDemand.list.invalidate({ customerId: customer.id }).catch(() => undefined);
      void utils.customerDemand.get.invalidate({ id: result.id }).catch(() => undefined);
      void utils.customerDemand.procurementList.invalidate().catch(() => undefined);
      void utils.customerDemand.procurementGet.invalidate({ id: result.id }).catch(() => undefined);
      void utils.customerDemand.quoteList.invalidate({ demandId: result.id }).catch(() => undefined);
      void utils.customerDemand.revisionHistory.invalidate({ id: result.id }).catch(() => undefined);
      try { onSaved?.(); } catch { toast.warning("需求已保存，关联列表刷新失败，请稍后刷新。"); }
      if (intent === "submit" || intent === "update") {
        toast.success(intent === "update" ? "需求变更已保存" : "需求已提交采购", { description: intent === "update" ? `${result.demandNo} · V${result.revision ?? 1}` : result.demandNo });
        onClose();
      } else {
        setSaveHint(`草稿已保存${result.demandNo ? `，编号 ${result.demandNo}` : ""}`);
      }
    } catch (error) {
      const code = (error as { data?: { code?: string } })?.data?.code;
      const uncertain = (!code || ["INTERNAL_SERVER_ERROR", "TIMEOUT"].includes(code)) && !["CONFLICT", "BAD_REQUEST", "FORBIDDEN", "NOT_FOUND", "UNAUTHORIZED"].includes(code ?? "");
      setAwaitingReplay(uncertain);
      setSaveError(uncertain ? "保存结果尚未确认，内容已锁定。请点击重试保存，系统将使用同一请求编号确认结果。" : errorMessage(error));
    } finally {
      savingRef.current = false;
      setSavingIntent(null);
    }
  };

  const pending = savingIntent !== null;
  const fieldDisabled = readOnly || pending || awaitingReplay || Boolean(customer.archivedAt);
  const globalItemsError = inputError(fieldErrors, "data.items");

  return <>
    <Dialog open onOpenChange={open => { if (!open) requestClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="flex h-auto max-h-[90dvh] w-[calc(100vw-32px)] max-w-[1180px] sm:max-w-[1180px] flex-col gap-0 overflow-hidden p-0"
        onEscapeKeyDown={event => { event.preventDefault(); requestClose(); }}
        onInteractOutside={event => { event.preventDefault(); requestClose(); }}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><DialogTitle className="text-base font-semibold text-slate-800">{editingMode === "view" ? "需求详情" : demandId ? "编辑需求" : "需求录入"}</DialogTitle><span data-testid="demand-number-header" className="text-xs font-normal text-slate-500">单号：{demandNo || "保存后自动生成"}{detail?.revision ? ` · V${detail.revision}` : ""}</span></div>
            <DialogDescription className="mt-1 text-xs text-slate-500">
              内部采购需求，不向客户展示
            </DialogDescription>
          </div>
          <div className="flex items-center gap-2">
            {status && <span className={`rounded border px-2 py-0.5 text-[11px] font-medium ${statusClass(status)}`}>{CUSTOMER_DEMAND_STATUS_LABELS[status]}</span>}
            <button aria-label="关闭需求录入" type="button" disabled={pending} onClick={requestClose} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {detailQuery.isLoading && activeDemandId ? <div className="flex items-center gap-2 py-8 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />正在加载需求…</div> : null}
          {detailQuery.error ? <p role="alert" className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{errorMessage(detailQuery.error)}</p> : null}
          {customer.archivedAt ? <p role="alert" className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">该客户已归档，不能新增或修改需求。</p> : null}
          {detail?.hasActiveOrders && <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">已成单的物料行已锁定，不能修改或删除；新增物料请另建需求，原订单不受影响。</p>}
          {!readOnly && updatingSubmitted && <p className="mb-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-[#185FA5]">保存后形成新版本并同步采购；已有报价保留为旧版本，需采购确认后才能作为当前报价。</p>}
          {detail?.editRestriction && <p className="mb-3 text-xs text-slate-500">{detail.editRestriction}</p>}
          {Object.keys(fieldErrors).length > 0 && <p role="alert" className="mb-3 text-xs text-red-600">{Object.values(fieldErrors)[0]}</p>}
          <div className="grid grid-cols-1 gap-2 border-b border-slate-100 pb-3 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1.4fr)_minmax(100px,.7fr)_minmax(180px,1fr)_96px_228px]">
            <div className="min-w-0">
              <label className={labelClass}>关联客户</label>
              <input aria-label="关联客户" value={customer.name} readOnly className={`${compactInput} w-full bg-slate-50`} />
            </div>
            <div className="min-w-0">
              <label className={labelClass}>销售</label>
              <input aria-label="销售" value={salesName} readOnly className={`${compactInput} w-full bg-slate-50`} />
            </div>
            <div className="min-w-0">
              <label htmlFor="demand-project" className={labelClass}>项目名称（选填）</label>
              <input id="demand-project" maxLength={128} value={form.projectName} disabled={fieldDisabled} onChange={event => updateHeader("projectName", event.target.value)} className={`${compactInput} w-full`} />
            </div>
            <div className="min-w-0">
              <label htmlFor="demand-priority" className={labelClass}>优先级</label>
              <select id="demand-priority" value={form.priority} disabled={fieldDisabled} onChange={event => updateHeader("priority", event.target.value as DemandForm["priority"])} className={`${compactInput} w-full`}>
                <option value="normal">普通</option><option value="urgent">紧急</option>
              </select>
            </div>
            <div className="min-w-0">
              <label htmlFor="demand-reply-due" className={labelClass}>回复时间（北京时间，选填）</label>
              <BeijingDateTimePicker id="demand-reply-due" aria-label="要求回复时间（北京时间）" value={form.replyDueAt} disabled={fieldDisabled} onChange={value => updateHeader("replyDueAt", value)} className="w-full max-w-[228px]" />
              {inputError(fieldErrors, "replyDueAt") && <p className="mt-1 text-[11px] text-red-600">{inputError(fieldErrors, "replyDueAt")}</p>}
            </div>
          </div>

          <div className="mt-3">
            <div className="mb-2 flex items-center justify-between">
              <div><h3 className="text-sm font-semibold text-slate-800">物料明细</h3><p className="mt-0.5 text-[11px] text-slate-500">提交采购时，型号和数量为必填。</p></div>
              {!readOnly && <Button type="button" size="sm" variant="outline" disabled={pending || awaitingReplay || Boolean(customer.archivedAt) || detail?.hasActiveOrders || form.items.length >= CUSTOMER_DEMAND_MAX_ITEMS} onClick={addRow} className="h-8 border-[#185FA5]/40 bg-white px-2 text-xs text-[#185FA5] hover:bg-[#f5f9fd] hover:text-[#185FA5]"><Plus className="mr-1 h-3.5 w-3.5" />新增一行</Button>}
            </div>
            {globalItemsError && <p role="alert" className="mb-2 text-xs text-red-600">{globalItemsError}</p>}
            <div className="overflow-x-auto rounded border border-slate-200">
              <table className="min-w-[970px] w-full table-fixed text-xs">
                <colgroup><col className="w-[16%]" /><col className="w-[10%]" /><col className="w-[10%]" /><col className="w-[9%]" /><col className="w-[8%]" /><col className="w-[15%]" /><col className="w-[22%]" /><col className="w-[10%]" /></colgroup>
                <thead><tr className="bg-slate-50 text-left text-[11px] font-medium text-slate-500"><th className="h-8 px-2">型号</th><th className="px-2">品牌</th><th className="px-2">封装</th><th className="px-2">数量</th><th className="px-2">单位</th><th className="px-2">要求交期</th><th className="px-2">备注</th><th className="px-2 text-right">删除</th></tr></thead>
                <tbody>{form.items.map((item, index) => { const rowLocked = itemIsLocked(item); return <tr key={item._localKey} className="border-t border-slate-100 align-top">
                  <td className="p-1.5"><DemandPartNumberInput value={item.partNumber} disabled={fieldDisabled || rowLocked} rowIndex={index} onChange={value => updateItem(index, "partNumber", value)} onSelect={suggestion => selectPart(item._localKey, suggestion)} className={`${compactInput} w-full`} />{inputError(fieldErrors, `data.items.${index}.partNumber`) && <p className="mt-1 text-[11px] text-red-600">{inputError(fieldErrors, `data.items.${index}.partNumber`)}</p>}</td>
                  <td className="p-1.5"><input aria-label={`第${index + 1}行品牌`} maxLength={64} value={item.brand} disabled={fieldDisabled || rowLocked} onChange={event => updateItem(index, "brand", event.target.value)} className={`${compactInput} w-full`} /></td>
                  <td className="p-1.5"><input aria-label={`第${index + 1}行封装`} maxLength={64} value={item.pkg} disabled={fieldDisabled || rowLocked} onChange={event => updateItem(index, "pkg", event.target.value)} className={`${compactInput} w-full`} /></td>
                  <td className="p-1.5"><input data-testid={`demand-item-${index}-qty`} aria-label={`第${index + 1}行数量`} type="number" min="1" step="1" value={item.qty ?? ""} disabled={fieldDisabled || rowLocked} onChange={event => updateItem(index, "qty", event.target.value === "" ? null : Number(event.target.value))} className={`${compactInput} w-full`} />{inputError(fieldErrors, `data.items.${index}.qty`) && <p className="mt-1 text-[11px] text-red-600">{inputError(fieldErrors, `data.items.${index}.qty`)}</p>}</td>
                  <td className="p-1.5"><select aria-label={`第${index + 1}行单位`} value={item.qtyUnit} disabled={fieldDisabled || rowLocked} onChange={event => updateItem(index, "qtyUnit", event.target.value as CustomerDemandItem["qtyUnit"])} className={`${compactInput} w-full`}>{CUSTOMER_DEMAND_UNITS.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select></td>
                  <td className="p-1.5"><input aria-label={`第${index + 1}行要求交期`} maxLength={80} value={item.deliveryRequirement} disabled={fieldDisabled || rowLocked} onChange={event => updateItem(index, "deliveryRequirement", event.target.value)} className={`${compactInput} w-full`} /></td>
                  <td className="p-1.5"><input aria-label={`第${index + 1}行备注`} maxLength={500} value={item.note} disabled={fieldDisabled || rowLocked} onChange={event => updateItem(index, "note", event.target.value)} className={`${compactInput} w-full`} /></td>
                  <td className="p-1.5 text-right">{rowLocked && <span className="block text-[10px] text-amber-700">已成单</span>}<button aria-label={`删除第${index + 1}行物料`} type="button" disabled={fieldDisabled || rowLocked || form.items.length <= 1} onClick={() => removeRow(index)} className="mt-0.5 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-35"><Trash2 className="h-3.5 w-3.5" /></button></td>
                </tr>; })}</tbody>
              </table>
            </div>
            <p className="mt-1 text-[11px] text-slate-500 sm:hidden">左右滑动物料表，可填写数量、交期等信息。</p>
          </div>

          <div className="mt-3">
            <label htmlFor="demand-note" className={labelClass}>需求说明</label>
            <textarea id="demand-note" value={form.note} disabled={fieldDisabled} onChange={event => updateHeader("note", event.target.value)} placeholder="提供给采购的需求说明，请勿填写客户联系方式" className="min-h-16 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#185FA5] focus:ring-1 focus:ring-[#185FA5]/25 disabled:bg-slate-50" maxLength={2000} />
          </div>
          {!readOnly && updatingSubmitted && <div className="mt-3"><label htmlFor="demand-change-reason" className={labelClass}>变更说明 <span className="text-red-600">*</span></label><input id="demand-change-reason" maxLength={500} value={changeReason} disabled={fieldDisabled} onChange={event => { setChangeReason(event.target.value); dirtyRef.current = true; setDirty(true); setFieldErrors({}); }} placeholder="说明本次修改原因，便于采购确认" className={`${compactInput} w-full`} /></div>}
          {activeDemandId && effectiveStatus !== "draft" && <div className="mt-4 border-t border-slate-200 pt-3"><DemandQuoteList demandId={activeDemandId} audience="sales" /></div>}
          {activeDemandId && <DemandRevisionHistory key={activeDemandId} demandId={activeDemandId} />}
          {saveError && <p role="alert" className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{saveError}</p>}
          {saveHint && <p role="status" className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{saveHint}</p>}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3">
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={requestClose} className="h-8 bg-white px-3 text-xs">{readOnly ? "关闭" : "取消"}</Button>
          {editingMode === "view" && detail?.canEdit && !customer.archivedAt && <Button type="button" size="sm" onClick={() => setEditingMode("edit")} className="h-8 bg-[#185FA5] px-3 text-xs hover:bg-[#0C447C]">编辑需求</Button>}
          {!readOnly && (awaitingReplay ? <Button type="button" size="sm" disabled={pending} onClick={() => void save(retryIntentRef.current)} className="h-8 bg-[#185FA5] px-3 text-xs">重试保存</Button> : updatingSubmitted ? <Button type="button" size="sm" disabled={pending || !dirty} onClick={() => void save("update")} className="h-8 bg-[#185FA5] px-3 text-xs hover:bg-[#0C447C]">{pending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}保存变更</Button> : <><Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void save("draft")} className="h-8 border-slate-300 bg-white px-3 text-xs text-slate-700">{savingIntent === "draft" && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}保存草稿</Button><Button type="button" size="sm" disabled={pending} onClick={() => void save("submit")} className="h-8 bg-[#185FA5] px-3 text-xs hover:bg-[#0C447C]">{savingIntent === "submit" && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}提交采购</Button></>)}
        </div>
      </DialogContent>
    </Dialog>
    {confirmDiscard && <ConfirmDialog title="放弃未保存的需求？" description="关闭后本次未保存的需求内容将丢失。" confirmLabel="放弃并关闭" danger onCancel={() => setConfirmDiscard(false)} onConfirm={() => { setConfirmDiscard(false); onClose(); }} />}
  </>;
}

export default CustomerDemandDialog;
