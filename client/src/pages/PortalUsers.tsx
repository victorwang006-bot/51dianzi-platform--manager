import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  History,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
  RefreshCw,
  Search,
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { formatBeijingDateTimeWithSeconds } from "@shared/beijingTime";
import { toast } from "sonner";

const PAGE_SIZE = 20;
const RECORD_LIMIT = 50;
type MuteHours = 3 | 6 | 24 | 72 | 168;

// 注册、登录与管控时间固定北京时间，便于排查异常操作时点。
const dateTime = (value: Date | string | null | undefined) =>
  value ? formatBeijingDateTimeWithSeconds(value) || "—" : "—";

const registrationChannel = (value: string | null | undefined) => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "未知";
  if (["local", "password"].includes(normalized)) return "网站注册";
  if (["wechat_miniprogram", "wechat_mini_program", "miniprogram"].includes(normalized)) {
    return "微信小程序";
  }
  if (["wechat", "wechat_oauth", "wechat_web"].includes(normalized)) return "微信渠道";
  if (["oauth", "manus"].includes(normalized)) return "第三方登录";
  return "其他渠道";
};

const muteLabels: Array<[MuteHours, string]> = [
  [3, "禁言3小时"],
  [6, "禁言6小时"],
  [24, "禁言1天"],
  [72, "禁言3天"],
  [168, "禁言7天"],
];

type UserTarget = { id: number; label: string };
type PendingAction =
  | { type: "login"; target: UserTarget; disabled: boolean; label: string }
  | { type: "mute"; target: UserTarget; durationHours: MuteHours | null; label: string }
  | { type: "hideMessage"; target: UserTarget; messageId: number; label: string };

type RecordDialog = { type: "history" | "messages"; target: UserTarget } | null;
type HistoryRow = {
  id: number;
  action: string;
  reason: string | null;
  operatorName: string | null;
  operatorRole?: string | null;
  createdAt: Date | string;
};
type ForumMessageRow = {
  id: number;
  content: string;
  createdAt: Date | string;
  isHidden: boolean;
  hiddenAt?: Date | string | null;
  hiddenReason?: string | null;
  status?: string | null;
};

function collectionRows<T>(value: T[] | { rows: T[] } | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : value.rows;
}

function targetLabel(user: { id: number; name: string | null; username: string | null }) {
  return user.name || user.username || `用户 ${user.id}`;
}

function actionDisplayName(action: string) {
  const labels: Record<string, string> = {
    login_disabled: "禁止登录",
    login_restored: "恢复登录",
    forum_muted: "论坛禁言",
    forum_unmuted: "解除禁言",
    forum_message_hidden: "撤回论坛发言",
    setLoginDisabled: "登录状态变更",
    setForumMute: "论坛状态变更",
    hideForumMessage: "撤回论坛发言",
  };
  return labels[action] ?? action;
}

export default function PortalUsers() {
  const { user: authUser } = useAuth();
  const canManage = authUser?.permissions?.includes("portalUsers.manage") ?? false;
  const [page, setPage] = useState(1);
  const [draftKeyword, setDraftKeyword] = useState("");
  const [keyword, setKeyword] = useState("");
  const [tableScrollWidth, setTableScrollWidth] = useState(0);
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState("");
  const [recordDialog, setRecordDialog] = useState<RecordDialog>(null);
  const tableRegionRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();
  const input = useMemo(() => ({
    page,
    pageSize: PAGE_SIZE,
    keyword: keyword || undefined,
  }), [keyword, page]);
  const query = trpc.frontendUser.list.useQuery(input, { retry: 1 });
  const statsQuery = trpc.frontendUser.stats.useQuery(undefined, { retry: 1 });
  const historyQuery = trpc.frontendUser.moderationHistory.useQuery(
    { userId: recordDialog?.target.id ?? 1, limit: RECORD_LIMIT },
    { enabled: canManage && recordDialog?.type === "history", retry: 1 },
  );
  const messagesQuery = trpc.frontendUser.forumMessages.useQuery(
    { userId: recordDialog?.target.id ?? 1, limit: RECORD_LIMIT },
    { enabled: canManage && recordDialog?.type === "messages", retry: 1 },
  );
  const historyRows = collectionRows(historyQuery.data) as HistoryRow[];
  const messageRows = collectionRows(messagesQuery.data) as ForumMessageRow[];
  const stats = statsQuery.data;
  const pageCount = Math.max(1, Math.ceil((query.data?.total ?? 0) / PAGE_SIZE));
  const isRefreshing = query.isFetching || statsQuery.isFetching;
  const summaryItems = [
    { label: "注册用户", value: stats?.totalUsers ?? "—" },
    { label: "普通用户", value: stats?.ordinaryUsers ?? "—" },
    { label: "ERP用户", value: stats?.erpUsers ?? "—" },
    { label: "今日注册", value: stats?.todayRegistered ?? "—" },
    { label: "近7日登录", value: stats?.sevenDayActive ?? "—" },
  ];

  const refreshUserList = async () => {
    await utils.frontendUser.list.invalidate();
  };

  const loginMutation = trpc.frontendUser.setLoginDisabled.useMutation({
    onSuccess: async () => {
      toast.success("账号状态已更新");
      setPendingAction(null);
      setReason("");
      await refreshUserList();
    },
    onError: error => toast.error(`操作失败：${error.message}`),
  });
  const muteMutation = trpc.frontendUser.setForumMute.useMutation({
    onSuccess: async () => {
      toast.success("论坛状态已更新");
      setPendingAction(null);
      setReason("");
      await refreshUserList();
    },
    onError: error => toast.error(`操作失败：${error.message}`),
  });
  const hideMessageMutation = trpc.frontendUser.hideForumMessage.useMutation({
    onSuccess: async () => {
      toast.success("论坛发言已撤回");
      setPendingAction(null);
      setReason("");
      await Promise.all([
        refreshUserList(),
        utils.frontendUser.forumMessages.invalidate(),
        utils.frontendUser.moderationHistory.invalidate(),
      ]);
    },
    onError: error => toast.error(`撤回失败：${error.message}`),
  });
  const isSubmitting = loginMutation.isPending || muteMutation.isPending || hideMessageMutation.isPending;

  const getTableScrollElement = () =>
    tableRegionRef.current?.querySelector<HTMLElement>('[data-slot="table-container"]') ?? null;

  useLayoutEffect(() => {
    const tableScrollElement = getTableScrollElement();
    const topScrollElement = topScrollRef.current;
    if (!tableScrollElement || !topScrollElement) {
      setTableScrollWidth(0);
      setHasHorizontalOverflow(false);
      return;
    }

    let syncing = false;
    const measure = () => {
      const nextWidth = tableScrollElement.scrollWidth;
      setTableScrollWidth(nextWidth);
      setHasHorizontalOverflow(nextWidth > tableScrollElement.clientWidth + 1);
      topScrollElement.scrollLeft = tableScrollElement.scrollLeft;
    };
    const syncTopScroll = () => {
      if (syncing) return;
      syncing = true;
      topScrollElement.scrollLeft = tableScrollElement.scrollLeft;
      syncing = false;
    };
    const syncTableScroll = () => {
      if (syncing) return;
      syncing = true;
      tableScrollElement.scrollLeft = topScrollElement.scrollLeft;
      syncing = false;
    };

    tableScrollElement.addEventListener("scroll", syncTopScroll, { passive: true });
    topScrollElement.addEventListener("scroll", syncTableScroll, { passive: true });
    window.addEventListener("resize", measure);
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(measure);
    resizeObserver?.observe(tableScrollElement);
    measure();

    return () => {
      tableScrollElement.removeEventListener("scroll", syncTopScroll);
      topScrollElement.removeEventListener("scroll", syncTableScroll);
      window.removeEventListener("resize", measure);
      resizeObserver?.disconnect();
    };
  }, [query.data?.rows.length]);

  const submitSearch = () => {
    setPage(1);
    setKeyword(draftKeyword.trim());
  };

  const scrollTableBy = (distance: number) => {
    getTableScrollElement()?.scrollBy({ left: distance, behavior: "smooth" });
  };

  const openAction = (action: PendingAction) => {
    setPendingAction(action);
    setReason(
      action.type === "login" && !action.disabled
        ? "管理员恢复登录"
        : action.type === "mute" && action.durationHours === null
          ? "管理员解除禁言"
          : "",
    );
  };

  const submitAction = () => {
    if (!pendingAction || !reason.trim()) {
      toast.error("请输入操作原因");
      return;
    }
    if (pendingAction.type === "login") {
      loginMutation.mutate({
        userId: pendingAction.target.id,
        disabled: pendingAction.disabled,
        reason: reason.trim(),
      });
    } else if (pendingAction.type === "mute") {
      muteMutation.mutate({
        userId: pendingAction.target.id,
        durationHours: pendingAction.durationHours,
        reason: reason.trim(),
      });
    } else {
      hideMessageMutation.mutate({ messageId: pendingAction.messageId, reason: reason.trim() });
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">用户管理</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              统计前台注册用户，并按后台权威开通状态区分普通用户与ERP用户。
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void Promise.all([query.refetch(), statsQuery.refetch()])}
            disabled={isRefreshing}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            刷新
          </Button>
        </div>

        <div
          aria-label="用户统计摘要"
          className="flex flex-wrap items-center gap-x-7 gap-y-2 border-y py-2 text-sm"
        >
          {summaryItems.map(item => (
            <div key={item.label} className="flex items-baseline gap-2 whitespace-nowrap">
              <span className="text-muted-foreground">{item.label}</span>
              <strong className="text-base font-semibold text-foreground">{item.value}</strong>
            </div>
          ))}
        </div>

        {statsQuery.error && (
          <Card><CardContent className="p-3 text-sm text-destructive">用户统计暂不可用：{statsQuery.error.message}</CardContent></Card>
        )}

        <Card>
          <CardContent className="p-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={draftKeyword}
                onChange={event => setDraftKeyword(event.target.value)}
                onKeyDown={event => event.key === "Enter" && submitSearch()}
                placeholder="用户名、姓名、手机号、邮箱或企业名称"
              />
              <Button onClick={submitSearch}><Search className="mr-2 h-4 w-4" />搜索</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {query.isLoading ? (
              <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : query.error ? (
              <div className="p-10 text-center">
                <p className="font-medium text-destructive">前台用户服务暂不可用</p>
                <p className="mt-2 text-sm text-muted-foreground">{query.error.message}</p>
                <Button className="mt-4" variant="outline" onClick={() => query.refetch()}>重试</Button>
              </div>
            ) : !query.data?.rows.length ? (
              <div className="p-12 text-center text-sm text-muted-foreground">没有符合条件的前台注册用户</div>
            ) : (
              <div ref={tableRegionRef} className="portal-user-table">
                <div
                  className={`${hasHorizontalOverflow ? "flex" : "hidden"} items-center gap-2 border-b bg-muted/25 px-3 py-2`}
                  aria-hidden={!hasHorizontalOverflow}
                >
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">左右拖动查看全部字段</span>
                  <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" aria-label="向左移动用户表格" onClick={() => scrollTableBy(-360)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <div ref={topScrollRef} className="portal-user-top-scroll h-[16px] min-w-0 flex-1 overflow-x-auto" role="region" aria-label="用户表格横向滚动" tabIndex={0}>
                    <div style={{ width: Math.max(tableScrollWidth, 1), height: 1 }} />
                  </div>
                  <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" aria-label="向右移动用户表格" onClick={() => scrollTableBy(360)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
                <Table className="min-w-[1780px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>用户</TableHead>
                      <TableHead>联系方式</TableHead>
                      <TableHead>企业</TableHead>
                      <TableHead>用户类型</TableHead>
                      <TableHead>注册渠道</TableHead>
                      <TableHead>账号状态</TableHead>
                      <TableHead>论坛状态</TableHead>
                      <TableHead>注册时间</TableHead>
                      <TableHead>最近登录</TableHead>
                      <TableHead className="sticky right-0 bg-background text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {query.data.rows.map(user => {
                      const target = { id: user.id, label: targetLabel(user) };
                      const muted = Boolean(user.forumMutedUntil && new Date(user.forumMutedUntil).getTime() > Date.now());
                      return (
                        <TableRow key={user.id}>
                          <TableCell>
                            <div className="font-medium">{target.label}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{user.username || "未设置用户名"} · ID {user.id}</div>
                          </TableCell>
                          <TableCell>
                            <div>{user.phone || "—"}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{user.email || "未填写邮箱"}</div>
                          </TableCell>
                          <TableCell>
                            <div>{user.companyName || "—"}</div>
                            {user.creditCode && <div className="mt-1 text-xs text-muted-foreground">{user.creditCode}</div>}
                          </TableCell>
                          <TableCell>
                            {user.userType === "erp"
                              ? <Badge className="bg-emerald-100 text-emerald-800">ERP用户</Badge>
                              : <Badge variant="secondary">普通用户</Badge>}
                          </TableCell>
                          <TableCell>{registrationChannel(user.loginMethod)}</TableCell>
                          <TableCell className="max-w-[220px] align-top">
                            {user.loginDisabled ? <Badge variant="destructive">禁止登录</Badge> : <Badge variant="secondary">正常</Badge>}
                            {user.loginDisabled && (
                              <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                                <div>{dateTime(user.loginDisabledAt)}</div>
                                <div className="break-words" title={user.loginDisabledReason ?? undefined}>{user.loginDisabledReason || "未记录原因"}</div>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="max-w-[240px] align-top">
                            {muted ? <Badge variant="destructive">禁言中</Badge> : <Badge variant="secondary">正常</Badge>}
                            {user.forumMutedUntil && (
                              <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                                <div>{muted ? "至 " : "已于 "}{dateTime(user.forumMutedUntil)}{muted ? "" : " 到期"}</div>
                                <div className="break-words" title={user.forumMuteReason ?? undefined}>{user.forumMuteReason || "未记录原因"}</div>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{dateTime(user.createdAt)}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{dateTime(user.lastSignedIn)}</TableCell>
                          <TableCell className="sticky right-0 bg-background text-right">
                            {canManage ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="outline" size="sm" aria-label={`管理 ${target.label}`}>
                                    <MoreHorizontal className="mr-1 h-4 w-4" />操作
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-52">
                                  <DropdownMenuLabel>账号管控</DropdownMenuLabel>
                                  <DropdownMenuItem variant={user.loginDisabled ? "default" : "destructive"} onSelect={() => openAction({ type: "login", target, disabled: !user.loginDisabled, label: user.loginDisabled ? "恢复登录" : "禁止登录" })}>
                                    {user.loginDisabled ? "恢复登录" : "禁止登录"}
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuLabel>论坛管控</DropdownMenuLabel>
                                  {muteLabels.map(([hours, label]) => (
                                    <DropdownMenuItem key={hours} variant="destructive" onSelect={() => openAction({ type: "mute", target, durationHours: hours, label })}>{label}</DropdownMenuItem>
                                  ))}
                                  <DropdownMenuItem onSelect={() => openAction({ type: "mute", target, durationHours: null, label: "解除禁言" })}>解除禁言</DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onSelect={() => setRecordDialog({ type: "history", target })}><History />查看管理记录</DropdownMenuItem>
                                  <DropdownMenuItem onSelect={() => setRecordDialog({ type: "messages", target })}><MessageSquareText />查看论坛发言记录</DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ) : <span className="text-xs text-muted-foreground">只读</span>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>共 {query.data?.total ?? 0} 条</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</Button>
            <span>{page} / {pageCount}</span>
            <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage(value => value + 1)}>下一页</Button>
          </div>
        </div>
      </div>

      <Dialog open={Boolean(pendingAction)} onOpenChange={open => !open && !isSubmitting && setPendingAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认{pendingAction?.label}</DialogTitle>
            <DialogDescription>此操作将写入管理记录，请确认目标和原因后提交。</DialogDescription>
          </DialogHeader>
          {pendingAction && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div><span className="text-muted-foreground">目标用户：</span>{pendingAction.target.label}（ID {pendingAction.target.id}）</div>
                <div className="mt-1"><span className="text-muted-foreground">具体动作：</span><strong className="text-destructive">{pendingAction.label}</strong></div>
                {pendingAction.type === "hideMessage" && <div className="mt-1"><span className="text-muted-foreground">消息 ID：</span>{pendingAction.messageId}</div>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="moderation-reason">操作原因 <span className="text-destructive">*</span></Label>
                <Textarea id="moderation-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={500} placeholder="请输入操作原因" rows={4} />
                <div className="text-right text-xs text-muted-foreground">{reason.length}/500</div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingAction(null)} disabled={isSubmitting}>取消</Button>
            <Button variant="destructive" onClick={submitAction} disabled={isSubmitting || !reason.trim()}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}确认提交
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={recordDialog?.type === "history"} onOpenChange={open => !open && setRecordDialog(null)}>
        <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>管理记录</DialogTitle>
            <DialogDescription>{recordDialog?.target.label}（ID {recordDialog?.target.id}）最近 {RECORD_LIMIT} 条管理操作</DialogDescription>
          </DialogHeader>
          <div className="min-h-32 flex-1 overflow-y-auto pr-1">
            {historyQuery.isLoading ? (
              <div className="flex min-h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : historyQuery.error ? (
              <p className="p-4 text-sm text-destructive">加载失败：{historyQuery.error.message}</p>
            ) : historyRows.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">暂无管理记录</p>
            ) : (
              <div className="space-y-2">
                {historyRows.map(item => (
                  <div key={item.id} className="rounded-md border p-3 text-sm">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <strong>{actionDisplayName(item.action)}</strong>
                      <span className="text-xs text-muted-foreground">{dateTime(item.createdAt)}</span>
                    </div>
                    <div className="mt-2 text-muted-foreground">操作人：{item.operatorName || "系统"}{item.operatorRole ? `（${item.operatorRole}）` : ""}</div>
                    <div className="mt-1 whitespace-pre-wrap break-words">原因：{item.reason || "—"}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={recordDialog?.type === "messages"} onOpenChange={open => !open && setRecordDialog(null)}>
        <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>论坛发言记录</DialogTitle>
            <DialogDescription>{recordDialog?.target.label}（ID {recordDialog?.target.id}）最近 {RECORD_LIMIT} 条论坛消息</DialogDescription>
          </DialogHeader>
          <div className="min-h-32 flex-1 overflow-y-auto pr-1">
            {messagesQuery.isLoading ? (
              <div className="flex min-h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : messagesQuery.error ? (
              <p className="p-4 text-sm text-destructive">加载失败：{messagesQuery.error.message}</p>
            ) : messageRows.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">暂无论坛发言</p>
            ) : (
              <div className="space-y-2">
                {messageRows.map(message => {
                  const hidden = Boolean(message.isHidden || message.hiddenAt || message.status === "hidden");
                  return (
                    <div key={message.id} className="rounded-md border p-3 text-sm">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>消息 ID {message.id}</span><span>{dateTime(message.createdAt)}</span>
                            {hidden && <Badge variant="secondary">已撤回</Badge>}
                          </div>
                          <p className="mt-2 whitespace-pre-wrap break-words">{message.content || "（无文本内容）"}</p>
                          {message.hiddenReason && <p className="mt-2 text-xs text-muted-foreground">撤回原因：{message.hiddenReason}</p>}
                        </div>
                        {canManage && !hidden && recordDialog && (
                          <Button size="sm" variant="destructive" onClick={() => openAction({ type: "hideMessage", target: recordDialog.target, messageId: message.id, label: "撤回论坛发言" })}>撤回</Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <style>{`
        .portal-user-table [data-slot="table-container"] {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .portal-user-table [data-slot="table-container"]::-webkit-scrollbar {
          display: none;
        }
        .portal-user-top-scroll {
          scrollbar-color: #6f8fa8 #dce7ef;
          scrollbar-width: auto;
        }
        .portal-user-top-scroll::-webkit-scrollbar {
          height: 14px;
        }
        .portal-user-top-scroll::-webkit-scrollbar-track {
          border-radius: 999px;
          background: #dce7ef;
        }
        .portal-user-top-scroll::-webkit-scrollbar-thumb {
          min-width: 72px;
          border: 2px solid #dce7ef;
          border-radius: 999px;
          background: #6f8fa8;
        }
        .portal-user-top-scroll::-webkit-scrollbar-thumb:hover {
          background: #476f8f;
        }
      `}</style>
    </DashboardLayout>
  );
}
