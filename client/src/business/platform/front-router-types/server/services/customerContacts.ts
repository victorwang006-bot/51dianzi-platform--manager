import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql, type SQLWrapper } from "drizzle-orm";
import type { CustomerData } from "../../../shared/crmCustomers";
import type {
  ContactChangeResult,
  ContactRecord,
  ContactSummary,
  ContactsListResult,
  CreateMultiInput,
  CustomerContactInput,
  CustomerContactMethod,
  CustomerMutableContactInput,
  UpdateBasicResult,
} from "../../../shared/customerContacts";
import {
  contactsAddSchema,
  contactsEditSchema,
  contactsListSchema,
  contactsSetPrimarySchema,
  contactsStopSchema,
  contactsSummarySchema,
  createMultiSchema,
  updateBasicSchema,
} from "../../../shared/customerContacts";
import {
  CRM_NOW,
  createCustomer,
  crmCustomerDuplicateState,
  displayName,
  insertCrmCustomerContactAudit,
  normalizeCustomerEmail,
  normalizeCustomerName,
  normalizeCustomerPhone,
  nullableText,
  prepareCrmCustomerCreateExtension,
  throwCrmCustomerDuplicate,
  toBeijingSqlDate,
  type CrmCustomerContactCustomer,
  type CrmCustomerContactTransaction,
  type CrmSqlExecutor,
  type CustomerServerScope,
  withCrmCustomerContactRead,
  withCrmCustomerContactTransaction,
} from "./crmCustomers";

type DateValue = Date | string | null | undefined;
type ContactPointerRow = { primaryContactId: string; legacyContactPresent: number | boolean };
type LegacyContactRow = {
  id: number;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  createdAt: DateValue;
  updatedAt: DateValue;
};
type ContactProfileRow = {
  id: string;
  name: string;
  department: string | null;
  position: string | null;
  createdByUserId: number | null;
  stoppedAt: DateValue;
  version: number;
  createdAt: DateValue;
  updatedAt: DateValue;
  authorName: string | null;
};
type ContactMethodRow = {
  id: number;
  methodType: CustomerContactMethod["type"];
  value: string;
  label: string | null;
  stoppedAt?: DateValue;
};
type CustomerSummaryRow = {
  id: number;
  legacyRowId: number | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  primaryContactId: string | null;
  legacyContactPresent: number | boolean | null;
};

type ContactRequestRow = { action: string; payloadHash: string; responseJson: unknown };
type ResultHeader = { affectedRows?: number; insertId?: number };

type ContactCore = Pick<CustomerContactInput, "name" | "department" | "position" | "methods">;

function rows<T>(result: unknown): T[] {
  const first = (result as [unknown, unknown] | undefined)?.[0];
  return Array.isArray(first) ? first as T[] : [];
}

function resultHeader(result: unknown): ResultHeader {
  const first = (result as [unknown, unknown] | undefined)?.[0];
  return first && typeof first === "object" && !Array.isArray(first) ? first as ResultHeader : {};
}

function fail(code: "BAD_REQUEST" | "CONFLICT" | "FORBIDDEN" | "NOT_FOUND" | "INTERNAL_SERVER_ERROR", message: string): never {
  throw new TRPCError({ code, message });
}

function assertExpectedIdentity(scope: CustomerServerScope, input: { expectedActorUserId: number; expectedEnterpriseId: number }) {
  if (scope.actorUserId !== input.expectedActorUserId || scope.enterpriseId !== input.expectedEnterpriseId) {
    fail("FORBIDDEN", "当前登录身份或企业已变化，请刷新后重试");
  }
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function legacyContactId(customerId: number) {
  return `legacy:${customerId}`;
}

function iso(value: DateValue): string | null {
  if (!value) return null;
  const parsed = value instanceof Date
    ? value
    : new Date(String(value).includes(" ") ? `${String(value).replace(" ", "T")}+08:00` : String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function canonicalMethod(method: CustomerContactMethod): CustomerContactMethod {
  return {
    type: method.type,
    value: method.value.trim(),
    ...(method.label?.trim() ? { label: method.label.trim() } : {}),
  };
}

function normalizedMethod(method: CustomerContactMethod) {
  if (method.type === "email") return normalizeCustomerEmail(method.value);
  if (method.type === "mobile" || method.type === "landline") return normalizeCustomerPhone(method.value);
  return method.value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
}

function canonicalContact(contact: ContactCore & { isPrimary?: boolean }): CustomerContactInput {
  return {
    name: contact.name.trim(),
    department: contact.department.trim(),
    position: contact.position.trim(),
    methods: contact.methods.map(canonicalMethod),
    isPrimary: Boolean(contact.isPrimary),
  };
}

function mapMethod(row: ContactMethodRow): CustomerContactMethod {
  return {
    type: row.methodType,
    value: row.value,
    ...(row.label ? { label: row.label } : {}),
  };
}

function canManageCustomerContact(
  scope: CustomerServerScope,
  context: Pick<CrmCustomerContactTransaction, "customer" | "canManageAll">,
) {
  return context.canManageAll || Number(context.customer.assignedUserId) === scope.actorUserId;
}

/** The customer ownership boundary remains primary; author identity only narrows a future non-owner path. */
function assertCanWriteProfile(
  scope: CustomerServerScope,
  context: CrmCustomerContactTransaction,
  profile: Pick<ContactProfileRow, "createdByUserId">,
) {
  if (canManageCustomerContact(scope, context)) return;
  if (profile.createdByUserId != null && Number(profile.createdByUserId) === scope.actorUserId) return;
  fail("FORBIDDEN", "只能修改本人录入的联系人");
}

function assertCanManageContact(scope: CustomerServerScope, context: CrmCustomerContactTransaction) {
  if (!canManageCustomerContact(scope, context)) fail("FORBIDDEN", "您没有该客户的联系人操作权限");
}

async function getLegacyContact(tx: CrmSqlExecutor, customerId: number, lock = false) {
  const lockSql = lock ? sql` FOR UPDATE` : sql``;
  return rows<LegacyContactRow>(await tx.execute(sql`
    SELECT id, contactName, phone, email, createdAt, updatedAt
      FROM crm_customer_contacts
     WHERE customerId = ${customerId} AND isPrimary = 1
     LIMIT 1${lockSql}
  `))[0] ?? null;
}

async function getPointer(
  tx: CrmSqlExecutor,
  scope: CustomerServerScope,
  customerId: number,
  lock = false,
) {
  const lockSql = lock ? sql` FOR UPDATE` : sql``;
  return rows<ContactPointerRow>(await tx.execute(sql`
    SELECT primaryContactId, legacyContactPresent
      FROM crm_customer_contact_primary
     WHERE enterpriseId = ${scope.enterpriseId} AND customerId = ${customerId}
     LIMIT 1${lockSql}
  `))[0] ?? null;
}

/** Mutations, never reads, materialize a legacy pointer. */
async function ensurePointer(tx: CrmSqlExecutor, scope: CustomerServerScope, customerId: number) {
  let pointer = await getPointer(tx, scope, customerId, true);
  if (pointer) return pointer;
  const legacy = await getLegacyContact(tx, customerId, true);
  await tx.execute(sql`
    INSERT INTO crm_customer_contact_primary
      (enterpriseId, customerId, primaryContactId, legacyContactPresent, updatedByUserId, updatedAt)
    VALUES (
      ${scope.enterpriseId}, ${customerId}, ${legacy ? legacyContactId(customerId) : ""},
      ${legacy ? 1 : 0}, ${scope.actorUserId}, ${CRM_NOW}
    )
  `);
  pointer = await getPointer(tx, scope, customerId, true);
  if (!pointer) fail("INTERNAL_SERVER_ERROR", "主联系人指针创建失败");
  return pointer;
}

async function getProfile(
  tx: CrmSqlExecutor,
  scope: CustomerServerScope,
  customerId: number,
  contactId: string,
  lock = false,
) {
  const lockSql = lock ? sql` FOR UPDATE` : sql``;
  return rows<ContactProfileRow>(await tx.execute(sql`
    SELECT p.*, COALESCE(u.name, u.username, CONCAT('用户', u.id)) AS authorName
      FROM crm_customer_contact_profiles p
      LEFT JOIN users u ON u.id = p.createdByUserId
     WHERE p.enterpriseId = ${scope.enterpriseId} AND p.customerId = ${customerId} AND p.id = ${contactId}
     LIMIT 1${lockSql}
  `))[0] ?? null;
}

async function listProfiles(tx: CrmSqlExecutor, scope: CustomerServerScope, customerId: number) {
  return rows<ContactProfileRow>(await tx.execute(sql`
    SELECT p.*, COALESCE(u.name, u.username, CONCAT('用户', u.id)) AS authorName
      FROM crm_customer_contact_profiles p
      LEFT JOIN users u ON u.id = p.createdByUserId
     WHERE p.enterpriseId = ${scope.enterpriseId} AND p.customerId = ${customerId}
     ORDER BY p.stoppedAt IS NOT NULL, p.createdAt, p.id
  `));
}

async function getMethods(
  tx: CrmSqlExecutor,
  scope: CustomerServerScope,
  customerId: number,
  contactId: string,
  lock = false,
) {
  const lockSql = lock ? sql` FOR UPDATE` : sql``;
  return rows<ContactMethodRow>(await tx.execute(sql`
    SELECT id, methodType, value, label, stoppedAt
      FROM crm_customer_contact_methods
     WHERE enterpriseId = ${scope.enterpriseId} AND customerId = ${customerId} AND contactId = ${contactId}
       AND stoppedAt IS NULL
     ORDER BY id${lockSql}
  `));
}

async function insertMethod(
  tx: CrmSqlExecutor,
  scope: CustomerServerScope,
  customerId: number,
  contactId: string,
  method: CustomerContactMethod,
) {
  const value = canonicalMethod(method);
  await tx.execute(sql`
    INSERT INTO crm_customer_contact_methods
      (enterpriseId, customerId, contactId, methodType, value, valueNormalized, label, createdAt, updatedAt)
    VALUES (
      ${scope.enterpriseId}, ${customerId}, ${contactId}, ${value.type}, ${value.value},
      ${normalizedMethod(value)}, ${value.label ?? null}, ${CRM_NOW}, ${CRM_NOW}
    )
  `);
}

async function insertProfile(
  tx: CrmSqlExecutor,
  scope: CustomerServerScope,
  customerId: number,
  contact: ContactCore & { isPrimary?: boolean },
  authorUserId: number | null = scope.actorUserId,
) {
  const id = randomUUID();
  const value = canonicalContact(contact);
  await tx.execute(sql`
    INSERT INTO crm_customer_contact_profiles
      (id, enterpriseId, customerId, name, department, position, createdByUserId, updatedByUserId, version, createdAt, updatedAt)
    VALUES (
      ${id}, ${scope.enterpriseId}, ${customerId}, ${value.name}, ${nullableText(value.department)},
      ${nullableText(value.position)}, ${authorUserId}, ${scope.actorUserId}, 1, ${CRM_NOW}, ${CRM_NOW}
    )
  `);
  for (const method of value.methods) await insertMethod(tx, scope, customerId, id, method);
  return id;
}

function mapProfile(
  profile: ContactProfileRow,
  methods: ContactMethodRow[],
  primaryContactId: string,
  scope: CustomerServerScope,
  context: CrmCustomerContactTransaction,
): ContactRecord {
  const authorUserId = profile.createdByUserId == null ? null : Number(profile.createdByUserId);
  return {
    id: String(profile.id),
    name: profile.name,
    department: profile.department ?? "",
    position: profile.position ?? "",
    methods: methods.map(mapMethod),
    isPrimary: String(primaryContactId) === String(profile.id),
    legacy: false,
    authorUserId,
    authorName: authorUserId == null ? null : displayName(profile.authorName, authorUserId),
    createdAt: iso(profile.createdAt),
    updatedAt: iso(profile.updatedAt),
    version: Number(profile.version),
    stoppedAt: iso(profile.stoppedAt),
    canEdit: !profile.stoppedAt && (canManageCustomerContact(scope, context)
      || (authorUserId != null && authorUserId === scope.actorUserId)),
  };
}

function mapLegacy(
  legacy: LegacyContactRow,
  customerId: number,
  primaryContactId: string,
  scope: CustomerServerScope,
  context: CrmCustomerContactTransaction,
): ContactRecord {
  const methods: CustomerContactMethod[] = [];
  if (legacy.phone) methods.push({ type: "other", value: legacy.phone, label: "历史电话" });
  if (legacy.email) methods.push({ type: "email", value: legacy.email, label: "历史邮箱" });
  return {
    id: legacyContactId(customerId),
    name: legacy.contactName ?? "历史联系人",
    department: "",
    position: "",
    methods,
    isPrimary: primaryContactId === legacyContactId(customerId),
    legacy: true,
    authorUserId: null,
    authorName: null,
    createdAt: iso(legacy.createdAt),
    updatedAt: iso(legacy.updatedAt),
    // The compatibility row has no independent version. Bind its snapshot to the
    // locked customer version so an old customer.update cannot be materialized.
    version: Number(context.customer.version),
    stoppedAt: null,
    canEdit: canManageCustomerContact(scope, context),
  };
}

function legacyHasUsableMethod(legacy: LegacyContactRow | null) {
  return Boolean(legacy?.phone?.trim() || legacy?.email?.trim());
}

/** Converts legacy compatibility data only after an explicit mutation has passed authorization. */
async function materializeLegacy(
  tx: CrmSqlExecutor,
  scope: CustomerServerScope,
  customerId: number,
  pointer: ContactPointerRow,
) {
  if (!Number(pointer.legacyContactPresent)) fail("NOT_FOUND", "历史联系人不存在");
  const legacy = await getLegacyContact(tx, customerId, true);
  if (!legacy) fail("NOT_FOUND", "历史联系人不存在");
  const id = await insertProfile(tx, scope, customerId, {
    name: legacy.contactName ?? "历史联系人",
    department: "",
    position: "",
    methods: [
      ...(legacy.phone ? [{ type: "other" as const, value: legacy.phone, label: "历史电话" }] : []),
      ...(legacy.email ? [{ type: "email" as const, value: legacy.email, label: "历史邮箱" }] : []),
    ],
  }, null);
  await tx.execute(sql`
    UPDATE crm_customer_contact_primary
       SET primaryContactId = ${String(pointer.primaryContactId) === legacyContactId(customerId) ? id : pointer.primaryContactId},
           legacyContactPresent = 0,
           updatedByUserId = ${scope.actorUserId}, updatedAt = ${CRM_NOW}
     WHERE enterpriseId = ${scope.enterpriseId} AND customerId = ${customerId}
  `);
  const profile = await getProfile(tx, scope, customerId, id, true);
  if (!profile) fail("INTERNAL_SERVER_ERROR", "历史联系人转换失败");
  return profile;
}

async function editableProfile(
  context: CrmCustomerContactTransaction,
  scope: CustomerServerScope,
  contactId: string,
) {
  assertCanManageContact(scope, context);
  const customerId = Number(context.customer.id);
  const pointer = await ensurePointer(context.tx, scope, customerId);
  if (contactId === legacyContactId(customerId)) return materializeLegacy(context.tx, scope, customerId, pointer);
  const profile = await getProfile(context.tx, scope, customerId, contactId, true);
  if (!profile) fail("NOT_FOUND", "联系人不存在");
  assertCanWriteProfile(scope, context, profile);
  return profile;
}

async function assertNoDuplicateContact(
  tx: CrmSqlExecutor,
  scope: CustomerServerScope,
  customerId: number,
  contact: ContactCore,
  excludeContactId: string | null,
  confirmed: boolean,
) {
  if (confirmed) return;
  const value = canonicalContact(contact);
  const normalizedValues = value.methods.map(normalizedMethod);
  const excluded = excludeContactId ? sql`AND p.id <> ${excludeContactId}` : sql``;
  const matchingProfiles = rows<{ id: string }>(await tx.execute(sql`
    SELECT p.id
      FROM crm_customer_contact_profiles p
     WHERE p.enterpriseId = ${scope.enterpriseId} AND p.customerId = ${customerId} AND p.stoppedAt IS NULL
       ${excluded}
       AND (
         p.name = ${value.name}
         OR EXISTS(
           SELECT 1 FROM crm_customer_contact_methods m
            WHERE m.enterpriseId = p.enterpriseId AND m.customerId = p.customerId AND m.contactId = p.id
              AND m.stoppedAt IS NULL
              AND m.valueNormalized IN (${sql.join(normalizedValues.map(item => sql`${item}`), sql`, `)})
         )
       )
     LIMIT 1 FOR UPDATE
  `));
  const pointer = await ensurePointer(tx, scope, customerId);
  const legacy = Number(pointer.legacyContactPresent) ? await getLegacyContact(tx, customerId, true) : null;
  const legacyValues = legacy
    ? [legacy.phone && normalizeCustomerPhone(legacy.phone), legacy.email && normalizeCustomerEmail(legacy.email)].filter(Boolean)
    : [];
  const legacyMatches = Boolean(legacy && (
    normalizeCustomerName(legacy.contactName ?? "") === normalizeCustomerName(value.name)
    || legacyValues.some(item => normalizedValues.includes(String(item)))
  ));
  if (matchingProfiles.length || legacyMatches) {
    fail("CONFLICT", "检测到相似联系人或联系方式，请确认后继续");
  }
}

async function reserveContactRequest<T extends object>(
  tx: CrmSqlExecutor,
  scope: CustomerServerScope,
  action: string,
  requestId: string,
  payloadHash: string,
): Promise<T | null> {
  await tx.execute(sql`
    INSERT IGNORE INTO crm_customer_contact_requests
      (enterpriseId, actorUserId, requestId, action, payloadHash, createdAt)
    VALUES (${scope.enterpriseId}, ${scope.actorUserId}, ${requestId}, ${action}, ${payloadHash}, ${CRM_NOW})
  `);
  const row = rows<ContactRequestRow>(await tx.execute(sql`
    SELECT action, payloadHash, responseJson
      FROM crm_customer_contact_requests
     WHERE enterpriseId = ${scope.enterpriseId} AND actorUserId = ${scope.actorUserId} AND requestId = ${requestId}
     LIMIT 1 FOR UPDATE
  `))[0];
  if (!row || row.action !== action || row.payloadHash !== payloadHash) {
    fail("CONFLICT", "请求号已用于不同内容");
  }
  if (row.responseJson == null) return null;
  let response: unknown = row.responseJson;
  if (typeof response === "string") {
    try {
      response = JSON.parse(response);
    } catch {
      fail("CONFLICT", "幂等记录已损坏");
    }
  }
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    fail("CONFLICT", "幂等记录已损坏");
  }
  return response as T;
}

async function completeContactRequest(
  tx: CrmSqlExecutor,
  scope: CustomerServerScope,
  requestId: string,
  response: { customerId: number; contactId?: string },
) {
  const changed = resultHeader(await tx.execute(sql`
    UPDATE crm_customer_contact_requests
       SET customerId = ${response.customerId}, contactId = ${response.contactId ?? null},
           responseJson = ${JSON.stringify(response)}, completedAt = ${CRM_NOW}
     WHERE enterpriseId = ${scope.enterpriseId} AND actorUserId = ${scope.actorUserId} AND requestId = ${requestId}
  `));
  if (Number(changed.affectedRows ?? 0) !== 1) fail("CONFLICT", "幂等响应绑定失败");
}

async function auditContact(
  tx: CrmSqlExecutor,
  scope: CustomerServerScope,
  input: {
    customerId: number;
    contactId?: string;
    action: string;
    note: string;
    requestId?: string;
    beforeData?: unknown;
    afterData?: unknown;
  },
) {
  await tx.execute(sql`
    INSERT INTO crm_customer_contact_audits
      (enterpriseId, customerId, contactId, actorUserId, action, note, beforeData, afterData, requestId, createdAt)
    VALUES (
      ${scope.enterpriseId}, ${input.customerId}, ${input.contactId ?? null}, ${scope.actorUserId},
      ${input.action}, ${input.note.slice(0, 500)},
      ${input.beforeData === undefined ? null : JSON.stringify(input.beforeData)},
      ${input.afterData === undefined ? null : JSON.stringify(input.afterData)},
      ${input.requestId ?? null}, ${CRM_NOW}
    )
  `);
  await insertCrmCustomerContactAudit(tx, {
    enterpriseId: scope.enterpriseId,
    customerId: input.customerId,
    actorUserId: scope.actorUserId,
    action: `contact_${input.action}`,
    note: input.note,
    requestId: input.requestId,
  });
}

async function updateCompatibilityProjection(
  tx: CrmSqlExecutor,
  scope: CustomerServerScope,
  customerId: number,
  contactId: string,
) {
  if (contactId === legacyContactId(customerId)) return;
  const profile = await getProfile(tx, scope, customerId, contactId, true);
  if (!profile) fail("NOT_FOUND", "联系人不存在");
  const methods = await getMethods(tx, scope, customerId, contactId, true);
  const phone = methods.find(method => method.methodType === "mobile" || method.methodType === "landline")?.value ?? "";
  const email = methods.find(method => method.methodType === "email")?.value ?? "";
  await tx.execute(sql`
    UPDATE crm_customer_contacts
       SET contactName = ${nullableText(profile.name)}, phone = ${nullableText(phone)}, phoneNormalized = ${normalizeCustomerPhone(phone)},
           email = ${nullableText(email)}, emailNormalized = ${normalizeCustomerEmail(email)}, updatedAt = ${CRM_NOW}
     WHERE customerId = ${customerId} AND isPrimary = 1
  `);
}

async function setPrimary(
  tx: CrmSqlExecutor,
  scope: CustomerServerScope,
  customerId: number,
  contactId: string,
) {
  const pointer = await ensurePointer(tx, scope, customerId);
  if (Number(pointer.legacyContactPresent) && contactId !== legacyContactId(customerId)) {
    await materializeLegacy(tx, scope, customerId, pointer);
  }
  await tx.execute(sql`
    UPDATE crm_customer_contact_primary
       SET primaryContactId = ${contactId}, updatedByUserId = ${scope.actorUserId}, updatedAt = ${CRM_NOW}
     WHERE enterpriseId = ${scope.enterpriseId} AND customerId = ${customerId}
  `);
  await updateCompatibilityProjection(tx, scope, customerId, contactId);
}

async function activeContactCount(tx: CrmSqlExecutor, scope: CustomerServerScope, customerId: number, pointer: ContactPointerRow) {
  const profileCount = rows<{ count: number | string }>(await tx.execute(sql`
    SELECT COUNT(*) AS count
      FROM crm_customer_contact_profiles
     WHERE enterpriseId = ${scope.enterpriseId} AND customerId = ${customerId} AND stoppedAt IS NULL
  `))[0];
  return Number(profileCount?.count ?? 0) + (Number(pointer.legacyContactPresent) ? 1 : 0);
}

export function customerContactsCreatePayloadHash(input: CreateMultiInput) {
  const contacts = input.contacts.map(canonicalContact);
  return hashPayload({
    kind: "createMulti",
    data: { ...input.data, assignedUserId: input.data.assignedUserId ?? null },
    contacts,
    initialFollowUp: input.initialFollowUp.trim(),
    confirmDuplicate: input.confirmDuplicate,
  });
}

export async function createMulti(scope: CustomerServerScope, rawInput: unknown) {
  const input = createMultiSchema.parse(rawInput);
  assertExpectedIdentity(scope, input);
  const contacts = input.contacts.map(canonicalContact);
  if (!input.confirmDuplicate) {
    const names = new Set<string>();
    const methods = new Set<string>();
    for (const contact of contacts) {
      const name = normalizeCustomerName(contact.name);
      if (names.has(name)) fail("CONFLICT", "本次录入包含同名联系人，请确认后继续");
      names.add(name);
      for (const method of contact.methods) {
        const key = `${method.type}:${normalizedMethod(method)}`;
        if (methods.has(key)) fail("CONFLICT", "本次录入包含重复联系方式，请确认后继续");
        methods.add(key);
      }
    }
  }
  const primary = contacts.find(contact => contact.isPrimary);
  if (!primary) fail("BAD_REQUEST", "必须且只能选择一位主联系人");
  const phone = primary.methods.find(method => method.type === "mobile" || method.type === "landline")?.value ?? "";
  const email = primary.methods.find(method => method.type === "email")?.value ?? "";
  const data: CustomerData = { ...input.data, contactName: primary.name, phone, email };
  const payloadHash = customerContactsCreatePayloadHash(input);
  const extension = prepareCrmCustomerCreateExtension({
    payloadHash,
    afterCustomerCreated: async ({ tx, customerId, requestId }) => {
      const ids: string[] = [];
      for (const contact of contacts) ids.push(await insertProfile(tx, scope, customerId, contact));
      const primaryId = ids[contacts.findIndex(contact => contact.isPrimary)];
      if (!primaryId) fail("INTERNAL_SERVER_ERROR", "主联系人创建失败");
      await tx.execute(sql`
        INSERT INTO crm_customer_contact_primary
          (enterpriseId, customerId, primaryContactId, legacyContactPresent, updatedByUserId, updatedAt)
        VALUES (${scope.enterpriseId}, ${customerId}, ${primaryId}, 0, ${scope.actorUserId}, ${CRM_NOW})
      `);
      await auditContact(tx, scope, {
        customerId,
        contactId: primaryId,
        action: "created_multi",
        note: "创建多联系人客户",
        requestId,
        afterData: { contactCount: ids.length, primaryContactId: primaryId },
      });
    },
  });
  return createCustomer(scope, {
    data,
    requestId: input.requestId,
    initialFollowUp: input.initialFollowUp,
    confirmDuplicate: input.confirmDuplicate,
  }, extension);
}

export async function contactsList(scope: CustomerServerScope, rawInput: unknown): Promise<ContactsListResult> {
  const input = contactsListSchema.parse(rawInput);
  assertExpectedIdentity(scope, input);
  return withCrmCustomerContactTransaction(scope, input.customerId, async context => {
    const customerId = Number(context.customer.id);
    const [legacy, pointer, profiles] = await Promise.all([
      getLegacyContact(context.tx, customerId),
      getPointer(context.tx, scope, customerId),
      listProfiles(context.tx, scope, customerId),
    ]);
    const primaryContactId = pointer?.primaryContactId ?? (legacy ? legacyContactId(customerId) : "");
    const legacyPresent = pointer ? Number(pointer.legacyContactPresent) : Boolean(legacy);
    const contacts: ContactRecord[] = [];
    if (legacy && legacyPresent) contacts.push(mapLegacy(legacy, customerId, primaryContactId, scope, context));
    for (const profile of profiles) {
      contacts.push(mapProfile(profile, await getMethods(context.tx, scope, customerId, String(profile.id)), primaryContactId, scope, context));
    }
    const assigned = rows<{ name: string | null }>(await context.tx.execute(sql`
      SELECT COALESCE(name, username, CONCAT('用户', id)) AS name FROM users WHERE id = ${context.customer.assignedUserId} LIMIT 1
    `))[0];
    return {
      customer: {
        id: customerId,
        name: context.customer.name,
        assignedUserId: Number(context.customer.assignedUserId),
        assignedName: displayName(assigned?.name, Number(context.customer.assignedUserId)),
        version: Number(context.customer.version),
        archivedAt: iso(context.customer.archivedAt),
      },
      contacts,
      canAdd: canManageCustomerContact(scope, context) && !context.customer.archivedAt,
    };
  });
}

export async function contactsSummary(scope: CustomerServerScope, rawInput: unknown): Promise<{ items: ContactSummary[] }> {
  const input = contactsSummarySchema.parse(rawInput);
  assertExpectedIdentity(scope, input);
  return withCrmCustomerContactRead(scope, async ({ tx, canManageAll }) => {
    const ids = input.customerIds;
    const ownership = canManageAll
      ? sql`c.enterpriseId = ${scope.enterpriseId}`
      : sql`c.enterpriseId = ${scope.enterpriseId} AND c.assignedUserId = ${scope.actorUserId}`;
    const customers = rows<CustomerSummaryRow>(await tx.execute(sql`
      SELECT c.id, cc.id AS legacyRowId, cc.contactName, cc.phone, cc.email, cp.primaryContactId, cp.legacyContactPresent
        FROM crm_customers c
        LEFT JOIN crm_customer_contacts cc ON cc.customerId = c.id AND cc.isPrimary = 1
        LEFT JOIN crm_customer_contact_primary cp ON cp.enterpriseId = c.enterpriseId AND cp.customerId = c.id
       WHERE ${ownership} AND c.id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
    `));
    if (!customers.length) return { items: [] };
    const allowedIds = customers.map(customer => Number(customer.id));
    const counts = rows<{ customerId: number; count: number | string }>(await tx.execute(sql`
      SELECT customerId, COUNT(*) AS count
        FROM crm_customer_contact_profiles
       WHERE enterpriseId = ${scope.enterpriseId} AND stoppedAt IS NULL
         AND customerId IN (${sql.join(allowedIds.map(id => sql`${id}`), sql`, `)})
       GROUP BY customerId
    `));
    const countByCustomer = new Map(counts.map(row => [Number(row.customerId), Number(row.count)]));
    const primaryIds = customers
      .map(customer => customer.primaryContactId)
      .filter((id): id is string => typeof id === "string" && !id.startsWith("legacy:"));
    const primaryProfiles = primaryIds.length ? rows<ContactProfileRow>(await tx.execute(sql`
      SELECT p.*, NULL AS authorName
        FROM crm_customer_contact_profiles p
       WHERE p.enterpriseId = ${scope.enterpriseId} AND p.stoppedAt IS NULL
         AND p.id IN (${sql.join(primaryIds.map(id => sql`${id}`), sql`, `)})
    `)) : [];
    const profileById = new Map(primaryProfiles.map(profile => [String(profile.id), profile]));
    const primaryMethods = primaryIds.length ? rows<ContactMethodRow & { contactId: string }>(await tx.execute(sql`
      SELECT m.contactId, m.id, m.methodType, m.value, m.label, m.stoppedAt
        FROM crm_customer_contact_methods m
       WHERE m.enterpriseId = ${scope.enterpriseId} AND m.stoppedAt IS NULL
         AND m.contactId IN (${sql.join(primaryIds.map(id => sql`${id}`), sql`, `)})
       ORDER BY m.id
    `)) : [];
    const methodsByContact = new Map<string, ContactMethodRow[]>();
    for (const method of primaryMethods) {
      const list = methodsByContact.get(method.contactId) ?? [];
      list.push(method);
      methodsByContact.set(method.contactId, list);
    }
    return {
      items: customers.map(customer => {
        const customerId = Number(customer.id);
        const legacyPresent = customer.legacyContactPresent == null
          ? customer.legacyRowId != null
          : Number(customer.legacyContactPresent) === 1;
        const primaryId = customer.primaryContactId ?? (legacyPresent ? legacyContactId(customerId) : "");
        if (legacyPresent && primaryId === legacyContactId(customerId)) {
          const methods: CustomerContactMethod[] = [];
          if (customer.phone) methods.push({ type: "other", value: customer.phone, label: "历史电话" });
          if (customer.email) methods.push({ type: "email", value: customer.email, label: "历史邮箱" });
          return {
            customerId,
            contactCount: (countByCustomer.get(customerId) ?? 0) + 1,
            primaryContact: { id: primaryId, name: customer.contactName ?? "历史联系人", methods, legacy: true },
          };
        }
        const profile = profileById.get(primaryId);
        return {
          customerId,
          contactCount: (countByCustomer.get(customerId) ?? 0) + (legacyPresent ? 1 : 0),
          primaryContact: profile ? {
            id: String(profile.id),
            name: profile.name,
            methods: (methodsByContact.get(String(profile.id)) ?? []).map(mapMethod),
            legacy: false,
          } : null,
        };
      }),
    };
  });
}

export async function contactsAdd(scope: CustomerServerScope, rawInput: unknown): Promise<ContactChangeResult> {
  const input = contactsAddSchema.parse(rawInput);
  assertExpectedIdentity(scope, input);
  const payloadHash = hashPayload({
    kind: "contactsAdd",
    customerId: input.customerId,
    contact: canonicalContact(input.contact),
    confirmDuplicate: input.confirmDuplicate,
  });
  return withCrmCustomerContactTransaction(scope, input.customerId, async context => {
    assertCanManageContact(scope, context);
    if (context.customer.archivedAt) fail("CONFLICT", "已归档客户不可补录联系人");
    const replay = await reserveContactRequest<ContactChangeResult>(context.tx, scope, "contacts_add", input.requestId, payloadHash);
    if (replay) return { ...replay, replayed: true };
    await ensurePointer(context.tx, scope, input.customerId);
    await assertNoDuplicateContact(context.tx, scope, input.customerId, input.contact, null, input.confirmDuplicate);
    const contactId = await insertProfile(context.tx, scope, input.customerId, input.contact);
    const response: ContactChangeResult = { id: contactId, contactId, customerId: input.customerId, replayed: false };
    await auditContact(context.tx, scope, { customerId: input.customerId, contactId, action: "added", note: "新增联系人", requestId: input.requestId });
    await completeContactRequest(context.tx, scope, input.requestId, response);
    return response;
  });
}

export async function contactsEdit(scope: CustomerServerScope, rawInput: unknown): Promise<ContactChangeResult> {
  const input = contactsEditSchema.parse(rawInput);
  assertExpectedIdentity(scope, input);
  const payloadHash = hashPayload({
    kind: "contactsEdit",
    customerId: input.customerId,
    contactId: input.contactId,
    version: input.version,
    contact: canonicalContact(input.contact),
    confirmDuplicate: input.confirmDuplicate,
  });
  return withCrmCustomerContactTransaction(scope, input.customerId, async context => {
    const editingLegacy = input.contactId === legacyContactId(input.customerId);
    if (context.customer.archivedAt) fail("CONFLICT", "已归档客户不可编辑联系人");
    assertCanManageContact(scope, context);
    if (!editingLegacy) {
      const existing = await getProfile(context.tx, scope, input.customerId, input.contactId, true);
      if (!existing) fail("NOT_FOUND", "联系人不存在");
      assertCanWriteProfile(scope, context, existing);
    }
    const replay = await reserveContactRequest<ContactChangeResult>(context.tx, scope, "contacts_edit", input.requestId, payloadHash);
    if (replay) return { ...replay, replayed: true };
    if (editingLegacy && input.version !== Number(context.customer.version)) {
      fail("CONFLICT", "联系人已被其他人更新，请刷新后重试");
    }
    const profile = await editableProfile(context, scope, input.contactId);
    if (profile.stoppedAt) fail("CONFLICT", "已停用联系人不可再次修改或停用");
    // A legacy snapshot is validated above against the customer version. Once it
    // is materialized, CAS must use the newly created profile's real version.
    const profileVersion = Number(profile.version);
    if (!editingLegacy && profileVersion !== input.version) fail("CONFLICT", "联系人已被其他人更新，请刷新后重试");
    await assertNoDuplicateContact(context.tx, scope, input.customerId, input.contact, String(profile.id), input.confirmDuplicate);
    const beforeData = {
      name: profile.name,
      department: profile.department ?? "",
      position: profile.position ?? "",
      methods: (await getMethods(context.tx, scope, input.customerId, String(profile.id), true)).map(mapMethod),
    };
    const changed = resultHeader(await context.tx.execute(sql`
      UPDATE crm_customer_contact_profiles
         SET name = ${input.contact.name.trim()}, department = ${nullableText(input.contact.department)},
             position = ${nullableText(input.contact.position)}, updatedByUserId = ${scope.actorUserId},
             version = version + 1, updatedAt = ${CRM_NOW}
       WHERE enterpriseId = ${scope.enterpriseId} AND customerId = ${input.customerId} AND id = ${profile.id}
         AND version = ${profileVersion} AND stoppedAt IS NULL
    `));
    if (Number(changed.affectedRows ?? 0) !== 1) fail("CONFLICT", "联系人已被其他人更新，请刷新后重试");
    await context.tx.execute(sql`
      UPDATE crm_customer_contact_methods
         SET stoppedAt = ${CRM_NOW}, stoppedByUserId = ${scope.actorUserId}, updatedAt = ${CRM_NOW}
       WHERE enterpriseId = ${scope.enterpriseId} AND customerId = ${input.customerId} AND contactId = ${profile.id}
         AND stoppedAt IS NULL
    `);
    for (const method of input.contact.methods) await insertMethod(context.tx, scope, input.customerId, String(profile.id), method);
    const pointer = await ensurePointer(context.tx, scope, input.customerId);
    if (String(pointer.primaryContactId) === String(profile.id)) {
      await updateCompatibilityProjection(context.tx, scope, input.customerId, String(profile.id));
    }
    const after = await getProfile(context.tx, scope, input.customerId, String(profile.id), true);
    if (!after) fail("INTERNAL_SERVER_ERROR", "联系人更新失败");
    const response: ContactChangeResult = {
      id: String(profile.id), contactId: String(profile.id), customerId: input.customerId, version: Number(after.version), replayed: false,
    };
    await auditContact(context.tx, scope, {
      customerId: input.customerId,
      contactId: String(profile.id),
      action: "edited",
      note: "编辑联系人",
      requestId: input.requestId,
      beforeData,
      afterData: canonicalContact(input.contact),
    });
    await completeContactRequest(context.tx, scope, input.requestId, response);
    return response;
  });
}

export async function contactsStop(scope: CustomerServerScope, rawInput: unknown): Promise<ContactChangeResult> {
  const input = contactsStopSchema.parse(rawInput);
  assertExpectedIdentity(scope, input);
  const payloadHash = hashPayload({
    kind: "contactsStop",
    customerId: input.customerId,
    contactId: input.contactId,
    version: input.version,
    replacementContactId: input.replacementContactId ?? null,
  });
  return withCrmCustomerContactTransaction(scope, input.customerId, async context => {
    const stoppingLegacy = input.contactId === legacyContactId(input.customerId);
    if (context.customer.archivedAt) fail("CONFLICT", "已归档客户不可停用联系人");
    assertCanManageContact(scope, context);
    if (!stoppingLegacy) {
      const existing = await getProfile(context.tx, scope, input.customerId, input.contactId, true);
      if (!existing) fail("NOT_FOUND", "联系人不存在");
      assertCanWriteProfile(scope, context, existing);
    }
    const replay = await reserveContactRequest<ContactChangeResult>(context.tx, scope, "contacts_stop", input.requestId, payloadHash);
    if (replay) return { ...replay, replayed: true };
    if (stoppingLegacy && input.version !== Number(context.customer.version)) {
      fail("CONFLICT", "联系人已被其他人更新，请刷新后重试");
    }
    const profile = await editableProfile(context, scope, input.contactId);
    if (profile.stoppedAt) fail("CONFLICT", "已停用联系人不可再次修改或停用");
    // Materialized legacy profiles begin at their own version; do not compare
    // that version to the legacy customer's version snapshot.
    const profileVersion = Number(profile.version);
    if (!stoppingLegacy && profileVersion !== input.version) fail("CONFLICT", "联系人已被其他人更新，请刷新后重试");
    const pointer = await ensurePointer(context.tx, scope, input.customerId);
    if (await activeContactCount(context.tx, scope, input.customerId, pointer) <= 1) {
      fail("BAD_REQUEST", "不能停用最后一位有效联系人");
    }
    if (String(pointer.primaryContactId) === String(profile.id)) {
      const replacementId = input.replacementContactId;
      if (!replacementId || replacementId === input.contactId || replacementId === String(profile.id)) {
        fail("BAD_REQUEST", "停用主联系人时必须选择另一位有效联系人");
      }
      if (replacementId === legacyContactId(input.customerId)) {
        const legacy = await getLegacyContact(context.tx, input.customerId, true);
        if (!Number(pointer.legacyContactPresent) || !legacyHasUsableMethod(legacy)) {
          fail("BAD_REQUEST", "替代联系人必须有有效联系方式");
        }
      } else {
        const replacement = await getProfile(context.tx, scope, input.customerId, replacementId, true);
        if (!replacement || replacement.stoppedAt || !(await getMethods(context.tx, scope, input.customerId, replacementId, true)).length) {
          fail("BAD_REQUEST", "替代联系人必须有有效联系方式");
        }
      }
      await setPrimary(context.tx, scope, input.customerId, replacementId);
    }
    const changed = resultHeader(await context.tx.execute(sql`
      UPDATE crm_customer_contact_profiles
         SET stoppedAt = ${CRM_NOW}, stoppedByUserId = ${scope.actorUserId}, updatedByUserId = ${scope.actorUserId},
             version = version + 1, updatedAt = ${CRM_NOW}
       WHERE enterpriseId = ${scope.enterpriseId} AND customerId = ${input.customerId} AND id = ${profile.id}
         AND version = ${profileVersion} AND stoppedAt IS NULL
    `));
    if (Number(changed.affectedRows ?? 0) !== 1) fail("CONFLICT", "联系人已被其他人更新，请刷新后重试");
    const response: ContactChangeResult = { id: String(profile.id), contactId: String(profile.id), customerId: input.customerId, replayed: false };
    await auditContact(context.tx, scope, { customerId: input.customerId, contactId: String(profile.id), action: "stopped", note: "停用联系人", requestId: input.requestId });
    await completeContactRequest(context.tx, scope, input.requestId, response);
    return response;
  });
}

export async function contactsSetPrimary(scope: CustomerServerScope, rawInput: unknown): Promise<ContactChangeResult> {
  const input = contactsSetPrimarySchema.parse(rawInput);
  assertExpectedIdentity(scope, input);
  const payloadHash = hashPayload({ kind: "contactsSetPrimary", customerId: input.customerId, contactId: input.contactId, version: input.version });
  return withCrmCustomerContactTransaction(scope, input.customerId, async context => {
    if (context.customer.archivedAt) fail("CONFLICT", "已归档客户不可设置主联系人");
    assertCanManageContact(scope, context);
    if (input.contactId !== legacyContactId(input.customerId)) {
      const profile = await getProfile(context.tx, scope, input.customerId, input.contactId, true);
      if (!profile) fail("NOT_FOUND", "联系人不存在");
      assertCanWriteProfile(scope, context, profile);
    }
    const replay = await reserveContactRequest<ContactChangeResult>(context.tx, scope, "contacts_set_primary", input.requestId, payloadHash);
    if (replay) return { ...replay, replayed: true };
    const pointer = await ensurePointer(context.tx, scope, input.customerId);
    if (input.contactId === legacyContactId(input.customerId)) {
      const legacy = await getLegacyContact(context.tx, input.customerId, true);
      if (
        !Number(pointer.legacyContactPresent)
        || input.version !== Number(context.customer.version)
        || !legacyHasUsableMethod(legacy)
      ) {
        fail("CONFLICT", "联系人版本已变化，请刷新后重试");
      }
    } else {
      const profile = await getProfile(context.tx, scope, input.customerId, input.contactId, true);
      if (!profile || profile.stoppedAt || Number(profile.version) !== input.version || !(await getMethods(context.tx, scope, input.customerId, input.contactId, true)).length) {
        fail("CONFLICT", "联系人已变化，请刷新后重试");
      }
    }
    await setPrimary(context.tx, scope, input.customerId, input.contactId);
    const response: ContactChangeResult = { id: input.contactId, contactId: input.contactId, customerId: input.customerId, replayed: false };
    await auditContact(context.tx, scope, { customerId: input.customerId, contactId: input.contactId, action: "primary_set", note: "设置主联系人", requestId: input.requestId });
    await completeContactRequest(context.tx, scope, input.requestId, response);
    return response;
  });
}

export async function updateBasic(scope: CustomerServerScope, rawInput: unknown): Promise<UpdateBasicResult> {
  const input = updateBasicSchema.parse(rawInput);
  assertExpectedIdentity(scope, input);
  const payloadHash = hashPayload({ kind: "updateBasic", customerId: input.customerId, version: input.version, data: input.data, confirmDuplicate: input.confirmDuplicate });
  return withCrmCustomerContactTransaction(scope, input.customerId, async context => {
    if (context.customer.archivedAt) fail("CONFLICT", "已归档客户不可编辑，请先恢复");
    const replay = await reserveContactRequest<UpdateBasicResult>(context.tx, scope, "update_basic", input.requestId, payloadHash);
    if (replay) return { ...replay, replayed: true };
    if (Number(context.customer.version) !== input.version) fail("CONFLICT", "客户已被其他人更新，请刷新后重试");
    const duplicates = await crmCustomerDuplicateState(context.tx, scope, {
      name: input.data.name,
      phone: "",
      email: "",
      excludeId: input.customerId,
    }, context.canManageAll);
    if (!input.confirmDuplicate && duplicates.rows.length) throwCrmCustomerDuplicate(duplicates.restricted);
    const changed = resultHeader(await context.tx.execute(sql`
      UPDATE crm_customers
         SET name = ${input.data.name.trim()}, nameNormalized = ${normalizeCustomerName(input.data.name)},
             province = ${nullableText(input.data.province)}, city = ${nullableText(input.data.city)},
             district = ${nullableText(input.data.district)}, address = ${nullableText(input.data.address)},
             scale = ${input.data.scale}, grade = ${input.data.grade}, stage = ${input.data.stage},
             source = ${nullableText(input.data.source)},
             nextFollowUpAt = ${input.data.nextFollowUpAt ? toBeijingSqlDate(input.data.nextFollowUpAt) : null},
             version = version + 1, updatedByUserId = ${scope.actorUserId}, updatedAt = ${CRM_NOW}
       WHERE enterpriseId = ${scope.enterpriseId} AND id = ${input.customerId} AND version = ${input.version}
    `));
    if (Number(changed.affectedRows ?? 0) !== 1) fail("CONFLICT", "客户已被其他人更新，请刷新后重试");
    const response: UpdateBasicResult = {
      id: input.customerId,
      customerId: input.customerId,
      version: input.version + 1,
      replayed: false,
    };
    await auditContact(context.tx, scope, { customerId: input.customerId, action: "basic_updated", note: "更新客户基本资料", requestId: input.requestId });
    await completeContactRequest(context.tx, scope, input.requestId, response);
    return response;
  });
}

/** Exact allowed API surface; collaboration and shared-list operations are intentionally absent. */
export const customerContactsService = Object.freeze({
  createMulti,
  contactsList,
  contactsSummary,
  contactsAdd,
  contactsEdit,
  contactsStop,
  contactsSetPrimary,
  updateBasic,
});
