# R9 当前包有限差量与待绑定补充

**结论：有限差量核验通过，原 R8 内容结论可复用；新 capture / sealed manifest 的机械绑定尚未完成，不构成生产批准或 source-verified 声明。** 本补充仅只读本地已保存文件及日志、比较原字节；没有重跑业务/预算/CSS测试、调用构建器/评估器、访问网络/MCP/SSH/DB/Node/API、操作服务或写 Git。原内容报告 `review-r8-current-payload.md` 不改写。

## 唯一旧阻塞的闭合

`current-store-baseline-user-acceptance.md` 记录用户于 **2026-11-20 14:02:35 北京时间**明确采用当前技术库保护基线，接受 STM32F407VET6 revision 2→9、参数/PDF 不变的更新。因此旧 `87910d282ec0a2a1b76235bbc4462ef98049d8228b7400de66a8bb6091ef4faf` 与实际 `37ddd23b13b10aa009f06234ee49e115a197457c372aa2024a417e110a6e4e71` 不同不再是本次有限内容阻塞。发布仍须保护新真实 capture 中该库的完整实际 SHA/META，本批次不修改该库。原只读 sourceVerifier 的 `CURRENT_SOURCE_VERSION_MISMATCH`、退出 1、无写入事实保留，不能改称通过；用户采用也不续期旧 capture。

## 精确工具差量及既有证据

R8→CSS修改前R9的 `release.py` 全文件差量只有 SCOPE `customer-batch-actions-20261120-6Lfttf6o-R8`→`customer-batch-actions-20261120-6Lfttf6o-R9`、TTL 900→3600；准备器只更新固定 controller pin。用户 **13:52:25**已明确授权本次 TTL3600、供应商 timer 最长暂停3600。保存的 `r9-budget-proof.json` 与 `r9-budget-tests.txt` 相符：8项通过（0.285s），日志 SHA `473ca52dae8c831149b4e1761a394f103fef8244fdd6180da464c18a5700869d`；未重跑。timer 脚本差量限 R9 stage 与已授权维护时限（receiver 1900→3700；实际暂停上限1800→3600），原恢复/保护流程不变。

CSS基线 `evidence/r9-css-baseline/release.py`→当前 controller 的唯一差量是 `validate_payload` 新增两行：对 `selector.strip()` 恰等于 `@media (max-width:900px)`、`@media (max-width:600px)`、`@media (max-width: 640px)` 的三个已审 wrapper 执行 `continue`。原内部 selector / comma scope 检查未改；其余整个文件字节不变。保存的 `r9-css-tests.txt` 为8项通过（0.228s），含未知media、font/supports、wrapper内非scope及comma拒绝；日志 SHA `bdd94ebfad67e1eea017b2ab92308231c6f0d7adb35557e84f36845432d0f756`。当前 controller SHA `2c7047701591af1ee2c21f93fe84593184ff0e6e3ed3d40ad2ee1d0f87dea0f8`；当前 preparer SHA `228a64cf55224e1ea1882ac4c66958fe961d5c80ada43a0e6a26cceb47e0319b`，相对CSS基线只改固定pin。

## R9已建包复用核验

比较 `backend-prepare-r8-current-002/candidate-spec.json` 与 `backend-prepare-r9-current-001/candidate-spec.json` 指向的实际文件：source key集合均为33项，其中31项逐字相同；只有 `release.py`、`prepare-local.py` 两个工具快照仍为CSS修改前R9，允许之后准确重绑定当前工具。规格显式列出的8份compiled-source JS也逐字相同；未扩展依赖图。

两API before逐字相同：front `51cd26a93c1d64fb0e6de6e13c2d19f8453b442cd702a6f5890e860cc451f017`，admin `a7a3f52a4fb21d7b6f73379b17b965d531d39b5e60d9ae873ce976683bb8b60d`。15+7共22个patch的实际名称、oldText/oldSha、原槽及新槽坐标完全相同；20项newText原字节相同。仅两项 `history.approved-local-namespace` 的front38行/admin5行 `//` 注释改变冻结目录。只替换两组**准确**绝对/相对 `backend-prepare-r9-current-001/backend-freeze-inputs/source`→对应R8目录后，两initializer及两份完整API after均逐字等于R8。无正文或槽外差量，原byte/inverse及非干涉证明复用，不重新计算无关完整代码。R9实际API after SHA：front `f469759300751d17ef20ae244efd272ae1f8c200d84dde4ec9ba6a9b50ebde8f`，admin `14034473467f2b22f3dcf2f11624b961c4c7831d69e41bb21ac401f9bb85a120`；不冒称其全SHA等于R8。

两JS/CSS/HTML实际原字节及after SHA均与原内容报告准确相同：

| 对象 | 完整SHA256 |
|---|---|
| JS 9e0625dd | `9e0625dd796f1d58e8024bbb2652a847fc4aa9e66c60cc659a07ebd2e4ed4479` |
| JS 96ff8152 | `96ff81525a3f2e1301ab1c3684eed0c8d8e0d0c25fae262858f5c160c149f82d` |
| CSS | `0abf3e1aacf580cfda4a0f9f45db055a549ed5cb4e59d2c09b96b8e22c23fb97` |
| HTML after | `891672cae359b9c4c22426a4f3c6c9f4cc17950cea13be9dd101ce0b50be1c55` |

HTML before亦逐字相同，SHA `71aca2bb6483befa1f3a4bf09a8aaf73f619bac3299d9bec9f4ea9d67878efa3`。

## 待最终机械绑定

本范围内无未许可实际内容差量。尚需父任务提供新sealed manifest路径/实物及capture SHA，再核对当前两工具快照、原内容报告和本补充原字节、上述精确payload以及新capture/ownerNonce是否真实绑定。**现不填写不存在的manifest hash、审批file或生产/source-proof通过结论；不读取或等待未完成capture。** 全META/source/CAS、权限、双锁、coord、TTL、回滚及no-replay原发布门槛继续有效。
