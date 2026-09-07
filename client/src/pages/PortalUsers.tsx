import { useMemo, useState } from "react";
import {
  AlertTriangle,
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
  const isSuperAdmin = (authUser as { adminRole?: string } | null)?.adminRole === "super_admin";
  const [page, setPage] = useState(1);
  const [draftKeyword, setDraftKeyword] = useState("");
  const [keyword, setKeyword] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState("");
  const [recordDialog, setRecordDialog] = useState<RecordDialog>(null);
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
  const todayChannelParts = stats ? [
    stats.todayWebsiteRegistered > 0 ? `网站 ${stats.todayWebsiteRegistered}` : "",
    stats.todayMiniProgramRegistered > 0 ? `微信小程序 ${stats.todayMiniProgramRegistered}` : "",
    stats.todayOtherRegistered > 0 ? `其他 ${stats.todayOtherRegistered}` : "",
  ].filter(Boolean) : [];
  const summaryItems = [
    { label: "注册用户", value: stats?.totalUsers ?? "—" },
    { label: "普通用户", value: stats?.ordinaryUsers ?? "—" },
    { label: "ERP用户", value: stats?.erpUsers ?? "—" },
    { label: "今日注册", value: stats?.todayRegistered ?? "—", detail: todayChannelParts.join(" · ") },
    { label: "近7日登录用户", value: stats?.sevenDayActive ?? "—" },
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

  const submitSearch = () => {
    setPage(1);
    setKeyword(draftKeyword.trim());
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
              {item.detail && <span className="text-xs text-muted-foreground">{item.detail}</span>}
            </div>
          ))}
        </div>

        {isSuperAdmin && stats?.erpBindingMismatch && stats.erpBindingMismatch.total > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              ERP权限与后台企业绑定存在 {stats.erpBindingMismatch.total} 项待核对：
              后台有绑定但主站未开通 {stats.erpBindingMismatch.managerOnly} 项，
              主站已开通但后台未绑定 {stats.erpBindingMismatch.platformOnly} 项。
            </span>
          </div>
        )}

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
              <div className="portal-user-table min-w-0">
                <Table className="portal-user-responsive-table table-fixed">
                  <colgroup>
                    <col style={{ width: "20%" }} />
                    <col style={{ width: "15%" }} />
                    <col style={{ width: "22%" }} />
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "17%" }} />
                    <col style={{ width: "14%" }} />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <TableHead>用户</TableHead>
                      <TableHead>联系方式</TableHead>
                      <TableHead>企业</TableHead>
                      <TableHead>类型/渠道</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {query.data.rows.map(user => {
                      const target = { id: user.id, label: targetLabel(user) };
                      const muted = Boolean(user.forumMutedUntil && new Date(user.forumMutedUntil).getTime() > Date.now());
                      return (
                        <TableRow key={user.id}>
                          <TableCell data-label="用户" className="min-w-0 whitespace-normal align-top">
                            <div className="flex min-w-0 items-start gap-1">
                              <span className="min-w-0 break-all font-medium">{user.username || target.label}</span>
                              {canManage && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                                      aria-label={`管理 ${target.label}`}
                                      title="用户操作"
                                    >
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="start" className="w-52">
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
                              )}
                            </div>
                            <div className="mt-1 break-words text-xs text-muted-foreground">
                              {user.name && user.name !== user.username ? `${user.name} · ` : ""}ID {user.id}
                            </div>
                          </TableCell>
                          <TableCell data-label="联系方式" className="whitespace-normal align-top">
                            <div className="break-all">{user.phone || "—"}</div>
                            <div className="mt-1 break-all text-xs text-muted-foreground">{user.email || "未填写邮箱"}</div>
                          </TableCell>
                          <TableCell data-label="企业" className="whitespace-normal align-top">
                            <div className="break-words">{user.companyName || "—"}</div>
                            {user.creditCode && <div className="mt-1 break-all text-xs text-muted-foreground">{user.creditCode}</div>}
                          </TableCell>
                          <TableCell data-label="类型/渠道" className="whitespace-normal align-top">
                            {user.userType === "erp"
                              ? <Badge className="bg-emerald-100 text-emerald-800">ERP用户</Badge>
                              : <Badge variant="secondary">普通用户</Badge>}
                            <div className="mt-1 text-xs text-muted-foreground">{registrationChannel(user.loginMethod)}</div>
                          </TableCell>
                          <TableCell data-label="状态" className="whitespace-normal align-top">
                            <div className="flex flex-wrap gap-1">
                              {user.loginDisabled ? <Badge variant="destructive">禁止登录</Badge> : <Badge variant="secondary">账号正常</Badge>}
                              {muted ? <Badge variant="destructive">论坛禁言</Badge> : <Badge variant="secondary">论坛正常</Badge>}
                            </div>
                            {user.loginDisabled && (
                              <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                                <div>{dateTime(user.loginDisabledAt)}</div>
                                <div className="break-words" title={user.loginDisabledReason ?? undefined}>{user.loginDisabledReason || "未记录原因"}</div>
                              </div>
                            )}
                            {user.forumMutedUntil && (
                              <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                                <div>{muted ? "至 " : "已于 "}{dateTime(user.forumMutedUntil)}{muted ? "" : " 到期"}</div>
                                <div className="break-words" title={user.forumMuteReason ?? undefined}>{user.forumMuteReason || "未记录原因"}</div>
                              </div>
                            )}
                          </TableCell>
                          <TableCell data-label="时间" className="whitespace-normal align-top text-xs text-muted-foreground">
                            <div><span className="text-foreground/70">注册</span> {dateTime(user.createdAt)}</div>
                            <div className="mt-1"><span className="text-foreground/70">登录</span> {dateTime(user.lastSignedIn)}</div>
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
        @media (max-width: 900px) {
          .portal-user-table [data-slot="table-container"] {
            overflow-x: visible;
          }
          .portal-user-responsive-table,
          .portal-user-responsive-table tbody {
            display: block;
            width: 100%;
          }
          .portal-user-responsive-table colgroup,
          .portal-user-responsive-table thead {
            display: none;
          }
          .portal-user-responsive-table tbody {
            display: grid;
            gap: 0.75rem;
            padding: 0.75rem;
          }
          .portal-user-responsive-table tbody tr {
            display: grid;
            overflow: hidden;
            border: 1px solid var(--border);
            border-radius: 0.625rem;
          }
          .portal-user-responsive-table tbody td {
            display: grid;
            width: auto !important;
            min-width: 0;
            grid-template-columns: 5.5rem minmax(0, 1fr);
            gap: 0.75rem;
            white-space: normal;
          }
          .portal-user-responsive-table tbody td::before {
            content: attr(data-label);
            color: var(--muted-foreground);
            font-size: 0.75rem;
            font-weight: 500;
          }
        }
      `}</style>

    </DashboardLayout>
  );
}
