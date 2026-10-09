#!/usr/bin/env bash
# Activate the staged admin agency-certification release with a rolling reload of dianzi51-admin only.
set -Eeuo pipefail
umask 077

: "${COMMIT_SHA:?}" "${RELEASE_ID:?}" "${BACKEND_SHA:?}" "${ADMIN_ANON_401_PATH:?}"
[[ "$COMMIT_SHA" =~ ^[a-f0-9]{40}$ && "$BACKEND_SHA" =~ ^[a-f0-9]{64}$ ]]
[[ "$RELEASE_ID" =~ ^20[0-9]{6}T[0-9]{6}Z-agency-certification$ ]]
# Use a valid synthetic identifier; anonymous merchant scope rejects before any database read.  Its body is discarded and cannot contain merchant data.
[[ "$ADMIN_ANON_401_PATH" == '/api/trpc/merchant.agencyCertifications?input=%7B%22json%22%3A%7B%22merchantId%22%3A990001%7D%7D' ]]

old=/opt/apps/releases/dianzi51-admin-20261009T040650Z-analytics-copy
new="/opt/apps/releases/dianzi51-admin-${RELEASE_ID}"
link=/opt/apps/dianzi51-admin
sublink=/opt/apps/dianzi51-admin-subdomain
app=dianzi51-admin
old_backend_sha=c90486ee1dfc7049e3efcfcb2a47e0b66eabc35dde842084a57441001c78f955
old_index_sha=86babb216f3c43b69ca7a149a9d44a63e7096318ab5d498dca6d443b6b2a34a9
old_tree_sha=42ff4db5b3c1e9dfe3d4ed51988d634f024f9ee8a5b8215ab5df9a185177c985
uploads_target=/opt/shared/dianzi51-admin/uploads

exec 9>/var/lock/dianzi51-admin-deploy.lock
flock -n 9 || { echo 'another_admin_deploy_active' >&2; exit 4; }
get_sha(){ sha256sum "$1" | cut -d' ' -f1; }
field(){ node -p 'require(process.argv[1])[process.argv[2]]' "$new/RELEASE_METADATA.json" "$1"; }
public_tree(){
  python3 - "$1" <<'PY'
import hashlib,sys
from pathlib import Path
root=Path(sys.argv[1]); h=hashlib.sha256()
def walk(rel=Path('.')):
 for p in sorted((root/rel).iterdir(),key=lambda x:x.name):
  n=p.relative_to(root).as_posix()
  if p.is_symlink(): raise SystemExit('public_symlink:'+n)
  if p.is_dir(): h.update(f'D\0{n}\n'.encode());walk(p.relative_to(root))
  elif p.is_file():
   b=p.read_bytes();h.update(f'F\0{n}\0{len(b)}\0{hashlib.sha256(b).hexdigest()}\n'.encode())
  else: raise SystemExit('public_nonregular:'+n)
walk();print(h.hexdigest())
PY
}

[[ "$(readlink -f "$link")" == "$old" && "$(readlink -f "$sublink")" == "$old" && -f "$new/RELEASE_METADATA.json" ]]
node - "$new/RELEASE_METADATA.json" "$COMMIT_SHA" "$old" "$BACKEND_SHA" "$old_tree_sha" <<'JS'
const m=require(process.argv[2]);
if(m.commitSha!==process.argv[3] || m.basedOnRelease!==process.argv[4] || m.backendSha256!==process.argv[5] ||
   m.oldTreeSha256!==process.argv[6] || m.deploymentMode!=="verified-admin-agency-certification-backend-static" ||
   !/^[a-f0-9]{64}$/.test(m.newTreeSha256) || !/^[a-f0-9]{64}$/.test(m.staticIndexSha256) ||
   !/^[a-f0-9]{64}$/.test(m.newMainSha256) || !/^[a-f0-9]{64}$/.test(m.newCssSha256) ||
   !/^assets\/(?:index|main)-[A-Za-z0-9_-]+\.js$/.test(m.newMain) ||
   !/^assets\/(?:index|main)-[A-Za-z0-9_-]+\.css$/.test(m.newCss) ||
   m.oldImportMapAliases!==2 || m.loginFullheightMarker!=="min-h-screen") process.exit(3);
JS
new_index_sha=$(field staticIndexSha256)
new_main=$(field newMain); new_main_sha=$(field newMainSha256)
new_css=$(field newCss); new_css_sha=$(field newCssSha256)

[[ "$(get_sha "$old/dist/index.js")" == "$old_backend_sha" ]]
[[ "$(get_sha "$old/dist/public/index.html")" == "$old_index_sha" ]]
[[ "$(public_tree "$old/dist/public")" == "$old_tree_sha" ]]
[[ "$(get_sha "$new/dist/index.js")" == "$BACKEND_SHA" && "$BACKEND_SHA" != "$old_backend_sha" ]]
node --check "$new/dist/index.js"
[[ "$(get_sha "$new/dist/public/index.html")" == "$new_index_sha" ]]
[[ "$(get_sha "$new/dist/public/$new_main")" == "$new_main_sha" ]]
[[ "$(get_sha "$new/dist/public/$new_css")" == "$new_css_sha" ]]
[[ "$(public_tree "$new/dist/public")" == "$(field newTreeSha256)" ]]
python3 - "$old/dist/public/index.html" "$new/dist/public/index.html" <<'PY'
import json,re,sys
old,new=(open(x).read() for x in sys.argv[1:])
pat=re.compile(r'<script type="importmap">([^<]+)</script>')
a,b=pat.findall(old),pat.findall(new)
assert len(a)==len(b)==1 and a[0]==b[0]
assert len(json.loads(a[0]).get('imports',{}))==2
PY
[[ -L "$new/uploads" && "$(readlink "$new/uploads")" == "$(readlink "$old/uploads")" && "$(readlink -f "$new/uploads")" == "$uploads_target" ]]
while IFS= read -r -d '' old_file; do
  rel=${old_file#"$old/"}; [[ "$rel" == dist/index.js ]] && continue
  cmp -s "$old_file" "$new/$rel"
done < <(find "$old/dist" -path "$old/dist/public" -prune -o -type f -print0)

# Do not inspect PM2 JSON or its environment.  The supplied public preflight establishes stable link configuration;
# this guard verifies the two PM2 PIDs, their public cmdline, cwd, and live dist hash before and after reload.
pids_for(){
 local name=$1 expected=$2 listed
 listed=$(pm2 pid "$name" 2>/dev/null | grep -E '^[1-9][0-9]*$' || true)
 [[ -n "$listed" && "$(printf '%s\n' "$listed" | wc -l)" == "$expected" ]]
 local pid; while IFS= read -r pid; do [[ -d "/proc/$pid" ]]; done <<< "$listed"
 printf '%s\n' "$listed"
}
verify_admin_binding(){
 local target=$1 expected_sha=$2 cwd_policy=${3:-target} listed pid cwd
 listed=$(pids_for "$app" 2)
 while IFS= read -r pid; do
  cwd=$(readlink -f "/proc/$pid/cwd")
  grep -azF "$link/dist/index.js" "/proc/$pid/cmdline" >/dev/null
  [[ "$(get_sha "$cwd/dist/index.js")" == "$expected_sha" ]]
  if [[ "$cwd_policy" == target ]]; then [[ "$cwd" == "$target" ]]; fi
 done <<< "$listed"
}
other_pids(){
 local spec name expected listed pid
 local -a out=() specs=(
  'dianzi51:4' 'dianzi51-chat-sync:1' 'dianzi51-refund:1'
  'dianzi51-inventory-import:1' 'dianzi51-forum-quotes:1' 'dianzi51-inventory-publish:1'
 )
 for spec in "${specs[@]}"; do
  name=${spec%:*}; expected=${spec#*:}; listed=$(pids_for "$name" "$expected")
  while IFS= read -r pid; do out+=("$name:$pid"); done <<< "$listed"
 done
 printf '%s\n' "${out[@]}" | sort | paste -sd,
}
origin_get(){ curl -A "Mozilla/5.0" --noproxy '*' -fsS --resolve admin.51dianzi.com:443:127.0.0.1 --max-time 15 "https://admin.51dianzi.com$1" -o "$2"; }
origin_status(){ curl -A "Mozilla/5.0" --noproxy '*' -sS -o /dev/null -w '%{http_code}' --resolve admin.51dianzi.com:443:127.0.0.1 --max-time 15 "https://admin.51dianzi.com$1"; }
set_link(){ local path=$1 target=$2 tag=$3; ln -s "$target" "$path.$tag.$$"; mv -Tf "$path.$tag.$$" "$path"; }
switch_links(){ local target=$1 tag=$2; set_link "$link" "$target" "$tag"; set_link "$sublink" "$target" "$tag"; }

pre_other=$(other_pids)
[[ "$pre_other" == *dianzi51:* && "$pre_other" == *dianzi51-inventory-import:* && "$pre_other" == *dianzi51-inventory-publish:* ]]
verify_admin_binding "$old" "$old_backend_sha" historical
probe=$(mktemp); trap 'rm -f "$probe"' EXIT
origin_get /login "$probe"; [[ "$(get_sha "$probe")" == "$old_index_sha" ]]

switched=0
rollback(){
 local code=${1:-1}; trap - ERR INT TERM HUP
 if [[ "$switched" == 1 ]]; then
  switch_links "$old" rollback || { echo 'rollback_admin_links_failed' >&2; exit 90; }
  # Existing PM2 environment is intentionally retained; no ecosystem file and no --update-env are used.
  pm2 reload "$app" || { echo 'rollback_admin_reload_failed' >&2; exit 90; }
  for _ in $(seq 1 15); do verify_admin_binding "$old" "$old_backend_sha" && break || sleep 2; done
  verify_admin_binding "$old" "$old_backend_sha" || { echo 'rollback_admin_binding_failed' >&2; exit 90; }
  origin_get /login "$probe" && [[ "$(get_sha "$probe")" == "$old_index_sha" ]] || { echo 'rollback_admin_origin_failed' >&2; exit 90; }
  [[ "$(other_pids)" == "$pre_other" ]] || { echo 'rollback_nonadmin_pid_changed' >&2; exit 90; }
  echo 'rollback_status=completed_old_admin_links_and_rolling_reload_restored' >&2
 fi
 exit "$code"
}
trap 'rollback $?' ERR; trap 'rollback 130' INT; trap 'rollback 143' TERM; trap 'rollback 129' HUP

switched=1
switch_links "$new" next
# Cluster-mode rolling reload of only the two admin processes; no start/reload-all and no environment update.
pm2 reload "$app"
for _ in $(seq 1 15); do verify_admin_binding "$new" "$BACKEND_SHA" && break || sleep 2; done
verify_admin_binding "$new" "$BACKEND_SHA"
origin_get / "$probe"; [[ "$(get_sha "$probe")" == "$new_index_sha" ]]
origin_get /login "$probe"; [[ "$(get_sha "$probe")" == "$new_index_sha" ]]
origin_get "/$new_main" "$probe"; [[ "$(get_sha "$probe")" == "$new_main_sha" ]]
origin_get "/$new_css" "$probe"; [[ "$(get_sha "$probe")" == "$new_css_sha" ]]
[[ "$(origin_status "$ADMIN_ANON_401_PATH")" == 401 ]]
[[ "$(other_pids)" == "$pre_other" ]]
trap - ERR INT TERM HUP
echo "release_status=active commit=$COMMIT_SHA release=$new admin_rolling_reload=true admin_instances=2 admin_exec_sha=$BACKEND_SHA nonadmin_pids_unchanged=true uploads_preserved=true database_touched=false anonymous_agency_probe=401"
