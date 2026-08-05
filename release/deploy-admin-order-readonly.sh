#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

EXPECTED_HOSTNAME='iZbp19cboe4cce8vc6sqz7Z'
RELEASE_ID="${RELEASE_ID:?RELEASE_ID is required}"
EXPECTED_SHA="${EXPECTED_SHA:?EXPECTED_SHA is required}"
EXPECTED_SIZE="${EXPECTED_SIZE:?EXPECTED_SIZE is required}"

APP_LINK='/opt/apps/dianzi51-admin'
EXPECTED_OLD_TARGET='/opt/releases/20260805T090253Z-admin-crm-secret-free-v2/dianzi51-admin'
EXPECTED_OLD_DIST_SHA='d65276f6bef7b1abdea30bc819574e681f01bb25d9b8e0c8acdc7a1d3a54c498'
EXPECTED_OLD_PIDS='234797,234810'
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
PORTAL_API_KEY=''
PLATFORM_API_BASE=''

export PATH="/usr/bin:/usr/local/bin:/usr/sbin:/usr/local/sbin:$PATH"

log() { printf '[admin-order-readonly] %s\n' "$*"; }
fail() { printf '[admin-order-readonly] ERROR: %s\n' "$*" >&2; return 1; }
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
  printf '[admin-order-readonly] FAILURE status=%s; starting atomic rollback\n' "$status" >&2
  if [[ "$ACTIVATED" == '1' && -n "$OLD_TARGET" && -d "$OLD_TARGET" ]]; then
    atomic_link "$OLD_TARGET" >>"$RESULT" 2>&1
    pm2 reload dianzi51-admin >>"$RESULT" 2>&1
    nginx -t >>"$RESULT" 2>&1 && nginx -s reload >>"$RESULT" 2>&1
    sleep 5
  fi
  printf '[admin-order-readonly] rollback finished; inspect %s\n' "$RESULT" >&2
  exit "$status"
}

smoke_order_proxy() {
  PORTAL_API_KEY="$PORTAL_API_KEY" PLATFORM_API_BASE="$PLATFORM_API_BASE" \
    node --import tsx --input-type=module - <<'NODE'
import { listPlatformOrders } from "./server/platformOrderApi.ts";
const result = await listPlatformOrders({ page: 1, pageSize: 1 });
if (!result || typeof result.total !== "number" || !Array.isArray(result.rows)) process.exit(2);
if (result.rows[0]) {
  for (const key of ["id", "orderNo", "buyerId", "sellerId", "status", "totalAmount", "createdAt"]) {
    if (!(key in result.rows[0])) process.exit(3);
  }
}
console.log(`order_proxy_smoke=passed rows=${result.rows.length}`);
NODE
}

[[ "$(hostname)" == "$EXPECTED_HOSTNAME" ]] || fail 'unexpected hostname'
[[ -L "$APP_LINK" && -L "$FRONT_LINK" ]] || fail 'active application path is not a symbolic link'
OLD_TARGET="$(readlink -f "$APP_LINK")"
[[ "$OLD_TARGET" == "$EXPECTED_OLD_TARGET" ]] || fail "unexpected admin baseline: $OLD_TARGET"
[[ "$(sha "$OLD_TARGET/dist/index.js")" == "$EXPECTED_OLD_DIST_SHA" ]] || fail 'admin dist baseline changed'
[[ "$(pm2_pids dianzi51-admin)" == "$EXPECTED_OLD_PIDS" ]] || fail 'admin PM2 processes changed before release'
[[ "$(readlink -f "$FRONT_LINK")" == "$EXPECTED_FRONT_TARGET" ]] || fail 'front release changed after freeze'
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

tar -tzf "$PACKAGE" | sed '/\/$/d' | LC_ALL=C sort >"$ARCHIVE_LIST"
cat >"$EXPECTED_LIST" <<'EOF'
client/src/pages/Orders.tsx
package.json
pnpm-lock.yaml
release/deploy-admin-order-readonly.sh
server/adminPermissions.test.ts
server/orderProxy.test.ts
server/orderReadOnlyContract.test.ts
server/platformOrderApi.ts
server/routers.ts
shared/adminPermissions.ts
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

log 'backing up changed source and current dist'
cat >"$BACKUP/existing-source-files.txt" <<'EOF'
client/src/pages/Orders.tsx
server/adminPermissions.test.ts
server/orderProxy.test.ts
server/platformOrderApi.ts
server/routers.ts
shared/adminPermissions.ts
package.json
pnpm-lock.yaml
EOF
tar -czf "$BACKUP/source-before.tar.gz" -C "$OLD_TARGET" -T "$BACKUP/existing-source-files.txt"
cp -a "$OLD_TARGET/dist" "$BACKUP/dist-before"
printf 'old_target=%s\nold_dist_sha=%s\nfront_target=%s\nfront_dist_sha=%s\nfront_pids=%s\n' \
  "$OLD_TARGET" "$EXPECTED_OLD_DIST_SHA" "$EXPECTED_FRONT_TARGET" "$EXPECTED_FRONT_DIST_SHA" "$EXPECTED_FRONT_PIDS" \
  >"$BACKUP/baseline.txt"
sha256sum "$BACKUP/source-before.tar.gz" "$BACKUP/dist-before/index.js" >"$BACKUP/backup-sha256.txt"

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

log 'installing locked dependencies and running order-only release gates'
cd "$SOURCE"
pnpm install --frozen-lockfile
pnpm exec vitest run server/orderProxy.test.ts server/adminPermissions.test.ts server/orderReadOnlyContract.test.ts \
  --pool=forks --maxWorkers=1 --minWorkers=1 --reporter=verbose
pnpm check
pnpm build:admin
pnpm verify:admin-build
[[ -f dist/index.js && -f dist/public/index.html ]] || fail 'staged build incomplete'
grep -Fq 'procedure: "list" | "detail"' server/platformOrderApi.ts \
  || fail 'order proxy source is not limited to list/detail queries'
grep -Fq 'list: orderReadProcedure' server/routers.ts || fail 'order list read route missing from source'
grep -Fq 'detail: orderReadProcedure' server/routers.ts || fail 'order detail read route missing from source'
grep -Fq '"orders.read"' shared/adminPermissions.ts || fail 'order read permission missing from source'
grep -Fq '只读访问商城唯一订单事实源' dist/public/index.html || grep -RFlq '只读访问商城唯一订单事实源' dist/public \
  || fail 'read-only order page marker missing from admin bundle'
if grep -Fq 'transitionPlatformOrder' server/platformOrderApi.ts \
  || grep -Fq 'transition: orderWriteProcedure' server/routers.ts \
  || grep -Fq '"orders.write"' shared/adminPermissions.ts \
  || grep -RFlq '履约操作' dist/public; then
  fail 'order write capability remains in source contract or production UI bundle'
fi

ADMIN_PM2_ID="$(pm2 describe dianzi51-admin | sed -n 's/^ Describing process with id \([0-9][0-9]*\).*/\1/p' | head -n 1)"
[[ "$ADMIN_PM2_ID" =~ ^[0-9]+$ ]] || fail 'cannot locate admin PM2 id'
PORTAL_API_KEY="$(pm2 env "$ADMIN_PM2_ID" | sed -n 's/^PORTAL_API_KEY: //p' | head -n 1)"
PLATFORM_API_BASE="$(pm2 env "$ADMIN_PM2_ID" | sed -n 's/^PLATFORM_API_BASE: //p' | head -n 1)"
PLATFORM_API_BASE="${PLATFORM_API_BASE:-http://127.0.0.1:3000}"
[[ -n "$PORTAL_API_KEY" ]] || fail 'PORTAL_API_KEY unavailable from active PM2 environment'
smoke_order_proxy
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
[[ "$(pm2_pids dianzi51-admin | tr ',' '\n' | sed '/^$/d' | wc -l | tr -d ' ')" == '2' ]] \
  || fail 'admin PM2 instance count is not two'
[[ "$(readlink -f "$FRONT_LINK")" == "$EXPECTED_FRONT_TARGET" ]] || fail 'front release changed after admin reload'
[[ "$(sha "$FRONT_LINK/dist/index.js")" == "$EXPECTED_FRONT_DIST_SHA" ]] || fail 'front dist changed after admin reload'
[[ "$(pm2_pids dianzi51)" == "$EXPECTED_FRONT_PIDS" ]] || fail 'front PM2 processes changed after admin reload'

LOCAL_HTTP="$(curl -sS --max-time 20 -o "$BACKUP/local-admin-login.html" -w '%{http_code}' http://127.0.0.1:3001/admin/login)"
PUBLIC_HTTP="$(curl -sS --max-time 20 -o "$BACKUP/public-admin-login.html" -w '%{http_code}' https://51dianzi.com/admin/login)"
[[ "$LOCAL_HTTP" == '200' && "$PUBLIC_HTTP" == '200' ]] || fail 'admin login health check failed'
grep -Fq '<div id="root"></div>' "$BACKUP/public-admin-login.html" || fail 'public admin shell missing'
smoke_order_proxy
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
order_related_tests=passed
typescript=passed
admin_build=passed
order_proxy_smoke=passed
admin_login_local_http=$LOCAL_HTTP
admin_login_public_http=$PUBLIC_HTTP
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
