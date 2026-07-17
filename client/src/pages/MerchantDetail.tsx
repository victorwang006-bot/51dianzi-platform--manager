import DashboardLayout from "@/components/DashboardLayout";
import {
  PageHeader,
  StatusBadge,
  merchantStatusMap,
  agreementStatusMap,
  formatDateTime,
} from "@/components/admin/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CreditCard,
  FileImage,
  FileText,
  Landmark,
  Mail,
  Phone,
  ScrollText,
  ShieldCheck,
  User,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation, useRoute } from "wouter";

function InfoItem({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value?: string | null;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-[#8a94a6] flex items-center gap-1">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </span>
      <span className="text-sm text-foreground break-all">{value || "—"}</span>
    </div>
  );
}

export default function MerchantDetail() {
  const [, params] = useRoute("/merchants/:id");
  const [, navigate] = useLocation();
  const id = Number(params?.id);

  const { data: merchant, isLoading } = trpc.merchant.detail.useQuery(
    { id },
    { enabled: Number.isFinite(id) && id > 0 }
  );

  const utils = trpc.useUtils();
  const [reviewDialog, setReviewDialog] = useState<{
    open: boolean;
    action: "approve" | "reject" | "supplement" | "suspend" | "reactivate" | null;
  }>({ open: false, action: null });
  const [note, setNote] = useState("");

  const reviewMutation = trpc.merchant.review.useMutation({
    onSuccess: () => {
      toast.success("操作成功");
      utils.merchant.detail.invalidate({ id });
      utils.merchant.list.invalidate();
      setReviewDialog({ open: false, action: null });
      setNote("");
    },
    onError: e => toast.error(e.message || "操作失败"),
  });

  const actionLabels: Record<string, string> = {
    approve: "审核通过",
    reject: "审核拒绝",
    supplement: "要求补件",
    suspend: "暂停商户",
    reactivate: "恢复商户",
  };

  const openReview = (action: typeof reviewDialog.action) =>
    setReviewDialog({ open: true, action });

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="space-y-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-60 rounded-xl" />
        </div>
      </DashboardLayout>
    );
  }

  if (!merchant) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <p className="text-muted-foreground">未找到该商户</p>
          <Button variant="outline" onClick={() => navigate("/merchants")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> 返回商户列表
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="mb-4">
        <Button
          variant="ghost"
          size="sm"
          className="text-[#8a94a6] hover:text-primary -ml-2"
          onClick={() => navigate("/merchants")}
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> 返回商户列表
        </Button>
      </div>

      <PageHeader
        title={merchant.companyName}
        description={`商户编号 ${merchant.merchantNo} · 入驻时间 ${formatDateTime(merchant.createdAt)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {(merchant.status === "pending" || merchant.status === "supplement") && (
              <>
                <Button size="sm" onClick={() => openReview("approve")}>
                  通过
                </Button>
                <Button size="sm" variant="outline" onClick={() => openReview("supplement")}>
                  补件
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => openReview("reject")}
                >
                  拒绝
                </Button>
              </>
            )}
            {merchant.status === "approved" && (
              <Button size="sm" variant="outline" onClick={() => openReview("suspend")}>
                暂停
              </Button>
            )}
            {merchant.status === "suspended" && (
              <Button size="sm" onClick={() => openReview("reactivate")}>
                恢复
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <StatusBadge {...(merchantStatusMap[merchant.status] ?? { label: merchant.status, style: "gray" as const })} />
        <StatusBadge {...(agreementStatusMap[merchant.agreementStatus] ?? { label: merchant.agreementStatus, style: "gray" as const })} />
        {merchant.commissionRate && (
          <Badge variant="outline" className="text-xs font-normal">
            佣金费率 {(Number(merchant.commissionRate) * 100).toFixed(2)}%
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* 企业工商信息 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" />
                企业工商信息
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                <InfoItem label="企业名称" value={merchant.companyName} icon={Building2} />
                <InfoItem
                  label="统一社会信用代码"
                  value={merchant.businessLicense}
                  icon={FileText}
                />
                <InfoItem label="注册资本" value={merchant.registeredCapital} icon={Landmark} />
                <InfoItem
                  label="成立日期"
                  value={
                    merchant.establishedDate
                      ? new Date(merchant.establishedDate).toLocaleDateString("zh-CN")
                      : null
                  }
                  icon={CalendarDays}
                />
                <InfoItem
                  label="营业执照到期"
                  value={
                    merchant.licenseExpiry
                      ? new Date(merchant.licenseExpiry).toLocaleDateString("zh-CN")
                      : null
                  }
                  icon={ShieldCheck}
                />
                <InfoItem label="注册地址" value={merchant.registeredAddress} />
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <span className="text-xs text-[#8a94a6] flex items-center gap-1 mb-1">
                  <ScrollText className="h-3.5 w-3.5" /> 经营范围
                </span>
                <p className="text-sm leading-relaxed text-foreground">
                  {merchant.businessScope || "—"}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* 营业执照 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileImage className="h-4 w-4 text-primary" />
                营业执照
              </CardTitle>
            </CardHeader>
            <CardContent>
              {merchant.licenseImageUrl ? (
                <a href={merchant.licenseImageUrl} target="_blank" rel="noreferrer">
                  <img
                    src={merchant.licenseImageUrl}
                    alt="营业执照"
                    className="max-h-80 rounded-lg border border-border hover:shadow-md transition-shadow"
                  />
                </a>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-[#b3bcc9] border border-dashed border-border rounded-lg">
                  <FileImage className="h-8 w-8 mb-2" />
                  <p className="text-sm">商户尚未上传营业执照图片</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 审核记录 */}
          {merchant.reviewNote && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  最近审核备注
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-foreground">{merchant.reviewNote}</p>
                {merchant.reviewedAt && (
                  <p className="text-xs text-[#8a94a6] mt-2">
                    审核时间：{formatDateTime(merchant.reviewedAt)}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {/* 法人信息 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <UserRound className="h-4 w-4 text-primary" />
                法人信息
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <InfoItem label="法人姓名" value={merchant.legalPersonName} icon={User} />
              <InfoItem label="法人身份证号" value={merchant.legalPersonIdNo} icon={FileText} />
              <InfoItem label="法人联系电话" value={merchant.legalPersonPhone} icon={Phone} />
            </CardContent>
          </Card>

          {/* 联系人信息 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <User className="h-4 w-4 text-primary" />
                联系人信息
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <InfoItem label="联系人" value={merchant.contactName} icon={User} />
              <InfoItem label="联系电话" value={merchant.contactPhone} icon={Phone} />
              <InfoItem label="联系邮箱" value={merchant.contactEmail} icon={Mail} />
            </CardContent>
          </Card>

          {/* 结算账户 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-primary" />
                结算账户
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <InfoItem label="开户名" value={merchant.settlementAccountName} />
              <InfoItem label="开户银行" value={merchant.settlementBank} icon={Landmark} />
              <InfoItem label="银行账号" value={merchant.settlementAccount} icon={CreditCard} />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 审核操作对话框 */}
      <Dialog
        open={reviewDialog.open}
        onOpenChange={open => !open && setReviewDialog({ open: false, action: null })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reviewDialog.action ? actionLabels[reviewDialog.action] : ""} · {merchant.companyName}
            </DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="请填写操作备注（选填）"
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReviewDialog({ open: false, action: null })}
            >
              取消
            </Button>
            <Button
              disabled={reviewMutation.isPending}
              onClick={() =>
                reviewDialog.action &&
                reviewMutation.mutate({ id, action: reviewDialog.action, note: note || undefined })
              }
            >
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
