# 前台故障修复与未完成事项

用户已授权2026-11-19 23:57按建议实施，并要求未完成一并完成。必须不增加等待，不长时间白屏或无限骨架；不延长150ms掩盖问题。保护后台并行客户渠道库存任务，不改其函数/字节；限定增量发布，不全量dist。

- [x] 技术参数快照使用单次验证索引、single-flight和原子文件版本失效；冷/更新校验移出主事件循环，新PID预热后接流量。20,002条真实私有实机热读P95 3.72ms、10并发19.77ms；保留source/ticket/revision/digest/URL安全围栏，坏新版本不回旧ready。
- [x] 商户与自营独立提交；快的一方先显示，参数不阻塞商品/报价。每代success/error/timeout/cancel结束loading，rawFetching不覆盖终态；transport取消及迟回隔离、访客授权队列硬失败与不自动重发扣配额请求通过回归，真实访客两型号正常完成。
- [x] 精确认证手册URL及PDF-only入口不受参数数量控制。ST DS7147 Rev10/华邦Rev.C两官方文档本轮实际提取、完整型号匹配；已发布访客页面PDF入口及参数展开真实验证，无猜链接或跨型号/版本回退。
- [x] W25N04KVZEIR保留原13参数值，补八个精确完整型号官方概念；21raw字段经既有无效值过滤为20有效可见，满足16项要求。不把MOQ当库存或改交易字段，两型号prepare/verify保持其他20,000条不变。
- [x] 首页两红框‘工厂库存 · 供需流转’=>‘潜在库存 · 供需流转’、‘让工厂库存，’=>‘让潜在库存，’，真实首页可见，其他文案/导航依赖不变。
- [x] 真实冷启动/热读/并发/更新/坏来源已实机通过；访客页面及用户09:07自行登录后两型号/参数/PDF/报价真实通过，原购物车自营与普通商户分区只读正常。登录态/报价购物车callback ABI已有专项覆盖；没有加车、删改、勾选、下单、付款或改库存，不冒充交易写入全链路实测。一次8秒取消错误终态及手动刷新恢复已如实归档。
- [x] fresh19588生产capture、共享双锁COORD/full-META CAS、固定全包独立审核、增量发布/新PID预热/actual业务-source认证通过；R2 verified闭窗，08:46后验19594无未知漂移；08:51正式交接后台，原stage/消费attempt不可重放，无整站或自动回滚。
- [x] 两仓库已保存完整可追溯源码与构建/测试/去敏回执，保留后台422b545及此前并行历史；最终实际发布与浏览器证据归档deploy/front-fast-r2-20261120，无凭证/生产快照/原始tickets。

## R2实际终态（2026-11-20）

R2一次性apply于08:45北京时间exit0/status verified，未回退；08:46双锁只读复核status verified-closed-readonly-reconfirmed，12进程/19594文件/四目标/两HTML/full metadata/current业务/精确closed coord无failure覆盖。4次full-source、4个新front PID prewarm、9次业务探测通过。终态receipt SHA f893fcfda09485a1aaf540c61bebafc9f739a62e2eeb176cb70e0717f2c31145，closedcoord SHA8a130860aefec8087cebfab27d2bc7782f30a6790a300a75546fb48436f0af89。详见deploy/front-fast-r2-20261120/README.md与evidence/final-acceptance.md。

后台发布占用已明确交接，前台不再开生产窗口。后台的新捕获/封包/独立审批不以旧seed或前台receipt替代。第6项在09:07至09:26用户真实登录两型号及原购物车只读检查完成后才勾选；最后阶段仅匿名证据与文档归档，不改生产。

## 方案B新静态版本实际交接（2026-11-20 17:05）

自营列表方案B与DEMO详情已实际发布；本轮仅4个内容寻址JS、1个原字节图片和前台HTML，不改API/store/DB/env/业务进程/reload/timer。HTML SHA349cbe260fe908ceb17fe4d04517f6c3ad043ec69d1cf8fe8324935c44a5c19f，manifest93910d8185a1e2e3d6c32eeae2a595a6c4cb423db876fe9771e896aa4df81ca3，工具源集合40d2756a31273f03d2c013a50ff12103d41321ace6c1c3e3280b40b7a1254434。

用户批准一次完整83,094基线后每步精确静态CAS，不再全机重复采集；旧PENDING及semanticsFalse不提升。原一次apply在自带GET改变6目标atime后guard拒绝、rollback前guard再拒，verify未执行，失败事实保留。用户16:58:53批准只对这个ownedattempt采纳真实observed atime，其他内容/身份exact；通过原open-file-description双锁继承进行manual续作，不第二次apply、不重写HTML/assets、不篡改atime。

17:05:35实际终态为verified-manual-recovery-closed：manual确认receipt9ca64d8a57c6698cc5ccccfc1185d1d73603161f86f8b9fd34796d9e58a83c18、verified回执4c9757cf7d08d7693a2566d8c972667c191ff19881cf927b4b3498c8dc19e23f；closedcoord5f0faee56453b0901c0f01519da3913a3deb9881c107e6336a416c8e6c300e1d；postcloseState664465cb82610322e3a836f4cabde7a5842a31859484512722012d6a8e5668e7。两真实匿名列表/详情页已渲染，无nativePageError、0nonGET；未重测此前登录/购物车或交易写链路。

只有实际闭窗确认后才结束原精确hold执行器，继承双锁最后释放。17:07已将去敏实际摘要及说明附件交接协调和后台，前台0连接/0锁/0生产作业、明确释放窗口。后台仍须按自身用户scope、新coord、当前动态集合/源码/META及自己的新鲜证据准入，不继承前台静态契约、atime恢复、旧capture或本次审批。当前全机动态语义图没有由本次静态收尾重新认证。前台只继续本地文档/Git保存。
