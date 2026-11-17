import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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

export function CompanyStockOrderForm(
  props: Parameters<typeof CompanyStockOrderSession>[0]
) {
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
}: {
  customer: SalesCustomer;
  enabled: boolean;
  onCreated: (result: {
    id: number;
    orderNumber: string;
    replayed?: boolean;
  }) => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const session = useCompanyStockSession(enabled);
  const [draftKeyword, setDraftKeyword] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [lines, setLines] = useState<LotDraft[]>([]);
  const [salesTaxMode, setSalesTaxMode] = useState<
    "tax_included" | "tax_excluded"
  >("tax_included");
  const [dueDate, setDueDate] = useState("");
  const [confirmationNote, setConfirmationNote] = useState("");
  const [customerConfirmed, setCustomerConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] =
    useState<SalesOrderCompanyStockCreateInput | null>(null);
  const saving = useRef(false);
  const requestKeys = useRef(new Map<string, string>());
  const query = trpc.crmSalesOrder.companyStockCandidates.useQuery(
    { customerId: customer.id, keyword, page, pageSize: 20 },
    {
      enabled,
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
      setError(failure.message || "保存结果未确认，请重试原请求");
      const known = [
        "BAD_REQUEST",
        "FORBIDDEN",
        "UNAUTHORIZED",
        "NOT_FOUND",
        "CONFLICT",
      ].includes(failure.data?.code ?? "");
      if (known) setUncertain(null);
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
      uncertain ||
      mutation.isPending
  );
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onBusyChange(mutation.isPending);
  }, [mutation.isPending, onBusyChange]);
  useEffect(
    () => () => {
      onDirtyChange(false);
      onBusyChange(false);
    },
    [onDirtyChange, onBusyChange]
  );
  const locked = mutation.isPending || Boolean(uncertain) || !enabled;
  const search = () => {
    setKeyword(draftKeyword.trim());
    setPage(1);
  };
  const update = (
    lotId: number,
    field: "qty" | "agreedUnitPrice",
    value: string
  ) =>
    setLines(current =>
      current.map(line =>
        line.lot.lotId === lotId ? { ...line, [field]: value } : line
      )
    );
  const submit = () => {
    if (!session.isWritable() || saving.current) return;
    if (uncertain) {
      saving.current = true;
      mutation.mutate(uncertain);
      return;
    }
    if (!customerConfirmed) {
      setError("请确认已与客户确认订单");
      return;
    }
    if (!previewReady || !candidateReady) {
      setError("请先核验库存与订单预览");
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
      setError("");
      setUncertain(payload);
      saving.current = true;
      mutation.mutate(payload);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "请检查订单内容");
    }
  };
  return (
    <div className="space-y-2" data-company-stock-form>
      {!locked ? (
        <>
          <div className="company-stock-toolbar">
            <input
              className="crm-input"
              aria-label="搜索型号"
              placeholder="搜索型号"
              value={draftKeyword}
              onChange={e => setDraftKeyword(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") search();
              }}
            />
            <button type="button" className="crm-btn" onClick={search}>
              搜索
            </button>
          </div>
          <CompanyLotPicker
            lots={lots}
            selectedIds={lines.map(line => line.lot.lotId)}
            onSelect={lot => {
              if (
                !session.isWritable() ||
                !candidateReady ||
                !lots.includes(lot)
              )
                return;
              setLines(current =>
                current.some(line => line.lot.lotId === lot.lotId)
                  ? current
                  : [...current, { lot, qty: "", agreedUnitPrice: "" }]
              );
            }}
            loading={query.isFetching || query.isLoading}
            error={
              query.isError ? query.error?.message || "库存读取失败" : undefined
            }
            onRetry={() => {
              void query.refetch();
            }}
          />
          <div className="company-stock-toolbar">
            <button
              type="button"
              className="crm-btn"
              disabled={page <= 1 || query.isFetching}
              onClick={() => setPage(p => p - 1)}
            >
              上一页
            </button>
            <span>{page}</span>
            <button
              type="button"
              className="crm-btn"
              disabled={
                page * 20 >= (query.data?.total ?? 0) || query.isFetching
              }
              onClick={() => setPage(p => p + 1)}
            >
              下一页
            </button>
          </div>
        </>
      ) : null}
      {lines.length ? (
        <div className="company-stock-scroll">
          <table className="company-stock-table" aria-label="公司库存订单物料">
            <thead>
              <tr>
                <th>真实批次物料</th>
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
                      onChange={e =>
                        update(line.lot.lotId, "qty", e.target.value)
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
                      onChange={e =>
                        update(
                          line.lot.lotId,
                          "agreedUnitPrice",
                          e.target.value
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
                        setLines(current =>
                          current.filter(
                            row => row.lot.lotId !== line.lot.lotId
                          )
                        )
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
      ) : null}
      <div className="company-stock-toolbar">
        <label>
          销售口径{" "}
          <select
            aria-label="销售含税未税"
            className="crm-input"
            disabled={locked}
            value={salesTaxMode}
            onChange={e =>
              setSalesTaxMode(e.target.value as typeof salesTaxMode)
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
            onChange={e => setDueDate(e.target.value)}
          />
        </label>
      </div>
      <label className="block">
        客户确认说明
        <textarea
          className="crm-input w-full"
          aria-label="公司订单客户确认说明"
          maxLength={500}
          disabled={locked}
          value={confirmationNote}
          onChange={e => setConfirmationNote(e.target.value)}
        />
      </label>
      <label className="company-stock-toolbar">
        <input
          type="checkbox"
          checked={customerConfirmed}
          disabled={locked}
          onChange={e => setCustomerConfirmed(e.target.checked)}
        />
        客户已确认数量、销售价格与交期
      </label>
      {previewReady ? (
        <>
          <div className="text-right tabular-nums">
            {preview.data.currencyLabel}：
            {formatSalesOrderAmount(preview.data.totalAmount)}
          </div>
          <SalesProfitSummary
            profit={preview.data.profitBreakdown}
            commission={preview.data.commissionPreview}
          />
        </>
      ) : preview.isFetching && parsedPreview?.success ? (
        <p role="status">正在核验订单预览…</p>
      ) : preview.isError && parsedPreview?.success ? (
        <p role="alert">
          {preview.error?.message || "订单预览不可用"}{" "}
          <button
            type="button"
            className="crm-btn"
            onClick={() => {
              void preview.refetch();
            }}
          >
            重试
          </button>
        </p>
      ) : (
        <p className="admin-cell-secondary">
          完善数量、单价及确认说明后核验预览
        </p>
      )}
      {error ? (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      ) : null}
      {uncertain && !mutation.isPending ? (
        <p role="alert">保存结果待确认，请重试原请求，暂不可修改。</p>
      ) : null}
      <div className="flex justify-end">
        <button
          type="button"
          className="crm-btn crm-btn-primary"
          disabled={
            !enabled ||
            mutation.isPending ||
            (!uncertain && (!previewReady || !candidateReady))
          }
          onClick={submit}
        >
          {mutation.isPending
            ? "保存中…"
            : uncertain
              ? "确认保存结果"
              : "保存订单"}
        </button>
      </div>
    </div>
  );
}
