#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

INDEX_FILE="dist/public/index.html"
if [[ ! -f "$INDEX_FILE" ]]; then
  echo "未找到 $INDEX_FILE，请先运行 pnpm build:subdomain" >&2
  exit 1
fi

mapfile -t entry_bundles < <(grep -oE 'src="/assets/index-[^"]+\.js"' "$INDEX_FILE" | sed -E 's/^src="(.*)"$/dist\/public\1/')
asset_refs=$(grep -oE '(src|href)="/assets/' "$INDEX_FILE" | wc -l | tr -d ' ')
admin_asset_refs=$(grep -oE '(src|href)="/admin/assets/' "$INDEX_FILE" | wc -l | tr -d ' ' || true)

if (( ${#entry_bundles[@]} != 1 )); then
  echo "失败：无法唯一定位子域入口脚本" >&2
  exit 1
fi

entry_bundle="${entry_bundles[0]}"
if [[ ! -f "$entry_bundle" ]]; then
  echo "失败：入口脚本不存在：$entry_bundle" >&2
  exit 1
fi

admin_base_refs=$(grep -o '"/admin/"\.replace' "$entry_bundle" | wc -l | tr -d ' ' || true)
root_base_refs=$(grep -o '="/"\.replace' "$entry_bundle" | wc -l | tr -d ' ' || true)
api_refs=$(grep -o '/api/trpc' "$entry_bundle" | wc -l | tr -d ' ' || true)
admin_api_refs=$(grep -o '/admin/api/trpc' "$entry_bundle" | wc -l | tr -d ' ' || true)

printf 'index_root_assets=%s\n' "$asset_refs"
printf 'index_admin_assets=%s\n' "$admin_asset_refs"
printf 'bundle_root_base_refs=%s\n' "$root_base_refs"
printf 'bundle_admin_base_refs=%s\n' "$admin_base_refs"
printf 'bundle_api_refs=%s\n' "$api_refs"
printf 'bundle_admin_api_refs=%s\n' "$admin_api_refs"
printf 'entry_bundle=%s\n' "$entry_bundle"

if (( asset_refs < 2 )); then
  echo "失败：index.html 未正确引用 /assets/ 根路径资源" >&2
  exit 1
fi
if (( admin_asset_refs != 0 )); then
  echo "失败：index.html 仍引用 /admin/assets/" >&2
  exit 1
fi
if (( root_base_refs < 1 )); then
  echo "失败：前端包未写入根路径路由基础路径" >&2
  exit 1
fi
if (( admin_base_refs != 0 )); then
  echo "失败：前端包仍包含 /admin/ API 或路由基础路径" >&2
  exit 1
fi
if (( api_refs < 1 )); then
  echo "失败：前端包缺少 /api/trpc 请求路径" >&2
  exit 1
fi
if (( admin_api_refs != 0 )); then
  echo "失败：前端包仍包含 /admin/api/trpc 请求路径" >&2
  exit 1
fi

echo "通过：admin.51dianzi.com 根路径生产构建自检完成"
