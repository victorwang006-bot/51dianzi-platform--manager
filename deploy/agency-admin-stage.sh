#!/usr/bin/env bash
# Stage the admin company agency-certification release.  No database migration, Nginx change, config read, or activation occurs here.
set -Eeuo pipefail
umask 077

: "${ARCHIVE:?}" "${ARCHIVE_SHA:?}" "${BACKEND_SHA:?}" "${COMMIT_SHA:?}" "${RELEASE_ID:?}" "${ADMIN_BACKEND_MARKER:?}"
[[ "$ARCHIVE_SHA" =~ ^[a-f0-9]{64}$ && "$BACKEND_SHA" =~ ^[a-f0-9]{64}$ && "$COMMIT_SHA" =~ ^[a-f0-9]{40}$ ]]
[[ "$RELEASE_ID" =~ ^20[0-9]{6}T[0-9]{6}Z-agency-certification$ ]]
[[ "$ARCHIVE" == "/tmp/dianzi51-admin-${RELEASE_ID}.tar.gz" ]]
[[ "$ADMIN_BACKEND_MARKER" =~ ^[A-Za-z0-9_.:-]{6,160}$ ]]

old=/opt/apps/releases/dianzi51-admin-20261009T040650Z-analytics-copy
new="/opt/apps/releases/dianzi51-admin-${RELEASE_ID}"
link=/opt/apps/dianzi51-admin
sublink=/opt/apps/dianzi51-admin-subdomain
old_backend_sha=c90486ee1dfc7049e3efcfcb2a47e0b66eabc35dde842084a57441001c78f955
old_index_sha=86babb216f3c43b69ca7a149a9d44a63e7096318ab5d498dca6d443b6b2a34a9
old_tree_sha=42ff4db5b3c1e9dfe3d4ed51988d634f024f9ee8a5b8215ab5df9a185177c985
uploads_target=/opt/shared/dianzi51-admin/uploads

exec 9>/var/lock/dianzi51-admin-deploy.lock
flock -n 9 || { echo 'another_admin_deploy_active' >&2; exit 4; }
get_sha(){ sha256sum "$1" | cut -d' ' -f1; }

[[ "$(readlink -f "$link")" == "$old" && "$(readlink -f "$sublink")" == "$old" && ! -e "$new" && -f "$ARCHIVE" ]]
[[ "$(get_sha "$ARCHIVE")" == "$ARCHIVE_SHA" ]]
[[ "$(get_sha "$old/dist/index.js")" == "$old_backend_sha" ]]
[[ "$(get_sha "$old/dist/public/index.html")" == "$old_index_sha" ]]
[[ -L "$old/uploads" && "$(readlink -f "$old/uploads")" == "$uploads_target" ]]
(( $(df -PB1 /opt/apps/releases | awk 'NR==2{print $4}') > 2147483648 )) || { echo 'insufficient_disk_space' >&2; exit 4; }

work=$(mktemp -d /tmp/dianzi51-admin-agency-certification.XXXXXXXX)
staging=$(mktemp -d "${new}.staging.XXXXXXXX")
chmod 0755 "$staging"
cleanup(){ rm -rf "$work"; [[ ! -d "$staging" ]] || rm -rf "$staging"; }
trap cleanup EXIT

# New build must be complete, but its only accepted release changes are public/, dist/index.js, and this audited offline overlay.
python3 - "$ARCHIVE" <<'PY'
import sys, tarfile
with tarfile.open(sys.argv[1], 'r:gz') as tar:
    members=tar.getmembers(); assert members and len(members)<5000
    names={m.name for m in members}
    assert {'public/index.html','backend/index.js','agency-admin-overlay.py'} <= names
    for m in members:
        n=m.name
        assert (n=='public' or n.startswith('public/') or n=='backend' or n=='backend/index.js' or n=='agency-admin-overlay.py'), n
        assert not n.startswith('/') and '..' not in n.split('/'), n
        assert m.isfile() or m.isdir(), n
PY
tar -xzf "$ARCHIVE" -C "$work"
[[ "$(get_sha "$work/backend/index.js")" == "$BACKEND_SHA" && "$BACKEND_SHA" != "$old_backend_sha" ]]
node --check "$work/backend/index.js"
grep -aqF "$ADMIN_BACKEND_MARKER" "$work/backend/index.js"
python3 "$work/agency-admin-overlay.py" \
  --old "$old/dist/public" --build "$work/public" --output "$work/merged" --old-tree-sha "$old_tree_sha" > "$work/overlay.json"

# Reflink/copy first, then replace whole paths with new files; never mutate a shared hardlink inode.
cp -a --reflink=auto "$old/." "$staging/"
rm -rf "$staging/dist/public"
mv -T "$work/merged" "$staging/dist/public"
install -m 0644 "$work/backend/index.js" "$staging/dist/index.js"
[[ "$(get_sha "$staging/dist/index.js")" == "$BACKEND_SHA" ]]
while IFS= read -r -d '' old_file; do
  rel=${old_file#"$old/"}
  [[ "$rel" == dist/index.js ]] && continue
  cmp -s "$old_file" "$staging/$rel"
done < <(find "$old/dist" -path "$old/dist/public" -prune -o -type f -print0)
[[ -L "$staging/uploads" && "$(readlink "$staging/uploads")" == "$(readlink "$old/uploads")" ]]
[[ "$(readlink -f "$staging/uploads")" == "$uploads_target" ]]
for file in index.html "$(node -p 'require(process.argv[1]).newMain' "$work/overlay.json")"; do
  runuser -u nginx -- test -r "$staging/dist/public/$file"
done

metadata=$(node -e 'const x=require(process.argv[1]);console.log(JSON.stringify({releaseId:process.argv[2],commitSha:process.argv[3],basedOnRelease:process.argv[4],deploymentMode:"verified-admin-agency-certification-backend-static",backendSha256:process.argv[5],staticIndexSha256:x.indexSha,newTreeSha256:x.newTree,newMain:x.newMain,newMainSha256:x.newMainSha,newCss:x.newCss,newCssSha256:x.newCssSha,oldTreeSha256:x.oldTree,oldImportMapAliases:x.oldImportMapAliases,preservedInlineStyleTags:x.preservedInlineStyleTags,loginFullheightMarker:x.loginFullheightMarker}))' \
  "$work/overlay.json" "$RELEASE_ID" "$COMMIT_SHA" "$old" "$BACKEND_SHA")
printf '%s\n' "$metadata" > "$staging/RELEASE_METADATA.json"
chmod 0644 "$staging/RELEASE_METADATA.json"
[[ "$(readlink -f "$link")" == "$old" && "$(readlink -f "$sublink")" == "$old" ]]
mv -T "$staging" "$new"
staging=''
echo "stage_status=ready release=$new commit=$COMMIT_SHA active_unchanged=$(readlink -f "$link") database_touched=false uploads_preserved=true"
