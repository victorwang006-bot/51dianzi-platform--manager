import { usePageMemory, useRememberedState, freshListOptions, useListPositionRestore, returnToPageSource } from "../hooks/usePageMemory";
import { useCustomerCreateDraft, useCustomerCreateDraftIdentity } from "../hooks/useCustomerCreateDraft";
import { useCustomerStars } from "../hooks/useCustomerStars";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Plus, Star } from "lucide-react";
import { useLocation, useSearch } from "wouter";
import { toast } from "sonner";
import {
  CUSTOMER_GRADES,
  CUSTOMER_STAGE_LABELS,
  CUSTOMER_STAGES,
  type CustomerData,
  customerNeedsCompletion,
} from "../../../shared/crmCustomers";
import PlatformLayout from "../../../../BusinessContentFrame";
import { CustomerCreateForm, type CustomerCreateSaveMode, type CustomerCreateState } from "../components/customers/CustomerCreateForm";
import { CustomerContactsSummary } from "../components/customers/CustomerContactsSummary";
import { formatContactMethod, useCustomerContactScope, withCustomerContactScope, type ContactSummary } from "../components/customers/customerContacts";
import { CustomerSupplyUploadDialog } from "../components/customers/CustomerSupplyUploadDialog";
import { CustomerSupplyCell } from "../components/customers/CustomerSupplyCell";
import { CustomerSupplyAction } from "../components/customers/CustomerSupplyAction";
import { useCustomerSupplyAuthority, supplyLocation, type SupplySummary } from "../components/customers/customerSupply";
import { CustomerDemandDialog } from "../components/customerDemands/CustomerDemandDialog";
import { EMPTY_CUSTOMER_FORM, errorMessage } from "../components/customers/customerUtils";
import { trpc } from "../../../../api/business-trpc";
import { AdminPage, AdminPageHeader, AdminFilterBar, AdminDataPanel } from "@/components/admin/UnifiedAdminPage";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
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

import { businessIndustryCodeSchema, getBusinessIndustryLabel } from "../../../shared/businessIndustry";
import "./CustomerList.css";

const PAGE_SIZE = 20;
type GradeFilter = "" | CustomerData["grade"];
type StageFilter = "" | CustomerData["stage"];
type ScopeFilter = "mine" | "all";
type DueFilter = "all" | "today" | "overdue";

type FilterState = {
  keyword: string;
  grade: GradeFilter;
  stage: StageFilter;
  scope: ScopeFilter;
  assignedUserId: string;
  due: DueFilter;
  archived: boolean;
  starredOnly: boolean;
};

const DEFAULT_FILTERS: FilterState = {
  keyword: "",
  grade: "",
  stage: "",
  scope: "mine",
  assignedUserId: "",
  due: "all",
  archived: false,
  starredOnly: false,
};

const toolbarActionClass =
  "customer-list-control min-w-[64px] border-slate-300 bg-white px-3 text-slate-700 shadow-none hover:bg-slate-50 hover:text-slate-900";

export default function CustomerList() {
  const d51Ready = usePageMemory();

  const [, navigate] = useLocation();
  const search = useSearch();
  const utils = trpc.useUtils();
  const contextQuery = trpc.customer.context.useQuery();
  const contactScope = useCustomerContactScope(contextQuery.data);
  const supplyAuthority = useCustomerSupplyAuthority(contactScope.scope, contactScope.ready);
  const [supplyCustomer, setSupplyCustomer] = useState<{ id: number; version: number; authorityKey: string } | null>(null);
  const [supplyRevision, setSupplyRevision] = useState(0);
  const [supplyState, setSupplyState] = useState<{ key: string; items: SupplySummary[]; canWrite: boolean; loading: boolean; failed: boolean }>({ key: "", items: [], canWrite: false, loading: false, failed: false });
  const createDraftIdentity = useCustomerCreateDraftIdentity(contactScope.scope, contactScope.ready, contextQuery.isPending && !contextQuery.isError);
  const emptyCreateDraft = useMemo(() => ({
    form: EMPTY_CUSTOMER_FORM,
    contacts: [],
    request: null,
    pendingSave: null,
  }), []);
  const createDraft = useCustomerCreateDraft(createDraftIdentity, emptyCreateDraft);
  const [createOpen, setCreateOpen] = useRememberedState(
    "createOpen",
    () => new URLSearchParams(search).get("create") === "1",
  );
  const [createState, setCreateState] = useState<CustomerCreateState>({ dirty: false, busy: false });
  const [demandCustomer, setDemandCustomer] = useState<{ id: number; name: string; archivedAt: string | null } | null>(null);
  const mountedRef = useRef(true);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get("create") !== "1") return;
    setCreateOpen(true);
    params.delete("create");
    navigate(`/customers${params.size ? `?${params}` : ""}`, { replace: true });
  }, [search, navigate]);
  const [draftFilters, setDraftFilters] =
    useRememberedState<FilterState>("draftFilters", DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] =
    useRememberedState<FilterState>("appliedFilters", DEFAULT_FILTERS);
  const [moreFiltersOpen, setMoreFiltersOpen] = useRememberedState("moreFiltersOpen", false);
  const [page, setPage] = useRememberedState("page", 1);
  const canManageAll = contextQuery.data?.canManageAll ?? false;
  const canReadAll = contextQuery.data?.canReadAll ?? canManageAll;
  const starFocusId = useRef<number | null>(null);
  const tableRegionRef = useRef<HTMLDivElement>(null);
  const stars = useCustomerStars(contactScope.scope, contactScope.ready && !contextQuery.isPending && !contextQuery.isError, async customerId => {
    // Do not steal focus if the user has moved into a filter or another action.
    starFocusId.current = document.activeElement?.getAttribute("data-star-customer") === String(customerId) ? customerId : null;
    setPage(1);
    // The service sorts the entire authorized filtered set before pagination.
    // Do not locally reorder the currently loaded twenty records.
    await utils.customer.list.invalidate();
  }, JSON.stringify([appliedFilters, page]));

  // Read-only team reachability is distinct from enterprise manage/write authority.
  useEffect(() => {
    if (contextQuery.isLoading || contextQuery.isPending || !contextQuery.data) return;
    if (canReadAll) return;
    const restrictToMine = (current: FilterState) =>
      current.scope === "mine" && !current.assignedUserId
        ? current
        : { ...current, scope: "mine" as const, assignedUserId: "" };
    setDraftFilters(restrictToMine);
    setAppliedFilters(restrictToMine);
  }, [canReadAll, contextQuery.isLoading, contextQuery.isPending, contextQuery.data]);

  const listInput = useMemo(() => {
    const scope = canReadAll ? appliedFilters.scope : "mine";
    const assignedUserId = Number(appliedFilters.assignedUserId);
    return {
      keyword: appliedFilters.keyword.trim(),
      ...(appliedFilters.grade ? { grade: appliedFilters.grade } : {}),
      ...(appliedFilters.stage ? { stage: appliedFilters.stage } : {}),
      scope,
      ...(canReadAll &&
      scope === "all" &&
      Number.isInteger(assignedUserId) &&
      assignedUserId > 0
        ? { assignedUserId }
        : {}),
      starMode: "assignee" as const,
      ...(contactScope.scope ? { expectedEnterpriseId: contactScope.scope.enterpriseId, expectedActorUserId: contactScope.scope.actorUserId } : {}),
      archived: appliedFilters.archived,
      due: appliedFilters.due,
      starredOnly: appliedFilters.starredOnly === true,
      page,
      pageSize: PAGE_SIZE,
    };
  }, [appliedFilters, canReadAll, page, contactScope.identityKey]);
  const listQuery = trpc.customer.list.useQuery(listInput, freshListOptions({
    enabled: contactScope.ready && !contextQuery.isPending && !contextQuery.isError && Boolean(contextQuery.data) && (appliedFilters.starredOnly !== true || stars.ready),
    placeholderData: undefined,
  }, d51Ready));
  // Never render a previous identity/enterprise page, including its old total.
  const result = d51Ready && contactScope.ready && !contextQuery.isPending && !contextQuery.isError
    && !listQuery.isError && (appliedFilters.starredOnly !== true || stars.ready)
    && listQuery.data?.items.every(customer => customer.enterpriseId === contactScope.scope?.enterpriseId
      && (customer.starUserId === undefined || customer.starUserId === null || customer.starUserId === customer.assignedUserId))
    ? listQuery.data : undefined;
  useListPositionRestore(listQuery, Boolean(result) && d51Ready && contactScope.ready && !contextQuery.isPending && !contextQuery.isError);
  stars.observeRows(result?.items ?? []);
  const pageCustomerIds = useMemo(() => result?.items.map(customer => customer.id) ?? [], [result?.items]);
  const supplyRequestKey = JSON.stringify([supplyAuthority.identity?.key, listInput, pageCustomerIds]);
  const supplyRequestRef = useRef(supplyRequestKey); supplyRequestRef.current = supplyRequestKey;
  useEffect(() => {
    const identity = supplyAuthority.identity;
    if (!identity || !pageCustomerIds.length) { setSupplyState({ key: supplyRequestKey, items: [], canWrite: false, loading: false, failed: false }); return; }
    let alive = true;
    let abort: AbortController | null = null;
    const refresh = async () => {
      abort?.abort(); const request = new AbortController(); abort = request;
      const current = () => alive && !request.signal.aborted && supplyRequestRef.current === supplyRequestKey;
      try {
        const data = await utils.client.channelInventory.customerSupplySummary.query({ customerIds: pageCustomerIds,
          expectedEnterpriseId: identity.enterpriseId, expectedActorUserId: identity.actorUserId }, { signal: request.signal });
        if (!current()) return;
        setSupplyState({ key: supplyRequestKey, items: data.items.filter(item => pageCustomerIds.includes(item.customerId)),
          canWrite: data.canWrite, loading: false, failed: false });
      } catch (error) {
        if (!current()) return;
        supplyAuthority.onAuthorizationError(error);
        setSupplyState({ key: supplyRequestKey, items: [], canWrite: false, loading: false, failed: true });
      }
    };
    setSupplyState(previous => previous.key === supplyRequestKey ? { ...previous, loading: true } : { key: supplyRequestKey, items: [], canWrite: false, loading: true, failed: false });
    // One bounded read per identity/page, completed upload or explicit retry.
    // Each upload command still rechecks the authoritative server context.
    void refresh();
    return () => { alive = false; abort?.abort(); };
  }, [supplyRequestKey, supplyRevision, utils]);
  const supplyResult = supplyState.key === supplyRequestKey ? supplyState : { items: [], canWrite: false, loading: true, failed: false };
  const supplySummaries = new Map(supplyResult.items.map(item => [item.customerId, item]));
  const supplyRow = result?.items.find(customer => customer.id === supplyCustomer?.id);
  const supplyCurrent = Boolean(supplyCustomer && supplyAuthority.identity
    && supplyCustomer.authorityKey === supplyAuthority.identity.key && supplyAuthority.canWrite
    && !contextQuery.isError && !listQuery.isError && !supplyResult.failed
    && supplyResult.canWrite && supplySummaries.get(supplyCustomer.id)?.canUpload
    && supplyRow && !supplyRow.archivedAt && supplyRow.version === supplyCustomer.version);
  const supplyCurrentRef = useRef(supplyCurrent); supplyCurrentRef.current = supplyCurrent;
  useEffect(() => { if (supplyCustomer && !supplyCurrent) setSupplyCustomer(null); }, [supplyCustomer, supplyCurrent]);
  const contactIdentityRef = useRef(contactScope.identityKey);
  useEffect(() => {
    if (contactIdentityRef.current === contactScope.identityKey) return;
    contactIdentityRef.current = contactScope.identityKey;
    // A scope is part of every contacts request. Reset both restored caches when
    // account or enterprise changes instead of allowing an old page result to linger.
    void Promise.all([
      utils.customer.contactsSummary.reset(),
      utils.customer.contactsList.reset(),
    ]);
  }, [contactScope.identityKey, utils]);
  const summaryInput = contactScope.scope
    ? withCustomerContactScope(contactScope.scope, { customerIds: pageCustomerIds })
    : { customerIds: pageCustomerIds, expectedActorUserId: 0, expectedEnterpriseId: 0 };
  // One bounded query for the already-authorized current page; never fetch a full
  // contacts list per table row.
  const contactsSummaryQuery = trpc.customer.contactsSummary.useQuery(summaryInput, {
    enabled: contactScope.ready && Boolean(contactScope.scope) && pageCustomerIds.length > 0,
    retry: false,
    staleTime: 0,
  });
  const contactSummaries = useMemo(() => new Map(
    (contactsSummaryQuery.data?.items ?? []).map(summary => [summary.customerId, summary]),
  ), [contactsSummaryQuery.data]);
  const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / PAGE_SIZE));
  const safePage = result ? Math.min(page, totalPages) : page;
  const currentListInputRef = useRef(listInput);
  currentListInputRef.current = listInput;
  useEffect(() => {
    if (stars.busy || listQuery.isFetching || !result || starFocusId.current === null) return;
    const id = starFocusId.current; starFocusId.current = null;
    const star = tableRegionRef.current?.querySelector<HTMLButtonElement>(`button[data-star-customer="${id}"]`);
    (star ?? tableRegionRef.current ?? createButtonRef.current)?.focus({ preventScroll: true });
  }, [result, listQuery.isFetching, stars.busy]);
  useEffect(() => { starFocusId.current = null; }, [contactScope.identityKey]);

  const collapseCreate = (force = false) => {
    if (!force && createState.busy) return;
    setCreateOpen(false);
    setCreateState({ dirty: false, busy: false });
    createButtonRef.current?.focus({ preventScroll: true });
  };
  const handleCustomerSaved = ({ id, mode }: { id: number; mode: CustomerCreateSaveMode }) => {
    if (mode === "close") collapseCreate(true);
    const savedListInput = listInput;
    // Keep the current scope, filters and page. Never inject a record that does
    // not match the server's authoritative filtered result into this table.
    void utils.customer.list.invalidate()
      .then(() => utils.customer.list.fetch(savedListInput, { staleTime: 0 }))
      .then(refreshed => {
        if (!mountedRef.current || JSON.stringify(currentListInputRef.current) !== JSON.stringify(savedListInput)) return;
        if (!refreshed.items.some(customer => customer.id === id)) {
          toast.info("客户已保存，当前筛选或页码下未显示，可调整筛选或查看客户。", {
            action: { label: "查看客户", onClick: () => navigate(`/customers/${id}`) },
          });
        }
      })
      .catch(() => {
        if (mountedRef.current) toast.warning("客户已保存，但列表刷新失败，请重试刷新列表，不要重复录入。");
      });
  };

  // A request can settle after this list has unmounted. The completion is scoped
  // by the exact draft identity, so a later identity cannot consume it.
  useEffect(() => {
    if (!contactScope.ready || contextQuery.isPending || contextQuery.isError) return;
    const completion = createDraft.completion;
    if (!completion) return;
    createDraft.consumeCompletion();
    if (completion.mode === "continue") setCreateOpen(true);
    handleCustomerSaved(completion);
  }, [contactScope.ready, contextQuery.isError, contextQuery.isPending, createDraft, createDraft.completion]);

  useEffect(() => {
    if (result && !listQuery.isFetching && safePage !== page) setPage(safePage);
  }, [page, safePage, result, listQuery.isFetching]);

  const updateDraft = <K extends keyof FilterState>(
    key: K,
    value: FilterState[K]
  ) => {
    setDraftFilters(current => ({ ...current, [key]: value }));
  };

  const applyFilters = () => {
    const next = {
      ...draftFilters,
      keyword: draftFilters.keyword.trim(),
      starredOnly: appliedFilters.starredOnly === true,
      assignedUserId:
        draftFilters.scope === "all" ? draftFilters.assignedUserId : "",
    };
    setDraftFilters(next);
    setAppliedFilters(next);
    setPage(1);
  };

  const resetFilters = () => {
    // Scope is a header-level view choice, like inventory status, rather than
    // a transient form condition. Resetting filters must not expose another
    // assignee when moving between scope views.
    // Reset also clears starredOnly, without changing the assignee-star semantics.
    const scope = canReadAll ? appliedFilters.scope : "mine";
    const next = { ...DEFAULT_FILTERS, scope };
    setDraftFilters(next);
    setAppliedFilters(next);
    setPage(1);
  };

  const changeScope = (scope: ScopeFilter) => {
    const safeScope = canReadAll && scope === "all" ? "all" : "mine";
    // Clear both draft and applied assignment when scope changes so switching
    // back to all-company cannot silently revive a previous owner filter.
    setDraftFilters(current => ({
      ...current,
      scope: safeScope,
      assignedUserId: "",
    }));
    setAppliedFilters(current => ({
      ...current,
      scope: safeScope,
      assignedUserId: "",
    }));
    setPage(1);
  };

  const toggleStarredOnly = () => {
    // Apply this one condition immediately to the existing server query, not
    // unapplied drafts. Keep both copies in sync so later Enter/确定 preserves it.
    const starredOnly = appliedFilters.starredOnly !== true;
    setDraftFilters(current => ({ ...current, starredOnly }));
    setAppliedFilters(current => ({ ...current, starredOnly }));
    setPage(1);
  };

  const canResetFilters = Boolean(
    draftFilters.keyword ||
      draftFilters.grade ||
      draftFilters.stage ||
      draftFilters.assignedUserId ||
      draftFilters.due !== "all" ||
      draftFilters.archived ||
      draftFilters.starredOnly === true ||
      appliedFilters.keyword ||
      appliedFilters.grade ||
      appliedFilters.stage ||
      appliedFilters.assignedUserId ||
      appliedFilters.due !== "all" ||
      appliedFilters.archived ||
      appliedFilters.starredOnly === true
  );

  const emptyMessage = appliedFilters.archived
    ? "暂无已归档客户"
    : "暂无匹配客户";

  return (
    <PlatformLayout>
      <AdminPage className="customer-list-page">
      <AdminPageHeader title="客户列表" actions={
        <div className="flex flex-wrap items-center gap-2">
          {canReadAll ? (
            <Select
              value={appliedFilters.scope}
              onValueChange={value => changeScope(value as ScopeFilter)}
            >
              <SelectTrigger
                aria-label="客户范围"
                className="customer-list-control w-[126px] bg-white"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mine">我的客户</SelectItem>
                <SelectItem value="all">{canManageAll ? "全企业" : "授权组员客户"}</SelectItem>
              </SelectContent>
            </Select>
          ) : null}
          <Button
            ref={createButtonRef}
            type="button"
            className="customer-list-control bg-[#185FA5] hover:bg-[#0C447C]"
            aria-expanded={createOpen}
            aria-controls="customer-entry-panel"
            disabled={!d51Ready || createState.busy || contextQuery.isPending || contextQuery.isError}
            onClick={() => createOpen ? collapseCreate() : setCreateOpen(true)}
          >
            {createOpen ? <ChevronUp className="mr-1 h-3.5 w-3.5" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
            {createOpen ? "收起录入" : "录入客户"}
          </Button>
        </div>
      } />

      {appliedFilters.starredOnly === true && !stars.ready && !stars.failed && !stars.invalidTarget ?
        <p role="status" className="customer-list-caption mb-2">正在核验重点客户权限；仅看重点客户筛选已保留，暂不读取客户结果。</p> : null}
      {stars.failed || stars.invalidTarget ? <div role="alert" className="customer-list-caption mb-2">
        重点客户权限读取失败，其他客户操作仍可使用。
        <CustomerSupplyAction onClick={stars.refresh}>重新读取重点客户权限</CustomerSupplyAction>
      </div> : null}
      {stars.notice ? <div role={stars.unknown ? "alert" : "status"} aria-live="polite" className="customer-list-caption mb-2">
        {stars.notice}
        {stars.unknown ? <CustomerSupplyAction onClick={stars.retry}>重试原重点客户请求</CustomerSupplyAction> : null}
      </div> : null}

      <AdminFilterBar className="customer-list-filters mb-3" aria-label="客户筛选">
        <div className="customer-list-filter-row customer-list-basic-filters" role="group" aria-label="基础筛选">
          <div className="customer-list-search-group">
            <Input
              placeholder="搜索客户名称、联系人或电话"
              aria-label="搜索客户名称、联系人或电话"
              value={draftFilters.keyword}
              onChange={event => updateDraft("keyword", event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter") applyFilters();
              }}
              className="customer-list-control customer-list-search bg-white"
            />
            <button type="button" className="customer-list-star customer-list-star-filter"
              aria-label="仅看重点客户" aria-pressed={appliedFilters.starredOnly === true}
              title={appliedFilters.starredOnly === true ? "取消仅看重点客户筛选（保留其他条件）" : "仅看重点客户（叠加已应用条件，不提交筛选草稿）"}
              onClick={toggleStarredOnly}>
              <Star size={16} aria-hidden="true" />
            </button>
          </div>
          <Select
            value={draftFilters.grade || "all"}
            onValueChange={value =>
              updateDraft(
                "grade",
                value === "all" ? "" : (value as GradeFilter)
              )
            }
          >
            <SelectTrigger
              aria-label="按客户等级筛选"
              className="customer-list-control w-[126px] bg-white"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部等级</SelectItem>
              {CUSTOMER_GRADES.map(grade => (
                <SelectItem key={grade} value={grade}>
                  {grade}级客户
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={draftFilters.due}
            onValueChange={value => updateDraft("due", value as DueFilter)}
          >
            <SelectTrigger
              aria-label="按跟进状态筛选"
              className="customer-list-control w-[140px] bg-white"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部跟进</SelectItem>
              <SelectItem value="today">今日待跟进</SelectItem>
              <SelectItem value="overdue">已逾期</SelectItem>
            </SelectContent>
          </Select>
          <div className="customer-list-filter-actions">
            <Button
              type="button"
              variant="outline"
              className={toolbarActionClass}
              onClick={applyFilters}
            >
              搜索
            </Button>
            <Button
              type="button"
              variant="outline"
              className={toolbarActionClass}
              title="重置筛选（含仅看重点客户），保留客户范围"
              disabled={!canResetFilters}
              onClick={resetFilters}
            >
              重置
            </Button>
            <Button
              type="button"
              variant="outline"
              aria-expanded={moreFiltersOpen}
              aria-controls="customer-list-more-filters"
              className="customer-list-control min-w-[110px] justify-between border-slate-300 bg-white px-3 text-slate-700 shadow-none hover:bg-slate-50 hover:text-slate-900"
              onClick={() => setMoreFiltersOpen(open => !open)}
            >
              更多筛选
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${moreFiltersOpen ? "rotate-180" : ""}`}
              />
            </Button>
          </div>
        </div>

        {moreFiltersOpen ? (
          <div id="customer-list-more-filters" className="customer-list-filter-row customer-list-more-filters" role="group" aria-label="更多筛选条件">
            <Select
              value={draftFilters.stage || "all"}
              onValueChange={value =>
                updateDraft(
                  "stage",
                  value === "all" ? "" : (value as StageFilter)
                )
              }
            >
              <SelectTrigger
                aria-label="按客户阶段筛选"
                className="customer-list-control w-[140px] bg-white"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部阶段</SelectItem>
                {CUSTOMER_STAGES.map(stage => (
                  <SelectItem key={stage} value={stage}>
                    {CUSTOMER_STAGE_LABELS[stage]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canReadAll && draftFilters.scope === "all" ? (
              <Select
                value={draftFilters.assignedUserId || "all"}
                onValueChange={value =>
                  updateDraft("assignedUserId", value === "all" ? "" : value)
                }
              >
                <SelectTrigger
                  aria-label="按负责人筛选"
                  className="customer-list-control w-[156px] bg-white"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部负责人</SelectItem>
                  {(canManageAll ? contextQuery.data?.members ?? [] : stars.targets).map(member => (
                    <SelectItem
                      key={member.userId}
                      value={String(member.userId)}
                    >
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Select
              value={draftFilters.archived ? "archived" : "active"}
              onValueChange={value =>
                updateDraft("archived", value === "archived")
              }
            >
              <SelectTrigger
                aria-label="按归档状态筛选"
                className="customer-list-control w-[140px] bg-white"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">在档客户</SelectItem>
                <SelectItem value="archived">已归档客户</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={toolbarActionClass}
              onClick={applyFilters}
            >
              确定
            </Button>
          </div>
        ) : null}
      </AdminFilterBar>

      {createOpen && (
        <section id="customer-entry-panel" aria-labelledby="customer-entry-heading" className="mb-3">
          <CustomerCreateForm
            onCollapse={collapseCreate}
            onDiscarded={collapseCreate}
            onSaved={handleCustomerSaved}
            onStateChange={setCreateState}
            onIdentityInvalidated={() => collapseCreate(true)}
            draftIdentity={createDraftIdentity}
          />
        </section>
      )}

      {contextQuery.isError ? (
        <ErrorPanel
          message={`无法读取客户权限：${errorMessage(contextQuery.error)}`}
          onRetry={() => contextQuery.refetch()}
        />
      ) : listQuery.isError ? (
        <ErrorPanel
          message={errorMessage(listQuery.error)}
          onRetry={() => listQuery.refetch()}
        />
      ) : (
        <AdminDataPanel className="overflow-hidden p-0">
          {supplyAuthority.failed ? <div role="alert" className="customer-list-error border-b px-3 py-2">
            供应库存权限读取失败。
            <CustomerSupplyAction onClick={() => void supplyAuthority.retry()}>重试供应权限</CustomerSupplyAction>
          </div> : null}
          {listQuery.isPending ? (
            <div className="flex justify-center p-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (result?.items.length ?? 0) === 0 ? (
            <div className="p-14 text-center">
              <p className="admin-cell-primary font-medium">
                {emptyMessage}
              </p>
              <p className="customer-list-caption mt-1.5">
                {appliedFilters.archived
                  ? "归档客户会保留历史记录，可由管理员恢复。"
                  : "可以新建客户，或调整筛选条件后再试。"}
              </p>
              {!appliedFilters.archived ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="admin-row-action mt-2 px-0 text-[#185FA5]"
                  disabled={!d51Ready || createState.busy || contextQuery.isPending || contextQuery.isError}
                  onClick={() => {
                    setCreateOpen(true);
                    document.getElementById("customer-entry-panel")?.scrollIntoView({ block: "nearest" });
                  }}
                >
                  录入第一位客户
                </Button>
              ) : null}
            </div>
          ) : (
            <div ref={tableRegionRef} className="customer-list-table-scroll" data-page-memory-scroll="customer-list-table" role="region" tabIndex={0} aria-label="客户列表，可横向滚动查看全部列">
            <Table className="admin-table-readable customer-list-table" containerClassName="customer-list-table-inner" aria-label="客户列表">
              <colgroup>
                <col className="customer-list-col-name" />
                <col className="customer-list-col-industry" />
                <col className="customer-list-col-contacts" />
                <col className="customer-list-col-stage" />
                <col className="customer-list-col-owner" />
                <col className="customer-list-col-supply" />
                <col className="customer-list-col-demand" />
                <col className="customer-list-col-actions" />
              </colgroup>
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead>
                    客户名称
                  </TableHead>
                  <TableHead>
                    所属行业
                  </TableHead>
                  <TableHead>
                    联系人 / 电话
                  </TableHead>
                  <TableHead>
                    等级 / 阶段
                  </TableHead>
                  <TableHead>
                    负责人
                  </TableHead>
                  <TableHead className="text-center" data-testid="supply-header">供应库存</TableHead>
                  <TableHead className="customer-list-demand-column text-center" data-testid="demand-header">
                    需求录入
                  </TableHead>
                  <TableHead className="customer-list-actions-column text-right" data-testid="actions-header">
                    跟进
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result?.items.map(customer => {
                  const incomplete = customerNeedsCompletion(customer);
                  const rowStarred = customer.starUserId === customer.assignedUserId && customer.isStarred === true;
                  return (
                    <TableRow key={customer.id} data-page-memory-row={String(customer.id)}>
                      <TableCell>
                        <div className="customer-list-name-line">
                        <button
                          type="button"
                          className="customer-list-name min-w-0 truncate text-left font-medium hover:underline"
                          title={customer.name || "未命名客户"}
                          onClick={() => navigate(`/customers/${customer.id}`)}
                        >
                          {customer.name?.trim() || "未命名客户"}
                        </button>
                        <button type="button" className="customer-list-star" data-star-customer={customer.id}
                          data-star-state={stars.pendingCustomerId === customer.id && stars.busy ? "pending" : rowStarred ? "starred" : "unstarred"}
                          aria-label={`${rowStarred ? "取消重点客户标记" : "标记为重点客户"}：${customer.name?.trim() || "未命名客户"}`}
                          aria-pressed={rowStarred}
                          aria-busy={stars.pendingCustomerId === customer.id && stars.busy}
                          aria-disabled={!stars.canSet(customer) || stars.blocked || listQuery.isFetching}
                          disabled={!stars.canSet(customer) || stars.blocked || listQuery.isFetching}
                          title={!stars.ready ? "重点客户权限尚未核验" : !Number.isSafeInteger(customer.assignedUserId) || customer.assignedUserId < 1 ? "当前客户没有有效负责人，不能设置重点标记" : !stars.canSet(customer) ? "当前负责人不在合法重点标记范围，不能设置" : rowStarred ? "取消重点客户标记" : "标记为重点客户"}
                          onClick={event => { event.stopPropagation(); if (!listQuery.isFetching) stars.toggle(customer); }}>
                          {stars.pendingCustomerId === customer.id && stars.busy ? <Loader2 size={16} aria-hidden="true" className="animate-spin" />
                            : <Star size={16} aria-hidden="true" />}
                        </button>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          {incomplete ? (
                            <span className="customer-list-status rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">
                              待补全
                            </span>
                          ) : null}
                          {customer.archivedAt ? (
                            <span className="customer-list-status rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                              已归档
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="customer-list-secondary-data truncate" title={getBusinessIndustryLabel(customer.industryCode)} data-testid="industry-cell">{getBusinessIndustryLabel(customer.industryCode)}</TableCell>
                      <TableCell className="customer-list-contacts-cell">
                        <CustomerContactsSummary
                          customerId={customer.id}
                          contactName={contactSummaries.get(customer.id)?.primaryContact?.name ?? customer.contactName}
                          primaryMethod={contactSummaries.get(customer.id)?.primaryContact?.methods[0] ? formatContactMethod(contactSummaries.get(customer.id)!.primaryContact!.methods[0]) : customer.phone}
                          contactCount={contactSummaries.get(customer.id)?.contactCount ?? 1}
                          scope={contactScope.scope}
                          scopeReady={contactScope.ready}
                          identityKey={contactScope.identityKey}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          <span
                            className={`customer-list-status rounded px-1.5 py-0.5 font-medium ${gradeClass(customer.grade)}`}
                          >
                            {customer.grade}
                          </span>
                          <span
                            className="admin-cell-secondary truncate"
                            title={CUSTOMER_STAGE_LABELS[customer.stage]}
                          >
                            {CUSTOMER_STAGE_LABELS[customer.stage]}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell
                        className="customer-list-secondary-data truncate"
                        title={customer.assignedName}
                      >
                        {customer.assignedName || "—"}
                      </TableCell>
                      <TableCell className="text-center" data-testid="supply-cell">
                        <CustomerSupplyCell summary={supplyAuthority.canRead ? supplySummaries.get(customer.id) : (() => {
                          const summary = supplySummaries.get(customer.id);
                          return summary ? { ...summary, canViewStock: false, channelId: null, materialCount: null } : undefined;
                        })()} canWrite={supplyAuthority.canWrite && supplyResult.canWrite} archived={Boolean(customer.archivedAt)}
                          loading={supplyResult.loading} failed={supplyResult.failed}
                          onRetry={() => setSupplyRevision(value => value + 1)}
                          needsIndustry={!businessIndustryCodeSchema.safeParse(customer.industryCode).success} onCompleteProfile={() => navigate(`/customers/${customer.id}`)}
                          onUpload={() => { if (supplyAuthority.identity) setSupplyCustomer({ id: customer.id, version: customer.version, authorityKey: supplyAuthority.identity.key }); }}
                          onViewStock={channelId => navigate(supplyLocation(channelId, "materials"))} />
                      </TableCell>
                      <TableCell className="customer-list-demand-column text-center" data-testid="demand-cell">
                        <CustomerSupplyAction
                          disabledReason={customer.archivedAt ? "该客户已归档，不能录入需求" : undefined}
                          onClick={() => setDemandCustomer({ id: customer.id, name: customer.name, archivedAt: customer.archivedAt })}
                        >
                          需求录入
                        </CustomerSupplyAction>
                      </TableCell>
                      <TableCell className="customer-list-actions-column text-right" data-testid="actions-cell">
                        <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                          <CustomerSupplyAction
                            disabledReason={customer.archivedAt ? "该客户已归档，不能新增跟进" : undefined}
                            onClick={() =>
                              navigate(`/customers/${customer.id}?follow=1`)
                            }
                          >
                            跟进
                          </CustomerSupplyAction>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          )}

          <div className="customer-list-caption flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-3 py-3">
            <span className="whitespace-nowrap">
              共 {result?.total ?? 0} 条 · 第 {safePage} / {totalPages} 页
            </span>
            <div className="flex items-center gap-1.5 whitespace-nowrap">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="admin-row-action customer-list-pagination bg-white px-3"
                disabled={safePage <= 1 || listQuery.isFetching}
                onClick={() => setPage(value => Math.max(1, value - 1))}
              >
                上一页
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="admin-row-action customer-list-pagination bg-white px-3"
                disabled={safePage >= totalPages || listQuery.isFetching}
                onClick={() =>
                  setPage(value => Math.min(totalPages, value + 1))
                }
              >
                下一页
              </Button>
            </div>
          </div>
        </AdminDataPanel>
      )}
      {supplyCustomer && supplyCurrent && supplyAuthority.identity ? <CustomerSupplyUploadDialog
        key={`${supplyAuthority.identity.key}:${supplyCustomer.id}`} customerId={supplyCustomer.id} identity={supplyAuthority.identity}
        isCurrent={() => supplyCurrentRef.current} onClose={() => setSupplyCustomer(null)}
        onComplete={() => setSupplyRevision(value => value + 1)} onAuthorizationError={supplyAuthority.onAuthorizationError} /> : null}
      {demandCustomer && <CustomerDemandDialog
        customer={demandCustomer}
        onClose={() => setDemandCustomer(null)}
      />}
      </AdminPage>
    </PlatformLayout>
  );
}

function gradeClass(grade: CustomerData["grade"]): string {
  return grade === "A"
    ? "bg-[#FCEBEB] text-[#A32D2D]"
    : grade === "B"
      ? "bg-[#FFF7E6] text-[#B8741A]"
      : grade === "C"
        ? "bg-[#e8f0fe] text-[#185FA5]"
        : "bg-slate-100 text-slate-500";
}
function ErrorPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <AdminDataPanel className="border-[#F5C2C2] bg-[#FFF8F8] p-5 text-center">
      <p className="customer-list-error text-[#A32D2D]">加载失败：{message}</p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="customer-list-control mt-3"
        onClick={onRetry}
      >
        重试
      </Button>
    </AdminDataPanel>
  );
}
