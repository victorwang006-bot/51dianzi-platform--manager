import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { trpc } from "../../../../api/business-trpc";
import PlatformLayout from "../../../../BusinessContentFrame";
import CompanyForm, { useCertBadge } from "../components/CompanyForm";
import CompanyPhotoWall from "../components/CompanyPhotoWall";
import PickupPointManager from "../components/PickupPointManager";
import CompanyReviewInbox from "../components/CompanyReviewInbox";
import "./CompanyInfo.css";

/**
 * 企业信息管理（CRM 工作台）：企业资料填写 + 营业执照上传 + 认证等级展示（预留）
 * 表单主体复用 components/CompanyForm。
 */
export default function CompanyInfo() {
  const [companyFormOpen, setCompanyFormOpen] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);
  const {
    data: company,
    isLoading,
    isError,
    error,
    refetch,
  } = trpc.company.get.useQuery();
  const certBadge = useCertBadge(company?.certLevel || "pending");

  if (isLoading) {
    return (
      <PlatformLayout>
        <div className="company-info-page rounded-lg border bg-white p-8 text-center text-sm text-muted-foreground">
          正在加载企业认证资料…
        </div>
      </PlatformLayout>
    );
  }

  if (isError) {
    return (
      <PlatformLayout>
        <div className="company-info-page rounded-lg border border-red-200 bg-red-50 p-8 text-center">
          <p className="text-sm font-medium text-red-700">企业资料加载失败</p>
          <p className="mt-2 text-sm text-red-700">{error?.message}</p>
          <button
            type="button"
            className="company-info-retry mt-3 rounded-md border border-red-200 bg-white px-4 text-red-700"
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
      <div className="company-info-page">
        <div>
          <h1 className="admin-page-title company-info-title font-semibold">
            企业信息
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            维护企业认证资料、评论、自提点和公司展示图。
          </p>
        </div>
        <section className="mt-4 overflow-hidden rounded-lg border bg-white">
          <button
            type="button"
            data-testid="company-form-toggle"
            aria-expanded={companyFormOpen}
            onClick={() => setCompanyFormOpen(value => !value)}
            className="company-info-toggle flex w-full items-center justify-between gap-4 px-5 py-3 text-left transition-colors hover:bg-slate-50"
          >
            <span className="min-w-0">
              <span className="admin-section-title company-info-section-title block font-medium">
                企业认证资料
              </span>
              <span className="company-info-summary mt-0.5 block text-xs text-muted-foreground">
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
            <div className="company-info-form border-t bg-slate-50/50 p-4">
              <CompanyForm onSaved={() => setCompanyFormOpen(false)} />
            </div>
          ) : null}
        </section>
        <CompanyReviewInbox approved={company?.reviewStatus === "approved"} />
        <div className="company-info-pickup">
          <PickupPointManager approved={company?.reviewStatus === "approved"} />
        </div>
        <div className="company-info-photos">
          <section className="mt-4 overflow-hidden rounded-lg border bg-white">
            <button type="button" data-testid="company-photos-toggle"
              aria-expanded={photosOpen} onClick={() => setPhotosOpen(value => !value)}
              className="flex w-full items-center justify-between gap-4 px-5 py-3 text-left hover:bg-slate-50">
              <span className="text-[13px] font-medium text-[#233548]">公司信息墙</span>
              <ChevronDown size={18} className={`text-slate-400 transition-transform ${photosOpen ? "rotate-180" : ""}`} />
            </button>
            {photosOpen ? company?.reviewStatus === "approved" ? <CompanyPhotoWall />
              : <p className="p-5 text-sm text-muted-foreground">企业资料审核通过后才可管理公司信息墙。</p>
              : null}
          </section>
        </div>
      </div>
    </PlatformLayout>
  );
}
