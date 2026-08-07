# 阶段 D：后台子域灰度

## 一、目标与不变项

阶段 D 将后台新增到 `https://admin.51dianzi.com/`，并在灰度期继续保留 `https://51dianzi.com/admin/`。新入口不新增 PM2 进程，不迁移数据库，不复制上传文件，也不改变后台账号和权限；两个入口复用现有 `dianzi51-admin` 两个 cluster 实例（端口 3001）与 RDS。

| 项目 | 主站兼容入口 | 子域灰度入口 |
|---|---|---|
| URL | `/admin/` | `admin.51dianzi.com/` |
| 前端基址 | `/admin/` | `/` |
| 构建 | `pnpm build:admin` | `pnpm build:subdomain` |
| 制品 | 现有后台 release | 独立子域静态 release |
| API | `/admin/api/trpc` → 3001 | `/api/trpc` → 3001 |
| 上传 | `/admin/uploads/` | `/uploads/` |
| 登录 Cookie | 主站 host-only | 子域 host-only |

## 二、发布前门禁

子域构建必须执行：

```bash
pnpm check
pnpm build:subdomain
pnpm verify:subdomain-build
```

校验器必须确认入口 HTML 只引用 `/assets/`，入口 bundle 只使用 `/api/trpc` 与根路由基址，且没有 `/admin/assets/`、`/admin/api/trpc` 或 `/admin/` 路由基址残留。旧 `/admin/` 构建也必须继续通过：

```bash
pnpm build:admin
pnpm verify:admin-build
```

完成旧入口检查后需要重新执行 `build:subdomain`，确保待上传目录最终为子域制品。

## 三、DNS 与证书

`admin.51dianzi.com` 使用独立 DV TLS 证书，证书 SAN 必须包含精确主机名。证书安装为：

```text
/etc/nginx/ssl/admin.51dianzi.com.pem
/etc/nginx/ssl/admin.51dianzi.com.key
```

私钥权限必须为 `0600`。证书申请若使用 DNS 验证，应先添加验证记录，证书签发并下载 Nginx 格式后再安装业务 server block。业务 A 记录指向生产 ECS `47.97.108.147`，灰度 TTL 使用短值。当前主站证书不得覆盖、移动或替换。

## 四、Nginx 与静态制品

生产模板为 `deploy/nginx/dianzi51-admin-subdomain.conf.example`。启用前必须把子域根路径制品放入版本化 release，并原子切换：

```text
/opt/apps/dianzi51-admin-subdomain -> /opt/releases/<release-id>/dianzi51-admin-subdomain
```

Nginx 需要满足以下边界：HTTP 仅重定向 HTTPS；精确 `server_name`；`/assets/` 缺失时返回 404；`/api/` 代理 3001；`/uploads/` 复用现有上传目录；HTML 不缓存；`robots.txt` 与 `X-Robots-Tag` 禁止收录。灰度期不设置 HSTS，以便独立撤回子域。

## 五、启用与健康门禁

切换前备份现有 Nginx 配置，并在临时路径写入新配置与证书。执行 `nginx -t` 成功后再原子移动到 `/etc/nginx/conf.d/` 并 reload。DNS 尚未生效时使用 `curl --resolve` 验证：

```bash
curl --resolve admin.51dianzi.com:443:127.0.0.1 https://admin.51dianzi.com/
curl --resolve admin.51dianzi.com:443:127.0.0.1 https://admin.51dianzi.com/login
curl --resolve admin.51dianzi.com:443:127.0.0.1 \
  'https://admin.51dianzi.com/api/trpc/system.health?input=%7B%22json%22%3Anull%7D'
```

生产验收至少覆盖证书主机名与有效期、HTTP→HTTPS、首页、登录页、深链接、JS/CSS MIME、缺失哈希 404、tRPC、上传文件、robots、两实例在线、旧 `/admin/` 入口无回归，以及浏览器登录后路由和数据读取。

## 六、回滚

子域异常时先删除或移出子域 Nginx 配置，执行 `nginx -t && nginx -s reload`，再删除或回退 `admin` A 记录。旧 `/admin/` include、后台 3001 进程、RDS 和上传目录始终不变，因此不需要回滚应用进程或数据库。证书文件可保留供排障，不得删除主站证书。
