import { useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";
import { CUSTOMER_DEMAND_STATUS_LABELS, type CustomerDemandStatus } from "../../../../shared/customerDemands";
import { formatBeijingDateTime } from "../../../../shared/beijingTime";
import { trpc } from "../../../../../api/business-trpc";
import { Button } from "../ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { CustomerDemandDialog } from "./CustomerDemandDialog";

type CustomerLink = { id: number; name: string; archivedAt?: string | null };
export type CustomerDemandHistoryProps = { customer: CustomerLink };
const PAGE_SIZE = 20;
const HEADER_CELL = "h-8 border-r border-slate-200/70 px-2 text-[11px] font-medium text-slate-500";
const BODY_CELL = "px-2 py-2 text-xs text-slate-600";

function statusClass(status: CustomerDemandStatus) {
  if (status === "processing") return "border-blue-200 bg-blue-50 text-[#185FA5]";
  if (status === "submitted") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function CustomerDemandHistory({ customer }: CustomerDemandHistoryProps) {
  const [page, setPage] = useState(1);
  const [opened, setOpened] = useState<{ id?: number; mode: "view" | "edit" } | null>(null);
  const utils = trpc.useUtils();
  const listQuery = trpc.customerDemand.list.useQuery({ customerId: customer.id, page, pageSize: PAGE_SIZE });
  const result = listQuery.data;
  const items = result?.items ?? [];
  const currentPage = result?.page ?? page;
  const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / PAGE_SIZE));
  const archived = Boolean(customer.archivedAt);
  const refresh = () => { void utils.customerDemand.list.invalidate({ customerId: customer.id }).catch(() => undefined); };

  return <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" aria-labelledby="customer-demand-history-title">
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
      <div className="flex items-baseline gap-2"><h2 id="customer-demand-history-title" className="text-sm font-semibold text-slate-800">客户需求</h2><span className="text-[11px] text-slate-500">共 {result?.total ?? 0} 条 · 内部采购需求</span></div>
      <Button type="button" size="sm" disabled={archived} title={archived ? "已归档客户不能录入需求" : undefined} onClick={() => setOpened({ mode: "edit" })} className="h-8 bg-[#185FA5] px-3 text-xs hover:bg-[#0C447C]"><Plus className="mr-1 h-3.5 w-3.5" />需求录入</Button>
    </div>
    {listQuery.isLoading ? <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />正在加载需求…</div> : listQuery.error ? <div role="alert" className="p-3 text-xs text-red-600">{listQuery.error.message || "需求记录加载失败"}</div> : items.length === 0 ? <div className="p-6 text-center text-xs text-slate-500">暂无客户需求记录</div> : (
      <Table className="w-full min-w-[920px] table-fixed text-xs" containerClassName="customer-demand-table-scroll" aria-label="客户需求列表">
        <colgroup>
          <col className="w-[22%]" />
          <col className="w-[24%]" />
          <col className="w-[8%]" />
          <col className="w-[12%]" />
          <col className="w-[7%]" />
          <col className="w-[17%]" />
          <col className="w-[10%]" />
        </colgroup>
        <TableHeader>
          <TableRow className="border-slate-200 bg-slate-50 hover:bg-slate-50">
            <TableHead scope="col" className={HEADER_CELL}>需求单号</TableHead>
            <TableHead scope="col" className={HEADER_CELL}>项目名称</TableHead>
            <TableHead scope="col" className={`${HEADER_CELL} text-center`}>物料项数</TableHead>
            <TableHead scope="col" className={HEADER_CELL}>状态</TableHead>
            <TableHead scope="col" className={`${HEADER_CELL} text-center`}>报价数</TableHead>
            <TableHead scope="col" className={HEADER_CELL}>更新时间</TableHead>
            <TableHead scope="col" className="sticky right-0 z-10 h-8 bg-slate-50 px-2 text-right text-[11px] font-medium text-slate-500 shadow-[-1px_0_0_#e2e8f0]">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map(demand => {
            const editable = !archived && demand.canEdit !== false;
            return <TableRow key={demand.id} className="group border-slate-100 hover:bg-slate-50/60">
              <TableCell className={BODY_CELL}>
                <div className="flex items-center gap-1.5 whitespace-nowrap">
                  <button type="button" onClick={() => setOpened({ id: demand.id, mode: "view" })} className="text-xs font-medium text-[#185FA5]">{demand.demandNo}</button>
                  <span className="text-[10px] text-slate-400">V{demand.revision ?? 1}</span>
                </div>
              </TableCell>
              <TableCell className={BODY_CELL}><span className="block truncate" title={demand.projectName || undefined}>{demand.projectName || "—"}</span></TableCell>
              <TableCell className={`${BODY_CELL} text-center tabular-nums`}>{demand.itemCount}</TableCell>
              <TableCell className={BODY_CELL}><span className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] ${statusClass(demand.status)}`}>{CUSTOMER_DEMAND_STATUS_LABELS[demand.status]}</span>{demand.hasActiveOrders && <span className="mt-0.5 block text-[10px] text-slate-400">已关联订单</span>}</TableCell>
              <TableCell className={`${BODY_CELL} text-center tabular-nums`}>{demand.quoteCount ?? 0}</TableCell>
              <TableCell className="whitespace-nowrap px-2 py-2 text-[11px] tabular-nums text-slate-500">{formatBeijingDateTime(demand.updatedAt || demand.createdAt) || "—"}</TableCell>
              <TableCell className="sticky right-0 z-10 bg-white px-2 py-2 text-right shadow-[-1px_0_0_#e2e8f0] group-hover:bg-slate-50">
                <div className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <button type="button" className="h-7 text-xs text-[#185FA5]" onClick={() => setOpened({ id: demand.id, mode: "view" })}>查看</button>
                  <span className="text-slate-200" aria-hidden="true">|</span>
                  <button type="button" disabled={!editable} title={archived ? "已归档客户不可编辑需求" : !editable ? "当前需求不可编辑" : demand.hasActiveOrders ? "已成单物料锁定，其他允许的内容可编辑" : undefined} className="h-7 text-xs text-[#185FA5] disabled:cursor-not-allowed disabled:text-slate-400" onClick={() => setOpened({ id: demand.id, mode: "edit" })}>编辑</button>
                </div>
              </TableCell>
            </TableRow>;
          })}
        </TableBody>
      </Table>
    )}
    {(result?.total ?? 0) > PAGE_SIZE && <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-3 py-2 text-xs text-slate-500"><span>第 {currentPage}/{totalPages} 页，共 {result?.total} 条</span><Button type="button" size="icon" variant="outline" className="h-7 w-7" disabled={currentPage <= 1 || listQuery.isFetching} onClick={() => setPage(currentPage - 1)} aria-label="上一页"><ChevronLeft className="h-3.5 w-3.5" /></Button><Button type="button" size="icon" variant="outline" className="h-7 w-7" disabled={currentPage >= totalPages || listQuery.isFetching} onClick={() => setPage(currentPage + 1)} aria-label="下一页"><ChevronRight className="h-3.5 w-3.5" /></Button></div>}
    {opened && <CustomerDemandDialog customer={customer} demandId={opened.id} mode={opened.mode} onClose={() => setOpened(null)} onSaved={refresh} />}
  </section>;
}
export default CustomerDemandHistory;
