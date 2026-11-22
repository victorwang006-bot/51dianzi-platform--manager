# 采购需求改版＋顶部通知修复：有限联合发布核对

**结论：PASS，可进入已授权发布流程；本次范围内未发现真实上线阻塞。** 此结论不是已上线回执。

最终 manifest 实算 SHA256：`0786e09ac96e74c95b50755404a3a262e656c3f515de98707a8ba86cdb0544c6`。最终 HTML 实算 SHA256：`7578df3b3e637b8647e99da6bf4a344bbbb26b40e8181debdc721324cbb070d4`。

32 项 sourcePins 与 freeze 一致，6 个静态资源、2 个 API 完整 hash/size 一致。旧 132 个 imports、118 个 scopes及所有 WB/nav/NI aliases逐项闭合；新 map 共 122 个 scopes，98 条真实候选 import 解析一致。两 API 各 2 hunks、两 WB 各 7 slots、Dashboard 2 slots 和 HTML 均完成完整前向、逆向、槽外字节核对；两 WB 的 5577/6115 个非目标函数字节保持不变。

实际采购 API schema/listFn → 原授权 BFF → 页面 query、exact 路由与服务端 ID toast 已接通；header status 位于原 Provider 内且复用原 React/Query/NI singleton。DI15、两 WB 有限真实 factory/route/toast smoke及 3 采购视口＋27 NI状态视口/189槽/0网络证据按冻结复用，没有重跑测试或构建。

成熟发布器基线 SHA 一致，778 行限定派生为 820 行；复算只存在无序 set 展示顺序差异，语义完全一致。front HTML noop、两 API＋admin HTML change、6 static、runtimes=[]；双锁顺序、完整 stat CAS、不可变安装、精确备份、owned-inode 回滚、failurehold、durable close与客户端独立锁核验保留。全部12进程 config/ENV指纹、非目标PID、dump/nginx bytes/stat保护均绑定捕获记录。

本次未执行发布器，未访问网络、SSH、数据库、Git或生产，未修改候选、主 manifest 或发布器；仅写入本审核 JSON/Markdown。既有验证全部为 synthetic/受控DI/SQLite，非真人/MySQL。发布后的两个匿名采购GET仅证明授权门禁，不是业务SQL/写测，也不保证应用启动/重载的全部数据库写入为零。上线仍以发布器当前基线、双锁和运行时保护通过为前提；完整细目及限制见 `integration-release-review.json`。
