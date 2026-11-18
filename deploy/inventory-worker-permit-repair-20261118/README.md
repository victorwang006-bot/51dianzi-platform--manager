# 库存 worker 许可修补与健康日志增量

根因是 worker 更新后，根控制审批许可仍绑定旧程序指纹。进程在线不等于业务就绪。解决方法必须审阅已批准旧程序到当前程序的累计差分，再按正式许可流程绑定最终 artifact；不得移除 epoch、许可、企业、权限、配额、行版本、租约或防重复校验，也不得直接改任务状态或补写库存。

本目录的 `build-health.cjs`、`test-health.cjs` 仅在本地构建和测试。`release.py` 是主流程的限定发布控制器，默认无写预检，仅显式 `--apply` 才应用已经批准且完整指纹冻结的私有包；它不是为任意新程序盲改许可的通用旁路。

## 健康补丁

两个 worker 各在原生 main 邻接位置加入三处纯插入：内存状态闭包、原 guard 阻塞分支日志、原 guard 通过后日志。原 guard 表达式、idle／continue 和 main 业务语句保持。首次阻塞和许可转换立即记录，持续阻塞至少 60 秒一条，不新增定时器，不读取／输出环境凭据、客户、联系人或业务 ID。

```json
{"worker":"inventory-import","businessReady":false,"reason":"RELEASE_PERMIT_OR_READINESS_BLOCKED"}
{"worker":"inventory-import","businessReady":true}
```

发布 worker 使用固定 `inventory-publish` 角色。`businessReady: true` 只表示本轮原 guard 允许，不代表任务已经成功；最终任务结果必须由真实只读记录核验。

| Worker | 原固定基线 SHA-256 | 新健康候选 SHA-256 |
|---|---|---|
| import | `d126bfa328a9a73b6f75c87308c4d5ef9ede9d87b6e53dfbae86a178723bb275` | `1b0a57b41d2f44371ed43d7f609a50f733931531172d412cbb1e65c39c66f3ac` |
| publish | `3d62bde157308a67e1512aac14387e707c984d582258d8ce61e6842024121e6e` | `e3fe7e3586f2380616fbfc9fd905a1fcde9a13d6a028304dbc7c7625193e47fb` |

合计两个 hunk、六处插入、零删除。精确逆转得到整个原文件和 AST；许可实现全文不变。60 项隔离 VM 回归通过，完整生产 bundle 不执行、不重编、不进入公开仓库。

## 许可与发布约束

控制器冻结当前两 worker、原许可、增量、原生只读探针、控制器和清单 SHA，并保护所有当前 API／HTML／静态资产／runtime／环境及进程前像。使用项目双锁和共享窗口，只停止两个目标 worker，精确替换已审阅健康增量及许可，再要求原生门禁许可／readiness／物理程序检查通过后恢复这两个实例；其余进程 PID 和环境保持。

许可只改变 `workerArtifactSha256.inventory-import`、`workerArtifactSha256.inventory-publish` 和重算的 `contentSha256`。原 epoch、审计证明、readiness、candidateManifestSha256、issuedAt 及另外三个角色指纹保留，不用本轮发布包 SHA 覆盖历史审计字段。原生探针只执行只读事务，绝不启动 main／claim。

失败恢复仅限本任务仍持有的前后字节，不回退第三方新程序、HTML 或任何业务数据库；恢复未验证时保留 `recovery-required` 阻塞窗口。恢复合法服务后，只有既有 worker 处理原来用户已提交的队列；控制器本身没有业务 DML。十项完全离线控制器测试覆盖成功、许可／文件／进程漂移、窗口忙、门禁拒绝及第三方字节保护。

## 本轮交付

两 worker 原生业务门禁、健康状态和正式发布回执已验证；原上传任务由合法服务完成，暂存、结果、正式库存及归属真实只读核验一致。后台另一任务的 API／页面成果和其余进程保持，原授权只读统计探针仍可用，不创建浏览器会话，不使用会产生 ERP 同步副作用的普通 context。

公开仓库只保存源码与匿名工具。完整 bundle、许可、保护快照、真实用户库存与财务、原始回执放在受控私有运维目录。今后每次 worker 更新必须重新审阅和绑定最终程序 SHA，不能把 PM2 online 当作导入成功。
