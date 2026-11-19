import { sql } from "drizzle-orm";
import { createOfficialTechnicalPreparedStore, type OfficialTechnicalPreparationTicket } from "./officialTechnicalPreparedStore";
import { OFFICIAL_TECHNICAL_DICTIONARY_COLUMNS, readOfficialTechnicalDictionaryRows, type OfficialTechnicalDictionaryRow } from "./officialTechnicalDictionary";
import { officialTechnicalIdentitySchema, type OfficialTechnicalIdentity, type OfficialTechnicalDictionaryReader } from "./officialTechnicalResource";

type Executor = { execute(query: ReturnType<typeof sql>): Promise<unknown> };
function rows<T>(result: unknown): T[] {
  if (!Array.isArray(result) || !Array.isArray(result[0])) throw new Error("自营技术参数准备不可用");
  return result[0] as T[];
}
export function createOfficialTechnicalPreparationHook(path?: string) {
  const store = createOfficialTechnicalPreparedStore(path);
  function reader(db: Executor, locking = false): OfficialTechnicalDictionaryReader {
    return async identities => {
      if (!identities.length) return [];
      const parts = Array.from(new Set(identities.map(item => item.partNumber.trim().toUpperCase())));
      const found = rows<OfficialTechnicalDictionaryRow>(await db.execute(sql`SELECT ${sql.raw(OFFICIAL_TECHNICAL_DICTIONARY_COLUMNS)} FROM materials
        WHERE status = 'enabled' AND UPPER(partNumber) IN (${sql.join(parts.map(part => sql`${part}`), sql`, `)})
        ${locking ? sql`FOR SHARE` : sql``}`));
      return readOfficialTechnicalDictionaryRows(identities, found);
    };
  }
  async function currentIdentities(db: Executor, partNumbers: readonly string[]): Promise<OfficialTechnicalIdentity[]> {
    if (!partNumbers.length) return [];
    const parts = Array.from(new Set(partNumbers.map(part => part.trim().toUpperCase())));
    return rows<OfficialTechnicalIdentity>(await db.execute(sql`SELECT c.publicId, c.revision, c.partNumber, c.brand, c.pkg
      FROM official_mall_materials c INNER JOIN official_mall_publications p ON p.materialId = c.id
      WHERE c.status = 'published' AND UPPER(c.partNumber) IN (${sql.join(parts.map(part => sql`${part}`), sql`, `)})
        AND BINARY p.publicId = BINARY c.publicId AND p.revision = c.revision
        AND JSON_UNQUOTE(JSON_EXTRACT(p.snapshot, '$.sourceType')) = 'official_mall'
        AND BINARY JSON_UNQUOTE(JSON_EXTRACT(p.snapshot, '$.publicId')) = BINARY c.publicId
        AND JSON_EXTRACT(p.snapshot, '$.revision') = c.revision
        AND BINARY JSON_UNQUOTE(JSON_EXTRACT(p.snapshot, '$.partNumber')) = BINARY c.partNumber
        AND BINARY JSON_UNQUOTE(JSON_EXTRACT(p.snapshot, '$.brand')) = BINARY c.brand
        AND BINARY JSON_UNQUOTE(JSON_EXTRACT(p.snapshot, '$.pkg')) = BINARY c.pkg`)).map(item => officialTechnicalIdentitySchema.parse(item));
  }
  /** Mandatory invalidation under the native source-row lock BEFORE mutation. IO failure aborts the DB write. */
  async function beforeSourceMutation(partNumbers: readonly string[]) {
    return store.beginSourceMutation(partNumbers);
  }
  /** A rejected native transaction releases only its own pending tickets, keeping the source unavailable. */
  async function abortSourceMutation(tickets: OfficialTechnicalPreparationTicket) {
    await store.abortSourceMutation(tickets);
  }
  /** Run only after DB commit using the same native db/pool. A failed rebuild stays durably unavailable. */
  async function afterSourceCommit(db: Executor, partNumbers: readonly string[], tickets: OfficialTechnicalPreparationTicket) {
    try {
      const items = await currentIdentities(db, partNumbers);
      return await store.complete(items, tickets, reader(db, true));
    } catch {
      // Complete normally settles its ticket even on failure; this also covers identity-query failure.
      // Cleanup failure is fail-closed: no repair attempt can bypass an unsettled writer.
      await store.abortSourceMutation(tickets);
      // At most ONE fresh invalidation + CURRENT read, never publish with an older completion ticket.
      // If another source writer remains pending, prepare rejects and the source stays unavailable.
      const freshItems = await currentIdentities(db, partNumbers);
      return store.prepare(freshItems, reader(db, true));
    }
  }
  /** Native publication transaction calls this BEFORE its publication INSERT, with next revision.
   * Include existing same-model publications so preparing one package/brand cannot evict another.
   * Locking dictionary read is a CURRENT read, not an old RR snapshot; serializes source updates. */
  async function preparePublication(tx: Executor, rawIdentity: OfficialTechnicalIdentity) {
    const identity = officialTechnicalIdentitySchema.parse(rawIdentity);
    const current = await currentIdentities(tx, [identity.partNumber]);
    const items = [...current.filter(item => item.publicId !== identity.publicId), identity];
    await store.prepare(items, reader(tx, true));
  }
  return { store, beforeSourceMutation, abortSourceMutation, afterSourceCommit, preparePublication, currentIdentities };
}
/** Instantiation is inert: no pool, no DB query, no file/directory write until an explicit hook call. */
export const officialTechnicalPreparation = createOfficialTechnicalPreparationHook();

/** Source mutation has already committed. Do not falsely roll it back or invite duplicate
 * create retries: the mandatory PRE-write invalidation remains durable and list is unavailable.
 * One safe fresh repair has already been attempted. Log only a fixed diagnostic, never DB errors. */
export async function finishOfficialTechnicalSourceCommit(db: Executor, partNumbers: readonly string[], tickets: OfficialTechnicalPreparationTicket): Promise<boolean> {
  try { await officialTechnicalPreparation.afterSourceCommit(db, partNumbers, tickets); return true; }
  catch { console.warn("[officialTechnical] material saved; technical preparation unavailable; explicit repair required"); return false; }
}
