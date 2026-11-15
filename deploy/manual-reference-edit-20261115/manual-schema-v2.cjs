'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const ROOT = '/opt/ops/20261115-manual-reference-schema-v2-JfFQcJM';
const TABLE = 'channel_inventory_manual_references';
const COORD = '/opt/ops/51-project-release-coordination-20261027.json';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const assert = (v, why) => { if (!v) throw new Error(why); };
function exclusiveRecord(file, value) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value,null,2)+'\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const dir = fs.openSync(path.dirname(file),'r');
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}
function validateSql(bytes) {
  const text = bytes.toString('utf8').replace(/^\s*--[^\n]*(?:\n|$)/gm, '').trim();
  assert(/^CREATE TABLE\s+`?channel_inventory_manual_references`?\s*\(/i.test(text), 'ONLY_FIXED_CREATE_TABLE_ALLOWED');
  assert(!/\b(ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|REPLACE|RENAME|GRANT|REVOKE|SELECT|REFERENCES|TRIGGER|PROCEDURE|IF\s+NOT\s+EXISTS)\b/i.test(text), 'OTHER_SQL_OR_REFERENCES_FORBIDDEN');
  const statement = text.replace(/;\s*$/, '');
  assert(!statement.includes(';') && !statement.includes('/*') && !statement.includes('--'), 'EXACTLY_ONE_CREATE_STATEMENT');
  assert(/ENGINE\s*=\s*InnoDB/i.test(statement), 'INNODB_REQUIRED');
  return statement;
}
function fingerprint(rows) { return sha(Buffer.from(JSON.stringify(rows))); }
async function tableShape(c) {
  const [tables] = await c.query('SELECT ENGINE,TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [TABLE]);
  if (!tables.length) return null;
  const [columns] = await c.query('SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [TABLE]);
  const [indexes] = await c.query('SELECT INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX', [TABLE]);
  return { tables, columns, indexes };
}
async function protectedSnapshot(c) {
  const out = {};
  for (const table of ['channel_inventory_materials', 'channel_inventory_channels', 'crm_customers', 'crm_customer_supply_channels']) {
    const [rows] = await c.query('SELECT * FROM `' + table + '` ORDER BY id');
    out[table] = { count: rows.length, sha256: fingerprint(rows) };
  }
  return out;
}
function verifyShape(shape, intent) {
  assert(shape && shape.tables.length === 1 && shape.tables[0].ENGINE === 'InnoDB', 'EXPECTED_INNODB_TABLE');
  assert(JSON.stringify(shape.columns.map(c => c.COLUMN_NAME)) === JSON.stringify(intent.expectedColumns), 'COLUMN_NAMES_OR_ORDER_MISMATCH');
  const primary = shape.indexes.filter(x => x.INDEX_NAME === 'PRIMARY').map(x => x.COLUMN_NAME);
  assert(JSON.stringify(primary) === JSON.stringify(['enterpriseId','dataOwnerUserId','materialId']), 'PRIMARY_KEY_SCOPE_MISMATCH');
  const byName = Object.fromEntries(shape.columns.map(c => [c.COLUMN_NAME,c]));
  assert(shape.tables[0].TABLE_COLLATION === 'utf8mb4_unicode_ci', 'TABLE_COLLATION_MISMATCH');
  assert(shape.indexes.length === 3 && shape.indexes.every(x => x.INDEX_NAME === 'PRIMARY' && Number(x.NON_UNIQUE) === 0), 'UNEXPECTED_INDEX');
  for (const name of ['enterpriseId','dataOwnerUserId','materialId','updatedByUserId','updatedByAdminAccountId']) assert(byName[name].COLUMN_TYPE === 'bigint unsigned', 'EXACT_METADATA_TYPE_REQUIRED');
  assert(byName.updatedAt.COLUMN_TYPE === 'timestamp(3)' && String(byName.updatedAt.COLUMN_DEFAULT).toUpperCase() === 'CURRENT_TIMESTAMP(3)', 'TIMESTAMP_DEFAULT_MISMATCH');
  for (const name of ['manualReferenceLcsc', 'manualReferenceIckey']) assert(byName[name].COLUMN_TYPE === 'varchar(32)' && byName[name].IS_NULLABLE === 'YES', 'EXACT_NULLABLE_PRICE_STORAGE');
  for (const name of ['enterpriseId', 'dataOwnerUserId', 'materialId', 'updatedByUserId', 'updatedAt']) assert(byName[name].IS_NULLABLE === 'NO', 'REQUIRED_METADATA_NOT_NULL');
  assert(byName.updatedByAdminAccountId.IS_NULLABLE === 'YES', 'NATIVE_ACTOR_MUST_ALLOW_NO_ADMIN');
}
function assertMaintenancePostcondition(expected, actual, manualRows) {
  assert(JSON.stringify(expected) === JSON.stringify(actual), 'PROTECTED_BUSINESS_DATA_CHANGED_NO_SUCCESS_RECEIPT');
  assert(Number(manualRows) === 0, 'NEW_MANUAL_TABLE_NOT_EMPTY_NO_SUCCESS_RECEIPT');
}
async function main(argv) {
  const [mode, intentHash, planHash] = argv;
  assert(['plan', 'apply', 'verify'].includes(mode), 'UNKNOWN_MODE');
  const intentBytes = fs.readFileSync(path.join(ROOT, 'intent.json'));
  assert(sha(intentBytes) === intentHash, 'INTENT_PIN_MISMATCH');
  const intent = JSON.parse(intentBytes);
  assert(intent.contractVersion === 'single-manual-reference-table-v1' && intent.userConfirmed === true && intent.root === ROOT && intent.table === TABLE, 'EXACT_SCOPE_REQUIRED');
  const sqlBytes = fs.readFileSync(path.join(ROOT, 'schema.sql'));
  assert(sha(sqlBytes) === intent.sqlSha256, 'DDL_PIN_MISMATCH');
  const statement = validateSql(sqlBytes);
  const coordBytes = fs.readFileSync(COORD);
  assert(sha(coordBytes) === intent.coordSha256, 'COORD_BASELINE_CHANGED');
  const coord = JSON.parse(coordBytes);
  assert(coord.shared_release_active === false, 'ACTIVE_RELEASE_WINDOW');
  const processResult = spawnSync('pm2', ['jlist'], {encoding:'utf8', maxBuffer:8*1024*1024});
  assert(processResult.status === 0, 'PM2_READ_FAILED');
  const pm = JSON.parse(processResult.stdout).find(p => p.pm_id === 190);
  assert(pm && pm.pm2_env.status === 'online', 'FRONT_NOT_ONLINE');
  if (mode !== 'verify') assert(sha(fs.readFileSync(pm.pm2_env.pm_exec_path)) === intent.frontSha256, 'FRONT_BASELINE_CHANGED');
  const mysql = createRequire(pm.pm2_env.pm_cwd + '/package.json')('mysql2/promise');
  const c = await mysql.createConnection(pm.pm2_env.DATABASE_URL);
  let locked = false;
  try {
    const [lock] = await c.query("SELECT GET_LOCK('51-manual-reference-schema-20261115',0) AS held");
    assert(Number(lock[0].held) === 1, 'DATABASE_LOCK_BUSY'); locked = true;
    await c.query('SET SESSION TRANSACTION READ ONLY');
    await c.query('START TRANSACTION READ ONLY');
    const before = await protectedSnapshot(c), shapeBefore = await tableShape(c);
    await c.rollback();
    if (mode === 'plan') {
      assert(shapeBefore === null, 'TABLE_ALREADY_EXISTS_INSPECT_NO_REPLAY');
      return {status:'PLANNED_ONE_CREATE_TABLE',root:ROOT,intentHash,sqlSha256:intent.sqlSha256,requestId:intent.requestId,protectedBefore:before,ddlStatements:0,businessWrites:0,processReloads:0};
    }
    const planBytes = fs.readFileSync(path.join(ROOT, 'plan-result.json'));
    assert(sha(planBytes) === planHash, 'PLAN_PIN_MISMATCH');
    const plan = JSON.parse(planBytes);
    assert(plan.status === 'PLANNED_ONE_CREATE_TABLE' && plan.root === ROOT && plan.intentHash === intentHash && plan.requestId === intent.requestId && plan.sqlSha256 === intent.sqlSha256, 'EXACT_PLAN_REQUIRED');
    if (mode === 'verify') {
      verifyShape(shapeBefore,intent);
      const [count] = await c.query('SELECT COUNT(*) AS count FROM channel_inventory_manual_references');
      assertMaintenancePostcondition(plan.protectedBefore,before,count[0].count);
      return {status:'VERIFIED_MANUAL_REFERENCE_SCHEMA',root:ROOT,intentHash,planHash,requestId:intent.requestId,sqlSha256:intent.sqlSha256,shape:shapeBefore,shapeSha256:fingerprint(shapeBefore),manualRows:0,protectedBefore:plan.protectedBefore,protectedAfter:before,protectedUnchanged:true,businessWrites:0,ddlStatements:0,processReloads:0};
    }
    assert(shapeBefore === null, 'TABLE_ALREADY_EXISTS_NO_APPLY_REPLAY');
    assert(JSON.stringify(plan.protectedBefore) === JSON.stringify(before), 'BUSINESS_BASELINE_CHANGED_REPLAN_REQUIRED');
    exclusiveRecord(path.join(ROOT,'create-intent.json'),{status:'CREATE_INTENT_DURABLE',intentHash,planHash,sqlSha256:intent.sqlSha256,requestId:intent.requestId,at:new Date().toISOString()});
    await c.query('SET SESSION TRANSACTION READ WRITE');
    await c.query(statement);
    const afterShape = await tableShape(c); verifyShape(afterShape,intent);
    const after = await protectedSnapshot(c);
    const [count] = await c.query('SELECT COUNT(*) AS count FROM channel_inventory_manual_references');
    assertMaintenancePostcondition(plan.protectedBefore,after,count[0].count);
    const result = {status:'CREATED_ONE_MANUAL_REFERENCE_TABLE',root:ROOT,intentHash,sqlSha256:intent.sqlSha256,requestId:intent.requestId,shape:afterShape,shapeSha256:fingerprint(afterShape),manualRows:Number(count[0].count),protectedBefore:before,protectedAfter:after,protectedUnchanged:JSON.stringify(before)===JSON.stringify(after),ddlStatements:1,businessWrites:0,processReloads:0,rollback:'No automatic DROP: new additive table is safe for old application.'};
    exclusiveRecord(path.join(ROOT,'apply-result.json'),result);
    return result;
  } finally {
    if(locked) await c.query("SELECT RELEASE_LOCK('51-manual-reference-schema-20261115')").catch(()=>{});
    await c.end();
  }
}
if(require.main === module) main(process.argv.slice(2)).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error('MANUAL_SCHEMA_ABORT',e.code||e.message);process.exitCode=1;});
module.exports={validateSql, verifyShape, fingerprint, assertMaintenancePostcondition};
