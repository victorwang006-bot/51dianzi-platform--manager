import { usePageMemory, useRememberedState, freshListOptions, useRestoringListQuery, returnToPageSource } from "../hooks/usePageMemory";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Plus, Search } from "lucide-react";
import { useLocation } from "wouter";
import {
  CUSTOMER_DEMAND_WORKFLOW_LABELS,
  CUSTOMER_DEMAND_WORKFLOW_STAGES,
  type CustomerDemandWorkflowStage,
  type SalesDemandSummary,
} from "../../../shared/customerDemands";
import PlatformLayout from "../../../../BusinessContentFrame";
import { CustomerDemandDialog } from "../components/customerDemands/CustomerDemandDialog";
import { formatBeijingDateTime } from "../../../shared/beijingTime";
import { trpc } from "../../../../api/business-trpc";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";

const PAGE_SIZE = 20;
type StageFilter = "all" | CustomerDemandWorkflowStage;
type ScopeFilter = "mine" | "all";
const secondaryButtonClass = "h-8 border-slate-300 bg-white px-3 text-xs text-slate-700 shadow-none hover:bg-slate-50";

function formatQty(value: number) {
  return Number.isFinite(value) ? Math.trunc(value).toLocaleString("zh-CN") : "0";
}

function stageClass(stage: CustomerDemandWorkflowStage) {
  if (stage === "quote_selection") return "border-amber-200 bg-amber-50 text-amber-700";
  if (stage === "quote_confirmed") return "border-blue-200 bg-blue-50 text-[#185FA5]";
  if (stage === "customer_confirmed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function quoteText(row: SalesDemandSummary) {
  if (row.currentQuoteCount === 0) {
    return (row.quoteCount ?? 0) > 0 ? `${row.quoteCount}份历史报价｜待重新报价` : "暂无报价";
  }
  if (row.acceptedQuoteCount > 0) return `${row.currentQuoteCount}份报价｜已采用${row.acceptedQuoteCount}份`;
  return `${row.currentQuoteCount}份报价｜待选择`;
}

export default function CustomerDemands() {
  const d51Ready = usePageMemory();

  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const contextQuery = trpc.customer.context.useQuery();
  const canManageAll = contextQuery.data?.canManageAll ?? false;
  const [draftKeyword, setDraftKeyword] = useRememberedState("draftKeyword", "");
  const [keyword, setKeyword] = useRememberedState("keyword", "");
  const [stage, setStage] = useRememberedState<StageFilter>("stage", "all");
  const [scope, setScope] = useRememberedState<ScopeFilter>("scope", "mine");
  const [assignedUserId, setAssignedUserId] = useRememberedState("assignedUserId", "all");
  const [due, setDue] = useRememberedState<"all" | "overdue">("due", "all");
  const [page, setPage] = useRememberedState("page", 1);
  const [activeDemand, setActiveDemand] = useState<SalesDemandSummary | null>(null);
  const [customerSelectOpen, setCustomerSelectOpen] = useState(false);
  const [customerKeywordDraft, setCustomerKeywordDraft] = useState("");
  const [customerKeyword, setCustomerKeyword] = useState("");
  const [customerPage, setCustomerPage] = useState(1);
  const [newDemandCustomer, setNewDemandCustomer] = useState<{ id: number; name: string; archivedAt: string | null } | null>(null);

  useEffect(() => {
    if (contextQuery.isLoading || contextQuery.isPending || !contextQuery.data) return;
    if (canManageAll) return;
    setScope("mine");
    setAssignedUserId("all");
  }, [canManageAll, contextQuery.isLoading, contextQuery.isPending, contextQuery.data]);

  const listInput = useMemo(() => ({
    keyword,
    ...(stage === "all" ? {} : { stage }),
    scope: canManageAll ? scope : "mine" as const,
    ...(canManageAll && scope === "all" && assignedUserId !== "all" ? { assignedUserId: Number(assignedUserId) } : {}),
    due,
    page,
    pageSize: PAGE_SIZE,
  }), [assignedUserId, canManageAll, due, keyword, page, scope, stage]);
  const listQuery = useRestoringListQuery(trpc.customerDemand.salesList.useQuery(listInput, freshListOptions({ enabled: Boolean(contextQuery.data) }, d51Ready)));
  const result = listQuery.data;
  const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / PAGE_SIZE));
  useEffect(() => {
    if (result && page > totalPages) setPage(totalPages);
  }, [page, result, totalPages]);

  const customerListQuery = trpc.customer.list.useQuery({
    keyword: customerKeyword,
    scope: canManageAll ? scope : "mine",
    archived: false,
    due: "all",
    page: customerPage,
    pageSize: 10,
  }, { enabled: customerSelectOpen && Boolean(contextQuery.data) });
  const customerPages = Math.max(1, Math.ceil((customerListQuery.data?.total ?? 0) / 10));

  const applyFilters = () => {
    setKeyword(draftKeyword.trim());
    setPage(1);
  };
  const resetFilters = () => {
    setDraftKeyword("");
    setKeyword("");
    setStage("all");
    setAssignedUserId("all");
    setDue("all");
    setPage(1);
  };
  const selectStage = (value: StageFilter) => {
    setStage(value);
    setDue("all");
    setPage(1);
  };
  const openDemand = (row: SalesDemandSummary) => setActiveDemand(row);
  const handleNext = (row: SalesDemandSummary) => {
    if (row.workflowStage === "quote_confirmed") {
      navigate(`/sales-orders?demandNo=${encodeURIComponent(row.demandNo)}`);
      return;
    }
    if (row.workflowStage === "customer_confirmed") {
      navigate(`/sales-orders?keyword=${encodeURIComponent(row.demandNo)}`);
      return;
    }
  };

  const countCards: Array<{ key: StageFilter | "overdue"; label: string; count: number; accent?: boolean }> = [
    { key: "all", label: "全部需求", count: result?.counts.all ?? 0 },
    { key: "inquiring", label: "询价中", count: result?.counts.inquiring ?? 0 },
    { key: "quote_selection", label: "待选择报价", count: result?.counts.quote_selection ?? 0, accent: true },
    { key: "quote_confirmed", label: "报价已确认", count: result?.counts.quote_confirmed ?? 0 },
    { key: "customer_confirmed", label: "客户已确认", count: result?.counts.customer_confirmed ?? 0 },
    { key: "overdue", label: "已逾期", count: result?.counts.overdue ?? 0, accent: true },
  ];

  return (
    <PlatformLayout>
      <div className="space-y-3 text-sm text-slate-700">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">客户需求</h1>
            <p className="mt-0.5 text-xs text-slate-500">集中管理询价、采购报价和客户确认；客户列表仍可快捷录入。</p>
          </div>
          <div className="flex items-center gap-2">
            {canManageAll ? (
              <Select value={scope} onValueChange={value => { setScope(value as ScopeFilter); setAssignedUserId("all"); setPage(1); }}>
                <SelectTrigger aria-label="需求范围" className="h-8 w-[112px] bg-white text-xs"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="mine">我的需求</SelectItem><SelectItem value="all">全企业</SelectItem></SelectContent>
              </Select>
            ) : null}
            <Button type="button" className="h-8 bg-[#185FA5] px-3 text-xs hover:bg-[#0C447C]" onClick={() => setCustomerSelectOpen(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />录入需求
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" aria-label="客户需求阶段统计">
          {countCards.map(card => {
            const selected = card.key === "overdue" ? due === "overdue" : due === "all" && stage === card.key;
            return (
              <button
                key={card.key}
                type="button"
                className={`rounded-lg border bg-white px-3 py-2 text-left shadow-sm transition-colors hover:border-[#185FA5]/40 ${selected ? "border-[#185FA5] ring-1 ring-[#185FA5]/15" : "border-slate-200"}`}
                onClick={() => card.key === "overdue" ? (setDue("overdue"), setStage("all"), setPage(1)) : selectStage(card.key as StageFilter)}
              >
                <span className={`block text-[11px] ${card.accent && card.count > 0 ? "text-amber-700" : "text-slate-500"}`}>{card.label}</span>
                <strong className="mt-0.5 block text-lg font-semibold tabular-nums text-slate-800">{card.count}</strong>
              </button>
            );
          })}
        </div>

        <Card className="border-slate-200 bg-white p-2 shadow-none">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="搜索客户需求"
              className="h-8 w-full bg-white text-xs sm:w-[260px]"
              placeholder="需求号、客户、项目、型号或品牌"
              value={draftKeyword}
              onChange={event => setDraftKeyword(event.target.value)}
              onKeyDown={event => { if (event.key === "Enter") applyFilters(); }}
            />
            <Select value={stage} onValueChange={value => { setStage(value as StageFilter); setDue("all"); setPage(1); }}>
              <SelectTrigger aria-label="按需求阶段筛选" className="h-8 w-[130px] bg-white text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部阶段</SelectItem>
                {CUSTOMER_DEMAND_WORKFLOW_STAGES.map(value => <SelectItem key={value} value={value}>{CUSTOMER_DEMAND_WORKFLOW_LABELS[value]}</SelectItem>)}
              </SelectContent>
            </Select>
            {canManageAll && scope === "all" ? (
              <Select value={assignedUserId} onValueChange={value => { setAssignedUserId(value); setPage(1); }}>
                <SelectTrigger aria-label="按负责人筛选" className="h-8 w-[130px] bg-white text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部负责人</SelectItem>
                  {contextQuery.data?.members.map(member => <SelectItem key={member.userId} value={String(member.userId)}>{member.name}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : null}
            <Button type="button" variant="outline" className={secondaryButtonClass} onClick={applyFilters}><Search className="mr-1 h-3.5 w-3.5" />筛选</Button>
            <Button type="button" variant="outline" className={secondaryButtonClass} onClick={resetFilters}>重置</Button>
          </div>
        </Card>

        {contextQuery.isError || listQuery.isError ? (
          <Card className="border-red-200 bg-red-50 p-6 text-center text-xs text-red-700">
            客户需求加载失败，请稍后重试。
            <Button type="button" variant="link" className="ml-1 h-auto p-0 text-xs" onClick={() => { void contextQuery.refetch(); void listQuery.refetch(); }}>重新加载</Button>
          </Card>
        ) : (
          <Card className="gap-0 overflow-hidden border-slate-200 p-0 shadow-none">
            {listQuery.isPending ? (
              <div className="flex justify-center p-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
            ) : (result?.items.length ?? 0) === 0 ? (
              <div className="p-14 text-center">
                <p className="text-sm font-medium text-slate-600">暂无匹配需求</p>
                <p className="mt-1.5 text-xs text-slate-500">可调整筛选，或选择客户录入新需求。</p>
              </div>
            ) : (
              <div className="min-w-0">
                <Table className="w-full table-fixed" containerClassName="overflow-hidden">
                  <colgroup>
                    <col className="w-[22%]" /><col className="w-[18%]" /><col className="w-[12%]" /><col className="w-[16%]" />
                    <col className="w-[12%]" /><col className="w-[8%]" /><col className="w-[12%]" />
                  </colgroup>
                  <TableHeader><TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                    <TableHead className="h-9 px-3 text-xs whitespace-nowrap">需求 / 客户</TableHead>
                    <TableHead className="h-9 px-3 text-xs whitespace-nowrap">型号摘要</TableHead>
                    <TableHead className="h-9 px-3 text-xs whitespace-nowrap">当前阶段</TableHead>
                    <TableHead className="h-9 px-3 text-xs whitespace-nowrap">采购报价</TableHead>
                    <TableHead className="h-9 px-3 text-xs whitespace-nowrap">下一步</TableHead>
                    <TableHead className="h-9 px-3 text-xs whitespace-nowrap">负责人</TableHead>
                    <TableHead className="h-9 px-3 text-xs whitespace-nowrap">更新时间</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {result?.items.map(row => (
                      <TableRow key={row.id} className="text-xs" data-page-memory-row={String(row.id)}>
                        <TableCell className="min-w-0 px-3 py-2.5 align-top whitespace-normal">
                          <button type="button" className="block w-full truncate text-left font-medium text-[#185FA5] hover:underline" title={row.demandNo} onClick={() => openDemand(row)}>{row.demandNo}</button>
                          <button type="button" className="mt-0.5 block w-full truncate text-left text-[11px] text-slate-500 hover:text-[#185FA5]" title={row.customerName || "—"} onClick={() => navigate(`/customers/${row.customerId}`)}>{row.customerName || "—"}</button>
                        </TableCell>
                        <TableCell className="min-w-0 px-3 py-2.5 align-top whitespace-normal">
                          <div className="truncate font-medium text-slate-700" title={`${row.firstPartNumber || "—"}${row.itemCount > 1 ? ` 等${row.itemCount}项` : ""}`}>{row.firstPartNumber || "—"}{row.itemCount > 1 ? ` 等${row.itemCount}项` : ""}</div>
                          <div className="mt-0.5 text-[11px] tabular-nums text-slate-500">{row.totalQty > 0 ? `${formatQty(row.totalQty)}${row.qtyUnit || ""}` : "数量待补充"}</div>
                        </TableCell>
                        <TableCell className="min-w-0 px-3 py-2.5 align-top whitespace-normal">
                          <span className={`inline-flex max-w-full truncate rounded border px-2 py-0.5 text-[11px] font-medium ${stageClass(row.workflowStage)}`}>{CUSTOMER_DEMAND_WORKFLOW_LABELS[row.workflowStage]}</span>
                          {row.overdue ? <span className="mt-1 flex items-center gap-1 text-[11px] text-red-600"><AlertTriangle className="h-3 w-3" />已逾期</span> : null}
                        </TableCell>
                        <TableCell className="min-w-0 truncate px-3 py-2.5 align-top text-slate-700" title={quoteText(row)}>{quoteText(row)}</TableCell>
                        <TableCell className="min-w-0 truncate px-3 py-2.5 align-top" title={row.nextAction}>
                          {row.workflowStage === "quote_confirmed" || row.workflowStage === "customer_confirmed" ? (
                            <button type="button" className="block w-full truncate text-left font-medium text-[#185FA5] hover:underline" onClick={() => handleNext(row)}>{row.nextAction}</button>
                          ) : (
                            <span className="block truncate text-slate-600">{row.nextAction}</span>
                          )}
                        </TableCell>
                        <TableCell className="min-w-0 truncate px-3 py-2.5 align-top" title={row.assignedName}>{row.assignedName || "—"}</TableCell>
                        <TableCell className="min-w-0 truncate px-3 py-2.5 align-top text-[11px] tabular-nums text-slate-500" title={formatBeijingDateTime(row.activityAt) || "—"}>{formatBeijingDateTime(row.activityAt) || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
              <span>共 {result?.total ?? 0} 条 · 第 {Math.min(page, totalPages)} / {totalPages} 页</span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="h-7 px-2 text-xs" disabled={page <= 1 || listQuery.isFetching} onClick={() => setPage(value => value - 1)}><ChevronLeft className="mr-1 h-3.5 w-3.5" />上一页</Button>
                <Button type="button" variant="outline" className="h-7 px-2 text-xs" disabled={page >= totalPages || listQuery.isFetching} onClick={() => setPage(value => value + 1)}>下一页<ChevronRight className="ml-1 h-3.5 w-3.5" /></Button>
              </div>
            </div>
          </Card>
        )}
      </div>

      {activeDemand ? (
        <CustomerDemandDialog
          customer={{ id: activeDemand.customerId, name: activeDemand.customerName }}
          demandId={activeDemand.id}
          mode="view"
          onClose={() => setActiveDemand(null)}
          onSaved={() => { void utils.customerDemand.salesList.invalidate(); }}
        />
      ) : null}
      {newDemandCustomer ? (
        <CustomerDemandDialog
          customer={newDemandCustomer}
          onClose={() => setNewDemandCustomer(null)}
          onSaved={() => { void utils.customerDemand.salesList.invalidate(); }}
        />
      ) : null}
      <Dialog open={customerSelectOpen} onOpenChange={open => { setCustomerSelectOpen(open); if (!open) setCustomerKeywordDraft(""); }}>
        <DialogContent className="max-w-xl">
          <DialogTitle>选择客户</DialogTitle>
          <DialogDescription>从客户列表选择后录入需求。</DialogDescription>
          <div className="flex gap-2">
            <Input className="h-8 text-xs" placeholder="客户名称、联系人或电话" value={customerKeywordDraft} onChange={event => setCustomerKeywordDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { setCustomerKeyword(customerKeywordDraft.trim()); setCustomerPage(1); } }} />
            <Button type="button" variant="outline" className={secondaryButtonClass} onClick={() => { setCustomerKeyword(customerKeywordDraft.trim()); setCustomerPage(1); }}>搜索</Button>
          </div>
          <div className="min-h-48 overflow-hidden rounded-md border border-slate-200">
            {customerListQuery.isPending ? <div className="flex justify-center p-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div> : null}
            {!customerListQuery.isPending && (customerListQuery.data?.items.length ?? 0) === 0 ? <p className="p-12 text-center text-xs text-slate-500">暂无客户，请先到客户列表录入客户。</p> : null}
            {customerListQuery.data?.items.map(customer => (
              <button key={customer.id} type="button" className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2.5 text-left last:border-b-0 hover:bg-slate-50" onClick={() => { setCustomerSelectOpen(false); setNewDemandCustomer({ id: customer.id, name: customer.name, archivedAt: customer.archivedAt }); }}>
                <span className="min-w-0"><strong className="block truncate text-xs font-medium text-slate-800">{customer.name}</strong><span className="mt-0.5 block truncate text-[11px] text-slate-500">{customer.contactName || "—"} · {customer.phone || "—"}</span></span>
                <span className="ml-3 shrink-0 text-xs text-[#185FA5]">录入</span>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <Button type="button" variant="link" className="h-auto p-0 text-xs text-[#185FA5]" onClick={() => navigate("/customers?create=1")}>录入新客户</Button>
            <div className="flex items-center gap-2"><span>第 {customerPage}/{customerPages} 页</span><Button type="button" variant="outline" className="h-7 px-2 text-xs" disabled={customerPage <= 1} onClick={() => setCustomerPage(value => value - 1)}>上一页</Button><Button type="button" variant="outline" className="h-7 px-2 text-xs" disabled={customerPage >= customerPages} onClick={() => setCustomerPage(value => value + 1)}>下一页</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </PlatformLayout>
  );
}
