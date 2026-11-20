# 前台快速故障修复 R2 — 2026-11-20

本目录归档本轮实际使用的受控工具、源码和去敏证据，不包含生产快照、数据库凭据、原始source tickets或私钥。R2 scope为 `front-fast-r2-20261120-qp4e5jVm`，owner为 `qp4e5jVmsAp0UHKwymyD5X`。原失败stage和本轮已消费attempt永久禁止重放。

## 已实际verified并闭窗

2026-11-20 08:45北京时间，一次性R2发布exit0，`deployment-confirmed.json` 状态为 `verified`。08:46双锁下只读后验 `final-verification.json` 为 `verified-closed-readonly-reconfirmed`，闭窗精确绑定，无failure覆盖、无自动回退。receipt SHA256为 `f893fcfda09485a1aaf540c61bebafc9f739a62e2eeb176cb70e0717f2c31145`，closed coord SHA256为 `8a130860aefec8087cebfab27d2bc7782f30a6790a300a75546fb48436f0af89`。

完整包独立审核actual passed，review SHA256为 `31c7ba9f0a17f7956b9dad417efd6b7dd7dd29357c06d7f1f769fb841d4ed118`；manifest为 `ec3894f939fecaf24c76b9083e6375a9b8386d567b1280d60873fe51c96f33bf`，controller为 `8a69178951903c32cc30b23fdafac70f97558d4504df9eed7fbfd2de74d3059b`。审批只属于已消费的新包，不可作为以后发布授权。

部署完成四次真实current full-source认证，四个新front PID预热，九次三型号业务DTO探测。ST12与华邦21raw参数均ready且PDF/version精确匹配；非目标控制型号9项保持不变。后验12进程、19,594文件全核对；其他六进程raw/environment/config/权限严格不变，未知other-file漂移为零。五份retained资产full metadata未被触碰，六新技术叶已认证。

原失败窗口此前独立恢复并闭窗，`recovery-confirmed.json` 的 `restored-recovery-verified` 与 `businessAcceptanceVerified=false` 只认证旧版已恢复，不冒充新功能上线。旧源认证器不用新v4投影假认证旧store。

## 业务与性能

新候选20,002条，当前只读认证19,987 source keys。只修改两个完整型号entry及其source key，其他20,000条与sources/order不变。实机私有compiled worker单次loads=1，冷预热937.55ms、主线程心跳最大延迟3.07ms；热读P95 3.72ms、10并发P95 19.77ms。坏schema同size/mtime原子替换fail-closed；恢复正确新版本后才ready。私有bench不冒充端到端页面P95。

W25N04KVZEIR v4精确认证原13字段或21字段摘要，保留原13值及metadata，补八个缺失官方概念。沿用 `写周期时间(Tw)='-'` 无效值过滤后有20个有效可见参数，不为凑数改UI。原ECC=`有`/接口=`SPI`不冒充已展示8-bit/Dual/Quad细节。STM8S003F3P6TR保持原12参数，仅补精确官方PDF；保留完整型号、source ticket/revision/digest/URL及交易字段围栏。

正常访客浏览器已看到首页两处潜在库存文案、华邦新增概念完整展开、ST12额外参数与两份官方PDF入口。ST中间状态记录到商户已显示、自营仍在加载，之后自营正常完成；最终无loading。公开PDF已实际提取并验证文档/完整型号匹配。未提交订单、付款、购物车、询价或入驻申请。

用户09:07自行登录后，已实际核验ST12、华邦20有效自营参数、两型号报价和PDF入口；ST PDF点击成功下载并核验DS7147 Rev10，华邦点击进入官方74页Rev.C阅读器。09:23原购物车自营/普通商户分区、数量和金额字段正常。未加车、删改、勾选、结算、下单、付款或改库存；只读页面＋已有逻辑/回调ABI回归不冒充实际交易写入全链路。

浏览器标签恢复后一次请求8秒取消进入错误终态，无无限loading；手动刷新后真实华邦officialMall.list1359.6ms、search.search1722.8ms均200、最终无loading/error。后台一次轻量origin ST96.852ms/WB86.503ms ready与final一致。该瞬时超时及恢复如实存入evidence/browser-auth，不据此推定代码失败、放宽等待或回滚。账号截图/私有购物车明细/凭证不归档；TODO最后一项实测完成后才勾选。

## 固定窄范围合同

四既有目标仅front API、admin API、front HTML、prepared技术快照。API只改商城/技术helper指针和必要pre-listen await；客户上传、渠道库存、金融callback及非目标字节完整正反证明保持。没有全量dist、环境/nginx/手工业务DB修改或worker job reload。

11份内容寻址资源为六新技术runtime/worker/helper和五份已留存前台资产，后者以fresh capture全metadata与package bytes严格认证，不overwrite/chown/chmod或认领。保留单一guest ESM及原React/tRPC/provider，不创建第二运行时。

顺序reload admin191/192，再front190/193/194/200。其他0/201..205 raw配置环境权限不变。TTL900只授权准入；运行中/rollback不因过时放弃CAS。新PID预热、当前来源、三型号业务及时限通过后切HTML，durable terminal先于closed coord。失败只回退本attempt拥有的增量，不覆盖foreign变化，原stage/attempt不重放。

## 源码与证据

前台专项75、独立业务补丁281、manager技术115分别通过；两库完整TypeScript通过；R2/恢复认证83及闭窗故障注入5通过。各测试有交集不加总。`preflight.json` baseline规范unavailable只表示原故障可读；新版本ready证据以实际deployment-confirmed/final-verification为准。

最终证据位于 `evidence/`，浏览器截图与读取日志在 `evidence/browser/`，用户验收说明为 `evidence/final-acceptance.md`。原始ticket/source证明仍在ECS private receipt，不进仓库；此处仅存其摘要、public DTO和必要去敏元数据。

08:51实际终态、两API/两HTML/store/sourceflags SHA与12PID已发后台任务 `6Lfttf6oVWJ8YS69o5FkXQ`，明确解除前台占用。后台只可按其自身用户授权，以完整newowner/newscope、新fresh capture、完整封包独立审核和同双锁CAS继续；种子旧2API不同，不复用旧stage/capture/review。前台之后只做文档归档，不再开生产窗口。

归档 `tools/` 应复制到原workspace布局 `platform/manager/remote-evidence/r2-build/r2-private` 后按固定scope复核，不直接从仓库猜生产路径运行。任何历史README、bench、review或receipt都不是新发布审批。
