import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  formatSalesOrderAmount,
  type SalesOrderSummary,
  type SalesOrderDetail,
} from "../../../shared/crmSalesOrders";
import {
  businessOrderShipmentText,
  BUSINESS_RECEIVER_MISSING,
} from "../lib/businessSalesOrderPresentation";

export type BusinessSalesOrderRowContext = {
  order: SalesOrderSummary;
  identity: string;
  verified: boolean;
  canWrite: boolean;
};
export type BusinessSalesOrderListContext = {
  children: ReactNode;
  rows: SalesOrderSummary[];
  ready: boolean;
  canWrite: boolean;
  identityKey: string;
  merchantId: number;
  customerId?: number;
};
export type BusinessSalesOrderRowSlots = {
  wrapList?: (context: BusinessSalesOrderListContext) => ReactNode;
  receiverCell?: (context: BusinessSalesOrderRowContext) => ReactNode;
  statusCell?: (context: BusinessSalesOrderRowContext) => ReactNode;
  options?: (context: BusinessSalesOrderRowContext) => ReactNode;
  readExportMetadata?: import("../lib/businessSalesOrderPresentation").BusinessOrderExportMetadataReader;
};

export function BusinessOrderMetadataBoundary({
  slots,
  context,
  children,
}: {
  slots?: BusinessSalesOrderRowSlots;
  context: Omit<BusinessSalesOrderListContext, "children">;
  children: ReactNode;
}) {
  return slots?.wrapList ? slots.wrapList({ ...context, children }) : children;
}

export function BusinessOrderItems({
  detail,
  failed,
  onView,
}: {
  detail?: SalesOrderDetail;
  failed?: string;
  onView: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!detail)
    return (
      <span className="text-xs text-muted-foreground">
        {failed ? "商品读取失败" : "商品读取中…"}
      </span>
    );
  const first = detail.items[0];
  if (!first)
    return <span className="text-xs text-muted-foreground">未录入商品</span>;
  const itemLine = (item: typeof first) => (
    <div key={item.id} className="space-y-0.5">
      <button
        type="button"
        className="block max-w-full truncate text-left font-semibold text-slate-800 hover:underline"
        title={item.partNumber}
        onClick={onView}
      >
        {item.partNumber}
      </button>
      <div
        className="truncate text-[11px] text-muted-foreground"
        title={[item.brand, item.pkg].filter(Boolean).join(" / ")}
      >
        {[item.brand, item.pkg].filter(Boolean).join(" / ") || "—"}
      </div>
      <div className="text-[11px] tabular-nums text-muted-foreground">
        {item.orderedQty}
        {item.qtyUnit || "个"} × {formatSalesOrderAmount(item.unitPrice)}
        （含税）
      </div>
    </div>
  );
  return (
    <div>
      {itemLine(first)}
      {detail.items.length > 1 && (
        <button
          type="button"
          className="mt-0.5 text-[11px] text-[#185FA5] hover:underline"
          aria-expanded={expanded}
          aria-label={expanded ? "收起订单商品明细" : "展开订单全部商品"}
          onClick={() => setExpanded(value => !value)}
        >
          {expanded ? "收起" : `+${detail.items.length - 1}项`}
        </button>
      )}
      {expanded && (
        <div className="mt-1 space-y-1 border-t border-dashed border-slate-200 pt-1">
          {detail.items.slice(1).map(itemLine)}
        </div>
      )}
    </div>
  );
}
export function BusinessOrderLogistics({
  detail,
  failed,
  onView,
}: {
  detail?: SalesOrderDetail;
  failed?: string;
  onView: () => void;
}) {
  if (!detail)
    return (
      <span className="text-xs text-muted-foreground">
        {failed ? "物流读取失败" : "物流读取中…"}
      </span>
    );
  if (!detail.shipments.length)
    return <div className="text-xs text-muted-foreground">未录入物流</div>;
  // Keep every shipment; no fake tracking, pickup address, receiver or mall command.
  return (
    <div className="space-y-1" title={businessOrderShipmentText(detail)}>
      {detail.shipments.map(shipment => (
        <div key={shipment.id}>
          <div className="truncate text-xs font-medium text-slate-700">
            {shipment.deliveryMethod === "pickup"
              ? "上门自提"
              : shipment.expressCo || BUSINESS_RECEIVER_MISSING}
          </div>
          <button
            type="button"
            className="block max-w-full truncate text-left text-[11px] text-[#185FA5] hover:underline"
            onClick={onView}
          >
            {shipment.deliveryMethod === "pickup"
              ? "查看出货记录"
              : shipment.expressNo || "运单号未录入"}
          </button>
        </div>
      ))}
    </div>
  );
}
export function BusinessOrderRowActions({
  orderNumber,
  children,
  extraActions,
}: {
  orderNumber: string;
  children: ReactNode;
  extraActions?: ReactNode;
}) {
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!position) return;
    const close = (event: Event) => {
      if (
        event.target instanceof Node &&
        (panel.current?.contains(event.target) ||
          trigger.current?.contains(event.target))
      )
        return;
      setPosition(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPosition(null);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [position]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="h-7 w-7 rounded text-lg text-slate-600 hover:bg-slate-100"
        aria-label={`操作 ${orderNumber}`}
        aria-haspopup="dialog"
        aria-expanded={Boolean(position)}
        onClick={() => {
          if (position) {
            setPosition(null);
            return;
          }
          const bounds = trigger.current!.getBoundingClientRect();
          setPosition({
            left: Math.max(
              8,
              Math.min(bounds.right - 148, window.innerWidth - 156)
            ),
            top: Math.max(
              8,
              Math.min(bounds.bottom + 4, window.innerHeight - 160)
            ),
          });
        }}
      >
        …
      </button>
      {position &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label={`${orderNumber} 操作`}
            className="fixed z-[80] flex min-w-[148px] flex-col rounded-lg border border-slate-200 bg-white p-1.5 text-left shadow-xl"
            style={position}
            onClick={event => {
              if ((event.target as Element).closest("button"))
                setPosition(null);
            }}
          >
            {children}
            {extraActions}
          </div>,
          document.body
        )}
    </>
  );
}
