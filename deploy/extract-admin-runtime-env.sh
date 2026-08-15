#!/usr/bin/env bash
# 从当前运行的 dianzi51-admin 进程内存中提取运行时凭据，固化为 runtime.env 配置文件。
#
# 背景：admin 的凭据（JWT_SECRET / PORTAL_API_KEY / DATABASE_URL 等）历史上只存在于
# PM2 进程环境中，既不在源码仓库（正确，凭据不应入库），也没有落成服务器配置文件。
# 一旦进程被 kill，这些值将永久丢失且无法重建：
#   - JWT_SECRET 丢失 → 所有后台管理员登录态失效
#   - PORTAL_API_KEY 丢失 → 后台与前台对接通道断裂
# 因此必须在动进程之前先固化。
#
# 输出：/opt/config/dianzi51-admin/runtime.env（权限 600，仅 root 可读）
set -euo pipefail

OUT_DIR=/opt/config/dianzi51-admin
OUT_FILE=$OUT_DIR/runtime.env
mkdir -p "$OUT_DIR"

if [ -f "$OUT_FILE" ]; then
  cp "$OUT_FILE" "$OUT_FILE.bak-$(date +%Y%m%d-%H%M%S)"
  echo "已备份原有配置"
fi

TMP=$(mktemp)
pm2 jlist > "$TMP"

python3 - "$TMP" "$OUT_FILE" <<'PY'
import json, sys, os

src, out = sys.argv[1], sys.argv[2]
data = json.load(open(src))

env = None
for p in data:
    if p.get("name") == "dianzi51-admin":
        env = p.get("pm2_env", {}) or {}
        break

if env is None:
    sys.exit("未找到 dianzi51-admin 进程，无法提取凭据")

# 需要固化的键。UPLOAD_DIR / PLATFORM_DB_NAME 历史上未显式设置而依赖默认值，
# 这里显式写出，避免换环境后行为漂移。
wanted = [
    "PORT", "NODE_ENV", "DATABASE_URL", "JWT_SECRET", "PORTAL_API_KEY",
    "OAUTH_SERVER_URL", "SMS_ACCESS_KEY_ID", "SMS_ACCESS_KEY_SECRET",
    "SMS_SIGN_NAME", "SMS_TEMPLATE_CODE", "UPLOAD_DIR", "PLATFORM_DB_NAME",
    "PORTAL_BASE_URL", "PORTAL_INTERNAL_BASE_URL", "ADMIN_PUBLIC_ORIGIN",
]
defaults = {
    "PORT": "3001",
    "NODE_ENV": "production",
    "UPLOAD_DIR": "/opt/apps/dianzi51-admin/uploads",
    "PLATFORM_DB_NAME": "dianzi51",
}

lines = [
    "# dianzi51-admin 运行时配置",
    "# 由 deploy/extract-admin-runtime-env.sh 从运行进程内存提取生成。",
    "# 凭据不入 Git 仓库；本文件为服务器上的唯一权威来源，请勿删除。",
    "",
]
found, missing = [], []
for k in wanted:
    v = env.get(k)
    if v in (None, ""):
        if k in defaults:
            lines.append(f"{k}={defaults[k]}")
            found.append(f"{k}(默认值)")
        else:
            missing.append(k)
        continue
    lines.append(f"{k}={v}")
    found.append(k)

open(out, "w", encoding="utf-8").write("\n".join(lines) + "\n")
os.chmod(out, 0o600)

print("已固化：" + ", ".join(found))
if missing:
    print("未设置（跳过）：" + ", ".join(missing))
PY

rm -f "$TMP"
echo "输出：$OUT_FILE"
echo "--- 键名清单（不显示值）---"
sed -E 's/=.*/=***/' "$OUT_FILE" | grep -v '^#' | grep -v '^$'
