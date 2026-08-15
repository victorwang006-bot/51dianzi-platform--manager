#!/usr/bin/env bash
# dianzi51-admin 健康巡检。建议由 cron 每 10 分钟执行一次。
#
# 为什么需要专门的巡检：
# 2026-08-13 的故障中，admin 进程 PM2 状态一直是 online、内存正常、无错误日志，
# 但代码目录已被删除，所有请求返回 404，后台实际停摆了 3 天无人发现。
# 「进程存活」与「服务可用」是两件事，只看 pm2 list 会被彻底误导。
#
# 因此本脚本必须检查真实业务响应，而非进程状态。
set -uo pipefail

FAIL=0
log() { echo "[$(date '+%F %T')] $*"; }
bad() { log "FAIL: $*"; FAIL=1; }

PORT=$(grep -E '^PORT=' /opt/config/dianzi51-admin/runtime.env 2>/dev/null | cut -d= -f2)
PORT=${PORT:-3001}

# 1. 代码目录必须真实存在。这是 8-13 故障的直接根因，优先检查。
LINK=/opt/apps/dianzi51-admin
TARGET=$(readlink -f "$LINK" 2>/dev/null || echo "")
if [ -z "$TARGET" ] || [ ! -d "$TARGET" ]; then
  bad "软链 $LINK 指向的目录不存在：$TARGET"
else
  log "OK 代码目录：$TARGET"
fi
[ -f "$LINK/dist/index.js" ] || bad "缺少 dist/index.js"
[ -f "$LINK/dist/public/index.html" ] || bad "缺少 dist/public/index.html"

# 2. 进程 cwd 不得指向已删除目录。"(deleted)" 是静默失效的明确信号。
for PID in $(pgrep -f "/opt/apps/dianzi51-admin/dist/index.js" 2>/dev/null); do
  CWD=$(readlink "/proc/$PID/cwd" 2>/dev/null || echo "")
  case "$CWD" in
    *"(deleted)"*) bad "PID $PID 的工作目录已被删除：$CWD" ;;
    "") ;;
    *) log "OK PID $PID cwd=$CWD" ;;
  esac
done

# 3. 本地 API 必须真实响应。auth.me 是无需登录的公开接口，
#    返回 200 说明 tRPC 路由与数据库连接均正常。
API=$(curl -s -o /dev/null -w '%{http_code}' -m 10 \
  "http://127.0.0.1:${PORT}/api/trpc/auth.me?input=%7B%7D" 2>/dev/null || echo 000)
[ "$API" = "200" ] && log "OK 本地 API auth.me=200" || bad "本地 API 异常：HTTP $API"

# 4. 对外站点必须返回 200 且是后台页面。
#    只查状态码不够：Nginx 可能回退到别的站点也给 200。
#
#    必须带 --compressed：本站 gzip_min_length=1024，而首页近 368KB，
#    必然被压缩。不解压则 grep 拿到的是二进制流，会恒定误报内容不匹配。
#    只请求一次并复用同一份响应：两次独立请求可能命中不同后端或缓存状态，
#    导致状态码与内容分歧。误报比漏报更有害——告警天天响，真出事时就没人看了。
RESP=$(curl -s --compressed -m 15 -w '\n__HTTP_CODE__%{http_code}' https://admin.51dianzi.com/ 2>/dev/null || echo "__HTTP_CODE__000")
CODE=$(printf '%s' "$RESP" | tail -1 | sed 's/.*__HTTP_CODE__//')
BODY=$(printf '%s' "$RESP" | sed 's/__HTTP_CODE__[0-9]*$//')
# 注意：不要在 if 条件里直接写 `printf ... | grep -q`。
# grep -q 匹配到就立即退出，上游 printf 会因管道提前关闭而收到 SIGPIPE，
# 在 set -o pipefail 下该失败会被传掭，使判定结果反转——交互式执行正常、
# 放进脚本却恒定误报。先算出计数再比较，避开该陷阱。
TITLE_HITS=$(printf '%s' "$BODY" | grep -ac "后台管理系统" || true)
if [ "$CODE" != "200" ]; then
  bad "站点异常：HTTP $CODE"
elif [ "${TITLE_HITS:-0}" -lt 1 ]; then
  bad "站点返回 200 但内容不是后台页面（可能回退到其它站点）"
else
  log "OK 站点 200 且内容正确"
fi

# 5. 静态资源哈希文件必须存在。index.html 引用的 JS 若 404，
#    页面会白屏，而首页仍返回 200，极易漏判。
ASSET=$(printf '%s' "$BODY" | grep -aoE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1 || true)
if [ -n "$ASSET" ]; then
  ACODE=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "https://admin.51dianzi.com${ASSET}" 2>/dev/null || echo 000)
  [ "$ACODE" = "200" ] && log "OK 静态资源 $ASSET=200" || bad "静态资源缺失：$ASSET HTTP $ACODE"
else
  bad "index.html 中未找到入口 JS 引用"
fi

# 6. uploads 必须指向 release 之外的持久目录。
#    若指回 release 内部，下次部署会丢失全部历史上传图片。
UP=$(readlink -f "$LINK/uploads" 2>/dev/null || echo "")
case "$UP" in
  /opt/shared/*) log "OK uploads 持久化：$UP" ;;
  "") bad "uploads 不存在" ;;
  *) bad "uploads 未指向持久目录（部署会丢图）：$UP" ;;
esac

# 7. 前台不得被误伤。admin 与前台完全独立，任何 admin 操作都不该影响前台。
FCODE=$(curl -s -o /dev/null -w '%{http_code}' -m 10 http://127.0.0.1:3000/ 2>/dev/null || echo 000)
[ "$FCODE" = "200" ] && log "OK 前台 3000=200" || bad "前台异常：HTTP $FCODE"

if [ "$FAIL" = "0" ]; then
  log "===== admin 健康检查全部通过 ====="
  exit 0
fi
log "===== admin 健康检查存在失败项 ====="
exit 1
