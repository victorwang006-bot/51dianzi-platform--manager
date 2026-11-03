import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PlatformLayout from "../../../../BusinessContentFrame";
import { AdminPage, AdminPageHeader, AdminFilterBar, AdminDataPanel } from "@/components/admin/UnifiedAdminPage";
import "./InboundManagement.css";
import { BulkInboundForm } from "../components/inbound/BulkInboundForm";
import { ConfirmDialog } from "../components/customers/ConfirmDialog";
import { ErpHelperText, ErpSegmentedControl } from "../components/erp/ErpFormControls";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { trpc } from "../../../../api/business-trpc";
import { toast } from "sonner";
import { ChevronDown, Loader2, Plus, X } from "lucide-react";
import { useLocation } from "wouter";
import { CNY_TAX_EXCLUDED, CNY_TAX_INCLUDED, DEFAULT_INBOUND_TAX_RATE, INBOUND_TAX_RATE_OPTIONS, MAX_INBOUND_TAX_RATE, normalizeInboundPricing, type InboundPriceBasis } from "../../../shared/inboundPricing";
import { INBOUND_PAYMENT_PAID, INBOUND_PAYMENT_PARTIAL, INBOUND_PAYMENT_UNPAID, MAX_INBOUND_QTY, formatInboundMoney, inboundMoneyCents, inboundMoneyStringFromCents, inboundPayableCents, normalizeInboundMoney, type InboundPaymentMode } from "../../../shared/inboundPayment";

const PAGE_SIZE = 10;
const PART_NUMBER_LOOKUP_MIN_LENGTH = 2;
const PART_NUMBER_LOOKUP_LIMIT = 8;
const currentYear = new Date().getFullYear();
const yearSuggestions = Array.from({ length: currentYear - 1989 }, (_, i) => String(currentYear - i));
const todayLocal = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};
const newRequestId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
const uppercasePartNumber = (value: string) => value.normalize("NFKC").toUpperCase().slice(0, 128);
const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result ?? "")); reader.onerror = () => reject(new Error("图片读取失败")); reader.readAsDataURL(file); });

type InboundStatus = "in_transit" | "received" | "cancelled";
type InboundPaymentCategory = "untracked" | "unpaid" | "partial" | "paid" | "overpaid" | "refunded" | "cancelled_pending";
type InboundPhoto = { key: string; url: string; name: string; mimeType: "image/jpeg" | "image/png" | "image/webp"; size: number; };
type InboundRow = {
  id: number;
  slipNo: string;
  partNumber: string;
  brand: string | null;
  qty: number;
  unitCost: string | null;
  unitCostBasis: string | null;
  taxRate: string | null;
  unitCostTaxIncluded: string | null;
  unitCostTaxExcluded: string | null;
  prodYear: string | null;
  supplierName: string | null;
  supplierContact: string | null;
  supplierPhone: string | null;
  packageType: string | null;
  lotNumber: string | null;
  supplierOrderNo: string | null;
  status: InboundStatus;
  inboundDate: string;
  actualInboundDate: string | null;
  actualQty: number | null;
  operator: string | null;
  location: string | null;
  warehouseAddress?: string | null;
  procurementRegion?: string | null;
  priceMissing?: boolean | number;
  bulkBatchId?: number | null;
  note: string | null;
  receivedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  photos: unknown;
  paymentTrackedAt: Date | null;
  paymentTracked: boolean;
  paymentCategory: InboundPaymentCategory;
  payableAmount: string | null;
  paidAmount: string;
  outstandingAmount: string | null;
  paymentPercentage: number | null;
  createdAt: Date;
};
type InboundCancelScope = { ids: number[] } | { bulkBatchId: number };
type InboundCancelPreview = {
  count: number;
  ignoredCount: number;
  paidCount: number;
  paidAmount: string;
  paymentFingerprint: string;
  rows: Array<{ id: number; slipNo: string; partNumber: string; status: InboundStatus; bulkBatchId: number | null; paidAmount: string }>;
};

const emptyForm = () => ({
  status: "in_transit" as "in_transit" | "received",
  partNumber: "",
  brand: "",
  qty: "",
  unitCost: "",
  unitCostBasis: CNY_TAX_INCLUDED as InboundPriceBasis,
  taxRate: String(DEFAULT_INBOUND_TAX_RATE),
  prodYear: String(currentYear),
  supplierName: "",
  supplierContact: "",
  supplierPhone: "",
  packageType: "",
  lotNumber: "",
  supplierOrderNo: "",
  inboundDate: todayLocal(),
  operator: "",
  location: "",
  note: "",
  photos: [] as InboundPhoto[],
  paymentMode: INBOUND_PAYMENT_UNPAID as InboundPaymentMode,
  paymentPercent: "50" as "30" | "50" | "custom",
  paymentAmount: "",
  paymentDate: todayLocal(),
  paymentNote: "",
});
const emptyFilters = () => ({ supplierName: "", operator: "", partNumber: "", slipNo: "", status: "", paymentCategory: "", dateFrom: "", dateTo: "" });
const fmtDate = (value?: string | null) => (value || "").slice(0, 10);
const fmtQty = (value: number) => Number(value).toLocaleString("zh-CN");
const fmtMoney = (value: number) => value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const fmtUnitCost = (value: number) => value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const priceBasisLabel = (basis?: string | null, hasCost = false) => basis === CNY_TAX_EXCLUDED ? "未税" : hasCost ? "含税" : "-";
const statusMeta: Record<InboundStatus, { label: string; className: string }> = {
  in_transit: { label: "在途", className: "bg-[#E8F0FE] text-[#185FA5]" },
  received: { label: "已入库", className: "bg-[#EAF6EE] text-[#1B7F4B]" },
  cancelled: { label: "已作废", className: "bg-[#F4F4F4] text-[#777]" },
};
const paymentMeta: Record<InboundPaymentCategory, { label: string; className: string }> = {
  untracked: { label: "未登记", className: "bg-[#F4F4F4] text-[#777]" },
  unpaid: { label: "未付款", className: "bg-[#FFF4E5] text-[#8A4B08]" },
  partial: { label: "部分付款", className: "bg-[#E8F0FE] text-[#185FA5]" },
  paid: { label: "已付全款", className: "bg-[#EAF6EE] text-[#1B7F4B]" },
  overpaid: { label: "超付待处理", className: "bg-[#FDECEC] text-[#B42318]" },
  refunded: { label: "已线下退款", className: "bg-[#F4F4F4] text-[#666]" },
  cancelled_pending: { label: "作废待退款", className: "bg-[#FDECEC] text-[#B42318]" },
};
const inboundStatusDotClass: Record<InboundStatus, string> = {
  in_transit: "text-blue-500",
  received: "text-emerald-500",
  cancelled: "text-slate-400",
};
const paymentStatusDotClass: Record<InboundPaymentCategory, string> = {
  untracked: "text-slate-400",
  unpaid: "text-amber-500",
  partial: "text-blue-500",
  paid: "text-emerald-500",
  overpaid: "text-red-500",
  refunded: "text-slate-400",
  cancelled_pending: "text-amber-500",
};

export default function InboundManagement() {
  const [, navigate] = useLocation();
  const [filterInput, setFilterInput] = useState(emptyFilters());
  const [filters, setFilters] = useState(emptyFilters());
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [entryMode, setEntryMode] = useState<"single" | "bulk">("single");
  const [bulkDirty, setBulkDirty] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmBulkClose, setConfirmBulkClose] = useState(false);
  const [editingRow, setEditingRow] = useState<InboundRow | null>(null);
  const [detailRow, setDetailRow] = useState<InboundRow | null>(null);
  const [receiveRow, setReceiveRow] = useState<InboundRow | null>(null);
  const [receiveForm, setReceiveForm] = useState({ actualInboundDate: todayLocal(), actualQty: "", location: "" });
  const [receiveRequestId, setReceiveRequestId] = useState(newRequestId());
  const [createRequestId, setCreateRequestId] = useState(newRequestId());
  const [cancelRow, setCancelRow] = useState<InboundRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelRefundConfirmed, setCancelRefundConfirmed] = useState(false);
  const [cancelPaymentFingerprint, setCancelPaymentFingerprint] = useState("");
  const [batchCancelScope, setBatchCancelScope] = useState<InboundCancelScope | null>(null);
  const [batchCancelPreview, setBatchCancelPreview] = useState<InboundCancelPreview | null>(null);
  const [batchCancelReason, setBatchCancelReason] = useState("");
  const [batchRefundConfirmed, setBatchRefundConfirmed] = useState(false);
  const [batchCancelLoading, setBatchCancelLoading] = useState(false);
  const [paymentRow, setPaymentRow] = useState<InboundRow | null>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: "", paymentDate: todayLocal(), note: "" });
  const [paymentRequestId, setPaymentRequestId] = useState(newRequestId());
  const [voidPaymentEntry, setVoidPaymentEntry] = useState<{ id: number; amount: string } | null>(null);
  const [voidPaymentReason, setVoidPaymentReason] = useState("");
  const [form, setForm] = useState(emptyForm());
  const [showMore, setShowMore] = useState(false);
  const [printRows, setPrintRows] = useState<InboundRow[]>([]);
  const [batchMode, setBatchMode] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [partLookupKeyword, setPartLookupKeyword] = useState("");
  const [partDropdownOpen, setPartDropdownOpen] = useState(false);
  const [activePartIndex, setActivePartIndex] = useState(-1);
  const [actionMenu, setActionMenu] = useState<{ row: InboundRow; x: number; y: number } | null>(null);
  const [paymentOverviewOpen, setPaymentOverviewOpen] = useState(false);
  const partLookupDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activePartLookupRef = useRef("");
  const partInputWrapRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const paymentOverviewWrapRef = useRef<HTMLDivElement>(null);
  const paymentOverviewTriggerRef = useRef<HTMLButtonElement>(null);
  const paymentOverviewPopoverRef = useRef<HTMLDivElement>(null);
  const closePaymentOverview = useCallback(() => {
    setPaymentOverviewOpen(false);
    requestAnimationFrame(() => paymentOverviewTriggerRef.current?.focus());
  }, []);
  const trpcUtils = trpc.useUtils();
  // These tax/photo procedures are deployed with the inbound API migration; keep the UI compatible while this frontend file is replayed independently.
  const inboundApi = trpc.inbound as any;
  const inboundUtils = trpcUtils.inbound as any;

  const queryInput = useMemo(() => {
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(filters)) if (value) next[key] = value;
    return Object.keys(next).length ? next as any : undefined;
  }, [filters]);
  const { data: rows = [], isLoading, refetch } = trpc.inbound.list.useQuery(queryInput);
  const { data: overview } = inboundApi.overview.useQuery() as { data?: {
    totalPaidAmount: string;
    inTransitPaidAmount: string;
    receivedPaidAmount: string;
    cancelledPaidAmount: string;
    untrackedCount: number;
    totalInventoryValue: string;
    totalInventoryQty: number;
    totalInventoryValueComplete: boolean;
  } };
  const { data: company } = trpc.company.get.useQuery();
  const { data: detailPhotos = [], isFetching: detailPhotosLoading } = inboundApi.photos.useQuery({ id: detailRow?.id ?? 0 }, { enabled: detailRow != null }) as { data?: InboundPhoto[]; isFetching: boolean };
  const { data: paymentData, isFetching: paymentHistoryLoading, refetch: refetchPaymentHistory } = inboundApi.paymentHistory.useQuery(
    { id: paymentRow?.id ?? 0 },
    { enabled: paymentRow != null },
  ) as { data?: { order: InboundRow; entries: Array<{ id: number; amount: string; paymentDate: string; note: string | null; actorName: string; createdAt: string; voidedAt: string | null; voidReason: string | null; }> }; isFetching: boolean; refetch: () => Promise<unknown> };
  const partLookupQuery = trpc.inbound.suggestPartNumbers.useQuery(
    { keyword: partLookupKeyword, limit: PART_NUMBER_LOOKUP_LIMIT },
    {
      enabled: formOpen && partLookupKeyword.length >= PART_NUMBER_LOOKUP_MIN_LENGTH,
      staleTime: 60_000,
      retry: false,
    },
  );
  const partSuggestions = partLookupKeyword === form.partNumber.trim() ? partLookupQuery.data ?? [] : [];
  const pricingPreview = useMemo(() => { if (!form.unitCost.trim() || !form.taxRate.trim()) return null; try { return normalizeInboundPricing(Number(form.unitCost), form.unitCostBasis, Number(form.taxRate)); } catch { return null; } }, [form.unitCost, form.unitCostBasis, form.taxRate]);
  const payablePreview = useMemo(() => { const qty = Number(form.qty); if (!pricingPreview || !Number.isInteger(qty) || qty <= 0) return null; try { return inboundMoneyStringFromCents(inboundPayableCents(pricingPreview.unitCostTaxIncluded, qty)); } catch { return null; } }, [pricingPreview, form.qty]);
  const initialPaidPreview = useMemo(() => {
    if (form.paymentMode === INBOUND_PAYMENT_UNPAID) return "0.00";
    if (form.paymentMode === INBOUND_PAYMENT_PAID) return payablePreview;
    if (payablePreview == null) return null;
    if (form.paymentPercent === "custom") { try { return form.paymentAmount.trim() ? normalizeInboundMoney(form.paymentAmount) : null; } catch { return null; } }
    const percentage = BigInt(Number(form.paymentPercent));
    return inboundMoneyStringFromCents((inboundMoneyCents(payablePreview) * percentage + BigInt(50)) / BigInt(100));
  }, [form.paymentAmount, form.paymentMode, form.paymentPercent, payablePreview]);
  const initialOutstandingPreview = useMemo(() => {
    if (payablePreview == null || initialPaidPreview == null) return null;
    const payableCents = inboundMoneyCents(payablePreview);
    const paidCents = inboundMoneyCents(initialPaidPreview);
    return inboundMoneyStringFromCents(payableCents > paidCents ? payableCents - paidCents : BigInt(0));
  }, [initialPaidPreview, payablePreview]);
  const list = rows as unknown as InboundRow[];
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = list.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const createMutation = trpc.inbound.create.useMutation({
    onSuccess: result => {
      toast.success(result.status === "received" ? `入库单 ${result.slipNo} 已完成入库` : `在途单 ${result.slipNo} 已创建`);
      setFormOpen(false); refetch(); void inboundUtils.overview.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const updateMutation = trpc.inbound.update.useMutation({
    onSuccess: () => { toast.success("在途单已更新"); setFormOpen(false); setEditingRow(null); refetch(); void inboundUtils.overview.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const updateDetailsMutation = inboundApi.updateDetails.useMutation({
    onSuccess: () => { toast.success("入库单资料已更新"); setFormOpen(false); setEditingRow(null); refetch(); },
    onError: (error: { message: string }) => toast.error(error.message),
  });
  const uploadPhotoMutation = inboundApi.uploadPhoto.useMutation();
  const receiveMutation = trpc.inbound.receive.useMutation({
    onSuccess: result => {
      toast.success(result.alreadyReceived ? "该单已完成入库，未重复增加库存" : `入库单 ${result.slipNo} 已完成入库`);
      setReceiveRow(null); setDetailRow(null); refetch(); void inboundUtils.overview.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const cancelMutation = trpc.inbound.cancel.useMutation({
    onSuccess: result => {
      toast.success(result.alreadyCancelled ? "该单已作废" : "已作废，可在“已作废”中查看");
      setDetailRow(null); setCancelRow(null); setCancelReason(""); setCancelRefundConfirmed(false); setCancelPaymentFingerprint(""); setFormOpen(false); setEditingRow(null); refetch(); void inboundUtils.overview.invalidate();
    },
    onError: error => {
      toast.error(error.message);
      if (error.message.includes("付款记录已变化")) { setCancelRow(null); setCancelPaymentFingerprint(""); }
    },
  });
  const cancelManyMutation = inboundApi.cancelMany.useMutation({
    onSuccess: async (result: { count: number }) => {
      toast.success(`已作废 ${result.count} 单，可在“已作废”中查看`);
      setBatchCancelScope(null); setBatchCancelPreview(null); setBatchCancelReason(""); setBatchRefundConfirmed(false); setSelectedIds(new Set());
      await refetch(); void inboundUtils.overview.invalidate();
    },
    onError: (error: { message: string }) => {
      toast.error(error.message);
      if (error.message.includes("付款记录已变化")) { setBatchCancelScope(null); setBatchCancelPreview(null); }
    },
  });
  const refreshPaymentViews = async () => {
    await Promise.all([
      refetch(),
      paymentRow ? refetchPaymentHistory() : Promise.resolve(),
      inboundUtils.overview.invalidate(),
    ]);
  };
  const markPaymentUnpaidMutation = inboundApi.markPaymentUnpaid.useMutation({
    onSuccess: async () => { toast.success("已确认当前未付款"); await refreshPaymentViews(); },
    onError: (error: { message: string }) => toast.error(error.message),
  });
  const recordPaymentMutation = inboundApi.recordPayment.useMutation({
    onSuccess: async (result: { replayed: boolean }) => {
      toast.success(result.replayed ? "该笔付款已登记，未重复入账" : "付款已登记");
      setPaymentForm({ amount: "", paymentDate: todayLocal(), note: "" });
      setPaymentRequestId(newRequestId());
      await refreshPaymentViews();
    },
    onError: (error: { message: string }) => toast.error(error.message),
  });
  const voidPaymentMutation = inboundApi.voidPayment.useMutation({
    onSuccess: async () => { toast.success("付款记录已作废"); setVoidPaymentEntry(null); setVoidPaymentReason(""); await refreshPaymentViews(); },
    onError: (error: { message: string }) => toast.error(error.message),
  });

  useEffect(() => {
    const onDocumentMouseDown = (event: MouseEvent) => {
      if (!partInputWrapRef.current?.contains(event.target as Node)) {
        setPartDropdownOpen(false);
        setActivePartIndex(-1);
      }
    };
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, []);

  useEffect(() => () => {
    if (partLookupDebounceRef.current) clearTimeout(partLookupDebounceRef.current);
    const activeKeyword = activePartLookupRef.current;
    if (activeKeyword) {
      void trpcUtils.inbound.suggestPartNumbers.cancel({ keyword: activeKeyword, limit: PART_NUMBER_LOOKUP_LIMIT });
    }
  }, [trpcUtils]);

  useEffect(() => {
    if (!paymentOverviewOpen) return;
    paymentOverviewPopoverRef.current?.focus();
    const onDocumentMouseDown = (event: MouseEvent) => {
      if (!paymentOverviewWrapRef.current?.contains(event.target as Node)) {
        closePaymentOverview();
      }
    };
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closePaymentOverview();
    };
    document.addEventListener("mousedown", onDocumentMouseDown);
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocumentMouseDown);
      document.removeEventListener("keydown", onDocumentKeyDown);
    };
  }, [paymentOverviewOpen, closePaymentOverview]);

  const resetPartLookup = () => {
    if (partLookupDebounceRef.current) clearTimeout(partLookupDebounceRef.current);
    setPartLookupKeyword("");
    setPartDropdownOpen(false);
    setActivePartIndex(-1);
  };
  const changePartNumber = (rawValue: string) => {
    const value = uppercasePartNumber(rawValue);
    setForm(current => ({ ...current, partNumber: value }));
    const keyword = value.trim();
    // 输入一变化就隐藏并清空旧关键词候选，避免防抖窗口内误选旧型号。
    setPartLookupKeyword("");
    setPartDropdownOpen(false);
    setActivePartIndex(-1);
    const activeKeyword = activePartLookupRef.current;
    if (activeKeyword && activeKeyword !== keyword) {
      void trpcUtils.inbound.suggestPartNumbers.cancel({ keyword: activeKeyword, limit: PART_NUMBER_LOOKUP_LIMIT });
    }
    if (partLookupDebounceRef.current) clearTimeout(partLookupDebounceRef.current);
    if (keyword.length < PART_NUMBER_LOOKUP_MIN_LENGTH) {
      activePartLookupRef.current = "";
      return;
    }
    partLookupDebounceRef.current = setTimeout(() => {
      activePartLookupRef.current = keyword;
      setPartLookupKeyword(keyword);
      setPartDropdownOpen(true);
      setActivePartIndex(-1);
    }, keyword.length <= 2 ? 320 : 180);
  };
  const selectPartSuggestion = (item: { partNumber: string; brand: string; package: string }) => {
    const partNumber = uppercasePartNumber(item.partNumber).trim();
    setForm(current => ({
      ...current,
      partNumber,
      brand: item.brand || current.brand,
      packageType: item.package || current.packageType,
    }));
    setPartLookupKeyword(partNumber);
    setPartDropdownOpen(false);
    setActivePartIndex(-1);
  };
  const onPartNumberKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setPartDropdownOpen(false);
      setActivePartIndex(-1);
      return;
    }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && partSuggestions.length > 0) {
      event.preventDefault();
      setPartDropdownOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const initialIndex = event.key === "ArrowDown" ? 0 : partSuggestions.length - 1;
      setActivePartIndex(index => index < 0
        ? initialIndex
        : (index + step + partSuggestions.length) % partSuggestions.length);
      return;
    }
    if (event.key === "Enter" && partDropdownOpen && activePartIndex >= 0 && partSuggestions[activePartIndex]) {
      event.preventDefault();
      selectPartSuggestion(partSuggestions[activePartIndex]);
    }
  };

  const openCreate = () => { setEntryMode("single"); setBulkDirty(false); setBulkBusy(false); setConfirmBulkClose(false); setEditingRow(null); setForm(emptyForm()); setCreateRequestId(newRequestId()); setShowMore(false); resetPartLookup(); setFormOpen(true); };
  const closeCreate = () => {
    if (bulkBusy || createMutation.isPending || updateMutation.isPending || updateDetailsMutation.isPending || uploadPhotoMutation.isPending) return;
    if (!editingRow && bulkDirty) { setConfirmBulkClose(true); return; }
    setFormOpen(false);
  };
  useEffect(() => {
    if (!formOpen || !bulkDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [formOpen, bulkDirty]);
  const openEdit = async (row: InboundRow) => {
    if (row.status === "cancelled") return toast.error("已作废入库单不能编辑");
    let photos: InboundPhoto[] = [];
    try { photos = await inboundUtils.photos.fetch({ id: row.id }); } catch (error) { toast.error(error instanceof Error ? error.message : "入库照片加载失败"); return; }
    setEditingRow(row);
    setForm({ status: row.status === "received" ? "received" : "in_transit", partNumber: uppercasePartNumber(row.partNumber), brand: row.brand || "", qty: String(row.qty), unitCost: row.unitCost != null ? String(Number(row.unitCost)) : "", unitCostBasis: row.unitCostBasis === CNY_TAX_EXCLUDED ? CNY_TAX_EXCLUDED : CNY_TAX_INCLUDED, taxRate: row.taxRate != null ? String(Number(row.taxRate)) : "", prodYear: row.prodYear || String(currentYear), supplierName: row.supplierName || "", supplierContact: row.supplierContact || "", supplierPhone: row.supplierPhone || "", packageType: row.packageType || "", lotNumber: row.lotNumber || "", supplierOrderNo: row.supplierOrderNo || "", inboundDate: fmtDate(row.inboundDate), operator: row.operator || "", location: row.location || "", note: row.note || "", photos, paymentMode: INBOUND_PAYMENT_UNPAID, paymentPercent: "50", paymentAmount: "", paymentDate: todayLocal(), paymentNote: "" });
    resetPartLookup();
    setShowMore(Boolean(row.status === "received" || row.packageType || row.lotNumber || row.supplierOrderNo || photos.length));
    setFormOpen(true);
  };
  const uploadInboundPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    const available = 5 - form.photos.length;
    if (available <= 0) return toast.error("入库照片最多5张");
    const selected = Array.from(files).slice(0, available);
    if (files.length > available) toast.info(`最多还能上传${available}张照片`);
    try { for (const file of selected) { if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("仅支持 JPG、PNG、WebP 图片"); if (file.size <= 0 || file.size > 5 * 1024 * 1024) throw new Error("单张图片不能超过5MB"); const result = await uploadPhotoMutation.mutateAsync({ fileName: file.name, mimeType: file.type as InboundPhoto["mimeType"], base64: await readFileAsDataUrl(file) }); setForm(value => ({ ...value, photos: [...value.photos, result] })); } } catch (error) { toast.error(error instanceof Error ? error.message : "照片上传失败"); } finally { if (photoInputRef.current) photoInputRef.current.value = ""; }
  };
  const openReceive = (row: InboundRow) => {
    setReceiveRow(row);
    setReceiveRequestId(newRequestId());
    setReceiveForm({ actualInboundDate: todayLocal(), actualQty: String(row.qty), location: row.location || "" });
  };
  const openPayment = (row: InboundRow) => {
    setPaymentRow(row);
    setPaymentForm({ amount: row.outstandingAmount != null && inboundMoneyCents(row.outstandingAmount) > BigInt(0) ? row.outstandingAmount : "", paymentDate: todayLocal(), note: "" });
    setPaymentRequestId(newRequestId());
  };
  const submitPayment = () => {
    if (!paymentRow) return;
    let amount: string;
    try { amount = normalizeInboundMoney(paymentForm.amount); } catch { return toast.error("请输入有效付款金额"); }
    if (inboundMoneyCents(amount) <= BigInt(0)) return toast.error("请输入有效付款金额");
    if (!paymentForm.paymentDate) return toast.error("请选择付款日期");
    if (paymentForm.paymentDate > todayLocal()) return toast.error("付款日期不能晚于今天");
    recordPaymentMutation.mutate({ id: paymentRow.id, requestId: paymentRequestId, amount, paymentDate: paymentForm.paymentDate, note: paymentForm.note.trim() || undefined });
  };
  const requestVoidPayment = (paymentId: number, amount: string) => {
    setVoidPaymentEntry({ id: paymentId, amount });
    setVoidPaymentReason("");
  };
  const submitVoidPayment = () => {
    if (!voidPaymentEntry) return;
    const reason = voidPaymentReason.trim();
    if (reason.length < 2) return toast.error("请填写至少2个字的作废原因");
    voidPaymentMutation.mutate({ paymentId: voidPaymentEntry.id, reason });
  };

  const submitForm = () => {
    const photos = form.photos.map(({ key, name, mimeType, size }) => ({ key, name, mimeType, size }));
    if (editingRow?.status === "received") { if (!form.supplierName.trim()) return toast.error("请输入供应商名称"); if (!form.operator.trim()) return toast.error("请输入采购员"); if (!form.location.trim()) return toast.error("请输入存放仓位"); updateDetailsMutation.mutate({ id: editingRow.id, supplierName: form.supplierName.trim(), supplierContact: form.supplierContact.trim(), supplierPhone: form.supplierPhone.trim(), packageType: form.packageType.trim(), lotNumber: form.lotNumber.trim(), supplierOrderNo: form.supplierOrderNo.trim(), operator: form.operator.trim(), location: form.location.trim(), note: form.note.trim(), photos }); return; }
    const qty = Number(form.qty), partNumber = uppercasePartNumber(form.partNumber).trim();
    if (!partNumber) return toast.error("请输入料号/型号");
    if (!Number.isInteger(qty) || qty <= 0 || qty > MAX_INBOUND_QTY) return toast.error("数量须为1–999,999,999的整数");
    if (!form.prodYear.trim()) return toast.error("请输入年份/DC");
    if (!form.supplierName.trim()) return toast.error("请输入供应商名称");
    if (!form.operator.trim()) return toast.error("请输入采购员");
    if (!form.inboundDate) return toast.error(form.status === "in_transit" ? "请选择预计到货日期" : "请选择入库日期");
    if (form.status === "received" && !form.location.trim()) return toast.error("直接入库时请填写存放仓位");
    const unitCost = form.unitCost.trim() ? Number(form.unitCost) : undefined;
    if (unitCost != null && (!Number.isFinite(unitCost) || unitCost < 0)) return toast.error("请输入有效采购单价");
    const taxRate = unitCost != null && form.taxRate.trim() ? Number(form.taxRate) : undefined;
    const legacyPriceUnchanged = Boolean(editingRow?.status === "in_transit" && editingRow.unitCost != null && editingRow.taxRate == null && unitCost != null && Math.abs(Number(editingRow.unitCost) - unitCost) < 0.0000005 && form.unitCostBasis === (editingRow.unitCostBasis === CNY_TAX_EXCLUDED ? CNY_TAX_EXCLUDED : CNY_TAX_INCLUDED));
    if (unitCost != null && taxRate == null && !legacyPriceUnchanged) return toast.error("请选择采购税率");
    if (taxRate != null && (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > MAX_INBOUND_TAX_RATE || Math.round(taxRate * 10) !== taxRate * 10)) return toast.error("税率须为0%至13%，最多保留1位小数");
    let pricing: ReturnType<typeof normalizeInboundPricing> | null = null;
    if (unitCost != null && taxRate != null) { try { pricing = normalizeInboundPricing(unitCost, form.unitCostBasis, taxRate); } catch (error) { return toast.error(error instanceof Error ? error.message : "采购单价或税率无效"); } }
    const payload = { status: editingRow ? "in_transit" as const : form.status, partNumber, brand: form.brand.trim() || undefined, qty, unitCost: pricing?.unitCost, unitCostBasis: pricing?.unitCostBasis ?? (legacyPriceUnchanged ? form.unitCostBasis : undefined), taxRate: pricing?.taxRate, prodYear: form.prodYear.trim(), supplierName: form.supplierName.trim(), supplierContact: form.supplierContact.trim() || undefined, supplierPhone: form.supplierPhone.trim() || undefined, packageType: form.packageType.trim() || undefined, lotNumber: form.lotNumber.trim() || undefined, supplierOrderNo: form.supplierOrderNo.trim() || undefined, inboundDate: form.inboundDate, operator: form.operator.trim(), location: form.location.trim() || undefined, note: form.note.trim() || undefined, photos };
    if (legacyPriceUnchanged) payload.unitCost = unitCost;
    if (editingRow) {
      updateMutation.mutate({ id: editingRow.id, data: payload as any });
      return;
    }
    if (form.paymentMode !== INBOUND_PAYMENT_UNPAID) {
      if (payablePreview == null || inboundMoneyCents(payablePreview) <= BigInt(0)) return toast.error("登记付款前请填写有效采购单价、税率和数量");
      if (initialPaidPreview == null || inboundMoneyCents(initialPaidPreview) <= BigInt(0) || inboundMoneyCents(initialPaidPreview) > inboundMoneyCents(payablePreview)) return toast.error("已付款金额须大于0且不能超过采购货款");
      if (form.paymentMode === INBOUND_PAYMENT_PARTIAL && inboundMoneyCents(initialPaidPreview) >= inboundMoneyCents(payablePreview)) return toast.error("付款金额等于全款时请选择“已付全款”");
      if (!form.paymentDate) return toast.error("请选择付款日期");
      if (form.paymentDate > todayLocal()) return toast.error("付款日期不能晚于今天");
    }
    createMutation.mutate({
      ...payload,
      clientRequestId: createRequestId,
      payment: {
        mode: form.paymentMode,
        amount: form.paymentMode === INBOUND_PAYMENT_PARTIAL ? initialPaidPreview ?? undefined : undefined,
        paymentDate: form.paymentMode === INBOUND_PAYMENT_UNPAID ? undefined : form.paymentDate,
        note: form.paymentNote.trim() || undefined,
      },
    } as any);
  };
  const submitReceive = () => {
    if (!receiveRow) return;
    const actualQty = Number(receiveForm.actualQty);
    if (!Number.isInteger(actualQty) || actualQty <= 0 || actualQty > MAX_INBOUND_QTY) return toast.error("数量须为1–999,999,999的整数");
    if (!receiveForm.actualInboundDate) return toast.error("请选择入库日期");
    if (!receiveForm.location.trim()) return toast.error("请输入仓位");
    receiveMutation.mutate({ id: receiveRow.id, clientRequestId: receiveRequestId, actualInboundDate: receiveForm.actualInboundDate, actualQty, location: receiveForm.location.trim() });
  };
  const requestCancel = async (row: InboundRow) => {
    try {
      const preview = await inboundUtils.cancelPreview.fetch({ ids: [row.id] }) as InboundCancelPreview;
      const current = preview.rows[0];
      if (!current) return toast.error("该单已作废");
      setCancelRow({ ...row, paidAmount: current.paidAmount });
      setCancelReason(""); setCancelRefundConfirmed(false); setCancelPaymentFingerprint(preview.paymentFingerprint);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "预检失败");
    }
  };
  const submitCancel = () => {
    if (!cancelRow) return;
    const reason = cancelReason.trim();
    if (reason.length < 2) return toast.error("请填写至少2个字的作废原因");
    const hasPayment = inboundMoneyCents(cancelRow.paidAmount || "0") > BigInt(0);
    if (hasPayment && !cancelRefundConfirmed) return toast.error("请确认线下退款");
    cancelMutation.mutate({ id: cancelRow.id, reason, refundConfirmed: cancelRefundConfirmed, paymentFingerprint: cancelPaymentFingerprint });
  };
  const requestBatchCancel = async (scope: InboundCancelScope) => {
    setBatchCancelLoading(true);
    try {
      const preview = await inboundUtils.cancelPreview.fetch(scope) as InboundCancelPreview;
      if (!preview.count) return toast.error("没有可作废单据");
      setBatchCancelScope(scope); setBatchCancelPreview(preview); setBatchCancelReason(""); setBatchRefundConfirmed(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "预检失败");
    } finally {
      setBatchCancelLoading(false);
    }
  };
  const requestCancelImportBatch = (row: InboundRow) => {
    if (!row.bulkBatchId) return toast.error("该单不属于批量入库");
    void requestBatchCancel({ bulkBatchId: row.bulkBatchId });
  };
  const submitBatchCancel = () => {
    if (!batchCancelScope || !batchCancelPreview) return;
    const reason = batchCancelReason.trim();
    if (reason.length < 2) return toast.error("请填写至少2个字的作废原因");
    if (batchCancelPreview.paidCount > 0 && !batchRefundConfirmed) return toast.error("请确认线下退款");
    cancelManyMutation.mutate({ ...batchCancelScope, reason, refundConfirmed: batchRefundConfirmed, paymentFingerprint: batchCancelPreview.paymentFingerprint } as any);
  };
  const toggleSelect = (id: number) => setSelectedIds(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const doPrint = (selected: InboundRow[]) => { const received = selected.filter(row => row.status === "received"); if (!received.length) return toast.error("只有已入库单可以打印验收单"); setPrintRows(received); setTimeout(() => window.print(), 150); };
  const toggleBatchMode = () => { setBatchMode(value => !value); setSelectedIds(new Set()); };
  const toggleActionMenu = (row: InboundRow, button: HTMLButtonElement) => { if (actionMenu?.row.id === row.id) return setActionMenu(null); const rect = button.getBoundingClientRect(); setActionMenu({ row, x: Math.max(8, Math.min(window.innerWidth - 168, rect.right - 160)), y: Math.max(8, Math.min(window.innerHeight - 220, rect.bottom + 6)) }); };
  const applyFilters = () => { setFilters({ ...filterInput }); setPage(1); };
  const resetFilters = () => { setFilterInput(emptyFilters()); setFilters(emptyFilters()); setShowAdvancedFilters(false); setPage(1); };
  const immutableEdit = editingRow?.status === "received";
  const currentPaymentOrder = paymentData?.order ?? paymentRow;
  const cancelHasPayment = Boolean(cancelRow && inboundMoneyCents(cancelRow.paidAmount || "0") > BigInt(0));
  const hasAdvancedFilterInput = Boolean(filterInput.operator || filterInput.slipNo || filterInput.dateFrom || filterInput.dateTo);
  const hasAnyFilterInput = Object.values(filterInput).some(Boolean);
  const hasAppliedFilters = Object.values(filters).some(Boolean);
  const selectablePageIds = pageRows.filter(row => row.status !== "cancelled").map(row => row.id);
  const allSelectablePageRowsSelected = selectablePageIds.length > 0 && selectablePageIds.every(id => selectedIds.has(id));
  const toggleSelectablePageRows = () => setSelectedIds(previous => {
    const next = new Set(previous);
    if (allSelectablePageRowsSelected) selectablePageIds.forEach(id => next.delete(id));
    else selectablePageIds.forEach(id => next.add(id));
    return next;
  });

  return (
    <PlatformLayout>
      <AdminPage className="erp-ui inbound-management-page">
        <AdminPageHeader
          title="入库管理"
          description="管理在途、入库、采购付款与验收记录"
          actions={
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <div ref={paymentOverviewWrapRef} className="relative">
              <button
                ref={paymentOverviewTriggerRef}
                type="button"
                className="inbound-overview-button"
                aria-haspopup="dialog"
                aria-controls="inbound-payment-overview"
                aria-expanded={paymentOverviewOpen}
                onClick={() => setPaymentOverviewOpen(value => !value)}>
                <span>已付款项</span>
                <strong>{overview ? `¥${formatInboundMoney(overview.totalPaidAmount)}` : "—"}</strong>
              </button>
              {paymentOverviewOpen && <div ref={paymentOverviewPopoverRef} id="inbound-payment-overview" className="inbound-overview-popover" role="dialog" aria-label="已付款项明细" tabIndex={-1}>
                <div><span>在途已付</span><strong>¥{formatInboundMoney(overview?.inTransitPaidAmount ?? "0")}</strong></div>
                <div><span>已入库已付</span><strong>¥{formatInboundMoney(overview?.receivedPaidAmount ?? "0")}</strong></div>
                <div><span>作废待退款</span><strong>¥{formatInboundMoney(overview?.cancelledPaidAmount ?? "0")}</strong></div>
                <div><span>付款未登记</span><strong>{overview?.untrackedCount ?? 0} 单</strong></div>
              </div>}
            </div>
            <button
              type="button"
              className="inbound-overview-button"
              title="查看当前可用库存"
              onClick={() => navigate("/inventory")}>
              <span>库存总价值</span>
              <strong>{overview ? `${overview.totalInventoryValueComplete ? "" : "约 "}¥${formatInboundMoney(overview.totalInventoryValue)}` : "—"}</strong>
            </button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-pressed={batchMode}
              className={batchMode
                ? "h-8 border-[#185FA5] bg-[#185FA5] px-3 text-xs text-white shadow-none hover:bg-[#0C447C] hover:text-white"
                : "h-8 border-slate-300 bg-white px-3 text-xs text-slate-700 shadow-none hover:bg-slate-50 hover:text-slate-900"}
              onClick={toggleBatchMode}>
              {batchMode ? "退出批量" : "批量操作"}
            </Button>
            <Button type="button" size="sm" className="h-8 bg-[#185FA5] px-3 text-xs hover:bg-[#0C447C]" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" />
              新建入库
            </Button>
          </div>
          }
        />
        <AdminFilterBar
          className="inbound-toolbar"
          onKeyDown={event => { if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") applyFilters(); }}>
          <div className="flex flex-wrap items-center gap-2">
            <Input className="h-8 w-[150px] bg-white text-xs" placeholder="搜索料号" value={filterInput.partNumber} onChange={event => setFilterInput(value => ({ ...value, partNumber: event.target.value }))} />
            <Input className="h-8 w-[140px] bg-white text-xs" placeholder="供应商名称" value={filterInput.supplierName} onChange={event => setFilterInput(value => ({ ...value, supplierName: event.target.value }))} />
            <Select value={filterInput.status || "active"} onValueChange={status => setFilterInput(value => ({ ...value, status: status === "active" ? "" : status }))}>
              <SelectTrigger size="sm" className="w-[124px] bg-white text-xs"><SelectValue /></SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="active">有效单据</SelectItem>
                <SelectItem value="in_transit">在途</SelectItem>
                <SelectItem value="received">已入库</SelectItem>
                <SelectItem value="cancelled">已作废</SelectItem>
                <SelectItem value="all">全部单据</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterInput.paymentCategory || "all_payment"} onValueChange={paymentCategory => setFilterInput(value => ({ ...value, paymentCategory: paymentCategory === "all_payment" ? "" : paymentCategory }))}>
              <SelectTrigger size="sm" className="w-[132px] bg-white text-xs"><SelectValue /></SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="all_payment">全部付款状态</SelectItem>
                <SelectItem value="untracked">付款未登记</SelectItem>
                <SelectItem value="unpaid">未付款</SelectItem>
                <SelectItem value="partial">部分付款</SelectItem>
                <SelectItem value="paid">已付全款</SelectItem>
                <SelectItem value="overpaid">超付待处理</SelectItem>
                <SelectItem value="refunded">已线下退款</SelectItem>
                <SelectItem value="cancelled_pending">作废待退款</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 min-w-[100px] justify-between border-slate-300 bg-white px-3 text-xs text-slate-700 shadow-none hover:bg-slate-50 hover:text-slate-900"
              aria-expanded={showAdvancedFilters}
              data-testid="inbound-more-filters"
              onClick={() => setShowAdvancedFilters(value => !value)}>
              更多筛选{hasAdvancedFilterInput ? " · 已选" : ""}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvancedFilters ? "rotate-180" : ""}`} />
            </Button>
            <div className="inline-flex items-center gap-1.5">
              <Button size="sm" variant="outline" className="h-8 min-w-[60px] border-slate-300 bg-white px-3 text-xs text-slate-700 shadow-none hover:bg-slate-50 hover:text-slate-900" onClick={applyFilters}>筛选</Button>
              <Button size="sm" variant="outline" className="h-8 min-w-[60px] border-slate-300 bg-white px-3 text-xs text-slate-700 shadow-none hover:bg-slate-50 hover:text-slate-900" disabled={!hasAnyFilterInput && !hasAppliedFilters} onClick={resetFilters}>重置</Button>
            </div>
          </div>
          {showAdvancedFilters && <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2" data-testid="inbound-advanced-filters">
            <Input className="h-8 w-[120px] bg-white text-xs" placeholder="采购员" value={filterInput.operator} onChange={event => setFilterInput(value => ({ ...value, operator: event.target.value }))} />
            <Input className="h-8 w-[160px] bg-white text-xs" placeholder="入库单号" value={filterInput.slipNo} onChange={event => setFilterInput(value => ({ ...value, slipNo: event.target.value }))} />
            <div className="inline-flex items-center gap-1.5">
              <Input type="date" aria-label="开始日期" className="h-8 w-[138px] bg-white text-xs" value={filterInput.dateFrom} onChange={event => setFilterInput(value => ({ ...value, dateFrom: event.target.value }))} />
              <span className="text-[11px] text-muted-foreground">至</span>
              <Input type="date" aria-label="结束日期" className="h-8 w-[138px] bg-white text-xs" value={filterInput.dateTo} onChange={event => setFilterInput(value => ({ ...value, dateTo: event.target.value }))} />
            </div>
          </div>}
        </AdminFilterBar>

        {batchMode && <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#b9d2e8] bg-[#f5f9fd] px-3 py-2 text-xs text-[#12324a]">
          <span className="font-medium">已选择 <b>{selectedIds.size}</b> 条</span>
          <Button size="sm" variant="outline" className="h-8 bg-white text-xs text-[#185FA5]" disabled={selectedIds.size === 0} onClick={() => doPrint(list.filter(row => selectedIds.has(row.id)))}>合并打印验收单</Button>
          <Button size="sm" variant="outline" className="h-8 border-red-200 bg-white text-xs text-[#B42318] hover:bg-red-50 hover:text-[#B42318]" disabled={selectedIds.size === 0 || batchCancelLoading} onClick={() => { void requestBatchCancel({ ids: Array.from(selectedIds) }); }}>{batchCancelLoading ? "预检中…" : "批量作废"}</Button>
          <Button size="sm" variant="outline" className="h-8 bg-white text-xs" onClick={toggleBatchMode}>取消选择</Button>
        </div>}

        <AdminDataPanel className="overflow-hidden">
          {isLoading ? (
            <div className="flex justify-center p-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : pageRows.length === 0 ? (
            <div className="p-14 text-center">
              <div className="text-sm font-medium text-slate-800">{hasAppliedFilters ? "无符合筛选条件的入库记录" : "暂无入库记录"}</div>
              <div className="mt-1.5 text-xs text-muted-foreground">{hasAppliedFilters ? "尝试调整筛选条件或点击「重置」" : "点击右上角「新建入库」开始录入"}</div>
            </div>
          ) : (
            <div className="max-h-[calc(100vh-260px)] min-h-[320px] overflow-auto">
              <table className="crm-table inbound-list-table min-w-[980px] table-fixed">
                <colgroup>
                  {batchMode && <col className="w-[4%]" />}
                  <col className={batchMode ? "w-[14%]" : "w-[15%]"} /><col className={batchMode ? "w-[18%]" : "w-[19%]"} /><col className="w-[11%]" /><col className="w-[10%]" />
                  <col className={batchMode ? "w-[12%]" : "w-[13%]"} /><col className={batchMode ? "w-[15%]" : "w-[16%]"} /><col className="w-[10%]" /><col className="w-[6%]" />
                </colgroup>
                <thead><tr>
                  {batchMode && <th className="sticky left-0 z-30 w-9 bg-slate-50 shadow-[1px_0_0_#e2e8f0]"><Checkbox aria-label="选择本页全部未作废单" checked={allSelectablePageRowsSelected ? true : selectedIds.size > 0 ? "indeterminate" : false} disabled={selectablePageIds.length === 0} onCheckedChange={() => toggleSelectablePageRows()} /></th>}
                  <th className={`sticky z-20 bg-slate-50 shadow-[1px_0_0_#e2e8f0] ${batchMode ? "left-9" : "left-0"}`}>入库单 / 日期</th><th>料号 / 品牌</th><th className="inbound-numeric">数量 / DC</th><th>货物状态</th><th>付款情况</th><th>供应商</th><th>采购员 / 仓位</th><th className="inbound-actions">操作</th>
                </tr></thead>
                <tbody>
                  {pageRows.map(row => <tr
                    key={row.id}
                    tabIndex={0}
                    aria-label={`查看入库单 ${row.slipNo}`}
                    className={`h-14 cursor-pointer outline-none focus-visible:bg-[#f5f9fd] ${row.status === "cancelled" ? "opacity-60" : ""}`}
                    onClick={event => { if (!(event.target as HTMLElement).closest("button, input, a")) setDetailRow(row); }}
                    onKeyDown={event => { if ((event.target as HTMLElement).closest("button, input, a")) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setDetailRow(row); } }}>
                    {batchMode && <td className="sticky left-0 z-20 bg-white shadow-[1px_0_0_#e2e8f0]"><Checkbox aria-label={`选择 ${row.slipNo}`} disabled={row.status === "cancelled"} checked={selectedIds.has(row.id)} onCheckedChange={() => toggleSelect(row.id)} /></td>}
                    <td className={`sticky z-10 bg-white shadow-[1px_0_0_#e2e8f0] ${batchMode ? "left-9" : "left-0"}`}><button className="crm-link truncate font-medium" onClick={() => setDetailRow(row)}>{row.slipNo}</button><div className="mt-0.5 text-[11px] text-muted-foreground">{fmtDate(row.actualInboundDate || row.inboundDate)} · {row.status === "in_transit" ? "预计到货" : "入库"}</div></td>
                    <td><div className="truncate font-semibold text-slate-800" title={row.partNumber}>{row.partNumber}</div><div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={row.brand || ""}>{row.brand || "—"}{Boolean(row.priceMissing) && <span className="ml-1 text-[11px] text-amber-700">未录价格</span>}</div></td>
                    <td className="inbound-numeric"><div className="font-medium tabular-nums text-slate-800">{fmtQty(Number(row.actualQty ?? row.qty))}</div><div className="mt-0.5 text-[11px] text-muted-foreground">DC {row.prodYear || "—"}</div></td>
                    <td><div className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-slate-600"><span className={`text-[10px] ${inboundStatusDotClass[row.status]}`} aria-hidden="true">●</span><span className="font-medium text-slate-700">{statusMeta[row.status].label}</span></div></td>
                    <td><div className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-slate-600"><span className={`text-[10px] ${paymentStatusDotClass[row.paymentCategory]}`} aria-hidden="true">●</span><span className="font-medium text-slate-700">{paymentMeta[row.paymentCategory].label}</span></div>{row.paymentPercentage != null && row.paymentCategory !== "paid" && <div className="mt-0.5 whitespace-nowrap text-[11px] text-muted-foreground">已付 {row.paymentPercentage}%</div>}</td>
                    <td><div className="truncate text-[12px] text-slate-700" title={row.supplierName || ""}>{row.supplierName || "—"}</div></td>
                    <td><div className="truncate text-[12px] text-slate-700" title={row.operator || ""}>{row.operator || "—"}</div><div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={row.location || ""}>{row.location || "未填仓位"}</div></td>
                    <td className="inbound-actions"><button type="button" className="inbound-row-menu" aria-label={`操作 ${row.slipNo}`} aria-haspopup="menu" aria-expanded={actionMenu?.row.id === row.id} onClick={event => toggleActionMenu(row, event.currentTarget)}>…</button></td>
                  </tr>)}
                </tbody>
              </table>
            </div>
          )}
        </AdminDataPanel>
        {list.length > 0 && <div className="aui-pagination mb-8 mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>共 {list.length} 条 · 每页 {PAGE_SIZE} 条</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-8 bg-white text-xs" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>上一页</Button>
            <span className="min-w-[64px] text-center">第 {safePage} / {totalPages} 页</span>
            <Button size="sm" variant="outline" className="h-8 bg-white text-xs" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>下一页</Button>
          </div>
        </div>}

      {actionMenu && <><button type="button" aria-label="关闭操作菜单" className="fixed inset-0 z-40 cursor-default" onClick={() => setActionMenu(null)} /><div role="menu" aria-label={`${actionMenu.row.slipNo} 操作`} className="fixed z-50 w-40 rounded-lg border border-[#e3e3e3] bg-white p-1.5 shadow-xl" style={{ left: actionMenu.x, top: actionMenu.y }}><button role="menuitem" className="erp-menu-item" onClick={() => { setDetailRow(actionMenu.row); setActionMenu(null); }}>查看详情</button>{actionMenu.row.status === "in_transit" && <button role="menuitem" className="erp-menu-item text-[#185FA5] hover:bg-[#f0f6fd]" onClick={() => { openReceive(actionMenu.row); setActionMenu(null); }}>确认入库</button>}{actionMenu.row.status !== "cancelled" && <button role="menuitem" className="erp-menu-item" onClick={() => { void openEdit(actionMenu.row); setActionMenu(null); }}>编辑</button>}<button role="menuitem" className="erp-menu-item" onClick={() => { openPayment(actionMenu.row); setActionMenu(null); }}>付款记录</button>{actionMenu.row.status === "received" && <button role="menuitem" className="erp-menu-item" onClick={() => { doPrint([actionMenu.row]); setActionMenu(null); }}>打印验收单</button>}{actionMenu.row.status !== "cancelled" && actionMenu.row.bulkBatchId && <button role="menuitem" className="erp-menu-item erp-menu-item-danger" disabled={batchCancelLoading} onClick={() => { requestCancelImportBatch(actionMenu.row); setActionMenu(null); }}>作废本批</button>}{actionMenu.row.status !== "cancelled" && <button role="menuitem" className="erp-menu-item erp-menu-item-danger" onClick={() => { requestCancel(actionMenu.row); setActionMenu(null); }}>作废</button>}</div></>}

      {formOpen && <Modal onClose={closeCreate} width="1180px" label={editingRow ? "编辑入库单" : "新建入库单"} className="inbound-entry-modal">
        <div className="inbound-entry-header"><div><h3 className="inbound-entry-title">{immutableEdit ? "编辑入库资料" : editingRow ? "编辑在途单" : "新建入库单"}</h3><p className="mt-1 text-[12px] text-[#8A94A3]">{editingRow ? `正在编辑 ${editingRow.slipNo}` : "登记在途或直接入库"}</p></div><div className="flex items-center gap-3"><span className="inbound-slip-hint">单号：{editingRow?.slipNo || "保存后生成"}</span><button type="button" className="inbound-modal-close" aria-label={editingRow ? "关闭编辑入库单" : "关闭新建入库单"} disabled={bulkBusy || createMutation.isPending} onClick={closeCreate}><X aria-hidden="true" className="h-4 w-4" /></button></div></div>
        {!editingRow && <div className="inbound-entry-switchbar"><span className="text-[12px] font-medium text-[#64748B]">录入方式</span><ErpSegmentedControl ariaLabel="录入方式" value={entryMode} options={[{ value: "single", label: "单条录入" }, { value: "bulk", label: "批量入库" }]} onChange={setEntryMode} disabled={bulkBusy || createMutation.isPending} variant="buttons" className="inbound-entry-mode" /></div>}<div className="inbound-entry-scroll">
        {!editingRow && <div hidden={entryMode !== "bulk"}><BulkInboundForm onCancel={closeCreate} onDirtyChange={setBulkDirty} onBusyChange={setBulkBusy} onSuccess={() => { setBulkDirty(false); setBulkBusy(false); setFormOpen(false); void refetch(); void inboundUtils.overview.invalidate(); }} /></div>}
        <div hidden={!editingRow && entryMode === "bulk"} className="inbound-form-controls">
        {immutableEdit && <div className="rounded-lg bg-[#f7f9fc] border border-[#e4e9f0] px-4 py-3 text-[12px] text-[#666]">已入库单可修改供应商资料、采购员、仓位、封装、批次、订单号、备注和照片；料号、数量、日期及成本已进入库存台账，不能直接修改。</div>}
        <section className="inbound-entry-card"><div className="inbound-entry-card-title">基本信息</div><div className="inbound-entry-card-body grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
          {!editingRow && <Field label="单据状态" required><ErpSegmentedControl ariaLabel="单据状态" value={form.status} options={[{ value: "in_transit", label: "在途" }, { value: "received", label: "直接入库" }]} onChange={status => setForm(value => ({ ...value, status }))} variant="buttons" className="inbound-status-choice" /></Field>}
          <Field label={form.status === "in_transit" ? "预计到货日期" : "入库日期"} required><input type="date" className="crm-input w-full" disabled={immutableEdit} value={form.inboundDate} onChange={event => setForm(value => ({ ...value, inboundDate: event.target.value }))} /></Field>
          <Field label="料号/型号" required><div ref={partInputWrapRef} className="relative"><input id="inbound-part-number" aria-label="料号/型号" className="crm-input w-full pr-16" disabled={immutableEdit} placeholder="输入2个字符自动联想，如：STM32F103C8T6" value={form.partNumber} maxLength={128} autoComplete="off" role="combobox" aria-autocomplete="list" aria-expanded={partDropdownOpen && partLookupKeyword.length >= PART_NUMBER_LOOKUP_MIN_LENGTH} aria-controls="inbound-part-suggestions" aria-activedescendant={activePartIndex >= 0 ? `inbound-part-option-${activePartIndex}` : undefined} onChange={event => changePartNumber(event.target.value)} onFocus={() => { if (partLookupKeyword === form.partNumber.trim() && partSuggestions.length > 0) setPartDropdownOpen(true); }} onKeyDown={onPartNumberKeyDown} />{partLookupQuery.isFetching && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[#999]" aria-live="polite">联想中…</span>}{partDropdownOpen && partLookupKeyword.length >= PART_NUMBER_LOOKUP_MIN_LENGTH && <div id="inbound-part-suggestions" role="listbox" aria-label="匹配型号" className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-[#ddd] rounded-md shadow-lg max-h-56 overflow-y-auto">{partSuggestions.map((item, index) => <button key={item.id} id={`inbound-part-option-${index}`} type="button" role="option" aria-selected={index === activePartIndex} className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 border-b border-[#eee] last:border-0 ${index === activePartIndex ? "bg-[#f0f6fd]" : "hover:bg-[#f0f6fd]"}`} onMouseDown={event => { event.preventDefault(); selectPartSuggestion(item); }} onMouseEnter={() => setActivePartIndex(index)}><span className="font-medium text-[#185FA5] truncate">{item.partNumber}</span><span className="text-[11px] text-[#888] shrink-0">{[item.brand, item.package].filter(Boolean).join(" · ")}</span></button>)}{!partLookupQuery.isFetching && partSuggestions.length === 0 && <div className="px-3 py-2 text-[12px] text-[#888]" role="status">未找到匹配型号，可继续手动输入</div>}</div>}</div></Field>
          <Field label="品牌/制造商"><input className="crm-input w-full" disabled={immutableEdit} placeholder="如：ST" value={form.brand} onChange={event => setForm(value => ({ ...value, brand: event.target.value }))} /></Field>
          <Field label={form.status === "in_transit" ? "计划到货数量" : "入库数量"} required><input type="number" min={1} max={MAX_INBOUND_QTY} step={1} className="crm-input w-full" disabled={immutableEdit} placeholder="请输入整数数量" value={form.qty} onChange={event => setForm(value => ({ ...value, qty: event.target.value }))} /></Field>
          <Field label="年份 / DC" required><input className="crm-input w-full" disabled={immutableEdit} list="inbound-year-options" placeholder="如：2026、25+、2512、混批" value={form.prodYear} onChange={event => setForm(value => ({ ...value, prodYear: event.target.value }))} /><datalist id="inbound-year-options">{yearSuggestions.map(year => <option key={year} value={year} />)}<option value="25+" /><option value="混批" /><option value="未知" /></datalist></Field></div></section><section className="inbound-entry-card mt-3"><div className="inbound-entry-card-title">采购与付款</div><div className="inbound-entry-card-body grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
          <Field label="供应商名称" required><input className="crm-input w-full" value={form.supplierName} onChange={event => setForm(value => ({ ...value, supplierName: event.target.value }))} /></Field>
          <Field label="采购员" required><input className="crm-input w-full" value={form.operator} onChange={event => setForm(value => ({ ...value, operator: event.target.value }))} /></Field>
          <Field label="供应商联系人"><input className="crm-input w-full" placeholder="联系人姓名" value={form.supplierContact} onChange={event => setForm(value => ({ ...value, supplierContact: event.target.value }))} /></Field>
          <Field label="联系方式"><input className="crm-input w-full" placeholder="手机或微信" value={form.supplierPhone} onChange={event => setForm(value => ({ ...value, supplierPhone: event.target.value }))} /></Field>
          <Field label="采购单价"><div><div className="inbound-price-editor"><ErpSegmentedControl ariaLabel="价格类型" value={form.unitCostBasis} options={[{ value: CNY_TAX_INCLUDED, label: "含税" }, { value: CNY_TAX_EXCLUDED, label: "未税" }]} onChange={unitCostBasis => setForm(value => ({ ...value, unitCostBasis }))} disabled={immutableEdit} variant="buttons" className="shrink-0" /><input type="number" min={0} step="0.000001" className="crm-input min-w-0 flex-1" disabled={immutableEdit} placeholder="选填单价" aria-label="采购单价" value={form.unitCost} onChange={event => setForm(value => ({ ...value, unitCost: event.target.value }))} /><div className="relative w-[96px] shrink-0"><input type="number" min={0} max={MAX_INBOUND_TAX_RATE} step="0.1" list="inbound-tax-rate-options" className="crm-input w-full pr-7" disabled={immutableEdit} placeholder="税率" aria-label="采购税率" value={form.taxRate} onChange={event => setForm(value => ({ ...value, taxRate: event.target.value }))} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#888]">%</span><datalist id="inbound-tax-rate-options">{INBOUND_TAX_RATE_OPTIONS.map(rate => <option key={rate} value={rate} />)}</datalist></div></div>{pricingPreview ? <ErpHelperText>含税 ¥{fmtUnitCost(pricingPreview.unitCostTaxIncluded)} · 未税 ¥{fmtUnitCost(pricingPreview.unitCostTaxExcluded)} · 每件税额 ¥{fmtUnitCost(pricingPreview.unitCostTaxIncluded - pricingPreview.unitCostTaxExcluded)}</ErpHelperText> : editingRow?.unitCost != null && editingRow.taxRate == null ? <ErpHelperText tone="warning">历史单价未记录税率；保持原价可直接保存，修改价格时须确认税率</ErpHelperText> : <ErpHelperText>用于换算含税价与未税价，默认13%，支持0%—13%</ErpHelperText>}</div></Field>
          <Field label="仓位" required={form.status === "received"}><input className="crm-input w-full" placeholder={form.status === "received" ? "直接入库时必填" : "可在确认入库时填写"} value={form.location} onChange={event => setForm(value => ({ ...value, location: event.target.value }))} /></Field>
          {!editingRow && <div className="sm:col-span-2"><Field label="货款情况" required><div className="inbound-payment-panel"><div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><ErpSegmentedControl ariaLabel="货款情况" value={form.paymentMode} options={[{ value: INBOUND_PAYMENT_UNPAID, label: "未付款" }, { value: INBOUND_PAYMENT_PARTIAL, label: "部分付款" }, { value: INBOUND_PAYMENT_PAID, label: "已付全款" }]} onChange={paymentMode => setForm(value => ({ ...value, paymentMode }))} variant="buttons" className="inbound-payment-mode" />{form.paymentMode === INBOUND_PAYMENT_PAID && <ErpHelperText>已按100%自动计算本次付款</ErpHelperText>}</div>{form.paymentMode !== INBOUND_PAYMENT_UNPAID && <div className="w-full lg:w-[240px]"><label className="mb-1 block text-[12px] font-medium text-slate-600">付款日期</label><input type="date" aria-label="付款日期" className="crm-input w-full" max={todayLocal()} value={form.paymentDate} onChange={event => setForm(value => ({ ...value, paymentDate: event.target.value }))} /></div>}</div>{form.paymentMode === INBOUND_PAYMENT_PARTIAL && <div className="inbound-payment-details"><div><div className="mb-1 text-[12px] font-medium text-slate-600">付款比例</div><ErpSegmentedControl ariaLabel="付款比例" value={form.paymentPercent} options={[{ value: "30", label: "30%" }, { value: "50", label: "50%" }, { value: "custom", label: "自定义" }]} onChange={paymentPercent => setForm(value => ({ ...value, paymentPercent }))} variant="buttons" className="inbound-payment-percent" /></div><div><div className="mb-1 text-[12px] font-medium text-slate-600">本次已付</div><div className="relative"><input type="number" min={0.01} step="0.01" className="crm-input w-full pl-7" aria-label="已付款金额" disabled={form.paymentPercent !== "custom"} placeholder={form.paymentPercent === "custom" ? "输入实际付款金额" : "按比例自动计算"} value={form.paymentPercent === "custom" ? form.paymentAmount : initialPaidPreview ?? ""} onChange={event => setForm(value => ({ ...value, paymentAmount: event.target.value }))} /><span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#8A94A3]">¥</span></div><ErpHelperText>{form.paymentPercent === "custom" ? "填写实际付款金额" : `${form.paymentPercent}% 自动计算，可选“自定义”输入实际金额`}</ErpHelperText></div></div>}{form.paymentMode !== INBOUND_PAYMENT_UNPAID && <div className="inbound-payment-summary"><div><span>含税货款</span><strong>{payablePreview != null ? `¥${formatInboundMoney(payablePreview)}` : "—"}</strong></div><div><span>本次已付</span><strong>{initialPaidPreview != null ? `¥${formatInboundMoney(initialPaidPreview)}` : "—"}</strong></div><div><span>待付</span><strong>{initialOutstandingPreview != null ? `¥${formatInboundMoney(initialOutstandingPreview)}` : "—"}</strong></div></div>}{form.paymentMode !== INBOUND_PAYMENT_UNPAID && <input className="crm-input mt-3 w-full" maxLength={255} placeholder="付款备注（选填）" value={form.paymentNote} onChange={event => setForm(value => ({ ...value, paymentNote: event.target.value }))} />}</div></Field></div>}
        </div></section>
        <button type="button" className="inbound-more-toggle" aria-expanded={showMore} onClick={() => setShowMore(value => !value)}><span>更多信息与照片</span><span>{showMore ? "收起 ↑" : "展开 ↓"}</span></button>
        {showMore && <section className="inbound-entry-card mt-3"><div className="inbound-entry-card-body grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
          <Field label="封装"><input className="crm-input w-full" value={form.packageType} onChange={event => setForm(value => ({ ...value, packageType: event.target.value }))} /></Field>
          <Field label="批次 / Lot No."><input className="crm-input w-full" value={form.lotNumber} onChange={event => setForm(value => ({ ...value, lotNumber: event.target.value }))} /></Field>
          <div className="sm:col-span-2"><Field label="供应商订单号"><input className="crm-input w-full" value={form.supplierOrderNo} onChange={event => setForm(value => ({ ...value, supplierOrderNo: event.target.value }))} /></Field></div>
          <div className="sm:col-span-2"><Field label="入库实拍照片"><input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={event => void uploadInboundPhotos(event.target.files)} /><div className="flex flex-wrap gap-2"><button type="button" className="crm-btn crm-btn-sm" disabled={uploadPhotoMutation.isPending || form.photos.length >= 5} onClick={() => photoInputRef.current?.click()}>{uploadPhotoMutation.isPending ? "上传中…" : `上传照片（${form.photos.length}/5）`}</button><span className="self-center text-[11px] text-[#999]">支持JPG、PNG、WebP，单张不超过5MB</span></div>{form.photos.length > 0 && <div className="grid grid-cols-5 gap-2 mt-2">{form.photos.map((photo, index) => <div key={photo.key} className="relative aspect-square rounded-md overflow-hidden border bg-white"><img src={photo.url} alt={`入库照片${index + 1}`} className="w-full h-full object-cover" /><button type="button" aria-label={`删除第${index + 1}张照片`} className="absolute right-1 top-1 rounded bg-black/65 text-white w-5 h-5 text-[12px] leading-5" onClick={() => setForm(value => ({ ...value, photos: value.photos.filter(item => item.key !== photo.key) }))}>×</button></div>)}</div>}</Field></div>
        </div></section>}
        <section className="inbound-entry-card mt-3"><div className="inbound-entry-card-body"><Field label="备注"><textarea className="crm-input h-[64px] w-full resize-none" maxLength={500} value={form.note} onChange={event => setForm(value => ({ ...value, note: event.target.value }))} /></Field></div></section>
        <div className="inbound-entry-actions"><button className="crm-btn" onClick={closeCreate}>取消</button><button className="crm-btn crm-btn-primary" disabled={createMutation.isPending || updateMutation.isPending || updateDetailsMutation.isPending || uploadPhotoMutation.isPending} onClick={submitForm}>{editingRow ? "保存修改" : form.status === "in_transit" ? "保存为在途" : "确认入库"}</button></div>
        </div>
        </div>
      </Modal>}

      {confirmBulkClose && <ConfirmDialog title="放弃本次录入？" description="未录入内容将丢失。" confirmLabel="放弃录入" busy={bulkBusy} onCancel={() => setConfirmBulkClose(false)} onConfirm={() => { setConfirmBulkClose(false); setBulkDirty(false); setFormOpen(false); }} />}

      {receiveRow && <Modal onClose={() => setReceiveRow(null)} width="520px" label="确认入库"><h3 className="text-[18px] font-semibold">确认入库</h3><p className="text-[12px] text-[#8A94A3] mt-1 mb-5">{receiveRow.slipNo} · {receiveRow.partNumber} · 计划 {fmtQty(receiveRow.qty)} 件</p><div className="space-y-4"><Field label="入库日期" required><input type="date" className="crm-input w-full" value={receiveForm.actualInboundDate} onChange={event => setReceiveForm(value => ({ ...value, actualInboundDate: event.target.value }))} /></Field><Field label="入库数量" required><input type="number" min={1} max={MAX_INBOUND_QTY} step={1} className="crm-input w-full" value={receiveForm.actualQty} onChange={event => setReceiveForm(value => ({ ...value, actualQty: event.target.value }))} /></Field><Field label="仓位" required><input className="crm-input w-full" placeholder="如：A区-03-12" value={receiveForm.location} onChange={event => setReceiveForm(value => ({ ...value, location: event.target.value }))} /></Field></div><div className="flex justify-end gap-2.5 mt-6"><button className="crm-btn" onClick={() => setReceiveRow(null)}>取消</button><button className="crm-btn crm-btn-primary" disabled={receiveMutation.isPending} onClick={submitReceive}>确认入库</button></div></Modal>}

      {cancelRow && <Modal onClose={() => setCancelRow(null)} width="520px" label="作废入库单"><h3 className="text-[18px] font-semibold">作废入库单</h3><p className="mt-1 text-[12px] text-[#8A94A3]">{cancelRow.slipNo} · {cancelRow.partNumber}</p>{cancelRow.status === "received" && <div className="mt-4 rounded-lg bg-[#fff4e5] px-4 py-3 text-[12px] text-[#8a4b08]">将冲销库存；有后续变动时无法作废。</div>}{cancelHasPayment && <div className="mt-4 rounded-lg border border-[#F1D6A8] bg-[#FFF9EF] px-4 py-3 text-[12px] text-[#8A4B08]"><div>已付款 ¥{formatInboundMoney(cancelRow.paidAmount)}，退款在线下处理。</div><label className="mt-2 flex items-center gap-2 font-medium"><input type="checkbox" checked={cancelRefundConfirmed} onChange={event => setCancelRefundConfirmed(event.target.checked)} />已确认线下退款</label></div>}<Field label="作废原因" required><textarea className="crm-input h-[86px] w-full resize-none" maxLength={255} value={cancelReason} onChange={event => setCancelReason(event.target.value)} placeholder="作废原因" /></Field><div className="mt-6 flex justify-end gap-2.5"><button className="crm-btn" onClick={() => setCancelRow(null)}>取消</button><button className="crm-btn crm-btn-primary" disabled={cancelMutation.isPending || cancelReason.trim().length < 2 || cancelHasPayment && !cancelRefundConfirmed} onClick={submitCancel}>确认作废</button></div></Modal>}

      {batchCancelScope && batchCancelPreview && <Modal onClose={() => { if (!cancelManyMutation.isPending) { setBatchCancelScope(null); setBatchCancelPreview(null); } }} width="560px" label="批量作废"><h3 className="text-[18px] font-semibold">{"bulkBatchId" in batchCancelScope ? "作废本批" : "批量作废"}</h3><p className="mt-1 text-[12px] text-[#8A94A3]">共 {batchCancelPreview.count} 单{batchCancelPreview.ignoredCount ? `，忽略已作废 ${batchCancelPreview.ignoredCount} 单` : ""}</p><div className="mt-4 rounded-lg bg-[#fff4e5] px-4 py-3 text-[12px] text-[#8a4b08]">将冲销库存；有后续变动时整批不作废。</div>{batchCancelPreview.paidCount > 0 && <div className="mt-3 rounded-lg border border-[#F1D6A8] bg-[#FFF9EF] px-4 py-3 text-[12px] text-[#8A4B08]"><div>已付款 {batchCancelPreview.paidCount} 单，共 ¥{formatInboundMoney(batchCancelPreview.paidAmount)}。</div><label className="mt-2 flex items-center gap-2 font-medium"><input type="checkbox" checked={batchRefundConfirmed} onChange={event => setBatchRefundConfirmed(event.target.checked)} />已确认线下退款</label></div>}<Field label="作废原因" required><textarea className="crm-input h-[86px] w-full resize-none" maxLength={255} value={batchCancelReason} onChange={event => setBatchCancelReason(event.target.value)} placeholder="作废原因" /></Field><div className="mt-6 flex justify-end gap-2.5"><button className="crm-btn" disabled={cancelManyMutation.isPending} onClick={() => { setBatchCancelScope(null); setBatchCancelPreview(null); }}>取消</button><button className="crm-btn crm-btn-primary" disabled={cancelManyMutation.isPending || batchCancelReason.trim().length < 2 || batchCancelPreview.paidCount > 0 && !batchRefundConfirmed} onClick={submitBatchCancel}>{cancelManyMutation.isPending ? "作废中…" : "确认作废"}</button></div></Modal>}

      {paymentRow && currentPaymentOrder && <Modal onClose={() => setPaymentRow(null)} width="720px" label="采购付款"><div className="flex items-start justify-between gap-4"><div><h3 className="text-[18px] font-semibold">采购付款</h3><p className="mt-1 text-[12px] text-[#8A94A3]">{currentPaymentOrder.slipNo} · {currentPaymentOrder.partNumber}</p></div><span className={`inline-flex rounded px-2 py-1 text-[12px] ${paymentMeta[currentPaymentOrder.paymentCategory].className}`}>{paymentMeta[currentPaymentOrder.paymentCategory].label}</span></div>{paymentHistoryLoading ? <div className="py-10 text-center text-[13px] text-[#8A94A3]">付款记录加载中…</div> : <><div className="mt-5 grid grid-cols-3 gap-3"><div className="rounded-lg border border-[#E3E8EF] p-3"><div className="text-[12px] text-[#8A94A3]">采购货款</div><div className="inbound-payment-total mt-1 text-[15px] font-semibold tabular-nums">{currentPaymentOrder.payableAmount != null ? `¥${formatInboundMoney(currentPaymentOrder.payableAmount)}` : "待补价格"}</div></div><div className="rounded-lg border border-[#E3E8EF] p-3"><div className="text-[12px] text-[#8A94A3]">累计已付</div><div className="inbound-payment-total mt-1 text-[15px] font-semibold text-[#185FA5] tabular-nums">¥{formatInboundMoney(currentPaymentOrder.paidAmount || "0")}</div></div><div className="rounded-lg border border-[#E3E8EF] p-3"><div className="text-[12px] text-[#8A94A3]">待付金额</div><div className="inbound-payment-total mt-1 text-[15px] font-semibold tabular-nums">{currentPaymentOrder.outstandingAmount != null ? `¥${formatInboundMoney(currentPaymentOrder.outstandingAmount)}` : "-"}</div></div></div>{!currentPaymentOrder.paymentTracked && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#F1D6A8] bg-[#FFF9EF] px-4 py-3 text-[12px] text-[#8A4B08]"><span>这是历史单据，平台没有可靠付款资料，暂不推断为未付款。</span>{currentPaymentOrder.status !== "cancelled" && <button className="crm-btn crm-btn-sm" disabled={markPaymentUnpaidMutation.isPending} onClick={() => markPaymentUnpaidMutation.mutate({ id: currentPaymentOrder.id })}>确认当前未付款</button>}</div>}{currentPaymentOrder.status !== "cancelled" && currentPaymentOrder.payableAmount != null && inboundMoneyCents(currentPaymentOrder.outstandingAmount || "0") > BigInt(0) && <div className="mt-4 rounded-lg border border-[#E3E8EF] bg-[#FAFBFC] p-4"><div className="erp-section-title">登记付款</div><div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="本次付款金额" required><div className="relative"><input type="number" min={0.01} max={currentPaymentOrder.outstandingAmount ?? undefined} step="0.01" className="crm-input w-full pl-7 pr-20" value={paymentForm.amount} onChange={event => setPaymentForm(value => ({ ...value, amount: event.target.value }))} /><span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#8A94A3]">¥</span><button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-[#185FA5]" onClick={() => setPaymentForm(value => ({ ...value, amount: String(currentPaymentOrder.outstandingAmount ?? "") }))}>付清剩余</button></div></Field><Field label="付款日期" required><input type="date" max={todayLocal()} className="crm-input w-full" value={paymentForm.paymentDate} onChange={event => setPaymentForm(value => ({ ...value, paymentDate: event.target.value }))} /></Field></div><input className="crm-input mt-3 w-full" maxLength={255} placeholder="付款备注（选填）" value={paymentForm.note} onChange={event => setPaymentForm(value => ({ ...value, note: event.target.value }))} /><div className="mt-3 flex justify-end"><button className="crm-btn crm-btn-primary" disabled={recordPaymentMutation.isPending} onClick={submitPayment}>{recordPaymentMutation.isPending ? "保存中…" : "确认登记"}</button></div></div>}<div className="mt-5"><div className="erp-section-title">付款记录</div><div className="mt-2 overflow-x-auto rounded-lg border border-[#E3E8EF]"><table className="crm-table"><thead><tr><th>付款日期</th><th className="inbound-numeric">金额</th><th>登记人</th><th>备注</th><th>状态</th><th className="inbound-actions">操作</th></tr></thead><tbody>{!paymentData?.entries?.length ? <tr><td colSpan={6} className="py-8 text-center text-[#8A94A3]">暂无付款记录</td></tr> : paymentData.entries.map(entry => { const refunded = entry.voidReason?.startsWith("线下退款："); return <tr key={entry.id} className={entry.voidedAt ? "opacity-55" : ""}><td>{fmtDate(entry.paymentDate)}</td><td className="inbound-numeric tabular-nums">¥{formatInboundMoney(entry.amount)}</td><td>{entry.actorName}</td><td className="max-w-[160px] truncate" title={entry.voidReason || entry.note || ""}>{entry.voidReason || entry.note || "-"}</td><td>{entry.voidedAt ? <span className={refunded ? "text-[#666]" : "text-[#B42318]"}>{refunded ? "已线下退款" : "已作废"}</span> : <span className="text-[#1B7F4B]">有效</span>}</td><td className="inbound-actions">{!entry.voidedAt && <button className="text-[12px] text-[#B42318]" disabled={voidPaymentMutation.isPending} onClick={() => requestVoidPayment(entry.id, entry.amount)}>作废</button>}</td></tr>; })}</tbody></table></div></div></>}<div className="mt-5 flex justify-end"><button className="crm-btn" onClick={() => setPaymentRow(null)}>关闭</button></div></Modal>}
      {voidPaymentEntry && <Modal onClose={() => setVoidPaymentEntry(null)} width="480px" label="作废付款记录"><h3 className="text-[18px] font-semibold">作废付款记录</h3><p className="mt-1 text-[12px] text-[#8A94A3]">金额 ¥{formatInboundMoney(voidPaymentEntry.amount)}。仅限录入错误。</p><Field label="作废原因" required><textarea className="crm-input h-[86px] w-full resize-none" maxLength={255} placeholder="如：金额录入错误" value={voidPaymentReason} onChange={event => setVoidPaymentReason(event.target.value)} /></Field><div className="mt-6 flex justify-end gap-2.5"><button className="crm-btn" onClick={() => setVoidPaymentEntry(null)}>取消</button><button className="crm-btn crm-btn-primary" disabled={voidPaymentMutation.isPending} onClick={submitVoidPayment}>确认作废</button></div></Modal>}

      {detailRow && <Modal onClose={() => setDetailRow(null)} width="650px" label="入库单详情"><div className="flex justify-between"><h3 className="text-[18px] font-semibold">入库单详情</h3><span className={`rounded px-2 py-1 text-[12px] ${statusMeta[detailRow.status].className}`}>{statusMeta[detailRow.status].label}</span></div><table className="crm-detail-table mt-4"><tbody>
        <tr><td className="label-cell">入库单号</td><td className="text-[#185FA5]">{detailRow.slipNo}</td><td className="label-cell">预计到货</td><td>{fmtDate(detailRow.inboundDate)}</td></tr>
        <tr><td className="label-cell">料号/型号</td><td>{detailRow.partNumber}</td><td className="label-cell">品牌</td><td>{detailRow.brand || "-"}</td></tr>
        <tr><td className="label-cell">计划数量</td><td className="inbound-numeric">{fmtQty(detailRow.qty)}</td><td className="label-cell">入库数量</td><td className="inbound-numeric">{detailRow.actualQty ? fmtQty(detailRow.actualQty) : "-"}</td></tr>
        <tr><td className="label-cell">入库日期</td><td>{fmtDate(detailRow.actualInboundDate) || "-"}</td><td className="label-cell">年份/DC</td><td>{detailRow.prodYear || "-"}</td></tr>
        <InboundPricingRows row={detailRow} />
        <InboundPaymentRows row={detailRow} />
        <tr><td className="label-cell">仓位</td><td>{detailRow.location || "-"}</td><td className="label-cell">供应商</td><td>{detailRow.supplierName || "-"}</td></tr>
        <tr><td className="label-cell">仓库地址</td><td>{detailRow.warehouseAddress || "-"}</td><td className="label-cell">采购地区</td><td>{detailRow.procurementRegion || "-"}</td></tr>
        <tr><td className="label-cell">采购员</td><td>{detailRow.operator || "-"}</td><td className="label-cell">供应商联系人</td><td>{detailRow.supplierContact || "-"}</td></tr>
        <tr><td className="label-cell">封装</td><td>{detailRow.packageType || "-"}</td><td className="label-cell">批次/Lot</td><td>{detailRow.lotNumber || "-"}</td></tr>
        <tr><td className="label-cell">备注</td><td colSpan={3}>{detailRow.note || "-"}</td></tr>
        {detailRow.cancelReason && <tr><td className="label-cell">作废原因</td><td colSpan={3}>{detailRow.cancelReason}</td></tr>}
      </tbody></table>{detailPhotosLoading ? <div className="mt-4 text-[12px] text-[#999]">照片加载中…</div> : detailPhotos.length > 0 && <div className="mt-4"><div className="text-[12px] text-[#666] mb-2">入库实拍照片</div><div className="grid grid-cols-5 gap-2">{detailPhotos.map((photo, index) => <a key={photo.key} href={photo.url} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-md border bg-[#f7f7f7]"><img src={photo.url} alt={`入库实拍${index + 1}`} className="h-full w-full object-cover" /></a>)}</div></div>}<div className="flex flex-wrap justify-end gap-2.5 mt-5"><button className="crm-btn" onClick={() => { setDetailRow(null); openPayment(detailRow); }}>付款记录</button>{detailRow.status === "in_transit" && <button className="crm-btn crm-btn-primary" onClick={() => { setDetailRow(null); openReceive(detailRow); }}>确认入库</button>}{detailRow.status === "received" && <button className="crm-btn crm-btn-up" onClick={() => doPrint([detailRow])}>打印验收单</button>}{detailRow.status !== "cancelled" && detailRow.bulkBatchId && <button className="crm-btn text-[#B42318]" disabled={batchCancelLoading} onClick={() => { setDetailRow(null); requestCancelImportBatch(detailRow); }}>作废本批</button>}{detailRow.status !== "cancelled" && <button className="crm-btn" onClick={() => { setDetailRow(null); requestCancel(detailRow); }}>作废</button>}<button className="crm-btn" onClick={() => setDetailRow(null)}>关闭</button></div></Modal>}

      {printRows.length > 0 && <><div className="fixed inset-0 z-[60] bg-black/45 flex items-center justify-center p-4 no-print" onClick={() => setPrintRows([])}><div className="bg-white rounded-xl w-[820px] max-w-full max-h-[92vh] overflow-y-auto p-8" onClick={event => event.stopPropagation()}><InboundSlip rows={printRows} companyName={company?.companyName || "51电子网企业用户"} address={company?.regAddress || ""} /><div className="flex justify-end gap-2.5 mt-6"><button className="crm-btn" onClick={() => setPrintRows([])}>关闭</button><button className="crm-btn crm-btn-primary" onClick={() => window.print()}>打印</button></div></div></div><div className="print-area hidden print:block"><InboundSlip rows={printRows} companyName={company?.companyName || "51电子网企业用户"} address={company?.regAddress || ""} /></div></>}
      </AdminPage>
    </PlatformLayout>
  );
}

function Modal({ children, onClose, width, label, className = "" }: { children: React.ReactNode; onClose: () => void; width: string; label?: string; className?: string }) {
  return <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4" onClick={onClose}><div role={label ? "dialog" : undefined} aria-modal={label ? true : undefined} aria-label={label} className={`inbound-modal aui-dialog bg-white rounded-lg max-w-full max-h-[90vh] overflow-y-auto p-4 sm:p-7 ${className}`} style={{ width }} onClick={event => event.stopPropagation()}>{children}</div></div>;
}
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <div className="inbound-field mt-4"><label className="erp-field-label mb-1.5 block">{label}{required && <span className="ml-1 text-[#C63C3C]">*</span>}</label>{children}</div>;
}
function includedUnitCost(row: InboundRow) { if (row.unitCostTaxIncluded != null) return Number(row.unitCostTaxIncluded); return row.unitCost != null && row.unitCostBasis !== CNY_TAX_EXCLUDED ? Number(row.unitCost) : null; }
function InboundPricingRows({ row }: { row: InboundRow }) {
  if (row.unitCost == null) return <tr><td className="label-cell">采购单价</td><td>-</td><td className="label-cell">税率</td><td>-</td></tr>;
  const qty = Number(row.actualQty ?? row.qty), included = includedUnitCost(row), excluded = row.unitCostTaxExcluded != null ? Number(row.unitCostTaxExcluded) : null, taxAmount = included != null && excluded != null ? (included - excluded) * qty : null;
  return <><tr><td className="label-cell">录入单价</td><td className="inbound-numeric">¥{fmtUnitCost(Number(row.unitCost))}（{priceBasisLabel(row.unitCostBasis, true)}）{Boolean(row.priceMissing) && <span className="ml-1 text-[11px] text-amber-700">未录价格</span>}</td><td className="label-cell">税率</td><td className="inbound-numeric">{row.taxRate != null ? `${Number(row.taxRate)}%` : "历史数据未记录"}</td></tr><tr><td className="label-cell">含税单价</td><td className="inbound-numeric">{included != null ? `¥${fmtUnitCost(included)}` : "-"}</td><td className="label-cell">未税单价</td><td className="inbound-numeric">{excluded != null ? `¥${fmtUnitCost(excluded)}` : "-"}</td></tr><tr><td className="label-cell">含税金额</td><td className="inbound-numeric">{included != null ? `¥${fmtMoney(included * qty)}` : "-"}</td><td className="label-cell">税额</td><td className="inbound-numeric">{taxAmount != null ? `¥${fmtMoney(taxAmount)}` : "-"}</td></tr></>;
}
function InboundPaymentRows({ row }: { row: InboundRow }) {
  const meta = paymentMeta[row.paymentCategory];
  return <><tr><td className="label-cell">付款状态</td><td><span className={`inline-flex rounded px-2 py-0.5 text-[11px] ${meta.className}`}>{meta.label}</span></td><td className="label-cell">付款比例</td><td className="inbound-numeric">{row.paymentPercentage != null ? `${row.paymentPercentage}%` : "-"}</td></tr><tr><td className="label-cell">已付金额</td><td className="inbound-numeric">¥{formatInboundMoney(row.paidAmount || "0")}</td><td className="label-cell">待付金额</td><td className="inbound-numeric">{row.outstandingAmount != null ? `¥${formatInboundMoney(row.outstandingAmount)}` : "-"}</td></tr></>;
}
function InboundSlip({ rows, companyName, address }: { rows: InboundRow[]; companyName: string; address: string }) {
  const total = rows.reduce((acc, row) => { const qty = Number(row.actualQty ?? row.qty), unitCost = includedUnitCost(row); return { qty: acc.qty + qty, amount: acc.amount + (unitCost != null ? unitCost * qty : 0) }; }, { qty: 0, amount: 0 });
  const first = rows[0];
  return <div className="print-slip"><div className="text-center"><div className="text-[20px] font-bold">{companyName}</div>{address && <div className="text-[12px] mt-1">地址：{address}</div>}</div><div className="text-center mt-3 mb-2"><span className="text-[17px] font-bold border-b-2 border-black px-6 pb-0.5 tracking-[6px]">入库验收单</span></div><div className="flex justify-between text-[12px] mt-3 mb-1"><span>单号：{rows.map(row => row.slipNo).join("、")}</span><span>入库日期：{fmtDateCn(first?.actualInboundDate || first?.inboundDate)}</span></div><div className="grid grid-cols-3 gap-2 text-[12px] mb-2"><span>供应商：{first?.supplierName || "　"}</span><span>采购员：{first?.operator || "　"}</span><span>仓位：{first?.location || "　"}</span></div><table className="slip-table"><thead><tr><th>序号</th><th>料号/型号</th><th>品牌</th><th>年份/DC</th><th>数量</th><th>含税单价</th><th>含税金额</th></tr></thead><tbody>{rows.map((row, index) => { const qty = Number(row.actualQty ?? row.qty), unitCost = includedUnitCost(row); return <tr key={row.id}><td>{index + 1}</td><td>{row.partNumber}</td><td>{row.brand || ""}</td><td>{row.prodYear || ""}</td><td>{fmtQty(qty)}</td><td>{unitCost != null ? unitCost.toFixed(6).replace(/\.?0+$/, "") : ""}</td><td>{unitCost != null ? (unitCost * qty).toFixed(2) : ""}</td></tr>; })}<tr><td className="font-bold">合计</td><td /><td /><td /><td className="font-bold">{fmtQty(total.qty)}</td><td /><td className="font-bold">{rows.some(row => includedUnitCost(row) != null) ? total.amount.toFixed(2) : ""}</td></tr></tbody></table><div className="text-[11px] mt-2">注意事项：来料须经品质检验合格后方可入库；数量以实收为准。</div><div className="flex justify-between text-[12px] mt-4"><span>送货人：__________</span><span>仓库验收人：__________</span><span>品质检验员：__________</span><span>采购负责人：__________</span></div></div>;
}
function fmtDateCn(value?: string | null) { const [year, month, day] = fmtDate(value).split("-"); return year ? `${year}年${month}月${day}日` : ""; }
