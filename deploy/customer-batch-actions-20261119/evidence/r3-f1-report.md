# R3 F1：有限JSON入口的最小离线修正

**结论：F1小修正静态通过；整体仍NOT_APPROVED，未上线。**

独立R3审查发现，原 `parse_constant` 只拒绝字面NaN/Infinity，普通合法JSON指数 `1e400/-1e400` 可在未知nested子树中解析为±inf，违反严格有限值门槛。该审查未证明重载/成功绕过；原字节与五数字metadata约束未被绕过。

本次只在 `release.py` 增加标准库math导入，并在 `decode` 内增加checked `parse_float`（先float转换，再math.isfinite，不有限即NONFINITE_JSON）。准确字节差量仅6行新增；除decode之外所有原有顶层AST及全部PM2/审批/CAS/恢复协议保持。preparer仅固定CONTROLLER_SHA同步。不增加字段白名单、不改变scope、不规范化任何原token、不限制正常有限业务数字为PM2 safe integer。

当前控制器SHA：

```text
bf7ec85b902ae2474ded779bfad110e7ac791e7d4c244d67ca6f912614d375ab
```

基线ec2及其初版审查/测试原样保留；R3远程stage/capture/attempt从未创建，故此离线最小修正仍属同一个未尝试R3 scope，但ec2旧pin不可复用。

## 验证

新增 `test_finite_json.py` 六项纯内存测试通过：正负指数溢出，root/未知nested/array/env任意深度，原NaN/Infinity拒绝，有限指数及下溢指数允许且原bytes不变，opaque/escaped字符串原bytes保持，duplicate key继续拒绝。原完整控制器89项与准备器32项再次通过；没有重跑业务或真实生产流程。

主任务精确AST/pin证据为 `r3-f1-source-and-safety.json`、`r3-f1-controller.diff`；最终原始日志为 `r3-f1-finite-tests.txt`、`r3-f1-release-tests.txt`、`r3-f1-prepare-tests.txt`。独立F1审查再计算基线/当前SHA、复现旧反例、单独提取纯helper与测试类运行6/6，确认F1已纠正、其它92个原顶层AST保持、preparer唯pin变化。独立报告另存 `r3-f1-independent-offline.md/.json`；未导入完整被审模块，不执行发布或Node/God/RPC/数据库，不生成approval。

## 发布限制保持

ECS备份失败与容量处理、前台方案B最新纯静态需求共同hold。服务器任务报告外部盘已300GiB，但p3/根文件系统仍旧规模约197G且99%，快照与新成功文件备份未确认；这不是应用可写恢复审批。后台不新增ECS连接、capture/stage、业务active写、reload、DB/env写，不清理或迁移旧shadow/回退/现役日志目录。

仍缺实际fclone语义、六own完整retained-byte/source-shape witness、当次fresh完整META/前台新保护集合/完整包与正式独立审批。原R3 late readiness gate仍属于受控失败设计，不声称known-false包可安全fully-approved：**正式审批前六own pm2ReloadReady必须全部True**，且与capture/manifest绑定，all-true只是必要条件；不能用89/32/6 mock或旧8a130/f893审批。

只有服务器任务明确安全边界、前台最新静态scope actual verified durableclosed及明确交接后，后台再fresh重建、完整独立审、窄scope一次性发布并verified closed。当前所有controller/release/finalDeploy批准均False。
