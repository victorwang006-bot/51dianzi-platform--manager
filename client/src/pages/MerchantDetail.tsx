import DashboardLayout from "@/components/DashboardLayout";
import {
  PageHeader,
  StatusBadge,
  agreementStatusMap,
  formatDateTime,
} from "@/components/admin/shared";
import { Button } from "@/components/ui/button";
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
  Mail,
  Phone,
  ScrollText,
  ShieldCheck,
  User,
} from "lucide-react";
import { useLocation, useRoute } from "wouter";
import MerchantMaterialPanel from "@/components/admin/MerchantMaterialPanel";
import CollapsibleCard from "@/components/admin/CollapsibleCard";
import { formatBeijingDate } from "@shared/beijingTime";

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
                  {merchant.licenseImageUrl ? (
                    <a
                      href={merchant.licenseImageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                    >
                      <FileImage className="h-4 w-4" /> 点击查看营业执照
                    </a>
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
          {/* 联系人信息 */}
          <CollapsibleCard title="联系人信息" icon={User} contentClassName="space-y-4">
              <InfoItem label="联系人" value={merchant.contactName} icon={User} />
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

    </DashboardLayout>
  );
}
