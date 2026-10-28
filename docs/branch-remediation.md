# 历史分支整改台账

采集基线：`fc456eabc3f74ac4b8b5b080a74ca1e6612e6f77`。

本轮有 14 个历史分支头未被 main 历史包含。尚无证据要求立即合并某个旧分支；本轮不自动合并、删除或恢复旧业务。

本清单记录提交与文件差异，不代表功能一定缺失。git cherry 的不同补丁标识仍可能对应 squash 或替代实现。负责人和需求验收状态未确认，不作猜测。

## 处置流程

优先核对企业权限/数据范围、订单/支付、库存和消息幂等相关需求，再处理其他改动。对每个分支登记业务负责人、当前需求、替代实现、迁移影响及验收测试。

已确认被替代的分支写明对应 main 提交后留档；确需整合的内容从最新 main 整理最小补丁，经隔离测试后走 PR；已废弃的写明关闭理由。不得直接批量合并，也不得把旧迁移脚本直接运行于生产。

完整机器清单见 `docs/branch-remediation-inventory.json`。

## 逐分支事实清单

### `feat/portal-users-home-price`

分支头：`a20ab168cc4e91183c586aeb5cb68cd3abb96d57`；分支侧差异涉及 36 个文件。补丁历史中相同补丁 0 个，未匹配补丁 10 个。

负责人：待确认。处置：待需求与当前实现核验，不自动合并。

包含 schema/迁移候选路径，合并前必须检查测试数据库及回退影响：

- `drizzle/0019_medical_vengeance.sql`
- `drizzle/meta/0019_snapshot.json`
- `drizzle/meta/_journal.json`
- `drizzle/schema.ts`

### `feat/sales-owner-scope-v1`

分支头：`27368877acf0ee91dcf11992e7f43ccb0b7ac48d`；分支侧差异涉及 52 个文件。补丁历史中相同补丁 0 个，未匹配补丁 21 个。

负责人：待确认。处置：待需求与当前实现核验，不自动合并。

包含 schema/迁移候选路径，合并前必须检查测试数据库及回退影响：

- `drizzle/0019_medical_vengeance.sql`
- `drizzle/meta/0019_snapshot.json`
- `drizzle/meta/_journal.json`
- `drizzle/schema.ts`
- `scripts/apply-sales-permissions-schema.mjs`

### `feature/admin-order-management`

分支头：`3f835080e34a9adaa310ab9950690fe9e65f81c6`；分支侧差异涉及 21 个文件。补丁历史中相同补丁 0 个，未匹配补丁 4 个。

负责人：待确认。处置：待需求与当前实现核验，不自动合并。

包含 schema/迁移候选路径，合并前必须检查测试数据库及回退影响：

- `drizzle/0019_medical_vengeance.sql`
- `drizzle/meta/0019_snapshot.json`
- `drizzle/meta/_journal.json`
- `drizzle/schema.ts`

### `feature/bom-inquiry-table`

分支头：`81a6837b6d9135216561124f638a4be785646729`；分支侧差异涉及 3 个文件。补丁历史中相同补丁 0 个，未匹配补丁 1 个。

负责人：待确认。处置：待需求与当前实现核验，不自动合并。

### `feature/chat-outbox-idempotency`

分支头：`85da0ccf6efe40a892aba1de7778741b197fbcc2`；分支侧差异涉及 11 个文件。补丁历史中相同补丁 0 个，未匹配补丁 2 个。

负责人：待确认。处置：待需求与当前实现核验，不自动合并。

包含 schema/迁移候选路径，合并前必须检查测试数据库及回退影响：

- `drizzle/0019_medical_vengeance.sql`
- `drizzle/meta/0019_snapshot.json`
- `drizzle/meta/_journal.json`
- `drizzle/schema.ts`

### `feature/external-catalog-import`

分支头：`d8c385fcfb44802dc630a44c1a69354d1fca2053`；分支侧差异涉及 10 个文件。补丁历史中相同补丁 0 个，未匹配补丁 3 个。

负责人：待确认。处置：待需求与当前实现核验，不自动合并。

包含 schema/迁移候选路径，合并前必须检查测试数据库及回退影响：

- `drizzle/0019_omniscient_the_stranger.sql`
- `drizzle/meta/0019_snapshot.json`
- `drizzle/meta/_journal.json`
- `drizzle/schema.ts`
- `scripts/apply-external-catalog-schema.mjs`

### `fix/admin-navigation-user-refresh-message-types`

分支头：`ee5eb4dad5ec7e85eb989f28d040a96bb53f0402`；分支侧差异涉及 26 个文件。补丁历史中相同补丁 0 个，未匹配补丁 7 个。

负责人：待确认。处置：待需求与当前实现核验，不自动合并。

包含 schema/迁移候选路径，合并前必须检查测试数据库及回退影响：

- `drizzle/0019_medical_vengeance.sql`
- `drizzle/meta/0019_snapshot.json`
- `drizzle/meta/_journal.json`
- `drizzle/schema.ts`

### `fix/crm-duplicate-company-message`

分支头：`f2106dd7bcab6ad4488a941a26d6879fa483135b`；分支侧差异涉及 23 个文件。补丁历史中相同补丁 0 个，未匹配补丁 5 个。

负责人：待确认。处置：待需求与当前实现核验，不自动合并。

包含 schema/迁移候选路径，合并前必须检查测试数据库及回退影响：

- `drizzle/0019_medical_vengeance.sql`
- `drizzle/meta/0019_snapshot.json`
- `drizzle/meta/_journal.json`
- `drizzle/schema.ts`

### `fix/crm-enabled-cem-message`

分支头：`aacee6d2462d6dcbcc549f0c8eb6d02d8be4f1cb`；分支侧差异涉及 23 个文件。补丁历史中相同补丁 0 个，未匹配补丁 6 个。

负责人：待确认。处置：待需求与当前实现核验，不自动合并。

包含 schema/迁移候选路径，合并前必须检查测试数据库及回退影响：

- `drizzle/0019_medical_vengeance.sql`
- `drizzle/meta/0019_snapshot.json`
- `drizzle/meta/_journal.json`
- `drizzle/schema.ts`

### `fix/erp-visible-branding`

分支头：`5778eb29d5d52d6f15021792682434c600330059`；分支侧差异涉及 31 个文件。补丁历史中相同补丁 0 个，未匹配补丁 9 个。

负责人：待确认。处置：待需求与当前实现核验，不自动合并。

包含 schema/迁移候选路径，合并前必须检查测试数据库及回退影响：

- `drizzle/0019_medical_vengeance.sql`
- `drizzle/meta/0019_snapshot.json`
- `drizzle/meta/_journal.json`
- `drizzle/schema.ts`

### `fix/log-noise`

分支头：`c6ced912cec0f9181f113813d53aadce5fb435f5`；分支侧差异涉及 16 个文件。补丁历史中相同补丁 0 个，未匹配补丁 3 个。

负责人：待确认。处置：待需求与当前实现核验，不自动合并。

包含 schema/迁移候选路径，合并前必须检查测试数据库及回退影响：

- `drizzle/0019_medical_vengeance.sql`
- `drizzle/meta/0019_snapshot.json`
- `drizzle/meta/_journal.json`
- `drizzle/schema.ts`

### `fix/merchant-top-scroll`

分支头：`431833e4a97dacf387ab524baf3ad0d2f0f39ffd`；分支侧差异涉及 37 个文件。补丁历史中相同补丁 0 个，未匹配补丁 12 个。

负责人：待确认。处置：待需求与当前实现核验，不自动合并。

包含 schema/迁移候选路径，合并前必须检查测试数据库及回退影响：

- `drizzle/0019_medical_vengeance.sql`
- `drizzle/meta/0019_snapshot.json`
- `drizzle/meta/_journal.json`
- `drizzle/schema.ts`

### `fix/order-material-codes-20260903`

分支头：`4596635cd74662cca2e67f3e84bd86a0317ca632`；分支侧差异涉及 2 个文件。补丁历史中相同补丁 0 个，未匹配补丁 2 个。

负责人：待确认。处置：待需求与当前实现核验，不自动合并。

### `fix/portal-users-compact-layout`

分支头：`17293350895bb09541852bd442f49fcdee367017`；分支侧差异涉及 36 个文件。补丁历史中相同补丁 0 个，未匹配补丁 11 个。

负责人：待确认。处置：待需求与当前实现核验，不自动合并。

包含 schema/迁移候选路径，合并前必须检查测试数据库及回退影响：

- `drizzle/0019_medical_vengeance.sql`
- `drizzle/meta/0019_snapshot.json`
- `drizzle/meta/_journal.json`
- `drizzle/schema.ts`
