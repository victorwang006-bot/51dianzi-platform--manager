export const ZHIJIE_ENTERPRISE_ID = 1;
export const ZHIJIE_COMPANY = "深圳市智捷创芯信息科技有限公司";
export const ZHIJIE_ROLE_LABELS = {
  employee: "普通员工",
  team_manager: "团队经理",
  department_manager: "部门经理",
} as const;
export type ZhijieRole = keyof typeof ZHIJIE_ROLE_LABELS;
export const ZHIJIE_CAPABILITIES = [
  "read",
  "maintain",
  "assign",
  "publish",
  "export",
  "template",
  "seal",
] as const;
export type ZhijieCapability = (typeof ZHIJIE_CAPABILITIES)[number];
export const ZHIJIE_CAPABILITY_LABELS: Record<ZhijieCapability, string> = {
  read: "查看",
  maintain: "维护",
  assign: "分配与交接",
  publish: "对外发布",
  export: "批量导出",
  template: "合同模板",
  seal: "使用印章",
};
export const ZHIJIE_MODULES = [
  {
    id: "inventory",
    label: "我的库存",
    group: "库存管理",
    sourcePermission: "inventory.manage",
    columns: ["型号", "品牌", "数量", "负责人", "更新日期"],
  },
  {
    id: "channels",
    label: "工厂渠道",
    group: "库存管理",
    sourcePermission: "inventory.manage",
    columns: ["渠道", "联系人", "合作状态", "负责人", "更新日期"],
  },
  {
    id: "channel-inventory",
    label: "渠道库存",
    group: "库存管理",
    sourcePermission: "inventory.manage",
    columns: ["型号", "品牌", "可供数量", "内部渠道", "负责人"],
  },
  {
    id: "inbound",
    label: "入库管理",
    group: "库存管理",
    sourcePermission: "inventory.inbound",
    columns: ["入库单号", "来源订单", "型号", "数量", "负责人"],
  },
  {
    id: "inquiries",
    label: "询价接待",
    group: "客户管理",
    sourcePermission: "inquiry.receive",
    columns: ["询价编号", "型号", "数量", "状态", "负责人"],
  },
  {
    id: "customers",
    label: "客户与跟进",
    group: "客户管理",
    sourcePermission: "customers.manage",
    columns: ["客户名称", "联系人", "客户阶段", "下次跟进", "负责人"],
  },
  {
    id: "customer-demands",
    label: "客户需求",
    group: "客户管理",
    sourcePermission: "customers.manage",
    columns: ["需求编号", "关联客户", "型号", "数量", "负责人"],
  },
  {
    id: "sales-orders",
    label: "销售订单",
    group: "客户管理",
    sourcePermission: "sales.business_orders",
    columns: ["订单号", "客户", "金额", "履约状态", "负责人"],
  },
  {
    id: "online-orders",
    label: "线上订单",
    group: "客户管理",
    sourcePermission: "sales_orders.manage",
    columns: ["订单号", "买家", "金额", "订单状态", "负责人"],
  },
  {
    id: "procurement-demands",
    label: "采购需求",
    group: "采购管理",
    sourcePermission: "procurement.demands",
    columns: ["需求编号", "型号", "数量", "采购状态", "负责人"],
  },
  {
    id: "procurement-orders",
    label: "采购订单",
    group: "采购管理",
    sourcePermission: "procurement.orders",
    columns: ["采购单号", "供应商", "金额", "履约状态", "负责人"],
  },
  {
    id: "suppliers",
    label: "供应商管理",
    group: "采购管理",
    sourcePermission: "procurement.orders",
    columns: ["供应商", "联系人", "合作状态", "负责人", "更新日期"],
  },
  {
    id: "company",
    label: "公司资料",
    group: "企业设置",
    sourcePermission: "enterprise.members.manage",
    columns: ["资料名称", "当前内容", "更新人员", "更新日期"],
  },
  {
    id: "templates",
    label: "合同模板与用章",
    group: "企业设置",
    sourcePermission: "procurement.orders",
    columns: ["模板名称", "版本", "状态", "更新人员", "更新日期"],
  },
] as const;
export type ZhijieModuleId = (typeof ZHIJIE_MODULES)[number]["id"];
export type ZhijieGrants = Partial<Record<ZhijieModuleId, ZhijieCapability[]>>;
export interface ZhijieTeam {
  id: number;
  name: string;
  leaderUserId: number;
  status: "active" | "archived";
}
export interface ZhijieSourceMember {
  memberId: number;
  userId: number;
  name: string;
  status: "active" | "suspended";
  teamId: number | null;
  sourcePermissions: string[];
  isOwner: boolean;
}
export interface ZhijieStaffAccess {
  adminUserId: number;
  sourceMemberId: number;
  sourceUserId: number;
  role: ZhijieRole;
  teamIds: number[];
  grants: ZhijieGrants;
  status: "active" | "disabled";
  revision: number;
  displayName?: string;
}
export interface ZhijieContext {
  companyName: string;
  enterpriseId: number;
  canConfigure: boolean;
  authorized: boolean;
  connected: false;
  status: "unconfigured" | "unauthorized" | "ready" | "source_unavailable";
  message: string;
  access: ZhijieStaffAccess | null;
  teams: ZhijieTeam[];
  scopeLabel: string;
  readableModules: ZhijieModuleId[];
}
export interface ZhijieSetup {
  schemaReady: boolean;
  sourceReady: boolean;
  message: string;
  adminAccounts: {
    id: number;
    name: string;
    status: string;
    platformRole: string;
  }[];
  members: ZhijieSourceMember[];
  teams: ZhijieTeam[];
  staff: ZhijieStaffAccess[];
}
export interface ZhijieAccessInput {
  adminUserId: number;
  sourceMemberId: number;
  role: ZhijieRole;
  teamIds: number[];
  grants: ZhijieGrants;
  status: "active" | "disabled";
  expectedRevision: number;
  reason: string;
}
export interface ZhijieListResult {
  moduleId: ZhijieModuleId;
  connected: false;
  items: never[];
  total: null;
  message: string;
}
export interface ZhijieAuditRow {
  id: number;
  actorAdminId: number;
  targetAdminId: number;
  action: string;
  reason: string;
  createdAt: string;
}
export const ZHIJIE_API_PREFIX = "/api/zhijie";
export function isZhijieModule(value: unknown): value is ZhijieModuleId {
  return typeof value === "string" && ZHIJIE_MODULES.some(m => m.id === value);
}
