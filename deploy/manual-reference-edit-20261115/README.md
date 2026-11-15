# 单条库存手填参考两价：已完成的限定发布

2026-11-15北京时间18:37已真实上线原51dianzi ECS，ROOT为 `/opt/ops/20261115-manual-reference-edit-JfFQcJM`。随后只读verify和后台HTML、两个Host脚本、CSS四项公网HTTP200/fullSHA均PASS。功能源码提交6d882af5f437dda3b8dca353df806c5c94245e29；最终manifest为f7e5c57fe2dcd3916c848da69e0da93cd7f7f9610a06e29fa1a25519730f1623。

本目录为固定该轮次的审计及控制工具封存，不是通用部署命令。该ROOT/attempt已verified且窗口关闭，**不得重放stage、apply、close或同一建表请求**。后续维护必须独立新ROOT、读取当前真实基线并重新审核，不可修改旧回执/哈希来绕过检查。

新功能仅增加原编辑弹窗两个CNY精确十进制手填价，按单条库存独立存储、手填优先、清空恢复自动，保持原授权/CAS/UUID/事务审计。原来源客户、库存报价、库存归属和213条成功商城参考报价保持不变，三个参考helper未重新编译，采价任务未开启。

新增存储通过独立schema-v2 ROOT严格执行一次CREATE TABLE。原四业务表hash/count不变、新表0行；无需历史回填。初版schema仅只读计划，无DDL，其原工件保留。代码发布驱动无DB写，整轮实际DDL为1，业务数据改写为0，`database-maintenance-receipt.json`为独立真实维护回执。

原4front/2admin顺序重载后全在线，另6进程PID/env/config不变，旧资产与历史ROOT完整保留。最终Host为原25+准确2个本地模块，发布驱动按准确27路径三方核验。上传接收器仅允许本ECS已核实的系统锁目录别名 `/var/lock -> ../run/lock`，锁本体仍打开 `/run/lock/`下同一固定文件且禁止其他符号链接；不是任意路径放宽。

测试和限制见[实施与上线说明](./实施与上线说明.md)。独立实际候选QA只声明原生工件映射与代码行为回归，嵌套隔离测试保留fixture属性；没有生产账号登录/编辑保存E2E或完整获读服务包执行。仅保存不含密钥的摘要、回执和限定控制源码，未将获读运行API包或SSH/Git凭据纳入本目录。
