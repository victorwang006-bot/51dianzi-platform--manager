#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=/opt/releases/20261020-erp-certification-unified-v1/admin
PUBLIC=/opt/releases/20261019-approval-sync-v1/admin/dist/public
TARGET="$ROOT/dist/index.js"
HTML="$PUBLIC/index.html"
OLD_ASSET="$PUBLIC/assets/Merchants-review-ui-8bbfe0e38a230e0b.js"
ASSET_NAME=Merchants-review-readable-148b184dd7bdde0f.js
NEW_ASSET="$PUBLIC/assets/$ASSET_NAME"
UPLOAD=/tmp/cn-review-readable-RP8XvX8GVfYKmIsx3rS8D5
OLD_BACKEND=e5719e5cacdabad4f5bf945d84a40d1ae768590b0bfdf9a0a354f765bfb3172f
NEW_BACKEND=236ea7579bae39126dcb3ab27dcad8a90348e13fc59a5cf2083985a40ba5e369
OLD_FRONTEND=8bbfe0e38a230e0b2d70a04c70c5683ca7fe7b4bc91a4ce9e9e18c97059c0357
NEW_FRONTEND=148b184dd7bdde0f6ef08184a40df03d9363a5333f952c4aaf5d40a9d28d9de0
OLD_HTML=60161797a246a0b5b84d1eeb1ea16bd526709816aef5a70ccd8a8522b9c5304b
NEW_HTML=9381eca8adefa5d320efb15ca370fe73762a2c26856ef1c4fb67cab25bbd53aa
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP=/opt/backups/dianzi51-admin/cn-review-readable-detail-$STAMP
BACKEND_TMP="$ROOT/dist/.index.cn-review-readable.$STAMP.new.js"
HTML_TMP="$PUBLIC/.index.cn-review-readable.$STAMP.new.html"
BACKEND_SWAPPED=0
HTML_SWAPPED=0
hash() { sha256sum "$1" | awk '{print $1}'; }
exec 9>/var/lock/dianzi51-admin-cn-review-date.lock
flock -n 9 || { echo 'STOP: deployment lock already held'; exit 1; }
rollback() {
  local status=$?
  trap - ERR
  echo "DEPLOY_FAILED=$status"
  if [[ "$HTML_SWAPPED" == 1 ]]; then
    [[ "$(hash "$HTML")" == "$NEW_HTML" ]] || { echo 'STOP: HTML changed externally; do not overwrite'; exit "$status"; }
    cp -p "$BACKUP/index.html.before" "$HTML_TMP"
    mv -T "$HTML_TMP" "$HTML"
  fi
  if [[ "$BACKEND_SWAPPED" == 1 ]]; then
    [[ "$(hash "$TARGET")" == "$NEW_BACKEND" ]] || { echo 'STOP: backend changed externally; do not overwrite'; exit "$status"; }
    cp -p "$BACKUP/index.js.before" "$BACKEND_TMP"
    node --check "$BACKEND_TMP"
    [[ "$(hash "$BACKEND_TMP")" == "$OLD_BACKEND" ]]
    mv -T "$BACKEND_TMP" "$TARGET"
    pm2 reload dianzi51-admin
  fi
  echo 'STAGE2_ROLLED_BACK; original date fix preserved; new immutable asset may safely remain'
  exit "$status"
}
trap rollback ERR
[[ "$(hash "$TARGET")" == "$OLD_BACKEND" ]]
[[ "$(hash "$HTML")" == "$OLD_HTML" ]]
[[ "$(hash "$OLD_ASSET")" == "$OLD_FRONTEND" ]]
[[ "$(hash "$UPLOAD/index.backend.js")" == "$NEW_BACKEND" ]]
[[ "$(hash "$UPLOAD/index.html")" == "$NEW_HTML" ]]
[[ "$(hash "$UPLOAD/$ASSET_NAME")" == "$NEW_FRONTEND" ]]
[[ ! -e "$NEW_ASSET" ]] || { echo 'STOP: new asset path already exists'; exit 1; }
node --check "$UPLOAD/index.backend.js"
node --check "$UPLOAD/$ASSET_NAME"
node - "$TARGET" "$UPLOAD/index.backend.js" "$HTML" "$UPLOAD/index.html" <<'NODE'
const fs=require('fs');const cp=require('child_process');
const [a,b,c,d]=process.argv.slice(2).map(x=>fs.readFileSync(x,'utf8'));
const start='async function reviewCnRegistrationDraft(';
if(a.slice(a.indexOf(start))!==b.slice(b.indexOf(start))) throw Error('Mutation function changed');
const guard=s=>s.slice(s.indexOf('function cnReviewAssertSubject('),s.indexOf('function cnReviewCompanyGuard('));
if(guard(a)!==guard(b)) throw Error('Subject guard changed');
if(c.replace('"/assets/Merchants-review-ui-8bbfe0e38a230e0b.js"','"/assets/Merchants-review-readable-148b184dd7bdde0f.js"')!==d) throw Error('More than the intended import-map change');
const root='/opt/releases/20261020-erp-certification-unified-v1/admin';
const apps=JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8'})).filter(p=>p.name==='dianzi51-admin');
if(apps.length!==2||apps.some(p=>p.pm2_env.status!=='online'||p.pm2_env.pm_cwd!==root||p.pm2_env.pm_exec_path!==root+'/dist/index.js'||p.pm2_env.exec_mode!=='cluster_mode')) throw Error('Unexpected backend target');
console.log('Verified unchanged mutation/subject guards and single import-map replacement');
NODE
mkdir -p "$BACKUP"
cp -p "$TARGET" "$BACKUP/index.js.before"
cp -p "$HTML" "$BACKUP/index.html.before"
cp -p "$OLD_ASSET" "$BACKUP/merchant-asset.before.js"
cp "$UPLOAD/manifest.json" "$BACKUP/manifest.json"
[[ "$(hash "$BACKUP/index.js.before")" == "$OLD_BACKEND" ]]
[[ "$(hash "$BACKUP/index.html.before")" == "$OLD_HTML" ]]
# New content-addressed asset becomes available before switching HTML; old assets stay.
cp "$UPLOAD/$ASSET_NAME" "$NEW_ASSET"
chmod 644 "$NEW_ASSET"
[[ "$(hash "$NEW_ASSET")" == "$NEW_FRONTEND" ]]
cp "$UPLOAD/index.backend.js" "$BACKEND_TMP"
chmod --reference="$TARGET" "$BACKEND_TMP"
chown --reference="$TARGET" "$BACKEND_TMP"
node --check "$BACKEND_TMP"
cp "$UPLOAD/index.html" "$HTML_TMP"
chmod --reference="$HTML" "$HTML_TMP"
chown --reference="$HTML" "$HTML_TMP"
[[ "$(hash "$TARGET")" == "$OLD_BACKEND" && "$(hash "$HTML")" == "$OLD_HTML" && "$(hash "$OLD_ASSET")" == "$OLD_FRONTEND" ]]
echo "BACKUP=$BACKUP"
mv -T "$BACKEND_TMP" "$TARGET"
BACKEND_SWAPPED=1
[[ "$(hash "$TARGET")" == "$NEW_BACKEND" ]]
pm2 reload dianzi51-admin
node <<'NODE'
const cp=require('child_process');
const apps=JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8'})).filter(p=>p.name==='dianzi51-admin');
if(apps.length!==2||apps.some(p=>p.pm2_env.status!=='online')) throw Error('Backend reload failed');
console.log('AFTER_PM2='+JSON.stringify(apps.map(p=>({id:p.pm_id,pid:p.pid,status:p.pm2_env.status,cwd:p.pm2_env.pm_cwd}))));
NODE
[[ "$(hash "$HTML")" == "$OLD_HTML" ]]
mv -T "$HTML_TMP" "$HTML"
HTML_SWAPPED=1
[[ "$(hash "$HTML")" == "$NEW_HTML" ]]
[[ "$(hash "$OLD_ASSET")" == "$OLD_FRONTEND" ]]
[[ "$(hash "$TARGET")" == "$NEW_BACKEND" ]]
echo "BACKEND_SHA=$(hash "$TARGET")"
echo "HTML_SHA=$(hash "$HTML")"
echo "NEW_FRONTEND_SHA=$(hash "$NEW_ASSET")"
echo "BACKUP=$BACKUP"
echo 'STAGE2_DEPLOY_SUCCESS'
