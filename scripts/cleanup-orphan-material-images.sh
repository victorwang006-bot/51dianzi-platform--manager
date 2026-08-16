#!/usr/bin/env bash
#
# 清理 uploads/material-images 下的孤儿图片文件。
#
# 背景：该目录下 101 个 PNG（152MB）在数据库中无任何引用
# （materials.coverImageUrl / images 均不含 /uploads/ 路径，前台库存引用为 0），
# 且与 OSS 上的 464 张封面图内容 md5 无一重复。
# 经用户确认为错误图（疑似早期模型生成的训练数据，丝印与封装不匹配），
# 予以清理。
#
# 安全设计：
#   1. 删除前先做完整归档到 /opt/backups，误判时可取回；
#   2. 删除前复查数据库引用，若发现任何引用立即中止
#      （防止在勘察与执行之间有新数据写入）;
#   3. 只删 material-images 目录下的 .png，不碰目录本身，
#      因为该目录是 release 软链目标，删掉会让上传接口报错。
#
set -Eeuo pipefail

UPLOAD_DIR=/opt/shared/dianzi51-admin/uploads/material-images
BACKUP_DIR=/opt/backups/orphan-material-images
STAMP=$(date +%Y%m%d-%H%M%S)
ARCHIVE="$BACKUP_DIR/orphan-images-$STAMP.tar.gz"
DBH="rm-bp1m856i4zowwc264.mysql.rds.aliyuncs.com"

Q() { mysql -uRDS_51dianzi -pwangwen_0306 -h"$DBH" dianzi51_admin -N -B -e "$1" 2>/dev/null; }

echo "=== 1. 复查数据库引用（必须全为 0）==="
cover_refs=$(Q "SELECT COUNT(*) FROM materials WHERE coverImageUrl LIKE '/uploads/%'")
gallery_refs=$(Q "SELECT COUNT(*) FROM materials
                  WHERE JSON_SEARCH(images,'one','/uploads%',NULL,'\$**.url') IS NOT NULL")
inv_refs=$(Q "SELECT COUNT(*) FROM dianzi51.inventories i
              JOIN materials m ON i.materialCode=m.materialNo
              WHERE m.coverImageUrl LIKE '/uploads/%'")

echo "    封面图引用：$cover_refs"
echo "    图集引用：  $gallery_refs"
echo "    库存关联：  $inv_refs"

if [[ "$cover_refs" != "0" || "$gallery_refs" != "0" || "$inv_refs" != "0" ]]; then
  echo "!! 发现数据库引用，中止清理。这些文件正在被使用。" >&2
  exit 2
fi
echo "    确认无引用，可以清理"

echo ""
echo "=== 2. 归档（误判时可取回）==="
file_count=$(find "$UPLOAD_DIR" -maxdepth 1 -name '*.png' | wc -l)
if [[ "$file_count" == "0" ]]; then
  echo "    目录下已无 PNG 文件，无需清理"
  exit 0
fi
mkdir -p "$BACKUP_DIR"
tar -czf "$ARCHIVE" -C "$UPLOAD_DIR" $(cd "$UPLOAD_DIR" && ls *.png)
chmod 600 "$ARCHIVE"
echo "    已归档 $file_count 个文件 → $ARCHIVE"
echo "    归档大小：$(du -h "$ARCHIVE" | cut -f1)"

echo ""
echo "=== 3. 校验归档完整性（校验通过才删原文件）==="
archived_count=$(tar -tzf "$ARCHIVE" | grep -c '\.png$')
echo "    归档内文件数：$archived_count / 原文件数：$file_count"
if [[ "$archived_count" != "$file_count" ]]; then
  echo "!! 归档文件数不符，中止删除。原文件保持不动。" >&2
  exit 3
fi

echo ""
echo "=== 4. 删除原文件 ==="
find "$UPLOAD_DIR" -maxdepth 1 -name '*.png' -delete
remaining=$(find "$UPLOAD_DIR" -maxdepth 1 -name '*.png' | wc -l)
echo "    删除完成，剩余 PNG：$remaining"
echo "    目录仍存在（上传接口依赖）：$([[ -d "$UPLOAD_DIR" ]] && echo yes || echo NO)"

echo ""
echo "=== 5. 磁盘释放情况 ==="
df -h /opt | tail -1

echo ""
echo "=== 完成 ==="
echo "归档位置：$ARCHIVE"
echo "如需取回：tar -xzf $ARCHIVE -C $UPLOAD_DIR"
