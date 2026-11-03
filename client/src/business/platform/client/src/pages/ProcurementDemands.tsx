import { usePageMemory, useRememberedState, freshListOptions, useRestoringListQuery, returnToPageSource } from "../hooks/usePageMemory";
import { useEffect, useState } from "react";
import { AdminDataPanel, AdminFilterBar, AdminPage } from "@/components/admin/UnifiedAdminPage";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  CUSTOMER_DEMAND_UNITS,
} from "../../../shared/customerDemands";
import { formatBeijingDateTime } from "../../../shared/beijingTime";
import PlatformLayout from "../../../../BusinessContentFrame";
import { DemandQuoteDialog } from "../components/customerDemands/DemandQuoteDialog";
import { DemandQuoteList } from "../components/customerDemands/DemandQuoteList";
import { ProcurementWorkspaceNav } from "../components/customerDemands/ProcurementWorkspaceNav";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/ui/dialog";
import { trpc } from "../../../../api/business-trpc";
import "./ProcurementDemands.css";

type QuoteView = "all" | "unquoted" | "quoted";

const QUOTE_VIEW_OPTIONS = [
  { value: "all", label: "全部需求" },
  { value: "unquoted", label: "我未报价" },
  { value: "quoted", label: "我已报价" },
] as const satisfies readonly { value: QuoteView; label: string }[];

const PAGE_SIZE = 20;
const toolbarClass =
  "procurement-demand-control border-slate-300 bg-white px-3 text-slate-700 shadow-none hover:bg-slate-50 hover:text-slate-900";

function quoteProgress(demand: { mySupplierCount?: number; myQuoteRoundCount?: number; myQuoteNeedsReconfirmation?: boolean }) {
  if ((demand.mySupplierCount ?? 0) > 0) return `${demand.mySupplierCount}家 · 累计${demand.myQuoteRoundCount ?? 0}轮`;
  return demand.myQuoteNeedsReconfirmation ? "待更新" : "待报价";
}
function formatQty(value: number | null | undefined, unit: string | undefined) {
  return value == null ? "待确认" : `${value.toLocaleString("zh-CN")}${unit || "片"}`;
}
function priorityLabel(priority: "normal" | "urgent") {
  return priority === "urgent" ? "紧急" : "普通";
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
  const detailQuery = trpc.customerDemand.procurementGet.useQuery({ id });
  const detail = detailQuery.data;
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
            <DialogTitle className="admin-section-title">
              采购需求详情
            </DialogTitle>
            <DialogDescription className="admin-cell-secondary mt-1">
              内部需求，仅供授权采购独立报价
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
          {detailQuery.isLoading && (
            <div className="admin-cell-secondary flex items-center gap-2 py-8">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在加载需求…
            </div>
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
                  <p className="mt-1">
                    {detail.projectName || "—"}
                  </p>
                </div>
                <div>
                  <p className="admin-cell-secondary">销售</p>
                  <p className="mt-1">
                    {detail.salesName || "—"}
                  </p>
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
                  物料明细
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
                            {item.qty ?? "—"}
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
                          <td className="px-2 py-2">{item.note || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="mt-3">
                <h3 className="admin-section-title">
                  需求说明
                </h3>
                <p className="mt-1 whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 px-3 py-2 leading-6 text-slate-700">
                  {detail.note || "—"}
                </p>
              </div>
              <DemandQuoteList demandId={id} audience="procurement" onCreate={() => onQuote()} onEdit={onQuote} />
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
          {detail &&
            (detail.status === "submitted" ||
              detail.status === "processing") && (
              <Button
                type="button"
                size="default"
                onClick={() => onQuote()}
                className="procurement-demand-control bg-[#185FA5] hover:bg-[#0C447C]"
              >
                新增供应商报价
              </Button>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ProcurementDemands() {
  const d51Ready = usePageMemory();

  const [view, setView] = useRememberedState<QuoteView>("view", "all");
  const [keywordInput, setKeywordInput] = useRememberedState("keywordInput", "");
  const [keyword, setKeyword] = useRememberedState("keyword", "");
  const [page, setPage] = useRememberedState("page", 1);
  const [openedId, setOpenedId] = useState<number | null>(null);
  const [quoteTarget, setQuoteTarget] = useState<{ demandId: number; quoteId?: number } | null>(null);
  const listQuery = useRestoringListQuery(trpc.customerDemand.procurementList.useQuery({
    view,
    keyword,
    page,
    pageSize: PAGE_SIZE,
  }, freshListOptions({}, d51Ready)));
  const result = listQuery.data;
  const items = result?.items ?? [];
  const currentPage = result?.page ?? page;
  const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / PAGE_SIZE));

  useEffect(() => {
    if (result?.page && result.page !== page) setPage(result.page);
  }, [result?.page, page]);
  const chooseView = (next: QuoteView) => {
    setView(next);
    setPage(1);
  };
  const search = () => {
    setKeyword(keywordInput.trim());
    setPage(1);
  };
  const manualRefresh = async () => {
    try {
      await listQuery.refetch?.();
    } catch {
      toast.error("刷新失败，请稍后重试");
    }
  };
  const quoteable = (demand: (typeof items)[number]) =>
    demand.status === "submitted" || demand.status === "processing";

  return (
    <PlatformLayout>
    <AdminPage className="procurement-demands-page" aria-label="采购内部需求">
    <ProcurementWorkspaceNav active="internal" />
    <AdminFilterBar className="mb-3 flex flex-wrap items-center gap-2">
        <label htmlFor="procurement-demand-view" className="admin-cell-secondary">报价状态</label>
        <select
          id="procurement-demand-view"
          aria-label="采购报价视图"
          value={view}
          onChange={event => {
            const nextView = QUOTE_VIEW_OPTIONS.find(option => option.value === event.target.value)?.value;
            if (nextView) chooseView(nextView);
          }}
          className="procurement-demand-control rounded-md border border-slate-300 bg-white px-3 text-slate-700"
        >
          {QUOTE_VIEW_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
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
            size="default"
            variant="outline"
            onClick={search}
            className={`${toolbarClass} min-w-[60px]`}
          >
            <Search className="mr-1 h-3.5 w-3.5" />
            搜索
          </Button>
          <Button
            type="button"
            size="default"
            variant="outline"
            onClick={() => {
              setKeywordInput("");
              setKeyword("");
              chooseView("all");
            }}
            className={toolbarClass}
          >
            重置
          </Button>
          <Button
            type="button"
            size="default"
            variant="outline"
            onClick={() => void manualRefresh()}
            disabled={Boolean(listQuery.isFetching)}
            className="procurement-demand-control border-[#185FA5]/40 bg-white text-[#185FA5] hover:bg-[#f5f9fd] hover:text-[#185FA5]"
          >
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${listQuery.isFetching ? "animate-spin" : ""}`}
            />
            手动刷新
          </Button>
        </div>
      </AdminFilterBar>
      <AdminDataPanel className="gap-0 overflow-hidden p-0">
        {listQuery.isLoading ? (
          <div className="admin-cell-secondary flex items-center justify-center gap-2 py-12">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在加载采购需求…
          </div>
        ) : listQuery.error ? (
          <div role="alert" className="p-4 text-sm text-red-600">
            {listQuery.error.message || "采购需求加载失败"}
          </div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center">
            <p className="admin-cell-primary">暂无需求</p>
            <p className="admin-cell-secondary mt-1">
              当前筛选条件下没有可报价的内部需求
            </p>
          </div>
        ) : (
          <Table className="admin-table-readable procurement-demands-table table-fixed">
            <colgroup>
              <col className="w-[17%]" />
              <col className="w-[21%]" />
              <col className="w-[8%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[8%]" />
              <col className="w-[12%]" />
              <col className="w-[14%]" />
            </colgroup>
            <TableHeader>
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                <TableHead>需求编号</TableHead>
                <TableHead>型号</TableHead>
                <TableHead>品牌</TableHead>
                <TableHead className="text-right">数量</TableHead>
                <TableHead>交期</TableHead>
                <TableHead>销售</TableHead>
                <TableHead>报价进度</TableHead>
                <TableHead className="procurement-demand-actions text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(demand => (
                <TableRow
                  key={demand.id}
                  className="h-[60px]" data-page-memory-row={String(demand.id)}
                >
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <span className="admin-cell-primary procurement-demand-number">{demand.demandNo}</span>
                      {demand.priority === "urgent" ? <span className="procurement-demand-priority font-medium text-red-600">紧急</span> : null}
                    </div>
                    <div className="admin-cell-secondary mt-0.5 truncate" title={demand.projectName || undefined}>{demand.projectName || "—"}</div>
                  </TableCell>
                  <TableCell>
                    <div className="admin-cell-primary procurement-demand-model" title={demand.firstPartNumber || undefined}>{demand.firstPartNumber || "—"}</div>
                    {demand.itemCount > 1 ? <div className="admin-cell-secondary mt-0.5">共{demand.itemCount}项</div> : null}
                  </TableCell>
                  <TableCell className="procurement-demand-secondary-data truncate" title={demand.firstBrand || undefined}>{demand.firstBrand || "—"}</TableCell>
                  <TableCell className="admin-cell-primary whitespace-nowrap text-right tabular-nums">{formatQty(demand.firstQty, demand.firstQtyUnit)}</TableCell>
                  <TableCell className="procurement-demand-secondary-data truncate" title={demand.firstDeliveryRequirement || undefined}>{demand.firstDeliveryRequirement || "待确认"}</TableCell>
                  <TableCell className="procurement-demand-secondary-data truncate" title={demand.salesName || undefined}>{demand.salesName || "—"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                      <span aria-hidden="true" className={`text-[10px] ${(demand.mySupplierCount ?? 0) > 0 ? "text-emerald-500" : "text-amber-500"}`}>●</span>
                      <span className="font-medium">{quoteProgress(demand)}</span>
                    </div>
                    {(demand.currentQuoteCount ?? 0) > 0 ? <div className="admin-cell-secondary mt-0.5">全部共{demand.currentQuoteCount}份</div> : null}
                  </TableCell>
                  <TableCell className="procurement-demand-actions text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setOpenedId(demand.id)}
                        className="admin-row-action border border-slate-200 bg-white px-2.5 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      >
                        查看
                      </Button>
                      {quoteable(demand) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setQuoteTarget({ demandId: demand.id })}
                          className="admin-row-action border border-[#185FA5]/30 bg-white px-2.5 text-[#185FA5] hover:bg-[#f5f9fd] hover:text-[#185FA5]"
                        >
                          {(demand.myActiveQuoteCount ?? 0) > 0 ? "新增报价" : demand.myQuoteNeedsReconfirmation ? "更新报价" : "报价"}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!listQuery.isLoading && !listQuery.error && (result?.total ?? 0) > 0 ? (
        <div className="admin-cell-secondary flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-3 py-3">
          <span>共 {result?.total} 条 · 第 {currentPage}/{totalPages} 页</span>
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
            <ChevronLeft className="mr-1 h-3.5 w-3.5" />上一页
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
            下一页<ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
          </div>
        </div>
        ) : null}
      </AdminDataPanel>
      {openedId !== null && (
        <ProcurementDemandDetailDialog
          id={openedId}
          onClose={() => setOpenedId(null)}
          onQuote={quoteId => {
            setOpenedId(null);
            setQuoteTarget({ demandId: openedId, ...(quoteId == null ? {} : { quoteId }) });
          }}
        />
      )}
      {quoteTarget !== null && (
        <DemandQuoteDialog
          demandId={quoteTarget.demandId}
          quoteId={quoteTarget.quoteId}
          onClose={() => setQuoteTarget(null)}
          onSaved={() => {
            void listQuery.refetch?.();
          }}
        />
      )}
    </AdminPage>
    </PlatformLayout>
  );
}
