import { useState } from "react";
import type { DemandQuoteItem } from "../../../../shared/customerDemandQuotes";
import { formatBeijingDateTime } from "../../../../shared/beijingTime";
import { trpc } from "../../../../../api/business-trpc";
import { Button } from "../ui/button";
import { usePageIdentity } from "../../hooks/usePageIdentity";
import { demandFreshReadOptions, useDemandServerRead } from "./useDemandReadSession";

const PAGE_SIZE = 10;
type ReadOnlyQuotesProps = { demandId: number; customerId?: number; contextIdentityKey?: string | number | null };

/** Archived/read-only branches never mount any quote mutation. */
export function ReadOnlyDemandQuotes(props: ReadOnlyQuotesProps) {
  const identity = usePageIdentity();
  return <ReadOnlyDemandQuotesSession key={JSON.stringify([identity, props.contextIdentityKey, props.customerId, props.demandId])} {...props} />;
}

function ReadOnlyDemandQuotesSession({ demandId }: ReadOnlyQuotesProps) {
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState<{ quoteId: number; page: number } | null>(null);
  const query = trpc.customerDemand.quoteList.useQuery({ demandId, audience: "sales", page, pageSize: PAGE_SIZE }, demandFreshReadOptions);
  const historyQuery = trpc.customerDemand.quoteHistory.useQuery({ quoteId: history?.quoteId ?? 1, audience: "sales", page: history?.page ?? 1, pageSize: PAGE_SIZE }, { ...demandFreshReadOptions, enabled: Boolean(history) });
  const invalid = query.data?.items.some(quote => quote.demandId !== demandId);
  const quoteRead = useDemandServerRead(query, `${demandId}:${page}`, invalid);
  const result = quoteRead.data;
  const invalidHistory = history && historyQuery.data?.items.some(round => round.quoteId !== history.quoteId);
  const historyRead = useDemandServerRead(historyQuery, `${history?.quoteId}:${history?.page}`, Boolean(invalidHistory));
  const historyResult = result ? historyRead.data : undefined;
  return <section aria-label="采购报价（只读）" className="min-w-0">
    <div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-slate-800">采购报价（只读）</h3>{result && <span className="text-[11px] text-slate-500">{result.total} 份</span>}</div>
    {quoteRead.waiting ? <p className="py-3 text-xs text-slate-500">正在加载采购报价…</p> : quoteRead.failed ? <p role="alert" className="text-xs text-red-600">{invalid ? "报价上下文不一致" : query.error?.message || "报价加载失败"}</p> : result?.items.length === 0 ? <p className="rounded border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">暂无有效采购报价。</p> : null}
    <div className="space-y-2">{result?.items.map(quote => <article key={quote.id} className="min-w-0 rounded border border-slate-200" aria-label={`只读报价 ${quote.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-600"><span>{quote.procurementName || "采购人员"} · 第{quote.version}轮 · 需求 V{quote.demandRevision ?? 1}{quote.isAccepted ? " · 销售已采用" : ""}{quote.acceptanceStale ? " · 原采用已失效" : ""}{quote.needsReconfirmation ? " · 旧版报价，待采购重新确认" : ""}</span><span>{formatBeijingDateTime(quote.updatedAt) || "—"}</span></div>
      <Items items={quote.items} />
      {quote.note && <p className="px-3 py-2 text-[11px] text-slate-500">{quote.note}</p>}
      <div className="border-t border-slate-100 px-3 py-1"><Button type="button" size="sm" variant="ghost" className="h-7 px-0 text-xs text-[#185FA5]" onClick={() => setHistory({ quoteId: quote.id, page: 1 })}>历史轮次（{quote.version}）</Button></div>
    </article>)}</div>
    {result && result.total > PAGE_SIZE && <Pager page={result.page} total={result.total} busy={query.isFetching} onPage={setPage} label="只读报价" />}
    {history && result && <section className="mt-3 rounded border border-slate-200 p-3" aria-label="采购报价历史轮次">
      <div className="mb-2 flex justify-between"><h4 className="text-xs font-medium text-slate-700">采购报价历史轮次</h4><button type="button" className="text-xs text-[#185FA5]" onClick={() => setHistory(null)}>收起历史</button></div>
      {historyRead.waiting && <p className="text-xs text-slate-500">正在加载历史…</p>}
      {historyQuery.error && <p role="alert" className="text-xs text-red-600">{historyQuery.error.message}</p>}
      {invalidHistory && <p role="alert" className="text-xs text-red-600">报价历史上下文不一致，请收起后重新打开。</p>}
      {historyResult?.items.map(round => <article className="mb-2 rounded border border-slate-200" key={round.id}><div className="bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600">第{round.version}轮 · 需求 V{round.demandRevision} · {formatBeijingDateTime(round.createdAt) || "—"}</div><Items items={round.items} /></article>)}
      {historyResult && historyResult.total > PAGE_SIZE && <Pager page={historyResult.page} total={historyResult.total} busy={historyQuery.isFetching} onPage={next => setHistory({ ...history, page: next })} label="报价历史" />}
    </section>}
  </section>;
}

function Pager({ page, total, busy, onPage, label }: { page: number; total: number; busy: boolean; onPage: (page: number) => void; label: string }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return <div className="mt-2 flex items-center justify-end gap-2 text-[11px] text-slate-500"><span>第 {page}/{pages} 页 · 共 {total} 条</span><button type="button" aria-label={`${label}上一页`} disabled={busy || page <= 1} onClick={() => onPage(page - 1)}>上一页</button><button type="button" aria-label={`${label}下一页`} disabled={busy || page >= pages} onClick={() => onPage(page + 1)}>下一页</button></div>;
}

function Items({ items }: { items: DemandQuoteItem[] }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-[11px]"><thead><tr className="h-7 text-left text-slate-500"><th className="px-2">型号 / 品牌 / 封装</th><th className="px-2">方案</th><th className="px-2">报价数量</th><th className="px-2">采购含税单价（元）</th><th className="px-2">交期 / 备注</th><th className="px-2">销售采用数量</th></tr></thead><tbody>{items.map(item => <tr key={`${item.demandItemId}:${item.alternateNo ?? 1}`} className="border-t border-slate-100 text-slate-700"><td className="px-2 py-1.5">{item.partNumber || "—"}<div className="text-slate-500">{item.brand || "—"} · {item.pkg || "—"}</div></td><td className="px-2">方案{item.alternateNo ?? 1}</td><td className="px-2 tabular-nums">{item.qty.toLocaleString("zh-CN")}{item.qtyUnit}</td><td className="px-2 tabular-nums">{item.unitPrice}</td><td className="px-2">{item.leadTime}<div className="text-slate-500">{item.note}</div></td><td className="px-2 tabular-nums">{item.acceptedQty ? `${item.acceptedQty.toLocaleString("zh-CN")}${item.qtyUnit}` : "—"}</td></tr>)}</tbody></table></div>;
}
