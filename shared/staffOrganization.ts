import { z } from "zod";
import {
  resolveAdminPermissions,
  type AdminPermission,
} from "./adminPermissions";

/** Native operations only. No business.*, official* or system capabilities. */
export const STAFF_OPERATIONS_PERMISSIONS = [
  "materials.read",
  "materials.write",
  "merchants.read",
  "merchants.write",
  "portalUsers.read",
  "portalUsers.manage",
  "messages.read",
  "messages.write",
  "orders.read",
  "analytics.read",
] as const satisfies readonly AdminPermission[];
export type StaffOperationsPermission =
  (typeof STAFF_OPERATIONS_PERMISSIONS)[number];
export const STAFF_OPERATIONS_TEMPLATE_VERSION = 1;
export const STAFF_OPERATIONS_TEMPLATES = [
  {
    id: "platform-operations",
    name: "平台运营",
    description:
      "商户、物料、前台用户与消息运营；不包含系统权限、官方库存或业务 ERP 授权。",
    permissions: [...STAFF_OPERATIONS_PERMISSIONS],
  },
  {
    id: "operations-view",
    name: "运营查看",
    description:
      "仅查看运营模块；不包含编辑、系统权限、官方库存或业务 ERP 授权。",
    permissions: [
      "materials.read",
      "merchants.read",
      "portalUsers.read",
      "messages.read",
      "orders.read",
      "analytics.read",
    ] as StaffOperationsPermission[],
  },
] as const;
const requestId = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9_-]{8,64}$/,
    "请求号须为 8–64 位字母、数字、下划线或连字符"
  );
const id = z.number().int().positive().max(2147483647);
const revision = z.number().int().min(0).max(4294967294);
const name = z.string().trim().min(1).max(128);
const notes = z.string().trim().max(2000);
export const staffOrganizationOverviewInput = z.object({}).strict().optional();
export const staffOrganizationCreateTeamInput = z
  .object({ name, notes: notes.optional(), requestId })
  .strict();
export const staffOrganizationUpdateTeamInput = z
  .object({
    id,
    name,
    notes: notes.optional(),
    status: z.enum(["active", "archived"]),
    expectedRevision: revision,
    requestId,
  })
  .strict();
export const staffOrganizationSetMemberInput = z
  .object({
    adminUserId: id,
    teamId: id.nullable(),
    role: z.enum(["member", "leader"]).nullable(),
    expectedRevision: revision,
    requestId,
  })
  .strict()
  .refine(
    v => (v.teamId === null) === (v.role === null),
    "团队与成员身份须同时填写或同时为空"
  );
export const staffOrganizationApplyTemplateInput = z
  .object({
    adminUserId: id,
    templateId: z.enum(["platform-operations", "operations-view"]),
    expectedRevision: revision,
    expectedSessionVersion: z.number().int().nonnegative(),
    requestId,
  })
  .strict();
export const staffOrganizationAuditInput = z
  .object({
    page: z.number().int().min(1).max(100000).default(1),
    pageSize: z.number().int().min(1).max(100).default(20),
  })
  .strict();
export type CreateStaffTeamInput = z.infer<
  typeof staffOrganizationCreateTeamInput
>;
export type UpdateStaffTeamInput = z.infer<
  typeof staffOrganizationUpdateTeamInput
>;
export type SetStaffMemberInput = z.infer<
  typeof staffOrganizationSetMemberInput
>;
export type ApplyStaffTemplateInput = z.infer<
  typeof staffOrganizationApplyTemplateInput
>;
export type StaffTeamDto = {
  id: number;
  name: string;
  notes: string | null;
  status: "active" | "archived";
  revision: number;
};
export type StaffMemberDto = {
  adminUserId: number;
  displayName: string;
  username: string;
  status: "active" | "disabled" | "locked";
  adminRole: string;
  teamId: number | null;
  teamRole: "member" | "leader" | null;
  revision: number;
  sessionVersion: number;
  permissions: readonly AdminPermission[];
  operationsPermissions: StaffOperationsPermission[];
};
export type StaffOrganizationOverview = {
  teams: StaffTeamDto[];
  members: StaffMemberDto[];
  canManage: boolean;
  templates: typeof STAFF_OPERATIONS_TEMPLATES;
  actorAdminUserId: number;
};

/** Replace only native operations keys, preserving every other domain's effective baseline. */
export function mergeStaffOperationsTemplate(
  role: string,
  stored: readonly string[],
  desired: readonly StaffOperationsPermission[]
): string[] {
  const allowed = new Set<string>(STAFF_OPERATIONS_PERMISSIONS);
  if (desired.some(key => !allowed.has(key)))
    throw new Error("运营模板包含不可下放的权限");
  const baseline = stored.length
    ? stored
    : resolveAdminPermissions(role, stored);
  const result = new Set(baseline.filter(key => !allowed.has(key)));
  for (const key of desired) result.add(key);
  // Explicit row prevents an empty grant set from falling back to role defaults.
  result.add("profile.manage");
  return Array.from(result).sort();
}
