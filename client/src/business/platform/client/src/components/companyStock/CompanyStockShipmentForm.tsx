import { useEffect, useRef, useState } from "react";
import { trpc } from "../../../../../api/business-trpc";
import {
  useCompanyStockScope,
  useCompanyStockSession,
} from "./useCompanyStockSession";
import {
  salesOrderCompanyStockShipSchema,
  type SalesOrderDetail,
  type SalesOrderCompanyStockShipInput,
} from "../../../../shared/crmSalesOrders";
import { requestId } from "./companyStockSales";
import { CompanyStockAllocationForm } from "./CompanyStockAllocationForm";

export function CompanyStockShipmentForm(
  props: Parameters<typeof CompanyStockShipmentSession>[0]
) {
  const scope = useCompanyStockScope();
  return (
    <CompanyStockShipmentSession
      key={`${scope.identityKey}:${props.order.id}`}
      {...props}
      enabled={props.enabled && scope.ready}
    />
  );
}
function CompanyStockShipmentSession({
  order,
  enabled,
  onSaved,
  onAllocated,
  onDirtyChange,
  onBusyChange,
  onCancel,
}: {
  order: SalesOrderDetail;
  enabled: boolean;
  onSaved: () => void;
  onAllocated: () => void;
  onDirtyChange: (value: boolean) => void;
  onBusyChange: (value: boolean) => void;
  onCancel: () => void;
}) {
  const session = useCompanyStockSession(enabled);
  const [deliveryMethod, setDeliveryMethod] = useState<"express" | "pickup">(
    "express"
  );
  const [expressCo, setExpressCo] = useState("");
  const [expressNo, setExpressNo] = useState("");
  const [note, setNote] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [allocationDirty, setAllocationDirty] = useState(false);
  const [allocationBusy, setAllocationBusy] = useState(false);
  const [uncertain, setUncertain] =
    useState<SalesOrderCompanyStockShipInput | null>(null);
  const keys = useRef(new Map<string, string>());
  const saving = useRef(false);
  const allocations = (order.companyStockAllocations ?? []).filter(
    row =>
      row.orderId === order.id &&
      row.reservedQty > 0 &&
      order.items.some(item => item.id === row.orderItemId)
  );
  const mutation = trpc.crmSalesOrder.shipCompanyStock.useMutation({
    onSuccess: () => {
      if (session.isWritable()) onSaved();
    },
    onError: failure => {
      if (!session.isWritable()) return;
      setError(failure.message || "出货结果未确认，请重试原请求");
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
      saving.current = false;
    },
  });
  const dirty = Boolean(
    deliveryMethod !== "express" ||
      expressCo ||
      expressNo ||
      note ||
      Object.values(qtys).some(Boolean) ||
      allocationDirty ||
      uncertain ||
      mutation.isPending
  );
  const busy = mutation.isPending || allocationBusy;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  useEffect(
    () => () => {
      onDirtyChange(false);
      onBusyChange(false);
    },
    [onDirtyChange, onBusyChange]
  );
  const locked = !enabled || busy || Boolean(uncertain);
  const submit = () => {
    if (!session.isWritable() || saving.current || allocationBusy) return;
    try {
      let payload = uncertain;
      if (!payload) {
        const items = allocations
          .filter(row => qtys[`${row.orderItemId}:${row.lotId}`]?.trim())
          .map(row => {
            const qty = Number(qtys[`${row.orderItemId}:${row.lotId}`]);
            if (!Number.isSafeInteger(qty) || qty <= 0 || qty > row.reservedQty)
              throw new Error("本次出货不得超过本单批次预留数量");
            return { orderItemId: row.orderItemId, lotId: row.lotId, qty };
          });
        for (const item of order.items) {
          const total = items
            .filter(row => row.orderItemId === item.id)
            .reduce((sum, row) => sum + row.qty, 0);
          if (total > item.orderedQty - item.shippedQty)
            throw new Error("本行出货总量超过待出数量");
        }
        payload = salesOrderCompanyStockShipSchema.parse({
          id: order.id,
          version: order.version,
          requestId: requestId(),
          deliveryMethod,
          expressCo: expressCo.trim(),
          expressNo: expressNo.trim(),
          note: note.trim(),
          items,
        });
        const key = JSON.stringify({ ...payload, requestId: undefined });
        if (!keys.current.has(key)) keys.current.set(key, requestId());
        payload.requestId = keys.current.get(key)!;
      }
      setError("");
      setUncertain(payload);
      saving.current = true;
      mutation.mutate(payload);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "出货内容无效");
    }
  };
  return (
    <div className="space-y-2" data-company-shipment>
      {order.sourceType !== "company_stock" && !uncertain ? (
        <CompanyStockAllocationForm
          key={order.id}
          order={order}
          enabled={enabled && !mutation.isPending}
          onSaved={onAllocated}
          onDirtyChange={setAllocationDirty}
          onBusyChange={setAllocationBusy}
        />
      ) : null}
      <div className="company-stock-toolbar">
        <label>
          交付方式{" "}
          <select
            className="crm-input"
            aria-label="公司出货交付方式"
            disabled={locked}
            value={deliveryMethod}
            onChange={e =>
              setDeliveryMethod(e.target.value as typeof deliveryMethod)
            }
          >
            <option value="express">快递</option>
            <option value="pickup">自提</option>
          </select>
        </label>
        {deliveryMethod === "express" ? (
          <>
            <input
              className="crm-input"
              aria-label="公司出货快递公司"
              placeholder="快递公司"
              value={expressCo}
              disabled={locked}
              onChange={e => setExpressCo(e.target.value)}
            />
            <input
              className="crm-input"
              aria-label="公司出货快递单号"
              placeholder="快递单号"
              value={expressNo}
              disabled={locked}
              onChange={e => setExpressNo(e.target.value)}
            />
          </>
        ) : null}
        <input
          className="crm-input"
          aria-label="公司出货备注"
          placeholder="备注"
          value={note}
          disabled={locked}
          onChange={e => setNote(e.target.value)}
        />
      </div>
      <div className="company-stock-scroll">
        <table
          className="company-stock-table crm-sales-orders-shipment-table"
          aria-label="本单已预留公司批次"
        >
          <thead>
            <tr>
              <th>物料 / 公司批次</th>
              <th className="numeric">待出</th>
              <th className="numeric">本单预留</th>
              <th className="numeric">本次出货</th>
            </tr>
          </thead>
          <tbody>
            {allocations.length ? (
              allocations.map(row => {
                const item = order.items.find(
                  item => item.id === row.orderItemId
                )!;
                const key = `${row.orderItemId}:${row.lotId}`;
                return (
                  <tr key={key} data-company-lot={row.lotId}>
                    <td>
                      <div>{item.partNumber}</div>
                      <div className="admin-cell-secondary">
                        {[
                          item.brand,
                          item.pkg,
                          item.dc,
                          `公司批次 #${row.lotId}`,
                        ]
                          .filter(Boolean)
                          .join(" / ")}
                      </div>
                    </td>
                    <td className="numeric">
                      {item.orderedQty - item.shippedQty}
                    </td>
                    <td className="numeric">{row.reservedQty}</td>
                    <td className="numeric">
                      <input
                        className="crm-input"
                        aria-label={`批次 ${row.lotId} 本次出货`}
                        inputMode="numeric"
                        value={qtys[key] ?? ""}
                        disabled={locked}
                        onChange={e =>
                          setQtys(current => ({
                            ...current,
                            [key]: e.target.value,
                          }))
                        }
                      />
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={4}>
                  无本单可出货预留批次
                  {order.sourceType === "company_stock"
                    ? "，请核验订单库存"
                    : "，请先分配公司库存"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {error ? (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      ) : null}
      {uncertain && !mutation.isPending ? (
        <p role="alert">出货结果待确认，请重试原请求。</p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="crm-btn"
          disabled={busy}
          onClick={onCancel}
        >
          取消
        </button>
        <button
          type="button"
          className="crm-btn crm-btn-primary"
          disabled={!enabled || busy || (!uncertain && !allocations.length)}
          onClick={submit}
        >
          {mutation.isPending
            ? "提交中…"
            : uncertain
              ? "确认出货结果"
              : "确认出货"}
        </button>
      </div>
    </div>
  );
}
