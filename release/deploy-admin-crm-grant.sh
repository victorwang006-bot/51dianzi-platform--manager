#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

EXPECTED_HOSTNAME='iZbp19cboe4cce8vc6sqz7Z'
RELEASE_ID="${RELEASE_ID:?RELEASE_ID is required}"
EXPECTED_SHA="${EXPECTED_SHA:?EXPECTED_SHA is required}"
EXPECTED_SIZE="${EXPECTED_SIZE:?EXPECTED_SIZE is required}"

APP_LINK='/opt/apps/dianzi51-admin'
EXPECTED_OLD_TARGET='/opt/releases/20260805T074538Z-admin-enterprise-rebind-v1/dianzi51-admin'
EXPECTED_OLD_DIST_SHA='d65276f6bef7b1abdea30bc819574e681f01bb25d9b8e0c8acdc7a1d3a54c498'
FRONT_LINK='/opt/apps/dianzi51-platform'
EXPECTED_FRONT_TARGET='/opt/releases/20260805T073538Z-enterprise-ownership-v1/dianzi51-platform'
EXPECTED_FRONT_DIST_SHA='bd9360ddc5954ce6c96d630e9b9db9c983eb54f843586548c2bc83ed3e349701'
EXPECTED_FRONT_PIDS='229137,229138,229163,229164'

PACKAGE="/opt/releases/${RELEASE_ID}.tar.gz"
RELEASE_ROOT="/opt/releases/${RELEASE_ID}"
SOURCE="$RELEASE_ROOT/dianzi51-admin"
BACKUP="/opt/backups/dianzi51-admin/${RELEASE_ID}"
RESULT="$RELEASE_ROOT/deploy-result.txt"
ARCHIVE_LIST="$RELEASE_ROOT/archive-files.txt"
EXPECTED_LIST="$RELEASE_ROOT/expected-files.txt"
NEXT_LINK="/opt/apps/.dianzi51-admin.${RELEASE_ID}.next"

OLD_TARGET=''
DATABASE_URL=''
ACTIVATED=0
TEST_FIXTURES_TOUCHED=0

export PATH="/usr/bin:/usr/local/bin:/usr/sbin:/usr/local/sbin:$PATH"

log() { printf '[admin-crm-grant] %s\n' "$*"; }
fail() { printf '[admin-crm-grant] ERROR: %s\n' "$*" >&2; return 1; }
pm2_pids() { pm2 pid "$1" 2>/dev/null | sed '/^$/d' | sort -n | paste -sd, -; }
sha() { sha256sum "$1" | cut -d ' ' -f1; }

assert_sha() {
  local file="$1"
  local expected="$2"
  [[ -f "$file" ]] || fail "missing baseline file: $file"
  [[ "$(sha "$file")" == "$expected" ]] || fail "baseline file changed: $file"
}

atomic_link() {
  local target="$1"
  rm -f "$NEXT_LINK"
  ln -s "$target" "$NEXT_LINK"
  mv -Tf "$NEXT_LINK" "$APP_LINK"
}

cleanup_test_fixtures() {
  if [[ "$TEST_FIXTURES_TOUCHED" == '1' && -n "$DATABASE_URL" && -f "$SOURCE/release/cleanup-crm-test-fixtures.mjs" ]]; then
    DATABASE_URL="$DATABASE_URL" /usr/bin/node-22 "$SOURCE/release/cleanup-crm-test-fixtures.mjs"
    TEST_FIXTURES_TOUCHED=0
  fi
}

rollback_on_error() {
  local status=$?
  trap - ERR
  set +e
  printf '[admin-crm-grant] FAILURE status=%s; starting guarded cleanup/rollback\n' "$status" >&2
  cleanup_test_fixtures >> "$RESULT" 2>&1
  if [[ "$ACTIVATED" == '1' && -n "$OLD_TARGET" && -d "$OLD_TARGET" ]]; then
    atomic_link "$OLD_TARGET" >> "$RESULT" 2>&1
    pm2 reload dianzi51-admin >> "$RESULT" 2>&1
    sleep 5
  fi
  printf '[admin-crm-grant] guarded cleanup/rollback finished; inspect %s\n' "$RESULT" >&2
  exit "$status"
}

[[ "$(hostname)" == "$EXPECTED_HOSTNAME" ]] || fail 'unexpected hostname'
[[ -L "$APP_LINK" ]] || fail 'admin active path is not a symbolic link'
[[ -L "$FRONT_LINK" ]] || fail 'front active path is not a symbolic link'
OLD_TARGET="$(readlink -f "$APP_LINK")"
[[ "$OLD_TARGET" == "$EXPECTED_OLD_TARGET" ]] || fail "unexpected admin baseline: $OLD_TARGET"
[[ "$(readlink -f "$FRONT_LINK")" == "$EXPECTED_FRONT_TARGET" ]] || fail 'front release changed after freeze'
[[ "$(sha "$OLD_TARGET/dist/index.js")" == "$EXPECTED_OLD_DIST_SHA" ]] || fail 'admin dist baseline changed'
[[ "$(sha "$FRONT_LINK/dist/index.js")" == "$EXPECTED_FRONT_DIST_SHA" ]] || fail 'front dist changed after freeze'
[[ "$(pm2_pids dianzi51)" == "$EXPECTED_FRONT_PIDS" ]] || fail 'front PM2 processes changed after freeze'
[[ -f "$PACKAGE" ]] || fail 'release package missing'
[[ "$(sha "$PACKAGE")" == "$EXPECTED_SHA" ]] || fail 'release package SHA-256 mismatch'
[[ "$(stat -c '%s' "$PACKAGE")" == "$EXPECTED_SIZE" ]] || fail 'release package size mismatch'
[[ ! -e "$RELEASE_ROOT" && ! -e "$BACKUP" ]] || fail 'release or backup path already exists'

mkdir -p "$RELEASE_ROOT" "$BACKUP"
chmod 0700 "$RELEASE_ROOT" "$BACKUP"
exec > >(tee "$RESULT") 2>&1
trap rollback_on_error ERR

tar -tzf "$PACKAGE" | sed '/\/$/d' | LC_ALL=C sort > "$ARCHIVE_LIST"
cat > "$EXPECTED_LIST" <<'EOF'
.gitignore
client/src/pages/Merchants.tsx
drizzle/0017_crm_owner_rebind_logs.sql
drizzle/meta/_journal.json
drizzle/schema.ts
package.json
pnpm-lock.yaml
release/cleanup-crm-test-fixtures.mjs
release/deploy-admin-crm-grant.sh
server/crmGrantPolicy.test.ts
server/crmGrantPolicy.ts
server/crmGrantRouter.test.ts
server/crmRebindPersistenceContract.test.ts
server/db.ts
server/platformCrmApi.ts
server/routers.ts
EOF
LC_ALL=C sort -o "$EXPECTED_LIST" "$EXPECTED_LIST"
diff -u "$EXPECTED_LIST" "$ARCHIVE_LIST" || fail 'archive file list is not exact'
grep -Eq '(^/|(^|/)\.\.(/|$))' "$ARCHIVE_LIST" && fail 'unsafe archive path'
grep -Eq '(^|/)(\.env[^/]*|node_modules|dist|uploads|\.git|\.manus-logs)(/|$)|\.(pem|key|log|sqlite|db)$' "$ARCHIVE_LIST" \
  && fail 'sensitive, database, or runtime path found in archive'

assert_sha "$OLD_TARGET/.gitignore" 'b4572613f7e7b7827f8dd1c7543b03f903082ba146ebe8115dd9bd81aebd4bee'
assert_sha "$OLD_TARGET/client/src/pages/Merchants.tsx" '494386c12b125003bb8dd5be66891dffe9ad2f4bfc66925be10ba98f42ce1858'
assert_sha "$OLD_TARGET/drizzle/0017_crm_owner_rebind_logs.sql" '5f4ac8984aeb43132a2f64a0a547b8a74322a883eeccd66b485e611211956a6d'
assert_sha "$OLD_TARGET/drizzle/meta/_journal.json" '10ba44163a1054b8d620c142d893543fda34b9ce118b5d2ebd1e538138b02d31'
assert_sha "$OLD_TARGET/drizzle/schema.ts" '88a96dddc36de0a1860e2c5fee9c9618b4c8f1dabaa4f6cf69b4b3baafae481a'
assert_sha "$OLD_TARGET/package.json" '031764b06bc7f86412015c7dc3425f6956d69cb6b5f106e7e947ef349ed9689d'
assert_sha "$OLD_TARGET/pnpm-lock.yaml" '03bcc99fe46a361fb3d226f0ada2d1584d7d62804042785688e1a94d985b0d91'
assert_sha "$OLD_TARGET/release/cleanup-crm-test-fixtures.mjs" 'a591b8aeaf170246509960cd754b5a3038dc7c13c0bab0055bd04f6525b724cb'
assert_sha "$OLD_TARGET/release/deploy-admin-crm-grant.sh" 'f0c2acb8e28d92f9528d169151e041f230fa79dbcebf1dddb6c70e483f188465'
assert_sha "$OLD_TARGET/server/crmGrantPolicy.test.ts" '940eaaeedbdb9d086c3b8de6ee0f285f6179c13f6afe50e2755c02f6133527e2'
assert_sha "$OLD_TARGET/server/crmGrantPolicy.ts" 'f4817068cb928c4c94d1c3314e62c5e4d17fac633fa9842c626c0b2955ff1606'
assert_sha "$OLD_TARGET/server/crmGrantRouter.test.ts" '2d9a533f37fb28e510af5464d5853d553b92792a5fd3b516ae127db595c32355'
assert_sha "$OLD_TARGET/server/crmRebindPersistenceContract.test.ts" '6e70fb628c94a22215c743cec8544b13cc1a8338f1fca7885f7effb5caa043e1'
assert_sha "$OLD_TARGET/server/db.ts" 'b567d78f8cc4ccedc455d724dea18ec7936717da911bdb886e6f9f399416e547'
assert_sha "$OLD_TARGET/server/platformCrmApi.ts" '1a3db92907e804e87ab6397b61a1d9a02da90fe8773324acec428ea02e67046f'
assert_sha "$OLD_TARGET/server/routers.ts" 'b04279a263a667bad1ca59881b371f162ec1cd3ef807c846c70048178a7aac58'
[[ "$(tar -xOzf "$PACKAGE" package.json | sha256sum | cut -d ' ' -f1)" == "$(sha "$OLD_TARGET/package.json")" ]] \
  || fail 'package.json differs from active application'
[[ "$(tar -xOzf "$PACKAGE" pnpm-lock.yaml | sha256sum | cut -d ' ' -f1)" == "$(sha "$OLD_TARGET/pnpm-lock.yaml")" ]] \
  || fail 'pnpm-lock.yaml differs from active application'

log 'backing up current changed source and dist on ECS'
cat > "$BACKUP/existing-source-files.txt" <<'EOF'
.gitignore
client/src/pages/Merchants.tsx
drizzle/0017_crm_owner_rebind_logs.sql
drizzle/meta/_journal.json
drizzle/schema.ts
release/cleanup-crm-test-fixtures.mjs
release/deploy-admin-crm-grant.sh
server/crmGrantPolicy.test.ts
server/crmGrantPolicy.ts
server/crmGrantRouter.test.ts
server/crmRebindPersistenceContract.test.ts
server/db.ts
server/platformCrmApi.ts
server/routers.ts
package.json
pnpm-lock.yaml
EOF
tar -czf "$BACKUP/source-before.tar.gz" -C "$OLD_TARGET" -T "$BACKUP/existing-source-files.txt"
cp -a "$OLD_TARGET/dist" "$BACKUP/dist-before"
printf 'old_target=%s\nold_dist_sha=%s\nfront_target=%s\nfront_dist_sha=%s\nfront_pids=%s\n' \
  "$OLD_TARGET" "$EXPECTED_OLD_DIST_SHA" "$EXPECTED_FRONT_TARGET" "$EXPECTED_FRONT_DIST_SHA" "$EXPECTED_FRONT_PIDS" \
  > "$BACKUP/baseline.txt"
sha256sum "$BACKUP/source-before.tar.gz" "$BACKUP/dist-before/index.js" > "$BACKUP/backup-sha256.txt"

log 'creating isolated release from allowlisted current source'
mkdir -p "$SOURCE"
for path in client drizzle patches scripts server shared deploy docs; do
  [[ -e "$OLD_TARGET/$path" ]] && cp -a "$OLD_TARGET/$path" "$SOURCE/"
done
for path in .gitignore .gitkeep .prettierignore .prettierrc components.json drizzle.config.ts package.json pnpm-lock.yaml pnpm-workspace.yaml template.json tsconfig.json vite.config.ts vitest.config.ts; do
  [[ -e "$OLD_TARGET/$path" ]] && cp -a "$OLD_TARGET/$path" "$SOURCE/"
done
install -m 0600 "$OLD_TARGET/ecosystem.config.cjs" "$SOURCE/ecosystem.config.cjs"
[[ "$(stat -c '%a' "$SOURCE/ecosystem.config.cjs")" == '600' ]] || fail 'runtime process config mode changed'
cmp -s "$OLD_TARGET/ecosystem.config.cjs" "$SOURCE/ecosystem.config.cjs" \
  || fail 'runtime process config changed during release preparation'
if [[ -L "$OLD_TARGET/uploads" ]]; then
  ln -s "$(readlink "$OLD_TARGET/uploads")" "$SOURCE/uploads"
fi
tar -xzf "$PACKAGE" -C "$SOURCE"
chmod 0700 "$SOURCE/release"
chmod 0600 "$SOURCE/release/"*

log 'installing locked dependencies in isolated release'
cd "$SOURCE"
pnpm install --frozen-lockfile

ADMIN_PM2_ID="$(pm2 describe dianzi51-admin \
  | sed -n 's/^ Describing process with id \([0-9][0-9]*\).*/\1/p' \
  | head -n 1)"
[[ "$ADMIN_PM2_ID" =~ ^[0-9]+$ ]] || fail 'cannot locate admin PM2 id'
DATABASE_URL="$(pm2 env "$ADMIN_PM2_ID" | sed -n 's/^DATABASE_URL: //p' | head -n 1)"
[[ -n "$DATABASE_URL" ]] || fail 'DATABASE_URL unavailable from active PM2 environment'

log 'verifying CRM test fixture namespace is empty before tests'
CHECK_ONLY=1 DATABASE_URL="$DATABASE_URL" /usr/bin/node-22 "$SOURCE/release/cleanup-crm-test-fixtures.mjs"

log 'running CRM policy/router/rebind regression'
pnpm exec vitest run server/crmGrantPolicy.test.ts server/crmGrantRouter.test.ts server/crmRebindPersistenceContract.test.ts \
  --pool=forks --maxWorkers=1 --minWorkers=1 --reporter=verbose

log 'running CRM database integration regression against production schema'
TEST_FIXTURES_TOUCHED=1
DATABASE_URL="$DATABASE_URL" PORTAL_API_KEY='crm-release-test-key' \
  JWT_SECRET='crm-release-test-only-secret' OAUTH_SERVER_URL='https://oauth.example.invalid' \
  VITE_APP_ID='crm-release-test-app' \
  pnpm exec vitest run server/crmActions.test.ts server/crmAndProfile.test.ts server/crmCompanyBinding.test.ts \
  --pool=forks --maxWorkers=1 --minWorkers=1 --reporter=verbose --testTimeout=30000 --hookTimeout=30000
cleanup_test_fixtures
CHECK_ONLY=1 DATABASE_URL="$DATABASE_URL" /usr/bin/node-22 "$SOURCE/release/cleanup-crm-test-fixtures.mjs"

log 'running TypeScript, production build, and /admin/ build verification'
pnpm check
pnpm build:admin
pnpm verify:admin-build
[[ -f "$SOURCE/dist/index.js" && -f "$SOURCE/dist/public/index.html" ]] || fail 'staged build incomplete'
for marker in rebindCrmOwner validatePlatformCrmRebindTarget rebindMerchantCrmOwner crm_owner_rebind_logs expectedExistingOwner isEquivalentEnabledBinding decideMerchantCrmGrant; do
  grep -Fq "$marker" "$SOURCE/dist/index.js" || fail "binding protection marker missing from server bundle: $marker"
done
grep -RFlq '尚未绑定前台用户' "$SOURCE/dist/public" || fail 'abnormal owner warning missing from admin bundle'
NEW_DIST_SHA="$(sha "$SOURCE/dist/index.js")"

log 'rechecking frozen front-end and admin baseline before cutover'
[[ "$(readlink -f "$APP_LINK")" == "$OLD_TARGET" ]] || fail 'admin release changed during build'
[[ "$(readlink -f "$FRONT_LINK")" == "$EXPECTED_FRONT_TARGET" ]] || fail 'front release changed during build'
[[ "$(sha "$FRONT_LINK/dist/index.js")" == "$EXPECTED_FRONT_DIST_SHA" ]] || fail 'front dist changed during build'
[[ "$(pm2_pids dianzi51)" == "$EXPECTED_FRONT_PIDS" ]] || fail 'front PM2 processes changed during build'
nginx -t

log 'atomically switching admin release and reloading only dianzi51-admin'
atomic_link "$SOURCE"
ACTIVATED=1
pm2 reload dianzi51-admin
sleep 6
[[ "$(readlink -f "$APP_LINK")" == "$SOURCE" ]] || fail 'admin symlink did not activate new release'
[[ "$(sha "$APP_LINK/dist/index.js")" == "$NEW_DIST_SHA" ]] || fail 'active admin dist hash mismatch'
[[ "$(pm2_pids dianzi51-admin | tr ',' '\n' | sed '/^$/d' | wc -l | tr -d ' ')" == '2' ]] \
  || fail 'admin PM2 instance count is not two'
[[ "$(readlink -f "$FRONT_LINK")" == "$EXPECTED_FRONT_TARGET" ]] || fail 'front release changed after admin reload'
[[ "$(sha "$FRONT_LINK/dist/index.js")" == "$EXPECTED_FRONT_DIST_SHA" ]] || fail 'front dist changed after admin reload'
[[ "$(pm2_pids dianzi51)" == "$EXPECTED_FRONT_PIDS" ]] || fail 'front PM2 processes changed after admin reload'

LOCAL_HTTP="$(curl -sS --max-time 20 -o "$BACKUP/local-admin-login.html" -w '%{http_code}' http://127.0.0.1:3001/admin/login)"
PUBLIC_HTTP="$(curl -sS --max-time 20 -o "$BACKUP/public-admin-login.html" -w '%{http_code}' https://51dianzi.com/admin/login)"
[[ "$LOCAL_HTTP" == '200' && "$PUBLIC_HTTP" == '200' ]] || fail 'admin login health check failed'
grep -Fq '<div id="root"></div>' "$BACKUP/public-admin-login.html" || fail 'public admin shell missing'

ADMIN_PM2_ID="$(pm2 describe dianzi51-admin \
  | sed -n 's/^ Describing process with id \([0-9][0-9]*\).*/\1/p' \
  | head -n 1)"
[[ "$ADMIN_PM2_ID" =~ ^[0-9]+$ ]] || fail 'cannot locate reloaded admin PM2 id'
PORTAL_API_KEY="$(pm2 env "$ADMIN_PM2_ID" | sed -n 's/^PORTAL_API_KEY: //p' | head -n 1)"
[[ -n "$PORTAL_API_KEY" ]] || fail 'PORTAL_API_KEY unavailable after reload'
API_URL='https://51dianzi.com/admin/api/trpc/portal.getCrmAccess'
API_INPUT='{"json":{"creditCode":"91440300MAKJT4Q80C","portalUserId":"390005"}}'
API_HTTP="$(curl -sS --max-time 20 -o "$BACKUP/crm-access-before-reset.json" -w '%{http_code}' \
  -H "x-portal-key: $PORTAL_API_KEY" --get --data-urlencode "input=$API_INPUT" "$API_URL")"
[[ "$API_HTTP" == '200' ]] || fail 'CRM access endpoint health check failed'
grep -Fq 'CRM_BINDING_REQUIRED' "$BACKUP/crm-access-before-reset.json" \
  || fail 'legacy enabled-without-owner state no longer reports binding required before reset'

ADMIN_PIDS_AFTER="$(pm2_pids dianzi51-admin)"
cat > "$BACKUP/deployment-summary.txt" <<EOF
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
crm_policy_router_rebind_tests=passed
crm_database_regression=passed
typescript=passed
admin_build=passed
admin_login_local_http=$LOCAL_HTTP
admin_login_public_http=$PUBLIC_HTTP
legacy_binding_guard=CRM_BINDING_REQUIRED
EOF
printf '%s\n' "$RELEASE_ID" > "$SOURCE/.last-successful-deploy"
chmod 0600 "$SOURCE/.last-successful-deploy" "$BACKUP"/* "$RELEASE_ROOT"/*.txt 2>/dev/null || true

trap - ERR
log "deployment_ok release=$RELEASE_ID"
log "old_target=$OLD_TARGET"
log "new_target=$SOURCE"
log "new_dist_sha=$NEW_DIST_SHA"
log "admin_pids_after=$ADMIN_PIDS_AFTER"
log 'front release, dist, and four PM2 PIDs remained unchanged'
