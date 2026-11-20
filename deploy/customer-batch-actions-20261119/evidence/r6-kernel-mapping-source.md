# io_uring映射类型的来源与本次适配边界

R5首次双锁只读捕获实际11:55拒绝DYNAMIC_UNSUPPORTED_MAPPING，没有形成capture、attempt、发布窗口、API/HTML写入或reload。随后一次有界maps类型诊断只读当前Node及父图，20个进程集合中17个Node出现总110条unsupported，类型全部精确为anon_inode:[io_uring]，实际权限rw-s、dev00:0f、非零inode。完整诊断仅在本任务私有work保存，不含环境值、不当新鲜全META或审批；未知新增两个Node仍须后续完整actualgraph/source审查，不能固定旧15数量。

Linux io_uring源码的io_uring_get_file创建名为[io_uring]的匿名inode文件，注释明确应用通过mmap访问提交与完成队列。[1] io_uring手册描述队列是用户与内核共享的环形缓冲区，示例以PROT_READ|PROT_WRITE和MAP_SHARED映射。[2] maps手册定义权限x表示执行、s表示共享，并说明dev/inode/offset及pathname字段。[3] 这些公开来源解释精确内核类型，不是运行中内核整源码pin或当前进程完整状态证明。

本次仅支持这个实际精确命名且无执行权限的共享内核数据映射。不能把它当绝对文件源读hash，也不能忽略它：foreign映射的权限、offset、device、inode、长度和multiplicity应完整记录比较；自有六槽的运行时匿名I/O inode变化不塞入稳定执行源码图，仍由原严格自有重载证据链保护。任意其他anon_inode名、可执行或非法形状继续拒绝，所有文件映射source/fullMETA/multiplicity与原环境/权限/业务/捕获/审批协议不改。新R6scope不用已拒绝的R5stage。

## References

[1]: https://raw.githubusercontent.com/torvalds/linux/master/io_uring/io_uring.c "Linux io_uring anonymous file creation source"
[2]: https://man7.org/linux/man-pages/man7/io_uring.7.html "Linux io_uring shared queue manual"
[3]: https://man7.org/linux/man-pages/man5/proc_pid_maps.5.html "Linux process mapping fields and permissions"
