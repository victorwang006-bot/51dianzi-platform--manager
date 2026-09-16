import DashboardLayout from "@/components/DashboardLayout";
import {
  PageHeader,
  StatusBadge,
  agreementStatusMap,
  formatDateTime,
} from "@/components/admin/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CreditCard,
  FileImage,
  FileText,
  Landmark,
  Loader2,
  Mail,
  Pencil,
  Phone,
  ScrollText,
  ShieldCheck,
  User,
} from "lucide-react";
import { useState } from "react";
import { useLocation, useRoute } from "wouter";
import MerchantMaterialPanel from "@/components/admin/MerchantMaterialPanel";
import MerchantCompanyWallPanel from "@/components/admin/MerchantCompanyWallPanel";
import CollapsibleCard from "@/components/admin/CollapsibleCard";
import { formatBeijingDate } from "@shared/beijingTime";
import { toast } from "sonner";

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
  const [usernameEditing, setUsernameEditing] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState("");
  const utils = trpc.useUtils();

  const { data: merchant, isLoading } = trpc.merchant.detail.useQuery(
    { id },
    { enabled: Number.isFinite(id) && id > 0 }
  );
  const licenseAccess = trpc.merchant.licenseAccess.useMutation();
  const usernameMutation = trpc.merchant.setInternalContactName.useMutation({
    onSuccess: result => {
      toast.success(result.internalContactName ? "用户名已更新" : "已恢复原用户名");
      setUsernameEditing(false);
      void utils.merchant.detail.invalidate({ id: result.merchantId });
      void utils.merchant.list.invalidate();
    },
    onError: error => {
      toast.error(`用户名更新失败：${error.message}`);
      void utils.merchant.detail.invalidate({ id });
    },
  });

  const openBusinessLicense = async () => {
    const preview = window.open("about:blank", "_blank");
    if (preview) preview.opener = null;
    try {
      const result = await licenseAccess.mutateAsync({ id });
      if (preview) {
        preview.location.replace(result.url);
      } else {
        const anchor = document.createElement("a");
        anchor.href = result.url;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.click();
      }
    } catch (error) {
      preview?.close();
      toast.error(error instanceof Error ? error.message : "营业执照暂时无法查看");
    }
  };

  const startUsernameEdit = () => {
    setUsernameDraft(merchant?.internalContactName?.trim() || merchant?.contactName?.trim() || "");
    setUsernameEditing(true);
  };

  const saveUsername = () => {
    if (!merchant) return;
    const originalName = merchant.contactName?.normalize("NFKC").trim() || null;
    const nextName = usernameDraft.normalize("NFKC").trim() || null;
    usernameMutation.mutate({
      id: merchant.id,
      expectedInternalContactName: merchant.internalContactName?.normalize("NFKC").trim() || null,
      internalContactName: nextName === originalName ? null : nextName,
    });
  };

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
      />
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <StatusBadge {...(agreementStatusMap[merchant.agreementStatus] ?? { label: merchant.agreementStatus, style: "gray" as const })} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* 物料管理：已通过 CRM 的商户展示其前台发布的物料（默认展开） */}
          {merchant.crmStatus === "enabled" && merchant.crmOwnerPortalUserId && merchant.businessLicense && (
            <MerchantMaterialPanel creditCode={merchant.businessLicense} />
          )}

          {/* 企业工商信息 */}
          <CollapsibleCard title="企业工商信息" icon={Building2}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                <InfoItem label="企业名称" value={merchant.companyName} icon={Building2} />
                <InfoItem
                  label="统一社会信用代码"
                  value={merchant.businessLicense}
                  icon={FileText}
                />
                <InfoItem label="企业类型" value={merchant.companyType} icon={Building2} />
                <InfoItem label="企业角色" value={merchant.companyRole} icon={ShieldCheck} />
                <InfoItem label="注册资本" value={merchant.registeredCapital} icon={Landmark} />
                <InfoItem
                  label="成立日期"
                  value={
                    merchant.establishedDate
                      ? formatBeijingDate(merchant.establishedDate)
                      : null
                  }
                  icon={CalendarDays}
                />
                <InfoItem label="注册地址" value={merchant.registeredAddress} />
                <InfoItem label="法人姓名" value={merchant.legalPersonName} icon={User} />
                <InfoItem label="法人身份证号" value={merchant.legalPersonIdNo} icon={FileText} />
                <InfoItem label="法人联系电话" value={merchant.legalPersonPhone} icon={Phone} />
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-[#8a94a6] flex items-center gap-1">
                    <FileImage className="h-3.5 w-3.5" />
                    营业执照
                  </span>
                  {merchant.hasLicenseDocument ? (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      disabled={licenseAccess.isPending}
                      onClick={() => void openBusinessLicense()}
                      className="h-auto justify-start p-0 text-sm font-normal"
                    >
                      {licenseAccess.isPending
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <FileImage className="h-4 w-4" />}
                      {licenseAccess.isPending ? "正在获取安全链接…" : "点击查看营业执照"}
                    </Button>
                  ) : (
                    <span className="text-sm text-foreground">—</span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-[#8a94a6] flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5" />
                    签署协议文件
                  </span>
                  {merchant.agreementFileUrl ? (
                    <a
                      href={merchant.agreementFileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                    >
                      <FileText className="h-4 w-4" /> 查看已签署协议
                    </a>
                  ) : (
                    <span className="text-sm text-foreground">商户尚未上传签署协议</span>
                  )}
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <span className="text-xs text-[#8a94a6] flex items-center gap-1 mb-1">
                  <ScrollText className="h-3.5 w-3.5" /> 经营范围
                </span>
                <p className="text-sm leading-relaxed text-foreground">
                  {merchant.businessScope || "—"}
                </p>
              </div>
              {merchant.source === "portal" && (
                <p className="text-xs text-[#8a94a6] mt-3">
                  工商信息由前台商家提交
                  {merchant.submittedAt ? ` · 提交时间 ${formatDateTime(merchant.submittedAt)}` : ""}
                </p>
              )}
          </CollapsibleCard>

          {/* 审核记录 */}
          {merchant.reviewNote && (
            <CollapsibleCard title="最近审核备注" icon={FileText}>
                <p className="text-sm text-foreground">{merchant.reviewNote}</p>
                {merchant.reviewedAt && (
                  <p className="text-xs text-[#8a94a6] mt-2">
                    审核时间：{formatDateTime(merchant.reviewedAt)}
                  </p>
                )}
            </CollapsibleCard>
          )}
        </div>

        <div className="space-y-6">
          {/* 后台显示用户名；业务员可在此维护，不修改前台企业资料。 */}
          <CollapsibleCard title="联系信息" icon={User} contentClassName="space-y-4">
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-1 text-[11px] text-[#8a94a6]">
                  <User className="h-3 w-3" />
                  用户名
                  {merchant.canManage && !usernameEditing && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-1 h-5 rounded px-1.5 text-[10px] font-normal text-primary"
                      aria-label="修改用户名"
                      onClick={startUsernameEdit}
                    >
                      <Pencil className="mr-0.5 h-2.5 w-2.5" />
                      修改
                    </Button>
                  )}
                </span>
                {usernameEditing ? (
                  <div className="flex items-center gap-1.5">
                    <Input
                      autoFocus
                      value={usernameDraft}
                      maxLength={64}
                      className="h-7 max-w-[160px] px-2 text-xs"
                      aria-label="后台用户名"
                      disabled={usernameMutation.isPending}
                      onChange={event => setUsernameDraft(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === "Enter") saveUsername();
                        if (event.key === "Escape") setUsernameEditing(false);
                      }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      disabled={usernameMutation.isPending}
                      onClick={saveUsername}
                    >
                      保存
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      disabled={usernameMutation.isPending}
                      onClick={() => setUsernameEditing(false)}
                    >
                      取消
                    </Button>
                  </div>
                ) : (
                  <span className="text-sm text-foreground break-all">
                    {merchant.internalContactName?.trim() || merchant.contactName || "—"}
                  </span>
                )}
                {usernameEditing && (
                  <span className="text-[10px] text-[#8a94a6]">清空后保存可恢复原用户名</span>
                )}
              </div>
              <InfoItem label="联系电话" value={merchant.contactPhone} icon={Phone} />
              <InfoItem label="联系邮箱" value={merchant.contactEmail} icon={Mail} />
          </CollapsibleCard>

          {/* 结算账户 */}
          <CollapsibleCard title="结算账户" icon={CreditCard} contentClassName="space-y-4">
              <InfoItem label="账户名称" value={merchant.settlementAccountName} />
              <InfoItem label="账户号码" value={merchant.settlementAccount} icon={CreditCard} />
              <InfoItem label="开户行" value={merchant.settlementBank} icon={Landmark} />
          </CollapsibleCard>

        </div>
      </div>

      {/* 公司照片墙：全宽展示；超管或当前商户销售范围内账号可维护，服务端再次校验归属。 */}
      <div className="mt-6">
        <MerchantCompanyWallPanel merchantId={merchant.id} />
      </div>

    </DashboardLayout>
  );
}
