# proc虚拟元数据被误当持久身份的实际问题

2026-11-20 13:04原R7 dynamic_protection同路径诊断在不修改任何原守卫情况下抓到DYNAMIC_FINAL_FULL_PROC_DRIFT。两次完整扫描均是原15PID，所有scan identity/name/cmdline H一致，没有新增、退出或启动时间变化。唯一拒绝字段是PID1 kernelLinkMeta的exe/cwd虚拟symlink inode和mtime/ctime改变：实际目标、permission、真实FS源及其他record字段没有变化。此前只按错误标签概括为Node集合变化并终止任务，结论不够准确；先前各失败未保留字段差异，不能倒推它们与本次完全相同。

Linux proc_pid_make_inode以new_inode、get_next_ino生成inode，并调用simple_inode_init_ts。proc_fill_cache注释明确所有proc inode动态生成，在缓存前不存在，readdir创建dentry用于与stat编号同步。[1] 这类ino/初始化时间是proc缓存实例的元数据，不是被观察进程的持久启动身份。官方proc文档说明它是内核内部数据的接口，打开proc目录FD不阻止PID重用；死任务的旧FD不会指向同PID新任务。[2] proc/exe的业务含义是实际执行文件pathname，删除会附加(deleted)，须继续拒绝删除/替换或目标漂移。[3]

拟修仅精确cfg.proc/PID目录和exe/cwd两个虚拟链接的元数据表达，不对真实文件/库/API/HTML/锁/目录/alias/其他路径采用此转换。保留dev、kind/statmode、uid/gid、size/nlink，持续比较实际readlink target；PID+PPID+startTicks/comm和整cmdline/env/permission原保护不改，目标exe/CWD/映射实际文件fullH/fullMETA保持，采样前后完整复读和集合比较保持。只排除虚拟inode生成值与初始化mtime/ctime，不允许mtime/ctime例外泄漏到实际FS源。若cache实例变而这些语义字段与真实启动身份/目标不变可以通过；任何真正启动、链接目标、权限、源byte/META、未知集合、environment变更仍应拒绝。O_PATH固定cache只能延长本次引用，不能充当跨独立进程的持久启动ID；不会读FD/队列内容、执行应用或暂停服务。

这是本次实际字段与官方生成机制的解释，不是运行内核整源码H证明，也不证明以前每次拒绝的原因，更不是整包批准。新源码实现/真实再验证/current fullMETA/fullpkg审批仍待后续推进。

## References

[1]: https://raw.githubusercontent.com/torvalds/linux/master/fs/proc/base.c "Linux proc inode creation and cache instance generation"
[2]: https://docs.kernel.org/filesystems/proc.html "Kernel proc filesystem and PID descriptor lifetime"
[3]: https://man7.org/linux/man-pages/man5/proc_pid_exe.5.html "Proc executable target link semantics"
