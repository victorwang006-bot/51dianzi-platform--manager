import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";
import { CUSTOMER_DEMAND_STATUS_LABELS, type CustomerDemandStatus, type CustomerDemandSummary } from "../../../../shared/customerDemands";
import { formatBeijingDateTime } from "../../../../shared/beijingTime";
import { trpc } from "../../../../../api/business-trpc";
import { usePageIdentity } from "../../hooks/usePageIdentity";
import { Button } from "../ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { CustomerDemandDialog } from "./CustomerDemandDialog";
import type { CustomerDemandOrderIntent, CustomerDemandOpenIntent, CustomerDemandCustomer } from "./customerDemandWorkbench";
export type { CustomerDemandOrderIntent, CustomerDemandOpenIntent } from "./customerDemandWorkbench";
import { demandFreshReadOptions, useDemandServerRead } from "./useDemandReadSession";

export type CustomerDemandHistoryProps = {
  customer: CustomerDemandCustomer;
  contextIdentityKey?: string | number | null;
  canRead?: boolean;
  readOnly?: boolean;
  canManageOrders?: boolean;
  /** A nonzero token opens create once, including when the tab first mounts. */
  createRequestToken?: string | number;
  initialDemandIntent?: CustomerDemandOpenIntent | null;
  onDemandIntentHandled?: (token: string | number) => void;
  onCreateOrder?: (intent: CustomerDemandOrderIntent) => void;
  onViewOrders?: (intent: CustomerDemandOrderIntent) => void;
  onDirtyChange?: (dirty: boolean) => void;
};
const PAGE_SIZE = 20;
const HEADER_CELL = "h-8 border-r border-slate-200/70 px-2 text-[11px] font-medium text-slate-500";
const BODY_CELL = "px-2 py-2 text-xs text-slate-600";

function statusClass(status: CustomerDemandStatus) {
  if (status === "processing") return "border-blue-200 bg-blue-50 text-[#185FA5]";
  if (status === "submitted") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function demandStatus(demand: CustomerDemandSummary) {
  if (demand.hasActiveOrders || (demand.activeOrderCount ?? 0) > 0 || demand.workflowStage === "customer_confirmed") return { label: "已关联订单", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  if ((demand.acceptedQuoteCount ?? 0) > 0) return { label: "报价已确认", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  if ((demand.currentQuoteCount ?? 0) > 0) return { label: "已报价", className: "border-blue-200 bg-blue-50 text-[#185FA5]" };
  return { label: CUSTOMER_DEMAND_STATUS_LABELS[demand.status], className: statusClass(demand.status) };
}

/** Customer/account changes unmount queries, dialogs, drafts and pending callbacks synchronously. */
export function CustomerDemandHistory(props: CustomerDemandHistoryProps) {
  const identity = usePageIdentity();
  const sessionKey = JSON.stringify([identity, props.contextIdentityKey, props.customer.id, props.canRead !== false, Boolean(props.readOnly || props.customer.archivedAt)]);
  if (props.canRead === false) return <section className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">当前账号无权查看客户需求。</section>;
  return <CustomerDemandHistorySession key={sessionKey} {...props} />;
}

function CustomerDemandHistorySession({ customer, readOnly = false, contextIdentityKey, canManageOrders, createRequestToken, initialDemandIntent, onDemandIntentHandled, onCreateOrder, onViewOrders, onDirtyChange }: CustomerDemandHistoryProps) {
  const [page, setPage] = useState(1);
  const [opened, setOpened] = useState<{ id?: number; mode: "view" | "edit"; section?: "materials" | "quotes"; quoteConfirm?: boolean } | null>(null);
  const handledCreateRef = useRef<string | number | undefined>(undefined);
  const handledIntentRef = useRef<string | number | undefined>(undefined);
  const utils = trpc.useUtils();
  const listQuery = trpc.customerDemand.list.useQuery({ customerId: customer.id, page, pageSize: PAGE_SIZE }, demandFreshReadOptions);
  const wrongCustomer = Boolean(listQuery.data?.items.some(demand => demand.customerId !== customer.id));
  const listRead = useDemandServerRead(listQuery, `${customer.id}:${page}`, wrongCustomer);
  const result = listRead.data;
  const items = result?.items ?? [];
  const currentPage = result?.page ?? page;
  const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / PAGE_SIZE));
  const archived = Boolean(customer.archivedAt);
  const immutable = archived || readOnly;
  const refresh = () => { void utils.customerDemand.list.invalidate({ customerId: customer.id }).catch(() => undefined); };

  useEffect(() => {
    if (result && page > totalPages) setPage(totalPages);
  }, [result, page, totalPages]);

  useEffect(() => {
    // Never replace an open form: a shell intent waits until the user closes it.
    if (opened) return;
    if (initialDemandIntent && handledIntentRef.current !== initialDemandIntent.token) {
      handledIntentRef.current = initialDemandIntent.token;
      if (Number.isSafeInteger(initialDemandIntent.demandId) && initialDemandIntent.demandId > 0) {
        setOpened({ id: initialDemandIntent.demandId, mode: immutable ? "view" : initialDemandIntent.mode ?? "view", section: initialDemandIntent.section });
      }
      onDemandIntentHandled?.(initialDemandIntent.token);
      return;
    }
    if (createRequestToken != null && createRequestToken !== 0 && createRequestToken !== "" && handledCreateRef.current !== createRequestToken) {
      handledCreateRef.current = createRequestToken;
      if (!immutable) setOpened({ mode: "edit" });
    }
  }, [createRequestToken, initialDemandIntent, immutable, opened, onDemandIntentHandled]);

  return <section className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white" aria-labelledby="customer-demand-history-title">
    <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-2"><h2 id="customer-demand-history-title" className="text-sm font-semibold text-slate-800">需求与采购报价</h2>{result && <span className="text-[11px] text-slate-500">共 {result.total} 条</span>}{immutable && <span className="text-[11px] text-slate-500">只读</span>}</div>
      <Button type="button" size="sm" disabled={immutable} title={immutable ? "当前客户需求只读" : undefined} onClick={() => setOpened({ mode: "edit" })} className="h-8 bg-[#185FA5] px-3 text-xs hover:bg-[#0C447C]"><Plus className="mr-1 h-3.5 w-3.5" />新增需求</Button>
    </div>
    {listRead.waiting ? <div className="flex items-center justify-center gap-2 py-4 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />正在加载需求…</div> : listRead.failed ? <div role="alert" className="p-3 text-xs text-red-600">{wrongCustomer ? "需求上下文不一致，请刷新客户工作台。" : listQuery.error?.message || "需求记录加载失败"}<button type="button" className="ml-2 text-[#185FA5]" onClick={() => void listQuery.refetch()}>重试</button></div> : items.length === 0 ? <div className="px-3 py-4 text-center text-xs text-slate-500">暂无需求记录{!immutable ? "，可新增需求并提交采购。" : "。"}</div> : (
      <Table className="w-full min-w-[860px] table-fixed text-xs" containerClassName="customer-demand-table-scroll overflow-x-auto" aria-label="客户需求列表">
        <colgroup><col className="w-[20%]" /><col className="w-[17%]" /><col className="w-[8%]" /><col className="w-[13%]" /><col className="w-[9%]" /><col className="w-[15%]" /><col className="w-[18%]" /></colgroup>
        <TableHeader><TableRow className="border-slate-200 bg-slate-50 hover:bg-slate-50">
          <TableHead scope="col" className={`${HEADER_CELL} text-left`}>需求单号</TableHead>
          <TableHead scope="col" className={`${HEADER_CELL} text-left`}>项目名称</TableHead>
          <TableHead scope="col" className={`${HEADER_CELL} text-center`}>物料项数</TableHead>
          <TableHead scope="col" className={`${HEADER_CELL} text-center`}>需求状态</TableHead>
          <TableHead scope="col" className={`${HEADER_CELL} text-center`} title="服务端返回的采购报价份数，不是报价轮次">采购报价数</TableHead>
          <TableHead scope="col" className={`${HEADER_CELL} text-left`}>更新时间</TableHead>
          <TableHead scope="col" className="sticky right-0 z-10 h-8 bg-slate-50 px-2 text-right text-[11px] font-medium text-slate-500 shadow-[-1px_0_0_#e2e8f0]">操作</TableHead>
        </TableRow></TableHeader>
        <TableBody>{items.map(demand => {
          // Old list DTOs omit canEdit; opening edit is safe because the detail must explicitly grant it before save.
          const editable = !immutable && demand.canEdit !== false;
          const displayStatus = demandStatus(demand);
          // Missing legacy metadata fails closed. Total historical quoteCount is never confirmation authority.
          const confirmable = editable && demand.status !== "draft" && (demand.confirmableQuoteCount ?? 0) > 0;
          return <TableRow key={demand.id} className="group border-slate-100 hover:bg-slate-50/60">
            <TableCell className={`${BODY_CELL} text-left`}><div className="flex items-center gap-1.5 whitespace-nowrap"><button type="button" onClick={() => setOpened({ id: demand.id, mode: "view" })} className="text-xs font-medium text-[#185FA5]">{demand.demandNo}</button><span className="text-[10px] text-slate-400">V{demand.revision ?? 1}</span></div></TableCell>
            <TableCell className={`${BODY_CELL} text-left`}><span className="block truncate" title={demand.projectName || undefined}>{demand.projectName || "—"}</span></TableCell>
            <TableCell className={`${BODY_CELL} text-center tabular-nums`}>{demand.itemCount}</TableCell>
            <TableCell className={`${BODY_CELL} text-center`}><span className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] ${displayStatus.className}`}>{displayStatus.label}</span></TableCell>
            <TableCell className={`${BODY_CELL} text-center tabular-nums`} title={demand.currentQuoteCount == null ? undefined : `当前有效 ${demand.currentQuoteCount} 份 · 已采用 ${demand.acceptedQuoteCount ?? 0} 份`}>{demand.quoteCount == null ? "—" : `${demand.quoteCount} 份`}</TableCell>
            <TableCell className="whitespace-nowrap px-2 py-2 text-left text-[11px] tabular-nums text-slate-500">{formatBeijingDateTime(demand.updatedAt || demand.createdAt) || "—"}</TableCell>
            <TableCell className="sticky right-0 z-10 bg-white px-2 py-2 text-right shadow-[-1px_0_0_#e2e8f0] group-hover:bg-slate-50"><div className="inline-flex items-center gap-2 whitespace-nowrap">
              <button type="button" className="h-7 text-xs text-[#185FA5]" title="查看物料明细及关联采购报价" onClick={() => setOpened({ id: demand.id, mode: "view", section: "materials" })}>查看报价</button>
              <button type="button" disabled={!confirmable} className="h-7 text-xs text-[#185FA5] disabled:cursor-not-allowed disabled:text-slate-400" title={immutable ? "当前客户需求只读" : !editable ? "当前需求无报价采用权限" : !confirmable ? "暂无当前有效且有剩余数量的可确认报价" : "选择一份当前报价，核对版本、方案与数量后采用；不生成销售订单"} onClick={() => { if (confirmable) setOpened({ id: demand.id, mode: "view", section: "quotes", quoteConfirm: true }); }}>确认报价</button>
              <button type="button" disabled={!editable} title={immutable ? "当前客户需求只读" : !editable ? "当前需求不可编辑" : demand.hasActiveOrders ? "已成单物料锁定，其他允许的内容可编辑" : undefined} className="h-7 text-xs text-[#185FA5] disabled:cursor-not-allowed disabled:text-slate-400" onClick={() => setOpened({ id: demand.id, mode: "edit" })}>编辑</button>
            </div></TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>
    )}
    {(result?.total ?? 0) > PAGE_SIZE && <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-3 py-2 text-xs text-slate-500"><span>第 {currentPage}/{totalPages} 页，共 {result?.total} 条</span><Button type="button" size="icon" variant="outline" className="h-7 w-7" disabled={currentPage <= 1 || listQuery.isFetching} onClick={() => setPage(currentPage - 1)} aria-label="上一页"><ChevronLeft className="h-3.5 w-3.5" /></Button><Button type="button" size="icon" variant="outline" className="h-7 w-7" disabled={currentPage >= totalPages || listQuery.isFetching} onClick={() => setPage(currentPage + 1)} aria-label="下一页"><ChevronRight className="h-3.5 w-3.5" /></Button></div>}
    {opened && <CustomerDemandDialog customer={customer} contextIdentityKey={contextIdentityKey} demandId={opened.id} mode={opened.mode} initialSection={opened.section} initialQuoteConfirm={opened.quoteConfirm} readOnly={immutable} canManageOrders={canManageOrders} onCreateOrder={onCreateOrder} onViewOrders={onViewOrders} onDirtyChange={onDirtyChange} onClose={() => setOpened(null)} onSaved={refresh} />}
  </section>;
}
export default CustomerDemandHistory;
