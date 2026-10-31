import { Link } from "wouter";
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
  return <nav aria-label="采购工作台功能" className="mb-3 flex flex-wrap gap-1 border-b border-slate-200 pb-2">
    {tabs.map(tab => <Link key={tab.key} href={tab.href} aria-current={active === tab.key ? "page" : undefined} className={`inline-flex h-8 items-center rounded-md px-3 text-xs ${active === tab.key ? "bg-[#185FA5] font-medium text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>{tab.label}</Link>)}
  </nav>;
}
export default ProcurementWorkspaceNav;
