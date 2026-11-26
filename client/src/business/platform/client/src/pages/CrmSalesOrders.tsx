import { BusinessSalesOrdersPage } from './BusinessSalesOrdersPage';
import {
  usePageMemory,
  useRememberedState,
  freshListOptions,
  useRestoringListQuery,
} from "../hooks/usePageMemory";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { useLocation, useSearch } from "wouter";
import PlatformLayout from "../../../../BusinessContentFrame";
import { trpc } from "../../../../api/business-trpc";
import { useBusinessScope } from "../../../../BusinessScope";
import { useAdminNewInformationContextRows } from "../../../../../lib/adminNewInformation";
import { AdminNewInformationRowBadge } from "../../../../../components/admin/AdminNewInformationBadge";
import {
  AdminPage,
  AdminPageHeader,
  AdminFilterBar,
  AdminDataPanel,
} from "@/components/admin/UnifiedAdminPage";
import { ConfirmDialog } from "../components/customers/ConfirmDialog";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Textarea } from "../components/ui/textarea";
import "./CrmSalesOrders.css";
import { CompanyStockShipmentForm } from "../components/companyStock/CompanyStockShipmentForm";
import {
  CompanyStockOrderForm,
  emptyCompanyStockDraft,
  type CompanyStockFormDraft,
} from "../components/companyStock/CompanyStockOrderForm";
import { useSalesOrderDraft } from "../hooks/useSalesOrderDraft";
import {
  parseSalesOrderEntryDraft,
  serializeSalesOrderEntryDraft,
} from "../lib/salesOrderEntryDraft";
import type { SalesOrderDraftPayload } from "../../../shared/crmSalesOrderDrafts";
import { hasLockedSalesOrderDraft, isUnstartedSalesOrderDraft } from "../lib/salesOrderDraftRecovery";
import {
  SalesCustomerPicker,
  type SalesCustomer,
} from "../components/companyStock/SalesCustomerPicker";
import { SalesExpensesEditor } from "../components/companyStock/SalesExpensesEditor";
import { SalesProfitSummary } from "../components/companyStock/SalesProfitSummary";
import {
  useCompanyStockScope,
  useCompanyStockSession,
} from "../components/companyStock/useCompanyStockSession";
import {
  orderOwnerLabel,
  orderMaterialLabel,
} from "../components/companyStock/companyStockSales";
function OrderMaterialSummary({
  order,
}: {
  order: { itemCount?: number; orderedQty?: number };
}) {
  return <span>{orderMaterialLabel(order)}</span>;
}

import {
  customerMatches,
  customerPageMatches,
} from "../hooks/useSalesOrderSession";
import {
  CRM_SALES_ORDER_STATUS_LABELS,
  CRM_SALES_PAYMENT_METHOD_LABELS,
  CRM_SALES_PAYMENT_STATUS_LABELS,
  CRM_SALES_SHIPMENT_STATUS_LABELS,
  formatSalesOrderAmount,
  canonicalSalesOrderCreatePayload,
  calculateSalesOrderAmounts,
  salesOrderCreateSchema,
  salesOrderCancelSchema,
  type CrmSalesPaymentMethod,
  type SalesOrderDemandCandidate,
  type SalesOrderPaymentInput,
} from "../../../shared/crmSalesOrders";

const PAGE_SIZE = 20;
const buttonClass =
  "crm-sales-orders-control bg-[#185FA5] px-3 text-xs text-white hover:bg-[#0C447C]";
const secondaryButtonClass =
  "crm-sales-orders-control border-slate-300 bg-white px-3 text-xs text-slate-700 shadow-none hover:bg-slate-50";
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
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);
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

export type CustomerSalesOrderIntent = {
  mode?: "create" | "view";
  demandNo: string;
  demandId?: number;
  nonce: string | number;
};
export type CustomerSalesOrdersProps = {
  customer: { id: number; name: string; archivedAt?: string | Date | null };
  /** UI identity only, not an authorization grant; include actor/enterprise/customer revisions. */
  contextIdentityKey: string | number | null;
  canRead?: boolean;
  canWrite?: boolean;
  readOnly?: boolean;
  intent?: CustomerSalesOrderIntent | null;
  onIntentHandled?: (nonce: string | number) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onOrderChanged?: () => void;
};
type StatePair<T> = [T, Dispatch<SetStateAction<T>>];
type OrderListState = {
  draftKeyword: StatePair<string>;
  keyword: StatePair<string>;
  status: StatePair<StatusFilter>;
  page: StatePair<number>;
  selectedId: StatePair<number | null>;
};
/** Backward-compatible standalone route; only this wrapper reads the route's page memory. */
export default function CrmSalesOrders() {
  const ready = usePageMemory();
  const scope = useCompanyStockScope();
  const state: OrderListState = {
    draftKeyword: useRememberedState("draftKeyword", ""),
    keyword: useRememberedState("keyword", ""),
    status: useRememberedState<StatusFilter>("status", "all"),
    page: useRememberedState("page", 1),
    selectedId: useRememberedState<number | null>("selectedId", null),
  };
  return (
    <PlatformLayout>
      <BusinessSalesOrdersPage key={scope.identityKey} ready={ready} state={state} />
    </PlatformLayout>
  );
}
/** Caller must prove sales.business_orders; customer read access never implies order access. */
export function CustomerSalesOrders(props: CustomerSalesOrdersProps) {
  const scope = useCompanyStockScope();
  if (
    !props.canRead ||
    !Number.isSafeInteger(props.customer.id) ||
    props.customer.id <= 0 ||
    props.contextIdentityKey == null ||
    props.contextIdentityKey === ""
  ) {
    return (
      <div className="crm-sales-orders-access-note" role="status">
        客户查看权限不包含销售订单权限。请联系管理员授予销售业务订单权限。
      </div>
    );
  }
  const identity = JSON.stringify([
    scope.identityKey,
    props.contextIdentityKey,
    props.customer.id,
    props.canRead,
    props.canWrite === true,
    props.readOnly === true,
    Boolean(props.customer.archivedAt),
  ]);
  return <CustomerOrdersSession key={identity} {...props} />;
}
function CustomerOrdersSession(props: CustomerSalesOrdersProps) {
  const state: OrderListState = {
    draftKeyword: useState(""),
    keyword: useState(""),
    status: useState<StatusFilter>("all"),
    page: useState(1),
    selectedId: useState<number | null>(null),
  };
  return <SalesOrdersContent ready state={state} embedded={props} />;
}
export function SalesOrdersContent({
  ready,
  state,
  embedded,
}: {
  ready: boolean;
  state: OrderListState;
  embedded?: CustomerSalesOrdersProps;
}) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const search = useSearch();
  const businessScope = useBusinessScope();
  const companyScope = useCompanyStockScope();
  const orderDraft = useSalesOrderDraft();
  const draftHydrated = useRef(false);
  const suppressDraftWrite = useRef(false);
  const [draftApplied, setDraftApplied] = useState(false);
  const [draftRestoreError, setDraftRestoreError] = useState("");
  const [draftConflict, setDraftConflict] = useState<{
    payload: SalesOrderDraftPayload;
    title: string;
    message: string;
    canStartNew: boolean;
  } | null>(null);
  const [draftResolutionBusy, setDraftResolutionBusy] = useState(false);
  const [draftResolutionError, setDraftResolutionError] = useState("");
  const draftResolutionRef = useRef(false);
  const draftPayloadRef = useRef<SalesOrderDraftPayload | null>(null);
  const deepLinkedDemandNoRef = useRef("");
  const deepLinkedDemandIdRef = useRef<number | undefined>(undefined);
  const handledIntentRef = useRef<string | number | null>(null);
  const [draftKeyword, setDraftKeyword] = state.draftKeyword;
  const [keyword, setKeyword] = state.keyword;
  const [status, setStatus] = state.status;
  const [page, setPage] = state.page;
  const [selectedId, setSelectedId] = state.selectedId;
  const customerId = embedded?.customer.id;
  const canWrite =
    companyScope.ready &&
    ready &&
    (!embedded ||
      (embedded.canRead === true &&
        embedded.canWrite === true &&
        !embedded.readOnly &&
        !embedded.customer.archivedAt));
  const session = useCompanyStockSession(canWrite);
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryCustomer, setEntryCustomer] = useState<SalesCustomer | null>(
    null
  );
  const [customerSearch, setCustomerSearch] = useState("");
  const [sourceType, setSourceType] = useState<"company_stock" | "demand">(
    embedded ? "demand" : "company_stock"
  );
  const [stockDirty, setStockDirty] = useState(false);
  const [stockBusy, setStockBusy] = useState(false);
  const [stockLocked, setStockLocked] = useState(false);
  const [stockDraft, setStockDraft] = useState<CompanyStockFormDraft>(
    emptyCompanyStockDraft
  );
  const [expenseDirty, setExpenseDirty] = useState(false);
  const selectedCustomer = embedded?.customer ?? entryCustomer;
  const candidateCustomerId = selectedCustomer?.id;
  const [candidateKeyword, setCandidateKeyword] = useState("");
  const [candidateApplied, setCandidateApplied] = useState("");
  const [candidatePage, setCandidatePage] = useState(1);
  const [selectedDemand, setSelectedDemand] =
    useState<SalesOrderDemandCandidate | null>(null);
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
  const [uncertainCancellation, setUncertainCancellation] = useState<ReturnType<
    typeof salesOrderCancelSchema.parse
  > | null>(null);
  const [pendingDemandRequest, setPendingDemandRequest] = useState<ReturnType<
    typeof salesOrderCreateSchema.parse
  > | null>(null);
  const uncertainSave = Boolean(pendingDemandRequest);
  const demandRetryUnknown = useRef(false);
  const [entryError, setEntryError] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [shipOpen, setShipOpen] = useState(false);
  const [companyShipDirty, setCompanyShipDirty] = useState(false);
  const [companyShipBusy, setCompanyShipBusy] = useState(false);
  const [payMethod, setPayMethod] = useState<CrmSalesPaymentMethod>("bank");
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(todayLocal());
  const [payNote, setPayNote] = useState("");
  const [uncertainPayment, setUncertainPayment] =
    useState<SalesOrderPaymentInput | null>(null);
  const [shipMethod, setShipMethod] = useState<"express" | "pickup">("express");
  const [expressCo, setExpressCo] = useState("");
  const [expressNo, setExpressNo] = useState("");
  const [shipNote, setShipNote] = useState("");
  const [shipQtys, setShipQtys] = useState<Record<string, string>>({});
  const payRequestIdRef = useRef(newRequestId());
  const shipRequestIdRef = useRef(newRequestId());
  const formTouched = Boolean(
    entryCustomer ||
      stockDirty ||
      selectedDemand ||
      lines.some(line => line.qty || line.agreedUnitPrice) ||
      dueDate ||
      confirmationNote ||
      customerConfirmed
  );

  const buildEntryPayload = (
    company = stockDraft,
    pending = pendingDemandRequest
  ) => {
    const payload = serializeSalesOrderEntryDraft({
      customer: selectedCustomer ?? null,
      source: sourceType,
      selectedDemand,
      lines,
      dueDate,
      confirmationNote,
      customerConfirmed,
      pendingRequest: pending,
      company,
    });
    return { ...payload, form: { ...payload.form, customerSearch } };
  };
  useEffect(() => {
    if (!orderDraft.restored || draftHydrated.current || draftResolutionBusy) return;
    draftHydrated.current = true;
    const saved = orderDraft.initialPayload;
    if (!saved) {
      setDraftApplied(true);
      return;
    }
    try {
      const restored = parseSalesOrderEntryDraft(saved);
      if (isUnstartedSalesOrderDraft(saved)) {
        // Keep the hook's proved CAS revision and original payload; no delete/reset-to-zero.
        // Only real later input may replace this unstarted form through normal persistence.
        draftPayloadRef.current = null;
        setDraftApplied(true);
        return;
      }
      if (embedded && restored.customer?.id !== embedded.customer.id) {
        const locked = hasLockedSalesOrderDraft(saved);
        const unassociated = !restored.customer;
        const title = locked
          ? "原订单保存结果需要核验"
          : unassociated ? "有未关联客户的未完成草稿" : "有其他客户的未完成草稿";
        const message = locked
          ? "原请求或清理状态仍需核验，已保留原内容和防重复标识。请前往业务订单处理，不能清除后重新下单。"
          : unassociated
            ? "草稿中已有输入，但尚未选择客户。可继续原草稿，或先完整保留再录入当前客户订单。"
            : "为避免订单串客户，未将原草稿载入当前客户。可继续原草稿，或先完整保留再录入当前客户订单。";
        setDraftConflict({ payload: saved, title, message, canStartNew: !locked });
        setDraftRestoreError(title);
        setEntryOpen(true);
        return;
      }
      setEntryCustomer(restored.customer);
      setCustomerSearch(
        typeof saved.form?.customerSearch === "string"
          ? saved.form.customerSearch
          : ""
      );
      setSourceType(restored.source);
      setSelectedDemand(restored.selectedDemand);
      setLines(restored.lines);
      setDueDate(restored.dueDate);
      setConfirmationNote(restored.confirmationNote);
      setCustomerConfirmed(restored.customerConfirmed);
      setPendingDemandRequest(restored.pendingRequest);
      demandRetryUnknown.current = Boolean(restored.pendingRequest);
      setStockDraft(restored.company);
      setStockLocked(Boolean(restored.company.pendingRequest));
      draftPayloadRef.current = saved;
      setEntryOpen(true);
      setDraftApplied(true);
    } catch (failure) {
      setDraftRestoreError(
        failure instanceof Error
          ? failure.message
          : "草稿结构异常，已保留原内容。"
      );
      setEntryOpen(true);
    }
  }, [orderDraft.restored, orderDraft.initialPayload, embedded, draftResolutionBusy]);
  useEffect(() => {
    if (
      !draftHydrated.current ||
      !draftApplied ||
      !entryOpen ||
      suppressDraftWrite.current ||
      draftRestoreError
    )
      return;
    const payload = buildEntryPayload();
    if (isUnstartedSalesOrderDraft(payload, embedded?.customer.id)) return;
    draftPayloadRef.current = payload;
    void orderDraft.persist(payload).catch(() => undefined);
  }, [
    draftApplied,
    entryOpen,
    entryCustomer,
    customerSearch,
    sourceType,
    selectedDemand,
    lines,
    dueDate,
    confirmationNote,
    customerConfirmed,
    stockDraft,
    pendingDemandRequest,
    draftRestoreError,
    orderDraft.persist,
  ]);

  const listInput = useMemo(
    () => ({
      keyword,
      ...(customerId === undefined ? {} : { customerId }),
      ...(status === "all" ? {} : { status }),
      page,
      pageSize: PAGE_SIZE,
    }),
    [customerId, keyword, page, status]
  );
  const rawListQuery = useRestoringListQuery(
    trpc.crmSalesOrder.list.useQuery(listInput, freshListOptions({}, ready)),
    !embedded
  );
  const rawDetailQuery = trpc.crmSalesOrder.get.useQuery(
    {
      id: selectedId ?? 1,
      ...(customerId === undefined ? {} : { customerId }),
    },
    { enabled: selectedId != null, staleTime: 0, refetchOnMount: "always" }
  );
  const rawCandidatesQuery = trpc.crmSalesOrder.candidates.useQuery(
    {
      keyword: candidateApplied,
      ...(candidateCustomerId === undefined
        ? {}
        : { customerId: candidateCustomerId }),
      page: candidatePage,
      pageSize: 10,
    },
    {
      enabled: entryOpen && canWrite && sourceType === "demand" && !draftRestoreError,
      staleTime: 0,
      refetchOnMount: "always",
    }
  );
  // Reject the whole response, including its count, rather than filtering a foreign customer's rows locally.
  const scopeError = new Error(
    "响应与当前客户或订单不一致，已停止展示与操作，请刷新重试。"
  );
  const listMismatch = !customerPageMatches(rawListQuery.data, customerId);
  const detailMismatch =
    rawDetailQuery.data != null &&
    (!customerMatches(rawDetailQuery.data, customerId) ||
      rawDetailQuery.data.id !== selectedId);
  const candidateMismatch = !customerPageMatches(
    rawCandidatesQuery.data,
    candidateCustomerId
  );
  const listQuery = {
    ...rawListQuery,
    data:
      listMismatch ||
      (embedded &&
        (rawListQuery.isError ||
          rawListQuery.isFetching ||
          rawListQuery.isFetchedAfterMount === false))
        ? undefined
        : rawListQuery.data,
    isError: rawListQuery.isError || listMismatch,
    error: listMismatch ? scopeError : rawListQuery.error,
  };
  const detailQuery = {
    ...rawDetailQuery,
    data:
      detailMismatch ||
      !companyScope.ready ||
      selectedId == null ||
      !rawDetailQuery.isSuccess ||
      rawDetailQuery.isError ||
      rawDetailQuery.isFetching ||
      rawDetailQuery.isPlaceholderData ||
      rawDetailQuery.isFetchedAfterMount === false
        ? undefined
        : rawDetailQuery.data,
    isError: rawDetailQuery.isError || detailMismatch,
    error: detailMismatch ? scopeError : rawDetailQuery.error,
  };
  const candidatesQuery = {
    ...rawCandidatesQuery,
    data:
      candidateMismatch ||
      (embedded &&
        (rawCandidatesQuery.isError ||
          rawCandidatesQuery.isFetching ||
          rawCandidatesQuery.isFetchedAfterMount === false))
        ? undefined
        : rawCandidatesQuery.data,
    isError: rawCandidatesQuery.isError || candidateMismatch,
    error: candidateMismatch ? scopeError : rawCandidatesQuery.error,
  };
  // Only a proved response may supply a shipment context. Keep that exact component
  // mounted during background fetch/error; it remains read-only until reverified.
  const shipmentIdentity = `${companyScope.identityKey}:${selectedId}`;
  const shipmentContext = useRef<{
    identity: string;
    order: NonNullable<typeof rawDetailQuery.data>;
  } | null>(null);
  if (shipmentContext.current?.identity !== shipmentIdentity)
    shipmentContext.current = null;
  if (detailQuery.data)
    shipmentContext.current = {
      identity: shipmentIdentity,
      order: detailQuery.data,
    };
  const shipmentOrder = shipmentContext.current?.order;
  const pageRows = listQuery.data?.items ?? [];
  const notificationListReady =
    ready &&
    companyScope.ready &&
    listQuery.isSuccess &&
    !listQuery.isError &&
    !listQuery.isFetching &&
    !listQuery.isPlaceholderData &&
    listQuery.isFetchedAfterMount !== false;
  const newInformationRows = useAdminNewInformationContextRows({
    module: "sales",
    refs: notificationListReady
      ? pageRows.map(order => `crm-sales:${order.id}`)
      : [],
    scope: String(businessScope.merchantId),
    listReady: notificationListReady,
  });
  // Preserve server filters/pagination: only the already displayed page is reordered.
  const displayedRows = [...pageRows].sort(
    (a, b) =>
      Number(newInformationRows.getRow(`crm-sales:${b.id}`).isNew) -
      Number(newInformationRows.getRow(`crm-sales:${a.id}`).isNew)
  );
  const totalPages = Math.max(
    1,
    Math.ceil((listQuery.data?.total ?? 0) / PAGE_SIZE)
  );
  const candidatePages = Math.max(
    1,
    Math.ceil((candidatesQuery.data?.total ?? 0) / 10)
  );

  const resetEntry = () => {
    deepLinkedDemandNoRef.current = "";
    deepLinkedDemandIdRef.current = undefined;
    setSelectedDemand(null);
    setEntryCustomer(null);
    setCustomerSearch("");
    setSourceType(embedded ? "demand" : "company_stock");
    setStockDirty(false);
    setStockBusy(false);
    setLines([]);
    setDueDate("");
    setConfirmationNote("");
    setCustomerConfirmed(false);
    setCandidateKeyword("");
    setCandidateApplied("");
    setCandidatePage(1);
    requestIdRef.current = newRequestId();
    requestKeysRef.current.clear();
    setPendingDemandRequest(null);
    setStockDraft(emptyCompanyStockDraft());
    setStockLocked(false);
    setEntryError("");
    demandRetryUnknown.current = false;
  };
  const closeEntry = () => {
    setEntryOpen(false);
  };
  const completeEntry = () => {
    suppressDraftWrite.current = true;
    const saved = draftPayloadRef.current;
    closeEntry();
    resetEntry();
    void orderDraft.clear(saved ?? undefined);
  };
  const requestCloseEntry = () => {
    if (savingRef.current || stockBusy || draftResolutionRef.current) return;
    if (draftPayloadRef.current && !draftRestoreError)
      void orderDraft.persist(draftPayloadRef.current).catch(() => undefined);
    closeEntry();
  };
  const rereadDraft = () => {
    if (draftResolutionRef.current) return;
    draftHydrated.current = false;
    setDraftApplied(false);
    setDraftConflict(null);
    setDraftRestoreError("");
    setDraftResolutionError("");
    orderDraft.retryRestore();
  };
  const resolveDraft = async (archiveId?: string) => {
    if (!session.isWritable() || draftResolutionRef.current || savingRef.current || stockBusy)
      return;
    if (!archiveId && (!draftConflict?.canStartNew || !orderDraft.writable)) return;
    const original = draftConflict?.payload;
    if (!archiveId && !original) return;
    const confirmed = window.confirm(archiveId
      ? "恢复此保留草稿？当前有内容的普通草稿会先另行保留，不会覆盖已有备份。"
      : "原草稿将完整保留在本浏览器，可在业务订单恢复；仅本账号本公司可见，不是跨设备多草稿。确认保留后新建？");
    if (!confirmed) return;
    draftResolutionRef.current = true;
    setDraftResolutionBusy(true);
    setDraftResolutionError("");
    suppressDraftWrite.current = true;
    try {
      if (archiveId) await orderDraft.restorePreserved(archiveId);
      else {
        const next = serializeSalesOrderEntryDraft({
          customer: null,
          source: embedded ? "demand" : "company_stock",
          selectedDemand: null, lines: [], dueDate: "", confirmationNote: "",
          customerConfirmed: false, pendingRequest: null, company: emptyCompanyStockDraft(),
        });
        await orderDraft.replaceOrdinary(original!, next);
      }
      if (!session.isWritable()) return;
      resetEntry();
      draftPayloadRef.current = null;
      draftHydrated.current = false;
      setDraftApplied(false);
      setDraftConflict(null);
      setDraftRestoreError("");
      setEntryOpen(true);
    } catch (failure) {
      setDraftResolutionError(failure instanceof Error ? failure.message : "草稿处理未完成，原内容已保留。");
    } finally {
      suppressDraftWrite.current = false;
      draftResolutionRef.current = false;
      setDraftResolutionBusy(false);
    }
  };
  useEffect(() => {
    if (listQuery.data && page > totalPages) setPage(totalPages);
  }, [listQuery.data, page, totalPages]);
  useEffect(() => {
    if (candidatesQuery.data && candidatePage > candidatePages)
      setCandidatePage(candidatePages);
  }, [candidatePage, candidatePages, candidatesQuery.data]);
  useEffect(() => {
    if (embedded) return;
    const params = new URLSearchParams(search);
    const demandNo = params.get("demandNo")?.trim() ?? "";
    const orderKeyword = params.get("keyword")?.trim() ?? "";
    if (demandNo) {
      deepLinkedDemandNoRef.current = demandNo;
      setSourceType("demand");
      setEntryOpen(true);
      setCandidateKeyword(demandNo);
      setCandidateApplied(demandNo);
      setCandidatePage(1);
      params.delete("demandNo");
      params.set("orderSource", "business");
      navigate(
        `/orders?${params}${typeof window === "undefined" ? "" : window.location.hash}`,
        {
          replace: true,
        }
      );
      return;
    }
    if (orderKeyword) {
      setDraftKeyword(orderKeyword);
      setKeyword(orderKeyword);
      setPage(1);
      params.delete("keyword");
      params.set("orderSource", "business");
      navigate(
        `/orders?${params}${typeof window === "undefined" ? "" : window.location.hash}`,
        {
          replace: true,
        }
      );
    }
  }, [embedded, navigate, search]);

  const createMutation = trpc.crmSalesOrder.create.useMutation({
    onSuccess: result => {
      if (!session.isWritable()) return;
      embedded?.onOrderChanged?.();
      setSelectedId(result.id);
      completeEntry();
      toast.success(
        result.replayed ? "已返回此前保存的销售订单" : "销售订单已录入",
        { description: result.orderNumber }
      );
      void Promise.allSettled([
        utils.crmSalesOrder.list.invalidate(),
        utils.crmSalesOrder.candidates.invalidate(),
      ]);
    },
    onError: error => {
      if (!session.isWritable()) return;
      const knownRejection = [
        "BAD_REQUEST",
        "FORBIDDEN",
        "UNAUTHORIZED",
        "NOT_FOUND",
        "CONFLICT",
      ].includes(error.data?.code ?? "");
      if (knownRejection && !demandRetryUnknown.current)
        setPendingDemandRequest(null);
      else demandRetryUnknown.current = true;
      setEntryError(error.message || "订单保存结果待确认，请核验原请求。");
      void utils.crmSalesOrder.list.invalidate().catch(() => undefined);
    },
    onSettled: () => {
      savingRef.current = false;
    },
  });
  const cancelMutation = trpc.crmSalesOrder.cancel.useMutation({
    onSuccess: () => {
      if (!session.isWritable()) return;
      embedded?.onOrderChanged?.();
      setCancelOpen(false);
      setCancelReason("");
      setCancelError("");
      setUncertainCancellation(null);
      toast.success("订单已取消", {
        description: "未触发库存、支付或发运操作",
      });
      void Promise.allSettled([
        utils.crmSalesOrder.list.invalidate(),
        utils.crmSalesOrder.get.invalidate(),
        utils.crmSalesOrder.candidates.invalidate(),
      ]);
    },
    onError: error => {
      if (!session.isWritable()) return;
      setCancelError(error.message || "取消失败，请刷新后重试");
      if (
        [
          "BAD_REQUEST",
          "FORBIDDEN",
          "UNAUTHORIZED",
          "NOT_FOUND",
          "CONFLICT",
        ].includes(error.data?.code ?? "")
      )
        setUncertainCancellation(null);
      void utils.crmSalesOrder.get.invalidate().catch(() => undefined);
    },
    onSettled: () => {
      cancellingRef.current = false;
    },
  });
  const paymentMutation = trpc.crmSalesOrder.recordPayment.useMutation({
    onSuccess: result => {
      if (!session.isWritable()) return;
      embedded?.onOrderChanged?.();
      setPayOpen(false);
      setPayAmount("");
      setPayNote("");
      setUncertainPayment(null);
      payRequestIdRef.current = newRequestId();
      toast.success(result.replayed ? "已返回此前登记的收款" : "收款已登记");
      void Promise.allSettled([
        utils.crmSalesOrder.list.invalidate(),
        utils.crmSalesOrder.get.invalidate(),
      ]);
    },
    onError: error => {
      if (!session.isWritable()) return;
      if (
        [
          "BAD_REQUEST",
          "FORBIDDEN",
          "UNAUTHORIZED",
          "NOT_FOUND",
          "CONFLICT",
        ].includes(error.data?.code ?? "")
      ) {
        setUncertainPayment(null);
        payRequestIdRef.current = newRequestId();
      }
      toast.error(error.message || "收款结果未确认，请重试原请求");
    },
  });

  const applyFilters = () => {
    setKeyword(draftKeyword.trim());
    setPage(1);
  };
  const selectDemand = (demand: SalesOrderDemandCandidate) => {
    if (!session.isWritable() || !customerMatches(demand, candidateCustomerId))
      return;
    setSelectedDemand(demand);
    setLines(
      demand.items
        .filter(item => item.remainingQty > 0)
        .map(item => ({ demandItemId: item.id, qty: "", agreedUnitPrice: "" }))
    );
  };
  useEffect(() => {
    const demandNo = deepLinkedDemandNoRef.current;
    if (
      !entryOpen ||
      !demandNo ||
      candidateApplied !== demandNo ||
      candidatesQuery.isFetching ||
      !candidatesQuery.data
    )
      return;
    const candidate = candidatesQuery.data.items.find(
      item =>
        item.demandNo === demandNo &&
        (deepLinkedDemandIdRef.current === undefined ||
          item.id === deepLinkedDemandIdRef.current)
    );
    deepLinkedDemandNoRef.current = "";
    if (!candidate) {
      toast.error("该需求当前不可生成销售订单，请确认已采用最新采购报价");
      return;
    }
    selectDemand(candidate);
  }, [
    candidateApplied,
    candidatesQuery.data,
    candidatesQuery.isFetching,
    entryOpen,
  ]);
  const updateLine = (
    id: number,
    field: "qty" | "agreedUnitPrice",
    value: string
  ) => {
    setLines(current =>
      current.map(line =>
        line.demandItemId === id ? { ...line, [field]: value } : line
      )
    );
  };
  const selectedLines =
    selectedDemand?.items.map(item => ({
      item,
      draft: lines.find(line => line.demandItemId === item.id),
    })) ?? [];
  const amountPreview = useMemo(() => {
    try {
      const items = lines
        .filter(line => line.qty || line.agreedUnitPrice)
        .map(line => ({
          qty: Number(line.qty),
          agreedUnitPrice: line.agreedUnitPrice,
        }));
      if (!items.length) return "—";
      return formatSalesOrderAmount(
        calculateSalesOrderAmounts(items).totalAmount
      );
    } catch {
      return "请完善数量与单价";
    }
  }, [lines]);
  const submitOrder = async () => {
    if (
      !session.isWritable() ||
      savingRef.current ||
      draftResolutionRef.current ||
      draftRestoreError ||
      (!orderDraft.writable && !orderDraft.canVerifyPending)
    )
      return;
    if (pendingDemandRequest) {
      demandRetryUnknown.current = true;
      savingRef.current = true;
      setEntryError("");
      if (!orderDraft.writable) {
        try {
          await orderDraft.persist(
            draftPayloadRef.current ?? buildEntryPayload(),
            true
          );
          if (!session.isWritable()) {
            savingRef.current = false;
            return;
          }
        } catch (failure) {
          savingRef.current = false;
          setEntryError(
            failure instanceof Error ? failure.message : "原请求暂无法核验。"
          );
          return;
        }
      }
      createMutation.mutate(pendingDemandRequest);
      return;
    }
    if (
      candidateMismatch ||
      (embedded && (!candidatesQuery.data || candidatesQuery.isError))
    )
      return;
    if (
      !selectedDemand ||
      !customerMatches(selectedDemand, candidateCustomerId)
    ) {
      setEntryError("请选择客户需求");
      return;
    }
    const items = lines
      .filter(line => line.qty.trim() || line.agreedUnitPrice.trim())
      .map(line => ({
        demandItemId: line.demandItemId,
        qty: Number(line.qty),
        agreedUnitPrice: line.agreedUnitPrice.trim(),
      }));
    if (!items.length) {
      setEntryError("请至少确认一行物料数量与单价");
      return;
    }
    if (!customerConfirmed) {
      setEntryError("请确认已与客户确认订单");
      return;
    }
    if (!confirmationNote.trim()) {
      setEntryError("请填写客户确认说明");
      return;
    }
    const parsed = salesOrderCreateSchema.safeParse({
      demandId: selectedDemand.id,
      demandRevision: selectedDemand.demandRevision ?? 1,
      requestId: requestIdRef.current,
      items,
      dueDate: dueDate || null,
      confirmationNote: confirmationNote.trim(),
      customerConfirmed,
    });
    if (!parsed.success) {
      setEntryError(parsed.error.issues[0]?.message ?? "请检查订单内容");
      return;
    }
    if (
      items.some(
        item =>
          item.qty >
          (selectedDemand.items.find(source => source.id === item.demandItemId)
            ?.remainingQty ?? 0)
      )
    ) {
      setEntryError("确认数量超过可用需求数量，请检查后重试");
      return;
    }
    const fingerprint = JSON.stringify(
      canonicalSalesOrderCreatePayload(parsed.data)
    );
    if (!requestKeysRef.current.has(fingerprint))
      requestKeysRef.current.set(fingerprint, newRequestId());
    const payload = {
      ...parsed.data,
      requestId: requestKeysRef.current.get(fingerprint)!,
    };
    const draft = buildEntryPayload(stockDraft, payload);
    savingRef.current = true;
    setEntryError("");
    setPendingDemandRequest(payload);
    draftPayloadRef.current = draft;
    try {
      await orderDraft.persist(draft, true);
      if (!session.isWritable()) {
        savingRef.current = false;
        return;
      }
      createMutation.mutate(payload);
    } catch (failure) {
      savingRef.current = false;
      setEntryError(
        failure instanceof Error
          ? failure.message
          : "原请求暂无法保存，请重试。"
      );
    }
  };
  const cancelOrder = () => {
    if (!session.isWritable() || !detailQuery.data) return;
    setCancelReason("");
    setCancelError("");
    setUncertainCancellation(null);
    setCancelOpen(true);
  };
  const confirmCancel = () => {
    const detail = detailQuery.data;
    if (!session.isWritable() || !detail || cancellingRef.current) return;
    if (detail.status !== "confirmed") {
      setCancelError("订单状态已变化，请关闭后查看最新详情");
      return;
    }
    if (!cancelReason.trim()) {
      setCancelError("请填写取消原因");
      return;
    }
    cancellingRef.current = true;
    const payload = uncertainCancellation ?? {
      id: detail.id,
      version: detail.version,
      reason: cancelReason.trim(),
    };
    setUncertainCancellation(payload);
    cancelMutation.mutate(payload);
  };

  const payTouched =
    payOpen &&
    Boolean(
      uncertainPayment ||
        payAmount ||
        payNote ||
        payMethod !== "bank" ||
        payDate !== todayLocal()
    );
  const shipTouched = shipOpen && companyShipDirty;
  const cancelTouched = cancelOpen && Boolean(cancelReason);
  const pending =
    stockBusy ||
    createMutation.isPending ||
    paymentMutation.isPending ||
    companyShipBusy ||
    cancelMutation.isPending;
  const dirty = Boolean(
    (entryOpen && formTouched) ||
      payTouched ||
      shipTouched ||
      cancelTouched ||
      expenseDirty ||
      pending
  );
  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (
        !dirty ||
        (entryOpen &&
          !payTouched &&
          !shipTouched &&
          !cancelTouched &&
          !expenseDirty &&
          !pending)
      )
        return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [
    dirty,
    entryOpen,
    payTouched,
    shipTouched,
    cancelTouched,
    expenseDirty,
    pending,
  ]);
  const dirtyCallback = useRef(embedded?.onDirtyChange);
  dirtyCallback.current = embedded?.onDirtyChange;
  useEffect(() => {
    dirtyCallback.current?.(dirty);
  }, [dirty]);
  useEffect(
    () => () => {
      dirtyCallback.current?.(false);
    },
    []
  );
  const requestCloseTransaction = (kind: "pay" | "ship" | "cancel") => {
    const busy =
      kind === "pay"
        ? paymentMutation.isPending
        : kind === "ship"
          ? companyShipBusy
          : cancelMutation.isPending;
    const touched =
      kind === "pay"
        ? payTouched
        : kind === "ship"
          ? shipTouched
          : cancelTouched;
    if (
      busy ||
      (touched && !window.confirm("内容尚未保存，确认放弃本次填写？"))
    )
      return;
    if (kind === "pay") {
      setPayOpen(false);
      setUncertainPayment(null);
      payRequestIdRef.current = newRequestId();
    } else if (kind === "ship") setShipOpen(false);
    else {
      setCancelOpen(false);
      setUncertainCancellation(null);
    }
  };
  useEffect(() => {
    const guardNavigation = (event: MouseEvent) => {
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (
        !dirty ||
        (entryOpen &&
          !payTouched &&
          !shipTouched &&
          !cancelTouched &&
          !expenseDirty &&
          !pending) ||
        !anchor ||
        anchor.getAttribute("href")?.startsWith("#")
      )
        return;
      if (
        pending ||
        !window.confirm("内容尚未保存，确认离开并放弃本次填写？")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("click", guardNavigation, true);
    return () => document.removeEventListener("click", guardNavigation, true);
  }, [
    dirty,
    pending,
    entryOpen,
    payTouched,
    shipTouched,
    cancelTouched,
    expenseDirty,
  ]);
  useEffect(() => {
    const intent = embedded?.intent;
    if (!intent || handledIntentRef.current === intent.nonce) return;
    if (intent.mode !== "view" && !session.isWritable()) {
      handledIntentRef.current = intent.nonce;
      embedded?.onIntentHandled?.(intent.nonce);
      return;
    }
    if (pending) return;
    if (
      dirty &&
      !window.confirm("内容尚未保存，确认放弃并开始该需求的成交确认？")
    ) {
      handledIntentRef.current = intent.nonce;
      embedded?.onIntentHandled?.(intent.nonce);
      return;
    }
    handledIntentRef.current = intent.nonce;
    resetEntry();
    setSelectedId(null);
    setPayOpen(false);
    setShipOpen(false);
    setCancelOpen(false);
    const demandNo = intent.demandNo.trim();
    if (intent.mode === "view") {
      setDraftKeyword(demandNo);
      setKeyword(demandNo);
      setStatus("all");
      setPage(1);
      setEntryOpen(false);
      embedded?.onIntentHandled?.(intent.nonce);
      return;
    }
    deepLinkedDemandNoRef.current = demandNo;
    deepLinkedDemandIdRef.current = intent.demandId;
    setCandidateKeyword(demandNo);
    setCandidateApplied(demandNo);
    setCandidatePage(1);
    setSourceType("demand");
    setEntryOpen(true);
    embedded?.onIntentHandled?.(intent.nonce);
  }, [embedded?.intent, embedded?.onIntentHandled, dirty, pending, canWrite]);

  return (
    <>
      <AdminPage
        className={`crm-sales-orders-page min-w-0 space-y-3${embedded ? " crm-sales-orders-embedded" : ""}`}
        aria-label={embedded ? `${embedded.customer.name}客户订单` : "业务订单"}
      >
        {embedded ? (
          <AdminPageHeader
            list
            title="客户订单"
            description={`仅显示 ${embedded.customer.name} 的内部业务订单，不含网站自主下单。`}
            actions={
              canWrite ? (
                <Button
                  type="button"
                  className={buttonClass}
                  onClick={() => {
                    suppressDraftWrite.current = false;
                    setEntryOpen(true);
                  }}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  录入销售订单
                </Button>
              ) : undefined
            }
          />
        ) : null}
        {embedded && !canWrite ? (
          <p role="status" className="crm-sales-orders-readonly-note">
            {embedded.customer.archivedAt
              ? "客户已归档，客户订单仅供查看。"
              : "当前为只读模式，不能录入、收款、出货或取消订单。"}
          </p>
        ) : null}

        <AdminFilterBar className="crm-sales-orders-filters">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="搜索销售订单"
              className="crm-sales-orders-control w-[320px] max-w-full bg-white text-xs"
              placeholder="订单号、需求号、项目、客户、型号"
              value={draftKeyword}
              onChange={event => setDraftKeyword(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter") applyFilters();
              }}
            />
            <Select
              value={status}
              onValueChange={value => {
                setStatus(value as StatusFilter);
                setPage(1);
              }}
            >
              <SelectTrigger className="crm-sales-orders-control w-[128px] bg-white text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="crm-sales-orders-select">
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="confirmed">待交付</SelectItem>
                <SelectItem value="cancelled">已取消</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              className={secondaryButtonClass}
              onClick={applyFilters}
            >
              <Search className="mr-1 h-3.5 w-3.5" />
              筛选
            </Button>
            {keyword || status !== "all" || draftKeyword ? (
              <Button
                type="button"
                variant="outline"
                className={secondaryButtonClass}
                onClick={() => {
                  setDraftKeyword("");
                  setKeyword("");
                  setStatus("all");
                  setPage(1);
                }}
              >
                重置
              </Button>
            ) : null}
          </div>
          {!embedded && canWrite ? (
            <div className="crm-sales-orders-toolbar-actions">
              <Button
                type="button"
                className={buttonClass}
                onClick={() => {
                  suppressDraftWrite.current = false;
                  setEntryOpen(true);
                }}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                新建业务订单
              </Button>
            </div>
          ) : null}
        </AdminFilterBar>

        <AdminDataPanel className="overflow-hidden">
          {listQuery.isLoading ? (
            <div className="flex justify-center p-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : listQuery.isError ? (
            <div className="p-14 text-center text-xs text-red-600">
              {listQuery.error?.message || "订单读取失败"}{" "}
              <Button
                className="ml-2 h-7 text-xs"
                variant="outline"
                onClick={() => listQuery.refetch()}
              >
                重试
              </Button>
            </div>
          ) : !listQuery.data?.items.length ? (
            <div className="p-14 text-center">
              <p className="text-sm font-medium">暂无匹配的内部销售订单</p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                可调整筛选，或录入新的销售订单。
              </p>
            </div>
          ) : (
            <div className="min-w-0">
              <Table
                className="crm-sales-orders-table admin-table-readable w-full table-fixed"
                containerClassName="crm-sales-orders-table-scroll overflow-x-auto"
              >
                <colgroup>
                  {embedded ? (
                    <>
                      <col className="w-[14%]" />
                      <col className="w-[18%]" />
                      <col className="w-[8%]" />
                      <col className="w-[10%]" />
                      <col className="w-[9%]" />
                      <col className="w-[10%]" />
                      <col className="w-[9%]" />
                      <col className="w-[8%]" />
                      <col className="w-[14%]" />
                    </>
                  ) : (
                    <>
                      <col style={{ width: "16%" }} />
                      <col style={{ width: "16%" }} />
                      <col style={{ width: "20%" }} />
                      <col style={{ width: "12%" }} />
                      <col style={{ width: "10%" }} />
                      <col style={{ width: "9%" }} />
                      <col style={{ width: "7%" }} />
                      <col style={{ width: "10%" }} />
                    </>
                  )}
                </colgroup>
                <TableHeader>
                  <TableRow className="bg-slate-50 hover:bg-slate-50">
                    <TableHead>订单号{embedded ? "" : " / 日期"}</TableHead>
                    <TableHead>{embedded ? "客户 / 需求" : "客户"}</TableHead>
                    <TableHead>{embedded ? "项目" : "物料摘要"}</TableHead>
                    <TableHead className="text-right">
                      {embedded ? "金额（含税）" : "金额"}
                    </TableHead>
                    {embedded ? <TableHead>状态</TableHead> : null}
                    <TableHead>收款</TableHead>
                    <TableHead>出货</TableHead>
                    <TableHead>{embedded ? "录入时间" : "负责人"}</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedRows.map(order => (
                    <TableRow
                      key={order.id}
                      ref={
                        newInformationRows.getRow(`crm-sales:${order.id}`).ref
                      }
                      className="h-14"
                      data-page-memory-row={String(order.id)}
                    >
                      <TableCell className="min-w-0 px-2 py-1.5">
                        <div className="flex min-w-0 items-center">
                          <button
                            type="button"
                            className="crm-sales-orders-order-link block w-full truncate text-left font-medium text-[#185FA5] hover:underline"
                            title={order.orderNumber}
                            onClick={() => setSelectedId(order.id)}
                          >
                            {order.orderNumber}
                          </button>
                          <AdminNewInformationRowBadge
                            isNew={
                              newInformationRows.getRow(`crm-sales:${order.id}`)
                                .isNew
                            }
                          />
                        </div>
                        {!embedded ? (
                          <div className="admin-cell-secondary">
                            {beijingDate(order.createdAt)} ·{" "}
                            {CRM_SALES_ORDER_STATUS_LABELS[order.status]}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="min-w-0 px-2 py-1.5 whitespace-normal">
                        <div
                          className="admin-cell-primary truncate"
                          title={order.customerName}
                        >
                          {order.customerName || "—"}
                        </div>
                        <div
                          className="admin-cell-secondary mt-0.5 truncate"
                          title={order.demandNo ?? undefined}
                        >
                          {order.demandNo || "公司库存"}
                        </div>
                      </TableCell>
                      <TableCell className="admin-cell-primary min-w-0 px-2 py-1.5">
                        {embedded ? (
                          order.projectName || "—"
                        ) : (
                          <OrderMaterialSummary order={order} />
                        )}
                      </TableCell>
                      <TableCell className="admin-cell-primary px-2 py-1.5 text-right tabular-nums">
                        {formatSalesOrderAmount(order.totalAmount)}
                        {!embedded ? (
                          <div className="admin-cell-secondary">
                            {order.currencyLabel}
                          </div>
                        ) : null}
                      </TableCell>
                      {embedded ? (
                        <TableCell className="px-2 py-1.5">
                          <div className="admin-cell-primary flex items-center gap-1.5 whitespace-nowrap">
                            <span
                              className={`crm-sales-orders-status-dot text-[10px] ${statusDotClass(order.status)}`}
                              aria-hidden="true"
                            >
                              ●
                            </span>
                            <span className="font-medium text-slate-700">
                              {CRM_SALES_ORDER_STATUS_LABELS[order.status]}
                            </span>
                          </div>
                        </TableCell>
                      ) : null}
                      <TableCell className="px-2 py-1.5">
                        <div className="admin-cell-primary flex items-center gap-1.5 whitespace-nowrap">
                          <span
                            className={`crm-sales-orders-status-dot text-[10px] ${paymentDotClass(order.paymentStatus)}`}
                            aria-hidden="true"
                          >
                            ●
                          </span>
                          <span className="font-medium text-slate-700">
                            {
                              CRM_SALES_PAYMENT_STATUS_LABELS[
                                order.paymentStatus
                              ]
                            }
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="px-2 py-1.5">
                        <div className="admin-cell-primary flex items-center gap-1.5 whitespace-nowrap">
                          <span
                            className={`crm-sales-orders-status-dot text-[10px] ${shipmentDotClass(order.shipmentStatus)}`}
                            aria-hidden="true"
                          >
                            ●
                          </span>
                          <span className="font-medium text-slate-700">
                            {
                              CRM_SALES_SHIPMENT_STATUS_LABELS[
                                order.shipmentStatus
                              ]
                            }
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="truncate px-2 py-1.5 tabular-nums">
                        <span className="admin-cell-secondary">
                          {embedded
                            ? beijingDate(order.createdAt)
                            : orderOwnerLabel(order)}
                        </span>
                      </TableCell>
                      <TableCell className="px-2 py-1.5 text-right">
                        <div className="inline-flex items-center whitespace-nowrap divide-x divide-slate-200">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="admin-row-action rounded-none px-2 text-xs text-[#185FA5] hover:bg-[#185FA5]/5 hover:text-[#0C447C]"
                            onClick={() => setSelectedId(order.id)}
                          >
                            查看
                          </Button>
                          {canWrite && order.status === "confirmed" ? (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="admin-row-action rounded-none px-2 text-xs text-[#185FA5] hover:bg-[#185FA5]/5 hover:text-[#0C447C]"
                                onClick={() => {
                                  setSelectedId(order.id);
                                  setPayAmount("");
                                  setPayDate(todayLocal());
                                  setPayNote("");
                                  setPayMethod("bank");
                                  setPayOpen(true);
                                }}
                              >
                                收款
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="admin-row-action rounded-none px-2 text-xs text-[#185FA5] hover:bg-[#185FA5]/5 hover:text-[#0C447C]"
                                onClick={() => {
                                  setSelectedId(order.id);
                                  setShipQtys({});
                                  setExpressCo("");
                                  setExpressNo("");
                                  setShipNote("");
                                  setShipMethod("express");
                                  setShipOpen(true);
                                }}
                              >
                                出货
                              </Button>
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
        </AdminDataPanel>
        {listQuery.data?.items.length ? (
          <div className="aui-pagination crm-sales-orders-pagination mb-8 mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>共 {listQuery.data.total} 条</span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 bg-white text-xs"
                disabled={page <= 1 || listQuery.isFetching}
                onClick={() => setPage(current => current - 1)}
              >
                上一页
              </Button>
              <span className="min-w-[64px] text-center">
                第 {page} / {totalPages} 页
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 bg-white text-xs"
                disabled={page >= totalPages || listQuery.isFetching}
                onClick={() => setPage(current => current + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        ) : null}
      </AdminPage>

      <Dialog
        open={entryOpen}
        onOpenChange={open => (open ? setEntryOpen(true) : requestCloseEntry())}
      >
        <DialogContent
          className="crm-sales-orders-dialog crm-sales-orders-entry-dialog grid-cols-[minmax(0,1fr)] w-[calc(100vw-32px)] max-h-[92vh] max-w-[1100px] overflow-x-hidden overflow-y-auto p-4 sm:max-w-[1100px]"
          showCloseButton={!createMutation.isPending && !stockBusy && !draftResolutionBusy}
        >
          <DialogHeader>
            <DialogTitle className="text-base text-slate-800">
              {embedded && sourceType === "demand"
                ? "客户成交报价与确认"
                : "新建业务订单"}
            </DialogTitle>
          </DialogHeader>
          {uncertainSave && (
            <p
              role="alert"
              className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800"
            >
              保存结果待确认，内容已锁定。
            </p>
          )}
          {!orderDraft.restored || draftRestoreError || !orderDraft.writable ? (
            <section role="alert" aria-label="订单草稿处理" className="min-w-0 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-slate-700">
              <h3 className="font-semibold text-slate-900">
                {draftConflict?.title || (draftRestoreError ? "订单草稿暂不能恢复" : !orderDraft.restored ? "正在读取订单草稿" : "订单草稿需要处理")}
              </h3>
              <p className="mt-2 leading-6">
                {draftConflict?.message || draftRestoreError || orderDraft.notice || "请稍候，读取完成后再录入。"}
              </p>
              {draftConflict && orderDraft.notice ? <p className="mt-2 text-xs">{orderDraft.notice}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {embedded && draftRestoreError ? (
                  <Button type="button" className={buttonClass} disabled={draftResolutionBusy}
                    onClick={() => { if (draftResolutionRef.current) return; requestCloseEntry(); navigate("/orders?orderSource=business"); }}>
                    {draftConflict && hasLockedSalesOrderDraft(draftConflict.payload) ? "去业务订单核验原请求" : "去业务订单继续草稿"}
                  </Button>
                ) : null}
                {draftConflict?.canStartNew ? (
                  <Button type="button" variant="outline" className={secondaryButtonClass}
                    disabled={!canWrite || !orderDraft.writable || draftResolutionBusy}
                    onClick={() => void resolveDraft()}>
                    {draftResolutionBusy ? "正在保留草稿…" : "保留原草稿后新建"}
                  </Button>
                ) : null}
                <Button type="button" variant="outline" className={secondaryButtonClass}
                  disabled={!orderDraft.restored || draftResolutionBusy} onClick={rereadDraft}>
                  重新读取草稿
                </Button>
              </div>
            </section>
          ) : null}
          {draftResolutionError ? <p role="alert" className="text-sm text-red-600">{draftResolutionError}</p> : null}
          {orderDraft.notice && orderDraft.writable ? (
            <p role="status" className="text-xs text-slate-500">
              {orderDraft.notice}
            </p>
          ) : null}
          {!embedded && orderDraft.preservedDrafts.length > 0 ? (
            <details className="rounded border border-slate-200 p-3 text-xs">
              <summary className="cursor-pointer font-medium text-slate-700">已保留草稿（仅本浏览器）</summary>
              <p className="my-2 text-slate-500">恢复前会保留当前普通草稿；不会覆盖原备份，也不会自动提交订单。</p>
              {orderDraft.preservedDrafts.map(saved => (
                <div key={saved.archiveId} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 py-2">
                  <span>{typeof saved.payload.customer?.name === "string" ? saved.payload.customer.name : "未关联客户"} · {saved.payload.source === "demand" ? "需求采购" : "公司库存"} · {new Date(saved.savedAt).toLocaleString("zh-CN")}</span>
                  <Button type="button" variant="outline" className={secondaryButtonClass}
                    disabled={!canWrite || !orderDraft.writable || Boolean(draftRestoreError) || uncertainSave || stockLocked || stockBusy || createMutation.isPending || draftResolutionBusy}
                    onClick={() => void resolveDraft(saved.archiveId)}>恢复此草稿</Button>
                </div>
              ))}
            </details>
          ) : null}
          {!draftRestoreError ? (
          <fieldset
            disabled={
              (!orderDraft.writable && !orderDraft.canVerifyPending) ||
              Boolean(draftRestoreError) || draftResolutionBusy
            }
            className="min-w-0 space-y-3"
          >
            <section className="crm-order-section" aria-label="订单客户">
              <h3 className="crm-order-section-title">客户</h3>
              <div className="company-stock-toolbar">
                <span>
                  {selectedCustomer?.name ||
                    (selectedDemand ? selectedDemand.customerName : "选择客户")}
                </span>
                {!embedded &&
                selectedCustomer &&
                !uncertainSave &&
                !stockLocked &&
                !stockBusy ? (
                  <Button
                    type="button"
                    className={secondaryButtonClass}
                    onClick={() => {
                      if (
                        formTouched &&
                        !window.confirm("内容尚未保存，确认重新选择客户？")
                      )
                        return;
                      resetEntry();
                    }}
                  >
                    更换客户
                  </Button>
                ) : null}
              </div>
              {!selectedCustomer && !selectedDemand ? (
                <SalesCustomerPicker
                  enabled={canWrite && ready && orderDraft.writable}
                  onSelect={setEntryCustomer}
                  customerSearch={customerSearch}
                  onCustomerSearchChange={setCustomerSearch}
                />
              ) : null}
            </section>
            <div
              className="crm-sales-orders-source-controls"
              aria-label="订单货源"
            >
              <span className="crm-order-section-title">货源</span>
              <Button
                type="button"
                className={secondaryButtonClass}
                aria-pressed={sourceType === "company_stock"}
                disabled={
                  !canWrite ||
                  stockBusy ||
                  createMutation.isPending ||
                  uncertainSave ||
                  stockLocked
                }
                onClick={() => {
                  if (
                    formTouched &&
                    !window.confirm("内容尚未保存，确认切换货源？")
                  )
                    return;
                  setSourceType("company_stock");
                  setSelectedDemand(null);
                  setLines([]);
                }}
              >
                公司库存
              </Button>
              <Button
                type="button"
                className={secondaryButtonClass}
                aria-pressed={sourceType === "demand"}
                disabled={
                  !canWrite ||
                  stockBusy ||
                  createMutation.isPending ||
                  uncertainSave ||
                  stockLocked
                }
                onClick={() => {
                  if (
                    formTouched &&
                    !window.confirm("内容尚未保存，确认切换货源？")
                  )
                    return;
                  setSourceType("demand");
                }}
              >
                需求采购
              </Button>
            </div>
            {sourceType === "company_stock" ? (
              selectedCustomer ? (
                <CompanyStockOrderForm
                  key={`${businessScope.storageScope}:${selectedCustomer.id}`}
                  customer={selectedCustomer}
                  enabled={
                    canWrite &&
                    session.isWritable() &&
                    ready &&
                    (orderDraft.writable || orderDraft.canVerifyPending) &&
                    !draftRestoreError && !draftResolutionBusy
                  }
                  draft={stockDraft}
                  onDraftChange={setStockDraft}
                  onPersistRequest={async company => {
                    const payload = buildEntryPayload(company);
                    draftPayloadRef.current = payload;
                    await orderDraft.persist(payload, true);
                  }}
                  onClose={requestCloseEntry}
                  onLockedChange={setStockLocked}
                  onDirtyChange={setStockDirty}
                  onBusyChange={setStockBusy}
                  onCreated={result => {
                    if (!session.isWritable()) return;
                    setSelectedId(result.id);
                    completeEntry();
                    embedded?.onOrderChanged?.();
                    toast.success(
                      result.replayed ? "已返回此前保存订单" : "业务订单已创建"
                    );
                    void Promise.allSettled([
                      utils.crmSalesOrder.list.invalidate(),
                      utils.crmSalesOrder.get.invalidate(),
                      utils.crmSalesOrder.candidates.invalidate(),
                    ]);
                  }}
                />
              ) : (
                <p className="admin-cell-secondary">请先选择客户</p>
              )
            ) : (
              <>
                {!selectedDemand ? (
                  <div className="space-y-2">
                    <AdminFilterBar className="crm-sales-orders-candidate-filters">
                      <Input
                        className="h-8 text-xs"
                        value={candidateKeyword}
                        placeholder="搜索需求号、项目或型号"
                        onChange={event =>
                          setCandidateKeyword(event.target.value)
                        }
                        onKeyDown={event => {
                          if (event.key === "Enter") {
                            setCandidateApplied(candidateKeyword.trim());
                            setCandidatePage(1);
                          }
                        }}
                      />
                      <Button
                        type="button"
                        className={secondaryButtonClass}
                        variant="outline"
                        onClick={() => {
                          setCandidateApplied(candidateKeyword.trim());
                          setCandidatePage(1);
                        }}
                      >
                        搜索
                      </Button>
                    </AdminFilterBar>
                    <AdminDataPanel className="max-h-[380px] overflow-auto">
                      <Table className="crm-sales-orders-dialog-table admin-table-readable">
                        <TableHeader className="bg-slate-50">
                          <TableRow>
                            <TableHead className="h-8 text-xs">客户</TableHead>
                            <TableHead className="h-8 text-xs">
                              需求 / 项目
                            </TableHead>
                            <TableHead className="h-8 text-right text-xs">
                              可下单物料
                            </TableHead>
                            <TableHead className="h-8 text-right text-xs">
                              操作
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {candidatesQuery.isLoading ? (
                            <TableRow>
                              <TableCell
                                colSpan={4}
                                className="h-20 text-center text-xs"
                              >
                                <Loader2 className="inline h-4 w-4 animate-spin" />
                              </TableCell>
                            </TableRow>
                          ) : null}
                          {candidatesQuery.isError ? (
                            <TableRow>
                              <TableCell
                                colSpan={4}
                                className="h-20 text-center text-xs text-red-600"
                              >
                                {candidatesQuery.error?.message ||
                                  "需求读取失败"}
                              </TableCell>
                            </TableRow>
                          ) : null}
                          {!candidatesQuery.isLoading &&
                          !candidatesQuery.isError &&
                          !candidatesQuery.data?.items.length ? (
                            <TableRow>
                              <TableCell
                                colSpan={4}
                                className="h-20 text-center text-xs text-slate-500"
                              >
                                暂无已采用报价且可录入的需求
                              </TableCell>
                            </TableRow>
                          ) : null}
                          {candidatesQuery.data?.items.map(demand => (
                            <TableRow
                              key={demand.id}
                              data-page-memory-row={String(demand.id)}
                            >
                              <TableCell className="py-2 text-xs">
                                {demand.customerName}
                              </TableCell>
                              <TableCell className="py-2 text-xs">
                                <div>{demand.demandNo}</div>
                                <div className="admin-cell-secondary">
                                  {demand.projectName || "未填写项目"}
                                </div>
                              </TableCell>
                              <TableCell className="py-2 text-right text-xs tabular-nums">
                                {
                                  demand.items.filter(
                                    item => item.remainingQty > 0
                                  ).length
                                }{" "}
                                行可下单
                              </TableCell>
                              <TableCell className="py-2 text-right">
                                <Button
                                  type="button"
                                  className="admin-row-action text-xs"
                                  variant="outline"
                                  disabled={
                                    !demand.items.some(
                                      item => item.remainingQty > 0
                                    )
                                  }
                                  onClick={() => selectDemand(demand)}
                                >
                                  选择
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </AdminDataPanel>
                    <div className="flex items-center justify-end gap-2 text-xs text-slate-500">
                      <span>
                        {candidatePage} / {candidatePages}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        disabled={candidatePage <= 1}
                        onClick={() => setCandidatePage(current => current - 1)}
                      >
                        上一页
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        disabled={candidatePage >= candidatePages}
                        onClick={() => setCandidatePage(current => current + 1)}
                      >
                        下一页
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="min-w-0 space-y-3">
                    <AdminDataPanel className="crm-sales-orders-selected-demand flex flex-wrap items-start justify-between gap-2 p-3 text-xs">
                      <div>
                        <strong className="crm-sales-orders-selected-customer text-[#185FA5]">
                          {selectedDemand.customerName}
                        </strong>
                        <span className="mx-2 text-slate-400">|</span>
                        {selectedDemand.demandNo}
                        <span className="mx-2 text-slate-400">|</span>
                        {selectedDemand.projectName || "未填写项目"}
                      </div>
                      <Button
                        type="button"
                        className="h-7 px-2 text-xs"
                        variant="outline"
                        disabled={createMutation.isPending || uncertainSave}
                        onClick={() => {
                          setSelectedDemand(null);
                          setLines([]);
                        }}
                      >
                        重新选择
                      </Button>
                    </AdminDataPanel>
                    <h3 className="crm-order-section-title">订单明细</h3>
                    <AdminDataPanel className="min-w-0 max-w-full overflow-auto">
                      <Table className="crm-sales-orders-dialog-table admin-table-readable">
                        <TableHeader className="bg-slate-50">
                          <TableRow>
                            <TableHead className="h-8 text-xs">
                              型号 / 品牌 / 封装
                            </TableHead>
                            <TableHead className="h-8 text-right text-xs">
                              需求 / 可下单
                            </TableHead>
                            <TableHead className="h-8 w-[120px] text-right text-xs">
                              客户确认数量
                            </TableHead>
                            <TableHead className="h-8 w-[150px] text-right text-xs">
                              客户同意含税单价（元）
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedLines.map(({ item, draft }) => (
                            <TableRow
                              key={item.id}
                              className={
                                item.remainingQty <= 0
                                  ? "bg-slate-50 text-slate-400"
                                  : ""
                              }
                              data-page-memory-row={String(item.id)}
                            >
                              <TableCell className="py-2 text-xs">
                                <div className="admin-cell-primary crm-sales-orders-model">
                                  {item.partNumber || "未填写型号"}
                                </div>
                                <div className="admin-cell-secondary">
                                  {[item.brand, item.pkg]
                                    .filter(Boolean)
                                    .join(" / ") || "—"}
                                </div>
                              </TableCell>
                              <TableCell className="py-2 text-right text-xs tabular-nums">
                                {item.demandQty} {item.qtyUnit} /{" "}
                                <span className="font-medium">
                                  {item.remainingQty} {item.qtyUnit}
                                </span>
                              </TableCell>
                              <TableCell className="py-2">
                                <Input
                                  disabled={
                                    !draft ||
                                    item.remainingQty <= 0 ||
                                    createMutation.isPending ||
                                    uncertainSave
                                  }
                                  className="h-8 text-right text-xs tabular-nums"
                                  type="number"
                                  min={1}
                                  step={1}
                                  max={item.remainingQty}
                                  aria-label={`${item.partNumber} 确认数量`}
                                  inputMode="numeric"
                                  value={draft?.qty ?? ""}
                                  placeholder="不录入"
                                  onChange={event =>
                                    updateLine(
                                      item.id,
                                      "qty",
                                      event.target.value
                                    )
                                  }
                                  onBlur={() => {
                                    const current = Number(draft?.qty);
                                    if (current > item.remainingQty) {
                                      updateLine(
                                        item.id,
                                        "qty",
                                        String(item.remainingQty)
                                      );
                                      toast.info(
                                        `确认数量已调整为最大可用数量 ${item.remainingQty}`
                                      );
                                    }
                                  }}
                                />
                              </TableCell>
                              <TableCell className="py-2">
                                <Input
                                  disabled={
                                    !draft ||
                                    item.remainingQty <= 0 ||
                                    createMutation.isPending ||
                                    uncertainSave
                                  }
                                  className="h-8 text-right text-xs tabular-nums"
                                  aria-label={`${item.partNumber} 含税单价`}
                                  inputMode="decimal"
                                  value={draft?.agreedUnitPrice ?? ""}
                                  placeholder="0.0000"
                                  onChange={event =>
                                    updateLine(
                                      item.id,
                                      "agreedUnitPrice",
                                      event.target.value
                                    )
                                  }
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </AdminDataPanel>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label
                          htmlFor="sales-order-due-date"
                          className="text-xs"
                        >
                          约定交付日期（可选）
                        </Label>
                        <Input
                          id="sales-order-due-date"
                          disabled={createMutation.isPending || uncertainSave}
                          type="date"
                          className="h-8 text-xs"
                          value={dueDate}
                          max="9999-12-31"
                          onChange={event => setDueDate(event.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label
                          htmlFor="sales-order-confirmation"
                          className="text-xs"
                        >
                          客户确认说明 <span className="text-red-600">*</span>
                        </Label>
                        <Textarea
                          id="sales-order-confirmation"
                          disabled={createMutation.isPending || uncertainSave}
                          className="min-h-16 text-xs"
                          maxLength={500}
                          value={confirmationNote}
                          placeholder="客户确认内容"
                          onChange={event =>
                            setConfirmationNote(event.target.value)
                          }
                        />
                      </div>
                    </div>
                    <div className="text-right text-xs font-medium tabular-nums text-slate-800">
                      金额（人民币含税）：{amountPreview}
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                      <Checkbox
                        disabled={createMutation.isPending || uncertainSave}
                        checked={customerConfirmed}
                        onCheckedChange={checked =>
                          setCustomerConfirmed(checked === true)
                        }
                      />
                      <span>
                        我确认客户已明确同意以上数量、含税价格及约定交期{" "}
                        <span className="text-red-600">*</span>
                      </span>
                    </label>
                  </div>
                )}
              </>
            )}
            {entryError ? (
              <p role="alert" className="text-xs text-red-600">
                {entryError}
              </p>
            ) : null}
            {sourceType === "demand" ? (
              <DialogFooter className="crm-order-actions">
                {sourceType === "demand" && selectedDemand ? (
                  <Button
                    type="button"
                    className={buttonClass}
                    disabled={
                      !canWrite ||
                      (!uncertainSave &&
                        (candidateMismatch ||
                          Boolean(
                            embedded &&
                              (!candidatesQuery.data || candidatesQuery.isError)
                          ))) ||
                      (!orderDraft.writable && !orderDraft.canVerifyPending) ||
                      Boolean(draftRestoreError) ||
                      createMutation.isPending
                    }
                    onClick={() => {
                      void submitOrder();
                    }}
                  >
                    {createMutation.isPending ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="mr-1 h-3.5 w-3.5" />
                    )}
                    {uncertainSave ? "确认保存结果" : "保存订单"}
                  </Button>
                ) : null}
              </DialogFooter>
            ) : null}
          </fieldset>
          ) : null}
          {sourceType === "demand" || draftRestoreError ? (
            <div className="flex justify-end">
              <Button type="button" variant="outline" className={secondaryButtonClass}
                disabled={createMutation.isPending || stockBusy || draftResolutionBusy} onClick={requestCloseEntry}>
                收起
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={selectedId != null && !payOpen && !shipOpen && !cancelOpen}
        onOpenChange={open => {
          if (
            !open &&
            !cancellingRef.current &&
            !cancelOpen &&
            !payOpen &&
            !shipOpen
          )
            setSelectedId(null);
        }}
      >
        <DialogContent className="crm-sales-orders-dialog grid-cols-[minmax(0,1fr)] w-[calc(100vw-32px)] max-h-[90vh] max-w-[1100px] overflow-x-hidden overflow-y-auto p-4 sm:max-w-[1100px]">
          <DialogHeader>
            <DialogTitle className="text-base">销售订单详情</DialogTitle>
          </DialogHeader>
          {detailQuery.isLoading ? (
            <div className="py-12 text-center text-xs text-slate-500">
              <Loader2 className="inline h-4 w-4 animate-spin" /> 加载中
            </div>
          ) : null}
          {detailQuery.isError ? (
            <div className="py-8 text-center text-xs text-red-600">
              {detailQuery.error?.message || "订单详情读取失败"}
            </div>
          ) : null}
          {detailQuery.data ? (
            <div className="crm-sales-orders-detail space-y-3">
              <AdminDataPanel className="crm-sales-orders-detail-summary grid gap-2 p-3 sm:grid-cols-3">
                <div>
                  <span className="text-slate-500">订单号：</span>
                  {detailQuery.data.orderNumber}
                </div>
                <div>
                  <span className="text-slate-500">客户：</span>
                  {detailQuery.data.customerName}
                </div>
                <div>
                  <span className="text-slate-500">来源：</span>
                  {detailQuery.data.demandNo || "公司库存"}
                </div>
                <div>
                  <span className="text-slate-500">状态：</span>
                  <span className="admin-cell-primary inline-flex items-center gap-1.5">
                    <span
                      className={`crm-sales-orders-status-dot text-[10px] ${statusDotClass(detailQuery.data.status)}`}
                      aria-hidden="true"
                    >
                      ●
                    </span>
                    {CRM_SALES_ORDER_STATUS_LABELS[detailQuery.data.status]}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">总额：</span>
                  {formatSalesOrderAmount(detailQuery.data.totalAmount)}（
                  {detailQuery.data.currencyLabel}）
                </div>
                <div>
                  <span className="text-slate-500">交付日期：</span>
                  {detailQuery.data.dueDate || "—"}
                </div>
              </AdminDataPanel>
              <details className="crm-sales-orders-fold">
                <summary>客户确认说明</summary>
                <div>{detailQuery.data.confirmationNote}</div>
              </details>
              <AdminDataPanel className="min-w-0 max-w-full overflow-auto">
                <Table className="crm-sales-orders-dialog-table admin-table-readable">
                  <TableHeader className="bg-slate-50">
                    <TableRow>
                      <TableHead className="h-8 text-xs">型号</TableHead>
                      <TableHead className="h-8 text-right text-xs">
                        数量
                      </TableHead>
                      <TableHead className="h-8 text-right text-xs">
                        销售单价
                      </TableHead>
                      <TableHead className="h-8 text-right text-xs">
                        金额
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detailQuery.data.items.map(item => (
                      <TableRow
                        key={item.id}
                        data-page-memory-row={String(item.id)}
                      >
                        <TableCell className="py-2 text-xs">
                          <div className="admin-cell-primary crm-sales-orders-model">
                            {item.partNumber}
                          </div>
                          <div className="admin-cell-secondary">
                            {[item.brand, item.pkg].filter(Boolean).join(" / ")}
                          </div>
                        </TableCell>
                        <TableCell className="py-2 text-right tabular-nums">
                          {item.orderedQty} {item.qtyUnit}
                          {embedded ? (
                            <div className="admin-cell-secondary">
                              已出 {item.shippedQty} · 待出{" "}
                              {item.orderedQty - item.shippedQty}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="py-2 text-right tabular-nums">
                          {formatSalesOrderAmount(item.unitPrice)}
                        </TableCell>
                        <TableCell className="py-2 text-right tabular-nums">
                          {formatSalesOrderAmount(item.lineAmount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </AdminDataPanel>
              {detailQuery.data.status === "cancelled" ? (
                <AdminDataPanel className="bg-slate-50 p-3">
                  <strong>取消原因：</strong>
                  {detailQuery.data.cancelledReason}
                </AdminDataPanel>
              ) : null}
              <SalesProfitSummary
                profit={detailQuery.data.profitBreakdown}
                commission={detailQuery.data.commissionPreview}
              />
              <SalesExpensesEditor
                key={`${detailQuery.data.id}:${businessScope.storageScope}`}
                orderId={detailQuery.data.id}
                version={detailQuery.data.version}
                amount={detailQuery.data.salesExpenses}
                history={detailQuery.data.salesExpenseHistory ?? []}
                enabled={canWrite && detailQuery.data.status === "confirmed"}
                onDirtyChange={setExpenseDirty}
                onSaved={() => {
                  if (!session.isWritable()) return;
                  embedded?.onOrderChanged?.();
                  toast.success("费用已保存");
                  void Promise.allSettled([
                    utils.crmSalesOrder.get.invalidate(),
                    utils.crmSalesOrder.list.invalidate(),
                  ]);
                }}
              />
              <details className="crm-sales-orders-fold">
                <summary>物料备注与操作履历</summary>
                {detailQuery.data.items
                  .filter(item => item.note || item.deliveryRequirement)
                  .map(item => (
                    <div key={item.id}>
                      {item.partNumber} · {item.deliveryRequirement} ·{" "}
                      {item.note}
                    </div>
                  ))}
                {(detailQuery.data.audits ?? []).map(audit => (
                  <div key={audit.id} className="admin-cell-secondary">
                    {audit.createdAt} · {audit.actorName} · {audit.note}
                  </div>
                ))}
              </details>
              <div className="grid gap-2 sm:grid-cols-2">
                <AdminDataPanel className="p-3">
                  <div className="mb-1 font-medium text-slate-700">收款</div>
                  <div className="text-slate-600">
                    {
                      CRM_SALES_PAYMENT_STATUS_LABELS[
                        detailQuery.data.paymentStatus
                      ]
                    }{" "}
                    · 已收 {formatSalesOrderAmount(detailQuery.data.paidAmount)}
                    {Number(detailQuery.data.monthlyAmount) > 0
                      ? ` · 月结 ${formatSalesOrderAmount(detailQuery.data.monthlyAmount)}`
                      : ""}
                  </div>
                  <details className="crm-sales-orders-fold">
                    <summary>收款履历</summary>
                    {detailQuery.data.payments.map(payment => (
                      <div
                        key={payment.id}
                        className="admin-cell-secondary mt-1"
                      >
                        {payment.paymentDate}{" "}
                        {CRM_SALES_PAYMENT_METHOD_LABELS[payment.method]}{" "}
                        {formatSalesOrderAmount(payment.amount)}
                        {payment.note ? ` · ${payment.note}` : ""}
                      </div>
                    ))}
                  </details>
                </AdminDataPanel>
                <AdminDataPanel className="p-3">
                  <div className="mb-1 font-medium text-slate-700">出货</div>
                  <div className="text-slate-600">
                    {
                      CRM_SALES_SHIPMENT_STATUS_LABELS[
                        detailQuery.data.shipmentStatus
                      ]
                    }{" "}
                    · {detailQuery.data.shippedQty}/
                    {detailQuery.data.orderedQty}
                  </div>
                  <details className="crm-sales-orders-fold">
                    <summary>出货履历</summary>
                    {detailQuery.data.shipments.map(shipment => (
                      <div
                        key={shipment.id}
                        className="admin-cell-secondary mt-1"
                      >
                        {beijingDate(shipment.createdAt)}{" "}
                        {shipment.deliveryMethod === "pickup"
                          ? "自提"
                          : `${shipment.expressCo} ${shipment.expressNo}`}{" "}
                        ·{" "}
                        {shipment.items
                          .map(item => `${item.partNumber}×${item.qty}`)
                          .join("，")}
                      </div>
                    ))}
                  </details>
                </AdminDataPanel>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            {canWrite && detailQuery.data?.status === "confirmed" ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className={secondaryButtonClass}
                  onClick={() => {
                    setPayAmount("");
                    setPayDate(todayLocal());
                    setPayNote("");
                    setPayMethod("bank");
                    setPayOpen(true);
                  }}
                >
                  登记收款
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className={secondaryButtonClass}
                  onClick={() => {
                    setShipQtys({});
                    setExpressCo("");
                    setExpressNo("");
                    setShipNote("");
                    setShipMethod("express");
                    setShipOpen(true);
                  }}
                >
                  出货
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 border-red-200 bg-white px-3 text-xs text-red-700 hover:bg-red-50"
                  disabled={
                    cancelMutation.isPending ||
                    Number(detailQuery.data.paidAmount) > 0 ||
                    Number(detailQuery.data.monthlyAmount) > 0 ||
                    detailQuery.data.shippedQty > 0
                  }
                  onClick={cancelOrder}
                >
                  {cancelMutation.isPending ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="mr-1 h-3.5 w-3.5" />
                  )}
                  取消订单
                </Button>
              </>
            ) : null}
            <Button
              type="button"
              className={buttonClass}
              disabled={cancelMutation.isPending}
              onClick={() => {
                if (expenseDirty && !window.confirm("费用尚未保存，确认关闭？"))
                  return;
                setSelectedId(null);
              }}
            >
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {cancelOpen && detailQuery.data && (
        <ConfirmDialog
          title="确认取消销售订单？"
          description={`订单 ${detailQuery.data.orderNumber}；已收款或已出货的订单不能取消。`}
          confirmLabel="确认取消订单"
          danger
          busy={cancelMutation.isPending}
          error={cancelError}
          onCancel={() => requestCloseTransaction("cancel")}
          onConfirm={confirmCancel}
        >
          <label className="crm-sales-orders-cancel-reason block text-sm text-slate-600">
            取消原因
            <textarea
              className="crm-input mt-1 min-h-20 w-full"
              maxLength={500}
              disabled={
                !canWrite ||
                cancelMutation.isPending ||
                Boolean(uncertainCancellation)
              }
              value={cancelReason}
              onChange={event => setCancelReason(event.target.value)}
            />
          </label>
        </ConfirmDialog>
      )}
      {payOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"
              onClick={() => requestCloseTransaction("pay")}
            >
              <div
                className="crm-sales-orders-dialog max-h-[90vh] w-[480px] max-w-full overflow-y-auto rounded-xl bg-white p-4"
                onClick={event => event.stopPropagation()}
              >
                <h3 className="text-[18px] font-semibold">登记收款</h3>
                <div className="inbound-field mt-4">
                  <label className="erp-field-label mb-1.5 block">
                    收款方式<span className="ml-1 text-[#C63C3C]">*</span>
                  </label>
                  <select
                    className="crm-input w-full"
                    value={payMethod}
                    disabled={
                      !canWrite ||
                      paymentMutation.isPending ||
                      Boolean(uncertainPayment)
                    }
                    onChange={event =>
                      setPayMethod(event.target.value as CrmSalesPaymentMethod)
                    }
                  >
                    <option value="bank">对公转账</option>
                    <option value="cash">现金</option>
                    <option value="monthly">月结</option>
                  </select>
                </div>
                <div className="inbound-field mt-4">
                  <label className="erp-field-label mb-1.5 block">
                    金额<span className="ml-1 text-[#C63C3C]">*</span>
                  </label>
                  <input
                    className="crm-input w-full text-right tabular-nums"
                    value={payAmount}
                    disabled={
                      !canWrite ||
                      paymentMutation.isPending ||
                      Boolean(uncertainPayment)
                    }
                    onChange={event => setPayAmount(event.target.value)}
                    placeholder="含税金额"
                  />
                </div>
                <div className="inbound-field mt-4">
                  <label className="erp-field-label mb-1.5 block">
                    收款日期<span className="ml-1 text-[#C63C3C]">*</span>
                  </label>
                  <input
                    type="date"
                    className="crm-input w-full"
                    value={payDate}
                    disabled={
                      !canWrite ||
                      paymentMutation.isPending ||
                      Boolean(uncertainPayment)
                    }
                    onChange={event => setPayDate(event.target.value)}
                  />
                </div>
                <div className="inbound-field mt-4">
                  <label className="erp-field-label mb-1.5 block">备注</label>
                  <input
                    className="crm-input w-full"
                    maxLength={255}
                    value={payNote}
                    disabled={
                      !canWrite ||
                      paymentMutation.isPending ||
                      Boolean(uncertainPayment)
                    }
                    onChange={event => setPayNote(event.target.value)}
                  />
                </div>
                <div className="mt-6 flex justify-end gap-2.5">
                  <button
                    type="button"
                    className="crm-btn"
                    disabled={paymentMutation.isPending}
                    onClick={() => requestCloseTransaction("pay")}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="crm-btn crm-btn-primary"
                    disabled={
                      !canWrite ||
                      paymentMutation.isPending ||
                      !detailQuery.data ||
                      detailQuery.data.status !== "confirmed"
                    }
                    onClick={() => {
                      if (
                        !session.isWritable() ||
                        !detailQuery.data ||
                        detailQuery.data.status !== "confirmed"
                      )
                        return;
                      const payload = uncertainPayment ?? {
                        id: detailQuery.data.id,
                        version: detailQuery.data.version,
                        requestId: payRequestIdRef.current,
                        method: payMethod,
                        amount: payAmount.trim(),
                        paymentDate: payDate,
                        note: payNote.trim(),
                      };
                      setUncertainPayment(payload);
                      paymentMutation.mutate(payload);
                    }}
                  >
                    {paymentMutation.isPending
                      ? "保存中…"
                      : uncertainPayment
                        ? "确认收款结果"
                        : "确认收款"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      <Dialog
        open={shipOpen}
        onOpenChange={open => {
          if (!open) requestCloseTransaction("ship");
        }}
      >
        <DialogContent
          className="crm-sales-orders-dialog w-[calc(100vw-32px)] max-h-[90vh] max-w-[960px] overflow-y-auto"
          showCloseButton={!companyShipBusy}
        >
          <DialogHeader>
            <DialogTitle>出货</DialogTitle>
          </DialogHeader>
          {detailQuery.isLoading || detailQuery.isFetching ? (
            <p role="status">正在核验订单与本单预留…</p>
          ) : detailQuery.isError ? (
            <p role="alert">
              {detailQuery.error?.message || "订单读取失败"}{" "}
              <button
                type="button"
                className="crm-btn"
                onClick={() => {
                  void detailQuery.refetch();
                }}
              >
                重试
              </button>
            </p>
          ) : null}
          {shipmentOrder ? (
            <CompanyStockShipmentForm
              key={shipmentIdentity}
              order={shipmentOrder}
              enabled={
                canWrite &&
                detailQuery.data?.status === "confirmed" &&
                !detailQuery.isFetching &&
                !detailQuery.isError
              }
              onDirtyChange={setCompanyShipDirty}
              onBusyChange={setCompanyShipBusy}
              onCancel={() => requestCloseTransaction("ship")}
              onAllocated={() => {
                if (!session.isWritable()) return;
                toast.success("公司批次已分配");
                embedded?.onOrderChanged?.();
                void Promise.allSettled([
                  utils.crmSalesOrder.get.invalidate(),
                  utils.crmSalesOrder.list.invalidate(),
                ]);
              }}
              onSaved={() => {
                if (!session.isWritable()) return;
                toast.success("出货已登记");
                embedded?.onOrderChanged?.();
                setShipOpen(false);
                void Promise.allSettled([
                  utils.crmSalesOrder.get.invalidate(),
                  utils.crmSalesOrder.list.invalidate(),
                ]);
              }}
            />
          ) : (
            <p role="status">订单暂不可用</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
