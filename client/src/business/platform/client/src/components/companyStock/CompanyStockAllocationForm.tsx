import { useEffect, useRef, useState } from "react";
import { trpc } from "../../../../../api/business-trpc";
import {
  useCompanyStockScope,
  useCompanyStockSession,
} from "./useCompanyStockSession";
import {
  salesOrderCompanyStockAllocateSchema,
  type SalesOrderDetail,
  type SalesOrderCompanyStockAllocateInput,
} from "../../../../shared/crmSalesOrders";
import { CompanyLotPicker } from "./CompanyLotPicker";
import {
  requestId,
  lotLabel,
  allocationLotMatches,
  allocationOrderError,
  companyStockAllocationItems,
  type AllocationDraft,
} from "./companyStockSales";

export function CompanyStockAllocationForm(
  props: Parameters<typeof CompanyStockAllocationSession>[0]
) {
  const scope = useCompanyStockScope();
  return (
    <CompanyStockAllocationSession
      key={`${scope.identityKey}:${props.order.id}`}
      {...props}
      enabled={props.enabled && scope.ready}
    />
  );
}
function CompanyStockAllocationSession({
  order,
  enabled,
  onSaved,
  onDirtyChange,
  onBusyChange,
}: {
  order: SalesOrderDetail;
  enabled: boolean;
  onSaved: () => void;
  onDirtyChange: (value: boolean) => void;
  onBusyChange: (value: boolean) => void;
}) {
  const eligible = order.items;
  const orderError = allocationOrderError(order);
  const [itemId, setItemId] = useState(eligible[0]?.id ?? 0);
  const [keyword, setKeyword] = useState("");
  const [draftKeyword, setDraftKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState<Record<number, AllocationDraft[]>>({});
  const rows = drafts[itemId] ?? [];
  const [error, setError] = useState("");
  const [uncertain, setUncertain] =
    useState<SalesOrderCompanyStockAllocateInput | null>(null);
  const keys = useRef(new Map<string, string>());
  const busy = useRef(false);
  const session = useCompanyStockSession(enabled);
  const item = eligible.find(row => row.id === itemId);
  const query = trpc.crmSalesOrder.companyStockCandidates.useQuery(
    {
      customerId: order.customerId,
      keyword: keyword || item?.partNumber || "",
      page,
      pageSize: 20,
    },
    {
      enabled: enabled && !orderError && Boolean(item),
      staleTime: 0,
      retry: false,
      placeholderData: undefined,
      refetchOnMount: "always",
    }
  );
  const fresh =
    enabled &&
    query.isSuccess &&
    !query.isFetching &&
    !query.isError &&
    !query.isPlaceholderData &&
    query.isFetchedAfterMount !== false;
  const lots = fresh
    ? (query.data?.items ?? []).filter(
        lot => item && allocationLotMatches(item, lot)
      )
    : [];
  const mutation = trpc.crmSalesOrder.allocateCompanyStock.useMutation({
    onSuccess: () => {
      if (!session.isWritable()) return;
      setDrafts({});
      setUncertain(null);
      onSaved();
    },
    onError: failure => {
      if (!session.isWritable()) return;
      setError(failure.message || "分配结果未确认");
      if (
        [
          "BAD_REQUEST",
          "FORBIDDEN",
          "UNAUTHORIZED",
          "NOT_FOUND",
          "CONFLICT",
        ].includes(failure.data?.code ?? "")
      )
        setUncertain(null);
    },
    onSettled: () => {
      busy.current = false;
    },
  });
  const dirty = Boolean(
    Object.values(drafts).some(lines => lines.length) ||
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
  const submit = () => {
    if (!session.isWritable() || busy.current) return;
    try {
      let payload = uncertain;
      if (!payload) {
        if (!fresh) throw new Error("库存候选未核验，请重试");
        payload = salesOrderCompanyStockAllocateSchema.parse({
          id: order.id,
          version: order.version,
          requestId: requestId(),
          items: companyStockAllocationItems(order, drafts),
        });
        const fingerprint = JSON.stringify({
          ...payload,
          requestId: undefined,
        });
        if (!keys.current.has(fingerprint))
          keys.current.set(fingerprint, requestId());
        payload.requestId = keys.current.get(fingerprint)!;
      }
      setError("");
      setUncertain(payload);
      busy.current = true;
      mutation.mutate(payload);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "分配无效");
    }
  };
  const locked = !enabled || mutation.isPending || Boolean(uncertain);
  const updateRows = (
    update: (lines: AllocationDraft[]) => AllocationDraft[]
  ) => {
    if (!session.isWritable() || locked || busy.current) return;
    setDrafts(current => ({
      ...current,
      [itemId]: update(current[itemId] ?? []),
    }));
  };
  if (!eligible.length) return null;
  if (orderError && !uncertain) return <p role="alert">{orderError}</p>;
  return (
    <details className="crm-sales-orders-fold">
      <summary>分配公司库存</summary>
      <div className="company-stock-toolbar">
        <select
          aria-label="待分配订单物料"
          className="crm-input"
          disabled={locked}
          value={itemId}
          onChange={e => {
            if (!session.isWritable() || locked || busy.current) return;
            setItemId(Number(e.target.value));
            setPage(1);
            setKeyword("");
            setDraftKeyword("");
          }}
        >
          {eligible.map(row => (
            <option key={row.id} value={row.id}>
              {row.partNumber} · 订单行 #{row.id} · 数量 {row.orderedQty}
            </option>
          ))}
        </select>
        <input
          className="crm-input"
          aria-label="搜索型号"
          placeholder="搜索型号"
          value={draftKeyword}
          disabled={locked}
          onChange={e => setDraftKeyword(e.target.value)}
        />
        <button
          type="button"
          className="crm-btn"
          disabled={locked}
          onClick={() => {
            setKeyword(draftKeyword.trim());
            setPage(1);
          }}
        >
          搜索
        </button>
      </div>
      <ul aria-label="整单物料分配完成情况">
        {eligible.map(row => {
          let total = BigInt(0);
          let valid = Boolean(drafts[row.id]?.length);
          for (const line of drafts[row.id] ?? []) {
            const qty = Number(line.qty);
            if (
              !/^\d+$/.test(line.qty) ||
              !Number.isSafeInteger(qty) ||
              qty <= 0 ||
              qty > 999999999 ||
              qty > line.lot.availableQty ||
              !allocationLotMatches(row, line.lot)
            ) {
              valid = false;
            } else total += BigInt(qty);
          }
          return (
            <li key={row.id} data-allocation-item={row.id}>
              {row.partNumber} · 订单行 #{row.id}：{total.toString()} /{" "}
              {row.orderedQty}
              {valid && total === BigInt(row.orderedQty)
                ? " · 已完成"
                : " · 未完成"}
            </li>
          );
        })}
      </ul>
      {!locked ? (
        <CompanyLotPicker
          lots={lots}
          selectedIds={rows.map(row => row.lot.lotId)}
          loading={query.isFetching}
          error={
            query.isError ? query.error?.message || "库存读取失败" : undefined
          }
          onRetry={() => {
            void query.refetch();
          }}
          onSelect={lot => {
            if (
              !session.isWritable() ||
              locked ||
              busy.current ||
              !fresh ||
              !lots.includes(lot)
            )
              return;
            updateRows(current =>
              current.some(row => row.lot.lotId === lot.lotId)
                ? current
                : [...current, { lot, qty: "" }]
            );
          }}
        />
      ) : null}
      <div className="company-stock-toolbar">
        <button
          type="button"
          className="crm-btn"
          disabled={locked || page <= 1 || query.isFetching}
          onClick={() => setPage(p => p - 1)}
        >
          上一页
        </button>
        <span>{page}</span>
        <button
          type="button"
          className="crm-btn"
          disabled={
            locked || page * 20 >= (query.data?.total ?? 0) || query.isFetching
          }
          onClick={() => setPage(p => p + 1)}
        >
          下一页
        </button>
      </div>
      {rows.map(row => (
        <div key={row.lot.lotId} className="company-stock-toolbar">
          <span>{lotLabel(row.lot)}</span>
          <input
            className="crm-input"
            aria-label={`批次 ${row.lot.lotId} 分配数量`}
            inputMode="numeric"
            value={row.qty}
            disabled={locked}
            onChange={e =>
              updateRows(current =>
                current.map(line =>
                  line.lot.lotId === row.lot.lotId
                    ? { ...line, qty: e.target.value }
                    : line
                )
              )
            }
          />
          <button
            type="button"
            className="crm-btn"
            disabled={locked}
            onClick={() =>
              updateRows(current =>
                current.filter(line => line.lot.lotId !== row.lot.lotId)
              )
            }
          >
            移除
          </button>
        </div>
      ))}
      {error ? (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      ) : null}
      {uncertain && !mutation.isPending ? (
        <p role="alert">分配结果待确认，请重试原整单请求。</p>
      ) : null}
      <button
        type="button"
        className="crm-btn"
        disabled={!enabled || mutation.isPending || (!uncertain && !fresh)}
        onClick={submit}
      >
        {mutation.isPending
          ? "分配中…"
          : uncertain
            ? "确认分配结果"
            : "确认分配并预留"}
      </button>
    </details>
  );
}
