import MerchantCompanyWallPanel from "@/components/admin/MerchantCompanyWallPanel";
import MerchantEnterpriseUsersPanel from "@/components/admin/MerchantEnterpriseUsersPanel";
import MerchantMaterialPanel from "@/components/admin/MerchantMaterialPanel";
import MerchantOperationRecordsPanel from "@/components/admin/MerchantOperationRecordsPanel";
import {
  StatusBadge,
  agreementStatusMap,
  formatDateTime,
} from "@/components/admin/shared";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { formatBeijingDate } from "@shared/beijingTime";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  Contact,
  CreditCard,
  FileImage,
  FileText,
  History,
  Images,
  Landmark,
  Loader2,
  Mail,
  PackageSearch,
  Pencil,
  Phone,
  ScrollText,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation, useRoute } from "wouter";

type MerchantTab = "materials" | "users" | "company" | "images" | "records";

const MERCHANT_TABS: { value: MerchantTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "materials", label: "物料库存", icon: PackageSearch },
  { value: "users", label: "企业用户", icon: Users },
  { value: "company", label: "企业资料", icon: Building2 },
  { value: "images", label: "图片资料", icon: Images },
  { value: "records", label: "操作记录", icon: History },
];

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
    <div className="min-w-0">
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {Icon ? <Icon className="h-3 w-3" /> : null}
        {label}
      </span>
      <span className="mt-1 block break-all text-[13px] text-foreground">{value || "—"}</span>
    </div>
  );
}

function SectionCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-white">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Icon className="h-4 w-4 text-primary" />
        <h2 className="text-[15px] font-semibold">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export default function MerchantDetail() {
  const [, params] = useRoute("/merchants/:id");
  const [, navigate] = useLocation();
  const id = Number(params?.id);
  const [activeTab, setActiveTab] = useState<MerchantTab>("materials");
  const [visitedTabs, setVisitedTabs] = useState<Set<MerchantTab>>(
    () => new Set<MerchantTab>(["materials"]),
  );
  const [usernameEditing, setUsernameEditing] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState("");
  const utils = trpc.useUtils();

  const { data: merchant, isLoading } = trpc.merchant.detail.useQuery(
    { id },
    { enabled: Number.isFinite(id) && id > 0 },
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

  const changeTab = (value: string) => {
    const next = value as MerchantTab;
    setActiveTab(next);
    setVisitedTabs(current => {
      if (current.has(next)) return current;
      const updated = new Set(current);
      updated.add(next);
      return updated;
    });
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-14 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      </DashboardLayout>
    );
  }

  if (!merchant) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center gap-4 py-24">
          <p className="text-muted-foreground">未找到该商户</p>
          <Button variant="outline" onClick={() => navigate("/merchants")}>
            <ArrowLeft className="mr-1 h-4 w-4" /> 返回商户列表
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const materialAvailable = Boolean(
    merchant.crmStatus === "enabled" && merchant.crmOwnerPortalUserId && merchant.businessLicense,
  );
  const agreementBadge = agreementStatusMap[merchant.agreementStatus] ?? {
    label: merchant.agreementStatus,
    style: "gray" as const,
  };

  return (
    <DashboardLayout>
      <main className="space-y-3 text-[13px]" data-merchant-detail-tabs>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 h-8 text-xs text-muted-foreground hover:text-primary"
          onClick={() => navigate("/merchants")}
        >
          <ArrowLeft className="mr-1 h-3.5 w-3.5" /> 返回商户列表
        </Button>

        <header className="rounded-lg border bg-white px-4 py-3" data-merchant-summary-header>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-[16px] font-semibold">{merchant.companyName}</h1>
                <StatusBadge {...agreementBadge} />
                <span className={`rounded-md border px-2 py-0.5 text-xs ${merchant.crmStatus === "enabled" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                  ERP {merchant.crmStatus === "enabled" ? "已开通" : "未开通"}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">商户编号 {merchant.merchantNo} · 统一社会信用代码 {merchant.businessLicense || "—"}</p>
            </div>
            <p className="text-xs text-muted-foreground">入驻时间 {formatDateTime(merchant.createdAt)}</p>
          </div>
        </header>

        <dl className="grid grid-cols-2 overflow-hidden rounded-lg border bg-white sm:grid-cols-4" data-merchant-stat-strip>
          <div className="border-b px-4 py-2.5 sm:border-b-0 sm:border-r"><dt className="text-[11px] text-muted-foreground">协议状态</dt><dd className="mt-0.5 font-medium">{agreementBadge.label}</dd></div>
          <div className="border-b px-4 py-2.5 sm:border-b-0 sm:border-r"><dt className="text-[11px] text-muted-foreground">ERP 状态</dt><dd className="mt-0.5 font-medium">{merchant.crmStatus === "enabled" ? "已开通" : "未开通"}</dd></div>
          <div className="border-r px-4 py-2.5"><dt className="text-[11px] text-muted-foreground">资料来源</dt><dd className="mt-0.5 font-medium">{merchant.source === "portal" ? "商户前台提交" : "后台录入"}</dd></div>
          <div className="px-4 py-2.5"><dt className="text-[11px] text-muted-foreground">销售负责人</dt><dd className="mt-0.5 truncate font-medium">{merchant.salesOwner || merchant.salesOwnerCode || "未分配"}</dd></div>
        </dl>

        <Tabs value={activeTab} onValueChange={changeTab} className="gap-3">
          <div className="overflow-x-auto rounded-lg border bg-white" data-responsive-tab-scroll>
            <TabsList className="h-10 min-w-max rounded-none bg-transparent p-0">
              {MERCHANT_TABS.map(tab => {
                const Icon = tab.icon;
                return (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="h-10 min-w-[104px] rounded-none border-0 border-b-2 border-transparent px-4 text-[13px] shadow-none data-[state=active]:border-primary data-[state=active]:bg-primary/5 data-[state=active]:text-primary data-[state=active]:shadow-none"
                  >
                    <Icon className="h-3.5 w-3.5" /> {tab.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>

          {visitedTabs.has("materials") ? (
            <TabsContent value="materials" forceMount className={activeTab === "materials" ? "mt-0" : "hidden"}>
              {materialAvailable && merchant.businessLicense ? (
                <MerchantMaterialPanel merchantId={merchant.id} creditCode={merchant.businessLicense} />
              ) : (
                <section className="rounded-lg border bg-white p-8 text-center">
                  <PackageSearch className="mx-auto h-8 w-8 text-muted-foreground/50" />
                  <h2 className="mt-3 text-[15px] font-semibold">暂无可管理的物料库存</h2>
                  <p className="mt-1 text-xs text-muted-foreground">商户需完成 ERP 开通、账号绑定并具备统一社会信用代码。</p>
                </section>
              )}
            </TabsContent>
          ) : null}

          {visitedTabs.has("users") ? (
            <TabsContent value="users" forceMount className={activeTab === "users" ? "mt-0" : "hidden"}>
              <MerchantEnterpriseUsersPanel
                merchantId={merchant.id}
                canManage={merchant.canManage}
                canManageLogin={merchant.canManageLogin}
                canOverrideOwnerLogin={merchant.canOverrideOwnerLogin}
              />
            </TabsContent>
          ) : null}

          {visitedTabs.has("company") ? (
            <TabsContent value="company" forceMount className={activeTab === "company" ? "mt-0" : "hidden"}>
              <div className="grid gap-3 lg:grid-cols-2" data-enterprise-profile-full-width>
                <SectionCard title="企业工商信息" icon={Building2}>
                  <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                    <InfoItem label="企业名称" value={merchant.companyName} icon={Building2} />
                    <InfoItem label="统一社会信用代码" value={merchant.businessLicense} icon={FileText} />
                    <InfoItem label="企业类型" value={merchant.companyType} icon={Building2} />
                    <InfoItem label="企业角色" value={merchant.companyRole} icon={ShieldCheck} />
                    <InfoItem label="注册资本" value={merchant.registeredCapital} icon={Landmark} />
                    <InfoItem label="成立日期" value={merchant.establishedDate ? formatBeijingDate(merchant.establishedDate) : null} icon={CalendarDays} />
                    <InfoItem label="注册地址" value={merchant.registeredAddress} />
                    <InfoItem label="法人姓名" value={merchant.legalPersonName} icon={User} />
                    <InfoItem label="法人身份证号" value={merchant.legalPersonIdNo} icon={FileText} />
                    <InfoItem label="法人联系电话" value={merchant.legalPersonPhone} icon={Phone} />
                    <div className="min-w-0">
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><FileImage className="h-3 w-3" />营业执照</span>
                      {merchant.hasLicenseDocument ? (
                        <Button type="button" variant="link" size="sm" disabled={licenseAccess.isPending} onClick={() => void openBusinessLicense()} className="mt-1 h-auto justify-start p-0 text-[13px] font-normal">
                          {licenseAccess.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileImage className="h-4 w-4" />}
                          {licenseAccess.isPending ? "正在获取安全链接…" : "点击查看营业执照"}
                        </Button>
                      ) : <span className="mt-1 block text-[13px]">—</span>}
                    </div>
                    <div className="min-w-0">
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><FileText className="h-3 w-3" />签署协议文件</span>
                      {merchant.agreementFileUrl ? <a href={merchant.agreementFileUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[13px] text-primary hover:underline"><FileText className="h-4 w-4" /> 查看已签署协议</a> : <span className="mt-1 block text-[13px]">商户尚未上传签署协议</span>}
                    </div>
                  </div>
                  <div className="mt-4 border-t pt-4"><span className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground"><ScrollText className="h-3 w-3" />经营范围</span><p className="text-[13px] leading-6">{merchant.businessScope || "—"}</p></div>
                  {merchant.source === "portal" ? <p className="mt-3 text-xs text-muted-foreground">工商信息由前台商家提交{merchant.submittedAt ? ` · 提交时间 ${formatDateTime(merchant.submittedAt)}` : ""}</p> : null}
                </SectionCard>

                <div className="space-y-3">
                  <SectionCard title="联系信息" icon={Contact}>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                      <div className="min-w-0">
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <User className="h-3 w-3" /> 用户名
                          {merchant.canManage && !usernameEditing ? (
                            <Button type="button" variant="ghost" size="sm" className="ml-1 h-5 rounded px-1.5 text-[10px] font-normal text-primary" aria-label="修改用户名" onClick={startUsernameEdit}><Pencil className="mr-0.5 h-2.5 w-2.5" />修改</Button>
                          ) : null}
                        </span>
                        {usernameEditing ? (
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Input autoFocus value={usernameDraft} maxLength={64} className="h-7 max-w-[180px] px-2 text-xs" aria-label="后台用户名" disabled={usernameMutation.isPending} onChange={event => setUsernameDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") saveUsername(); if (event.key === "Escape") setUsernameEditing(false); }} />
                            <Button type="button" size="sm" className="h-7 px-2 text-[11px]" disabled={usernameMutation.isPending} onClick={saveUsername}>保存</Button>
                            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px]" disabled={usernameMutation.isPending} onClick={() => setUsernameEditing(false)}>取消</Button>
                          </div>
                        ) : <span className="mt-1 block break-all text-[13px]">{merchant.internalContactName?.trim() || merchant.contactName || "—"}</span>}
                        {usernameEditing ? <span className="mt-1 block text-[10px] text-muted-foreground">清空后保存可恢复原用户名</span> : null}
                      </div>
                      <InfoItem label="联系电话" value={merchant.contactPhone} icon={Phone} />
                      <InfoItem label="联系邮箱" value={merchant.contactEmail} icon={Mail} />
                    </div>
                  </SectionCard>

                  <SectionCard title="结算账户" icon={CreditCard}>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                      <InfoItem label="账户名称" value={merchant.settlementAccountName} />
                      <InfoItem label="账户号码" value={merchant.settlementAccount} icon={CreditCard} />
                      <InfoItem label="开户行" value={merchant.settlementBank} icon={Landmark} />
                    </div>
                  </SectionCard>

                  <SectionCard title="最近审核备注" icon={FileText}>
                    <p className="text-[13px] leading-6">{merchant.reviewNote || "暂无审核备注"}</p>
                    {merchant.reviewedAt ? <p className="mt-2 text-xs text-muted-foreground">审核时间：{formatDateTime(merchant.reviewedAt)}</p> : null}
                  </SectionCard>
                </div>
              </div>
            </TabsContent>
          ) : null}

          {visitedTabs.has("images") ? (
            <TabsContent value="images" forceMount className={activeTab === "images" ? "mt-0" : "hidden"}>
              <MerchantCompanyWallPanel merchantId={merchant.id} />
            </TabsContent>
          ) : null}

          {visitedTabs.has("records") ? (
            <TabsContent value="records" forceMount className={activeTab === "records" ? "mt-0" : "hidden"}>
              <MerchantOperationRecordsPanel merchantId={merchant.id} />
            </TabsContent>
          ) : null}
        </Tabs>
      </main>
    </DashboardLayout>
  );
}
