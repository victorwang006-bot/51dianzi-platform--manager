# 后台采购与导航离线候选 v2

旧候选完整归档于 `/home/ubuntu/51-inspection/candidate-admin-v1`。本目录是重新生成的最终离线候选，未发布，线上 hold 仍有效，须用户对精确固定候选确认后才由父执行发布程序。

## 本次收敛

已按真实 `admin-source-before/actual-source.diff` 删除需求编号下的整条通用项目名第二行（旧 compiled `ProcurementDemands.tsx:415`）。详情中真实 `projectName` 仍保留。七个批准源文件的 after SHA 与父提供的真实 before 快照 pin 全部核对；每个 patch 的 `beforeSourceSha256`、CSS `baselineSourceSha256` 均为真实非空 SHA。父声明前态来自 `f9703e50`；本次未运行 Git，仅验证提供文件的字节哈希。没有新增 quote receipt guards。

三个 JS chunk 的补丁范围可逆还原到原基线 SHA，未改其它字节、import/export 表、旧状态和操作、App 路由与授权上下文。importmap 精确 importer scopes 随 contenthash 重命名复制，非目标映射保持原值。CSS 为页内作用域 overlay，无全局业务隐藏。

## 证据与复跑

```bash
node /home/ubuntu/51-inspection/deployment-tools/verify-demand-admin.mjs
node /home/ubuntu/51-inspection/deployment-tools/test-demand-admin-runtime.mjs
```

`verification.json` 为独立静态校验。`runtime-test.json` 为真实 React 单例与 ReactDOMServer 的合成 SSR，抽取候选中的 ProcurementDemands、详情、QuoteList、QuoteCard 及白名单纯辅助函数，不执行完整生产模块。验证北京时间分钟（UTC 00:02:59 → 北京 08:02）、列表无项目名副行、详情保留真实项目名且仅一个新增报价按钮、空白需求说明不渲染、总数/轮次和撤回/旧版/采用/有效状态保留、默认下一轮提示仅在 title。

SSR 替代了 UI primitives 与查询 hooks，仅使用合成需求/报价。真实 query、network、DB 均未执行；mutation/refetch/invalidation 桩执行即抛错。SSR 不证明浏览器布局、hydration、交互或线上静态依赖可用性，不能伪装浏览器验收。父此前提供 source tests 329/329、pnpm check 0 通过信息，本次未重新执行该源码测试套件。

所有 asset 发布 URL 以 manifest 为准；这是离线 candidate，不是上线结果。原 deployment-tools/ADMIN-BUILDER-README.md 为 v1 旧说明，本次权限限定未改该历史文件，应以本 README 与当前 manifest 为准。
