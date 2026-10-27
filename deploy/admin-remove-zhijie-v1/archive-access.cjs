'use strict';
const fs = require('fs');
const cp = require('child_process');
const crypto = require('crypto');
const assert = require('assert/strict');
const { createRequire } = require('module');
const root = '/opt/ops/20261028-admin-remove-zhijie-v1';
const tables = ['zhijie_staff_access', 'zhijie_access_audits'];
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

(async () => {
  const mode = process.argv[2];
  assert.ok(['archive', 'verify'].includes(mode));
  const processes = JSON.parse(cp.execFileSync('/usr/bin/node-22', [
    '/usr/local/lib/node_modules/pm2/bin/pm2', 'jlist'
  ], { encoding: 'utf8' }));
  const admin = processes.find(item => item.name === 'dianzi51-admin');
  assert.ok(admin);
  const env = { ...admin.pm2_env, ...(admin.pm2_env.env || {}) };
  const requireAdmin = createRequire(admin.pm2_env.pm_cwd + '/package.json');
  const url = new URL(env.DATABASE_URL);
  assert.equal(url.pathname, '/dianzi51_admin');
  const db = await requireAdmin('mysql2/promise').createConnection(url.toString());
  const result = {};
  try {
    await db.query('SET TRANSACTION READ ONLY');
    await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    for (const table of tables) {
      const [rows] = await db.query('SELECT * FROM `' + table + '` ORDER BY id');
      assert.equal(rows.length, 0, 'unexpected records appeared; inspect, never delete data');
      const [schema] = await db.query('SHOW CREATE TABLE `' + table + '`');
      const path = root + '/private/' + table + '.json';
      if (mode === 'archive') {
        assert.ok(!fs.existsSync(path), 'existing archive must not be overwritten');
        fs.writeFileSync(path, JSON.stringify({ table, rows, schema }, null, 2) + '\n', { mode: 0o600 });
      } else {
        const archived = JSON.parse(fs.readFileSync(path, 'utf8'));
        assert.equal(sha(rows), sha(archived.rows), table + ' records drifted; stop without restoring database');
        assert.equal(sha(schema), sha(archived.schema), table + ' schema drifted');
      }
      result[table] = { count: rows.length, rowsSha256: sha(rows), schemaSha256: sha(schema) };
    }
    await db.rollback();
  } finally {
    await db.end();
  }
  console.log(JSON.stringify({ mode, tables: result, databaseWrites: 0, tablesDropped: 0 }));
})().catch(error => {
  console.error('ZHJ_ARCHIVE_STOPPED', error.message);
  process.exitCode = 1;
});
