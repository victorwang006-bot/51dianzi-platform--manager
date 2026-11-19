'use strict';
// Fixed additive migration only. Credentials stay in memory; outputs contain no rows or secrets.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const mysql = require('/opt/releases/20261031-forum-quote-v34/front/node_modules/mysql2/promise');
const H = value => crypto.createHash('sha256').update(value).digest('hex');
const STAGE = '/opt/backups/official-cart-20261119-yOJKWq2D/schema';
const SQL_FILE = path.join(STAGE, 'official-cart-20261119.sql');
const SQL_SHA = '91df6cdff504bbaebfa77bc14957528aedb7d1d7c7af25ac33590838ed21349c';
const FIRST_EMPTY_TABLE_SHA = '97adc5f47ea7bf4432a21d29498326404f84f579b2733c11e86579ab0b217734';
const ORIGINAL_PREFLIGHT_SHA = 'b93bdf361a362e05b45ecbc81efbe003ac2214aa6fdfb355aaa9c3e653dc2fcd';
const ORIGINAL_BEFORE_SCHEMA_SHA = '6185a08991a8c017e7ccda715d37fb781b1a238b570f1f757eb1ff36296bc6c7';
const NEW_TABLES = ['official_cart_items', 'official_cart_checkout_sessions', 'official_basket_requests', 'official_basket_receipts'];
const OLD_TABLES = ['official_checkout_receipts', 'cart_items', 'checkout_sessions', 'order_items', 'orders', 'payment_batches'];
const INDEXES = {
  official_cart_items: ['PRIMARY', 'official_cart_owner_public_uq'],
  official_cart_checkout_sessions: ['PRIMARY', 'official_cart_session_owner_idx'],
  official_basket_requests: ['PRIMARY', 'official_basket_token_uq', 'official_basket_order_uq', 'official_basket_batch_uq'],
  official_basket_receipts: ['PRIMARY', 'official_basket_child_request_uq', 'official_basket_material_uq', 'official_basket_receipt_reservation_idx'],
};
function need(condition, code) { if (!condition) throw new Error(code); }
function save(name, value) {
  if (!name.endsWith('.json')) name += '.json';
  need(/^[a-z0-9-]+\.json$/.test(name), 'FIXED_RECEIPT_NAME');
  fs.writeFileSync(path.join(STAGE, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
function requireOwnedPartial(tables) {
  need(H(fs.readFileSync(path.join(STAGE, 'preflight.json'))) === ORIGINAL_PREFLIGHT_SHA, 'ORIGINAL_ZERO_NEW_TABLES_PROOF');
  need(H(fs.readFileSync(path.join(STAGE, 'before-schema.json'))) === ORIGINAL_BEFORE_SCHEMA_SHA, 'ORIGINAL_OWN_ADDITIVE_ATTEMPT');
  need(tables[0].exists && tables[0].count === 0 && H(tables[0].create) === FIRST_EMPTY_TABLE_SHA, 'ONLY_EXACT_OWN_EMPTY_FIRST_TABLE');
  need(tables.slice(1).every(row => !row.exists), 'REMAINING_TABLES_MUST_BE_ABSENT');
}
function statements(text) {
  const clean = text.replace(/^\s*--.*$/gm, '');
  const parts = clean.split(';').map(s => s.trim()).filter(Boolean);
  need(parts.length === 5 && parts[0] === 'USE dianzi51', 'EXACT_FIVE_STATEMENTS');
  for (let i = 0; i < NEW_TABLES.length; i++) need(parts[i + 1].startsWith('CREATE TABLE IF NOT EXISTS ' + NEW_TABLES[i] + ' ('), 'FIXED_CREATE_ONLY');
  need(!/^\s*(?:ALTER|DROP|DELETE|INSERT|UPDATE|REPLACE|GRANT|TRUNCATE|CALL|LOAD)\b/im.test(clean), 'NO_OLD_TABLE_OR_DATA_WRITES');
  return parts;
}
async function schema(c, table) {
  need([...OLD_TABLES, ...NEW_TABLES].includes(table), 'FIXED_TABLE_ONLY');
  const [exists] = await c.query('SHOW TABLES LIKE ?', [table]);
  if (!exists.length) return { table, exists: false };
  const [create] = await c.query('SHOW CREATE TABLE `' + table + '`');
  const [columns] = await c.query('SHOW COLUMNS FROM `' + table + '`');
  const [indexes] = await c.query('SHOW INDEX FROM `' + table + '`');
  const [count] = await c.query('SELECT COUNT(*) n FROM `' + table + '`');
  return { table, exists: true, create: Object.values(create[0])[1], columns, indexes, count: Number(count[0].n) };
}
async function originals(c) {
  const tables = [];
  for (const table of OLD_TABLES) {
    const meta = await schema(c, table); need(meta.exists, 'OLD_TABLE_REQUIRED');
    const order = table === 'official_checkout_receipts' ? 'orderItemId' : 'id';
    const [rows] = await c.query('SELECT * FROM `' + table + '` ORDER BY `' + order + '`');
    tables.push({ ...meta, recordsSha256: H(JSON.stringify(rows)) });
  }
  return tables;
}
function oldConstraints(rows) {
  const receipt = rows.find(r => r.table === 'official_checkout_receipts');
  for (const [name, columns] of [
    ['official_receipt_buyer_request_uq', 'buyerId,requestId'],
    ['official_receipt_order_uq', 'orderId'], ['official_receipt_batch_uq', 'paymentBatchId'],
  ]) {
    const values = receipt.indexes.filter(x => x.Key_name === name).sort((a,b) => a.Seq_in_index - b.Seq_in_index);
    need(values.length > 0 && values.every(x => x.Non_unique === 0) && values.map(x => x.Column_name).join(',') === columns, 'OLD_SINGLE_UNIQUE_MUST_STAY');
  }
}
(async () => {
  const action = process.argv[2] || 'preflight'; need(['preflight','apply','verify'].includes(action), 'FIXED_ACTION');
  const real = fs.realpathSync(STAGE);
  need(real === STAGE || real === '/data/archive/backups/official-cart-20261119-yOJKWq2D/schema', 'FIXED_CANONICAL_SCHEMA_STAGE');
  const bytes = fs.readFileSync(SQL_FILE); need(H(bytes) === SQL_SHA, 'FIXED_SQL_HASH'); const ddl = statements(bytes.toString());
  const ps = JSON.parse(cp.execFileSync('pm2', ['jlist'], { maxBuffer: 24e6 }));
  const actual = ps.filter(p => p.name === 'dianzi51'); need(actual.length === 4, 'FOUR_ACTUAL_FRONT_PROCESSES');
  const urls = actual.map(p => p.pm2_env.DATABASE_URL || p.pm2_env.env?.DATABASE_URL); need(urls[0] && urls.every(v => v === urls[0]), 'SHARED_EXISTING_DATABASE_CONFIG');
  const c = await mysql.createConnection(urls[0]);
  try {
    const [[db]] = await c.query('SELECT DATABASE() db, VERSION() version'); need(db.db === 'dianzi51', 'ACTUAL_FRONT_DATABASE');
    const [canonical] = await c.query('SELECT COUNT(*) n FROM dianzi51_admin.official_mall_materials');
    const before = await originals(c); oldConstraints(before);
    const tables = []; for (const table of NEW_TABLES) tables.push(await schema(c, table));
    if (action === 'preflight') {
      requireOwnedPartial(tables);
      const result = { status: 'preflight-passed', sqlSha256: SQL_SHA, checkedAtUtc: new Date().toISOString(), oldTables: before, newTables: tables, canonicalMaterialCount: Number(canonical[0].n), applicationWrites: 0, schemaWrites: 0 };
      save('preflight-resume-v2', result); console.log(JSON.stringify({ status: result.status, sqlSha256: SQL_SHA, newTables: NEW_TABLES.length, oldTables: OLD_TABLES.length, businessWrites: 0 })); return;
    }
    if (action === 'apply') {
      const coord = JSON.parse(fs.readFileSync('/opt/ops/51-project-release-coordination-20261027.json', 'utf8'));
      need(coord.shared_release_active === false, 'FOREIGN_RELEASE_WINDOW');
      need(!fs.existsSync('/opt/ops/official-cart-active-20261119.json'), 'NEW_SERVICE_MUST_NOT_BE_ACTIVE');
      requireOwnedPartial(tables);
      // Durable private backup before any DDL. It contains metadata + hashes, never credentials.
      save('before-schema-resume-v2', { sqlSha256: SQL_SHA, before, checkedAtUtc: new Date().toISOString() });
      for (const sql of [ddl[0], ...ddl.slice(2)]) await c.query(sql);
    }
    const after = await originals(c); oldConstraints(after);
    for (let i = 0; i < before.length; i++) {
      need(before[i].create === after[i].create, 'OLD_SCHEMA_CHANGED');
      need(before[i].recordsSha256 === after[i].recordsSha256, 'BUSINESS_FINGERPRINT_CHANGED_NO_RESTORE');
    }
    const created = []; for (const table of NEW_TABLES) {
      const s = await schema(c, table); need(s.exists && s.create.includes('ENGINE=InnoDB'), 'NEW_INNODB_REQUIRED');
      for (const name of INDEXES[table]) need(s.indexes.some(x => x.Key_name === name), 'NEW_INDEX_REQUIRED');
      if (action === 'apply') need(s.count === 0, 'NEW_TABLE_MUST_BE_EMPTY'); created.push(s);
    }
    const result = { status: 'verified', action, sqlSha256: SQL_SHA, migrationSha256: SQL_SHA, targetTables: NEW_TABLES, checkedAtUtc: new Date().toISOString(), oldSchemasUnchanged: true, oldSingleUniquesUnchanged: true, oldBusinessRecordsUnchanged: true, tables: created, businessWrites: 0 };
    save(action === 'apply' ? 'schema-receipt' : 'verification-' + Date.now(), result);
    console.log(JSON.stringify({ status: result.status, action, sqlSha256: SQL_SHA, targetTables: NEW_TABLES, oldBusinessRecordsUnchanged: true, businessWrites: 0 }));
  } finally { await c.end(); }
})().catch(error => { console.error(JSON.stringify({ status: 'failed', reason: /^[A-Z0-9_]+$/.test(error.message || '') ? error.message : error.code || error.name })); process.exitCode = 1; });
