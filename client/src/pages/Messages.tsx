import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  ArrowLeft, Building2, CheckCircle2, Mail, MessageSquare, Phone, RotateCcw, Search, Send, User,
} from "lucide-react";

function formatTime(value: string | Date) {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

const THREAD_TYPE_META: Record<string, { label: string; className: string }> = {
  inquiry: { label: "快速询价", className: "bg-amber-100 text-amber-800 hover:bg-amber-100 border-transparent" },
  service: { label: "在线客服", className: "bg-blue-100 text-blue-800 hover:bg-blue-100 border-transparent" },
  crm_apply: { label: "企业开通", className: "bg-violet-100 text-violet-800 hover:bg-violet-100 border-transparent" },
  general: { label: "留言", className: "bg-slate-100 text-slate-700 hover:bg-slate-100 border-transparent" },
};

function ThreadTypeBadge({ type }: { type?: string | null }) {
  const meta = THREAD_TYPE_META[type ?? "general"] ?? THREAD_TYPE_META.general;
  return <Badge className={meta.className}>{meta.label}</Badge>;
}

/** 公司资料快照（前台已提交公司资料的用户，会话中附带） */
interface CompanyProfileSnapshot {
  companyName?: string | null;
  creditCode?: string | null;
  companyType?: string | null;
  legalPerson?: string | null;
  companyRole?: string | null;
  regAddress?: string | null;
  certLevel?: string | null;
}

/** 会话列表 + 对话视图（选中会话后进入对话） */
export default function Messages() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "closed">("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "general" | "inquiry" | "service" | "crm_apply">("all");
  const [keyword, setKeyword] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [activeThreadId, setActiveThreadId] = useState<number | null>(() => {
    // 支持 /messages?thread=4 直达会话详情
    const t = new URLSearchParams(window.location.search).get("thread");
    return t && /^\d+$/.test(t) ? Number(t) : null;
  });
  const pageSize = 20;

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.message.threads.useQuery({
    page, pageSize,
    status: statusFilter === "all" ? undefined : statusFilter,
    threadType: typeFilter === "all" ? undefined : typeFilter,
    keyword: keyword || undefined,
  }, { refetchInterval: 30000 });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));

  if (activeThreadId !== null) {
    return (
      <DashboardLayout>
        <ThreadDetail
          threadId={activeThreadId}
          onBack={() => {
            setActiveThreadId(null);
            utils.message.threads.invalidate();
            utils.message.unreadCount.invalidate();
          }}
        />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">消息中心</h1>
        <p className="text-sm text-muted-foreground mt-1">
          前台用户通过"联系我们"提交的留言，在此查看并回复
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <Input
            placeholder="搜索主题 / 联系人 / 电话 / 邮箱 / 会话编号"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") { setKeyword(searchInput.trim()); setPage(1); }
            }}
            className="w-80"
          />
          <Button variant="outline" className="bg-background" onClick={() => { setKeyword(searchInput.trim()); setPage(1); }}>
            <Search className="h-4 w-4 mr-1" /> 搜索
          </Button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Select value={typeFilter} onValueChange={v => { setTypeFilter(v as typeof typeFilter); setPage(1); }}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              <SelectItem value="inquiry">快速询价</SelectItem>
              <SelectItem value="service">在线客服</SelectItem>
              <SelectItem value="crm_apply">企业开通</SelectItem>
              <SelectItem value="general">普通留言</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={v => { setStatusFilter(v as typeof statusFilter); setPage(1); }}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="open">进行中</SelectItem>
              <SelectItem value="closed">已关闭</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : !data?.items.length ? (
          <div className="py-16 text-center text-muted-foreground">
            <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>暂无消息</p>
            <p className="text-xs mt-1">前台用户通过"联系我们"提交留言后会显示在这里</p>
          </div>
        ) : (
          <div className="divide-y">
            {data.items.map(thread => (
              <button
                key={thread.id}
                onClick={() => setActiveThreadId(thread.id)}
                className="w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors flex items-start gap-3"
              >
                <div className="mt-1 shrink-0">
                  <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <ThreadTypeBadge type={(thread as { threadType?: string }).threadType} />
                    <span className="font-medium truncate">
                      {thread.subject || "（无主题）"}
                    </span>
                    {thread.adminUnreadCount > 0 && (
                      <Badge className="bg-red-500 text-white hover:bg-red-500 px-1.5 h-5 min-w-5 justify-center">
                        {thread.adminUnreadCount}
                      </Badge>
                    )}
                    {thread.status === "closed" && (
                      <Badge variant="secondary">已关闭</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate mt-0.5">
                    {thread.lastMessagePreview}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    {thread.contactName && <span>{thread.contactName}</span>}
                    {thread.contactPhone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{thread.contactPhone}</span>}
                    {thread.contactEmail && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{thread.contactEmail}</span>}
                    <span>{thread.threadNo}</span>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground shrink-0 mt-1">
                  {formatTime(thread.lastMessageAt)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" className="bg-background" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
          <span className="text-muted-foreground">{page} / {totalPages}</span>
          <Button variant="outline" className="bg-background" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</Button>
        </div>
      )}
    </div>
    </DashboardLayout>
  );
}

function ThreadDetail({ threadId, onBack }: { threadId: number; onBack: () => void }) {
  const [replyContent, setReplyContent] = useState("");
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.message.detail.useQuery(
    { threadId },
    { refetchInterval: 15000 },
  );

  const replyMutation = trpc.message.reply.useMutation({
    onSuccess: () => {
      setReplyContent("");
      utils.message.detail.invalidate({ threadId });
      toast.success("回复已发送");
    },
    onError: err => toast.error(err.message || "回复失败"),
  });

  const statusMutation = trpc.message.setStatus.useMutation({
    onSuccess: (_d, vars) => {
      utils.message.detail.invalidate({ threadId });
      toast.success(vars.status === "closed" ? "会话已关闭" : "会话已重新打开");
    },
    onError: err => toast.error(err.message || "操作失败"),
  });

  const thread = data?.thread;
  const companyProfile = (thread as { companyProfile?: CompanyProfileSnapshot | null } | undefined)?.companyProfile ?? null;
  const hasCompanyProfile = !!companyProfile && Object.values(companyProfile).some(v => v != null && v !== "");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" /> 返回消息列表
        </Button>
      </div>

      {isLoading || !thread ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold">{thread.subject || "（无主题）"}</h1>
                <ThreadTypeBadge type={(thread as { threadType?: string }).threadType} />
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-muted-foreground">
                <span>{thread.threadNo}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {thread.status === "open" ? (
                <Button
                  variant="outline" className="bg-background" size="sm"
                  onClick={() => statusMutation.mutate({ threadId, status: "closed" })}
                  disabled={statusMutation.isPending}
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" /> 关闭会话
                </Button>
              ) : (
                <Button
                  variant="outline" className="bg-background" size="sm"
                  onClick={() => statusMutation.mutate({ threadId, status: "open" })}
                  disabled={statusMutation.isPending}
                >
                  <RotateCcw className="h-4 w-4 mr-1" /> 重新打开
                </Button>
              )}
            </div>
          </div>

          {/* 客户信息卡片：联系方式 + 公司资料 */}
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <User className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">客户信息</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground shrink-0">联系人</span>
                <span className="font-medium">{thread.contactName || "—"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground shrink-0">电话</span>
                {thread.contactPhone ? (
                  <a href={`tel:${thread.contactPhone}`} className="font-medium text-primary hover:underline">{thread.contactPhone}</a>
                ) : <span>—</span>}
              </div>
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground shrink-0">邮箱</span>
                {thread.contactEmail ? (
                  <a href={`mailto:${thread.contactEmail}`} className="font-medium text-primary hover:underline truncate">{thread.contactEmail}</a>
                ) : <span>—</span>}
              </div>
            </div>
            {hasCompanyProfile && (
              <>
                <div className="flex items-center gap-2 mt-4 mb-3 pt-3 border-t">
                  <Building2 className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">公司资料</span>
                  {companyProfile?.certLevel && (
                    <Badge variant="secondary">{companyProfile.certLevel}</Badge>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-sm">
                  {companyProfile?.companyName && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground shrink-0">企业名称</span>
                      <span className="font-medium truncate">{companyProfile.companyName}</span>
                    </div>
                  )}
                  {companyProfile?.creditCode && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground shrink-0">统一社会信用代码</span>
                      <span className="font-medium truncate">{companyProfile.creditCode}</span>
                    </div>
                  )}
                  {companyProfile?.companyType && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground shrink-0">企业类型</span>
                      <span className="font-medium">{companyProfile.companyType}</span>
                    </div>
                  )}
                  {companyProfile?.legalPerson && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground shrink-0">法定代表人</span>
                      <span className="font-medium">{companyProfile.legalPerson}</span>
                    </div>
                  )}
                  {companyProfile?.companyRole && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground shrink-0">企业角色</span>
                      <span className="font-medium">{companyProfile.companyRole}</span>
                    </div>
                  )}
                  {companyProfile?.regAddress && (
                    <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-3">
                      <span className="text-muted-foreground shrink-0">注册地址</span>
                      <span className="font-medium truncate">{companyProfile.regAddress}</span>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="rounded-lg border bg-card p-4 space-y-4 max-h-[52vh] overflow-y-auto">
            {data.messages.map(m => (
              <div key={m.id} className={`flex ${m.senderType === "admin" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                  m.senderType === "admin"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}>
                  <div className={`text-xs mb-1 ${m.senderType === "admin" ? "text-primary-foreground/75" : "text-muted-foreground"}`}>
                    {m.senderType === "admin" ? `${m.senderName ?? "平台客服"}（后台）` : (m.senderName || "前台用户")}
                    <span className="ml-2">{formatTime(m.createdAt)}</span>
                  </div>
                  <div className="whitespace-pre-wrap break-words">{m.content}</div>
                </div>
              </div>
            ))}
          </div>

          {thread.status === "open" ? (
            <div className="rounded-lg border bg-card p-3 space-y-2">
              <Textarea
                placeholder="输入回复内容...（前台用户可在其会话中看到回复）"
                value={replyContent}
                onChange={e => setReplyContent(e.target.value)}
                rows={3}
              />
              <div className="flex justify-end">
                <Button
                  onClick={() => {
                    const content = replyContent.trim();
                    if (!content) { toast.error("请输入回复内容"); return; }
                    replyMutation.mutate({ threadId, content });
                  }}
                  disabled={replyMutation.isPending}
                >
                  <Send className="h-4 w-4 mr-1" />
                  {replyMutation.isPending ? "发送中..." : "发送回复"}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-2">
              会话已关闭。如需继续沟通，请点击"重新打开"。
            </p>
          )}
        </>
      )}
    </div>
  );
}
