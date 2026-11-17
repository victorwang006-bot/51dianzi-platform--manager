# 业务订单空数据局部修复

只修两份当前真实业务工厂的四个CRM列表副本：保留经客户/权限过滤的query.data，在通知行提升到JSX外时使用data?.items；不可读取的列表传空refs。正常成功订单、客户隔离、原filters/pagination、详情付款、采购/销售入出库、附件预览下载、保存参考、商城与导航单例均不变。源码已安全读data，此次同步通知refs和实际增量接线器，防止再次丢失可选链。

check-orders.mjs安全提取并完整执行四个编译函数，不执行工厂/旧API/DB；测试包含真正undefined及原embedded/customer边界主动清数据，结果是mock JSX/查询ABI，不冒充真实浏览器和已读RPC。85项候选检查通过，详见implementation-tests.md。需本次授权工作目录current-inputs/manifest或--manifest；真实前映像、完整候选及服务器快照不入Git。

capture只读获取当前真实HTML/模块哈希；build仅八个节点并逆向保护其余字节；成熟双锁/CAS静态apply仅一次更换两模块和HTML映射，不重载12进程、不执行DB/DDL，不改环境配置。源码冻结与预检/上线分离，实际状态以最终回执为准。报价补查暂停。全站错误页中文化和路由重置不纳入此次紧急修复。
