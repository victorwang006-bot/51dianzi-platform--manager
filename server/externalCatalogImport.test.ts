import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error JavaScript CLI module intentionally exports testable pure helpers.
import { parseArgs as parseImportArgs, validateRecord } from "../scripts/import-external-catalog.mjs";
// @ts-expect-error JavaScript CLI module intentionally exports the transaction helper.
import { activate } from "../scripts/activate-external-catalog.mjs";

const root = resolve(import.meta.dirname, "..");

describe("external catalog import contracts", () => {
  it("accepts zero-price rows as raw data while leaving structured price unavailable", () => {
    expect(() =>
      validateRecord(
        {
          rowNo: 2,
          sourceSequenceRaw: "1",
          partNumberRaw: "ABC-1",
          partNumberKey: "ABC-1",
          partNumberCompactKey: "ABC-1",
          priceRaw: "0",
          priceValue: null,
          quantityThresholdRaw: "1000",
          quantityThresholdValue: "1000",
        },
        2,
      ),
    ).not.toThrow();
  });

  it("rejects row-number drift and malformed numeric values", () => {
    expect(() =>
      validateRecord(
        {
          rowNo: 3,
          partNumberRaw: "ABC-1",
          partNumberKey: "ABC-1",
          partNumberCompactKey: "ABC-1",
          priceRaw: "1.25",
          priceValue: "1.25",
          quantityThresholdRaw: "100",
          quantityThresholdValue: "100",
        },
        2,
      ),
    ).toThrow(/row sequence mismatch/);
  });

  it("requires explicit trusted artifact and manifest paths", () => {
    expect(parseImportArgs(["--artifact", "/tmp/catalog.ndjson.gz", "--manifest", "/tmp/catalog.json"]))
      .toMatchObject({ batchSize: 1000 });
    expect(() => parseImportArgs(["--artifact", "/tmp/catalog.ndjson.gz"])).toThrow(/usage/);
  });

  it("locks the migration contract to isolated external tables and a unique batch row", () => {
    const migrationName = readdirSync(join(root, "drizzle")).find(name => /^0019_.*\.sql$/.test(name));
    expect(migrationName).toBeTruthy();
    const migration = readFileSync(join(root, "drizzle", migrationName!), "utf8");
    expect(migration).toContain("CREATE TABLE `external_catalog_batches`");
    expect(migration).toContain("CREATE TABLE `external_catalog_entries`");
    expect(migration).toContain("CREATE TABLE `external_catalog_state`");
    expect(migration).toContain("CONSTRAINT `external_catalog_entries_batch_row_idx` UNIQUE(`batchId`,`rowNo`)");
    expect(migration).not.toMatch(/ALTER TABLE `materials`/);
  });

  it("never uses the curated materials table in the schema installer", () => {
    const installer = readFileSync(join(root, "scripts", "apply-external-catalog-schema.mjs"), "utf8");
    expect(installer).toContain("CREATE TABLE IF NOT EXISTS external_catalog_entries");
    expect(installer).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE)\s+materials\b/i);
  });
});

describe("external catalog activation transaction", () => {
  it("atomically archives the old batch and activates a verified ready batch", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[{ activeBatchId: 1 }]])
      .mockResolvedValueOnce([[{
        id: 2,
        status: "ready",
        expectedRows: 3,
        importedRows: 3,
        validPriceRows: 2,
        uniquePartKeys: 3,
      }]])
      .mockResolvedValueOnce([[{
        importedRows: 3,
        validPriceRows: 2,
        uniquePartKeys: 3,
        minRowNo: 2,
        maxRowNo: 4,
      }]])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{}]);
    const connection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      query,
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
    };

    const result = await activate(connection, 2);

    expect(result).toMatchObject({ previousBatchId: 1, activeBatchId: 2, importedRows: 3 });
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(query.mock.calls[3]?.[0]).toMatch(/status = 'archived'/);
    expect(query.mock.calls[5]?.[0]).toMatch(/external_catalog_state/);
  });

  it("rolls back when row integrity does not match the batch manifest", async () => {
    const connection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      query: vi
        .fn()
        .mockResolvedValueOnce([[{ activeBatchId: null }]])
        .mockResolvedValueOnce([[{
          id: 2,
          status: "ready",
          expectedRows: 3,
          importedRows: 3,
          validPriceRows: 2,
          uniquePartKeys: 3,
        }]])
        .mockResolvedValueOnce([[{
          importedRows: 2,
          validPriceRows: 2,
          uniquePartKeys: 2,
          minRowNo: 2,
          maxRowNo: 3,
        }]]),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
    };

    await expect(activate(connection, 2)).rejects.toThrow(/integrity checks/);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
});
