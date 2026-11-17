import type { AdminNewInformationModule } from "@shared/adminNewInformation";
import type { SalesOrderSource } from "@/lib/salesOrderWorkspace";
import { useAdminNewInformationContext } from "@/lib/adminNewInformation";
import { AdminNewInformationBadge } from "./AdminNewInformationBadge";

export function adminNewInformationModuleForPath(path: string): AdminNewInformationModule | undefined {
  if (path === "/workbench/customers") return "customers";
  if (path === "/workbench/channel-inventory") return "inventory";
  if (path === "/workbench/mall-materials") return "mall";
  if (path === "/workbench/inquiries") return "reception";
  if (["/workbench/procurement-demands", "/workbench/procurement/demands"].includes(path)) return "procurement";
  if (path === "/workbench/inbound") return "inbound";
  if (["/workbench/orders", "/workbench/sales-orders", "/workbench/outbound", "/orders"].includes(path)) return "sales";
  return undefined;
}
const labels: Record<AdminNewInformationModule, string> = {
  customers: "客户列表", inventory: "库存列表", mall: "商城物料", reception: "询价接待",
  procurement: "采购需求", inbound: "采购入库", sales: "销售订单",
};
export function AdminNewInformationMenuBadge({ module, source }: {
  module: AdminNewInformationModule;
  source?: SalesOrderSource;
}) {
  const { summary } = useAdminNewInformationContext();
  const total = summary.count(module);
  const data = summary.moduleSummary(module);
  const lastKnown = summary.isModuleLastKnown(module);
  const count = module === "sales" && source && total !== undefined
    ? data?.children?.[source] ?? (data?.available ? 0 : undefined) : total;
  return <AdminNewInformationBadge count={count} placement="nav" lastKnown={lastKnown}
    ariaLabel={count === undefined ? undefined : `${labels[module]}${source === "business" ? "·业务订单" : source === "mall" ? "·商城订单" : ""}：${count}条未查看新信息${lastKnown ? "（上次成功查询，当前更新失败）" : ""}`} />;
}
