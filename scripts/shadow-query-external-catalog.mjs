#!/usr/bin/env node
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import mysql from "mysql2/promise";

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];
    if (!token?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`invalid argument near ${token ?? "<end>"}`);
    }
    values.set(token, value);
    index += 1;
  }
  const batchId = Number(values.get("--batch-id"));
  const configPath = values.get("--from-ecosystem-config");
  const iterations = Number(values.get("--iterations") ?? "100");
  if (!Number.isSafeInteger(batchId) || batchId <= 0 || !configPath) {
    throw new Error("usage: shadow-query-external-catalog.mjs --batch-id N --from-ecosystem-config FILE [--iterations N]");
  }
  if (!Number.isSafeInteger(iterations) || iterations < 20 || iterations > 1000) {
    throw new Error("iterations must be between 20 and 1000");
  }
  return { batchId, configPath: resolve(configPath), iterations };
}

function databaseUrlFromEcosystem(configPath) {
  const require = createRequire(import.meta.url);
  const moduleId = require.resolve(configPath);
  delete require.cache[moduleId];
  const config = require(moduleId);
  const apps = Array.isArray(config?.apps) ? config.apps : [];
  const app = apps.find(item => item?.name === "dianzi51-admin") ?? apps[0];
  const databaseUrl = app?.env?.DATABASE_URL;
  return typeof databaseUrl === "string" ? databaseUrl.trim() : "";
}

function percentile(values, fraction) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))];
}

function timingSummary(values) {
  return {
    iterations: values.length,
    p50Ms: Number(percentile(values, 0.5).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
    maxMs: Number(Math.max(...values).toFixed(3)),
  };
}

async function benchmark(connection, sql, params, iterations) {
  for (let index = 0; index < 10; index += 1) await connection.query(sql, params);
  const timings = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    await connection.query(sql, params);
    timings.push(performance.now() - started);
  }
  return timingSummary(timings);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL?.trim() || databaseUrlFromEcosystem(args.configPath);
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");

  const connection = await mysql.createConnection(databaseUrl);
  try {
    const [[state]] = await connection.query(
      "SELECT activeBatchId FROM external_catalog_state WHERE id = 1",
    );
    if (state?.activeBatchId !== null) {
      throw new Error(`shadow gate failed: activeBatchId must remain NULL, got ${state?.activeBatchId}`);
    }

    const [[batch]] = await connection.query(
      `SELECT id, status, expectedRows, importedRows, validPriceRows, uniquePartKeys
         FROM external_catalog_batches WHERE id = ?`,
      [args.batchId],
    );
    if (!batch || batch.status !== "ready") throw new Error("shadow batch is not ready");

    const [[stats]] = await connection.query(
      `SELECT COUNT(*) AS importedRows,
              SUM(priceValue > 0) AS validPriceRows,
              SUM(priceValue IS NULL) AS unavailablePriceRows,
              COUNT(DISTINCT partNumberKey) AS uniquePartKeys,
              MIN(rowNo) AS minRowNo,
              MAX(rowNo) AS maxRowNo
         FROM external_catalog_entries WHERE batchId = ?`,
      [args.batchId],
    );
    const normalizedStats = Object.fromEntries(
      Object.entries(stats).map(([key, value]) => [key, Number(value)]),
    );
    if (
      normalizedStats.importedRows !== Number(batch.importedRows) ||
      normalizedStats.validPriceRows !== Number(batch.validPriceRows) ||
      normalizedStats.uniquePartKeys !== Number(batch.uniquePartKeys) ||
      normalizedStats.unavailablePriceRows !== 1 ||
      normalizedStats.minRowNo !== 2 ||
      normalizedStats.maxRowNo !== Number(batch.expectedRows) + 1
    ) {
      throw new Error(`shadow statistics mismatch: ${JSON.stringify(normalizedStats)}`);
    }

    const exactSql = `SELECT rowNo, partNumberRaw, brandRaw, packageRaw, priceRaw, priceValue
                        FROM external_catalog_entries
                       WHERE batchId = ? AND partNumberKey = ?
                       ORDER BY rowNo ASC LIMIT 20`;
    const prefixSql = `SELECT rowNo, partNumberRaw, brandRaw, packageRaw
                         FROM external_catalog_entries
                        WHERE batchId = ? AND partNumberKey LIKE CONCAT(?, '%') ESCAPE '='
                        ORDER BY partNumberKey ASC, rowNo ASC LIMIT 20`;

    const [zeroPriceRows] = await connection.query(exactSql, [args.batchId, "AQY4C2PX"]);
    if (zeroPriceRows.length !== 1 || zeroPriceRows[0].priceRaw !== "0" || zeroPriceRows[0].priceValue !== null) {
      throw new Error("zero-price shadow contract failed");
    }
    const [ambiguousRows] = await connection.query(exactSql, [args.batchId, "K210"]);
    if (ambiguousRows.length !== 2) throw new Error("ambiguous part-number shadow contract failed");
    const [prefixRows] = await connection.query(prefixSql, [args.batchId, "STM32F103"]);
    if (prefixRows.length === 0) throw new Error("prefix shadow query returned no rows");

    const [exactPlan] = await connection.query(
      `EXPLAIN SELECT rowNo FROM external_catalog_entries
        WHERE batchId = ? AND partNumberKey = ? LIMIT 20`,
      [args.batchId, "AQY4C2PX"],
    );
    const [prefixPlan] = await connection.query(
      `EXPLAIN SELECT rowNo FROM external_catalog_entries
        WHERE batchId = ? AND partNumberKey LIKE CONCAT(?, '%') ESCAPE '=' LIMIT 20`,
      [args.batchId, "STM32F103"],
    );

    const exactTiming = await benchmark(connection, exactSql, [args.batchId, "AQY4C2PX"], args.iterations);
    const prefixTiming = await benchmark(connection, prefixSql, [args.batchId, "STM32F103"], args.iterations);
    if (exactTiming.p95Ms >= 50 || prefixTiming.p95Ms >= 50) {
      throw new Error(`shadow performance gate failed: ${JSON.stringify({ exactTiming, prefixTiming })}`);
    }

    console.log(JSON.stringify({
      ok: true,
      activeBatchId: null,
      batch: {
        id: Number(batch.id),
        status: batch.status,
        expectedRows: Number(batch.expectedRows),
        importedRows: Number(batch.importedRows),
        validPriceRows: Number(batch.validPriceRows),
        uniquePartKeys: Number(batch.uniquePartKeys),
      },
      stats: normalizedStats,
      zeroPriceSample: zeroPriceRows[0],
      ambiguousSampleCount: ambiguousRows.length,
      prefixSampleCount: prefixRows.length,
      exactPlan: exactPlan.map(row => ({ key: row.key, rows: Number(row.rows), extra: row.Extra })),
      prefixPlan: prefixPlan.map(row => ({ key: row.key, rows: Number(row.rows), extra: row.Extra })),
      exactTiming,
      prefixTiming,
    }, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
