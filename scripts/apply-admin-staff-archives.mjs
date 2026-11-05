#!/usr/bin/env node
/** Server-local explicit migration. Never reads a .env, user data, or deletes/alters a table. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
const table = 'admin_staff_archives';
const columns = ['id','adminUserId','merchantId','enterpriseId','frontUserId','actorAdminUserId','actorFrontUserId',
  'bindingVersion','actorBindingVersion','expectedSessionVersion','resultingSessionVersion','requestId','expectedRevision',
  'nextOwnerUserId','enterpriseBinding','state','attemptCount','lastError','archivedAt','completedAt','updatedAt'];
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const sqlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '20261105-admin-staff-archives.sql');
async function main() {
  if (!process.argv.includes('--apply')) { console.log(JSON.stringify({planOnly:true,table,scope:'CREATE new sidecar only; no ALTER/DML',sqlSha256:sha(fs.readFileSync(sqlPath))})); return; }
  if (process.argv.slice(2).join(' ') !== '--apply' || !process.env.DATABASE_URL) throw new Error('contract');
  const raw=fs.readFileSync(sqlPath,'utf8'), sql=raw.replace(/^--.*$/mg,'').trim();
  if (!/^CREATE TABLE admin_staff_archives\s*\([\s\S]+\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;$/.test(sql)
    || /\b(?:ALTER|DROP|TRUNCATE|DELETE|INSERT|UPDATE)\b/i.test(sql.replace(/updatedAt/gi,''))) throw new Error('schema-contract');
  const db=await mysql.createConnection(process.env.DATABASE_URL);
  try {
    const [lock]=await db.query("SELECT GET_LOCK('51-admin-staff-archives-schema', 0) AS acquired");
    if (lock[0]?.acquired !== 1) throw new Error('migration-lock');
    const [existing]=await db.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);
    const created=existing.length===0;
    if (created) await db.query(sql);
    const [actual]=await db.query('SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',[table]);
    if (JSON.stringify(actual.map(x=>x.COLUMN_NAME))!==JSON.stringify(columns)) throw new Error('schema-columns');
    const nullable=new Set(['merchantId','enterpriseId','frontUserId','actorFrontUserId','actorBindingVersion','expectedRevision','enterpriseBinding','nextOwnerUserId','lastError','completedAt']);
    if (actual.some(x=>x.IS_NULLABLE!==(nullable.has(x.COLUMN_NAME)?'YES':'NO'))) throw new Error('schema-nullability');
    const [indexes]=await db.query('SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnNames FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? GROUP BY INDEX_NAME,NON_UNIQUE',[table]);
    const wanted={PRIMARY:'id',admin_staff_archives_admin_unique:'adminUserId',admin_staff_archives_request_unique:'requestId',admin_staff_archives_pending_idx:'state,updatedAt'};
    if (indexes.length!==4 || indexes.some(x=>wanted[x.INDEX_NAME]!==x.columnNames || x.NON_UNIQUE!==(x.INDEX_NAME==='admin_staff_archives_pending_idx'?1:0))) throw new Error('schema-index');
    const [shape]=await db.query('SHOW CREATE TABLE admin_staff_archives');
    console.log(JSON.stringify({ok:true,table,created,sqlSha256:sha(raw),schemaSha256:sha(shape[0]['Create Table']),businessDataWrites:false,existingTablesChanged:false}));
    await db.query("SELECT RELEASE_LOCK('51-admin-staff-archives-schema')");
  } finally { await db.end(); }
}
main().catch(()=>{ console.error('Staff archive schema stopped; sensitive details suppressed. Inspect schema before retry.');process.exitCode=1; });
