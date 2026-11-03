import { useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  History,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import type { DemandQuote } from "../../../../shared/customerDemandQuotes";
import { formatBeijingDateTime } from "../../../../shared/beijingTime";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/dialog";
import { trpc } from "../../../../../api/business-trpc";
import { ConfirmDialog } from "../customers/ConfirmDialog";
import { toast } from "sonner";

export type DemandQuoteListProps = {
  demandId: number;
  audience: "sales" | "procurement";
  onCreate?: () => void;
  onEdit?: (quoteId: number) => void;
};

const PAGE_SIZE = 10;
const HISTORY_PAGE_SIZE = 10;

function newRequestId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now()}_${Math.random().toString(36).slice(2, 16)}`;
}

function parsePositiveInteger(value: string) {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Procurement sees every caller-owned supplier option (including withdrawn history).
 * Sales sees active options and explicitly allocates accepted quantity per material.
 */
export function DemandQuoteList({
  demandId,
  audience,
  onCreate,
  onEdit,
}: DemandQuoteListProps) {
  const [page, setPage] = useState(1);
  const [acceptingQuote, setAcceptingQuote] = useState<DemandQuote | null>(
    null
  );
  const [acceptAlternate, setAcceptAlternate] = useState<
    Record<number, number>
  >({});
  const [acceptQty, setAcceptQty] = useState<Record<number, string>>({});
  const [acceptError, setAcceptError] = useState("");
  const [withdrawingQuote, setWithdrawingQuote] = useState<DemandQuote | null>(
    null
  );
  const [historyQuote, setHistoryQuote] = useState<DemandQuote | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const requestKeysRef = useRef(new Map<string, string>());
  const utils = trpc.useUtils();
  const query = trpc.customerDemand.quoteList.useQuery({
    demandId,
    audience,
    page,
    pageSize: PAGE_SIZE,
  });
  const historyQuery = trpc.customerDemand.quoteHistory.useQuery(
    {
      quoteId: historyQuote?.id ?? 1,
      audience,
      page: historyPage,
      pageSize: HISTORY_PAGE_SIZE,
    },
    { enabled: Boolean(historyQuote) }
  );
  const result = query.data;
  const quotes = result?.items ?? [];
  const currentPage = result?.page ?? page;
  const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / PAGE_SIZE));
  const historyCurrentPage = historyQuery.data?.page ?? historyPage;
  const historyTotalPages = Math.max(
    1,
    Math.ceil((historyQuery.data?.total ?? 0) / HISTORY_PAGE_SIZE)
  );
  const heading = audience === "sales" ? "采购报价" : "我的供应商报价";

  const refreshRelated = () =>
    Promise.allSettled([
      utils.customerDemand.quoteList.invalidate({ demandId }),
      utils.customerDemand.procurementList?.invalidate?.(),
      utils.customerDemand.get?.invalidate?.({ id: demandId }),
      utils.customerDemand.salesList?.invalidate?.(),
      utils.crmSalesOrder?.candidates?.invalidate?.(),
    ]);

  const acceptMutation = trpc.customerDemand.quoteAccept.useMutation({
    onSuccess: result => {
      setAcceptingQuote(null);
      setAcceptQty({});
      setAcceptError("");
      toast.success(
        result.replayed
          ? "该报价已采用"
          : `已采用 ${result.acceptedQty.toLocaleString("zh-CN")} 片`
      );
      void refreshRelated();
    },
    onError: error => {
      setAcceptError(error.message || "采用报价失败，请刷新后重试");
      void query.refetch?.();
      void utils.crmSalesOrder?.candidates?.invalidate?.();
    },
  });
  const withdrawMutation = trpc.customerDemand.quoteWithdraw.useMutation({
    onSuccess: result => {
      setWithdrawingQuote(null);
      toast.success(result.replayed ? "该报价已撤回" : "报价已撤回");
      void refreshRelated();
    },
    onError: error => {
      setWithdrawingQuote(null);
      toast.error(error.message || "撤回报价失败，请刷新后重试");
      void query.refetch?.();
    },
  });

  const openAccept = (quote: DemandQuote) => {
    const initial: Record<number, string> = {};
    const alternates: Record<number, number> = {};
    quote.items.forEach(item => {
      if (alternates[item.demandItemId] != null) return;
      alternates[item.demandItemId] = item.alternateNo ?? 1;
      const available = Math.min(
        item.qty,
        item.availableToAcceptQty ?? item.qty
      );
      initial[item.demandItemId] = available > 0 ? String(available) : "";
    });
    setAcceptAlternate(alternates);
    setAcceptQty(initial);
    setAcceptError("");
    setAcceptingQuote(quote);
  };
  const openHistory = (quote: DemandQuote) => {
    setHistoryPage(1);
    setHistoryQuote(quote);
  };

  const acceptanceItems = useMemo(() => {
    if (!acceptingQuote) return [];
    return acceptingQuote.items.flatMap(item => {
      if ((item.alternateNo ?? 1) !== acceptAlternate[item.demandItemId])
        return [];
      const qty = parsePositiveInteger(acceptQty[item.demandItemId] ?? "");
      return qty == null
        ? []
        : [
            {
              demandItemId: item.demandItemId,
              alternateNo: item.alternateNo ?? 1,
              qty,
            },
          ];
    });
  }, [acceptQty, acceptAlternate, acceptingQuote]);

  const confirmAccept = () => {
    if (!acceptingQuote || acceptMutation.isPending) return;
    for (const item of acceptingQuote.items) {
      if ((item.alternateNo ?? 1) !== acceptAlternate[item.demandItemId])
        continue;
      const raw = acceptQty[item.demandItemId]?.trim() ?? "";
      if (!raw) continue;
      const qty = parsePositiveInteger(raw);
      const available = Math.min(
        item.qty,
        item.availableToAcceptQty ?? item.qty
      );
      if (qty == null) {
        setAcceptError(
          `型号 ${item.partNumber || "未命名物料"} 的采用数量须为正整数`
        );
        return;
      }
      if (qty > available) {
        setAcceptError(
          `型号 ${item.partNumber || "未命名物料"} 最多可采用 ${available.toLocaleString("zh-CN")}${item.qtyUnit}`
        );
        return;
      }
    }
    if (!acceptanceItems.length) {
      setAcceptError("请填写至少一项采用数量");
      return;
    }
    const demandRevision = Number(
      acceptingQuote.currentDemandRevision ?? acceptingQuote.demandRevision ?? 1
    );
    const fingerprint = `${demandId}:${demandRevision}:${acceptingQuote.id}:${acceptingQuote.version}:${JSON.stringify(acceptanceItems)}`;
    if (!requestKeysRef.current.has(fingerprint))
      requestKeysRef.current.set(fingerprint, newRequestId());
    acceptMutation.mutate({
      demandId,
      quoteId: acceptingQuote.id,
      quoteVersion: acceptingQuote.version,
      demandRevision,
      requestId: requestKeysRef.current.get(fingerprint)!,
      note: "",
      items: acceptanceItems,
    });
  };

  return (
    <section className="mt-3 min-w-0" aria-label={heading}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{heading}</h3>
          {audience === "procurement" ? (
            <p className="mt-0.5 text-[11px] text-slate-500">
              每家供应商独立报价；同物料可有多个备选，修改保存完整新轮次，备选不累计采购金额
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {typeof result?.total === "number" && (
            <span className="text-[11px] text-slate-500">
              {result.total} 份
            </span>
          )}
          {audience === "procurement" && onCreate ? (
            <Button
              type="button"
              size="sm"
              className="h-7 bg-[#185FA5] px-2.5 text-[11px] hover:bg-[#0C447C]"
              onClick={onCreate}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              新增供应商报价
            </Button>
          ) : null}
        </div>
      </div>

      {query.isLoading ? (
        <div className="flex items-center gap-2 rounded border border-slate-200 px-3 py-5 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在加载报价…
        </div>
      ) : null}
      {query.error ? (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {query.error.message || "报价加载失败"}
        </p>
      ) : null}
      {!query.isLoading && !query.error && quotes.length === 0 ? (
        <p className="rounded border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-500">
          {audience === "procurement"
            ? "暂无供应商报价，可新增第一份报价"
            : "暂无有效报价"}
        </p>
      ) : null}

      <div className="space-y-2">
        {quotes.map(quote => (
          <QuoteCard
            key={quote.id}
            quote={quote}
            audience={audience}
            onAccept={() => openAccept(quote)}
            onEdit={onEdit ? () => onEdit(quote.id) : undefined}
            onHistory={() => openHistory(quote)}
            onWithdraw={() => setWithdrawingQuote(quote)}
          />
        ))}
      </div>

      {(result?.total ?? 0) > PAGE_SIZE && (
        <div className="mt-2 flex items-center justify-end gap-2 text-[11px] text-slate-500">
          <span>
            第 {currentPage}/{totalPages} 页
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label="报价上一页"
            disabled={currentPage <= 1 || Boolean(query.isFetching)}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label="报价下一页"
            disabled={currentPage >= totalPages || Boolean(query.isFetching)}
            onClick={() => setPage(currentPage + 1)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {acceptingQuote ? (
        <Dialog
          open
          onOpenChange={open => {
            if (!open && !acceptMutation.isPending) setAcceptingQuote(null);
          }}
        >
          <DialogContent
            showCloseButton={false}
            className="flex max-h-[88dvh] w-[calc(100vw-32px)] max-w-[760px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[760px]"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <DialogTitle className="text-base font-semibold text-slate-800">
                  采用报价
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs text-slate-500">
                  {audience === "sales"
                    ? `第${acceptingQuote.version}轮，可只采用部分数量`
                    : `${acceptingQuote.supplierName} · 第${acceptingQuote.version}轮；可只采用部分数量`}
                </DialogDescription>
              </div>
              <button
                type="button"
                aria-label="关闭采用报价"
                disabled={acceptMutation.isPending}
                onClick={() => setAcceptingQuote(null)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="overflow-x-auto rounded border border-slate-200">
                <table className="min-w-[620px] w-full table-fixed text-xs">
                  <thead>
                    <tr className="h-8 bg-slate-50 text-left text-[11px] text-slate-500">
                      <th className="px-2">型号</th>
                      <th className="px-2">选择报价方案</th>
                      <th className="px-2">剩余可采用</th>
                      <th className="px-2">本次采用数量</th>
                    </tr>
                  </thead>
                  <tbody>
                    {acceptingQuote.items
                      .filter(
                        item =>
                          (item.alternateNo ?? 1) ===
                          acceptAlternate[item.demandItemId]
                      )
                      .map(item => {
                        const available = Math.min(
                          item.qty,
                          item.availableToAcceptQty ?? item.qty
                        );
                        return (
                          <tr
                            key={item.demandItemId}
                            className="border-t border-slate-100"
                          >
                            <td className="px-2 py-2 font-medium text-slate-800">
                              {item.partNumber || "—"}
                            </td>
                            <td className="px-2 py-2">
                              <select
                                aria-label={`${item.partNumber}报价方案`}
                                value={item.alternateNo ?? 1}
                                disabled={acceptMutation.isPending}
                                className="h-8 w-full rounded border border-slate-300 bg-white text-xs"
                                onChange={event => {
                                  const alternateNo = Number(
                                    event.target.value
                                  );
                                  const selected = acceptingQuote.items.find(
                                    option =>
                                      option.demandItemId ===
                                        item.demandItemId &&
                                      (option.alternateNo ?? 1) === alternateNo
                                  )!;
                                  setAcceptAlternate(current => ({
                                    ...current,
                                    [item.demandItemId]: alternateNo,
                                  }));
                                  setAcceptQty(current => ({
                                    ...current,
                                    [item.demandItemId]: String(
                                      Math.min(
                                        selected.qty,
                                        selected.availableToAcceptQty ??
                                          selected.qty
                                      )
                                    ),
                                  }));
                                  setAcceptError("");
                                }}
                              >
                                {acceptingQuote.items
                                  .filter(
                                    option =>
                                      option.demandItemId === item.demandItemId
                                  )
                                  .map(option => (
                                    <option
                                      key={option.alternateNo ?? 1}
                                      value={option.alternateNo ?? 1}
                                    >
                                      方案{option.alternateNo ?? 1} ·{" "}
                                      {option.qty}
                                      {option.qtyUnit} · ¥{option.unitPrice} ·{" "}
                                      {option.leadTime}
                                    </option>
                                  ))}
                              </select>
                            </td>
                            <td className="px-2 py-2 tabular-nums text-slate-600">
                              {available.toLocaleString("zh-CN")}
                              {item.qtyUnit}
                            </td>
                            <td className="p-1.5">
                              <input
                                aria-label={`${item.partNumber}采用数量`}
                                inputMode="numeric"
                                value={acceptQty[item.demandItemId] ?? ""}
                                disabled={
                                  available <= 0 || acceptMutation.isPending
                                }
                                onChange={event => {
                                  setAcceptQty(current => ({
                                    ...current,
                                    [item.demandItemId]: event.target.value,
                                  }));
                                  setAcceptError("");
                                }}
                                className="h-8 w-full rounded-md border border-slate-300 px-2 text-xs outline-none focus:border-[#185FA5] focus:ring-1 focus:ring-[#185FA5]/25 disabled:bg-slate-50"
                              />
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                每个需求行只选择一个方案；备选不累计。采用后记录人员、轮次、方案及数量；改价后需重新采用。
              </p>
              {acceptError ? (
                <p
                  role="alert"
                  className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                >
                  {acceptError}
                </p>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 bg-white text-xs"
                disabled={acceptMutation.isPending}
                onClick={() => setAcceptingQuote(null)}
              >
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 bg-[#185FA5] text-xs hover:bg-[#0C447C]"
                disabled={acceptMutation.isPending}
                onClick={confirmAccept}
              >
                {acceptMutation.isPending && (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                )}
                确认采用
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {historyQuote ? (
        <Dialog
          open
          onOpenChange={open => {
            if (!open) setHistoryQuote(null);
          }}
        >
          <DialogContent
            showCloseButton={false}
            className="flex max-h-[88dvh] w-[calc(100vw-32px)] max-w-[820px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[820px]"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <DialogTitle className="text-base font-semibold text-slate-800">
                  报价历史
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs text-slate-500">
                  {audience === "sales"
                    ? `共${historyQuote.version}轮`
                    : `${historyQuote.supplierName} · 共${historyQuote.version}轮`}
                </DialogDescription>
              </div>
              <button
                type="button"
                aria-label="关闭报价历史"
                onClick={() => setHistoryQuote(null)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
              {historyQuery.isLoading ? (
                <p className="flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  正在加载历史…
                </p>
              ) : null}
              {historyQuery.error ? (
                <p role="alert" className="text-xs text-red-600">
                  {historyQuery.error.message || "报价历史加载失败"}
                </p>
              ) : null}
              {(historyQuery.data?.items ?? []).map(round => (
                <article
                  key={round.id}
                  className="rounded border border-slate-200"
                >
                  <div className="flex items-center justify-between bg-slate-50 px-3 py-2 text-[11px]">
                    <strong className="text-slate-700">
                      第{round.version}轮
                    </strong>
                    <span className="text-slate-500">
                      {formatBeijingDateTime(round.createdAt) || "—"}
                    </span>
                  </div>
                  <QuoteItemsTable items={round.items} />
                </article>
              ))}
            </div>
            {(historyQuery.data?.total ?? 0) > HISTORY_PAGE_SIZE ? (
              <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500">
                <span>
                  共 {historyQuery.data?.total ?? 0} 轮 · 第{" "}
                  {historyCurrentPage}/{historyTotalPages} 页
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 bg-white px-2 text-[11px]"
                    aria-label="历史上一页"
                    disabled={
                      historyCurrentPage <= 1 ||
                      Boolean(historyQuery.isFetching)
                    }
                    onClick={() => setHistoryPage(historyCurrentPage - 1)}
                  >
                    <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                    上一页
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 bg-white px-2 text-[11px]"
                    aria-label="历史下一页"
                    disabled={
                      historyCurrentPage >= historyTotalPages ||
                      Boolean(historyQuery.isFetching)
                    }
                    onClick={() => setHistoryPage(historyCurrentPage + 1)}
                  >
                    下一页
                    <ChevronRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      ) : null}

      {withdrawingQuote ? (
        <ConfirmDialog
          title="撤回此报价？"
          description={`撤回“${withdrawingQuote.supplierName}”后，销售将不能继续采用；历史轮次仍会保留。`}
          confirmLabel={withdrawMutation.isPending ? "撤回中…" : "确认撤回"}
          danger
          onCancel={() => {
            if (!withdrawMutation.isPending) setWithdrawingQuote(null);
          }}
          onConfirm={() =>
            withdrawMutation.mutate({
              quoteId: withdrawingQuote.id,
              version: withdrawingQuote.version,
            })
          }
        />
      ) : null}
    </section>
  );
}

function QuoteCard({
  quote,
  audience,
  onAccept,
  onEdit,
  onHistory,
  onWithdraw,
}: {
  quote: DemandQuote;
  audience: "sales" | "procurement";
  onAccept: () => void;
  onEdit?: () => void;
  onHistory: () => void;
  onWithdraw: () => void;
}) {
  const withdrawn = quote.status === "withdrawn";
  const hasAvailable = quote.items.some(
    item => Math.min(item.qty, item.availableToAcceptQty ?? item.qty) > 0
  );
  const statusHint = quote.isAccepted
    ? `${quote.acceptedByName || "销售人员"} · ${formatBeijingDateTime(quote.acceptedAt ?? "") || "已记录"}`
    : withdrawn
      ? "报价已撤回，历史仍保留"
      : quote.needsReconfirmation
        ? "旧版报价不能采用，请采购重新确认"
        : audience === "procurement"
          ? "修改报价将生成下一轮"
          : "";
  return (
    <article
      className={`min-w-0 rounded border ${withdrawn ? "border-slate-200 bg-slate-50/50" : "border-slate-200 bg-white"}`}
      aria-label={`报价 ${quote.id}`}
    >
      <div className="flex flex-col gap-1 border-b border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-600 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 truncate">
          {audience === "sales" ? (
            <span className="font-medium text-slate-700">
              {quote.procurementName || "采购人员"}
            </span>
          ) : (
            <span className="font-medium text-slate-700">
              {quote.supplierName || "未填写供应商"}
            </span>
          )}
          <span className="ml-2 text-slate-500">第{quote.version}轮</span>
          <span className="ml-2 text-slate-400">
            需求 V{quote.demandRevision ?? 1}
          </span>
          {withdrawn ? (
            <span className="ml-2 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-slate-500">
              已撤回
            </span>
          ) : null}
          {quote.needsReconfirmation ? (
            <span className="ml-2 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-800">
              旧版报价 · 待重新确认
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {audience === "sales" && quote.isAccepted ? (
            <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">
              <Check className="h-3 w-3" />
              已采用
            </span>
          ) : null}
          {audience === "sales" && quote.acceptanceStale ? (
            <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-800">
              原采用已失效
            </span>
          ) : null}
          <time className="tabular-nums text-slate-500">
            更新于 {formatBeijingDateTime(quote.updatedAt) || "—"}
          </time>
        </div>
      </div>
      {quote.needsReconfirmation ? (
        <p className="border-b border-amber-100 bg-amber-50/50 px-3 py-2 text-[11px] text-amber-800">
          当前需求已变更为 V{quote.currentDemandRevision ?? "新版本"}
          ，以下保留原报价内容，仅供参考，待采购重新确认。
        </p>
      ) : null}
      <QuoteItemsTable items={quote.items} />
      {quote.note ? (
        <p className="border-t border-slate-100 px-3 py-2 text-[11px] leading-5 text-slate-600">
          <span className="font-medium text-slate-700">报价说明：</span>
          {quote.note}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
        {statusHint ? (
          <p className="min-w-0 text-[11px] text-slate-500">{statusHint}</p>
        ) : (
          <span />
        )}
        <div className="flex items-center divide-x divide-slate-200">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 rounded-none px-2 text-[11px] text-slate-600"
            onClick={onHistory}
          >
            <History className="mr-1 h-3.5 w-3.5" />
            历史（{quote.version}）
          </Button>
          {audience === "procurement" && !withdrawn && onEdit ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 rounded-none px-2 text-[11px] text-[#185FA5]"
              onClick={onEdit}
            >
              {quote.needsReconfirmation ? "重新确认" : "新一轮"}
            </Button>
          ) : null}
          {audience === "procurement" && !withdrawn ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 rounded-none px-2 text-[11px] text-red-600"
              onClick={onWithdraw}
            >
              撤回
            </Button>
          ) : null}
          {audience === "sales" &&
          !quote.isAccepted &&
          !quote.needsReconfirmation &&
          hasAvailable ? (
            <Button
              type="button"
              size="sm"
              className="h-7 rounded-none bg-[#185FA5] px-2.5 text-[11px] hover:bg-[#0C447C]"
              onClick={onAccept}
            >
              采用报价
            </Button>
          ) : null}
          {audience === "sales" &&
          !quote.isAccepted &&
          !quote.needsReconfirmation &&
          !hasAvailable ? (
            <span className="px-2 text-[11px] text-slate-400">
              需求数量已满足
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/** Group only by immutable demand row ID, never by repeated part number or brand. */
function QuoteItemsTable({ items }: { items: DemandQuote["items"] }) {
  const groups = new Map<number, DemandQuote["items"]>();
  items.forEach(item =>
    groups.set(item.demandItemId, [
      ...(groups.get(item.demandItemId) ?? []),
      item,
    ])
  );
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[760px] w-full text-[11px]">
        <thead>
          <tr className="h-7 text-left text-slate-500">
            <th className="px-2">型号 / 品牌 / 封装</th>
            <th className="px-2">方案</th>
            <th className="px-2">报价数量</th>
            <th className="px-2">含税单价（元）</th>
            <th className="px-2">交期 / 备注</th>
            <th className="px-2">采用数量</th>
          </tr>
        </thead>
        <tbody>
          {Array.from(groups.entries()).flatMap(([id, options]) =>
            options.map((item, index) => (
              <tr
                key={`${id}:${item.alternateNo ?? 1}`}
                className="border-t border-slate-100 align-top text-slate-700"
              >
                {index === 0 && (
                  <td
                    rowSpan={options.length}
                    className="px-2 py-1.5 font-medium"
                  >
                    {item.partNumber || "—"}
                    <div className="font-normal text-slate-500">
                      {item.brand || "—"} · {item.pkg || "—"}
                    </div>
                  </td>
                )}
                <td className="px-2 py-1.5">方案{item.alternateNo ?? 1}</td>
                <td className="px-2 py-1.5 tabular-nums">
                  {item.qty.toLocaleString("zh-CN")}
                  {item.qtyUnit}
                </td>
                <td className="px-2 py-1.5 tabular-nums">{item.unitPrice}</td>
                <td className="px-2 py-1.5">
                  {item.leadTime}
                  {item.note && (
                    <div className="text-slate-500">{item.note}</div>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {item.acceptedQty
                    ? `${item.acceptedQty.toLocaleString("zh-CN")}${item.qtyUnit}`
                    : "—"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default DemandQuoteList;
