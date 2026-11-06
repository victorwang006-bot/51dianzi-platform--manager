import { useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { formatDateTime } from "@/components/admin/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { hasAdminPermission, type AdminRole } from "@shared/adminPermissions";
import { toast } from "sonner";

type ReviewSummary = {
  companyName: string;
  unifiedSocialCreditCode: string;
  legalRepresentative: string;
  registeredAddress: string;
  bankAccountName: string;
  bankName: string;
  bankAccountNumberMasked: string | null;
  documents: Record<"BUSINESS_LICENSE" | "BANK_LICENSE", { available: boolean; fileName: string | null }>;
};
type CnRegistrationReviewDetailProps = {
  merchantId: number;
  onClose?: () => void;
  onReviewed?: () => void;
};
const SIMPLE_DEFAULT = "当前资料暂不能审核，请刷新后重试。";
function displayValue(value: unknown) { return typeof value === "string" && value ? value : "—"; }

function Summary({ summary }: { summary: ReviewSummary }) {
  const fields: Array<[string, string | null]> = [
    ["企业名称", summary.companyName], ["统一社会信用代码", summary.unifiedSocialCreditCode],
    ["法定代表人", summary.legalRepresentative], ["注册地址", summary.registeredAddress],
    ["账户名称", summary.bankAccountName], ["开户行", summary.bankName], ["账户号码", summary.bankAccountNumberMasked],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2" data-review-summary>
      {fields.map(([label, value]) => <div className="min-w-0" key={label}>
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="mt-1 break-all text-sm">{displayValue(value)}</dd>
      </div>)}
      {(["BUSINESS_LICENSE", "BANK_LICENSE"] as const).map(kind => <div className="min-w-0" key={kind} data-review-document={kind}>
        <dt className="text-xs text-muted-foreground">{kind === "BUSINESS_LICENSE" ? "营业执照" : "银行许可证"}</dt>
        <dd className="mt-1 break-all text-sm">{summary.documents[kind].available ? displayValue(summary.documents[kind].fileName) : "—"}</dd>
      </div>)}
    </dl>
  );
}

/** The displayed pending version is the human-confirmation snapshot, not a guessed version. */
export default function CnRegistrationReviewDetail({ merchantId, onClose, onReviewed }: CnRegistrationReviewDetailProps) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [expectedVersion, setExpectedVersion] = useState<string | null>(null);
  const [portalUserId, setPortalUserId] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const detailQuery = trpc.merchant.getCnRegistrationReviewDetail.useQuery({ id: merchantId }, {
    enabled: Number.isInteger(merchantId) && merchantId > 0,
    retry: false, staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true,
  });
  const detail = detailQuery.data;
  const candidate = detail?.candidate ?? null;
  const adminRole = (user?.adminRole ?? "super_admin") as AdminRole;
  const adminPermissions = (user as { permissions?: string[] } | null)?.permissions;
  const mayApprove = Boolean(user) && hasAdminPermission(adminRole, "merchants.write", adminPermissions);
  const readableCandidate = detail?.region === "CN" && typeof candidate?.expectedVersion === "string" && candidate.expectedVersion.trim().length > 0;
  const versionChanged = Boolean(candidate && expectedVersion && candidate.expectedVersion !== expectedVersion);
  // Registration resubmission does not silently resume a paused/rejected ERP or reopen an enabled one.
  const retainCrmStatus = detail?.reviewKind === "resubmission" && ["enabled", "disabled", "rejected"].includes(detail.crmStatus);
  const alreadyReviewed = !candidate && detail?.reviewStatus === "approved" && Boolean(detail.effective);
  const boundOwner = detail?.crmOwnerPortalUserId?.trim() || "";
  const owner = boundOwner || portalUserId.trim();

  useEffect(() => {
    setExpectedVersion(null); setPortalUserId(""); setRejecting(false); setNote("");
  }, [merchantId]);
  useEffect(() => {
    if (readableCandidate && candidate && !expectedVersion) setExpectedVersion(candidate.expectedVersion);
  }, [readableCandidate, candidate?.expectedVersion, expectedVersion]);

  const afterSuccess = async (message: string) => {
    toast.success(message);
    setRejecting(false); setNote("");
    onReviewed?.();
    onClose?.();
    await Promise.all([detailQuery.refetch(), utils.merchant.list.invalidate(), utils.merchant.listCnRegistrationReviewQueue.invalidate()]);
  };
  const combinedMutation = trpc.merchant.approveCnRegistrationAndEnableCrm.useMutation({
    onSuccess: result => {
      if (!result.success) { toast.error("操作未完成，请刷新后重试"); return; }
      void afterSuccess(result.idempotent ? "该审核与开通请求已处理" : "企业资料已审核通过，ERP 已开通");
    },
    onError: error => toast.error(error.message),
  });
  const reviewMutation = trpc.merchant.reviewCnRegistrationDraft.useMutation({
    onSuccess: result => {
      if (!result.success) { toast.error("审核未完成，请刷新后重试"); return; }
      void afterSuccess(result.decision === "approved" ? "企业资料已审核通过，原 ERP 状态保持不变" : "已退回候选资料");
    },
    onError: error => toast.error(error.message),
  });
  const crmMutation = trpc.merchant.setCrmStatus.useMutation({
    onSuccess: result => {
      if (!result.success) { toast.error(result.message); return; }
      void afterSuccess(detail?.crmStatus === "disabled" ? "ERP 已恢复" : "ERP 已开通");
    },
    onError: error => toast.error(error.message),
  });
  const busy = combinedMutation.isPending || reviewMutation.isPending || crmMutation.isPending;
  const actionDisabled = busy || detailQuery.isFetching || !mayApprove || versionChanged
    || (!alreadyReviewed && (!detail?.canReview || !readableCandidate || !expectedVersion));
  const approveDisabled = actionDisabled || (!retainCrmStatus && !owner);
  const refresh = async () => {
    const result = await detailQuery.refetch();
    if (result.data?.candidate) setExpectedVersion(result.data.candidate.expectedVersion);
    setRejecting(false); setNote("");
  };
  const submitApproval = () => {
    if (approveDisabled || !detail) return;
    if (alreadyReviewed) {
      // An already-approved company uses the original ERP grant without re-reviewing it.
      crmMutation.mutate({ id: merchantId, crmStatus: "enabled", portalUserId: owner, note: note.trim() || undefined });
      return;
    }
    if (!detail?.canReview || !mayApprove || !readableCandidate || !candidate || !expectedVersion || versionChanged) return;
    if (retainCrmStatus) {
      reviewMutation.mutate({ id: merchantId, decision: "approved", expectedVersion, confirmed: true, note: note.trim() || undefined });
    } else {
      // confirmed is supplied only by this explicit human click, never by loading the page.
      combinedMutation.mutate({ id: merchantId, expectedVersion, confirmed: true, portalUserId: owner, note: note.trim() || undefined });
    }
  };
  const submitRejection = () => {
    if (actionDisabled || !candidate || !expectedVersion || !note.trim()) return;
    reviewMutation.mutate({ id: merchantId, decision: "rejected", expectedVersion, note: note.trim() });
  };
  const EmptyDetail = ({ message }: { message: string }) => <div className="space-y-3" data-cn-registration-review-empty>
    <p role="status" className="text-sm text-muted-foreground">{message}</p>
    <div className="flex gap-2">
      <Button type="button" variant="outline" size="sm" disabled={detailQuery.isFetching || busy} onClick={() => void refresh()} data-review-refresh>刷新资料</Button>
      {onClose ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>关闭</Button> : null}
    </div>
  </div>;
  if (detailQuery.isLoading) return <p role="status" className="text-sm text-muted-foreground">资料加载中…</p>;
  if (detailQuery.isError) return <EmptyDetail message={detailQuery.error?.message || "资料加载失败，请刷新后重试。"} />;
  if (!detail || detail.region !== "CN") return <EmptyDetail message="尚未读取到该待审申请的详情，请刷新资料后重试。" />;
  if ((!readableCandidate || !candidate) && !alreadyReviewed) return <EmptyDetail message="资料加载不完整，请刷新后重试。" />;
  const confirmationText = alreadyReviewed ? "企业资料已经审核通过。本次确认仅开通 ERP，不修改资料或负责人绑定。"
    : retainCrmStatus ? "确认已核对以下候选企业资料并审核通过；保持现有 ERP 开通、暂停或拒绝状态，不更换绑定账号。"
    : "请核对以下企业资料与前台用户。点击确认将同时审核通过企业资料并开通 ERP；任一校验失败，两项均不生效，不更换已有绑定账号。";
  return <div className="space-y-4" data-cn-registration-review-detail>
    {detail.reviewNotice || (!detail.canReview && !alreadyReviewed) ? <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm" data-review-notice={Boolean(detail.reviewNotice)} data-review-blocked={!detail.canReview}>
      {detail.reviewNotice || detail.reviewBlockedReason || SIMPLE_DEFAULT}
    </p> : null}
    {versionChanged ? <p role="alert" className="text-sm text-amber-900" data-review-version-changed>待审核资料已变化，请刷新后重新核对</p> : null}
    <Card><CardContent className="space-y-4 py-4">
      {detail.effective ? <Summary summary={detail.effective} /> : null}
      {candidate ? <Summary summary={candidate.summary} /> : null}
      {detail.differences.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm" data-review-differences><tbody>
        {detail.differences.map(row => <tr className="border-t" key={row.field}>
          <th scope="row" className="py-2 pr-3 text-xs font-medium text-muted-foreground">{row.label}</th>
          <td className="py-2 pr-3 break-all">{displayValue(row.before)}</td><td className="py-2 break-all">{displayValue(row.after)}</td>
        </tr>)}
      </tbody></table></div> : null}
      {candidate?.submittedAt ? <p className="text-xs text-muted-foreground">{formatDateTime(candidate.submittedAt)}</p> : null}
    </CardContent></Card>
    <p className="text-sm" data-review-confirmation>{confirmationText}</p>
    {!retainCrmStatus ? <div className="space-y-2">
      <label htmlFor="cn-crm-owner" className="text-sm font-medium">前台用户 ID</label>
      <Input id="cn-crm-owner" value={boundOwner || portalUserId} disabled={busy || Boolean(boundOwner)} onChange={event => setPortalUserId(event.target.value)} placeholder="核对申请人提交的前台用户 ID" />
      <p className="text-xs text-muted-foreground">{boundOwner ? "保留商户现有绑定账号，不会改绑。" : "必须与企业正式负责人一致；系统不会猜测或自动改绑。"}</p>
    </div> : null}
    <Textarea value={note} maxLength={1000} disabled={busy} onChange={event => setNote(event.target.value)} placeholder={rejecting ? "退回资料原因（必填）" : "审核备注（选填）"} />
    <div className="flex flex-wrap gap-2 border-t pt-4" data-review-actions>
      {!rejecting ? <Button type="button" size="sm" disabled={approveDisabled} onClick={submitApproval} data-review-approve data-review-submit>
        {busy ? "处理中…" : alreadyReviewed ? "确认通过（开通 ERP）" : retainCrmStatus ? "确认通过（保留 ERP 状态）" : "确认通过（审核并开通 ERP）"}
      </Button> : <Button type="button" size="sm" disabled={actionDisabled || !note.trim()} onClick={submitRejection} data-review-submit>确认退回</Button>}
      {candidate ? <Button type="button" variant="outline" size="sm" disabled={actionDisabled} onClick={() => { setRejecting(!rejecting); setNote(""); }} data-review-reject>{rejecting ? "取消退回" : "退回候选资料"}</Button> : null}
      <Button type="button" variant="outline" size="sm" disabled={detailQuery.isFetching || busy} onClick={() => void refresh()} data-review-refresh>{detailQuery.isFetching ? "刷新中…" : "刷新资料"}</Button>
      {onClose ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>关闭</Button> : null}
    </div>
  </div>;
}
