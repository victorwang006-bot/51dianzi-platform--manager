# 渠道参考有限身份绑定实现

状态：本地实现已完成，锁定运行的 **`pnpm check` 通过**；最终相关回归 **18 文件 / 1302 测试通过，14 个原有跳过**。新增绑定测试 21 个。尚未生成、合并任何真实绑定数据，未连接生产、未部署。

## 文件边界

仅修改 `server/channelReference/snapshot.ts`，新增 `server/channelReference/identityBindings.ts` 与 `server/channelReference/identityBindings.test.ts`。`service.ts`、`shared/channelReference.ts` 保持不变；用户提供的 `client/src/lib/channelReferenceModel.ts` 在仓库不存在，实际模型位于 `client/src/business/platform/client/src/pages/channelReferenceModel.ts`，已读取并验证，无需修改。DB、业务型号品牌、所有数据 JSON、Git、部署工具、TODO、自动/手动生产器及禁用默认均未改动。

## 父代理生成输入格式

生产文件固定为 `server/channelReference/channel-reference-identity-bindings.json`，与快照同目录。不会从 ENV、请求、配置参数、URL 或调用者提供的路径读取。以下仅为格式模板，**不是任何真实型号/厂牌授权**；不得将占位值写入实际文件。

```json
{
  "schemaVersion": 1,
  "snapshotSha256": "最终完整快照原始UTF-8字节的64位小写SHA-256",
  "bindings": [
    {
      "raw": {
        "partNumber": "库存原始型号（逐字保留附加说明）",
        "brand": "库存原始品类/品牌（逐字保留）"
      },
      "canonical": {
        "partNumber": "已独立核实制造商专属完整MPN",
        "brand": "已独立核实唯一制造商的完整字面品牌键"
      },
      "sources": ["lcsc"],
      "confirmation": {
        "reviewVersion": "20261117-review-v1",
        "manufacturerSpecificCompleteMpn": true,
        "uniqueManufacturer": true,
        "additionalSpecificationsMatch": true,
        "basis": "记录完整MPN制造商依据、原始附加规格逐项一致依据、唯一厂牌排除依据及已核实证据出处；不是笼统的已确认。"
      }
    }
  ]
}
```

顶层和各嵌套对象字段必须完全一致，禁止未知字段或重复 JSON 属性名；`bindings` 最多 500 个，整个文件 1–524288 字节、严格 UTF-8（不接受 BOM）。每个精确 `raw` 的 `[partNumber, brand]` 组合只能出现一次，不能按来源拆成重复 raw 条目。`sources` 必须为非空、无重复的 `lcsc` / `ickey` 数组，最大两个；同一 raw 的两个来源共用同一个明确 canonical 身份。不支持前缀、正则、型号族、trim/case/全角 raw 合并、拼接键、链式绑定或运行时制造商猜测。

raw/canonical 型号最多 128 字符、品牌最多 64 字符，非空且无控制/不可见字符。raw 原文不规范化。canonical 型号只接受 `[A-Za-z0-9][A-Za-z0-9._+#/\-]*` 的完整字面形式；canonical 品牌必须已去掉首尾空白，且无 `*`、`?`、`\\`。审计 `reviewVersion` 非空最多 64 字符，`basis` 非空最多 2048 字符，三个确认字段只能为布尔 `true`。数据层确认是人工审核断言，不是运行时依据型号文本能证明的事实；父代理仍须逐项独立验证，**泛型多厂牌 FR107W / SS26 / MAX809 等不得任意指定厂家并填写 true**。

### 快照与来源绑定

选择最简严格的**整个快照摘要**方案，未增加单来源摘要框架。`snapshotSha256` 绑定最终完整 `channel-reference-snapshot.json` 的原始字节，包括生成时间、所有型号/厂牌、每个来源 quote 及 evidence。计算示例：`sha256sum server/channelReference/channel-reference-snapshot.json`；不得对重新序列化后的内存对象代替实际落盘字节计算。

canonical 必须为同一快照中实际存在的精确完整 `[partNumber, brand]` 行；该行允许来源的报价必须由原 schemaVersion 1 严格 quote/evidence 验证器判为 `ok`。不存在、来源未授权、字段被篡改、证据不合法或非 `ok` 均不会补值，绝不沿其他绑定跳转。canonical 行仍必须保留真实 `matchedPartNumber` / `matchedBrand`，不写回 raw 品类。任何快照字节更新，包括有效价格/库存变化或重新排版，都会使旧绑定整体失效；父代理真实合并必须生成新快照后重新计算摘要并生成绑定文件。

## 查找与失败行为

先冻结批准输入的 `materialId` / `partNumber` / `brand`，按原始精确键加载原快照。某原 raw/source 已有有效 `ok` 时绝对优先，完整复制原报价和 tiers，永不被 canonical 覆盖。仅对原来的非 `ok` 或不存在来源，才应用同一精确 raw、同一许可 source 的明确绑定。返回外层仍为原 materialId/型号/品类；报价内部仍为实际 canonical 的制造商及完整 MPN。

仅缺口场景按次读取绑定，无 import-time IO、缓存、watcher、网络、工作器或写操作。固定文件使用 `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`，要求普通文件并限制实际读取长度。真正 `ENOENT` 表示缺省不存在；损坏、非法格式/UTF-8、symlink、权限或摘要错误只禁用补齐，保留每个原 raw/source 的原始状态/数据。没有上一份好映射的保留行为。较早绑定读取迟到、而更新一次 lookup 已开始时，早先 lookup 保守不补齐，不能在新查询已看到删除/损坏后复活旧映射。

测试 DI 为 `createChannelReferenceSnapshotService({ readSnapshot, readIdentityBindings })`，`readIdentityBindings: () => Promise<string | Uint8Array | null>`；默认始终读取固定 sibling，`null` 为缺省。生产 `lookup(materials, { refresh? })` 的既有签名不增路径/URL参数。

## 当前验证

首轮命令：

```sh
pnpm exec vitest run server/channelReference/identityBindings.test.ts server/channelReference/snapshot.test.ts server/channelReference/defaultLookup.test.ts server/channelReference/manualRefreshConfig.test.ts client/src/business/platform/client/src/pages/channelReferenceModel.test.ts
```

结果：新增绑定测试 21、原 snapshot 测试 503、默认入口 1、手动配置 51、客户端模型 17，共 593 通过。覆盖合法精确绑定展示、外层 raw 保持、旧 ok 不覆盖、generic/变体不推断、唯一 raw/source 枚举、摘要及 canonical 原严格验证、坏文件/删除/读错误不保留好映射、迟到读与输入修改不泄露、固定文件/无调用者路径、普通文件/no-follow/大小/UTF-8 限制及默认禁用兼容。

最终命令：

```sh
flock /tmp/51dianzi-platform-manager-pnpm-check.lock pnpm check
pnpm exec vitest run server/channelReference client/src/business/platform/client/src/pages/channelReferenceModel.test.ts client/src/business/platform/client/src/pages/ChannelInventoryHost.referenceRefresh.test.ts client/src/business/platform/client/src/pages/ChannelInventoryHost.reference.render.test.ts
```

结果：类型检查成功；渠道路由、渠道解析/服务/快照/手动配置以及受影响客户端回归共 **18 文件通过，1302 passed / 14 skipped**，无失败。没有为环境的“无 active project”语言诊断建立新项目。报告中的 14 个跳过来自既有测试，不是新增绑定用例。

另外仅离线读取本地源码 JSON，调用未放宽的 `validateChannelReferenceSnapshot`：**294 records / 588 sources / 213 positive，allValid: true**。当前原始字节 SHA-256 为 `a00f52da7e423addf6b40508c972ad34df0eecec71250b1206ce9cb35c5ae436`，本子任务没有改动该文件。此摘要只用于当前状态记录，父代理合并 canonical 行后必须重新计算，不得直接沿用。

## 仍待父代理

独立研究完成后，仅对真正满足制造商专属完整 MPN、原附加规格一致、唯一厂牌的有限条目，生成严格 canonical 行与本 schema 的真实绑定文件；当前实现没有猜测或填入任何实际映射，也没有改动当前 294 组 / 588 来源 / 213 ok 的源码数据快照。真实离线合并审计与生产上线仍待父代理完成。
