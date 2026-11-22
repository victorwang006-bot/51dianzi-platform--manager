# 页面异常与通知状态修复 · 2026-11-22 11:48

用户批准“修复问题”。本轮完成代码修复、真实静态候选与GitHub保存，不执行生产发布。

平台Orders提行器保留nullable receiver，实际选中的完整Orders leaf仅补一个问号；当前源码本来已安全，不能只改源码而漏掉静态产物。ErrorBoundary改为中文短提示、手动重试/返回及折叠技术信息；App使用原Wouter/认证/权限绑定做路由恢复和账号边界隔离，并给Orders局部错误边界。实际入口三槽补丁保持原React及导出，不重新打包整个App。

通知成功正数显示原红计数；pending/failed/lastKnown未知或零值显示中性核验状态；source denied明确blocked，不能当temporary或假零。客户列表仍inspect-only，详情当前成功、可见、账号/商户/权限及receipt门禁保持；accepted后只重查摘要，不本地减一或批量清库。纯常量模块拆分保留共享协议原导出/校验规则，使独立浏览器通知包不再携带未使用的Zod。原始体积302044→24294B，本地同参数gzip62170→8578B，不能将此比例当用户页面提速比例。

客户唯一横滚容器为命名inline-size容器，实际宽度小于1312px时需求/跟进双sticky变为static，防止初始位置遮住供应文字。宽容器保留sticky，原1312–1392px预算及232/128/88列宽不变，390px保持真实横滚可达。

## 候选与验证

工作根：`/home/ubuntu/work/customer-runtime-fix-20261122-1148`。最终候选在`candidate/final/`，含6个admin不可变资源与HTML；`manifest.json`证明131项目标依赖解析、所有非目标旧映射保持与HTML精确逆变换。更新所有旧entry别名，而非只换HTML主script，以免混用两个entry实例。新增exactscope只写实际依赖，原scopes保留。生产上线前必须fresh捕获和CAS，并另获用户明确上线授权；本轮没有锁、stage、API重载或业务写入。

通知源码90项、订单及恢复受影响50项通过；实际新entry恢复6项、实际新通知包7阶段和两最终原生IM/通知5场景通过。完整51CSS搭配原生WB0/WB1、真实构造祖先的10组几何/遮挡/hit通过。所有账号、业务数据、receipt、mark和几何业务验证均为隔离mock，不证明真人seen持久化。实际全库ES2020 TypeScript检查与独立生产前端构建通过。标准pnpm check仍有既存server/services/adminNewInformation.ts:819 ES5 MapIterator TS2802，本轮不改server/tsconfig掩盖；扩展旧路由两失败在HEAD基线复现并保留，不声称全库测试全绿。

第一版工作台空白压缩组装因顶层await目标/大AST内存被拒绝，未用于候选。最终轻量lexer+串行esbuild语法校验组装通过，工作台大包空白压缩推迟，保留通知包瘦身；51份CSS与整体HTML加载图没有全站重构。

## 503尚未定位唯一上游原因

11:35:49/50的inspect503真实存在；实际runtime把secret/fence/store/fullscan/lookup/schema/receipt及cleanup等内部失败统一为SERVICE_UNAVAILABLE。现有脱敏访问日志和PM2有界尾部不足归因本人或具体分支。20组内存探针仅证明错误合同，不是生产修复。没有修改服务端、权限、围栏、DB或调用真实mark；需已有本人Network响应的安全code/path/模块available/reason分类或独立受控阶段诊断才能闭合。不能将neutral徽标修复称为503已修。

## 12:13批准发布后的正式结果

用户追加“上线”“并继续查明原因”，12:24:14静态发布VERIFIED。仅后台HTML9b64edef与6新admin资源变化，前台当前c85a670和两API原字节/inode保持，无API重载、runtime变更或真实业务RPC/mark写测。持久closed与独立双锁释放通过。实现源码4f9bc74；本目录publication-1214保存原回执、源码绑定及只读查因，不改写凌晨旧回执。源码、候选与隔离测试结论仍按前述记录；生产静态一致不等同真人已读验收。更深完整日志仍不足503唯一归因，原异常丢失且缺阶段关联，需独立受控安全诊断，不能猜改服务端。
