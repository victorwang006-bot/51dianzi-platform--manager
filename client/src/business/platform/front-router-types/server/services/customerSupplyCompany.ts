import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { ChannelInventoryError, type ChannelInventoryScope, type SqlExecutor, type SqlResultRow } from "./channelInventory";
import { crmCustomerPolicyWhere, resolveCrmCustomerPolicy, type CrmSqlExecutor } from "./crmCustomers";
import { businessIndustryCodeSchema } from "../../../shared/businessIndustry";
const rows = (r: unknown): SqlResultRow[] => Array.isArray(r) ? (Array.isArray(r[0]) ? r[0] : r) as SqlResultRow[] : [];
export const currentReadExecutor = (tx: SqlExecutor): SqlExecutor & CrmSqlExecutor & { rollback: () => never } => ({ execute: query => tx.execute(query.getSQL()), rollback: () => { throw new Error("authority-only transaction marker"); } });
export function hasCustomerScopeRead(scope: ChannelInventoryScope) {
  return !scope.officialActor || scope.officialActor.inventoryPermissions?.customerScopeRead === true;
}
/** Fresh signed local CRM scope AND the real native CRM policy. Never legacy fallback. */
export async function resolveCustomerSupplyReadPolicy(tx: SqlExecutor, scope: ChannelInventoryScope) {
  if (!hasCustomerScopeRead(scope)) throw new TRPCError({ code: "FORBIDDEN", message: "未获当前客户读取权限" });
  return resolveCrmCustomerPolicy(currentReadExecutor(tx), scope);
}
export function customerSupplyCompletion(customer: SqlResultRow): string | null {
  if (customer.archivedAt) return "客户已归档，不能上传供应库存";
  if (!String(customer.name ?? "").trim()) return "请先在客户档案补全公司名称";
  if (!businessIndustryCodeSchema.safeParse(customer.industryCode).success) return "请先完善客户所属行业";
  return null;
}
export async function customerReadPolicy(tx: SqlExecutor, scope: ChannelInventoryScope) {
  try { return await resolveCustomerSupplyReadPolicy(tx, scope); }
  catch (error) { if (error instanceof TRPCError && error.code === "FORBIDDEN") return null; throw error; }
}
/** Caller must already have locked and authorized the CRM customer. Reads never materialize legacy contacts. */
export async function readCustomerPrimaryContact(tx: SqlExecutor, scope: ChannelInventoryScope, customerId: number) {
  const pointer = rows(await tx.execute(sql`SELECT primaryContactId, legacyContactPresent FROM crm_customer_contact_primary
    WHERE enterpriseId = ${scope.enterpriseId} AND customerId = ${customerId} LIMIT 1 FOR UPDATE`))[0];
  if (!pointer || String(pointer.primaryContactId) === `legacy:${customerId}`) {
    if (pointer && Number(pointer.legacyContactPresent) !== 1) return { contactName: null, phone: null };
    const legacy = rows(await tx.execute(sql`SELECT contactName, phone FROM crm_customer_contacts
      WHERE customerId = ${customerId} AND isPrimary = 1 LIMIT 1 FOR UPDATE`))[0];
    return { contactName: legacy?.contactName == null ? null : String(legacy.contactName), phone: legacy?.phone == null ? null : String(legacy.phone) };
  }
  const profile = rows(await tx.execute(sql`SELECT id, name FROM crm_customer_contact_profiles
    WHERE enterpriseId = ${scope.enterpriseId} AND customerId = ${customerId} AND id = ${String(pointer.primaryContactId)} AND stoppedAt IS NULL LIMIT 1 FOR UPDATE`))[0];
  if (!profile) return { contactName: null, phone: null };
  const methods = rows(await tx.execute(sql`SELECT methodType, value FROM crm_customer_contact_methods
    WHERE enterpriseId = ${scope.enterpriseId} AND customerId = ${customerId} AND contactId = ${String(profile.id)}
      AND stoppedAt IS NULL ORDER BY id FOR UPDATE`));
  const phone = methods.find(method => method.methodType === "mobile" || method.methodType === "landline")?.value;
  return { contactName: String(profile.name), phone: phone == null ? null : String(phone) };
}
/** Aliases are server constants only. Schema must be installed before these reads are deployed. */
export async function linkedCompanyReadGate(tx: SqlExecutor, scope: ChannelInventoryScope, alias = "c") {
  const policy = await customerReadPolicy(tx, scope);
  const c = sql.raw(alias);
  return sql`(NOT EXISTS (SELECT 1 FROM crm_customer_supply_channels supply_link
    WHERE supply_link.enterpriseId = ${c}.enterprise_id AND supply_link.dataOwnerUserId = ${c}.data_owner_user_id AND supply_link.channelId = ${c}.id)
    OR EXISTS (SELECT 1 FROM crm_customer_supply_channels supply_link INNER JOIN crm_customers supply_customer
      ON supply_customer.enterpriseId = supply_link.enterpriseId AND supply_customer.id = supply_link.customerId
      WHERE supply_link.enterpriseId = ${c}.enterprise_id AND supply_link.dataOwnerUserId = ${c}.data_owner_user_id AND supply_link.channelId = ${c}.id
        AND ${policy ? crmCustomerPolicyWhere(scope, policy, "supply_customer") : sql`FALSE`} FOR UPDATE))`;
}
export async function linkedCompany(tx: SqlExecutor, scope: ChannelInventoryScope, channelId: number) {
  const link = rows(await tx.execute(sql`SELECT customerId FROM crm_customer_supply_channels
    WHERE enterpriseId = ${scope.enterpriseId} AND dataOwnerUserId = ${scope.dataOwnerUserId} AND channelId = ${channelId} LIMIT 1 FOR UPDATE`))[0];
  if (!link) return { linked: false as const, customer: null };
  const policy = await customerReadPolicy(tx, scope);
  const customer = policy ? rows(await tx.execute(sql`SELECT supply_customer.id, supply_customer.name, supply_customer.industryCode,
    supply_customer.version, supply_customer.archivedAt FROM crm_customers supply_customer
    WHERE supply_customer.id = ${Number(link.customerId)} AND ${crmCustomerPolicyWhere(scope, policy, "supply_customer")} LIMIT 1 FOR UPDATE`))[0] ?? null : null;
  return { linked: true as const, customer: customer ? { ...customer, ...await readCustomerPrimaryContact(tx, scope, Number(customer.id)) } as SqlResultRow : null };
}
/** Never fall back to a stale COPY when a linked CRM record is inaccessible. */
export async function projectChannelCompany<T extends { id: number; name: string; industryCode: string | null; contactName: string | null; phone: string | null; wechat: string | null; qq: string | null; notes: string | null }>(tx: SqlExecutor, scope: ChannelInventoryScope, item: T): Promise<T & { customerId?: number; companyReadOnly?: boolean }> {
  const company = await linkedCompany(tx, scope, item.id);
  if (!company.linked) return item;
  const c = company.customer;
  if (!hasCustomerScopeRead(scope)) throw new ChannelInventoryError("FORBIDDEN", "未获当前关联客户读取权限");
  return { ...item, name: c ? String(c.name) : "关联客户（暂无CRM访问权限）", industryCode: c?.industryCode == null ? null : String(c.industryCode),
    contactName: c?.contactName == null ? null : String(c.contactName), phone: c?.phone == null ? null : String(c.phone),
    wechat: null, qq: null, notes: null, companyReadOnly: true, ...(c ? { customerId: Number(c.id) } : {}) };
}
export async function projectMaterialCompany<T extends { channelId: number | null; channelName: string | null; channelType?: unknown; channelActive?: unknown }>(tx: SqlExecutor, scope: ChannelInventoryScope, item: T): Promise<T> {
  if (item.channelId == null) return item;
  const company = await linkedCompany(tx, scope, item.channelId);
  if (!company.linked) return item;
  if (!company.customer) return { ...item, channelId: null, channelName: null, ...(item.channelType !== undefined ? { channelType: null, channelActive: null } : {}) };
  return { ...item, channelName: String(company.customer.name) };
}
