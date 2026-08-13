#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SOURCE_ROOT="${SOURCE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DEPLOY_HOST="${DEPLOY_HOST:-47.97.108.147}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_SSH_KEY="${DEPLOY_SSH_KEY:?Set DEPLOY_SSH_KEY to the authorized private-key file}"
DEPLOY_RELEASE_ID="${DEPLOY_RELEASE_ID:-$(date -u +%Y%m%dT%H%M%SZ)-admin-sales-permissions}"
EXPECTED_HOST_KEY_SHA256="${EXPECTED_HOST_KEY_SHA256:-SHA256:XumyySq4LpO8THovTnJu3+4aeqR+tIefVU8TUdJR7Pw}"
DEPLOY_KNOWN_HOSTS_FILE="${DEPLOY_KNOWN_HOSTS_FILE:-}"
DEPLOY_LOCAL_VERIFY="${DEPLOY_LOCAL_VERIFY:-1}"

[[ "$DEPLOY_HOST" != "8.154.34.152" ]] || { echo "Refusing obsolete ECS host" >&2; exit 2; }
[[ "$DEPLOY_RELEASE_ID" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Invalid release id" >&2; exit 2; }
[[ -r "$DEPLOY_SSH_KEY" ]] || { echo "SSH key is not readable" >&2; exit 2; }

for command_name in ssh scp ssh-keyscan ssh-keygen tar sha256sum; do
  command -v "$command_name" >/dev/null || { echo "Missing command: $command_name" >&2; exit 2; }
done

if command -v pnpm >/dev/null 2>&1; then
  pnpm_command=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  pnpm_command=(corepack pnpm)
else
  echo "Neither pnpm nor corepack is available" >&2
  exit 2
fi

stage="$(mktemp -d)"
archive="$(mktemp --suffix=.tar.gz)"
known_hosts="$(mktemp)"
cleanup() { rm -rf "$stage"; rm -f "$archive" "$known_hosts"; }
trap cleanup EXIT

if [[ "$DEPLOY_LOCAL_VERIFY" == "1" ]]; then
  (
    cd "$SOURCE_ROOT"
    "${pnpm_command[@]}" exec vitest run \
      server/salesPermissionContract.test.ts \
      server/adminPermissions.test.ts \
      server/adminUser.test.ts \
      server/orderProxy.test.ts \
      server/salesScopeAuthorization.test.ts \
      server/platformMaterial.test.ts \
      server/frontendUserManagement.test.ts \
      server/orderReadOnlyContract.test.ts
    "${pnpm_command[@]}" check
  )
fi

mkdir -p "$stage/service" "$stage/subdomain/dist"
(
  cd "$SOURCE_ROOT"
  "${pnpm_command[@]}" build:admin
  "${pnpm_command[@]}" verify:admin-build
  cp -a dist "$stage/service/dist"
  "${pnpm_command[@]}" build:subdomain
  "${pnpm_command[@]}" verify:subdomain-build
  cp -a dist/public "$stage/subdomain/dist/public"
)
cp "$SOURCE_ROOT/package.json" "$SOURCE_ROOT/pnpm-lock.yaml" "$stage/service/"
if [[ -f "$SOURCE_ROOT/pnpm-workspace.yaml" ]]; then
  cp "$SOURCE_ROOT/pnpm-workspace.yaml" "$stage/service/"
fi
if [[ -d "$SOURCE_ROOT/patches" ]]; then
  cp -a "$SOURCE_ROOT/patches" "$stage/service/patches"
fi
mkdir -p "$stage/service/scripts"
cp "$SOURCE_ROOT/scripts/apply-sales-permissions-schema.mjs" "$stage/service/scripts/"
chmod -R a+rX "$stage"
[[ -f "$stage/service/dist/index.js" ]]
[[ -f "$stage/service/dist/public/index.html" ]]
[[ -f "$stage/subdomain/dist/public/index.html" ]]
[[ ! -e "$stage/service/.env" && ! -e "$stage/subdomain/.env" ]]

tar -C "$stage" -czf "$archive" service subdomain
archive_sha256="$(sha256sum "$archive" | awk '{print $1}')"

if [[ -n "$DEPLOY_KNOWN_HOSTS_FILE" ]]; then
  cp "$DEPLOY_KNOWN_HOSTS_FILE" "$known_hosts"
else
  ssh-keyscan -p "$DEPLOY_PORT" -T 5 -t ed25519 "$DEPLOY_HOST" >"$known_hosts" 2>/dev/null
fi
[[ -s "$known_hosts" ]]
actual_fingerprint="$(ssh-keygen -lf "$known_hosts" | awk 'NR==1 {print $2}')"
[[ "$actual_fingerprint" == "$EXPECTED_HOST_KEY_SHA256" ]] || {
  echo "ECS host-key mismatch" >&2
  exit 3
}

ssh_options=(-i "$DEPLOY_SSH_KEY" -p "$DEPLOY_PORT" -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$known_hosts")
scp_options=(-i "$DEPLOY_SSH_KEY" -P "$DEPLOY_PORT" -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$known_hosts")
remote_archive="/tmp/${DEPLOY_RELEASE_ID}.tar.gz"
scp "${scp_options[@]}" "$archive" "$DEPLOY_USER@$DEPLOY_HOST:$remote_archive"

ssh "${ssh_options[@]}" "$DEPLOY_USER@$DEPLOY_HOST" bash -s -- \
  "$remote_archive" "$archive_sha256" "$DEPLOY_RELEASE_ID" <<'REMOTE'
set -Eeuo pipefail
umask 077

remote_archive="$1"
archive_sha256="$2"
release_id="$3"
service_link='/opt/apps/dianzi51-admin'
static_link='/opt/apps/dianzi51-admin-subdomain'
release_root="/opt/releases/$release_id"
service_release="$release_root/dianzi51-admin"
static_release="$release_root/dianzi51-admin-subdomain"
backup_root="/opt/backups/dianzi51-admin/${release_id}-pre-sales-permissions"
result_file="$release_root/deploy-result.txt"
next_service="/opt/apps/.dianzi51-admin.${release_id}.next"
next_static="/opt/apps/.dianzi51-admin-subdomain.${release_id}.next"
service_switched=0
static_switched=0
old_service=''
old_static=''

log() { printf '[admin-sales-permissions] %s\n' "$*"; }
sha() { sha256sum "$1" | awk '{print $1}'; }

rollback() {
  status="${1:-1}"
  failed_line="${2:-unknown}"
  failed_command="${3:-unknown}"
  trap - ERR
  set +e
  log "failure status=$status line=$failed_line command=$failed_command; restoring both admin links"
  if [[ "$service_switched" == '1' && -d "$old_service" ]]; then
    rm -f "$next_service"
    ln -s "$old_service" "$next_service"
    mv -Tf "$next_service" "$service_link"
  fi
  if [[ "$static_switched" == '1' && -d "$old_static" ]]; then
    rm -f "$next_static"
    ln -s "$old_static" "$next_static"
    mv -Tf "$next_static" "$static_link"
  fi
  if [[ "$service_switched" == '1' && -f "$old_service/ecosystem.config.cjs" ]]; then
    pm2 reload "$old_service/ecosystem.config.cjs" --only dianzi51-admin --update-env || true
  fi
  nginx -t && nginx -s reload || true
  rm -rf "$release_root"
  rm -f "$remote_archive"
  exit "$status"
}
trap 'rollback "$?" "$LINENO" "$BASH_COMMAND"' ERR

[[ "$(hostname)" == 'iZbp19cboe4cce8vc6sqz7Z' ]]
[[ -L "$service_link" && -L "$static_link" ]]
old_service="$(readlink -f "$service_link")"
old_static="$(readlink -f "$static_link")"
[[ "$old_service" == /opt/releases/* && "$old_static" == /opt/releases/* ]]
[[ -f "$old_service/dist/index.js" && -f "$old_static/dist/public/index.html" ]]
[[ ! -e "$release_root" && ! -e "$backup_root" ]]
[[ "$(sha "$remote_archive")" == "$archive_sha256" ]]

mkdir -p "$release_root" "$backup_root"
chmod 0700 "$release_root" "$backup_root"
exec > >(tee "$result_file") 2>&1

cat >"$backup_root/baseline.txt" <<EOF
release_id=$release_id
old_service=$old_service
old_static=$old_static
old_service_sha256=$(sha "$old_service/dist/index.js")
old_static_sha256=$(sha "$old_static/dist/public/index.html")
pm2_pids=$(pm2 pid dianzi51-admin 2>/dev/null | sed '/^$/d' | sort -n | paste -sd, -)
EOF
pm2 jlist >"$backup_root/pm2-jlist.json"
nginx -T >"$backup_root/nginx-full.txt" 2>&1

tar -xzf "$remote_archive" -C "$release_root"
mv "$release_root/service" "$service_release"
mv "$release_root/subdomain" "$static_release"
rm -f "$remote_archive"
# /opt/releases 下的新目录必须允许 nginx 用户穿越；敏感 ecosystem 文件随后单独收紧为 0600。
chmod 0755 "$release_root" "$service_release" "$static_release"
chmod -R a+rX "$service_release/dist" "$static_release/dist"
cp -p "$old_service/ecosystem.config.cjs" "$service_release/ecosystem.config.cjs"
chmod 0600 "$service_release/ecosystem.config.cjs"
if [[ -L "$old_service/uploads" ]]; then
  ln -s "$(readlink "$old_service/uploads")" "$service_release/uploads"
elif [[ -d "$old_service/uploads" ]]; then
  ln -s "$old_service/uploads" "$service_release/uploads"
fi

cd "$service_release"
if command -v corepack >/dev/null 2>&1; then pnpm_command=(corepack pnpm); else pnpm_command=(pnpm); fi
NODE_ENV=production "${pnpm_command[@]}" install --prod --frozen-lockfile
node scripts/apply-sales-permissions-schema.mjs --from-ecosystem-config "$service_release/ecosystem.config.cjs"

log 'validating service and static release artifacts'
[[ -f "$service_release/dist/index.js" ]]
[[ -f "$service_release/dist/public/index.html" ]]
[[ -f "$static_release/dist/public/index.html" ]]
grep -Eq 'src="/admin/assets/index-[^"]+\.js"' "$service_release/dist/public/index.html"
grep -Eq 'src="/assets/index-[^"]+\.js"' "$static_release/dist/public/index.html"
runuser -u nginx -- test -r "$static_release/dist/public/index.html"
runuser -u nginx -- test -r "$service_release/dist/public/index.html"
nginx -t

rm -f "$next_service" "$next_static"
ln -s "$service_release" "$next_service"
ln -s "$static_release" "$next_static"
mv -Tf "$next_service" "$service_link"
service_switched=1
mv -Tf "$next_static" "$static_link"
static_switched=1

pm2 reload "$service_release/ecosystem.config.cjs" --only dianzi51-admin --update-env
sleep 6
nginx -t
nginx -s reload

[[ "$(readlink -f "$service_link")" == "$service_release" ]]
[[ "$(readlink -f "$static_link")" == "$static_release" ]]
[[ "$(pm2 pid dianzi51-admin 2>/dev/null | sed '/^$/d' | wc -l | tr -d ' ')" == '2' ]]
local_status="$(curl -sS --max-time 20 -o "$backup_root/local-login.html" -w '%{http_code}' http://127.0.0.1:3001/admin/login)"
public_path_status="$(curl -sS --max-time 20 -o "$backup_root/public-path-login.html" -w '%{http_code}' https://51dianzi.com/admin/login)"
public_subdomain_status="$(curl -sS --max-time 20 -o "$backup_root/public-subdomain-login.html" -w '%{http_code}' https://admin.51dianzi.com/login)"
[[ "$local_status" == '200' && "$public_path_status" == '200' && "$public_subdomain_status" == '200' ]]

admin_pm2_id="$(pm2 describe dianzi51-admin | sed -n 's/^ Describing process with id \([0-9][0-9]*\).*/\1/p' | head -1)"
portal_key="$(pm2 env "$admin_pm2_id" | sed -n 's/^PORTAL_API_KEY: //p' | head -1)"
[[ -n "$portal_key" ]]
staff_status="$(curl -sS --max-time 20 -o "$backup_root/sales-staff.json" -w '%{http_code}' \
  -H "x-portal-key: $portal_key" \
  'http://127.0.0.1:3001/api/trpc/portal.listSalesStaff?input=%7B%22json%22%3Anull%7D')"
[[ "$staff_status" == '200' ]]
for name in Victor Ocean Bella Doomi Mark Jean; do grep -Fq "$name" "$backup_root/sales-staff.json"; done

cat >>"$backup_root/deployment-summary.txt" <<EOF
new_service=$service_release
new_static=$static_release
local_login_http=$local_status
public_path_login_http=$public_path_status
public_subdomain_login_http=$public_subdomain_status
sales_staff_api_http=$staff_status
EOF
printf '%s\n' "$release_id" >"$service_release/.last-successful-deploy"
pm2 save
trap - ERR
log "deployment_ok release=$release_id"
log "old_service=$old_service"
log "old_static=$old_static"
log "new_service=$service_release"
log "new_static=$static_release"
REMOTE
