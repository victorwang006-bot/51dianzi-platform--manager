# dianzi51-admin 部署与运维

管理后台 `admin.51dianzi.com` 的完整部署流程。本目录下所有脚本均可安全提交仓库，
不含任何凭据。

## 架构

后台与前台**完全独立**，互不干扰：

| | 前台 | 后台 |
|---|---|---|
| 域名 | 51dianzi.com | admin.51dianzi.com |
| 仓库 | 51dianzi-platform | 51dianzi-platform--manager（本仓库） |
| 端口 | 3000 | 3001 |
| 主库 | dianzi51 | dianzi51_admin |
| PM2 应用 | dianzi51 / -chat-sync / -refund | dianzi51-admin |
| 配置目录 | /opt/config/dianzi51 | /opt/config/dianzi51-admin |

后台通过 `PLATFORM_DB_NAME=dianzi51` 跨库访问前台业务数据，这是后台的正常职责。

## 服务器路径

```
/opt/apps/dianzi51-admin            软链 → 当前 release（PM2 cwd 与 /uploads/ alias 使用）
/opt/apps/dianzi51-admin-subdomain  软链 → 当前 release（Nginx 静态根使用）
/opt/apps/releases/dianzi51-admin-* 历史 release
/opt/shared/dianzi51-admin/uploads  上传文件（业务数据，release 之外）
/opt/config/dianzi51-admin/
  ├── runtime.env                   凭据（600，服务器唯一权威来源，不入库）
  ├── ecosystem.config.cjs          PM2 配置（从本目录 production 版复制而来）
  └── healthcheck-admin.sh          健康巡检（cron 每 10 分钟）
/var/log/dianzi51/admin-health.log  巡检日志
```

## 部署流程

### 1. 构建（本地/沙箱）

```bash
pnpm install --frozen-lockfile
npx tsc --noEmit                      # 类型检查
pnpm build:subdomain                  # 子域形态构建
bash scripts/verify-subdomain-build.sh # 必须通过
```

> **形态不可混用。** `build:subdomain` 用于 `admin.51dianzi.com`，
> `build:admin` 用于 `/admin/` 路径形态。两者的静态资源路径与 API 前缀不同，
> 装错的症状是「页面能打开但所有请求 404」，非常隐蔽。
> `verify-subdomain-build.sh` 专门拦截此错误，务必执行。

### 2. 打包

```bash
tar -czf admin-dist.tar.gz \
  dist package.json pnpm-lock.yaml pnpm-workspace.yaml patches drizzle shared
```

> **`patches/` 与 `pnpm-workspace.yaml` 必须包含。** 本项目对 `wouter@3.7.1`
> 打了 pnpm patch，缺失会导致服务器上 `pnpm install` 直接 ENOENT 失败。
> `deploy-admin.sh` 已内置该校验，且校验发生在切换软链之前。

### 3. 部署

```bash
scp admin-dist.tar.gz deploy/deploy-admin.sh root@<server>:/tmp/
ssh root@<server> 'bash /tmp/deploy-admin.sh /tmp/admin-dist.tar.gz'
```

脚本会依次完成：产物完整性校验 → 依赖复用 → uploads 软链 → 原子切换 →
仅重启 admin → 健康检查 → 确认前台未受影响。

### 4. 验证

```bash
ssh root@<server> 'bash /opt/config/dianzi51-admin/healthcheck-admin.sh'
```

## 首次部署 / 灾难恢复

若 `/opt/config/dianzi51-admin/runtime.env` 不存在：

```bash
# 情况一：admin 进程仍在运行（哪怕已失能），可从进程内存提取凭据
bash deploy/extract-admin-runtime-env.sh

# 情况二：进程已不存在，凭据无法自动恢复，须手工重建
cp deploy/ecosystem.config.production.cjs /opt/config/dianzi51-admin/ecosystem.config.cjs
# 然后手工编写 runtime.env，参考 ecosystem.config.example.cjs 的变量清单
```

> **凭据抢救的时间窗口。** `JWT_SECRET` 与 `PORTAL_API_KEY` 只存在于运行进程的
> 环境变量中，仓库与服务器配置文件里都没有。若在排查故障时先 kill 进程，
> 这些值将永久丢失：`JWT_SECRET` 丢失会使所有管理员登录态失效且无法复原，
> `PORTAL_API_KEY` 丢失会切断后台与前台的对接通道。
> **任何情况下，先跑 `extract-admin-runtime-env.sh` 再动进程。**

## 历史故障与防护

### 2026-08-13：后台静默停摆 3 天

**现象**：`admin.51dianzi.com` 返回 404，但 PM2 显示 `online`、内存正常、无错误日志。

**根因**：两个软链指向 `/opt/releases/20260813T085614Z-.../`，该目录在一次部署中被
清理。Linux 不会释放已打开文件的内容，进程因此存活，但静态目录与路由均已失效，
且**一旦重启就再也起不来**。

**为什么 3 天无人发现**：「进程存活」不等于「服务可用」。只看 `pm2 list` 会被完全误导。

**本次建立的防护**：

| 防护 | 针对的问题 |
|---|---|
| release 移至 `/opt/apps/releases/` | 不再放临时区，避免被其它流程清理 |
| 进程 cwd 指向稳定软链 | 不绑定具体 release 目录 |
| uploads 移出 release，软链接入 | 切换版本不再丢失历史上传图片 |
| 凭据固化为 runtime.env | 不再只存在于进程内存 |
| ecosystem 缺 JWT_SECRET 即拒绝启动 | 避免用错配置静默启动 |
| 巡检检查真实业务响应而非进程状态 | 直接针对本次故障的漏判模式 |
| 巡检检查 cwd 是否含 `(deleted)` | 直接针对本次故障的根因信号 |
| 部署脚本在切软链前校验产物 | 失败时线上保持原状，不留半成品 |

## 互不干扰的重启命令

```bash
# 前台（不影响后台）
pm2 reload /opt/config/dianzi51/ecosystem.config.cjs \
  --only dianzi51,dianzi51-chat-sync,dianzi51-refund

# 后台（不影响前台）
pm2 startOrReload /opt/config/dianzi51-admin/ecosystem.config.cjs \
  --only dianzi51-admin
```

> 两侧都必须带 `--only`。前台的 ecosystem 不包含 `dianzi51-admin`，
> 不加 `--only` 执行 `pm2 reload <file>` 时 PM2 会按文件内容重整进程列表，
> 可能影响到不在该文件中的应用。

## 回滚

```bash
ls -dt /opt/apps/releases/dianzi51-admin-* | head -5   # 查看历史版本
ln -sfn <上一版本目录> /opt/apps/dianzi51-admin.tmp
mv -Tf /opt/apps/dianzi51-admin.tmp /opt/apps/dianzi51-admin
ln -sfn <上一版本目录> /opt/apps/dianzi51-admin-subdomain.tmp
mv -Tf /opt/apps/dianzi51-admin-subdomain.tmp /opt/apps/dianzi51-admin-subdomain
pm2 restart dianzi51-admin
bash /opt/config/dianzi51-admin/healthcheck-admin.sh
```
