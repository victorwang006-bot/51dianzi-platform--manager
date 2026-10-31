import { useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { formatDateTime } from "@/components/admin/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { hasAdminPermission, type AdminRole } from "@shared/adminPermissions";
import { toast } from "sonner";

type ReviewDecision = "approved" | "rejected";
type ReviewDocuments = Record<
  "BUSINESS_LICENSE" | "BANK_LICENSE",
  { available: boolean; fileName: string | null }
>;
type ReviewSummary = {
  companyName: string;
  unifiedSocialCreditCode: string;
  legalRepresentative: string;
  registeredAddress: string;
  bankAccountName: string;
  bankName: string;
  bankAccountNumberMasked: string | null;
  documents: ReviewDocuments;
};
type ReviewDifference = {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
  changed: true;
};
type CnRegistrationReviewDetailData = {
  merchantId: number;
  region: "CN";
  reviewKind: "initial" | "resubmission" | null;
  effective: ReviewSummary | null;
  candidate: {
    expectedVersion: string;
    submittedAt: string | null;
    summary: ReviewSummary;
  } | null;
  differences: ReviewDifference[];
  reviewStatus: string;
  reviewBlockedReason: string | null;
  reviewBlockedCode: string | null;
  reviewNotice: string | null;
  canReview: boolean;
};

type CnRegistrationReviewDetailProps = {
  merchantId: number;
  onClose?: () => void;
  onReviewed?: () => void;
};

const SIMPLE_DEFAULT = "当前资料暂不能审核，请刷新后重试。";

function displayValue(value: string | null | undefined) {
  return value || "—";
}

function Summary({ summary }: { summary: ReviewSummary }) {
  const fields: Array<[string, string | null]> = [
    ["企业名称", summary.companyName],
    ["统一社会信用代码", summary.unifiedSocialCreditCode],
    ["法定代表人", summary.legalRepresentative],
    ["注册地址", summary.registeredAddress],
    ["账户名称", summary.bankAccountName],
    ["开户行", summary.bankName],
    ["账户号码", summary.bankAccountNumberMasked],
  ];

  return (
    <dl className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2" data-review-summary>
      {fields.map(([label, value]) => (
        <div className="min-w-0" key={label}>
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-1 break-all text-sm">{displayValue(value)}</dd>
        </div>
      ))}
      {(["BUSINESS_LICENSE", "BANK_LICENSE"] as const).map(kind => {
        const document = summary.documents[kind];
        const label = kind === "BUSINESS_LICENSE" ? "营业执照" : "银行许可证";
        return (
          <div className="min-w-0" key={kind} data-review-document={kind}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-all text-sm">{document.available ? displayValue(document.fileName) : "—"}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * Reinstates only the original CN-review client contract established by the
 * handwritten patch/test sources. Server-side scope, state, subject and CAS
 * guards remain authoritative; this component merely avoids offering an
 * unsafe client-side action when those facts are absent or stale.
 */
export default function CnRegistrationReviewDetail({
  merchantId,
  onClose,
  onReviewed,
}: CnRegistrationReviewDetailProps) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const [expectedVersion, setExpectedVersion] = useState<string | null>(null);
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const detailQuery = trpc.merchant.getCnRegistrationReviewDetail.useQuery(
    { id: merchantId },
    {
      enabled: Number.isInteger(merchantId) && merchantId > 0,
      retry: false,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
    },
  );
  const detail = detailQuery.data as CnRegistrationReviewDetailData | undefined;
  const candidate = detail?.candidate ?? null;
  const adminRole = (user?.adminRole ?? "super_admin") as AdminRole;
  const adminPermissions = (user as { permissions?: string[] } | null)?.permissions;
  const mayApprove = Boolean(user) && hasAdminPermission(adminRole, "merchants.write", adminPermissions);
  const readableCandidate = detail?.region === "CN"
    && typeof candidate?.expectedVersion === "string"
    && candidate.expectedVersion.trim().length > 0;
  const versionChanged = Boolean(
    decision
    && (!candidate || !expectedVersion || candidate.expectedVersion !== expectedVersion),
  );

  const closeDecision = () => {
    if (reviewMutation.isPending) return;
    setDecision(null);
    setExpectedVersion(null);
    setIdentityConfirmed(false);
    setNote("");
  };

  const reviewMutation = trpc.merchant.reviewCnRegistrationDraft.useMutation({
    onSuccess: async () => {
      await Promise.all([
        detailQuery.refetch(),
        utils.merchant.list.invalidate(),
        utils.merchant.listCnRegistrationReviewQueue.invalidate(),
      ]);
      closeDecision();
      onReviewed?.();
    },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    if (!decision || !candidate || !expectedVersion) return;
    if (candidate.expectedVersion !== expectedVersion) setIdentityConfirmed(false);
  }, [candidate?.expectedVersion, decision, expectedVersion]);

  const chooseDecision = (nextDecision: ReviewDecision) => {
    if (!detail?.canReview || !mayApprove || !readableCandidate || !candidate) return;
    setDecision(nextDecision);
    // Freeze the exact candidate that was inspected. A later refetch must not
    // let a reviewer submit confirmation for a newly supplied candidate.
    setExpectedVersion(candidate.expectedVersion);
    setIdentityConfirmed(false);
    setNote("");
  };

  const submitReview = () => {
    if (!decision || !candidate || !expectedVersion || versionChanged || !detail?.canReview || !mayApprove) return;
    if (decision === "approved" && !identityConfirmed) return;
    if (decision === "rejected" && !note.trim()) return;
    reviewMutation.mutate({
      id: merchantId,
      decision,
      expectedVersion,
      note: note.trim() || undefined,
      confirmed: decision === "approved" ? identityConfirmed : undefined,
    });
  };

  const EmptyDetail = ({ message }: { message: string }) => (
    <div className="space-y-3" data-cn-registration-review-empty>
      <p role="status" className="text-sm text-muted-foreground">{message}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={detailQuery.isFetching}
          onClick={() => void detailQuery.refetch()}
          data-review-refresh
        >
          {detailQuery.isFetching ? "刷新中…" : "刷新资料"}
        </Button>
        {onClose ? <Button type="button" variant="outline" size="sm" disabled={reviewMutation.isPending} onClick={onClose}>关闭</Button> : null}
      </div>
    </div>
  );

  if (detailQuery.isLoading) {
    return <p role="status" className="text-sm text-muted-foreground">资料加载中…</p>;
  }

  if (detailQuery.isError) {
    return <EmptyDetail message="资料加载失败，请刷新后重试。" />;
  }

  if (!detail || detail.region !== "CN") {
    return <EmptyDetail message="尚未读取到该待审申请的详情，请刷新资料后重试。" />;
  }

  if (!readableCandidate || !candidate) {
    return <EmptyDetail message="资料加载不完整，请刷新后重试。" />;
  }

  const actionDisabled = reviewMutation.isPending || !mayApprove || !detail.canReview || versionChanged;
  const actionTitle = !mayApprove
    ? "当前账号无审核权限"
    : !detail.canReview
      ? detail.reviewBlockedReason || SIMPLE_DEFAULT
      : versionChanged
        ? "待审核资料已变化，请刷新后重新核对"
        : undefined;

  return (
    <div className="space-y-4" data-cn-registration-review-detail>
      {detail.reviewNotice || !detail.canReview ? (
        <p
          role={detail.reviewNotice ? "status" : "alert"}
          className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          data-review-notice={Boolean(detail.reviewNotice)}
          data-review-blocked={!detail.canReview}
        >
          {detail.reviewNotice || detail.reviewBlockedReason || SIMPLE_DEFAULT}
        </p>
      ) : null}
      {versionChanged ? (
        <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-review-version-changed>
          待审核资料已变化，请刷新后重新核对
        </p>
      ) : null}

      <Card>
        <CardContent className="space-y-4 py-4">
          {detail.effective ? <Summary summary={detail.effective} /> : null}
          <Summary summary={candidate.summary} />
          {detail.differences.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm" data-review-differences>
                <tbody>
                  {detail.differences.map(row => (
                    <tr className="border-t" key={row.field}>
                      <th scope="row" className="py-2 pr-3 text-xs font-medium text-muted-foreground">{row.label}</th>
                      <td className="py-2 pr-3 break-all">{displayValue(row.before)}</td>
                      <td className="py-2 break-all">{displayValue(row.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {candidate.submittedAt ? <p className="text-xs text-muted-foreground">{formatDateTime(candidate.submittedAt)}</p> : null}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2 border-t pt-4" data-review-actions>
        <Button
          type="button"
          size="sm"
          disabled={actionDisabled}
          title={actionTitle}
          onClick={() => chooseDecision("approved")}
          data-review-approve
        >
          审核通过
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={actionDisabled}
          title={actionTitle}
          onClick={() => chooseDecision("rejected")}
          data-review-reject
        >
          退回候选资料
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={detailQuery.isFetching || reviewMutation.isPending}
          onClick={() => void detailQuery.refetch()}
          data-review-refresh
        >
          {detailQuery.isFetching ? "刷新中…" : "刷新资料"}
        </Button>
        {onClose ? <Button type="button" variant="outline" size="sm" disabled={reviewMutation.isPending} onClick={onClose}>关闭</Button> : null}
      </div>

      {decision ? (
        <Card data-review-decision>
          <CardContent className="space-y-3 py-4">
            {decision === "approved" ? (
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={identityConfirmed}
                  disabled={actionDisabled}
                  onCheckedChange={checked => setIdentityConfirmed(checked === true)}
                />
                <span>通过企业资料前必须确认已人工核对</span>
              </label>
            ) : (
              <Textarea
                value={note}
                maxLength={1000}
                disabled={actionDisabled}
                onChange={event => setNote(event.target.value)}
              />
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={actionDisabled || (decision === "approved" && !identityConfirmed) || (decision === "rejected" && !note.trim())}
                onClick={submitReview}
                data-review-submit
              >
                {reviewMutation.isPending ? "处理中…" : decision === "approved" ? "确认通过" : "确认退回"}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={reviewMutation.isPending} onClick={closeDecision}>关闭</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
