import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { trpc } from "../../../../api/business-trpc";
import PlatformLayout from "../../../../BusinessContentFrame";
import CompanyForm, { useCertBadge } from "../components/CompanyForm";
import CompanyPhotoWall from "../components/CompanyPhotoWall";
import PickupPointManager from "../components/PickupPointManager";
import CompanyReviewInbox from "../components/CompanyReviewInbox";

/**
 * 企业信息管理（CRM 工作台）：企业资料填写 + 营业执照上传 + 认证等级展示（预留）
 * 表单主体复用 components/CompanyForm。
 */
export default function CompanyInfo() {
  const [companyFormOpen, setCompanyFormOpen] = useState(false);
  const {
    data: company,
    isLoading,
    isError,
    refetch,
  } = trpc.company.get.useQuery();
  const certBadge = useCertBadge(company?.certLevel || "pending");

  if (isLoading) {
    return (
      <PlatformLayout>
        <div className="rounded-lg border bg-white p-8 text-center text-sm text-muted-foreground">
          正在加载企业认证资料…
        </div>
      </PlatformLayout>
    );
  }

  if (isError) {
    return (
      <PlatformLayout>
        <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
          <p className="text-sm font-medium text-red-700">企业资料加载失败</p>
          <button
            type="button"
            className="mt-3 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs text-red-700"
            onClick={() => void refetch()}
          >
            重新加载
          </button>
        </div>
      </PlatformLayout>
    );
  }

  return (
    <PlatformLayout>
      <div>
        <h1 className="text-lg font-semibold">企业信息</h1>
        <p className="mt-1 text-xs text-muted-foreground">维护企业认证资料、评论、自提点和公司展示图。</p>
      </div>
      <section className="mt-4 overflow-hidden rounded-lg border bg-white">
        <button
          type="button"
          data-testid="company-form-toggle"
          aria-expanded={companyFormOpen}
          onClick={() => setCompanyFormOpen(value => !value)}
          className="flex w-full items-center justify-between gap-4 px-5 py-3 text-left transition-colors hover:bg-slate-50"
        >
          <span className="min-w-0">
            <span className="block text-[13px] font-medium text-[#233548]">企业认证资料</span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {company?.companyName || "企业认证资料"} · 修改后需重新审核
              </span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            {certBadge}
            <ChevronDown
              size={18}
              className={`text-slate-400 transition-transform ${companyFormOpen ? "rotate-180" : ""}`}
            />
          </span>
        </button>
        {companyFormOpen ? (
          <div className="border-t bg-slate-50/50 p-4">
            <CompanyForm onSaved={() => setCompanyFormOpen(false)} />
          </div>
        ) : null}
      </section>
      <CompanyReviewInbox />
      <PickupPointManager approved={company?.reviewStatus === "approved"} />
      <CompanyPhotoWall />
    </PlatformLayout>
  );
}
