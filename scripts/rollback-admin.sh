#!/usr/bin/env bash
set -euo pipefail

TARGET_INPUT="${1:?用法: rollback-admin.sh <目标后台release目录>}"
LINK=/opt/apps/dianzi51-admin
SUBLINK=/opt/apps/dianzi51-admin-subdomain
PLATFORM_LINK=/opt/apps/dianzi51-platform
ADMIN_ECO=/opt/config/dianzi51-admin/ecosystem.config.cjs
ADMIN_ENV=/opt/config/dianzi51-admin/runtime.env

TARGET="$(readlink -f "$TARGET_INPUT")"
CURRENT="$(readlink -f "$LINK")"
case "$TARGET" in
  /opt/apps/releases/dianzi51-admin-*) ;;
  *) echo "拒绝：目标不是受管后台release目录：$TARGET" >&2; exit 2 ;;
esac
[[ -f "$TARGET/dist/index.js" ]] || { echo "拒绝：目标缺少dist/index.js" >&2; exit 2; }
[[ -f "$TARGET/dist/public/index.html" ]] || { echo "拒绝：目标缺少前端产物" >&2; exit 2; }
[[ -f "$CURRENT/dist/index.js" ]] || { echo "拒绝：当前后台release无效" >&2; exit 2; }

PLATFORM_REQUIRES_ONBOARDING=0
if [[ -f "$PLATFORM_LINK/dist/index.js" ]] \
  && grep -Fq 'portal.submitOnboardingLead' "$PLATFORM_LINK/dist/index.js"; then
  PLATFORM_REQUIRES_ONBOARDING=1
fi
if [[ "$PLATFORM_REQUIRES_ONBOARDING" == "1" ]] \
  && { ! grep -Fq 'submitOnboardingLead' "$TARGET/dist/index.js" \
       || ! grep -Fq 'onboardingMessages' "$TARGET/dist/index.js"; }; then
  echo "拒绝回滚：当前主站依赖开通消息协议，目标后台不兼容。请先回滚主站。" >&2
  exit 3
fi

rollback_current() {
  code=$?
  trap - ERR
  echo "后台回滚失败，恢复原版本：$CURRENT" >&2
  ln -sfn "$CURRENT" "${LINK}.restore.$$" && mv -Tf "${LINK}.restore.$$" "$LINK"
  ln -sfn "$CURRENT" "${SUBLINK}.restore.$$" && mv -Tf "${SUBLINK}.restore.$$" "$SUBLINK"
  pm2 startOrReload "$ADMIN_ECO" --only dianzi51-admin --update-env || true
  exit "$code"
}
trap rollback_current ERR

ln -sfn "$TARGET" "${LINK}.rollback.$$" && mv -Tf "${LINK}.rollback.$$" "$LINK"
ln -sfn "$TARGET" "${SUBLINK}.rollback.$$" && mv -Tf "${SUBLINK}.rollback.$$" "$SUBLINK"
pm2 startOrReload "$ADMIN_ECO" --only dianzi51-admin --update-env

PORT="$(grep -E '^PORT=' "$ADMIN_ENV" | tail -1 | cut -d= -f2 | tr -d '\r\"\047 ')"
[[ "$PORT" =~ ^[0-9]{2,5}$ ]]
for _ in $(seq 1 12); do
  if [[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${PORT}/")" == "200" ]]; then
    break
  fi
  sleep 2
done
[[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${PORT}/")" == "200" ]]

if [[ "$PLATFORM_REQUIRES_ONBOARDING" == "1" ]]; then
  [[ -f "$PLATFORM_LINK/scripts/preflight-onboarding-admin.mjs" ]]
  node "$PLATFORM_LINK/scripts/preflight-onboarding-admin.mjs" \
    --from-ecosystem-config "$PLATFORM_LINK/ecosystem.config.cjs" \
    --admin-runtime-env "$ADMIN_ENV"
fi

trap - ERR
echo "admin_rollback=passed"
echo "previous_release=$CURRENT"
echo "active_release=$TARGET"
