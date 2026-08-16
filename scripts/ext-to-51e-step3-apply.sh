#!/usr/bin/env bash
# ============================================================================
# EXT- 纳入 51E- 编码体系 —— 第 3 阶段：分批执行
#
# 设计要点：
#   1. 每批 5000 条，独立事务提交，避免超长事务锁表 / binlog 暴涨
#   2. 先写 external 别名（唯一约束天然幂等），再改 materialNo
#   3. 用 _work_ext_codemap.applied 标记进度，中断后重跑自动跳过已完成批次
#   4. 全程只改 materialNo，绝不触碰 partNumber / 图片 / 规格书字段
#   5. 每 20 批探测一次生产站点，异常立即停止
#
# 用法：bash ext-to-51e-step3-apply.sh
# ============================================================================
set -uo pipefail

DBH="rm-bp1m856i4zowwc264.mysql.rds.aliyuncs.com"
DBU="RDS_51dianzi"
DBP="wangwen_0306"
DB="dianzi51_admin"
SRC="ext-to-51e-2026-08-16"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"

M() { mysql -u"$DBU" -p"$DBP" -h"$DBH" "$DB" -N -B -e "$1" 2>/dev/null; }

TOTAL_BATCHES=$(M "SELECT MAX(batchNo) FROM _work_ext_codemap;")
echo "=== 待执行批次总数：$TOTAL_BATCHES ==="
START_TS=$(date +%s)

for ((b=1; b<=TOTAL_BATCHES; b++)); do
  PENDING=$(M "SELECT COUNT(*) FROM _work_ext_codemap WHERE batchNo=$b AND applied=0;")
  if [[ "$PENDING" == "0" ]]; then
    continue   # 幂等：该批已完成
  fi

  # 单事务内：写别名 → 改编码 → 标记完成
  mysql -u"$DBU" -p"$DBP" -h"$DBH" "$DB" 2>/dev/null <<SQL
START TRANSACTION;

INSERT IGNORE INTO material_code_aliases (materialId, aliasCode, aliasType, source)
SELECT c.id, c.oldNo, 'external', '$SRC'
FROM _work_ext_codemap c
WHERE c.batchNo = $b AND c.applied = 0;

UPDATE materials m
JOIN _work_ext_codemap c ON c.id = m.id
SET m.materialNo = c.newNo
WHERE c.batchNo = $b AND c.applied = 0;

UPDATE _work_ext_codemap SET applied = 1 WHERE batchNo = $b;

COMMIT;
SQL
  RC=$?
  if [[ $RC -ne 0 ]]; then
    echo "!!! 批次 $b 执行失败（退出码 $RC），已停止。可修复后重跑本脚本续做。"
    exit 1
  fi

  # 进度输出
  if (( b % 10 == 0 || b == TOTAL_BATCHES )); then
    DONE=$(M "SELECT COUNT(*) FROM _work_ext_codemap WHERE applied=1;")
    ELAPSED=$(( $(date +%s) - START_TS ))
    echo "批次 $b/$TOTAL_BATCHES 完成｜已纳编 $DONE 条｜耗时 ${ELAPSED}s"
  fi

  # 每 20 批探测生产站点
  if (( b % 20 == 0 )); then
    FC=$(curl -s -o /dev/null -w "%{http_code}" -A "$UA" --max-time 15 https://51dianzi.com/)
    AC=$(curl -s -o /dev/null -w "%{http_code}" -A "$UA" --max-time 15 https://admin.51dianzi.com/)
    echo "  └─ 站点探测：前台 $FC / 后台 $AC"
    if [[ "$FC" != "200" || "$AC" != "200" ]]; then
      echo "!!! 生产站点异常（前台 $FC 后台 $AC），已停止在批次 $b。"
      exit 1
    fi
  fi
done

echo ""
echo "=== 分批执行完毕，总耗时 $(( $(date +%s) - START_TS ))s ==="
echo "--- 残留未应用批次（应为 0）---"
M "SELECT COUNT(*) FROM _work_ext_codemap WHERE applied=0;"
