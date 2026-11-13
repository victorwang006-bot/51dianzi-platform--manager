#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const ROOT = process.env.METADATA_OPS_ROOT || '/opt/ops/20261113-sales-unified-4kOS3RBC';
const TABLES = ['business_sales_order_metadata_orders', 'business_sales_order_receivers', 'business_sales_order_after_sales', 'business_sales_order_metadata_requests', 'business_sales_order_metadata_audits'];
const requireCondition = (ok, message) => { if (!ok) throw new Error(message); };
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function save(name, value) {
  fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  const file = path.join(ROOT, name), temporary = file + '.tmp-' + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, file);
}
async function main() {
  const mode = process.argv[2];
  requireCondition(['--timezone', '--prepare', '--verify'].includes(mode), 'USE_TIMEZONE_PREPARE_OR_VERIFY');
  const processes = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }));
  const adminProcess = processes.find(item => item.name === 'dianzi51-admin');
  requireCondition(adminProcess?.pm2_env.status === 'online', 'ADMIN_NOT_ONLINE');
  const env = adminProcess.pm2_env.env || adminProcess.pm2_env;
  const uri = env.DATABASE_URL || adminProcess.pm2_env.DATABASE_URL;
  requireCondition(typeof uri === 'string' && new URL(uri).pathname === '/dianzi51_admin', 'EXPECTED_ADMIN_DATABASE_REQUIRED');
  if (env.TZ) globalThis.process.env.TZ = env.TZ;
  const require = createRequire(path.join(adminProcess.pm2_env.pm_cwd, 'package.json'));
  const connection = await require('mysql2/promise').createConnection(uri);
  try {
    // No SET time_zone: emulate the unmodified native drizzle(DATABASE_URL) defaults.
    const [clocks] = await connection.query("SELECT @@session.time_zone AS sessionZone, @@system_time_zone AS systemZone, NOW(3) AS localNow, DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%fZ') AS utcNow");
    const clock = clocks[0];
    const utc = Date.parse(clock.utcNow.replace(/(\.\d{3})\d{3}Z$/, '$1Z'));
    const isDate = clock.localNow instanceof Date;
    const delta = isDate ? clock.localNow.getTime() - utc : null;
    const config = connection.connection?.config || connection.config || {};
    const timezone = { status: isDate && Number.isFinite(delta) && Math.abs(delta) <= 10 ? 'PASS' : 'BLOCKED', atUtc: new Date().toISOString(), processTZ: env.TZ || null, nodeOffsetMinutes: new Date().getTimezoneOffset(), driverTimezone: config.timezone || 'local', driverDateStrings: config.dateStrings === true, mysqlSessionZone: clock.sessionZone, mysqlSystemZone: clock.systemZone, returnedDateObject: isDate, nativeTimestampUtcDeltaMs: delta };
    save('timezone-proof.json', timezone);
    requireCondition(timezone.status === 'PASS', 'NATIVE_TIMESTAMP_UTC_MAPPING_NOT_VERIFIED');
    if (mode === '--timezone') { console.log(JSON.stringify(timezone)); return; }
    const ddl = fs.readFileSync(path.join(ROOT, 'metadata-schema.sql'), 'utf8');
    const statements = ddl.split(';').map(value => value.trim()).filter(Boolean);
    requireCondition(statements.length === TABLES.length, 'EXACT_FIVE_TABLE_DDL_REQUIRED');
    const ddlNames = statements.map(value => value.match(/^CREATE TABLE (business_sales_order_[a-z_]+)\s*\(/)?.[1]);
    requireCondition(JSON.stringify(ddlNames) === JSON.stringify(TABLES), 'METADATA_DDL_ALLOWLIST_FAILED');
    requireCondition(!/\b(?:ALTER|DROP|DELETE|INSERT|UPDATE|REFERENCES)\b/i.test(ddl), 'NON_METADATA_CREATE_OPERATION_REFUSED');
    const [existing] = await connection.execute('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (' + TABLES.map(() => '?').join(',') + ')', TABLES);
    const existingNames = new Set(existing.map(item => item.name));
    const created = [];
    if (mode === '--prepare') {
      for (let i = 0; i < TABLES.length; i++) {
        if (!existingNames.has(TABLES[i])) { await connection.query(statements[i]); created.push(TABLES[i]); }
      }
    }
    const counts = {}, schemas = {};
    for (const table of TABLES) {
      const [tableState] = await connection.execute('SELECT ENGINE AS engine, TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table]);
      requireCondition(tableState.length === 1 && tableState[0].engine === 'InnoDB' && tableState[0].collation === 'utf8mb4_bin', 'METADATA_TABLE_ENGINE_OR_COLLATION_MISMATCH');
      const [rows] = await connection.query('SELECT COUNT(*) AS count FROM `' + table + '`');
      const [description] = await connection.query('SHOW CREATE TABLE `' + table + '`');
      const definition = description[0]['Create Table'];
      requireCondition(!/FOREIGN KEY|REFERENCES/i.test(definition), 'ORIGINAL_TABLE_FOREIGN_KEY_REFUSED');
      counts[table] = Number(rows[0].count);
      schemas[table] = digest(definition.replace(/AUTO_INCREMENT=\d+/g, 'AUTO_INCREMENT=__CURRENT__'));
    }
    const [kinds] = await connection.query("SHOW COLUMNS FROM business_sales_order_after_sales LIKE 'kind'");
    requireCondition(kinds.length === 1 && kinds[0].Type === "enum('consultation','repair','exchange','return_request','refund_request')", 'AFTERSALE_INTENT_ENUM_MISMATCH');
    const receipt = { status: 'PASS', atUtc: new Date().toISOString(), action: mode, ddlSha256: digest(ddl), tables: TABLES, createdTables: created, counts, schemaHashes: schemas, originalTableDDL: 0, originalTableDML: 0, metadataRecordWrites: 0, historicalBackfill: 0, independentTablesOnly: true, timezoneVerified: true };
    save(mode === '--prepare' ? 'schema-prepared.json' : 'schema-verified.json', receipt);
    console.log(JSON.stringify(receipt));
  } finally { await connection.end(); }
}
main().catch(error => { console.error(JSON.stringify({ status: 'FAILED', message: error.message })); globalThis.process.exitCode = 1; });
