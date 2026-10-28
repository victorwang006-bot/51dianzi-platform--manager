# 管理端生产版本基线（2026-10-28）

本次仅将已经部署、经审查的功能分支改动纳入 `main`，并新增本清单；不重新部署、不重启服务、不写入业务数据库。

- 仓库：`victorwang006-bot/51dianzi-platform--manager`
- 合入分支：`fix/cn-review-established-date-20261028`
- 已审查代码基线：`16cec88a371b7c17a5056cfe36678b00685972ee`
- main 原提交：`fc456eabc3f74ac4b8b5b080a74ca1e6612e6f77`
- 生产观测时间（UTC）：`2026-10-28T14:04:34.174047+00:00`
- 合入方式：将 main 非强制快进到已审查分支之上的文档提交；保留原功能提交和分支。
- 完整哈希及前端映射：`production-baseline-20261028.json`。该文件剔除了密钥、IP、主机名、PID、服务器绝对路径和业务记录。

## 覆盖范围

记录运行入口、后端及 worker 本地模块、HTML 入口、import-map、静态 literal import 图、运行时版本、安装依赖锁信息与源码锁文件哈希。import-map 可含历史条目；本清单不把历史映射全部视为当前必经执行路径。

## 源码可复现边界

**尚未通过从干净源码完整重建、产物等价的验收。** 合入已上线分支并不等于证明全站源码与生产产物一一可重建。

- Integrated review fixes are deployment patches, scripts and evidence; this does not establish that the application main source independently reproduces the current runtime bundle.
- Current layout retains the platform-navigation dependency while adding review-standard changes.

管理端本次合入的 40 个文件全部为 deploy/docs/scripts 新增文件，没有修改应用主源码。因此本次是修复补丁、测试及上线凭证归档，不是把生产修复回灌到主源码，也不能宣称 main 源码已与运行时同步。

后续应在隔离环境完成缺失源码回灌、overlay 输入与构建链梳理，再校验产物及业务行为。不可仅因 main 已收敛而从旧工作区或 main 直接构建覆盖线上。

## 审计及回退原则

本次文档提交为功能分支代码基线的直接子提交。最终 GitHub main SHA 以提交历史及实施回执为准，避免在文档内自引用提交号。若需撤销仓库变更，应采用单独审查的 revert，不强推覆盖他人提交；本次没有对生产服务执行任何回滚或切换。
