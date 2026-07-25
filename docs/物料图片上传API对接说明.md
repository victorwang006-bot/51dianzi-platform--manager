# 物料图片上传 API 对接说明

> 交付对象：负责物料图片资料上传的 Manus 任务
> 出具方：51电子网后台管理系统（dianzi51-admin）
> 日期：2026-07-25

## 一、接口用途与场景

本接口用于将物料图片（文件名即制造商型号，如 `STM32F103C8.jpg`）批量上传至 51电子网后台。后台收到图片后自动完成三件事：将图片保存到生产服务器存储、按型号（大小写不敏感）匹配物料数据库 `materials` 表中的记录、把图片 URL 回写到该物料的封面图（coverImageUrl）与图集（images）字段。回写完成后，前台网站通过 RDS 直连或公开搜索 API 即可读到图片。

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

密钥获取方式：生产 ECS `/opt/apps/dianzi51-admin/ecosystem.config.cjs` 中的 `PORTAL_API_KEY` 环境变量（48 位随机串）。请通过安全渠道向项目负责人索取，不要写入代码仓库。

> **重要：必须使用 HTTPS 调用本接口。** 明文 HTTP 下大于约 16KB 的 POST 请求体会被公网链路的深度包检测截断（表现为上传完成后约 30 秒空响应断连）。服务器 443 端口已配置 HTTPS（自签证书），调用时需跳过证书校验：curl 加 `-k`；Node.js fetch/axios 设 `NODE_TLS_REJECT_UNAUTHORIZED=0` 或 agent `rejectUnauthorized: false`；Python requests 设 `verify=False`。查询类小请求（material.lookup 等）HTTP/HTTPS 均可。

## 三、请求参数（JSON body 的 `json` 字段内）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| partNumber | string | 是 | 制造商型号，大小写不敏感，如 `STM32F103C8`。**注意库内型号不含封装后缀**（是 `STM32F103C8` 而非 `STM32F103C8T6`），建议先用查询接口确认 |
| fileName | string | 是 | 原始文件名（仅记录用），如 `STM32F103C8.jpg` |
| mimeType | string | 是 | `image/png` / `image/jpeg` / `image/webp` / `image/gif` |
| base64 | string | 是 | 图片内容的 base64 编码（**不含** `data:image/...;base64,` 前缀） |
| asCover | boolean | 否 | 默认 `true`（设为封面图）；传 `false` 时仅追加进图集，封面为空时才顺带设为封面 |

## 四、返回与错误码

成功返回示例：

```json
{"result":{"data":{"json":{
  "partNumber": "STM32F103C8",
  "url": "/uploads/material-images/1784980860990-f6cbe499.png",
  "coverImageUrl": "/uploads/material-images/1784980860990-f6cbe499.png",
  "imageCount": 1
}}}}
```

返回的 `url` 为相对路径，公网访问地址为 `http://47.97.108.147/admin` + `url`（由 Nginx 磁盘直出，已实测 200 且 Content-Type 正确）。
图片为静态 GET 资源不受上述限制，HTTP 与 HTTPS 均可访问。

| HTTP 状态 | code | 含义 |
|---|---|---|
| 401 | UNAUTHORIZED | 缺少或错误的 x-portal-key |
| 404 | NOT_FOUND | 型号在物料库中不存在（返回消息含具体型号） |
| 400 | BAD_REQUEST | 图片格式不支持 / 内容为空 / 超过 5MB / 文件头魔数校验失败（内容不是有效图片） |

## 五、调用示例

**curl（单张）：**

```bash
B64=$(base64 -w0 STM32F103C8.jpg)
curl -k -X POST "https://47.97.108.147/admin/api/trpc/portal.uploadMaterialImage" \
  -H "Content-Type: application/json" \
  -H "x-portal-key: $PORTAL_KEY" \
  -d "{\"json\":{\"partNumber\":\"STM32F103C8\",\"fileName\":\"STM32F103C8.jpg\",\"mimeType\":\"image/jpeg\",\"base64\":\"$B64\"}}"
```

**Node.js（批量：遍历目录，文件名即型号）：**

```javascript
import fs from "fs";
import path from "path";
import https from "https";

// 自签证书：跳过校验（仅对本服务器）
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const BASE = "https://47.97.108.147/admin/api/trpc";
const KEY = process.env.PORTAL_API_KEY;
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

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
  if (res.ok) console.log(`OK ${partNumber} → ${data.result.data.json.url}`);
  else console.error(`FAIL ${partNumber}: ${data.error?.json?.message}`);
  await new Promise(r => setTimeout(r, 200)); // 温和限速
}
```

## 六、批量导入建议

建议逐张串行上传并保留失败清单（型号不存在的 404 记录下来人工核对），不要并发超过 5。上传前可先调用型号查询接口确认库内型号写法：

```
GET http://47.97.108.147/admin/api/trpc/material.lookup?input={"json":{"keyword":"STM32F103"}}
```

该查询接口为公开接口无需密钥，返回匹配的型号候选列表，可用于把文件名（可能带封装后缀）映射到库内标准型号。
