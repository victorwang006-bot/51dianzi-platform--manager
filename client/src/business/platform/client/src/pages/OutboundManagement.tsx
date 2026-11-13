import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "../../../../api/business-trpc";
import PlatformLayout from "../../../../BusinessContentFrame";
import { ChevronDown, Download, Search } from "lucide-react";
import { ORDER_STATUS_META } from "../../../shared/cartUtils";
import LogisticsDialog from "../components/LogisticsDialog";
import WaybillOcrUploader from "../components/WaybillOcrUploader";
import { formatBeijingDateCompact, formatBeijingDateTime } from "../../../shared/beijingTime";
import { AdminDataPanel, AdminFilterBar, AdminPage } from "@/components/admin/UnifiedAdminPage";
import "./OutboundManagement.css";
import { sumMallOrderAmounts } from "../lib/mallOrderListAmounts";

/**
 * 线上订单 —— 显示买家通过商城下的订单，支持筛选、发货、详情、订单动态
 * 功能同原"收到的订单"模块
 *
 * 命名沿革：销售出库 → 订单跟踪（2026-08）→ 销售订单 → 线上订单（2026-09-23）。
 * 路由 /outbound、接口名与数据库字段一律未动，仅改中文展示文案。
 */

const PAGE_SIZE = 10;

const fmtQty = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("zh-CN");
const fmtMoney = (n: number) =>
  n.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const num = (s: string | null | undefined) => Number(s ?? 0);
const dateStr = (d: Date | string | null | undefined) =>
  d
    ? formatBeijingDateTime(d)
    : "";
const fmtDate = (d: Date | string | null | undefined) =>
  dateStr(d).slice(0, 10);

/** 导出当前筛选结果或所选订单；过期/卸载后不生成文件。 */
async function exportToExcel(rows: OrderRow[], isCurrent: () => boolean = () => true) {
  if (rows.length === 0) {
    toast.warning("没有可导出的订单");
    return;
  }

  try {
    const XLSX = await import("xlsx");
    if (!isCurrent()) return;
    const sheetData = rows.flatMap(o =>
      (o.items.length ? o.items : [{ partNumber: "", qty: "", unitPrice: "" }]).map(it => ({
        订单号: o.orderNo,
        料号型号: it.partNumber,
        数量: it.qty,
        "单价(含税)": it.unitPrice,
        "金额(含税)": o.totalAmount,
        "含税额(价内税)": o.taxAmount,
        运费: o.shippingFee,
        收货人: o.receiver,
        联系电话: o.receiverPhone,
        配送方式: o.deliveryMethod === "pickup" ? "自提" : "快递",
        配送地址: o.deliveryMethod === "pickup" ? o.pickupAddress || o.receiverAddress : o.receiverAddress,
        快递公司: o.expressCo ?? "",
        快递单号: o.expressNo ?? "",
        状态: ORDER_STATUS_META[o.status]?.label ?? o.status,
        下单时间: fmtDate(o.createdAt),
        备注: o.note ?? "",
      }))
    );
    const ws = XLSX.utils.json_to_sheet(sheetData);
    // 文本单元格显式为字符串，避免公式注入；金额字符串保留原精度。
    for (const [key, cell] of Object.entries(ws)) {
      if (!key.startsWith("!") && cell && typeof cell === "object" && "v" in cell && typeof cell.v === "string") {
        cell.t = "s";
        delete cell.f;
      }
    }
    ws["!cols"] = [
      { wch: 20 },
      { wch: 18 },
      { wch: 8 },
      { wch: 10 },
      { wch: 12 },
      { wch: 10 },
      { wch: 8 },
      { wch: 10 },
      { wch: 14 },
      { wch: 36 },
      { wch: 12 },
      { wch: 18 },
      { wch: 8 },
      { wch: 12 },
      { wch: 20 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "商城订单");
    // 导出文件名与菜单名保持一致，否则商家下载后对不上模块
    const fileName = `商城订单_${formatBeijingDateCompact(new Date())}.xlsx`;
    if (!isCurrent()) return;
    XLSX.writeFile(wb, fileName);
    toast.success(`已导出 ${rows.length} 笔订单`, { description: fileName });
  } catch (error) {
    console.error("[sales-export] Excel 导出失败", error);
    toast.error("导出失败，请稍后重试");
  }
}

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-[#FFF7E6] text-[#B8741A]",
  paid: "bg-[#e8f0fe] text-[#185FA5]",
  shipped: "bg-[#E6F4FB] text-[#1170A6]",
  done: "bg-[#EAF3DE] text-[#3B6D11]",
  refund: "bg-[#FCEBEB] text-[#A32D2D]",
  /** 已退款终态：与处理中的 refund 分色，卖家才能分清哪些单已实际出款 */
  refunded: "bg-[#EEF1F6] text-[#5A6B85]",
  cancel: "bg-[#f5f5f5] text-[#999]",
};

const emptyFilters = () => ({
  kw: "",
  receiver: "",
  expressNo: "",
  status: "all",
  dateFrom: "",
  dateTo: "",
});
const SALES_ORDER_STATUS_TABS = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待付款" },
  { value: "paid", label: "待发货" },
  { value: "shipped", label: "已发货" },
  { value: "done", label: "已完成" },
  { value: "after_sales", label: "售后" },
  { value: "cancel", label: "已取消" },
] as const;

/**
 * 卖家退款处理动作。不含“确认线下汇出”：后者不是审批选项，
 * 而是退款单已处于 pending_offline 时的唯一待办，由弹窗自行切换形态。
 */
type RefundActionKind = "approve" | "reject" | "agreeReturn";

type OrderRow = {
  id: number;
  orderNo: string;
  /** 买家公司；个人买家没有企业资料时为空 */
  buyerCompanyName: string | null;
  buyerDisplayName: string;
  status: string;
  statusNote: string | null;
  totalAmount: string;
  taxAmount: string;
  shippingFee: string;
  receiver: string;
  receiverPhone: string;
  receiverAddress: string;
  note: string | null;
  expressCo: string | null;
  expressNo: string | null;
  /** 付款方式：只有对公转账订单允许卖家手工确认收款 */
  payMethod: "corp" | "alipay" | "wechat";
  transferDeclaredAt: Date | null;
  corpPayeeMode: "platform_legacy" | "seller_direct";
  payeeAccountName: string | null;
  payeeAccountNumber: string | null;
  payeeBankName: string | null;
  /** 下单配送方式及自提快照。 */
  deliveryMethod: "express" | "pickup";
  deliveryPlanMode: "legacy_global" | "seller_split";
  pickupPointName: string | null;
  pickupAddress: string | null;
  pickupContact: string | null;
  pickupPhone: string | null;
  pickupBusinessHours: string | null;
  pickupReadyAt: Date | null;
  pickedUpAt: Date | null;
  /** 物流概要（来自缓存，列表不实时查询） */
  logistics: { state: string; stateLabel: string; queriedAt: Date } | null;
  createdAt: Date;
  items: Array<{
    id: number;
    partNumber: string;
    unitPrice: string;
    qty: number;
  }>;
};

export type OutboundManagementProps = {
  /** 前台仅查看订单；后台原生复用时默认保留完整订单处理能力。 */
  readOnly?: boolean;
};

/** 变更处理器的最后一道前端防线；服务端领域授权仍保持原有校验。 */
export function canMutateOutboundOrder(readOnly: boolean) {
  return !readOnly;
}

export default function OutboundManagement({ readOnly = false }: OutboundManagementProps) {
  const utils = trpc.useUtils();

  // 勾选状态
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [expandedItemOrderIds, setExpandedItemOrderIds] = useState<Set<number>>(new Set());
  const [openMenu, setOpenMenu] = useState<{ order: OrderRow; x: number; y: number; placement: "bottom" | "top"; trigger: HTMLButtonElement } | null>(null);
  const actionPopoverRef = useRef<HTMLDivElement>(null);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback((rows: OrderRow[]) => {
    setSelectedIds(prev => {
      const allIds = rows.map(r => r.id);
      const allSelected = allIds.every(id => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        allIds.forEach(id => next.delete(id));
        return next;
      } else {
        const next = new Set(prev);
        allIds.forEach(id => next.add(id));
        return next;
      }
    });
  }, []);

  const toggleMoreMenu = useCallback((order: OrderRow, anchor: HTMLButtonElement) => {
    setOpenMenu(prev => {
      if (prev?.order.id === order.id) return null;
      const rect = anchor.getBoundingClientRect();
      const menuWidth = 148;
      const estimatedHeight = 220;
      const x = Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8));
      const belowY = rect.bottom + 6;
      const placement = belowY + estimatedHeight > window.innerHeight - 40 && rect.top > estimatedHeight ? "top" : "bottom";
      return { order, x, y: placement === "bottom" ? belowY : rect.top - 6, placement, trigger: anchor };
    });
  }, []);

  const closeMoreMenu = useCallback(() => setOpenMenu(null), []);

  const toggleExpandItems = useCallback((id: number) => {
    setExpandedItemOrderIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const { data: orders, isLoading } = trpc.order.sellerOrders.useQuery();
  const { data: expressCos } = trpc.order.expressCos.useQuery();

  const [filterInput, setFilterInput] = useState(emptyFilters());
  const [filters, setFilters] = useState(emptyFilters());
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const exportEpoch = useRef(0);
  useEffect(() => {
    const epoch = ++exportEpoch.current;
    setExporting(false);
    return () => { if (exportEpoch.current === epoch) ++exportEpoch.current; };
  }, [orders, filters]);


  const [detailRow, setDetailRow] = useState<OrderRow | null>(null);
  const [shipOrder, setShipOrder] = useState<OrderRow | null>(null);
  const [expressCo, setExpressCo] = useState("");
  const [expressNo, setExpressNo] = useState("");
  const [trackOrderId, setTrackOrderId] = useState<number | null>(null);
  /** 正在查看物流轨迹的订单 */
  const [logisticsOrder, setLogisticsOrder] = useState<OrderRow | null>(null);
  /** 正在确认到账的订单 */
  const [confirmPayOrder, setConfirmPayOrder] = useState<OrderRow | null>(null);
  const [payVoucher, setPayVoucher] = useState("");
  /** 正在处理退款的订单与动作类型 */
  const [refundAction, setRefundAction] = useState<{
    order: OrderRow;
    kind: RefundActionKind;
  } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  /** 对公转账退款的银行汇款凭据 */
  const [refundVoucherNo, setRefundVoucherNo] = useState("");

  const { data: tracks } = trpc.order.tracks.useQuery(
    { orderId: trackOrderId ?? 0 },
    { enabled: trackOrderId !== null }
  );

  const confirmPayMut = trpc.order.sellerConfirmPay.useMutation({
    onSuccess: () => {
      toast.success("已确认到账", { description: "订单已流转为待发货状态" });
      setConfirmPayOrder(null);
      setPayVoucher("");
      utils.order.sellerOrders.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const cancelOrderMut = trpc.order.sellerCancel.useMutation({
    onSuccess: () => {
      toast.success("已取消订单", { description: "库存已释放，买家已收到通知" });
      utils.order.sellerOrders.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const requestCancelOrder = (order: OrderRow) => {
    if (!canMutateOutboundOrder(readOnly)) return;
    const extra =
      order.payMethod === "corp" && order.transferDeclaredAt
        ? "买家已声明转账，取消后如已到账需自行退款。\n"
        : order.payMethod === "alipay" || order.payMethod === "wechat"
          ? "将关闭待付款支付，同批次未付款订单也会取消。\n"
          : "";
    if (!confirm(`${extra}确定取消订单 ${order.orderNo} 吗？`)) return;
    cancelOrderMut.mutate({ orderId: order.id });
  };

  const openConfirmPay = (order: OrderRow) => {
    if (!canMutateOutboundOrder(readOnly)) return;
    setConfirmPayOrder(order);
    setPayVoucher("");
  };

  const shipMut = trpc.order.ship.useMutation({
    onSuccess: () => {
      toast.success(shipOrder?.deliveryMethod === "pickup" ? "已通知买家" : "发货成功", {
        description: shipOrder?.deliveryMethod === "pickup" ? "等待买家自提" : "订单已流转为已发货状态",
      });
      setShipOrder(null);
      setExpressCo("");
      setExpressNo("");
      utils.order.sellerOrders.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const closeRefundDialog = () => {
    setRefundAction(null);
    setRejectReason("");
    setRefundVoucherNo("");
  };

  const openRefundAction = (order: OrderRow, kind: RefundActionKind) => {
    if (!canMutateOutboundOrder(readOnly)) return;
    setRefundAction({ order, kind });
  };

  const approveRefundMut = trpc.order.approveRefund.useMutation({
    onSuccess: res => {
      // 对公转账走线下打款，必须在提示里区分，
      // 否则卖家以为钱已自动退出去、不再知会财务
      toast.success("已通过售后", { description: res.message });
      closeRefundDialog();
      utils.order.sellerOrders.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const rejectRefundMut = trpc.order.rejectRefund.useMutation({
    onSuccess: () => {
      toast.success("已驳回退款申请", { description: "订单已还原，买家已收到通知" });
      closeRefundDialog();
      utils.order.sellerOrders.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const agreeReturnMut = trpc.order.agreeReturn.useMutation({
    onSuccess: () => {
      toast.success("已同意退货", { description: "已通知买家寄回商品并填写运单" });
      closeRefundDialog();
      utils.order.sellerOrders.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  /**
   * 确认对公转账退款已线下汇出。没有这个入口时，财务汇出后无处登记，
   * 退款单会永远停在“待财务线下打款”，订单也无法终结。
   */
  const confirmOfflineRefundMut = trpc.order.confirmOfflineRefund.useMutation({
    onSuccess: () => {
      toast.success("退款已完成", {
        description: "已登记银行凭据，订单已终结，买家已收到通知",
      });
      closeRefundDialog();
      utils.order.sellerOrders.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const list = useMemo(() => {
    let l = (orders ?? []) as OrderRow[];
    if (filters.status === "after_sales") l = l.filter(o => o.status === "refund" || o.status === "refunded");
    else if (filters.status !== "all") l = l.filter(o => o.status === filters.status);
    if (filters.kw.trim()) {
      const k = filters.kw.trim().toLowerCase();
      l = l.filter(o =>
        [o.orderNo, ...o.items.map(i => i.partNumber)]
          .join(" ")
          .toLowerCase()
          .includes(k)
      );
    }
    if (filters.receiver.trim()) {
      const k = filters.receiver.trim().toLowerCase();
      l = l.filter(o =>
        (o.receiver + " " + o.receiverPhone).toLowerCase().includes(k)
      );
    }
    if (filters.expressNo.trim()) {
      const k = filters.expressNo.trim().toLowerCase();
      l = l.filter(o => (o.expressNo ?? "").toLowerCase().includes(k));
    }
    if (filters.dateFrom)
      l = l.filter(o => fmtDate(o.createdAt) >= filters.dateFrom);
    if (filters.dateTo)
      l = l.filter(o => fmtDate(o.createdAt) <= filters.dateTo);
    return l;
  }, [orders, filters]);

  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = list.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    if (openMenu === null) return;
    requestAnimationFrame(() => {
      actionPopoverRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const trigger = openMenu.trigger;
      setOpenMenu(null);
      requestAnimationFrame(() => trigger.focus());
    };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeMoreMenu);
    window.addEventListener("scroll", closeMoreMenu, true);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeMoreMenu);
      window.removeEventListener("scroll", closeMoreMenu, true);
    };
  }, [openMenu, closeMoreMenu]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: (orders ?? []).length };
    for (const s of Object.keys(ORDER_STATUS_META))
      c[s] = (orders ?? []).filter(o => o.status === s).length;
    c.after_sales = (c.refund ?? 0) + (c.refunded ?? 0);
    return c;
  }, [orders]);

  const applyFilters = () => {
    setFilters({ ...filterInput });
    setPage(1);
    setSelectedIds(new Set());
  };
  const resetFilters = () => {
    setFilterInput(emptyFilters());
    setFilters(emptyFilters());
    setShowMoreFilters(false);
    setPage(1);
    setSelectedIds(new Set());
  };
  const selectStatus = (status: string) => {
    setFilterInput(current => ({ ...current, status }));
    setFilters(current => ({ ...current, status }));
    setPage(1);
    setSelectedIds(new Set());
  };
  const hasAdvancedFilterInput = Boolean(
    filterInput.receiver || filterInput.expressNo || filterInput.dateFrom || filterInput.dateTo,
  );
  const hasAnyFilterInput = Object.entries(filterInput).some(
    ([key, value]) => key === "status" ? value !== "all" : Boolean(value),
  );

  const openShip = (o: OrderRow) => {
    if (!canMutateOutboundOrder(readOnly)) return;
    setShipOrder(o);
    setExpressCo(expressCos?.[0] ?? "顺丰速运");
    setExpressNo("");
  };

  const submitShip = () => {
    if (!canMutateOutboundOrder(readOnly)) return;
    if (shipOrder?.deliveryMethod === "pickup") {
      shipMut.mutate({
        orderId: shipOrder!.id,
        deliveryMethod: "pickup",
      });
      return;
    }
    if (!expressCo) return toast.error("请选择快递公司");
    if (expressNo.trim().length < 6)
      return toast.error("请填写正确的快递单号（至少 6 位）");
    shipMut.mutate({
      orderId: shipOrder!.id,
      deliveryMethod: "express",
      expressCo,
      expressNo: expressNo.trim(),
    });
  };

  return (
    <PlatformLayout>
      <AdminPage className="erp-ui sales-order-page" aria-label="商城订单" data-testid="sales-order-inventory-style">
        <h1 className="sr-only">商城订单</h1>
        {readOnly && <p role="status" className="sales-order-readonly-note">当前为只读模式，不能收款、发货、取消或处理退款。</p>}
        <AdminFilterBar
          className="sales-order-toolbar sales-order-filter-card"
          onKeyDown={event => { if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") applyFilters(); }}>
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="搜索商城订单"
              className="crm-input w-[320px] max-w-full"
              placeholder="搜索订单号或型号"
              value={filterInput.kw}
              onChange={event => setFilterInput(current => ({ ...current, kw: event.target.value }))}
            />
            <select aria-label="商城订单状态" className="crm-input w-[128px]" value={filters.status} onChange={event => selectStatus(event.target.value)}>
              {SALES_ORDER_STATUS_TABS.map(item => <option key={item.value} value={item.value}>{item.value === "all" ? "全部状态" : item.label}（{counts[item.value] ?? 0}）</option>)}
            </select>
            <button
              type="button"
              className="sales-order-compact-button min-w-[100px] justify-between"
              aria-expanded={showMoreFilters}
              onClick={() => setShowMoreFilters(value => !value)}>
              更多筛选{hasAdvancedFilterInput ? " · 已选" : ""}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showMoreFilters ? "rotate-180" : ""}`} />
            </button>
            <button type="button" className="sales-order-compact-button" onClick={applyFilters}><Search className="h-3.5 w-3.5" />筛选</button>
            <button type="button" className="sales-order-compact-button" disabled={!hasAnyFilterInput} onClick={resetFilters}>重置</button>
          </div>
          {showMoreFilters && <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2" data-testid="sales-order-advanced-filters">
            <input
              className="crm-input w-[150px]"
              placeholder="收货人或电话"
              value={filterInput.receiver}
              onChange={event => setFilterInput(current => ({ ...current, receiver: event.target.value }))}
            />
            <input
              className="crm-input w-[150px]"
              placeholder="快递单号"
              value={filterInput.expressNo}
              onChange={event => setFilterInput(current => ({ ...current, expressNo: event.target.value }))}
            />
            <div className="inline-flex items-center gap-1.5">
              <input type="date" aria-label="订单开始日期" className="crm-input w-[138px]" value={filterInput.dateFrom} onChange={event => setFilterInput(current => ({ ...current, dateFrom: event.target.value }))} />
              <span className="text-[11px] text-muted-foreground">至</span>
              <input type="date" aria-label="订单结束日期" className="crm-input w-[138px]" value={filterInput.dateTo} onChange={event => setFilterInput(current => ({ ...current, dateTo: event.target.value }))} />
            </div>
          </div>}
        </AdminFilterBar>

        <AdminDataPanel id="sales-order-panel" aria-label="商城订单列表" className="sales-order-table-card overflow-hidden">
          <div className="sales-order-list-toolbar">
            <button type="button" className="sales-order-compact-button ml-auto" disabled={exporting || isLoading || list.length === 0}
              onClick={async () => {
                const epoch = exportEpoch.current;
                setExporting(true);
                await exportToExcel(selectedIds.size > 0 ? list.filter(order => selectedIds.has(order.id)) : list, () => exportEpoch.current === epoch);
                if (exportEpoch.current === epoch) setExporting(false);
              }}>
              <Download className="h-3.5 w-3.5" />
              {exporting ? "导出中…" : selectedIds.size > 0 ? `导出选中（${list.filter(order => selectedIds.has(order.id)).length}）` : "导出筛选结果"}
            </button>
          </div>
          <div className="sales-order-table-viewport overflow-x-auto">
            <table className="crm-table sales-order-table min-w-[1040px] table-fixed">
              <colgroup>
                <col className="w-[36px]" /><col className="w-[150px]" /><col className="w-[19%]" /><col className="w-[20%]" />
                <col className="w-[156px]" /><col /><col className="w-[98px]" /><col className="w-[64px]" />
              </colgroup>
              <thead><tr>
                <th className="text-center"><input type="checkbox" aria-label="选择本页全部订单" checked={pageRows.length > 0 && pageRows.every(row => selectedIds.has(row.id))} onChange={() => toggleSelectAll(pageRows)} /></th>
                <th>订单 / 日期</th><th>客户 / 收货人</th><th>商品明细</th><th className="sales-order-numeric">含税金额</th><th>配送 / 物流</th><th>状态</th><th className="text-right">操作</th>
              </tr></thead>
              <tbody>
                {isLoading ? <tr><td colSpan={8} className="py-12 text-center text-muted-foreground">加载中…</td></tr> : pageRows.length === 0 ? <tr><td colSpan={8} className="py-14 text-center text-muted-foreground">暂无匹配订单</td></tr> : pageRows.map(order => {
                  const itemsExpanded = expandedItemOrderIds.has(order.id);
                  const statusLabel = order.deliveryMethod === "pickup" && order.status === "shipped"
                    ? "待自提"
                    : ORDER_STATUS_META[order.status]?.label ?? order.status;
                  return <tr
                    key={order.id}
                    tabIndex={0}
                    aria-label={`查看线上订单 ${order.orderNo}`}
                    className="cursor-pointer outline-none focus-visible:bg-[#f5f9fd]"
                    onClick={event => { if (!(event.target as HTMLElement).closest("button, input, a")) setDetailRow(order); }}
                    onKeyDown={event => { if ((event.target as HTMLElement).closest("button, input, a")) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setDetailRow(order); } }}>
                    <td className="text-center"><input type="checkbox" aria-label={`选择订单 ${order.orderNo}`} checked={selectedIds.has(order.id)} onChange={() => toggleSelect(order.id)} /></td>
                    <td><button type="button" className="crm-link truncate font-medium" onClick={() => setDetailRow(order)}>{order.orderNo}</button><div className="mt-0.5 text-[11px] text-muted-foreground">{fmtDate(order.createdAt)}</div></td>
                    <td><div className="truncate font-medium text-slate-800" title={order.buyerCompanyName ?? order.buyerDisplayName}>{order.buyerCompanyName ?? "个人买家"}</div><div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={`${order.receiver} ${order.receiverPhone}`}>{order.receiver} · {order.receiverPhone}</div></td>
                    <td>{order.items.length > 0 ? <div>
                      <div className="flex items-center gap-1"><span className="min-w-0 truncate font-semibold text-slate-800" title={order.items[0].partNumber}>{order.items[0].partNumber}</span>{order.items.length > 1 && <button type="button" className="shrink-0 text-[11px] text-[#185FA5] hover:underline" aria-expanded={itemsExpanded} aria-label={itemsExpanded ? "收起订单商品明细" : "展开订单全部商品"} onClick={() => toggleExpandItems(order.id)}>{itemsExpanded ? "收起" : `+${order.items.length - 1}项`}</button>}</div>
                      <div className="sales-order-numeric mt-0.5 text-[11px] text-muted-foreground">{fmtQty(order.items[0].qty)} 件 · ¥{fmtMoney(num(order.items[0].unitPrice))}/件</div>
                      {itemsExpanded && <div className="mt-1 space-y-1 border-t border-dashed border-slate-200 pt-1 text-[11px] text-slate-600">{order.items.slice(1).map(item => <div key={item.id} className="flex justify-between gap-2"><span className="truncate font-medium">{item.partNumber}</span><span className="shrink-0">{fmtQty(item.qty)} × ¥{fmtMoney(num(item.unitPrice))}</span></div>)}</div>}
                    </div> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="sales-order-numeric"><div className="font-medium tabular-nums text-slate-800">¥{fmtMoney(num(order.totalAmount))}</div><div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={`含税额 ¥${fmtMoney(num(order.taxAmount))} · ${num(order.shippingFee) === 0 ? "包邮" : `运费 ¥${fmtMoney(num(order.shippingFee))}`}`}>含税额 ¥{fmtMoney(num(order.taxAmount))} · {num(order.shippingFee) === 0 ? "包邮" : `运费 ¥${fmtMoney(num(order.shippingFee))}`}</div></td>
                    <td>{order.deliveryMethod === "pickup" || order.expressCo === "自提" ? <><div className="font-medium text-[#185FA5]">上门自提</div><div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={order.pickupAddress || order.receiverAddress}>{order.pickupAddress || order.receiverAddress}</div></> : order.expressNo ? <><div className="truncate font-medium text-slate-700">{order.expressCo || "快递"}</div><button type="button" className="crm-link mt-0.5 block truncate text-[11px]" onClick={() => setLogisticsOrder(order)}>{order.expressNo}</button></> : <><div className="text-slate-700">等待发货</div><div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={order.receiverAddress}>{order.receiverAddress}</div></>}</td>
                    <td><span className="sales-order-status whitespace-nowrap"><span className={`sales-order-status-dot ${STATUS_BADGE[order.status] ?? "text-[#999]"}`} aria-hidden="true">●</span><span className="font-medium text-slate-700">{statusLabel}</span></span>{order.statusNote && <div className="mt-1 truncate text-[11px] text-muted-foreground" title={order.statusNote}>{order.statusNote}</div>}</td>
                    <td className="text-right"><button type="button" className="inbound-row-menu admin-row-action" aria-label={`操作 ${order.orderNo}`} aria-haspopup="dialog" aria-controls={`sales-order-actions-${order.id}`} aria-expanded={openMenu?.order.id === order.id} onClick={event => { event.stopPropagation(); toggleMoreMenu(order, event.currentTarget); }}>更多</button></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          <div className="sales-order-pagination">
            <span>共 {list.length} 条，每页 {PAGE_SIZE} 条 · 含税合计 {sumMallOrderAmounts(list.map(order => order.totalAmount))}</span>
            <div className="flex items-center gap-2">
              <button type="button" className="sales-order-compact-button" disabled={safePage <= 1 || isLoading} onClick={() => setPage(safePage - 1)}>上一页</button>
              <span className="min-w-[64px] text-center">第 {safePage} / {totalPages} 页</span>
              <button type="button" className="sales-order-compact-button" disabled={safePage >= totalPages || isLoading} onClick={() => setPage(safePage + 1)}>下一页</button>
            </div>
          </div>
        </AdminDataPanel>

        {openMenu && <><button type="button" aria-label="关闭订单操作" className="fixed inset-0 z-[70] cursor-default bg-transparent" onClick={closeMoreMenu} /><div ref={actionPopoverRef} id={`sales-order-actions-${openMenu.order.id}`} role="dialog" aria-label={`${openMenu.order.orderNo} 操作`} className="fixed z-[80] min-w-[148px] rounded-lg border border-[#e3e3e3] bg-white p-1.5 text-left shadow-xl" style={{ left: openMenu.x, top: openMenu.y, transform: openMenu.placement === "top" ? "translateY(-100%)" : undefined }} onClick={event => event.stopPropagation()}>
          <button type="button" className="erp-menu-item" onClick={() => { setDetailRow(openMenu.order); closeMoreMenu(); }}>查看详情</button>
          <a className="erp-menu-item block" href={`/api/orders/${openMenu.order.id}/contract`} target="_blank" rel="noreferrer" onClick={closeMoreMenu}>下载合同</a>
          {!readOnly && openMenu.order.status === "pending" && openMenu.order.payMethod === "corp" && <button type="button" className="erp-menu-item" onClick={() => { openConfirmPay(openMenu.order); closeMoreMenu(); }}>确认到账</button>}
          <button type="button" className="erp-menu-item" onClick={() => { setTrackOrderId(openMenu.order.id); closeMoreMenu(); }}>订单动态</button>
          {!readOnly && openMenu.order.status === "pending" && <button type="button" className="erp-menu-item erp-menu-item-danger" disabled={cancelOrderMut.isPending} onClick={() => { const order = openMenu.order; closeMoreMenu(); requestCancelOrder(order); }}>取消订单</button>}
          {openMenu.order.expressNo && <button type="button" className="erp-menu-item" onClick={() => { setLogisticsOrder(openMenu.order); closeMoreMenu(); }}>物流轨迹</button>}
          {!readOnly && openMenu.order.status === "paid" && <button type="button" className="erp-menu-item text-[#185FA5] hover:bg-[#f0f6fd]" onClick={() => { openShip(openMenu.order); closeMoreMenu(); }}>{openMenu.order.deliveryMethod === "pickup" ? "备货完成" : "填写快递"}</button>}
          {!readOnly && openMenu.order.status === "refund" && <><button type="button" className="erp-menu-item erp-menu-item-danger" onClick={() => { openRefundAction(openMenu.order, "approve"); closeMoreMenu(); }}>通过售后（立即退款）</button>{openMenu.order.expressNo && <button type="button" className="erp-menu-item erp-menu-item-danger" onClick={() => { openRefundAction(openMenu.order, "agreeReturn"); closeMoreMenu(); }}>同意退货</button>}<button type="button" className="erp-menu-item erp-menu-item-danger" onClick={() => { openRefundAction(openMenu.order, "reject"); closeMoreMenu(); }}>驳回退款</button></>}
        </div></>}

      {/* 订单详情弹窗 */}
      {detailRow && (
        <div
          className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4"
          onClick={() => setDetailRow(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="outbound-detail-title"
            className="outbound-dialog bg-white rounded-lg w-[640px] max-w-full max-h-[90vh] overflow-y-auto p-6"
            onClick={e => e.stopPropagation()}
          >
            <h3 id="outbound-detail-title" className="text-[18px] font-semibold text-[#222] mb-4">订单详情</h3>
            <table className="crm-detail-table">
              <tbody>
                <tr>
                  <td className="label-cell">订单号</td>
                  <td className="text-[#185FA5] font-medium">
                    {detailRow.orderNo}
                  </td>
                  <td className="label-cell">下单时间</td>
                  <td>{dateStr(detailRow.createdAt)}</td>
                </tr>
                <tr>
                  <td className="label-cell">订单公司</td>
                  <td>{detailRow.buyerCompanyName ?? "个人买家"}</td>
                  <td className="label-cell">买家账号</td>
                  <td>{detailRow.buyerDisplayName || "-"}</td>
                </tr>
                <tr>
                  <td className="label-cell">订单状态</td>
                  <td>
                    <span
                      className={`crm-badge ${STATUS_BADGE[detailRow.status] ?? "bg-[#f5f5f5] text-[#999]"}`}
                    >
                      {detailRow.deliveryMethod === "pickup" && detailRow.status === "shipped"
                        ? "待自提"
                        : ORDER_STATUS_META[detailRow.status]?.label ?? detailRow.status}
                    </span>
                  </td>
                  <td className="label-cell">状态备注</td>
                  <td>{detailRow.statusNote || "-"}</td>
                </tr>
                <tr>
                  <td className="label-cell">商品明细</td>
                  <td colSpan={3}>
                    {detailRow.items.map(it => (
                      <div key={it.id} className="outbound-detail-item">
                        <span>{it.partNumber}</span>{" "}
                        <span className="sales-order-numeric text-[12px] text-[#888]">
                          ￥{fmtMoney(num(it.unitPrice))} × {fmtQty(it.qty)} =
                          ￥{fmtMoney(num(it.unitPrice) * it.qty)}
                        </span>
                      </div>
                    ))}
                  </td>
                </tr>
                <tr>
                  <td className="label-cell">订单金额</td>
                  <td className="sales-order-numeric text-[#A32D2D] font-bold">
                    ￥{fmtMoney(num(detailRow.totalAmount))}
                  </td>
                  <td className="label-cell">含税额 / 运费</td>
                  <td className="sales-order-numeric">
                    ￥{fmtMoney(num(detailRow.taxAmount))} /{" "}
                    {num(detailRow.shippingFee) === 0
                      ? "包邮"
                      : `￥${fmtMoney(num(detailRow.shippingFee))}`}
                  </td>
                </tr>
                <tr>
                  <td className="label-cell">收货人</td>
                  <td>{detailRow.receiver}</td>
                  <td className="label-cell">联系电话</td>
                  <td>{detailRow.receiverPhone}</td>
                </tr>
                <tr>
                  <td className="label-cell">{detailRow.deliveryMethod === "pickup" ? "自提地址" : "收货地址"}</td>
                  <td colSpan={3}>{detailRow.deliveryMethod === "pickup" ? detailRow.pickupAddress || detailRow.receiverAddress : detailRow.receiverAddress}</td>
                </tr>
                <tr>
                  <td className="label-cell">物流信息</td>
                  <td colSpan={3}>
                    {detailRow.expressNo
                      ? `${detailRow.expressCo || ""} ${detailRow.expressNo}`
                      : "暂未发货"}
                  </td>
                </tr>
                <tr>
                  <td className="label-cell">买家备注</td>
                  <td colSpan={3}>{detailRow.note || "-"}</td>
                </tr>
              </tbody>
            </table>
            <div className="flex justify-end gap-2.5 mt-5">
              <button className="crm-btn" onClick={() => setDetailRow(null)}>
                关闭
              </button>
              <button
                className="crm-btn crm-btn-up"
                onClick={() => setTrackOrderId(detailRow.id)}
              >
                订单动态
              </button>
              {detailRow.expressNo && (
                <button
                  className="crm-btn crm-btn-up"
                  onClick={() => {
                    const r = detailRow;
                    setDetailRow(null);
                    setLogisticsOrder(r);
                  }}
                >
                  物流轨迹
                </button>
              )}
              {!readOnly && detailRow.status === "pending" && detailRow.payMethod === "corp" && (
                <button
                  className="crm-btn crm-btn-primary"
                  onClick={() => {
                    const r = detailRow;
                    setDetailRow(null);
                    openConfirmPay(r);
                  }}
                >
                  确认到账
                </button>
              )}
              {!readOnly && detailRow.status === "pending" && (
                <button
                  className="crm-btn"
                  disabled={cancelOrderMut.isPending}
                  onClick={() => {
                    const r = detailRow;
                    setDetailRow(null);
                    requestCancelOrder(r);
                  }}
                >
                  取消订单
                </button>
              )}
              {!readOnly && detailRow.status === "paid" && (
                <button
                  className="crm-btn crm-btn-primary"
                  onClick={() => {
                    const r = detailRow;
                    setDetailRow(null);
                    openShip(r);
                  }}
                >
                  {detailRow.deliveryMethod === "pickup" ? "备货完成" : "发货"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 发货弹窗 */}
      {!readOnly && shipOrder && (
        <div
          className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4"
          onClick={() => setShipOrder(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="outbound-ship-title"
            className="outbound-dialog bg-white rounded-lg w-[480px] max-w-full max-h-[90vh] overflow-y-auto p-6"
            onClick={e => e.stopPropagation()}
          >
            <h3 id="outbound-ship-title" className="text-[18px] font-semibold text-[#222]">
              {shipOrder.deliveryMethod === "pickup" ? "备货完成" : "订单发货"}
            </h3>
            <p className="text-[12px] text-[#888] mt-1 mb-5">
              {shipOrder.orderNo} · {shipOrder.deliveryMethod === "pickup" ? "自提人" : "收货人"} {shipOrder.receiver}{" "}
              {shipOrder.receiverPhone}
            </p>
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg bg-[#f5f7fa] px-4 py-3 text-[12px]">
                <span className="text-[#667085]">配送方式</span>
                <b className="text-[#344054]">{shipOrder.deliveryMethod === "pickup" ? "自提" : "快递"}</b>
              </div>

              {shipOrder.deliveryMethod === "express" ? (
                <>
                  {/* 面单 OCR：识别后由用户确认再回填，不静默覆盖已填内容 */}
                  <WaybillOcrUploader
                    orderId={shipOrder.id}
                    onApply={({ waybill, expressName }) => {
                      setExpressNo(waybill);
                      // 推断出的公司名必须在下拉选项内才回填，否则 select 会显示空值
                      if (expressName && (expressCos ?? []).includes(expressName)) {
                        setExpressCo(expressName);
                      }
                      toast.success("已填入识别结果", {
                        description: "请核对后点击确认发货",
                      });
                    }}
                  />
                  <div>
                    <label className="block text-[12px] text-[#666] mb-1.5">
                      快递公司 <span className="text-[#A32D2D]">*</span>
                    </label>
                    <select
                      className="crm-input w-full"
                      value={expressCo}
                      onChange={e => setExpressCo(e.target.value)}
                    >
                      {(expressCos ?? []).map(c => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[12px] text-[#666] mb-1.5">
                      快递单号 <span className="text-[#A32D2D]">*</span>
                    </label>
                    <input
                      className="crm-input w-full"
                      placeholder="填写快递运单号"
                      value={expressNo}
                      onChange={e => setExpressNo(e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-[#cfe0f0] bg-[#f5f9fd] p-4 text-[12px] leading-6 text-[#475467]">
                  <div className="font-medium text-[#344054]">{shipOrder.pickupPointName || "自提点"}</div>
                  <div>{shipOrder.pickupAddress || shipOrder.receiverAddress}</div>
                  <div>{shipOrder.pickupContact || "联系人"}　{shipOrder.pickupPhone || ""}</div>
                  {shipOrder.pickupBusinessHours && <div>{shipOrder.pickupBusinessHours}</div>}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2.5 mt-6">
              <button className="crm-btn" onClick={() => setShipOrder(null)}>
                取消
              </button>
              <button
                className="crm-btn crm-btn-primary"
                disabled={shipMut.isPending}
                onClick={submitShip}
              >
                {shipMut.isPending ? "提交中…" : shipOrder.deliveryMethod === "pickup" ? "通知买家" : "确认发货"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 订单动态弹窗 */}
      {trackOrderId !== null && (
        <div
          className="fixed inset-0 z-[60] bg-black/45 flex items-center justify-center p-4"
          onClick={() => setTrackOrderId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="outbound-tracks-title"
            className="outbound-dialog bg-white rounded-lg w-[480px] max-w-full max-h-[85vh] overflow-y-auto p-6"
            onClick={e => e.stopPropagation()}
          >
            <h3 id="outbound-tracks-title" className="text-[18px] font-semibold text-[#222] mb-2">
              订单动态 / 物流信息
            </h3>
            <div className="mb-4 rounded-md border border-[#dbe8f3] bg-[#f5f9fd] px-3 py-2 text-[11px] leading-5 text-[#54718a]">
              此处为平台内部状态流转记录；承运商实时运输轨迹请查看「物流轨迹」。
            </div>
            <div className="max-h-80 overflow-y-auto space-y-3 pl-4 border-l border-[#eee] ml-1">
              {(tracks ?? []).map((t, i) => (
                <div key={t.id} className="relative">
                  <span
                    className={`absolute -left-[21.5px] top-1.5 h-2 w-2 rounded-full ${i === 0 ? "bg-[#3B6D11] ring-2 ring-[#EAF3DE]" : "bg-[#ddd]"}`}
                  />
                  <div
                    className={`text-[11px] ${i === 0 ? "text-[#3B6D11] font-semibold" : "text-[#888]"}`}
                  >
                    {dateStr(t.createdAt)}
                  </div>
                  <div
                    className={`text-[12px] mt-0.5 ${i === 0 ? "text-[#333]" : "text-[#888]"}`}
                  >
                    {t.content}
                  </div>
                </div>
              ))}
              {(tracks ?? []).length === 0 && (
                <div className="text-[12px] text-[#888] py-4">暂无动态</div>
              )}
            </div>
            <div className="flex justify-end mt-5">
              <button className="crm-btn" onClick={() => setTrackOrderId(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 物流轨迹弹窗（快递100 实时查询） */}
      {logisticsOrder && (
        <LogisticsDialog
          orderId={logisticsOrder.id}
          orderNo={logisticsOrder.orderNo}
          onClose={() => setLogisticsOrder(null)}
        />
      )}

      {/* 退款处理弹窗 */}
      {!readOnly && refundAction && (
        <RefundActionDialog
          order={refundAction.order}
          kind={refundAction.kind}
          rejectReason={rejectReason}
          onRejectReasonChange={setRejectReason}
          onSwitchKind={kind => {
            if (!canMutateOutboundOrder(readOnly)) return;
            setRefundAction({ order: refundAction.order, kind });
          }}
          onClose={closeRefundDialog}
          pending={
            approveRefundMut.isPending ||
            rejectRefundMut.isPending ||
            agreeReturnMut.isPending ||
            confirmOfflineRefundMut.isPending
          }
          onApprove={() => {
            if (!canMutateOutboundOrder(readOnly)) return;
            approveRefundMut.mutate({ orderId: refundAction.order.id });
          }}
          onAgreeReturn={() => {
            if (!canMutateOutboundOrder(readOnly)) return;
            agreeReturnMut.mutate({ orderId: refundAction.order.id });
          }}
          onReject={() => {
            if (!canMutateOutboundOrder(readOnly)) return;
            if (rejectReason.trim().length < 2) {
              toast.error("请填写驳回理由");
              return;
            }
            rejectRefundMut.mutate({
              orderId: refundAction.order.id,
              reason: rejectReason.trim(),
            });
          }}
          voucherNo={refundVoucherNo}
          onVoucherNoChange={setRefundVoucherNo}
          onConfirmOffline={() => {
            if (!canMutateOutboundOrder(readOnly)) return;
            if (refundVoucherNo.trim().length < 4) {
              toast.error("请填写银行流水号或回单号");
              return;
            }
            confirmOfflineRefundMut.mutate({
              orderId: refundAction.order.id,
              voucherNo: refundVoucherNo.trim(),
            });
          }}
        />
      )}

      {/* 确认到账弹窗 */}
      {!readOnly && confirmPayOrder && (
        <div
          className="fixed inset-0 z-[60] bg-black/45 flex items-center justify-center p-4"
          onClick={() => setConfirmPayOrder(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="outbound-confirm-pay-title"
            className="outbound-dialog bg-white rounded-lg w-[420px] max-w-full max-h-[90vh] overflow-y-auto p-6"
            onClick={e => e.stopPropagation()}
          >
            <h3 id="outbound-confirm-pay-title" className="text-[18px] font-semibold text-[#222] mb-1">确认到账</h3>
            <div className="text-[12px] text-[#888] mb-4">
              订单 {confirmPayOrder.orderNo}
            </div>

            {confirmPayOrder.corpPayeeMode === "seller_direct" ? (
              <div className="mb-3 rounded-md border border-[#dbe7f5] bg-[#f5f9ff] px-3 py-2.5 text-[12px] leading-5 text-[#185FA5]">
                {confirmPayOrder.transferDeclaredAt
                  ? "买家已声明完成转账，请核对银行到账记录。"
                  : "买家尚未声明转账；如企业网银已确认到账，仍可直接确认。"}
                {confirmPayOrder.payeeAccountName ? (
                  <div className="mt-1 text-[#52606d]">
                    订单收款账户：{confirmPayOrder.payeeAccountName}
                    {confirmPayOrder.payeeAccountNumber
                      ? `（尾号 ${confirmPayOrder.payeeAccountNumber.slice(-4)}）`
                      : ""}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mb-4 rounded-md border border-[#f5e3c8] bg-[#fffbf2] px-3 py-2.5 text-[12px] leading-5 text-[#8a6d3b]">
              请先在企业网银核对到账金额
              <span className="font-semibold">
                {" "}
                ¥{fmtMoney(num(confirmPayOrder.totalAmount))}{" "}
              </span>
              后再确认。确认后订单将进入待发货状态，此操作不可撤销。
            </div>

            <div className="mb-4">
              <label className="block text-[12px] text-[#666] mb-1.5">
                到账凭证（选填）
              </label>
              <input
                className="crm-input w-full"
                placeholder="银行流水号或转账附言，便于日后对账"
                value={payVoucher}
                maxLength={120}
                onChange={e => setPayVoucher(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                className="crm-btn"
                onClick={() => setConfirmPayOrder(null)}
              >
                取消
              </button>
              <button
                className="crm-btn crm-btn-primary"
                disabled={confirmPayMut.isPending}
                onClick={() => {
                  if (!canMutateOutboundOrder(readOnly)) return;
                  confirmPayMut.mutate({
                    orderId: confirmPayOrder.id,
                    voucher: payVoucher.trim() || undefined,
                  });
                }}
              >
                {confirmPayMut.isPending ? "处理中…" : "确认已收款"}
              </button>
            </div>
          </div>
        </div>
      )}
      </AdminPage>
    </PlatformLayout>
  );
}

/**
 * 卖家退款处理弹窗：通过售后 / 同意退货 / 驳回三中选一。
 *
 * 三个动作放在同一弹窗而非三个独立入口，是为了让卖家在做决定前
 * 看到完整上下文：退多少钱、是否已发货、选错了会有什么后果。
 */
function RefundActionDialog({
  order,
  kind,
  rejectReason,
  onRejectReasonChange,
  onSwitchKind,
  onClose,
  pending,
  onApprove,
  onAgreeReturn,
  onReject,
  voucherNo,
  onVoucherNoChange,
  onConfirmOffline,
}: {
  order: OrderRow;
  kind: RefundActionKind;
  rejectReason: string;
  onRejectReasonChange: (v: string) => void;
  onSwitchKind: (kind: RefundActionKind) => void;
  onClose: () => void;
  pending: boolean;
  onApprove: () => void;
  onAgreeReturn: () => void;
  onReject: () => void;
  voucherNo: string;
  onVoucherNoChange: (v: string) => void;
  onConfirmOffline: () => void;
}) {
  const detail = trpc.order.refundDetail.useQuery({ orderId: order.id });
  const d = detail.data;
  const shipped = Boolean(order.expressNo);
  const confirmingReturnReceipt = d?.status === "awaiting_return";
  // 待财务线下打款：此时已无需再审批，唯一待办是登记银行汇款凭据
  const awaitingOfflinePay = d?.status === "pending_offline";

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/45 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="outbound-refund-title"
        className="outbound-dialog bg-white rounded-lg w-[460px] max-w-full max-h-[85vh] overflow-y-auto p-6"
        onClick={e => e.stopPropagation()}
      >
        <h3 id="outbound-refund-title" className="text-[18px] font-semibold text-[#222] mb-1">处理退款申请</h3>
        <div className="text-[12px] text-[#888] mb-4">订单 {order.orderNo}</div>

        {detail.isLoading && (
          <div className="text-[12px] text-[#888] py-3">加载退款信息…</div>
        )}
        {!detail.isLoading && !d && (
          <div className="mb-4 rounded-md border border-[#f5d0d0] bg-[#fdf5f5] px-3 py-2.5 text-[12px] leading-5 text-[#A32D2D]">
            未找到退款单。若订单状态异常，请联系平台客服处理。
          </div>
        )}

        {d && (
          <>
            <div className="mb-4 rounded-md border border-[#eee] bg-[#fafbfc] px-3 py-2.5 text-[12px] leading-6 text-[#555]">
              <div className="flex justify-between">
                <span>退款金额</span>
                <span className="font-bold text-[#A32D2D]">
                  ¥{fmtMoney(num(d.refundAmount))}
                </span>
              </div>
              <div className="flex justify-between">
                <span>其中货款及税</span>
                <span>¥{fmtMoney(num(d.goodsAmount))}</span>
              </div>
              <div className="flex justify-between">
                <span>其中运费</span>
                <span>
                  {num(d.shippingFee) > 0
                    ? `¥${fmtMoney(num(d.shippingFee))}`
                    : d.shippedWhenRequested
                      ? "不退（已发货）"
                      : "包邮"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>当前状态</span>
                <span>{d.statusLabel}</span>
              </div>
              <div className="mt-1 pt-1 border-t border-dashed border-[#e5e5e5]">
                买家原因：{d.reason}
              </div>
            </div>

            {/* 自动退款倒计时提醒：卖家必须知道不作为的后果 */}
            {d.status === "requested" && d.autoApproveAt && (
              <div className="mb-4 rounded-md border border-[#f5e3c8] bg-[#fffbf2] px-3 py-2.5 text-[12px] leading-5 text-[#8a6d3b]">
                该订单尚未发货。若在{" "}
                <span className="font-semibold">{dateStr(d.autoApproveAt)}</span>{" "}
                前未处理，系统将自动为买家退款。如有异议请及时驳回。
              </div>
            )}

            {/*
              待财务线下打款：对公转账没有退款 API，钱必须人工从银行汇出。
              若不提供登记入口，汇出后无处确认，退款单会永远停在本状态。
            */}
            {awaitingOfflinePay ? (
              <>
                <div className="mb-3 rounded-md border border-[#f5e3c8] bg-[#fffbf2] px-3 py-2.5 text-[12px] leading-5 text-[#8a6d3b]">
                  该退款已审批通过，但对公转账无法自动退款。请财务从对公账户
                  汇出 <span className="font-semibold">¥{fmtMoney(num(d.refundAmount))}</span>{" "}
                  后，在此登记银行凭据完成退款。
                </div>
                <div className="mb-3">
                  <label className="block text-[12px] text-[#666] mb-1.5">
                    银行流水号 / 回单号
                  </label>
                  <input
                    className="crm-input w-full"
                    maxLength={64}
                    placeholder="如：2026081512345678（买家可凭此号向银行核对入账）"
                    value={voucherNo}
                    onChange={e => onVoucherNoChange(e.target.value)}
                  />
                  <div className="mt-1.5 text-[11px] leading-4 text-[#999]">
                    凭据号会同步给买家，并作为日后对账与举证依据，请如实填写。
                  </div>
                </div>
              </>
            ) : (
              <>
            {/* 动作选择 */}
            <div className="flex gap-2 mb-3">
              <button
                className={`crm-btn crm-btn-sm ${kind === "approve" ? "crm-btn-primary" : ""}`}
                onClick={() => onSwitchKind("approve")}
              >
                {confirmingReturnReceipt ? "确认退货入库" : "通过退款"}
              </button>
              {shipped && (
                <button
                  className={`crm-btn crm-btn-sm ${kind === "agreeReturn" ? "crm-btn-primary" : ""}`}
                  onClick={() => onSwitchKind("agreeReturn")}
                >
                  同意退货
                </button>
              )}
              <button
                className={`crm-btn crm-btn-sm ${kind === "reject" ? "crm-btn-primary" : ""}`}
                onClick={() => onSwitchKind("reject")}
              >
                驳回
              </button>
            </div>

            {kind === "approve" && (
              <div className="mb-4 rounded-md border border-[#f5d0d0] bg-[#fdf5f5] px-3 py-2.5 text-[12px] leading-5 text-[#A32D2D]">
                {confirmingReturnReceipt
                  ? `确认退货已验收入库后，将回补库存并办理退款 ¥${fmtMoney(num(d.refundAmount))}。此操作不可撤销。`
                  : order.payMethod === "corp"
                    ? `确认后将标记为待财务线下打款 ¥${fmtMoney(num(d.refundAmount))}。${shipped ? "商品尚未确认退回，本次不会回补库存。" : "未发货订单将同步释放库存。"}请知会财务及时汇出。`
                    : `确认后将立即向原支付渠道发起退款 ¥${fmtMoney(num(d.refundAmount))}。${shipped ? "商品尚未确认退回，本次不会回补库存。" : "未发货订单将同步释放库存。"}此操作不可撤销。`}
                {shipped && !confirmingReturnReceipt &&
                  " 该订单已发货，直接通过将在未收到退货的情况下放款，请确认已与买家谈妥。"}
              </div>
            )}
            {kind === "agreeReturn" && (
              <div className="mb-4 rounded-md border border-[#dbe8f3] bg-[#f5f9fd] px-3 py-2.5 text-[12px] leading-5 text-[#54718a]">
                确认后将通知买家寄回商品并填写退货运单。收到退货并验货无误后，
                再回到本弹窗选择「通过退款」放款。选择后将不再自动退款。
              </div>
            )}
            {kind === "reject" && (
              <div className="mb-3">
                <label className="block text-[12px] text-[#666] mb-1.5">
                  驳回理由（会展示给买家）
                </label>
                <textarea
                  className="crm-input w-full min-h-[72px] py-2"
                  maxLength={200}
                  placeholder="如：商品已报关发出无法撤回、买家描述与实际不符等（200 字以内）"
                  value={rejectReason}
                  onChange={e => onRejectReasonChange(e.target.value)}
                />
              </div>
            )}
              </>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button className="crm-btn" onClick={onClose}>
            取消
          </button>
          {d && awaitingOfflinePay && (
            <button
              className="crm-btn crm-btn-primary"
              disabled={pending || voucherNo.trim().length < 4}
              onClick={onConfirmOffline}
            >
              {pending ? "处理中…" : "确认已线下汇出"}
            </button>
          )}
          {d && !awaitingOfflinePay && (
            <button
              className="crm-btn crm-btn-primary"
              disabled={pending}
              onClick={
                kind === "approve"
                  ? onApprove
                  : kind === "agreeReturn"
                    ? onAgreeReturn
                    : onReject
              }
            >
              {pending
                ? "处理中…"
                : kind === "approve"
                  ? confirmingReturnReceipt
                    ? "确认退货入库并退款"
                    : "确认通过退款"
                  : kind === "agreeReturn"
                    ? "确认同意退货"
                    : "确认驳回"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
