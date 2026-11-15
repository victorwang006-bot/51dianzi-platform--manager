# 来源客户 + 编辑：最终独立定点复核

**结论：PASS。B1、B2 均准确关闭，本次两项不再构成阻断；明确允许本轮已限定范围的有限 incremental 候选发布。**

复核时间：2026-11-15 15:18–15:20（UTC+8）。本结论仅绑定下列最终 actual 哈希及已核对的冻结源码，取代上轮 `independent-review.md` 对 B1/B2 的 BLOCKED 判断。不声称已上线，不扩大本轮发布范围，不追加新的测试或泛化安全审查要求。

## B1：CLOSED

`channelInventory.ts:497–520, 764–807` 的 official 旧 `findMaterial/listMaterials/getMaterial` 已统一到 `projectOfficialMaterialManagement`：读取共同 `canManageMaterial` SQL，并与**当前实际** `resolveChannelInventoryAuthority(..., "stocks", false, true).write` 及 `linkedCompany/materialManagementProjection` 相交。来源、company、canEditMaterial、canEdit、readOnly 使用同一投影，不再仅凭 signed write、来源 SQL 或负责人标签。

`getMaterial` 不覆盖 official 投影的 edit flags，`listMaterials` 不再通过旧 CRM helper 二次恢复客户名称；无渠道名 fallback。该输出 gate 未整体过滤原库存 WHERE/计数，原可读 note 保留；native 旧读取/投影分支保留。最终现有报告的 6 条 B1 断言均 passed，包含 signed write=1 但 ERP writeAllowed=0 时 find/list/get 保留 stock/note、同时拒绝客户来源与 canEdit 的组合。

## B2：CLOSED

`channelMaterialManagement.ts:70–103` 的共同 SQL 已仅在 leader 分支加入当前 ERP stocks setting scalar：按 enterprise/user/module=stocks 绑定，`ORDER BY revision DESC, id DESC LIMIT 1 FOR UPDATE`。最新 setting 必须严格 `BINARY ... = BINARY 'team'` 且 revision 为有效安全正整数；self、enterprise、无效 scope/revision 不允许 leader 跨录入人管理。缺 setting 的默认 team 处于现有当前 active、唯一有效 team joins 内，并非无团队兜底授权。

关键逻辑为 `creator OR (leaderTeamScope AND leader)`：严格原始 creator 独立保留，未被错误套入 leader 的 scope 限制。该共同 SQL 继续流经列表、来源 getter/options、打开编辑及保存，调用方仍相交实际 access.write 与 CRM gate。现有最终报告的 8 条 B2 断言均 passed，覆盖 paired/actor-bound leader、最新 revision/id 与主体边界、失效团队、creator 独立及实际 SQL 结果串接来源/选项/旧保存。

## 关键 gate 与 actual/source 对齐：PASS

旧 official `updateMaterial` 仍委托严格公共 `updateTeamMaterial`，signed UUID、schema 对 note/channel/currency/responsibility 等字段的拒绝、授权先于 replay/CAS/DML 均未回退；native 旧保存前置 `authorizedMaterial`，原 owner/private 字段体继续保留。`sourceOptions/getTeamMaterialSource` 使用 management + actual write + CRM；all-source DTO 的 company/customerSource/channelSource/canViewSource/edit/readOnly 同步遮罩，无渠道名回退。

本复核独立只读解析 actual AST、静态编译源片段并按生成器明确符号映射比对，以下 11 个函数/方法与当前 source 一致：`officialMaterialRecorderStaffUserId`、`teamMaterialManagementEligibility`、`materialManagementProjection`、`channelCustomerMaterialReadGate`、`projectOfficialMaterialManagement`、`findMaterial`、`teamMaterialSourceEligibility`、`listMaterials`、`getMaterial`、`getTeamMaterialSource`、`listTeamSourceOptions`。另直接检查 actual 旧保存、authorizedMaterial 与列表全来源投影关键 gate。没有加载或执行整包，也没有重新生成补丁。

## 参考字节与 pin：PASS

独立按现有 patchproof 在内存逆向恢复并比较完整 baseline，front 27 spans、admin 3 spans 均成功；每一未触及字节区间保持一致，整包仅解析语法。front 42 个 protected 函数原字节一致，其中 38 个 price/reference 函数；admin `readApprovedChannelReferenceMaterials` 与 `createChannelReferenceRouter` 原字节一致。原 savedref 公共库存验证路径与已保存参考价读取没有被本轮来源/编辑 gate 替代。

`backend/FINAL-SOURCE-HASHES.json` 的 45 项源/测试/生成器/工件 bytes 与 SHA 当前全部匹配。父任务冻结的 172 项源码在 repo 与 `source-final` 均无 drift；native source 烟测记录的 25 项依赖也与当前源码一致。

| 最终工件 | SHA256 |
|---|---|
| front baseline | `6c217218ed880f3c5ba9f1086a12bd20bdc517615184d6a6fef023b87c59b995` |
| **front final** | `132c2a9924da37ccb50fadeb014865400df5cddf8d2255594631041cb1718538` |
| admin baseline | `dd81abecde638e62d544ada3add7e3b48d29219a4848e8f00b22896a99a3c900` |
| **admin final** | `50f425a421f4ad44f4a9f91744ec168b61c2103303ba54d0cc7fe67576563b9f` |
| front patchproof | `25278b1132d4a3e4cccd6b5037b77f153adae947a3a4a6309dbda0631d6eff1f` |
| admin patchproof | `333514ec8231a43691c20a3be85b2f19b4bec09442e3ce513b4f07ff390e28fa` |
| FINAL-SOURCE-HASHES.json | `040ef49d36f801cb14350bb41ba9b1eba570381d1b338fad3d796cba11628a5c` |
| 最终测试 JSON report | `94553bea3342abe6d3a58b957132a2036464eec9ae58083cab957751af017455` |
| channelInventory.ts | `f597f2fa83c3ab4c63f4a717b9c6e89c8d613de52cb94c80d2c236ce373a1e95` |
| channelMaterialManagement.ts | `7830cb814acb69d16f96c5b11636bdc0442abefc02198d7a2ba1f93e8c3f31e7` |

## 使用现有测试证据，未重跑

- [后端最终报告](/home/ubuntu/work/customer-origin-edit-20261115/backend/B1B2-final-tests.report.json)：20 个实际测试文件 / 442 tests passed / 0 failed，success=true；交接记录 exit code=0、测试前后 hash 一致。actual boundary 文件为 67 tests passed。本复核读取报告及具体 B1/B2 断言，并独立重算当前 pins，没有用旧 22 tests 结果代替新版本。
- [UI 原报告](/home/ubuntu/work/customer-origin-edit-20261115/ui/affected-tests.report.json)：15 文件 / 652 passed / 0 failed / 0 pending；`ui/typecheck.exit` 为 0。
- [native source 烟测](/home/ubuntu/work/customer-origin-edit-20261115/deploy/host-smoke/report.json)：PASS，compileSourceCount=25，依赖 hash 无 drift。该报告诚实标记 `offlineSmokeOnly=true`、`finalCandidate=false`，只作为既有 source 编译链证据，不能说最终发布候选已 E2E。

## 审查与发布边界

这是 **code-only / noE2E** 定点判断。现有测试使用离线 actual 函数字节、合成 ERP/CRM fixtures、内存 SQLite SQL 真值表；锁子句有静态捕获/断言，但不是 MySQL 并发锁验证，不代表真实生产账号、HTTP/E2E 或发布后验收。上述边界不新增为本轮阻断项。

本复核未修改 application、SSH、DB、browser 或 Git 状态，未使用 SSH/浏览器/真实或外部 DB；起始仅一次只读 `git status --short` 定位，无 Git 写操作。没有重跑全量或限定测试，没有新增 pentest，仅写约定的两份最终报告。

**发布决定：允许本轮有限 incremental 候选发布，绑定本报告 front/admin final SHA 与已冻结源码；本报告不表示部署已经执行，也不表示生产 E2E 已完成。**

完整结构化结论见 [independent-review-final.json](/home/ubuntu/work/customer-origin-edit-20261115/independent-review-final.json)，最终后端交接见 [FINAL-BACKEND-HANDOFF.md](/home/ubuntu/work/customer-origin-edit-20261115/backend/FINAL-BACKEND-HANDOFF.md)。
