# 客户未读与布局热修

用户2026-11-21反馈：只看未读崩溃并要移入功能栏，公司名换行、功能文字裁切一并修。

源码冻结和定向测试已完成：源页面18项；真正完整原生WB0 Jw/WB1 vt离线执行各16种交互状态。旧模块均实际复现undefined.map，新候选通过。只改实际客户列表四个槽位：result不可用为undefined、移除独立控件行、控件移入搜索/重置功能栏、长公司名自适应表宽。保持固定操作列、完整公司title、星标与未读标，窄屏使用原横向滚动区。

`build-hotfix.mjs`从当前生效静态模块的fresh完整hash构建；不重跑历史admin-polish构建器。每个模块整个文件正向/逆向bytes核验；所有其他原生功能/详情/库存函数不变。HTML只改有效importmap和原CSS链接；新模块继承原singleton依赖映射。

静态发布器保双锁、完整CAS、私有fsync原bytes备份、原子替换、失败精确回退、持久closed回执。前台HTML和两个API为强制no-op，runtime不改、PM2不reload、不执行真实清未读/客户/询价/订单业务测试。源码与native离线fixture使用只读mock和opaque外部组件，未冒称真实登录/像素布局全测。

此提交为已冻结待发布版本；正式结果以随后receipt.json为准。载荷及SSH认证配置只留私有任务工作区，不入Git。
