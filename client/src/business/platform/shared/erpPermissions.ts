export const ERP_PERMISSION_KEYS = [
  "inventory.manage",
  "inventory.publish",
  "inquiry.receive",
  "sales_orders.manage",
  "inventory.inbound",
  "inventory.dashboard",
  "enterprise.members.manage",
  "customers.manage",
  "customers.manage_all",
  "procurement.demands",
  "sales.business_orders",
  "procurement.orders",
] as const;

export type ErpPermissionKey = (typeof ERP_PERMISSION_KEYS)[number];

export const ERP_PERMISSION_DEFINITIONS: Record<
  ErpPermissionKey,
  { label: string; description: string; href: string }
> = {
  "inventory.manage": {
    label: "我的库存",
    description: "查看并维护库存明细",
    href: "/inventory",
  },
  "inventory.publish": {
    label: "发布库存",
    description: "新建、导入并发布库存",
    href: "/publish",
  },
  "inquiry.receive": {
    label: "询价接待",
    description: "接收本人分配的询价，并通过聊一聊回复和报价；不含库存编辑权限",
    href: "/inquiries",
  },
  "sales_orders.manage": {
    label: "线上订单",
    description: "处理网站自主下单、收款与发货",
    href: "/outbound",
  },
  "inventory.inbound": {
    label: "入库管理",
    description: "录入并管理入库单据",
    href: "/inbound",
  },
  "inventory.dashboard": {
    label: "库存看板",
    description: "查看库存汇总、台账和流水",
    href: "/stock-board",
  },
  "enterprise.members.manage": {
    label: "用户与权限",
    description: "邀请成员并管理企业权限",
    href: "/add-user",
  },
  "customers.manage": {
    label: "客户列表 / 客户需求",
    description: "查看并维护客户列表与客户需求",
    href: "/customers",
  },
  "customers.manage_all": {
    label: "全部客户管理",
    description: "可看全公司客户，分配和转移",
    href: "/customers",
  },
  "procurement.demands": {
    label: "采购工作台",
    description: "查看并领取本企业物料需求",
    href: "/procurement/demands",
  },
  "procurement.orders": {
    label: "采购订单",
    description: "登记本企业向供应商采购的订单与履约进度",
    href: "/procurement/orders",
  },
  "sales.business_orders": {
    label: "销售订单",
    description: "处理客户需求形成的内部订单",
    href: "/sales-orders",
  },
};

/** 邀请/成员权限勾选项按左侧菜单分组；不含已并入入库管理的库存看板，也不含无模块权限的企业信息、我的信息。 */
export const ERP_PERMISSION_GROUPS: { title: string; keys: ErpPermissionKey[] }[] = [
  { title: "库存管理", keys: ["inventory.manage", "inventory.publish", "inventory.inbound"] },
  { title: "客户管理", keys: ["inquiry.receive", "customers.manage", "sales.business_orders", "sales_orders.manage", "customers.manage_all"] },
  { title: "采购管理", keys: ["procurement.demands", "procurement.orders"] },
  { title: "用户中心", keys: ["enterprise.members.manage"] },
];

export const ERP_VISIBLE_PERMISSION_KEYS = ERP_PERMISSION_KEYS.filter(
  key => key !== "inventory.dashboard",
) as ErpPermissionKey[];

export const ERP_PERMISSION_SET = new Set<string>(ERP_PERMISSION_KEYS);

export const ERP_PERMISSION_BY_ROUTE: Record<string, ErpPermissionKey> = {
  ...Object.fromEntries(ERP_PERMISSION_KEYS.map(key => [ERP_PERMISSION_DEFINITIONS[key].href, key])),
  "/customers": "customers.manage",
  "/customers/new": "customers.manage",
  "/customer-demands": "customers.manage",
};

export function erpPermissionForRoute(path: string): ErpPermissionKey | undefined {
  const pathname = path.split("?")[0];
  if (pathname === "/customers" || pathname.startsWith("/customers/") || pathname === "/customer-demands") return "customers.manage";
  return ERP_PERMISSION_BY_ROUTE[pathname];
}

export function isErpPermissionKey(value: string): value is ErpPermissionKey {
  return ERP_PERMISSION_SET.has(value);
}

export function normalizeErpPermissions(values: readonly string[]): ErpPermissionKey[] {
  const effective = new Set(values);
  // 库存看板已并入入库管理；存量成员无需人工改权限即可访问整合后的页面。
  if (effective.has("inventory.dashboard")) effective.add("inventory.inbound");
  effective.delete("inventory.dashboard");
  if (effective.has("customers.manage_all")) effective.add("customers.manage");
  return ERP_PERMISSION_KEYS.filter(key => effective.has(key));
}

export function firstErpPermissionHref(values: readonly string[]): string | null {
  const normalized = normalizeErpPermissions(values);
  return normalized.length > 0 ? ERP_PERMISSION_DEFINITIONS[normalized[0]].href : null;
}
