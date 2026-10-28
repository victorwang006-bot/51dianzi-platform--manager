#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=/opt/releases/20261020-erp-certification-unified-v1/admin
TARGET="$ROOT/dist/index.js"
UPLOAD=/tmp/cn-review-date-RP8XvX8GVfYKmIsx3rS8D5/index.patched.js
OLD=1b9a8b55daf817b5040b03ecc635b2a6957988d2540daaad834444ea1763730d
NEW=e5719e5cacdabad4f5bf945d84a40d1ae768590b0bfdf9a0a354f765bfb3172f
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP=/opt/backups/dianzi51-admin/cn-review-established-date-$STAMP
STAGED="$ROOT/dist/.index.cn-review-date.$STAMP.new.js"
SWAPPED=0
exec 9>/var/lock/dianzi51-admin-cn-review-date.lock
flock -n 9 || { echo 'STOP: another CN-review deploy holds the lock'; exit 1; }
hash() { sha256sum "$1" | awk '{print $1}'; }
rollback() {
  local code=$?
  trap - ERR
  echo "DEPLOY FAILED: exit $code"
  if [[ "$SWAPPED" == 1 ]]; then
    if [[ "$(hash "$TARGET")" != "$NEW" ]]; then
      echo 'STOP: target changed after deployment; do not overwrite third-party changes'
      exit "$code"
    fi
    echo "ROLLBACK from $BACKUP/index.js.before"
    cp -p "$BACKUP/index.js.before" "$STAGED"
    node --check "$STAGED"
    [[ "$(hash "$STAGED")" == "$OLD" ]]
    mv -T "$STAGED" "$TARGET"
    pm2 reload dianzi51-admin
    echo "ROLLED_BACK_SHA=$(hash "$TARGET")"
  fi
  exit "$code"
}
trap rollback ERR
[[ "$(hash "$TARGET")" == "$OLD" ]] || { echo 'STOP: production hash differs from inspected baseline'; exit 1; }
[[ "$(hash "$UPLOAD")" == "$NEW" ]] || { echo 'STOP: uploaded candidate hash mismatch'; exit 1; }
node --check "$UPLOAD"
node - "$ROOT" <<'NODE'
const cp=require('child_process');
const root=process.argv[2];
const apps=JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8'})).filter(p=>p.name==='dianzi51-admin');
if(apps.length!==2||apps.some(p=>p.pm2_env.status!=='online'||p.pm2_env.pm_cwd!==root||p.pm2_env.pm_exec_path!==root+'/dist/index.js'||p.pm2_env.exec_mode!=='cluster_mode')) throw Error('Unexpected production process target');
console.log('BEFORE_PM2='+JSON.stringify(apps.map(p=>({id:p.pm_id,pid:p.pid,status:p.pm2_env.status,cwd:p.pm2_env.pm_cwd}))));
NODE
mkdir -p "$BACKUP"
cp -p "$TARGET" "$BACKUP/index.js.before"
[[ "$(hash "$BACKUP/index.js.before")" == "$OLD" ]]
printf 'target=%s\nbeforeSha256=%s\nafterSha256=%s\ncreatedAt=%s\n' "$TARGET" "$OLD" "$NEW" "$STAMP" > "$BACKUP/manifest.txt"
cp "$UPLOAD" "$STAGED"
chmod --reference="$TARGET" "$STAGED"
chown --reference="$TARGET" "$STAGED"
node --check "$STAGED"
[[ "$(hash "$STAGED")" == "$NEW" ]]
[[ "$(hash "$TARGET")" == "$OLD" ]] || { echo 'STOP: production changed immediately before replacement'; exit 1; }
echo "BACKUP=$BACKUP"
mv -T "$STAGED" "$TARGET"
SWAPPED=1
[[ "$(hash "$TARGET")" == "$NEW" ]]
echo 'Atomic replacement complete; rolling reload of backend only'
pm2 reload dianzi51-admin
node - "$ROOT" <<'NODE'
const cp=require('child_process');
const root=process.argv[2];
const apps=JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8'})).filter(p=>p.name==='dianzi51-admin');
if(apps.length!==2||apps.some(p=>p.pm2_env.status!=='online'||p.pm2_env.pm_cwd!==root||p.pm2_env.pm_exec_path!==root+'/dist/index.js')) throw Error('Backend not healthy after reload');
console.log('AFTER_PM2='+JSON.stringify(apps.map(p=>({id:p.pm_id,pid:p.pid,status:p.pm2_env.status,cwd:p.pm2_env.pm_cwd}))));
NODE
node --check "$TARGET"
echo "DEPLOYED_SHA=$(hash "$TARGET")"
echo "BACKUP=$BACKUP"
echo 'DEPLOY_SUCCESS'
