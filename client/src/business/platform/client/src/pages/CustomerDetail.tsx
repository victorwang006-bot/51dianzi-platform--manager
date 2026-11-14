import { usePageMemory, freshListOptions, returnToPageSource } from "../hooks/usePageMemory";
import { pageMemoryScope } from "../lib/pageMemory";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useParams, useSearch } from "wouter";
import { toast } from "sonner";
import {
  CUSTOMER_FOLLOW_LABELS,
  CUSTOMER_FOLLOW_METHODS,
  CUSTOMER_STAGE_LABELS,
  CUSTOMER_STAGES,
  customerNeedsCompletion,
  customerFollowUpSchema,
  type CustomerFollowUp,
  type CustomerRecord,
} from "../../../shared/crmCustomers";
import PlatformLayout from "../../../../BusinessContentFrame";
import { ConfirmDialog } from "../components/customers/ConfirmDialog";
import { CustomerFields } from "../components/customers/CustomerFields";
import { CustomerContactsManager } from "../components/customers/CustomerContactsManager";
import { BeijingDateTimePicker } from "../components/customers/BeijingDateTimePicker";
import { CustomerDemandHistory } from "../components/customerDemands/CustomerDemandHistory";
import { CustomerSalesOrders, type CustomerSalesOrderIntent } from "./CrmSalesOrders";
import { CustomerWorkbenchContacts } from "../components/customers/CustomerWorkbenchContacts";
import { CustomerWorkbenchSupply } from "../components/customers/CustomerWorkbenchSupply";
import { CUSTOMER_WORKBENCH_TABS, customerWorkbenchLocation, customerWorkbenchTab, type CustomerWorkbenchTab, type CustomerDemandOrderLink } from "../components/customers/customerWorkbench";
import { useCustomerWorkbenchOrders } from "../components/customers/useCustomerWorkbenchOrders";
import { useCustomerNavigationGuard } from "../components/customers/useCustomerNavigationGuard";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "../components/ui/dropdown-menu";
import "../components/customers/CustomerDetailCompact.css";
import "./CustomerDetailReadability.css";
import "../components/customers/CustomerWorkbench.css";
import {
  beijingDateTimeLocalToIso,
  errorMessage,
  formatCustomerDateTime,
  isoToBeijingDateTimeLocal,
  makeCustomerRequestId,
  nowBeijingDateTimeLocal,
  recordToCustomerForm,
  type CustomerFormState,
} from "../components/customers/customerUtils";
import { trpc } from "../../../../api/business-trpc";
import { useBusinessScope } from "../../../../BusinessScope";
import type { CustomerFieldErrors } from "../components/customers/customerValidation";
import {
  contactErrorMessage,
  customerContactBaseData,
  isDuplicateContactConflict,
  useCustomerContactScope,
  validateCustomerContactBase,
  withCustomerContactScope,
} from "../components/customers/customerContacts";

import { getBusinessIndustryLabel } from "../../../shared/businessIndustry";

type FollowUpForm = {
  method: typeof CUSTOMER_FOLLOW_METHODS[number];
  content: string;
  occurredAt: string;
  nextFollowUpAt: string;
  stage: "" | typeof CUSTOMER_STAGES[number];
  correctionOfId: number | null;
};

const EMPTY_FOLLOW_UP: FollowUpForm = {
  method: "phone",
  content: "",
  occurredAt: nowBeijingDateTimeLocal(),
  nextFollowUpAt: "",
  stage: "",
  correctionOfId: null,
};

type ActionDialog = "transfer" | "archive" | "restore" | null;

export default function CustomerDetail() {
  const d51Ready = usePageMemory();
  const { id } = useParams<{ id: string }>();
  const { contextVerification } = useBusinessScope();
  // Private form bodies stay in React only; a new real binding/account/tenant
  // cannot reuse the previous identity's detail editor, even for the same id.
  const sessionKey = `${pageMemoryScope() ?? "unresolved"}:${contextVerification.authorizationVersion}:${id}`;
  return <CustomerDetailPage key={sessionKey} d51Ready={d51Ready} sessionKey={sessionKey} />;
}

function CustomerDetailPage({ d51Ready, sessionKey }: { d51Ready: boolean; sessionKey: string }) {
  const { id: idText } = useParams<{ id: string }>();
  const id = Number(idText);
  const validId = Number.isSafeInteger(id) && id > 0;
  const [, navigate] = useLocation();
  const search = useSearch();
  const tab = customerWorkbenchTab(search);
  const utils = trpc.useUtils();
  const contextQuery = trpc.customer.context.useQuery(undefined, freshListOptions({}, d51Ready));
  const contactScope = useCustomerContactScope(contextQuery.data);
  // Retained successful cache is not proof for this mount. Once verified, an
  // ordinary background fetch must not unmount a dirty editor or lose its draft.
  const contextVerified = useRef(false);
  const detailVerified = useRef(false);
  const contextValid = d51Ready && contactScope.ready && !contextQuery.isError && !contextQuery.isPlaceholderData;
  if (!contextValid) contextVerified.current = false;
  else if (contextQuery.isFetchedAfterMount === true && !contextQuery.isFetching && !contextQuery.isPending) contextVerified.current = true;
  const authorityReady = contextValid && contextVerified.current;
  const detailQuery = trpc.customer.get.useQuery({ id }, freshListOptions({ enabled: validId && authorityReady, placeholderData: undefined }, d51Ready));
  const detailValid = authorityReady && !detailQuery.isError && !detailQuery.isPlaceholderData && detailQuery.data?.customer.id === id
    && detailQuery.data.customer.enterpriseId === contactScope.scope?.enterpriseId;
  if (!detailValid) detailVerified.current = false;
  else if (detailQuery.isFetchedAfterMount === true && !detailQuery.isFetching && !detailQuery.isPending) detailVerified.current = true;
  const detail = detailValid && detailVerified.current ? detailQuery.data : undefined;
  const customer: CustomerRecord | undefined = detail?.customer;
  const isArchived = Boolean(customer?.archivedAt);
  const canManageAll = authorityReady && Boolean(contextQuery.data?.canManageAll);
  const orderAuthority = useCustomerWorkbenchOrders(contactScope.scope, authorityReady && Boolean(customer));
  const canReadOrders = authorityReady && Boolean(customer) && orderAuthority.canRead;
  const workbenchIdentity = `${sessionKey}:${contactScope.identityKey}`;
  const receiptSession = useRef({ mounted: true, generation: 0, identity: workbenchIdentity, active: false });
  const active = Boolean(customer);
  if (receiptSession.current.identity !== workbenchIdentity || (receiptSession.current.active && !active)) receiptSession.current.generation++;
  receiptSession.current.identity = workbenchIdentity;
  receiptSession.current.active = active;
  useLayoutEffect(() => {
    receiptSession.current.mounted = true;
    return () => { receiptSession.current.mounted = false; receiptSession.current.generation++; };
  }, []);
  const captureReceiptGuard = () => {
    const generation = receiptSession.current.generation;
    const identity = workbenchIdentity;
    return () => receiptSession.current.mounted && receiptSession.current.active
      && receiptSession.current.generation === generation && receiptSession.current.identity === identity;
  };

  const [form, setForm] = useState<CustomerFormState | null>(null);
  const [editError, setEditError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<CustomerFieldErrors>({});
  const [confirmUpdateDuplicate, setConfirmUpdateDuplicate] = useState(false);
  const basicRequestRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [basicExpanded, setBasicExpanded] = useState(false);
  const [basicDirty, setBasicDirty] = useState(false);
  const [createDemandToken, setCreateDemandToken] = useState(0);
  const createDemandSequence = useRef(0);
  const [orderIntent, setOrderIntent] = useState<CustomerSalesOrderIntent | null>(null);
  const orderIntentSequence = useRef(0);
  const [demandsDirty, setDemandsDirty] = useState(false);
  const [ordersDirty, setOrdersDirty] = useState(false);
  const [contactsDirty, setContactsDirty] = useState(false);
  const [contactsBusy, setContactsBusy] = useState(false);
  // Read live during navigation: the importer closes its portal before completion navigation.
  const supplyOpen = useRef(false);
  const [blockedModuleLeave, setBlockedModuleLeave] = useState(false);
  const [pendingLeaveAction, setPendingLeaveAction] = useState<(() => void) | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [followUp, setFollowUp] = useState<FollowUpForm>(() => ({ ...EMPTY_FOLLOW_UP, occurredAt: nowBeijingDateTimeLocal() }));
  const [followUpError, setFollowUpError] = useState("");
  const [followOpen, setFollowOpen] = useState(false);
  const [followDirty, setFollowDirty] = useState(false);
  const [confirmDiscardFollow, setConfirmDiscardFollow] = useState(false);
  const [pendingCorrection, setPendingCorrection] = useState<CustomerFollowUp | null>(null);
  const [actionDialog, setActionDialog] = useState<ActionDialog>(null);
  const [transferUserId, setTransferUserId] = useState("");
  const [actionReason, setActionReason] = useState("");
  const followRequestId = useRef(makeCustomerRequestId());
  const followFingerprint = useRef<string | null>(null);
  const followSubmitting = useRef(false);
  const formDirty = useRef(false);
  const formVersion = useRef(1);
  const formCustomerId = useRef<number | null>(null);
  const followNextDirty = useRef(false);

  const updateMutation = trpc.customer.updateBasic.useMutation();
  const followMutation = trpc.customer.addFollowUp.useMutation();
  const transferMutation = trpc.customer.transfer.useMutation();
  const archiveMutation = trpc.customer.archive.useMutation();
  const restoreMutation = trpc.customer.restore.useMutation();
  const shellBusy = updateMutation.isPending || followMutation.isPending
    || transferMutation.isPending || archiveMutation.isPending || restoreMutation.isPending;

  useEffect(() => {
    if (customer) return;
    setForm(null); formDirty.current = false; formCustomerId.current = null;
    setBasicDirty(false); setBasicExpanded(false); setContactsOpen(false);
    setContactsDirty(false); setContactsBusy(false); followSubmitting.current = false;
    setFollowUp({ ...EMPTY_FOLLOW_UP, occurredAt: nowBeijingDateTimeLocal() });
    setFollowOpen(false); setFollowDirty(false); followNextDirty.current = false;
    followFingerprint.current = null; basicRequestRef.current = null;
    setActionDialog(null); setActionReason(""); setTransferUserId("");
    supplyOpen.current = false;
    setPendingCorrection(null); setConfirmDiscardFollow(false); setConfirmUpdateDuplicate(false);
    setCreateDemandToken(0); setOrderIntent(null); setDemandsDirty(false); setOrdersDirty(false);
    setPendingLeaveAction(null); setBlockedModuleLeave(false); setMoreOpen(false);
    setEditError(""); setFollowUpError(""); setFieldErrors({});
  }, [Boolean(customer), workbenchIdentity]);

  useEffect(() => {
    if (canReadOrders) return;
    setOrderIntent(null); setOrdersDirty(false);
  }, [canReadOrders]);

  const moduleBusyOrDirty = demandsDirty || ordersDirty || contactsDirty || contactsBusy;
  const approvedShellAction = useRef(false);
  const runApprovedAction = (action: () => void) => {
    approvedShellAction.current = true;
    try { action(); } finally { approvedShellAction.current = false; }
  };
  const commitTab = (next: CustomerWorkbenchTab) => {
    if (next !== "demands") setCreateDemandToken(0);
    navigate(customerWorkbenchLocation(id, next, search), { replace: true });
  };
  const guardAction = (action: () => void) => {
    if (supplyOpen.current || moduleBusyOrDirty || shellBusy || followSubmitting.current) { setBlockedModuleLeave(true); return; }
    if (basicDirty || followDirty) { setPendingLeaveAction(() => action); return; }
    runApprovedAction(action);
  };
  const changeTab = (next: CustomerWorkbenchTab) => {
    if (next === tab) return;
    guardAction(() => commitTab(next));
  };
  const openCustomerOrders = (mode: "create" | "view", link: CustomerDemandOrderLink) => {
    if (!canReadOrders || (mode === "create" && isArchived)) return;
    guardAction(() => { setOrderIntent({ ...link, mode, nonce: ++orderIntentSequence.current }); commitTab("orders"); });
  };

  useCustomerNavigationGuard({
    identityKey: workbenchIdentity,
    getMode: () => {
      if (!receiptSession.current.active || !receiptSession.current.mounted) return "clean";
      // Module booleans include unknown/pending. Contacts also remain conservative:
      // discard through their own editor, never force-unmount an unknown write.
      if (supplyOpen.current || moduleBusyOrDirty || shellBusy || followSubmitting.current) return "busy";
      if (approvedShellAction.current) return "clean";
      return basicDirty || followDirty ? "dirty" : "clean";
    },
    onBlocked: mode => { if (mode === "busy") setBlockedModuleLeave(true); },
  });

  useEffect(() => {
    const params = new URLSearchParams(search);
    if (!CUSTOMER_WORKBENCH_TABS.some(item => item.id === params.get("tab"))) {
      const location = customerWorkbenchLocation(id, customerWorkbenchTab(search), search);
      navigate(params.get("tab") === "followups" ? `${location}#customer-followups` : location, { replace: true });
    }
  }, [id, search, navigate]);

  useEffect(() => {
    if (!customer || tab !== "company" || window.location.hash !== "#customer-followups") return;
    const frame = requestAnimationFrame(() => document.getElementById("customer-followups")?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [customer?.id, search, tab]);

  useEffect(() => {
    const protectDraft = (event: BeforeUnloadEvent) => {
      if (!supplyOpen.current && !basicDirty && !followDirty && !moduleBusyOrDirty && !shellBusy && !followSubmitting.current) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [basicDirty, followDirty, moduleBusyOrDirty, shellBusy]);

  const requestBack = () => {
    if (updateMutation.isPending || followMutation.isPending) return;
    guardAction(() => returnToPageSource(navigate, "/customers"));
  };

  useEffect(() => {
    if (!customer) return;
    const changedCustomer = formCustomerId.current !== customer.id;
    if (changedCustomer || !formDirty.current) {
      setForm(recordToCustomerForm(customer));
      formVersion.current = customer.version;
      formDirty.current = false;
      setBasicDirty(false);
    }
    if (changedCustomer) {
      setFollowUp({ ...EMPTY_FOLLOW_UP, occurredAt: nowBeijingDateTimeLocal(), nextFollowUpAt: isoToBeijingDateTimeLocal(customer.nextFollowUpAt) });
      followNextDirty.current = false;
      followFingerprint.current = null;
      setFollowDirty(false);
      setFollowOpen(false);
    } else if (!followNextDirty.current) {
      setFollowUp(current => ({ ...current, nextFollowUpAt: isoToBeijingDateTimeLocal(customer.nextFollowUpAt) }));
    }
    formCustomerId.current = customer.id;
    setTransferUserId(String(customer.assignedUserId));
  }, [customer]);

  const followFormRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!customer || isArchived || tab !== "company" || new URLSearchParams(search).get("follow") !== "1") return;
    setFollowOpen(true);
  }, [customer?.id, isArchived, search, tab]);

  useEffect(() => {
    if (!followOpen || tab !== "company") return;
    const frame = requestAnimationFrame(() => {
      const field = followFormRef.current;
      if (!field) return;
      field.closest("section")?.scrollIntoView({ block: "start" });
      field.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [followOpen, search, tab]);

  const refreshCustomer = async (isCurrent: () => boolean) => {
    if (!isCurrent()) return;
    await Promise.all([
      utils.customer.get.invalidate({ id }),
      isCurrent() ? utils.customer.list.invalidate() : Promise.resolve(),
    ]);
  };

  const resetFollowUp = () => {
    if (!customer) return;
    setFollowUp({ ...EMPTY_FOLLOW_UP, occurredAt: nowBeijingDateTimeLocal(), nextFollowUpAt: isoToBeijingDateTimeLocal(customer.nextFollowUpAt) });
    followNextDirty.current = false;
    followFingerprint.current = null;
    followRequestId.current = makeCustomerRequestId();
    setFollowDirty(false);
    setFollowUpError("");
  };

  const openFollowUp = (correction?: CustomerFollowUp) => {
    if (!customer) return;
    followNextDirty.current = false;
    setFollowUp({
      ...EMPTY_FOLLOW_UP,
      occurredAt: correction ? isoToBeijingDateTimeLocal(correction.occurredAt) || nowBeijingDateTimeLocal() : nowBeijingDateTimeLocal(),
      nextFollowUpAt: isoToBeijingDateTimeLocal(customer.nextFollowUpAt),
      correctionOfId: correction?.id ?? null,
    });
    followFingerprint.current = null;
    followRequestId.current = makeCustomerRequestId();
    setFollowDirty(false);
    setFollowUpError("");
    setFollowOpen(true);
  };

  const requestCloseFollowUp = () => {
    if (followMutation.isPending || followSubmitting.current) return;
    if (followDirty) {
      setPendingCorrection(null);
      setConfirmDiscardFollow(true);
      return;
    }
    resetFollowUp();
    setFollowOpen(false);
  };

  const requestCorrection = (item: CustomerFollowUp) => {
    if (followMutation.isPending || followSubmitting.current) return;
    if (followDirty) {
      setPendingCorrection(item);
      setConfirmDiscardFollow(true);
      return;
    }
    commitTab("company");
    openFollowUp(item);
  };

  const discardFollowDraft = () => {
    const correction = pendingCorrection;
    setConfirmDiscardFollow(false);
    setPendingCorrection(null);
    if (correction) openFollowUp(correction);
    else {
      resetFollowUp();
      setFollowOpen(false);
    }
  };

  useEffect(() => {
    setConfirmUpdateDuplicate(false);
    basicRequestRef.current = null;
  }, [contactScope.identityKey]);

  const submitUpdate = async (confirmDuplicate = false) => {
    if (!customer || !form || isArchived || !contactScope.scope || !contactScope.ready || updateMutation.isPending) return;
    const isCurrent = captureReceiptGuard();
    if (!isCurrent()) return;
    const validationErrors = validateCustomerContactBase(form);
    setFieldErrors(validationErrors as CustomerFieldErrors);
    if (Object.keys(validationErrors).length) { setBasicExpanded(true); setEditError(""); return; }
    setEditError("");
    try {
      const { assignedUserId: _ignored, ...data } = customerContactBaseData(form);
      const fingerprint = JSON.stringify({ identity: contactScope.identityKey, customerId: id, data, version: formVersion.current });
      if (!basicRequestRef.current || basicRequestRef.current.fingerprint !== fingerprint) {
        basicRequestRef.current = { fingerprint, requestId: makeCustomerRequestId() };
      }
      await updateMutation.mutateAsync(withCustomerContactScope(contactScope.scope, {
        customerId: id,
        data,
        version: formVersion.current,
        requestId: basicRequestRef.current.requestId,
        confirmDuplicate,
      }));
      if (!isCurrent()) return;
      formDirty.current = false;
      setBasicDirty(false);
      setConfirmUpdateDuplicate(false);
      basicRequestRef.current = null;
      toast.success("客户信息已更新");
      await refreshCustomer(isCurrent);
    } catch (error) {
      if (!isCurrent()) return;
      if (!confirmDuplicate && isDuplicateContactConflict(error)) {
        setConfirmUpdateDuplicate(true);
      } else {
        setEditError(contactErrorMessage(error));
      }
    }
  };

  const submitFollowUp = async () => {
    if (!customer || isArchived || followSubmitting.current || followMutation.isPending) return;
    const isCurrent = captureReceiptGuard();
    if (!isCurrent()) return;
    const occurredAt = beijingDateTimeLocalToIso(followUp.occurredAt);
    const nextFollowUpAt = followNextDirty.current ? beijingDateTimeLocalToIso(followUp.nextFollowUpAt) : customer.nextFollowUpAt;
    const candidate = {
      customerId: customer.id,
      requestId: followRequestId.current,
      method: followUp.method,
      content: followUp.content.trim(),
      occurredAt: occurredAt ?? "",
      nextFollowUpAt,
      ...(followUp.stage ? { stage: followUp.stage } : {}),
      ...(followUp.correctionOfId ? { correctionOfId: followUp.correctionOfId } : {}),
    };
    const fingerprint = JSON.stringify({ ...candidate, requestId: undefined });
    if (followFingerprint.current !== fingerprint) {
      followRequestId.current = makeCustomerRequestId();
      candidate.requestId = followRequestId.current;
      followFingerprint.current = fingerprint;
    }
    const parsed = customerFollowUpSchema.safeParse(candidate);
    if (!parsed.success) {
      setFollowUpError(parsed.error.issues[0]?.message ?? "请补充跟进信息");
      return;
    }
    setFollowUpError("");
    followSubmitting.current = true;
    try {
      const result = await followMutation.mutateAsync(parsed.data);
      if (!isCurrent()) return;
      toast.success(result.replayed ? "跟进已确认保存" : followUp.correctionOfId ? "更正记录已追加" : "跟进已追加");
      resetFollowUp();
      setFollowOpen(false);
      try {
        await refreshCustomer(isCurrent);
      } catch {
        if (!isCurrent()) return;
        toast.error("跟进已保存，列表刷新失败，请稍后刷新页面确认");
      }
    } catch (error) {
      if (!isCurrent()) return;
      setFollowUpError(errorMessage(error));
    } finally {
      if (isCurrent()) followSubmitting.current = false;
    }
  };

  const submitTransfer = async () => {
    if (!customer || transferMutation.isPending) return;
    const isCurrent = captureReceiptGuard();
    if (!isCurrent()) return;
    const assignedUserId = Number(transferUserId);
    if (!Number.isInteger(assignedUserId) || assignedUserId <= 0) {
      setEditError("请选择新的销售负责人");
      return;
    }
    if (!actionReason.trim()) {
      setEditError("请填写转移原因");
      return;
    }
    try {
      await transferMutation.mutateAsync({ id, version: customer.version, assignedUserId, reason: actionReason.trim() });
      if (!isCurrent()) return;
      toast.success("负责人已转移");
      closeActionDialog();
      await refreshCustomer(isCurrent);
    } catch (error) {
      if (!isCurrent()) return;
      setEditError(errorMessage(error));
    }
  };

  const submitArchive = async () => {
    if (!customer || archiveMutation.isPending) return;
    const isCurrent = captureReceiptGuard();
    if (!isCurrent()) return;
    if (!actionReason.trim()) {
      setEditError("请填写归档原因");
      return;
    }
    try {
      await archiveMutation.mutateAsync({ id, version: customer.version, reason: actionReason.trim() });
      if (!isCurrent()) return;
      toast.success("客户已归档");
      closeActionDialog();
      await refreshCustomer(isCurrent);
    } catch (error) {
      if (!isCurrent()) return;
      setEditError(errorMessage(error));
    }
  };

  const submitRestore = async () => {
    if (!customer || restoreMutation.isPending) return;
    const isCurrent = captureReceiptGuard();
    if (!isCurrent()) return;
    try {
      await restoreMutation.mutateAsync({ id, version: customer.version });
      if (!isCurrent()) return;
      toast.success("客户已恢复到在档状态");
      closeActionDialog();
      await refreshCustomer(isCurrent);
    } catch (error) {
      if (!isCurrent()) return;
      setEditError(errorMessage(error));
    }
  };

  const closeActionDialog = () => {
    setActionDialog(null);
    setActionReason("");
    setEditError("");
  };

  if (!validId) return <PlatformLayout><main className="erp-ui mx-auto max-w-4xl p-5"><ErrorState message="客户编号无效" onBack={() => returnToPageSource(navigate, "/customers")} /></main></PlatformLayout>;
  if (contextQuery.isError) return <PlatformLayout><main className="erp-ui mx-auto max-w-4xl p-5"><ErrorState message={`无法读取客户权限：${errorMessage(contextQuery.error)}`} onBack={() => returnToPageSource(navigate, "/customers")} onRetry={() => contextQuery.refetch()} /></main></PlatformLayout>;
  if (!authorityReady || (!detailQuery.isError && !detailVerified.current)) return <PlatformLayout><main className="erp-ui mx-auto max-w-4xl p-5"><section className="rounded-lg border border-slate-200 bg-white p-12 text-center text-sm text-muted-foreground">加载客户详情中…</section></main></PlatformLayout>;
  if (detailQuery.isError || !customer || !detail) return <PlatformLayout><main className="erp-ui mx-auto max-w-4xl p-5"><ErrorState message={detailQuery.isError ? errorMessage(detailQuery.error) : "未找到客户"} onBack={() => returnToPageSource(navigate, "/customers")} onRetry={() => detailQuery.refetch()} /></main></PlatformLayout>;

  const currentAssignee = contextQuery.data?.members.find(member => member.userId === customer.assignedUserId)?.name ?? customer.assignedName;
  const actionBusy = transferMutation.isPending || archiveMutation.isPending || restoreMutation.isPending;
  const isCurrentChildReceipt = captureReceiptGuard();

  return <PlatformLayout>
    <main className="erp-ui customer-detail-compact customer-detail-readable customer-workbench">
      <div className="customer-detail-top-actions mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h1 className="admin-page-title customer-detail-name">{customer.name}</h1><span className={`crm-badge ${customer.grade === "A" ? "bg-[#FCEBEB] text-[#A32D2D]" : customer.grade === "B" ? "bg-[#FFF7E6] text-[#B8741A]" : "bg-[#e8f0fe] text-[#185FA5]"}`}>{customer.grade}级</span>{isArchived && <span className="crm-badge bg-slate-100 text-slate-500">已归档</span>}</div>
          <p className="customer-detail-meta mt-1">负责人：{customer.assignedName} · 创建于 {formatCustomerDateTime(customer.createdAt)}</p>
        </div>
        <div className="customer-workbench-top-buttons">
          <button type="button" className="crm-btn" title="回到进入详情前的页面，保留筛选、页码与位置" onClick={requestBack}>返回上一页</button>
          <button type="button" className="crm-btn crm-btn-primary" disabled={isArchived} onClick={() => guardAction(() => { commitTab("demands"); setCreateDemandToken(++createDemandSequence.current); })}>新增需求</button>
          <button type="button" className="crm-btn" disabled={isArchived} onClick={() => guardAction(() => { commitTab("company"); if (!followOpen) openFollowUp(); })}>新增跟进</button>
          {canManageAll && <DropdownMenu open={moreOpen} onOpenChange={open => { if (!open) setMoreOpen(false); else guardAction(() => setMoreOpen(true)); }}><DropdownMenuTrigger asChild><button type="button" className="crm-btn">更多</button></DropdownMenuTrigger><DropdownMenuContent align="end">{!isArchived ? <><DropdownMenuItem onSelect={() => guardAction(() => setActionDialog("transfer"))}>转移负责人</DropdownMenuItem><DropdownMenuItem className="text-red-700" onSelect={() => guardAction(() => setActionDialog("archive"))}>归档客户</DropdownMenuItem></> : <DropdownMenuItem onSelect={() => guardAction(() => setActionDialog("restore"))}>恢复客户</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>}
        </div>
      </div>

      {customerNeedsCompletion(customer) && <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">待补全：请补齐基本资料后保存；历史查看和追加跟进不受影响。</p>}
      {isArchived && <section className="mb-3 rounded-lg border border-[#F1D3A6] bg-[#FFF9ED] px-4 py-3 text-sm text-[#8A5A16]"><b>该客户已归档，当前为只读状态。</b> {customer.archiveReason ? `归档原因：${customer.archiveReason}` : ""} 仅管理员可恢复。</section>}
      {editError && <section className="mb-3 rounded-lg border border-[#F5C2C2] bg-[#FFF4F4] px-4 py-3 text-sm text-[#A32D2D]" role="alert">{editError}</section>}

      <nav className="customer-workbench-tabs" role="tablist" aria-label="客户工作台">{CUSTOMER_WORKBENCH_TABS.map(item => <button type="button" role="tab" id={`customer-tab-${item.id}`} aria-selected={tab === item.id} aria-controls={`customer-panel-${item.id}`} key={item.id} onClick={() => changeTab(item.id)}>{item.label}{item.id === "company" && (basicDirty || followDirty) ? " · 未保存" : ""}</button>)}</nav>
      <div hidden={tab !== "company"} role="tabpanel" id="customer-panel-company" aria-labelledby="customer-tab-company">
      <section id="customer-base" className="customer-detail-basic mb-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="admin-section-title">基础信息</h2>
              {basicDirty && <span className="text-[13px] text-amber-700" role="status">未保存</span>}
            </div>
            <div className="customer-detail-summary mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <span>主联系人：{customer.contactName || "—"}</span>
              <span>电话：{customer.phone || "—"}</span>
              <span>所属行业：{getBusinessIndustryLabel(customer.industryCode)}</span>
              <span>当前阶段：{CUSTOMER_STAGE_LABELS[form?.stage ?? customer.stage]}</span>
              <span>下次跟进：{formatCustomerDateTime(customer.nextFollowUpAt)}</span>
            </div>
            <p className="customer-detail-meta mt-1">版本 {customer.version} · 上次更新 {formatCustomerDateTime(customer.updatedAt)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!isArchived && basicExpanded && <button type="button" className="crm-btn crm-btn-primary" disabled={!form || updateMutation.isPending || !contactScope.ready} onClick={() => void submitUpdate()}>{updateMutation.isPending ? "保存中…" : "保存修改"}</button>}
            <button type="button" className="crm-btn" aria-expanded={basicExpanded} aria-controls="customer-base-editor" onClick={() => setBasicExpanded(open => !open)}>{basicExpanded ? "收起" : "展开"}</button>
          </div>
        </div>
        {basicExpanded && <div id="customer-base-editor" className="border-t border-slate-100 p-4 sm:p-5">
          {form ? <CustomerFields value={form} onChange={next => { formDirty.current = true; setBasicDirty(true); setForm(current => current ? typeof next === "function" ? next(current) : next : current); }} members={contextQuery.data?.members ?? []} canManageAll={canManageAll} allowAssigneeChange={false} currentAssigneeName={currentAssignee} includeLegacyContactFields={false} fieldErrors={fieldErrors} disabled={isArchived || updateMutation.isPending || !contactScope.ready} /> : null}
        </div>}
      </section>

      <section id="customer-contacts" className="mb-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div><h2 className="admin-section-title">联系人</h2></div>
          <button type="button" className="crm-btn crm-btn-primary" disabled={!contactScope.ready} onClick={() => setContactsOpen(true)}>管理联系人</button>
        </div>
        {tab === "company" && <CustomerWorkbenchContacts key={`${contactScope.identityKey}:${customer.id}`} customerId={customer.id} scope={contactScope.scope} scopeReady={contactScope.ready} />}
      </section>

      <section id="customer-followups" className="customer-detail-followups mb-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div><h2 className="admin-section-title">跟进记录</h2><p className="customer-detail-meta mt-1">跟进仅可追加；如需更正，请基于原记录追加一条更正说明。</p></div>
          {!isArchived && !followOpen && <button type="button" className="crm-btn crm-btn-primary" onClick={() => openFollowUp()}>新增跟进</button>}
        </div>
        {!isArchived && followOpen && <div className="customer-detail-followup-form border-b border-slate-100 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div><h3 className="text-[15px] font-medium text-slate-800">{followUp.correctionOfId ? `更正跟进 #${followUp.correctionOfId}` : "新增跟进"}</h3>{followUp.correctionOfId && <p className="mt-1 text-[13px] text-amber-700">将追加一条更正记录，原记录不会被修改。</p>}</div>
          </div>
          {followUpError && <div className="mb-3 rounded border border-[#F5C2C2] bg-[#FFF4F4] px-3 py-2 text-xs text-[#A32D2D]" role="alert">{followUpError}</div>}
          <div className="customer-detail-followup-row">
            <label className="customer-detail-method block"><span className="mb-1 block text-xs text-slate-600">方式</span><select aria-label="跟进方式" className="crm-input" value={followUp.method} disabled={followMutation.isPending} onChange={event => { setFollowDirty(true); setFollowUp(current => ({ ...current, method: event.target.value as FollowUpForm["method"] })); }}>{CUSTOMER_FOLLOW_METHODS.map(method => <option key={method} value={method}>{CUSTOMER_FOLLOW_LABELS[method]}</option>)}</select></label>
            <label className="customer-detail-datetime block"><span className="mb-1 block text-xs text-slate-600">跟进时间（北京时间）</span><BeijingDateTimePicker aria-label="跟进时间（北京时间）" clearable={false} aria-required value={followUp.occurredAt} disabled={followMutation.isPending} onChange={value => { setFollowDirty(true); setFollowUp(current => ({ ...current, occurredAt: value })); }} /></label>
            <label className="customer-detail-stage block"><span className="mb-1 block text-xs text-slate-600">更新阶段（选填）</span><select aria-label="更新阶段（选填）" className="crm-input" value={followUp.stage} disabled={followMutation.isPending} onChange={event => { setFollowDirty(true); setFollowUp(current => ({ ...current, stage: event.target.value as FollowUpForm["stage"] })); }}><option value="">不变更</option>{CUSTOMER_STAGES.map(stage => <option key={stage} value={stage}>{CUSTOMER_STAGE_LABELS[stage]}</option>)}</select></label>
            <label className="customer-detail-datetime block"><span className="mb-1 block text-xs text-slate-600">下次跟进（北京时间）</span><BeijingDateTimePicker aria-label="下次跟进（北京时间）" value={followUp.nextFollowUpAt} disabled={followMutation.isPending} onChange={value => { followNextDirty.current = true; setFollowDirty(true); setFollowUp(current => ({ ...current, nextFollowUpAt: value })); }} /></label>
          </div>
          <label className="mt-3 block"><span className="mb-1 block text-xs text-slate-600"><b className="mr-1 text-[#A32D2D]">*</b>{followUp.correctionOfId ? "更正说明" : "跟进内容"}</span><textarea ref={followFormRef} aria-label={followUp.correctionOfId ? "更正说明" : "跟进内容"} className="customer-detail-followup-content crm-input w-full" rows={3} maxLength={4000} placeholder={followUp.correctionOfId ? "说明原记录中需要更正的事实" : "记录本次沟通情况、需求和下一步动作"} value={followUp.content} disabled={followMutation.isPending} onChange={event => { setFollowDirty(true); setFollowUp(current => ({ ...current, content: event.target.value })); }} /></label>
          <div className="mt-3 flex justify-end gap-2"><button type="button" className="crm-btn" disabled={followMutation.isPending} onClick={requestCloseFollowUp}>取消</button><button type="button" className="crm-btn crm-btn-primary" disabled={followMutation.isPending} onClick={() => void submitFollowUp()}>{followMutation.isPending ? "保存中…" : followUp.correctionOfId ? "追加更正" : "保存跟进"}</button></div>
        </div>}
        <div className="customer-detail-follow-history divide-y divide-slate-100">{detail.followUps.length === 0 ? <p className="px-4 py-3 text-xs text-muted-foreground">暂无跟进记录</p> : detail.followUps.map(item => <FollowUpRow key={item.id} item={item} readOnly={isArchived} onCorrect={() => requestCorrection(item)} />)}</div>
      </section>
      </div>
      <CustomerContactsManager key={workbenchIdentity} customerId={customer.id} open={contactsOpen} onClose={() => setContactsOpen(false)} scope={contactScope.scope} scopeReady={contactScope.ready} identityKey={contactScope.identityKey} onDirtyChange={setContactsDirty} onBusyChange={setContactsBusy} />

      {tab === "demands" && <div id="customer-panel-demands" role="tabpanel" aria-labelledby="customer-tab-demands" className="mb-4">
        <CustomerDemandHistory key={workbenchIdentity} customer={{ id: customer.id, name: customer.name, archivedAt: customer.archivedAt }} contextIdentityKey={workbenchIdentity} canRead={authorityReady} readOnly={isArchived} canManageOrders={canReadOrders} createRequestToken={createDemandToken} onCreateOrder={link => openCustomerOrders("create", link)} onViewOrders={link => openCustomerOrders("view", link)} onDirtyChange={setDemandsDirty} />
      </div>}
      {tab === "orders" && <section id="customer-panel-orders" role="tabpanel" aria-labelledby="customer-tab-orders" className="customer-workbench-panel">
        {orderAuthority.failed && <p role="alert">订单权限核验失败。<button type="button" className="crm-link" onClick={() => void orderAuthority.refresh()}>重试核验</button></p>}
        <CustomerSalesOrders customer={{ id: customer.id, name: customer.name, archivedAt: customer.archivedAt }} contextIdentityKey={workbenchIdentity} canRead={canReadOrders} canWrite={canReadOrders && !isArchived} readOnly={isArchived} intent={orderIntent} onIntentHandled={nonce => { if (isCurrentChildReceipt()) setOrderIntent(current => current?.nonce === nonce ? null : current); }} onDirtyChange={setOrdersDirty} onOrderChanged={() => { if (!isCurrentChildReceipt()) return; void utils.crmSalesOrder.customerSummary.invalidate({ customerId: customer.id }); if (isCurrentChildReceipt()) void utils.crmSalesOrder.customerMaterials.invalidate({ customerId: customer.id }); }} />
      </section>}
      {tab === "inventory" && <div id="customer-panel-inventory" role="tabpanel" aria-labelledby="customer-tab-inventory"><CustomerWorkbenchSupply key={workbenchIdentity} customerId={customer.id} scope={contactScope.scope} scopeReady={authorityReady} customerVersion={customer.version} archived={isArchived} isCurrent={isCurrentChildReceipt} onAction={guardAction} onOpenChange={open => { if (isCurrentChildReceipt()) supplyOpen.current = open; }} /></div>}


    </main>

    {blockedModuleLeave && <ConfirmDialog title="当前需求或订单尚未完成" description="联系人、需求、订单、供应库存上传或客户操作尚未完成。请先在当前模块保存，或通过该模块的取消操作确认放弃，再切换页签、返回或操作更多；执行中或结果待确认时不能离开。" confirmLabel="继续当前操作" onCancel={() => setBlockedModuleLeave(false)} onConfirm={() => setBlockedModuleLeave(false)} />}
    {pendingLeaveAction && <ConfirmDialog title="放弃未保存的客户修改？" description="公司资料或跟进内容尚未保存。继续切换页签、返回或操作更多将放弃当前未保存内容。" danger confirmLabel="放弃并继续" onCancel={() => setPendingLeaveAction(null)} onConfirm={() => { const action = pendingLeaveAction; setPendingLeaveAction(null); if (moduleBusyOrDirty || shellBusy || followSubmitting.current) { setBlockedModuleLeave(true); return; } formDirty.current = false; setBasicDirty(false); setForm(recordToCustomerForm(customer)); formVersion.current = customer.version; resetFollowUp(); setFollowOpen(false); runApprovedAction(action); }} />}
    {confirmUpdateDuplicate && <ConfirmDialog title="确认保存可能重复的客户？" description="系统发现可能与已有客户重复。确认后将提交当前修改；无权访问的客户资料不会展示。" confirmLabel="确认并保存" error={editError} busy={updateMutation.isPending} onCancel={() => setConfirmUpdateDuplicate(false)} onConfirm={() => void submitUpdate(true)} />}
    {confirmDiscardFollow && <ConfirmDialog title="放弃未保存的跟进？" description="当前跟进备注尚未保存。放弃后内容将无法恢复。" confirmLabel={pendingCorrection ? "放弃并更正原记录" : "放弃未保存内容"} danger onCancel={() => { setConfirmDiscardFollow(false); setPendingCorrection(null); }} onConfirm={discardFollowDraft} />}
    {actionDialog === "transfer" && <ConfirmDialog title="转移销售负责人" description="转移会保留既有跟进的原作者和历史记录。" confirmLabel="确认转移" error={editError} busy={actionBusy} onCancel={closeActionDialog} onConfirm={() => void submitTransfer()}><label className="block text-xs text-slate-600">新负责人<select className="crm-input mt-1 w-full" value={transferUserId} onChange={event => setTransferUserId(event.target.value)}>{contextQuery.data?.members.map(member => <option key={member.userId} value={String(member.userId)}>{member.name}</option>)}</select></label><label className="block text-xs text-slate-600">转移原因<textarea className="crm-input mt-1 min-h-20 w-full" maxLength={500} value={actionReason} onChange={event => setActionReason(event.target.value)} placeholder="请说明转移原因" /></label></ConfirmDialog>}
    {actionDialog === "archive" && <ConfirmDialog title="归档客户" description="归档后客户、基础资料和跟进均为只读；可由管理员明确恢复。" confirmLabel="确认归档" error={editError} danger busy={actionBusy} onCancel={closeActionDialog} onConfirm={() => void submitArchive()}><label className="block text-xs text-slate-600">归档原因<textarea className="crm-input mt-1 min-h-20 w-full" maxLength={500} value={actionReason} onChange={event => setActionReason(event.target.value)} placeholder="请填写归档原因" /></label></ConfirmDialog>}
    {actionDialog === "restore" && <ConfirmDialog title="确认恢复客户？" description="恢复后客户将重新进入在档状态，销售可继续维护和追加跟进。" confirmLabel="确认恢复" error={editError} busy={actionBusy} onCancel={closeActionDialog} onConfirm={() => void submitRestore()} />}
  </PlatformLayout>;
}

function FollowUpRow({ item, readOnly, onCorrect }: { item: CustomerFollowUp; readOnly: boolean; onCorrect: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = item.content.length > 160 || item.content.split("\n").length > 3;
  const content = !expanded && canExpand ? `${item.content.slice(0, 160)}…` : item.content;
  return <article className="px-4 py-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="crm-badge bg-[#e8f0fe] text-[#185FA5]">{CUSTOMER_FOLLOW_LABELS[item.method]}</span>{item.correctionOfId && <span className="crm-badge bg-[#FFF7E6] text-[#B8741A]">更正 # {item.correctionOfId}</span>}<span className="customer-detail-meta">{item.authorName}</span></div><p className="customer-detail-followup-body mt-2 whitespace-pre-wrap">{content}</p>{canExpand && <button type="button" className="crm-link admin-row-action customer-detail-history-action mt-1" onClick={() => setExpanded(open => !open)}>{expanded ? "收起内容" : "展开内容"}</button>}</div><div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1"><time className="customer-detail-meta whitespace-nowrap">{formatCustomerDateTime(item.occurredAt)}</time>{!readOnly && <button type="button" className="crm-link admin-row-action customer-detail-history-action" onClick={onCorrect}>更正此记录</button>}</div></div></article>;
}

function ErrorState({ message, onBack, onRetry }: { message: string; onBack: () => void; onRetry?: () => void }) {
  return <section className="rounded-lg border border-[#F5C2C2] bg-[#FFF8F8] p-8 text-center"><p className="text-sm text-[#A32D2D]">{message}</p><div className="mt-4 flex justify-center gap-2">{onRetry && <button type="button" className="crm-btn" onClick={onRetry}>重试</button>}<button type="button" className="crm-btn" onClick={onBack}>返回客户列表</button></div></section>;
}
