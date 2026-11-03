import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import {
  demandQuoteSaveSchema,
  type DemandQuote,
  type QuotableDemandItem,
} from "../../../../shared/customerDemandQuotes";
import { errorMessage } from "../customers/customerUtils";
import { ConfirmDialog } from "../customers/ConfirmDialog";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/dialog";
import { trpc } from "../../../../../api/business-trpc";

export type DemandQuoteDialogProps = {
  demandId: number;
  quoteId?: number;
  onClose: () => void;
  onSaved?: () => void;
};

type QuoteLineForm = {
  demandItemId: number;
  partNumber: string;
  brand: string;
  pkg: string;
  qtyUnit: string;
  demandQty: number | null;
  include: boolean;
  options: QuoteOptionForm[];
};
type QuoteOptionForm = {
  alternateNo: number;
  persisted: boolean;
  qty: string;
  unitPrice: string;
  leadTime: string;
  note: string;
};
type QuoteForm = { supplierName: string; note: string; items: QuoteLineForm[] };
type QuoteMeta = { id: number; version: number } | null;
type FieldErrors = Record<string, string>;

const compactInput =
  "h-8 min-w-0 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#185FA5] focus:ring-1 focus:ring-[#185FA5]/25 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";
const labelClass = "mb-1 block text-[11px] font-medium text-slate-600";

function requestKey() {
  const uuid = globalThis.crypto?.randomUUID?.().replace(/-/g, "");
  return `demandquote_${uuid ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`}`.slice(
    0,
    80
  );
}

function fingerprint(form: QuoteForm, meta: QuoteMeta) {
  return JSON.stringify({
    id: meta?.id ?? null,
    version: meta?.version ?? null,
    supplierName: form.supplierName,
    note: form.note,
    items: form.items
      .filter(item => item.include)
      .map(({ demandItemId, options }) => ({
        demandItemId,
        options: options.map(
          ({ alternateNo, qty, unitPrice, leadTime, note }) => ({
            alternateNo,
            qty,
            unitPrice,
            leadTime,
            note,
          })
        ),
      })),
  });
}

function emptyForm(
  items: QuotableDemandItem[],
  quote?: DemandQuote
): QuoteForm {
  const existing = new Map<number, DemandQuote["items"]>();
  for (const item of quote?.items ?? [])
    existing.set(item.demandItemId, [
      ...(existing.get(item.demandItemId) ?? []),
      item,
    ]);
  return {
    supplierName: quote?.supplierName ?? "",
    note: quote?.note ?? "",
    items: items.map(item => {
      const saved = existing.get(item.id);
      return {
        demandItemId: item.id,
        partNumber: item.partNumber || "",
        brand: item.brand || "",
        pkg: item.pkg || "",
        qtyUnit: item.qtyUnit || "",
        demandQty: item.qty ?? null,
        include: Boolean(saved?.length),
        options: saved?.length
          ? saved.map(option => ({
              alternateNo: option.alternateNo ?? 1,
              persisted: true,
              qty: String(option.qty),
              unitPrice: option.unitPrice,
              leadTime: option.leadTime,
              note: option.note,
            }))
          : [blankOption(1)],
      };
    }),
  };
}

function blankOption(alternateNo: number): QuoteOptionForm {
  return {
    alternateNo,
    persisted: false,
    qty: "",
    unitPrice: "",
    leadTime: "",
    note: "",
  };
}
function isBlankOption(option: QuoteOptionForm) {
  return [option.qty, option.unitPrice, option.leadTime, option.note].every(
    value => !value.trim()
  );
}

function fieldError(errors: FieldErrors, path: string) {
  return errors[path] || "";
}
function isConflict(error: unknown) {
  const code = trpcErrorCode(error);
  return (
    code === "CONFLICT" ||
    /版本|冲突|conflict|version/i.test(errorMessage(error))
  );
}
function isAmbiguousNetworkFailure(error: unknown) {
  const code = trpcErrorCode(error);
  // An explicitly typed application rejection is safe to surface for editing.
  // Anything without a typed rejection may have reached the server, including a
  // proxy/response failure after a successful idempotent write.
  if (
    ["BAD_REQUEST", "FORBIDDEN", "NOT_FOUND", "CONFLICT"].includes(code ?? "")
  ) {
    return false;
  }
  return (
    !code ||
    code === "INTERNAL_SERVER_ERROR" ||
    code === "TIMEOUT" ||
    /网络|network|fetch|timeout|timed out|连接|connection/i.test(
      errorMessage(error)
    )
  );
}

function trpcErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const data = "data" in error ? (error as { data?: unknown }).data : undefined;
  if (!data || typeof data !== "object" || !("code" in data)) return undefined;
  const code = (data as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** Quote selected demand lines; edit only a caller-owned option when quoteId is present. */
export function DemandQuoteDialog({
  demandId,
  quoteId,
  onClose,
  onSaved,
}: DemandQuoteDialogProps) {
  const detailQuery = trpc.customerDemand.procurementGet.useQuery({
    id: demandId,
  });
  const ownQuotesQuery = trpc.customerDemand.quoteList.useQuery(
    {
      demandId,
      ...(quoteId == null ? {} : { quoteId }),
      audience: "procurement",
      page: 1,
      pageSize: 20,
    },
    { enabled: quoteId != null }
  );
  const saveMutation = trpc.customerDemand.quoteSave.useMutation();
  const utils = trpc.useUtils();
  const [form, setForm] = useState<QuoteForm>({
    supplierName: "",
    note: "",
    items: [],
  });
  const formRef = useRef(form);
  const [quoteMeta, setQuoteMeta] = useState<QuoteMeta>(null);
  const quoteMetaRef = useRef<QuoteMeta>(null);
  const demandRevisionRef = useRef(1);
  const [loadedDemandRevision, setLoadedDemandRevision] = useState(1);
  const [revisionConfirmed, setRevisionConfirmed] = useState(false);
  const baselineRef = useRef(fingerprint(form, null));
  const dirtyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [awaitingReplay, setAwaitingReplay] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmExcess, setConfirmExcess] = useState(false);
  const loadedRef = useRef<string | null>(null);
  const requestKeysRef = useRef(new Map<string, string>());

  const ownQuote =
    quoteId == null
      ? undefined
      : ownQuotesQuery.data?.items?.find(quote => quote.id === quoteId);
  const detail = detailQuery.data;
  const loadingOwnQuote =
    quoteId != null &&
    Boolean(
      ownQuotesQuery.isLoading ||
        (ownQuotesQuery.isFetching && !ownQuotesQuery.data)
    );
  const formReady =
    Boolean(detail?.id) &&
    !detailQuery.isLoading &&
    !loadingOwnQuote &&
    !ownQuotesQuery.error &&
    (quoteId == null || Boolean(ownQuote));
  const revisionChanged = Boolean(
    detail && (detail.revision ?? 1) !== loadedDemandRevision
  );
  const needsReconfirmation = Boolean(
    ownQuote &&
      (ownQuote.demandRevision ?? 1) < (detail?.revision ?? 1) &&
      ownQuote.version >= (quoteMeta?.version ?? ownQuote.version)
  );
  const editingLocked =
    saving || awaitingReplay || !formReady || revisionChanged;

  const replaceForm = (updater: (current: QuoteForm) => QuoteForm) => {
    if (editingLocked) return;
    setForm(current => {
      const next = updater(current);
      formRef.current = next;
      const nextDirty =
        fingerprint(next, quoteMetaRef.current) !== baselineRef.current;
      dirtyRef.current = nextDirty;
      setDirty(nextDirty);
      return next;
    });
    setErrors({});
    setSaveError("");
    setConflict(false);
  };

  useEffect(() => {
    if (!detail?.id || loadingOwnQuote || ownQuotesQuery.error || !detail.items)
      return;
    const incomingMeta = ownQuote
      ? { id: ownQuote.id, version: ownQuote.version }
      : null;
    // A save may invalidate/refetch detail before the quote-list cache updates.
    // There is no quote deletion path, so an older empty list must never erase a
    // confirmed local save while that quote-list response is in flight.
    if (quoteMetaRef.current && !incomingMeta) return;
    // Do not overwrite a confirmed local save with a stale cache response.
    if (
      incomingMeta &&
      quoteMetaRef.current?.id === incomingMeta.id &&
      incomingMeta.version < quoteMetaRef.current.version
    )
      return;
    const recordKey = `${detail.id}:${detail.revision ?? 1}:${incomingMeta?.id ?? "new"}:${incomingMeta?.version ?? 0}`;
    if (
      loadedRef.current === recordKey ||
      dirtyRef.current ||
      savingRef.current ||
      awaitingReplay
    )
      return;
    const loaded = emptyForm(detail.items, ownQuote);
    demandRevisionRef.current = detail.revision ?? 1;
    setLoadedDemandRevision(detail.revision ?? 1);
    setRevisionConfirmed(false);
    formRef.current = loaded;
    quoteMetaRef.current = incomingMeta;
    setForm(loaded);
    setQuoteMeta(incomingMeta);
    baselineRef.current = fingerprint(loaded, incomingMeta);
    dirtyRef.current = false;
    setDirty(false);
    setErrors({});
    setSaveError("");
    setAwaitingReplay(false);
    loadedRef.current = recordKey;
  }, [
    detail?.id,
    detail?.revision,
    detail?.items,
    quoteId,
    ownQuote?.id,
    ownQuote?.version,
    loadingOwnQuote,
    ownQuotesQuery.error,
    awaitingReplay,
  ]);

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

  const updateHeader = (key: "supplierName" | "note", value: string) =>
    replaceForm(current => ({ ...current, [key]: value }));
  const updateLine = (
    index: number,
    optionIndex: number,
    key: "qty" | "unitPrice" | "leadTime" | "note",
    value: string
  ) =>
    replaceForm(current => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              options: item.options.map((option, i) =>
                i === optionIndex ? { ...option, [key]: value } : option
              ),
            }
          : item
      ),
    }));
  const updateIncluded = (index: number, include: boolean) =>
    replaceForm(current => ({
      ...current,
      items: current.items.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const options = item.options.length ? item.options : [blankOption(1)];
        return {
          ...item,
          include,
          options: options.map((option, i) =>
            i === 0 && include && !option.qty
              ? {
                  ...option,
                  qty:
                    item.demandQty && item.demandQty > 0
                      ? String(item.demandQty)
                      : "",
                }
              : option
          ),
        };
      }),
    }));

  const addOption = (index: number) =>
    replaceForm(current => ({
      ...current,
      items: current.items.map((item, i) =>
        i === index
          ? {
              ...item,
              options: [
                ...item.options,
                blankOption(
                  Math.max(
                    0,
                    ...item.options.map(option => option.alternateNo)
                  ) + 1
                ),
              ],
            }
          : item
      ),
    }));
  const removeOption = (index: number, optionIndex: number) =>
    replaceForm(current => ({
      ...current,
      items: current.items.map((item, i) =>
        i === index
          ? {
              ...item,
              options: item.options.filter(
                (option, j) => j !== optionIndex || option.persisted
              ),
            }
          : item
      ),
    }));

  const buildPayload = () => {
    const current = formRef.current;
    const currentMeta = quoteMetaRef.current;
    const selected = current.items.flatMap((item, formIndex) =>
      !item.include
        ? []
        : item.options.flatMap((option, optionIndex) =>
            isBlankOption(option)
              ? []
              : [{ item, option, formIndex, optionIndex }]
          )
    );
    const items = selected.map(({ item, option }) => ({
      demandItemId: item.demandItemId,
      alternateNo: option.alternateNo,
      qty: /^\d+$/.test(option.qty.trim())
        ? Number(option.qty.trim())
        : Number.NaN,
      // Prices stay decimal strings; blank is never converted to zero.
      unitPrice: option.unitPrice.trim(),
      leadTime: option.leadTime.trim(),
      note: option.note.trim(),
    }));
    const candidate = {
      demandId,
      demandRevision: demandRevisionRef.current,
      ...(currentMeta
        ? { id: currentMeta.id, version: currentMeta.version }
        : {}),
      requestId: "demandquote_validation_key",
      supplierName: current.supplierName.trim(),
      note: current.note.trim(),
      items,
    };
    const parsed = demandQuoteSaveSchema.safeParse(candidate);
    const nextErrors: FieldErrors = {};
    if (!parsed.success)
      parsed.error.issues.forEach(issue => {
        const path = [...issue.path];
        // The shared schema indexes the compact selected payload. Map those
        // errors back onto the corresponding source-table row for partial quotes.
        if (path[0] === "items" && typeof path[1] === "number") {
          const selectedRow = selected[path[1]];
          if (selectedRow)
            path.splice(
              1,
              1,
              selectedRow.formIndex,
              "options",
              selectedRow.optionIndex
            );
        }
        nextErrors[path.join(".")] = issue.message;
      });
    current.items.forEach((item, index) => {
      if (item.include && !selected.some(row => row.formIndex === index))
        nextErrors[`items.${index}`] = "勾选物料至少填写一个完整报价方案";
    });
    setErrors(nextErrors);
    return { current, items, errors: nextErrors };
  };

  const save = async (excessConfirmed = false) => {
    if (savingRef.current || !formReady) return;
    if (!awaitingReplay && revisionChanged) {
      setConflict(true);
      setSaveError("需求已更新，请重新加载并核对最新物料后报价。");
      return;
    }
    if (needsReconfirmation && !revisionConfirmed) {
      setSaveError("请先勾选确认已核对最新需求版本。");
      return;
    }
    const built = buildPayload();
    if (Object.keys(built.errors).length) return;
    if (
      !awaitingReplay &&
      !excessConfirmed &&
      built.items.some(option => {
        const item = built.current.items.find(
          line => line.demandItemId === option.demandItemId
        );
        return item?.demandQty != null && option.qty > item.demandQty;
      })
    ) {
      setConfirmExcess(true);
      return;
    }
    const meta = quoteMetaRef.current;
    const keyFingerprint = `${demandRevisionRef.current}:${fingerprint(built.current, meta)}`;
    let requestId = requestKeysRef.current.get(keyFingerprint);
    if (!requestId) {
      requestId = requestKey();
      requestKeysRef.current.set(keyFingerprint, requestId);
    }
    const payload = {
      demandId,
      demandRevision: demandRevisionRef.current,
      ...(meta ? { id: meta.id, version: meta.version } : {}),
      requestId,
      supplierName: built.current.supplierName.trim(),
      note: built.current.note.trim(),
      items: built.items,
    };
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    setConflict(false);
    try {
      const result = await saveMutation.mutateAsync(payload);
      const nextMeta = { id: result.id, version: result.version };
      quoteMetaRef.current = nextMeta;
      setQuoteMeta(nextMeta);
      const committed = {
        ...formRef.current,
        items: formRef.current.items.map(item =>
          !item.include
            ? item
            : {
                ...item,
                options: item.options.map(option =>
                  isBlankOption(option)
                    ? option
                    : { ...option, persisted: true }
                ),
              }
        ),
      };
      formRef.current = committed;
      setForm(committed);
      baselineRef.current = fingerprint(committed, nextMeta);
      dirtyRef.current = false;
      setDirty(false);
      loadedRef.current = `${demandId}:${demandRevisionRef.current}:${result.id}:${result.version}`;
      setErrors({});
      setAwaitingReplay(false);
      toast.success(meta ? "报价已修改" : "报价已提交");
      // Mutation success is final. Cache-refresh failure must never turn it into a UI failure.
      void Promise.resolve(
        utils.customerDemand?.procurementList?.invalidate?.()
      ).catch(() => undefined);
      void Promise.resolve(
        utils.customerDemand?.procurementGet?.invalidate?.({ id: demandId })
      ).catch(() => undefined);
      void Promise.resolve(
        utils.customerDemand?.quoteList?.invalidate?.({ demandId })
      ).catch(() => undefined);
      void Promise.resolve(
        utils.customerDemand?.salesList?.invalidate?.()
      ).catch(() => undefined);
      void Promise.resolve(
        utils.crmSalesOrder?.candidates?.invalidate?.()
      ).catch(() => undefined);
      try {
        onSaved?.();
      } catch {
        /* callback failure does not change saved state */
      }
    } catch (error) {
      if (isConflict(error)) {
        setConflict(true);
        setSaveError("报价版本已更新，请重新加载后确认最新内容再保存。");
      } else if (isAmbiguousNetworkFailure(error)) {
        // We cannot know whether the server committed the idempotent request.
        // Lock edits and replay exactly the same payload/request ID on retry.
        setAwaitingReplay(true);
        setSaveError(
          "网络状态不明确，报价内容已锁定。请重试保存，系统将使用同一请求编号安全重放。"
        );
      } else {
        setSaveError(errorMessage(error));
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const reloadSafely = async () => {
    if (savingRef.current) return;
    loadedRef.current = null;
    dirtyRef.current = false;
    setDirty(false);
    setAwaitingReplay(false);
    setSaveError("");
    setConflict(false);
    await Promise.allSettled(
      [detailQuery.refetch?.(), ownQuotesQuery.refetch?.()].filter(
        Boolean
      ) as Promise<unknown>[]
    );
  };

  const errorForLine = (
    index: number,
    optionIndex: number,
    key: "qty" | "unitPrice" | "leadTime" | "note"
  ) => fieldError(errors, `items.${index}.options.${optionIndex}.${key}`);

  return (
    <>
      <Dialog
        open
        onOpenChange={open => {
          if (!open) requestClose();
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="flex min-w-0 max-h-[90dvh] w-[calc(100vw-32px)] max-w-[1100px] sm:max-w-[1100px] flex-col gap-0 overflow-hidden p-0"
          onEscapeKeyDown={event => {
            event.preventDefault();
            requestClose();
          }}
          onInteractOutside={event => {
            event.preventDefault();
            requestClose();
          }}
        >
          <div className="flex min-w-0 shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold text-slate-800">
                {quoteMeta
                  ? `修改报价 · 第${quoteMeta.version + 1}轮`
                  : "新增供应商报价"}
              </DialogTitle>
              <DialogDescription className="mt-1 truncate text-xs text-slate-500">
                {detail?.demandNo
                  ? `${detail.demandNo} · V${detail.revision ?? 1} · `
                  : ""}
                可选择部分物料报价；保存修改会生成新一轮并保留历史
              </DialogDescription>
            </div>
            <button
              type="button"
              aria-label="关闭报价"
              disabled={saving}
              onClick={requestClose}
              className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-3">
            {(detailQuery.isLoading || loadingOwnQuote) && (
              <div className="flex items-center gap-2 py-8 text-xs text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在加载需求和您的报价…
              </div>
            )}
            {Boolean(detailQuery.error) && (
              <p
                role="alert"
                className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
              >
                {errorMessage(detailQuery.error)}
              </p>
            )}
            {Boolean(ownQuotesQuery.error) && (
              <p
                role="alert"
                className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
              >
                无法确认您的已有报价，暂不能编辑：
                {errorMessage(ownQuotesQuery.error)}
              </p>
            )}
            {!loadingOwnQuote &&
              !ownQuotesQuery.error &&
              quoteId != null &&
              !ownQuote && (
                <p
                  role="alert"
                  className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                >
                  报价不存在、已被更新或不属于当前采购人员，请关闭后刷新。
                </p>
              )}
            {revisionChanged && (
              <p
                role="alert"
                className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
              >
                需求已变更为 V{detail?.revision ?? 1}。本次填写仍基于 V
                {loadedDemandRevision}
                ，请重新加载后核对；旧输入不会静默覆盖新需求。
              </p>
            )}
            {needsReconfirmation && !revisionChanged && (
              <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <p>
                  原报价基于 V{ownQuote?.demandRevision ?? 1}，当前需求为 V
                  {loadedDemandRevision}
                  。以下按最新需求展示，沿用的旧报价数值仅供核对；请重新确认后保存。
                </p>
                <label className="mt-2 flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={revisionConfirmed}
                    disabled={saving || awaitingReplay}
                    onChange={event =>
                      setRevisionConfirmed(event.target.checked)
                    }
                  />
                  <span>
                    我已核对最新需求，确认本次报价适用于 V{loadedDemandRevision}
                  </span>
                </label>
              </div>
            )}
            {formReady && (
              <>
                <div className="grid gap-2 border-b border-slate-100 pb-3 sm:grid-cols-3">
                  <div>
                    <label htmlFor="quote-supplier" className={labelClass}>
                      供应商名称
                    </label>
                    <input
                      id="quote-supplier"
                      maxLength={128}
                      value={form.supplierName}
                      disabled={editingLocked}
                      onChange={event =>
                        updateHeader("supplierName", event.target.value)
                      }
                      className={`${compactInput} w-full`}
                    />
                    {fieldError(errors, "supplierName") && (
                      <p className="mt-1 text-[11px] text-red-600">
                        {fieldError(errors, "supplierName")}
                      </p>
                    )}
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="quote-note" className={labelClass}>
                      报价说明（选填）
                    </label>
                    <input
                      id="quote-note"
                      maxLength={1000}
                      value={form.note}
                      disabled={editingLocked}
                      onChange={event =>
                        updateHeader("note", event.target.value)
                      }
                      className={`${compactInput} w-full`}
                    />
                  </div>
                </div>
                <div className="mt-3 min-w-0">
                  <div className="mb-2">
                    <h3 className="text-sm font-semibold text-slate-800">
                      报价明细
                    </h3>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      勾选物料后可添加多个备选方案；每行至少一个完整方案，空白新增不提交。备选方案不累计为采购金额。
                    </p>
                  </div>
                  {fieldError(errors, "items") && (
                    <p role="alert" className="mb-2 text-xs text-red-600">
                      {fieldError(errors, "items")}
                    </p>
                  )}
                  <div className="space-y-2">
                    {form.items.map((item, index) => (
                      <section
                        key={item.demandItemId}
                        className="rounded border border-slate-200"
                        aria-label={`需求行${index + 1}`}
                      >
                        <div className="flex flex-wrap items-center gap-3 bg-slate-50 px-3 py-2 text-xs">
                          <input
                            type="checkbox"
                            aria-label={`选择第${index + 1}行报价`}
                            checked={item.include}
                            disabled={editingLocked}
                            onChange={event =>
                              updateIncluded(index, event.target.checked)
                            }
                          />
                          <strong className="text-slate-800">
                            {item.partNumber || "—"}
                          </strong>
                          <span className="text-slate-600">
                            {item.brand || "—"} · {item.pkg || "—"}
                          </span>
                          <span className="text-slate-500">
                            需求数量：{item.demandQty ?? "—"} {item.qtyUnit}
                          </span>
                        </div>
                        {fieldError(errors, `items.${index}`) && (
                          <p
                            role="alert"
                            className="px-3 pt-2 text-xs text-red-600"
                          >
                            {fieldError(errors, `items.${index}`)}
                          </p>
                        )}
                        <div className="overflow-x-auto px-2">
                          <table className="min-w-[720px] w-full table-fixed text-xs">
                            <thead>
                              <tr className="h-8 text-left text-[11px] text-slate-500">
                                <th className="w-16 px-1">方案</th>
                                <th className="px-1">报价数量</th>
                                <th className="px-1">含税单价（元）</th>
                                <th className="px-1">交期</th>
                                <th className="px-1">备注</th>
                                <th className="w-16 px-1">操作</th>
                              </tr>
                            </thead>
                            <tbody>
                              {item.options.map((option, optionIndex) => (
                                <tr
                                  key={option.alternateNo}
                                  className="border-t border-slate-100 align-top"
                                >
                                  <td className="px-1 py-2 text-slate-600">
                                    方案{option.alternateNo}
                                  </td>
                                  {(
                                    [
                                      "qty",
                                      "unitPrice",
                                      "leadTime",
                                      "note",
                                    ] as const
                                  ).map(key => {
                                    const label = {
                                      qty: "报价数量",
                                      unitPrice: "含税单价",
                                      leadTime: "交期",
                                      note: "报价备注",
                                    }[key];
                                    const error = errorForLine(
                                      index,
                                      optionIndex,
                                      key
                                    );
                                    return (
                                      <td key={key} className="p-1">
                                        <input
                                          data-testid={`quote-item-${index}-${optionIndex === 0 ? "" : `option-${optionIndex}-`}${key}`}
                                          aria-label={`第${index + 1}行${optionIndex === 0 ? "" : `方案${option.alternateNo}`}${label}`}
                                          inputMode={
                                            key === "qty"
                                              ? "numeric"
                                              : key === "unitPrice"
                                                ? "decimal"
                                                : "text"
                                          }
                                          maxLength={
                                            key === "leadTime"
                                              ? 80
                                              : key === "note"
                                                ? 500
                                                : undefined
                                          }
                                          placeholder={
                                            key === "leadTime"
                                              ? "现货 / 7天到货"
                                              : undefined
                                          }
                                          value={option[key]}
                                          disabled={
                                            editingLocked || !item.include
                                          }
                                          onChange={event =>
                                            updateLine(
                                              index,
                                              optionIndex,
                                              key,
                                              event.target.value
                                            )
                                          }
                                          className={`${compactInput} w-full`}
                                        />
                                        {error && (
                                          <p className="mt-1 text-[11px] text-red-600">
                                            {error}
                                          </p>
                                        )}
                                      </td>
                                    );
                                  })}
                                  <td className="px-1 py-1">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      className="h-8 px-2 text-[11px] text-red-600"
                                      aria-label={`删除第${index + 1}行方案${option.alternateNo}`}
                                      disabled={
                                        editingLocked ||
                                        !item.include ||
                                        option.persisted
                                      }
                                      onClick={() =>
                                        removeOption(index, optionIndex)
                                      }
                                    >
                                      {option.persisted ? "已提交" : "删除"}
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="m-1 h-7 text-[11px] text-[#185FA5]"
                          aria-label={`第${index + 1}行添加报价方案`}
                          disabled={
                            editingLocked ||
                            !item.include ||
                            Math.max(
                              0,
                              ...item.options.map(option => option.alternateNo)
                            ) >= 100
                          }
                          onClick={() => addOption(index)}
                        >
                          ＋添加报价方案
                        </Button>
                      </section>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500 sm:hidden">
                    左右滑动可填写报价数量、价格和交期。
                  </p>
                </div>
              </>
            )}
            {saveError && (
              <p
                role="alert"
                className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700"
              >
                {saveError}
              </p>
            )}
          </div>
          <div className="flex min-w-0 shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={requestClose}
              className="h-8 bg-white px-3 text-xs"
            >
              取消
            </Button>
            {(conflict || revisionChanged) && !awaitingReplay && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => void reloadSafely()}
                className="h-8 px-3 text-xs"
              >
                重新加载
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              disabled={
                saving || !formReady || (!awaitingReplay && revisionChanged)
              }
              onClick={() => void save()}
              className="h-8 bg-[#185FA5] px-3 text-xs hover:bg-[#0C447C]"
            >
              {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {awaitingReplay
                ? "重试保存"
                : needsReconfirmation
                  ? "确认并保存报价"
                  : quoteMeta
                    ? "保存为新一轮"
                    : "提交报价"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {confirmExcess && (
        <ConfirmDialog
          title="报价数量超过需求数量"
          description="部分方案数量超过需求，可能涉及整包或MOQ，确认继续提交？"
          confirmLabel="确认并提交"
          onCancel={() => setConfirmExcess(false)}
          onConfirm={() => {
            setConfirmExcess(false);
            void save(true);
          }}
        />
      )}
      {confirmDiscard && (
        <ConfirmDialog
          title="放弃未保存的报价？"
          description="关闭后本次未保存的报价内容将丢失。"
          confirmLabel="放弃并关闭"
          danger
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={() => {
            setConfirmDiscard(false);
            onClose();
          }}
        />
      )}
    </>
  );
}

export default DemandQuoteDialog;
