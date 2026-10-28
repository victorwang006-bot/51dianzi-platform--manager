// Execute on ECS via `node < this-file`; does not import/start the application.
// Uses a READ ONLY transaction, prints no credentials or bank/account details.
const fs = require('fs');
const cp = require('child_process');
const vm = require('vm');
const crypto = require('crypto');
const {createRequire} = require('module');
const root = '/opt/releases/20261020-erp-certification-unified-v1/admin';
const req = createRequire(root + '/package.json');
const mysql = req('mysql2/promise');
const {sql} = req('drizzle-orm');
const {MySqlDialect} = req('drizzle-orm/mysql-core');
const dialect = new MySqlDialect();
const processes = JSON.parse(cp.execFileSync('pm2', ['jlist'], {encoding:'utf8'}));
const apps = processes.filter(p => p.name === 'dianzi51-admin');
if (apps.length !== 2 || apps.some(p => p.pm2_env.pm_cwd !== root || p.pm2_env.pm_exec_path !== root + '/dist/index.js')) throw Error('Unexpected PM2 deployment target');
const env = apps[0].pm2_env;
const uri = env.DATABASE_URL || env.env?.DATABASE_URL;
const platform = env.PLATFORM_DB_NAME || env.env?.PLATFORM_DB_NAME || 'dianzi51';
if (!uri || !/^[A-Za-z0-9_]+$/.test(platform)) throw Error('Invalid database configuration');
const candidatePath = '/tmp/cn-review-readable-RP8XvX8GVfYKmIsx3rS8D5/index.backend.js';
if (process.env.CN_REVIEW_ARTIFACT_PATH && process.env.CN_REVIEW_ARTIFACT_PATH !== candidatePath) throw Error('Unexpected candidate artifact');
const code = fs.readFileSync(process.env.CN_REVIEW_ARTIFACT_PATH || root + '/dist/index.js', 'utf8');
const hash = crypto.createHash('sha256').update(code).digest('hex');
function extract(name, next) {
  const start = code.indexOf('function ' + name + '(');
  const end = code.indexOf('\n' + next, start);
  if (start < 0 || end <= start) throw Error('Missing exact pure function ' + name);
  return code.slice(start, end);
}
const dateFunctions = code.slice(code.indexOf('var CN_REVIEW_DRAFT_KEYS ='), code.indexOf('function cnReviewCompanyGuard('));
const detailStart = code.indexOf('async function getCnRegistrationReviewDetail(');
const detailEnd = code.indexOf('async function reviewCnRegistrationDraft(', detailStart);
if (detailStart < 0 || detailEnd < detailStart) throw Error('Missing read-only detail function');
(async () => {
  const db = await mysql.createConnection(uri);
  try {
    await db.query('START TRANSACTION READ ONLY');
    const [merchantRows] = await db.query('SELECT * FROM merchants WHERE id = ? LIMIT 1', [30780]);
    if (!merchantRows[0]) throw Error('Target merchant missing');
    const executor = {
      select: () => ({from: () => ({where: () => ({limit: async () => merchantRows})})}),
      execute: async value => {
        const compiled = dialect.sqlToQuery(value);
        if (!/^\s*SELECT\b/i.test(compiled.sql)) throw Error('Refusing non-SELECT statement');
        return db.query(compiled.sql, compiled.params);
      }
    };
    const context = vm.createContext({sql4:sql,PLATFORM_DB:platform,CN_REVIEW_VERSION_PREFIX:'cn-registration-review-v1',getDb:async()=>executor,merchants:{id:30780},eq:()=>null});
    const helpers = [
      extract('decodeJsonValue','function normalizeMaterialJson'),
      extract('normalizeCreditCode','function normalizePortalUserId'),
      extract('normalizeCrmPortalUserId','function decideMerchantCrmGrant'),
      extract('merchantRegistrationIdentity','var CRM_COMPANY_ALREADY_ENABLED_MESSAGE')
    ].join('\n');
    vm.runInContext(helpers + '\n' + dateFunctions + '\n' + code.slice(detailStart, detailEnd), context);
    try {
      const detail = await context.getCnRegistrationReviewDetail(30780);
      console.log(JSON.stringify({artifactSha256:hash,detailRead:'SUCCESS',merchantId:detail.merchantId,reviewKind:detail.reviewKind,reviewStatus:detail.reviewStatus,canReview:detail.canReview,hasEffective:!!detail.effective,hasCandidate:!!detail.candidate,reviewBlockedCode:detail.reviewBlockedCode||null,reviewBlockedReason:detail.reviewBlockedReason||null,legalPersonDifference:detail.differences.some(x=>x.field==='legalPerson'),versionValid:/^[a-f0-9]{64}$/i.test(detail.candidate?.expectedVersion||''),differenceCount:detail.differences.length,documentAvailability:Object.fromEntries(Object.entries(detail.candidate?.summary?.documents||{}).map(([k,v])=>[k,!!v.available])),pm2:apps.map(p=>({id:p.pm_id,pid:p.pid,status:p.pm2_env.status,cwd:p.pm2_env.pm_cwd}))}));
    } catch(e) {
      console.log(JSON.stringify({artifactSha256:hash,detailRead:'FAILED',error:e.message,pm2:apps.map(p=>({id:p.pm_id,pid:p.pid,status:p.pm2_env.status,cwd:p.pm2_env.pm_cwd}))}));
      if (process.env.EXPECT_CN_REVIEW_FAILURE !== '1') process.exitCode = 1;
    }
    await db.rollback();
  } finally {await db.end();}
})().catch(e => {console.error('Read-only probe failed:',e.code || e.message);process.exitCode = 1;});
