# F1 最小修正：独立只读离线验证

**结论：F1 小修正静态通过；整体仍 `currentNOT_APPROVED`。`controllerApproved:false`、`releaseApproved:false`、`finalDeployApproval:false`、`DeployApprove:false`。**

2026-11-20 北京时间 10:07–10:08，仅核验此次 6 行控制器新增、preparer 固定 SHA 同步及 6 项纯测试。本报告不是正式 Controller/Deploy approval，不授权准备、封印、预检、开窗、发布或回滚；不重审业务或 R3 其它阶段。

## 1. 独立实物及差量核对

审查目录：`/home/ubuntu/51-manager/deploy/customer-batch-actions-20261119`。

| 对象 | 独立计算 SHA-256 |
|---|---|
| 当前 `release.py` | `bf7ec85b902ae2474ded779bfad110e7ac791e7d4c244d67ca6f912614d375ab` |
| `evidence/r3-f1-baseline-release.py` | `ec2f541d4cee799a21a9b21633110a183c8efaf162451876ad5aea415359bde5` |
| 当前 `prepare-local.py` | `48fbfaecdb81c65dff8722b88c701fbccf5202457e2d080f0c24cbcd2993aa79` |
| `evidence/r3-f1-baseline-prepare-local.py` | `4041d7e102a57b2e95d7d569313070a48c7b4b91757a5b85640010d1eaa5e267` |
| `test_finite_json.py` | `2963b03499f1aaffe95dc58fe87e01b110cbac5955c6592422a08ddcb8a42c5c` |

自行生成完整字节 diff，并从旧实物构造允许改动后的预期全文，与当前实物逐字节相等。控制器恰新增 6 行：`import math`；`decode` 内四行 `finite_float`；`json.loads` 的 `parse_float=finite_float` 一行。无删除或其它改动。移除新增 import、将 `decode` 恢复为旧 AST 后，控制器全 AST（忽略位置属性）与基线相等；除 `decode` 外的原有 92 个顶层 AST 节点全部保持。**PM2 helper、RPC 常量、Controller、协议、保护与所有其它 AST 均未改变**；这不是重新批准其既有语义。

Preparer 完整字节差量仅将 `CONTROLLER_SHA` 从 ec2 旧值替换为 bf7 当前值；恢复该赋值后全 AST 相等。固定值与真实 controller SHA 匹配。其原检查 `107` 行 controller 实物摘要、`174` 行 capture 的 scope/controller 摘要以及 `350/376` 行输出/参数绑定保持，因此 ec2 旧 capture pin 不可作为 bf7 当前 pin 复用。本次不运行这些阶段。

父任务 `r3-f1-controller.diff` 与自行生成差量一致；`r3-f1-source-and-safety.json` 中源码和日志摘要也与自行计算结果一致，但未以其布尔声明代替独立计算。

## 2. F1 确实修复，原 token 不重编码

仅在内存从两份 controller AST 提取纯 helper，不 import/执行完整 controller 或 preparer 模块，不触发其 `__main__`。独立重现原反例：

```text
基线 decode(b'{"opaque":{"n":1e400}}') → n 为 +inf
当前 decode(同一 bytes) → ReleaseError('NONFINITE_JSON')
```

`parse_float` 对 JSON root、任意 object/list 深度的普通浮点 token 都生效：先 `float(token)`，再 `math.isfinite`，不有限立即抛 `NONFINITE_JSON`。原 `parse_constant` 的 NaN/Infinity 拒绝和 `object_pairs_hook` 的重复键拒绝保持。

有限浮点仍采用原 float 解析语义，不增加 PM2 safe-integer 限制、不限制任意业务有限指数。测试涵盖 `1e308`、`-1.25E-9`、`-0.5` 和解析为有限 `0.0` 的 `1e-400`；浮点舍入/下溢并非新精确十进制承诺。`pm2_top_tokens`/`pm2_project` 本身字节及 AST 不变，依旧读取原文本 span；新 hook 只验证，不将解析值写回。测试实际断言原空白、指数大小写、小数、下溢指数及整个 opaque 子树原 bytes 完全保持；字符串 `"1e400"`、`"\\u0031e400"`、`"NaN"`/`"Infinity"` 不被误判或洗掉。

## 3. 测试与日志

为了避免新增测试文件 `9–12` 行完整模块动态导入，本次只执行其原 `FiniteJsonTests` 类 AST；保留六个原 test 方法和断言，向 `r` 注入当前源码提取的 `ReleaseError`、`need`、`decode`、`integer`、`pm2_top_tokens`、`pm2_project` 及 `PM2_RAW_GENERATED`。Python 使用 `-B`/`PYTHONDONTWRITEBYTECODE=1`，不产生 bytecode。**独立内存运行 6/6，最终 OK（0.001s）**。

| 六方法覆盖 | 独立结果 |
|---|---|
| root 正负指数 overflow | 通过 |
| 未知 nested、array、env 内 overflow；token helper 入口同拒绝 | 通过 |
| 字面 NaN、Infinity、-Infinity 及 nested NaN | 通过 |
| 合法有限小数/指数和原 bytes/span 不变 | 通过 |
| opaque/escaped 字符串原 bytes 不变 | 通过 |
| nested duplicate 在 projection 前拒绝 | 通过 |

另只读核对既有日志的方法数、汇总、最终 `OK` 和 SHA，不重跑 controller/preparer 整套：

| 既有日志 | 结果 | SHA-256 |
|---|---|---|
| `evidence/r3-f1-finite-tests.txt` | 6/6，OK | `ab36567b74ef88771992c87875e0f9d1f2ce5eaca7f04d0ed132a3f8b2de6f2b` |
| `evidence/r3-f1-release-tests.txt` | 89/89，OK；本次未重跑 | `6884006387e355ca4076690d901dba290d4bc497f3527b5fd4179fb65b47484b` |
| `evidence/r3-f1-prepare-tests.txt` | 32/32，OK；本次未重跑 | `7a6dc7efcebb03b304bd7d03e97bc592fac3f82677345628372753a9f8b2c3cb` |

收尾重新只读比较上述两份 controller、两份 preparer、finite test 及三份日志的原 bytes，均无漂移。

## 4. Scope、hold 和审批边界不变

源码 `SCOPE` 仍准确为 `customer-batch-actions-20261120-6Lfttf6o-R3`。按当前任务交接，R3 未运行 remote stage/capture/attempt，整个后台尚未发生 active write/reload/DB/env 写；**这些远端状态是继承的交接事实，本次未连接或探测远端，未据此制造 fresh 生产证明**。不复用 ec2 旧 pin。

ECS root 99% 与备份失败、前台方案 B 静态暂停共同 hold 继续。`fclone` 未知保持；实际 fclone 语义、完整 six-ready retained-byte witness、fresh fullMETA 及 fresh 包正式独立审批仍缺，不因 F1 或 89/32 mock 日志通过而闭合。无业务/R3 其它阶段重审，不新增门槛改写，不推进后续阶段。

本次没有网络、Git、SSH、MCP、生产 CLI/模块入口、锁、Node/vendor/RPC、DB、env 操作；未改 source/tools/物料，未生成 nonce、capture、stage、package、attempt、receipt、window 或任何 approval。只写本文件及 `review-f1-offline.json`；本次 active/生产/DB/env 写和 reload 均为 0。

**最终只叫“F1 小修正静态通过”；Controller 与 DeployApprove 全部 false，整个后台仍未获准发布。**
