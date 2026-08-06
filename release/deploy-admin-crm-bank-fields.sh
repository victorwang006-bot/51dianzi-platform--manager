#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

EXPECTED_HOSTNAME='iZbp19cboe4cce8vc6sqz7Z'
RELEASE_ID="${RELEASE_ID:?RELEASE_ID is required}"
EXPECTED_SHA="${EXPECTED_SHA:?EXPECTED_SHA is required}"
EXPECTED_SIZE="${EXPECTED_SIZE:?EXPECTED_SIZE is required}"

APP_LINK='/opt/apps/dianzi51-admin'
EXPECTED_OLD_TARGET='/opt/releases/20260805T154206Z-admin-order-readonly-v2/dianzi51-admin'
EXPECTED_OLD_DIST_SHA='7277679456ef2dad892851bec3c4231647e0f1626f24008f631493e0e2cf1199'
EXPECTED_OLD_PIDS='241291,241304'
EXPECTED_OLD_MIGRATION_MAX='1785906253930'
EXPECTED_NEW_MIGRATION_MAX='1785976729575'
FRONT_LINK='/opt/apps/dianzi51-platform'
EXPECTED_FRONT_TARGET='/opt/releases/20260805T153128Z-order-readonly-v1/dianzi51-platform'
EXPECTED_FRONT_DIST_SHA='897d67d906c5cd3a7b1fd33f7e0dc30c16f6004ec6ceb3608640157a192a76cf'
EXPECTED_FRONT_PIDS='239984,239985,240010,240011'

PACKAGE="/opt/releases/${RELEASE_ID}.tar.gz"
RELEASE_ROOT="/opt/releases/${RELEASE_ID}"
SOURCE="$RELEASE_ROOT/dianzi51-admin"
BACKUP="/opt/backups/dianzi51-admin/${RELEASE_ID}"
RESULT="$RELEASE_ROOT/deploy-result.txt"
ARCHIVE_LIST="$RELEASE_ROOT/archive-files.txt"
EXPECTED_LIST="$RELEASE_ROOT/expected-files.txt"
NEXT_LINK="/opt/apps/.dianzi51-admin.${RELEASE_ID}.next"

OLD_TARGET=''
ACTIVATED=0
ADMIN_DATABASE_URL=''

export PATH="/usr/bin:/usr/local/bin:/usr/sbin:/usr/local/sbin:$PATH"

log() { printf '[admin-crm-bank-fields] %s\n' "$*"; }
fail() { printf '[admin-crm-bank-fields] ERROR: %s\n' "$*" >&2; return 1; }
pm2_pids() { pm2 pid "$1" 2>/dev/null | sed '/^$/d' | sort -n | paste -sd, -; }
sha() { sha256sum "$1" | cut -d ' ' -f1; }

atomic_link() {
  local target="$1"
  rm -f "$NEXT_LINK"
  ln -s "$target" "$NEXT_LINK"
  mv -Tf "$NEXT_LINK" "$APP_LINK"
}

rollback_on_error() {
  local status=$?
  trap - ERR
  set +e
  printf '[admin-crm-bank-fields] FAILURE status=%s; starting application rollback\n' "$status" >&2
  if [[ "$ACTIVATED" == '1' && -n "$OLD_TARGET" && -d "$OLD_TARGET" ]]; then
    atomic_link "$OLD_TARGET" >>"$RESULT" 2>&1
    pm2 reload dianzi51-admin >>"$RESULT" 2>&1
    nginx -t >>"$RESULT" 2>&1 && nginx -s reload >>"$RESULT" 2>&1
    sleep 5
  fi
  printf '[admin-crm-bank-fields] additive nullable columns are retained; old code remains compatible\n' >&2
  exit "$status"
}

[[ "$(hostname)" == "$EXPECTED_HOSTNAME" ]] || fail 'unexpected hostname'
[[ -L "$APP_LINK" && -L "$FRONT_LINK" ]] || fail 'active application path is not a symbolic link'
OLD_TARGET="$(readlink -f "$APP_LINK")"
[[ "$OLD_TARGET" == "$EXPECTED_OLD_TARGET" ]] || fail "unexpected admin baseline: $OLD_TARGET"
[[ "$(sha "$OLD_TARGET/dist/index.js")" == "$EXPECTED_OLD_DIST_SHA" ]] || fail 'admin dist baseline changed'
[[ "$(pm2_pids dianzi51-admin)" == "$EXPECTED_OLD_PIDS" ]] || fail 'admin PM2 processes changed before release'
[[ "$(readlink -f "$FRONT_LINK")" == "$EXPECTED_FRONT_TARGET" ]] || fail 'front release changed after freeze'
[[ "$(sha "$FRONT_LINK/dist/index.js")" == "$EXPECTED_FRONT_DIST_SHA" ]] || fail 'front dist changed after freeze'
[[ "$(pm2_pids dianzi51)" == "$EXPECTED_FRONT_PIDS" ]] || fail 'front PM2 processes changed before release'
[[ -f "$PACKAGE" ]] || fail 'release package missing'
[[ "$(sha "$PACKAGE")" == "$EXPECTED_SHA" ]] || fail 'release package SHA-256 mismatch'
[[ "$(stat -c '%s' "$PACKAGE")" == "$EXPECTED_SIZE" ]] || fail 'release package size mismatch'
[[ ! -e "$RELEASE_ROOT" && ! -e "$BACKUP" ]] || fail 'release or backup path already exists'

mkdir -p "$RELEASE_ROOT" "$BACKUP"
chmod 0700 "$RELEASE_ROOT" "$BACKUP"
exec > >(tee "$RESULT") 2>&1
trap rollback_on_error ERR

tar -tzf "$PACKAGE" | sed '/\/$/d' | LC_ALL=C sort >"$ARCHIVE_LIST"
cat >"$EXPECTED_LIST" <<'EOF'
client/src/pages/MerchantDetail.tsx
drizzle/0018_nifty_purple_man.sql
drizzle/meta/0018_snapshot.json
drizzle/meta/_journal.json
drizzle/schema.ts
package.json
pnpm-lock.yaml
release/deploy-admin-crm-bank-fields.sh
server/crmBankFieldsContract.test.ts
server/crmBankMigrationContract.test.ts
server/db.ts
server/routers.ts
EOF
LC_ALL=C sort -o "$EXPECTED_LIST" "$EXPECTED_LIST"
diff -u "$EXPECTED_LIST" "$ARCHIVE_LIST" || fail 'archive file list is not exact'
grep -Eq '(^/|(^|/)\.\.(/|$))' "$ARCHIVE_LIST" && fail 'unsafe archive path'
grep -Eq '(^|/)(\.env[^/]*|node_modules|dist|uploads|\.git|\.manus-logs|docs)(/|$)|\.(pem|key|log|sqlite|db)$' "$ARCHIVE_LIST" \
  && fail 'sensitive, database, runtime, or audit path found in archive'
[[ "$(tar -xOzf "$PACKAGE" package.json | sha256sum | cut -d ' ' -f1)" == "$(sha "$OLD_TARGET/package.json")" ]] \
  || fail 'package.json differs from active application'
[[ "$(tar -xOzf "$PACKAGE" pnpm-lock.yaml | sha256sum | cut -d ' ' -f1)" == "$(sha "$OLD_TARGET/pnpm-lock.yaml")" ]] \
  || fail 'pnpm-lock.yaml differs from active application'

log 'backing up changed source, current dist, and merchant table schema'
cat >"$BACKUP/existing-source-files.txt" <<'EOF'
client/src/pages/MerchantDetail.tsx
drizzle/meta/_journal.json
drizzle/schema.ts
server/db.ts
server/routers.ts
package.json
pnpm-lock.yaml
EOF
tar -czf "$BACKUP/source-before.tar.gz" -C "$OLD_TARGET" -T "$BACKUP/existing-source-files.txt"
cp -a "$OLD_TARGET/dist" "$BACKUP/dist-before"

log 'creating isolated release from allowlisted active source'
mkdir -p "$SOURCE"
for path in client drizzle patches scripts server shared deploy docs release; do
  [[ -e "$OLD_TARGET/$path" ]] && cp -a "$OLD_TARGET/$path" "$SOURCE/"
done
for path in .gitignore .gitkeep .prettierignore .prettierrc components.json drizzle.config.ts package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json vite.config.ts vitest.config.ts; do
  [[ -e "$OLD_TARGET/$path" ]] && cp -a "$OLD_TARGET/$path" "$SOURCE/"
done
install -m 0600 "$OLD_TARGET/ecosystem.config.cjs" "$SOURCE/ecosystem.config.cjs"
cmp -s "$OLD_TARGET/ecosystem.config.cjs" "$SOURCE/ecosystem.config.cjs" || fail 'runtime process config changed'
if [[ -L "$OLD_TARGET/uploads" ]]; then
  ln -s "$(readlink "$OLD_TARGET/uploads")" "$SOURCE/uploads"
fi
tar -xzf "$PACKAGE" -C "$SOURCE"
chmod 0700 "$SOURCE/release"
chmod 0600 "$SOURCE/release/"*

log 'installing locked dependencies and running CRM bank-field release gates'
cd "$SOURCE"
pnpm install --frozen-lockfile
pnpm exec vitest run \
  server/crmBankFieldsContract.test.ts \
  server/crmBankMigrationContract.test.ts \
  server/adminPermissions.test.ts \
  server/crmGrantPolicy.test.ts \
  --pool=forks --maxWorkers=1 --minWorkers=1 --reporter=verbose
pnpm check
pnpm build:admin
pnpm verify:admin-build
[[ -f dist/index.js && -f dist/public/index.html ]] || fail 'staged build incomplete'
grep -Fq 'companyType: z.string().trim().min(1' server/routers.ts || fail 'company type required contract missing'
grep -Fq 'settlementAccountName: z.string().trim().min(1' server/routers.ts || fail 'bank account name required contract missing'
grep -Fq 'settlementAccount: z.string().trim().min(1' server/routers.ts || fail 'bank account number required contract missing'
grep -Fq 'settlementBank: z.string().trim().min(1' server/routers.ts || fail 'bank name required contract missing'
grep -Fq 'label="账户名称" value={merchant.settlementAccountName}' client/src/pages/MerchantDetail.tsx || fail 'merchant account-name UI missing'
grep -RFlq '账户名称' dist/public || fail 'merchant bank fields missing from admin bundle'
if grep -Eiq '\b(DROP|DELETE|UPDATE|TRUNCATE|MODIFY|CHANGE|CREATE TABLE)\b' drizzle/0018_nifty_purple_man.sql; then
  fail 'migration contains a non-additive statement'
fi

ADMIN_PM2_ID="$(pm2 describe dianzi51-admin | sed -n 's/^ Describing process with id \([0-9][0-9]*\).*/\1/p' | head -n 1)"
[[ "$ADMIN_PM2_ID" =~ ^[0-9]+$ ]] || fail 'cannot locate admin PM2 id'
ADMIN_DATABASE_URL="$(pm2 env "$ADMIN_PM2_ID" | sed -n 's/^DATABASE_URL: //p' | head -n 1)"
[[ -n "$ADMIN_DATABASE_URL" ]] || fail 'admin DATABASE_URL unavailable from active PM2 environment'

log 'preflighting additive migration and saving non-data schema backup'
DATABASE_URL="$ADMIN_DATABASE_URL" BACKUP="$BACKUP" EXPECTED_OLD_MIGRATION_MAX="$EXPECTED_OLD_MIGRATION_MAX" node --input-type=module <<'NODE'
import fs from "node:fs";
import mysql from "mysql2/promise";
const db = await mysql.createConnection(process.env.DATABASE_URL);
try {
  const [columns] = await db.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'merchants' AND COLUMN_NAME IN ('companyType','companyRole') ORDER BY COLUMN_NAME",
  );
  if (columns.length !== 0) throw new Error("target merchant columns already exist before migration");
  const [ledger] = await db.query("SELECT MAX(created_at) AS maxCreatedAt FROM __drizzle_migrations");
  if (String(ledger[0].maxCreatedAt) !== process.env.EXPECTED_OLD_MIGRATION_MAX) throw new Error("migration baseline changed");
  const [countRows] = await db.query("SELECT COUNT(*) AS count FROM merchants");
  const [createRows] = await db.query("SHOW CREATE TABLE merchants");
  fs.writeFileSync(`${process.env.BACKUP}/merchant-schema-before.sql`, `${createRows[0]["Create Table"]};\n`, { mode: 0o600 });
  fs.writeFileSync(`${process.env.BACKUP}/migration-preflight.json`, JSON.stringify({ merchantCount: Number(countRows[0].count) }), { mode: 0o600 });
} finally {
  await db.end();
}
NODE

log 'applying nullable merchant company-field migration'
DATABASE_URL="$ADMIN_DATABASE_URL" pnpm drizzle-kit migrate

DATABASE_URL="$ADMIN_DATABASE_URL" BACKUP="$BACKUP" EXPECTED_NEW_MIGRATION_MAX="$EXPECTED_NEW_MIGRATION_MAX" node --input-type=module <<'NODE'
import fs from "node:fs";
import mysql from "mysql2/promise";
const before = JSON.parse(fs.readFileSync(`${process.env.BACKUP}/migration-preflight.json`, "utf8"));
const db = await mysql.createConnection(process.env.DATABASE_URL);
try {
  const [columns] = await db.query(
    "SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'merchants' AND COLUMN_NAME IN ('companyType','companyRole') ORDER BY COLUMN_NAME",
  );
  if (columns.length !== 2 || columns.some(row => row.IS_NULLABLE !== "YES")) throw new Error("nullable merchant columns were not created exactly");
  const [ledger] = await db.query("SELECT MAX(created_at) AS maxCreatedAt FROM __drizzle_migrations");
  if (String(ledger[0].maxCreatedAt) !== process.env.EXPECTED_NEW_MIGRATION_MAX) throw new Error("new migration ledger entry missing");
  const [countRows] = await db.query("SELECT COUNT(*) AS count FROM merchants");
  if (Number(countRows[0].count) !== before.merchantCount) throw new Error("merchant row count changed during migration");
  console.log(`merchant_migration=passed rows=${before.merchantCount}`);
} finally {
  await db.end();
}
NODE

NEW_DIST_SHA="$(sha dist/index.js)"
log 'rechecking frozen baselines before cutover'
[[ "$(readlink -f "$APP_LINK")" == "$OLD_TARGET" ]] || fail 'admin release changed during build'
[[ "$(sha "$OLD_TARGET/dist/index.js")" == "$EXPECTED_OLD_DIST_SHA" ]] || fail 'admin dist changed during build'
[[ "$(pm2_pids dianzi51-admin)" == "$EXPECTED_OLD_PIDS" ]] || fail 'admin PM2 processes changed during build'
[[ "$(readlink -f "$FRONT_LINK")" == "$EXPECTED_FRONT_TARGET" ]] || fail 'front release changed during build'
[[ "$(sha "$FRONT_LINK/dist/index.js")" == "$EXPECTED_FRONT_DIST_SHA" ]] || fail 'front dist changed during build'
[[ "$(pm2_pids dianzi51)" == "$EXPECTED_FRONT_PIDS" ]] || fail 'front PM2 processes changed during build'
nginx -t

log 'atomically switching admin release and reloading only admin instances'
atomic_link "$SOURCE"
ACTIVATED=1
pm2 reload dianzi51-admin
sleep 6
nginx -t
nginx -s reload
[[ "$(readlink -f "$APP_LINK")" == "$SOURCE" ]] || fail 'admin symlink did not activate new release'
[[ "$(sha "$APP_LINK/dist/index.js")" == "$NEW_DIST_SHA" ]] || fail 'active admin dist hash mismatch'
[[ "$(pm2_pids dianzi51-admin | tr ',' '\n' | sed '/^$/d' | wc -l | tr -d ' ')" == '2' ]] || fail 'admin PM2 instance count is not two'
[[ "$(readlink -f "$FRONT_LINK")" == "$EXPECTED_FRONT_TARGET" ]] || fail 'front release changed after admin reload'
[[ "$(sha "$FRONT_LINK/dist/index.js")" == "$EXPECTED_FRONT_DIST_SHA" ]] || fail 'front dist changed after admin reload'
[[ "$(pm2_pids dianzi51)" == "$EXPECTED_FRONT_PIDS" ]] || fail 'front PM2 processes changed after admin reload'

LOCAL_HTTP="$(curl -sS --max-time 20 -o "$BACKUP/local-admin-login.html" -w '%{http_code}' http://127.0.0.1:3001/admin/login)"
PUBLIC_HTTP="$(curl -sS --max-time 20 -o "$BACKUP/public-admin-login.html" -w '%{http_code}' https://51dianzi.com/admin/login)"
MERCHANT_HTTP="$(curl -sS --max-time 20 -o "$BACKUP/public-admin-merchant.html" -w '%{http_code}' https://51dianzi.com/admin/merchants/1)"
[[ "$LOCAL_HTTP" == '200' && "$PUBLIC_HTTP" == '200' && "$MERCHANT_HTTP" == '200' ]] || fail 'admin health check failed'
grep -Fq '<div id="root"></div>' "$BACKUP/public-admin-login.html" || fail 'public admin shell missing'
pm2 save

ADMIN_PIDS_AFTER="$(pm2_pids dianzi51-admin)"
cat >"$BACKUP/deployment-summary.txt" <<EOF
host=$(hostname)
release_id=$RELEASE_ID
package_sha256=$EXPECTED_SHA
old_target=$OLD_TARGET
new_target=$SOURCE
old_dist_sha256=$EXPECTED_OLD_DIST_SHA
new_dist_sha256=$NEW_DIST_SHA
admin_pids_after=$ADMIN_PIDS_AFTER
front_target_unchanged=1
front_dist_unchanged=1
front_pids_unchanged=1
crm_bank_related_tests=passed
typescript=passed
admin_build=passed
merchant_migration=passed
admin_login_local_http=$LOCAL_HTTP
admin_login_public_http=$PUBLIC_HTTP
admin_merchant_public_http=$MERCHANT_HTTP
EOF
printf '%s\n' "$RELEASE_ID" >"$SOURCE/.last-successful-deploy"
chmod 0600 "$SOURCE/.last-successful-deploy" "$BACKUP"/* "$RELEASE_ROOT"/*.txt 2>/dev/null || true

trap - ERR
log "deployment_ok release=$RELEASE_ID"
log "old_target=$OLD_TARGET"
log "new_target=$SOURCE"
log "new_dist_sha=$NEW_DIST_SHA"
log "admin_pids_after=$ADMIN_PIDS_AFTER"
log 'front release, dist, and four PM2 PIDs remained unchanged'
