import {
  normalizeAssignedAdminPermissions,
  type AdminPermission,
} from "@shared/adminPermissions";
import {
  ERP_PERMISSION_DEFINITIONS,
  ERP_PERMISSION_GROUPS,
  ERP_VISIBLE_PERMISSION_KEYS,
  isErpPermissionKey,
  normalizeErpPermissions,
  type ErpPermissionKey,
} from "@/business/platform/shared/erpPermissions";

/** The business BFF permits only this official merchant. It is never an authorization source. */
export const OFFICIAL_STAFF_MERCHANT_ID = 30061;

export type StaffAdminAccount = {
  id: number;
  username: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  adminRole: string;
  status: "active" | "disabled" | "locked" | string;
  permissions: readonly string[];
  lastLoginAt?: Date | string | null;
  lastLoginIpAddress?: string | null;
  lastLoginLocation?: string | null;
  lastLoginDevice?: string | null;
  securityRiskLevel?: string | null;
  createdAt?: Date | string | null;
};

export type StaffEnterpriseMember = {
  memberId: number;
  userId: number;
  displayName: string;
  phone: string | null;
  role: string | null;
  status: "active" | "suspended";
  permissionKeys: ErpPermissionKey[];
  inventoryDataScope: "own" | "enterprise";
  isOwner: boolean;
};

export type StaffBinding = {
  adminUserId: number;
  frontUserId: number;
  bindingVersion: number;
};

export type StaffBffScope = {
  merchantId: number;
  modulePermissions: readonly string[];
};

export type BindingReadState = "not-requested" | "loading" | "error" | "unbound" | "bound";
export type ScopeReadState = "not-requested" | "loading" | "error" | "missing" | "ready";

export type StaffBffReadiness = {
  state: "not-applicable" | "checking" | "unlinked" | "scope-unavailable" | "scope-incomplete" | "ready";
  missingPermissions: string[];
  detail: string;
};

/** Minimum verified operator context needed before an ERP member write may start. */
export type StaffErpEditorAccess = {
  available: boolean;
  canManageMembers: boolean;
  actorIsOwner: boolean;
  currentUserId: number | null;
  grantableKeys: readonly ErpPermissionKey[];
};

export type StaffErpMutationGuard =
  | { allowed: true }
  | { allowed: false; reason: string };

export type StaffRow = {
  key: string;
  admin?: StaffAdminAccount;
  member?: StaffEnterpriseMember;
  /** Only a current server-returned binding may connect these two records. */
  binding?: StaffBinding | null;
  bindingState: BindingReadState;
  scope?: StaffBffScope | null;
  scopeState: ScopeReadState;
  bff: StaffBffReadiness;
};

export type StaffSaveDraft = {
  adminRole: string;
  adminPermissions: AdminPermission[];
  erpPermissionKeys: ErpPermissionKey[];
  inventoryDataScope: "own" | "enterprise";
};

export type StaffSaveBaseline = StaffSaveDraft;

export type StaffSaveCompletion = {
  erpPermissions: boolean;
  erpScope: boolean;
  admin: boolean;
};

export type StaffSaveOutcome = {
  completed: StaffSaveCompletion;
  errors: Partial<Record<keyof StaffSaveCompletion, string>>;
};

export const STAFF_ADMIN_PERMISSION_GROUPS: ReadonlyArray<{
  title: string;
  options: ReadonlyArray<{ key: AdminPermission; label: string; requires?: AdminPermission }>;
}> = [
  {
    title: "数据物料库",
    options: [
      { key: "materials.read", label: "查看" },
      { key: "materials.write", label: "维护", requires: "materials.read" },
    ],
  },
  {
    title: "商户管理",
    options: [
      { key: "merchants.read", label: "查看" },
      { key: "merchants.write", label: "维护", requires: "merchants.read" },
    ],
  },
  {
    title: "用户管理",
    options: [
      { key: "portalUsers.read", label: "查看" },
      { key: "portalUsers.manage", label: "管理", requires: "portalUsers.read" },
    ],
  },
  {
    title: "消息中心",
    options: [
      { key: "messages.read", label: "查看" },
      { key: "messages.write", label: "处理", requires: "messages.read" },
    ],
  },
  { title: "订单管理", options: [{ key: "orders.read", label: "查看" }] },
  { title: "运营数据", options: [{ key: "analytics.read", label: "查看" }] },
];

const STAFF_ADMIN_UI_PERMISSION_SET = new Set<AdminPermission>(
  STAFF_ADMIN_PERMISSION_GROUPS.flatMap(group => group.options.map(option => option.key)),
);

const ERP_SCOPE_REQUIREMENTS: Partial<Record<ErpPermissionKey, readonly string[]>> = {
  "inventory.manage": ["business.inventory.read", "business.inventory.write"],
  "inventory.publish": ["business.inventory.read", "business.inventory.write"],
  "inquiry.receive": ["business.inventory.read", "business.inventory.write"],
  "sales_orders.manage": ["business.orders.read", "business.orders.write"],
  "inventory.inbound": ["business.inventory.read", "business.inventory.write"],
  "enterprise.members.manage": ["business.users.read", "business.users.write"],
  "customers.manage": ["business.customers.read", "business.customers.write"],
  "customers.manage_all": ["business.customers.read", "business.customers.write"],
  "procurement.demands": ["business.procurement.read", "business.procurement.write"],
  "sales.business_orders": ["business.orders.read", "business.orders.write"],
  "procurement.orders": ["business.procurement.read", "business.procurement.write"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function positiveInteger(value: unknown): number | null {
  const candidate = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** Query keys are deliberately partitioned by authenticated admin and merchant candidate. */
export function staffQueryKey(
  accountId: string | number | null | undefined,
  merchantId: number | null | undefined,
  resource: string,
  targetId?: number,
) {
  return [
    "staff",
    accountId ?? "signed-out",
    merchantId ?? "unselected",
    resource,
    ...(targetId === undefined ? [] : [targetId]),
  ] as const;
}

export function staffQueryPrefix(accountId: string | number | null | undefined) {
  return ["staff", accountId ?? "signed-out"] as const;
}

export type StaffMerchantSelection =
  | { status: "implicit" }
  | { status: "valid"; merchantId: number }
  | { status: "invalid"; reason: string };

/** A URL can restore one choice only; it cannot create a merchant authorization. */
export function readStaffMerchantSelection(search: string): StaffMerchantSelection {
  const values = new URLSearchParams(search).getAll("merchantId");
  if (values.length === 0) return { status: "implicit" };
  if (values.length !== 1) {
    return { status: "invalid", reason: "merchantId 必须且只能出现一次" };
  }
  const merchantId = positiveInteger(values[0]);
  if (!merchantId) return { status: "invalid", reason: "merchantId 必须是单一正整数" };
  if (merchantId !== OFFICIAL_STAFF_MERCHANT_ID) {
    return { status: "invalid", reason: "员工业务权限中心仅支持当前核准的官方商户" };
  }
  return { status: "valid", merchantId };
}

export function selectOfficialStaffMerchant(
  navigation: unknown,
  selection: StaffMerchantSelection,
): { merchantId: number | null; reason: string | null } {
  if (selection.status === "invalid") return { merchantId: null, reason: selection.reason };
  const requested = selection.status === "valid" ? selection.merchantId : OFFICIAL_STAFF_MERCHANT_ID;
  const merchants = isRecord(navigation) && Array.isArray(navigation.merchants)
    ? navigation.merchants
    : [];
  const official = merchants.find(merchant => isRecord(merchant) && positiveInteger(merchant.id) === requested);
  if (!official) {
    return {
      merchantId: null,
      reason: "当前账号的业务导航未返回该官方商户；系统不会以固定商户号替代授权结果。",
    };
  }
  return { merchantId: requested, reason: null };
}

export type StaffBusinessContext = {
  merchantId: number;
  enterpriseId: number;
  frontendUserId: number;
  capabilities: string[];
  writeCapabilities: string[];
};

/** Mirrors the workbench's fail-closed proof before any enterprise request is made. */
export function validateStaffBusinessContext(
  value: unknown,
  accountId: unknown,
  selectedMerchantId: number | null,
): { context: StaffBusinessContext | null; reason: string | null } {
  if (!selectedMerchantId || !isRecord(value)) {
    return { context: null, reason: "尚未取得当前商户的业务上下文" };
  }
  const principal = value.staffPrincipal;
  const merchant = value.merchant;
  const currentAccountId = positiveInteger(accountId);
  if (!isRecord(principal) || principal.status !== "ready" || !isRecord(principal.user)) {
    return { context: null, reason: "业务工作人员主体未处于 ready 状态" };
  }
  const frontendUserId = positiveInteger(principal.frontendUserId);
  const principalUserId = positiveInteger(principal.user.id);
  const adminAccountId = positiveInteger(principal.adminAccountId);
  const enterpriseId = positiveInteger(principal.enterpriseId);
  const merchantId = isRecord(merchant) ? positiveInteger(merchant.id) : null;
  const contextEnterpriseId = isRecord(value.enterprise) ? positiveInteger(value.enterprise.id) : null;
  if (!frontendUserId || principalUserId !== frontendUserId || !adminAccountId || adminAccountId !== currentAccountId || !enterpriseId || contextEnterpriseId !== enterpriseId || merchantId !== selectedMerchantId) {
    return { context: null, reason: "业务上下文的后台账号、前台员工、企业或商户校验未通过" };
  }
  const capabilities = stringList(value.workbenchCapabilities);
  const writeCapabilities = stringList(value.writeCapabilities);
  if (!capabilities.includes("enterprise.members.manage") || !writeCapabilities.includes("enterprise.members.manage")) {
    return { context: null, reason: "当前商户未同时返回企业成员管理的可读与可写能力" };
  }
  return {
    context: { merchantId, enterpriseId, frontendUserId, capabilities, writeCapabilities },
    reason: null,
  };
}

/** A later domain response must prove the same employee and enterprise as the BFF context. */
export function validateStaffEnterpriseSummary(value: unknown, context: StaffBusinessContext | null): boolean {
  if (!context || !isRecord(value) || !isRecord(value.enterprise)) return false;
  return positiveInteger(value.currentUserId) === context.frontendUserId
    && positiveInteger(value.enterprise.id) === context.enterpriseId;
}

/** Full-replacement ERP writes may not silently discard rights the actor cannot grant. */
export function protectedStaffErpKeys(
  current: readonly ErpPermissionKey[],
  grantable: readonly ErpPermissionKey[],
  actorIsOwner: boolean,
): ErpPermissionKey[] {
  if (actorIsOwner) return [];
  const available = new Set(grantable);
  return current.filter(key => !available.has(key));
}

export function toggleStaffErpPermission(
  current: readonly ErpPermissionKey[],
  key: ErpPermissionKey,
  grantable: readonly ErpPermissionKey[],
  actorIsOwner: boolean,
): ErpPermissionKey[] {
  if (protectedStaffErpKeys(current, grantable, actorIsOwner).length || !grantable.includes(key)) {
    return [...current];
  }
  const selected = new Set(current);
  if (selected.has(key)) {
    selected.delete(key);
    if (key === "customers.manage") selected.delete("customers.manage_all");
  } else {
    selected.add(key);
    if (key === "customers.manage_all") selected.add("customers.manage");
  }
  return ERP_VISIBLE_PERMISSION_KEYS.filter(permission => selected.has(permission));
}

export function parseEnterpriseMembers(value: unknown): StaffEnterpriseMember[] {
  const source = isRecord(value) && Array.isArray(value.members) ? value.members : [];
  const members: StaffEnterpriseMember[] = [];
  for (const candidate of source) {
    if (!isRecord(candidate)) continue;
    const memberId = positiveInteger(candidate.memberId);
    const userId = positiveInteger(candidate.userId);
    if (!memberId || !userId) continue;
    const keys = normalizeErpPermissions(stringList(candidate.permissionKeys).filter(isErpPermissionKey));
    members.push({
      memberId,
      userId,
      displayName: typeof candidate.displayName === "string" && candidate.displayName.trim()
        ? candidate.displayName
        : `成员 #${userId}`,
      phone: typeof candidate.phone === "string" ? candidate.phone : null,
      role: typeof candidate.role === "string" ? candidate.role : null,
      status: candidate.status === "suspended" ? "suspended" : "active",
      permissionKeys: keys,
      inventoryDataScope: candidate.inventoryDataScope === "enterprise" ? "enterprise" : "own",
      isOwner: candidate.isOwner === true,
    });
  }
  return members;
}

/**
 * `staffBindings.current` is already active-only on the server. The browser
 * must still reject a response whose returned principal is not the requested
 * admin account; response shape alone is not an identity proof.
 */
export function parseStaffBinding(value: unknown, expectedAdminUserId: unknown): StaffBinding | null {
  if (!isRecord(value)) return null;
  const expectedAdminId = positiveInteger(expectedAdminUserId);
  const adminUserId = positiveInteger(value.adminUserId);
  const frontUserId = positiveInteger(value.frontUserId);
  const bindingVersion = positiveInteger(value.bindingVersion);
  if (!expectedAdminId || !adminUserId || adminUserId !== expectedAdminId || !frontUserId || !bindingVersion) return null;
  return { adminUserId, frontUserId, bindingVersion };
}

export function exactMerchantScope(value: unknown, merchantId: number | null): StaffBffScope | null {
  if (!merchantId || !Array.isArray(value)) return null;
  const raw = value.find(item => isRecord(item) && positiveInteger(item.merchantId) === merchantId);
  if (!isRecord(raw)) return null;
  return { merchantId, modulePermissions: stringList(raw.modulePermissions) };
}

function requiredBffPermissions(member: StaffEnterpriseMember): string[] {
  const required = new Set<string>(["business.context.read"]);
  for (const key of member.permissionKeys) {
    for (const permission of ERP_SCOPE_REQUIREMENTS[key] ?? []) required.add(permission);
  }
  return Array.from(required).sort();
}

export function evaluateBffReadiness(input: {
  admin?: StaffAdminAccount;
  member?: StaffEnterpriseMember;
  binding?: StaffBinding | null;
  bindingState: BindingReadState;
  scope?: StaffBffScope | null;
  scopeState: ScopeReadState;
  expectedMerchantId: number | null;
}): StaffBffReadiness {
  const { admin, member, binding, bindingState, scope, scopeState, expectedMerchantId } = input;
  if (!admin || !member) {
    return {
      state: "not-applicable",
      missingPermissions: [],
      detail: admin
        ? "未关联到官方企业成员；系统不会按姓名或手机号自动合并账号。"
        : "未关联后台账号；ERP 设置不代表 BFF 工作台可用。",
    };
  }
  if (bindingState === "loading") return { state: "checking", missingPermissions: [], detail: "正在核验后台账号与前台员工绑定…" };
  if (bindingState === "error") return { state: "checking", missingPermissions: [], detail: "绑定状态暂不可读，未将其视为未关联。" };
  if (bindingState !== "bound" || !binding || binding.adminUserId !== admin.id || binding.frontUserId !== member.userId) {
    return { state: "unlinked", missingPermissions: [], detail: "后台账号与该企业成员没有可用的一对一绑定，不能合并保存两侧权限。" };
  }
  if (scopeState === "loading") return { state: "checking", missingPermissions: [], detail: "正在读取该官方商户的 BFF scope…" };
  if (scopeState === "error") return { state: "checking", missingPermissions: [], detail: "该官方商户的 BFF scope 暂不可读，未将请求错误视为范围缺失。" };
  if (admin.status !== "active" || member.status !== "active") {
    return { state: "scope-incomplete", missingPermissions: [], detail: "后台账号或企业成员不是 active，BFF 不会把该组合视为有效业务人员。" };
  }
  if (!expectedMerchantId || !scope || scope.merchantId !== expectedMerchantId) {
    return { state: "scope-unavailable", missingPermissions: ["business.context.read"], detail: "未找到该官方商户的 active BFF scope。" };
  }
  const required = requiredBffPermissions(member);
  const missingPermissions = required.filter(permission => !scope.modulePermissions.includes(permission));
  if (missingPermissions.length) {
    return {
      state: "scope-incomplete",
      missingPermissions,
      detail: "ERP 已配置的模块仍缺少该商户 BFF scope；不会把 ERP 勾选当作最终工作台权限。",
    };
  }
  return {
    state: "ready",
    missingPermissions: [],
    detail: "绑定、active 状态和该商户 scope 前置条件已匹配；每个业务请求仍由 BFF 与原站服务复核。",
  };
}

/**
 * Shared UI/save gate. A ready BFF state is only accepted with the same target
 * admin/front identity again checked here, so a stale or handcrafted row cannot
 * make an ERP mutation permissive.
 */
export function staffErpMutationGuard(
  row: StaffRow | null | undefined,
  access: Pick<StaffErpEditorAccess, "available" | "canManageMembers" | "currentUserId">,
): StaffErpMutationGuard {
  const member = row?.member;
  const admin = row?.admin;
  const binding = row?.binding;
  if (!member || !admin) return { allowed: false, reason: "目标后台账号或企业成员未完成可信关联，ERP 设置保持禁用。" };
  if (member.isOwner) return { allowed: false, reason: "企业所有者的 ERP 权限与业务范围只读。" };
  if (access.currentUserId === member.userId) return { allowed: false, reason: "当前业务操作者不能修改自己的 ERP 权限或业务范围。" };
  if (!access.available) return { allowed: false, reason: "业务上下文未安全就绪，ERP 设置保持禁用。" };
  if (!access.canManageMembers) return { allowed: false, reason: "当前前台业务员工没有企业成员管理权限。" };
  if (row.bindingState !== "bound" || row.bff.state !== "ready") {
    return { allowed: false, reason: "目标成员的绑定或 BFF 前置核验未完成，ERP 设置保持禁用。" };
  }
  if (!binding || binding.adminUserId !== admin.id || binding.frontUserId !== member.userId) {
    return { allowed: false, reason: "目标成员的后台账号与前台身份绑定不一致，ERP 设置保持禁用。" };
  }
  return { allowed: true };
}

/** The caller supplies the sole mutation action; denied states never invoke it. */
export async function runGuardedStaffErpMutation<T>(
  row: StaffRow | null | undefined,
  access: Pick<StaffErpEditorAccess, "available" | "canManageMembers" | "currentUserId">,
  mutation: () => Promise<T>,
): Promise<StaffErpMutationGuard & { value?: T }> {
  const guard = staffErpMutationGuard(row, access);
  if (!guard.allowed) return guard;
  return { allowed: true, value: await mutation() };
}

export function mergeStaffRows(input: {
  admins: readonly StaffAdminAccount[];
  members: readonly StaffEnterpriseMember[];
  bindings: ReadonlyMap<number, { state: BindingReadState; binding: StaffBinding | null }>;
  scopes: ReadonlyMap<number, { state: ScopeReadState; scope: StaffBffScope | null }>;
  expectedMerchantId: number | null;
}): StaffRow[] {
  const memberByUserId = new Map(input.members.map(member => [member.userId, member]));
  const attachedMemberIds = new Set<number>();
  const rows: StaffRow[] = input.admins.map(admin => {
    const bindingResult = input.bindings.get(admin.id) ?? { state: "not-requested" as const, binding: null };
    const binding = bindingResult.binding?.adminUserId === admin.id ? bindingResult.binding : null;
    const member = binding ? memberByUserId.get(binding.frontUserId) : undefined;
    if (member) attachedMemberIds.add(member.userId);
    const scopeResult = input.scopes.get(admin.id) ?? { state: "not-requested" as const, scope: null };
    return {
      key: `admin:${admin.id}`,
      admin,
      member,
      binding,
      bindingState: bindingResult.state,
      scope: scopeResult.scope,
      scopeState: scopeResult.state,
      bff: evaluateBffReadiness({ admin, member, binding, bindingState: bindingResult.state, scope: scopeResult.scope, scopeState: scopeResult.state, expectedMerchantId: input.expectedMerchantId }),
    };
  });
  for (const member of input.members) {
    if (attachedMemberIds.has(member.userId)) continue;
    rows.push({
      key: `member:${member.userId}`,
      member,
      bindingState: "not-requested",
      scopeState: "not-requested",
      bff: evaluateBffReadiness({ member, bindingState: "not-requested", scopeState: "not-requested", expectedMerchantId: input.expectedMerchantId }),
    });
  }
  return rows;
}

export function staffDraftFromRow(row: StaffRow): StaffSaveDraft {
  return {
    adminRole: row.admin?.adminRole ?? "merchant_mgr",
    adminPermissions: row.admin
      ? normalizeStaffAdminPermissions(row.admin.permissions)
      : [],
    erpPermissionKeys: row.member?.permissionKeys ?? [],
    inventoryDataScope: row.member?.inventoryDataScope ?? "own",
  };
}

export function normalizeStaffAdminPermissions(values: readonly string[]): AdminPermission[] {
  const selected = values.filter((value): value is AdminPermission =>
    STAFF_ADMIN_UI_PERMISSION_SET.has(value as AdminPermission),
  );
  return normalizeAssignedAdminPermissions(selected)
    .filter(permission => STAFF_ADMIN_UI_PERMISSION_SET.has(permission));
}

/**
 * Preserve fixed and legacy service permissions while only editing the visible
 * operation controls. The server remains the final normalizer and risk gate.
 */
export function adminPermissionsForUpdate(
  existing: readonly string[],
  draftVisible: readonly string[],
  role: string,
): AdminPermission[] {
  if (role === "super_admin") return [];
  const preserved = existing.filter(permission =>
    permission === "profile.manage" || permission.startsWith("business.") || permission.startsWith("officialInventory."),
  );
  return normalizeAssignedAdminPermissions([...preserved, ...normalizeStaffAdminPermissions(draftVisible)]);
}

function orderedErp(values: readonly ErpPermissionKey[]): ErpPermissionKey[] {
  const selected = new Set(values);
  return ERP_VISIBLE_PERMISSION_KEYS.filter(key => selected.has(key));
}

function orderedAdmin(values: readonly AdminPermission[]): AdminPermission[] {
  return [...values].sort();
}

export function sameStringSet(left: readonly string[], right: readonly string[]) {
  const a = Array.from(new Set(left)).sort();
  const b = Array.from(new Set(right)).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function staffChangePreview(base: StaffSaveBaseline, draft: StaffSaveDraft) {
  const baseErp = orderedErp(base.erpPermissionKeys);
  const draftErp = orderedErp(draft.erpPermissionKeys);
  const baseAdmin = orderedAdmin(base.adminPermissions);
  const draftAdmin = orderedAdmin(draft.adminPermissions);
  return {
    erpAdded: draftErp.filter(key => !baseErp.includes(key)),
    erpRemoved: baseErp.filter(key => !draftErp.includes(key)),
    adminAdded: draftAdmin.filter(key => !baseAdmin.includes(key)),
    adminRemoved: baseAdmin.filter(key => !draftAdmin.includes(key)),
    scopeChanged: base.inventoryDataScope !== draft.inventoryDataScope,
    roleChanged: base.adminRole !== draft.adminRole,
  };
}

export function hasStaffDraftChanges(base: StaffSaveBaseline, draft: StaffSaveDraft) {
  const preview = staffChangePreview(base, draft);
  return preview.erpAdded.length > 0
    || preview.erpRemoved.length > 0
    || preview.adminAdded.length > 0
    || preview.adminRemoved.length > 0
    || preview.scopeChanged
    || preview.roleChanged;
}

export function erpPermissionLabel(key: ErpPermissionKey) {
  return ERP_PERMISSION_DEFINITIONS[key].label;
}

/**
 * List-only presentation derived from a real merged row. It never invents
 * permissions or changes the full set used by the editor and save guards.
 */
export function staffErpPermissionPreview(
  row: Pick<StaffRow, "member">,
  maxVisible = 2,
): { labels: string[]; remaining: number; total: number } {
  const member = row.member;
  if (!member) return { labels: [], remaining: 0, total: 0 };
  if (member.isOwner) return { labels: ["全部 ERP 权限"], remaining: 0, total: 1 };
  const visibleCount = Math.max(0, Math.floor(maxVisible));
  return {
    labels: member.permissionKeys.slice(0, visibleCount).map(erpPermissionLabel),
    remaining: Math.max(0, member.permissionKeys.length - visibleCount),
    total: member.permissionKeys.length,
  };
}

/** A row is actionable only through the existing unified permission sheet. */
export function staffRowNeedsAssociation(row: Pick<StaffRow, "admin" | "member">) {
  return !row.admin || !row.member;
}

export { ERP_PERMISSION_GROUPS, ERP_VISIBLE_PERMISSION_KEYS };
