#!/usr/bin/env bash
# dianzi51-admin 部署脚本（子域形态 admin.51dianzi.com）。
#
# 用法：deploy-admin.sh <产物包.tar.gz>
#
# 历史故障与本脚本的应对：
#   进程 cwd 曾直接绑定某个 release 目录，该目录被清理后进程虽 online
#   但代码已失效，全部请求 404，且重启即彻底失败。
#   应对：release 统一放在 /opt/apps/releases/ 下（与前台同级管理，不会被
#   其它部署流程当作临时目录清理），进程 cwd 恒定指向稳定软链。
#
# uploads 是业务数据（物料图片），必须存放在 release 之外并以软链接入，
# 否则每次切换 release 都会丢失历史上传文件。
set -eEuo pipefail

PKG="${1:?usage: deploy-admin.sh <tar.gz>}"
STAMP=$(date +%Y%m%d-%H%M%S)
REL=/opt/apps/releases/dianzi51-admin-$STAMP
LINK=/opt/apps/dianzi51-admin
SUBLINK=/opt/apps/dianzi51-admin-subdomain
SHARED_UPLOADS=/opt/shared/dianzi51-admin/uploads
ECO=/opt/config/dianzi51-admin/ecosystem.config.cjs

echo "=== 1. 记录当前状态（回滚用）==="
PREV=$(readlink -f "$LINK" 2>/dev/null || echo none)
PREV_SUB=$(readlink -f "$SUBLINK" 2>/dev/null || echo none)
SWITCH_STARTED=0
echo "prev_release=$PREV"

rollback_on_error() {
  code=$?
  trap - ERR
  set +e
  if [[ "$SWITCH_STARTED" == "1" && -d "$PREV" ]]; then
    echo "部署失败，正在恢复旧后台版本：$PREV" >&2
    ln -sfn "$PREV" "${LINK}.restore.$$" && mv -Tf "${LINK}.restore.$$" "$LINK"
    restore_sub="$PREV"
    [[ -d "$PREV_SUB" ]] && restore_sub="$PREV_SUB"
    ln -sfn "$restore_sub" "${SUBLINK}.restore.$$" && mv -Tf "${SUBLINK}.restore.$$" "$SUBLINK"
    pm2 startOrReload "$ECO" --only dianzi51-admin --update-env || true
  else
    echo "部署在切换前失败，当前后台版本保持不变" >&2
  fi
  exit "$code"
}
trap rollback_on_error ERR

echo "=== 2. 解包到 $REL ==="
mkdir -p "$REL"
tar -xzf "$PKG" -C "$REL"
# 打包端若使用 mktemp 暂存目录，tar 可能携带根目录 0700 权限；Nginx 因无法穿越
# release 根目录会把本应存在的静态文件返回为 404。解包后统一恢复可穿越权限。
chmod 755 "$REL"
test -f "$REL/dist/index.js" || { echo "FAIL: 缺少 dist/index.js"; exit 1; }
test -f "$REL/dist/public/index.html" || { echo "FAIL: 缺少 dist/public/index.html"; exit 1; }
# pnpm 对依赖打了补丁（wouter），patches/ 与 pnpm-workspace.yaml 缺失会让
# pnpm install 直接 ENOENT 失败。宁可在切软链前就报错，也不能半成品上线。
test -f "$REL/package.json" || { echo "FAIL: 缺少 package.json"; exit 1; }
test -f "$REL/pnpm-lock.yaml" || { echo "FAIL: 缺少 pnpm-lock.yaml"; exit 1; }
test -f "$REL/scripts/rollback-admin.sh" || { echo "FAIL: 缺少受保护后台回滚脚本"; exit 1; }
if grep -q '"patchedDependencies"\|patchedDependencies:' "$REL/package.json" "$REL/pnpm-workspace.yaml" 2>/dev/null; then
  test -d "$REL/patches" || { echo "FAIL: 声明了 patchedDependencies 但缺少 patches/ 目录"; exit 1; }
  echo "patches 目录存在：$(ls "$REL/patches" | tr '\n' ' ')"
fi
echo "产物校验通过"

echo "=== 3. 依赖处理 ==="
if [ -d "$PREV/node_modules" ]; then
  cp -al "$PREV/node_modules" "$REL/node_modules"
  echo "node_modules 已从上一版硬链接复用"
elif [ -d /opt/shared/dianzi51-admin/node_modules ]; then
  cp -al /opt/shared/dianzi51-admin/node_modules "$REL/node_modules"
  echo "node_modules 已从共享目录复用"
else
  echo "首次部署：安装生产依赖"
  (cd "$REL" && pnpm install --prod --frozen-lockfile 2>&1 | tail -5)
  mkdir -p /opt/shared/dianzi51-admin
  cp -al "$REL/node_modules" /opt/shared/dianzi51-admin/node_modules
fi

echo "=== 4. uploads 持久化（业务数据，必须在 release 之外）==="
mkdir -p "$SHARED_UPLOADS"
# 首次部署时从历史 release 迁移既有图片，避免老记录裂图
if [ -z "$(ls -A "$SHARED_UPLOADS" 2>/dev/null)" ]; then
  OLD=$(ls -d /opt/apps/releases/dianzi51-admin-pre-*/uploads 2>/dev/null | head -1)
  if [ -n "$OLD" ] && [ -d "$OLD" ]; then
    cp -a "$OLD/." "$SHARED_UPLOADS/"
    echo "已迁移历史上传文件：$(find "$SHARED_UPLOADS" -type f | wc -l) 个"
  fi
fi
rm -rf "$REL/uploads"
ln -sfn "$SHARED_UPLOADS" "$REL/uploads"
echo "uploads -> $SHARED_UPLOADS"

echo "=== 4b. 执行举报投诉消息幂等迁移 ==="
test -f "$REL/scripts/apply-complaint-message-schema.mjs" || { echo "FAIL: 缺少举报投诉迁移脚本"; exit 1; }
node "$REL/scripts/apply-complaint-message-schema.mjs" \
  --from-runtime-env /opt/config/dianzi51-admin/runtime.env

echo "=== 4c. 执行开通消息类型幂等迁移 ==="
test -f "$REL/scripts/apply-onboarding-message-schema.mjs" || { echo "FAIL: 缺少开通消息迁移脚本"; exit 1; }
node "$REL/scripts/apply-onboarding-message-schema.mjs" \
  --from-runtime-env /opt/config/dianzi51-admin/runtime.env

echo "=== 4d. 执行负责人换绑平台同步账本幂等迁移 ==="
test -f "$REL/scripts/apply-crm-owner-rebind-sync-schema.mjs" || { echo "FAIL: 缺少负责人同步迁移脚本"; exit 1; }
node "$REL/scripts/apply-crm-owner-rebind-sync-schema.mjs" \
  --from-runtime-env /opt/config/dianzi51-admin/runtime.env

echo "=== 4e. 执行商户销售负责人筛选索引幂等迁移 ==="
test -f "$REL/scripts/apply-merchant-sales-owner-filter-schema.mjs" || { echo "FAIL: 缺少销售负责人筛选迁移脚本"; exit 1; }
node "$REL/scripts/apply-merchant-sales-owner-filter-schema.mjs" \
  --from-runtime-env /opt/config/dianzi51-admin/runtime.env

echo "=== 4f. 执行后台账号与会话安全幂等迁移 ==="
test -f "$REL/scripts/apply-admin-account-security-schema.mjs" || { echo "FAIL: 缺少后台账号安全迁移脚本"; exit 1; }
node "$REL/scripts/apply-admin-account-security-schema.mjs" \
  --from-runtime-env /opt/config/dianzi51-admin/runtime.env
install -o root -g root -m 0700 "$REL/scripts/rollback-admin.sh" \
  /opt/config/dianzi51-admin/rollback-admin.sh

echo "=== 5. 原子切换软链 ==="
# 子域形态下两个软链指向同一 release：
# LINK 供 PM2 进程与 /uploads/ alias 使用，SUBLINK 供 Nginx 静态根使用
SWITCH_STARTED=1
ln -sfn "$REL" "$LINK.tmp" && mv -Tf "$LINK.tmp" "$LINK"
ln -sfn "$REL" "$SUBLINK.tmp" && mv -Tf "$SUBLINK.tmp" "$SUBLINK"
echo "$LINK    -> $(readlink -f $LINK)"
echo "$SUBLINK -> $(readlink -f $SUBLINK)"

echo "=== 6. 重启 admin（仅 admin，绝不触碰前台进程）==="
pm2 startOrReload "$ECO" --only dianzi51-admin --update-env
sleep 6
pm2 list | grep -E "dianzi51-admin" || true

echo "=== 7. 健康检查 ==="
PORT=$(grep -E '^PORT=' /opt/config/dianzi51-admin/runtime.env | cut -d= -f2)
for i in 1 2 3 4 5 6; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "http://127.0.0.1:${PORT}/api/trpc/auth.me?input=%7B%7D" 2>/dev/null || echo 000)
  ROOT=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "http://127.0.0.1:${PORT}/" 2>/dev/null || echo 000)
  echo "attempt $i: api=$CODE root=$ROOT"
  [ "$ROOT" = "200" ] && break
  sleep 4
done
[[ "$CODE" == "200" ]]
[[ "$ROOT" == "200" ]]

echo "=== 8. 前台未受影响确认 ==="
curl -s -o /dev/null -w "前台 3000: HTTP %{http_code}\n" http://127.0.0.1:3000/ || true

echo "PREV_RELEASE=$PREV"
echo "NEW_RELEASE=$REL"
trap - ERR
