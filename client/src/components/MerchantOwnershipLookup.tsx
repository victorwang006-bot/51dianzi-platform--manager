import { formatDateTime } from "@/components/admin/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  Building2,
  Check,
  ExternalLink,
  Mail,
  Phone,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type LookupTab = "lookup" | "mine" | "pending";
type RequestType = "claim" | "collaborate" | "transfer";

const requestTypeLabel: Record<RequestType, string> = {
  claim: "认领",
  collaborate: "协作",
  transfer: "转交",
};

const requestStatusLabel: Record<string, string> = {
  pending: "待审批",
  approved: "已通过",
  rejected: "已拒绝",
  cancelled: "已取消",
};

function RequestStatus({ status }: { status: string }) {
  const style = status === "approved"
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : status === "rejected" || status === "cancelled"
      ? "bg-slate-50 text-slate-600 border-slate-200"
      : "bg-amber-50 text-amber-700 border-amber-200";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${style}`}>
      {requestStatusLabel[status] ?? status}
    </span>
  );
}

export default function MerchantOwnershipLookup({
  open,
  onOpenChange,
  isSuperAdmin,
  onOpenMerchant,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSuperAdmin: boolean;
  onOpenMerchant: (merchantId: number) => void;
}) {
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<LookupTab>("lookup");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [requestTarget, setRequestTarget] = useState<{
    merchantId: number;
    companyName: string;
    requestType: RequestType;
    verificationToken: string;
  } | null>(null);
  const [requestReason, setRequestReason] = useState("");
  const [reviewTargetId, setReviewTargetId] = useState<number | null>(null);
  const [reviewNote, setReviewNote] = useState("");

  useEffect(() => {
    if (!open) {
      setRequestTarget(null);
      setRequestReason("");
      setReviewTargetId(null);
      setReviewNote("");
    }
  }, [open]);

  const searchQuery = trpc.merchant.ownershipSearch.useQuery(
    { query },
    { enabled: open && tab === "lookup" && query.length >= 2, retry: false },
  );
  const myRequests = trpc.merchant.myOwnershipRequests.useQuery(undefined, {
    enabled: open && tab === "mine",
  });
  const pendingRequests = trpc.merchant.pendingOwnershipRequests.useQuery(undefined, {
    enabled: open && tab === "pending" && isSuperAdmin,
  });

  const createRequest = trpc.merchant.createOwnershipRequest.useMutation({
    onSuccess: result => {
      toast.success(result.idempotent ? "已有待处理申请，无需重复提交" : "申请已提交，等待超级管理员处理");
      setRequestTarget(null);
      setRequestReason("");
      utils.merchant.myOwnershipRequests.invalidate();
      if (isSuperAdmin) utils.merchant.pendingOwnershipRequests.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  const reviewRequest = trpc.merchant.reviewOwnershipRequest.useMutation({
    onSuccess: (_result, variables) => {
      toast.success(variables.decision === "approved" ? "申请已通过" : "申请已拒绝");
      setReviewTargetId(null);
      setReviewNote("");
      utils.merchant.pendingOwnershipRequests.invalidate();
      utils.merchant.myOwnershipRequests.invalidate();
      utils.merchant.list.invalidate();
      utils.merchant.salesOwnerFilterOptions.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  const submittedQueryLabel = useMemo(() => query.trim(), [query]);
  const doLookup = () => {
    const normalized = draft.trim();
    if (normalized.length < 2) {
      toast.error("请至少输入 2 个字符");
      return;
    }
    setQuery(normalized);
    setRequestTarget(null);
  };

  const beginRequest = (merchantId: number, companyName: string, requestType: RequestType, verificationToken: string) => {
    setRequestTarget({ merchantId, companyName, requestType, verificationToken });
    setRequestReason("");
  };

  const openMerchant = (merchantId: number) => {
    onOpenChange(false);
    onOpenMerchant(merchantId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            客户归属查询
          </DialogTitle>
          <DialogDescription>
            客户开发前先查重。范围外客户只展示最少归属信息，不展示客户联系方式或经营资料。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1 border-b bg-muted/20 px-6 py-2">
          {([
            ["lookup", "查客户"],
            ["mine", "我的申请"],
            ...(isSuperAdmin ? [["pending", "待审批"]] : []),
          ] as [LookupTab, string][]).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={tab === value ? "secondary" : "ghost"}
              className={tab === value ? "text-primary" : ""}
              onClick={() => setTab(value)}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="max-h-[68vh] overflow-y-auto px-6 py-5">
          {tab === "lookup" && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Input
                  value={draft}
                  onChange={event => setDraft(event.target.value)}
                  onKeyDown={event => event.key === "Enter" && doLookup()}
                  placeholder="公司名称 / 信用代码 / 商户编号 / 联系手机号 / 联系人"
                  autoFocus
                />
                <Button type="button" onClick={doLookup} disabled={searchQuery.isFetching}>
                  <Search className="mr-1 h-4 w-4" />
                  查询归属
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                每个账号每分钟最多查询 30 次、24 小时最多 300 次；系统只保存查询摘要用于防止批量枚举。
              </p>

              {searchQuery.isFetching && <p className="py-8 text-center text-sm text-muted-foreground">正在核对客户归属…</p>}
              {!searchQuery.isFetching && submittedQueryLabel && searchQuery.data?.results.length === 0 && (
                <div className="rounded-lg border border-dashed py-10 text-center">
                  <Building2 className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
                  <p className="font-medium">暂无登记记录</p>
                  <p className="mt-1 text-sm text-muted-foreground">可按现有流程录入客户；录入前请再次核对公司全称或信用代码。</p>
                </div>
              )}

              <div className="space-y-3">
                {searchQuery.data?.results.map(result => {
                  const unassigned = !result.ownerCode;
                  const hasContact = Boolean(result.ownerEmail || result.ownerPhone);
                  return (
                    <div key={result.id} className="rounded-lg border bg-card p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-foreground">{result.companyName}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className={`rounded-full border px-2 py-0.5 ${unassigned ? "bg-slate-50" : "border-blue-200 bg-blue-50 text-blue-700"}`}>
                              {unassigned ? "未分配销售" : "跟进中"}
                            </span>
                            <span>负责人：{result.ownerName || "未分配"}{result.ownerCode ? `（${result.ownerCode}）` : ""}</span>
                            <span>记录更新：{formatDateTime(result.updatedAt)}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {result.inScope ? (
                            <Button type="button" size="sm" variant="outline" onClick={() => openMerchant(result.id)}>
                              查看详情 <ExternalLink className="ml-1 h-3.5 w-3.5" />
                            </Button>
                          ) : unassigned ? (
                            <Button type="button" size="sm" onClick={() => beginRequest(result.id, result.companyName, "claim", result.requestToken)}>
                              <UserPlus className="mr-1 h-4 w-4" />申请认领
                            </Button>
                          ) : (
                            <>
                              <Button type="button" size="sm" variant="outline" onClick={() => beginRequest(result.id, result.companyName, "collaborate", result.requestToken)}>
                                <Users className="mr-1 h-4 w-4" />申请协作
                              </Button>
                              <Button type="button" size="sm" variant="outline" onClick={() => beginRequest(result.id, result.companyName, "transfer", result.requestToken)}>
                                申请转交
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                      {!unassigned && hasContact && (
                        <div className="mt-3 flex flex-wrap gap-3 border-t pt-3 text-xs">
                          {result.ownerPhone && (
                            <a className="inline-flex items-center gap-1 text-primary hover:underline" href={`tel:${result.ownerPhone}`}>
                              <Phone className="h-3.5 w-3.5" />联系负责人 {result.ownerPhone}
                            </a>
                          )}
                          {result.ownerEmail && (
                            <a className="inline-flex items-center gap-1 text-primary hover:underline" href={`mailto:${result.ownerEmail}`}>
                              <Mail className="h-3.5 w-3.5" />{result.ownerEmail}
                            </a>
                          )}
                        </div>
                      )}
                      {requestTarget?.merchantId === result.id && (
                        <div className="mt-4 rounded-md bg-muted/35 p-3">
                          <p className="mb-2 text-sm font-medium">申请{requestTypeLabel[requestTarget.requestType]}：{requestTarget.companyName}</p>
                          <Textarea
                            value={requestReason}
                            onChange={event => setRequestReason(event.target.value)}
                            placeholder="说明客户来源、合作背景或转交原因（至少5个字符）"
                            rows={3}
                          />
                          <div className="mt-2 flex justify-end gap-2">
                            <Button type="button" size="sm" variant="ghost" onClick={() => setRequestTarget(null)}>取消</Button>
                            <Button
                              type="button"
                              size="sm"
                              disabled={requestReason.trim().length < 5 || createRequest.isPending}
                              onClick={() => createRequest.mutate({
                                merchantId: requestTarget.merchantId,
                                requestType: requestTarget.requestType,
                                reason: requestReason.trim(),
                                verificationToken: requestTarget.verificationToken,
                              })}
                            >
                              提交申请
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "mine" && (
            <RequestList
              loading={myRequests.isLoading}
              rows={myRequests.data ?? []}
              emptyText="暂无客户归属申请"
            />
          )}

          {tab === "pending" && isSuperAdmin && (
            <div className="space-y-3">
              {pendingRequests.isLoading && <p className="py-8 text-center text-sm text-muted-foreground">正在加载待审批申请…</p>}
              {!pendingRequests.isLoading && (pendingRequests.data?.length ?? 0) === 0 && (
                <p className="py-10 text-center text-sm text-muted-foreground">暂无待审批申请</p>
              )}
              {pendingRequests.data?.map(row => (
                <div key={row.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{row.companyName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.requesterName}（{row.requesterStaffCode}）申请{requestTypeLabel[row.requestType]} · 当前负责人：{row.ownerName || "未分配"}
                      </p>
                      <p className="mt-2 text-sm">{row.reason}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</span>
                  </div>
                  {reviewTargetId === row.id ? (
                    <div className="mt-3 rounded-md bg-muted/35 p-3">
                      <Input
                        value={reviewNote}
                        onChange={event => setReviewNote(event.target.value)}
                        placeholder="审批备注（选填）"
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <Button type="button" size="sm" variant="ghost" onClick={() => setReviewTargetId(null)}>取消</Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={reviewRequest.isPending}
                          onClick={() => reviewRequest.mutate({ requestId: row.id, decision: "rejected", reviewNote: reviewNote.trim() || undefined })}
                        >
                          <X className="mr-1 h-4 w-4" />拒绝
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={reviewRequest.isPending}
                          onClick={() => reviewRequest.mutate({ requestId: row.id, decision: "approved", reviewNote: reviewNote.trim() || undefined })}
                        >
                          <Check className="mr-1 h-4 w-4" />通过
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex justify-end">
                      <Button type="button" size="sm" variant="outline" onClick={() => { setReviewTargetId(row.id); setReviewNote(""); }}>
                        处理申请
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RequestList({
  loading,
  rows,
  emptyText,
}: {
  loading: boolean;
  rows: Array<{
    id: number;
    companyName: string;
    requestType: RequestType;
    status: string;
    reason: string;
    ownerName: string | null;
    reviewNote: string | null;
    createdAt: Date | string;
  }>;
  emptyText: string;
}) {
  if (loading) return <p className="py-8 text-center text-sm text-muted-foreground">正在加载申请记录…</p>;
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <div className="space-y-3">
      {rows.map(row => (
        <div key={row.id} className="rounded-lg border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-medium">{row.companyName}</p>
                <RequestStatus status={row.status} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                申请{requestTypeLabel[row.requestType]} · 当前负责人：{row.ownerName || "未分配"} · {formatDateTime(row.createdAt)}
              </p>
              <p className="mt-2 text-sm">{row.reason}</p>
              {row.reviewNote && <p className="mt-2 text-xs text-muted-foreground">审批备注：{row.reviewNote}</p>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
