export const OFFICIAL_INVENTORY_PERMISSIONS = [
  "officialInventory.read",
  "officialInventory.write",
  "officialInventory.publish",
  "officialInventory.note",
] as const;

export type OfficialInventoryPermission =
  (typeof OFFICIAL_INVENTORY_PERMISSIONS)[number];
export type OfficialTeamRole = "member" | "leader";
export type OfficialSourceType = "factory" | "agent" | "trade" | "other";
export type OfficialStockStatus = "draft" | "published" | "offshelf";

export type OfficialTeam = {
  id: number;
  name: string;
  status: "active" | "archived";
  revision: number;
};

export type OfficialTeamMember = {
  adminUserId: number;
  displayName: string;
  teamId: number | null;
  teamName: string | null;
  role: OfficialTeamRole | null;
  revision: number;
  officialPermissions: OfficialInventoryPermission[];
};

export type OfficialPermissionTarget = {
  adminUserId: number;
  displayName: string;
  officialPermissions: OfficialInventoryPermission[];
  accountVersion: number;
};

export type OfficialTeamMemberMutation = {
  member: OfficialTeamMember | null;
  officialPermissions: OfficialInventoryPermission[];
  accountVersion: number;
  revision: number;
  requestId: string;
  idempotent: boolean;
};

export type OfficialServerScope = {
  adminUserId: number | null;
  available: boolean;
  isSuperAdmin: boolean;
  teamId: number | null;
  teamRole: OfficialTeamRole | null;
  permissions: OfficialInventoryPermission[];
};

export type OfficialTeamsOverview = {
  available: boolean;
  teams: OfficialTeam[];
  members: OfficialTeamMember[];
  /** Independent native authorization targets; never synthesized from team members. */
  targets: OfficialPermissionTarget[];
  serverScope: OfficialServerScope;
};

export type OfficialPagedList<T> = {
  available: boolean;
  items: T[];
  total: number;
  pageCount: number;
};

export type OfficialStockNotes = {
  available: boolean;
  items: OfficialStockNote[];
};

export type OfficialSource = {
  id: number;
  teamId: number | null;
  name: string;
  type: OfficialSourceType;
  contactName: string | null;
  phone: string | null;
  wechat: string | null;
  qq: string | null;
  notes: string | null;
  active: boolean;
  publicationApproved: boolean;
  everPublished: boolean;
  revision: number;
  /** Present only for a source copied through the official legacy importer. */
  legacySourceId: string | null;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
};

export type OfficialStockPermissions = {
  canEdit: boolean;
  canPublish: boolean;
  canOffshelf: boolean;
  canAddNote: boolean;
};

export type OfficialStock = {
  id: number;
  sourceId: number;
  teamId: number | null;
  sourceName: string;
  sourceType: OfficialSourceType;
  ownerAdminUserId: number | null;
  responsibleName: string | null;
  createdByName: string | null;
  partNumber: string;
  brand: string;
  qty: number | null;
  dateCode: string | null;
  price: string | null;
  currency: "CNY";
  taxIncluded: boolean | null;
  leadTime: string | null;
  note: string | null;
  status: OfficialStockStatus;
  revision: number;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
  latestNote: {
    body: string;
    createdAt: string | Date | null;
    authorName: string | null;
  } | null;
  permissions: OfficialStockPermissions;
  /** Present only in the detail DTO for a stock copied through legacy import. */
  legacyMaterialId: string | null;
};

export type OfficialStockNote = {
  id: number;
  body: string;
  authorName: string | null;
  createdAt: string | Date | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function nonEmptyString(value: unknown): string | null {
  const text = asString(value)?.trim() ?? "";
  return text || null;
}

function asSafePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function asRevision(value: unknown): number {
  return asAccountVersion(value) ?? 0;
}

/** A missing account version is not the valid version zero. */
function asAccountVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function asNullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asDate(value: unknown): string | Date | null {
  return typeof value === "string" || value instanceof Date ? value : null;
}

function parseOfficialPermission(
  value: unknown
): OfficialInventoryPermission | null {
  return typeof value === "string" &&
    (OFFICIAL_INVENTORY_PERMISSIONS as readonly string[]).includes(value)
    ? (value as OfficialInventoryPermission)
    : null;
}

export function normalizeOfficialPermissions(
  value: readonly unknown[]
): OfficialInventoryPermission[] {
  const set = new Set<OfficialInventoryPermission>();
  for (const candidate of value) {
    const permission = parseOfficialPermission(candidate);
    if (permission) set.add(permission);
  }
  if (
    set.has("officialInventory.write") ||
    set.has("officialInventory.publish") ||
    set.has("officialInventory.note")
  ) {
    set.add("officialInventory.read");
  }
  return OFFICIAL_INVENTORY_PERMISSIONS.filter(permission =>
    set.has(permission)
  );
}

function readRole(value: unknown): OfficialTeamRole | null {
  return value === "member" || value === "leader" ? value : null;
}

function readSourceType(value: unknown): OfficialSourceType | null {
  return value === "factory" ||
    value === "agent" ||
    value === "trade" ||
    value === "other"
    ? value
    : null;
}

function readStockStatus(value: unknown): OfficialStockStatus | null {
  return value === "draft" || value === "published" || value === "offshelf"
    ? value
    : null;
}

/**
 * Decodes an authority hint supplied by the official server. It never derives
 * a grant from auth.me, a browser role, or a merchant context. Current team
 * management responses use `currentAccess`; list responses should expose the
 * same data as `serverScope` for non-super-admin inventory users.
 */
export function readOfficialServerScope(value: unknown): OfficialServerScope {
  const root = asRecord(value);
  // Only these two fields are returned by the official routes. This never
  // falls back to a browser role, a merchant context, or an imagined DTO.
  const candidate =
    asRecord(root?.serverScope) ?? asRecord(root?.currentAccess);
  if (!candidate) {
    return {
      adminUserId: null,
      available: false,
      isSuperAdmin: false,
      teamId: null,
      teamRole: null,
      permissions: [],
    };
  }
  const adminUserId = asSafePositiveInteger(candidate.adminUserId);
  const hasDeclaredSuperAdmin = typeof candidate.isSuperAdmin === "boolean";
  const permissions = Array.isArray(candidate.permissions)
    ? candidate.permissions
    : [];
  const hasDeclaredPermissions = Array.isArray(candidate.permissions);
  const teamId = asSafePositiveInteger(candidate.teamId);
  return {
    adminUserId,
    // A successful query without a complete server-derived actor is not a
    // permission grant. Keep every mutation unavailable until the native
    // service identifies the actor and returns its current permission set.
    available:
      candidate.available !== false &&
      adminUserId !== null &&
      hasDeclaredSuperAdmin &&
      hasDeclaredPermissions,
    isSuperAdmin: candidate.isSuperAdmin === true,
    teamId,
    teamRole: readRole(candidate.teamRole),
    permissions: normalizeOfficialPermissions(permissions),
  };
}

/** Only a complete server target can supply the CAS version for a new save. */
export function readOfficialPermissionTarget(
  value: unknown
): OfficialPermissionTarget | null {
  const target = asRecord(value);
  const adminUserId = asSafePositiveInteger(target?.adminUserId);
  const accountVersion = asAccountVersion(target?.accountVersion);
  if (
    !adminUserId ||
    accountVersion === null ||
    !Array.isArray(target?.officialPermissions) ||
    !target.officialPermissions.every(
      permission => parseOfficialPermission(permission) !== null
    )
  )
    return null;
  return {
    adminUserId,
    displayName: nonEmptyString(target.displayName) ?? "未命名员工",
    officialPermissions: normalizeOfficialPermissions(
      target.officialPermissions
    ),
    accountVersion,
  };
}

/**
 * Validates the native overview response before use in administration UI.
 * Invalid or partial values become an unavailable/empty view rather than a
 * business-team fallback; mutations remain disabled.
 */
export function readOfficialTeamsOverview(
  value: unknown
): OfficialTeamsOverview {
  const source = asRecord(value);
  if (!source) {
    return {
      available: false,
      teams: [],
      members: [],
      targets: [],
      serverScope: {
        adminUserId: null,
        available: false,
        isSuperAdmin: false,
        teamId: null,
        teamRole: null,
        permissions: [],
      },
    };
  }
  const hasTeams = Array.isArray(source.teams);
  const hasMembers = Array.isArray(source.members);
  const teamsValue: unknown[] = Array.isArray(source.teams) ? source.teams : [];
  const teams = teamsValue.flatMap(candidate => {
    const team = asRecord(candidate);
    const id = asSafePositiveInteger(team?.id);
    const name = nonEmptyString(team?.name);
    const status =
      team?.status === "archived"
        ? "archived"
        : team?.status === "active"
          ? "active"
          : null;
    if (!id || !name || !status) return [];
    return [
      {
        id,
        name,
        status,
        revision: asRevision(team?.revision),
      } satisfies OfficialTeam,
    ];
  });
  const membersValue: unknown[] = Array.isArray(source.members)
    ? source.members
    : [];
  const members = membersValue.flatMap(candidate => {
    const member = asRecord(candidate);
    const adminUserId = asSafePositiveInteger(member?.adminUserId);
    if (!adminUserId) return [];
    const permissions = Array.isArray(member?.officialPermissions)
      ? normalizeOfficialPermissions(member.officialPermissions)
      : Array.isArray(member?.permissions)
        ? normalizeOfficialPermissions(member.permissions)
        : [];
    return [
      {
        adminUserId,
        displayName: nonEmptyString(member?.displayName) ?? "未命名员工",
        teamId: asSafePositiveInteger(member?.teamId),
        teamName: nonEmptyString(member?.teamName),
        role: readRole(member?.role),
        revision: asRevision(member?.revision),
        officialPermissions: permissions,
      } satisfies OfficialTeamMember,
    ];
  });
  const serverScope = readOfficialServerScope(source);
  const rawTargets: unknown[] = Array.isArray(source.targets)
    ? source.targets
    : [];
  const targets = rawTargets.flatMap(candidate => {
    const parsed = readOfficialPermissionTarget(candidate);
    return parsed ? [parsed] : [];
  });
  const available = serverScope.available && hasTeams && hasMembers;
  return {
    available,
    teams: available ? teams : [],
    members: available ? members : [],
    targets: available && serverScope.isSuperAdmin ? targets : [],
    serverScope,
  };
}

/** Reject incomplete/legacy receipts; callers must refresh instead of inventing a version. */
export function readOfficialTeamMemberMutation(
  value: unknown
): OfficialTeamMemberMutation | null {
  const source = asRecord(value);
  const accountVersion = asAccountVersion(source?.accountVersion);
  const revision = asAccountVersion(source?.revision);
  if (
    !source ||
    accountVersion === null ||
    revision === null ||
    typeof source.idempotent !== "boolean" ||
    typeof source.requestId !== "string" ||
    !/^[A-Za-z0-9_-]{8,64}$/.test(source.requestId) ||
    !Array.isArray(source.officialPermissions) ||
    !source.officialPermissions.every(
      permission => parseOfficialPermission(permission) !== null
    )
  )
    return null;
  const officialPermissions = normalizeOfficialPermissions(
    source.officialPermissions
  );
  let member: OfficialTeamMember | null = null;
  if (source.member !== null) {
    const candidate = asRecord(source.member);
    const adminUserId = asSafePositiveInteger(candidate?.adminUserId);
    const teamId = asSafePositiveInteger(candidate?.teamId);
    const teamName = nonEmptyString(candidate?.teamName);
    const role = readRole(candidate?.role);
    if (
      !adminUserId ||
      !teamId ||
      !teamName ||
      !role ||
      revision === 0 ||
      candidate?.revision !== revision ||
      !Array.isArray(candidate.officialPermissions) ||
      !candidate.officialPermissions.every(
        permission => parseOfficialPermission(permission) !== null
      )
    )
      return null;
    const memberPermissions = normalizeOfficialPermissions(
      candidate.officialPermissions
    );
    if (
      JSON.stringify(memberPermissions) !== JSON.stringify(officialPermissions)
    )
      return null;
    member = {
      adminUserId,
      displayName: nonEmptyString(candidate.displayName) ?? "未命名员工",
      teamId,
      teamName,
      role,
      revision,
      officialPermissions: memberPermissions,
    };
  } else if (revision !== 0) {
    return null;
  }
  return {
    member,
    officialPermissions,
    accountVersion,
    revision,
    requestId: source.requestId,
    idempotent: source.idempotent,
  };
}

export function readOfficialSource(value: unknown): OfficialSource | null {
  const root = asRecord(value);
  const source = asRecord(root?.source) ?? root;
  const id = asSafePositiveInteger(source?.id);
  const name = nonEmptyString(source?.name);
  const type = readSourceType(source?.type);
  const active = asNullableBoolean(source?.active);
  if (!id || !name || !type || active === null) return null;
  return {
    id,
    teamId: asSafePositiveInteger(source?.teamId),
    name,
    type,
    contactName: nonEmptyString(source?.contactName),
    phone: nonEmptyString(source?.phone),
    wechat: nonEmptyString(source?.wechat),
    qq: nonEmptyString(source?.qq),
    notes: nonEmptyString(source?.notes),
    active,
    publicationApproved: source?.publicationApproved === true,
    everPublished: source?.everPublished === true,
    revision: asRevision(source?.revision),
    legacySourceId: nonEmptyString(source?.legacySourceId),
    createdAt: asDate(source?.createdAt),
    updatedAt: asDate(source?.updatedAt),
  };
}

function readListMetadata(source: Record<string, unknown> | null): {
  available: boolean;
  total: number;
  pageCount: number;
} {
  const total = source?.total;
  const pageCount = source?.pageCount;
  const available =
    typeof total === "number" &&
    Number.isSafeInteger(total) &&
    total >= 0 &&
    typeof pageCount === "number" &&
    Number.isSafeInteger(pageCount) &&
    pageCount >= 1;
  return {
    available,
    total: available ? total : 0,
    pageCount: available ? pageCount : 1,
  };
}

export function readOfficialSourceList(
  value: unknown
): OfficialPagedList<OfficialSource> {
  const source = asRecord(value);
  const hasItems = Array.isArray(source?.items);
  const itemsValue: unknown[] =
    source && Array.isArray(source.items) ? source.items : [];
  const items = itemsValue.flatMap(item => {
    const parsed = readOfficialSource(item);
    return parsed ? [parsed] : [];
  });
  const metadata = readListMetadata(source);
  return {
    available:
      hasItems && metadata.available && items.length === itemsValue.length,
    items,
    total: metadata.total,
    pageCount: metadata.pageCount,
  };
}

function readPermissions(value: unknown): OfficialStockPermissions {
  const source = asRecord(value);
  return {
    canEdit: source?.canEdit === true,
    canPublish: source?.canPublish === true,
    canOffshelf: source?.canOffshelf === true,
    canAddNote: source?.canAddNote === true,
  };
}

export function readOfficialStock(value: unknown): OfficialStock | null {
  const source = asRecord(value);
  const id = asSafePositiveInteger(source?.id);
  const sourceId = asSafePositiveInteger(source?.sourceId);
  const sourceName = nonEmptyString(source?.sourceName);
  const sourceType = readSourceType(source?.sourceType);
  const partNumber = nonEmptyString(source?.partNumber);
  const brand = nonEmptyString(source?.brand);
  const status = readStockStatus(source?.status);
  const qty =
    source?.qty === null || source?.qty === undefined
      ? null
      : typeof source.qty === "number" &&
          Number.isSafeInteger(source.qty) &&
          source.qty >= 0
        ? source.qty
        : null;
  const latestNoteSource = asRecord(source?.latestNote);
  if (
    !id ||
    !sourceId ||
    !sourceName ||
    !sourceType ||
    !partNumber ||
    !brand ||
    !status
  )
    return null;
  return {
    id,
    sourceId,
    teamId: asSafePositiveInteger(source?.teamId),
    sourceName,
    sourceType,
    ownerAdminUserId: asSafePositiveInteger(source?.ownerAdminUserId),
    responsibleName: nonEmptyString(source?.responsibleName),
    createdByName: nonEmptyString(source?.createdByName),
    partNumber,
    brand,
    qty,
    dateCode: nonEmptyString(source?.dateCode),
    price: nonEmptyString(source?.price),
    currency: "CNY",
    taxIncluded: asNullableBoolean(source?.taxIncluded),
    leadTime: nonEmptyString(source?.leadTime),
    note: nonEmptyString(source?.note),
    status,
    revision: asRevision(source?.revision),
    createdAt: asDate(source?.createdAt),
    updatedAt: asDate(source?.updatedAt),
    latestNote:
      latestNoteSource && nonEmptyString(latestNoteSource.body)
        ? {
            body: nonEmptyString(latestNoteSource.body)!,
            authorName: nonEmptyString(latestNoteSource.authorName),
            createdAt: asDate(latestNoteSource.createdAt),
          }
        : null,
    permissions: readPermissions(source?.permissions),
    legacyMaterialId: nonEmptyString(source?.legacyMaterialId),
  };
}

export function readOfficialStockList(
  value: unknown
): OfficialPagedList<OfficialStock> {
  const source = asRecord(value);
  const hasItems = Array.isArray(source?.items);
  const itemsValue: unknown[] =
    source && Array.isArray(source.items) ? source.items : [];
  const items = itemsValue.flatMap(item => {
    const parsed = readOfficialStock(item);
    return parsed ? [parsed] : [];
  });
  const metadata = readListMetadata(source);
  return {
    available:
      hasItems && metadata.available && items.length === itemsValue.length,
    items,
    total: metadata.total,
    pageCount: metadata.pageCount,
  };
}

export function readOfficialStockNotes(value: unknown): OfficialStockNotes {
  const source = asRecord(value);
  const rawItems = Array.isArray(source?.items) ? source.items : [];
  const items = rawItems.flatMap(candidate => {
    const note = asRecord(candidate);
    const id = asSafePositiveInteger(note?.id);
    const body = nonEmptyString(note?.body);
    if (!id || !body) return [];
    return [
      {
        id,
        body,
        authorName: nonEmptyString(note?.authorName),
        createdAt: asDate(note?.createdAt),
      } satisfies OfficialStockNote,
    ];
  });
  return { available: Array.isArray(source?.items), items };
}

export function officialRequestId(prefix: string): string {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replaceAll("-", "")
      : `${Date.now()}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${suffix}`.slice(0, 64);
}

export function officialSourceTypeLabel(type: OfficialSourceType): string {
  return { factory: "原厂", agent: "代理商", trade: "贸易商", other: "其他" }[
    type
  ];
}

export function officialTeamRoleLabel(role: OfficialTeamRole | null): string {
  return role === "leader" ? "组长" : role === "member" ? "队员" : "未分组";
}

export function officialPermissionLabel(
  permission: OfficialInventoryPermission
): string {
  return {
    "officialInventory.read": "查看渠道库存",
    "officialInventory.write": "录入和编辑库存",
    "officialInventory.publish": "发布和下架库存",
    "officialInventory.note": "追加内部备注",
  }[permission];
}

export function formatOfficialDate(
  value: string | Date | null | undefined
): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function errorMessage(error: unknown, fallback = "请稍后重试"): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
