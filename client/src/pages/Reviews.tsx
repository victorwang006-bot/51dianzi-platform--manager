import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  EyeOff,
  ImageIcon,
  Loader2,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { formatBeijingDateTimeWithSeconds } from "@shared/beijingTime";

const PAGE_SIZE = 30;
type ReviewStatus = "published" | "user_deleted" | "platform_hidden";

const STATUS_LABELS: Record<ReviewStatus, string> = {
  published: "公开",
  user_deleted: "用户已删除",
  platform_hidden: "平台已隐藏",
};

const STATUS_STYLES: Record<ReviewStatus, string> = {
  published: "border-emerald-200 bg-emerald-50 text-emerald-700",
  user_deleted: "border-slate-200 bg-slate-50 text-slate-600",
  platform_hidden: "border-amber-200 bg-amber-50 text-amber-700",
};

const dateTime = (value: Date | string | null | undefined) =>
  value ? formatBeijingDateTimeWithSeconds(value) || "—" : "—";

export default function Reviews() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ReviewStatus | "all">("all");
  const [draftKeyword, setDraftKeyword] = useState("");
  const [keyword, setKeyword] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [hideTarget, setHideTarget] = useState<{ id: number; company: string } | null>(null);
  const [hideReason, setHideReason] = useState("");

  const input = useMemo(() => ({
    status,
    keyword: keyword || undefined,
    page,
    pageSize: PAGE_SIZE,
  }), [keyword, page, status]);

  const query = trpc.reviewManagement.list.useQuery(input, { retry: 1 });
  const statsQuery = trpc.reviewManagement.stats.useQuery(undefined, { retry: 1 });
  const utils = trpc.useUtils();
  const hideMutation = trpc.reviewManagement.hide.useMutation();
  const restoreMutation = trpc.reviewManagement.restore.useMutation();

  const rows = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const stats = statsQuery.data;
  const busy = query.isFetching || statsQuery.isFetching || hideMutation.isPending || restoreMutation.isPending;

  useEffect(() => {
    if (query.data && page > pageCount) setPage(pageCount);
  }, [page, pageCount, query.data]);

  const refresh = () => {
    void query.refetch();
    void statsQuery.refetch();
  };

  const applyKeyword = () => {
    setKeyword(draftKeyword.trim());
    setPage(1);
  };

  const chooseStatus = (next: ReviewStatus | "all") => {
    setStatus(next);
    setPage(1);
    setExpandedId(null);
  };

  const submitHide = () => {
    if (!hideTarget || hideReason.trim().length < 2) return;
    hideMutation.mutate(
      { reviewId: hideTarget.id, reason: hideReason.trim() },
      {
        onSuccess: () => {
          setHideTarget(null);
          setHideReason("");
          void utils.reviewManagement.list.invalidate();
          void utils.reviewManagement.stats.invalidate();
          toast.success("评价已隐藏");
        },
        onError: error => toast.error(error.message),
      },
    );
  };

  const restore = (reviewId: number) => {
    if (!window.confirm("确认恢复公开这条评价？")) return;
    restoreMutation.mutate(
      { reviewId },
      {
        onSuccess: () => {
          void utils.reviewManagement.list.invalidate();
          void utils.reviewManagement.stats.invalidate();
          toast.success("评价已恢复公开");
        },
        onError: error => toast.error(error.message),
      },
    );
  };

  const summaryCards: Array<{
    key: ReviewStatus | "all";
    label: string;
    value: number;
    icon: typeof MessageSquareText;
    tone: string;
  }> = [
    { key: "all", label: "全部记录", value: stats?.total ?? 0, icon: MessageSquareText, tone: "text-slate-700" },
    { key: "published", label: "公开", value: stats?.published ?? 0, icon: ShieldCheck, tone: "text-emerald-600" },
    { key: "user_deleted", label: "用户已删除", value: stats?.userDeleted ?? 0, icon: Trash2, tone: "text-slate-500" },
    { key: "platform_hidden", label: "平台已隐藏", value: stats?.platformHidden ?? 0, icon: EyeOff, tone: "text-amber-600" },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">评价管理</h1>
            <p className="mt-1 text-sm text-slate-500">
              查看实名评价、用户删除历史及平台处理记录；后台不可修改评价原文。
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
            刷新
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {summaryCards.map(card => {
            const Icon = card.icon;
            const active = status === card.key;
            return (
              <button key={card.key} type="button" onClick={() => chooseStatus(card.key)} className="text-left">
                <Card className={active ? "border-blue-300 ring-2 ring-blue-100" : "transition hover:border-slate-300"}>
                  <CardContent className="flex items-center justify-between p-4">
                    <div>
                      <div className="text-xs text-slate-500">{card.label}</div>
                      <div className="mt-1 text-2xl font-semibold text-slate-900">{card.value}</div>
                    </div>
                    <Icon className={`h-6 w-6 ${card.tone}`} />
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>

        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <div className="flex items-center gap-2">
              <Input
                value={draftKeyword}
                onChange={event => setDraftKeyword(event.target.value)}
                onKeyDown={event => event.key === "Enter" && applyKeyword()}
                placeholder="搜索评价企业、被评企业或内容"
                className="w-72"
              />
              <Button size="sm" variant="outline" onClick={applyKeyword}>
                <Search className="mr-1.5 h-4 w-4" />搜索
              </Button>
            </div>
            <select
              value={status}
              onChange={event => chooseStatus(event.target.value as ReviewStatus | "all")}
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700"
            >
              <option value="all">全部状态</option>
              <option value="published">公开</option>
              <option value="user_deleted">用户已删除</option>
              <option value="platform_hidden">平台已隐藏</option>
            </select>
            {(keyword || status !== "all") && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraftKeyword("");
                  setKeyword("");
                  chooseStatus("all");
                }}
              >清除筛选</Button>
            )}
            <div className="ml-auto text-sm text-slate-500">共 {total} 条</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {query.data?.available === false ? (
              <div className="py-16 text-center text-sm text-slate-500">评价数据暂不可访问，请确认前台评价迁移已完成。</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[155px]">发布时间</TableHead>
                    <TableHead className="w-[260px]">评价企业 → 被评企业</TableHead>
                    <TableHead>评价内容</TableHead>
                    <TableHead className="w-[105px]">状态</TableHead>
                    <TableHead className="w-[110px] text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.isLoading && (
                    <TableRow><TableCell colSpan={5} className="py-14 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></TableCell></TableRow>
                  )}
                  {!query.isLoading && rows.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="py-14 text-center text-sm text-slate-400">暂无评价记录</TableCell></TableRow>
                  )}
                  {rows.map(row => (
                    <Fragment key={row.id}>
                      <TableRow className="cursor-pointer" onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}>
                        <TableCell className="whitespace-nowrap text-xs text-slate-600">{dateTime(row.createdAt)}</TableCell>
                        <TableCell>
                          <div className="text-sm font-medium text-slate-800">{row.raterCompanyName}</div>
                          <div className="mt-1 truncate text-xs text-slate-400">→ {row.ratedCompanyName || `用户 #${row.ratedUserId}`}</div>
                        </TableCell>
                        <TableCell className="max-w-0">
                          <div className="truncate text-sm text-slate-700" title={row.content}>{row.content}</div>
                          <div className="mt-1 text-[11px] text-slate-400">第 {row.revision} 版 · {row.images.length} 张图片</div>
                        </TableCell>
                        <TableCell><Badge variant="outline" className={STATUS_STYLES[row.status as ReviewStatus]}>{STATUS_LABELS[row.status as ReviewStatus]}</Badge></TableCell>
                        <TableCell className="text-right" onClick={event => event.stopPropagation()}>
                          {row.status === "published" && (
                            <Button size="sm" variant="outline" onClick={() => { setHideTarget({ id: row.id, company: row.raterCompanyName }); setHideReason(""); }}>
                              <EyeOff className="mr-1 h-3.5 w-3.5" />隐藏
                            </Button>
                          )}
                          {row.status === "platform_hidden" && (
                            <Button size="sm" variant="outline" onClick={() => restore(row.id)} disabled={restoreMutation.isPending}>
                              <RotateCcw className="mr-1 h-3.5 w-3.5" />恢复
                            </Button>
                          )}
                          {row.status === "user_deleted" && <span className="text-xs text-slate-400">仅查看</span>}
                        </TableCell>
                      </TableRow>
                      {expandedId === row.id && (
                        <TableRow>
                          <TableCell colSpan={5} className="bg-slate-50 p-5">
                            <div className="grid gap-5 text-sm lg:grid-cols-[minmax(0,1fr)_310px]">
                              <div className="space-y-4">
                                <DetailBlock label="评价原文" content={row.content} />
                                {row.images.length > 0 && (
                                  <div>
                                    <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500"><ImageIcon className="h-3.5 w-3.5" />评价图片</div>
                                    <div className="flex flex-wrap gap-2">
                                      {row.images.map(image => <a key={image.id} href={image.url} target="_blank" rel="noreferrer"><img src={image.url} alt="评价图片" className="h-20 w-20 rounded-lg border bg-white object-cover" /></a>)}
                                    </div>
                                  </div>
                                )}
                                {row.replyContent && <DetailBlock label="商家回复" content={row.replyContent} time={row.repliedAt} />}
                                {row.followUpContent && <DetailBlock label="追加评价" content={row.followUpContent} time={row.followedUpAt} />}
                              </div>
                              <dl className="space-y-2 rounded-lg border border-slate-200 bg-white p-4 text-xs">
                                <AuditField label="记录ID" value={`#${row.id} / 第${row.revision}版`} />
                                <AuditField label="评价方用户" value={`#${row.raterUserId}`} />
                                <AuditField label="被评方用户" value={`#${row.ratedUserId}`} />
                                <AuditField label="最后更新" value={dateTime(row.updatedAt)} />
                                {row.deletedAt && <AuditField label="用户删除" value={`${dateTime(row.deletedAt)} · 用户 #${row.deletedByUserId}`} />}
                                {row.hiddenAt && <AuditField label="平台隐藏" value={`${dateTime(row.hiddenAt)} · ${row.hiddenByAdminName || `管理员 #${row.hiddenByAdminId}`}`} />}
                                {row.hiddenReason && <AuditField label="隐藏原因" value={row.hiddenReason} />}
                                {row.restoredAt && <AuditField label="最近恢复" value={`${dateTime(row.restoredAt)} · ${row.restoredByAdminName || `管理员 #${row.restoredByAdminId}`}`} />}
                              </dl>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {pageCount > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="text-sm text-slate-600">第 {page} / {pageCount} 页</span>
            <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage(value => Math.min(pageCount, value + 1))}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        )}
      </div>

      {hideTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="平台隐藏评价">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-lg font-semibold text-slate-900">隐藏评价</h2><p className="mt-1 text-sm text-slate-500">隐藏后前台不再展示，后台保留原文和操作记录。</p></div>
              <button type="button" onClick={() => setHideTarget(null)} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-4 text-sm text-slate-600">评价企业：<span className="font-medium text-slate-800">{hideTarget.company}</span></div>
            <textarea value={hideReason} onChange={event => setHideReason(event.target.value)} maxLength={255} rows={4} autoFocus placeholder="填写隐藏原因（至少2个字）" className="mt-3 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500" />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setHideTarget(null)}>取消</Button>
              <Button onClick={submitHide} disabled={hideReason.trim().length < 2 || hideMutation.isPending}>{hideMutation.isPending ? "处理中…" : "确认隐藏"}</Button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

function DetailBlock({ label, content, time }: { label: string; content: string; time?: Date | string | null }) {
  return <div><div className="text-xs font-medium text-slate-500">{label}{time ? ` · ${dateTime(time)}` : ""}</div><p className="mt-1 whitespace-pre-wrap break-words leading-6 text-slate-700">{content}</p></div>;
}

function AuditField({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-slate-400">{label}</dt><dd className="mt-0.5 break-words text-slate-700">{value}</dd></div>;
}
