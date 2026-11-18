# 客户“待补全”误报修复 — 2026-11-18

## 边界

仅修改客户完整性 helper、CustomerList、CustomerDetail 和新/相关 tests。本任务不提交或推送 Git，不访问生产、网络或浏览器，不改数据库，不引入新权限、接口或常驻进程，不修改库存、销售、profiles 等其他业务实现。所有新增测试均使用合成客户/联系人、保留示例域名或虚构号码。

## 验收 criteria

- [x] 统一新模型：客户名称非空 + 有效主联系人姓名非空 + 主联系人至少一种有效活跃联系方式。
- [x] 支持 mobile / landline / wechat / qq / email / other。手机和座机采用现有电话格式规则；邮箱采用现有邮箱规则；微信、QQ、其他采用现有联系方式 schema 的非空文本规则，不额外强制电话。
- [x] 微信-only、QQ-only、邮箱-only 及其他联系方式不误报。不把微信写成电话，不补造 phone，不改任何数据库或业务投影。
- [x] legacy 的 other 历史联系方式保持读取兼容；不重新要求其满足新电话格式。
- [x] 已确认摘要 primaryContact=null、主联系人缺名、methods=[] 或仅无效方法判定未完整；旧 contactName/phone 不可覆盖摘要结果。
- [x] 服务只返回活跃 profile/method。停用联系人和停用方式在摘要中分别表现为 null 主联系人或过滤后的 methods；测试覆盖这两种结果，不用旧电话复活停用信息。
- [x] helper 保留原单参数调用行为；显式传入 undefined 返回 undefined（未核验），不是 false（已完整）。客户名称缺失可直接返回 true。
- [x] 新增纯导出 customerContactSummaryQueryVerified(query, scopeReady)：scope 已就绪、isSuccess=true、isFetchedAfterMount=true，且无 pending/fetching/error/placeholder 才通过。无任何副作用。
- [x] 列表保留一条当前已授权页 contactsSummary 查询及 Map，不逐行读取完整联系人列表；添加 freshListOptions、placeholderData=undefined 和原列表授权门槛，不放宽 guards。
- [x] 列表仅把当前页 ID、唯一摘要项且验证成功的数据纳入 Map；错页/缺行/旧身份/错误/加载/占位/未验证缓存不触发补全徽标，不宣称已完整。
- [x] 详情只增加一条 scope/customerId guarded contactsSummary query，要求 validId、authorityReady、已验证 customer、contactScope.ready/scope；复用 freshListOptions，不改变原 context/detail guard。
- [x] 详情只使用当前客户单项摘要；错 customerId、缺行、加载、错误、placeholder 或未取得当前 mount 的新鲜读取证据时不触发补全提示。
- [x] 详情“补齐基本资料后保存”改为客户名称、管理联系人中的主联系人姓名及至少一种有效联系方式；历史查看和追加跟进保持原行为。
- [x] 核心 helper 可独立 bundle/compile，未运行或重编全站组件作为发布产物。本 source 改动可供主任务限定 AST 最小替换。

## 修改文件

- `client/src/business/platform/shared/crmCustomers.ts`
- `client/src/business/platform/client/src/pages/CustomerList.tsx`
- `client/src/business/platform/client/src/pages/CustomerDetail.tsx`
- `client/src/business/platform/shared/crmCustomers.completion.test.ts`（新增）
- `client/src/business/platform/client/src/pages/CustomerList.render.test.ts`
- `client/src/business/platform/client/src/pages/CustomerDetail.memory.test.ts`
- `client/src/business/platform/client/src/components/customers/CustomerContacts.restore.test.tsx`（query fixture 明确 isSuccess）
- 本独立 TODO 文件。

## 检查记录

### 本次专项

```sh
pnpm vitest run \
  client/src/business/platform/shared/crmCustomers.completion.test.ts \
  client/src/business/platform/client/src/pages/CustomerList.render.test.ts \
  client/src/business/platform/client/src/pages/CustomerDetail.memory.test.ts \
  -t 'customer completion uses|current authorized contacts summary query proof|CustomerList contact completeness badges|CustomerDetail contact completeness'
```

结果：**3 files passed；61 passed，187 skipped**。覆盖六种联系方式、缺客户名/主联系人名、空 methods、无 primary、停用投影、legacy、未知/加载/错误/placeholder/cache、错客户和权限 guard。

### 已有相关回归

上述三文件不加 `-t`：**247 passed / 1 failed**。详情 126/126、helper 30/30 均通过。列表唯一失败为原库存导入测试 `refreshes the bounded summary after the real importer completion event and locates the real channel`，错误是找不到“预览并校验”按钮；不属于本次 completion 断言，未修改库存实现或该断言。初次列表运行还发现原 fixture 未 mock 新信息 QueryClient 依赖，已仅在相关列表 test 中提供无网络的静态新信息 hook mock。

独立编译：`pnpm exec esbuild client/src/business/platform/shared/crmCustomers.ts --bundle --platform=node --format=esm --outfile=/home/ubuntu/diagnosis/customer-completion-helper.mjs` 成功。

`git diff --check` 通过。全仓库 `pnpm exec tsc --noEmit` 检查结果另行在下方记录；不得据专项通过声称全仓库无误。

## 未执行 / 后续

- [ ] 主任务完成限定 AST 增量发布和当前产物验证（本子任务未访问生产或网络）。
- [ ] 原库存导入测试缺失“预览并校验”按钮的独立排查；不在本次修复授权范围内。

### 全仓库类型检查

`pnpm exec tsc --noEmit` 返回 exit 2；唯一诊断为 `server/services/adminNewInformationSources/mall.ts(8,8) TS2307`，缺少 `../../../../51dianzi-platform/shared/adminNewInformationFacts` 模块/类型。该文件和路径均未在本次修改范围内，未为使检查变绿而修改。日志没有本次 helper/list/detail/tests 的 TypeScript 诊断。

检查日志保存在仓库外：`/home/ubuntu/diagnosis/completion-focused-test.log`、`/home/ubuntu/diagnosis/completion-targeted-test.log`、`/home/ubuntu/diagnosis/completion-typecheck.log`。
