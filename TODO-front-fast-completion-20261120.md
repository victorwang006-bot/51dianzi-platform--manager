# 前台故障修复与未完成事项

用户已授权2026-11-19 23:57按建议实施，并要求未完成一并完成。必须不增加等待，不长时间白屏或无限骨架；不延长150ms掩盖问题。保护后台并行客户渠道库存任务，不改其函数/字节；限定增量发布，不全量dist。

- [x] 技术参数快照使用单次验证索引、single-flight和原子文件版本失效；冷/更新校验移出主事件循环，新PID预热后接流量。20,002条真实私有实机热读P95 3.72ms、10并发19.77ms；保留source/ticket/revision/digest/URL安全围栏，坏新版本不回旧ready。
- [x] 商户与自营独立提交；快的一方先显示，参数不阻塞商品/报价。每代success/error/timeout/cancel结束loading，rawFetching不覆盖终态；transport取消及迟回隔离、访客授权队列硬失败与不自动重发扣配额请求通过回归，真实访客两型号正常完成。
- [x] 精确认证手册URL及PDF-only入口不受参数数量控制。ST DS7147 Rev10/华邦Rev.C两官方文档本轮实际提取、完整型号匹配；已发布访客页面PDF入口及参数展开真实验证，无猜链接或跨型号/版本回退。
- [x] W25N04KVZEIR保留原13参数值，补八个精确完整型号官方概念；21raw字段经既有无效值过滤为20有效可见，满足16项要求。不把MOQ当库存或改交易字段，两型号prepare/verify保持其他20,000条不变。
- [x] 首页两红框‘工厂库存 · 供需流转’=>‘潜在库存 · 供需流转’、‘让工厂库存，’=>‘让潜在库存，’，真实首页可见，其他文案/导航依赖不变。
- [ ] 真实冷启动/热读/并发/更新/坏来源已实机通过；访客两页面/参数/PDF/价格数量界面真实通过。登录态及报价/购物车逻辑、callback ABI已专项覆盖，但尚无用户账号实际登录整页验收；需要用户在云浏览器登录后只读核验，不下单、不付款、不改库存。
- [x] fresh19588生产capture、共享双锁COORD/full-META CAS、固定全包独立审核、增量发布/新PID预热/actual业务-source认证通过；R2 verified闭窗，08:46后验19594无未知漂移；08:51正式交接后台，原stage/消费attempt不可重放，无整站或自动回滚。
- [x] 两仓库已保存完整可追溯源码与构建/测试/去敏回执，保留后台422b545及此前并行历史；最终实际发布与浏览器证据归档deploy/front-fast-r2-20261120，无凭证/生产快照/原始tickets。

## R2实际终态（2026-11-20）

R2一次性apply于08:45北京时间exit0/status verified，未回退；08:46双锁只读复核status verified-closed-readonly-reconfirmed，12进程/19594文件/四目标/两HTML/full metadata/current业务/精确closed coord无failure覆盖。4次full-source、4个新front PID prewarm、9次业务探测通过。终态receipt SHA f893fcfda09485a1aaf540c61bebafc9f739a62e2eeb176cb70e0717f2c31145，closedcoord SHA8a130860aefec8087cebfab27d2bc7782f30a6790a300a75546fb48436f0af89。详见deploy/front-fast-r2-20261120/README.md与evidence/final-acceptance.md。

后台发布占用已明确交接，前台不再开生产窗口。后台的新捕获/封包/独立审批不以旧seed或前台receipt替代。最后登录态实测完成前不将第6项误标完成。
