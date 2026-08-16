#!/usr/bin/env bash
#
# 判断 /opt/shared/dianzi51-admin/uploads/material-images 下的 101 张本地图
# 是否与 OSS 上的 464 张封面图重复。
#
# 为何需要判断：本地图已无任何数据库引用（孤儿文件），但内容是带水印的
# 正式商品图，不能直接删。必须先确认 OSS 上有同款，否则删掉就是丢资产。
#
# 比对方法：本地图文件名是时间戳（无型号信息），无法按名匹配，
# 故用内容哈希（md5）逐一比对——同一张图无论存哪里，md5 必然相同。
#
set -uo pipefail

LOCAL_DIR=/opt/shared/dianzi51-admin/uploads/material-images
WORK=/tmp/img-cmp
DBH="rm-bp1m856i4zowwc264.mysql.rds.aliyuncs.com"

mkdir -p "$WORK"

echo "=== 1. 计算本地 101 张的 md5 ==="
find "$LOCAL_DIR" -name '*.png' -exec md5sum {} \; \
  | awk '{print $1"\t"$2}' | sort > "$WORK/local.md5"
echo "本地文件数：$(wc -l < "$WORK/local.md5")"

echo ""
echo "=== 2. 取 OSS 封面图地址清单 ==="
mysql -uRDS_51dianzi -pwangwen_0306 -h"$DBH" dianzi51_admin -N -B -e \
  "SELECT coverImageUrl FROM materials
   WHERE coverImageUrl LIKE 'http%' AND coverImageUrl <> ''" 2>/dev/null \
  > "$WORK/oss-urls.txt"
echo "OSS 图片数：$(wc -l < "$WORK/oss-urls.txt")"

echo ""
echo "=== 3. 下载 OSS 图并计算 md5（逐张，带限速）==="
: > "$WORK/oss.md5"
downloaded=0
failed=0
while IFS= read -r url; do
  [[ -z "$url" ]] && continue
  tmp="$WORK/oss-tmp.png"
  if curl -fsS --max-time 30 -o "$tmp" "$url" 2>/dev/null; then
    printf '%s\t%s\n' "$(md5sum "$tmp" | cut -d' ' -f1)" "$url" >> "$WORK/oss.md5"
    downloaded=$((downloaded + 1))
  else
    failed=$((failed + 1))
  fi
  # 每 50 张报一次进度，避免长时间无输出
  if (( (downloaded + failed) % 50 == 0 )); then
    echo "    进度：已处理 $((downloaded + failed)) / $(wc -l < "$WORK/oss-urls.txt")"
  fi
done < "$WORK/oss-urls.txt"
rm -f "$WORK/oss-tmp.png"
echo "下载成功：$downloaded  失败：$failed"

echo ""
echo "=== 4. 比对结果 ==="
cut -f1 "$WORK/local.md5" | sort -u > "$WORK/local-hashes.txt"
cut -f1 "$WORK/oss.md5"   | sort -u > "$WORK/oss-hashes.txt"

dup=$(comm -12 "$WORK/local-hashes.txt" "$WORK/oss-hashes.txt" | wc -l)
only_local=$(comm -23 "$WORK/local-hashes.txt" "$WORK/oss-hashes.txt" | wc -l)

echo "本地唯一哈希数：$(wc -l < "$WORK/local-hashes.txt")"
echo "OSS  唯一哈希数：$(wc -l < "$WORK/oss-hashes.txt")"
echo "两处内容相同（本地是冗余副本）：$dup"
echo "仅存于本地（删除即丢资产）    ：$only_local"

if [[ "$only_local" -gt 0 ]]; then
  echo ""
  echo "=== 仅存于本地的文件清单（不可删，需先转存 OSS）==="
  comm -23 "$WORK/local-hashes.txt" "$WORK/oss-hashes.txt" \
    | while read -r h; do grep -m1 "^$h" "$WORK/local.md5" | cut -f2; done
fi
