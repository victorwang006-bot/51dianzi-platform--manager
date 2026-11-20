# 客户批次控制器 R2：仅本地最小差量报告

状态：**离线检查通过；未独立审核、未真实只读 capture、未批准**。本次未使用 Git/SSH/MCP，未访问生产，未运行 release CLI capture/preflight/apply/verify/rollback，未运行任何 JS 构建器。

## 当前源与范围

旧控制器 SHA256 为 `7fc9ec42ce21f6d0167b36ffbbe7642865a16f70fc31f8b99bf0da4862598423`，本次修改前已完整核对并留存旧源。

当前 `release.py` SHA256 为 **`d6f724847e205005060b6d11e0b15d7e31ba0ce373119187d062aba437e4cdec`**。`prepare-local.py` 固定 `CONTROLLER_SHA` 已同步；其余 preparer AST 不变。

完整 OWNER 保持 `6Lfttf6oVWJ8YS69o5FkXQ`；SCOPE 为 **`customer-batch-actions-20261120-6Lfttf6o-R2`**，默认 stage 派生为 `/opt/ops/customer-batch-actions-20261120-6Lfttf6o-R2`。Config 其余路径不变。未创建远程 R2 stage，不复用旧失败 stage/capture。

只修改指定六个既有文件：`release.py`、`test_release.py`、`prepare-local.py`、`test_prepare_local.py`、`README.md`、`prepare-local.README.md`；另新增 `evidence/r2-*`。所有既有 JS 构建器及原 evidence 的前后 SHA 保持一致，审计检查未发现其它既有文件变化。

## 控制器差量

新增纯 `adapter_files(cfg, entries)`，严格接受原绝对 specifier 对应的 `modules/pm2-axon/index.js` 和 `modules/pm2-axon-rpc/index.js` 两项固定解析结果，顺序也必须匹配。完整递归记录这两个真实 vendor 根及其所有普通文件、目录、空目录与 `lib` 后代的 `describe`（含文件 SHA256 和完整 META）。拒绝 symlink、hardlinked file、special/未知类型、错误入口、路径逃逸与枚举/META 漂移，不接受 npm/node_modules fallback。

`transport.sources` 保留 Node、God Reload、Daemon 源 pin，加入真实 PM2 root `package.json`，以两 vendor 树所有普通文件 pin 替代错误假设的两个 vendor `package.json` pin；每个实际 resolved 入口自然在文件全集中独立 hash 绑定。新增 `transport.fullAdapterMeta` 绑定完整路径集合和 META；源码 pin 必须匹配先前快照，Node cluster-source 探针后再完整快照比较。目录本身还在递归枚举前后精确核对集合与 META。

原 RPC 字符串逐字节保持：原 `require(a.base+'/modules/pm2-axon')` / `require(a.base+'/modules/pm2-axon-rpc')` 未替换；RPC verify 仍遍历全部 `sources` hash，未删 pin，未增加 fallback。Node/daemon/socket/God/Daemon、resolved-only 调用和 Node cluster-source 原语句保持。

相对旧 7fc9，AST 审计证明所有既有 controller 顶层节点仅 **`SCOPE` 和 `transport`** 改变，唯一新增节点为 **`adapter_files`**。包括 `Config`、RPC、snapshot、raw/env/permissions、双锁、CAS、bounds、full inventory、manifest/source/review、health、apply、verify、rollback、CLI 在内的其余 AST 均保持。原 `cfg.pm2_base` 整树 full inventory 未削弱。

这属于**固定 vendor closure 内容/META 绑定**，不是假造缺失的 npm package metadata，也不是替换依赖解析机制。

## 测试与静态证据

- `test_release.py`：**60/60 通过**，原 43 项安全测试保留；原方法唯一变化是 R2 stage 的固定期望，新增 17 项 adapter 文件集合、目录/META、源码与枚举竞态、晚变更、缺 root package、错 resolved entry、symlink/hardlink/special、拒绝 fallback 以及原 RPC 参数全 pin 检查。
- `test_prepare_local.py`：**30/30 通过**，原 27 项方法 AST 不变，新增 3 项当前 pin/scope 固定与旧 scope/7fc9 capture 拒绝。
- 四个指定 Python 文件及审计脚本内存 `compile()` 通过，未生成 `__pycache__`。

测试真实执行纯文件系统 helper/transport pin 计算，但 Node、daemon、socket 和 RPC 子进程均为明确 mock；全部可变 fixture 在独立 temp 目录。**未证明实际 RPC 可用或真实六槽发布通过。**

## 主任务只读证据与待办

已仅在本地读取、核对主任务保存于 `/home/ubuntu/work/customer-batch/adapter-source/` 的三份文件：

| 主任务只读文件 | bytes | SHA256 |
|---|---:|---|
| PM2 root package.json | 3718 | `f2819cffb2aae16bb813596575410877570a253be11949260caa33c8038788d6` |
| pm2-axon/index.js | 36 | `564748a7a82ddd5cf0e2fbc4204556d1b5078ceea2eba651fb183f8e2c43f4ab` |
| pm2-axon-rpc/index.js | 84 | `f5177ff52b4950dc70c5957b677909d34d2bcd9aca797a1a72244d92a4bfb656` |

入口文本分别只指向相对 `./lib` 或 `./lib/server`、`./lib/client`，没有改用 npm 入口。主任务同时提供前台 08:51 final verified/closed 明确交接，以及旧后台首次 capture FileNotFoundError 后无 capture/package/receipt/window/activewrite/reload 的状态；本子任务未重新访问生产核实这些上下文。

**尚不能认定完成动态依赖外部范围审计**：本地三份证据不包含真实 vendor `lib` 整树源码，helper 不执行或推断动态 require。真实 transitive 文件应由原 pm2_base full inventory 保护；独立差量审须根据实际源码确认没有未受保护的动态 outside-root 依赖，若有疑点必须拒绝而不是增加 fallback/扩大配置。

下一步仅由主任务按授权进行独立差量审及真实只读路径/完整树/capture 验证；**在两项实际通过前，新控制器不得 approved**。

## 证据索引

- [7fc9 旧源与修改前全部文件 SHA](/home/ubuntu/51-manager/deploy/customer-batch-actions-20261119/evidence/r2-before.json)
- [最小控制器差量](/home/ubuntu/51-manager/deploy/customer-batch-actions-20261119/evidence/r2-controller.diff)
- [全部六文件差量](/home/ubuntu/51-manager/deploy/customer-batch-actions-20261119/evidence/r2-allowed-files.diff)
- [AST/源 SHA/安全边界](/home/ubuntu/51-manager/deploy/customer-batch-actions-20261119/evidence/r2-source-and-safety.json)
- [静态及主任务本地证据 SHA 核对](/home/ubuntu/51-manager/deploy/customer-batch-actions-20261119/evidence/r2-static-checks.json)
- [60 项控制器测试日志](/home/ubuntu/51-manager/deploy/customer-batch-actions-20261119/evidence/r2-release-tests.txt)
- [30 项 preparer 测试日志](/home/ubuntu/51-manager/deploy/customer-batch-actions-20261119/evidence/r2-prepare-tests.txt)
- [证据与指定文件 SHA256 清单](/home/ubuntu/51-manager/deploy/customer-batch-actions-20261119/evidence/r2-SHA256SUMS.txt)
