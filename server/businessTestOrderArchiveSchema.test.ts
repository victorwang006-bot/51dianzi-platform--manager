import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/mysql-core";
import {
  businessTestOrderArchiveAudits,
  businessTestOrderArchives,
} from "../drizzle/businessTestOrderArchiveSchema";

describe("independent admin-only archive metadata schema", () => {
  it("has fail-safe defaults and retains restore + private backup metadata without any orders FK", () => {
    const config = getTableConfig(businessTestOrderArchives);
    expect(config.name).toBe("business_test_order_archives");
    expect(config.foreignKeys).toEqual([]);
    expect(businessTestOrderArchives.isTest.default).toBe(0);
    expect(businessTestOrderArchives.state.default).toBe("restored");
    expect(businessTestOrderArchives.originalStatus.enumValues).toEqual(["cancel"]);
    expect(businessTestOrderArchives.restoredAt.notNull).toBe(false);
    expect(businessTestOrderArchives.restoredBatchId.notNull).toBe(false);
    expect(businessTestOrderArchives.snapshotSha256.notNull).toBe(true);
    expect(businessTestOrderArchives.backupReference.notNull).toBe(true);
    expect(config.indexes.map(index => ({ name: index.config.name, unique: index.config.unique, columns: index.config.columns.map(column => "name" in column ? column.name : "") }))).toEqual([
      { name: "btoa_order_scope_unique", unique: true, columns: ["merchantId", "sellerUserId", "orderId"] },
      { name: "btoa_number_scope_unique", unique: true, columns: ["merchantId", "sellerUserId", "orderNo"] },
      { name: "btoa_active_scope_idx", unique: false, columns: ["merchantId", "sellerUserId", "state", "isTest"] },
      { name: "btoa_batch_idx", unique: false, columns: ["batchId"] },
    ]);
  });

  it("does not invent a logged-in admin for user-task confirmation", () => {
    expect(businessTestOrderArchives.confirmedByAdminId.notNull).toBe(false);
    expect(businessTestOrderArchives.confirmationTaskId.notNull).toBe(false);
    expect(businessTestOrderArchiveAudits.actorAdminId.notNull).toBe(false);
    expect(businessTestOrderArchiveAudits.confirmationTaskId.notNull).toBe(false);
    expect(businessTestOrderArchiveAudits.actorKind.enumValues).toEqual(["user_task_confirmation", "admin_session", "maintenance_cli"]);
    expect(businessTestOrderArchiveAudits.actorKind.notNull).toBe(true);
  });

  it("defines per-action append audit identity with no cascade or auto-updated fields", () => {
    const config = getTableConfig(businessTestOrderArchiveAudits);
    expect(config.name).toBe("business_test_order_archive_audits");
    expect(config.foreignKeys).toEqual([]);
    expect(businessTestOrderArchiveAudits.action.enumValues).toEqual(["archive", "restore"]);
    expect(config.columns.every(column => column.onUpdateFn === undefined)).toBe(true);
    expect(config.indexes.map(index => ({ name: index.config.name, unique: index.config.unique, columns: index.config.columns.map(column => "name" in column ? column.name : "") }))).toEqual([
      { name: "btoaa_batch_action_unique", unique: true, columns: ["batchId", "archiveId", "action"] },
      { name: "btoaa_archive_idx", unique: false, columns: ["archiveId", "id"] },
    ]);
  });
});
