# 前台快速故障修复 R2 — 2026-11-20

本目录归档本轮实际使用的受控工具、源码和测试证据，不包含生产资料快照、数据库凭据、source tickets或私钥。R2 scope 为 `front-fast-r2-20261120-qp4e5jVm`，owner 为 `qp4e5jVmsAp0UHKwymyD5X`。原失败stage永久禁止重放。

## 已确认，尚未将R2上线成功混为一谈

原失败窗口已独立认证恢复并实际闭窗，`recovery/confirmed.json` 的状态是 `restored-recovery-verified`；只证明旧版四目标、12进程、19,588文件、来源和listener恢复正确，`businessAcceptanceVerified=false`。原故障仍存在于旧版运行时。恢复认证器只使用旧投影的固定full-source verifier，不用新v4资料假认证旧store。

新私有候选包含20,002条，当前来源只读认证19987 source keys。只修改两个完整型号entry和其source key，其他20,000条与sources/order未变。实机私有compiled worker：单次预热loads=1，冷预热937.55ms，主线程心跳最大延迟3.07ms；30项热读P95 3.72ms，10并发P95 19.77ms（均不大于50ms）。同size/mtime原子替换的坏schema新版fail-closed，恢复新版本后才能返回ready。

W25N04KVZEIR v4补充只认证原13字段或精确21字段摘要，保留原13值、metadata和已有安全PDF，补八个缺失官方概念，避免同义重复。prepared有21个原始字段，原`写周期时间(Tw)='-'`沿用UI无效值过滤，因此20个有效可见参数；不为凑数改UI或声称原ECC=`有`/接口=`SPI`已展示8-bit/Dual/Quad详细值。STM8S003F3P6TR保持原12参数，只补官方PDF。保留完整型号、来源ticket/revision/digest/URL与金融字段安全围栏，不修改交易字段。

## 限定发布合同

四个既有目标：front API、admin API、front HTML、prepared技术快照。API只修改原native商城/技术helper指针和必要pre-listen await；客户上传、渠道库存、所有金融callback及非目标字节正反证明保持原样。不全量dist、不改环境、不改nginx、不写DB、不重启worker jobs。

11份内容寻址不可变资源：六个新技术runtime/worker/helper与五个已留存的前台资产。后者必须与fresh capture全metadata及package bytes精确相等；不overwrite/chown/chmod，不认领为本次新增。旧前端资产是已审查的独立商户/自营8秒终态、单一guest ESM、PDF-only与首页两文案实现，不再引入新的React/tRPC/provider副本。

依次admin191/192、front190/193/194/200顺序reload；其余0/201..205 raw配置环境权限严格不变。fresh capture TTL900只用于准入，运行中及rollback仍保留全state CAS，不因时间过期跳过恢复。实际新PID预热、current sources、三型号业务DTO/参数/PDF/version和时限通过后才切HTML并闭窗。durable terminal receipt先于closedcoord；失败仅回退本attempt拥有的增量，foreign变化不覆盖、needsOperatorRecovery保持，原stage和本attempt永不重放。

## 本轮证据

前台专项75通过、独立业务补丁281通过、manager镜像/商城事实115通过；两库完整TypeScript通过；R2及恢复认证83通过、闭窗故障注入5通过。actual `preflight.json` 状态通过，baseline三型号规范unavailable只代表原故障可读，不算新版本ready验收。最终完整独立审核、实际发布和闭窗回执以本轮后续记录为准。

工具使用的是已复原独立workspace布局：`platform/`、`manager/`、`remote-evidence/`、`r2-build/`、`r2-private/`等。归档`tools/`文件应复制到同一workspace根目录按其固定范围复核后使用，不直接在仓库执行或猜生产路径。`package-r2.py`从fresh候选和完整capture绑定新manifest；`private-launch.py`仅在内存继承原有效配置，不写环境。不得把历史review、快照、私有bench或此README当作新的发布审批。
