export const ERP_PERMISSION_KEYS = [
  "inventory.manage",
  "inventory.publish",
  "sales_orders.manage",
  "inventory.inbound",
  "inventory.dashboard",
  "enterprise.members.manage",
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
  "sales_orders.manage": {
    label: "销售订单",
    description: "查看并处理销售出库",
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
    label: "用户权限",
    description: "邀请成员并管理企业权限",
    href: "/add-user",
  },
};

export const ERP_PERMISSION_SET = new Set<string>(ERP_PERMISSION_KEYS);

export function isErpPermissionKey(value: string): value is ErpPermissionKey {
  return ERP_PERMISSION_SET.has(value);
}

export function normalizeErpPermissions(values: readonly string[]): ErpPermissionKey[] {
  return ERP_PERMISSION_KEYS.filter(key => values.includes(key));
}
