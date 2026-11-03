import { Link } from "wouter";
import { AdminPageTabs } from "@/components/admin/UnifiedAdminPage";
import { trpc } from "../../../../../api/business-trpc";

export type ProcurementWorkspaceTab = "internal" | "publish" | "quotes";

export function ProcurementWorkspaceNav({ active }: { active: ProcurementWorkspaceTab }) {
  const enterprise = trpc.enterprise.me.useQuery(undefined, { retry: false });
  const canReadInternal = enterprise.data?.isOwner || (enterprise.data?.permissionKeys as readonly string[] | undefined)?.includes("procurement.demands");
  const tabs = [
    ...(canReadInternal ? [{ key: "internal", label: "内部需求", href: "/procurement/demands" }] : []),
    { key: "publish", label: "发布需求", href: "/demand-publish" },
    { key: "quotes", label: "收到的报价", href: "/demand-quotes" },
  ];

  return (
    <AdminPageTabs ariaLabel="采购工作台功能" className="mb-3">
      {tabs.map(tab => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? "page" : undefined}
          className="aui-page-tab"
        >
          {tab.label}
        </Link>
      ))}
    </AdminPageTabs>
  );
}

export default ProcurementWorkspaceNav;
