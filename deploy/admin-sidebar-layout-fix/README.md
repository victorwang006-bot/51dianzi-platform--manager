# Admin侧栏菜单重叠修复

本次只修复Flex侧栏中原平台菜单分组被压缩、内容溢出重叠的问题。当前原CSS包含`.flex{min-height:0}`；分组默认flex-shrink:1，在菜单总高度超出视口时原分组高度可降至8px，而内部按钮仍为正常行高。新增分组进一步触发压缩。基线线上构建只插入一次智捷导航，不是重复挂载。

修复为`[data-sidebar="content"] > [data-sidebar="group"]`和`.zj-sidebar`设置`flex-shrink:0`，菜单自然超出并由原SidebarContent滚动。智捷新增细分隔线和间距。保留原字体字号、选中、红色角标、点击、折叠逻辑，没有业务总览。

构建只将`client/src/components/zhijie-sidebar.css`压缩为新的内容哈希CSS。部署脚本capture当前ECS保护快照，读取当前HTML并只替换唯一的ZhijieSidebar样式引用；不使用上一轮index.html，不改模块importmap、不覆盖原CSS/JS，不变更Nginx或任何运行服务。所有现有静态文件、主服务文件、智捷服务和原PM2进程受保护；数据库没有连接或写入。失败只在当前HTML仍是本版本时恢复即时原件，有并发变更则停止而不覆盖他人版本。

布局验证以线上原CSS和新侧栏CSS在隔离iframe进行，模拟长菜单、低高度、缩放和折叠，不签发真实会话，不进行后台业务写操作。最终需校验公网HTML与CSS哈希。部署与验证结果保存在服务器ops目录和本地evidence，构建制品/快照不进入Git。

## 发布结果

2026-10-27 18:48:21（北京时间）已发布到admin.51dianzi.com。新资源`/assets/AdminSidebar-layout-fixed-9dd0cd88c70bb590.css`，SHA256为`9dd0cd88c70bb590bed9b0e1f9f4450fcbdc9e7036bd15894440548b6d440c0c`。HTML仅替换一条CSS引用，其他HTML/importmap逐字保持，256项原文件与所有PM2进程保持，数据库未连接/修改，Nginx和智捷服务不变。源码全项目类型通过，隔离布局30组通过（5种高度×展开/折叠×100%/125%/150%缩放等效视口），滚动、无重叠、末项可达、Logo/账号稳定、字号、角标、点击和横向溢出均通过。公网CSS与HTML字节哈希验证通过；requests对未声明charset的HTML可能推断为ISO-8859-1，文本比较须显式用UTF-8解码，不据此错误修改页面。

用户要求协调的另两个任务：库存任务只拟新增库存前端哈希资产并增量改www库存import-map键；公众号任务已完成其既有文章/封面及草稿动作，待处理网站卡片若需修CSS只增加hp-report局部样式引用。双方已确认暂缓共享ECS、继续本地开发，候选就绪申请窗口。三任务使用共同的非阻塞发布锁，后发布者从最新www HTML合并并保留前者。协调记录`/opt/ops/51-project-release-coordination-20261027.json`。本次后台修复没有发布或替代其他两任务的候选，也不误报其全部完成。
