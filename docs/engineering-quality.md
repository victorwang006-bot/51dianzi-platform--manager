# 工程质量与测试门禁

## 默认安全门禁

本仓库的默认测试命令是 `pnpm test`，它等价于 `pnpm test:unit`。该命令不是全量测试或 coverage 门槛；首批业务回归门禁仅包含已经在健康检查中验证的两份纯单元测试：

- `client/src/components/admin/adminWorkbenchNavigationModel.test.ts`（7 个用例）
- `server/merchantLicenseAccess.test.ts`（5 个用例）

两份测试合计 12 个既有业务用例。额外的 `scripts/testing/**/*.test.ts` 只验证测试运行器、环境隔离和网络防护本身。此选择是为了先建立可重复、无外部依赖的 PR 门禁，**不表示全仓测试覆盖率，也不表示生产行为的完整一致性验证**。

`vitest.unit.config.ts` 是默认 Vitest 配置，并且有三层保护：

1. allowlist 只发现上述业务测试和测试基础设施回归；未分类旧 `*.test.ts` 文件仍保留在仓库中，但不会被 `pnpm test` 自动执行；
2. 运行器和 preload 只保留最小运行时环境，移除数据库、支付、OSS、OAuth、云凭据和 dotenv 配置变量；测试配置将 `dotenv`/`dotenv/config` 指向空实现，因此不会读取本机或生产 `.env`；
3. preload/setup 在导入测试模块前阻止 TCP、UDP、HTTP、HTTPS、TLS、`fetch`、`WebSocket` 和 `XMLHttpRequest`。需要网络、数据库或第三方服务的测试必须改为显式的集成测试，不得绕过该保护。

常用命令：

```bash
pnpm check
pnpm build:admin && pnpm verify:admin-build
pnpm build:subdomain && pnpm verify:subdomain-build
pnpm test
pnpm lint
```

`pnpm lint` 仅检查本次新增或维护的治理基础设施（workflow、测试配置/运行器、package/workspace 配置和本文档）的 Prettier 格式及 Node/测试配置语法。它有意不把遗留全仓格式问题作为当前 PR 的阻断条件。

## 集成测试：显式本地测试库许可

集成测试不会由默认测试或 CI 自动运行。`pnpm test:integration` 必须同时具有：

```bash
ALLOW_TEST_DB=1 \
TEST_DATABASE_URL='mysql://tester:password@127.0.0.1:3306/platform_test' \
pnpm test:integration
```

运行器会在启动 Vitest 前拒绝缺失参数、非 `mysql://` 协议、非 `localhost`/`127.0.0.1`/`::1` 主机，或数据库名不以 `_test` 结尾的 URL。它只把 `ALLOW_TEST_DB`、`TEST_DATABASE_URL` 和少量运行时变量传给子进程；不会传入常规 `DATABASE_URL`、支付、OSS、OAuth 或其他父进程秘密变量。集成测试配置仅发现明确命名为 `*.integration.test.ts` 的文件，未分类旧测试不会被自动纳入。

即使参数通过，调用者仍必须确保本机测试库独立、可销毁且没有生产数据。当前整改没有添加迁移、清理、部署或数据库访问行为。

## CI 与分支治理边界

`.github/workflows/quality.yml` 会在 PR 以及 `main` 和 `chore/health-remediation-20261028` 的 push 上执行锁定依赖安装、实际依赖补丁验证、类型检查、两种前端制品构建与验证、allowlisted unit 测试和窄范围治理 lint。工作流固定 Node `22.23.4` 与 pnpm `10.4.1`，使用 `--frozen-lockfile --ignore-scripts`，仅声明 `contents: read` 权限，不引用生产 secrets，也没有自动部署步骤。

本轮未更改或核实分支保护设置；该 workflow 本身不能阻止绕过检查的合并。启用 required status checks、限制直接推送和审阅规则需要由仓库管理员在 GitHub 设置中完成。

历史远端分支不会因“尚未合入”而自动影响当前 `main` 的可用性，也不应批量合并。应按需求逐项核对其目标、当前替代实现、迁移影响和测试状态；距离主线较远且包含迁移/脚本的历史分支应在专门评审后处理。

## 固定版本的依赖补丁验收

pnpm 固定为 10.4.1。该版本实际读取根 `package.json` 的 `pnpm.patchedDependencies` / `pnpm.overrides`，因此本轮保留此唯一有效来源，workspace 保留原有包选择与构建许可项。原锁文件及依赖版本不变。安装后 CI 执行 `node scripts/verify-dependency-patch.mjs`，验证配置、补丁元数据和已安装 wouter 的实际补丁；不把较新启动器的弃用警告直接解释为当前固定版本的补丁失效。

集成测试另有 setup 网络守卫，只允许经验证的 loopback MySQL 主机和端口，阻断其他 TCP、HTTP(S)、UDP 与 dotenv 加载。没有集成用例时不会返回成功，避免空测试集被误当作完整验收。
