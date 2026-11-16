# 商城页全局导航修复：已上线

2026-11-17仅撤销两处导航读取/显示禁用条件。商城与其他后台页均按当前账号真实导航权限显示，不伪造或放开capabilities。独立官方商城的原生账号/PermissionGate/数据/表、无BusinessScope边界不变。

8项真实DashboardLayout+AdminWorkspaceNavigation DOM回归及后台全量TypeScript通过。新导航JS与后台HTML映射已正式切换，公网HTML/导航哈希通过；原App主入口/商城leaf/CSS哈希相同，12进程PID、启动脚本/环境、Nginx及PM2保存配置保护通过。不重载API/worker，不执行DB操作，不创建物料/订单。

未使用真实员工登录浏览器做业务写测；页面完整菜单依据当前账号的实际导航授权返回。刷新当前商城页加载新资源即可。
