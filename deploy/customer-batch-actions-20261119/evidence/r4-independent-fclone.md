# fclone / Utility.clone 独立离线语义核验

## 结论与授权边界

**仅有条件的 clone 局部证据成立；不能证明任意合法 JSON 树无条件等价，不能据此批准 reload 或发布。** 15 个有限、纯本地、合成样本在下述限定域通过 `fclone` 的值／键序／原型保留、递归容器独立及原对象不变检查，并与 Python `copy.deepcopy` 的解码 JSON 值相符。该结论不是 actual 六槽 retained forecast 通过，也不是 actual daemon 对象域已经证明。

发现两个明确反例边界：`Utility.clone(null)` 返回 `{}` 而不是 `null`；普通 JSON 对象的自有 `__proto__` 键在 `fclone` 中赋给普通 `{}` 时会触发继承的 setter，丢失该自有键，或改变副本原型。**“合法 JSON”本身不足以满足证明域；必须递归排除 `__proto__`。**

`controllerApproved = False`、`releaseApproved = False`、`finalDeployApproval = False`、`reloadApproved = False`。`actualSixSlotsRetainedForecastVerified = False`；未核验不能描述为实际六槽通过或实际六槽失败。

本次仅读取指定本地源码及稳定 evidence，执行自写纯本地比较；无网络、SSH、MCP、Git、生产访问、锁、应用 CLI、server capture、reload、pub 或源码修改。没有加载 `Utility`、`God`、完整被审模块、PM2 entrypoint 或应用。只执行经 SHA 校验的单一 `fclone` 函数文本；函数中的原生 `Buffer` 检测由本地 Node 内建值提供。子进程环境移除了调用方的 Node loader 环境配置。合成 lifecycle-looking / env 样本不来自客户数据，也不是业务或 metadata 政策审查。

## 来源与稳定参考

|证据|大小 / SHA-256|
|---|---|
|`fclone-resolved-once/fclone.js`|1239 bytes；`9b921f33e5d4e36dd030f5d2e736ea2af0c95f4fb795ada696160e2db7fe2fe6`|
|`fclone-resolved-once/read-record.json`|710 bytes；`d6c7d30385e379a15b0cceab0bbe8ed3e99da2fa15f21b1c67de359178d41ce0`|
|稳定 bf7 snapshot `evidence/r4-baseline-bf7ec85b/release.py`|114655 bytes；`bf7ec85b902ae2474ded779bfad110e7ac791e7d4c244d67ca6f912614d375ab`|
|immutable ec2 `evidence/r3-f1-baseline-release.py`|114459 bytes；`ec2f541d4cee799a21a9b21633110a183c8efaf162451876ad5aea415359bde5`|

后两者位于 `/home/ubuntu/51-manager/deploy/customer-batch-actions-20261119/`。读取前精确核验了 SHA；未读取变动中 R4aux 的 current 作为稳定 final。两份参考的 `pm2_raw_binding` 单函数文本**完全相同**，该函数文本 SHA-256 为 `cefe20459dba70b0d8f3329c6ab7ed8d155bc7b798b8262716c2393fd1801284`。只做文本／AST 提取，未 import 或执行 release 模块。

已有 `read-record.json` 记录 actual Node resolution：`/usr/local/lib/node_modules/pm2/modules/fclone` → `/usr/local/lib/node_modules/pm2/modules/fclone.js`，并绑定上述 local copy 与同一 SHA；记录自身标明 `EXACT_RESOLVED_SOURCE_ONLY_NOT_CAPTURE_OR_APPROVAL`。本次不重复远端 resolution，也不将此前记录当作新的 runtime capture。源码读取到此限定，不扩展寻找依赖。

### 本次观察的原链 pins（不是完整九源确认）

以下原链目录均为 `/home/ubuntu/work/customer-batch/pm2-live-source/`：

|路径|SHA-256|
|---|---|
|`lib/Utility.js`|`66cd15711be69f40f6ee3c3f60adcf07e58d0bcdec9552ec5104530b22ba28f1`|
|`lib/God.js`|`f598e5113890418827e31dd52fc3538e8f19287fad212cafd9388b0216fe500d`|
|`lib/God/Reload.js`|`5e90112e447c4634009ea35005ffd477aab93064f55390288c56b51eee25992e`|
|`lib/God/Methods.js`|`577a8505074225dfe73ce2c955c844662c6bc9d76c31d8102f809a1691262044`|
|`lib/God/ClusterMode.js`|`b4a9304e12f468f87a039c174c6ea4a1001f21d9dd1f5317121ed217bc389119`|
|`lib/ProcessContainer.js`|`712b414f248a460f58d4365898fa7b27d39bf7f571ac889359e3a7b6a32419d1`|
|`constants.js`|`5a4adce0c3c277d4974c0ebdefb22d62ffcad74edcf910bfeeff287dacb8a853`|

加上本次 `fclone` 共 **8 个观察到的源 pins**。任务要求 R4 是原 8 + 新 fclone = **9 源 pins**，而本次明确列出的原链只有 7 个路径；没有自行推测、追加或声称第九源已核验。完整九源集合仍待交接证据确认。

## 源码解释：哪些成立，哪些不成立

`fclone.js` 的函数在第 3–47 行，第 49 行仅 `module.exports = fclone`，无 imports。`Utility.js` 第 11 行依赖 `../modules/fclone`，第 92–95 行是：

```javascript
clone: function(obj) {
  if (obj === null || obj === undefined) return {};
  return fclone(obj);
}
```

对非 null 的限定普通 JSON 树，Utility 包装器不改变 fclone 行为；根 null 则不与 deepcopy 等价。嵌套 null 由 fclone 第 4 行原样保留。字符串、布尔值、number 同样原样返回，number 的符号零也不会由 clone 本身改变。

对象分支创建 `{}`，以 `Object.keys(obj)` 依次递归赋值。排除 `__proto__`、特殊属性与特殊原型后，非整数字符串键插入序得到保留，整数索引键仍遵循 JS 自身枚举规则，因此副本的 `Object.keys` 与原对象相同。密集数组分支创建同长度新数组并逐个递归赋值。可以按树结构归纳：叶值不变，每个容器新建，子树也满足同一性质，故源树不被修改、没有与源树共享的可变容器。这个论证与有限测试相辅，不是用样本替代 actual typed witness。

### 必须明确排除的域

- **自有 `__proto__`：** `{ "__proto__": {"inherited":"x"}, "own":1 }` 经 JSON.parse 确实是含自有该键的普通对象；克隆时 `copy[key] = ...` 将其设为副本原型而不是自有数据键。值为 null 会设 null 原型；值为字符串会被 setter 忽略。三种局部／嵌套合法 JSON 反例均已测到，Python dict deepcopy 则保留该键。
- **array-like：** 第 13–17 行不仅认 native Array，还检查数值 length、末端索引存在及可调用 `indexOf`。满足条件的普通对象会按数组复制，其他键丢失。合成 array-like `{0:'x', length:1, indexOf:function(){}, extra:'lost'}` 产生 `["x"]`；可调用函数本身已在 JSON 域之外。JSON 的 `length` 与字符串 `indexOf` 样本则未触发此分支。
- **稀疏数组及额外属性：** 循环会把洞变成自有 undefined 槽，只复制索引，忽略额外键。密集、无额外属性数组才在证明域内。
- **cycles／共享图：** `refs` 仅保存当前递归祖先；祖先回边变成字符串 `"[Circular]"`，不是恢复图结构。局部对象／数组循环分别产生 `{"self":"[Circular]"}`、`["[Circular]"]`。重复但非祖先的同一对象会被分开复制，fclone 不保留别名；Python deepcopy 使用 memo 会保留共享与循环。必须限定为无环、无共享身份的树；JSON stringify 会抹掉共享身份，不能据此反证源对象无共享。
- **special／prototype：** Date 构造新 Date，Buffer 使用 Buffer.from，ArrayBuffer views 调用 `slice(0)`；DataView 没有该方法时会抛错。普通 ArrayBuffer 本体未命中特殊分支。Error 先生成 name/message/stack，再复制 enumerable 键。其他 class instance、Map/Set、RegExp、自定义原型通常只走 enumerable 键复制，原型与内部槽不保留。函数和 undefined 由第 4 行原样返回，不成为可证明的 JSON 值。getters／setters 可执行副作用，symbol／不可枚举属性不被 Object.keys 复制。这些行为仅按源码说明，未声称与 deepcopy 等价，也未实例化应用对象。

## 条件等价的精确定义

成立必须同时满足：输入是有限、无环、无共享引用的 JSON 值树；数组为密集 native Array 且无额外属性；对象为普通 Object.prototype 对象，仅有自有、可枚举、字符串键的数据属性；**每层无自有 `__proto__` 键**；无特殊对象、函数、undefined、accessor、额外原型行为或 non-JSON 属性；number 均有限。Utility.clone 根还须非 null／非 undefined。

对应 Python 值必须是普通 dict/list/JSON 叶值且同样是树，数字解释忠实于 JS binary64，字符串／键忠实于 JS UTF-16 code units。例如 Python 能精确保留整数 `9007199254740993`，JS JSON.parse 会舍入到 `9007199254740992`，这是输入模型不同，不是 clone 变值；仅 `allow_nan=False` 并不能证明跨语言数字模型等价。数值测试限定到可对应的有限值；另有安全整数之外的传输反例。

在这些条件下，fclone 与 deepcopy 都可被用来证明**递归 JSON 值复制且不修改原输入**。两者各自保留其运行时的键序；这不等于 Python 序列化字节必然与 JS JSON.stringify 相同，不等于完整语言对象行为等价，也不等于 source daemon 的 actual shape 已满足条件。

## 纯本地比较证据

脚本：[review-fclone-offline.py](/home/ubuntu/work/customer-batch/review-fclone-offline.py)；仅向指定 JSON 文件写证据。Node harness 通过 stdin 收取已校验的单函数文本和合成 JSON 样本，未 require 被审文件、未执行 `module.exports`。Python 使用标准 `copy.deepcopy`，原 Node／Python 树均检查未改变；Node 另外逐层检查值（包括 Object.is 的 -0）、Object.keys、原型和新容器。

|类别|数量|结果|
|---|---:|---|
|限定域 JSON 样本|15|fclone 与 deepcopy 的保值、新容器及原样不变检查通过；根 null 仅证明 fclone，明确不适用于 Utility.clone|
|合法 JSON `__proto__` 反例|3|fclone 不保留完整自有数据／原型；与 deepcopy 解码 JSON 值不相符，预期反例成立|
|传输／序列化边界|7|覆盖大整数、1.0、-0.0、指数、CJK escaping、整数键枚举和孤立 surrogate；记录差异，不当作批准|
|域外合成图／array-like|4 类观测|循环字符串替代、别名丢失、deepcopy 别名保留、array-like 丢弃其他键；不代表 actual daemon|

样本还包含 empty 值、有限正负数、最小正 subnormal／最大有限 double、安全整数边缘、CJK／补充平面字符、控制字符、孤立 high/low surrogate、整数键及嵌套键、nested lifecycle-looking / env 值。全部 25 个 JSON 样本的源输入在克隆后未变；未做 bulkLLM、大型分析或随机海量测试。

### 字节差异不能当语义放宽

限定域的 `finite_numbers`、`lone_surrogates`、`integer_key_order`、`nested_key_order` 均记录 Python strict UTF-8 与 Node clone JSON 的字节不一致。

- `1.0`、-0、指数格式和极小浮点可在 JS／Python 序列化时有不同 spelling；clone 保值不意味着 spelling 相同。JSON.stringify 也会将 -0 输出为 0。
- JS 整数索引键先按升序枚举；Python dict 按解析插入序保留。fclone 保留原 JS Object.keys 序，deepcopy 保留原 dict 序；跨语言顺序差异不是 clone 导致的重排。
- `ensure_ascii=True` 对 CJK 会转义；稳定 forecast 用的是 `ensure_ascii=False`，该 setting 不能概括为所有 Unicode 已字节一致。孤立 surrogate 在 Python `ensure_ascii=False` 后 strict UTF-8 encode 会报错，Node JSON.stringify 可以输出 ASCII escape。比较日志自身用 ensure_ascii=True 安全存档；这不是更改 forecast 的编码政策。

稳定 `pm2_raw_binding` 第 513 行是 `copy.deepcopy(e)`；第 523 行是 `json.dumps(..., ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf8')`；第 524 行用 `pm2_project(predicted) == projected` 做保守字节门槛。预测只可作为保留应用字节的 equality gate，不能代替真实 retained bytes。上述 serialization／key-order 差异会阻断 forecast，孤立 surrogate 会编码失败而非产生可接受 forecast；**都不构成放宽语义、增删字段例外、规范化接受或改写 controller 的依据**。本次未执行该完整函数或 project helper，也不重审其业务政策。

## 为何 monitor JSON 不能直接证明 daemon 域

`God/Reload.js` 第 36／117 行克隆 `old_worker.pm2_env`；`God.js` 第 176 行再次克隆传入 env；`God/ClusterMode.js` 第 48 行把 `JSON.stringify(env_copy)` 送入 cluster.fork 的 pm2_env；`ProcessContainer.js` 第 19 行 JSON.parse。`God/Methods.js` 的 formatted process 中 pm2_env 直接指向 daemon 数据，而非提供完整 typed shape 证据。

RPC getMonitorData 获取并 JSON 序列化的模型只是一个观测投影。序列化／解析会抹去 prototype、函数／undefined 或 symbol 属性、访问器身份与共享身份；Date 可变成字符串，nonfinite number 可变 null，特殊对象可能变另一形状，带 toJSON 的对象可主动改变结果。**不能仅因模型是普通 JSON，就无条件反推出 reload 前 original daemon pm2_env 也是上面限定的普通 JSON 树。** 本次未扩展读取 RPC 实现；此处陈述的是任务所指 JSON 模型边界与 JSON 序列化语义，不是新的 RPC capture 证明。

只有 actual typed/fullSourceShape witness 已排除这些类型、属性与图行为，且 actual field 来源绑定、fullRetained／complete-byte witness 能覆盖 retained 内容、序列化模型在相关数字／字符串／键序上足够精确时，局部 clone 证据才可接入完整 source-defined proof。否则不能凭 monitor JSON 与 deepcopy 的局部一致性批准 reload。

## 哈希、复现与剩余阻碍

- 源码 SHA：`9b921f33e5d4e36dd030f5d2e736ea2af0c95f4fb795ada696160e2db7fe2fe6`。
- 比较脚本 SHA：`cd854bd729fcaa1e9cd26cc9fc041e006053877f69ba6efc57bb8dc10a06056b`。
- **纯比较日志 SHA**：`055bfcf52ea5f201f52477dcdf9aece847e4ca56f015a2f9cc0d78e3c1cbf018`。
- 日志完整嵌入 [review-fclone-offline.json](/home/ubuntu/work/customer-batch/review-fclone-offline.json) 的 `comparisonLogCanonical`；其哈希定义为 UTF-8、ensure_ascii=True、sort_keys=True、紧凑 comma/colon separators、末尾一个 LF。结构化对象同时位于 `comparisonLog`；不另写 log 文件。
- 本地复现：`python3 -B /home/ubuntu/work/customer-batch/review-fclone-offline.py`。会重建唯一 JSON 证据文件；只读取固定路径及执行合成测试，不调用 PM2 或生产。脚本也精确校验 source／稳定 reference pins。

仍须交接：完整 **9 源 pins**；外部 flock／Node／root 保护；全包；fresh14proc；六 Ready 全部 True；实际 typed/fullSourceShape／actualfield 来源限制；fullRetained／complete-byte witness；独立审批。此处全都**未核验／未批准**，不因限定 JSON clone 样本通过而消失。

主静态列表与详情的小双锁只读定位／未 pub 属于任务给定状态，不由本次离线工作新增 runtime 证明。后台始终纯离线，不 servercap／写生产／reload。最终三项批准值均为 **False**。
