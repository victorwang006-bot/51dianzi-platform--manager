# 采购 v2 后端联调缺口（11:48）

后端主任务已确认 create/bulkCreate costs、在途 update costs、history 已部署。前端已对齐实际契约：在途一次原子 update，已入库先 revise 后 updateDetails；供应商费用不计入创建的初始全额付款。

| 缺口 | 当前 UI 安全处理 | 建议后端扩展 |
|---|---|---|
| 已入库 revise.strict() 无 taxRate/unitCostBasis | 已入库税率/口径锁定并提示，仍可改数量、单价、费用 | revise 增加税率/口径并统一重算 |
| 已入库 updateDetails 无 inboundDate/prodYear | 日期/DC 锁定并提示，不静默丢弃 | updateDetails 支持日期/DC |
| 已作废单 updateDetails 原实现仅允许 received | 已作废可以打开新版查看/编辑，服务端错误友好展示 | 若要求资料可随时改，允许 cancelled 资料保存 |
| 在途 update 原子成本修改契约无 reason | UI 会要求原因但接口目前无约定原因字段 | 建议 update 顶层增加 reason?:string 并写 history |
| bulk 原行 schema 无 supplierPhone/packageType/lotNumber/supplierOrderNo/photos | 批量完成后按响应 items 对每张单 updateDetails / update 补充，失败保留原请求重试，已成功的单不会重复补充 | 未来原子 bulk 支持这些共享/逐行字段更稳妥 |
| bulk 原契约无初始 payment | 多物料明确拒绝非未付款，提示创建后逐单登记；单条付款完整保留 | 如果要多物料初始付款，需明确分摊契约 |
| 列表未提供 shippedQty/reservedQty/currentQty 等库存数据 | 已入库显示已入库数量；未返回的已出库/当前库存不估算 | 建议返回实际已出库、已预留、当前库存字段 |

未修改任何后端文件。
