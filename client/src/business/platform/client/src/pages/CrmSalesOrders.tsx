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
import {
  AdminPage,
  AdminFilterBar,
  AdminDataPanel,
} from "@/components/admin/UnifiedAdminPage";
import { useBusinessScope } from "../../../../BusinessScope";
import { useBusinessWorkbenchAccess } from "../../../../BusinessWorkbenchAccessGate";
import { businessSalesOrderMetadataCanWrite } from "../lib/businessSalesOrderMetadataAccess";
import { useBusinessSalesOrderPresentation } from "../hooks/useBusinessSalesOrderPresentation";
import {
  BusinessOrderItems,
  BusinessOrderMetadataBoundary,
  BusinessOrderLogistics,
  BusinessOrderRowActions,
  type BusinessSalesOrderRowSlots,
} from "../components/businessSalesOrderRows";
import {
  BUSINESS_AFTERSALE_MISSING,
  BUSINESS_RECEIVER_MISSING,
} from "../lib/businessSalesOrderPresentation";
import {
  BusinessSalesOrderMetadataProvider,
  BusinessSalesOrderReceiverCell,
  BusinessSalesOrderAfterSaleCell,
  BusinessSalesOrderMetadataActionItems,
  createBusinessSalesOrderMetadataExportReader,
} from "../components/businessSalesOrderMetadata";
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
import {
  customerMatches,
  customerPageMatches,
  useSalesOrderSession,
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
  type CrmSalesPaymentMethod,
  type SalesOrderDemandCandidate,
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
  rowSlots?: BusinessSalesOrderRowSlots;
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
export default function CrmSalesOrders({
  rowSlots,
}: { rowSlots?: BusinessSalesOrderRowSlots } = {}) {
  const proof = useBusinessScope().contextVerification;
  const proofKey = JSON.stringify([proof.identity, proof.authorizationVersion, proof.readVersion]);
  const previousProof = useRef(proofKey);
  const ready = usePageMemory();
  const state: OrderListState = {
    draftKeyword: useRememberedState("draftKeyword", ""),
    keyword: useRememberedState("keyword", ""),
    status: useRememberedState<StatusFilter>("status", "all"),
    page: useRememberedState("page", 1),
    selectedId: useRememberedState<number | null>("selectedId", null),
  };
  useEffect(() => {
    if (previousProof.current === proofKey) return;
    previousProof.current = proofKey;
    state.selectedId[1](null);
  }, [proofKey]);
  return (
    <PlatformLayout>
      <SalesOrdersContent key={proofKey} ready={ready} state={state} rowSlots={rowSlots} />
    </PlatformLayout>
  );
}
/** Caller must prove sales.business_orders; customer read access never implies order access. */
export function CustomerSalesOrders(props: CustomerSalesOrdersProps) {
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
  const proof = useBusinessScope().contextVerification;
  const proofKey = JSON.stringify([proof.identity, proof.authorizationVersion, proof.readVersion]);
  const previousProof = useRef(proofKey);
  const state: OrderListState = {
    draftKeyword: useState(""),
    keyword: useState(""),
    status: useState<StatusFilter>("all"),
    page: useState(1),
    selectedId: useState<number | null>(null),
  };
  useEffect(() => {
    if (previousProof.current === proofKey) return;
    previousProof.current = proofKey;
    state.selectedId[1](null);
  }, [proofKey]);
  return (
    <SalesOrdersContent
      key={proofKey}
      ready
      state={state}
      embedded={props}
      rowSlots={props.rowSlots}
    />
  );
}
function SalesOrdersContent({
  ready,
  state,
  embedded,
  rowSlots,
}: {
  ready: boolean;
  state: OrderListState;
  embedded?: CustomerSalesOrdersProps;
  rowSlots?: BusinessSalesOrderRowSlots;
}) {
  const utils = trpc.useUtils();
  const business = useBusinessScope();
  const metadataAccess = useBusinessWorkbenchAccess();
  const verification = business.contextVerification;
  const verified = verification.state === "verified";
  const verifiedIdentity = JSON.stringify([
    verification.identity,
    verification.authorizationVersion,
    verification.readVersion,
    embedded?.contextIdentityKey,
    embedded?.customer.id,
  ]);
  const verifiedIdentityRef = useRef(verifiedIdentity);
  const [, navigate] = useLocation();
  const search = useSearch();
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
    !embedded ||
    (embedded.canRead === true &&
      embedded.canWrite === true &&
      !embedded.readOnly &&
      !embedded.customer.archivedAt);
  const coreSession = useSalesOrderSession(canWrite && verified);
  const liveIdentityRef = useRef(verifiedIdentity);
  liveIdentityRef.current = verifiedIdentity;
  const session = useMemo(
    () => ({
      isWritable: () =>
        coreSession.isWritable() &&
        liveIdentityRef.current === verifiedIdentity,
    }),
    [coreSession, verifiedIdentity]
  );
  const [entryOpen, setEntryOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
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
  const formTouched = Boolean(
    selectedDemand ||
      lines.some(line => line.qty || line.agreedUnitPrice) ||
      dueDate ||
      confirmationNote ||
      customerConfirmed
  );

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
    trpc.crmSalesOrder.list.useQuery(
      listInput,
      freshListOptions({ trpc: { abortOnUnmount: true } }, ready && verified)
    ),
    !embedded
  );
  const rawDetailQuery = trpc.crmSalesOrder.get.useQuery(
    {
      id: selectedId ?? 1,
      ...(customerId === undefined ? {} : { customerId }),
    },
    {
      enabled: selectedId != null && verified,
      trpc: { abortOnUnmount: true },
      staleTime: 0,
      refetchOnMount: "always",
    }
  );
  const rawCandidatesQuery = trpc.crmSalesOrder.candidates.useQuery(
    {
      keyword: candidateApplied,
      ...(customerId === undefined ? {} : { customerId }),
      page: candidatePage,
      pageSize: 10,
    },
    { enabled: entryOpen && canWrite, staleTime: 0, refetchOnMount: "always" }
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
    customerId
  );
  const listQuery = {
    ...rawListQuery,
    data:
      !verified ||
      verifiedIdentityRef.current !== verifiedIdentity ||
      listMismatch ||
      rawListQuery.isError ||
      rawListQuery.isFetching ||
      rawListQuery.isFetchedAfterMount === false
        ? undefined
        : rawListQuery.data,
    isError: rawListQuery.isError || listMismatch,
    error: listMismatch ? scopeError : rawListQuery.error,
  };
  const detailQuery = {
    ...rawDetailQuery,
    data:
      !verified ||
      verifiedIdentityRef.current !== verifiedIdentity ||
      detailMismatch ||
      rawDetailQuery.isError ||
      rawDetailQuery.isFetching ||
      rawDetailQuery.isFetchedAfterMount === false
        ? undefined
        : rawDetailQuery.data,
    isError: rawDetailQuery.isError || detailMismatch,
    error: detailMismatch ? scopeError : rawDetailQuery.error,
  };
  const candidatesQuery = {
    ...rawCandidatesQuery,
    data:
      !verified ||
      verifiedIdentityRef.current !== verifiedIdentity ||
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
  const metadataReady = ready && verified && verifiedIdentityRef.current === verifiedIdentity && listQuery.data != null;
  const metadataCanWrite = businessSalesOrderMetadataCanWrite({ verified: metadataReady, merchantId: business.merchantId, pageWritable: session.isWritable(), access: metadataAccess });
  const metadataLive = useRef({ ready: metadataReady, identity: verifiedIdentity, merchantId: business.merchantId });
  metadataLive.current = { ready: metadataReady, identity: verifiedIdentity, merchantId: business.merchantId };
  const metadataSlots = useMemo<BusinessSalesOrderRowSlots>(() => ({
    wrapList: context => <BusinessSalesOrderMetadataProvider {...context} />,
    receiverCell: ({ order }) => <BusinessSalesOrderReceiverCell order={order} />,
    statusCell: ({ order }) => <BusinessSalesOrderAfterSaleCell order={order} />,
    options: ({ order }) => <BusinessSalesOrderMetadataActionItems order={order} />,
    readExportMetadata: createBusinessSalesOrderMetadataExportReader({
      ready: metadataReady,
      identityKey: verifiedIdentity,
      merchantId: business.merchantId ?? 0,
      ...(customerId === undefined ? {} : { customerId }),
      isCurrent: () => metadataLive.current.ready && metadataLive.current.identity === verifiedIdentity && metadataLive.current.merchantId === business.merchantId,
      onAuthorizationError: business.onAuthorizationError,
    }),
    ...rowSlots,
  }), [metadataReady, verifiedIdentity, business.merchantId, customerId, business.onAuthorizationError, rowSlots]);
  // New presentation reads bypass shared query cache: a previous principal's cached
  // get/list response or in-flight fetch can never satisfy this read generation.
  const presentation = useBusinessSalesOrderPresentation({
    identity: verifiedIdentity,
    verified: verified && verifiedIdentityRef.current === verifiedIdentity,
    page,
    filters: {
      keyword,
      ...(customerId === undefined ? {} : { customerId }),
      ...(status === "all" ? {} : { status }),
    },
    rows: listQuery.data?.items,
    total: listQuery.data?.total,
    readRevision: rawListQuery.dataUpdatedAt,
    readers: {
      list: (input, signal) =>
        utils.client.crmSalesOrder.list.query(input, { signal }),
      get: (input, signal) =>
        utils.client.crmSalesOrder.get.query(input, { signal }),
    },
    onReadError: business.onAuthorizationError,
    readExportMetadata: metadataSlots?.readExportMetadata,
  });
  useEffect(() => {
    if (verifiedIdentityRef.current === verifiedIdentity) return;
    verifiedIdentityRef.current = verifiedIdentity;
    setSelectedId(null);
    setPayOpen(false);
    setShipOpen(false);
    setCancelOpen(false);
    // Require a new response before showing same-id data after a proof revision.
    void utils.crmSalesOrder.list.invalidate();
    void utils.crmSalesOrder.get.invalidate();
  }, [verifiedIdentity, utils]);
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
      closeEntry();
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
      setUncertainSave(!knownRejection);
      toast.error(error.message || "订单保存结果尚未确认，请重试原请求");
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
      payRequestIdRef.current = newRequestId();
      toast.success(result.replayed ? "已返回此前登记的收款" : "收款已登记");
      void Promise.allSettled([
        utils.crmSalesOrder.list.invalidate(),
        utils.crmSalesOrder.get.invalidate(),
      ]);
    },
    onError: error => {
      if (session.isWritable()) toast.error(error.message || "收款登记失败");
    },
  });
  const shipMutation = trpc.crmSalesOrder.ship.useMutation({
    onSuccess: result => {
      if (!session.isWritable()) return;
      embedded?.onOrderChanged?.();
      setShipOpen(false);
      setShipQtys({});
      setExpressCo("");
      setExpressNo("");
      setShipNote("");
      shipRequestIdRef.current = newRequestId();
      toast.success(
        result.replayed ? "已返回此前出货记录" : "出货已登记并扣减库存"
      );
      void Promise.allSettled([
        utils.crmSalesOrder.list.invalidate(),
        utils.crmSalesOrder.get.invalidate(),
      ]);
    },
    onError: error => {
      if (session.isWritable()) toast.error(error.message || "出货失败");
    },
  });

  const applyFilters = () => {
    setKeyword(draftKeyword.trim());
    setPage(1);
  };
  const selectDemand = (demand: SalesOrderDemandCandidate) => {
    if (!session.isWritable() || !customerMatches(demand, customerId)) return;
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
  const submitOrder = () => {
    if (
      !session.isWritable() ||
      savingRef.current ||
      candidateMismatch ||
      (embedded && (!candidatesQuery.data || candidatesQuery.isError))
    )
      return;
    if (!selectedDemand || !customerMatches(selectedDemand, customerId)) {
      toast.error("请选择客户需求");
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
      toast.error("请至少确认一行物料数量与单价");
      return;
    }
    if (!customerConfirmed) {
      toast.error("请确认已与客户确认订单");
      return;
    }
    if (!confirmationNote.trim()) {
      toast.error("请填写客户确认说明");
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
      toast.error(parsed.error.issues[0]?.message ?? "请检查订单内容");
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
      toast.error("确认数量超过可用需求数量，请检查后重试");
      return;
    }
    const fingerprint = JSON.stringify(
      canonicalSalesOrderCreatePayload(parsed.data)
    );
    if (!requestKeysRef.current.has(fingerprint))
      requestKeysRef.current.set(fingerprint, newRequestId());
    savingRef.current = true;
    createMutation.mutate({
      ...parsed.data,
      requestId: requestKeysRef.current.get(fingerprint)!,
    });
  };
  const cancelOrder = () => {
    if (!session.isWritable() || !detailQuery.data) return;
    setCancelReason("");
    setCancelError("");
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
    cancelMutation.mutate({
      id: detail.id,
      version: detail.version,
      reason: cancelReason.trim(),
    });
  };

  const payTouched =
    payOpen &&
    Boolean(
      payAmount || payNote || payMethod !== "bank" || payDate !== todayLocal()
    );
  const shipTouched =
    shipOpen &&
    Boolean(
      Object.values(shipQtys).some(Boolean) ||
        expressCo ||
        expressNo ||
        shipNote ||
        shipMethod !== "express"
    );
  const cancelTouched = cancelOpen && Boolean(cancelReason);
  const pending =
    createMutation.isPending ||
    paymentMutation.isPending ||
    shipMutation.isPending ||
    cancelMutation.isPending;
  const dirty = Boolean(
    (entryOpen && formTouched) ||
      payTouched ||
      shipTouched ||
      cancelTouched ||
      pending
  );
  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);
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
          ? shipMutation.isPending
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
    if (kind === "pay") setPayOpen(false);
    else if (kind === "ship") setShipOpen(false);
    else setCancelOpen(false);
  };
  useEffect(() => {
    const guardNavigation = (event: MouseEvent) => {
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (!dirty || !anchor || anchor.getAttribute("href")?.startsWith("#"))
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
  }, [dirty, pending]);
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
    setEntryOpen(true);
    embedded?.onIntentHandled?.(intent.nonce);
  }, [embedded?.intent, embedded?.onIntentHandled, dirty, pending, canWrite]);

  return (
    <>
      <BusinessOrderMetadataBoundary
        slots={metadataSlots}
        context={{
          rows: listQuery.data?.items ?? [],
          ready: metadataReady,
          canWrite: metadataCanWrite,
          identityKey: verifiedIdentity,
          merchantId: business.merchantId,
          ...(customerId === undefined ? {} : { customerId }),
        }}
      >
        <AdminPage
          className={`crm-sales-orders-page min-w-0 space-y-3${embedded ? " crm-sales-orders-embedded" : ""}`}
          aria-label={
            embedded ? `${embedded.customer.name}订单与出货` : undefined
          }
        >
          {embedded && !canWrite ? (
            <p role="status" className="crm-sales-orders-readonly-note">
              {embedded.customer.archivedAt
                ? "客户已归档，订单与出货仅供查看。"
                : "当前为只读模式，不能录入、收款、出货或取消订单。"}
            </p>
          ) : null}

          <AdminDataPanel className="overflow-hidden">
            <AdminFilterBar className="crm-sales-orders-filters border-0 border-b rounded-none shadow-none">
              <div className="flex w-full flex-wrap items-center gap-2">
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
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {canWrite ? (
                    <Button
                      type="button"
                      className={buttonClass}
                      disabled={!verified}
                      onClick={() => setEntryOpen(true)}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      {embedded ? "成交确认 / 生成订单" : "录入销售订单"}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    className={secondaryButtonClass}
                    disabled={
                      !listQuery.data || presentation.exportBusy || !verified
                    }
                    onClick={() => void presentation.exportOrders()}
                  >
                    {presentation.exportBusy
                      ? "导出中…"
                      : presentation.selectedIds.size
                        ? `导出选中 ${presentation.selectedIds.size}`
                        : "导出当前筛选全部"}
                  </Button>
                  {presentation.exportBusy ? (
                    <Button
                      type="button"
                      variant="outline"
                      className={secondaryButtonClass}
                      onClick={presentation.cancelExport}
                    >
                      取消导出
                    </Button>
                  ) : null}
                </div>
              </div>
            </AdminFilterBar>
            {presentation.exportMessage ? (
              <p
                role="status"
                className="px-3 py-1.5 text-xs text-muted-foreground"
              >
                {presentation.exportMessage}
              </p>
            ) : null}
            {!verified ? (
              <p
                role="status"
                className="px-3 py-2 text-xs text-muted-foreground"
              >
                正在重新核验业务身份，暂停读取与导出。
              </p>
            ) : null}
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
                  className="crm-sales-orders-table admin-table-readable w-full min-w-[1040px] table-fixed"
                  containerClassName="crm-sales-orders-table-scroll overflow-x-auto"
                >
                  <colgroup>
                    <col className="w-[36px]" />
                    <col className="w-[150px]" />
                    <col className="w-[19%]" />
                    <col className="w-[20%]" />
                    <col className="w-[156px]" />
                    <col />
                    <col className="w-[132px]" />
                    <col className="w-[64px]" />
                  </colgroup>
                  <TableHeader>
                    <TableRow className="bg-slate-50 hover:bg-slate-50">
                      <TableHead className="h-8 px-2 text-center">
                        <input
                          type="checkbox"
                          aria-label="选择本页全部订单"
                          checked={
                            listQuery.data.items.length > 0 &&
                            listQuery.data.items.every(order =>
                              presentation.selectedIds.has(order.id)
                            )
                          }
                          disabled={presentation.exportBusy}
                          onChange={presentation.toggleAll}
                        />
                      </TableHead>
                      {[
                        "订单 / 日期",
                        "客户 / 收货人",
                        "商品明细",
                        "含税金额",
                        "配送 / 物流",
                        "状态",
                        "操作",
                      ].map((label, index) => (
                        <TableHead
                          key={label}
                          className={`h-8 px-2 text-[11px] text-slate-500${index === 3 || index === 6 ? " text-right" : ""}`}
                        >
                          {label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listQuery.data.items.map(order => (
                      <TableRow
                        key={order.id}
                        className="h-14"
                        data-page-memory-row={String(order.id)}
                      >
                        <TableCell className="px-2 py-1.5 text-center">
                          <input
                            type="checkbox"
                            aria-label={`选择订单 ${order.orderNumber}`}
                            checked={presentation.selectedIds.has(order.id)}
                            disabled={presentation.exportBusy}
                            onChange={() => presentation.toggle(order.id)}
                          />
                        </TableCell>
                        <TableCell className="min-w-0 px-2 py-1.5">
                          <button
                            type="button"
                            className="crm-sales-orders-order-link block w-full truncate text-left font-medium text-[#185FA5] hover:underline"
                            title={order.orderNumber}
                            onClick={() => setSelectedId(order.id)}
                          >
                            {order.orderNumber}
                          </button>
                          <div className="admin-cell-secondary mt-0.5 tabular-nums">
                            {beijingDate(order.createdAt)}
                          </div>
                          <div
                            className="admin-cell-secondary mt-0.5 truncate"
                            title={`${order.demandNo} · ${order.projectName || "—"}`}
                          >
                            {order.demandNo} · {order.projectName || "—"}
                          </div>
                        </TableCell>
                        <TableCell className="min-w-0 px-2 py-1.5 whitespace-normal">
                          <div
                            className="admin-cell-primary truncate"
                            title={order.customerName}
                          >
                            {order.customerName || "—"}
                          </div>
                          {metadataSlots?.receiverCell ? (
                            metadataSlots.receiverCell({
                              order,
                              identity: verifiedIdentity,
                              verified,
                              canWrite,
                            })
                          ) : (
                            <>
                              <div className="admin-cell-secondary mt-0.5">
                                收货人：{BUSINESS_RECEIVER_MISSING}
                              </div>
                              <div className="admin-cell-secondary mt-0.5">
                                地址：{BUSINESS_RECEIVER_MISSING}
                              </div>
                            </>
                          )}
                        </TableCell>
                        <TableCell className="min-w-0 px-2 py-1.5">
                          <BusinessOrderItems
                            detail={presentation.details?.get(order.id)}
                            failed={presentation.detailsError}
                            onView={() => setSelectedId(order.id)}
                          />
                        </TableCell>
                        <TableCell className="admin-cell-primary px-2 py-1.5 text-right tabular-nums">
                          <div className="font-medium">
                            {formatSalesOrderAmount(order.totalAmount)}
                          </div>
                          <div className="admin-cell-secondary mt-0.5">
                            已收 {formatSalesOrderAmount(order.paidAmount)}
                          </div>
                          <div className="admin-cell-secondary mt-0.5">
                            月结 {formatSalesOrderAmount(order.monthlyAmount)}
                          </div>
                        </TableCell>
                        <TableCell className="min-w-0 px-2 py-1.5">
                          <BusinessOrderLogistics
                            detail={presentation.details?.get(order.id)}
                            failed={presentation.detailsError}
                            onView={() => setSelectedId(order.id)}
                          />
                          <div className="admin-cell-secondary mt-0.5">
                            {
                              CRM_SALES_SHIPMENT_STATUS_LABELS[
                                order.shipmentStatus
                              ]
                            }
                          </div>
                        </TableCell>
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
                          <div className="admin-cell-secondary mt-0.5">
                            {
                              CRM_SALES_PAYMENT_STATUS_LABELS[
                                order.paymentStatus
                              ]
                            }
                          </div>
                          {metadataSlots?.statusCell ? (
                            metadataSlots.statusCell({
                              order,
                              identity: verifiedIdentity,
                              verified,
                              canWrite,
                            })
                          ) : (
                            <div
                              className="admin-cell-secondary mt-0.5"
                              title={BUSINESS_AFTERSALE_MISSING}
                            >
                              {BUSINESS_AFTERSALE_MISSING}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="px-2 py-1.5 text-right">
                          <BusinessOrderRowActions
                            orderNumber={order.orderNumber}
                          >
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
                          </BusinessOrderRowActions>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {presentation.detailsError ? (
              <p role="alert" className="px-3 py-2 text-xs text-red-600">
                商品 / 物流：{presentation.detailsError}{" "}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={presentation.retry}
                >
                  重试商品与统计
                </Button>
              </p>
            ) : null}
            {listQuery.data ? (
              <div className="aui-pagination crm-sales-orders-pagination flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
                <div className="flex flex-wrap items-center gap-3">
                  <span>
                    共 {presentation.aggregate?.total ?? listQuery.data.total}{" "}
                    条，每页 {PAGE_SIZE} 条
                  </span>
                  <span>
                    当前筛选含税金额：
                    {presentation.aggregate
                      ? formatSalesOrderAmount(presentation.aggregate.amount)
                      : presentation.aggregateError
                        ? "统计失败"
                        : "统计中…"}
                  </span>
                  {presentation.aggregateError ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      title={presentation.aggregateError}
                      onClick={presentation.retry}
                    >
                      重试统计
                    </Button>
                  ) : null}
                  {presentation.selectedIds.size ? (
                    <span>
                      本页已选 {presentation.selectedIds.size} 条；翻页 /
                      更改筛选将清空
                    </span>
                  ) : null}
                </div>
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
          </AdminDataPanel>
        </AdminPage>
      </BusinessOrderMetadataBoundary>

      <Dialog
        open={entryOpen}
        onOpenChange={open => (open ? setEntryOpen(true) : requestCloseEntry())}
      >
        <DialogContent
          className="crm-sales-orders-dialog grid-cols-[minmax(0,1fr)] w-[calc(100vw-32px)] max-h-[92vh] max-w-[1100px] overflow-x-hidden overflow-y-auto p-4 sm:max-w-[1100px]"
          showCloseButton={!createMutation.isPending}
        >
          <DialogHeader>
            <DialogTitle className="text-base text-slate-800">
              客户成交报价与确认
            </DialogTitle>
            <p className="text-xs text-slate-500">
              {embedded ? `已锁定客户：${embedded.customer.name}。` : ""}
              仅显示已采用采购报价的物料。采购报价 /
              销售采用不等于客户确认；请填写客户同意的数量、含税单价和交期，并记录确认依据。此处不保存或发送独立销售报价，客户明确确认后直接生成真实订单。
            </p>
          </DialogHeader>
          {uncertainSave && (
            <p
              role="alert"
              className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800"
            >
              上次保存结果尚未确认，请点击“确认保存结果”重试原请求。确认前暂不允许修改，关闭不会撤销可能已创建的订单。
            </p>
          )}
          {!selectedDemand ? (
            <div className="space-y-2">
              <AdminFilterBar className="crm-sales-orders-candidate-filters">
                <Input
                  className="h-8 text-xs"
                  value={candidateKeyword}
                  placeholder="搜索需求号、项目或型号"
                  onChange={event => setCandidateKeyword(event.target.value)}
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
                      <TableHead className="h-8 text-xs">需求 / 项目</TableHead>
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
                          {candidatesQuery.error?.message || "需求读取失败"}
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
                            demand.items.filter(item => item.remainingQty > 0)
                              .length
                          }{" "}
                          行可下单
                        </TableCell>
                        <TableCell className="py-2 text-right">
                          <Button
                            type="button"
                            className="admin-row-action text-xs"
                            variant="outline"
                            disabled={
                              !demand.items.some(item => item.remainingQty > 0)
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
                              updateLine(item.id, "qty", event.target.value)
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
                  <Label htmlFor="sales-order-due-date" className="text-xs">
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
                  <Label htmlFor="sales-order-confirmation" className="text-xs">
                    客户确认说明 <span className="text-red-600">*</span>
                  </Label>
                  <Textarea
                    id="sales-order-confirmation"
                    disabled={createMutation.isPending || uncertainSave}
                    className="min-h-16 text-xs"
                    maxLength={500}
                    value={confirmationNote}
                    placeholder="例如：2026-09-23 电话确认型号、数量及含税单价"
                    onChange={event => setConfirmationNote(event.target.value)}
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
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className={secondaryButtonClass}
              disabled={createMutation.isPending}
              onClick={requestCloseEntry}
            >
              取消
            </Button>
            {selectedDemand ? (
              <Button
                type="button"
                className={buttonClass}
                disabled={
                  !canWrite ||
                  candidateMismatch ||
                  Boolean(
                    embedded &&
                      (!candidatesQuery.data || candidatesQuery.isError)
                  ) ||
                  createMutation.isPending
                }
                onClick={submitOrder}
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
        </DialogContent>
      </Dialog>
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent className="crm-sales-orders-dialog max-w-sm p-4 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">放弃本次录入？</DialogTitle>
            <p className="text-xs text-slate-500">
              {uncertainSave
                ? "上次保存结果尚未确认，关闭不会撤销已创建订单；请先查看订单列表，避免再次录入。"
                : "已填写内容尚未保存。"}
            </p>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className={secondaryButtonClass}
              onClick={() => setDiscardOpen(false)}
            >
              继续编辑
            </Button>
            <Button type="button" className={buttonClass} onClick={closeEntry}>
              放弃录入
            </Button>
          </DialogFooter>
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
                  <span className="text-slate-500">来源需求：</span>
                  {detailQuery.data.demandNo}
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
                  {formatSalesOrderAmount(detailQuery.data.totalAmount)}
                  （人民币含税）
                </div>
                <div>
                  <span className="text-slate-500">交付日期：</span>
                  {detailQuery.data.dueDate || "—"}
                </div>
              </AdminDataPanel>
              <div>
                <div className="mb-1 font-medium text-slate-700">
                  客户确认说明
                </div>
                <AdminDataPanel className="p-3 text-slate-600">
                  {detailQuery.data.confirmationNote}
                </AdminDataPanel>
              </div>
              <AdminDataPanel className="min-w-0 max-w-full overflow-auto">
                <Table className="crm-sales-orders-dialog-table admin-table-readable">
                  <TableHeader className="bg-slate-50">
                    <TableRow>
                      <TableHead className="h-8 text-xs">型号</TableHead>
                      <TableHead className="h-8 text-right text-xs">
                        数量
                      </TableHead>
                      <TableHead className="h-8 text-right text-xs">
                        含税单价
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
                  {detailQuery.data.payments.map(payment => (
                    <div key={payment.id} className="admin-cell-secondary mt-1">
                      {payment.paymentDate}{" "}
                      {CRM_SALES_PAYMENT_METHOD_LABELS[payment.method]}{" "}
                      {formatSalesOrderAmount(payment.amount)}
                      {payment.note ? ` · ${payment.note}` : ""}
                    </div>
                  ))}
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
              onClick={() => setSelectedId(null)}
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
              disabled={cancelMutation.isPending}
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
                    onChange={event => setPayDate(event.target.value)}
                  />
                </div>
                <div className="inbound-field mt-4">
                  <label className="erp-field-label mb-1.5 block">备注</label>
                  <input
                    className="crm-input w-full"
                    maxLength={255}
                    value={payNote}
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
                      paymentMutation.mutate({
                        id: detailQuery.data.id,
                        version: detailQuery.data.version,
                        requestId: payRequestIdRef.current,
                        method: payMethod,
                        amount: payAmount.trim(),
                        paymentDate: payDate,
                        note: payNote.trim(),
                      });
                    }}
                  >
                    {paymentMutation.isPending ? "保存中…" : "确认收款"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      {shipOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"
              onClick={() => requestCloseTransaction("ship")}
            >
              <div
                className="crm-sales-orders-dialog max-h-[90vh] w-[560px] max-w-full overflow-y-auto rounded-xl bg-white p-4"
                onClick={event => event.stopPropagation()}
              >
                <h3 className="text-[18px] font-semibold">出货</h3>
                {detailQuery.data ? (
                  <>
                    <div className="grid gap-x-4 sm:grid-cols-2">
                      <div className="inbound-field mt-4">
                        <label className="erp-field-label mb-1.5 block">
                          交付方式<span className="ml-1 text-[#C63C3C]">*</span>
                        </label>
                        <select
                          className="crm-input w-full"
                          value={shipMethod}
                          onChange={event =>
                            setShipMethod(
                              event.target.value as "express" | "pickup"
                            )
                          }
                        >
                          <option value="express">快递</option>
                          <option value="pickup">自提</option>
                        </select>
                      </div>
                      {shipMethod === "express" ? (
                        <>
                          <div className="inbound-field mt-4">
                            <label className="erp-field-label mb-1.5 block">
                              快递公司
                              <span className="ml-1 text-[#C63C3C]">*</span>
                            </label>
                            <input
                              className="crm-input w-full"
                              value={expressCo}
                              onChange={event =>
                                setExpressCo(event.target.value)
                              }
                            />
                          </div>
                          <div className="inbound-field mt-4 sm:col-span-2">
                            <label className="erp-field-label mb-1.5 block">
                              快递单号
                              <span className="ml-1 text-[#C63C3C]">*</span>
                            </label>
                            <input
                              className="crm-input w-full"
                              value={expressNo}
                              onChange={event =>
                                setExpressNo(event.target.value)
                              }
                            />
                          </div>
                        </>
                      ) : null}
                    </div>
                    <div className="inbound-field mt-4">
                      <label className="erp-field-label mb-1.5 block">
                        备注
                      </label>
                      <input
                        className="crm-input w-full"
                        value={shipNote}
                        onChange={event => setShipNote(event.target.value)}
                      />
                    </div>
                    <div className="crm-sales-orders-section-title mt-6">
                      出货数量
                    </div>
                    <AdminDataPanel className="overflow-x-auto">
                      <table className="crm-table crm-sales-orders-dialog-table crm-sales-orders-shipment-table admin-table-readable">
                        <thead>
                          <tr>
                            <th>型号</th>
                            <th className="text-right">待出</th>
                            <th className="text-right">库存</th>
                            <th className="text-right">本次出货</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailQuery.data.items.flatMap(item => {
                            const candidates = (
                              detailQuery.data?.stockCandidates ?? []
                            ).filter(
                              candidate => candidate.orderItemId === item.id
                            );
                            const remaining = item.orderedQty - item.shippedQty;
                            if (!candidates.length) {
                              return [
                                <tr key={item.id}>
                                  <td>{item.partNumber}</td>
                                  <td className="text-right tabular-nums">
                                    {remaining}
                                    {item.qtyUnit}
                                  </td>
                                  <td className="admin-cell-secondary text-right tabular-nums">
                                    0
                                  </td>
                                  <td className="admin-cell-secondary text-right">
                                    无库存
                                  </td>
                                </tr>,
                              ];
                            }
                            return candidates.map(candidate => {
                              const key = `${item.id}:${candidate.inventoryId}`;
                              return (
                                <tr key={key}>
                                  <td>
                                    <div className="admin-cell-primary crm-sales-orders-model font-medium">
                                      {item.partNumber}
                                    </div>
                                    <div className="admin-cell-secondary">
                                      {candidate.ownerName}
                                    </div>
                                  </td>
                                  <td className="text-right tabular-nums">
                                    {remaining}
                                    {item.qtyUnit}
                                  </td>
                                  <td className="text-right tabular-nums">
                                    {candidate.availableQty}
                                  </td>
                                  <td className="text-right">
                                    <input
                                      className="crm-input w-24 text-right tabular-nums"
                                      value={shipQtys[key] ?? ""}
                                      onChange={event =>
                                        setShipQtys(current => ({
                                          ...current,
                                          [key]: event.target.value,
                                        }))
                                      }
                                    />
                                  </td>
                                </tr>
                              );
                            });
                          })}
                        </tbody>
                      </table>
                    </AdminDataPanel>
                  </>
                ) : null}
                {detailQuery.data &&
                detailQuery.data.items.every(item =>
                  (detailQuery.data?.stockCandidates ?? []).every(
                    candidate => candidate.orderItemId !== item.id
                  )
                ) ? (
                  <div className="mt-4 text-xs text-[#8A4B08]">
                    无匹配库存，请先入库后再出货。
                  </div>
                ) : null}
                <div className="mt-6 flex justify-end gap-2.5">
                  <button
                    type="button"
                    className="crm-btn"
                    disabled={shipMutation.isPending}
                    onClick={() => requestCloseTransaction("ship")}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="crm-btn crm-btn-primary"
                    disabled={
                      !canWrite ||
                      shipMutation.isPending ||
                      !detailQuery.data ||
                      detailQuery.data.status !== "confirmed" ||
                      Boolean(
                        detailQuery.data &&
                          detailQuery.data.items.every(item =>
                            (detailQuery.data?.stockCandidates ?? []).every(
                              candidate => candidate.orderItemId !== item.id
                            )
                          )
                      )
                    }
                    onClick={() => {
                      if (
                        !session.isWritable() ||
                        !detailQuery.data ||
                        detailQuery.data.status !== "confirmed"
                      )
                        return;
                      const items = Object.entries(shipQtys)
                        .map(([key, qty]) => {
                          const [orderItemId, inventoryId] = key
                            .split(":")
                            .map(Number);
                          return { orderItemId, inventoryId, qty: Number(qty) };
                        })
                        .filter(
                          item => Number.isInteger(item.qty) && item.qty > 0
                        );
                      if (!items.length) {
                        toast.error(
                          detailQuery.data.stockCandidates.length
                            ? "请填写出货数量"
                            : "无匹配库存，请先入库"
                        );
                        return;
                      }
                      shipMutation.mutate({
                        id: detailQuery.data.id,
                        version: detailQuery.data.version,
                        requestId: shipRequestIdRef.current,
                        deliveryMethod: shipMethod,
                        expressCo: expressCo.trim(),
                        expressNo: expressNo.trim(),
                        note: shipNote.trim(),
                        items,
                      });
                    }}
                  >
                    {shipMutation.isPending ? "提交中…" : "确认出货"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
