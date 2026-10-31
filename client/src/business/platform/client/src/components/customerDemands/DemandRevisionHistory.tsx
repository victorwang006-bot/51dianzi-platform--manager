import { useState } from "react";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { trpc } from "../../../../../api/business-trpc";
import { formatBeijingDateTime } from "../../../../shared/beijingTime";
export function DemandRevisionHistory({ demandId }: { demandId: number }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const history = trpc.customerDemand.revisionHistory.useQuery({ id: demandId, page, pageSize: 5 }, { enabled: open });
  return <section className="mt-3 border-t border-slate-200 pt-3" aria-label="需求版本记录">
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} className="flex h-7 items-center gap-1.5 text-xs font-medium text-slate-600"><History className="h-3.5 w-3.5" />变更记录{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button>
    {open && <div className="mt-2 overflow-hidden rounded border border-slate-200 bg-white text-xs">
      {history.isLoading ? <p className="p-3 text-slate-500">正在加载变更记录…</p> : history.error ? <p role="alert" className="p-3 text-red-600">{history.error.message}</p> : !history.data?.items.length ? <p className="p-3 text-slate-500">暂无已保存的变更记录；首次变更时将保留当前版本。</p> : history.data.items.map(record => <article key={record.id} className="border-b border-slate-100 last:border-b-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"><span className="font-medium text-slate-700">V{record.revision}</span><span className="text-slate-500">{record.actorName}</span><time className="text-slate-500">{formatBeijingDateTime(record.createdAt)}</time><button type="button" className="ml-auto text-[#185FA5]" onClick={() => setExpandedId(value => value === record.id ? null : record.id)}>{expandedId === record.id ? "收起快照" : "查看快照"}</button><p className="w-full break-words leading-5 text-slate-600">{record.changeReason || "保存需求版本"}</p></div>
        {expandedId === record.id && <div className="border-t border-slate-100 bg-slate-50/50 px-3 py-2"><p className="mb-2 text-slate-600">项目：{record.snapshot.projectName || "—"} · 优先级：{record.snapshot.priority === "urgent" ? "紧急" : "普通"} · 回复时间：{formatBeijingDateTime(record.snapshot.replyDueAt) || "—"}</p><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-xs"><thead><tr className="h-7 text-left text-[11px] text-slate-500"><th className="pr-3">型号</th><th className="pr-3">品牌 / 封装</th><th className="pr-3">数量</th><th className="pr-3">要求交期</th><th>备注</th></tr></thead><tbody>{record.snapshot.items.map((item, index) => <tr key={`${item.id ?? index}`} className="border-t border-slate-100"><td className="py-1.5 pr-3">{item.partNumber || "—"}</td><td className="pr-3">{item.brand || "—"} / {item.pkg || "—"}</td><td className="pr-3 tabular-nums">{item.qty ?? "—"} {item.qtyUnit}</td><td className="pr-3">{item.deliveryRequirement || "—"}</td><td>{item.note || "—"}</td></tr>)}</tbody></table></div>{record.snapshot.note && <p className="mt-2 whitespace-pre-wrap leading-5 text-slate-600">需求说明：{record.snapshot.note}</p>}</div>}
      </article>)}
      {history.data && history.data.total > 5 && <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-3 py-2 text-slate-500"><button type="button" disabled={page <= 1 || history.isFetching} onClick={() => { setPage(value => value - 1); setExpandedId(null); }} className="disabled:opacity-40">上一页</button><span>第 {page} 页</span><button type="button" disabled={page * 5 >= history.data.total || history.isFetching} onClick={() => { setPage(value => value + 1); setExpandedId(null); }} className="disabled:opacity-40">下一页</button></div>}
    </div>}
  </section>;
}
