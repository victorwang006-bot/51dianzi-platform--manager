#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

INDEX_FILE="dist/public/index.html"
if [[ ! -f "$INDEX_FILE" ]]; then
  echo "未找到 $INDEX_FILE，请先运行 pnpm build:admin" >&2
  exit 1
fi

asset_refs=$(grep -c '/admin/assets/' "$INDEX_FILE" || true)
admin_base_refs=$({ grep -h -o '"/admin/"\.replace' dist/public/assets/index-*.js 2>/dev/null || true; } | wc -l | tr -d ' ')
root_base_refs=$({ grep -h -o '="/"\.replace' dist/public/assets/index-*.js 2>/dev/null || true; } | wc -l | tr -d ' ')
unresolved_vite_placeholders=$(grep -RohE '%VITE_[A-Z0-9_]+%' dist/public \
  --include='*.html' --include='*.js' | wc -l | tr -d ' ' || true)

printf 'index_admin_assets=%s\n' "$asset_refs"
printf 'bundle_admin_base_refs=%s\n' "$admin_base_refs"
printf 'bundle_root_base_refs=%s\n' "$root_base_refs"
printf 'unresolved_vite_placeholders=%s\n' "$unresolved_vite_placeholders"

if (( asset_refs < 2 )); then
  echo "失败：index.html 未正确引用 /admin/assets/" >&2
  exit 1
fi
if (( admin_base_refs < 2 )); then
  echo "失败：前端包未同时写入 /admin/ 的 API 与路由基础路径" >&2
  exit 1
fi
if (( root_base_refs != 0 )); then
  echo "失败：前端包仍包含根路径 API/路由基础配置" >&2
  exit 1
fi
if (( unresolved_vite_placeholders != 0 )); then
  echo "失败：生产制品仍包含未替换的 %VITE_*% 占位符" >&2
  exit 1
fi

echo "通过：/admin/ 生产构建基础路径自检完成"
