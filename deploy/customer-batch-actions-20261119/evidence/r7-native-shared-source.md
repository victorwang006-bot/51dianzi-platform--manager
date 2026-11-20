# 现役pnpm共享原生库的来源限定保护

R6首次完整只读捕获拒绝FileNotFoundError，没有capture/attempt/发布/reload；随后当前pure动态收件诊断拒绝DYNAMIC_SINGLE_REGULAR_SOURCE。仅执行源身份的有界诊断得到48实际源路径，其中两个普通ELF文件nlink=86，非symlink、非删除或异形文件。随后仅定向读两库全字节/ELF头/元数据前后/两packageJSON，全部一致，未加载库、未改链接、未执行模块。实际数据在任务私有native-hardlink-source-pins-once.json，不含env值。

pnpm官方说明包文件会硬链接到内容寻址存储；多个链接指向磁盘上的同一文件数据，并非各自独立副本。[1] [2] 这解释当前库86链接，不代表扫描了全部86个别名，也不能豁免未知硬链接执行源。

已定位的两个当前库为20261030-migration-v14/front虚拟存储中的@img/sharp-libvips-linux-x64 1.3.3 libvips-cpp.so.8.18.6与@img/sharp-linux-x64 0.35.4 sharp-linux-x64-0.35.4.node。机器生成完整SHA/size/ELF/nlink/dev/inode/mode/owner与package来源hash以实际JSON为准。新来源限定方案只允许这两个精确路径的准确已读字节与固定86链接/元数据；并非通用放宽hardlink。读取前/后完整fstat/META和rename检查保留，每次完整H校验，原映射device/inode绑定和所有保护样本再读保持。改变同一inode的字节、链接数、owner/权限或时间等均会改变保护结果；unknown硬链接及symlink继续拒绝。两库不可CAS写入/拆链接，包JSON仅来源说明不是新的执行源豁免。

固定观测不能保证对不协作root写者的原子冻结，也不能由两个原生库证明全部loaded JS源码闭包；完整当前source/META/未知进程依赖与新包独立审仍待后续。六目标先前Ready全部True是一次实际布尔/字节JSON见证，不替代R7fresh完整捕获、typed/完整raw及包审批。

## References

[1]: https://pnpm.io/symlinked-node-modules-structure "pnpm package files linked to content-addressable store"
[2]: https://pnpm.io/faq "pnpm hard links address the same underlying disk data"
