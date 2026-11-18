import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { and, eq, getTableName, inArray, or } from "drizzle-orm";
import { int, json, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { adminUsers, adminUserPermissions as adminPerms, materials } from "../../drizzle/schema";
import { officialChannelTeams as teams, officialChannelTeamMembers } from "../../drizzle/officialChannelSchema";
import { officialMallMaterials, officialMallPublications, officialMallRequests } from "../../drizzle/officialMallSchema";
import {
  assertOfficialRecordAction, loadOfficialAccess, officialTeamPredicate,
  type OfficialActor, type OfficialPermission,
} from "../../server/services/officialChannelAccess";
import { createOfficialMallService, publicProjection, validateOfficialMallMaterial } from "../../server/services/officialMall";
import { ACTOR_ID, TEAM_ID, canonical, hash, type ImportPlan } from "./input";
import type { Checkpoint } from "./engine";

export const officialMallSourceData = mysqlTable("official_mall_source_data", {
  materialId: int("materialId").primaryKey(),
  unit: varchar("unit", { length: 8 }).notNull(),
  sourcePayload: json("sourcePayload").$type<unknown>().notNull(),
  importKey: varchar("importKey", { length: 64 }).notNull(),
}, table => ({ importKeyUnique: uniqueIndex("om_source_import_key_uq").on(table.importKey) }));
export function sourceImportKey(plan: ImportPlan, index: number) {
  // Row identity is intentional: equal source SKUs/model tuples must NOT be skipped.
  return hash({ dataset: plan.datasetHash, rowNumber: index + 1, sourceProductCode: plan.sourceMetadata[index].sourceProductCode });
}

/** Snapshots retain the service's ISO milliseconds; native SQL timestamp columns retain seconds. */
export function verifiedSnapshotPublishedAt(snapshotISO: unknown, publicationDate: unknown, materialDate: unknown): string {
  if (typeof snapshotISO !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(snapshotISO)) throw Error("SNAPSHOT_PUBLICATION_ISO_INVALID");
  const snapshotDate = new Date(snapshotISO);
  if (!Number.isFinite(snapshotDate.getTime()) || snapshotDate.toISOString() !== snapshotISO) throw Error("SNAPSHOT_PUBLICATION_ISO_INVALID");
  if (!(publicationDate instanceof Date) || !(materialDate instanceof Date) ||
      !Number.isFinite(publicationDate.getTime()) || !Number.isFinite(materialDate.getTime()) ||
      Math.floor(snapshotDate.getTime() / 1000) !== Math.floor(publicationDate.getTime() / 1000) ||
      Math.floor(snapshotDate.getTime() / 1000) !== Math.floor(materialDate.getTime() / 1000)) throw Error("PUBLICATION_TIMESTAMP_SECOND_MISMATCH");
  return snapshotISO;
}

/** No connection on import. Only the explicit runner --execute/--preflight-only calls this. */
export function createNativeAdapter(databaseUrl: string, plan: ImportPlan) {
  if (!databaseUrl) throw Error("DATABASE_URL_NOT_INJECTED");
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 2, dateStrings: true, multipleStatements: false, decimalNumbers: false });
  const db = drizzle(pool);
  const service = createOfficialMallService({
    getDb: async () => db, loadOfficialAccess, assertOfficialRecordAction, officialTeamPredicate,
  });
  const contracts = [
    [adminUsers, ["id", "adminRole", "status", "sessionVersion"]],
    [adminPerms, ["id", "adminUserId", "permission"]],
    [materials, ["id", "partNumber", "brand", "package", "status"]],
    [teams, ["id", "name", "status"]],
    [officialChannelTeamMembers, ["id", "adminUserId", "teamId", "role"]],
    [officialMallMaterials, ["id", "publicId", "teamId", "ownerAdminUserId", "createdByAdminUserId", "updatedByAdminUserId", "publishedByAdminUserId", "partNumber", "brand", "pkg", "dateCode", "qtyOnSale", "qtyStock", "qtyOrder", "leadTime", "priceEx", "taxIncluded", "moq", "spq", "ladderPrices", "note", "status", "revision", "createdAt", "updatedAt", "publishedAt"]],
    [officialMallPublications, ["materialId", "publicId", "revision", "partNumber", "brand", "snapshot", "publishedAt"]],
    [officialMallRequests, ["id", "actorAdminUserId", "requestId", "action", "payloadHash", "state", "result", "before", "after", "createdAt", "completedAt"]],
    [officialMallSourceData, ["materialId", "unit", "sourcePayload", "importKey"]],
  ] as const;

  async function inspectTables() {
    const [databaseRows] = await pool.query<any[]>("SELECT DATABASE() AS db");
    if (databaseRows[0]?.db !== "dianzi51_admin") throw Error("EXPECTED_CANONICAL_ADMIN_DATABASE");
    const names = contracts.map(([table]) => getTableName(table));
    const marks = names.map(() => "?").join(",");
    const [tableRows] = await pool.query<any[]>(`SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${marks})`, names);
    const [columns] = await pool.query<any[]>(`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, DATA_TYPE AS type, CHARACTER_MAXIMUM_LENGTH AS length FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${marks})`, names);
    for (const [table, required] of contracts) {
      const name = getTableName(table);
      if (tableRows.find(row => row.name === name)?.engine?.toLowerCase() !== "innodb") throw Error(`REQUIRED_INNODB_TABLE_${name}`);
      for (const column of required) if (!columns.some(row => row.tableName === name && row.name === column)) throw Error(`REQUIRED_COLUMN_${name}_${column}`);
    }
    for (const [column, type, length] of [["materialId", "int", null], ["unit", "varchar", 8], ["sourcePayload", "json", null], ["importKey", "varchar", 64]] as const) {
      const found = columns.find(row => row.tableName === "official_mall_source_data" && row.name === column);
      if (found?.type !== type || (length !== null && Number(found.length) !== length)) throw Error(`SOURCE_METADATA_CONTRACT_${column}`);
    }
    const [indexes] = await pool.query<any[]>("SELECT TABLE_NAME AS tableName, INDEX_NAME AS name, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS seq, COLUMN_NAME AS columnName FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('official_mall_requests','official_mall_source_data','official_mall_materials','official_mall_publications')");
    function requireUnique(table: string, expected: string[]) {
      const groups = new Map<string, any[]>();
      for (const row of indexes.filter(row => row.tableName === table && Number(row.nonUnique) === 0)) groups.set(row.name, [...(groups.get(row.name) ?? []), row]);
      if (![...groups.values()].some(rows => canonical(rows.sort((a, b) => a.seq - b.seq).map(row => row.columnName)) === canonical(expected))) throw Error(`REQUIRED_UNIQUE_KEY_${table}_${expected.join("_")}`);
    }
    requireUnique("official_mall_requests", ["actorAdminUserId", "requestId"]);
    requireUnique("official_mall_source_data", ["materialId"]);
    requireUnique("official_mall_source_data", ["importKey"]);
    requireUnique("official_mall_materials", ["publicId"]);
    requireUnique("official_mall_publications", ["materialId"]);
    return { database: "dianzi51_admin", tables: names, ledgerUniqueVerified: true, sourceMetadataUniqueVerified: true };
  }
  async function authority(tx: any, actor: OfficialActor, permission: OfficialPermission) {
    const access = await loadOfficialAccess(tx, actor, permission);
    if (!access.isSuperAdmin || access.adminUserId !== ACTOR_ID) throw Error("EXISTING_ACTIVE_SUPER_ADMIN_REQUIRED");
    officialTeamPredicate(access, officialMallMaterials);
    const [team] = await tx.select({ id: teams.id, status: teams.status }).from(teams).where(eq(teams.id, TEAM_ID)).limit(1).for("update");
    if (!team || team.status !== "active") throw Error("EXISTING_ACTIVE_TEAM_1_REQUIRED");
    assertOfficialRecordAction(access, { teamId: TEAM_ID, ownerAdminUserId: ACTOR_ID }, permission === "officialInventory.publish" ? "publish" : permission === "officialInventory.write" ? "manage" : "read");
    return access;
  }
  async function preflight(saved?: Checkpoint, expectedSessionVersion?: number) {
    const tables = await inspectTables();
    const [account] = await db.select({ id: adminUsers.id, status: adminUsers.status, role: adminUsers.adminRole, sessionVersion: adminUsers.sessionVersion }).from(adminUsers).where(eq(adminUsers.id, ACTOR_ID)).limit(1);
    if (!account || account.status !== "active" || account.role !== "super_admin" || !Number.isSafeInteger(account.sessionVersion) || account.sessionVersion < 1) throw Error("EXISTING_ACTIVE_SUPER_ADMIN_30004_REQUIRED");
    const actor = saved?.actor ?? { adminUserId: ACTOR_ID, sessionVersion: account.sessionVersion };
    if (actor.sessionVersion !== account.sessionVersion || (expectedSessionVersion !== undefined && expectedSessionVersion !== actor.sessionVersion)) throw Error("CURRENT_SESSION_VERSION_MISMATCH");
    const baseline = await db.transaction(async tx => {
      for (const permission of ["officialInventory.read", "officialInventory.write", "officialInventory.publish"] as const) await authority(tx, actor, permission);
      // A fresh run is specifically authorized to preserve the existing one material.
      const rows = saved?.baseline ?? await tx.select().from(officialMallMaterials);
      if (!saved && rows.length !== 1) throw Error("FRESH_RUN_EXPECTS_ONE_EXISTING_MATERIAL");
      if (saved) {
        const actual = await tx.select().from(officialMallMaterials).where(inArray(officialMallMaterials.id, rows.map(row => row.id)));
        if (canonical(actual) !== canonical(rows)) throw Error("BASELINE_MATERIAL_CHANGED");
      }
      return rows;
    }, { isolationLevel: "repeatable read" });
    return { actor, baseline, tables };
  }
  function assertRow(row: any, index: number, status?: "draft" | "published") {
    if (!row || row.teamId !== TEAM_ID || row.ownerAdminUserId !== ACTOR_ID || row.createdByAdminUserId !== ACTOR_ID || row.updatedByAdminUserId !== ACTOR_ID) throw Error("IMPORTED_ROW_AUTHORITY_MISMATCH");
    const expected = plan.rows[index].data;
    const input = validateOfficialMallMaterial(Object.fromEntries(Object.keys(expected).map(key => [key, row[key]])));
    if (canonical(input) !== canonical(expected)) throw Error(`IMPORTED_ROW_DATA_MISMATCH_${index + 1}`);
    if (status && (row.status !== status || row.revision !== (status === "draft" ? 1 : 2))) throw Error(`IMPORTED_ROW_${status.toUpperCase()}_REVISION_MISMATCH`);
    if (!status && !((row.status === "draft" && row.revision === 1) || (row.status === "published" && row.revision === 2))) throw Error("IMPORTED_ROW_UNEXPECTED_STATE");
  }
  function operations(checkpoint: Checkpoint) {
    const actor = checkpoint.actor;
    async function verifyDrafts(ids: number[], firstIndex: number) {
      return db.transaction(async tx => {
        await authority(tx, actor, "officialInventory.publish");
        const rows = await tx.select().from(officialMallMaterials).where(inArray(officialMallMaterials.id, ids)).for("update");
        const byId = new Map(rows.map(row => [row.id, row]));
        return ids.map((id, offset) => {
          const row = byId.get(id);
          assertRow(row, firstIndex + offset, "draft");
          return { id, expectedRevision: row!.revision };
        });
      }, { isolationLevel: "repeatable read" });
    }
    async function ensurePrivateMetadata(ids: number[], firstIndex: number) {
      return db.transaction(async tx => {
        const access = await authority(tx, actor, "officialInventory.write");
        const mallRows = await tx.select().from(officialMallMaterials).where(inArray(officialMallMaterials.id, ids)).for("update");
        const byId = new Map(mallRows.map(row => [row.id, row]));
        const desired = ids.map((id, offset) => {
          const index = firstIndex + offset;
          const row = byId.get(id);
          assertRow(row, index);
          assertOfficialRecordAction(access, row!, "manage");
          return { materialId: id, unit: plan.sourceMetadata[index].unit, sourcePayload: plan.privatePayloads[index], importKey: sourceImportKey(plan, index) };
        });
        const existing = await tx.select().from(officialMallSourceData).where(or(
          inArray(officialMallSourceData.materialId, ids), inArray(officialMallSourceData.importKey, desired.map(row => row.importKey)),
        )).for("update");
        const toInsert = desired.filter(row => {
          const match = existing.find(value => value.materialId === row.materialId || value.importKey === row.importKey);
          if (!match) return true;
          if (canonical(match) !== canonical(row)) throw Error("SOURCE_METADATA_ID_OR_PAYLOAD_CONFLICT");
          return false;
        });
        if (toInsert.length) await tx.insert(officialMallSourceData).values(toInsert);
        return { materialIds: ids, inserted: toInsert.length, unchanged: desired.length - toInsert.length, importKeys: desired.map(row => row.importKey) };
      }, { isolationLevel: "repeatable read" });
    }
    async function verifyFinal(ids: number[]) {
      return db.transaction(async tx => {
        await authority(tx, actor, "officialInventory.read");
        let tiers = 0, zeroStock = 0;
        for (let start = 0; start < ids.length; start += 100) {
          const selected = ids.slice(start, start + 100);
          const rows = await tx.select().from(officialMallMaterials).where(inArray(officialMallMaterials.id, selected));
          const published = await tx.select().from(officialMallPublications).where(inArray(officialMallPublications.materialId, selected));
          const meta = await tx.select().from(officialMallSourceData).where(inArray(officialMallSourceData.materialId, selected));
          for (let offset = 0; offset < selected.length; offset++) {
            const id = selected[offset], index = start + offset;
            const row = rows.find(row => row.id === id);
            assertRow(row, index, "published");
            const publication = published.find(value => value.materialId === id);
            if (!publication || !row || publication.publicId !== row.publicId || publication.revision !== row.revision || row.publishedByAdminUserId !== ACTOR_ID) throw Error("PUBLICATION_CURRENT_REVISION_MISMATCH");
            const publishedISO = verifiedSnapshotPublishedAt(publication.snapshot?.publishedAt, publication.publishedAt, row.publishedAt);
            const expected = publicProjection({ ...plan.rows[index].data, publicId: row.publicId, revision: 2 }, publishedISO);
            if (canonical(publication.snapshot) !== canonical(expected)) throw Error("PUBLIC_WHITELIST_OR_QUOTE_STOCK_MISMATCH");
            const source = meta.find(value => value.materialId === id);
            if (!source || source.unit !== plan.sourceMetadata[index].unit || source.importKey !== sourceImportKey(plan, index) || canonical(source.sourcePayload) !== canonical(plan.privatePayloads[index])) throw Error("PRIVATE_SOURCE_METADATA_MISMATCH");
            tiers += row.ladderPrices.length;
            if (row.qtyStock === 0) zeroStock++;
          }
        }
        const baseline = await tx.select().from(officialMallMaterials).where(inArray(officialMallMaterials.id, checkpoint.baseline.map(row => row.id)));
        if (canonical(baseline) !== canonical(checkpoint.baseline)) throw Error("BASELINE_MATERIAL_CHANGED");
        if (tiers !== plan.tierCount || zeroStock !== plan.zeroStockCount) throw Error("FINAL_TIER_OR_ZERO_STOCK_COUNT_MISMATCH");
        return { imported: ids.length, published: ids.length, sourceMetadata: ids.length, tiers, zeroStock, baselineIdsPreserved: baseline.map(row => row.id), whitelistVerified: true, sourcePayloadVerified: true };
      }, { isolationLevel: "repeatable read" });
    }
    return { service, verifyDrafts, ensurePrivateMetadata, verifyFinal };
  }
  return { service, preflight, operations, close: () => pool.end() };
}
