import { usePageMemory, useRememberedState, freshListOptions, useRestoringListQuery, returnToPageSource } from "../hooks/usePageMemory";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Plus, RefreshCw, Search, X } from "lucide-react";
import { toast } from "sonner";
import PlatformLayout from "../../../../BusinessContentFrame";
import "./ProcurementOrders.css";
import { trpc } from "../../../../api/business-trpc";
import { AdminPage, AdminPageHeader, AdminPageTabs, AdminFilterBar, AdminDataPanel } from "@/components/admin/UnifiedAdminPage";

type PaymentStatus = "pending" | "partial" | "paid";
type ShippingStatus = "pending" | "partial" | "shipped";
type ReceiptStatus = "pending" | "partial" | "received" | "over_received";
type InvoiceStatus = "pending" | "partial" | "received";
type Lifecycle = "active" | "cancelled" | "all";
type CreateSource = "manual" | "accepted_quote";
type DetailTab = "overview" | "payment" | "shipping" | "inbound" | "invoice" | "history";

type ManualLine = {
  rowId: string;
  partNumber: string;
  brand: string;
  pkg: string;
  qtyUnit: string;
  qty: string;
  unitPrice: string;
};

const PAGE_SIZE = 20;
const paymentLabels: Record<PaymentStatus, string> = { pending: "待付款", partial: "部分付款", paid: "已付清" };
const shippingLabels: Record<ShippingStatus, string> = { pending: "待发货", partial: "部分发货", shipped: "已发货" };
const receiptLabels: Record<ReceiptStatus, string> = { pending: "待入库", partial: "部分入库", received: "已入库", over_received: "超量待核对" };
const invoiceLabels: Record<InvoiceStatus, string> = { pending: "待收票", partial: "部分收票", received: "已收票" };

function makeRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `purchase_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function useStableRequestId() {
  const previous = useRef<{ payload: string; requestId: string } | null>(null);
  return (payload: unknown) => {
    const serialized = JSON.stringify(payload);
    if (previous.current?.payload !== serialized) previous.current = { payload: serialized, requestId: makeRequestId() };
    return previous.current.requestId;
  };
}

function newLine(): ManualLine {
  return { rowId: makeRequestId(), partNumber: "", brand: "", pkg: "", qtyUnit: "片", qty: "", unitPrice: "" };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}

function formatMoney(value: unknown) {
  const match = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(String(value ?? ""));
  if (!match) return "—";
  const [, sign, whole, fraction = ""] = match;
  return `¥${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0")}`;
}

function formatDate(value: unknown, withTime = false) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", withTime ? { hour12: false } : { year: "numeric", month: "2-digit", day: "2-digit" });
}

function StatusBadge({ type, value }: { type: "payment" | "shipping" | "receipt" | "invoice"; value: string }) {
  const label = type === "payment"
    ? paymentLabels[value as PaymentStatus]
    : type === "shipping"
      ? shippingLabels[value as ShippingStatus]
      : type === "receipt"
        ? receiptLabels[value as ReceiptStatus]
        : invoiceLabels[value as InvoiceStatus];
  const palette = value === "over_received"
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : value === "paid" || value === "shipped" || value === "received"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : value === "partial"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-slate-200 bg-slate-50 text-slate-600";
  return <span className={`inline-flex procurement-order-status shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${palette}`}>{label ?? value}</span>;
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="procurement-order-field-label mb-1 block text-[12px] font-medium text-slate-700">{children}</label>;
}

function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`procurement-order-control h-8 w-full rounded-md border border-slate-200 bg-white px-3 text-[12px] outline-none transition focus:border-[#185FA5] focus:ring-2 focus:ring-[#185FA5]/15 disabled:bg-slate-100 ${props.className ?? ""}`} />;
}

function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`procurement-order-control h-8 w-full rounded-md border border-slate-200 bg-white px-3 text-[12px] outline-none transition focus:border-[#185FA5] focus:ring-2 focus:ring-[#185FA5]/15 disabled:bg-slate-100 ${props.className ?? ""}`} />;
}

function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`procurement-order-control min-h-24 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-[12px] outline-none transition focus:border-[#185FA5] focus:ring-2 focus:ring-[#185FA5]/15 disabled:bg-slate-100 ${props.className ?? ""}`} />;
}

function PrimaryButton({ children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={`procurement-order-button inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#185FA5] px-3 text-[12px] font-medium text-white transition hover:bg-[#124a80] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>{children}</button>;
}

function SecondaryButton({ children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={`procurement-order-button inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>{children}</button>;
}

export default function ProcurementOrders() {
  const d51Ready = usePageMemory();

  const utils = trpc.useUtils();
  const [keywordInput, setKeywordInput] = useRememberedState("keywordInput", "");
  const [keyword, setKeyword] = useRememberedState("keyword", "");
  const [paymentFilter, setPaymentFilter] = useRememberedState<"" | PaymentStatus>("paymentFilter", "");
  const [shippingFilter, setShippingFilter] = useRememberedState<"" | ShippingStatus>("shippingFilter", "");
  const [invoiceFilter, setInvoiceFilter] = useRememberedState<"" | InvoiceStatus>("invoiceFilter", "");
  const [lifecycle, setLifecycle] = useRememberedState<Lifecycle>("lifecycle", "active");
  const [page, setPage] = useRememberedState("page", 1);
  const [selectedOrderId, setSelectedOrderId] = useRememberedState<number | null>("selectedOrderId", null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSource, setCreateSource] = useState<CreateSource>("manual");
  const [detailTab, setDetailTab] = useRememberedState<DetailTab>("detailTab", "overview");

  useEffect(() => {
    if (keywordInput.trim() === keyword) return;
    const timer = window.setTimeout(() => {
      setKeyword(keywordInput.trim());
      setPage(1);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [keywordInput, keyword]);

  const listInput = useMemo(() => ({
    keyword,
    paymentStatus: paymentFilter || undefined,
    shippingStatus: shippingFilter || undefined,
    invoiceStatus: invoiceFilter || undefined,
    lifecycle,
    page,
    pageSize: PAGE_SIZE,
  }), [keyword, paymentFilter, shippingFilter, invoiceFilter, lifecycle, page]);
  const ordersQuery = useRestoringListQuery(trpc.purchaseOrder.list.useQuery(listInput, freshListOptions({ retry: 1 }, d51Ready)));
  const detailQuery = trpc.purchaseOrder.get.useQuery({ id: selectedOrderId ?? 0 }, { enabled: selectedOrderId !== null, retry: 1 });
  const detail = detailQuery.data as any;
  useEffect(() => {
    if (!ordersQuery.data || ordersQuery.isFetching) return;
    const lastPage = Math.max(1, Math.ceil(ordersQuery.data.total / PAGE_SIZE));
    if (page > lastPage) setPage(lastPage);
  }, [ordersQuery.data, ordersQuery.isFetching, page]);

  const invalidateOrders = async () => {
    await utils.purchaseOrder.list.invalidate();
    if (selectedOrderId) await utils.purchaseOrder.get.invalidate({ id: selectedOrderId });
  };

  const dismissCreate = () => setCreateOpen(false);
  const selectedFromList = (id: number) => {
    setSelectedOrderId(id);
    setDetailTab("overview");
  };

  return (
    <PlatformLayout>
      <AdminPage className="procurement-orders-page mx-auto max-w-[1480px] space-y-3">
        <AdminPageHeader
          list
          title={<>采购订单 <span className="procurement-order-context rounded-md bg-blue-50 px-2 py-0.5 font-medium text-[#185FA5]">采购管理</span></>}
          description="独立管理采购下单、人工付款进度、发货、入库关联与供应商发票。"
          actions={<PrimaryButton onClick={() => { setCreateSource("manual"); setCreateOpen(true); }}><Plus className="size-3.5" />新建采购订单</PrimaryButton>}
        />

        <AdminFilterBar>
          <div className="grid w-full gap-2 md:grid-cols-2 xl:grid-cols-[minmax(250px,1.8fr)_repeat(4,minmax(144px,0.7fr))_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
              <Input value={keywordInput} onChange={event => setKeywordInput(event.target.value)} placeholder="搜索订单号、供应商或型号" className="pl-8" aria-label="搜索采购订单" />
            </div>
            <Select value={paymentFilter} onChange={event => { setPaymentFilter(event.target.value as "" | PaymentStatus); setPage(1); }} aria-label="付款状态">
              <option value="">付款状态（全部）</option><option value="pending">待付款</option><option value="partial">部分付款</option><option value="paid">已付清</option>
            </Select>
            <Select value={shippingFilter} onChange={event => { setShippingFilter(event.target.value as "" | ShippingStatus); setPage(1); }} aria-label="发货状态">
              <option value="">发货状态（全部）</option><option value="pending">待发货</option><option value="partial">部分发货</option><option value="shipped">已发货</option>
            </Select>
            <Select value={invoiceFilter} onChange={event => { setInvoiceFilter(event.target.value as "" | InvoiceStatus); setPage(1); }} aria-label="发票状态">
              <option value="">发票状态（全部）</option><option value="pending">待收票</option><option value="partial">部分收票</option><option value="received">已收票</option>
            </Select>
            <Select value={lifecycle} onChange={event => { setLifecycle(event.target.value as Lifecycle); setPage(1); }} aria-label="订单生命周期">
              <option value="active">有效订单</option><option value="cancelled">已取消</option><option value="all">全部订单</option>
            </Select>
            <SecondaryButton onClick={() => void ordersQuery.refetch()} disabled={ordersQuery.isFetching}><RefreshCw className={`size-3.5 ${ordersQuery.isFetching ? "animate-spin" : ""}`} />刷新</SecondaryButton>
          </div>
        </AdminFilterBar>

        <OrdersList
          query={ordersQuery}
          selectedOrderId={selectedOrderId}
          onSelect={selectedFromList}
          page={page}
          onPageChange={setPage}
        />

        {selectedOrderId !== null ? (
          <OrderDetail
            key={selectedOrderId}
            detail={detail}
            query={detailQuery}
            tab={detailTab}
            setTab={setDetailTab}
            onClose={() => setSelectedOrderId(null)}
            onChanged={invalidateOrders}
          />
        ) : null}

        {createOpen ? <CreateOrderDialog source={createSource} setSource={setCreateSource} onClose={dismissCreate} onCreated={async (id: number) => { setCreateOpen(false); await invalidateOrders(); setSelectedOrderId(id); setDetailTab("overview"); }} /> : null}
      </AdminPage>
    </PlatformLayout>
  );
}

function OrdersList({ query, selectedOrderId, onSelect, page, onPageChange }: { query: any; selectedOrderId: number | null; onSelect: (id: number) => void; page: number; onPageChange: (page: number) => void }) {
  const data = query.data as any;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return <AdminDataPanel className="overflow-hidden">
    <div className="hidden overflow-x-auto md:block">
      <table className="admin-table-readable procurement-order-list-table w-full text-left">
        <colgroup><col className="procurement-order-col-number" /><col className="procurement-order-col-supplier" /><col className="procurement-order-col-amount" /><col className="procurement-order-col-status" /><col className="procurement-order-col-status" /><col className="procurement-order-col-status" /><col className="procurement-order-col-status" /><col className="procurement-order-col-time" /><col className="procurement-order-col-action" /></colgroup>
        <thead className="border-b border-slate-200 bg-slate-50 text-slate-600"><tr>
          <th className="px-3 py-2 font-medium">采购订单</th><th className="px-3 py-2 font-medium">供应商 / 物料</th><th className="px-3 py-2 font-medium text-right">订单金额</th><th className="px-3 py-2 font-medium">付款</th><th className="px-3 py-2 font-medium">发货</th><th className="px-3 py-2 font-medium">入库</th><th className="px-3 py-2 font-medium">发票</th><th className="px-3 py-2 font-medium">创建时间</th><th className="px-3 py-2 font-medium text-right">操作</th>
        </tr></thead>
        <tbody>
          {query.isLoading ? <TableMessage colSpan={9} text="采购订单加载中…" /> : query.isError ? <TableMessage colSpan={9} text={`加载失败：${errorMessage(query.error)}`} error /> : items.length === 0 ? <TableMessage colSpan={9} text="暂无符合条件的采购订单" /> : items.map((item: any) => <tr key={item.id} className={`border-b border-slate-100 last:border-0 ${selectedOrderId === item.id ? "bg-blue-50/60" : "hover:bg-slate-50"}`}>
            <td className="px-3 py-2.5"><div className="admin-cell-primary procurement-order-number font-medium">{item.orderNo}</div>{item.lifecycle === "cancelled" ? <span className="mt-0.5 inline-flex rounded-md border border-rose-200 bg-rose-50 px-1 py-0.5 text-[12px] text-rose-700">已取消</span> : null}</td>
            <td className="px-3 py-2.5"><div className="admin-cell-primary truncate font-medium" title={item.supplierName}>{item.supplierName}</div><div className="mt-0.5 procurement-order-material"><span className="admin-cell-primary">{item.firstPartNumber || "—"}</span><span className="admin-cell-secondary">{item.itemCount > 1 ? ` 等 ${item.itemCount} 项` : ""} · 共 {item.totalQty ?? 0}</span></div></td>
            <td className="admin-cell-primary whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums">{formatMoney(item.totalAmount)}</td>
            <td className="px-3 py-2.5"><StatusBadge type="payment" value={item.paymentStatus} /></td><td className="px-3 py-2.5"><StatusBadge type="shipping" value={item.shippingStatus} /></td><td className="px-3 py-2.5"><StatusBadge type="receipt" value={item.receiptStatus} /></td><td className="px-3 py-2.5"><StatusBadge type="invoice" value={item.invoiceStatus} /></td>
            <td className="whitespace-nowrap px-3 py-2.5"><span className="admin-cell-secondary">{formatDate(item.createdAt, true)}</span></td>
            <td className="px-3 py-2.5 text-right"><button type="button" onClick={() => onSelect(item.id)} className="admin-row-action procurement-order-row-action font-medium text-[#185FA5] hover:bg-blue-50">查看详情</button></td>
          </tr>) }
        </tbody>
      </table>
    </div>
    <div className="divide-y divide-slate-100 md:hidden">
      {query.isLoading ? <div className="px-3 py-8 text-center text-[12px] text-slate-500">采购订单加载中…</div> : query.isError ? <div className="px-3 py-8 text-center text-[12px] text-rose-600">加载失败：{errorMessage(query.error)}</div> : items.length === 0 ? <div className="px-3 py-8 text-center text-[12px] text-slate-500">暂无符合条件的采购订单</div> : items.map((item: any) => <button key={item.id} type="button" onClick={() => onSelect(item.id)} className={`w-full px-3 py-3 text-left ${selectedOrderId === item.id ? "bg-blue-50" : ""}`}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1 procurement-order-material"><div className="admin-cell-primary font-medium text-slate-800">{item.orderNo}</div><div className="mt-0.5 text-[12px] text-slate-600">{item.supplierName} · {item.firstPartNumber || "未录入型号"}</div></div><div className="text-right"><div className="admin-cell-primary font-medium text-slate-800">{formatMoney(item.totalAmount)}</div><div className="mt-1 flex justify-end gap-1"><StatusBadge type="payment" value={item.paymentStatus} /><StatusBadge type="shipping" value={item.shippingStatus} /></div></div></div>
        <div className="mt-2 flex items-center justify-between text-[12px] text-slate-500"><span>{item.itemCount} 项 · 共 {item.totalQty ?? 0}</span><span>{formatDate(item.createdAt)}</span></div>
      </button>) }
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-3 py-2 text-[12px] text-slate-500"><span>共 {total} 条，第 {page}/{totalPages} 页</span><div className="flex gap-2"><SecondaryButton className="admin-row-action procurement-order-row-action px-2" disabled={page <= 1 || query.isFetching} onClick={() => onPageChange(page - 1)}>上一页</SecondaryButton><SecondaryButton className="admin-row-action procurement-order-row-action px-2" disabled={page >= totalPages || query.isFetching} onClick={() => onPageChange(page + 1)}>下一页</SecondaryButton></div></div>
  </AdminDataPanel>;
}

function TableMessage({ colSpan, text, error }: { colSpan: number; text: string; error?: boolean }) {
  return <tr><td colSpan={colSpan} className={`px-3 py-12 text-center ${error ? "text-rose-600" : "text-slate-500"}`}>{text}</td></tr>;
}

function CreateOrderDialog({ source, setSource, onClose, onCreated }: { source: CreateSource; setSource: (source: CreateSource) => void; onClose: () => void; onCreated: (id: number) => Promise<void> }) {
  const [supplierName, setSupplierName] = useState("");
  const [supplierOrderNo, setSupplierOrderNo] = useState("");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<ManualLine[]>([newLine()]);
  const [quoteKeyword, setQuoteKeyword] = useState("");
  const [acceptanceId, setAcceptanceId] = useState<number | null>(null);
  const [formError, setFormError] = useState("");
  const quoteQuery = trpc.purchaseOrder.acceptedQuoteOptions.useQuery({ keyword: quoteKeyword.trim(), limit: 20 }, { enabled: source === "accepted_quote", retry: 1 });
  const createMutation = trpc.purchaseOrder.create.useMutation();
  const stableRequestId = useStableRequestId();

  const updateLine = (rowId: string, field: keyof Omit<ManualLine, "rowId">, value: string) => setLines(current => current.map(line => line.rowId === rowId ? { ...line, [field]: value } : line));
  const submit = async () => {
    setFormError("");
    if (source === "manual") {
      if (!supplierName.trim()) return setFormError("请填写供应商名称");
      const normalized = lines.map(line => ({ ...line, partNumber: line.partNumber.trim(), brand: line.brand.trim(), pkg: line.pkg.trim(), qtyUnit: line.qtyUnit.trim() || "片", qty: Number(line.qty), unitPrice: line.unitPrice.trim() }));
      if (normalized.some(line => !line.partNumber || !Number.isInteger(line.qty) || line.qty <= 0 || !/^(?:0|[1-9]\d{0,7})(?:\.\d{1,4})?$/.test(line.unitPrice))) return setFormError("请完整填写型号、正整数数量和非负单价（最多4位小数）");
      try {
        const payload = { source: "manual" as const, supplierName: supplierName.trim(), supplierOrderNo: supplierOrderNo.trim(), expectedDeliveryDate: expectedDeliveryDate || undefined, note: note.trim(), items: normalized.map(({ rowId, ...line }) => line) };
        const result = await createMutation.mutateAsync({ ...payload, requestId: stableRequestId(payload) });
        toast.success(`采购订单 ${result.orderNo} 已创建`);
        await onCreated(result.id);
      } catch (error) { setFormError(errorMessage(error)); }
      return;
    }
    if (!acceptanceId) return setFormError("请选择一条已采用报价选项");
    if (!window.confirm("确认按该已采用报价选项复制并创建采购订单？将以当前报价快照建单，创建后仍可分别登记付款、发货、入库和发票。")) return;
    try {
      const payload = { source: "accepted_quote" as const, acceptanceId, supplierOrderNo: supplierOrderNo.trim(), expectedDeliveryDate: expectedDeliveryDate || undefined, note: note.trim() };
      const result = await createMutation.mutateAsync({ ...payload, requestId: stableRequestId(payload) });
      toast.success(`采购订单 ${result.orderNo} 已创建`);
      await onCreated(result.id);
    } catch (error) { setFormError(errorMessage(error)); }
  };

  return <Dialog title="新建采购订单" onClose={onClose} wide>
    <AdminPageTabs ariaLabel="采购订单建单来源" className="procurement-order-tabs px-4"><button type="button" aria-current={source === "manual" ? "page" : undefined} onClick={() => { setSource("manual"); setFormError(""); }} className={`procurement-order-tab min-h-10 border-b-2 pb-2 font-medium ${source === "manual" ? "border-[#185FA5] text-[#185FA5]" : "border-transparent text-slate-500"}`}>手工创建</button><button type="button" aria-current={source === "accepted_quote" ? "page" : undefined} onClick={() => { setSource("accepted_quote"); setFormError(""); }} className={`procurement-order-tab min-h-10 border-b-2 pb-2 font-medium ${source === "accepted_quote" ? "border-[#185FA5] text-[#185FA5]" : "border-transparent text-slate-500"}`}>从已采用报价建单</button></AdminPageTabs>
    <div className="procurement-order-dialog-body max-h-[calc(100vh-220px)] overflow-y-auto p-4">
      {source === "manual" ? <>
        <div className="grid gap-3 sm:grid-cols-2"><div><FieldLabel>供应商名称 <span className="text-rose-600">*</span></FieldLabel><Input value={supplierName} maxLength={128} onChange={event => setSupplierName(event.target.value)} placeholder="请输入供应商名称" /></div><div><FieldLabel>供应商订单号</FieldLabel><Input value={supplierOrderNo} maxLength={64} onChange={event => setSupplierOrderNo(event.target.value)} placeholder="选填" /></div><div><FieldLabel>预计交期</FieldLabel><Input type="date" value={expectedDeliveryDate} onChange={event => setExpectedDeliveryDate(event.target.value)} /></div><div><FieldLabel>备注</FieldLabel><Input value={note} maxLength={1000} onChange={event => setNote(event.target.value)} placeholder="选填" /></div></div>
        <div className="mt-4"><div className="mb-2 flex items-center justify-between"><h3 className="admin-section-title text-[15px] font-semibold text-slate-800">采购物料</h3><SecondaryButton className="admin-row-action procurement-order-row-action px-2" onClick={() => setLines(current => [...current, newLine()])}><Plus className="size-3" />添加一行</SecondaryButton></div>
          <AdminDataPanel className="overflow-x-auto"><table className="admin-table-readable procurement-order-detail-table w-full min-w-[720px] text-[12px]"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-2 py-2 text-left font-medium">型号 *</th><th className="px-2 py-2 text-left font-medium">品牌</th><th className="px-2 py-2 text-left font-medium">封装</th><th className="px-2 py-2 text-left font-medium">单位</th><th className="px-2 py-2 text-right font-medium">数量 *</th><th className="px-2 py-2 text-right font-medium">含税单价 *</th><th className="w-12 px-2 py-2" /></tr></thead><tbody>{lines.map(line => <tr key={line.rowId} className="border-t border-slate-100"><td className="p-1.5"><Input value={line.partNumber} onChange={event => updateLine(line.rowId, "partNumber", event.target.value)} /></td><td className="p-1.5"><Input value={line.brand} onChange={event => updateLine(line.rowId, "brand", event.target.value)} /></td><td className="p-1.5"><Input value={line.pkg} onChange={event => updateLine(line.rowId, "pkg", event.target.value)} /></td><td className="p-1.5"><Input value={line.qtyUnit} onChange={event => updateLine(line.rowId, "qtyUnit", event.target.value)} /></td><td className="p-1.5"><Input className="text-right tabular-nums" type="number" min="1" step="1" value={line.qty} onChange={event => updateLine(line.rowId, "qty", event.target.value)} /></td><td className="p-1.5"><Input className="text-right tabular-nums" inputMode="decimal" value={line.unitPrice} onChange={event => updateLine(line.rowId, "unitPrice", event.target.value)} /></td><td className="p-1.5 text-center">{lines.length > 1 ? <button type="button" aria-label="删除物料行" className="admin-row-action procurement-order-row-action text-slate-500 hover:bg-rose-50 hover:text-rose-600" onClick={() => setLines(current => current.filter(candidate => candidate.rowId !== line.rowId))}><X className="size-3.5" /></button> : null}</td></tr>)}</tbody></table></AdminDataPanel>
        </div>
      </> : <>
        <div className="mb-3 rounded-md border border-blue-100 bg-blue-50 p-2.5 text-[12px] leading-5 text-blue-800">仅可从已经采用的报价选项创建。确认后会复制该报价快照生成新的采购订单；请在确认弹窗中再次核对。</div>
        <AdminFilterBar className="procurement-order-inline-filter"><Input value={quoteKeyword} onChange={event => setQuoteKeyword(event.target.value)} placeholder="搜索供应商、需求或型号" aria-label="搜索已采用报价" /></AdminFilterBar>
        <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-slate-200">{quoteQuery.isLoading ? <div className="p-4 text-center text-[12px] text-slate-500">加载已采用报价…</div> : quoteQuery.isError ? <div className="p-4 text-center text-[12px] text-rose-600">加载失败：{errorMessage(quoteQuery.error)}</div> : (quoteQuery.data?.items ?? []).length === 0 ? <div className="p-4 text-center text-[12px] text-slate-500">没有可建单的已采用报价</div> : (quoteQuery.data?.items ?? []).map((item: any) => <label key={item.acceptanceId} className={`flex cursor-pointer gap-2 border-b border-slate-100 p-3 last:border-0 ${acceptanceId === item.acceptanceId ? "bg-blue-50" : "hover:bg-slate-50"}`}><input type="radio" checked={acceptanceId === item.acceptanceId} onChange={() => setAcceptanceId(item.acceptanceId)} className="mt-0.5" /><span className="min-w-0 flex-1"><span className="admin-cell-primary block font-medium text-slate-800">{item.supplierName}</span><span className="admin-cell-primary procurement-order-material mt-1 block">{item.partSummary} · 采用数量 {item.acceptedQty}</span><span className="mt-1 block text-[12px] text-slate-500">需求 #{item.demandId} · 报价 #{item.quoteId} / V{item.quoteVersion}</span></span></label>)}</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2"><div><FieldLabel>供应商订单号</FieldLabel><Input value={supplierOrderNo} maxLength={64} onChange={event => setSupplierOrderNo(event.target.value)} placeholder="选填" /></div><div><FieldLabel>预计交期</FieldLabel><Input type="date" value={expectedDeliveryDate} onChange={event => setExpectedDeliveryDate(event.target.value)} /></div><div className="sm:col-span-2"><FieldLabel>备注</FieldLabel><Textarea value={note} maxLength={1000} onChange={event => setNote(event.target.value)} placeholder="选填" /></div></div>
      </>}
      {formError ? <p role="alert" className="mt-3 text-[12px] text-rose-600">{formError}</p> : null}
    </div>
    <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3"><SecondaryButton onClick={onClose} disabled={createMutation.isPending}>取消</SecondaryButton><PrimaryButton onClick={() => void submit()} disabled={createMutation.isPending}>{createMutation.isPending ? "创建中…" : source === "accepted_quote" ? "确认并建单" : "创建订单"}</PrimaryButton></div>
  </Dialog>;
}

function OrderDetail({ detail, query, tab, setTab, onClose, onChanged }: { detail: any; query: any; tab: DetailTab; setTab: (tab: DetailTab) => void; onClose: () => void; onChanged: () => Promise<void> }) {
  if (query.isLoading) return <AdminDataPanel className="p-8 text-center text-[12px] text-slate-500">订单详情加载中…</AdminDataPanel>;
  if (query.isError) return <AdminDataPanel className="border-rose-200 bg-rose-50 p-4 text-[12px] text-rose-700">订单详情加载失败：{errorMessage(query.error)} <button type="button" className="ml-2 underline" onClick={() => void query.refetch()}>重试</button></AdminDataPanel>;
  const order = detail as any;
  if (!order) return null;
  const tabs: { key: DetailTab; label: string }[] = [{ key: "overview", label: "订单明细" }, { key: "payment", label: "付款登记" }, { key: "shipping", label: "发货登记" }, { key: "inbound", label: "入库关联" }, { key: "invoice", label: "供应商发票" }, { key: "history", label: "操作历史" }];
  return <AdminDataPanel className="procurement-order-detail overflow-hidden">
    <header className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 lg:flex-row lg:items-start lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h2 className="admin-section-title procurement-order-number text-[15px] font-semibold text-slate-900">{order.orderNo}</h2>{order.lifecycle === "cancelled" ? <span className="rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[12px] font-medium text-rose-700">已取消</span> : <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[12px] font-medium text-emerald-700">有效</span>}</div><p className="mt-1 text-[12px] text-slate-500">供应商：{order.supplierName} · 下单：{formatDate(order.createdAt, true)} · 版本 V{order.version}</p></div><div className="flex flex-wrap items-center gap-1.5"><StatusBadge type="payment" value={order.paymentStatus} /><StatusBadge type="shipping" value={order.shippingStatus} /><StatusBadge type="receipt" value={order.receiptStatus} /><StatusBadge type="invoice" value={order.invoiceStatus} /><SecondaryButton className="ml-1" onClick={onClose}>收起</SecondaryButton></div></header>
    <AdminPageTabs className="procurement-order-tabs px-3" ariaLabel="采购订单详情功能">{tabs.map(item => <button type="button" key={item.key} aria-current={tab === item.key ? "page" : undefined} onClick={() => setTab(item.key)} className={`procurement-order-tab min-h-10 shrink-0 border-b-2 px-3 py-2.5 font-medium ${tab === item.key ? "border-[#185FA5] text-[#185FA5]" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{item.label}</button>)}</AdminPageTabs>
    <div className="p-4">
      {order.lifecycle !== "cancelled" ? <div className="mb-3 flex justify-end"><CancelOrderButton order={order} onChanged={onChanged} /></div> : null}
      {tab === "overview" ? <OrderOverview order={order} items={detail.items ?? []} /> : null}
      {tab === "payment" ? <PaymentPanel order={order} onChanged={onChanged} /> : null}
      {tab === "shipping" ? <ShippingPanel order={order} items={detail.items ?? []} onChanged={onChanged} /> : null}
      {tab === "inbound" ? <InboundPanel order={order} items={detail.items ?? []} inbounds={detail.inbounds ?? []} onChanged={onChanged} /> : null}
      {tab === "invoice" ? <InvoicePanel order={order} invoices={detail.invoices ?? []} onChanged={onChanged} /> : null}
      {tab === "history" ? <HistoryPanel events={detail.events ?? []} /> : null}
    </div>
  </AdminDataPanel>;
}

function OrderOverview({ order, items }: { order: any; items: any[] }) {
  return <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Info label="订单金额" value={formatMoney(order.totalAmount)} /><Info label="供应商订单号" value={order.supplierOrderNo || "—"} /><Info label="预计交期" value={formatDate(order.expectedDeliveryDate)} /><Info label="备注" value={order.note || "—"} /></div><AdminDataPanel className="overflow-x-auto"><table className="admin-table-readable procurement-order-detail-table w-full min-w-[720px] text-[12px]"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2 text-left font-medium">型号</th><th className="px-3 py-2 text-left font-medium">品牌 / 封装</th><th className="px-3 py-2 text-right font-medium">采购数量</th><th className="px-3 py-2 text-right font-medium">含税单价</th><th className="px-3 py-2 text-right font-medium">累计发货</th><th className="px-3 py-2 text-right font-medium">累计入库</th></tr></thead><tbody>{items.map(item => <tr key={item.id} className="border-t border-slate-100"><td className="px-3 py-2.5 font-medium text-slate-800">{item.partNumber}</td><td className="px-3 py-2.5 text-slate-600"><span className="admin-cell-secondary procurement-order-cell-secondary">{[item.brand, item.pkg].filter(Boolean).join(" / ") || "—"}</span></td><td className="px-3 py-2.5 text-right">{item.qty} {item.qtyUnit}</td><td className="px-3 py-2.5 text-right">{formatMoney(item.unitPrice)}</td><td className="px-3 py-2.5 text-right">{item.shippedQty} / {item.qty}</td><td className="px-3 py-2.5 text-right">{item.receivedQty} / {item.qty}</td></tr>)}</tbody></table></AdminDataPanel></div>;
}

function Info({ label, value }: { label: string; value: string }) { return <div className="rounded border border-slate-200 p-2.5"><div className="text-[12px] text-slate-500">{label}</div><div className="admin-cell-primary mt-1 break-words font-medium text-slate-800">{value}</div></div>; }

function PaymentPanel({ order, onChanged }: { order: any; onChanged: () => Promise<void> }) {
  const [status, setStatus] = useState<PaymentStatus>(order.paymentStatus ?? "pending");
  const [note, setNote] = useState(order.paymentNote ?? "");
  const [error, setError] = useState("");
  const mutation = trpc.purchaseOrder.updatePayment.useMutation();
  const stableRequestId = useStableRequestId();
  useEffect(() => { setStatus(order.paymentStatus ?? "pending"); setNote(order.paymentNote ?? ""); }, [order.id, order.version]);
  const submit = async () => { setError(""); const payload = { id: order.id, version: order.version, status, note: note.trim() }; try { await mutation.mutateAsync({ ...payload, requestId: stableRequestId(payload) }); toast.success("付款进度已登记"); await onChanged(); } catch (cause) { setError(errorMessage(cause)); } };
  return <div className="max-w-2xl"><div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-[12px] leading-5 text-amber-800"><strong>付款进度（人工登记）</strong>：仅记录采购订单状态和备注，不发起任何真实付款或资金划转。</div><div className="grid gap-3 sm:grid-cols-2"><div><FieldLabel>付款状态</FieldLabel><Select value={status} onChange={event => setStatus(event.target.value as PaymentStatus)}><option value="pending">待付款</option><option value="partial">部分付款</option><option value="paid">已付清</option></Select></div><div><FieldLabel>当前状态</FieldLabel><div className="flex h-8 items-center"><StatusBadge type="payment" value={order.paymentStatus} /></div></div><div className="sm:col-span-2"><FieldLabel>登记备注</FieldLabel><Textarea value={note} maxLength={500} onChange={event => setNote(event.target.value)} placeholder="例如：已向供应商确认付款安排（选填）" /></div></div>{error ? <p role="alert" className="mt-3 text-[12px] text-rose-600">{error}</p> : null}<div className="mt-3"><PrimaryButton disabled={mutation.isPending || order.lifecycle === "cancelled"} onClick={() => void submit()}>{mutation.isPending ? "登记中…" : "保存付款进度"}</PrimaryButton></div></div>;
}

function ShippingPanel({ order, items, onChanged }: { order: any; items: any[]; onChanged: () => Promise<void> }) {
  const [lines, setLines] = useState(() => items.map(item => ({ itemId: item.id as number, shippedQty: String(item.shippedQty ?? 0) })));
  const [carrier, setCarrier] = useState(order.carrier ?? ""); const [trackingNo, setTrackingNo] = useState(order.trackingNo ?? ""); const [note, setNote] = useState(""); const [error, setError] = useState("");
  const mutation = trpc.purchaseOrder.updateShipping.useMutation();
  const stableRequestId = useStableRequestId();
  useEffect(() => {
    setLines(items.map(item => ({ itemId: item.id as number, shippedQty: String(item.shippedQty ?? 0) })));
    setCarrier(order.carrier ?? ""); setTrackingNo(order.trackingNo ?? ""); setNote("");
  }, [order.id, order.version]);
  const update = (itemId: number, value: string) => setLines(current => current.map(line => line.itemId === itemId ? { ...line, shippedQty: value } : line));
  const submit = async () => { setError(""); const linesPayload = lines.map(line => ({ itemId: line.itemId, shippedQty: Number(line.shippedQty) })); if (linesPayload.some((line, index) => !Number.isInteger(line.shippedQty) || line.shippedQty < 0 || line.shippedQty > Number(items[index]?.qty ?? 0))) return setError("累计发货数量应为不超过采购数量的非负整数"); const payload = { id: order.id, version: order.version, lines: linesPayload, carrier: carrier.trim(), trackingNo: trackingNo.trim(), note: note.trim() }; try { await mutation.mutateAsync({ ...payload, requestId: stableRequestId(payload) }); toast.success("发货进度已登记"); await onChanged(); } catch (cause) { setError(errorMessage(cause)); } };
  return <div><div className="mb-3 rounded-md border border-blue-100 bg-blue-50 p-2.5 text-[12px] leading-5 text-blue-800"><strong>累计发货登记</strong>：每行填写截至当前的累计已发货数量，不是本次增量。不会自动变更库存。</div><AdminDataPanel className="overflow-x-auto"><table className="admin-table-readable procurement-order-detail-table w-full min-w-[600px] text-[12px]"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2 text-left font-medium">型号</th><th className="px-3 py-2 text-right font-medium">采购数量</th><th className="px-3 py-2 text-right font-medium">现累计发货</th><th className="px-3 py-2 text-right font-medium">更新后累计发货</th></tr></thead><tbody>{items.map(item => <tr key={item.id} className="border-t border-slate-100"><td className="px-3 py-2.5 font-medium text-slate-800">{item.partNumber}</td><td className="px-3 py-2.5 text-right">{item.qty} {item.qtyUnit}</td><td className="px-3 py-2.5 text-right">{item.shippedQty ?? 0}</td><td className="w-48 px-3 py-1.5"><Input className="text-right tabular-nums" type="number" min="0" max={item.qty} step="1" value={lines.find(line => line.itemId === item.id)?.shippedQty ?? "0"} onChange={event => update(item.id, event.target.value)} /></td></tr>)}</tbody></table></AdminDataPanel><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><div><FieldLabel>承运商</FieldLabel><Input value={carrier} maxLength={100} onChange={event => setCarrier(event.target.value)} placeholder="选填" /></div><div><FieldLabel>运单号</FieldLabel><Input value={trackingNo} maxLength={128} onChange={event => setTrackingNo(event.target.value)} placeholder="选填" /></div><div className="sm:col-span-2 lg:col-span-1"><FieldLabel>登记备注</FieldLabel><Input value={note} maxLength={500} onChange={event => setNote(event.target.value)} placeholder="选填" /></div></div>{error ? <p role="alert" className="mt-3 text-[12px] text-rose-600">{error}</p> : null}<div className="mt-3"><PrimaryButton disabled={mutation.isPending || order.lifecycle === "cancelled"} onClick={() => void submit()}>{mutation.isPending ? "登记中…" : "保存发货进度"}</PrimaryButton></div></div>;
}

function InboundPanel({ order, items, inbounds, onChanged }: { order: any; items: any[]; inbounds: any[]; onChanged: () => Promise<void> }) {
  const [itemId, setItemId] = useState<number>(items[0]?.id ?? 0); const [keyword, setKeyword] = useState(""); const [error, setError] = useState("");
  const candidatesQuery = trpc.purchaseOrder.inboundCandidates.useQuery({ id: order.id, keyword: keyword.trim(), limit: 20 }, { enabled: Boolean(order.id), retry: 1 });
  const mutation = trpc.purchaseOrder.linkInbound.useMutation();
  const stableRequestId = useStableRequestId();
  const link = async (inboundOrderId: number) => { setError(""); if (!itemId) return setError("请选择要关联的采购物料"); const payload = { id: order.id, version: order.version, itemId, inboundOrderId }; try { await mutation.mutateAsync({ ...payload, requestId: stableRequestId(payload) }); toast.success("已关联入库单"); await onChanged(); } catch (cause) { setError(errorMessage(cause)); } };
  return <div className="space-y-5"><div><div className="mb-2 flex flex-wrap items-end justify-between gap-2"><div><h3 className="admin-section-title text-[15px] font-semibold text-slate-800">已关联入库单</h3><p className="mt-1 text-[12px] text-slate-500">关联用于追溯到货；不在此处自动入库或重复累计付款。</p></div></div><AdminDataPanel className="overflow-x-auto"><table className="admin-table-readable procurement-order-detail-table w-full min-w-[760px] text-[12px]"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2 text-left font-medium">入库单</th><th className="px-3 py-2 text-left font-medium">型号</th><th className="px-3 py-2 text-right font-medium">数量 / 实收</th><th className="px-3 py-2 text-left font-medium">状态</th><th className="px-3 py-2 text-left font-medium">付款流水预览</th></tr></thead><tbody>{inbounds.length === 0 ? <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">暂无关联入库单</td></tr> : inbounds.map(inbound => <tr key={inbound.id} className="border-t border-slate-100"><td className="px-3 py-2.5 font-medium text-slate-800">{inbound.slipNo || `#${inbound.inboundOrderId}`}</td><td className="px-3 py-2.5">{inbound.partNumber || "—"}</td><td className="px-3 py-2.5 text-right">{inbound.qty ?? "—"} / {inbound.actualQty ?? "—"}</td><td className="px-3 py-2.5 text-slate-600"><span className="admin-cell-secondary procurement-order-cell-secondary">{inbound.status || "—"}</span></td><td className="px-3 py-2.5 text-slate-500"><span className="admin-cell-secondary procurement-order-cell-secondary">原入库付款流水（只读，不重复累计）{inbound.paymentTrackedAt ? `：${formatDate(inbound.paymentTrackedAt)} ${formatMoney(inbound.paidAmount)}` : "：暂无"}</span></td></tr>)}</tbody></table></AdminDataPanel></div>
    <div className="border-t border-slate-200 pt-4"><h3 className="admin-section-title text-[15px] font-semibold text-slate-800">关联已有入库单</h3><p className="mt-1 text-[12px] text-slate-500">从候选入库单中选择，并明确关联到一条采购物料。</p><AdminFilterBar className="mt-3"><div className="grid w-full gap-2 sm:grid-cols-[minmax(180px,0.8fr)_minmax(220px,1.2fr)]"><Select value={itemId} onChange={event => setItemId(Number(event.target.value))}>{items.map(item => <option key={item.id} value={item.id}>{item.partNumber}（采购 {item.qty}{item.qtyUnit}）</option>)}</Select><Input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索入库单号或型号" /></div></AdminFilterBar><AdminDataPanel className="mt-2 overflow-x-auto"><table className="admin-table-readable procurement-order-detail-table w-full min-w-[650px] text-[12px]"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2 text-left font-medium">入库单</th><th className="px-3 py-2 text-left font-medium">型号</th><th className="px-3 py-2 text-right font-medium">数量 / 实收</th><th className="px-3 py-2 text-left font-medium">供应商</th><th className="px-3 py-2" /></tr></thead><tbody>{candidatesQuery.isLoading ? <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">加载候选入库单…</td></tr> : candidatesQuery.isError ? <tr><td colSpan={5} className="px-3 py-6 text-center text-rose-600">加载失败：{errorMessage(candidatesQuery.error)}</td></tr> : (candidatesQuery.data?.items ?? []).length === 0 ? <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">未找到可关联的入库单</td></tr> : (candidatesQuery.data?.items ?? []).map((candidate: any) => <tr key={candidate.id} className="border-t border-slate-100"><td className="px-3 py-2.5 font-medium">{candidate.slipNo}</td><td className="px-3 py-2.5">{candidate.partNumber}</td><td className="px-3 py-2.5 text-right">{candidate.qty} / {candidate.actualQty}</td><td className="px-3 py-2.5">{candidate.supplierName || "—"}</td><td className="px-3 py-2.5 text-right"><SecondaryButton className="admin-row-action procurement-order-row-action px-2" disabled={mutation.isPending || order.lifecycle === "cancelled"} onClick={() => void link(candidate.id)}>{mutation.isPending ? "关联中…" : "关联"}</SecondaryButton></td></tr>)}</tbody></table></AdminDataPanel>{error ? <p role="alert" className="mt-3 text-[12px] text-rose-600">{error}</p> : null}</div>
  </div>;
}

function InvoicePanel({ order, invoices, onChanged }: { order: any; invoices: any[]; onChanged: () => Promise<void> }) {
  const [invoiceNo, setInvoiceNo] = useState(""); const [kind, setKind] = useState<"special" | "normal" | "other">("special"); const [amount, setAmount] = useState(""); const [issuedDate, setIssuedDate] = useState(new Date().toISOString().slice(0, 10)); const [note, setNote] = useState(""); const [error, setError] = useState(""); const [voiding, setVoiding] = useState<any>(null); const [voidReason, setVoidReason] = useState("");
  const recordMutation = trpc.purchaseOrder.recordInvoice.useMutation(); const voidMutation = trpc.purchaseOrder.voidInvoice.useMutation();
  const stableRequestId = useStableRequestId();
  const submit = async () => { setError(""); if (!invoiceNo.trim() || !/^(?:0|[1-9]\d{0,14})(?:\.\d{1,2})?$/.test(amount.trim()) || Number(amount) <= 0 || !issuedDate) return setError("请填写发票号码、有效开票日期和大于 0 的金额（金额最多两位小数）"); const payload = { id: order.id, version: order.version, invoiceNo: invoiceNo.trim(), kind, amount: amount.trim(), issuedDate, note: note.trim() }; try { await recordMutation.mutateAsync({ ...payload, requestId: stableRequestId(payload) }); toast.success("供应商发票已登记"); await onChanged(); setInvoiceNo(""); setAmount(""); setNote(""); } catch (cause) { setError(errorMessage(cause)); } };
  const voidInvoice = async () => { setError(""); if (!voiding || voidReason.trim().length < 4) return setError("请填写至少4个字的作废原因"); if (!window.confirm(`确认作废发票 ${voiding.invoiceNo}？此操作会保留操作历史。`)) return; const payload = { id: order.id, invoiceId: voiding.id, version: order.version, reason: voidReason.trim() }; try { await voidMutation.mutateAsync({ ...payload, requestId: stableRequestId(payload) }); toast.success("发票已作废"); await onChanged(); setVoiding(null); setVoidReason(""); } catch (cause) { setError(errorMessage(cause)); } };
  return <div className="space-y-5"><div><div className="flex items-start justify-between gap-3"><div><h3 className="admin-section-title text-[15px] font-semibold text-slate-800">已登记发票</h3><p className="mt-1 text-[12px] text-slate-500">仅登记供应商发票元数据，不上传附件，也不代表自动开票。</p></div><StatusBadge type="invoice" value={order.invoiceStatus} /></div><AdminDataPanel className="mt-3 overflow-x-auto"><table className="admin-table-readable procurement-order-detail-table w-full min-w-[640px] text-[12px]"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2 text-left font-medium">发票号码</th><th className="px-3 py-2 text-left font-medium">类型</th><th className="px-3 py-2 text-right font-medium">金额</th><th className="px-3 py-2 text-left font-medium">开票日期</th><th className="px-3 py-2 text-left font-medium">状态</th><th className="px-3 py-2" /></tr></thead><tbody>{invoices.length === 0 ? <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">尚未登记供应商发票</td></tr> : invoices.map(invoice => <tr key={invoice.id} className="border-t border-slate-100"><td className="px-3 py-2.5 font-medium">{invoice.invoiceNo}</td><td className="px-3 py-2.5"><span className="admin-cell-secondary procurement-order-cell-secondary">{invoice.kind === "special" ? "专用发票" : invoice.kind === "normal" ? "普通发票" : "其他"}</span></td><td className="px-3 py-2.5 text-right">{formatMoney(invoice.amount)}</td><td className="whitespace-nowrap px-3 py-2.5"><span className="admin-cell-secondary procurement-order-cell-secondary">{formatDate(invoice.issuedDate)}</span></td><td className="px-3 py-2.5"><span className="admin-cell-secondary procurement-order-cell-secondary">{invoice.voidedAt ? <span className="text-rose-600">已作废</span> : <span className="text-emerald-700">有效</span>}</span></td><td className="px-3 py-2.5 text-right">{invoice.voidedAt ? null : <button type="button" className="admin-row-action procurement-order-row-action text-rose-600 hover:bg-rose-50" onClick={() => setVoiding(invoice)}>作废</button>}</td></tr>)}</tbody></table></AdminDataPanel></div><div className="border-t border-slate-200 pt-4"><h3 className="admin-section-title text-[15px] font-semibold text-slate-800">登记供应商发票</h3><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div><FieldLabel>发票号码 <span className="text-rose-600">*</span></FieldLabel><Input value={invoiceNo} maxLength={64} onChange={event => setInvoiceNo(event.target.value)} /></div><div><FieldLabel>发票类型</FieldLabel><Select value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="special">专用发票</option><option value="normal">普通发票</option><option value="other">其他</option></Select></div><div><FieldLabel>金额 <span className="text-rose-600">*</span></FieldLabel><Input className="text-right tabular-nums" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="最多两位小数" /></div><div><FieldLabel>开票日期 <span className="text-rose-600">*</span></FieldLabel><Input type="date" value={issuedDate} onChange={event => setIssuedDate(event.target.value)} /></div><div className="sm:col-span-2 lg:col-span-4"><FieldLabel>备注</FieldLabel><Input value={note} maxLength={500} onChange={event => setNote(event.target.value)} placeholder="选填" /></div></div>{voiding ? <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3"><div className="flex items-center justify-between gap-2"><span className="text-[12px] font-medium text-rose-800">作废发票：{voiding.invoiceNo}</span><button type="button" onClick={() => { setVoiding(null); setVoidReason(""); }} className="admin-row-action procurement-order-row-action text-slate-600">取消作废</button></div><div className="mt-2"><FieldLabel>作废原因 <span className="text-rose-600">*</span></FieldLabel><Textarea value={voidReason} maxLength={500} onChange={event => setVoidReason(event.target.value)} placeholder="至少4个字" /></div><PrimaryButton className="mt-2 bg-rose-600 hover:bg-rose-700" disabled={voidMutation.isPending} onClick={() => void voidInvoice()}>{voidMutation.isPending ? "作废中…" : "确认作废"}</PrimaryButton></div> : null}{error ? <p role="alert" className="mt-3 text-[12px] text-rose-600">{error}</p> : null}<div className="mt-3"><PrimaryButton disabled={recordMutation.isPending || order.lifecycle === "cancelled"} onClick={() => void submit()}>{recordMutation.isPending ? "登记中…" : "登记发票"}</PrimaryButton></div></div></div>;
}

function HistoryPanel({ events }: { events: any[] }) { return <div>{events.length === 0 ? <div className="py-8 text-center text-[12px] text-slate-500">暂无操作历史</div> : <ol className="relative ml-2 border-l border-slate-200 pl-5">{events.map(event => <li key={event.id ?? `${event.createdAt}-${event.action}`} className="relative pb-5 last:pb-0"><span className="absolute -left-[25px] top-0.5 size-2.5 rounded-full border-2 border-white bg-[#185FA5] shadow" /><div className="flex flex-wrap items-baseline justify-between gap-2"><strong className="text-[12px] text-slate-800">{event.action}</strong><time className="text-[12px] text-slate-500">{formatDate(event.createdAt, true)}</time></div>{event.details ? <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-slate-600">{typeof event.details === "string" ? event.details : JSON.stringify(event.details)}</p> : null}{event.actorUserId ? <p className="mt-1 text-[12px] text-slate-500">操作人 #{event.actorUserId}</p> : null}</li>)}</ol>}</div>;
}

function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-3" role="presentation">
    <section role="dialog" aria-modal="true" aria-label={title} className={`procurement-orders-dialog max-h-[calc(100vh-24px)] w-full overflow-hidden rounded-lg bg-white shadow-xl ${wide ? "max-w-4xl" : "max-w-lg"}`}>
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3"><h2 className="procurement-order-dialog-title text-lg font-semibold text-slate-900">{title}</h2><button type="button" onClick={onClose} className="admin-row-action procurement-order-row-action rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label="关闭"><X className="size-4" /></button></header>
      {children}
    </section>
  </div>;
}

function CancelOrderButton({ order, onChanged }: { order: any; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const mutation = trpc.purchaseOrder.cancel.useMutation();
  const stableRequestId = useStableRequestId();
  const submit = async () => {
    setError("");
    if (reason.trim().length < 4) return setError("请填写至少4个字的取消原因");
    if (!window.confirm(`确认取消采购订单 ${order.orderNo}？取消后将保留全部历史记录。`)) return;
    try {
      const payload = { id: order.id, version: order.version, reason: reason.trim() };
      await mutation.mutateAsync({ ...payload, requestId: stableRequestId(payload) });
      toast.success("采购订单已取消");
      await onChanged();
      setOpen(false);
      setReason("");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };
  return <>
    <button type="button" onClick={() => setOpen(true)} className="admin-row-action procurement-order-row-action ml-1 text-rose-600 hover:bg-rose-50">取消订单</button>
    {open ? <Dialog title="取消采购订单" onClose={() => !mutation.isPending && setOpen(false)}>
      <div className="procurement-order-dialog-body overflow-y-auto p-4"><p className="text-[12px] leading-5 text-slate-600">订单 <strong className="text-slate-800">{order.orderNo}</strong> 将被标记为已取消，付款、发货、入库及发票记录不会被删除。</p><div className="mt-3"><FieldLabel>取消原因 <span className="text-rose-600">*</span></FieldLabel><Textarea value={reason} maxLength={500} onChange={event => setReason(event.target.value)} placeholder="至少4个字" /></div>{error ? <p role="alert" className="mt-3 text-[12px] text-rose-600">{error}</p> : null}</div>
      <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3"><SecondaryButton disabled={mutation.isPending} onClick={() => setOpen(false)}>返回</SecondaryButton><PrimaryButton className="bg-rose-600 hover:bg-rose-700" disabled={mutation.isPending} onClick={() => void submit()}>{mutation.isPending ? "取消中…" : "确认取消订单"}</PrimaryButton></div>
    </Dialog> : null}
  </>;
}
