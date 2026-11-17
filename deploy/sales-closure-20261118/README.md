# 简洁开单、公司库存与持久销售草稿

2026-11-18 01:24:09（北京时间），最终 `release-final-0118` 已联合上线并 verified。主站和后台仅滚动重载 `dianzi51` / `dianzi51-admin`；其他 worker、运行环境、nginx、PM2 dump 均未改。代码阶段不执行业务 DML、DDL 或 GRANT；证据充分的历史入库关联维护和空草稿表新增迁移为独立受控阶段，未创建真实验收订单、客户、出库或付款。

## 实施内容

紧凑客户→货源→明细→操作开单界面；删除多余客户保存提示和教程，利润/提成默认收起。公司批次搜索下拉采用服务端分页及 selected ID 单独核验，支持型号特殊字符。订单草稿按真实公司/员工/adminAccount 隔离，服务端 CAS+本地兜底，不预留库存。无行返回 null，删除墓碑返回真实 revision 与 payload:null；旧首次 revision0 不得复活墓碑。未知创建完整冻结原 requestId/payload，仅原请求核验，身份变化/迟到响应/草稿版本冲突不得重新组装订单。冲突显式重读先保留本地旧表单，GET 成功和失败均不得丢弃内存冻结原请求。

正式公司销售、预览和出库使用真实批次与本单有效预留，正式创建/幂等/预留/审计共用事务，合法取消释放。已付款或出货不可直接取消。未知成本保持利润、提成待核，不作零成本。

## 最终验证

| 验证 | 结果 |
|---|---|
| 前端 hook / 实际外层开单页面 / 公司库存 | 39 / 55 / 67 项，共 161 passed |
| 草稿服务与真实 router/gateway 离线适配 | 35 passed |
| 后台 BFF/HTTP 权限及输出 | 21 passed |
| API 实际 native runtime/回调 ABI | 14 passed |
| 实际 A/B 模块与四 getter 原生 DOM | 17 passed |
| manager / platform TypeScript | 两端通过 |
| ECS preflight/apply/verify | passed/applied/verified，12 进程健康 |

UI 验证是真实安装 React/ReactDOM 19.2.1、现网 native Zod 及精确 getter 字节，完整 A/B 模块使用禁止网络的声明式 mock imports。现网 React 亦为 19.2.1，但不宣称库字节完全相同、生产登录交互或真实 InnoDB 并发锁已由此证明。

## 冻结绑定与恢复

最终 manifest SHA256：`47f3542e62d00a4a7ad0cdfdea30531ad24cd8a6aebcd36733e6da19be271cb1`。该单次控制器绑定独立 review、preflight、39 保护文件与 12 进程前像；双非阻塞锁、API/HTML 替换前 CAS、原子落盘，失败仅恢复自己的候选 SHA，不覆盖他人版本，additive 保留且禁止盲重试。旧实验候选从未 apply。完整代码前像、冻结源码和许可保留在受保护 ECS 备份暂存目录；本 Git 归档不含凭据、生产业务数据或大型编译产物。

此目录工具保留原构建布局和明确基线，不能在未知现网自动 relock。复现时将根工具与 current-tools 放回原工作区 packaging/，validation 工具放回 validation/，准备已捕获的 live/ 基线及两源码仓库；先新目录 proposal、执行校验、assemble、独立 review、现网 preflight，最后只有新显式授权/合法范围才可 apply。CSS 基线固定为 manager `f053ca2bee29c72cb69335548381be8289dc0ee8`，提交后不依赖可移动 HEAD。部署 helper 只在规范化后的非活动备份目录生成差量；不能把暂存构建误当已上线。
