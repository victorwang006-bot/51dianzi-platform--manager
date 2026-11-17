# 最终来源围栏与默认运行图闭合

2026-11-17。原 reducer 已保留新增厂牌字面对的来源限制说明；父代理补充了快照实际来源围栏，不新增型号研究、采价器规则或厂牌族。

`shared/channelReferenceBrand.ts` 的 matcher 增加内部可选 `allowIckeyEquivalences`，只控制五组新增云汉完整字面对。`snapshot.ts` 的价格证明传入逐来源验证循环中已经核实的 `source`；库存证明传入已校验的 `r.source`。只有云汉来源可启用这些新增规则，立创证明使用原规则；旧历史方向、完整品牌族、普通 alias 和原两个来源适配器均不改变。匹配仍不删除型号/包装/环保后缀，不选任意厂家或供应商。

三项定向测试通过：实际最终快照仍严格有效、全部213份原quote/evidence逐字段不变；新增字面对在立创快照证明中只保留原有方向；将真实新云汉报价刻意重标为立创来源的负例被拒绝。没有新生成参考价格或访问外部网页。

原源锁与运行图显式归档到 `runtime-build/pre-final-code/`，然后一次冻结最终16文件service图、9文件worker图、18个允许源文件。最终默认loader检查通过91个原始身份绑定/95个来源、8份真实库存补证和213份原成功价/证据，101个样本输出/10次调用；worker、网络、cache或采价器未执行。数据三siblings精确字节没有变化。对应检查在 `source-profile-tests.log`、`runtime-build/default-final.log` 与 `runtime-build/offline-final/`。

这已闭合 `final-aggregation.md` 第45段当时披露的来源机制缺口；该报告和 reducer 的原输出保留作为历史离线阶段，不重写原证据。以上仍是代码/离线默认加载验证，不是生产发布回执或员工业务写测。
