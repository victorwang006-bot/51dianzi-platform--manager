import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "../../../../../api/business-trpc";
import {
  useCompanyStockScope,
  useCompanyStockSession,
} from "./useCompanyStockSession";
import {
  salesOrderCompanyStockCreateSchema,
  salesOrderCompanyStockPreviewSchema,
  canonicalCompanyStockCreatePayload,
  formatSalesOrderAmount,
  type SalesOrderCompanyStockCreateInput,
} from "../../../../shared/crmSalesOrders";
import { CompanyLotPicker } from "./CompanyLotPicker";
import { SalesProfitSummary } from "./SalesProfitSummary";
import {
  companyOrderItems,
  requestId,
  lotLabel,
  type LotDraft,
} from "./companyStockSales";
import type { SalesCustomer } from "./SalesCustomerPicker";

import { emptyCompanyStockDraft, type CompanyStockFormDraft } from "../../lib/companyStockOrderDraft";
export { emptyCompanyStockDraft, type CompanyStockFormDraft } from "../../lib/companyStockOrderDraft";
type Props = {
  customer: SalesCustomer;
  enabled: boolean;
  onCreated: (result: {
    id: number;
    orderNumber: string;
    replayed?: boolean;
  }) => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  onLockedChange?: (locked: boolean) => void;
  onClose?: () => void;
  draft?: CompanyStockFormDraft | null;
  onDraftChange?: (draft: CompanyStockFormDraft) => void;
  /** Must durably freeze the full payload before the create RPC can be sent. */
  onPersistRequest?: (draft: CompanyStockFormDraft) => Promise<void>;
};
export function CompanyStockOrderForm(props: Props) {
  const scope = useCompanyStockScope();
  return (
    <CompanyStockOrderSession
      key={`${scope.identityKey}:${props.customer.id}`}
      {...props}
      enabled={props.enabled && scope.ready}
    />
  );
}
function CompanyStockOrderSession({
  customer,
  enabled,
  onCreated,
  onDirtyChange,
  onBusyChange,
  onLockedChange,
  onClose,
  draft,
  onDraftChange,
  onPersistRequest,
}: Props) {
  const session = useCompanyStockSession(enabled);
  const [draftKeyword, setDraftKeyword] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [value, setValue] = useState<CompanyStockFormDraft>(
    () => draft ?? emptyCompanyStockDraft()
  );
  const [error, setError] = useState("");
  const [persisting, setPersisting] = useState(false);
  const saving = useRef(false);
  const retryingUnknown = useRef(Boolean(draft?.pendingRequest));
  const requestKeys = useRef(new Map<string, string>());
  const valueRef = useRef(value);
  valueRef.current = value;
  const {
    lines,
    salesTaxMode,
    dueDate,
    confirmationNote,
    customerConfirmed,
    pendingRequest: uncertain,
  } = value;
  const updateDraft = (next: Partial<CompanyStockFormDraft>) =>
    setValue(current => ({ ...current, ...next }));
  const query = trpc.crmSalesOrder.companyStockCandidates.useQuery(
    { customerId: customer.id, keyword, page, pageSize: 20 },
    {
      enabled: enabled && !uncertain,
      staleTime: 0,
      retry: false,
      placeholderData: undefined,
      refetchOnMount: "always",
    }
  );
  const candidateReady =
    enabled &&
    query.isSuccess &&
    !query.isFetching &&
    !query.isError &&
    !query.isPlaceholderData &&
    query.isFetchedAfterMount !== false;
  const lots = candidateReady ? (query.data?.items ?? []) : [];
  const parsedPreview = useMemo(() => {
    try {
      return salesOrderCompanyStockPreviewSchema.safeParse({
        customerId: customer.id,
        items: companyOrderItems(lines),
        salesTaxMode,
        dueDate: dueDate || null,
        confirmationNote: confirmationNote.trim(),
        customerConfirmed: true,
      });
    } catch {
      return null;
    }
  }, [customer.id, lines, salesTaxMode, dueDate, confirmationNote]);
  const preview = trpc.crmSalesOrder.previewCompanyStock.useQuery(
    parsedPreview?.success
      ? parsedPreview.data
      : {
          customerId: customer.id,
          items: [],
          salesTaxMode,
          dueDate: null,
          confirmationNote: "",
          customerConfirmed: true,
        },
    {
      enabled: enabled && Boolean(parsedPreview?.success) && !uncertain,
      staleTime: 0,
      retry: false,
      placeholderData: undefined,
      refetchOnMount: "always",
    }
  );
  const previewReady =
    enabled &&
    parsedPreview?.success &&
    preview.isSuccess &&
    !preview.isFetching &&
    !preview.isError &&
    !preview.isPlaceholderData &&
    !uncertain &&
    preview.isFetchedAfterMount !== false;
  const mutation = trpc.crmSalesOrder.createCompanyStock.useMutation({
    onSuccess: result => {
      if (session.isWritable()) onCreated(result);
    },
    onError: failure => {
      if (!session.isWritable()) return;
      const known = [
        "BAD_REQUEST",
        "FORBIDDEN",
        "UNAUTHORIZED",
        "NOT_FOUND",
        "CONFLICT",
      ].includes(failure.data?.code ?? "");
      // A recovered/unknown request may already exist: even a later rejection must not discard it.
      if (known && !retryingUnknown.current)
        updateDraft({ pendingRequest: null });
      else retryingUnknown.current = true;
      setError(failure.message || "保存结果待确认，请核验原请求。");
    },
    onSettled: () => {
      saving.current = false;
    },
  });
  const dirty = Boolean(
    lines.length ||
      dueDate ||
      confirmationNote ||
      customerConfirmed ||
      salesTaxMode !== "tax_included" ||
      uncertain ||
      mutation.isPending
  );
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onBusyChange(mutation.isPending || persisting);
  }, [mutation.isPending, persisting, onBusyChange]);
  useEffect(() => {
    onLockedChange?.(Boolean(uncertain));
  }, [uncertain, onLockedChange]);
  useEffect(() => {
    onDraftChange?.(value);
  }, [value, onDraftChange]);
  useEffect(
    () => () => {
      onDirtyChange(false);
      onBusyChange(false);
      onLockedChange?.(false);
    },
    [onDirtyChange, onBusyChange, onLockedChange]
  );
  const locked =
    mutation.isPending || persisting || Boolean(uncertain) || !enabled;
  const search = () => {
    setKeyword(draftKeyword.trim());
    setPage(1);
    if (draftKeyword.trim() === keyword && page === 1) void query.refetch();
  };
  const updateLine = (
    lotId: number,
    field: "qty" | "agreedUnitPrice",
    text: string
  ) => {
    if (locked) return;
    setValue(current => ({
      ...current,
      lines: current.lines.map(line =>
        line.lot.lotId === lotId ? { ...line, [field]: text } : line
      ),
    }));
  };
  const submit = async () => {
    if (!session.isWritable() || saving.current) return;
    if (uncertain) {
      retryingUnknown.current = true;
      saving.current = true;
      setError("");
      mutation.mutate(uncertain);
      return;
    }
    if (!customerConfirmed) {
      setError("请确认已与客户确认订单");
      return;
    }
    if (!confirmationNote.trim()) {
      setError("请填写客户确认说明");
      return;
    }
    if (!previewReady || !candidateReady) {
      setError("请先核验库存与订单金额");
      return;
    }
    try {
      const input = salesOrderCompanyStockCreateSchema.parse({
        customerId: customer.id,
        requestId: requestId(),
        items: companyOrderItems(lines),
        salesTaxMode,
        dueDate: dueDate || null,
        confirmationNote: confirmationNote.trim(),
        customerConfirmed,
      });
      const fingerprint = JSON.stringify(
        canonicalCompanyStockCreatePayload(input)
      );
      if (!requestKeys.current.has(fingerprint))
        requestKeys.current.set(fingerprint, requestId());
      const payload = {
        ...input,
        requestId: requestKeys.current.get(fingerprint)!,
      };
      const frozen = { ...valueRef.current, pendingRequest: payload };
      saving.current = true;
      setPersisting(true);
      setError("");
      setValue(frozen);
      // If durability cannot be established, do not send a new inventory-affecting request.
      if (onPersistRequest) await onPersistRequest(frozen);
      if (!session.isWritable()) {
        retryingUnknown.current = true;
        saving.current = false;
        return;
      }
      mutation.mutate(payload);
    } catch (failure) {
      saving.current = false;
      setError(failure instanceof Error ? failure.message : "请检查订单内容");
    } finally {
      setPersisting(false);
    }
  };
  const inlineError =
    error ||
    (uncertain && !mutation.isPending && !persisting
      ? "保存结果待确认，内容已锁定。"
      : preview.isError && parsedPreview?.success
        ? preview.error?.message || "订单金额核验失败"
        : "");
  return (
    <div className="space-y-3" data-company-stock-form>
      <section className="crm-order-section" aria-label="公司库存货源">
        <h3 className="crm-order-section-title">货源批次</h3>
        <CompanyLotPicker
          lots={lots}
          selectedIds={lines.map(line => line.lot.lotId)}
          disabled={locked}
          keyword={draftKeyword}
          onKeywordChange={setDraftKeyword}
          onSearch={search}
          onOpen={() => {
            void query.refetch();
          }}
          page={page}
          total={query.data?.total ?? 0}
          pageSize={20}
          onPageChange={setPage}
          loading={query.isFetching || query.isLoading}
          error={
            query.isError ? query.error?.message || "库存读取失败" : undefined
          }
          onRetry={() => {
            void query.refetch();
          }}
          onSelect={lot => {
            if (
              !session.isWritable() ||
              !candidateReady ||
              !lots.includes(lot) ||
              locked
            )
              return;
            setValue(current =>
              current.lines.some(line => line.lot.lotId === lot.lotId)
                ? current
                : {
                    ...current,
                    lines: [
                      ...current.lines,
                      { lot, qty: "", agreedUnitPrice: "" },
                    ],
                  }
            );
          }}
        />
      </section>
      <section className="crm-order-section" aria-label="订单明细">
        <h3 className="crm-order-section-title">订单明细</h3>
        {lines.length ? (
          <div className="company-stock-scroll">
            <table
              className="company-stock-table"
              aria-label="公司库存订单物料"
            >
              <thead>
                <tr>
                  <th>型号 / 品牌 / 批次</th>
                  <th className="numeric">可售</th>
                  <th className="numeric">销售数量</th>
                  <th className="numeric">销售单价</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(line => (
                  <tr key={line.lot.lotId}>
                    <td>{lotLabel(line.lot)}</td>
                    <td className="numeric">{line.lot.availableQty}</td>
                    <td className="numeric">
                      <input
                        className="crm-input"
                        aria-label={`批次 ${line.lot.lotId} 销售数量`}
                        inputMode="numeric"
                        value={line.qty}
                        disabled={locked}
                        onChange={event =>
                          updateLine(line.lot.lotId, "qty", event.target.value)
                        }
                      />
                    </td>
                    <td className="numeric">
                      <input
                        className="crm-input"
                        aria-label={`批次 ${line.lot.lotId} 销售单价`}
                        inputMode="decimal"
                        value={line.agreedUnitPrice}
                        disabled={locked}
                        onChange={event =>
                          updateLine(
                            line.lot.lotId,
                            "agreedUnitPrice",
                            event.target.value
                          )
                        }
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="crm-btn"
                        disabled={locked}
                        onClick={() =>
                          setValue(current => ({
                            ...current,
                            lines: current.lines.filter(
                              row => row.lot.lotId !== line.lot.lotId
                            ),
                          }))
                        }
                      >
                        移除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="admin-cell-secondary">尚未选择批次</p>
        )}
        <div className="company-stock-toolbar mt-3">
          <label>
            销售口径{" "}
            <select
              aria-label="销售含税未税"
              className="crm-input"
              disabled={locked}
              value={salesTaxMode}
              onChange={event =>
                updateDraft({
                  salesTaxMode: event.target.value as typeof salesTaxMode,
                })
              }
            >
              <option value="tax_included">含税</option>
              <option value="tax_excluded">未税</option>
            </select>
          </label>
          <label>
            交期{" "}
            <input
              type="date"
              aria-label="公司订单交期"
              className="crm-input"
              value={dueDate}
              disabled={locked}
              onChange={event => updateDraft({ dueDate: event.target.value })}
            />
          </label>
        </div>
        <label className="block mt-3">
          客户确认说明 <span className="text-red-600">*</span>
          <textarea
            className="crm-input w-full"
            aria-label="公司订单客户确认说明"
            maxLength={500}
            disabled={locked}
            value={confirmationNote}
            onChange={event =>
              updateDraft({ confirmationNote: event.target.value })
            }
          />
        </label>
        <label className="company-stock-toolbar mt-2">
          <input
            type="checkbox"
            checked={customerConfirmed}
            disabled={locked}
            onChange={event =>
              updateDraft({ customerConfirmed: event.target.checked })
            }
          />
          客户已确认数量、销售价格与交期 <span className="text-red-600">*</span>
        </label>
        {previewReady ? (
          <>
            <div className="text-right tabular-nums mt-2">
              {preview.data.currencyLabel}：
              {formatSalesOrderAmount(preview.data.totalAmount)}
            </div>
            <SalesProfitSummary
              profit={preview.data.profitBreakdown}
              commission={preview.data.commissionPreview}
            />
          </>
        ) : preview.isFetching && parsedPreview?.success ? (
          <p role="status">正在核验订单金额…</p>
        ) : null}
      </section>
      {inlineError ? (
        <p role="alert" className="text-xs text-red-600">
          {inlineError}
        </p>
      ) : null}
      <div className="crm-order-actions">
        {onClose ? (
          <button
            type="button"
            className="crm-btn"
            disabled={mutation.isPending || persisting}
            onClick={onClose}
          >
            收起
          </button>
        ) : null}
        <button
          type="button"
          className="crm-btn crm-btn-primary"
          disabled={
            !enabled ||
            mutation.isPending ||
            persisting ||
            (!uncertain && (!previewReady || !candidateReady))
          }
          onClick={() => {
            void submit();
          }}
        >
          {mutation.isPending || persisting
            ? "保存中…"
            : uncertain
              ? "确认保存结果"
              : "保存订单"}
        </button>
      </div>
    </div>
  );
}
