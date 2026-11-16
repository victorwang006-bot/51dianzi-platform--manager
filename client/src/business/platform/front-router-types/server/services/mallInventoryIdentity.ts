import { readFileSync } from "node:fs";
import { sql, type SQL } from "drizzle-orm";
import { inventories } from "../../drizzle/schema";
import { SELF_OPERATOR_COMPANY_NAME } from "../../../shared/supplierDisplayName";
import { mallInventoryContentProofSql } from "./mallInventoryFingerprint";

type Database = { execute: (query: SQL) => Promise<unknown> };
export function mallOperatorConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.MALL_SELF_OPERATOR_BINDING_FILE) {
    try {
      const binding = JSON.parse(readFileSync(env.MALL_SELF_OPERATOR_BINDING_FILE, "utf8"));
      if (binding.schemaVersion !== 1 || binding.merchantId !== 30061) return null;
      return mallOperatorConfig({ MALL_SELF_OPERATOR_ENTERPRISE_ID: String(binding.enterpriseId ?? ""), MALL_SELF_OPERATOR_DATA_OWNER_USER_ID: String(binding.dataOwnerUserId ?? ""), MALL_SELF_OPERATOR_COMPANY_ID: String(binding.companyId ?? ""), MALL_SELF_OPERATOR_CREDIT_CODE: binding.creditCode });
    } catch { return null; }
  }
  const names = ["MALL_SELF_OPERATOR_ENTERPRISE_ID", "MALL_SELF_OPERATOR_DATA_OWNER_USER_ID", "MALL_SELF_OPERATOR_COMPANY_ID"] as const;
  const ids = names.map(name => env[name]?.trim() ?? "");
  const creditCode = env.MALL_SELF_OPERATOR_CREDIT_CODE?.trim() ?? "";
  if (ids.some(id => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) || !/^[0-9A-Z]{18}$/.test(creditCode)) return null;
  return { enterpriseId: Number(ids[0]), dataOwnerUserId: Number(ids[1]), companyId: Number(ids[2]), creditCode };
}
export function mallIdentitySql(): SQL {
  const c = mallOperatorConfig();
  if (!c) return sql`FALSE`;
  return sql`${inventories.enterpriseId} = ${c.enterpriseId} AND ${inventories.userId} = ${c.dataOwnerUserId}
    AND EXISTS (SELECT 1 FROM enterprises me INNER JOIN companies mc
      ON mc.enterpriseId = me.id AND mc.userId = me.crmDataOwnerUserId
      WHERE me.id = ${c.enterpriseId} AND me.crmDataOwnerUserId = ${c.dataOwnerUserId}
      AND mc.id = ${c.companyId} AND me.creditCode = ${c.creditCode} AND mc.creditCode = ${c.creditCode}
      AND me.registrationRegion = 'CN' AND mc.registrationRegion = 'CN'
      AND BINARY me.companyName = BINARY ${SELF_OPERATOR_COMPANY_NAME}
      AND BINARY mc.companyName = BINARY ${SELF_OPERATOR_COMPANY_NAME}
      AND mc.reviewStatus = 'approved' AND mc.certLevel IN ('certified','premium'))`;
}
export async function mallSchemaReady(db: Database): Promise<boolean> {
  const result = await db.execute(sql`SELECT COUNT(*) AS cnt FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name IN ('mall_inventory_publications','mall_inventory_requests')`);
  return Number((result as [Array<{cnt: unknown}>])[0]?.[0]?.cnt ?? 0) === 2;
}
export async function mallPublicationsAvailable(db: Database): Promise<boolean> {
  const result = await db.execute(sql`SELECT COUNT(*) AS cnt FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = 'mall_inventory_publications'`);
  return Number((result as [Array<{cnt: unknown}>])[0]?.[0]?.cnt ?? 0) > 0;
}
/** Called after the authorized native inventory write while its row lock is still held.
 * Never INSERTs/links old inventory. Stock reservation/restoration must not call this. */
export async function invalidateMallInventoryConfirmation(db: Database, ids: number[], onlyExistingProof = false) {
  if (!ids.length || !await mallPublicationsAvailable(db)) return;
  await db.execute(sql`UPDATE mall_inventory_publications SET status = 'draft',
    confirmedContentProof = NULL, publishedAt = NULL, version = version + 1
    WHERE inventoryId IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
    ${onlyExistingProof ? sql`AND (confirmedContentProof IS NOT NULL OR status = 'published')` : sql``}`);
}
/** No business-state cache: every query rechecks current publication and identity. */
export async function mallPublicPolicy(db: Database) {
  // Binding is identity, not association. Requests absence blocks management,
  // but must not bypass a readable publication table's real linked-row gate.
  if (!await mallPublicationsAvailable(db)) return { self: sql`FALSE`, gate: sql`TRUE`, linked: sql<boolean>`FALSE` };
  const self = sql`EXISTS (SELECT 1 FROM mall_inventory_publications mp WHERE mp.inventoryId = ${inventories.id}
    AND mp.enterpriseId = ${inventories.enterpriseId} AND mp.dataOwnerUserId = ${inventories.userId}
    AND mp.status = 'published' AND ${inventories.status} = 'published'
    AND mp.confirmedContentProof IS NOT NULL AND mp.confirmedContentProof = ${mallInventoryContentProofSql()}
    AND (${mallIdentitySql()}))`;
  const gate = sql`(NOT EXISTS (SELECT 1 FROM mall_inventory_publications mg WHERE mg.inventoryId = ${inventories.id}) OR (${self}))`;
  const linked = sql<boolean>`EXISTS (SELECT 1 FROM mall_inventory_publications ml WHERE ml.inventoryId = ${inventories.id})`;
  return { self, gate, linked };
}
export async function mallEligibility(db: Database, enterpriseId: number) {
  if (!await mallSchemaReady(db)) return { eligible: false, code: "SCHEMA_NOT_READY", message: "商城发布表尚未迁移" } as const;
  const c = mallOperatorConfig();
  if (!c) return { eligible: false, code: "OPERATOR_NOT_CONFIGURED", message: "缺少经核实的自营企业、公司、信用代码及稳定库存归属绑定" } as const;
  if (c.enterpriseId !== enterpriseId) return { eligible: false, code: "NOT_SELF_OPERATOR", message: "当前企业不是指定自营经营主体" } as const;
  const result = await db.execute(sql`SELECT me.id FROM enterprises me INNER JOIN companies mc ON mc.enterpriseId = me.id
    WHERE me.id = ${c.enterpriseId} AND me.crmDataOwnerUserId = ${c.dataOwnerUserId} AND mc.userId = ${c.dataOwnerUserId}
    AND mc.id = ${c.companyId} AND me.creditCode = ${c.creditCode} AND mc.creditCode = ${c.creditCode}
    AND me.registrationRegion = 'CN' AND mc.registrationRegion = 'CN'
    AND BINARY me.companyName = BINARY ${SELF_OPERATOR_COMPANY_NAME} AND BINARY mc.companyName = BINARY ${SELF_OPERATOR_COMPANY_NAME}
    AND mc.reviewStatus = 'approved' AND mc.certLevel IN ('certified','premium') LIMIT 1`);
  const eligible = Boolean((result as [unknown[]])[0]?.length);
  return { eligible, code: eligible ? "READY" : "OPERATOR_IDENTITY_MISMATCH", message: eligible ? "可选择真实自营库存" : "自营企业认证或库存数据归属证据失配" };
}
