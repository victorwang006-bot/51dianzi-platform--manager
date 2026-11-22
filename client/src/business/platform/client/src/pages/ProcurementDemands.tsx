import {
  usePageMemory,
  useRememberedState,
  freshListOptions,
  useRestoringListQuery,
} from "../hooks/usePageMemory";
import { useEffect, useState } from "react";
import { useBusinessScope } from "../../../../BusinessScope";
import {
  useProcurementRead,
  useProcurementArrivals,
} from "./procurementDemandReads";
import {
  AdminDataPanel,
  AdminFilterBar,
  AdminPage,
} from "@/components/admin/UnifiedAdminPage";
import { useAdminNewInformationContextRows } from "../../../../../lib/adminNewInformation";
import { AdminNewInformationRowBadge } from "../../../../../components/admin/AdminNewInformationBadge";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { CUSTOMER_DEMAND_UNITS } from "../../../shared/customerDemands";
import {
  formatBeijingDateTime,
  formatBeijingDateTimeWithSeconds,
} from "../../../shared/beijingTime";
import PlatformLayout from "../../../../BusinessContentFrame";
import { DemandQuoteDialog } from "../components/customerDemands/DemandQuoteDialog";
import { DemandQuoteList } from "../components/customerDemands/DemandQuoteList";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/ui/dialog";
import { trpc } from "../../../../api/business-trpc";
import "./ProcurementDemands.css";

type QuoteView = "all" | "unquoted" | "quoted" | "reconfirm";

const QUOTE_VIEW_OPTIONS = [
  { value: "all", label: "全部需求" },
  { value: "unquoted", label: "我未报价" },
  { value: "quoted", label: "我已报价" },
  { value: "reconfirm", label: "待重新确认" },
] as const satisfies readonly { value: QuoteView; label: string }[];

const PAGE_SIZE = 20;
const toolbarClass =
  "procurement-demand-control border-slate-300 bg-white px-3 text-slate-700 shadow-none hover:bg-slate-50 hover:text-slate-900";

function quoteProgress(demand: {
  mySupplierCount?: number;
  myQuoteRoundCount?: number;
  myQuoteNeedsReconfirmation?: boolean;
}) {
  if ((demand.mySupplierCount ?? 0) > 0)
    return `${demand.mySupplierCount}家 · 累计${demand.myQuoteRoundCount ?? 0}轮`;
  return demand.myQuoteNeedsReconfirmation ? "待更新" : "待报价";
}
function formatQty(value: number | null | undefined, unit: string | undefined) {
  return value == null
    ? "待确认"
    : `${value.toLocaleString("zh-CN")}${unit || "片"}`;
}
function priorityLabel(priority: "normal" | "urgent") {
  return priority === "urgent" ? "紧急" : "普通";
}

// Existing UI status eligibility only; quote writes remain server-authorized.
function quoteable(demand: { status: string }) {
  return demand.status === "submitted" || demand.status === "processing";
}

function ProcurementDemandDetailDialog({
  id,
  onClose,
  onQuote,
}: {
  id: number;
  onClose: () => void;
  onQuote: (quoteId?: number) => void;
}) {
  const detailQuery = trpc.customerDemand.procurementGet.useQuery(
    { id },
    { placeholderData: undefined, staleTime: 0, refetchOnMount: "always" }
  );
  const mismatch = Boolean(detailQuery.data && detailQuery.data.id !== id);
  const detailRead = useProcurementRead(
    detailQuery,
    String(id),
    true,
    mismatch
  );
  const detail = detailRead.data;
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="procurement-demands-detail flex min-w-0 max-h-[90dvh] w-[calc(100vw-32px)] max-w-[1100px] sm:max-w-[1100px] flex-col gap-0 overflow-hidden p-0"
        onEscapeKeyDown={event => {
          event.preventDefault();
          onClose();
        }}
        onInteractOutside={event => {
          event.preventDefault();
          onClose();
        }}
      >
        <div className="flex min-w-0 shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <DialogTitle>采购需求详情</DialogTitle>
            <DialogDescription className="sr-only">
              查看需求基本信息、物料明细与供应商报价
            </DialogDescription>
          </div>
          <button
            type="button"
            aria-label="关闭采购需求详情"
            onClick={onClose}
            className="procurement-demand-close shrink-0 rounded text-slate-600 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-3">
          {!detail && !detailQuery.error && (
            <div className="admin-cell-secondary flex items-center gap-2 py-8">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在加载需求…
            </div>
          )}
          {mismatch && (
            <p role="alert" className="text-red-600">
              需求上下文不一致，请关闭后重新打开。
            </p>
          )}
          {detailQuery.error && (
            <p
              role="alert"
              className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {detailQuery.error.message || "需求加载失败"}
            </p>
          )}
          {detail && (
            <>
              <div className="procurement-demand-metadata grid gap-3 border-b border-slate-100 pb-3 sm:grid-cols-3 lg:grid-cols-4">
                <div>
                  <p className="admin-cell-secondary">需求编号</p>
                  <p className="admin-cell-primary mt-1 break-all">
                    {detail.demandNo}
                  </p>
                </div>
                <div>
                  <p className="admin-cell-secondary">项目</p>
                  <p className="mt-1">{detail.projectName || "—"}</p>
                </div>
                <div>
                  <p className="admin-cell-secondary">提交时间</p>
                  <p className="mt-1 tabular-nums">
                    {formatBeijingDateTimeWithSeconds(detail.submittedAt) ||
                      "—"}
                  </p>
                </div>
                <div>
                  <p className="admin-cell-secondary">录入时间</p>
                  <p className="mt-1 tabular-nums">
                    {formatBeijingDateTimeWithSeconds(detail.createdAt) || "—"}
                  </p>
                </div>
                <div>
                  <p className="admin-cell-secondary">销售</p>
                  <p className="mt-1">{detail.salesName || "—"}</p>
                </div>
                <div>
                  <p className="admin-cell-secondary">优先级</p>
                  <p
                    className={`mt-1 ${detail.priority === "urgent" ? "font-medium text-red-600" : "text-slate-700"}`}
                  >
                    {priorityLabel(detail.priority)}
                  </p>
                </div>
                <div>
                  <p className="admin-cell-secondary">要求回复时间</p>
                  <p className="mt-1">
                    {formatBeijingDateTime(detail.replyDueAt) || "—"}
                  </p>
                </div>
              </div>
              <div className="mt-3">
                <h3 className="admin-section-title mb-2">
                  物料明细（共{detail.items.length}项）
                </h3>
                <div className="overflow-x-auto rounded border border-slate-200">
                  <table className="admin-table-readable procurement-demand-items w-full table-fixed">
                    <colgroup>
                      <col className="w-[24%]" />
                      <col className="w-[13%]" />
                      <col className="w-[11%]" />
                      <col className="w-[10%]" />
                      <col className="w-[7%]" />
                      <col className="w-[15%]" />
                      <col className="w-[20%]" />
                    </colgroup>
                    <thead>
                      <tr className="bg-slate-50 text-left">
                        <th className="px-2">型号</th>
                        <th className="px-2">品牌</th>
                        <th className="px-2">封装</th>
                        <th className="px-2 text-right">数量</th>
                        <th className="px-2">单位</th>
                        <th className="px-2">要求交期</th>
                        <th className="px-2">备注</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.items.map(item => (
                        <tr
                          key={item.id}
                          className="border-t border-slate-100 text-slate-700"
                        >
                          <td className="admin-cell-primary procurement-demand-model px-2 py-2">
                            {item.partNumber || "—"}
                          </td>
                          <td className="px-2 py-2">{item.brand || "—"}</td>
                          <td className="px-2 py-2">{item.pkg || "—"}</td>
                          <td className="admin-cell-primary px-2 py-2 text-right tabular-nums">
                            {item.qty == null
                              ? "待确认"
                              : item.qty.toLocaleString("zh-CN")}
                          </td>
                          <td className="px-2 py-2">
                            {item.qtyUnit &&
                            CUSTOMER_DEMAND_UNITS.includes(
                              item.qtyUnit as never
                            )
                              ? item.qtyUnit
                              : "—"}
                          </td>
                          <td className="px-2 py-2">
                            {item.deliveryRequirement || "—"}
                          </td>
                          <td className="whitespace-pre-wrap px-2 py-2">
                            {item.note || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {detail.note?.trim() ? (
                <div className="mt-3">
                  <h3 className="admin-section-title">需求说明</h3>
                  <p className="mt-1 whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 px-3 py-2 leading-6 text-slate-700">
                    {detail.note}
                  </p>
                </div>
              ) : null}
              <DemandQuoteList
                demandId={id}
                audience="procurement"
                canWrite={quoteable(detail)}
                onCreate={() => {
                  if (quoteable(detail)) onQuote();
                }}
                onEdit={quoteId => {
                  if (quoteable(detail)) onQuote(quoteId);
                }}
              />
            </>
          )}
        </div>
        <div className="flex min-w-0 shrink-0 justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3">
          <Button
            type="button"
            size="default"
            variant="outline"
            onClick={onClose}
            className="procurement-demand-control bg-white"
          >
            关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ProcurementDemands() {
  const scope = useBusinessScope();
  // A real authorization generation remounts local receipts, dialogs and arrival baseline.
  // A normal context revalidation does not interrupt an in-progress quotation.
  return (
    <ProcurementDemandsSession
      key={`${scope.storageScope}|${scope.contextVerification.authorizationVersion}`}
    />
  );
}

function ProcurementDemandsSession() {
  const d51Ready = usePageMemory();
  const [viewMemory, setView] = useRememberedState<
    QuoteView | "mine" | "unassigned"
  >("view", "all");
  const view: QuoteView =
    viewMemory === "mine"
      ? "quoted"
      : viewMemory === "unassigned"
        ? "unquoted"
        : QUOTE_VIEW_OPTIONS.some(option => option.value === viewMemory)
          ? viewMemory
          : "all";
  const [sortMemory, setSort] = useRememberedState<"latest" | "urgent">(
    "sort",
    "latest"
  );
  const sort: "latest" | "urgent" = sortMemory === "urgent" ? "urgent" : "latest";
  const [keywordInput, setKeywordInput] = useRememberedState(
    "keywordInput",
    ""
  );
  const [keyword, setKeyword] = useRememberedState("keyword", "");
  const [page, setPage] = useRememberedState("page", 1);
  const [openedId, setOpenedId] = useState<number | null>(null);
  const [quoteTarget, setQuoteTarget] = useState<{
    demandId: number;
    quoteId?: number;
  } | null>(null);
  const [latestIntent, setLatestIntent] = useState<{
    requestedAt: number;
    priorDataUpdatedAt: number;
  } | null>(null);
  const listInput = { view, sort, keyword, page, pageSize: PAGE_SIZE };
  const rawListQuery = trpc.customerDemand.procurementList.useQuery(
    listInput,
    freshListOptions({ placeholderData: undefined }, d51Ready)
  );
  const mainRead = useProcurementRead(
    rawListQuery,
    JSON.stringify(listInput),
    d51Ready
  );
  const arrivals = useProcurementArrivals(
    d51Ready && mainRead.data !== undefined && !mainRead.denied,
    mainRead.denied || !d51Ready
  );
  const denied = mainRead.denied || arrivals.denied;
  const result = denied ? undefined : mainRead.data;
  const listQuery = useRestoringListQuery(
    rawListQuery,
    result !== undefined && !denied
  );
  const items = result?.items ?? [];
  const currentPage = result?.page ?? page;
  const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / PAGE_SIZE));
  // New-information is a notification witness only. Server sort is never changed here.
  const listReady =
    d51Ready && !denied && mainRead.fresh && result !== undefined;
  const newInformationRows = useAdminNewInformationContextRows({
    module: "procurement",
    refs: listReady ? items.map(demand => `demand:${demand.id}`) : [],
    listReady,
  });
  useEffect(() => {
    if (result?.page && result.page !== page) setPage(result.page);
  }, [result?.page, page]);
  useEffect(() => {
    if (denied || !d51Ready) {
      setOpenedId(null);
      setQuoteTarget(null);
      setLatestIntent(null);
    }
  }, [denied, d51Ready]);
  useEffect(() => {
    if (
      !latestIntent || !listReady || !result ||
      view !== "all" || sort !== "latest" || keyword !== "" ||
      page !== 1 || result.page !== 1 ||
      !("latestSubmission" in result) ||
      rawListQuery.dataUpdatedAt < latestIntent.requestedAt ||
      rawListQuery.dataUpdatedAt <= latestIntent.priorDataUpdatedAt
    ) return;
    // Confirm the cursor actually displayed by this successful main read,
    // never the peek cursor and never merely a button click or cached result.
    arrivals.acknowledge(result.latestSubmission);
    setLatestIntent(null);
  }, [latestIntent, listReady, result, view, sort, keyword, page, rawListQuery.dataUpdatedAt]);
  const chooseView = (next: QuoteView) => {
    setLatestIntent(null);
    setView(next);
    setPage(1);
  };
  const search = () => {
    setLatestIntent(null);
    setKeyword(keywordInput.trim());
    setPage(1);
  };
  const latest = () => {
    const unchanged =
      view === "all" && sort === "latest" && keyword === "" && page === 1;
    setLatestIntent({
      requestedAt: Date.now(),
      priorDataUpdatedAt: rawListQuery.dataUpdatedAt,
    });
    setKeywordInput("");
    setKeyword("");
    setView("all");
    setSort("latest");
    setPage(1);
    window.scrollTo?.({ top: 0, left: 0 });
    if (unchanged) void manualRefresh();
  };
  const manualRefresh = async () => {
    try {
      const refreshed = await listQuery.refetch();
      if (refreshed?.error || refreshed?.isError)
        toast.error("刷新失败，请稍后重试");
    } catch {
      toast.error("刷新失败，请稍后重试");
    }
  };
  const ordinaryFailure =
    !denied && Boolean(listQuery.error) && result !== undefined;
  const appliedView =
    QUOTE_VIEW_OPTIONS.find(option => option.value === view)?.label ??
    "全部需求";
  const unapplied = keywordInput.trim() !== keyword;

  return (
    <PlatformLayout>
      <AdminPage className="procurement-demands-page" aria-label="采购内部需求">
        <AdminFilterBar className="mb-3 flex flex-wrap items-center gap-2">
          <label
            htmlFor="procurement-demand-view"
            className="admin-cell-secondary"
          >
            可报价需求
          </label>
          <select
            id="procurement-demand-view"
            aria-label="采购报价视图"
            value={view}
            onChange={event => {
              const next = QUOTE_VIEW_OPTIONS.find(
                option => option.value === event.target.value
              )?.value;
              if (next) chooseView(next);
            }}
            className="procurement-demand-control rounded-md border border-slate-300 bg-white px-3 text-slate-700"
          >
            {QUOTE_VIEW_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <label
            htmlFor="procurement-demand-sort"
            className="admin-cell-secondary"
          >
            排序
          </label>
          <select
            id="procurement-demand-sort"
            aria-label="采购需求排序"
            value={sort}
            onChange={event => {
              setSort(event.target.value === "urgent" ? "urgent" : "latest");
              setPage(1);
            }}
            className="procurement-demand-control rounded-md border border-slate-300 bg-white px-3 text-slate-700"
          >
            <option value="latest">最新提交</option>
            <option value="urgent">紧急优先</option>
          </select>
          <div className="ml-auto flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:flex-1">
            <Input
              aria-label="搜索需求编号或型号"
              value={keywordInput}
              onChange={event => setKeywordInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter") search();
              }}
              placeholder="搜索需求编号或型号"
              className="procurement-demand-control min-w-0 flex-1 bg-white sm:max-w-[320px]"
            />
            <Button
              type="button"
              variant="outline"
              onClick={search}
              className={toolbarClass}
            >
              <Search className="mr-1 h-3.5 w-3.5" />
              搜索
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={latest}
              className={toolbarClass}
            >
              查看最新
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void manualRefresh()}
              disabled={!d51Ready || Boolean(listQuery.isFetching)}
              className="procurement-demand-control border-[#185FA5]/40 bg-white text-[#185FA5] hover:bg-[#f5f9fd]"
            >
              <RefreshCw
                className={`mr-1.5 h-3.5 w-3.5 ${listQuery.isFetching ? "animate-spin" : ""}`}
              />
              手动刷新
            </Button>
          </div>
        </AdminFilterBar>
        <div
          className="procurement-demand-conditions mb-3 flex flex-wrap items-center gap-x-4 gap-y-1"
          aria-label="已应用采购条件"
        >
          <span>
            已应用：{appliedView} ·{" "}
            {sort === "latest" ? "最新提交" : "紧急优先"} ·{" "}
            {keyword ? `搜索“${keyword}”` : "未限制关键词"} · 第{page}页
          </span>
          {unapplied && (
            <span className="text-amber-700">
              输入尚未应用，请按 Enter 或搜索
            </span>
          )}
          <span className="admin-cell-secondary">
            仅显示当前账号获授权的内部已提交需求；保留本页筛选、页码与返回位置
          </span>
        </div>
        {!denied && arrivals.count > 0 && (
          <div
            className="procurement-demand-arrivals mb-3 flex flex-wrap items-center justify-between gap-2"
            aria-live="polite"
          >
            <span>有 {arrivals.count} 条新需求，列表尚未自动更新</span>
            <button
              type="button"
              className="procurement-demand-text-link"
              onClick={latest}
            >
              查看最新需求
            </button>
          </div>
        )}
        {!denied && arrivals.error && (
          <div className="procurement-demand-conditions mb-3">
            新需求检查暂未更新 ·{" "}
            <button
              type="button"
              className="procurement-demand-text-link"
              onClick={() => void arrivals.retry()}
            >
              重试检查
            </button>
          </div>
        )}
        <AdminDataPanel className="procurement-demands-panel gap-0 overflow-hidden p-0">
          {ordinaryFailure && (
            <div
              role="alert"
              className="procurement-demand-update-alert flex flex-wrap items-center gap-2 px-3 py-2"
            >
              暂未更新，以下保留上次成功数据 ·{" "}
              {listQuery.error?.message || "刷新失败"}
              <button
                type="button"
                onClick={() => void manualRefresh()}
                className="procurement-demand-text-link"
              >
                重试刷新
              </button>
            </div>
          )}
          {denied ? (
            <div role="alert" className="p-4 text-red-600">
              当前需求授权已失效，请重新核验权限后重试。
              <button
                type="button"
                className="procurement-demand-text-link ml-2"
                onClick={() => void manualRefresh()}
              >
                重试
              </button>
            </div>
          ) : !d51Ready || (!result && !listQuery.error) ? (
            <div className="admin-cell-secondary flex items-center justify-center gap-2 py-12">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在加载采购需求…
            </div>
          ) : !result && listQuery.error ? (
            <div role="alert" className="p-4 text-red-600">
              {listQuery.error.message || "采购需求加载失败"}
              <button
                type="button"
                onClick={() => void manualRefresh()}
                className="procurement-demand-text-link ml-2"
              >
                重试刷新
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="p-12 text-center">
              <p className="admin-cell-primary">暂无需求</p>
              <p className="admin-cell-secondary mt-1">
                当前筛选条件下没有可报价的内部需求，可点击“查看最新”清除旧条件
              </p>
            </div>
          ) : (
            <Table
              className="admin-table-readable procurement-demands-table table-fixed"
              containerClassName="procurement-demands-table-scroll"
            >
              <colgroup>
                <col />
                <col />
                <col />
                <col />
                <col />
                <col />
                <col />
                <col />
                <col />
              </colgroup>
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead>需求编号</TableHead>
                  <TableHead>型号</TableHead>
                  <TableHead>品牌</TableHead>
                  <TableHead className="text-right">数量</TableHead>
                  <TableHead>交期</TableHead>
                  <TableHead>提交时间</TableHead>
                  <TableHead>销售</TableHead>
                  <TableHead className="procurement-demand-quote-status">本人报价状态</TableHead>
                  <TableHead className="procurement-demand-actions text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(demand => {
                  const material = demand.matchedItem ?? {
                    partNumber: demand.firstPartNumber,
                    brand: demand.firstBrand,
                    qty: demand.firstQty,
                    qtyUnit: demand.firstQtyUnit,
                    deliveryRequirement: demand.firstDeliveryRequirement,
                  };
                  const submitted = formatBeijingDateTime(demand.submittedAt);
                  return (
                    <TableRow
                      key={demand.id}
                      ref={newInformationRows.getRow(`demand:${demand.id}`).ref}
                      data-page-memory-row={String(demand.id)}
                    >
                      <TableCell>
                        <button
                          type="button"
                          className="procurement-demand-number procurement-demand-text-link"
                          aria-label={`查看需求 ${demand.demandNo} 详情`}
                          onClick={() => setOpenedId(demand.id)}
                        >
                          {demand.demandNo}
                        </button>
                        <div className="procurement-demand-flags">
                          <AdminNewInformationRowBadge
                            isNew={
                              newInformationRows.getRow(`demand:${demand.id}`)
                                .isNew
                            }
                          />
                          {demand.priority === "urgent" && (
                            <span className="procurement-demand-priority text-red-600">
                              紧急
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => setOpenedId(demand.id)}
                          className="admin-cell-primary procurement-demand-model procurement-demand-text-link"
                          aria-label={`查看需求 ${demand.demandNo} 的型号详情`}
                        >
                          {material.partNumber || "查看物料详情"}
                        </button>
                        {demand.itemCount > 1 && (
                          <button
                            type="button"
                            className="admin-cell-secondary procurement-demand-text-link mt-1"
                            aria-label={`查看需求 ${demand.demandNo} 的全部${demand.itemCount}项物料`}
                            onClick={() => setOpenedId(demand.id)}
                          >
                            {demand.matchedItem
                              ? `命中第${demand.matchedItem.index}项 / 共${demand.itemCount}项 · 查看全部物料`
                              : `共${demand.itemCount}项 · 查看全部物料`}
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="procurement-demand-caption-cell procurement-demand-brand" title={material.brand || "待确认"}>
                        {material.brand || "待确认"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="admin-cell-primary tabular-nums">
                          {formatQty(material.qty, material.qtyUnit)}
                        </div>
                      </TableCell>
                      <TableCell className="procurement-demand-caption-cell procurement-demand-secondary-data">
                        <div>{material.deliveryRequirement || "待确认"}</div>
                        <div
                          className="admin-cell-secondary procurement-demand-reply mt-1"
                          title={
                            formatBeijingDateTime(demand.replyDueAt) ||
                            undefined
                          }
                        >
                          回复：
                          {formatBeijingDateTime(demand.replyDueAt) || "待确认"}
                        </div>
                      </TableCell>
                      <TableCell className="procurement-demand-caption-cell">
                        <div
                          className="procurement-demand-time tabular-nums"
                          title={`提交时间（北京时间）：${formatBeijingDateTimeWithSeconds(demand.submittedAt) || "待确认"}`}
                        >
                          {submitted || "提交时间待确认"}
                        </div>
                      </TableCell>
                      <TableCell className="procurement-demand-caption-cell procurement-demand-secondary-data">
                        {demand.salesName || "—"}
                      </TableCell>
                      <TableCell className="procurement-demand-caption-cell procurement-demand-quote-status">
                        <div className="font-medium">
                          {quoteProgress(demand)}
                        </div>
                        {demand.myQuoteNeedsReconfirmation && (
                          <div className="procurement-demand-reconfirm mt-1">
                            旧版报价待重新确认
                          </div>
                        )}
                        {(demand.currentQuoteCount ?? 0) > 0 && (
                          <div className="admin-cell-secondary mt-1">
                            全体当前 {demand.currentQuoteCount} 份
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="procurement-demand-actions text-right">
                        <div className="procurement-demand-row-actions">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setOpenedId(demand.id)}
                            aria-label={`查看需求 ${demand.demandNo}`}
                            className="admin-row-action procurement-demand-view-action"
                          >
                            查看
                          </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!quoteable(demand) || !listReady}
                          onClick={() => {
                            if (!quoteable(demand) || !listReady) return;
                            // Reconfirmation requires the original controlled personal quote selection/editor.
                            if (demand.myQuoteNeedsReconfirmation)
                              setOpenedId(demand.id);
                            else setQuoteTarget({ demandId: demand.id });
                          }}
                          title={
                            !quoteable(demand)
                              ? "当前需求不可报价，请查看详情核验"
                              : !listReady
                                ? "正在核验当前需求，请稍候"
                                : undefined
                          }
                          className="admin-row-action procurement-demand-quote-action border-[#185FA5]/30 bg-white px-2.5 text-[#185FA5] hover:bg-[#f5f9fd]"
                        >
                          {demand.myQuoteNeedsReconfirmation
                            ? "更新报价"
                            : (demand.myActiveQuoteCount ?? 0) > 0
                              ? "新增报价"
                              : "报价"}
                        </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {result && (result.total ?? 0) > 0 && (
            <div className="admin-cell-secondary flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-3 py-3">
              <span>
                共 {result.total} 条 · 第 {currentPage}/{totalPages} 页
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="admin-row-action bg-white px-2.5"
                  disabled={currentPage <= 1 || Boolean(listQuery.isFetching)}
                  onClick={() => setPage(currentPage - 1)}
                  aria-label="上一页"
                >
                  <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                  上一页
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="admin-row-action bg-white px-2.5"
                  disabled={
                    currentPage >= totalPages || Boolean(listQuery.isFetching)
                  }
                  onClick={() => setPage(currentPage + 1)}
                  aria-label="下一页"
                >
                  下一页
                  <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </AdminDataPanel>
        {!denied && d51Ready && openedId !== null && (
          <ProcurementDemandDetailDialog
            id={openedId}
            onClose={() => setOpenedId(null)}
            onQuote={quoteId => {
              setOpenedId(null);
              setQuoteTarget({
                demandId: openedId,
                ...(quoteId == null ? {} : { quoteId }),
              });
            }}
          />
        )}
        {!denied && d51Ready && quoteTarget !== null && (
          <DemandQuoteDialog
            demandId={quoteTarget.demandId}
            quoteId={quoteTarget.quoteId}
            onClose={() => setQuoteTarget(null)}
            onSaved={() => {
              void manualRefresh();
            }}
          />
        )}
      </AdminPage>
    </PlatformLayout>
  );
}
