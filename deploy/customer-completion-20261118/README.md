# 客户“待补全”静态增量构建与离线验收

本目录的 `build.cjs`、`test.cjs` 只做当前客户待补全修复的离线构建和验收，不运行网络、SSH、Git、部署、API 写入、数据库写入或进程重载；不修改应用源码。`release.py` 属于主任务，构建和测试不会调用或修改它。

## 运行

从已有 `node_modules` symlink 的 `/home/ubuntu/diagnosis/fixrepo` 执行：

```bash
node deploy/customer-completion-20261118/build.cjs --check-source
node deploy/customer-completion-20261118/test.cjs --plan
node deploy/customer-completion-20261118/build.cjs
node deploy/customer-completion-20261118/test.cjs --candidate /home/ubuntu/diagnosis/completion-candidate
```

`--check-source` 只检查当前实际源码；`--plan` 在内存中对真实基线生成补丁并做合成验收，不写 candidate。正式构建必须在源码冻结且 source guard PASS 后执行。输出目录已存在时拒绝覆盖；需要重建时使用新的私有目录，例如 `--out /home/ubuntu/diagnosis/completion-candidate-stage2`，验收传入同一个路径。不会自动删除旧产物。

默认基线为 `/home/ubuntu/diagnosis/baseline`，HTML 和活动列表 SHA-256 已固定，两个活动 asset 的完整 hash 必须匹配各自已有 contents-hash 文件名。可通过 `--baseline` 指向同一真实基线的离线副本，但不能绕过 hash guard。

默认读取 `client/src/business/platform/shared/crmCustomers.ts`、CustomerList/CustomerDetail 页面和 usePageMemory 中的 fresh options。Query helper 默认接口为 `customerContactSummaryQueryVerified(query, scopeReady)`；可用 `--query-helper 名称` 改导出名，接口或页面结构改变时必须人工核对脚本，不能仅靠改名假装兼容。`--repo`、`--shared` 只用于明确选择实际冻结源码。

## 输出结构与主任务接口

生产基线及区间 evidence 全部保存在 PUBLIC repo 之外的私有 `/home/ubuntu/diagnosis/completion-candidate`，目录 0700、构建文件 0600：

```text
completion-candidate/
  candidate/index.html
  candidate/active-workbenches.json
  candidate/assets/BusinessWorkbenchPage-customer-completion-<contentsHA>.js  # 两个
  baseline/index.html
  manifest.json
  release-manifest.json
  proof/html.json
  proof/<原活动bundle文件名>.json
```

`release-manifest.json` 包含 `ownerTask`、`scope: static-customer-completion-only`、三项零写入/零重载计数、before/after HTML hash、两个新 asset pin、两个原 asset pin。`protectedApis` 初始化为空数组，并标记 `protectedApisPendingOwnerFill: true`，必须由主任务补入正确 pin 后才供其 release 工具使用；主任务应重新计算最终 manifest 的 SHA-256。这里没有真实 API 路径/客户数据硬编码，也不负责授予发布权限。

## 修改边界及验证

- 从实际 shared 源码 AST 抽取 `isCustomerPhone`、`customerNeedsCompletion` 和配置的 query helper，用 esbuild 做 TS→JS transform，**不 bundle**。复用原生 schema bridge 的 Zod string factory；不新建 React、TRPC 或 provider root，不添加运行时 import。
- 每个含“待补全”的列表 callback 使用两参数新纯 helper；原 summary query 加 `refetchOnMount: "always"`、`placeholderData: undefined`。Map 只读取本次挂载后 verified 的 summary，校验当前 expected scope、当前请求客户 ID、重复 ID；验证状态加入原 useMemo dependencies。未核验 summary 不退回旧 contactName/phone cache。
- 真实基线共 2 个列表回调、5 个详情 warning owner。每个详情 owner AST 抽取现有 context/scope/get/customer/ID 绑定，只插入一个原生 `customer.contactsSummary.useQuery`。保留原 get-enabled/客户验证；summary 本身必须本次挂载已获取、非 error/pending/fetching/placeholder，且唯一匹配当前客户。手机号、座机、微信、QQ、邮箱、其他联系方式均按实际 source helper 识别，文案使用本次真实详情源码。
- 实际源 helper 有明确优先级：**客户名称缺失直接为 true**，即使 contacts summary 未核验也已知缺客户名称；只有客户名称非空且 summary 显式 undefined 才为 unknown，不显示联系人待补全。这是主任务确认的源码设计，构建未改它。未传第二参数的旧兼容规则仍保留在非本次补丁调用点。
- 不重编整个 bundle。每个补丁都校验旧区间，生成完整 exact inverse 与未修改分区的 UTF-8 bytes/hash 证明。其他 bundle 内容保留；imports、exports 和动态 import 表逐字相同。每个 oldURL 各生成一个新的 contents-hash asset，绝不覆盖旧文件。
- HTML 只改原 import-map 中活动 oldURL 的**值**；不删改 import key 或已有 scope。为两个移动后的 bundle 仅克隆失去作用的原有效依赖 scope。HTML import-map 之外全部字节相同；每个静态/动态依赖的有效解析保持一致，不复制当前全站结构、不下载或执行依赖。
- 验收重新从冻结源码/真实基线生成期望产物，比较完整 bundle 和 HTML、所有区间/proof、artifact hash、实际 source hash，并对每一个补丁点执行合成数据状态测试。包括仅微信/邮箱/QQ/其他方式、缺主联系人、旧 cache、占位/拒绝/挂载前/刷新中、scope/customer/actor/page 变化、重复 summary、memo 状态切换。

本验收是离线结构与合成行为验证，不替代真实浏览器/TRPC 集成验收；没有访问真实客户数据或现场服务。后续来源读取修复若改变冻结源码或 HTML/asset 基线，应生成新的私有 stage 并重跑本次 guard/proof，不在已构建 package 上手改。
