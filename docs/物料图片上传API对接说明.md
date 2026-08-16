# 物料图片上传 API 对接说明

> 交付对象：负责物料图片资料上传的调用方（脚本、Manus 任务或外部系统）
> 出具方：51电子网后台管理系统（dianzi51-admin）
> 首次发布：2026-07-25　｜　最近修订：2026-08-16
>
> **本次修订要点（2026-08-16）：** 库内 ST 型号已由截短形态补全为完整型号
> （`STM32F058T8` → `STM32F058T8Y6`），接口同时新增**短号自动回退兼容**，
> 历史调用方无需修改代码。详见第三节与第七节。

## 一、接口用途与场景

本接口用于将物料图片（文件名即制造商型号，如 `STM32F103C8T6.jpg`）批量上传至 51电子网后台。后台收到图片后自动完成三件事：将图片保存到生产服务器存储、按型号匹配物料数据库 `materials` 表中的记录、把图片 URL 回写到该物料的封面图（`coverImageUrl`）与图集（`images`）字段。回写完成后，前台网站通过 RDS 直连或公开搜索 API 即可读到图片。

## 二、接口定义

| 项目 | 值 |
|---|---|
| 接口地址 | `POST https://47.97.108.147/admin/api/trpc/portal.uploadMaterialImage`（**必须用 HTTPS**，见下方说明） |
| 鉴权方式 | 请求头 `x-portal-key: <密钥>`（与商户入驻、留言接口共用同一密钥） |
| Content-Type | `application/json` |
| 图片格式 | PNG / JPG / WebP / GIF |
| 大小限制 | 单张 ≤ 5MB（base64 编码前的原始大小） |
| 内容校验 | 服务端校验图片文件头魔数（PNG/JPEG/WebP/GIF），与 mimeType 不符返回 400 |
| 图集上限 | 每个物料最多 9 张，超出时自动淘汰最旧的一张；同一 URL 不重复追加 |

密钥获取方式：生产服务器 `/opt/config/dianzi51-admin/runtime.env` 中的 `PORTAL_API_KEY` 环境变量（48 位随机串）。请通过安全渠道向项目负责人索取，不要写入代码仓库。

> **重要：必须使用 HTTPS 调用本接口。** 明文 HTTP 下大于约 16KB 的 POST 请求体会被公网链路的深度包检测截断（表现为上传完成后约 30 秒空响应断连）。服务器 443 端口已配置 HTTPS（自签证书），调用时需跳过证书校验：curl 加 `-k`；Node.js fetch/axios 设 `NODE_TLS_REJECT_UNAUTHORIZED=0` 或 agent `rejectUnauthorized: false`；Python requests 设 `verify=False`。查询类小请求（`material.lookup` 等）HTTP/HTTPS 均可。

## 三、型号匹配规则（2026-08-16 重要变更）

型号匹配是本接口最容易出错的环节，本节说明当前的完整规则。

### 3.1 匹配顺序

服务端按以下顺序尝试匹配，任一步命中即停止：

| 顺序 | 匹配方式 | 说明 |
|---|---|---|
| 第一步 | 精确匹配 | `UPPER(partNumber) = UPPER(输入)`，大小写不敏感 |
| 第二步 | 短号回退 | 精确匹配失败时，为输入补全 ST 封装+温度后缀再查，**必须唯一命中**才接受 |

### 3.2 短号回退的适用边界

短号回退是为兼容历史调用方而设的**安全网**，其触发条件被刻意限制得很窄：

> 仅当输入以 `STM32` 开头、且补全后在库内**唯一命中一条**记录时才生效。
> 若补全后命中多条（存在歧义），接口拒绝猜测，按型号不存在处理。

补全时尝试的后缀取自 ST 官方封装与温度等级编码表，包括 `T6`（LQFP）、`U6`（UFQFPN）、`H6`（BGA）、`Y6`（WLCSP）、`P6`（TSSOP）、`I6` 等。

**为何限定 STM32 而非全库启用：** 其他品牌的型号尾部两位可能是有效的规格位而非封装标识，盲目补全会把不同规格的料混为一谈。这一约束已写入契约测试，不应放宽。

### 3.3 历史背景与当前状态

2026-08-16 之前，库内有 464 条 ST 物料的 `partNumber` 被截去了尾部 2 位封装+温度标识——`STM32F058T8` 实际应为 `STM32F058T8Y6`。这批残缺型号让买家搜到实际买不到的料号，已于 2026-08-16 全部补全。

补全依据是图片文件名保留了完整型号，且实测 464 条无一例外满足「图片名 = 短号 + 恰好 2 位后缀」，后缀与 `package` 字段严格对应：

| 后缀 | 对应封装 | 条数 |
|---|---|---|
| T6 | LQFP | 370 |
| U6 | UFQFPN | 33 |
| H6 | BGA | 24 |
| Y6 | WLCSP | 16 |
| I6 | — | 14 |
| P6 | TSSOP | 7 |

**对调用方的影响：**

> 建议新调用方直接使用完整型号（`STM32F058T8Y6`）。
> 历史调用方沿用短号（`STM32F058T8`）仍可正常上传，由短号回退兼容承接。

需要特别注意的是，**第 3.4 节的注意事项已随本次补全而失效**：文档旧版本记载「库内型号不含封装后缀（是 `STM32F103C8` 而非 `STM32F103C8T6`）」，该描述在补全后不再成立，库内现为完整型号。

### 3.4 温度等级不可互认

请勿假设尾部两位仅代表封装差异。`T6` 与 `T7` 属于**不同温度等级**的不同料号，参数与性能均不同，不可互相替代。接口的短号回退只做「短号 → 完整号」的补全，不做完整号之间的等价替换。

作为对照，卷带包装标识（如 `...T6` 与 `...T6TR`）属于同一颗芯片的不同包装形式，这类差异在平台的兼容料推荐逻辑中被视为同料，但**不影响本接口的型号匹配**——上传时仍须使用库内实际存在的型号。

## 四、请求参数（JSON body 的 `json` 字段内）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| partNumber | string | 是 | 制造商型号，大小写不敏感。**推荐使用完整型号**（如 `STM32F058T8Y6`）；ST 短号可由回退兼容承接，详见第三节 |
| fileName | string | 是 | 原始文件名（仅记录用），如 `STM32F058T8Y6.png` |
| mimeType | string | 是 | `image/png` / `image/jpeg` / `image/webp` / `image/gif` |
| base64 | string | 是 | 图片内容的 base64 编码（**不含** `data:image/...;base64,` 前缀） |
| asCover | boolean | 否 | 默认 `true`（设为封面图）；传 `false` 时仅追加进图集，封面为空时才顺带设为封面 |

> **关于 `asCover` 与既有封面的关系：** 传 `false` 时不会覆盖已有封面。对于封面已指向 OSS 绝对地址的存量物料，新图仅追加进图集，原封面保持不变。若需替换封面，须显式传 `asCover: true`。

## 五、返回与错误码

成功返回示例：

```json
{"result":{"data":{"json":{
  "partNumber": "STM32F058T8Y6",
  "url": "/uploads/material-images/1784980860990-f6cbe499.png",
  "coverImageUrl": "https://dianzi51-assets.oss-cn-hangzhou.aliyuncs.com/materials/STM32F058T8Y6.png",
  "imageCount": 2
}}}}
```

返回的 `partNumber` 是**服务端实际命中的库内型号**。当短号回退生效时，此字段会返回补全后的完整型号，调用方可据此校验匹配结果是否符合预期。

`url` 为本次上传图片的相对路径，公网访问地址为 `http://47.97.108.147/admin` + `url`（由 Nginx 磁盘直出）。`coverImageUrl` 可能是相对路径也可能是 OSS 绝对地址，取决于该物料封面的既有来源。图片为静态 GET 资源不受 HTTPS 限制，HTTP 与 HTTPS 均可访问。

| HTTP 状态 | code | 含义 |
|---|---|---|
| 401 | UNAUTHORIZED | 缺少或错误的 `x-portal-key` |
| 404 | NOT_FOUND | 型号在物料库中不存在（含短号回退后仍未唯一命中的情形），返回消息包含具体型号 |
| 400 | BAD_REQUEST | 图片格式不支持 / 内容为空 / 超过 5MB / 文件头魔数校验失败 |

> **区分 404 与 400 有助于定位问题：** 返回 404 说明型号匹配失败，应核对型号写法；返回 400（如「文件内容不是有效的图片」）说明型号已匹配成功，问题出在图片数据本身。

## 六、调用示例

**curl（单张）：**

```bash
B64=$(base64 -w0 STM32F058T8Y6.png)
curl -k -X POST "https://47.97.108.147/admin/api/trpc/portal.uploadMaterialImage" \
  -H "Content-Type: application/json" \
  -H "x-portal-key: $PORTAL_KEY" \
  -d "{\"json\":{\"partNumber\":\"STM32F058T8Y6\",\"fileName\":\"STM32F058T8Y6.png\",\"mimeType\":\"image/png\",\"base64\":\"$B64\"}}"
```

**Node.js（批量：遍历目录，文件名即型号）：**

```javascript
import fs from "fs";
import path from "path";

// 自签证书：跳过校验（仅对本服务器）
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const BASE = "https://47.97.108.147/admin/api/trpc";
const KEY = process.env.PORTAL_API_KEY;
const MIME = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif",
};

const failures = [];

for (const file of fs.readdirSync("./images")) {
  const ext = path.extname(file).toLowerCase();
  const mimeType = MIME[ext];
  if (!mimeType) continue;

  const partNumber = path.basename(file, ext).trim();
  const base64 = fs.readFileSync(path.join("./images", file)).toString("base64");

  const res = await fetch(`${BASE}/portal.uploadMaterialImage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-portal-key": KEY },
    body: JSON.stringify({ json: { partNumber, fileName: file, mimeType, base64 } }),
  });
  const data = await res.json();

  if (res.ok) {
    const hit = data.result.data.json.partNumber;
    // 短号回退生效时命中型号与输入不同，记录下来便于核对
    const note = hit === partNumber ? "" : `（回退命中 ${hit}）`;
    console.log(`OK   ${partNumber}${note} → ${data.result.data.json.url}`);
  } else {
    failures.push({ partNumber, message: data.error?.json?.message });
    console.error(`FAIL ${partNumber}: ${data.error?.json?.message}`);
  }
  await new Promise(r => setTimeout(r, 200)); // 温和限速
}

if (failures.length) {
  fs.writeFileSync("upload-failures.json", JSON.stringify(failures, null, 2));
  console.log(`\n${failures.length} 张失败，清单已写入 upload-failures.json`);
}
```

## 七、型号查询与编码体系

上传前建议先确认库内型号写法。查询接口为公开接口，无需密钥：

```
GET http://47.97.108.147/admin/api/trpc/material.lookup?input={"json":{"keyword":"STM32F058"}}
```

### 7.1 支持用历史料号编码查询

2026-08-16 起，型号联想同时支持**历史料号编码反查**。若手上只有旧编码而没有型号，可直接用编码查询：

| 编码形态 | 说明 | 是否可查 |
|---|---|---|
| `51E-NNNNNNNN` | 当前正式编码，全库 610,601 条 | 可查（主编码） |
| `EXT-4-N` | 外部导入的历史编码，599,738 条 | 可查（已建别名映射） |
| `MAT20260001` | 已废弃的第一代编码，10,983 条 | 可查（保留别名供追溯） |

反查要求**完整编码精确匹配**（如 `EXT-4-224923`），不支持编码前缀模糊查询——`EXT-4-2` 这类前缀会命中数万条无关记录，反而淹没目标。型号本身仍支持模糊匹配。

### 7.2 编码体系现状

2026-08-16 完成了外部物料纳编：599,618 条 `EXT-` 外部导入物料已分配 `51E-` 正式编码，全库统一到单一编码体系。旧的 `EXT-4-N` 编码通过别名表持续可查，外部系统无需同步改造。

另有 120 条记录属于「外部导入物料与平台自有物料撞型号」的重复项。这些记录零图片、零库存引用，已标记为 `lifecycle=obsolete` + `status=disabled`，并保留 `EXT-` 原编码（不占用正式流水号）。它们不会出现在型号联想结果中，其编码作为别名指向资产齐全的正式记录。

> **物料记录不会被物理删除。** 平台代码层面禁止对 `materials` 表执行物理删除（`MATERIAL_PHYSICAL_DELETE_FORBIDDEN`），废弃记录统一以 `lifecycle`/`status` 标记，保证历史订单与外部引用可追溯。

## 八、批量导入建议

建议逐张串行上传，并发不超过 5，并保留失败清单供人工核对。对于 404（型号不存在）的失败项，优先检查以下三种情形：

第一种是型号写法差异，例如文件名带了库内不存在的后缀或分隔符，可用 `material.lookup` 确认标准写法。第二种是该型号确实不在库内，属于需要先补录物料主数据的情况。第三种是短号补全后命中多条产生歧义，此时接口按设计拒绝猜测，需要调用方提供完整型号。

上传完成后可通过公开搜索接口验证图片是否已正确回写到前台，或直接访问返回的 `coverImageUrl` 确认可达。

---

**文档维护：** 本文档随接口行为变更同步更新。型号匹配规则的相关约束（STM32 限定、唯一命中要求、温度等级不可互认）已固化为契约测试，位于 `server/partNumberFallback.test.ts` 与 `server/materialCodeSystem.test.ts`，修改接口行为时测试会拦截不兼容变更。

**作者：** Manus AI
