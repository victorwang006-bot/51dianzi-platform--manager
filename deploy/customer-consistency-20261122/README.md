# 客户后台一致性修复 · 2026-11-22

用户00:33已批准按照自查建议实施并上线。沿用真实后台源码及ECS静态发布，不创建另一演示站；本次源码冻结时尚未发布，最终状态以本目录上线回执和持久receipt.json为准。

## 产品修改

客户列表采用有限整表1312–1392px，公司列只吸收280–360px，其余列固定预算。公司名单行省略并保留完整title/详情入口、重点星标及未读标记；空状态容器不撑高。供应上传与库存常见双操作同排，特殊长文案可自然增长，不裁剪功能。桌面工具栏顶部对齐，窄屏主动作优先；保持单一外层横向滚动、右侧需求与跟进固定。

通知运行时在同账号、同模块/商户和当前有效generation内同步现有多个QueryClient，不依赖同页广播。服务器accepted后取消旧查询、推进失效世代并刷新原摘要和unreadRefs，旧请求不得回弹；当前有效服务器lastKnown90可以覆盖旧91，unknown0不能清零。详情和顶部明确显示核验、阻断、失败、已确认及摘要待更新，失败重试保留fresh receipt及原账号/可见成功页面/权限守卫，不使用本地减数。

## 实际资产及证据

两份真实工作台分别仅改List两槽、Detail两槽，保留两阶段精确逆变换和其余bytes。通知运行时保持原React/Query/业务作用域对象身份和单例，不重新打包Provider。后台HTML只更新对应importmap值及一条客户CSS链接，导航原bytes及全部非目标映射保持。

最初完整51条上线样式链发现基础客户表格CSS未随新覆盖交付，导致内层overflow、sticky和列预算失败。已保留失败记录，构建改为旧CSS完整字节前缀＋源码客户局部foundation＋新覆盖，排除历史页头/subgrid。最终六组真实Chromium离线几何全部通过（WB0：1920/1560/1280/390；WB1：1560/390），包含长公司名、普通49px单/双操作行、功能可达与返回记忆。最终两工作台/通知runtime19项DOM场景和32项原生列表交互通过；本次仅CSS变化后未重复不受影响的业务测试。

标准pnpm check仍报告未修改server/services/adminNewInformation.ts(819,33)的默认ES5 MapIterator TS2802；未改后端或tsconfig掩盖。全库 `tsc --noEmit --target ES2020 --incremental false` 通过。源码与静态安全断言、SHA及HTML/import ABI证据另存本目录evidence。

## 发布保护与边界

本次仅新增4个admin不可变静态资产并替换adminHTML。前台HTML、前后API、服务端运行时、导航字节不变；不重启API或worker，不改数据库、权限、员工、客户或库存。使用原双锁、fresh SHA/stat CAS、原子私有stage、精确备份/自有回滚、failurehold与持久closed回执。若协调或目标漂移必须重新基于最新前像，而非强制覆盖。

所有业务context/get、summary、inspect、markDisplayed和unreadRefs测试均为mock；真实生产业务读写为0。本次未代用真实员工账号确认seen持久化、真实签名receipt或账户权限闭环，因此不把离线PASS或资源HTTP200称为真实已读落库验收。公开归档不包含密钥、token、私有payload、协调文件内容或真实业务数据。
