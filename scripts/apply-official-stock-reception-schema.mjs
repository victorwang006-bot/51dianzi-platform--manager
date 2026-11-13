#!/usr/bin/env node
import { readFile } from "node:fs/promises";
const sqlPath = new URL(
  "../drizzle/migrations/official-stock-reception-v1.sql",
  import.meta.url
);
const sql = await readFile(sqlPath, "utf8");
if (!process.argv.includes("--apply-fixture")) {
  console.log(
    "-- REVIEW ONLY: no connection opened, no database writes performed."
  );
  console.log(sql);
} else {
  // Deliberately cannot be used as a production launcher; no env/.env fallback.
  const index = process.argv.indexOf("--database-url");
  const url = index >= 0 ? process.argv[index + 1] : undefined;
  if (!url) throw new Error("Explicit --database-url is required");
  const parsed = new URL(url);
  const schema = decodeURIComponent(parsed.pathname.slice(1));
  if (
    !new Set(["localhost", "127.0.0.1"]).has(parsed.hostname) ||
    !/^migration_[a-z0-9_]+_test$/.test(schema)
  )
    throw new Error(
      "Only explicit loopback migration_*_test fixtures are permitted"
    );
  const { default: mysql } = await import("mysql2/promise");
  const connection = await mysql.createConnection({
    uri: url,
    multipleStatements: true,
  });
  try {
    const [lock] = await connection.query(
      "SELECT GET_LOCK('official_stock_reception_schema_v1', 10) AS acquired"
    );
    if (lock[0]?.acquired !== 1) throw new Error("Schema lock unavailable");
    try {
      await connection.query(sql);
      // CREATE IF NOT EXISTS must not silently accept an incompatible existing table.
      const [columns] = await connection.query(
        "SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'official_channel_stock_reception'"
      );
      const expected = {
        stockId: "int",
        merchantId: "int",
        sellerEnterpriseId: "int",
        routingMode: "enum",
        recipientAdminUserId: "int",
        responsibilityVersion: "int",
        updatedByAdminUserId: "int",
        updatedAt: "timestamp",
      };
      for (const [name, type] of Object.entries(expected))
        if (
          !columns.some(
            column => column.COLUMN_NAME === name && column.DATA_TYPE === type
          )
        )
          throw new Error(`Incompatible reception schema column: ${name}`);
      console.log(
        "Fixture-only reception schema applied; no identity or inquiry backfill."
      );
    } finally {
      await connection.query(
        "SELECT RELEASE_LOCK('official_stock_reception_schema_v1')"
      );
    }
  } finally {
    await connection.end();
  }
}
