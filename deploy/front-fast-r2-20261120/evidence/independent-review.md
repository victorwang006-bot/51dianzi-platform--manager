# R2 独立只读发布审查

**结论：passed，批准当前固定包；无阻碍。** 审查标记为 `independent-readonly-r2-reviewer-20261120T0033-subagent`。审批合同见同目录 `review.json`，仅限 owner `qp4e5jVmsAp0UHKwymyD5X`、scope `front-fast-r2-20261120-qp4e5jVm`。

固定 manifest SHA256：`ec3894f939fecaf24c76b9083e6375a9b8386d567b1280d60873fe51c96f33bf`。controller SHA256：`8a69178951903c32cc30b23fdafac70f97558d4504df9eed7fbfd2de74d3059b`。

## 独立核验

- 重算36个 `packageFiles`、7个controller `sourceFiles`、219个业务/构建source及7个测试日志哈希；完整包白名单、bindings、fresh capture、fullmeta、coord均匹配。capture与独立恢复证书/confirmed绑定同一已closed窗口，19588项保护文件、12个进程及四份原preimage相符，未绑定旧open窗口。
- 实际调用纯离线 `byte_delta` 验证admin API两patch、front API两patch、HTML27patch完整forward与full inverse；另核验front/admin native旧工件的完整正反保护。API非目标客户/渠道inventory与financial callback字节保留，不采用后台新API。`store_delta`及原exact store合同通过：20002 entries、19987 sourceKeys，非目标20000 entries及其他sources/identity/order保持；没有放宽pending、revision或projection。
- W25恢复preimage为原空技术资源，原已认证候选13参数逐项原值/顺序与新21参数前13项相同，仅追加8个缺失概念；原Tw占位过滤后20可见。ST原12参数逐项相同，只补安全PDF。私人真实全current-source证明转换为inline evidence后，所有source版本、ticket与identity revision均与候选对应；没有输出私人ticket。
- 11条immutable精确对应固定role/path：6条新技术runtime叶子为captured absent，5条前端资产为captured existing。5条复用叶子完整SHA/size/uid/gid/statmode与capture吻合，完整字节同原package；不授权覆写、chmod或chown。HTML前后98项物理引用重算一致，全部依赖由capture或固定叶子覆盖；两条global与三条scoped guest别名精确解析至同一ESM，宿主React/tRPC与dialog ABI哈希保持。
- 原frontend compiled源码关系沿用封存build/incremental review，并重算当前副本13个前端source pins及5个资产哈希、逐个检查compiled依赖；原native-entry的历史source/build关系由封存原审查证据承接，不冒称重新编译。compiled独立商户/自营终态取消、同snapshot官方提交、PDF-only及Home两句文案证据一致。历史审查明确非本R2完整发布批准。
- 新source/prewarm adapters绑定当前owner；source adapter实际只读事务核验全部当前publication/source/projected resource，非echo。prewarm adapter验证实际API SHA、四front角色新PID、PM2槽身份及相应PID/current snapshot的真实prelisten日志，再读store和monitor；不是只回传请求。actual front API在唯一`server.listen`之前await native ready，拒绝预热会进入启动失败；native→新helper→新compiledworker链对应候选。
- 实机private-process benchmark确用新helper/worker和同一候选SHA。由原始样本独立重算：cold 937.55ms，主线程heartbeat最大3.07ms，30项warm P95 3.719ms，10并发P95 19.772ms；loads1、quiet reuse、同size/mtime atomic坏版本failclosed及新版本恢复证据一致。读取而未重跑281/281、75/75、115/115、R2 83/83、恢复5/5及两库typecheck证据。

## 审批边界

本轮只有本地只读检查及本目录两个审查输出，无SSH、联网、生产执行、安装、Git写、候选修改、重编或重开测试。已读取严格只读preflight通过证据；三个baseline GET的规范unavailable只证明恢复基线可达，**不代表R2已发布或after验收成功**。TTL900只用于fresh admission；apply、每个新PID真实预热、current-source序列、发布后验收与全stateCAS rollback仍须按固定已审控制器执行，不因本审批跳过。
