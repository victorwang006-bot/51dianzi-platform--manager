# 20261105-admin-navigation-priority-v1

本目录仅提供构建/发布工具。工具准备阶段未执行 SSH 生产写入、部署或 git 提交/push；主任务在已批准范围内负责最终集成和静态发布。本轮只修改此新目录，不修改导航/客户 agent 的源码，也不修改父级 plan/TODO。

完整路径选择和证据见 [DECISION.md](./DECISION.md)：客户组件与旧页面共享多个模块级 store/context，采用当前完整冻结源码的 **production frontend-only build**，不做旧 bundle 正则删 UI。实际起始 HEAD 是 `b29c118d17fd2cb09ebfb0baffdb2b4070186301`。构建记录 HEAD + 工作树状态 + 逐文件 SHA + 整体 sourceTree SHA；存在未提交修改时不冒充“已提交完整来源”。最终提交与 release plan 由父级掌管。

## 文件

- `build.mjs`：隔离冻结、真实 tsc、客户/渠道/导航回归测试与 Vite production 前端构建；不调用包含 server esbuild 的 `pnpm build`。
- `vite-worker.mjs`：沿用现有 Vite 插件/别名，强制 production、根路径 `/`、空 envDir，不加载 `.env`、不继承注入的 VITE 配置或凭据。不安装依赖；记录已安装版本和 pnpm-lock SHA。
- `lib.mjs`：固定全部八个只读基线 SHA；HTML 五项精确编辑与完整逆向还原验证。
- `publish.py`：默认只读 plan；`--verify-local` 只读本地包；将来经独立授权才可 `--apply` 或 `--rollback-html`。
- `test-html.mjs`、`test_publish.py`：离线安全测试，发布测试全部使用临时 fixture，mock PM2/网络/保护快照，不访问生产。

## 最终构建（父级声明源码冻结后）

```bash
cd /home/ubuntu/51dianzi-manager
node deploy/admin-navigation-priority-v1/test-html.mjs
python3 deploy/admin-navigation-priority-v1/test_publish.py
node deploy/admin-navigation-priority-v1/build.mjs --freeze
# 上条命令输出绝对 freezeRecord 路径；替换下方占位符：
node deploy/admin-navigation-priority-v1/build.mjs --build --freeze-record /absolute/run/freeze.json
# 构建成功后输出 packageDir；验证不访问生产：
python3 deploy/admin-navigation-priority-v1/publish.py --verify-local --package /absolute/run/package
```

默认隔离工作区为 `/home/ubuntu/backend-optimization/admin-navigation-priority-v1/`，`--work` 必须在共享仓库外。冻结复制 client/shared/server/drizzle/tests/patches 和构建配置/package/lock；server/schema/tests 源码只供实际全仓 tsc 类型检查与来源记录，绝不构建或发布 server bundle，绝不执行 SQL/migration。依赖复用已安装 node_modules，不复制、不安装。构建前/后对真实工作树、snapshot、工具文件、依赖版本再校验；任何漂移都 STOP，不产生可发布最终 manifest。

只运行真实 `pnpm exec tsc --noEmit --incremental false`，不删类型、不绕过报错。回归测试来自实际源文件；增加隔离 Vitest config，明确 include 选中的 `.test.ts` **及 `.test.tsx`**，避免原配置只收 `.ts` 导致 TSX 客户测试未执行。任何 tsc/test/build 失败保留日志与 exit code，但不生成最终 release manifest。

生成内容：`package/manifest.json`、`package/candidate-index.html`、`package/assets/<VERSION>-<sourceSha前12位>/...`、`package/evidence/` 下冻结记录/真实命令日志/checks/Vite manifest/Rollup 模块关系/HTML edits。静态图全部进入唯一版本目录，原文件不覆盖/不删除。构建器检查当前导航、CustomerList、星标 hook、渠道 Host、管理/批次模块实际进入新 chunk，并检查删除/恢复/回收站/上传批次 API 与 `ciTab` 标记。最终业务交互仍需父级隔离交互 QA；构建标记不替代交互证据。

## HTML 及旧功能

候选 HTML 基于现网八 SHA 锁定基线，只做五项编辑：解除三个已被当前源码包含的旧 importmap/CSS 覆盖块，替换主 module entry 标签，替换主 stylesheet 为新构建 CSS/modulepreload 标签。源文件正常编译不删 UI；旧 compiled chunks 不修改。除这五段外，inline Manus runtime、ResizeObserver 拦截、favicon/meta/root 均保留原字节；`html-edits.json` 可以逆向还原整个基线 HTML（Python 验证正确处理 UTF-16 offsets）。

发布前要求现有根 public/favicon 文件 SHA 与冻结源码一致；本轮不覆盖 root public 文件。若不一致 STOP，应只读核查并重新设计，不扩大本轮发布范围。

## 将来生产操作（本次未执行）

将成功 package 连同 `publish.py` 放入 `/opt/ops/20261105-admin-navigation-priority-v1/` 是未来独立授权后的 staging 操作，本任务不提供/执行 SSH 命令。生产执行器必须有与旧发布脚本一致的权限。共享全局锁、coord、PM2/静态 serving roots、tombstone-aware 当前 admin backend、NGINX/前台/worker/config/env 摘要保护不变。

在本地完成隔离授权状态 UI 与有效 server API 兼容性核验后，由父级创建 `qa-approval.json`，其格式如下（不要在 QA 前提前签 true）：

```json
{
  "manifestSha256": "成功 package/manifest.json 的实际 sha256",
  "approvedByTask": "FCQEBhhCo90HxcTxZAQUMk",
  "isolatedAuthorizedUiQaPassed": true,
  "serverApiCompatibilityPassed": true
}
```

后续生产执行器授权命令：

```bash
python3 /opt/ops/20261105-admin-navigation-priority-v1/publish.py --plan
# 以上只读，必须基线仍完全相同。后续只有明确授权才执行：
python3 /opt/ops/20261105-admin-navigation-priority-v1/publish.py --apply
# 若需回退且当前 HTML 仍为本 release：
python3 /opt/ops/20261105-admin-navigation-priority-v1/publish.py --rollback-html
```

`--apply` 强制 release 包路径，先验证全部制品/日志/源冻结/HTML 逆变换，再取 `/var/lock/dianzi51-public-deploy.lock`，检查 coord 的共享窗口，备份后台 HTML 和摘要，添加全新 namespace 资源并逐项 hash+localhost HTTP 验证，最终只对后台 `index.html` fsync + atomic replace。前台/现有资产/PM2 PID、重启计数、script/cwd/status、环境摘要与配置/运行代码 SHA 均前后保护；原资产同时比较 byte hash 与 stat metadata。

生产 HTML：`/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public/index.html`。

admin backend 保持：`/opt/releases/20261104-channel-inventory-ci-management-v1/admin/dist/index.js`，其 `public/index.html` resolved serving root 必须确实等于上述 HTML；front 静态 root 必须不同。检查 localhost admin/front health 与 admin 公网 HTML/全部新资产 SHA，无登录账号或业务写请求。

出现异常：仅当当前 HTML hash 仍是本轮候选才自动回退 HTML；若变成其他 release，不碰该 HTML。始终保留所有旧与新资产，不回滚服务器/DB/data/config/env。不允许直接重放 partial/applied 目录：需要人工查 `before-state.json`、`applied.json`、`stopped.json`、current HTML 和 coord。中断导致 coord active 则 STOP，不自动清理未知 owner。

## 当前离线证据

- 工具安全测试日志：`/home/ubuntu/backend-optimization/admin-navigation-priority-v1/evidence/html-safety-tests.log`、`publisher-safety-tests.log`。
- 当前工作源码真实 tsc 日志：`/home/ubuntu/backend-optimization/admin-navigation-priority-v1/evidence/current-source-typecheck.log` 与 `.exit-code`。它是并行开发期间的一次检查，不是最终冻结后的通过证据。
- `tool-validation/` 只供离线工具链实测，不是父级最终版本批准；最终 freeze/build/隔离交互 QA 必须由父级确认。任何新来源提交、源码/CSS/工具改动都需重新 freeze/build。

不读取/输出凭据：构建子进程白名单环境，禁 `.env`/private key 路径；发布器不读取登录/SSH/DB 凭据，PM2 输出只在内存抽取 process metadata 与一向 env hash，不持久化原 env，不输出保护配置内容。保护文件仅作 opaque SHA，不解析内容。
