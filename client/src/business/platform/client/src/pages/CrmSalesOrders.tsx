import { usePageMemory, useRememberedState, freshListOptions, useRestoringListQuery, returnToPageSource } from "../hooks/usePageMemory";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { useLocation, useSearch } from "wouter";
import PlatformLayout from "../../../../BusinessContentFrame";
import { trpc } from "../../../../api/business-trpc";
import { ConfirmDialog } from "../components/customers/ConfirmDialog";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Textarea } from "../components/ui/textarea";
import {
  CRM_SALES_ORDER_STATUS_LABELS,
  CRM_SALES_PAYMENT_METHOD_LABELS,
  CRM_SALES_PAYMENT_STATUS_LABELS,
  CRM_SALES_SHIPMENT_STATUS_LABELS,
  formatSalesOrderAmount,
  canonicalSalesOrderCreatePayload,
  calculateSalesOrderAmounts,
  salesOrderCreateSchema,
  type CrmSalesPaymentMethod,
  type SalesOrderDemandCandidate,
} from "../../../shared/crmSalesOrders";

const PAGE_SIZE = 20;
const buttonClass = "h-8 bg-[#185FA5] px-3 text-xs text-white hover:bg-[#0C447C]";
const secondaryButtonClass = "h-8 border-slate-300 bg-white px-3 text-xs text-slate-700 shadow-none hover:bg-slate-50";
type StatusFilter = "all" | "confirmed" | "cancelled";
type DraftLine = { demandItemId: number; qty: string; agreedUnitPrice: string };

function newRequestId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now()}_${Math.random().toString(36).slice(2, 16)}`;
}
function beijingDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function statusDotClass(status: "confirmed" | "cancelled") {
  return status === "confirmed" ? "text-[#185FA5]" : "text-slate-400";
}
function paymentDotClass(status: string) {
  if (status === "paid") return "text-emerald-500";
  if (status === "partial" || status === "monthly") return "text-amber-500";
  return "text-slate-400";
}
function shipmentDotClass(status: string) {
  if (status === "shipped") return "text-emerald-500";
  if (status === "partial") return "text-amber-500";
  return "text-slate-400";
}
function todayLocal() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export default function CrmSalesOrders() {
  const d51Ready = usePageMemory();

  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const search = useSearch();
  const deepLinkedDemandNoRef = useRef("");
  const [draftKeyword, setDraftKeyword] = useRememberedState("draftKeyword", "");
  const [keyword, setKeyword] = useRememberedState("keyword", "");
  const [status, setStatus] = useRememberedState<StatusFilter>("status", "all");
  const [page, setPage] = useRememberedState("page", 1);
  const [selectedId, setSelectedId] = useRememberedState<number | null>("selectedId", null);
  const [entryOpen, setEntryOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [candidateKeyword, setCandidateKeyword] = useState("");
  const [candidateApplied, setCandidateApplied] = useState("");
  const [candidatePage, setCandidatePage] = useState(1);
  const [selectedDemand, setSelectedDemand] = useState<SalesOrderDemandCandidate | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [confirmationNote, setConfirmationNote] = useState("");
  const [customerConfirmed, setCustomerConfirmed] = useState(false);
  const requestIdRef = useRef(newRequestId());
  const requestKeysRef = useRef(new Map<string, string>());
  const savingRef = useRef(false);
  const cancellingRef = useRef(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState("");
  const [uncertainSave, setUncertainSave] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [shipOpen, setShipOpen] = useState(false);
  const [payMethod, setPayMethod] = useState<CrmSalesPaymentMethod>("bank");
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(todayLocal());
  const [payNote, setPayNote] = useState("");
  const [shipMethod, setShipMethod] = useState<"express" | "pickup">("express");
  const [expressCo, setExpressCo] = useState("");
  const [expressNo, setExpressNo] = useState("");
  const [shipNote, setShipNote] = useState("");
  const [shipQtys, setShipQtys] = useState<Record<string, string>>({});
  const payRequestIdRef = useRef(newRequestId());
  const shipRequestIdRef = useRef(newRequestId());
  const formTouched = Boolean(selectedDemand || lines.some(line => line.qty || line.agreedUnitPrice) || dueDate || confirmationNote || customerConfirmed);

  const listInput = useMemo(() => ({
    keyword, ...(status === "all" ? {} : { status }), page, pageSize: PAGE_SIZE,
  }), [keyword, page, status]);
  const listQuery = useRestoringListQuery(trpc.crmSalesOrder.list.useQuery(listInput, freshListOptions({}, d51Ready)));
  const detailQuery = trpc.crmSalesOrder.get.useQuery({ id: selectedId ?? 1 }, { enabled: selectedId != null });
  const candidatesQuery = trpc.crmSalesOrder.candidates.useQuery({ keyword: candidateApplied, page: candidatePage, pageSize: 10 }, { enabled: entryOpen });
  const totalPages = Math.max(1, Math.ceil((listQuery.data?.total ?? 0) / PAGE_SIZE));
  const candidatePages = Math.max(1, Math.ceil((candidatesQuery.data?.total ?? 0) / 10));

  const resetEntry = () => {
    deepLinkedDemandNoRef.current = "";
    setSelectedDemand(null);
    setLines([]);
    setDueDate("");
    setConfirmationNote("");
    setCustomerConfirmed(false);
    setCandidateKeyword("");
    setCandidateApplied("");
    setCandidatePage(1);
    requestIdRef.current = newRequestId();
    requestKeysRef.current.clear();
    setUncertainSave(false);
  };
  const closeEntry = () => {
    setEntryOpen(false);
    setDiscardOpen(false);
    resetEntry();
  };
  const requestCloseEntry = () => {
    if (savingRef.current) return;
    if (formTouched) setDiscardOpen(true);
    else closeEntry();
  };
  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (!entryOpen || !formTouched) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [entryOpen, formTouched]);
  useEffect(() => {
    if (listQuery.data && page > totalPages) setPage(totalPages);
  }, [listQuery.data, page, totalPages]);
  useEffect(() => {
    if (candidatesQuery.data && candidatePage > candidatePages) setCandidatePage(candidatePages);
  }, [candidatePage, candidatePages, candidatesQuery.data]);
  useEffect(() => {
    const params = new URLSearchParams(search);
    const demandNo = params.get("demandNo")?.trim() ?? "";
    const orderKeyword = params.get("keyword")?.trim() ?? "";
    if (demandNo) {
      deepLinkedDemandNoRef.current = demandNo;
      setEntryOpen(true);
      setCandidateKeyword(demandNo);
      setCandidateApplied(demandNo);
      setCandidatePage(1);
      params.delete("demandNo");
      navigate(`/sales-orders${params.size ? `?${params}` : ""}`, { replace: true });
      return;
    }
    if (orderKeyword) {
      setDraftKeyword(orderKeyword);
      setKeyword(orderKeyword);
      setPage(1);
      params.delete("keyword");
      navigate(`/sales-orders${params.size ? `?${params}` : ""}`, { replace: true });
    }
  }, [navigate, search]);

  const createMutation = trpc.crmSalesOrder.create.useMutation({
    onSuccess: result => {
      setSelectedId(result.id);
      closeEntry();
      toast.success(result.replayed ? "已返回此前保存的销售订单" : "销售订单已录入", { description: result.orderNumber });
      void Promise.allSettled([utils.crmSalesOrder.list.invalidate(), utils.crmSalesOrder.candidates.invalidate()]);
    },
    onError: error => {
      const knownRejection = ["BAD_REQUEST", "FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND", "CONFLICT"].includes(error.data?.code ?? "");
      setUncertainSave(!knownRejection);
      toast.error(error.message || "订单保存结果尚未确认，请重试原请求");
      void utils.crmSalesOrder.list.invalidate().catch(() => undefined);
    },
    onSettled: () => { savingRef.current = false; },
  });
  const cancelMutation = trpc.crmSalesOrder.cancel.useMutation({
    onSuccess: () => {
      setCancelOpen(false);
      setCancelReason("");
      setCancelError("");
      toast.success("订单已取消", { description: "未触发库存、支付或发运操作" });
      void Promise.allSettled([utils.crmSalesOrder.list.invalidate(), utils.crmSalesOrder.get.invalidate(), utils.crmSalesOrder.candidates.invalidate()]);
    },
    onError: error => {
      setCancelError(error.message || "取消失败，请刷新后重试");
      void utils.crmSalesOrder.get.invalidate().catch(() => undefined);
    },
    onSettled: () => { cancellingRef.current = false; },
  });
  const paymentMutation = trpc.crmSalesOrder.recordPayment.useMutation({
    onSuccess: result => {
      setPayOpen(false);
      setPayAmount("");
      setPayNote("");
      payRequestIdRef.current = newRequestId();
      toast.success(result.replayed ? "已返回此前登记的收款" : "收款已登记");
      void Promise.allSettled([utils.crmSalesOrder.list.invalidate(), utils.crmSalesOrder.get.invalidate()]);
    },
    onError: error => toast.error(error.message || "收款登记失败"),
  });
  const shipMutation = trpc.crmSalesOrder.ship.useMutation({
    onSuccess: result => {
      setShipOpen(false);
      setShipQtys({});
      setExpressCo("");
      setExpressNo("");
      setShipNote("");
      shipRequestIdRef.current = newRequestId();
      toast.success(result.replayed ? "已返回此前出货记录" : "出货已登记并扣减库存");
      void Promise.allSettled([utils.crmSalesOrder.list.invalidate(), utils.crmSalesOrder.get.invalidate()]);
    },
    onError: error => toast.error(error.message || "出货失败"),
  });

  const applyFilters = () => {
    setKeyword(draftKeyword.trim());
    setPage(1);
  };
  const selectDemand = (demand: SalesOrderDemandCandidate) => {
    setSelectedDemand(demand);
    setLines(demand.items.filter(item => item.remainingQty > 0).map(item => ({ demandItemId: item.id, qty: "", agreedUnitPrice: "" })));
  };
  useEffect(() => {
    const demandNo = deepLinkedDemandNoRef.current;
    if (!entryOpen || !demandNo || candidateApplied !== demandNo || candidatesQuery.isFetching || !candidatesQuery.data) return;
    const candidate = candidatesQuery.data.items.find(item => item.demandNo === demandNo);
    deepLinkedDemandNoRef.current = "";
    if (!candidate) {
      toast.error("该需求当前不可生成销售订单，请确认已采用最新采购报价");
      return;
    }
    selectDemand(candidate);
  }, [candidateApplied, candidatesQuery.data, candidatesQuery.isFetching, entryOpen]);
  const updateLine = (id: number, field: "qty" | "agreedUnitPrice", value: string) => {
    setLines(current => current.map(line => line.demandItemId === id ? { ...line, [field]: value } : line));
  };
  const selectedLines = selectedDemand?.items.map(item => ({ item, draft: lines.find(line => line.demandItemId === item.id) })) ?? [];
  const amountPreview = useMemo(() => {
    try {
      const items = lines.filter(line => line.qty || line.agreedUnitPrice).map(line => ({ qty: Number(line.qty), agreedUnitPrice: line.agreedUnitPrice }));
      if (!items.length) return "—";
      return formatSalesOrderAmount(calculateSalesOrderAmounts(items).totalAmount);
    } catch { return "请完善数量与单价"; }
  }, [lines]);
  const submitOrder = () => {
    if (savingRef.current) return;
    if (!selectedDemand) { toast.error("请选择客户需求"); return; }
    const items = lines.filter(line => line.qty.trim() || line.agreedUnitPrice.trim()).map(line => ({
      demandItemId: line.demandItemId,
      qty: Number(line.qty),
      agreedUnitPrice: line.agreedUnitPrice.trim(),
    }));
    if (!items.length) { toast.error("请至少确认一行物料数量与单价"); return; }
    if (!customerConfirmed) { toast.error("请确认已与客户确认订单"); return; }
    if (!confirmationNote.trim()) { toast.error("请填写客户确认说明"); return; }
    const parsed = salesOrderCreateSchema.safeParse({
      demandId: selectedDemand.id, demandRevision: selectedDemand.demandRevision ?? 1, requestId: requestIdRef.current, items,
      dueDate: dueDate || null, confirmationNote: confirmationNote.trim(), customerConfirmed,
    });
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? "请检查订单内容"); return; }
    if (items.some(item => item.qty > (selectedDemand.items.find(source => source.id === item.demandItemId)?.remainingQty ?? 0))) {
      toast.error("确认数量超过可用需求数量，请检查后重试"); return;
    }
    const fingerprint = JSON.stringify(canonicalSalesOrderCreatePayload(parsed.data));
    if (!requestKeysRef.current.has(fingerprint)) requestKeysRef.current.set(fingerprint, newRequestId());
    savingRef.current = true;
    createMutation.mutate({ ...parsed.data, requestId: requestKeysRef.current.get(fingerprint)! });
  };
  const cancelOrder = () => {
    setCancelReason("");
    setCancelError("");
    setCancelOpen(true);
  };
  const confirmCancel = () => {
    const detail = detailQuery.data;
    if (!detail || cancellingRef.current) return;
    if (detail.status !== "confirmed") { setCancelError("订单状态已变化，请关闭后查看最新详情"); return; }
    if (!cancelReason.trim()) { setCancelError("请填写取消原因"); return; }
    cancellingRef.current = true;
    cancelMutation.mutate({ id: detail.id, version: detail.version, reason: cancelReason.trim() });
  };

  return (
    <PlatformLayout>
      <div className="space-y-3">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold">销售订单</h1>
            <p className="mt-1 text-xs text-muted-foreground">客户需求形成的内部订单，不含网站自主下单。</p>
          </div>
          <Button type="button" className={buttonClass} onClick={() => setEntryOpen(true)}><Plus className="mr-1 h-3.5 w-3.5" />录入销售订单</Button>
        </div>

        <Card className="border-slate-200 bg-white p-2 shadow-none">
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="搜索销售订单" className="h-8 w-[220px] bg-white text-xs" placeholder="订单号、需求号、项目、客户、型号" value={draftKeyword} onChange={event => setDraftKeyword(event.target.value)} onKeyDown={event => { if (event.key === "Enter") applyFilters(); }} />
            <Select value={status} onValueChange={value => { setStatus(value as StatusFilter); setPage(1); }}>
              <SelectTrigger className="h-8 w-[112px] bg-white text-xs"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="confirmed">待交付</SelectItem><SelectItem value="cancelled">已取消</SelectItem></SelectContent>
            </Select>
            <Button type="button" variant="outline" className={secondaryButtonClass} onClick={applyFilters}><Search className="mr-1 h-3.5 w-3.5" />筛选</Button>
            {(keyword || status !== "all" || draftKeyword) ? <Button type="button" variant="outline" className={secondaryButtonClass} onClick={() => { setDraftKeyword(""); setKeyword(""); setStatus("all"); setPage(1); }}>重置</Button> : null}
          </div>
        </Card>

        <Card className="gap-0 overflow-hidden border-slate-200 p-0 shadow-none">
          {listQuery.isLoading ? (
            <div className="flex justify-center p-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : listQuery.isError ? (
            <div className="p-14 text-center text-xs text-red-600">{listQuery.error.message} <Button className="ml-2 h-7 text-xs" variant="outline" onClick={() => listQuery.refetch()}>重试</Button></div>
          ) : !(listQuery.data?.items.length) ? (
            <div className="p-14 text-center">
              <p className="text-sm font-medium">暂无匹配的内部销售订单</p>
              <p className="mt-1.5 text-xs text-muted-foreground">可调整筛选，或录入新的销售订单。</p>
            </div>
          ) : (
            <div className="min-w-0">
              <Table className="w-full table-fixed" containerClassName="overflow-hidden">
                <colgroup>
                  <col className="w-[14%]" /><col className="w-[18%]" /><col className="w-[8%]" /><col className="w-[10%]" />
                  <col className="w-[9%]" /><col className="w-[10%]" /><col className="w-[9%]" /><col className="w-[8%]" /><col className="w-[14%]" />
                </colgroup>
                <TableHeader>
                  <TableRow className="bg-slate-50 hover:bg-slate-50">
                    <TableHead className="h-8 px-2 text-[11px] text-slate-500">订单号</TableHead>
                    <TableHead className="h-8 px-2 text-[11px] text-slate-500">客户 / 需求</TableHead>
                    <TableHead className="h-8 px-2 text-[11px] text-slate-500">项目</TableHead>
                    <TableHead className="h-8 px-2 text-[11px] text-slate-500">金额（含税）</TableHead>
                    <TableHead className="h-8 px-2 text-[11px] text-slate-500">状态</TableHead>
                    <TableHead className="h-8 px-2 text-[11px] text-slate-500">收款</TableHead>
                    <TableHead className="h-8 px-2 text-[11px] text-slate-500">出货</TableHead>
                    <TableHead className="h-8 px-2 text-[11px] text-slate-500">录入时间</TableHead>
                    <TableHead className="h-8 whitespace-nowrap px-2 text-right text-[11px] text-slate-500">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listQuery.data.items.map(order => (
                    <TableRow key={order.id} className="h-14" data-page-memory-row={String(order.id)}>
                      <TableCell className="min-w-0 px-2 py-1.5">
                        <button type="button" className="block w-full truncate text-left text-[12px] font-medium text-[#185FA5] hover:underline" title={order.orderNumber} onClick={() => setSelectedId(order.id)}>{order.orderNumber}</button>
                      </TableCell>
                      <TableCell className="min-w-0 px-2 py-1.5 whitespace-normal">
                        <div className="truncate text-[12px] text-slate-700" title={order.customerName}>{order.customerName || "—"}</div>
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={order.demandNo}>{order.demandNo}</div>
                      </TableCell>
                      <TableCell className="min-w-0 truncate px-2 py-1.5 text-[12px] text-slate-600" title={order.projectName || "—"}>{order.projectName || "—"}</TableCell>
                      <TableCell className="px-2 py-1.5 text-[12px] tabular-nums text-slate-700">{formatSalesOrderAmount(order.totalAmount)}</TableCell>
                      <TableCell className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-slate-600">
                          <span className={`text-[10px] ${statusDotClass(order.status)}`} aria-hidden="true">●</span>
                          <span className="font-medium text-slate-700">{CRM_SALES_ORDER_STATUS_LABELS[order.status]}</span>
                        </div>
                      </TableCell>
                      <TableCell className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-slate-600">
                          <span className={`text-[10px] ${paymentDotClass(order.paymentStatus)}`} aria-hidden="true">●</span>
                          <span className="font-medium text-slate-700">{CRM_SALES_PAYMENT_STATUS_LABELS[order.paymentStatus]}</span>
                        </div>
                      </TableCell>
                      <TableCell className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-slate-600">
                          <span className={`text-[10px] ${shipmentDotClass(order.shipmentStatus)}`} aria-hidden="true">●</span>
                          <span className="font-medium text-slate-700">{CRM_SALES_SHIPMENT_STATUS_LABELS[order.shipmentStatus]}</span>
                        </div>
                      </TableCell>
                      <TableCell className="truncate px-2 py-1.5 text-[12px] tabular-nums text-muted-foreground">{beijingDate(order.createdAt)}</TableCell>
                      <TableCell className="px-2 py-1.5 text-right">
                        <div className="inline-flex items-center whitespace-nowrap divide-x divide-slate-200">
                          <Button type="button" variant="ghost" size="sm" className="h-7 rounded-none px-2 text-[11px] text-[#185FA5] hover:bg-[#185FA5]/5 hover:text-[#0C447C]" onClick={() => setSelectedId(order.id)}>查看</Button>
                          {order.status === "confirmed" ? (
                            <>
                              <Button type="button" variant="ghost" size="sm" className="h-7 rounded-none px-2 text-[11px] text-[#185FA5] hover:bg-[#185FA5]/5 hover:text-[#0C447C]" onClick={() => { setSelectedId(order.id); setPayAmount(""); setPayDate(todayLocal()); setPayNote(""); setPayMethod("bank"); setPayOpen(true); }}>收款</Button>
                              <Button type="button" variant="ghost" size="sm" className="h-7 rounded-none px-2 text-[11px] text-[#185FA5] hover:bg-[#185FA5]/5 hover:text-[#0C447C]" onClick={() => { setSelectedId(order.id); setShipQtys({}); setExpressCo(""); setExpressNo(""); setShipNote(""); setShipMethod("express"); setShipOpen(true); }}>出货</Button>
                            </>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
        {listQuery.data?.items.length ? (
          <div className="mb-8 mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>共 {listQuery.data.total} 条</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-7 bg-white text-xs" disabled={page <= 1 || listQuery.isFetching} onClick={() => setPage(current => current - 1)}>上一页</Button>
              <span className="min-w-[64px] text-center">第 {page} / {totalPages} 页</span>
              <Button size="sm" variant="outline" className="h-7 bg-white text-xs" disabled={page >= totalPages || listQuery.isFetching} onClick={() => setPage(current => current + 1)}>下一页</Button>
            </div>
          </div>
        ) : null}
      </div>

      <Dialog open={entryOpen} onOpenChange={open => open ? setEntryOpen(true) : requestCloseEntry()}>
        <DialogContent className="grid-cols-[minmax(0,1fr)] w-[calc(100vw-32px)] max-h-[92vh] max-w-[1100px] overflow-x-hidden overflow-y-auto p-4 sm:max-w-[1100px]" showCloseButton={!createMutation.isPending}>
          <DialogHeader><DialogTitle className="text-base text-slate-800">录入销售订单</DialogTitle><p className="text-xs text-slate-500">仅显示已采用采购报价的物料。</p></DialogHeader>
          {uncertainSave && <p role="alert" className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">上次保存结果尚未确认，请点击“确认保存结果”重试原请求。确认前暂不允许修改，关闭不会撤销可能已创建的订单。</p>}
          {!selectedDemand ? <div className="space-y-2"><div className="flex gap-2"><Input className="h-8 text-xs" value={candidateKeyword} placeholder="搜索需求号、项目或型号" onChange={event => setCandidateKeyword(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { setCandidateApplied(candidateKeyword.trim()); setCandidatePage(1); } }} /><Button type="button" className={secondaryButtonClass} variant="outline" onClick={() => { setCandidateApplied(candidateKeyword.trim()); setCandidatePage(1); }}>搜索</Button></div><div className="max-h-[380px] overflow-auto rounded border border-slate-200"><Table><TableHeader className="bg-slate-50"><TableRow><TableHead className="h-8 text-xs">客户</TableHead><TableHead className="h-8 text-xs">需求 / 项目</TableHead><TableHead className="h-8 text-xs">可下单物料</TableHead><TableHead className="h-8 text-right text-xs">操作</TableHead></TableRow></TableHeader><TableBody>{candidatesQuery.isLoading ? <TableRow><TableCell colSpan={4} className="h-20 text-center text-xs"><Loader2 className="inline h-4 w-4 animate-spin" /></TableCell></TableRow> : null}{candidatesQuery.isError ? <TableRow><TableCell colSpan={4} className="h-20 text-center text-xs text-red-600">{candidatesQuery.error.message}</TableCell></TableRow> : null}{!candidatesQuery.isLoading && !candidatesQuery.isError && !(candidatesQuery.data?.items.length) ? <TableRow><TableCell colSpan={4} className="h-20 text-center text-xs text-slate-500">暂无已采用报价且可录入的需求</TableCell></TableRow> : null}{candidatesQuery.data?.items.map(demand => <TableRow key={demand.id} data-page-memory-row={String(demand.id)}><TableCell className="py-2 text-xs">{demand.customerName}</TableCell><TableCell className="py-2 text-xs"><div>{demand.demandNo}</div><div className="text-slate-500">{demand.projectName || "未填写项目"}</div></TableCell><TableCell className="py-2 text-xs">{demand.items.filter(item => item.remainingQty > 0).length} 行可下单</TableCell><TableCell className="py-2 text-right"><Button type="button" className="h-7 text-xs" variant="outline" disabled={!demand.items.some(item => item.remainingQty > 0)} onClick={() => selectDemand(demand)}>选择</Button></TableCell></TableRow>)}</TableBody></Table></div><div className="flex items-center justify-end gap-2 text-xs text-slate-500"><span>{candidatePage} / {candidatePages}</span><Button type="button" variant="outline" className="h-7 px-2 text-xs" disabled={candidatePage <= 1} onClick={() => setCandidatePage(current => current - 1)}>上一页</Button><Button type="button" variant="outline" className="h-7 px-2 text-xs" disabled={candidatePage >= candidatePages} onClick={() => setCandidatePage(current => current + 1)}>下一页</Button></div></div> : <div className="min-w-0 space-y-3"><div className="flex items-start justify-between rounded border border-blue-100 bg-blue-50 p-2 text-xs"><div><strong className="text-[#185FA5]">{selectedDemand.customerName}</strong><span className="mx-2 text-slate-400">|</span>{selectedDemand.demandNo}<span className="mx-2 text-slate-400">|</span>{selectedDemand.projectName || "未填写项目"}</div><Button type="button" className="h-7 px-2 text-xs" variant="outline" disabled={createMutation.isPending || uncertainSave} onClick={() => { setSelectedDemand(null); setLines([]); }}>重新选择</Button></div><div className="min-w-0 max-w-full overflow-auto rounded border border-slate-200"><Table><TableHeader className="bg-slate-50"><TableRow><TableHead className="h-8 text-xs">型号 / 品牌 / 封装</TableHead><TableHead className="h-8 text-xs">需求 / 可下单</TableHead><TableHead className="h-8 w-[120px] text-xs">确认数量</TableHead><TableHead className="h-8 w-[150px] text-xs">含税单价（元）</TableHead></TableRow></TableHeader><TableBody>{selectedLines.map(({ item, draft }) => <TableRow key={item.id} className={item.remainingQty <= 0 ? "bg-slate-50 text-slate-400" : ""} data-page-memory-row={String(item.id)}><TableCell className="py-2 text-xs"><div>{item.partNumber || "未填写型号"}</div><div className="text-slate-500">{[item.brand, item.pkg].filter(Boolean).join(" / ") || "—"}</div></TableCell><TableCell className="py-2 text-xs">{item.demandQty} {item.qtyUnit} / <span className="font-medium">{item.remainingQty} {item.qtyUnit}</span></TableCell><TableCell className="py-2"><Input disabled={!draft || item.remainingQty <= 0 || createMutation.isPending || uncertainSave} className="h-8 text-xs" type="number" min={1} step={1} max={item.remainingQty} aria-label={`${item.partNumber} 确认数量`} inputMode="numeric" value={draft?.qty ?? ""} placeholder="不录入" onChange={event => updateLine(item.id, "qty", event.target.value)} onBlur={() => { const current = Number(draft?.qty); if (current > item.remainingQty) { updateLine(item.id, "qty", String(item.remainingQty)); toast.info(`确认数量已调整为最大可用数量 ${item.remainingQty}`); } }} /></TableCell><TableCell className="py-2"><Input disabled={!draft || item.remainingQty <= 0 || createMutation.isPending || uncertainSave} className="h-8 text-xs" aria-label={`${item.partNumber} 含税单价`} inputMode="decimal" value={draft?.agreedUnitPrice ?? ""} placeholder="0.0000" onChange={event => updateLine(item.id, "agreedUnitPrice", event.target.value)} /></TableCell></TableRow>)}</TableBody></Table></div><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><Label htmlFor="sales-order-due-date" className="text-xs">约定交付日期（可选）</Label><Input id="sales-order-due-date" disabled={createMutation.isPending || uncertainSave} type="date" className="h-8 text-xs" value={dueDate} max="9999-12-31" onChange={event => setDueDate(event.target.value)} /></div><div className="space-y-1"><Label htmlFor="sales-order-confirmation" className="text-xs">客户确认说明 <span className="text-red-600">*</span></Label><Textarea id="sales-order-confirmation" disabled={createMutation.isPending || uncertainSave} className="min-h-16 text-xs" maxLength={500} value={confirmationNote} placeholder="例如：2026-09-23 电话确认型号、数量及含税单价" onChange={event => setConfirmationNote(event.target.value)} /></div></div><div className="text-right text-sm font-medium text-slate-800">金额（人民币含税）：{amountPreview}</div><label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700"><Checkbox disabled={createMutation.isPending || uncertainSave} checked={customerConfirmed} onCheckedChange={checked => setCustomerConfirmed(checked === true)} /><span>我确认已与客户确认以上数量和含税价格 <span className="text-red-600">*</span></span></label></div>}
          <DialogFooter><Button type="button" variant="outline" className={secondaryButtonClass} disabled={createMutation.isPending} onClick={requestCloseEntry}>取消</Button>{selectedDemand ? <Button type="button" className={buttonClass} disabled={createMutation.isPending} onClick={submitOrder}>{createMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}{uncertainSave ? "确认保存结果" : "保存订单"}</Button> : null}</DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}><DialogContent className="max-w-sm p-4 sm:max-w-sm"><DialogHeader><DialogTitle className="text-base">放弃本次录入？</DialogTitle><p className="text-xs text-slate-500">{uncertainSave ? "上次保存结果尚未确认，关闭不会撤销已创建订单；请先查看订单列表，避免再次录入。" : "已填写内容尚未保存。"}</p></DialogHeader><DialogFooter><Button type="button" variant="outline" className={secondaryButtonClass} onClick={() => setDiscardOpen(false)}>继续编辑</Button><Button type="button" className={buttonClass} onClick={closeEntry}>放弃录入</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={selectedId != null && !payOpen && !shipOpen && !cancelOpen} onOpenChange={open => { if (!open && !cancellingRef.current && !cancelOpen && !payOpen && !shipOpen) setSelectedId(null); }}><DialogContent className="grid-cols-[minmax(0,1fr)] w-[calc(100vw-32px)] max-h-[90vh] max-w-[1100px] overflow-x-hidden overflow-y-auto p-4 sm:max-w-[1100px]"><DialogHeader><DialogTitle className="text-base">销售订单详情</DialogTitle></DialogHeader>{detailQuery.isLoading ? <div className="py-12 text-center text-xs text-slate-500"><Loader2 className="inline h-4 w-4 animate-spin" /> 加载中</div> : null}{detailQuery.isError ? <div className="py-8 text-center text-xs text-red-600">{detailQuery.error.message}</div> : null}{detailQuery.data ? <div className="space-y-3 text-xs"><div className="grid gap-2 rounded bg-slate-50 p-2 sm:grid-cols-3"><div><span className="text-slate-500">订单号：</span>{detailQuery.data.orderNumber}</div><div><span className="text-slate-500">客户：</span>{detailQuery.data.customerName}</div><div><span className="text-slate-500">来源需求：</span>{detailQuery.data.demandNo}</div><div><span className="text-slate-500">状态：</span><span className="inline-flex items-center gap-1.5 text-[12px] text-slate-700"><span className={`text-[10px] ${statusDotClass(detailQuery.data.status)}`} aria-hidden="true">●</span>{CRM_SALES_ORDER_STATUS_LABELS[detailQuery.data.status]}</span></div><div><span className="text-slate-500">总额：</span>{formatSalesOrderAmount(detailQuery.data.totalAmount)}（人民币含税）</div><div><span className="text-slate-500">交付日期：</span>{detailQuery.data.dueDate || "—"}</div></div><div><div className="mb-1 font-medium text-slate-700">客户确认说明</div><div className="rounded border border-slate-200 p-2 text-slate-600">{detailQuery.data.confirmationNote}</div></div><div className="min-w-0 max-w-full overflow-auto rounded border border-slate-200"><Table><TableHeader className="bg-slate-50"><TableRow><TableHead className="h-8 text-xs">型号</TableHead><TableHead className="h-8 text-xs">数量</TableHead><TableHead className="h-8 text-xs">含税单价</TableHead><TableHead className="h-8 text-xs">金额</TableHead></TableRow></TableHeader><TableBody>{detailQuery.data.items.map(item => <TableRow key={item.id} data-page-memory-row={String(item.id)}><TableCell className="py-2 text-xs"><div>{item.partNumber}</div><div className="text-slate-500">{[item.brand, item.pkg].filter(Boolean).join(" / ")}</div></TableCell><TableCell className="py-2">{item.orderedQty} {item.qtyUnit}</TableCell><TableCell className="py-2">{formatSalesOrderAmount(item.unitPrice)}</TableCell><TableCell className="py-2">{formatSalesOrderAmount(item.lineAmount)}</TableCell></TableRow>)}</TableBody></Table></div>{detailQuery.data.status === "cancelled" ? <div className="rounded border border-slate-200 bg-slate-50 p-2"><strong>取消原因：</strong>{detailQuery.data.cancelledReason}</div> : null}<div className="grid gap-2 sm:grid-cols-2"><div className="rounded border border-slate-200 p-2"><div className="mb-1 font-medium text-slate-700">收款</div><div className="text-slate-600">{CRM_SALES_PAYMENT_STATUS_LABELS[detailQuery.data.paymentStatus]} · 已收 {formatSalesOrderAmount(detailQuery.data.paidAmount)}{Number(detailQuery.data.monthlyAmount) > 0 ? ` · 月结 ${formatSalesOrderAmount(detailQuery.data.monthlyAmount)}` : ""}</div>{detailQuery.data.payments.map(payment => <div key={payment.id} className="mt-1 text-[11px] text-slate-500">{payment.paymentDate} {CRM_SALES_PAYMENT_METHOD_LABELS[payment.method]} {formatSalesOrderAmount(payment.amount)}{payment.note ? ` · ${payment.note}` : ""}</div>)}</div><div className="rounded border border-slate-200 p-2"><div className="mb-1 font-medium text-slate-700">出货</div><div className="text-slate-600">{CRM_SALES_SHIPMENT_STATUS_LABELS[detailQuery.data.shipmentStatus]} · {detailQuery.data.shippedQty}/{detailQuery.data.orderedQty}</div>{detailQuery.data.shipments.map(shipment => <div key={shipment.id} className="mt-1 text-[11px] text-slate-500">{beijingDate(shipment.createdAt)} {shipment.deliveryMethod === "pickup" ? "自提" : `${shipment.expressCo} ${shipment.expressNo}`} · {shipment.items.map(item => `${item.partNumber}×${item.qty}`).join("，")}</div>)}</div></div></div> : null}<DialogFooter>{detailQuery.data?.status === "confirmed" ? <><Button type="button" variant="outline" className={secondaryButtonClass} onClick={() => { setPayAmount(""); setPayDate(todayLocal()); setPayNote(""); setPayMethod("bank"); setPayOpen(true); }}>登记收款</Button><Button type="button" variant="outline" className={secondaryButtonClass} onClick={() => { setShipQtys({}); setExpressCo(""); setExpressNo(""); setShipNote(""); setShipMethod("express"); setShipOpen(true); }}>出货</Button><Button type="button" variant="outline" className="h-8 border-red-200 bg-white px-3 text-xs text-red-700 hover:bg-red-50" disabled={cancelMutation.isPending || Number(detailQuery.data.paidAmount) > 0 || Number(detailQuery.data.monthlyAmount) > 0 || detailQuery.data.shippedQty > 0} onClick={cancelOrder}>{cancelMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <X className="mr-1 h-3.5 w-3.5" />}取消订单</Button></> : null}<Button type="button" className={buttonClass} disabled={cancelMutation.isPending} onClick={() => setSelectedId(null)}>关闭</Button></DialogFooter></DialogContent></Dialog>
      {cancelOpen && detailQuery.data && <ConfirmDialog title="确认取消销售订单？" description={`订单 ${detailQuery.data.orderNumber}；已收款或已出货的订单不能取消。`} confirmLabel="确认取消订单" danger busy={cancelMutation.isPending} error={cancelError} onCancel={() => { if (!cancellingRef.current) setCancelOpen(false); }} onConfirm={confirmCancel}><label className="block text-xs text-slate-600">取消原因<textarea className="crm-input mt-1 min-h-20 w-full" maxLength={500} disabled={cancelMutation.isPending} value={cancelReason} onChange={event => setCancelReason(event.target.value)} /></label></ConfirmDialog>}
      {payOpen ? createPortal(<div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" onClick={() => { if (!paymentMutation.isPending) setPayOpen(false); }}>
        <div className="max-h-[90vh] w-[480px] max-w-full overflow-y-auto rounded-xl bg-white p-4 sm:p-7" onClick={event => event.stopPropagation()}>
          <h3 className="text-[18px] font-semibold">登记收款</h3>
          <div className="inbound-field mt-4"><label className="erp-field-label mb-1.5 block">收款方式<span className="ml-1 text-[#C63C3C]">*</span></label>
            <select className="crm-input w-full" value={payMethod} onChange={event => setPayMethod(event.target.value as CrmSalesPaymentMethod)}>
              <option value="bank">对公转账</option>
              <option value="cash">现金</option>
              <option value="monthly">月结</option>
            </select>
          </div>
          <div className="inbound-field mt-4"><label className="erp-field-label mb-1.5 block">金额<span className="ml-1 text-[#C63C3C]">*</span></label>
            <input className="crm-input w-full" value={payAmount} onChange={event => setPayAmount(event.target.value)} placeholder="含税金额" />
          </div>
          <div className="inbound-field mt-4"><label className="erp-field-label mb-1.5 block">收款日期<span className="ml-1 text-[#C63C3C]">*</span></label>
            <input type="date" className="crm-input w-full" value={payDate} onChange={event => setPayDate(event.target.value)} />
          </div>
          <div className="inbound-field mt-4"><label className="erp-field-label mb-1.5 block">备注</label>
            <input className="crm-input w-full" maxLength={255} value={payNote} onChange={event => setPayNote(event.target.value)} />
          </div>
          <div className="mt-6 flex justify-end gap-2.5">
            <button type="button" className="crm-btn" disabled={paymentMutation.isPending} onClick={() => setPayOpen(false)}>取消</button>
            <button type="button" className="crm-btn crm-btn-primary" disabled={paymentMutation.isPending || !detailQuery.data} onClick={() => {
              if (!detailQuery.data) return;
              paymentMutation.mutate({ id: detailQuery.data.id, version: detailQuery.data.version, requestId: payRequestIdRef.current, method: payMethod, amount: payAmount.trim(), paymentDate: payDate, note: payNote.trim() });
            }}>{paymentMutation.isPending ? "保存中…" : "确认收款"}</button>
          </div>
        </div>
      </div>, document.body) : null}
      {shipOpen ? createPortal(<div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" onClick={() => { if (!shipMutation.isPending) setShipOpen(false); }}>
        <div className="max-h-[90vh] w-[560px] max-w-full overflow-y-auto rounded-xl bg-white p-4 sm:p-7" onClick={event => event.stopPropagation()}>
          <h3 className="text-[18px] font-semibold">出货</h3>
          {detailQuery.data ? <>
            <div className="grid gap-x-4 sm:grid-cols-2">
              <div className="inbound-field mt-4"><label className="erp-field-label mb-1.5 block">交付方式<span className="ml-1 text-[#C63C3C]">*</span></label>
                <select className="crm-input w-full" value={shipMethod} onChange={event => setShipMethod(event.target.value as "express" | "pickup")}>
                  <option value="express">快递</option>
                  <option value="pickup">自提</option>
                </select>
              </div>
              {shipMethod === "express" ? <>
                <div className="inbound-field mt-4"><label className="erp-field-label mb-1.5 block">快递公司<span className="ml-1 text-[#C63C3C]">*</span></label>
                  <input className="crm-input w-full" value={expressCo} onChange={event => setExpressCo(event.target.value)} />
                </div>
                <div className="inbound-field mt-4 sm:col-span-2"><label className="erp-field-label mb-1.5 block">快递单号<span className="ml-1 text-[#C63C3C]">*</span></label>
                  <input className="crm-input w-full" value={expressNo} onChange={event => setExpressNo(event.target.value)} />
                </div>
              </> : null}
            </div>
            <div className="inbound-field mt-4"><label className="erp-field-label mb-1.5 block">备注</label>
              <input className="crm-input w-full" value={shipNote} onChange={event => setShipNote(event.target.value)} />
            </div>
            <div className="erp-section-title mt-6">出货数量</div>
            <div className="overflow-x-auto rounded-lg border border-[#E3E8EF]">
              <table className="crm-table">
                <thead><tr><th>型号</th><th>待出</th><th>库存</th><th>本次出货</th></tr></thead>
                <tbody>
                  {detailQuery.data.items.flatMap(item => {
                    const candidates = detailQuery.data.stockCandidates.filter(candidate => candidate.orderItemId === item.id);
                    const remaining = item.orderedQty - item.shippedQty;
                    if (!candidates.length) {
                      return [<tr key={item.id}><td>{item.partNumber}</td><td className="tabular-nums">{remaining}{item.qtyUnit}</td><td className="tabular-nums text-[#8A94A3]">0</td><td className="text-[#8A94A3]">无库存</td></tr>];
                    }
                    return candidates.map(candidate => {
                      const key = `${item.id}:${candidate.inventoryId}`;
                      return <tr key={key}>
                        <td>
                          <div className="font-medium text-slate-800">{item.partNumber}</div>
                          <div className="text-[11px] text-muted-foreground">{candidate.ownerName}</div>
                        </td>
                        <td className="tabular-nums">{remaining}{item.qtyUnit}</td>
                        <td className="tabular-nums">{candidate.availableQty}</td>
                        <td><input className="crm-input w-24" value={shipQtys[key] ?? ""} onChange={event => setShipQtys(current => ({ ...current, [key]: event.target.value }))} /></td>
                      </tr>;
                    });
                  })}
                </tbody>
              </table>
            </div>
          </> : null}
          {detailQuery.data && detailQuery.data.items.every(item => detailQuery.data.stockCandidates.every(candidate => candidate.orderItemId !== item.id)) ? <div className="mt-4 text-[13px] text-[#8A4B08]">无匹配库存，请先入库后再出货。</div> : null}
          <div className="mt-6 flex justify-end gap-2.5">
            <button type="button" className="crm-btn" disabled={shipMutation.isPending} onClick={() => setShipOpen(false)}>取消</button>
            <button type="button" className="crm-btn crm-btn-primary" disabled={shipMutation.isPending || !detailQuery.data || Boolean(detailQuery.data && detailQuery.data.items.every(item => detailQuery.data.stockCandidates.every(candidate => candidate.orderItemId !== item.id)))} onClick={() => {
              if (!detailQuery.data) return;
              const items = Object.entries(shipQtys).map(([key, qty]) => {
                const [orderItemId, inventoryId] = key.split(":").map(Number);
                return { orderItemId, inventoryId, qty: Number(qty) };
              }).filter(item => Number.isInteger(item.qty) && item.qty > 0);
              if (!items.length) {
                toast.error(detailQuery.data.stockCandidates.length ? "请填写出货数量" : "无匹配库存，请先入库");
                return;
              }
              shipMutation.mutate({
                id: detailQuery.data.id, version: detailQuery.data.version, requestId: shipRequestIdRef.current,
                deliveryMethod: shipMethod, expressCo: expressCo.trim(), expressNo: expressNo.trim(), note: shipNote.trim(), items,
              });
            }}>{shipMutation.isPending ? "提交中…" : "确认出货"}</button>
          </div>
        </div>
      </div>, document.body) : null}
    </PlatformLayout>
  );
}
