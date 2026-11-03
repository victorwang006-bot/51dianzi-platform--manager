import { z } from "zod";

export const BUSINESS_MODULES = ["customers", "demands", "channels", "stocks"] as const;
export type BusinessModule = (typeof BUSINESS_MODULES)[number];
export type BusinessDataScope = "self" | "team" | "enterprise";
export type BusinessModuleAccess = {
  read: boolean;
  write: boolean;
  scope: BusinessDataScope;
  teamId: number | null;
  explicit: boolean;
  teamRole: "leader" | "member" | null;
};
export type BusinessModuleSetting = { module: BusinessModule; read: boolean; write: boolean; scope: BusinessDataScope };
export type BusinessAccessTemplate = { id: string; name: string; description: string; modules: BusinessModuleSetting[] };
export const BUSINESS_TEMPLATE_VERSION = 1;
/** Templates configure business modules only: never grant ERP keys or a team leadership role. */
export const BUSINESS_ACCESS_TEMPLATES: BusinessAccessTemplate[] = [
  { id: "sales", name: "业务员", description: "客户、需求、渠道仅本人；库存允许显式同队共享只读。不会自动新增ERP权限。", modules: BUSINESS_MODULES.map(module => ({ module, read: true, write: true, scope: module === "stocks" ? "team" : "self" })) },
  { id: "lead", name: "业务组长", description: "岗位不自动扩大数据范围；客户、需求、渠道仍仅本人，需要另行显式选择团队范围。不会自动新增ERP权限。", modules: BUSINESS_MODULES.map(module => ({ module, read: true, write: true, scope: module === "stocks" ? "team" : "self" })) },
];
export type BusinessOrganizationOverview = {
  enterprise: { id: number; name: string };
  actorUserId: number;
  canManage: boolean;
  /** Team metadata CAS only; never use as a member's expectedRevision. */
  teams: { id: number; name: string; status: string; revision: number }[];
  members: {
    userId: number; username: string | null; name: string | null; status: string; enterpriseRole: string;
    /** revision is enterprise_members.permissionVersion, including when unassigned to a team. */
    teamId: number | null; teamRole: "leader" | "member" | null; revision: number;
    moduleAccess: (BusinessModuleSetting & { revision: number; explicit: boolean })[];
  }[];
  templates: BusinessAccessTemplate[];
};
export const businessRequestIdSchema = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);
const id = z.number().int().positive();
const revision = z.number().int().nonnegative();
const name = z.string().trim().min(1).max(80);
const notes = z.string().trim().max(500).optional();
export const businessCreateTeamSchema = z.object({ name, notes, requestId: businessRequestIdSchema }).strict();
export const businessUpdateTeamSchema = z.object({ id, name, notes, expectedRevision: revision, requestId: businessRequestIdSchema }).strict();
/** expectedRevision is the member's monotonic permissionVersion, not either team's revision. */
export const businessSetMemberSchema = z.object({ userId: id, teamId: id.nullable(), role: z.enum(["leader", "member"]).nullable(), expectedRevision: revision, requestId: businessRequestIdSchema }).strict().refine(value => (value.teamId === null) === (value.role === null), "团队与岗位须同时设置或同时清空");
export const businessModuleSettingSchema = z.object({ module: z.enum(BUSINESS_MODULES), read: z.boolean(), write: z.boolean(), scope: z.enum(["self", "team", "enterprise"]), expectedRevision: revision }).strict().refine(value => !value.write || value.read, "写权限必须包含读权限").refine(value => value.module !== "channels" || value.scope === "self", "渠道始终私有");
export const businessUpdateMemberAccessSchema = z.object({ userId: id, modules: z.array(businessModuleSettingSchema).length(4), templateId: z.enum(["sales", "lead"]).optional(), requestId: businessRequestIdSchema }).strict().refine(value => new Set(value.modules.map(item => item.module)).size === 4, "必须提供完整且不重复的四个模块");
export const businessAuditSchema = z.object({ page: z.number().int().min(1).max(1_000_000).default(1), pageSize: z.number().int().min(1).max(100).default(30) }).default({ page: 1, pageSize: 30 });
export type BusinessCreateTeamInput = z.infer<typeof businessCreateTeamSchema>;
export type BusinessUpdateTeamInput = z.infer<typeof businessUpdateTeamSchema>;
export type BusinessSetMemberInput = z.infer<typeof businessSetMemberSchema>;
export type BusinessUpdateMemberAccessInput = z.infer<typeof businessUpdateMemberAccessSchema>;
/** Saved intent is distinct from effective access: ERP entitlement is never implied by success. */
export type BusinessUpdateAccessResult = {
  success: true; idempotent: boolean; erpGrantsChanged: false;
  modules: (BusinessModuleSetting & { revision: number; explicit: boolean; entitled: boolean; requested: BusinessModuleSetting; notEntitled: boolean })[];
};
