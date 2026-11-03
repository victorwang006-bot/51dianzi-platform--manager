import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MessageSquareText,
  Reply,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "../../../../api/business-trpc";
import { classifyBusinessFailure } from "../../../../BusinessWorkbenchSession";
import { formatBeijingDateTime } from "../../../shared/beijingTime";

const PAGE_SIZE = 10;

function pageWindow(current: number, total: number) {
  const start = Math.max(1, Math.min(current - 2, total - 4));
  const end = Math.min(total, Math.max(current + 2, 5));
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
}

export default function CompanyReviewInbox({ approved = false }: { approved?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [replyingId, setReplyingId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const markedEventSignaturesRef = useRef(new Set<string>());
  const markingEventSignaturesRef = useRef(new Set<string>());
  const utils = trpc.useUtils();
  const inboxQuery = trpc.publicReview.inbox.useQuery(
    { page, pageSize: PAGE_SIZE },
    {
      enabled: approved && isOpen,
      refetchInterval: approved && isOpen ? 60_000 : false,
      refetchOnWindowFocus: approved && isOpen,
      retry: false,
    },
  );
  const markReadMutation = trpc.publicReview.markInboxRead.useMutation({
    retry: false,
  });
  const replyMutation = trpc.publicReview.reply.useMutation({
    onSuccess: () => {
      setReplyingId(null);
      setReplyText("");
      void utils.publicReview.inbox.invalidate();
      void utils.publicReview.unreadCount.invalidate();
      toast.success("回复已公开");
    },
    onError: error => toast.error(error.message),
  });

  const inbox = approved && !inboxQuery.isError ? inboxQuery.data : undefined;
  const visiblePages = useMemo(
    () => pageWindow(inbox?.page ?? 1, inbox?.totalPages ?? 1),
    [inbox?.page, inbox?.totalPages],
  );
  const unreadEventIds = inbox?.visibleUnreadEventIds ?? [];
  const unreadEventSignature = unreadEventIds.join(",");

  useEffect(() => {
    if (!isOpen || !inbox || inboxQuery.isFetching || unreadEventIds.length === 0) return;
    if (
      markedEventSignaturesRef.current.has(unreadEventSignature)
      || markingEventSignaturesRef.current.has(unreadEventSignature)
    ) return;
    markingEventSignaturesRef.current.add(unreadEventSignature);
    markReadMutation.mutate(
      { eventIds: unreadEventIds },
      {
        onSuccess: () => {
          markedEventSignaturesRef.current.add(unreadEventSignature);
          markingEventSignaturesRef.current.delete(unreadEventSignature);
          void utils.publicReview.inbox.invalidate();
          void utils.publicReview.unreadCount.invalidate();
        },
        onError: () => {
          markingEventSignaturesRef.current.delete(unreadEventSignature);
        },
      },
    );
  }, [inbox, inboxQuery.isFetching, isOpen, unreadEventSignature]);

  const submitReply = (reviewId: number) => {
    const content = replyText.trim();
    if (content.length < 2) {
      toast.error("回复至少填写2个字");
      return;
    }
    replyMutation.mutate({ reviewId, content });
  };

  return (
    <section data-testid="company-review-inbox" className="mt-4 overflow-hidden rounded-lg border bg-white">
      <button
        type="button"
        data-testid="company-review-toggle"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(value => !value)}
        className={`flex w-full flex-wrap items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-slate-50 ${isOpen ? "border-b" : ""}`}
      >
        <div>
          <h2 className="text-[13px] font-medium text-[#233548]">企业评论</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">其他认证企业发布的公开评论</p>
        </div>
        <span className="flex items-center gap-3 text-xs">
          {(inbox?.pendingReplyCount ?? 0) > 0 ? (
            <span className="rounded-full bg-[#FFF1F0] px-2.5 py-1 font-medium text-[#A32D2D]">
              待回复 {inbox?.pendingReplyCount}
            </span>
          ) : null}
          <span className="text-muted-foreground">共 {inbox?.total ?? 0} 条</span>
          <ChevronDown size={18} className={`text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </span>
      </button>

      {isOpen ? <>{!approved ? (
        <p className="p-5 text-sm text-muted-foreground">企业审核通过后可查看企业评论。</p>
      ) : inboxQuery.isLoading && !inbox ? (
        <div className="space-y-3 p-5">
          <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
          <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
        </div>
      ) : inboxQuery.isError ? (
        <div className="p-8 text-center text-sm text-slate-500">
          <p>{classifyBusinessFailure(inboxQuery.error) === "resource-denied" ? "暂无权限查看企业评论" : "企业评论加载失败"}</p>
          <p className="mt-2">{inboxQuery.error.message}</p>
          <button
            type="button"
            onClick={() => void inboxQuery.refetch()}
            className="crm-btn mt-3"
          >
            重新加载
          </button>
        </div>
      ) : inbox?.items.length ? (
        <div className="divide-y divide-slate-100 px-5">
          {inbox.items.map(review => {
            const editing = replyingId === review.id;
            const pendingReply = !review.replyContent;
            return (
              <article key={review.id} className="py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <strong className="truncate text-sm text-slate-800">{review.raterCompanyName}</strong>
                    {review.unread ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#A32D2D]">
                        <i className="size-1.5 rounded-full bg-[#A32D2D]" />新评论
                      </span>
                    ) : null}
                    {pendingReply ? (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">待回复</span>
                    ) : null}
                  </div>
                  <time className="shrink-0 text-[11px] text-slate-400">
                    {formatBeijingDateTime(review.createdAt)}
                  </time>
                </div>

                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{review.content}</p>

                {review.images.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {review.images.map(image => (
                      <a
                        key={image.id}
                        href={image.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block size-20 overflow-hidden rounded-md border bg-slate-50"
                        aria-label="查看评论图片"
                      >
                        <img src={image.url} alt="评论图片" loading="lazy" className="h-full w-full object-cover" />
                      </a>
                    ))}
                  </div>
                ) : null}

                {review.replyContent ? (
                  <div className="mt-3 rounded-lg bg-[#f5f8fb] px-3.5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[#185FA5]">商家回复</span>
                      <time className="text-[11px] text-slate-400">{formatBeijingDateTime(review.repliedAt)}</time>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{review.replyContent}</p>
                  </div>
                ) : null}

                {review.followUpContent ? (
                  <div className="mt-3 border-l-2 border-[#185FA5] pl-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-600">追加评论</span>
                      <time className="text-[11px] text-slate-400">{formatBeijingDateTime(review.followedUpAt)}</time>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{review.followUpContent}</p>
                  </div>
                ) : null}

                {pendingReply && inbox.canReply && !editing ? (
                  <button
                    type="button"
                    onClick={() => {
                      setReplyingId(review.id);
                      setReplyText("");
                    }}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[#185FA5] hover:underline"
                  >
                    <Reply size={14} />回复
                  </button>
                ) : null}

                {pendingReply && !inbox.canReply ? (
                  <p className="mt-3 text-xs text-slate-400">待企业管理员回复</p>
                ) : null}

                {editing ? (
                  <div className="mt-3 rounded-lg border border-slate-200 p-3">
                    <textarea
                      value={replyText}
                      onChange={event => setReplyText(event.target.value)}
                      maxLength={500}
                      rows={3}
                      autoFocus
                      placeholder="回复将公开展示"
                      className="w-full resize-none rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#185FA5]"
                    />
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span className="text-[11px] text-slate-400">{replyText.length}/500</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setReplyingId(null);
                            setReplyText("");
                          }}
                          className="crm-btn"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => submitReply(review.id)}
                          disabled={replyText.trim().length < 2 || replyMutation.isPending}
                          className="crm-btn crm-btn-primary disabled:opacity-50"
                        >
                          {replyMutation.isPending ? "提交中…" : "公开回复"}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-36 flex-col items-center justify-center p-6 text-center text-sm text-slate-400">
          <MessageSquareText size={24} className="mb-2 text-slate-300" />
          暂无企业评论
        </div>
      )}

      {inbox && inbox.totalPages > 1 ? (
        <div className="flex items-center justify-between border-t px-5 py-3 text-xs text-slate-500">
          <span>第 {inbox.page}/{inbox.totalPages} 页</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={inbox.page <= 1 || inboxQuery.isFetching}
              onClick={() => setPage(value => Math.max(1, value - 1))}
              className="grid size-8 place-items-center rounded-md border disabled:opacity-40"
              aria-label="上一页评论"
            >
              <ChevronLeft size={15} />
            </button>
            {visiblePages.map(value => (
              <button
                key={value}
                type="button"
                onClick={() => setPage(value)}
                className={`size-8 rounded-md border ${value === inbox.page ? "border-[#185FA5] bg-[#185FA5] text-white" : "border-slate-200"}`}
              >
                {value}
              </button>
            ))}
            <button
              type="button"
              disabled={inbox.page >= inbox.totalPages || inboxQuery.isFetching}
              onClick={() => setPage(value => Math.min(inbox.totalPages, value + 1))}
              className="grid size-8 place-items-center rounded-md border disabled:opacity-40"
              aria-label="下一页评论"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      ) : null}</> : null}
    </section>
  );
}
